import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import select

from .. import llm
from .. import settings_store as st
from ..db import session
from ..models import Provider

router = APIRouter(prefix="/api/providers", tags=["providers"])


def masked(p: Provider) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "base_url": p.base_url,
        "key_last4": p.api_key[-4:] if p.api_key else "",
        "has_key": bool(p.api_key),
        "created_at": p.created_at,
    }


class ProviderIn(BaseModel):
    name: str
    base_url: str
    api_key: str = ""


@router.get("")
def list_providers() -> list[dict]:
    with session() as s:
        return [masked(p) for p in s.exec(select(Provider).order_by(Provider.id)).all()]


@router.post("")
def add_provider(body: ProviderIn) -> dict:
    name = body.name.strip()
    base_url = body.base_url.strip().rstrip("/")
    if not name or not base_url:
        raise HTTPException(400, "name and base_url are required")
    p = Provider(name=name, base_url=base_url, api_key=body.api_key.strip())
    with session() as s:
        s.add(p)
        s.commit()
        s.refresh(p)
    return masked(p)


@router.delete("/{provider_id}")
def delete_provider(provider_id: int) -> dict:
    with session() as s:
        p = s.get(Provider, provider_id)
        if p is None:
            raise HTTPException(404, "provider not found")
        s.delete(p)
        s.commit()
    # clear any role that pointed at it
    for key in st.ROLE_KEYS:
        cfg = st.get_json(key)
        if cfg and cfg.get("provider_id") == provider_id:
            st.set(key, "")
    return {"deleted": provider_id}


class TestIn(BaseModel):
    model: str | None = None


@router.post("/{provider_id}/test")
async def test_provider(provider_id: int, body: TestIn | None = None) -> dict:
    with session() as s:
        p = s.get(Provider, provider_id)
    if p is None:
        raise HTTPException(404, "provider not found")

    model = (body.model.strip() if body and body.model else "") or None
    if not model:  # fall back to a role model assigned to this provider
        for key in st.ROLE_KEYS:
            cfg = st.get_json(key)
            if cfg and cfg.get("provider_id") == provider_id and cfg.get("model"):
                model = cfg["model"]
                break
    if not model:  # last resort: first model the endpoint lists
        try:
            models = await llm.list_models(p)
            model = models[0] if models else None
        except Exception as e:
            return {"ok": False, "error": f"no model assigned and listing failed: {e}"[:300]}
    if not model:
        return {"ok": False, "error": "no model to test with — assign this provider to a role first"}

    return await llm.test_provider(p, model)
