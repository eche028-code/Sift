"""The search pipeline: PubMed → dedupe → enrich → LLM triage → ranked deck.

"""

import asyncio
import json
import logging

import httpx
from pydantic import BaseModel, field_validator
from sqlmodel import select

from . import llm, prompts
from . import settings_store as st
from .db import session
from .enrich import enrich_papers
from .models import Paper, Search, SearchResult, Triage
from .pubmed import esearch, efetch_page

log = logging.getLogger("sift.pipeline")

RUNNING: set[int] = set()  # search ids with a pipeline task in flight
TRIAGE_CONCURRENCY = 5
EFETCH_PAGE_SIZE = 100


# ── stage bookkeeping ────────────────────────────────────────


def set_stage(search_id: int, stage: str | None = None, **detail_updates) -> None:
    with session() as s:
        search = s.get(Search, search_id)
        if search is None:
            return
        if stage is not None:
            search.stage = stage
        detail = json.loads(search.stage_detail) if search.stage_detail else {}
        detail.update(detail_updates)
        search.stage_detail = json.dumps(detail)
        s.add(search)
        s.commit()


# ── triage output contract ───────────────────────────────────


class TriageOut(BaseModel):
    relevant: bool
    finding: str | None = None
    design: str | None = None
    n: int | None = None
    followup: str | None = None
    weakness: str | None = None
    strengths: list[str] = []
    score: int = 0
    peer_reviewed: bool | None = None
    randomised: bool | None = None
    masked: bool | None = None

    @field_validator("n", mode="before")
    @classmethod
    def _coerce_n(cls, v):
        if isinstance(v, str):
            digits = "".join(ch for ch in v if ch.isdigit())
            return int(digits) if digits else None
        return v

    @field_validator("score", mode="before")
    @classmethod
    def _clamp_score(cls, v):
        try:
            return max(0, min(100, int(v)))
        except (TypeError, ValueError):
            return 0

    @field_validator("strengths", mode="before")
    @classmethod
    def _strengths_list(cls, v):
        if v is None:
            return []
        if isinstance(v, str):
            return [v]
        return v


def recent_feedback() -> str:
    """Up to 20 most recent kept and skipped papers across all searches."""
    out = {"kept": [], "skipped": []}
    with session() as s:
        for status in ("kept", "skipped"):
            rows = s.exec(
                select(Paper.title, Triage.finding)
                .join(SearchResult, SearchResult.paper_id == Paper.id)
                .join(Triage, Triage.paper_id == Paper.id, isouter=True)
                .where(SearchResult.status == status)
                .order_by(SearchResult.decided_at.desc())  # type: ignore[union-attr]
                .limit(20)
            ).all()
            out[status] = [{"title": t, "finding": f} for t, f in rows]
    return prompts.feedback_block(out["kept"], out["skipped"])


async def triage_one(paper: Paper, system: str) -> tuple[TriageOut, str]:
    user = prompts.triage_user(paper.title, paper.journal, paper.year, paper.abstract or "")
    raw = ""
    for attempt in range(2):  # one retry on parse failure
        raw = await llm.chat("triage", system, user, temperature=0.2, force_json=True)
        try:
            return TriageOut.model_validate(llm.extract_json(raw)), raw
        except llm.LLMNotConfigured:
            raise
        except Exception as e:
            if attempt == 1:
                raise ValueError(f"unparseable triage reply: {e}\n---\n{raw[:1000]}")
    raise RuntimeError("unreachable")


def save_triage(paper_id: int, out: TriageOut, raw: str, model_used: str) -> None:
    with session() as s:
        row = Triage(
            paper_id=paper_id,
            relevant=int(out.relevant),
            finding=out.finding,
            design=out.design,
            n=out.n,
            followup=out.followup,
            weakness=out.weakness,
            strengths=json.dumps(out.strengths),
            score=out.score,
            peer_reviewed=None if out.peer_reviewed is None else int(out.peer_reviewed),
            randomised=None if out.randomised is None else int(out.randomised),
            masked=None if out.masked is None else int(out.masked),
            model_used=model_used,
            raw_json=raw[:20000],
        )
        s.merge(row)
        s.commit()


def save_triage_error(paper_id: int, error: str, model_used: str) -> None:
    with session() as s:
        s.merge(
            Triage(
                paper_id=paper_id,
                relevant=0,
                score=0,
                model_used=model_used,
                raw_json=json.dumps({"error": error[:2000]}),
            )
        )
        s.commit()


# ── ranking ──────────────────────────────────────────────────


