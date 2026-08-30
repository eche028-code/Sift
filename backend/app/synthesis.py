"""Pool → evidence note."""

import json

from sqlmodel import select

from . import llm, prompts
from .db import session
from .models import Note, Paper, Search, SearchResult, Triage


def grade_label(score: int | None) -> str:
    s = score or 0
    if s >= 85:
        return "Strong"
    if s >= 70:
        return "Moderate"
    if s >= 50:
        return "Limited"
    return "Weak"


async def synthesise(search_id: int) -> Note:
    with session() as s:
        search = s.get(Search, search_id)
        if search is None:
            raise ValueError("search not found")
        rows = s.exec(
            select(Paper, Triage, SearchResult)
            .join(Triage, Triage.paper_id == Paper.id)
            .join(SearchResult, SearchResult.paper_id == Paper.id)
            .where(SearchResult.search_id == search_id, SearchResult.status == "kept")
            .order_by(SearchResult.decided_at)  # keep swipe order stable
        ).all()
        detail = json.loads(search.stage_detail) if search.stage_detail else {}

    if not rows:
        raise ValueError("nothing in the pool yet — keep some papers first")

    papers_payload = []
    for paper, triage, _sr in rows:
        first_author = (paper.authors or "Unknown").split(",")[0].strip()
        papers_payload.append(
            {
                "label": f"{first_author} et al. ({paper.year or '?'}, {triage.design or 'Study'}, n={triage.n or '?'})",
                "year": paper.year,
                "design": triage.design,
                "n": triage.n,
                "followup": triage.followup,
                "finding": triage.finding,
                "weakness": triage.weakness,
                "strengths": json.loads(triage.strengths) if triage.strengths else [],
                "score": triage.score,
                "grade": grade_label(triage.score),
                "abstract_excerpt": (paper.abstract or "")[:1200],
            }
        )

    counts = {
        "screened": detail.get("fetched") or detail.get("found") or "?",
        "passed": detail.get("passed") or "?",
        "kept": len(rows),
    }
    body = await llm.chat(
        "synthesis",
        prompts.synthesis_system(search.raw_query),
        prompts.synthesis_user(counts, papers_payload),
        temperature=0.4,
        force_json=False,
    )
    body = body.strip()
    if body.startswith("```"):
        body = body.strip("`").removeprefix("markdown").strip()

    note = Note(
        search_id=search_id,
        title=f"Evidence note — {search.raw_query.strip()}",
        body_md=body,
        paper_ids=json.dumps([paper.id for paper, _t, _sr in rows]),
    )
    with session() as s:
        s.add(note)
        s.commit()
        s.refresh(note)
    return note
