"""Stage 4 — the backend, not a model call, reports the outcome of an
already-executed portfolio confirmation.

Covers: the structured result the executor produces, the deterministic
renderer (voice, facts, no false success), portfolio_refresh, shadow/on/off
modes in chat_stream, LLM-call counts, and that the atomic-claim double-
execution protection still holds with the new result plumbing."""
import asyncio
import json
import logging

import pytest

import app.services.ai_service as ai
import app.api.routes.sync as sync_module
from app.api.routes.chat import _extract_action
from app.core.config import settings
from app.models.user import UserProfile
from app.services import portfolio_action_result as par
from tests.test_arthur_portfolio_transactions import fake_db, _pending_id  # noqa: F401  (fixture reuse)

PROFILE = UserProfile(id="p1", user_id="u1", name="Test", risk_tolerance="moderate")


# ── renderer ─────────────────────────────────────────────────────────────────

def _buy(**kw):
    base = dict(
        status="success", action="BUY", ticker="GOOGL", company_name="Alphabet", quantity=3.0,
        price=280.0, total_value=840.0, previous_position=10.0, new_position=13.0, avg_cost=270.0,
        currency="USD", portfolio_refresh=True,
    )
    base.update(kw)
    return par.PortfolioActionResult(**base)


def test_buy_reply_matches_the_spec_voice_and_facts():
    text = par.render_reply(_buy())
    assert text.startswith("Listo. Registré la compra de 3 acciones de Alphabet (GOOGL) a $280.00 por acción.")
    assert "Invertiste $840.00" in text and "13 acciones" in text
    assert "Tu portafolio ya quedó actualizado." in text


def test_sell_reply_partial_and_full_close():
    sell = par.PortfolioActionResult(
        status="success", action="SELL", ticker="GOOGL", company_name="Alphabet", quantity=3.0, price=280.0,
        total_value=840.0, previous_position=13.0, new_position=10.0, realized_pl=-25.5, portfolio_refresh=True,
    )
    text = par.render_reply(sell)
    assert "Registré la venta de 3 acciones de Alphabet (GOOGL)" in text
    assert "$840.00" in text and "10 acciones" in text and "-$25.50" in text
    closed = par.render_reply(par.PortfolioActionResult(**{**sell.__dict__, "new_position": 0.0}))
    assert "cerraste la posición por completo" in closed


def test_singular_english_and_currency():
    one = par.render_reply(_buy(quantity=1.0, total_value=280.0, new_position=11.0))
    assert "1 acción de Alphabet" in one
    en = par.render_reply(_buy(), lang="en")
    assert en.startswith("Done. I recorded the purchase of 3 shares of Alphabet (GOOGL)")
    mxn = par.render_reply(_buy(currency="MXN"))
    assert "$280.00 MXN" in mxn


@pytest.mark.parametrize("status", [par.STATUS_WRITE_FAILED, par.STATUS_ALREADY_PROCESSED])
@pytest.mark.parametrize("lang", ["es", "en"])
def test_non_success_never_uses_success_wording_or_refresh(status, lang):
    r = par.PortfolioActionResult(status=status, action="BUY", ticker="GOOGL", portfolio_refresh=False)
    text = par.render_full(r, lang)
    assert r.renderable
    forbidden = ["listo", "registré", "tu posición ahora", "compra realizada", "venta realizada",
                 "done.", "i recorded", "your position is now", "invertiste"]
    assert not any(w in text.lower() for w in forbidden), text
    assert "portfolio_refresh" not in text and "<!--" not in text


def test_refresh_signal_only_for_success_even_if_flag_is_set():
    failed = par.PortfolioActionResult(status=par.STATUS_WRITE_FAILED, portfolio_refresh=True)
    assert par.action_tag(failed) == ""
    ok_tag = par.action_tag(_buy())
    _, actions = _extract_action("hola" + ok_tag)
    assert {"type": "portfolio_refresh", "label": "", "data": {}} in actions
    assert any(a["type"] == "decision" and a["data"]["ticker"] == "GOOGL" for a in actions)


