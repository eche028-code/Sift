import json

from fastapi import APIRouter, HTTPException

from .. import scheduler
from .. import settings_store as st

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
def get_settings() -> dict:
    return st.all_settings()


@router.put("")
def put_settings(body: dict) -> dict:
    """Partial update. Accepts flat keys and/or {"roles": {"translator": {...}}}."""
    roles = body.pop("roles", None)
    for key, value in body.items():
        if key == "roles":
            continue
        if key not in st.DEFAULTS:
            raise HTTPException(400, f"unknown setting: {key}")
        st.set(key, "" if value is None else str(value))
    if isinstance(roles, dict):
        for role, cfg in roles.items():
            key = f"role.{role}"
            if key not in st.ROLE_KEYS:
                raise HTTPException(400, f"unknown role: {role}")
            if cfg and cfg.get("provider_id") and cfg.get("model"):
                st.set(key, json.dumps({"provider_id": int(cfg["provider_id"]), "model": str(cfg["model"]).strip()}))
            else:
                st.set(key, "")
    if "crawl_day" in body:
        scheduler.schedule_monthly()
    return st.all_settings()
