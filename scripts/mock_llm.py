"""OpenAI-compatible mock LLM for end-to-end testing without real API keys.

Run:  venv/Scripts/python.exe -m uvicorn mock_llm:app --port 9099  (from scripts/)

Routes by prompt content: translator → canned PubMed query, triage → deterministic
pseudo-random screening JSON, synthesis → canned markdown note.
"""

import hashlib
import json
import time

from fastapi import FastAPI, Request

app = FastAPI()

DESIGNS = ["RCT", "Meta-analysis", "Cohort", "Prospective", "Retrospective", "Cross-sectional", "Case series", "Survey"]


def h(text: str) -> int:
    return int(hashlib.sha256(text.encode()).hexdigest(), 16)


def translator_reply(user: str) -> str:
    return json.dumps(
        {
            "pubmed_query": '("orthokeratology"[MeSH Terms] OR "myopia control"[tiab] OR ortho-k[tiab]) '
            'AND ("axial length"[tiab] OR "myopia, progression"[MeSH Terms] OR elongation[tiab])',
            "rationale": "Interpreted as: effect of orthokeratology on axial elongation in myopic children.",
        }
    )


def triage_reply(user: str) -> str:
    title = user.split("\n", 1)[0].removeprefix("TITLE:").strip()
    seed = h(title)
    score = 35 + seed % 60  # 35–94
    relevant = seed % 10 != 0  # ~90% relevant
    design = DESIGNS[seed % len(DESIGNS)]
    if not relevant:
        return json.dumps({"relevant": False})
    return json.dumps(
        {
            "relevant": True,
            "finding": f"Mock finding for evidence testing: intervention changed the primary outcome (seed {seed % 1000}).",
            "design": design,
            "n": 20 + seed % 400,
            "followup": f"{6 + seed % 54} mo",
            "weakness": "Mock limitation: single-site data with unmasked outcome assessment.",
            "strengths": ["Mock strength: pre-registered outcome", "Mock strength: validated biometry"],
            "score": score,
            "peer_reviewed": True,
            "randomised": design in ("RCT", "Meta-analysis"),
            "masked": seed % 3 == 0,
        }
    )


def synthesis_reply(user: str) -> str:
    return (
        "Screened the retrieved abstracts; the papers below were kept after review.\n"
        "\n"
        "## Findings\n"
        "- **Mock A et al. (2025, RCT, n=102)** — the intervention slowed the primary outcome versus control. *[Strong]*\n"
        "- **Mock B et al. (2024, Cohort, n=74)** — effect persisted at 12 months in routine practice. *[Moderate]*\n"
        "\n"
        "## Where the evidence is thin\n"
        "Follow-up rarely exceeds two years and masking is inconsistent, so long-term estimates remain provisional.\n"
        "\n"
        "## Clinical takeaway\n"
        "This is mock output from the test provider — wire up a real model in Settings to get a usable note."
    )


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": "mock-1", "object": "model", "created": 0, "owned_by": "sift"}]}


@app.post("/v1/chat/completions")
async def chat(request: Request):
    body = await request.json()
    system = ""
    user = ""
    for m in body.get("messages", []):
        if m["role"] == "system":
            system = m["content"]
        elif m["role"] == "user":
            user = m["content"]

    if "pubmed_query" in system:
        content = translator_reply(user)
    elif '"relevant"' in system:
        content = triage_reply(user)
    elif "evidence note" in system.lower() or "## Findings" in system:
        content = synthesis_reply(user)
    else:
        content = "ok"

    return {
        "id": "chatcmpl-mock",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": body.get("model", "mock-1"),
        "choices": [
            {"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}
        ],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }
