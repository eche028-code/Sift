import json

from fastapi import APIRouter, HTTPException
from sqlmodel import select

from ..db import session
from ..models import Note, Search

router = APIRouter(prefix="/api/notes", tags=["notes"])


def note_out(note: Note, raw_query: str | None) -> dict:
    return {
        "id": note.id,
        "search_id": note.search_id,
        "title": note.title,
        "body_md": note.body_md,
        "paper_ids": json.loads(note.paper_ids),
        "created_at": note.created_at,
        "raw_query": raw_query,
    }


@router.get("")
def list_notes() -> list[dict]:
    with session() as s:
        rows = s.exec(
            select(Note, Search.raw_query)
            .join(Search, Search.id == Note.search_id, isouter=True)
            .order_by(Note.created_at.desc())  # type: ignore[union-attr]
        ).all()
        return [note_out(n, rq) for n, rq in rows]


@router.get("/{note_id}")
def get_note(note_id: int) -> dict:
    with session() as s:
        note = s.get(Note, note_id)
        if note is None:
            raise HTTPException(404, "note not found")
        raw_query = None
        if note.search_id:
            search = s.get(Search, note.search_id)
            raw_query = search.raw_query if search else None
        return note_out(note, raw_query)


@router.delete("/{note_id}")
def delete_note(note_id: int) -> dict:
    with session() as s:
        note = s.get(Note, note_id)
        if note is None:
            raise HTTPException(404, "note not found")
        s.delete(note)
        s.commit()
    return {"deleted": note_id}
