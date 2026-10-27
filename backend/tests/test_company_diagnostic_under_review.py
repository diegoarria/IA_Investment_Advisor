"""2026-10-27 — Nuvos Radar reliability-guard closeout (AXON backfill-pilot
audit). The guard (`_anomaly_review_reason`, company_valuation_service.py)
previously only ran on the backfill write path (`company_valuations`) —
this file pins the fix that makes `build_company_diagnostic` (the LIVE
path real users hit on a cache miss) apply the exact same rule, the Redis
cache-shape gate that keeps an old cached diagnostic from bypassing it,
and the corrected margin_of_safety_pct/upside_potential_pct convention."""
import asyncio

import pytest

from app.services.company_diagnostic_service import build_company_diagnostic, _fallback_relative_scenarios
from app.services.company_valuation_service import _anomaly_review_reason
from app.services.valuation.numeric_helpers import calc_margin_of_safety, calc_upside_potential_pct
from app.services.valuation.dcf_engine import mixed_regime_reliability


def _minimal_data(**overrides):
    """A believable but minimal get_fundamental_analysis()-shaped dict —
    sector/industry left None so _find_peers (and therefore any real
    network fetch inside _competitor_comparison/_sector_comparison) never
    fires; those two enrichments are optional/never-blocking by design."""
    base = {
        "company_name": "Axon Enterprise",
        "sector": None,
        "exchange": "NASDAQ",
        "business_quality_score": 80,
        "financial_strength_score": 75,
        "pe_ratio": 90.0,
        "total_debt": 100_000_000,
        "net_cash": 500_000_000,
        "segments": [],
    }
    base.update(overrides)
    return base


def _dcf_with_anchor(reliable: bool, *, base=36.30, current_price=425.87):
    return {
        "current_price": current_price,
        "operating_margin_anchor_reliable": reliable,
        "operating_margin_anchor_warning": None if reliable else (
            "operating_margin_anchor computed from a thin mixed-regime trend — unreliable 10-year anchor"
        ),
        "gqv_fair_value": {
            "status": "ok",
            "scenarios": {
                "bear": {"fair_value_per_share": base * 0.8},
                "base": {"fair_value_per_share": base},
                "bull": {"fair_value_per_share": base * 1.2},
                "current_price": current_price,
                "margin_of_safety_pct": calc_margin_of_safety(base, current_price),
            },
            "uncertainty_profile": {"data_confidence": {"score": 70}},
            "reality_gate": {"pass_rate": 80.0},
            "classification": "Compounder",
            "fair_pe": None,
        },
        "scenarios": None,
        "growth_buildup": {"avg_roic_pct": 15.0},
    }


# ── 1. AXON computed live -> under_review ──────────────────────────────

class TestLiveBuildAppliesReliabilityGuard:
    def test_unreliable_anchor_marks_under_review(self):
        dcf = _dcf_with_anchor(reliable=False)
        result = build_company_diagnostic("AXON", {**_minimal_data(), "dcf": dcf})
        assert result is not None
        assert result["valuation"]["validationStatus"] == "under_review"
        assert "mixed-regime" in result["valuation"]["reviewReason"]
        # Never adjusts the number itself — the real computed base is untouched.
        assert result["valuation"]["baseFairValue"] == 36.30

    def test_reliable_anchor_normal_ticker_stays_valid(self):
        dcf = _dcf_with_anchor(reliable=True, base=180.0, current_price=200.0)
        result = build_company_diagnostic("ADBE", {**_minimal_data(company_name="Adobe"), "dcf": dcf})
        assert result is not None
        assert result["valuation"]["validationStatus"] == "valid"
        assert result["valuation"]["reviewReason"] is None

    def test_extreme_gap_triggers_under_review_even_with_reliable_anchor(self):
        # A reliable anchor can still produce an extreme intrinsic/price
        # ratio (_anomaly_review_reason's second trigger) — the gap itself
        # is the review signal, never proof of error by construction, but
        # it must still route to under_review rather than valid.
        dcf = _dcf_with_anchor(reliable=True, base=10.0, current_price=400.0)
        result = build_company_diagnostic("SYN", {**_minimal_data(company_name="Synthetic Corp"), "dcf": dcf})
        assert result is not None
        assert result["valuation"]["validationStatus"] == "under_review"
        assert "fuera del rango" in result["valuation"]["reviewReason"]


# ── 5. Old cached diagnostic without the new status field -> treated as stale ──