def rank_search(search_id: int) -> int:
    """rank = score DESC, year DESC over relevant results. Returns pending deck size."""
    with session() as s:
        rows = s.exec(
            select(SearchResult, Triage.score, Paper.year)
            .join(Triage, Triage.paper_id == SearchResult.paper_id)
            .join(Paper, Paper.id == SearchResult.paper_id)
            .where(SearchResult.search_id == search_id, Triage.relevant == 1)
        ).all()
        ordered = sorted(rows, key=lambda r: (-(r[1] or 0), -(r[2] or 0)))
        pending = 0
        for i, (sr, _score, _year) in enumerate(ordered):
            sr.rank = i + 1
            if sr.status == "pending":
                pending += 1
            s.add(sr)
        s.commit()
    return pending


# ── the pipeline: fetch stage (free) then screen stage (spends tokens) ──


def _dedupe_and_link(records: list[dict], search_id: int) -> None:
    """Upsert papers and link them into search_results.

    Pending links from a previous run of this search are dropped first, so a
    refined query replaces the un-reviewed results instead of piling onto them.
    Kept/skipped links are history and always survive.
    """
    with session() as s:
        for sr in s.exec(
            select(SearchResult).where(
                SearchResult.search_id == search_id, SearchResult.status == "pending"
            )
        ).all():
            s.delete(sr)
        s.commit()
        for rec in records:
            paper = None
            if rec["pmid"]:
                paper = s.exec(select(Paper).where(Paper.pmid == rec["pmid"])).first()
            if paper is None and rec["doi"]:
                paper = s.exec(select(Paper).where(Paper.doi == rec["doi"])).first()
            if paper is None:
                paper = Paper(
                    pmid=rec["pmid"],
                    doi=rec["doi"],
                    title=rec["title"],
                    authors=rec["authors"],
                    journal=rec["journal"],
                    year=rec["year"],
                    pub_date=rec["pub_date"],
                    abstract=rec["abstract"],
                    url=rec["url"],
                    pmcid=rec.get("pmcid"),
                )
                s.add(paper)
                s.commit()
                s.refresh(paper)
            elif rec.get("pmcid") and not paper.pmcid:
                paper.pmcid = rec["pmcid"]
                s.add(paper)
                s.commit()
            link = s.get(SearchResult, (search_id, paper.id))
            if link is None:
                s.add(SearchResult(search_id=search_id, paper_id=paper.id))
                s.commit()


def _screening_workload(search_id: int) -> tuple[list[int], list[int]]:
    """(all linked paper ids, subset with no triage row yet) for a search."""
    with session() as s:
        linked = list(s.exec(
            select(SearchResult.paper_id).where(SearchResult.search_id == search_id)
        ).all())
        done = set(s.exec(
            select(Triage.paper_id).where(Triage.paper_id.in_(linked))  # type: ignore[attr-defined]
        ).all()) if linked else set()
    return linked, [pid for pid in linked if pid not in done]


async def run_fetch(search_id: int) -> dict:
    """PubMed search→fetch→dedupe→link. No LLM calls — stops at stage 'fetched'."""
    if search_id in RUNNING:
        raise RuntimeError("already running")
    RUNNING.add(search_id)
    try:
        return await _run_fetch_inner(search_id)
    finally:
        RUNNING.discard(search_id)


async def _run_fetch_inner(search_id: int) -> dict:
    with session() as s:
        search = s.get(Search, search_id)
        if search is None:
            raise ValueError(f"search {search_id} not found")
    if not (search.translated_query or "").strip():
        raise ValueError("translated query is empty")

    cap = st.get_int("record_cap", 200)
    term = search.translated_query
    if search.pdf_only:
        term = f"({term}) AND free full text[sb]"

    set_stage(search_id, "searching", found=None, fetched=0, no_abstract=0,
              to_screen=None, screened=0, passed=None, error=None)

    stats = {"found": 0, "fetched": 0, "no_abstract": 0}

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            count, webenv, qk = await esearch(client, term, search.date_from, search.date_to)
            stats["found"] = count
            set_stage(search_id, found=count)

            records: list[dict] = []
            fetched = 0
            for start in range(0, min(count, cap), EFETCH_PAGE_SIZE):
                page = await efetch_page(client, webenv, qk, start, min(EFETCH_PAGE_SIZE, cap - start))
                fetched += len(page)
                with_abstract = [r for r in page if r["abstract"]]
                stats["no_abstract"] += len(page) - len(with_abstract)
                records.extend(with_abstract)
                set_stage(search_id, fetched=fetched, no_abstract=stats["no_abstract"])
            stats["fetched"] = fetched

        _dedupe_and_link(records, search_id)

        todo = _screening_workload(search_id)[1]
        set_stage(search_id, "fetched", to_screen=len(todo))
        return stats
    except Exception as e:
        log.exception("fetch failed for search %s", search_id)
        set_stage(search_id, "error", error=str(e)[:500])
        raise


