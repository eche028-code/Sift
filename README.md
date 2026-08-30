# Sift

Personal literature-triage app: natural-language search → LLM-translated PubMed query → AI-screened swipe cards → pool → synthesised evidence notes. Single user, one process, SQLite. Accessed from an iPhone over Tailscale as an installable PWA.

Built to `docs/sift-build-spec.md`; the UX is a port of `docs/sift-simulator.jsx`.

```
iPhone PWA ── https://<machine>.<tailnet>.ts.net (tailscale serve)
                │
        FastAPI on 127.0.0.1:8000  (serves API + built frontend)
                │
        SQLite  data/sift.db  (WAL)
                │
        PubMed E-utilities · Crossref · Unpaywall · your LLM endpoints
```

## Run it

```bat
start_sift.bat
```

then open http://localhost:8000. (Everything is already built; the venv lives in `venv/`.)

First-time setup happens in the app, under **Settings** (gear icon):

1. **Add a provider** — e.g. tap the DeepSeek preset, paste your API key, Add. Any OpenAI-compatible endpoint works (DeepSeek, OpenRouter, Groq, Ollama with a blank key).
2. **Assign the three roles** — translator / triage / synthesis. For DeepSeek, `deepseek-chat` for all three is a fine start. Tap **Test** on the provider to confirm latency.
3. **PubMed & crawl** — put in your contact email (required for Unpaywall PDF lookup), and ideally a free [NCBI API key](https://www.ncbi.nlm.nih.gov/account/settings/) (raises the rate limit from 3 to 10 req/s).

Then: New search → confirm/edit the interpreted PubMed query → Run search → swipe.

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

`POST /api/searches` translates the question (translator role) and shows you the query for editing. **Run** then: PubMed `esearch`/`efetch` (capped at 200 records, newest first) → skip no-abstract records → dedupe into the global paper store (PMID, then normalised DOI) → Crossref fills metadata gaps, Unpaywall/PMC set `pdf_url` for OA papers → each new abstract is screened by the triage role (concurrency 5, JSON contract, one retry then `relevant=0`) → deck ranked by score desc, year desc. A paper triaged once is never re-screened, across all searches.

The triage prompt includes your 20 most recent kept and 20 most recent skipped papers as few-shot steering — the deck adapts to how you swipe, no training involved.

**Watched topics** (bookmark toggle) get a monthly crawl (day-of-month in Settings): a forward window since the last crawl, plus one backfill window (default 12 months) further into the past, until the floor year (default 2000). New relevant papers land as pending cards, shown as a badge on the home screen. `Run crawl now` in Settings triggers it manually.

## Development

```bash
# backend (auto-reload)
cd backend && ../venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
# frontend dev server with /api proxy → 8000
cd frontend && npm run dev
# rebuild the production frontend that FastAPI serves
cd frontend && npm run build
```

- `scripts/mock_llm.py` — OpenAI-compatible mock (port 9099) so the whole pipeline runs with no API keys: `cd scripts && ../venv/Scripts/python -m uvicorn mock_llm:app --port 9099`, then add provider `http://127.0.0.1:9099/v1`, model `mock-1`.
- `scripts/e2e_test.py` — end-to-end test against a running server + mock: provider CRUD, translate, live PubMed fetch, triage, deck, decisions, synthesis.
- `scripts/make_icons.py` — regenerates the PWA icons.
- Data lives in `data/` (gitignored). Delete `data/sift.db` for a factory reset. Logs: `data/sift.log`.
- Set `SIFT_DATA_DIR` to relocate the database. Keep it **out of OneDrive/Dropbox** — WAL-mode SQLite and file sync don't mix.

## Not here yet

Phase 2 "explore" deck (LLM proposes adjacent queries, `source='explore'`). Non-goals per spec: auth, multi-user, cloud, native app, Scholar scraping, trained ranking.