def test_incomplete_success_is_not_renderable():
    assert not par.PortfolioActionResult(status="success", action="BUY", ticker="X").renderable
    assert not _buy(action="UPDATE").renderable       # corrections stay on the LLM path
    assert not par.PortfolioActionResult(status="expired").renderable


def test_compare_flags_llm_success_claim_on_failure_and_missing_facts():
    failed = par.PortfolioActionResult(status=par.STATUS_WRITE_FAILED)
    assert "llm_claims_success_on_non_success" in par.compare_with_llm_text(failed, "Listo, quedó registrado.")
    ok = _buy()
    assert par.compare_with_llm_text(ok, 'GOOGL: ahora 13 acciones <!-- ACTION: {"actions":[{"type":"portfolio_refresh"}]} -->') == []
    issues = par.compare_with_llm_text(ok, "Hecho.")
    assert {"llm_missing_ticker", "llm_missing_or_different_new_position", "llm_missing_portfolio_refresh"} <= set(issues)


# ── executor: structured result comes from what was really written ───────────

async def _propose(fake_db, **kw):
    args = {"action_type": "BUY_ASSET", "ticker": "GOOGL", "amount": 200, "execution_price": 340,
            "raw_message": "Compré $200 más de Google a $340."}
    args.update(kw)
    return _pending_id(await ai._exec_mentor_tool("propose_portfolio_transaction", args, user_id="u1"))


async def test_buy_result_is_built_from_the_db_write_not_the_user_text(fake_db):
    pid = await _propose(fake_db)
    out = {}
    text = await ai._confirm_pending_financial_action({"pending_id": pid, "confirmed": True}, "u1", structured_out=out)
    r = out["result"]
    assert text.startswith("Aplicado.")
    assert (r.status, r.action, r.ticker, r.company_name) == ("success", "BUY", "GOOGL", "Alphabet")
    assert r.previous_position == pytest.approx(0.5147)
    assert r.new_position == pytest.approx(0.5147 + 200 / 340, abs=1e-3)
    persisted = fake_db["user_portfolio"][("u1", "default")]["positions"]["positions"]
    assert r.new_position == pytest.approx(sum(p["shares"] for p in persisted if p["ticker"] == "GOOGL"), abs=1e-6)
    assert r.price == 340.0 and r.total_value == pytest.approx(200.0, abs=0.01)
    assert r.portfolio_refresh is True and r.renderable


async def test_sell_result_has_realized_pl_and_new_position(fake_db):
    pid = await _propose(fake_db, action_type="SELL_ASSET", amount=None, quantity=0.2, execution_price=300)
    out = {}
    await ai._confirm_pending_financial_action({"pending_id": pid, "confirmed": True}, "u1", structured_out=out)
    r = out["result"]
    assert r.status == "success" and r.action == "SELL" and r.realized_pl is not None
    assert r.new_position == pytest.approx(0.5147 - 0.2, abs=1e-4)
    assert "Registré la venta" in par.render_reply(r)


async def test_write_failure_yields_write_failed_and_a_reply_with_no_success(fake_db, monkeypatch):
    pid = await _propose(fake_db)

    async def boom(*a, **k):
        raise RuntimeError("supabase blip")
    monkeypatch.setattr(sync_module, "apply_portfolio_positions", boom)
    out = {}
    await ai._confirm_pending_financial_action({"pending_id": pid, "confirmed": True}, "u1", structured_out=out)
    r = out["result"]
    assert r.status == "write_failed" and not r.portfolio_refresh
    reply = par.render_full(r)
    assert "No se registró ningún cambio" in reply
    assert "Listo" not in reply and "portfolio_refresh" not in reply
    # claim released: the pending row can be retried
    assert next(iter(fake_db["pending_financial_actions"].values()))["status"] == "pending"


