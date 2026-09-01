"""End-to-end pipeline test against a running server (port 8000) + mock LLM (port 9099).

Exercises: model config, per-function instructions, translate, real PubMed search/fetch,
dedupe, clarify loop, enrich, mock triage, ranking, deck, decisions, undo, pool, synthesis,
notes, and the bulletin watch (free delta polls, dismiss/promote, unwatch, fetch coverage).

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
    check("prompt defaults", r.status_code == 200
          and set(r.json()) == {"translator", "clarifier", "triage", "synthesis"})
    r = c.put("/api/settings", json={"prompt_triage": "Favour randomised trials."})
    check("custom instruction saved", r.json()["prompt_triage"] == "Favour randomised trials.")
    r = c.put("/api/settings", json={"prompt_triage": ""})
    check("instruction reset to default", r.json()["prompt_triage"] == "")

    # create search → the translation runs as a task; the client watches the stage
    r = c.post("/api/searches", json={"raw_query": "Does orthokeratology slow axial elongation in children?"})
    check("POST /api/searches starts translating", r.status_code == 200
          and r.json()["stage"] in ("translating", "new"))
    sid = r.json()["id"]

    def wait_stage(stages: tuple, timeout: int = 240, search_id: int | None = None):
        stage, detail = None, {}
        for _ in range(timeout):
            time.sleep(1)
            st = c.get(f"/api/searches/{search_id if search_id is not None else sid}/status").json()
            stage, detail = st["stage"], st["stage_detail"]
            if stage in stages or stage == "error":
                break
        return stage, detail

    stage, detail = wait_stage(("new",))
    check("translation lands at 'new'", stage == "new", f"stage={stage} detail={detail}")
    body = c.get(f"/api/searches/{sid}").json()
    check("query translated via mock", "orthokeratology" in (body.get("translated_query") or ""))
    check("rationale captured", bool(body["stage_detail"].get("rationale")))

    # patch filters: last 1 year, kept
    import datetime
    date_from = (datetime.date.today() - datetime.timedelta(days=365)).isoformat()
    r = c.patch(f"/api/searches/{sid}", json={"date_from": date_from, "pdf_only": False, "is_saved": True})
    check("PATCH filters", r.status_code == 200 and r.json()["is_saved"] is True)

    # fetch stage against real PubMed — free, must stop at 'fetched'
    r = c.post(f"/api/searches/{sid}/run")
    check("POST run (fetch stage)", r.status_code == 200)
    stage, detail = wait_stage(("fetched",))
    check("fetch stops at 'fetched' (no auto-screening)", stage == "fetched", f"stage={stage} detail={detail}")
    check("PubMed found records", (detail.get("found") or 0) > 0, f"found={detail.get('found')}")
    check("to_screen counted", (detail.get("to_screen") or 0) > 0, f"to_screen={detail.get('to_screen')}")
    check("nothing screened yet", detail.get("screened") == 0)

    # results preview
    r = c.get(f"/api/searches/{sid}/results")
    res = r.json()
    check("GET results", r.status_code == 200 and len(res["papers"]) > 0, f"{len(res.get('papers', []))} papers")
    check("results summary", res["summary"]["to_screen"] == detail.get("to_screen")
          and res["summary"]["total"] == len(res["papers"]), str(res["summary"]))
    check("results papers untriaged", all(p["triaged"] is False for p in res["papers"]))

    # clarify loop: threshold → questions → answers narrow the query, then re-fetch
    r = c.put("/api/settings", json={"clarify_threshold": 1})
    check("clarify threshold saved", r.status_code == 200 and r.json()["clarify_threshold"] == "1")
    r = c.get(f"/api/searches/{sid}/results")
    check("results expose threshold", r.json()["summary"].get("clarify_threshold") == 1)
    r = c.post(f"/api/searches/{sid}/clarify/questions")
    check("POST clarify/questions starts", r.status_code == 200 and r.json().get("started") is True)
    qs, d = [], {}
    for _ in range(120):
        time.sleep(1)
        d = c.get(f"/api/searches/{sid}/status").json()["stage_detail"]
        if d.get("clarify_status") in ("done", "error"):
            qs = d.get("clarify_questions") or []
            break
    check("clarify questions arrive", d.get("clarify_status") == "done"
          and len(qs) >= 1 and qs[0]["options"], str(qs)[:80])
    # the answer round rebuilds the query AND re-fetches, all in one task
    r = c.post(f"/api/searches/{sid}/clarify", json={"answers": [
        {"question": qs[0]["text"], "answer": qs[0]["options"][0]},
        {"question": "Which outcome should the papers report?", "answer": "Axial length"},
    ]})
    check("POST clarify starts", r.status_code == 200 and r.json().get("started") is True)
    stage, detail = wait_stage(("fetched",))
    check("clarified re-fetch reaches 'fetched'", stage == "fetched", f"stage={stage}")
    body = c.get(f"/api/searches/{sid}").json()
    check("clarify answers → narrower query", "child" in (body.get("translated_query") or "").lower())
    check("refined question stored", bool(body.get("refined_question")))
    check("clarifications accumulated", len(body.get("clarifications") or []) == 2)
    r = c.post(f"/api/searches/{sid}/clarify", json={"answers": [{"question": "x", "answer": "  "}]})
    check("blank answers rejected", r.status_code == 400)
    c.put("/api/settings", json={"clarify_threshold": 30})

    # refine the query — also one task that rebuilds then re-fetches
    r = c.post(f"/api/searches/{sid}/refine", json={"instruction": "only randomised trials in children"})
    check("POST refine starts", r.status_code == 200 and r.json().get("started") is True)
    stage, detail = wait_stage(("fetched",))
    check("refined re-fetch reaches 'fetched'", stage == "fetched", f"stage={stage}")
    body = c.get(f"/api/searches/{sid}").json()
    check("refine changed the query", bool(body.get("translated_query")))
    check("clarifications survive refine", len(body.get("clarifications") or []) == 2)

    # ── bulletin watch: free PubMed delta polls, zero LLM ───────
    # Runs before the screen stage on purpose: once these overlapping queries'
    # papers are triaged, the watch's triaged-anywhere filter (correctly)
    # suppresses them, and a forced wide poll would find nothing to assert on.
    def poll_and_wait(payload, timeout: int = 120):
        r = c.post("/api/bulletin/poll", json=payload)
        b = c.get("/api/bulletin").json()
        for _ in range(timeout):
            if not b["poll_running"]:
                break
            time.sleep(1)
            b = c.get("/api/bulletin").json()
        return r, b

    r = c.patch(f"/api/searches/{sid}", json={"watched": True})
    check("watch toggled on", r.status_code == 200 and r.json()["watched"] is True
          and bool(r.json()["watch_checked_at"]))
    sid_watermark = r.json()["watch_checked_at"]
    r = c.post("/api/bulletin/poll", json={})
    check("fresh watch → poll is a no-op", r.status_code == 200
          and r.json()["started"] is False and r.json()["reason"] == "fresh", str(r.json()))

    # a second watched topic that was never fetched: a forced wide poll must find items
    r = c.post("/api/searches", json={"raw_query": "orthokeratology and myopia control news"})
    sid2 = r.json()["id"]
    stage, _ = wait_stage(("new",), search_id=sid2)
    check("second search translated", stage == "new", f"stage={stage}")
    r = c.patch(f"/api/searches/{sid2}", json={"watched": True, "is_saved": True})
    check("second watch on", r.json()["watched"] is True)

    r, b = poll_and_wait({"force": True, "days": 90})
    check("forced poll starts", r.status_code == 200 and r.json()["started"] is True, str(r.json()))
    check("poll completes", b["poll_running"] is False)
    # sid carries a date_from filter — its watermark only advances if PubMed
    # accepted the pdat-range-in-term form the watch builds for filtered topics
    after = c.get(f"/api/searches/{sid}").json()["watch_checked_at"]
    check("date-filtered topic polls cleanly", bool(after) and after > sid_watermark,
          f"{sid_watermark} → {after}")
    topic = next((t for t in b["topics"] if t["search_id"] == sid2), None)
    check("bulletin lists the watched topic", topic is not None)
    items = topic["items"] if topic else []
    check("wide poll surfaces items", len(items) > 0, f"{len(items)} items in 90d")
    check("items carry pmid+title+abstract", all(i["pmid"] and i["title"] and i["abstract"] for i in items))
    check("no duplicate pmids", len({i["pmid"] for i in items}) == len(items))

    first = items[0] if items else {"id": 0, "pmid": ""}
    r = c.post(f"/api/bulletin/items/{first['id']}/dismiss")
    check("dismiss item", r.status_code == 200 and r.json()["status"] == "dismissed")
    promoted = items[1] if len(items) > 1 else None
    if promoted:
        r = c.post(f"/api/bulletin/items/{promoted['id']}/promote")
        check("promote item", r.status_code == 200 and r.json()["status"] == "promoted")
    b = c.get("/api/bulletin").json()
    t2 = next(t for t in b["topics"] if t["search_id"] == sid2)
    gone_ids = {first["id"]} | ({promoted["id"]} if promoted else set())
    check("acted-on items leave the view", all(i["id"] not in gone_ids for i in t2["items"]))

    # a re-poll of the same window must not resurrect acted-on pmids
    r, b = poll_and_wait({"force": True, "days": 90})
    t3 = next(t for t in b["topics"] if t["search_id"] == sid2)
    gone_pmids = {first["pmid"]} | ({promoted["pmid"]} if promoted else set())
    check("acted-on pmids stay suppressed", all(i["pmid"] not in gone_pmids for i in t3["items"]))
    check("re-poll adds no duplicates", len(t3["items"]) <= len(items))

    # unwatch clears the topic's bulletin (history included); re-watch starts fresh
    r = c.patch(f"/api/searches/{sid2}", json={"watched": False})
    check("unwatch", r.status_code == 200 and r.json()["watched"] is False)
    b = c.get("/api/bulletin").json()
    check("unwatched topic leaves the bulletin", all(t["search_id"] != sid2 for t in b["topics"]))
    c.patch(f"/api/searches/{sid2}", json={"watched": True})
    r, b = poll_and_wait({"force": True, "days": 90})
    t4 = next(t for t in b["topics"] if t["search_id"] == sid2)
    check("re-watch starts fresh (dismiss history cleared)", len(t4["items"]) == len(items),
          f"{len(t4['items'])} vs {len(items)}")

    # a fetch that links the papers retires the bulletin rows it covers
    r = c.post(f"/api/searches/{sid2}/run")
    check("run watched topic", r.status_code == 200)
    stage, _ = wait_stage(("fetched",), search_id=sid2)
    check("watched topic fetches", stage == "fetched", f"stage={stage}")
    b = c.get("/api/bulletin").json()
    t5 = next(t for t in b["topics"] if t["search_id"] == sid2)
    check("fetch covers its bulletin items", len(t5["items"]) == 0, f"{len(t5['items'])} left")

    # deleting a search takes its bulletin rows with it
    r = c.delete(f"/api/searches/{sid2}")
    check("delete watched search", r.status_code == 200)
    b = c.get("/api/bulletin").json()
    check("deleted topic leaves the bulletin", all(t["search_id"] != sid2 for t in b["topics"]))
    c.patch(f"/api/searches/{sid}", json={"watched": False})

    # commit to screening — this is the stage that spends tokens
    r = c.post(f"/api/searches/{sid}/screen")
    check("POST screen", r.status_code == 200)
    stage, detail = wait_stage(("ready",))
    check("screening reaches ready", stage == "ready", f"stage={stage} detail={detail}")
    check("papers screened", (detail.get("to_screen") or 0) > 0 and detail.get("screened") == detail.get("to_screen"))

    r = c.get(f"/api/searches/{sid}/results")
    check("results show triaged after screening", all(p["triaged"] for p in r.json()["papers"]))

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

    # synthesis — runs as a task; the note id lands in stage_detail
    r = c.post(f"/api/searches/{sid}/synthesise")
    check("POST synthesise starts", r.status_code == 200 and r.json().get("started") is True)
    note_id, d = None, {}
    for _ in range(120):
        time.sleep(1)
        d = c.get(f"/api/searches/{sid}/status").json()["stage_detail"]
        if d.get("synthesis_status") in ("done", "error"):
            note_id = d.get("synthesis_note_id")
            break
    check("synthesis completes", d.get("synthesis_status") == "done" and note_id is not None, str(d)[:120])
    r = c.get("/api/notes")
    check("notes list", r.status_code == 200 and len(r.json()) >= 1)
    r = c.get(f"/api/notes/{note_id}")
    check("note fetch", r.status_code == 200 and r.json()["raw_query"]
          and "## Findings" in r.json()["body_md"])

    # search list with counts (topics screen)
    r = c.get("/api/searches")
    row = next(x for x in r.json() if x["id"] == sid)
    check("topics counts", row["counts"]["kept"] == 2 and row["counts"]["pending"] > 0, str(row["counts"]))
    check("list exposes watched", row["watched"] is False)

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
