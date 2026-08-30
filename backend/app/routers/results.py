from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import session
from ..models import SearchResult, utcnow

router = APIRouter(prefix="/api/results", tags=["results"])


class DecisionIn(BaseModel):
    status: str


@router.post("/{search_id}/{paper_id}/decision")
def decide(search_id: int, paper_id: int, body: DecisionIn) -> dict:
    if body.status not in ("kept", "skipped"):
        raise HTTPException(400, "status must be 'kept' or 'skipped'")
    with session() as s:
        sr = s.get(SearchResult, (search_id, paper_id))
        if sr is None:
            raise HTTPException(404, "result not found")
        sr.status = body.status
        sr.decided_at = utcnow()
        s.add(sr)
        s.commit()
    return {"ok": True, "status": body.status}


@router.post("/{search_id}/{paper_id}/undo")
def undo(search_id: int, paper_id: int) -> dict:
    with session() as s:
        sr = s.get(SearchResult, (search_id, paper_id))
        if sr is None:
            raise HTTPException(404, "result not found")
        sr.status = "pending"
        sr.decided_at = None
        s.add(sr)
        s.commit()
    return {"ok": True, "status": "pending"}
