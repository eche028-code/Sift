from fastapi import APIRouter, HTTPException

from .. import prompts, scheduler
from .. import settings_store as st

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
def get_settings() -> dict:
    return st.all_settings()


@router.put("")
def put_settings(body: dict) -> dict:
    """Partial update: only the keys present in the body are written."""
    for key, value in body.items():
        if key not in st.DEFAULTS:
            raise HTTPException(400, f"unknown setting: {key}")
        st.set(key, "" if value is None else str(value))
    if "crawl_day" in body:
        scheduler.schedule_monthly()
    return st.all_settings()


@router.get("/prompt-defaults")
def prompt_defaults() -> dict:
    """The built-in instructions, so the UI can show and restore them."""
    return prompts.DEFAULT_PROMPTS
