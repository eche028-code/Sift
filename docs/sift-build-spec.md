# Sift — build specification

Personal literature-triage app for one user (optometrist, myopia control / ortho-K / anterior segment focus). Natural-language search → LLM-translated PubMed query → AI-screened swipe cards → pool → synthesised evidence notes. Runs entirely on the owner's always-on PC; accessed from an iPhone over Tailscale as an installable PWA.

**Design reference:** `sift-simulator.jsx` in this folder is the canonical UX and visual design. Port its screens, components, palette (slate-950 ground, amber-50 paper cards, teal accent, serif titles, mono data), and interactions. Do not redesign; replace mock data and simulated stages with real API calls.

---

## 1. Architecture

```
iPhone (PWA over Tailscale HTTPS)
        │
https://<machine>.<tailnet>.ts.net   ← tailscale serve
        │
FastAPI (uvicorn, 127.0.0.1:8000)
  ├─ serves built React frontend (same origin, no CORS)
  ├─ REST API
  ├─ APScheduler (monthly crawl + backfill, in-process)
  └─ pipeline workers (async tasks)
        │
SQLite (./data/sift.db, WAL mode)
        │
External: PubMed E-utilities · Crossref · Unpaywall · LLM APIs (user-configured)
```

- **Backend:** Python 3.11+, FastAPI, SQLModel (SQLAlchemy + Pydantic) over SQLite. `httpx` for outbound calls. APScheduler for the monthly job — in-process, so no OS cron/Task Scheduler dependency.
- **Frontend:** Vite + React + Tailwind, ported from the simulator. `vite-plugin-pwa` for manifest + service worker. Built output served statically by FastAPI.
- **Single user, no auth.** The tailnet is the security boundary. Bind uvicorn to `127.0.0.1` only; `tailscale serve` proxies to it. Nothing is exposed on the LAN or internet.

## 2. Tailscale deployment

