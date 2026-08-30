import json
import logging
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import select

from .db import BASE_DIR, DATA_DIR, init_db, session
from .models import Search
from .routers import llm_config, notes, results, searches, settings

log = logging.getLogger("sift")


def setup_logging() -> None:
    root = logging.getLogger()
    if any(isinstance(h, RotatingFileHandler) for h in root.handlers):
        return
    root.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    fh = RotatingFileHandler(DATA_DIR / "sift.log", maxBytes=2_000_000, backupCount=2, encoding="utf-8")
    fh.setFormatter(fmt)
    root.addHandler(fh)
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    root.addHandler(sh)


def reset_interrupted_searches() -> None:
    """A crash mid-pipeline leaves a stale running stage; mark it so the UI can re-run."""
    with session() as s:
        stuck = s.exec(
            select(Search).where(Search.stage.in_(["translating", "searching", "screening"]))  # type: ignore[attr-defined]
        ).all()
        for search in stuck:
            search.stage = "error"
            detail = json.loads(search.stage_detail) if search.stage_detail else {}
            detail["error"] = "Interrupted by a server restart — run the search again."
            search.stage_detail = json.dumps(detail)
            s.add(search)
        if stuck:
            s.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    init_db()
    reset_interrupted_searches()
    log.info("sift up — data dir %s", DATA_DIR)
    yield


app = FastAPI(title="Sift", lifespan=lifespan)

app.include_router(searches.router)
app.include_router(results.router)
app.include_router(notes.router)
app.include_router(llm_config.router)
app.include_router(settings.router)

DIST = BASE_DIR / "frontend" / "dist"
if DIST.exists():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="spa")
else:

    @app.get("/")
    def no_frontend() -> JSONResponse:
        return JSONResponse(
            {"sift": "api is up", "note": "frontend not built — run `npm run build` in frontend/"}
        )
