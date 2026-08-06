"""
Tests — app.services.valuation.growth_engine (Fase 1.5, Incremento 8).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
import pytest

from app.services.valuation.growth_engine import compute_weighted_growth, GrowthEngineResult
from app.services.quality.moat_engine import compute_moat_score, MoatScoreResult
from app.services.quality.deterioration_engine import compute_deterioration_signals, DeteriorationResult


def _strong_moat_result() -> MoatScoreResult:
    roic_trend = [18.0, 19.0, 21.0, 22.0, 24.0, 25.0, 27.0]
    om_trend = [20.0, 20.5, 21.0, 21.5, 22.0, 22.5, 23.0]
    return compute_moat_score(
        avg_roic_pct=22.0, roic_trend=roic_trend, avg_operating_margin_pct=21.5, operating_margin_trend=om_trend,
        gross_margin_latest_pct=55.0, industry_median_roic_pct=None, industry_median_operating_margin_pct=None,
    )


def _improving_deterioration_result() -> DeteriorationResult:
    return compute_deterioration_signals(
        roic_trend=[18.0, 19.0, 21.0, 22.0, 24.0, 25.0, 27.0],
        operating_margin_trend=[20.0, 20.5, 21.0, 21.5, 22.0, 22.5, 23.0],
        net_margin_trend=[12.0, 12.5, 13.0, 13.5, 14.0, 14.5, 15.0],
        fcf_margin_trend=[10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0],
        revenue_trend=[1000, 1100, 1250, 1400, 1600, 1850, 2100],
    )


def _deteriorating_moat_result() -> MoatScoreResult:
    roic_trend = [30.0, 28.0, 25.0, 22.0, 18.0, 15.0, 12.0]
    om_trend = [25.0, 24.0, 22.0, 20.0, 18.0, 16.0, 14.0]
    return compute_moat_score(
        avg_roic_pct=21.4, roic_trend=roic_trend, avg_operating_margin_pct=19.9, operating_margin_trend=om_trend,
        gross_margin_latest_pct=40.0, industry_median_roic_pct=None, industry_median_operating_margin_pct=None,
    )


def _deteriorating_deterioration_result() -> DeteriorationResult:
    return compute_deterioration_signals(
        roic_trend=[30.0, 28.0, 25.0, 22.0, 18.0, 15.0, 12.0],
        operating_margin_trend=[25.0, 24.0, 22.0, 20.0, 18.0, 16.0, 14.0],
        net_margin_trend=[15.0, 14.0, 13.0, 12.0, 10.0, 9.0, 7.0],
        fcf_margin_trend=[20.0, 19.0, 17.0, 15.0, 13.0, 11.0, 9.0],
        revenue_trend=[2000, 2100, 2050, 2000, 1900, 1850, 1800],
    )


class TestComputeWeightedGrowthStrongCompany:
    def _result(self, **overrides) -> GrowthEngineResult:
        kwargs = dict(
            historical_growth_pct=0.14,
            cagr_windows={"3y": 18.2, "5y": 15.0, "10y": 12.1},
            avg_roic_pct=22.0,
            incremental_roic_pct=26.0,
            moat_result=_strong_moat_result(),
            deterioration_result=_improving_deterioration_result(),
            capital_allocation_score=70,
            industry_median_revenue_cagr_pct=9.0,
        )
        kwargs.update(overrides)
        return compute_weighted_growth(**kwargs)

    def test_positive_adjustment_for_accelerating_improving_company(self):
        result = self._result()
        assert result.total_adjustment_pct > 0
        assert result.quality_adjusted_growth_pct > result.historical_growth_pct / 100

    def test_adjustment_never_exceeds_the_cap(self):
        # Even with every signal maxed out, |adjustment| <= 2.0pp.
        result = self._result()
        assert abs(result.total_adjustment_pct) <= 2.0

    def test_historical_growth_pct_round_trips(self):
        result = self._result()
        assert result.historical_growth_pct == pytest.approx(14.0)

    def test_all_six_factors_present(self):
        result = self._result()
        names = {f.name for f in result.factors}
        assert names == {
            "recent_growth_trend", "incremental_roic_vs_average", "moat_stability",
            "deterioration_direction", "capital_allocation", "industry_growth_comparison",
        }

    def test_has_any_signal_true(self):
        assert self._result().has_any_signal is True


class TestComputeWeightedGrowthDeterioratingCompany:
    def _result(self, **overrides) -> GrowthEngineResult:
        kwargs = dict(
            historical_growth_pct=0.02,
            cagr_windows={"3y": -3.5, "5y": 0.5, "10y": 2.0},
            avg_roic_pct=21.4,
            incremental_roic_pct=8.0,
            moat_result=_deteriorating_moat_result(),
            deterioration_result=_deteriorating_deterioration_result(),
        )
        kwargs.update(overrides)
        return compute_weighted_growth(**kwargs)

    def test_negative_adjustment_for_decelerating_deteriorating_company(self):
        # This is the exact behavior the removed moat_adjustment could
        # never produce (it was strictly additive) — real evidence of
        # deterioration must be able to pull the growth estimate DOWN.
        result = self._result()
        assert result.total_adjustment_pct < 0
        assert result.quality_adjusted_growth_pct < result.historical_growth_pct / 100

    def test_never_goes_negative_even_with_a_large_downward_adjustment(self):
        result = self._result(historical_growth_pct=0.001)
        assert result.quality_adjusted_growth_pct >= 0.0

    def test_missing_optional_signals_degrade_gracefully(self):
        result = self._result()  # capital_allocation/industry omitted
        by_name = {f.name: f for f in result.factors}
        assert by_name["capital_allocation"].score is None
        assert by_name["industry_growth_comparison"].score is None
        # the blend still produces a real result from the remaining signals
        assert result.has_any_signal is True


class TestComputeWeightedGrowthMissingData:
    def test_returns_unadjusted_growth_when_no_signals_available_at_all(self):
        empty_moat = compute_moat_score(
            avg_roic_pct=None, roic_trend=[], avg_operating_margin_pct=None, operating_margin_trend=[],
            gross_margin_latest_pct=None, industry_median_roic_pct=None, industry_median_operating_margin_pct=None,
        )
        empty_deterioration = compute_deterioration_signals(
            roic_trend=[], operating_margin_trend=[], net_margin_trend=[], fcf_margin_trend=[], revenue_trend=[],
        )
        result = compute_weighted_growth(
            historical_growth_pct=0.10,
            cagr_windows={},
            avg_roic_pct=None,
            incremental_roic_pct=None,
            moat_result=empty_moat,
            deterioration_result=empty_deterioration,
        )
        assert result.total_adjustment_pct == 0.0
        assert result.quality_adjusted_growth_pct == pytest.approx(0.10)
        assert result.has_any_signal is False

    def test_incremental_roic_factor_none_when_either_input_missing(self):
        result = compute_weighted_growth(
            historical_growth_pct=0.10, cagr_windows={}, avg_roic_pct=None, incremental_roic_pct=15.0,
            moat_result=_strong_moat_result(), deterioration_result=_improving_deterioration_result(),
        )
        by_name = {f.name: f for f in result.factors}
        assert by_name["incremental_roic_vs_average"].score is None


class TestOutputIsReadyForDcfEngine:
    def test_quality_adjusted_growth_pct_is_a_decimal_not_a_percentage(self):
        # 14% historical growth with a small positive adjustment should
        # stay well under 1.0 (i.e. it's 0.15-ish, not 15.0) — this is what
        # feeds directly into dcf_engine.project_driver_based_dcf's
        # revenue_growth_1.
        result = compute_weighted_growth(
            historical_growth_pct=0.14, cagr_windows={"3y": 18.2, "10y": 12.1},
            avg_roic_pct=22.0, incremental_roic_pct=26.0,
            moat_result=_strong_moat_result(), deterioration_result=_improving_deterioration_result(),
        )
        assert 0.0 < result.quality_adjusted_growth_pct < 1.0
