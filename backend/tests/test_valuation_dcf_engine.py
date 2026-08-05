"""
Tests — app.services.valuation.dcf_engine (Fase 1, Incremento 2).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md for the
full context: this is the new driver-based DCF (Revenue -> Operating
Margin -> EBIT -> NOPAT -> Reinvestment -> FCF), built alongside — not yet
replacing — the existing `fundamental_analysis_service._run_dcf`.
"""
import pytest

from app.services.valuation.dcf_engine import (
    is_reit_sector,
    recency_weighted_average,
    project_driver_based_dcf,
    select_discount_rate,
    compute_reinvestment_rate_anchor,
    DriverBasedDcfResult,
)
from app.services.valuation.robustness import UnstableGordonGrowthError


class TestIsReitSector:
    def test_matches_reit_industry_strings(self):
        assert is_reit_sector("REIT - Retail") is True
        assert is_reit_sector("REIT - Residential") is True
        assert is_reit_sector("reit - specialty") is True

    def test_does_not_match_plain_real_estate_services(self):
        # deliberately narrower than "real estate" — a real-estate broker
        # or services company has a normal operating FCF, unlike a REIT
        assert is_reit_sector("Real Estate Services") is False
        assert is_reit_sector("Real Estate - Development") is False

    def test_none_or_empty_is_false(self):
        assert is_reit_sector(None) is False
        assert is_reit_sector("") is False


class TestRecencyWeightedAverage:
    def test_weights_recent_values_more_heavily(self):
        # oldest=0.10 (weight 1), newest=0.30 (weight 2) -> (1*0.10 + 2*0.30)/3
        result = recency_weighted_average([(0, 0.10), (1, 0.30)])
        assert result == pytest.approx((1 * 0.10 + 2 * 0.30) / 3)

    def test_empty_list_returns_none(self):
        assert recency_weighted_average([]) is None

    def test_single_value_returns_that_value(self):
        assert recency_weighted_average([(5, 0.42)]) == pytest.approx(0.42)

    def test_non_contiguous_indices_still_weight_correctly(self):
        # skipping index 1 (missing data) - weights should still be index+1,
        # not renumbered sequentially
        result = recency_weighted_average([(0, 0.10), (2, 0.30)])
        assert result == pytest.approx((1 * 0.10 + 3 * 0.30) / 4)


class TestComputeReinvestmentRateAnchor:
    def test_clamps_extreme_values(self):
        assert compute_reinvestment_rate_anchor([(0, 5.0), (1, 5.0)]) == pytest.approx(1.5)
        assert compute_reinvestment_rate_anchor([(0, -2.0), (1, -2.0)]) == pytest.approx(-0.5)

    def test_normal_value_passes_through(self):
        assert compute_reinvestment_rate_anchor([(0, 0.30), (1, 0.35)]) == pytest.approx(
            recency_weighted_average([(0, 0.30), (1, 0.35)])
        )

    def test_empty_returns_none(self):
        assert compute_reinvestment_rate_anchor([]) is None


class TestSelectDiscountRate:
    def test_defaults_to_wacc(self):
        rate, source = select_discount_rate(wacc=0.09, required_return=0.12, use_required_return=False)
        assert rate == 0.09
        assert source == "wacc"

    def test_uses_required_return_when_requested(self):
        rate, source = select_discount_rate(wacc=0.09, required_return=0.12, use_required_return=True)
        assert rate == 0.12
        assert source == "required_return"

    def test_never_blends_the_two(self):
        rate, _ = select_discount_rate(wacc=0.09, required_return=0.20, use_required_return=True)
        assert rate not in (pytest.approx((0.09 + 0.20) / 2),)
        assert rate == 0.20

    def test_raises_if_required_return_requested_but_missing(self):
        with pytest.raises(ValueError):
            select_discount_rate(wacc=0.09, required_return=None, use_required_return=True)


