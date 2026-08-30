"""The search pipeline: PubMed → dedupe → enrich → LLM triage → ranked deck.

Also the monthly crawl (forward window + one backfill step per saved search).
"""

import asyncio
import json
import logging
from datetime import date, datetime, timezone

import httpx
from pydantic import BaseModel, field_validator
from sqlmodel import select

from . import llm, prompts
from . import settings_store as st
from .db import session
from .enrich import enrich_papers
from .models import CrawlLog, Paper, Search, SearchResult, Triage, utcnow
from .pubmed import esearch, efetch_page, normalise_doi

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


# ── the pipeline ─────────────────────────────────────────────


def _dedupe_and_link(records: list[dict], search_id: int) -> tuple[list[int], int, dict[int, str]]:
    """Upsert papers, link into search_results. Returns (linked_ids, new_count, pmcids)."""
    linked: list[int] = []
    new_count = 0
    pmcids: dict[int, str] = {}
    with session() as s:
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
                )
                s.add(paper)
                s.commit()
                s.refresh(paper)
                new_count += 1
            if rec.get("pmcid"):
                pmcids[paper.id] = rec["pmcid"]
            link = s.get(SearchResult, (search_id, paper.id))
            if link is None:
                s.add(SearchResult(search_id=search_id, paper_id=paper.id))
                s.commit()
            linked.append(paper.id)
    return linked, new_count, pmcids


async def run_pipeline(
    search_id: int,
    window_from: str | None = None,
    window_to: str | None = None,
    update_stage: bool = True,
) -> dict:
    """Run search→fetch→dedupe→enrich→triage→rank for one search.

    With window_from/window_to set (crawler), the search's own dates are ignored
    and the UI stage is left alone unless update_stage is True.
    """
    if search_id in RUNNING:
        raise RuntimeError("already running")
    RUNNING.add(search_id)
    try:
        return await _run_pipeline_inner(search_id, window_from, window_to, update_stage)
    finally:
        RUNNING.discard(search_id)


async def _run_pipeline_inner(
    search_id: int,
    window_from: str | None,
    window_to: str | None,
    update_stage: bool,
) -> dict:
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
    date_from = window_from if (window_from or window_to) else search.date_from
    date_to = window_to if (window_from or window_to) else search.date_to

    if update_stage:
        set_stage(search_id, "searching", found=None, fetched=0, no_abstract=0,
                  new_papers=0, to_screen=0, screened=0, passed=None, error=None)

    stats = {"found": 0, "fetched": 0, "no_abstract": 0, "new_papers": 0}

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            count, webenv, qk = await esearch(client, term, date_from, date_to)
            stats["found"] = count
            if update_stage:
                set_stage(search_id, found=count)

            records: list[dict] = []
            fetched = 0
            for start in range(0, min(count, cap), EFETCH_PAGE_SIZE):
                page = await efetch_page(client, webenv, qk, start, min(EFETCH_PAGE_SIZE, cap - start))
                fetched += len(page)
                with_abstract = [r for r in page if r["abstract"]]
                stats["no_abstract"] += len(page) - len(with_abstract)
                records.extend(with_abstract)
                if update_stage:
                    set_stage(search_id, fetched=fetched, no_abstract=stats["no_abstract"])
            stats["fetched"] = fetched

        linked, new_count, pmcids = _dedupe_and_link(records, search_id)
        stats["new_papers"] = new_count
        if update_stage:
            set_stage(search_id, new_papers=new_count)

        await enrich_papers(linked, pmcids)

        # ── triage ──
        with session() as s:
            done = {
                t for (t,) in s.exec(
                    select(Triage.paper_id).where(Triage.paper_id.in_(linked))  # type: ignore[attr-defined]
                ).all()
            } if linked else set()
            todo = [s.get(Paper, pid) for pid in linked if pid not in done]
        if update_stage:
            set_stage(search_id, "screening", to_screen=len(todo), screened=0)

        if todo:
            try:
                _label, _url, _key, model_name = llm.resolve_model()
            except llm.LLMNotConfigured:
                raise
            system = prompts.triage_system(search.raw_query, search.translated_query, recent_feedback())
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
                    if update_stage:
                        set_stage(search_id, screened=screened)

            await asyncio.gather(*(one(p) for p in todo))

        deck_size = rank_search(search_id)
        if update_stage:
            set_stage(search_id, "ready", passed=deck_size)

        # first successful run seeds the backfill cursor
        with session() as s:
            search = s.get(Search, search_id)
            if search and not search.backfill_cursor and not window_from:
                cursor = search.date_from
                if not cursor:
                    years = [r["year"] for r in records if r.get("year")]
                    cursor = f"{min(years):04d}-01-01" if years else date.today().isoformat()
                search.backfill_cursor = cursor
                s.add(search)
                s.commit()

        return stats
    except Exception as e:
        log.exception("pipeline failed for search %s", search_id)
        if update_stage:
            set_stage(search_id, "error", error=str(e)[:500])
        raise


