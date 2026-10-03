"""
GET /api/cash-holdings/summary — the single source every web/mobile screen
(Inicio, Patrimonio, Portafolio) reads cash + dividends from (2026-10-02).
"""
import asyncio
from types import SimpleNamespace

import app.api.routes.cash_holdings as ch
import app.api.routes.market as market


def _run(coro):
    return asyncio.run(coro)


def test_summary_converts_with_one_live_rate(monkeypatch):
    rows = {
        "cash_holdings": [
            {"id": "1", "amount": 1271.17, "currency": "MXN", "instrument": "bank", "label": None},
            {"id": "2", "amount": 100.0, "currency": "USD", "instrument": "other", "label": None},
        ],
        "dividend_income": [{"amount": 0.99, "currency": "USD"}],
    }

    class _Q:
        def __init__(self, table): self.table_name = table
        def select(self, *_a, **_k): return self
        def eq(self, *_a, **_k): return self
        def order(self, *_a, **_k): return self

    class _DB:
        def table(self, name): return _Q(name)

    async def fake_verified(factory, _max_attempts=3):
        return SimpleNamespace(data=rows[factory(_DB()).table_name])

    monkeypatch.setattr(ch, "run_query_verified_nonempty", fake_verified)
    monkeypatch.setattr(market, "_fx_to_usd_multiplier", lambda cur: {"USD": 1.0, "MXN": 1 / 20.0}[cur])

    out = _run(ch.cash_and_dividends_summary(user_id="u1"))

    mxn, usd = out["holdings"]
    assert mxn["accrued_amount"] == 1271.17          # bank, no rate → never changes
    assert abs(mxn["amount_usd"] - 1271.17 / 20.0) < 1e-9
    assert usd["amount_usd"] == 100.0
    assert abs(out["cash_total_usd"] - (1271.17 / 20.0 + 100.0)) < 1e-9
    assert out["dividend_total_usd"] == 0.99
    assert out["dividend_count"] == 1


def test_summary_empty_user(monkeypatch):
    async def fake_verified(factory, _max_attempts=3):
        return SimpleNamespace(data=[])

    monkeypatch.setattr(ch, "run_query_verified_nonempty", fake_verified)
    out = _run(ch.cash_and_dividends_summary(user_id="u1"))
    assert out["holdings"] == [] and out["cash_total_usd"] == 0 and out["dividend_total_usd"] == 0
