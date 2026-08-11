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
    compute_confidence_meter_v3,
    compute_confidence_meter_v4,
    compute_financial_statement_quality_score,
    compute_management_consistency_score,
    _confidence_meter,
)


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
        assert v2["dispersion_source"] == "bear_bull_dispersion"

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
        assert v2["dispersion_source"] == "bear_bull_dispersion"

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


# Fase 1.5, Incremento 18 — Confidence Engine 2.0.

class TestComputeFinancialStatementQualityScore:
    def test_perfect_score_when_no_years_flagged(self):
        assert compute_financial_statement_quality_score([]) == 100.0

    def test_penalizes_each_flagged_year(self):
        assert compute_financial_statement_quality_score(["2022"]) == 75.0
        assert compute_financial_statement_quality_score(["2021", "2022"]) == 50.0

    def test_floored_at_20_even_with_many_flagged_years(self):
        assert compute_financial_statement_quality_score(["2019", "2020", "2021", "2022", "2023"]) == 20.0


class TestComputeManagementConsistencyScore:
    def test_blends_both_signals_when_both_available(self):
        score = compute_management_consistency_score(80.0, 60.0)
        assert score == pytest.approx(70.0)

    def test_renormalizes_over_whichever_signal_is_present(self):
        assert compute_management_consistency_score(80.0, None) == pytest.approx(80.0)
        assert compute_management_consistency_score(None, 60.0) == pytest.approx(60.0)

    def test_none_when_neither_signal_available(self):
        assert compute_management_consistency_score(None, None) is None


class TestComputeConfidenceMeterV3:
    def test_degrades_to_v2_score_when_new_signals_are_none(self):
        # With financial_statement_quality_score/management_consistency_score
        # both None, weighted_mean renormalizes over the same 6 v2 components
        # (with v3's slightly different base weights) — this pins that v3
        # still produces a real, sane score in that degraded case, not that
        # it's bit-identical to v2 (the weights were deliberately rebalanced).
        result = compute_confidence_meter_v3(
            predictability_score=75, years_available=8,
            fair_value_range={"base": 100, "low": 80, "high": 120}, liquidity_ok=True,
            business_quality_score=70, financial_strength_score=65,
            method_values=[100.0, 102.0, 98.0],
            financial_statement_quality_score=None, management_consistency_score=None,
        )
        assert result is not None
        assert 0 <= result["score"] <= 100
        assert result["dispersion_source"] == "cross_method"

    def test_a_flagged_financial_statement_lowers_the_score(self):
        base_kwargs = dict(
            predictability_score=75, years_available=8,
            fair_value_range={"base": 100, "low": 80, "high": 120}, liquidity_ok=True,
            business_quality_score=70, financial_strength_score=65,
        )
        clean = compute_confidence_meter_v3(**base_kwargs, financial_statement_quality_score=100.0, management_consistency_score=80.0)
        flagged = compute_confidence_meter_v3(**base_kwargs, financial_statement_quality_score=20.0, management_consistency_score=80.0)
        assert flagged["score"] < clean["score"]

    def test_returns_none_when_predictability_score_missing(self):
        assert compute_confidence_meter_v3(None, 8, {}, True) is None

    def test_score_bounds_and_stars_stay_within_range(self):
        result = compute_confidence_meter_v3(
            predictability_score=95, years_available=10,
            fair_value_range={"base": 100, "low": 95, "high": 105}, liquidity_ok=True,
            business_quality_score=95, financial_strength_score=95,
            financial_statement_quality_score=100.0, management_consistency_score=90.0,
        )
        assert 0 <= result["score"] <= 100
        assert 1 <= result["stars"] <= 5


class TestComputeConfidenceMeterV4:
    """Nuvos Fair Value Engine rearchitecture (plan §13) — additive superset
    of v3. See /Users/diegoarria/.claude/plans/cosmic-munching-crown.md."""

    def _base_kwargs(self, **overrides):
        kwargs = dict(
            predictability_score=75, years_available=8,
            fair_value_range={"base": 100, "low": 80, "high": 120}, liquidity_ok=True,
            business_quality_score=70, financial_strength_score=65,
            financial_statement_quality_score=100.0, management_consistency_score=80.0,
        )
        kwargs.update(overrides)
        return kwargs

    def test_returns_none_when_predictability_score_missing(self):
        assert compute_confidence_meter_v4(None, 8, {}, True) is None

    def test_works_with_no_new_signals_at_all_renormalizing_over_v3_only(self):
        result = compute_confidence_meter_v4(**self._base_kwargs())
        assert result is not None
        assert 0 <= result["score"] <= 100

    def test_reality_gate_full_pass_scores_higher_than_partial_pass(self):
        full_pass = compute_confidence_meter_v4(**self._base_kwargs(reality_gate_pass_rate=100.0))
        partial_pass = compute_confidence_meter_v4(**self._base_kwargs(reality_gate_pass_rate=40.0))
        assert full_pass["score"] > partial_pass["score"]

    def test_unexplained_divergence_lowers_score_but_never_zeroes_it(self):
        explained = compute_confidence_meter_v4(**self._base_kwargs(divergence_explained=True))
        unexplained = compute_confidence_meter_v4(**self._base_kwargs(divergence_explained=False))
        assert unexplained["score"] < explained["score"]
        assert unexplained["score"] > 0  # floored at 40, not 0 — one signal can't zero out confidence

    def test_low_classification_confidence_lowers_the_score(self):
        clean = compute_confidence_meter_v4(**self._base_kwargs(classification_confidence=90.0))
        murky = compute_confidence_meter_v4(**self._base_kwargs(classification_confidence=20.0))
        assert murky["score"] < clean["score"]

    def test_low_provenance_completeness_lowers_the_score(self):
        complete = compute_confidence_meter_v4(**self._base_kwargs(provenance_completeness=100.0))
        incomplete = compute_confidence_meter_v4(**self._base_kwargs(provenance_completeness=30.0))
        assert incomplete["score"] < complete["score"]

    def test_score_and_stars_stay_within_range_with_every_signal_present(self):
        result = compute_confidence_meter_v4(**self._base_kwargs(
            classification_confidence=80.0, provenance_completeness=95.0,
            divergence_explained=True, reality_gate_pass_rate=90.0,
        ))
        assert 0 <= result["score"] <= 100
        assert 1 <= result["stars"] <= 5
