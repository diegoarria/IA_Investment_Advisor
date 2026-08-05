"""
Tests — app.services.valuation.confidence_engine (Fase 1, Incremento 5).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md. Key
requirement: when fewer than 2 real cross-method values are available,
`compute_confidence_meter_v2` must produce EXACTLY the same score as the
original `fundamental_analysis_service._confidence_meter` — this is the
"degrades to the original proxy" guarantee that makes the upgrade safe.
"""
import pytest

from app.services.valuation.confidence_engine import (
    compute_cross_method_spread_pct,
    compute_confidence_meter_v2,
)
from app.services.fundamental_analysis_service import _confidence_meter


class TestComputeCrossMethodSpreadPct:
    def test_two_close_values_produce_a_small_spread(self):
        spread = compute_cross_method_spread_pct([100.0, 105.0])
        assert spread == pytest.approx((105 - 100) / statistics_median([100.0, 105.0]) * 100, abs=0.5)

    def test_wide_disagreement_produces_a_large_spread(self):
        spread = compute_cross_method_spread_pct([50.0, 150.0])
        assert spread > 50

    def test_identical_values_produce_zero_spread(self):
        assert compute_cross_method_spread_pct([100.0, 100.0, 100.0]) == 0.0

    def test_fewer_than_2_valid_values_returns_none(self):
        assert compute_cross_method_spread_pct([100.0]) is None
        assert compute_cross_method_spread_pct([]) is None
        assert compute_cross_method_spread_pct([None, None]) is None
        assert compute_cross_method_spread_pct([100.0, None]) is None

    def test_ignores_none_and_non_positive_values(self):
        spread = compute_cross_method_spread_pct([100.0, None, 110.0, -5.0, 0.0])
        assert spread == compute_cross_method_spread_pct([100.0, 110.0])

    def test_spread_is_capped_at_100(self):
        spread = compute_cross_method_spread_pct([1.0, 1000.0])
        assert spread == 100.0


def statistics_median(values):
    import statistics
    return statistics.median(values)


class TestComputeConfidenceMeterV2:
    def test_degrades_exactly_to_v1_when_no_method_values_given(self):
        v1 = _confidence_meter(
            predictability_score=75, years_available=8,
            fair_value_range={"base": 100, "low": 80, "high": 120}, liquidity_ok=True,
            business_quality_score=70, financial_strength_score=65,
        )
        v2 = compute_confidence_meter_v2(
            predictability_score=75, years_available=8,
            fair_value_range={"base": 100, "low": 80, "high": 120}, liquidity_ok=True,
            business_quality_score=70, financial_strength_score=65,
            method_values=None,
        )
        assert v2["score"] == v1["score"]
        assert v2["label"] == v1["label"]
        assert v2["stars"] == v1["stars"]
        assert v2["dispersion_source"] == "scenario_range_proxy"

    def test_degrades_exactly_to_v1_when_fewer_than_2_real_method_values(self):
        v1 = _confidence_meter(
            predictability_score=60, years_available=5,
            fair_value_range={"base": 50, "low": 40, "high": 65}, liquidity_ok=False,
        )
        v2 = compute_confidence_meter_v2(
            predictability_score=60, years_available=5,
            fair_value_range={"base": 50, "low": 40, "high": 65}, liquidity_ok=False,
            method_values=[50.0, None],  # only one real value
        )
        assert v2["score"] == v1["score"]
        assert v2["dispersion_source"] == "scenario_range_proxy"

    def test_uses_real_cross_method_spread_when_available(self):
        result = compute_confidence_meter_v2(
            predictability_score=75, years_available=8,
            fair_value_range={"base": 100, "low": 80, "high": 120}, liquidity_ok=True,
            business_quality_score=70, financial_strength_score=65,
            method_values=[100.0, 102.0, 98.0],  # tight real agreement
        )
        assert result["dispersion_source"] == "cross_method"

    def test_tighter_real_agreement_yields_higher_score_than_wider_proxy_spread(self):
        # Same base inputs, but the scenario-range proxy implies a WIDE
        # (40%) spread while the real cross-method values agree tightly —
        # v2 should score higher than what the proxy alone would have given.
        fair_value_range = {"base": 100, "low": 70, "high": 110}  # (110-70)/100 = 40% dispersion via proxy
        v1_like = compute_confidence_meter_v2(
            predictability_score=75, years_available=8,
            fair_value_range=fair_value_range, liquidity_ok=True,
            method_values=None,
        )
        v2_real_agreement = compute_confidence_meter_v2(
            predictability_score=75, years_available=8,
            fair_value_range=fair_value_range, liquidity_ok=True,
            method_values=[100.0, 101.0, 99.0],  # real spread ~2%, much tighter than the 40% proxy
        )
        assert v2_real_agreement["score"] > v1_like["score"]

    def test_returns_none_when_predictability_score_missing(self):
        assert compute_confidence_meter_v2(None, 8, {}, True) is None

    def test_score_bounds_and_stars_stay_within_original_ranges(self):
        result = compute_confidence_meter_v2(
            predictability_score=95, years_available=10,
            fair_value_range={"base": 100, "low": 95, "high": 105}, liquidity_ok=True,
            business_quality_score=95, financial_strength_score=95,
            method_values=[100.0, 100.5, 99.5],
        )
        assert 0 <= result["score"] <= 100
        assert 1 <= result["stars"] <= 5