async def run_screen(search_id: int) -> dict:
    """Enrich→LLM triage→rank the already-fetched results. This is the stage that spends tokens."""
    if search_id in RUNNING:
        raise RuntimeError("already running")
    RUNNING.add(search_id)
    try:
        return await _run_screen_inner(search_id)
    finally:
        RUNNING.discard(search_id)


async def _run_screen_inner(search_id: int) -> dict:
    with session() as s:
        search = s.get(Search, search_id)
        if search is None:
            raise ValueError(f"search {search_id} not found")

    linked, todo_ids = _screening_workload(search_id)
    set_stage(search_id, "screening", to_screen=len(todo_ids), screened=0, error=None)

    try:
        with session() as s:
            pmcids = {
                p.id: p.pmcid
                for pid in set(linked)
                if (p := s.get(Paper, pid)) and p.pmcid
            }
        await enrich_papers(list(dict.fromkeys(linked)), pmcids)

        with session() as s:
            todo = [s.get(Paper, pid) for pid in todo_ids]

        if todo:
            _label, _url, _key, model_name = llm.resolve_model()
            question = search.refined_question or search.raw_query
            system = prompts.triage_system(question, search.translated_query, recent_feedback())
            sem = asyncio.Semaphore(TRIAGE_CONCURRENCY)
            screened = 0

            async def one(paper: Paper) -> None:
                nonlocal screened
                async with sem:
                    try:
                        out, raw = await triage_one(paper, system)
                        save_triage(paper.id, out, raw, model_name)
                    except llm.LLMNotConfigured:
                        raise
                    except Exception as e:
                        log.warning("triage failed for paper %s: %s", paper.id, e)
                        save_triage_error(paper.id, str(e), model_name)
                    screened += 1
                    set_stage(search_id, screened=screened)

            await asyncio.gather(*(one(p) for p in todo))

        deck_size = rank_search(search_id)
        set_stage(search_id, "ready", passed=deck_size)
        return {"screened": len(todo_ids), "passed": deck_size}
    except Exception as e:
        log.exception("screening failed for search %s", search_id)
        set_stage(search_id, "error", error=str(e)[:500])
        raise


# ── background query revision (refine / clarify) ─────────────
#
# These calls go through the same thinking model as triage and routinely take
# 45-80s. A phone PWA won't hold a fetch that long (iOS aborts around 60s, and
# instantly on backgrounding), so like fetch/screen they run as tasks and the
# client polls status; the LLM round-trip never rides on the request socket.


def revision_context(search_id: int) -> tuple[str, str, int | None, list[str], list[dict]] | None:
    """(raw_query, current_query, found, sample_titles, clarifications), or None if gone."""
    with session() as s:
        search = s.get(Search, search_id)
        if search is None:
            return None
        titles = list(s.exec(
            select(Paper.title)
            .join(SearchResult, SearchResult.paper_id == Paper.id)
            .where(SearchResult.search_id == search_id)
            .order_by(Paper.year.desc())  # type: ignore[union-attr]
            .limit(12)
        ).all())
        detail = json.loads(search.stage_detail) if search.stage_detail else {}
        clar = []
        if search.clarifications:
            try:
                parsed = json.loads(search.clarifications)
                clar = parsed if isinstance(parsed, list) else []
            except ValueError:
                pass
        return (
            search.raw_query,
            search.translated_query or "",
            detail.get("found"),
            titles,
            clar,
        )


async def _translate_round(system: str, user: str) -> tuple[str, str, str]:
    """One query-converter call: (pubmed_query, rationale, refined_question)."""
    reply = await llm.chat("query converter", system, user, temperature=0.0)
    parsed = llm.extract_json(reply)
    translated = str(parsed.get("pubmed_query") or "").strip()
    if not translated:
        raise ValueError("query converter returned no pubmed_query")
    return (
        translated,
        str(parsed.get("rationale") or "").strip(),
        str(parsed.get("refined_question") or "").strip(),
    )


