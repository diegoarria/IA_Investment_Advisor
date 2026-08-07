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
        assert result.assumptions["high_growth_years"] == 0

    def test_gordon_mode_assumptions_declare_the_method_and_no_exit_multiple(self):
        result = project_driver_based_dcf(**self._base_kwargs())
        assert result.assumptions["terminal_value_method"] == "gordon"
        assert result.assumptions["exit_multiple"] is None
        assert result.assumptions["exit_metric"] is None
        assert result.assumptions["gordon_terminal_value"] is None
        assert result.assumptions["gordon_sanity_check_ratio"] is None


class TestHybridExitMultipleTerminalValue:
    """Nuvos AI Fair Value Engine redesign, Incremento 2 — see
    /Users/diegoarria/.claude/plans/stateful-painting-flurry.md."""

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

    def test_no_regression_when_exit_multiple_omitted(self):
        # Zero-behavior-change guarantee: identical inputs, with vs. without
        # the new (defaulted) params, must produce IDENTICAL results.
        a = project_driver_based_dcf(**self._base_kwargs())
        b = project_driver_based_dcf(**self._base_kwargs(exit_multiple=None, exit_metric=None))
        assert a.enterprise_value == b.enterprise_value
        assert a.terminal_value == b.terminal_value
        assert a.assumptions == b.assumptions

    def test_raises_when_exit_multiple_given_without_a_valid_metric(self):
        with pytest.raises(ValueError):
            project_driver_based_dcf(**self._base_kwargs(exit_multiple=15.0, exit_metric=None))
        with pytest.raises(ValueError):
            project_driver_based_dcf(**self._base_kwargs(exit_multiple=15.0, exit_metric="p_e"))

    def test_exit_multiple_terminal_value_uses_year_n_metric(self):
        result = project_driver_based_dcf(**self._base_kwargs(exit_multiple=15.0, exit_metric="ev_ebit"))
        final_ebit = result.yearly[-1].ebit
        assert result.terminal_value == pytest.approx(15.0 * final_ebit, abs=1)
        assert result.assumptions["terminal_value_method"] == "exit_multiple"
        assert result.assumptions["exit_multiple"] == 15.0
        assert result.assumptions["exit_metric"] == "ev_ebit"

    def test_each_exit_metric_reads_the_matching_year_n_field(self):
        # Multiple picked per metric to stay within _GORDON_SANITY_BAND for
        # each one's very different natural scale (revenue >> EBIT > FCF) —
        # a flat 10x across all three would get clamped for ev_sales here,
        # which would test the clamp, not "did it read the right field".
        for metric, field_name, multiple in [("ev_sales", "revenue", 3.0), ("ev_ebit", "ebit", 10.0), ("ev_fcf", "fcf", 15.0)]:
            result = project_driver_based_dcf(**self._base_kwargs(exit_multiple=multiple, exit_metric=metric))
            expected = getattr(result.yearly[-1], field_name)
            assert result.terminal_value == pytest.approx(multiple * expected, abs=1)

    def test_monotonic_in_exit_multiple(self):
        low = project_driver_based_dcf(**self._base_kwargs(exit_multiple=8.0, exit_metric="ev_ebit"))
        high = project_driver_based_dcf(**self._base_kwargs(exit_multiple=20.0, exit_metric="ev_ebit"))
        assert high.enterprise_value > low.enterprise_value

    def test_gordon_sanity_check_present_when_gordon_has_a_valid_solution(self):
        result = project_driver_based_dcf(**self._base_kwargs(exit_multiple=15.0, exit_metric="ev_ebit"))
        assert result.assumptions["gordon_terminal_value"] is not None
        assert result.assumptions["gordon_sanity_check_ratio"] is not None
        expected_gordon = result.yearly[-1].fcf * 1.025 / (0.09 - 0.025)
        assert result.assumptions["gordon_terminal_value"] == pytest.approx(expected_gordon, abs=1)

    def test_never_raises_when_discount_rate_too_close_to_terminal_growth(self):
        # The exact input combination that raises UnstableGordonGrowthError
        # in Gordon-only mode (see TestProjectDriverBasedDcf above) must
        # instead return a real valuation in exit-multiple mode, with the
        # Gordon sanity check simply unavailable.
        result = project_driver_based_dcf(
            **self._base_kwargs(discount_rate=0.03, terminal_growth=0.03, exit_multiple=15.0, exit_metric="ev_ebit"),
        )
        assert result.enterprise_value is not None
        assert result.assumptions["gordon_terminal_value"] is None
        assert result.assumptions["gordon_sanity_check_ratio"] is None

    def test_extreme_exit_multiple_is_clamped_to_the_gordon_sanity_band(self):
        # Incremento 17 (calibration fix) — an unrealistically large exit
        # multiple (e.g. a premium mega-cap trading multiple bridged onto
        # a modest terminal growth rate) must not be allowed to imply a
        # terminal value arbitrarily larger than what this SAME run's own
        # Gordon Growth perpetuity would justify.
        huge = project_driver_based_dcf(**self._base_kwargs(exit_multiple=1000.0, exit_metric="ev_ebit"))
        gordon = huge.assumptions["gordon_terminal_value"]
        assert huge.terminal_value == pytest.approx(gordon * 2.5, rel=0.01)
        assert huge.assumptions["gordon_sanity_check_ratio"] == pytest.approx(2.5, abs=0.01)

    def test_extreme_low_exit_multiple_is_clamped_to_the_gordon_sanity_band(self):
        tiny = project_driver_based_dcf(**self._base_kwargs(exit_multiple=0.01, exit_metric="ev_ebit"))
        gordon = tiny.assumptions["gordon_terminal_value"]
        assert tiny.terminal_value == pytest.approx(gordon * 0.5, rel=0.01)
        assert tiny.assumptions["gordon_sanity_check_ratio"] == pytest.approx(0.5, abs=0.01)

    def test_exit_multiple_within_band_is_not_clamped(self):
        # A multiple that already produces a sane ratio (~1.4x Gordon here,
        # from test_gordon_sanity_check_present_when_gordon_has_a_valid_
        # solution's own 15x ev_ebit case) passes through unmodified.
        result = project_driver_based_dcf(**self._base_kwargs(exit_multiple=15.0, exit_metric="ev_ebit"))
        expected_raw = 15.0 * result.yearly[-1].ebit
        assert result.terminal_value == pytest.approx(expected_raw, abs=1)

    def test_terminal_roic_still_required_positive_in_exit_multiple_mode(self):
        # Still governs the reinvestment-rate fade, independent of which
        # terminal-value formula is used for the final year's metric.
        with pytest.raises(ValueError):
            project_driver_based_dcf(**self._base_kwargs(terminal_roic_pct=0.0, exit_multiple=15.0, exit_metric="ev_ebit"))

    def test_implied_fcf_margin_year_n_is_a_derived_output_not_an_input(self):
        result = project_driver_based_dcf(**self._base_kwargs(exit_multiple=15.0, exit_metric="ev_ebit"))
        final_row = result.yearly[-1]
        expected = round(final_row.fcf / final_row.revenue * 100, 2)
        assert result.assumptions["implied_fcf_margin_pct_year_n"] == pytest.approx(expected)


