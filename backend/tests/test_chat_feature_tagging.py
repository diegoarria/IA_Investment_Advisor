"""COGS-per-feature attribution: model calls in a portfolio-transaction turn
(tool_use round + the follow-up narration round) log as
"chat_portfolio_action"; ordinary chat keeps logging "chat_stream"."""
import asyncio
from types import SimpleNamespace

import app.services.ai_service as ai
from app.models.user import UserProfile


class _Usage:
    input_tokens = 10
    output_tokens = 5


def _final(stop, tool_names=()):
    content = [SimpleNamespace(type="tool_use", name=n, id=f"t_{n}", input={}) for n in tool_names]
    return SimpleNamespace(usage=_Usage(), stop_reason=stop, content=content)


def _install(monkeypatch, finals):
    it = iter(finals)

    class _Stream:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        @property
        async def text_stream(self):
            if False:
                yield ""

        async def get_final_message(self):
            return next(it)

    monkeypatch.setattr(ai.client.messages, "stream", lambda **kw: _Stream())
    monkeypatch.setattr(ai, "check_daily_spend_cap", lambda: None)

    async def fake_tool(name, inp, uid=None):
        return "PENDING_ID: abc\nPropuesta"
    monkeypatch.setattr(ai, "_exec_mentor_tool", fake_tool)
    logged = []

    async def fake_log(uid, endpoint, model, usage, already_tracked=False):
        logged.append(endpoint)
    monkeypatch.setattr(ai, "log_llm_usage", fake_log)
    return logged


async def _drain(**kw):
    async for _ in ai.chat_stream(
        message="compré 3 de GOOGL a 343", conversation_history=[],
        profile=UserProfile(id="p1", user_id="u1", name="Test", risk_tolerance="moderate"), raw_message="compré 3 de GOOGL a 343", **kw,
    ):
        pass
    await asyncio.sleep(0)  # let fire-and-forget log tasks run


async def test_portfolio_turn_is_tagged(monkeypatch):
    logged = _install(monkeypatch, [_final("tool_use", ["propose_portfolio_transaction"]), _final("end_turn")])
    await _drain()
    assert logged == ["chat_portfolio_action", "chat_portfolio_action"]


async def test_plain_chat_stays_chat_stream(monkeypatch):
    logged = _install(monkeypatch, [_final("tool_use", ["get_stock_quote"]), _final("end_turn")])
    await _drain()
    assert logged == ["chat_stream", "chat_stream"]