def start_pipeline_task(search_id: int) -> None:
    async def runner():
        try:
            await run_pipeline(search_id)
        except Exception:
            pass  # already logged and staged

    asyncio.get_running_loop().create_task(runner())


# ── monthly crawl ────────────────────────────────────────────


def _months_back(d: date, months: int) -> date:
    y, m = d.year, d.month - months
    while m < 1:
        m += 12
        y -= 1
    return date(y, m, min(d.day, 28))


def _log_crawl(search_id: int, wfrom: str, wto: str, stats: dict | None, error: str | None) -> None:
    with session() as s:
        s.add(
            CrawlLog(
                search_id=search_id,
                window_from=wfrom,
                window_to=wto,
                found=(stats or {}).get("found"),
                new_papers=(stats or {}).get("new_papers"),
                ran_at=utcnow(),
                status="error" if error else "ok",
                error=error,
            )
        )
        s.commit()


async def crawl_search(search: Search) -> None:
    today = date.today().isoformat()

    # forward: last successful window_to (or creation date) → today
    with session() as s:
        last_to = s.exec(
            select(CrawlLog.window_to)
            .where(CrawlLog.search_id == search.id, CrawlLog.status == "ok")
            .order_by(CrawlLog.window_to.desc())  # type: ignore[union-attr]
            .limit(1)
        ).first()
    wfrom = last_to or search.created_at[:10]
    try:
        stats = await run_pipeline(search.id, window_from=wfrom, window_to=today, update_stage=False)
        _log_crawl(search.id, wfrom, today, stats, None)
    except Exception as e:
        _log_crawl(search.id, wfrom, today, None, str(e)[:500])
        return

    # backward: one backfill window further into the past
    floor = date(st.get_int("backfill_floor_year", 2000), 1, 1)
    window_months = st.get_int("backfill_window_months", 12)
    with session() as s:
        fresh = s.get(Search, search.id)
        cursor_str = fresh.backfill_cursor if fresh else None
    if not cursor_str:
        return
    cursor = date.fromisoformat(cursor_str[:10])
    if cursor <= floor:
        return
    new_from = max(_months_back(cursor, window_months), floor)
    try:
        stats = await run_pipeline(
            search.id, window_from=new_from.isoformat(), window_to=cursor.isoformat(), update_stage=False
        )
        _log_crawl(search.id, new_from.isoformat(), cursor.isoformat(), stats, None)
        with session() as s:
            fresh = s.get(Search, search.id)
            if fresh:
                fresh.backfill_cursor = new_from.isoformat()
                s.add(fresh)
                s.commit()
    except Exception as e:
        _log_crawl(search.id, new_from.isoformat(), cursor.isoformat(), None, str(e)[:500])


async def monthly_crawl() -> dict:
    log.info("monthly crawl starting")
    with session() as s:
        saved = s.exec(select(Search).where(Search.is_saved == 1)).all()
    ran = 0
    for search in saved:
        if search.id in RUNNING:
            log.info("skipping search %s — pipeline already running", search.id)
            continue
        await crawl_search(search)
        ran += 1
    log.info("monthly crawl done: %d searches", ran)
    return {"searches_crawled": ran}
