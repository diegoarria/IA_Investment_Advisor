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
async def test_cache_hit_with_stale_earnings_period_is_served_immediately_not_rebuilt(monkeypatch):
    """2026-11-10 P0 latency fix: `_latest_reported_earnings_period` used to
    run on every cache hit and, on a mismatch, forced an immediate rebuild
    attempt (the old version of this test exercised exactly that, expecting
    a `stale=True` result once the forced rebuild failed). That inline
    check is gone — new-earnings-report detection moved to a scheduled
    sweep (job_refresh_company_diagnostic_earnings_freshness in worker.py),
    so a cache hit now returns immediately regardless of `_earnings_period`,
    with no rebuild attempt and no `stale` flag. The `_latest_reported_
    earnings_period` mock below is set to a DIFFERENT value than the
    cached entry's own field specifically to prove it's no longer even
    consulted on this path."""
    cached = {
        "ticker": "AMZN", "companyName": "Amazon", "score": 82, "scoreLabel": "Sólida",
        "_earnings_period": "2026-Q2",  # deliberately mismatched vs earnings_period="2026-Q3" below
        "_schema_version": screener._DIAGNOSTIC_SCHEMA_VERSION,
    }
    persisted = {
        "intrinsic_value_usd": 215.90, "computed_at": "2026-10-21T05:24:44+00:00",
        "validation_status": "valid", "assumptions": {},
    }
    _patch_common(monkeypatch, cached=cached, persisted=persisted, earnings_period="2026-Q3")

    async def _fail_sleep(seconds):
        raise AssertionError("must not sleep/retry on a plain cache hit")
    monkeypatch.setattr(asyncio, "sleep", _fail_sleep)

    import app.services.fundamental_analysis_service as fas
    attempts = {"n": 0}
    def _counting_fundamental(ticker):
        attempts["n"] += 1
        return None
    monkeypatch.setattr(fas, "get_fundamental_analysis", _counting_fundamental)

    result = await screener._company_diagnostic_result("AMZN", "es", "user1", use_ai=True)

    assert attempts["n"] == 0, "a cache hit must never trigger a live rebuild attempt just because _earnings_period differs"
    assert result.get("stale") is not True
    assert result["score"] == 82  # served straight from cache, untouched


@pytest.mark.asyncio
async def test_computed_at_reconciliation_still_forces_a_real_miss(monkeypatch):
    """The OTHER staleness mechanism — the _valuation_computed_at
    reconciliation backstop (2026-10-30, CHTR stale-cache incident) — is
    untouched by the earnings-period relocation above and must still force
    a genuine cache miss (not an immediate return) when Supabase has a
    newer publish than the cached entry's stamp. This is also the case
    PASO 5 calls "publicación de valoración nueva durante un período de
    degradación": even if the live rebuild itself can't complete (no
    provider), the miss still reaches the persisted-valuation fallback with
    the NEW number, never silently re-serving the pre-publish cache."""
    cached = {
        "ticker": "AMZN", "companyName": "Amazon", "score": 60, "scoreLabel": "Mixta",
        "_earnings_period": "2026-Q3",  # matches below — proves reconciliation, not earnings period, drives the miss
        "_schema_version": screener._DIAGNOSTIC_SCHEMA_VERSION,
        "_valuation_computed_at": "2026-11-01T00:00:00+00:00",
    }
    persisted = {
        "intrinsic_value_usd": 300.0, "computed_at": "2026-11-05T00:00:00+00:00",  # newer than the cache's stamp
        "validation_status": "valid", "assumptions": {},
    }
    _patch_common(monkeypatch, cached=cached, persisted=persisted, earnings_period="2026-Q3")

    import app.services.fundamental_analysis_service as fas
    monkeypatch.setattr(fas, "get_fundamental_analysis", lambda ticker: None)

    result = await screener._company_diagnostic_result("AMZN", "es", "user1", use_ai=True)

    # A real miss reached the persisted-valuation fallback with the NEW
    # number ($300), not the stale cached score (60) — the cache being
    # "fresh-looking" on earnings period alone didn't save it.
    assert result["dataAvailability"] == "valuation_only"
    assert result["valuation"]["baseFairValue"] == 300.0


