"""Bulletin watch: free PubMed delta polls for watched searches.

No LLM is ever involved here — collection is deliberately dumb, so the watch
never spends tokens. New matches land as bulletin items; acting on one runs
the normal on-demand pipeline. Polls are windowed on the Entrez (indexing)
date and PubMed is retroactively queryable, so downtime never loses news —
there is no scheduler, only a poll kicked when the app is opened.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

import httpx
from sqlmodel import select

from .db import session
from .models import BulletinItem, Paper, Search, SearchResult, Triage, utcnow
from .pubmed import efetch_page, esearch

log = logging.getLogger("sift.watch")

POLL_MIN_HOURS = 12  # a /poll inside this window is a no-op unless forced
OVERLAP_DAYS = 2  # window overlap across polls; pmid dedupe makes it idempotent
EXPIRY_DAYS = 60  # bulletin rows older than this are pruned at poll time
ITEM_CAP = 50  # per topic per poll — it's a bulletin, not a corpus

_task: asyncio.Task | None = None


def poll_running() -> bool:
    return _task is not None and not _task.done()


def _parse_ts(ts: str) -> datetime:
    dt = datetime.fromisoformat(ts)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _due_search_ids(force: bool) -> list[int]:
    horizon = datetime.now(timezone.utc) - timedelta(hours=POLL_MIN_HOURS)
    with session() as s:
        rows = s.exec(select(Search).where(Search.watched == 1)).all()
    return [
        row.id
        for row in rows
        if (row.translated_query or "").strip()
        and (force or not row.watch_checked_at or _parse_ts(row.watch_checked_at) < horizon)
    ]


def start_poll(force: bool = False, days: int | None = None) -> tuple[bool, str]:
    """Kick the poll task if any watched search is due. Returns (started, reason).

    days (only honoured with force) overrides the window floor to now-days —
    a testing hook; normal polls window from each search's own watermark.
    """
    global _task
    if poll_running():
        return False, "running"
    with session() as s:
        any_watched = s.exec(select(Search.id).where(Search.watched == 1)).first()
    if any_watched is None:
        return False, "no_watches"
    due = _due_search_ids(force)
    if not due:
        return False, "fresh"
    _task = asyncio.get_running_loop().create_task(_run_poll(due, days if force else None))
    return True, "started"


async def _run_poll(search_ids: list[int], days: int | None) -> None:
    _prune_expired()
    async with httpx.AsyncClient(timeout=30) as client:
        for sid in search_ids:  # sequential — stays inside the E-utilities pacing
            try:
                await _poll_search(client, sid, days)
            except Exception:
                log.exception("bulletin poll failed for search %s", sid)


def _prune_expired() -> None:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=EXPIRY_DAYS)).isoformat(timespec="seconds")
    with session() as s:
        old = s.exec(select(BulletinItem).where(BulletinItem.seen_at < cutoff)).all()
        for item in old:
            s.delete(item)
        if old:
            s.commit()
            log.info("pruned %d expired bulletin items", len(old))


async def _poll_search(client: httpx.AsyncClient, search_id: int, days: int | None) -> None:
    with session() as s:
        search = s.get(Search, search_id)
    if search is None or not search.watched:
        return
    started = utcnow()
    if days is not None:
        floor_dt = datetime.now(timezone.utc) - timedelta(days=days)
    else:
        anchor = _parse_ts(search.watch_checked_at) if search.watch_checked_at else datetime.now(timezone.utc)
        floor_dt = anchor - timedelta(days=OVERLAP_DAYS)
    floor = floor_dt.date().isoformat()

    term = search.translated_query
    if search.pdf_only:
        term = f"({term}) AND free full text[sb]"
    if search.date_from or search.date_to:
        # the fetch applies these as pdat params; here the params carry the edat
        # window, so the publication-date filter folds into the term instead
        lo = (search.date_from or "1800/01/01").replace("-", "/")
        hi = (search.date_to or "3000").replace("-", "/")
        term = f'({term}) AND ("{lo}"[pdat] : "{hi}"[pdat])'

    count, webenv, qk = await esearch(client, term, floor, None, datetype="edat")
    records = await efetch_page(client, webenv, qk, 0, min(count, ITEM_CAP)) if count else []
    fresh = _filter_new(search_id, records)

    with session() as s:
        for rec in fresh:
            s.add(
                BulletinItem(
                    search_id=search_id,
                    pmid=rec["pmid"],
                    title=rec["title"],
                    authors=rec["authors"],
                    journal=rec["journal"],
                    year=rec["year"],
                    pub_date=rec["pub_date"],
                    abstract=rec["abstract"],
                    url=rec["url"],
                )
            )
        row = s.get(Search, search_id)
        if row is not None:
            row.watch_checked_at = started
            s.add(row)
        s.commit()
    log.info(
        "bulletin poll for search %s: %d indexed since %s, %d new", search_id, count, floor, len(fresh)
    )


def _filter_new(search_id: int, records: list[dict]) -> list[dict]:
    """News = has an abstract (fetch parity), never bulletined for this search,
    not already in this search's results, and never triaged anywhere — a paper
    the model has screened is in (or has been through) a deck already."""
    records = [r for r in records if r["pmid"] and r["abstract"]]
    seen: set[str] = set()
    records = [r for r in records if not (r["pmid"] in seen or seen.add(r["pmid"]))]
    if not records:
        return []
    pmids = [r["pmid"] for r in records]
    with session() as s:
        bulletined = set(
            s.exec(
                select(BulletinItem.pmid).where(
                    BulletinItem.search_id == search_id,
                    BulletinItem.pmid.in_(pmids),  # type: ignore[attr-defined]
                )
            ).all()
        )
        paper_ids = {
            pmid: pid
            for pid, pmid in s.exec(
                select(Paper.id, Paper.pmid).where(Paper.pmid.in_(pmids))  # type: ignore[attr-defined]
            ).all()
        }
        ids = list(paper_ids.values())
        linked: set[int] = set()
        triaged: set[int] = set()
        if ids:
            linked = set(
                s.exec(
                    select(SearchResult.paper_id).where(
                        SearchResult.search_id == search_id,
                        SearchResult.paper_id.in_(ids),  # type: ignore[attr-defined]
                    )
                ).all()
            )
            triaged = set(
                s.exec(select(Triage.paper_id).where(Triage.paper_id.in_(ids))).all()  # type: ignore[attr-defined]
            )
    return [
        r
        for r in records
        if r["pmid"] not in bulletined
        and paper_ids.get(r["pmid"]) not in linked
        and paper_ids.get(r["pmid"]) not in triaged
    ]


def clear_covered(search_id: int) -> None:
    """After a fetch links papers into a search, its bulletin rows they cover are
    done — the results list owns them now, and the linked filter keeps them out
    of future polls."""
    with session() as s:
        rows = s.exec(select(BulletinItem).where(BulletinItem.search_id == search_id)).all()
        if not rows:
            return
        pmids = [r.pmid for r in rows]
        covered = set(
            s.exec(
                select(Paper.pmid)
                .join(SearchResult, SearchResult.paper_id == Paper.id)
                .where(
                    SearchResult.search_id == search_id,
                    Paper.pmid.in_(pmids),  # type: ignore[attr-defined]
                )
            ).all()
        )
        gone = [r for r in rows if r.pmid in covered]
        for r in gone:
            s.delete(r)
        if gone:
            s.commit()
            log.info("bulletin: %d items for search %s now covered by its results", len(gone), search_id)


def clear_watch(search_id: int) -> None:
    """Unwatch housekeeping: the topic's bulletin rows (and their dismissed-pmid
    history) go with the watch — re-watching starts fresh from now."""
    with session() as s:
        rows = s.exec(select(BulletinItem).where(BulletinItem.search_id == search_id)).all()
        for item in rows:
            s.delete(item)
        if rows:
            s.commit()