class TestThreeStageGrowthPlateau:
    """Fase 1.5, Incremento 1 — the high_growth_years plateau."""

    def _base_kwargs(self, **overrides):
        kwargs = dict(
            revenue_0=10_000.0,
            revenue_growth_1=0.20,
            terminal_growth=0.03,
            operating_margin_anchor_pct=0.25,
            terminal_operating_margin_pct=0.22,
            tax_rate=0.21,
            reinvestment_rate_anchor_pct=0.30,
            terminal_roic_pct=0.15,
            discount_rate=0.10,
        )
        kwargs.update(overrides)
        return kwargs

    def test_default_high_growth_years_matches_explicit_zero(self):
        default = project_driver_based_dcf(**self._base_kwargs())
        explicit_zero = project_driver_based_dcf(**self._base_kwargs(high_growth_years=0))
        assert [r.revenue_growth_pct for r in default.yearly] == [r.revenue_growth_pct for r in explicit_zero.yearly]
        assert default.enterprise_value == explicit_zero.enterprise_value

    def test_plateau_years_hold_growth_flat_at_year_1_rate(self):
        result = project_driver_based_dcf(**self._base_kwargs(high_growth_years=3))
        for row in result.yearly[:3]:
            assert row.revenue_growth_pct == pytest.approx(20.0)

    def test_fade_begins_immediately_after_the_plateau(self):
        result = project_driver_based_dcf(**self._base_kwargs(high_growth_years=3))
        # year 4 is the first faded year — strictly below the plateau rate, strictly above terminal
        assert result.yearly[3].revenue_growth_pct < 20.0
        assert result.yearly[3].revenue_growth_pct > 3.0

    def test_final_year_growth_still_reaches_terminal_growth(self):
        result = project_driver_based_dcf(**self._base_kwargs(high_growth_years=4))
        assert result.yearly[-1].revenue_growth_pct == pytest.approx(3.0, abs=0.01)

    def test_longer_plateau_yields_higher_enterprise_value(self):
        short_plateau = project_driver_based_dcf(**self._base_kwargs(high_growth_years=1))
        long_plateau = project_driver_based_dcf(**self._base_kwargs(high_growth_years=6))
        assert long_plateau.enterprise_value > short_plateau.enterprise_value

    def test_assumptions_dict_exposes_high_growth_years(self):
        result = project_driver_based_dcf(**self._base_kwargs(high_growth_years=5))
        assert result.assumptions["high_growth_years"] == 5

    def test_raises_when_high_growth_years_negative(self):
        with pytest.raises(ValueError):
            project_driver_based_dcf(**self._base_kwargs(high_growth_years=-1))

    def test_raises_when_high_growth_years_equals_or_exceeds_years(self):
        with pytest.raises(ValueError):
            project_driver_based_dcf(**self._base_kwargs(high_growth_years=10))
        with pytest.raises(ValueError):
            project_driver_based_dcf(**self._base_kwargs(high_growth_years=15))

    def test_operating_margin_unaffected_by_plateau(self):
        """Only revenue growth plateaus — operating margin keeps its plain two-stage fade."""
        no_plateau = project_driver_based_dcf(**self._base_kwargs(high_growth_years=0))
        with_plateau = project_driver_based_dcf(**self._base_kwargs(high_growth_years=4))
        assert [r.operating_margin_pct for r in no_plateau.yearly] == [r.operating_margin_pct for r in with_plateau.yearly]