class TestDiagnosticCacheSchemaVersion:
    def test_old_shape_cache_entry_is_rejected_as_a_miss(self, monkeypatch):
        import app.api.routes.screener as screener

        old_cached = {
            "ticker": "AXON", "_earnings_period": "2026-Q3",
            # no "_schema_version" key at all — exactly what every entry
            # written before this fix looks like, given the cache's 2-year TTL.
        }
        monkeypatch.setattr(screener, "cache_get", lambda key: old_cached)

        async def _check():
            cached = screener.cache_get("whatever")
            if cached and cached.get("_schema_version") != screener._DIAGNOSTIC_SCHEMA_VERSION:
                cached = None
            return cached

        assert asyncio.run(_check()) is None

    def test_current_shape_cache_entry_is_accepted(self):
        import app.api.routes.screener as screener

        fresh = {"ticker": "ADBE", "_schema_version": screener._DIAGNOSTIC_SCHEMA_VERSION}
        assert fresh.get("_schema_version") == screener._DIAGNOSTIC_SCHEMA_VERSION


# ── 6/7. Unaffected tickers ──────────────────────────────────────────────

class TestUnaffectedTickers:
    def test_stable_valid_company_unaffected(self):
        assert _anomaly_review_reason({"base": 250.0, "current_price": 220.0}, {"operating_margin_anchor_reliable": True}) is None

    def test_insufficient_data_path_untouched(self):
        dcf = {}  # no dcf block at all
        assert build_company_diagnostic("ZZZ", {**_minimal_data(), "dcf": None}) is None


# ── 8. Non-positive intrinsic value -> no misleading percentage ────────

class TestNonPositiveIntrinsicValue:
    def test_margin_of_safety_none_for_non_positive_intrinsic(self):
        assert calc_margin_of_safety(0, 100) is None
        assert calc_margin_of_safety(-5, 100) is None
        assert calc_margin_of_safety(None, 100) is None

    def test_upside_potential_none_for_non_positive_price(self):
        assert calc_upside_potential_pct(150, 0) is None
        assert calc_upside_potential_pct(150, -1) is None
        assert calc_upside_potential_pct(150, None) is None

    def test_upside_potential_none_for_missing_intrinsic(self):
        assert calc_upside_potential_pct(None, 100) is None


# ── 9. Extreme intrinsic/price gap (synthetic) -> under_review ─────────

class TestAnomalyRatioGuard:
    def test_ratio_far_below_range_triggers_review(self):
        reason = _anomaly_review_reason({"base": 10.0, "current_price": 400.0}, {})
        assert reason is not None and "fuera del rango" in reason

    def test_ratio_far_above_range_triggers_review(self):
        reason = _anomaly_review_reason({"base": 600.0, "current_price": 50.0}, {})
        assert reason is not None

    def test_ratio_within_normal_universe_range_is_fine(self):
        # Real universe tickers sit in the 0.7-0.9x and similar ranges —
        # this must never false-positive on an ordinary gap.
        assert _anomaly_review_reason({"base": 180.0, "current_price": 200.0}, {}) is None


# ── 10. margin_of_safety_pct vs upside_potential_pct correctness ───────

class TestMarginVsUpsideConvention:
    def test_the_150_100_case(self):
        assert calc_margin_of_safety(150, 100) == 33.3
        assert calc_upside_potential_pct(150, 100) == 50.0

    def test_relative_valuation_fallback_uses_correct_convention(self):
        # Pins the fix to the loose, uncommitted edit that had switched
        # _fallback_relative_scenarios to the price-denominator formula
        # under the margin-of-safety name — confirmed root cause of
        # test_builds_band_from_two_real_multiples failing before this fix.
        dcf = {
            "current_price": 14.3,
            "relative_valuation": {
                "intrinsic_value_per_share": 18.0,
                "implied_values_by_multiple": {"ev_sales": 16.0, "p_fcf": 20.0},
                "peer_count": 9,
                "margin_of_safety_pct": calc_margin_of_safety(18.0, 14.3),
            },
        }
        s = _fallback_relative_scenarios(dcf, {})
        assert s["margin_of_safety_pct"] == calc_margin_of_safety(18.0, 14.3)
        assert s["upside_potential_pct"] == calc_upside_potential_pct(18.0, 14.3)
        assert s["margin_of_safety_pct"] != s["upside_potential_pct"]


# ── mixed_regime_reliability sanity (already tested elsewhere for the
# backfill path — pinned here too since build_company_diagnostic now
# shares the exact same call) ───────────────────────────────────────────

class TestMixedRegimeReliabilitySharedAcrossBothPaths:
    def test_axon_like_pattern_is_unreliable(self):
        # Fractions, not percent — mirrors fundamental_analysis_service.py's
        # `m / 100` conversion before this function ever sees the values.
        pairs = [(2021, -0.193), (2022, 0.078), (2023, 0.102), (2024, 0.028), (2025, -0.022)]
        anchor = 0.0181
        assert mixed_regime_reliability(pairs, anchor) is False

    def test_stable_positive_history_is_reliable(self):
        pairs = [(2021, 0.110), (2022, 0.120), (2023, 0.125), (2024, 0.130), (2025, 0.118)]
        assert mixed_regime_reliability(pairs, 0.1206) is True