async def test_concurrent_confirms_one_success_rest_already_processed(fake_db, monkeypatch):
    pid = await _propose(fake_db)
    original = ai.run_query

    async def yielding(query):
        await asyncio.sleep(0)
        return await original(query)
    monkeypatch.setattr(ai, "run_query", yielding)
    monkeypatch.setattr(sync_module, "run_query", yielding)

    outs = [{} for _ in range(4)]
    texts = await asyncio.gather(*(
        ai._confirm_pending_financial_action({"pending_id": pid, "confirmed": True}, "u1", structured_out=o)
        for o in outs
    ))
    statuses = sorted(o["result"].status for o in outs if "result" in o)
    assert statuses.count("success") == 1
    assert all(s in ("success", "already_processed") for s in statuses)
    assert sum(t.startswith("Aplicado.") for t in texts) == 1
    googl = [p for p in fake_db["user_portfolio"][("u1", "default")]["positions"]["positions"] if p["ticker"] == "GOOGL"]
    assert len(googl) == 2  # the seeded lot + exactly ONE new buy lot


async def test_outcomes_needing_conversation_produce_no_structured_result(fake_db):
    out = {}
    await ai._confirm_pending_financial_action({"pending_id": "does-not-exist", "confirmed": True}, "u1", structured_out=out)
    assert "result" not in out                                   # not found -> LLM path
    pid = await _propose(fake_db)
    out = {}
    text = await ai._confirm_pending_financial_action({"pending_id": pid, "confirmed": False}, "u1", structured_out=out)
    assert text.startswith("Cancelado") and "result" not in out  # cancelled -> LLM path
    # expired
    pid = await _propose(fake_db, ticker="MSFT", amount=None, quantity=1, execution_price=400)
    row = next(r for r in fake_db["pending_financial_actions"].values() if r["id"] == pid)
    row["expires_at"] = "2000-01-01T00:00:00+00:00"
    out = {}
    text = await ai._confirm_pending_financial_action({"pending_id": pid, "confirmed": True}, "u1", structured_out=out)
    assert "expiró" in text and "result" not in out
    # sell more than held -> refused at propose time, never a pending row
    refused = await ai._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "SELL_ASSET", "ticker": "GOOGL", "quantity": 999, "execution_price": 300, "raw_message": "vendí 999"}, user_id="u1")
    assert "PENDING_ID" not in refused


async def test_no_portfolio_user_sells_never_report_success(fake_db):
    refused = await ai._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "SELL_ASSET", "ticker": "AAPL", "quantity": 1, "execution_price": 200, "raw_message": "vendí 1 AAPL"}, user_id="nobody")
    assert "PENDING_ID" not in refused


# ── chat_stream wiring: modes and LLM-call counts ────────────────────────────

class _Usage:
    input_tokens = 10
    output_tokens = 5


class _Block:
    type = "tool_use"

    def __init__(self, name, input, id):
        self.name, self.input, self.id = name, input, id


def _install_rounds(monkeypatch, rounds):
    state = {"calls": 0}

    def fake_stream(**kwargs):
        chunks, stop, content = rounds[state["calls"]]
        state["calls"] += 1

        class _S:
            @property
            async def text_stream(self):
                for c in chunks:
                    yield c

            async def get_final_message(self):
                from types import SimpleNamespace
                return SimpleNamespace(usage=_Usage(), stop_reason=stop, content=content)

        class _CM:
            async def __aenter__(self):
                return _S()

            async def __aexit__(self, *e):
                return False
        return _CM()

    monkeypatch.setattr(ai.client.messages, "stream", fake_stream)
    monkeypatch.setattr(ai, "check_daily_spend_cap", lambda: None)

    async def nolog(*a, **k):
        return None
    monkeypatch.setattr(ai, "log_llm_usage", nolog)
    return state


def _fake_confirm(result):
    async def fake(name, tool_input, user_id=None):
        if result is not None:
            ai._STRUCTURED_OUT.get()["result"] = result
        return "Aplicado. GOOGL: ahora 13.0000 acciones, costo promedio $270.00."
    return fake


async def _run(msg="sí, confirmo"):
    return "".join([c async for c in ai.chat_stream(
        message=msg, conversation_history=[], profile=PROFILE, raw_message=msg)])


LLM_NARRATION = "Listo, Diego. Quedó registrado: GOOGL, ahora 13 acciones."


