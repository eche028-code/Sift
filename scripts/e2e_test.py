"""End-to-end pipeline test against a running server (port 8000) + mock LLM (port 9099).

Exercises: model config, per-function instructions, translate, real PubMed search/fetch,
dedupe, enrich, mock triage, ranking, deck, decisions, undo, pool, synthesis, notes.

It writes to whatever database the target server uses, so point it at a scratch
instance rather than your own: set SIFT_DATA_DIR for that server, and SIFT_TEST_BASE here.

Run:  venv/Scripts/python.exe scripts/e2e_test.py
"""

import os
import sys
import time

import httpx

BASE = os.environ.get("SIFT_TEST_BASE", "http://127.0.0.1:8000")
c = httpx.Client(base_url=BASE, timeout=120)
failures = []


def check(name: str, cond: bool, extra: str = ""):
    mark = "PASS" if cond else "FAIL"
    print(f"[{mark}] {name}" + (f" — {extra}" if extra else ""))
    if not cond:
        failures.append(name)


def main() -> int:
    # settings roundtrip
    r = c.get("/api/settings")
    check("GET /api/settings", r.status_code == 200 and "record_cap" in r.json())

    # search without a translator configured → 409
    r = c.post("/api/searches", json={"raw_query": "test"})
    check("create search without models → 409", r.status_code == 409, r.json().get("detail", "")[:60])

    # point the one model at the mock
    r = c.put("/api/settings", json={
        "llm_provider": "Custom",
        "llm_base_url": "http://127.0.0.1:9099/v1",
        "llm_api_key": "test-key-1234",
        "llm_model": "mock-1",
    })
    check("configure model", r.status_code == 200 and r.json()["llm_model"] == "mock-1")
    body = r.json()
    check("api key masked", body.get("llm_api_key_set") is True
          and body.get("llm_api_key_last4") == "1234" and "llm_api_key" not in body)

    # connection ping against the saved config
    r = c.post("/api/llm/test", json={})
    check("llm test ping", r.status_code == 200 and r.json().get("ok") is True, str(r.json()))

    # editable per-function instructions
    r = c.get("/api/settings/prompt-defaults")
    check("prompt defaults", r.status_code == 200 and set(r.json()) == {"translator", "triage", "synthesis"})
    r = c.put("/api/settings", json={"prompt_triage": "Favour randomised trials."})
    check("custom instruction saved", r.json()["prompt_triage"] == "Favour randomised trials.")
    r = c.put("/api/settings", json={"prompt_triage": ""})
    check("instruction reset to default", r.json()["prompt_triage"] == "")

    # create search → translation via mock
    r = c.post("/api/searches", json={"raw_query": "Does orthokeratology slow axial elongation in children?"})
    check("POST /api/searches translates", r.status_code == 200 and "orthokeratology" in (r.json().get("translated_query") or ""))
    sid = r.json()["id"]
    check("rationale captured", bool(r.json()["stage_detail"].get("rationale")))

    # patch filters: last 1 year, kept
    import datetime
    date_from = (datetime.date.today() - datetime.timedelta(days=365)).isoformat()
    r = c.patch(f"/api/searches/{sid}", json={"date_from": date_from, "pdf_only": False, "is_saved": True})
    check("PATCH filters", r.status_code == 200 and r.json()["is_saved"] is True)

    # run the pipeline against real PubMed
    r = c.post(f"/api/searches/{sid}/run")
    check("POST run", r.status_code == 200)
    stage, detail = None, {}
    for _ in range(240):
        time.sleep(1)
        st = c.get(f"/api/searches/{sid}/status").json()
        stage, detail = st["stage"], st["stage_detail"]
        if stage in ("ready", "error"):
            break
    check("pipeline reaches ready", stage == "ready", f"stage={stage} detail={detail}")
    check("PubMed found records", (detail.get("found") or 0) > 0, f"found={detail.get('found')}")
    check("papers screened", (detail.get("to_screen") or 0) > 0 and detail.get("screened") == detail.get("to_screen"))

    # deck
    r = c.get(f"/api/searches/{sid}/deck")
    deck = r.json()
    cards = deck["cards"]
    check("deck has cards", len(cards) > 0, f"{len(cards)} cards, counts={deck['counts']}")
    if cards:
        c0 = cards[0]
        for field in ("paper_id", "title", "finding", "design", "score", "weakness", "strengths", "abstract", "url"):
            if c0.get(field) in (None, "", []):
                check(f"card field {field}", False, "missing on top card")
        ranks = [x["rank"] for x in cards]
        check("deck ranked ascending", ranks == sorted(ranks))
        scores = [x["score"] for x in cards]
        check("scores descend", all(scores[i] >= scores[i + 1] for i in range(len(scores) - 1)))
        pdfs = sum(1 for x in cards if x.get("pdf_url"))
        print(f"       ({pdfs}/{len(cards)} cards carry a pdf_url via PMC fallback)")

    # decisions: keep #1, skip #2, undo the skip
    a, b = cards[0], cards[1]
    r = c.post(f"/api/results/{sid}/{a['paper_id']}/decision", json={"status": "kept"})
    check("keep decision", r.status_code == 200)
    r = c.post(f"/api/results/{sid}/{b['paper_id']}/decision", json={"status": "skipped"})
    check("skip decision", r.status_code == 200)
    r = c.post(f"/api/results/{sid}/{b['paper_id']}/undo")
    check("undo", r.status_code == 200)
    deck2 = c.get(f"/api/searches/{sid}/deck").json()
    check("undo restores pending", any(x["paper_id"] == b["paper_id"] for x in deck2["cards"]))
    check("kept removed from deck", not any(x["paper_id"] == a["paper_id"] for x in deck2["cards"]))
    check("counts updated", deck2["counts"]["kept"] == 1, str(deck2["counts"]))

    # keep one more so the note has two papers
    r = c.post(f"/api/results/{sid}/{b['paper_id']}/decision", json={"status": "kept"})
    pool = c.get(f"/api/searches/{sid}/pool").json()
    check("pool lists kept", len(pool["papers"]) == 2, f"{len(pool['papers'])} papers")

    # synthesis
    r = c.post(f"/api/searches/{sid}/synthesise")
    check("synthesise", r.status_code == 200 and "## Findings" in r.json().get("body_md", ""), str(r.json())[:120])
    note_id = r.json().get("id")
    r = c.get("/api/notes")
    check("notes list", r.status_code == 200 and len(r.json()) >= 1)
    r = c.get(f"/api/notes/{note_id}")
    check("note fetch", r.status_code == 200 and r.json()["raw_query"])

    # search list with counts (topics screen)
    r = c.get("/api/searches")
    row = next(x for x in r.json() if x["id"] == sid)
    check("topics counts", row["counts"]["kept"] == 2 and row["counts"]["pending"] > 0, str(row["counts"]))

    # frontend served?
    r = c.get("/")
    check("frontend served at /", r.status_code == 200 and "<div id=\"root\"" in r.text, f"status={r.status_code}")

    print()
    if failures:
        print(f"{len(failures)} FAILURES: {failures}")
        return 1
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
