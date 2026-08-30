import asyncio

from fastapi import APIRouter
from sqlmodel import select

from ..db import session
from ..models import CrawlLog
from ..pipeline import monthly_crawl

router = APIRouter(prefix="/api/crawl", tags=["crawl"])

_manual_task: asyncio.Task | None = None


@router.post("/run")
async def run_crawl() -> dict:
    global _manual_task
    if _manual_task and not _manual_task.done():
        return {"started": False, "reason": "a crawl is already running"}
    _manual_task = asyncio.get_running_loop().create_task(monthly_crawl())
    return {"started": True}


@router.get("/log")
def crawl_log() -> list[dict]:
    with session() as s:
        rows = s.exec(
            select(CrawlLog).order_by(CrawlLog.ran_at.desc()).limit(20)  # type: ignore[union-attr]
        ).all()
        return [row.model_dump() for row in rows]
