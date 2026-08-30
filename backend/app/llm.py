"""One code path for every provider: an OpenAI-compatible chat-completions endpoint."""

import json
import time

from openai import AsyncOpenAI, BadRequestError

from . import settings_store as st


class LLMNotConfigured(Exception):
    pass


class LLMError(Exception):
    pass


_clients: dict[tuple[str, str], AsyncOpenAI] = {}


def _client(base_url: str, api_key: str) -> AsyncOpenAI:
    key = (base_url, api_key)
    if key not in _clients:
        _clients[key] = AsyncOpenAI(
            base_url=base_url,
            api_key=api_key or "sk-local",  # Ollama et al. accept any non-empty key
            timeout=120.0,
            max_retries=1,
        )
    return _clients[key]


def resolve_model() -> tuple[str, str, str, str]:
    """(label, base_url, api_key, model) for the one configured endpoint."""
    base_url = st.get("llm_base_url").strip()
    model = st.get("llm_model").strip()
    if not base_url or not model:
        raise LLMNotConfigured(
            "No model configured. Open Settings, pick a provider, and enter an API key and model."
        )
    label = st.get("llm_provider").strip() or base_url
    return label, base_url, st.get("llm_api_key").strip(), model


async def chat(
    role: str,
    system: str,
    user: str,
    *,
    temperature: float | None = 0.2,
    force_json: bool = True,
) -> str:
    """Chat with the configured model. `role` only labels errors. Strips params a provider rejects."""
    label, base_url, api_key, model = resolve_model()
    client = _client(base_url, api_key)
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    attempts: list[dict] = []
    base: dict = {"model": model, "messages": messages}
    if temperature is not None and force_json:
        attempts.append({**base, "temperature": temperature, "response_format": {"type": "json_object"}})
    if temperature is not None:
        attempts.append({**base, "temperature": temperature})
    if force_json:
        attempts.append({**base, "response_format": {"type": "json_object"}})
    attempts.append(base)

    last_err: Exception | None = None
    for kwargs in attempts:
        try:
            resp = await client.chat.completions.create(**kwargs)
            return resp.choices[0].message.content or ""
        except BadRequestError as e:
            last_err = e  # provider rejected a param — try a plainer request
        except Exception as e:
            raise LLMError(f"{label} ({model}) during {role}: {e}") from e
    raise LLMError(f"{label} ({model}) during {role}: {last_err}") from last_err


def extract_json(text: str) -> dict:
    """Parse a JSON object out of a model reply, tolerating fences and prose."""
    text = text.strip()
    try:
        return json.loads(text)
    except ValueError:
        pass
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
        try:
            return json.loads(text.strip())
        except ValueError:
            pass
    start = text.find("{")
    if start != -1:
        depth = 0
        in_str = False
        esc = False
        for i in range(start, len(text)):
            c = text[i]
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = not in_str
            elif not in_str:
                if c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                    if depth == 0:
                        return json.loads(text[start : i + 1])
    raise ValueError("no JSON object found in model reply")


async def test_connection(base_url: str, api_key: str, model: str) -> dict:
    """1-token-ish ping; returns latency or a readable error."""
    client = _client(base_url, api_key)
    t0 = time.monotonic()
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "Reply with exactly: ok"}],
        )
        ms = int((time.monotonic() - t0) * 1000)
        reply = (resp.choices[0].message.content or "").strip()[:40]
        return {"ok": True, "latency_ms": ms, "model": model, "reply": reply}
    except Exception as e:
        return {"ok": False, "model": model, "error": str(e)[:300]}


async def list_models(base_url: str, api_key: str) -> list[str]:
    client = _client(base_url, api_key)
    page = await client.models.list()
    return [m.id for m in page.data]