class TestProjectDriverBasedDcf:
    def _base_kwargs(self, **overrides):
        kwargs = dict(
            revenue_0=10_000.0,
            revenue_growth_1=0.12,
            terminal_growth=0.025,
            operating_margin_anchor_pct=0.25,
            terminal_operating_margin_pct=0.22,
            tax_rate=0.21,
            reinvestment_rate_anchor_pct=0.30,
            terminal_roic_pct=0.15,
            discount_rate=0.09,
        )
        kwargs.update(overrides)
        return kwargs

    def test_produces_10_years_by_default(self):
        result = project_driver_based_dcf(**self._base_kwargs())
        assert len(result.yearly) == 10
        assert isinstance(result, DriverBasedDcfResult)

    def test_waterfall_is_internally_consistent_every_year(self):
        result = project_driver_based_dcf(**self._base_kwargs())
        for row in result.yearly:
            assert row.ebit == pytest.approx(row.revenue * row.operating_margin_pct / 100, rel=0.01)
            assert row.nopat == pytest.approx(row.ebit * (1 - row.tax_rate_pct / 100), rel=0.01)
            assert row.fcf == pytest.approx(row.nopat - row.reinvestment, rel=0.01)

    def test_revenue_compounds_forward_each_year(self):
        result = project_driver_based_dcf(**self._base_kwargs())
        revs = [row.revenue for row in result.yearly]
        assert all(revs[i] < revs[i + 1] for i in range(len(revs) - 1))  # positive growth throughout

    def test_terminal_reinvestment_rate_matches_damodaran_identity(self):
        result = project_driver_based_dcf(**self._base_kwargs(terminal_growth=0.03, terminal_roic_pct=0.15))
        expected_terminal_rr = 0.03 / 0.15
        assert result.assumptions["terminal_reinvestment_rate_pct"] == pytest.approx(expected_terminal_rr * 100, abs=0.01)
        # final year's reinvestment rate should be close to (though not
        # exactly, since fade only reaches gt/ROIC precisely AT yr==years)
        # the terminal reinvestment rate
        final_rr = result.yearly[-1].reinvestment_rate_pct
        assert final_rr == pytest.approx(expected_terminal_rr * 100, abs=0.1)

    def test_enterprise_value_equals_pv_sum_plus_pv_terminal(self):
        result = project_driver_based_dcf(**self._base_kwargs())
        assert result.enterprise_value == pytest.approx(
            result.pv_of_fcf_sum + result.pv_of_terminal_value, abs=1
        )

    def test_computes_equity_value_and_per_share_when_given_net_cash_and_shares(self):
        result = project_driver_based_dcf(**self._base_kwargs(net_cash=500.0, shares_out=100.0))
        assert result.equity_value == pytest.approx(result.enterprise_value + 500.0, abs=1)
        assert result.value_per_share == pytest.approx(result.equity_value / 100.0, abs=0.01)

    def test_omits_per_share_value_when_shares_not_given(self):
        result = project_driver_based_dcf(**self._base_kwargs(net_cash=500.0))
        assert result.value_per_share is None

    def test_omits_per_share_value_when_shares_are_zero(self):
        result = project_driver_based_dcf(**self._base_kwargs(net_cash=500.0, shares_out=0.0))
        assert result.value_per_share is None

    def test_raises_unstable_gordon_growth_when_discount_rate_too_close_to_terminal_growth(self):
        with pytest.raises(UnstableGordonGrowthError):
            project_driver_based_dcf(**self._base_kwargs(discount_rate=0.03, terminal_growth=0.03))

    def test_raises_when_terminal_roic_not_positive(self):
        with pytest.raises(ValueError):
            project_driver_based_dcf(**self._base_kwargs(terminal_roic_pct=0.0))
        with pytest.raises(ValueError):
            project_driver_based_dcf(**self._base_kwargs(terminal_roic_pct=-0.05))

    def test_raises_when_revenue_0_not_positive(self):
        with pytest.raises(ValueError):
            project_driver_based_dcf(**self._base_kwargs(revenue_0=0.0))
        with pytest.raises(ValueError):
            project_driver_based_dcf(**self._base_kwargs(revenue_0=-1000.0))

    def test_higher_discount_rate_reduces_enterprise_value(self):
        low = project_driver_based_dcf(**self._base_kwargs(discount_rate=0.08))
        high = project_driver_based_dcf(**self._base_kwargs(discount_rate=0.14))
        assert high.enterprise_value < low.enterprise_value

    def test_higher_operating_margin_increases_enterprise_value(self):
        low = project_driver_based_dcf(**self._base_kwargs(
            operating_margin_anchor_pct=0.15, terminal_operating_margin_pct=0.15,
        ))
        high = project_driver_based_dcf(**self._base_kwargs(
            operating_margin_anchor_pct=0.35, terminal_operating_margin_pct=0.35,
        ))
        assert high.enterprise_value > low.enterprise_value

    def test_assumptions_dict_round_trips_key_inputs(self):
        result = project_driver_based_dcf(**self._base_kwargs())
        assert result.assumptions["discount_rate_pct"] == pytest.approx(9.0)
        assert result.assumptions["terminal_growth_pct"] == pytest.approx(2.5)
        assert result.assumptions["revenue_growth_1_pct"] == pytest.approx(12.0)