1. Install Tailscale on the PC and iPhone, same tailnet. Enable **MagicDNS** and **HTTPS certificates** in the admin console.
2. On the PC: `tailscale serve --bg 8000` (check `tailscale serve --help` for the installed version's exact syntax). This maps `https://<machine>.<tailnet>.ts.net` → `localhost:8000` with a valid TLS cert.
3. HTTPS matters: iOS requires a secure context for PWA install, service workers, and clipboard. Plain `http://100.x.y.z:8000` will work in Safari but degrade the app; always use the `.ts.net` URL.
4. Auto-start: the server process must survive reboots. Windows: Task Scheduler "at log on" with restart-on-failure (or NSSM as a service). Linux: a systemd unit. Tailscale itself already runs as a service.

## 3. SQLite schema

`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;` Single file `data/sift.db` (gitignore `data/`).

```sql
-- key-value app settings (NCBI key, contact email, role→model assignments,
-- backfill floor year, crawl day-of-month, etc.)
settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- user-configured LLM endpoints
providers(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,              -- "DeepSeek", "OpenRouter", "Ollama local"...
  base_url TEXT NOT NULL,          -- OpenAI-compatible /v1 endpoint
  api_key TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- one row per saved topic / search
searches(
  id INTEGER PRIMARY KEY,
  raw_query TEXT NOT NULL,         -- natural language
  translated_query TEXT,           -- PubMed boolean syntax from LLM
  date_from TEXT, date_to TEXT,
  pdf_only INTEGER NOT NULL DEFAULT 0,
  is_saved INTEGER NOT NULL DEFAULT 0,   -- included in monthly crawl
  backfill_cursor TEXT,            -- earliest date already crawled
  stage TEXT NOT NULL DEFAULT 'new',     -- new|translating|searching|screening|ready|error
  stage_detail TEXT,               -- JSON: counts for the scanning screen
  created_at TEXT NOT NULL
);

-- deduped global paper store
papers(
  id INTEGER PRIMARY KEY,
  pmid TEXT UNIQUE, doi TEXT UNIQUE,
  title TEXT NOT NULL, authors TEXT, journal TEXT,
  year INTEGER, pub_date TEXT,
  abstract TEXT,
  url TEXT, pdf_url TEXT,          -- pdf_url from Unpaywall/PMC when OA
  fetched_at TEXT NOT NULL
);

-- one AI screening per paper (reused across searches)
triage(
  paper_id INTEGER PRIMARY KEY REFERENCES papers(id),
  relevant INTEGER NOT NULL,       -- 0 → never decked
  finding TEXT, design TEXT, n INTEGER, followup TEXT,
  weakness TEXT, strengths TEXT,   -- strengths as JSON array
  score INTEGER,                   -- 0–100 evidence score
  peer_reviewed INTEGER, randomised INTEGER, masked INTEGER,
  model_used TEXT, raw_json TEXT, created_at TEXT NOT NULL
);

-- membership + swipe decisions per search
search_results(
  search_id INTEGER REFERENCES searches(id),
  paper_id INTEGER REFERENCES papers(id),
  rank INTEGER,                    -- deck order: score DESC, year DESC
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|kept|skipped
  source TEXT NOT NULL DEFAULT 'search',   -- search|explore
  decided_at TEXT,
  PRIMARY KEY (search_id, paper_id)
);

notes(
  id INTEGER PRIMARY KEY,
  search_id INTEGER REFERENCES searches(id),
  title TEXT, body_md TEXT NOT NULL,
  paper_ids TEXT NOT NULL,         -- JSON array
  created_at TEXT NOT NULL
);

crawl_log(
  id INTEGER PRIMARY KEY,
  search_id INTEGER, window_from TEXT, window_to TEXT,
  found INTEGER, new_papers INTEGER, ran_at TEXT, status TEXT, error TEXT
);
```

Dedupe rule: match on PMID first, then normalised DOI (lowercase, strip `https://doi.org/`). Existing paper → reuse its `triage` row; only insert a new `search_results` link.

## 4. LLM provider abstraction (Settings → "Models")

This is a first-class screen, not an afterthought.

- **Mechanism:** every provider is an OpenAI-compatible chat-completions endpoint (`base_url` + `api_key` + model name). This covers DeepSeek (`https://api.deepseek.com/v1`), OpenRouter, Groq, Ollama (`http://localhost:11434/v1`, empty key), and OpenAI itself with one code path: the `openai` Python SDK with `base_url` overridden. Anthropic can be reached via OpenRouter; a native adapter is optional later.
- **Three model roles**, each assignable in settings to `provider_id` + model string:
  - `translator` — NL → PubMed syntax (small/cheap)
  - `triage` — abstract screening (cheapest capable model; this does 95% of the volume)
  - `synthesis` — pool → evidence note (the best model configured)
- **Settings UI:** provider CRUD (name, base URL, key — masked after save, API returns last 4 chars only), role dropdowns, and a **Test** button per provider that sends a 1-token ping and reports latency/failure.
- Also in Settings: NCBI API key + contact email (raises E-utilities limit from 3 → 10 req/s; email is also required etiquette for Unpaywall), backfill floor year (default 2000), crawl day-of-month, backfill window size (default 12 months).
- Keys live in the `providers` table on the local disk. Acceptable for a single-user localhost app; never log them, never ship the DB.

## 5. Pipeline

`POST /api/searches` → translate → confirm → `run` executes stages async, writing `stage`/`stage_detail` so the frontend's scanning screen can poll real progress.

1. **Translate** (LLM, `translator` role): NL query → `{pubmed_query, rationale}` JSON. Show to user for confirmation before running (the simulator's "interpreted query" line becomes editable).
2. **Search** (PubMed E-utilities): `esearch` with `mindate/maxdate`, paging via `usehistory`. If `pdf_only`, append `AND free full text[sb]`. Cap initial run at ~200 records.
3. **Fetch**: `efetch` XML → title, authors, journal, dates, abstract, PMID, DOI. Skip records with no abstract (log count).
4. **Dedupe** against `papers` (PMID/DOI). New papers → insert; all → link into `search_results`.
5. **Enrich**: Crossref by DOI fills gaps (type, journal); Unpaywall by DOI (`?email=`) sets `pdf_url` when an OA PDF exists.
6. **Triage** (LLM, `triage` role): per-abstract, concurrency ~5, JSON-only output validated with Pydantic; one retry on parse failure, then mark `relevant=0` with error noted in `raw_json`. `relevant=0` results are stored but never decked.
7. **Rank**: `score DESC, year DESC` → `rank`; stage → `ready`.

**Triage output contract** (must match the card component):

```json
{
  "relevant": true,
  "finding": "one sentence, the single most decision-useful result",
  "design": "RCT | Cohort | Meta-analysis | Retrospective | Cross-sectional | Case series | Other",
  "n": 102,
  "followup": "24 mo",
  "weakness": "the single most important limitation, one sentence",
  "strengths": ["...", "..."],
  "score": 88,
  "peer_reviewed": true,
  "randomised": true,
  "masked": false
}
```

Score rubric in the prompt: design hierarchy (meta-analysis/RCT > prospective > retrospective > survey), sample size, follow-up length, masking, registration — 0–100.

**Feedback loop (few-shot, no training):** the triage prompt for a search includes up to 20 most recent *kept* and 20 most recent *skipped* titles+findings for that user (across searches), labelled as examples of what to favour and filter. Pull via `search_results.status`. This replaces any ML ranking.

**Synthesis** (LLM, `synthesis` role): input = kept papers' triage rows + abstracts; output = markdown note in the simulator's structure (intro line with counts, one bullet per paper with citation-style label + finding + grade, "where the evidence is thin", "clinical takeaway"). Store in `notes`; render + copy button in UI.

## 6. Scheduler (monthly crawl + backfill)

APScheduler cron job, day-of-month from settings, for every search with `is_saved=1`:

- **Forward:** window = last successful crawl → today. New relevant papers land as `pending` in that search's deck.
- **Backward:** step `backfill_cursor` one window (default 12 months) further into the past, run the same pipeline for that window, until the floor year. One backward step per month keeps API usage polite and the deck digestible.
- Log every window to `crawl_log`. Surface "N new cards since last visit" as a badge on the saved-topics list.

## 7. API surface

```
POST   /api/searches                      {raw_query} → id + translated_query
PATCH  /api/searches/{id}                 edit translated_query / filters / is_saved
POST   /api/searches/{id}/run             start pipeline (background task)
GET    /api/searches/{id}/status          {stage, stage_detail}
GET    /api/searches                      list (saved topics + recent, with new-card counts)
GET    /api/searches/{id}/deck            pending results, ranked
POST   /api/results/{search_id}/{paper_id}/decision   {status: kept|skipped}
POST   /api/results/{search_id}/{paper_id}/undo       → pending, restore rank
GET    /api/searches/{id}/pool            kept papers with triage detail
POST   /api/searches/{id}/synthesise      → note
GET    /api/notes/{id}
GET/POST/DELETE /api/providers            (+ POST /api/providers/{id}/test)
GET/PUT /api/settings
POST   /api/crawl/run                     manual trigger
```

## 8. Frontend changes vs simulator

- Wire scanning screen to `/status` polling (~700 ms); stages map 1:1 to the simulated lines.
- Replace `PAPERS` with deck fetch; decisions/undo call the API (optimistic UI, queue if offline).
- Add screens: **Topics** (saved searches list with new-card badges — becomes the home screen), **Settings** (§4), note history.
- Editable translated query on the filters screen before "Run search".
- PWA: manifest (name "Sift", standalone, theme `#020617`), icons incl. `apple-touch-icon`, service worker caching the app shell; API calls network-first.
- Detail view gains an "Open PDF" button when `pdf_url` exists.

## 9. Milestones

1. **Skeleton** — FastAPI + schema + static frontend serving; reachable via `tailscale serve` on the phone.
2. **Settings/providers** — CRUD, role assignment, test ping (DeepSeek configured and passing).
3. **Pipeline** — translate → search → fetch → dedupe → enrich → triage → ranked deck; status polling drives the scanning screen.
4. **Deck** — swipes, undo, pool, detail wired to real data.
5. **Synthesis notes** — generate, store, copy.
6. **Feedback few-shot** in triage prompt.
7. **Scheduler** — saved topics, monthly forward + backward crawl, new-card badges.
8. **PWA polish** — manifest, SW, icons, offline shell. *(Phase 2 afterwards: "explore" deck — LLM reads query history, proposes adjacent queries, results tagged `source='explore'` in a separate deck.)*

## 10. Non-goals

Multi-user, auth, cloud hosting, native app, Google Scholar scraping, training a ranking model. Keep it boring: SQLite, one process, one tailnet.