@pytest.mark.asyncio
async def test_cold_redis_with_persisted_snapshot_serves_fast_without_dcf(monkeypatch):
    """PASO 5: 'snapshot persistido y Redis vacío' — a cold public cache
    (Redis miss, e.g. after a restart or a genuine expiry) must not force a
    live DCF rebuild when a complete diagnostic_snapshot already exists in
    Supabase.

    2026-11-10 P0 structural latency fix (CHTR/KO ~9s-forever incident):
    previously the live build was attempted FIRST regardless, and only
    fell through to this snapshot AFTER it failed/timed out — confirmed
    live that under Yahoo's rate-limiting episode, CHTR and KO each paid
    the full ~8s `_LIVE_BUILD_TIMEOUT_S` on EVERY single request, forever,
    because a timed-out attempt never populates the cache either. Now a
    usable snapshot is served directly, with ZERO live-build attempt —
    asserted explicitly below via the call counter."""
    persisted = {
        "intrinsic_value_usd": 70.0, "computed_at": "2026-10-29T00:00:00+00:00",
        "validation_status": "valid", "assumptions": {},
        "diagnostic_snapshot": {
            "companyName": "Omnicom", "ticker": "AMZN", "score": 70,
            "valuation": {"currentPrice": 65.0, "baseFairValue": 70.0},
        },
        "snapshot_schema_version": screener._DIAGNOSTIC_SCHEMA_VERSION,
    }
    _patch_common(monkeypatch, cached=None, persisted=persisted, earnings_period="2026-Q3")

    import app.services.fundamental_analysis_service as fas
    attempts = {"n": 0}
    def _counting_fundamental(ticker):
        attempts["n"] += 1
        return None
    monkeypatch.setattr(fas, "get_fundamental_analysis", _counting_fundamental)

    async def _fail_sleep(seconds):
        raise AssertionError("must not sleep/retry when a usable snapshot short-circuits the live build")
    monkeypatch.setattr(asyncio, "sleep", _fail_sleep)

    result = await screener._company_diagnostic_result("AMZN", "es", "user1", use_ai=True)

    assert result["companyName"] == "Omnicom"
    assert result["score"] == 70
    assert result.get("dataAvailability") != "unavailable"
    assert attempts["n"] == 0, "a usable full snapshot must skip the live rebuild entirely, not just fall back after it fails"


@pytest.mark.asyncio
async def test_old_schema_snapshot_still_attempts_live_build(monkeypatch):
    """The short-circuit only applies to a CURRENT-schema snapshot — a row
    whose snapshot predates _DIAGNOSTIC_SCHEMA_VERSION (or has none at all)
    must still attempt a live build as before; there's nothing fast and
    complete to serve instead."""
    persisted = {
        "intrinsic_value_usd": 70.0, "computed_at": "2026-01-01T00:00:00+00:00",
        "validation_status": "valid", "assumptions": {},
        "diagnostic_snapshot": {"companyName": "Old Co", "ticker": "AMZN", "score": 40},
        "snapshot_schema_version": screener._DIAGNOSTIC_SCHEMA_VERSION - 1,  # stale shape
    }
    _patch_common(monkeypatch, cached=None, persisted=persisted, earnings_period="2026-Q3")

    import app.services.fundamental_analysis_service as fas
    attempts = {"n": 0}
    def _counting_fundamental(ticker):
        attempts["n"] += 1
        return None
    monkeypatch.setattr(fas, "get_fundamental_analysis", _counting_fundamental)

    result = await screener._company_diagnostic_result("AMZN", "es", "user1", use_ai=True)

    assert attempts["n"] == 1, "an old-schema snapshot is not usable and must not short-circuit the live build"
    assert result["dataAvailability"] == "valuation_only"  # falls back to the numeric-only path, not the stale snapshot


@pytest.mark.asyncio
async def test_usable_snapshot_short_circuit_still_respects_fresh_republish(monkeypatch):
    """The short-circuit must not undermine the existing publish-time
    invalidation discipline: `get_persisted_valuation` is always read
    fresh for the CURRENT row on every miss, so a ticker just republished
    (new WACC fix, new recompute) gets its NEW snapshot/number immediately
    — there is no separate, independently-stale copy of 'persisted' that
    this short-circuit could be reading instead."""
    persisted = {
        "intrinsic_value_usd": 1156.84, "computed_at": "2026-11-10T12:00:00+00:00",
        "validation_status": "under_review", "assumptions": {},
        "diagnostic_snapshot": {
            "companyName": "Charter Communications", "ticker": "CHTR", "score": 55,
            "valuation": {"currentPrice": 300.0, "baseFairValue": 1156.84},
        },
        "snapshot_schema_version": screener._DIAGNOSTIC_SCHEMA_VERSION,
    }
    monkeypatch.setattr(screener, "_resolve_quick_ticker", lambda q: "CHTR")
    monkeypatch.setattr(screener, "cache_get", lambda key: None)
    monkeypatch.setattr(screener, "cache_set", lambda *a, **k: None)
    monkeypatch.setattr(screener, "fh_quote", lambda ticker: {"price": 305.0})

    import app.services.company_valuation_service as cvs
    async def _get_persisted(ticker):
        return persisted
    monkeypatch.setattr(cvs, "get_persisted_valuation", _get_persisted)

    import app.services.fundamental_analysis_service as fas
    def _fail(ticker):
        raise AssertionError("must not attempt a live build when the just-republished snapshot is usable")
    monkeypatch.setattr(fas, "get_fundamental_analysis", _fail)

    result = await screener._company_diagnostic_result("CHTR", "es", "user1", use_ai=True)

    assert result["valuation"]["baseFairValue"] == 1156.84
    assert result["validationStatus"] == "under_review"
