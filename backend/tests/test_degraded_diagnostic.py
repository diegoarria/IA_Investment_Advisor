"""
screener.py's _degraded_diagnostic — the fallback shown when every live
provider failed AND there's no Redis cache either (2026-10-20). Confirms
it reads the durable company_valuations table, never fabricates a
score/pillar/scenario, and distinguishes "a real persisted value exists"
from "genuinely never computed."
"""
import asyncio

import app.api.routes.screener as screener


def _run(coro):
    return asyncio.run(coro)


def test_valuation_only_uses_persisted_value_and_live_price(monkeypatch):
    persisted = {
        "intrinsic_value_usd": 263.70,
        "computed_at": "2026-10-20T22:11:33+00:00",
        "validation_status": "valid",
        "assumptions": {"bear": 197.16, "bull": 295.46},
    }
    monkeypatch.setattr(screener, "fh_quote", lambda ticker: {"price": 339.50})

    result = _run(screener._degraded_diagnostic("AAPL", "es", persisted))

    assert result["dataAvailability"] == "valuation_only"
    assert result["valuationAsOf"] == persisted["computed_at"]
    assert result["valuation"]["baseFairValue"] == 263.70
    assert result["valuation"]["conservative"] == 197.16
    assert result["valuation"]["optimistic"] == 295.46
    assert result["valuation"]["currentPrice"] == 339.50
    assert result["valuation"]["marginOfSafetyPercent"] is not None
    # Never fabricated — the fields that need a real, non-stale compute
    # stay genuinely absent, not a fake placeholder.
    assert result["score"] is None
    assert result["pillarScores"] is None
    assert result["valuation"]["peCurrent"] is None


def test_unavailable_when_never_computed(monkeypatch):
    monkeypatch.setattr(screener, "fh_quote", lambda ticker: {"price": 100.0})

    result = _run(screener._degraded_diagnostic("ZZZZ", "es", None))

    assert result["dataAvailability"] == "unavailable"
    assert result["valuation"] is None
    assert result["score"] is None


def test_unavailable_when_persisted_but_not_valid(monkeypatch):
    persisted = {"intrinsic_value_usd": None, "validation_status": "insufficient_data", "computed_at": "2026-10-20T00:00:00+00:00"}
    result = _run(screener._degraded_diagnostic("BRK.B", "es", persisted))
    assert result["dataAvailability"] == "unavailable"
    assert result["valuation"] is None


def test_valuation_only_survives_a_live_quote_failure(monkeypatch):
    persisted = {
        "intrinsic_value_usd": 263.70, "computed_at": "2026-10-20T22:11:33+00:00",
        "validation_status": "valid", "assumptions": {"bear": 197.16, "bull": 295.46},
    }

    def _raise(ticker):
        raise RuntimeError("Finnhub down")
    monkeypatch.setattr(screener, "fh_quote", _raise)

    result = _run(screener._degraded_diagnostic("AAPL", "es", persisted))
    assert result["dataAvailability"] == "valuation_only"
    assert result["valuation"]["currentPrice"] is None
    assert result["valuation"]["marginOfSafetyPercent"] is None
    assert result["valuation"]["baseFairValue"] == 263.70  # the persisted value is never lost
