"""Importación por correo (2026-09-29): extraction normalization, statement
reconciliation into operations, forwarding-verification detection."""
import asyncio

from app.services import inbound_import as ii


def run(c):
    return asyncio.run(c)


def test_normalize_drops_invalid_and_classifies():
    out = ii.normalize({"kind": "trades", "broker": "GBM", "currency": "mxn", "trades": [
        {"action": "buy", "ticker": "amzn", "quantity": "10", "price": "3500.5", "date": "2026-09-28"},
        {"action": "BUY", "ticker": "", "quantity": 1, "price": 1},
        {"action": "HOLD", "ticker": "X", "quantity": 1, "price": 1},
    ]})
    assert out["kind"] == "trades" and out["currency"] == "MXN"
    assert out["trades"] == [{"action": "BUY", "ticker": "AMZN", "name": None, "quantity": 10.0, "price": 3500.5, "date": "2026-09-28"}]
    assert ii.normalize({"kind": "trades", "trades": []})["kind"] == "none"
    assert ii.normalize({"kind": "weird"})["kind"] == "none"


def test_statement_reconciliation(monkeypatch):
    async def last_price(t):
        return {"TSLA": 250.0, "AAPL": 200.0}.get(t)
    monkeypatch.setattr(ii, "_last_price", last_price)
    payload = {"kind": "statement", "positions": [
        {"ticker": "AAPL", "shares": 15, "avg_price": 150.0},   # had 10 → buy 5
        {"ticker": "MSFT", "shares": 3, "avg_price": 300.0},    # new → buy 3
    ]}
    parsed = {"positions": [{"ticker": "AAPL", "shares": 10}, {"ticker": "TSLA", "shares": 2}]}
    ops = run(ii.operations_for(payload, parsed))
    by = {(o["action"], o["ticker"]): o for o in ops}
    assert by[("BUY", "AAPL")]["quantity"] == 5 and by[("BUY", "AAPL")]["price"] == 150.0
    assert by[("BUY", "MSFT")]["quantity"] == 3
    assert by[("SELL", "TSLA")]["quantity"] == 2 and by[("SELL", "TSLA")]["price"] == 250.0


def test_trades_map_one_to_one():
    payload = {"kind": "trades", "trades": [{"action": "SELL", "ticker": "NVDA", "quantity": 1, "price": 100, "date": "2026-09-01"}]}
    assert run(ii.operations_for(payload, {"positions": []})) == payload["trades"]


def test_forwarding_verification_detection():
    assert ii._is_forwarding_verification("forwarding-noreply@google.com", "Confirmación de reenvío de Gmail")
    assert not ii._is_forwarding_verification("notificaciones@gbm.com", "Confirmación de operación")
