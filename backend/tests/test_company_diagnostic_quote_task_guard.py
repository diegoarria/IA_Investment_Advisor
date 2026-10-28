"""
2026-10-28 P0 (second hotfix): the cache-hit branch of
_company_diagnostic_result fires `fh_quote` concurrently as a task
(`quote_task`), then does `await quote_task` directly with no
try/except — unlike _latest_reported_earnings_period, fh_quote has no
top-level guard of its own (only its internal provider call is wrapped;
the dict-construction step around it is not). An exception there
propagated straight past the warm-cache fast path into main.py's generic
500 handler. Reproduced live for NVDA (~75% failure in a 10-request
burst against an already-cached, already-`valid` ticker).
"""
import asyncio

import pytest

import app.api.routes.screener as screener


def _patch_common(monkeypatch, *, cached):
    monkeypatch.setattr(screener, "_resolve_quick_ticker", lambda q: "NVDA")
    monkeypatch.setattr(screener, "cache_get", lambda key: cached)
    monkeypatch.setattr(screener, "cache_set", lambda *a, **k: None)
    monkeypatch.setattr(screener, "_latest_reported_earnings_period", lambda ticker: cached.get("_earnings_period"))


def _cached_payload(price: float) -> dict:
    return {
        "_schema_version": screener._DIAGNOSTIC_SCHEMA_VERSION,
        "_earnings_period": "2026-Q3",
        "ticker": "NVDA", "companyName": "NVIDIA Corp", "sector": "Technology",
        "score": 80, "scoreLabel": "Precio Justo",
        "valuation": {"currentPrice": price, "baseFairValue": 220.0, "marginOfSafetyPercent": 1.4},
    }


@pytest.mark.asyncio
async def test_fh_quote_exception_in_cache_hit_path_degrades_not_raises(monkeypatch):
    cached = _cached_payload(216.83)
    _patch_common(monkeypatch, cached=cached)

    def _raises(ticker):
        raise ConnectionError("simulated Finnhub/httpx failure under concurrent load")
    monkeypatch.setattr(screener, "fh_quote", _raises)

    result = await asyncio.wait_for(
        screener._company_diagnostic_result("NVDA", "es", "user1", use_ai=True),
        timeout=3.0,
    )
    # Must degrade to the cached diagnostic (with its last-known price),
    # never raise past this point.
    assert result["ticker"] == "NVDA"
    assert result["valuation"]["currentPrice"] == 216.83  # unchanged — live fetch failed, cached price kept


@pytest.mark.asyncio
async def test_healthy_fh_quote_still_refreshes_price_in_cache_hit_path(monkeypatch):
    cached = _cached_payload(200.00)
    _patch_common(monkeypatch, cached=cached)
    monkeypatch.setattr(screener, "fh_quote", lambda ticker: {"price": 216.83, "change_pct": 1.2})

    result = await asyncio.wait_for(
        screener._company_diagnostic_result("NVDA", "es", "user1", use_ai=True),
        timeout=3.0,
    )
    assert result["valuation"]["currentPrice"] == 216.83  # the fix doesn't regress the normal, healthy path
