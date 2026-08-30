import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import func, select

from .. import llm, prompts
from ..db import session
from ..models import CrawlLog, Note, Paper, Search, SearchResult, Triage
from ..pipeline import RUNNING, start_pipeline_task
from ..synthesis import synthesise as run_synthesis

router = APIRouter(prefix="/api/searches", tags=["searches"])


def _detail(search: Search) -> dict:
    if not search.stage_detail:
        return {}
    try:
        return json.loads(search.stage_detail)
    except ValueError:
        return {}


def _counts(s, search_id: int) -> dict:
    kept = s.exec(
        select(func.count()).select_from(SearchResult).where(
            SearchResult.search_id == search_id, SearchResult.status == "kept"
        )
    ).one()
    skipped = s.exec(
        select(func.count()).select_from(SearchResult).where(
            SearchResult.search_id == search_id, SearchResult.status == "skipped"
        )
    ).one()
    pending = s.exec(
        select(func.count())
        .select_from(SearchResult)
        .join(Triage, Triage.paper_id == SearchResult.paper_id)
        .where(
            SearchResult.search_id == search_id,
            SearchResult.status == "pending",
            Triage.relevant == 1,
        )
    ).one()
    return {"kept": kept, "skipped": skipped, "pending": pending}


def _search_out(s, search: Search) -> dict:
    return {
        "id": search.id,
        "raw_query": search.raw_query,
        "translated_query": search.translated_query,
        "date_from": search.date_from,
        "date_to": search.date_to,
        "pdf_only": bool(search.pdf_only),
        "is_saved": bool(search.is_saved),
        "stage": search.stage,
        "stage_detail": _detail(search),
        "created_at": search.created_at,
        "counts": _counts(s, search.id),
    }


def card(paper: Paper, triage: Triage, sr: SearchResult) -> dict:
    return {
        "paper_id": paper.id,
        "pmid": paper.pmid,
        "doi": paper.doi,
        "title": paper.title,
        "authors": paper.authors,
        "journal": paper.journal,
        "year": paper.year,
        "abstract": paper.abstract,
        "url": paper.url,
        "pdf_url": paper.pdf_url,
        "design": triage.design,
        "n": triage.n,
        "followup": triage.followup,
        "finding": triage.finding,
        "weakness": triage.weakness,
        "strengths": json.loads(triage.strengths) if triage.strengths else [],
        "score": triage.score or 0,
        "peer_reviewed": bool(triage.peer_reviewed),
        "randomised": bool(triage.randomised),
        "masked": bool(triage.masked),
        "rank": sr.rank,
        "status": sr.status,
        "decided_at": sr.decided_at,
    }


class SearchCreate(BaseModel):
    raw_query: str


@router.post("")
async def create_search(body: SearchCreate) -> dict:
    raw = body.raw_query.strip()
    if not raw:
        raise HTTPException(400, "query is empty")
    search = Search(raw_query=raw, stage="translating")
    with session() as s:
        s.add(search)
        s.commit()
        s.refresh(search)
    try:
        reply = await llm.chat("translator", prompts.TRANSLATOR_SYSTEM, raw, temperature=0.0)
        parsed = llm.extract_json(reply)
        translated = str(parsed.get("pubmed_query") or "").strip()
        if not translated:
            raise ValueError("translator returned no pubmed_query")
        rationale = str(parsed.get("rationale") or "").strip()
    except llm.LLMNotConfigured as e:
        with session() as s:
            s.delete(s.get(Search, search.id))
            s.commit()
        raise HTTPException(409, str(e))
    except Exception as e:
        with session() as s:
            s.delete(s.get(Search, search.id))
            s.commit()
        raise HTTPException(502, f"translation failed: {e}")
    with session() as s:
        fresh = s.get(Search, search.id)
        fresh.translated_query = translated
        fresh.stage = "new"
        fresh.stage_detail = json.dumps({"rationale": rationale})
        s.add(fresh)
        s.commit()
        return _search_out(s, fresh)


@router.get("")
def list_searches() -> list[dict]:
    with session() as s:
        rows = s.exec(select(Search).order_by(Search.created_at.desc())).all()  # type: ignore[union-attr]
        return [_search_out(s, row) for row in rows]


@router.get("/{search_id}")
def get_search(search_id: int) -> dict:
    with session() as s:
        search = s.get(Search, search_id)
        if search is None:
            raise HTTPException(404, "search not found")
        return _search_out(s, search)


class SearchPatch(BaseModel):
    translated_query: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    pdf_only: bool | None = None
    is_saved: bool | None = None


