from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import select

from .. import watch
from ..db import session
from ..models import BulletinItem, Search

router = APIRouter(prefix="/api/bulletin", tags=["bulletin"])


def _item_out(item: BulletinItem) -> dict:
    return {
        "id": item.id,
        "pmid": item.pmid,
        "title": item.title,
        "authors": item.authors,
        "journal": item.journal,
        "year": item.year,
        "pub_date": item.pub_date,
        "abstract": item.abstract,
        "url": item.url,
        "seen_at": item.seen_at,
    }


@router.get("")
def bulletin() -> dict:
    """Every watched topic with its unread items. Dismissed/promoted rows stay in
    the table (they suppress re-appearance) but never in this view."""
    with session() as s:
        watched = s.exec(
            select(Search).where(Search.watched == 1).order_by(Search.created_at.desc())  # type: ignore[union-attr]
        ).all()
        topics = []
        total = 0
        for search in watched:
            items = s.exec(
                select(BulletinItem)
                .where(BulletinItem.search_id == search.id, BulletinItem.status == "new")
                .order_by(BulletinItem.seen_at.desc(), BulletinItem.pub_date.desc())  # type: ignore[union-attr]
            ).all()
            total += len(items)
            topics.append(
                {
                    "search_id": search.id,
                    "raw_query": search.raw_query,
                    "stage": search.stage,
                    "watch_checked_at": search.watch_checked_at,
                    "items": [_item_out(i) for i in items],
                }
            )
    return {"poll_running": watch.poll_running(), "total_new": total, "topics": topics}


class PollBody(BaseModel):
    force: bool = False
    days: int | None = None  # testing hook: window floor = now - days (needs force)


@router.post("/poll")
async def poll(body: PollBody | None = None) -> dict:
    """Kick the free delta poll. The server owns staleness: without force this is
    a no-op unless a watched topic hasn't been checked for POLL_MIN_HOURS."""
    body = body or PollBody()
    days = body.days if body.force else None
    if days is not None and not (1 <= days <= 3650):
        raise HTTPException(400, "days out of range")
    started, reason = watch.start_poll(force=body.force, days=days)
    return {"started": started, "reason": reason}


def _set_status(item_id: int, status: str) -> dict:
    with session() as s:
        item = s.get(BulletinItem, item_id)
        if item is None:
            raise HTTPException(404, "bulletin item not found")
        item.status = status
        s.add(item)
        s.commit()
        return {"id": item.id, "status": item.status}


@router.post("/items/{item_id}/dismiss")
def dismiss_item(item_id: int) -> dict:
    return _set_status(item_id, "dismissed")


@router.post("/items/{item_id}/promote")
def promote_item(item_id: int) -> dict:
    """Mark an item taken into a new search — the client then opens New Search
    seeded from it; the actual search is the normal create/translate flow."""
    return _set_status(item_id, "promoted")


class DismissAll(BaseModel):
    search_id: int | None = None  # null = every topic


@router.post("/dismiss-all")
def dismiss_all(body: DismissAll) -> dict:
    with session() as s:
        q = select(BulletinItem).where(BulletinItem.status == "new")
        if body.search_id is not None:
            q = q.where(BulletinItem.search_id == body.search_id)
        rows = s.exec(q).all()
        for item in rows:
            item.status = "dismissed"
            s.add(item)
        s.commit()
        return {"dismissed": len(rows)}
