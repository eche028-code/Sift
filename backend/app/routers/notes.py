import json

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import select

from .. import codex
from ..db import session
from ..models import Note, Search, utcnow

router = APIRouter(prefix="/api/notes", tags=["notes"])


class ExportIn(BaseModel):
    tags: list[str] = []
    reflection: str | None = None


def note_out(note: Note, raw_query: str | None) -> dict:
    return {
        "id": note.id,
        "search_id": note.search_id,
        "title": note.title,
        "body_md": note.body_md,
        "paper_ids": json.loads(note.paper_ids),
        "created_at": note.created_at,
        "raw_query": raw_query,
        "tags": codex.tag_list(note.tags),
        "reflection": note.reflection,
        "exported_at": note.exported_at,
    }


def _note_and_question(s, note_id: int) -> tuple[Note, str | None, str | None]:
    """The note, the question to head the fragment with, and the raw query."""
    note = s.get(Note, note_id)
    if note is None:
        raise HTTPException(404, "note not found")
    search = s.get(Search, note.search_id) if note.search_id else None
    if search is None:
        return note, None, None
    return note, (search.refined_question or search.raw_query), search.raw_query


@router.get("")
def list_notes() -> list[dict]:
    with session() as s:
        rows = s.exec(
            select(Note, Search.raw_query)
            .join(Search, Search.id == Note.search_id, isouter=True)
            .order_by(Note.created_at.desc())  # type: ignore[union-attr]
        ).all()
        return [note_out(n, rq) for n, rq in rows]


@router.get("/fragments")
def list_fragments(ids: str | None = Query(default=None)) -> list[dict]:
    """Batch export — a JSON array of the same objects, which `codex import` accepts.

    Without `ids` this is every note that has been through the review dialog.
    Notes that never were are left out on purpose: their tags would be Sift's
    guesses rather than the reader's confirmations, which the spec does not allow.
    """
    wanted = None
    if ids is not None:
        try:
            wanted = [int(x) for x in ids.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(400, "ids must be a comma-separated list of note ids")
        if not wanted:
            return []
    out = []
    with session() as s:
        stmt = select(Note).order_by(Note.created_at)  # type: ignore[arg-type]
        stmt = stmt.where(Note.id.in_(wanted)) if wanted else stmt.where(
            Note.exported_at.is_not(None)  # type: ignore[union-attr]
        )
        for note in s.exec(stmt).all():
            search = s.get(Search, note.search_id) if note.search_id else None
            question = (search.refined_question or search.raw_query) if search else None
            out.append(codex.fragment(note, question))
    return out


@router.get("/{note_id}")
def get_note(note_id: int) -> dict:
    with session() as s:
        note, _question, raw_query = _note_and_question(s, note_id)
        return note_out(note, raw_query)


@router.get("/{note_id}/export")
def export_review(note_id: int) -> dict:
    """Everything the review dialog needs, in one call: nothing here spends tokens."""
    with session() as s:
        note, question, _raw = _note_and_question(s, note_id)
        taxonomy = codex.load_taxonomy()
        suggested = codex.suggest_tags(f"{question or ''}\n{note.body_md}", taxonomy)
        return {
            "filename": codex.filename(note.id),
            "fragment": codex.fragment(note, question),  # preview, saved tags applied
            "tags": codex.tag_list(note.tags),
            "reflection": note.reflection,
            "exported_at": note.exported_at,
            "suggested_tags": suggested,
            "taxonomy": taxonomy,
            "taxonomy_loaded": bool(taxonomy),
        }


@router.post("/{note_id}/export")
def export_note(note_id: int, body: ExportIn) -> dict:
    """Confirm the review, then emit. Tags and the reflection persist on the note
    so re-exporting the same id produces a byte-identical fragment."""
    tags = codex.tag_list(json.dumps(body.tags))
    reflection = (body.reflection or "").strip() or None
    with session() as s:
        note, question, _raw = _note_and_question(s, note_id)
        note.tags = json.dumps(tags)
        note.reflection = reflection
        note.exported_at = utcnow()
        s.add(note)
        s.commit()
        s.refresh(note)
        return {"filename": codex.filename(note.id), "fragment": codex.fragment(note, question)}


@router.delete("/{note_id}")
def delete_note(note_id: int) -> dict:
    with session() as s:
        note = s.get(Note, note_id)
        if note is None:
            raise HTTPException(404, "note not found")
        s.delete(note)
        s.commit()
    return {"deleted": note_id}
