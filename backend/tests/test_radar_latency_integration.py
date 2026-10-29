"""2026-10-29: manual integration of the cold-open-latency fix (formerly
commit 5ffc1e7e) onto the currently-deployed line (3 hotfixes + the
full-snapshot commit 2f226c5c). Covers what that integration actually
changed:
  1. _LIVE_BUILD_TIMEOUT_S hard-caps BOTH get_fundamental_analysis and
     build_company_diagnostic — a genuinely hanging (not just slow) call
     must not block the request past the cap, and must not raise past it
     either (confirmed this doesn't collide with the 3 hotfixes' own
     try/except around the same call sites).
  2. has_persisted_fallback widened from "only a `valid` row" to "any
     current row at all" — a `insufficient_data` row (e.g. DLR) must now
     skip the live retry+2.5s-backoff entirely, not just a `valid` one.
  3. _degraded_diagnostic's is_presentable (valid OR under_review) still
     distinguishes correctly from is_valid, and the new upsidePotentialPercent/
     validationStatus/reviewReason fields are present on the degraded path.
"""
import asyncio

import pytest

import app.api.routes.screener as screener


def _patch_common(monkeypatch, *, persisted=None):
    monkeypatch.setattr(screener, "_resolve_quick_ticker", lambda q: "DLR")
    monkeypatch.setattr(screener, "cache_get", lambda key: None)
    monkeypatch.setattr(screener, "cache_set", lambda *a, **k: None)
    monkeypatch.setattr(screener, "fh_quote", lambda ticker: {"price": 179.0})
    monkeypatch.setattr(screener, "_latest_reported_earnings_period", lambda ticker: "2026-Q3")

    import app.services.company_valuation_service as cvs
    async def _get_persisted(ticker):
        return persisted
    monkeypatch.setattr(cvs, "get_persisted_valuation", _get_persisted)

    import app.services.ai_service as ai_service
    async def _narrative(**kwargs):
        return None
    monkeypatch.setattr(ai_service, "generate_company_diagnostic_narrative", _narrative)


@pytest.mark.asyncio
async def test_hard_timeout_abandons_a_genuinely_hanging_fundamental_analysis_call(monkeypatch):
    """A call that would hang indefinitely (not just run slow) must still
    return control to the caller within _LIVE_BUILD_TIMEOUT_S, degrading
    to the insufficient_data fallback rather than hanging the request."""
    persisted = {
        "intrinsic_value_usd": None, "validation_status": "insufficient_data",
        "computed_at": "2026-10-28T00:00:00+00:00", "assumptions": {},
        "error_detail": "REIT — excluded from DCF",
    }
    _patch_common(monkeypatch, persisted=persisted)
    monkeypatch.setattr(screener, "_LIVE_BUILD_TIMEOUT_S", 0.05)

    import app.services.fundamental_analysis_service as fas
    import time
    def _hangs(ticker):
        time.sleep(10)  # genuinely blocking — would hang this test for 10s if not capped
        return {"ok": True}
    monkeypatch.setattr(fas, "get_fundamental_analysis", _hangs)

    result = await asyncio.wait_for(
        screener._company_diagnostic_result("DLR", "es", "user1", use_ai=True),
        timeout=3.0,  # proves the request itself returned well under the real 10s hang
    )

    # insufficient_data has no intrinsic value to show — correctly 'unavailable',
    # not a fabricated number. The point of this test is the *timing*: the
    # request returned in well under 3s despite the mock blocking for 10s.
    assert result is not None
    assert result["dataAvailability"] == "unavailable"


@pytest.mark.asyncio
async def test_insufficient_data_row_skips_retry_not_only_valid_rows(monkeypatch):
    """Before this integration, has_fresh_persisted only recognized
    `valid` — an insufficient_data row (DLR's real case) fell through
    into a full live retry + 2.5s backoff on every single open. Confirm
    the widened has_persisted_fallback now short-circuits for
    insufficient_data too, without ever calling asyncio.sleep."""
    persisted = {
        "intrinsic_value_usd": None, "validation_status": "insufficient_data",
        "computed_at": "2026-10-28T00:00:00+00:00", "assumptions": {},
        "error_detail": "REIT — excluded from DCF",
    }
    _patch_common(monkeypatch, persisted=persisted)

    import app.services.fundamental_analysis_service as fas
    def _returns_none(ticker):
        return None
    monkeypatch.setattr(fas, "get_fundamental_analysis", _returns_none)

    slept = {"called": False}
    async def _tracking_sleep(seconds):
        slept["called"] = True
    monkeypatch.setattr(asyncio, "sleep", _tracking_sleep)

    result = await screener._company_diagnostic_result("DLR", "es", "user1", use_ai=True)

    assert slept["called"] is False, "retry backoff should never fire when a persisted row already exists"
    # insufficient_data has no number to show (correctly 'unavailable'), but
    # the key assertion is slept["called"] is False above — the fix is that
    # this no longer burns the 2.5s retry+backoff before reaching here.
    assert result["dataAvailability"] == "unavailable"


@pytest.mark.asyncio
async def test_under_review_row_is_presentable_with_reason_on_degraded_path(monkeypatch):
    """_degraded_diagnostic's is_presentable (valid OR under_review) must
    still correctly distinguish from is_valid — an under_review row (no
    matching full snapshot) carries its real reviewReason through instead
    of degrading to generic 'unavailable'."""
    persisted = {
        "intrinsic_value_usd": 36.3, "validation_status": "under_review",
        "computed_at": "2026-10-27T00:00:00+00:00",
        "assumptions": {"bear": 30.0, "bull": 42.0},
        "error_detail": "operating_margin_anchor computed from a thin mixed-regime trend",
        # no diagnostic_snapshot / snapshot_schema_version — forces the cut-down path
    }
    result = await screener._degraded_diagnostic("AXON", "es", persisted)

    assert result["dataAvailability"] == "valuation_only"
    assert result["valuation"]["validationStatus"] == "under_review"
    assert result["valuation"]["reviewReason"] == "operating_margin_anchor computed from a thin mixed-regime trend"
    assert result["valuation"]["upsidePotentialPercent"] is not None


@pytest.mark.asyncio
async def test_insufficient_data_with_no_intrinsic_value_degrades_cleanly_not_crash(monkeypatch):
    """insufficient_data is NOT in is_presentable (only valid/under_review
    are — there's no number at all to show) — must degrade cleanly to
    'unavailable', never crash on a None intrinsic_value_usd."""
    persisted = {
        "intrinsic_value_usd": None, "validation_status": "insufficient_data",
        "computed_at": "2026-10-28T00:00:00+00:00", "assumptions": {},
        "error_detail": "REIT — excluded from DCF",
    }
    result = await screener._degraded_diagnostic("DLR", "es", persisted)

    assert result["dataAvailability"] == "unavailable"
    assert result["valuation"] is None


@pytest.mark.asyncio
async def test_no_persisted_row_at_all_is_unavailable_not_presentable(monkeypatch):
    result = await screener._degraded_diagnostic("ZZZZ_NEVER_SEEN", "es", None)
    assert result["dataAvailability"] == "unavailable"
    assert result["valuation"] is None