async def test_on_mode_skips_the_narration_call_and_sends_the_deterministic_reply(monkeypatch):
    monkeypatch.setattr(settings, "portfolio_confirm_render_mode", "on")
    state = _install_rounds(monkeypatch, [([], "tool_use", [_Block("confirm_pending_financial_action", {"pending_id": "x"}, "t1")]),
                                          ([LLM_NARRATION], "end_turn", [])])
    monkeypatch.setattr(ai, "_exec_mentor_tool", _fake_confirm(_buy()))
    out = await _run()
    assert state["calls"] == 1                      # narration call skipped (was 2)
    assert out.startswith("Listo. Registré la compra de 3 acciones de Alphabet (GOOGL)")
    assert LLM_NARRATION not in out
    clean, actions = _extract_action(out)
    assert any(a["type"] == "portfolio_refresh" for a in actions)


async def test_on_mode_write_failure_gets_an_error_reply_and_no_refresh(monkeypatch):
    monkeypatch.setattr(settings, "portfolio_confirm_render_mode", "on")
    failed = par.PortfolioActionResult(status=par.STATUS_WRITE_FAILED, action="BUY", ticker="GOOGL")
    state = _install_rounds(monkeypatch, [([], "tool_use", [_Block("confirm_pending_financial_action", {"pending_id": "x"}, "t1")]),
                                          ([LLM_NARRATION], "end_turn", [])])

    async def fake(name, tool_input, user_id=None):
        ai._STRUCTURED_OUT.get()["result"] = failed
        return "No pude actualizar tu posición. Tu portafolio NO fue modificado."
    monkeypatch.setattr(ai, "_exec_mentor_tool", fake)
    out = await _run()
    assert state["calls"] == 1
    assert "No se registró ningún cambio" in out
    assert "Listo" not in out and "portfolio_refresh" not in out


async def test_on_mode_still_uses_the_llm_when_the_outcome_needs_conversation(monkeypatch):
    monkeypatch.setattr(settings, "portfolio_confirm_render_mode", "on")
    state = _install_rounds(monkeypatch, [([], "tool_use", [_Block("confirm_pending_financial_action", {"pending_id": "x"}, "t1")]),
                                          (["Esa propuesta expiró, ¿la repetimos?"], "end_turn", [])])

    async def fake(name, tool_input, user_id=None):
        return "Esa propuesta ya expiró — pídele al usuario que la repita."   # no structured result
    monkeypatch.setattr(ai, "_exec_mentor_tool", fake)
    out = await _run()
    assert state["calls"] == 2 and "expiró" in out


async def test_on_mode_with_parallel_tools_keeps_the_llm_narration(monkeypatch):
    monkeypatch.setattr(settings, "portfolio_confirm_render_mode", "on")
    state = _install_rounds(monkeypatch, [([], "tool_use", [
        _Block("confirm_pending_financial_action", {"pending_id": "x"}, "t1"), _Block("get_stock_quote", {"ticker": "GOOGL"}, "t2")]),
        (["Hecho y GOOGL cotiza a 280."], "end_turn", [])])
    monkeypatch.setattr(ai, "_exec_mentor_tool", _fake_confirm(_buy()))
    out = await _run()
    assert state["calls"] == 2 and out.endswith("Hecho y GOOGL cotiza a 280.")


async def test_shadow_mode_shows_the_llm_reply_and_logs_discrepancies(monkeypatch, caplog):
    monkeypatch.setattr(settings, "portfolio_confirm_render_mode", "shadow")
    state = _install_rounds(monkeypatch, [([], "tool_use", [_Block("confirm_pending_financial_action", {"pending_id": "x"}, "t1")]),
                                          ([LLM_NARRATION], "end_turn", [])])
    monkeypatch.setattr(ai, "_exec_mentor_tool", _fake_confirm(_buy()))
    with caplog.at_level(logging.INFO):
        out = await _run()
    assert state["calls"] == 2                      # nothing skipped in shadow
    assert out.startswith(LLM_NARRATION)            # user still sees the legacy reply
    line = next(r.getMessage() for r in caplog.records if "portfolio_confirm_shadow" in r.getMessage())
    assert "llm_missing_portfolio_refresh" in line  # the LLM forgot the refresh tag -> logged
    assert "Alphabet" not in line                   # no names in the log


