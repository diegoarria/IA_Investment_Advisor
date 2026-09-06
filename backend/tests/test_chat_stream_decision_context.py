"""
Integration test — chat_stream()'s wiring of the new Decision Context /
Portfolio Truth block (decision_engine.py) into the real system prompt sent
to Claude, plus the post-stream Recommendation Guard telemetry.

Mocks `client.messages.stream` (the Anthropic SDK's async streaming context
manager) rather than `_claude()`, since chat_stream calls the client
directly for streaming — same boundary chosen for anything that needs to
inspect what actually reached the model. Verifies:

1. The Decision Context block (with real Portfolio Truth numbers, market-
   value-weighted) is present in the `system` param passed to the real API
   call — this is the actual "did the wiring happen" check, not a proxy.
2. chat_stream still yields text chunks in order (streaming behavior
   unchanged by the new optional params).
3. A response containing prescriptive language is caught by the guard and
   logged (not blocked — see ai_service.py's comment on why chat_stream
   can't retroactively fix an already-streamed response), while a clean
   response logs nothing.
4. Existing callers that don't pass positions/quotes (e.g. voice_call.py)
   still work — backward compatibility of the new optional params.
"""
import logging

import pytest

import app.services.ai_service as ai_service
from app.models.user import ChatMessage


class _FakeUsage:
    input_tokens = 100
    output_tokens = 50


class _FakeFinalMessage:
    def __init__(self, stop_reason="end_turn"):
        self.usage = _FakeUsage()
        self.stop_reason = stop_reason
        self.content = []


class _FakeStream:
    def __init__(self, chunks: list[str]):
        self._chunks = chunks

    @property
    async def text_stream(self):
        for c in self._chunks:
            yield c

    async def get_final_message(self):
        return _FakeFinalMessage()


class _FakeStreamContextManager:
    """Mimics `client.messages.stream(...)` — an async context manager
    whose __aenter__ returns the stream object, capturing the kwargs it
    was called with so the test can inspect the real system prompt."""
    captured_kwargs: dict = {}

    def __init__(self, chunks: list[str], **kwargs):
        self._chunks = chunks
        _FakeStreamContextManager.captured_kwargs = kwargs

    async def __aenter__(self):
        return _FakeStream(self._chunks)

    async def __aexit__(self, *exc):
        return False


def _install_fake_stream(monkeypatch, chunks: list[str]):
    def fake_stream(**kwargs):
        return _FakeStreamContextManager(chunks, **kwargs)

    monkeypatch.setattr(ai_service.client.messages, "stream", fake_stream)
    monkeypatch.setattr(ai_service, "check_daily_spend_cap", lambda: None)


async def _collect(async_gen):
    return "".join([chunk async for chunk in async_gen])


async def test_decision_context_and_portfolio_truth_reach_the_real_system_prompt(monkeypatch):
    _install_fake_stream(monkeypatch, ["Todo bien con tu portafolio."])

    positions = [{"ticker": "NVDA", "shares": 50, "avg_price": 100.0}, {"ticker": "OTHER", "shares": 50, "avg_price": 100.0}]
    quotes = {"NVDA": {"price": 100.0}, "OTHER": {"price": 100.0}}

    result = await _collect(ai_service.chat_stream(
        message="¿Compro más NVDA?",
        conversation_history=[],
        profile=None,
        positions=positions,
        quotes=quotes,
    ))
    assert result == "Todo bien con tu portafolio."

    system_blocks = _FakeStreamContextManager.captured_kwargs["system"]
    full_system_text = "\n".join(b["text"] for b in system_blocks)
    assert "DECISION CONTEXT" in full_system_text
    assert "PORTFOLIO TRUTH" in full_system_text
    # NVDA and OTHER have equal cost basis and equal price -> 50/50 by
    # market value; this is the concentration fact Arthur must reason from.
    assert "peso actual del portafolio: 50.0%" in full_system_text


async def test_chat_stream_backward_compatible_without_positions_or_quotes(monkeypatch):
    # voice_call.py and other pre-existing callers never pass positions/
    # quotes — this must still work exactly as before, just with an
    # "unknown" Decision Context block instead of a populated one.
    _install_fake_stream(monkeypatch, ["Hola, ¿en qué te ayudo?"])
    result = await _collect(ai_service.chat_stream(
        message="hola",
        conversation_history=[],
        profile=None,
    ))
    assert result == "Hola, ¿en qué te ayudo?"
    system_blocks = _FakeStreamContextManager.captured_kwargs["system"]
    full_system_text = "\n".join(b["text"] for b in system_blocks)
    assert "DECISION CONTEXT" in full_system_text
    assert "DESCONOCIDO" in full_system_text  # no data given -> honestly says so, never invents


async def test_streaming_still_yields_chunks_in_order(monkeypatch):
    _install_fake_stream(monkeypatch, ["Uno", " dos", " tres"])
    result = await _collect(ai_service.chat_stream(
        message="hola", conversation_history=[], profile=None,
    ))
    assert result == "Uno dos tres"


async def test_prescriptive_response_is_logged_not_blocked(monkeypatch, caplog):
    # chat_stream cannot retroactively fix an already-streamed response
    # (see the comment in ai_service.py) — a violation must still reach
    # the caller in full (never silently truncated), but must be logged
    # for prompt-quality review.
    _install_fake_stream(monkeypatch, ["Deberías comprar más NVDA ahora mismo."])
    with caplog.at_level(logging.WARNING):
        result = await _collect(ai_service.chat_stream(
            message="¿Compro más NVDA?", conversation_history=[], profile=None,
        ))
    assert result == "Deberías comprar más NVDA ahora mismo."  # not blocked, not altered
    assert any("recommendation guard flagged" in r.message for r in caplog.records)


async def test_clean_response_logs_no_guard_warning(monkeypatch, caplog):
    _install_fake_stream(monkeypatch, ["NVDA tiene un margen bruto de 75%."])
    with caplog.at_level(logging.WARNING):
        await _collect(ai_service.chat_stream(
            message="¿Cómo va NVDA?", conversation_history=[], profile=None,
        ))
    assert not any("recommendation guard flagged" in r.message for r in caplog.records)


async def test_conversation_history_still_forwarded_correctly(monkeypatch):
    _install_fake_stream(monkeypatch, ["ok"])
    history = [ChatMessage(role="user", content="hola"), ChatMessage(role="assistant", content="hola, ¿en qué ayudo?")]
    await _collect(ai_service.chat_stream(
        message="¿y ahora?", conversation_history=history, profile=None,
    ))
    messages = _FakeStreamContextManager.captured_kwargs["messages"]
    assert messages[0] == {"role": "user", "content": "hola"}
    assert messages[1] == {"role": "assistant", "content": "hola, ¿en qué ayudo?"}
    assert messages[-1] == {"role": "user", "content": "¿y ahora?"}
