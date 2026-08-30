# Sift

Personal literature-triage app: natural-language search → LLM-translated PubMed query → AI-screened swipe cards → pool → synthesised evidence notes. On-demand only — you run a search when you want one. Single user, one process, SQLite. Accessed from an iPhone over Tailscale as an installable PWA.

Built to `docs/sift-build-spec.md`; the UX is a port of `docs/sift-simulator.jsx`.

```
iPhone PWA ── https://<machine>.<tailnet>.ts.net:8443 (tailscale serve)
                │
        FastAPI on 127.0.0.1:8000  (serves API + built frontend)
                │
        SQLite  data/sift.db  (WAL)
                │
        PubMed E-utilities (no key) · Crossref · Unpaywall · your LLM endpoint
```

## Run it

```bat
start_sift.bat
```

then open http://localhost:8000. (Everything is already built; the venv lives in `venv/`.)

First-time setup happens in the app, under **Settings** (gear icon):

1. **Pick a provider** — DeepSeek, Moonshot, Anthropic, or Custom. The endpoint and a
   starting model name fill in; both stay editable. **Custom** covers anything else with an
   OpenAI-compatible `/v1` (OpenRouter, Groq, Ollama with a blank key, the mock below).
2. **Paste the API key and name the model.** One model runs all three functions
   (translator, triage, synthesis). **Test** pings it for latency; **Fetch models** lists
   what the endpoint actually offers, so you do not have to guess a model ID.
3. **Contact email** — required for Unpaywall PDF lookup. PubMed itself needs no account,
   key or registration; searches go to the public E-utilities API at ~3 req/s.
4. **Instructions** (optional) — per-function steering for translator, triage and synthesis.
   Blank uses the built-in wording. The JSON reply contract is appended automatically and is
   not editable, because the pipeline parses those keys.

Note on Anthropic: Sift talks to every provider over OpenAI-compatible chat-completions, and
Anthropic's compatibility endpoint
([docs](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk)) ignores
`response_format`, so JSON mode is not enforced there — triage falls back to parsing JSON out
of the reply. It works, but keep the "reply with JSON only" wording if you edit the triage
instructions.

Then: New search → confirm/edit the interpreted PubMed query → **Fetch results** (free, no
AI) → review the result list, refine the query as often as you like → **Screen N abstracts**
(the one step that spends tokens) → swipe. Tap a card mid-swipe to read the full title,
summary and abstract; leave the deck any time — swipes are saved instantly, and the topic
row on the home screen takes you back to where you stopped.

## Phone access (Tailscale)

1. Install Tailscale on this PC and the iPhone, same tailnet. In the [admin console](https://login.tailscale.com/admin/dns) enable **MagicDNS** and **HTTPS certificates**.
2. On this PC:

```bash
tailscale serve --bg 8000
```

3. On the iPhone, open `https://<machine>.<tailnet>.ts.net` in Safari → Share → **Add to Home Screen**. The HTTPS URL matters: iOS only grants PWA install, the service worker, and clipboard in a secure context.

## Start on boot

Task Scheduler, run-at-logon:

```powershell
schtasks /Create /TN "Sift" /TR "\"C:\Sift\start_sift.bat\"" /SC ONLOGON /RL LIMITED
```

(Or wrap `start_sift.bat` with [NSSM](https://nssm.cc/) to run it as a real service with restart-on-failure.) Tailscale already runs as a service.

## How the pipeline works

Two stages, so tokens are never spent without an explicit go-ahead:

1. **Fetch** (`POST /{id}/run`, free): PubMed `esearch`/`efetch` (capped at 200 records,
   newest first) → skip no-abstract records → dedupe into the global paper store (PMID, then
   normalised DOI) → stop at stage `fetched`. The results screen shows what came back — match
   count, titles, and exactly how many *new* abstracts a screening run would send to the
   model. From there you can refine the query (an LLM revision steered by your instruction
   plus a sample of the current results, or manual editing) and re-fetch as often as you
   like; a re-fetch replaces the search's un-reviewed results, while kept/skipped history
   always survives.
2. **Screen** (`POST /{id}/screen`, spends tokens): Crossref fills metadata gaps,
   Unpaywall/PMC set `pdf_url` for OA papers → each new abstract is screened by the triage
   function (concurrency 5, JSON contract, one retry then `relevant=0`) → deck ranked by
   score desc, year desc. A paper triaged once is never re-screened, across all searches.

The triage prompt includes your 20 most recent kept and 20 most recent skipped papers as few-shot steering — the deck adapts to how you swipe, no training involved.

The bookmark toggle just keeps a search on the home screen under **Kept topics**; it does not
schedule anything. To pick up newer papers, run the search again — anything already triaged is
never re-screened, so a re-run only costs tokens on genuinely new abstracts.

## Development

```bash
# backend (auto-reload)
cd backend && ../venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
# frontend dev server with /api proxy → 8000
cd frontend && npm run dev
# rebuild the production frontend that FastAPI serves
cd frontend && npm run build
```

- `scripts/mock_llm.py` — OpenAI-compatible mock (port 9099) so the whole pipeline runs with no API keys: `cd scripts && ../venv/Scripts/python -m uvicorn mock_llm:app --port 9099`, then pick **Custom**, endpoint `http://127.0.0.1:9099/v1`, model `mock-1`, blank key.
- `scripts/e2e_test.py` — end-to-end test against a running server + mock: model config, per-function instructions, translate, live PubMed fetch, triage, deck, decisions, synthesis. It writes to the target server's database, so point it at a scratch instance: run that server with `SIFT_DATA_DIR` set to a temp folder and `--port 8010`, then `SIFT_TEST_BASE=http://127.0.0.1:8010`.
- `scripts/make_icons.py` — regenerates the PWA icons.
- Data lives in `data/` (gitignored). Delete `data/sift.db` for a factory reset. Logs: `data/sift.log`.
- Set `SIFT_DATA_DIR` to relocate the database. Keep it **out of OneDrive/Dropbox** — WAL-mode SQLite and file sync don't mix.

## Not here yet

Phase 2 "explore" deck (LLM proposes adjacent queries, `source='explore'`). The scheduled monthly crawl and backfill were built and then removed — this is an on-demand tool. Non-goals per spec: auth, multi-user, cloud, native app, Scholar scraping, trained ranking.