async def test_off_mode_is_exactly_the_legacy_flow(monkeypatch, caplog):
    monkeypatch.setattr(settings, "portfolio_confirm_render_mode", "off")
    state = _install_rounds(monkeypatch, [([], "tool_use", [_Block("confirm_pending_financial_action", {"pending_id": "x"}, "t1")]),
                                          ([LLM_NARRATION], "end_turn", [])])
    monkeypatch.setattr(ai, "_exec_mentor_tool", _fake_confirm(_buy()))
    with caplog.at_level(logging.INFO):
        out = await _run()
    assert state["calls"] == 2 and out.startswith(LLM_NARRATION)
    assert not any("portfolio_confirm" in r.getMessage() for r in caplog.records)


async def test_default_mode_is_shadow():
    assert settings.portfolio_confirm_render_mode == "shadow"


# ── end to end: real executor + real chat_stream, mode on ────────────────────

async def test_end_to_end_confirm_turn_uses_one_llm_call_and_writes_once(fake_db, monkeypatch):
    monkeypatch.setattr(settings, "portfolio_confirm_render_mode", "on")
    pid = await _propose(fake_db)
    state = _install_rounds(monkeypatch, [
        ([], "tool_use", [_Block("confirm_pending_financial_action", {"pending_id": pid, "confirmed": True}, "t1")]),
        (["(never reached)"], "end_turn", [])])
    out = "".join([c async for c in ai.chat_stream(
        message="sí", conversation_history=[], profile=PROFILE, raw_message="sí")])
    assert state["calls"] == 1
    assert "Registré la compra" in out and "GOOGL" in out and "portfolio_refresh" in out
    googl = [p for p in fake_db["user_portfolio"][("u1", "default")]["positions"]["positions"] if p["ticker"] == "GOOGL"]
    assert len(googl) == 2
    assert next(iter(fake_db["pending_financial_actions"].values()))["status"] == "applied"


async def test_timeout_on_write_is_a_write_failure_with_no_success_reply(fake_db, monkeypatch):
    pid = await _propose(fake_db)

    async def slow(*a, **k):
        raise asyncio.TimeoutError()
    monkeypatch.setattr(sync_module, "apply_portfolio_positions", slow)
    out = {}
    await ai._confirm_pending_financial_action({"pending_id": pid, "confirmed": True}, "u1", structured_out=out)
    assert out["result"].status == "write_failed"
    assert "Listo" not in par.render_full(out["result"])


@pytest.mark.parametrize("bad", [
    {"ticker": "", "execution_price": 100, "quantity": 1},
    {"ticker": "GOOGL", "execution_price": 0, "quantity": 1},
    {"ticker": "GOOGL", "execution_price": -5, "quantity": 1},
    {"ticker": "GOOGL", "execution_price": 100, "quantity": 0},
    {"ticker": "GOOGL", "execution_price": 100, "quantity": -3},
])
async def test_invalid_inputs_never_create_a_pending_action(fake_db, bad):
    args = {"action_type": "BUY_ASSET", "raw_message": "x", **bad}
    result = await ai._exec_mentor_tool("propose_portfolio_transaction", args, user_id="u1")
    assert "PENDING_ID" not in result
    assert not fake_db["pending_financial_actions"]


async def test_on_mode_replies_even_when_confirm_lands_in_the_last_tool_round(monkeypatch):
    """Legacy gap: a confirm executed in the final allowed round (e.g. after a
    lookup round) left the user with NO reply at all. The deterministic reply
    closes it."""
    monkeypatch.setattr(settings, "portfolio_confirm_render_mode", "on")
    state = _install_rounds(monkeypatch, [
        ([], "tool_use", [_Block("get_portfolio_transactions", {}, "t0")]),
        ([], "tool_use", [_Block("confirm_pending_financial_action", {"pending_id": "x"}, "t1")]),
    ])

    async def fake(name, tool_input, user_id=None):
        if name == "confirm_pending_financial_action":
            ai._STRUCTURED_OUT.get()["result"] = _buy()
        return "ok"
    monkeypatch.setattr(ai, "_exec_mentor_tool", fake)
    out = await _run()
    assert state["calls"] == 2 and "Registré la compra" in out
