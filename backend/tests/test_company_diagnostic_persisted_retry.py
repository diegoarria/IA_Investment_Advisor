"""
2026-11-11 P0 (CHTR/guest "unavailable" incident): `get_persisted_
valuation`'s single Supabase read at the top of `_company_diagnostic_
result` is itself guarded against transient connection errors (it
already retries internally via run_query, then returns None as a last
resort — see its own docstring, confirmed live 2026-10-28 for NVDA/AAPL).
But until this fix, if THAT single top-level read came back None during
a transient contention window, `persisted` stayed None for the rest of
the request — even though the row (and its full snapshot) was genuinely
there the whole time, a few seconds later. Reproduced live for CHTR
during a 50-ticker backfill batch's heavy concurrent Supabase writes:
the guest endpoint burned ~18.5s on two failed live-rebuild attempts
(Yahoo rate-limited) and then showed "unavailable" for a ticker with a
perfectly good persisted under_review snapshot the entire time.

These tests simulate the read recovering on a later attempt (a stateful
mock returning None once, then a real row) and confirm the request now
serves the recovered row instead of either paying for a second costly
live-rebuild attempt, or showing "unavailable" when the row was there
the whole time.
"""
import asyncio

import pytest

import app.api.routes.screener as screener


def _patch_common(monkeypatch, *, cached=None, persisted_sequence=(None,), fundamental_data="FAIL"):
    """persisted_sequence is consumed one call at a time by get_persisted_
    valuation; the last value repeats once the sequence is exhausted."""
    monkeypatch.setattr(screener, "_resolve_quick_ticker", lambda q: "CHTR")
    monkeypatch.setattr(screener, "cache_get", lambda key: cached)
    monkeypatch.setattr(screener, "cache_set", lambda *a, **k: None)
    monkeypatch.setattr(screener, "fh_quote", lambda ticker: {"price": 133.82})

    calls = {"n": 0}

    import app.services.company_valuation_service as cvs
    async def _get_persisted(ticker):
        idx = min(calls["n"], len(persisted_sequence) - 1)
        calls["n"] += 1
        return persisted_sequence[idx]
    monkeypatch.setattr(cvs, "get_persisted_valuation", _get_persisted)

    import app.services.fundamental_analysis_service as fas
    def _get_fundamental(ticker):
        return None if fundamental_data == "FAIL" else fundamental_data
    monkeypatch.setattr(fas, "get_fundamental_analysis", _get_fundamental)

    import app.services.company_diagnostic_service as cds
    def _build(ticker, data, lang):
        return None
    monkeypatch.setattr(cds, "build_company_diagnostic", _build)

    import app.services.ai_service as ai_service
    async def _narrative(**kwargs):
        return None
    monkeypatch.setattr(ai_service, "generate_company_diagnostic_narrative", _narrative)

    return calls


_CHTR_ROW = {
    "ticker": "CHTR", "intrinsic_value_usd": 1156.84,
    "computed_at": "2026-10-30T03:52:11+00:00",
    "validation_status": "under_review", "error_detail": "intrinsic/price ratio 10.613x fuera del rango esperado",
    "assumptions": {"bear": 576.75, "bull": 1870.03},
    "diagnostic_snapshot": {
        "_schema_version": screener._DIAGNOSTIC_SCHEMA_VERSION,
        "ticker": "CHTR", "companyName": "Charter Communications", "score": 66,
        "valuation": {"baseFairValue": 1156.84},
    },
    "snapshot_schema_version": screener._DIAGNOSTIC_SCHEMA_VERSION,
}


@pytest.mark.asyncio
async def test_persisted_read_recovers_on_retry_check_avoids_second_live_attempt(monkeypatch):
    """First read (before the live attempt) transiently fails -> None.
    Second read (right after the first failed live attempt, before the
    2.5s sleep + second attempt) recovers -> the real CHTR row. Must serve
    it immediately, WITHOUT sleeping or burning a second live-build call."""
    _patch_common(monkeypatch, persisted_sequence=(None, _CHTR_ROW))

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

    result = await screener._company_diagnostic_result("CHTR", "es", None, use_ai=False)

    assert result["score"] == 66
    assert result["valuation"]["baseFairValue"] == 1156.84
    assert result["validationStatus"] == "under_review"
    assert attempts["n"] == 1, "must not burn a second live-build attempt once the persisted re-check recovers"
    assert sleeps["n"] == 0, "must not wait out the 2.5s backoff once the persisted re-check recovers"


@pytest.mark.asyncio
async def test_persisted_read_recovers_only_on_final_check_still_avoids_unavailable(monkeypatch):
    """Both the initial read AND the post-first-attempt re-check come back
    None (contention hasn't cleared yet) -> retries the live build once as
    before -> but the FINAL re-check (right before giving up and showing
    'unavailable') recovers. Must serve the recovered row, not 'unavailable'."""
    _patch_common(monkeypatch, persisted_sequence=(None, None, _CHTR_ROW))

    sleeps = {"n": 0}
    async def _counting_sleep(seconds):
        sleeps["n"] += 1
    monkeypatch.setattr(asyncio, "sleep", _counting_sleep)

    result = await screener._company_diagnostic_result("CHTR", "es", None, use_ai=False)

    assert "dataAvailability" not in result or result.get("dataAvailability") != "unavailable"
    assert result["score"] == 66
    assert result["validationStatus"] == "under_review"
    assert sleeps["n"] == 1, "the single existing 2.5s backoff before the second live attempt is unchanged"


@pytest.mark.asyncio
async def test_persisted_stays_down_the_whole_request_still_shows_unavailable(monkeypatch):
    """Regression guard: if the persisted read NEVER recovers (genuine
    outage, not a transient blip), the existing 'unavailable' behavior for
    a ticker with truly no data anywhere must be unchanged — no infinite
    retries, no fabricated data."""
    _patch_common(monkeypatch, persisted_sequence=(None,))

    attempts = {"n": 0}
    async def _counting_fundamental(ticker):
        attempts["n"] += 1
        return None

    import app.services.fundamental_analysis_service as fas
    monkeypatch.setattr(fas, "get_fundamental_analysis", lambda ticker: (attempts.__setitem__("n", attempts["n"] + 1), None)[1])

    result = await screener._company_diagnostic_result("CHTR", "es", None, use_ai=False)

    assert result["dataAvailability"] == "unavailable"
    assert result["valuation"] is None


@pytest.mark.asyncio
async def test_guest_and_authenticated_paths_share_the_same_recovery_behavior(monkeypatch):
    """The fix lives in the SHARED _company_diagnostic_result — confirm a
    guest call (user_id=None, use_ai=False) and an authenticated call
    (real user_id, use_ai=True) both benefit identically; this was never a
    guest-specific code path, just a timing coincidence of which request
    happened to land inside the transient-contention window."""
    _patch_common(monkeypatch, persisted_sequence=(None, _CHTR_ROW))
    guest_result = await screener._company_diagnostic_result("CHTR", "es", None, use_ai=False)

    _patch_common(monkeypatch, persisted_sequence=(None, _CHTR_ROW))
    auth_result = await screener._company_diagnostic_result("CHTR", "es", "real-user-123", use_ai=True)

    assert guest_result["valuation"]["baseFairValue"] == auth_result["valuation"]["baseFairValue"] == 1156.84
    assert guest_result["validationStatus"] == auth_result["validationStatus"] == "under_review"
