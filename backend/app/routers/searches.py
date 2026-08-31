import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import func, select

from .. import llm
from .. import settings_store as st
from ..db import session
from ..models import Note, Paper, Search, SearchResult, Triage
from ..pipeline import (
    RUNNING, _screening_workload, run_clarify_questions, run_revision,
    run_translate, start_pipeline_task, start_task,
)
from ..synthesis import run_synthesis_task

router = APIRouter(prefix="/api/searches", tags=["searches"])


def _detail(search: Search) -> dict:
    if not search.stage_detail:
        return {}
    try:
        return json.loads(search.stage_detail)
    except ValueError:
        return {}


def _clarifications(search: Search) -> list[dict]:
    if not search.clarifications:
        return []
    try:
        parsed = json.loads(search.clarifications)
        return parsed if isinstance(parsed, list) else []
    except ValueError:
        return []


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
        "clarifications": _clarifications(search),
        "refined_question": search.refined_question,
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
    """Create the search and convert the question as a task — the client watches the stage."""
    raw = body.raw_query.strip()
    if not raw:
        raise HTTPException(400, "query is empty")
    try:  # fail fast so the Search screen can offer Settings before a row exists
        llm.resolve_model()
    except llm.LLMNotConfigured as e:
        raise HTTPException(409, str(e))
    search = Search(raw_query=raw, stage="translating")
    with session() as s:
        s.add(search)
        s.commit()
        s.refresh(search)
        out = _search_out(s, search)
    start_task(run_translate(search.id))
    return out


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
                raise HTTPException(400, "the PubMed query cannot be empty")
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
        s.delete(search)
        s.commit()
    return {"deleted": search_id}


@router.post("/{search_id}/run")
async def run_search(search_id: int) -> dict:
    """Fetch stage only: PubMed search→fetch→link, stopping at 'fetched'. No LLM cost."""
    with session() as s:
        search = s.get(Search, search_id)
        if search is None:
            raise HTTPException(404, "search not found")
        if not (search.translated_query or "").strip():
            raise HTTPException(400, "no PubMed query yet — convert the question first")
    if search_id in RUNNING:
        raise HTTPException(409, "already running")
    start_pipeline_task(search_id, "fetch")
    return {"started": True}


@router.post("/{search_id}/screen")
async def screen_search(search_id: int) -> dict:
    """Screen stage: enrich→triage→rank the fetched results. This spends tokens."""
    with session() as s:
        search = s.get(Search, search_id)
        if search is None:
            raise HTTPException(404, "search not found")
        n_linked = s.exec(
            select(func.count()).select_from(SearchResult).where(SearchResult.search_id == search_id)
        ).one()
    if n_linked == 0:
        raise HTTPException(400, "no fetched results — run the search first")
    if search_id in RUNNING:
        raise HTTPException(409, "already running")
    # fail fast if abstracts need screening but no model is configured
    _linked, todo = _screening_workload(search_id)
    if todo:
        try:
            llm.resolve_model()
        except llm.LLMNotConfigured as e:
            raise HTTPException(409, str(e))
    start_pipeline_task(search_id, "screen")
    return {"started": True}


@router.get("/{search_id}/results")
def search_results(search_id: int) -> dict:
    """The fetched records with their screening status — shown before committing tokens."""
    with session() as s:
        search = s.get(Search, search_id)
        if search is None:
            raise HTTPException(404, "search not found")
        rows = s.exec(
            select(Paper, Triage, SearchResult)
            .join(SearchResult, SearchResult.paper_id == Paper.id)
            .join(Triage, Triage.paper_id == Paper.id, isouter=True)
            .where(SearchResult.search_id == search_id)
            .order_by(Paper.year.desc(), Paper.pub_date.desc())  # type: ignore[union-attr]
        ).all()
        papers = [
            {
                "paper_id": p.id,
                "pmid": p.pmid,
                "title": p.title,
                "authors": p.authors,
                "journal": p.journal,
                "year": p.year,
                "url": p.url,
                "triaged": t is not None,
                "relevant": None if t is None else bool(t.relevant),
                "score": None if t is None else t.score,
                "status": sr.status,
            }
            for p, t, sr in rows
        ]
        to_screen = sum(1 for x in papers if not x["triaged"])
        return {
            "search": _search_out(s, search),
            "papers": papers,
            "summary": {
                "total": len(papers),
                "to_screen": to_screen,
                "already_triaged": len(papers) - to_screen,
                "prior_relevant": sum(1 for x in papers if x["relevant"]),
                "clarify_threshold": st.get_int("clarify_threshold", 30),
            },
        }


class RefineBody(BaseModel):
    instruction: str


def _guard_revision(search_id: int) -> None:
    """Shared preflight for the slow LLM revision endpoints (which run as tasks)."""
    with session() as s:
        if s.get(Search, search_id) is None:
            raise HTTPException(404, "search not found")
    if search_id in RUNNING:
        raise HTTPException(409, "search is running — wait for it to finish")
    try:
        llm.resolve_model()
    except llm.LLMNotConfigured as e:
        raise HTTPException(409, str(e))


@router.post("/{search_id}/refine")
async def refine_search(search_id: int, body: RefineBody) -> dict:
    """Revise the query with the LLM, then re-fetch — as a background task the client polls.

    Thinking models take 45-80s per revision; a phone won't hold a request that long.
    """
    instruction = body.instruction.strip()
    if not instruction:
        raise HTTPException(400, "instruction is empty")
    _guard_revision(search_id)
    start_task(run_revision(search_id, "refine", instruction))
    return {"started": True}


@router.post("/{search_id}/clarify/questions")
async def clarify_questions(search_id: int) -> dict:
    """Ask round: start the clarifier task; the questions land in stage_detail for polling.

    Costs one small LLM call — only ever fired by an explicit tap on the nudge.
    """
    _guard_revision(search_id)
    start_task(run_clarify_questions(search_id))
    return {"started": True}


class QA(BaseModel):
    question: str
    answer: str


class ClarifyBody(BaseModel):
    answers: list[QA]


@router.post("/{search_id}/clarify")
async def clarify_search(search_id: int, body: ClarifyBody) -> dict:
    """Answer round: fold the answers into a narrower query, then re-fetch — as a task."""
    answers = [
        {"question": a.question.strip(), "answer": a.answer.strip()}
        for a in body.answers
        if a.answer.strip()
    ]
    if not answers:
        raise HTTPException(400, "no answers given")
    _guard_revision(search_id)
    start_task(run_revision(search_id, "clarify", answers))
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
    """Start the synthesis task; the client polls status for synthesis_note_id."""
    _guard_revision(search_id)
    with session() as s:
        kept = s.exec(
            select(func.count()).select_from(SearchResult).where(
                SearchResult.search_id == search_id, SearchResult.status == "kept"
            )
        ).one()
    if kept == 0:
        raise HTTPException(400, "nothing in the pool yet — keep some papers first")
    start_task(run_synthesis_task(search_id))
    return {"started": True}
