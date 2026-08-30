import json

from sqlmodel import select

from .db import session
from .models import Setting

DEFAULTS: dict[str, str] = {
    "ncbi_api_key": "",
    "contact_email": "",
    "backfill_floor_year": "2000",
    "crawl_day": "1",
    "backfill_window_months": "12",
    "record_cap": "200",
    "user_profile": (
        "An optometrist focused on myopia control, orthokeratology, "
        "and anterior segment disease. Reads to guide clinical decisions."
    ),
    "role.translator": "",
    "role.triage": "",
    "role.synthesis": "",
}

ROLE_KEYS = ("role.translator", "role.triage", "role.synthesis")


def get(key: str) -> str:
    with session() as s:
        row = s.get(Setting, key)
    if row is not None:
        return row.value
    return DEFAULTS.get(key, "")


def set(key: str, value: str) -> None:
    with session() as s:
        row = s.get(Setting, key)
        if row is None:
            row = Setting(key=key, value=value)
        else:
            row.value = value
        s.add(row)
        s.commit()


def get_json(key: str) -> dict | None:
    raw = get(key)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def get_int(key: str, fallback: int) -> int:
    try:
        return int(get(key))
    except (TypeError, ValueError):
        return fallback


def all_settings() -> dict:
    merged = dict(DEFAULTS)
    with session() as s:
        for row in s.exec(select(Setting)).all():
            merged[row.key] = row.value
    out: dict = {}
    for k, v in merged.items():
        if k in ROLE_KEYS:
            role = k.split(".", 1)[1]
            try:
                out.setdefault("roles", {})[role] = json.loads(v) if v else None
            except ValueError:
                out.setdefault("roles", {})[role] = None
        else:
            out[k] = v
    return out
