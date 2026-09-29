"""Arthur must always answer (Diego, 2026-09-29): _resilient_reply falls
back primary model -> Haiku -> GPT-mini generic, and only raises 503 when
everything fails."""
import asyncio

import pytest
from fastapi import HTTPException

from app.api.routes import chat


def _run(coro):
    return asyncio.run(coro)


def test_primary_model_answers(monkeypatch):
    calls = []

    async def collect(m):
        calls.append(m)
        return "hola"

    assert _run(chat._resilient_reply(collect, "sonnet", "q", [])) == "hola"
    assert calls == ["sonnet"]


def test_falls_back_to_haiku_on_exception(monkeypatch):
    calls = []

    async def collect(m):
        calls.append(m)
        if m == "sonnet":
            raise RuntimeError("529 overloaded")
        return "respuesta haiku"

    assert _run(chat._resilient_reply(collect, "sonnet", "q", [])) == "respuesta haiku"
    assert calls == ["sonnet", chat._FALLBACK_MODEL]


def test_empty_replies_fall_back_to_generic(monkeypatch):
    async def collect(m):
        return "   "

    async def generic(message, conversation_history=None):
        return "respuesta generica"

    monkeypatch.setattr(chat.ai_service, "generate_generic_answer", generic)
    assert _run(chat._resilient_reply(collect, "haiku", "q", [])) == "respuesta generica"


def test_everything_fails_raises_503(monkeypatch):
    async def collect(m):
        raise RuntimeError("down")

    async def generic(message, conversation_history=None):
        raise RuntimeError("openai down")

    monkeypatch.setattr(chat.ai_service, "generate_generic_answer", generic)
    with pytest.raises(HTTPException) as exc:
        _run(chat._resilient_reply(collect, "haiku", "q", []))
    assert exc.value.status_code == 503
