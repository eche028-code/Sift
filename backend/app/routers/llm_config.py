"""One endpoint's worth of LLM config: test the connection, list what it offers."""

from fastapi import APIRouter
from pydantic import BaseModel

from .. import llm
from .. import settings_store as st

router = APIRouter(prefix="/api/llm", tags=["llm"])


class TestIn(BaseModel):
    """All optional — blank fields fall back to what is saved, so the UI can
    test a key the reader has typed but not yet saved."""

    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None


def _resolve(body: TestIn | None) -> tuple[str, str, str]:
    body = body or TestIn()
    base_url = (body.base_url or "").strip() or st.get("llm_base_url").strip()
    model = (body.model or "").strip() or st.get("llm_model").strip()
    # An explicitly sent key wins; otherwise reuse the stored one (the UI never
    # gets the stored key back, so it cannot echo it).
    api_key = body.api_key if body.api_key is not None else st.get("llm_api_key")
    return base_url, (api_key or "").strip(), model


@router.post("/test")
async def test(body: TestIn | None = None) -> dict:
    base_url, api_key, model = _resolve(body)
    if not base_url or not model:
        return {"ok": False, "error": "Pick a provider and enter a model name first."}
    return await llm.test_connection(base_url, api_key, model)


@router.post("/models")
async def models(body: TestIn | None = None) -> dict:
    base_url, api_key, _ = _resolve(body)
    if not base_url:
        return {"ok": False, "error": "Pick a provider first.", "models": []}
    try:
        return {"ok": True, "models": await llm.list_models(base_url, api_key)}
    except Exception as e:  # providers vary wildly here; never break the settings screen
        return {"ok": False, "error": str(e)[:300], "models": []}
