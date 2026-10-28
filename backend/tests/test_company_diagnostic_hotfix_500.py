"""2026-10-28 P0 hotfix: confirmed live in production — a 10-request burst
against AAPL/MSFT/GOOGL/TSLA/JPM/V/HD got a ~50% hit rate of a fast (<1s)
generic `{"detail":"Internal server error"}` 500, despite AAPL having a
perfectly good `valid` persisted row the whole time. Root cause:
get_fundamental_analysis's call site inside _attempt_build was the ONLY
step in the live-rebuild path not wrapped in try/except (build_company_
diagnostic right below it already was) — under concurrent production
load it can raise instead of just running slow, and that exception was
propagating all the way to main.py's generic exception handler instead
of degrading to the persisted/cache fallback. This is what turned AAPL
into the user-visible "Valoración no disponible" / "Error 404 (unknown)"
screenshot — not a missing valuation, not a 404 at all, but an
unguarded 500.

Minimal, isolated hotfix cherry-picked onto the currently-deployed
commit (cc334dc7) — does NOT include the separate, not-yet-approved
8s-timeout/has_persisted_fallback-widening work (local-only, pending
review)."""
import asyncio

import pytest

import app.api.routes.screener as screener


def _patch_common(monkeypatch, *, persisted=None):
    monkeypatch.setattr(screener, "_resolve_quick_ticker", lambda q: "AAPL")
    monkeypatch.setattr(screener, "cache_get", lambda key: None)
    monkeypatch.setattr(screener, "cache_set", lambda *a, **k: None)
    monkeypatch.setattr(screener, "fh_quote", lambda ticker: {"price": 230.0})
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
async def test_get_fundamental_analysis_raising_degrades_to_persisted_fallback_instead_of_500(monkeypatch):
    persisted = {
        "intrinsic_value_usd": 230.0, "validation_status": "valid",
        "computed_at": "2026-10-28T00:00:00+00:00", "assumptions": {"bear": 200.0, "bull": 260.0},
    }
    _patch_common(monkeypatch, persisted=persisted)

    import app.services.fundamental_analysis_service as fas
    def _raises(ticker):
        raise RuntimeError("simulated shared-pool/provider-client exception under concurrent load")
    monkeypatch.setattr(fas, "get_fundamental_analysis", _raises)

    # Before this fix, the exception above propagated all the way out of
    # _company_diagnostic_result uncaught — this call itself (not raising)
    # is the core assertion.
    result = await screener._company_diagnostic_result("AAPL", "es", "user1", use_ai=True)

    assert result is not None
    assert result["dataAvailability"] == "valuation_only"
    assert result["valuation"]["baseFairValue"] == 230.0


@pytest.mark.asyncio
async def test_get_fundamental_analysis_raising_with_no_persisted_fallback_is_still_honest(monkeypatch):
    _patch_common(monkeypatch, persisted=None)

    import app.services.fundamental_analysis_service as fas
    def _raises(ticker):
        raise RuntimeError("simulated transient provider failure")
    monkeypatch.setattr(fas, "get_fundamental_analysis", _raises)

    async def _no_sleep(seconds):
        pass
    monkeypatch.setattr(asyncio, "sleep", _no_sleep)

    result = await asyncio.wait_for(
        screener._company_diagnostic_result("AAPL", "es", "user1", use_ai=True),
        timeout=5.0,
    )

    assert result is not None
    assert result["dataAvailability"] == "unavailable"
