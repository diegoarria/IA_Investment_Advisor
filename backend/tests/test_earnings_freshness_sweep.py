"""
Tests — worker.job_refresh_company_diagnostic_earnings_freshness (2026-11-10
P0 latency fix). This job is where new-earnings-report detection moved to,
after the interactive /company-diagnostic cache-hit path stopped calling
Finnhub's _latest_reported_earnings_period on every read (see
test_company_diagnostic_reordering.py's
test_cache_hit_with_stale_earnings_period_is_served_immediately_not_rebuilt
for the interactive-side half of this fix).
"""
import asyncio

import pytest

import worker


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _default_env(monkeypatch):
    monkeypatch.delenv("EARNINGS_FRESHNESS_SWEEP_ENABLED", raising=False)
    monkeypatch.delenv("EARNINGS_FRESHNESS_SWEEP_BATCH_SIZE", raising=False)
    monkeypatch.delenv("EARNINGS_FRESHNESS_SWEEP_TICKER_ALLOWLIST", raising=False)


def test_disabled_by_default_does_nothing(monkeypatch):
    """Same discipline as BACKFILL_ENABLED — new scheduled provider traffic
    must never start just because this deploys; Diego opts in explicitly."""
    import app.services.company_valuation_service as cvs
    called = {"n": 0}
    async def _get_persisted(ticker):
        called["n"] += 1
        return {"intrinsic_value_usd": 1.0}
    monkeypatch.setattr(cvs, "get_persisted_valuation", _get_persisted)

    _run(worker.job_refresh_company_diagnostic_earnings_freshness())

    assert called["n"] == 0


def test_invalidates_only_the_stale_ticker_not_the_whole_cache(monkeypatch):
    monkeypatch.setenv("EARNINGS_FRESHNESS_SWEEP_ENABLED", "true")
    monkeypatch.setenv("EARNINGS_FRESHNESS_SWEEP_TICKER_ALLOWLIST", "AAPL,MSFT")

    import app.api.routes.screener as screener
    import app.services.company_valuation_service as cvs

    async def _get_persisted(ticker):
        return {"intrinsic_value_usd": 100.0, "validation_status": "valid"}
    monkeypatch.setattr(cvs, "get_persisted_valuation", _get_persisted)

    # AAPL's cache says an OLD period; the "real" Finnhub answer (mocked
    # below) is newer -> AAPL must be invalidated. MSFT's cache already
    # matches -> must be left alone.
    cache_state = {
        screener._company_diagnostic_cache_key("AAPL", "es", tier="free"): {"_earnings_period": "2026-Q1"},
        screener._company_diagnostic_cache_key("AAPL", "en", tier="free"): {"_earnings_period": "2026-Q1"},
        screener._company_diagnostic_cache_key("AAPL", "es", tier="premium"): {"_earnings_period": "2026-Q1"},
        screener._company_diagnostic_cache_key("AAPL", "en", tier="premium"): {"_earnings_period": "2026-Q1"},
        screener._company_diagnostic_cache_key("MSFT", "es", tier="free"): {"_earnings_period": "2026-Q3"},
        screener._company_diagnostic_cache_key("MSFT", "en", tier="free"): {"_earnings_period": "2026-Q3"},
        screener._company_diagnostic_cache_key("MSFT", "es", tier="premium"): {"_earnings_period": "2026-Q3"},
        screener._company_diagnostic_cache_key("MSFT", "en", tier="premium"): {"_earnings_period": "2026-Q3"},
    }

    def _cache_get(key):
        return cache_state.get(key)
    import app.core.cache as cache_mod
    monkeypatch.setattr(cache_mod, "cache_get", _cache_get)

    def _fresh_period(ticker):
        return "2026-Q3"  # current real answer for both tickers
    monkeypatch.setattr(screener, "_latest_reported_earnings_period", _fresh_period)

    invalidated = []
    def _invalidate(ticker):
        invalidated.append(ticker)
    monkeypatch.setattr(cvs, "_invalidate_public_diagnostic_cache", _invalidate)

    _run(worker.job_refresh_company_diagnostic_earnings_freshness())

    assert invalidated == ["AAPL"], "only the ticker whose cached _earnings_period is actually behind should be touched"


def test_tickers_with_no_persisted_valuation_are_skipped(monkeypatch):
    """Scope discipline: this sweep never invents new tickers to check —
    only ones that already have a current persisted valuation."""
    monkeypatch.setenv("EARNINGS_FRESHNESS_SWEEP_ENABLED", "true")
    monkeypatch.setenv("EARNINGS_FRESHNESS_SWEEP_TICKER_ALLOWLIST", "AAPL")

    import app.services.company_valuation_service as cvs
    async def _get_persisted(ticker):
        return None  # AAPL has no current persisted valuation in this scenario
    monkeypatch.setattr(cvs, "get_persisted_valuation", _get_persisted)

    checked = {"n": 0}
    def _fresh_period(ticker):
        checked["n"] += 1
        return "2026-Q3"
    import app.api.routes.screener as screener
    monkeypatch.setattr(screener, "_latest_reported_earnings_period", _fresh_period)

    _run(worker.job_refresh_company_diagnostic_earnings_freshness())

    assert checked["n"] == 0


def test_batch_size_bounds_how_many_tickers_are_checked_per_tick(monkeypatch):
    monkeypatch.setenv("EARNINGS_FRESHNESS_SWEEP_ENABLED", "true")
    monkeypatch.setenv("EARNINGS_FRESHNESS_SWEEP_TICKER_ALLOWLIST", "AAPL,MSFT,AMZN")
    monkeypatch.setenv("EARNINGS_FRESHNESS_SWEEP_BATCH_SIZE", "1")

    import app.services.company_valuation_service as cvs
    async def _get_persisted(ticker):
        return {"intrinsic_value_usd": 1.0}
    monkeypatch.setattr(cvs, "get_persisted_valuation", _get_persisted)

    checked = {"n": 0}
    def _fresh_period(ticker):
        checked["n"] += 1
        return None  # Finnhub failure/empty — never invented, no invalidation either way
    import app.api.routes.screener as screener
    monkeypatch.setattr(screener, "_latest_reported_earnings_period", _fresh_period)

    _run(worker.job_refresh_company_diagnostic_earnings_freshness())

    assert checked["n"] == 1
