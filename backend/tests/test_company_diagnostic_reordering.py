"""
_company_diagnostic_result (screener.py) — 2026-10-21 reordering, Nuvos
Radar structural audit: a valid, current persisted valuation (company_
valuations) must be checked BEFORE the live build, so it can short-
circuit the retry+2.5s-backoff instead of only being consulted after
both live attempts already failed. Confirmed live this is what made
AMZN's total request latency exceed what a client/proxy would wait for,
hiding a perfectly good persisted valuation behind a timeout.

A stale-but-full cached diagnostic still outranks a valuation_only
fallback (real narrative/scores beat just a number), so it's checked
first when both exist.
"""
import asyncio

import pytest

import app.api.routes.screener as screener


def _run(coro):
    return asyncio.run(coro)


def _patch_common(monkeypatch, *, cached=None, persisted=None, fundamental_data="FAIL", earnings_period="2026-Q3"):
    """fundamental_data="FAIL" means get_fundamental_analysis returns None
    (the live build fails); any other value is returned as-is and
    build_company_diagnostic succeeds with it."""
    monkeypatch.setattr(screener, "_resolve_quick_ticker", lambda q: "AMZN")
    monkeypatch.setattr(screener, "cache_get", lambda key: cached)
    monkeypatch.setattr(screener, "cache_set", lambda *a, **k: None)
    monkeypatch.setattr(screener, "fh_quote", lambda ticker: {"price": 215.0})
    monkeypatch.setattr(screener, "_latest_reported_earnings_period", lambda ticker: earnings_period)

    import app.services.company_valuation_service as cvs
    async def _get_persisted(ticker):
        return persisted
    monkeypatch.setattr(cvs, "get_persisted_valuation", _get_persisted)

    import app.services.fundamental_analysis_service as fas
    def _get_fundamental(ticker):
        return None if fundamental_data == "FAIL" else fundamental_data
    monkeypatch.setattr(fas, "get_fundamental_analysis", _get_fundamental)

    import app.services.company_diagnostic_service as cds
    def _build(ticker, data, lang):
        return None  # live build always fails in these tests — we're testing the FALLBACK ordering
    monkeypatch.setattr(cds, "build_company_diagnostic", _build)

    import app.services.ai_service as ai_service
    async def _narrative(**kwargs):
        return None
    monkeypatch.setattr(ai_service, "generate_company_diagnostic_narrative", _narrative)


@pytest.mark.asyncio
async def test_fresh_persisted_valuation_skips_the_retry_entirely(monkeypatch):
    persisted = {
        "intrinsic_value_usd": 215.90, "computed_at": "2026-10-21T05:24:44+00:00",
        "validation_status": "valid", "assumptions": {"bear": 180.0, "bull": 260.0},
    }
    _patch_common(monkeypatch, cached=None, persisted=persisted)

    attempts = {"n": 0}
    sleeps = {"n": 0}
    orig_attempt = None

    async def _counting_sleep(seconds):
        sleeps["n"] += 1

    monkeypatch.setattr(asyncio, "sleep", _counting_sleep)

    import app.services.fundamental_analysis_service as fas
    def _counting_fundamental(ticker):
        attempts["n"] += 1
        return None
    monkeypatch.setattr(fas, "get_fundamental_analysis", _counting_fundamental)

    result = await screener._company_diagnostic_result("AMZN", "es", "user1", use_ai=True)

    assert result["dataAvailability"] == "valuation_only"
    assert result["valuation"]["baseFairValue"] == 215.90
    assert attempts["n"] == 1, "must not retry the live build when a fresh persisted valuation is already in hand"
    assert sleeps["n"] == 0, "must not wait out the 2.5s backoff when it's skipping the retry"


@pytest.mark.asyncio
async def test_no_persisted_valuation_still_retries_once(monkeypatch):
    _patch_common(monkeypatch, cached=None, persisted=None)

    attempts = {"n": 0}
    sleeps = {"n": 0}

    async def _counting_sleep(seconds):
        sleeps["n"] += 1

    monkeypatch.setattr(asyncio, "sleep", _counting_sleep)

    import app.services.fundamental_analysis_service as fas
    def _counting_fundamental(ticker):
        attempts["n"] += 1
        return None
    monkeypatch.setattr(fas, "get_fundamental_analysis", _counting_fundamental)

    result = await screener._company_diagnostic_result("AMZN", "es", "user1", use_ai=True)

    assert result["dataAvailability"] == "unavailable"
    assert attempts["n"] == 2, "with nothing to fall back to, the existing retry-once behavior must be preserved"
    assert sleeps["n"] == 1


@pytest.mark.asyncio
async def test_stale_full_cache_outranks_persisted_valuation_only(monkeypatch):
    stale_cached = {
        "ticker": "AMZN", "companyName": "Amazon", "score": 82, "scoreLabel": "Sólida",
        "_earnings_period": "2026-Q2",  # older than the "current" 2026-Q3 below -> triggers a rebuild attempt
        # 2026-10-27 (AXON closeout): a cache entry missing this is treated
        # as pre-dating the reliability guard and rejected outright
        # (test_company_diagnostic_under_review.py) — this fixture
        # represents an ordinary, current-schema stale entry instead.
        "_schema_version": screener._DIAGNOSTIC_SCHEMA_VERSION,
    }
    persisted = {
        "intrinsic_value_usd": 215.90, "computed_at": "2026-10-21T05:24:44+00:00",
        "validation_status": "valid", "assumptions": {},
    }
    _patch_common(monkeypatch, cached=stale_cached, persisted=persisted, earnings_period="2026-Q3")

    async def _fail_sleep(seconds):
        raise AssertionError("must not sleep/retry when a stale-but-full cached diagnostic can be served instead")
    monkeypatch.setattr(asyncio, "sleep", _fail_sleep)

    import app.services.fundamental_analysis_service as fas
    monkeypatch.setattr(fas, "get_fundamental_analysis", lambda ticker: None)

    result = await screener._company_diagnostic_result("AMZN", "es", "user1", use_ai=True)

    assert result["stale"] is True
    assert result["score"] == 82  # the real, richer stale diagnostic — not the valuation_only fallback
    assert "dataAvailability" not in result or result.get("dataAvailability") != "valuation_only"
