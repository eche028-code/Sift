from sqlmodel import select

from .db import session
from .models import Setting

DEFAULTS: dict[str, str] = {
    "contact_email": "",
    "record_cap": "200",
    # Nudge toward clarifying questions when a fetch would screen more new
    # abstracts than this. 0 nudges every time; raise it to nudge less often.
    "clarify_threshold": "30",
    "user_profile": (
        "An optometrist focused on myopia control, orthokeratology, "
        "and anterior segment disease. Reads to guide clinical decisions."
    ),
    # One model does all three jobs; the endpoint is an OpenAI-compatible /v1.
    "llm_provider": "",
    "llm_base_url": "",
    "llm_api_key": "",
    "llm_model": "",
    # Where "Export to Codex" drops the fragment. Blank falls back to download
    # and clipboard; point it at a synced cloud folder and Codex picks it up there.
    "codex_export_dir": "",
    # Per-function steering. Blank means "use the built-in instructions".
    "prompt_translator": "",
    "prompt_clarifier": "",
    "prompt_triage": "",
    "prompt_synthesis": "",
}

SECRET_KEYS = ("llm_api_key",)


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


def get_int(key: str, fallback: int) -> int:
    try:
        return int(get(key))
    except (TypeError, ValueError):
        return fallback


def all_settings() -> dict:
    """Everything the UI needs. Secrets are reported as set/last4, never echoed."""
    merged = dict(DEFAULTS)
    with session() as s:
        for row in s.exec(select(Setting)).all():
            merged[row.key] = row.value
    out: dict = {}
    for k, v in merged.items():
        if k in SECRET_KEYS:
            out[f"{k}_set"] = bool(v)
            out[f"{k}_last4"] = v[-4:] if len(v) >= 4 else ""
        else:
            out[k] = v
    return out
