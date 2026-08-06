"""
Tests — app.services.valuation.assumptions_engine (Nuvos AI Fair Value
Engine redesign, Incremento 4).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
import pytest

from app.services.valuation.assumptions_engine import compute_weighted_assumption, _WEIGHTS


class TestWeights:
    def test_four_weights_sum_to_one(self):
        assert sum(_WEIGHTS.values()) == pytest.approx(1.0)

    def test_matches_the_confirmed_30_25_25_20_split(self):
        assert _WEIGHTS["historical"] == pytest.approx(0.30)
        assert _WEIGHTS["industry"] == pytest.approx(0.25)
        assert _WEIGHTS["wall_street"] == pytest.approx(0.25)
        assert _WEIGHTS["business_quality"] == pytest.approx(0.20)


class TestComputeWeightedAssumption:
    def test_blends_all_four_real_values(self):
        result = compute_weighted_assumption(
            dimension="revenue_growth_1",
            historical_value_pct=10.0, industry_value_pct=8.0,
            wall_street_value_pct=12.0, business_quality_value_pct=14.0,
        )
        expected = 10.0 * 0.30 + 8.0 * 0.25 + 12.0 * 0.25 + 14.0 * 0.20
        assert result.blended_value_pct == pytest.approx(expected, abs=0.01)
        assert result.dimension == "revenue_growth_1"

    def test_all_four_factors_present_with_reasons(self):
        result = compute_weighted_assumption(
            dimension="revenue_growth_1",
            historical_value_pct=10.0, industry_value_pct=8.0,
            wall_street_value_pct=12.0, business_quality_value_pct=14.0,
        )
        assert len(result.factors) == 4
        names = {f.name for f in result.factors}
        assert names == {"historical", "industry", "wall_street", "business_quality"}
        for f in result.factors:
            assert f.reason
            assert f.value == f.score

    def test_industry_and_wall_street_move_the_result_more_than_2pp(self):
        # The exact structural difference from growth_engine.py (bounded to
        # +-2.0pp regardless of input magnitude): here, real industry/Wall
        # Street divergence from the historical value must be able to move
        # the blended result by MORE than 2pp — proof this isn't just
        # growth_engine.py renamed.
        historical_only = compute_weighted_assumption(
            dimension="revenue_growth_1",
            historical_value_pct=10.0, industry_value_pct=None,
            wall_street_value_pct=None, business_quality_value_pct=None,
        )
        with_divergent_signals = compute_weighted_assumption(
            dimension="revenue_growth_1",
            historical_value_pct=10.0, industry_value_pct=30.0,
            wall_street_value_pct=30.0, business_quality_value_pct=30.0,
        )
        assert with_divergent_signals.blended_value_pct - historical_only.blended_value_pct > 2.0

    def test_renormalizes_when_wall_street_missing(self):
        result = compute_weighted_assumption(
            dimension="revenue_growth_1",
            historical_value_pct=10.0, industry_value_pct=8.0,
            wall_street_value_pct=None, business_quality_value_pct=14.0,
        )
        expected = (10.0 * 0.30 + 8.0 * 0.25 + 14.0 * 0.20) / (0.30 + 0.25 + 0.20)
        assert result.blended_value_pct == pytest.approx(expected, abs=0.01)

    def test_returns_none_when_no_signals_available_at_all(self):
        result = compute_weighted_assumption(
            dimension="revenue_growth_1",
            historical_value_pct=None, industry_value_pct=None,
            wall_street_value_pct=None, business_quality_value_pct=None,
        )
        assert result.blended_value_pct is None
        assert result.has_any_signal is False

    def test_has_any_signal_true_with_at_least_one_real_value(self):
        result = compute_weighted_assumption(
            dimension="revenue_growth_1",
            historical_value_pct=10.0, industry_value_pct=None,
            wall_street_value_pct=None, business_quality_value_pct=None,
        )
        assert result.has_any_signal is True
        assert result.blended_value_pct == pytest.approx(10.0)

    def test_custom_reason_overrides_default(self):
        result = compute_weighted_assumption(
            dimension="revenue_growth_1",
            historical_value_pct=10.0, industry_value_pct=None,
            wall_street_value_pct=None, business_quality_value_pct=None,
            historical_reason="Razón personalizada.",
        )
        historical_factor = next(f for f in result.factors if f.name == "historical")
        assert historical_factor.reason == "Razón personalizada."

    def test_works_for_a_different_dimension_label(self):
        # Dimension-agnostic — same mechanism for margin/ROIC, not just growth.
        result = compute_weighted_assumption(
            dimension="terminal_operating_margin",
            historical_value_pct=25.0, industry_value_pct=22.0,
            wall_street_value_pct=None, business_quality_value_pct=28.0,
        )
        assert result.dimension == "terminal_operating_margin"
        assert result.blended_value_pct is not None