def _persist_translation(search_id: int, translated: str, rationale: str, **fields) -> None:
    with session() as s:
        search = s.get(Search, search_id)
        if search is None:
            return
        search.translated_query = translated
        for key, value in fields.items():
            setattr(search, key, value)
        detail = json.loads(search.stage_detail) if search.stage_detail else {}
        detail["rationale"] = rationale
        search.stage_detail = json.dumps(detail)
        s.add(search)
        s.commit()


async def run_translate(search_id: int) -> None:
    """First conversion of a raw question into a PubMed query; ends at stage 'new'."""
    if search_id in RUNNING:
        raise RuntimeError("already running")
    RUNNING.add(search_id)
    try:
        with session() as s:
            search = s.get(Search, search_id)
            if search is None:
                return
            raw = search.raw_query
        try:
            translated, rationale, _refined = await _translate_round(
                prompts.translator_system(), raw
            )
        except Exception as e:
            log.exception("query conversion failed for search %s", search_id)
            set_stage(search_id, "error", error=f"query conversion failed: {e}"[:500])
            return
        _persist_translation(search_id, translated, rationale, stage="new")
    finally:
        RUNNING.discard(search_id)


async def run_revision(search_id: int, mode: str, payload) -> None:
    """Rebuild the query from a refine instruction or clarify answers, then re-fetch.

    mode 'refine': payload is the instruction string.
    mode 'clarify': payload is the new [{question, answer}] list.
    """
    if search_id in RUNNING:
        raise RuntimeError("already running")
    RUNNING.add(search_id)
    try:
        ctx = revision_context(search_id)
        if ctx is None:
            return
        raw_query, current_query, found, titles, prior = ctx
        # entering a new revision invalidates any question round left in the detail
        set_stage(search_id, "translating", error=None,
                  clarify_status=None, clarify_questions=None, clarify_error=None)
        try:
            if mode == "clarify":
                combined = prior + payload
                translated, rationale, refined = await _translate_round(
                    prompts.clarified_translator_system(),
                    prompts.clarify_answers_user(raw_query, current_query, found, titles, combined),
                )
                extra = {"clarifications": json.dumps(combined, ensure_ascii=False)}
                if refined:  # keep any earlier refined question if this round didn't return one
                    extra["refined_question"] = refined
            else:
                translated, rationale, _refined = await _translate_round(
                    prompts.translator_system(),
                    prompts.refine_user(raw_query, current_query, found, titles, payload, prior),
                )
                extra = {}
        except Exception as e:
            log.exception("%s failed for search %s", mode, search_id)
            failure = "clarification failed" if mode == "clarify" else "refinement failed"
            set_stage(search_id, "error", error=f"{failure}: {e}"[:500])
            return
        _persist_translation(search_id, translated, rationale, **extra)
        await _run_fetch_inner(search_id)
    finally:
        RUNNING.discard(search_id)


async def run_clarify_questions(search_id: int) -> None:
    """Ask round: propose narrowing questions. Leaves the stage alone; results land in stage_detail."""
    if search_id in RUNNING:
        raise RuntimeError("already running")
    RUNNING.add(search_id)
    try:
        ctx = revision_context(search_id)
        if ctx is None:
            return
        raw_query, current_query, found, titles, clar = ctx
        set_stage(search_id, clarify_status="running", clarify_questions=None, clarify_error=None)
        try:
            reply = await llm.chat(
                "clarifier",
                prompts.clarifier_system(),
                prompts.clarify_questions_user(raw_query, current_query, found, titles, clar),
                temperature=0.2,
            )
            parsed = llm.extract_json(reply)
        except Exception as e:
            log.exception("clarifier failed for search %s", search_id)
            set_stage(search_id, clarify_status="error", clarify_error=f"clarifier failed: {e}"[:300])
            return
        questions = []
        for q in (parsed.get("clarify_questions") or [])[:3]:  # the cap is code-enforced
            if not isinstance(q, dict):
                continue
            text = str(q.get("text") or "").strip()
            if not text:
                continue
            options = [str(o).strip() for o in (q.get("options") or []) if str(o).strip()][:5]
            questions.append({"text": text, "options": options})
        set_stage(search_id, clarify_status="done", clarify_questions=questions)
    finally:
        RUNNING.discard(search_id)


def start_task(coro) -> None:
    """Fire-and-forget a pipeline coroutine; failures are logged and staged inside."""

    async def runner():
        try:
            await coro
        except Exception:
            pass  # already logged and staged

    asyncio.get_running_loop().create_task(runner())


def start_pipeline_task(search_id: int, mode: str = "fetch") -> None:
    start_task((run_screen if mode == "screen" else run_fetch)(search_id))
