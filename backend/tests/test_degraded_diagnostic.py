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


# ─── migration 117: full diagnostic snapshot ────────────────────────────

def _full_snapshot():
    return {
        "ticker": "AAPL", "companyName": "Apple Inc", "sector": "Technology", "exchange": "NASDAQ",
        "score": 78, "scoreLabel": "+ Descuento", "pillarScores": {"value": 80},
        "badges": ["Descuento Significativo"], "oneLinerPitch": "Apple Inc — + Descuento.",
        "investmentThesis": "...", "competitorComparison": {"rows": []},
        "sectorComparison": {"sector": "Technology", "rows": []},
        "valuation": {
            "conservative": 197.16, "baseFairValue": 263.70, "optimistic": 295.46,
            "currentPrice": 180.0, "marginOfSafetyPercent": 31.7,
            "peCurrent": 28.4, "fairPeBreakdown": {"note": "real"},
        },
    }


def test_snapshot_served_without_recomputation(monkeypatch):
    persisted = {
        "intrinsic_value_usd": 263.70, "computed_at": "2026-10-29T10:00:00+00:00",
        "validation_status": "valid", "assumptions": {},
        "diagnostic_snapshot": _full_snapshot(), "snapshot_schema_version": screener._DIAGNOSTIC_SCHEMA_VERSION,
    }
    monkeypatch.setattr(screener, "fh_quote", lambda ticker: {"price": 339.50})

    result = _run(screener._degraded_diagnostic("AAPL", "es", persisted))

    # The rich fields a cut-down fallback could never have — proves the
    # snapshot, not the base reconstruction, was served. `score` itself is
    # intentionally recomputed from the fresh price by
    # _apply_live_quote_diagnostic (same mos-consistency rule as any other
    # cache hit), so it's not asserted here — only the fields that rule
    # doesn't touch.
    assert result["competitorComparison"] == {"rows": []}
    assert result["sectorComparison"]["sector"] == "Technology"
    assert result["valuation"]["peCurrent"] == 28.4
    assert result["valuation"]["fairPeBreakdown"] == {"note": "real"}
    # Price still freshened from the live quote, same as any cache hit.
    assert result["valuation"]["currentPrice"] == 339.50
    assert result["valuationAsOf"] == persisted["computed_at"]
    assert result["validationStatus"] == "valid"


def test_snapshot_ignored_when_schema_version_stale(monkeypatch):
    persisted = {
        "intrinsic_value_usd": 263.70, "computed_at": "2026-10-20T22:11:33+00:00",
        "validation_status": "valid", "assumptions": {"bear": 197.16, "bull": 295.46},
        "diagnostic_snapshot": _full_snapshot(), "snapshot_schema_version": screener._DIAGNOSTIC_SCHEMA_VERSION - 1,
    }
    monkeypatch.setattr(screener, "fh_quote", lambda ticker: {"price": 339.50})

    result = _run(screener._degraded_diagnostic("AAPL", "es", persisted))

    # Falls through to the pre-existing cut-down reconstruction, not the
    # stale-schema snapshot — same behavior as before migration 117.
    assert result["score"] is None
    assert result["dataAvailability"] == "valuation_only"


def test_missing_snapshot_falls_back_to_cut_down_reconstruction(monkeypatch):
    persisted = {
        "intrinsic_value_usd": 263.70, "computed_at": "2026-10-20T22:11:33+00:00",
        "validation_status": "valid", "assumptions": {"bear": 197.16, "bull": 295.46},
        "diagnostic_snapshot": None, "snapshot_schema_version": None,
    }
    monkeypatch.setattr(screener, "fh_quote", lambda ticker: {"price": 339.50})

    result = _run(screener._degraded_diagnostic("AAPL", "es", persisted))

    assert result["dataAvailability"] == "valuation_only"
    assert result["score"] is None


def test_snapshot_reports_current_review_status_even_if_snapshot_was_valid(monkeypatch):
    # The row has since been reclassified under_review by a later backfill
    # pass (e.g. the AXON case) after an earlier visit persisted a 'valid'
    # snapshot — the response must reflect the CURRENT status, never the
    # stale status baked into the old snapshot.
    persisted = {
        "intrinsic_value_usd": 36.30, "computed_at": "2026-10-29T10:00:00+00:00",
        "validation_status": "under_review", "error_detail": "thin mixed-regime operating-margin anchor",
        "assumptions": {},
        "diagnostic_snapshot": _full_snapshot(), "snapshot_schema_version": screener._DIAGNOSTIC_SCHEMA_VERSION,
    }
    monkeypatch.setattr(screener, "fh_quote", lambda ticker: {"price": 425.87})

    result = _run(screener._degraded_diagnostic("AXON", "es", persisted))

    assert result["validationStatus"] == "under_review"
    assert result["reviewReason"] == "thin mixed-regime operating-margin anchor"