@router.patch("/{search_id}")
def patch_search(search_id: int, body: SearchPatch) -> dict:
    fields = body.model_dump(exclude_unset=True)
    with session() as s:
        search = s.get(Search, search_id)
        if search is None:
            raise HTTPException(404, "search not found")
        for key, value in fields.items():
            if key in ("pdf_only", "is_saved"):
                value = int(bool(value))
            if key == "translated_query" and (value or "").strip() == "":
                raise HTTPException(400, "translated query cannot be empty")
            setattr(search, key, value)
        s.add(search)
        s.commit()
        return _search_out(s, search)


@router.delete("/{search_id}")
def delete_search(search_id: int) -> dict:
    if search_id in RUNNING:
        raise HTTPException(409, "search is running — wait for it to finish")
    with session() as s:
        search = s.get(Search, search_id)
        if search is None:
            raise HTTPException(404, "search not found")
        for sr in s.exec(select(SearchResult).where(SearchResult.search_id == search_id)).all():
            s.delete(sr)
        for note in s.exec(select(Note).where(Note.search_id == search_id)).all():
            note.search_id = None  # keep the note, orphan it
            s.add(note)
        for row in s.exec(select(CrawlLog).where(CrawlLog.search_id == search_id)).all():
            s.delete(row)
        s.delete(search)
        s.commit()
    return {"deleted": search_id}


@router.post("/{search_id}/run")
async def run_search(search_id: int) -> dict:
    with session() as s:
        search = s.get(Search, search_id)
        if search is None:
            raise HTTPException(404, "search not found")
        if not (search.translated_query or "").strip():
            raise HTTPException(400, "no translated query — translate first")
    if search_id in RUNNING:
        raise HTTPException(409, "already running")
    # fail fast if the triage role is missing, before kicking the background task
    try:
        llm.resolve_role("triage")
    except llm.LLMNotConfigured as e:
        raise HTTPException(409, str(e))
    start_pipeline_task(search_id)
    return {"started": True}


@router.get("/{search_id}/status")
def search_status(search_id: int) -> dict:
    with session() as s:
        search = s.get(Search, search_id)
        if search is None:
            raise HTTPException(404, "search not found")
        return {"stage": search.stage, "stage_detail": _detail(search)}


def _cards(s, search_id: int, status: str) -> list[dict]:
    rows = s.exec(
        select(Paper, Triage, SearchResult)
        .join(Triage, Triage.paper_id == Paper.id)
        .join(SearchResult, SearchResult.paper_id == Paper.id)
        .where(
            SearchResult.search_id == search_id,
            SearchResult.status == status,
            Triage.relevant == 1,
        )
        .order_by(SearchResult.rank)
    ).all()
    return [card(p, t, sr) for p, t, sr in rows]


@router.get("/{search_id}/deck")
def deck(search_id: int) -> dict:
    with session() as s:
        search = s.get(Search, search_id)
        if search is None:
            raise HTTPException(404, "search not found")
        return {
            "search": {"id": search.id, "raw_query": search.raw_query, "stage": search.stage},
            "cards": _cards(s, search_id, "pending"),
            "counts": _counts(s, search_id),
        }


@router.get("/{search_id}/pool")
def pool(search_id: int) -> dict:
    with session() as s:
        search = s.get(Search, search_id)
        if search is None:
            raise HTTPException(404, "search not found")
        kept = s.exec(
            select(Paper, Triage, SearchResult)
            .join(Triage, Triage.paper_id == Paper.id)
            .join(SearchResult, SearchResult.paper_id == Paper.id)
            .where(SearchResult.search_id == search_id, SearchResult.status == "kept")
            .order_by(SearchResult.decided_at)
        ).all()
        return {
            "search": {"id": search.id, "raw_query": search.raw_query},
            "papers": [card(p, t, sr) for p, t, sr in kept],
            "counts": _counts(s, search_id),
        }


@router.post("/{search_id}/synthesise")
async def synthesise(search_id: int) -> dict:
    try:
        llm.resolve_role("synthesis")
    except llm.LLMNotConfigured as e:
        raise HTTPException(409, str(e))
    try:
        note = await run_synthesis(search_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except llm.LLMError as e:
        raise HTTPException(502, str(e))
    return {
        "id": note.id,
        "search_id": note.search_id,
        "title": note.title,
        "body_md": note.body_md,
        "paper_ids": json.loads(note.paper_ids),
        "created_at": note.created_at,
    }
