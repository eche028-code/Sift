"""Prompt builders for the three model roles."""

import json

from . import settings_store as st

# Each function's steering is editable in Settings; the JSON contract below it is not,
# because the pipeline parses those keys.
DEFAULT_TRANSLATOR = """- Group synonyms with OR inside parentheses; combine distinct concepts with AND.
- Use field tags where they help: [MeSH Terms], [tiab]. Prefer recall over precision — downstream AI screening removes noise.
- Do NOT add date restrictions or availability filters (free full text, language); those are applied separately."""

DEFAULT_TRIAGE = """Score 0-100 for evidence quality: study design first (meta-analysis and RCT high; prospective cohort middle; retrospective and cross-sectional lower; case series and surveys low), then sample size, follow-up length, masking, and registration or pre-specification of outcomes."""

DEFAULT_SYNTHESIS = """- One opening sentence with the counts you are given (screened / passed triage / kept).
- "## Findings" — one bullet per paper: **FirstAuthor et al. (Year, Design, n=N)** — the key finding, one sentence. End the bullet with the grade in italics, e.g. *[Strong]*.
- "## Where the evidence is thin" — one short paragraph on recurring limitations and open questions across these papers.
- "## Clinical takeaway" — two or three sentences, practical and specific, cautious where the evidence is weak."""

DEFAULT_PROMPTS = {
    "translator": DEFAULT_TRANSLATOR,
    "triage": DEFAULT_TRIAGE,
    "synthesis": DEFAULT_SYNTHESIS,
}


def steer(role: str) -> str:
    """The reader's own instructions for a function, or the built-in ones."""
    return st.get(f"prompt_{role}").strip() or DEFAULT_PROMPTS[role]


def translator_system() -> str:
    return "\n".join([
        "You convert a clinician's natural-language question into a single PubMed search query.",
        "",
        "Rules:",
        steer("translator"),
        '- Reply with JSON only, no prose: {"pubmed_query": "...", "rationale": "one short sentence on how you interpreted the question"}',
    ])


def triage_system(raw_query: str, translated_query: str | None, feedback_block: str) -> str:
    profile = st.get("user_profile")
    parts = [
        "You screen research abstracts for this reader:",
        profile,
        "",
        f'Current question: "{raw_query}"',
    ]
    if translated_query:
        parts.append(f"PubMed query used: {translated_query}")
    parts += [
        "",
        "Decide whether the paper is worth this reader's time for that question, and grade the evidence.",
    ]
    if feedback_block:
        parts += ["", feedback_block]
    parts += [
        "",
        steer("triage"),
        "",
        "Reply with JSON only, exactly these keys:",
        '{"relevant": true, "finding": "one sentence, the single most decision-useful result", '
        '"design": "RCT | Meta-analysis | Cohort | Prospective | Retrospective | Cross-sectional | Case series | Survey | Other", '
        '"n": 102, "followup": "24 mo", '
        '"weakness": "the single most important limitation, one sentence", '
        '"strengths": ["short phrase", "short phrase"], "score": 88, '
        '"peer_reviewed": true, "randomised": true, "masked": false}',
        "",
        'If the paper is off-topic or useless for the question, return {"relevant": false} '
        "(other keys may be null). Use null for unknown values. n is total participants; "
        'followup is compact like "24 mo" or null.',
    ]
    return "\n".join(parts)


def triage_user(title: str, journal: str | None, year: int | None, abstract: str) -> str:
    return (
        f"TITLE: {title}\n"
        f"JOURNAL: {journal or 'unknown'} ({year or 'year unknown'})\n\n"
        f"ABSTRACT:\n{abstract}"
    )


def feedback_block(kept: list[dict], skipped: list[dict]) -> str:
    """Few-shot block from the reader's recent swipe decisions."""
    if not kept and not skipped:
        return ""
    lines = ["This reader's recent decisions — favour papers like the kept ones, filter papers like the skipped ones:"]
    if kept:
        lines.append("KEPT:")
        lines += [f'- "{p["title"]}" — {p["finding"]}' if p.get("finding") else f'- "{p["title"]}"' for p in kept]
    if skipped:
        lines.append("SKIPPED:")
        lines += [f'- "{p["title"]}" — {p["finding"]}' if p.get("finding") else f'- "{p["title"]}"' for p in skipped]
    return "\n".join(lines)


def synthesis_system(raw_query: str) -> str:
    profile = st.get("user_profile")
    return f"""You write short evidence notes for this reader: {profile}

The reader screened the literature for: "{raw_query}" and kept the papers given below.

Write a markdown note with exactly this structure:
{steer("synthesis")}

No preamble, no code fences, markdown only. Do not invent papers or numbers."""


def synthesis_user(counts: dict, papers: list[dict]) -> str:
    return (
        f"Counts: screened {counts.get('screened', '?')} abstracts, "
        f"{counts.get('passed', '?')} passed triage, {counts.get('kept', '?')} kept.\n\n"
        "Kept papers (JSON):\n" + json.dumps(papers, indent=1, ensure_ascii=False)
    )
