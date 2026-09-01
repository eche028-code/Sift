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

## From a fresh clone

This repo holds source only — `venv/`, `node_modules/`, `frontend/dist/` and `data/` are all
gitignored, so a clone has to be built once before it will serve anything. Needs Python 3.10+
(developed on 3.14) and Node 20.19+ (Vite 7's floor; developed on 24).

```bat
git clone https://github.com/eche028-code/Sift.git
cd Sift
python -m venv venv
venv\Scripts\python -m pip install -r backend\requirements.txt
cd frontend && npm install && npm run build && cd ..
```

`npm run build` produces `frontend/dist`, which FastAPI mounts and serves — skip it and you get
a JSON stub instead of the app. `data/sift.db` is created on first start; nothing else is needed.

Not on Windows? There is no `start_sift.bat` — use the dev command under
[Development](#development), and `venv/bin/python` wherever this README says `venv\Scripts\python`.

## Run it

```bat
start_sift.bat
```

then open http://localhost:8000.

First-time setup happens in the app, under **Settings** (gear icon):

1. **Pick a provider** — DeepSeek, Moonshot, Anthropic, or Custom. The endpoint and a
   starting model name fill in; both stay editable. **Custom** covers anything else with an
   OpenAI-compatible `/v1` (OpenRouter, Groq, Ollama with a blank key, the mock below).
2. **Paste the API key and name the model.** One model runs all four functions
   (query converter, clarifier, triage, synthesis). **Test** pings it for latency; **Fetch
   models** lists what the endpoint actually offers, so you do not have to guess a model ID.
3. **Contact email** — required for Unpaywall PDF lookup. PubMed itself needs no account,
   key or registration; searches go to the public E-utilities API at ~3 req/s.
4. **Instructions** (optional) — per-function steering for the query converter, clarifier,
   triage and synthesis. Blank uses the built-in wording. The JSON reply contract is appended
   automatically and is not editable, because the pipeline parses those keys.

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

## Start on boot (optional)

Nothing is installed to run at boot — after a reboot you start Sift yourself with
`start_sift.bat`. `tailscale serve` persists its own config across reboots, so that batch
file is the only step.

To have it come up automatically instead, register it at logon:

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

## The bulletin watch (free)

A kept topic can also be **watched** (the feed icon next to its bookmark). Opening the app then
checks PubMed for records *newly indexed* since the last check — a plain E-utilities delta query
on the Entrez date, no LLM anywhere — and collects the matches in the **Bulletin** as titles to
skim. From an item you can **dismiss** it, open it on PubMed, or **Ask about this** (starts a new
search seeded from it); a topic with news also offers **Run this search**, the normal re-run that
screens only the new abstracts.

Design points, so expectations are right:

- **No scheduler.** Nothing polls while the app is closed. A poll fires when you open (or
  re-foreground) the app, at most every 12 hours, and PubMed date windows are retroactive — days
  offline are picked up in full on the next open, nothing is ever missed.
- **Zero tokens.** Collection never touches the model. Tokens are spent only when you act on the
  bulletin, through the same two-stage pipeline as any search.
- Papers you have already screened, kept or skipped anywhere never appear as news; dismissed
  items stay dismissed; items expire after 60 days; each poll keeps at most the 50 newest
  matches per topic. Unwatching a topic clears its bulletin.

## Export to Codex

A note can be filed into Codex as a `fragment.json` (spec v1). Open a note → **Export
to Codex** → confirm its tags, optionally write a reflection → take the fragment as a
file or on the clipboard, then on the Codex machine:

```bash
codex import sift-note-42.fragment.json
```

- **Tags come from Codex's own vocabulary.** Export it there with
  `anchors.export_taxonomy_yaml` and paste it into **Settings → Codex**; it is stored at
  `data/codex_taxonomy.yaml`. Sift suggests tags by plain word matching against that
  list — free, no model call — and you confirm every one. Without the file loaded you
  can still type tags, but nothing is checked against the knowledge base.
- **The reflection is yours or absent.** Sift never writes that field and omits it
  entirely when blank.
- **`id` is `sift-note-<id>`, fixed.** Codex inserts plainly, so re-importing the same
  note fails loudly instead of duplicating. Tags and the reflection are stored on the
  note, so exporting it again produces the same fragment.
- `created_at` is the note's synthesis date, not the export date — it dates the
  snapshot of the evidence.
- The Library's **Export reviewed notes as one file** button emits a JSON array of every
  note that has been through the dialog. Notes that never were are left out: their tags
  would be Sift's guesses rather than yours.

Notes synthesised from now on open with a `# Q:` line carrying the question, which the
fragment needs; older notes get that line added at export.

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

Phase 2 "explore" deck (LLM proposes adjacent queries, `source='explore'`). The scheduled monthly crawl and backfill were built and then removed — this is an on-demand tool, and the bulletin watch keeps it one: it polls only when you open the app and never touches the model. Non-goals per spec: auth, multi-user, cloud, native app, Scholar scraping, trained ranking.
