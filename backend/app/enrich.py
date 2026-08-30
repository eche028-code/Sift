"""Crossref fills metadata gaps; Unpaywall/PMC set pdf_url for OA papers."""

import asyncio
import logging

import httpx

from . import settings_store as st
from .db import session
from .models import Paper

log = logging.getLogger("sift.enrich")


async def _crossref(client: httpx.AsyncClient, paper: Paper) -> dict:
    r = await client.get(f"https://api.crossref.org/works/{paper.doi}")
    r.raise_for_status()
    msg = r.json().get("message", {})
    out = {}
    if not paper.journal and (ct := msg.get("container-title")):
        out["journal"] = ct[0][:200]
    if not paper.year:
        for key in ("published-print", "published-online", "issued"):
            parts = (msg.get(key) or {}).get("date-parts")
            if parts and parts[0] and parts[0][0]:
                out["year"] = int(parts[0][0])
                break
    return out


async def _unpaywall(client: httpx.AsyncClient, paper: Paper, email: str) -> dict:
    r = await client.get(
        f"https://api.unpaywall.org/v2/{paper.doi}", params={"email": email}
    )
    r.raise_for_status()
    data = r.json()
    loc = data.get("best_oa_location") or {}
    pdf = loc.get("url_for_pdf") or loc.get("url")
    return {"pdf_url": pdf} if pdf else {}


async def enrich_papers(paper_ids: list[int], pmcids: dict[int, str]) -> None:
    """Best-effort; failures never break the pipeline. pmcids maps paper_id → PMC id."""
    email = st.get("contact_email")
    with session() as s:
        papers = [p for pid in paper_ids if (p := s.get(Paper, pid))]

    sem = asyncio.Semaphore(5)
    updates: dict[int, dict] = {}

    async def work(client: httpx.AsyncClient, paper: Paper) -> None:
        async with sem:
            upd: dict = {}
            if paper.doi and (not paper.journal or not paper.year):
                try:
                    upd |= await _crossref(client, paper)
                except Exception as e:
                    log.debug("crossref failed for %s: %s", paper.doi, e)
            if not paper.pdf_url:
                if paper.doi and email:
                    try:
                        upd |= await _unpaywall(client, paper, email)
                    except Exception as e:
                        log.debug("unpaywall failed for %s: %s", paper.doi, e)
                if "pdf_url" not in upd and (pmc := pmcids.get(paper.id)):
                    upd["pdf_url"] = f"https://pmc.ncbi.nlm.nih.gov/articles/{pmc}/pdf/"
            if upd:
                updates[paper.id] = upd

    ua = "sift/0.1 (personal literature triage"
    ua += f"; mailto:{email})" if email else ")"
    async with httpx.AsyncClient(timeout=15, headers={"User-Agent": ua}, follow_redirects=True) as client:
        await asyncio.gather(*(work(client, p) for p in papers), return_exceptions=True)

    if updates:
        with session() as s:
            for pid, upd in updates.items():
                paper = s.get(Paper, pid)
                if paper:
                    for k, v in upd.items():
                        setattr(paper, k, v)
                    s.add(paper)
            s.commit()
