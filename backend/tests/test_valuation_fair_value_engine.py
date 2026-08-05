"""
Tests — app.services.valuation.fair_value_engine (Fase 1, Incremento 6).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
import pytest

from app.services.valuation.fair_value_engine import (
    sector_base_multiple,
    compute_justified_multiple,
    compute_fair_value,
    _MULTIPLE_LO,
    _MULTIPLE_HI,
    _DEFAULT_BASE_PE,
)


class TestSectorBaseMultiple:
    def test_matches_by_substring(self):
        assert sector_base_multiple("Consumer Electronics - Technology") == sector_base_multiple("Technology")

    def test_defaults_when_no_match(self):
        assert sector_base_multiple("Totally Unknown Sector") == _DEFAULT_BASE_PE
        assert sector_base_multiple(None) == _DEFAULT_BASE_PE

    def test_bank_and_financial_services_differ(self):
        # banks get a slightly more conservative base than general financial services
        assert sector_base_multiple("Banks - Regional") < sector_base_multiple("Technology")


class TestComputeJustifiedMultiple:
    def _neutral_kwargs(self, **overrides):
        kwargs = dict(
            sector="Technology",
            expected_eps_growth_pct=5.0,   # exactly the baseline -> zero growth adjustment
            roic_pct=9.0, cost_of_capital_pct=9.0,  # zero spread -> zero quality adjustment
            fcf_margin_pct=10.0,           # exactly the baseline -> zero fcf adjustment
            net_debt_to_ebitda=1.0,        # under the 2.0x threshold -> zero penalty
            interest_coverage=10.0,        # above the 5x threshold -> zero penalty
            dividend_yield_pct=None,
            moat_score=50.0, management_score=50.0,  # exactly neutral
        )
        kwargs.update(overrides)
        return kwargs

    def test_neutral_inputs_produce_exactly_the_sector_base(self):
        result = compute_justified_multiple(**self._neutral_kwargs())
        assert result.justified_multiple == pytest.approx(sector_base_multiple("Technology"))
        assert all(a.points == 0.0 for a in result.adjustments)

    def test_high_growth_increases_the_multiple(self):
        low = compute_justified_multiple(**self._neutral_kwargs(expected_eps_growth_pct=5.0))
        high = compute_justified_multiple(**self._neutral_kwargs(expected_eps_growth_pct=25.0))
        assert high.justified_multiple > low.justified_multiple

    def test_negative_growth_decreases_the_multiple(self):
        result = compute_justified_multiple(**self._neutral_kwargs(expected_eps_growth_pct=-10.0))
        assert result.justified_multiple < sector_base_multiple("Technology")

    def test_growth_adjustment_is_bounded(self):
        result = compute_justified_multiple(**self._neutral_kwargs(expected_eps_growth_pct=500.0))
        growth_adj = next(a for a in result.adjustments if a.factor == "growth")
        assert growth_adj.points == 10.0  # capped

    def test_high_roic_spread_increases_multiple(self):
        result = compute_justified_multiple(**self._neutral_kwargs(roic_pct=30.0, cost_of_capital_pct=9.0))
        quality_adj = next(a for a in result.adjustments if a.factor == "quality")
        assert quality_adj.points > 0

    def test_roic_below_cost_of_capital_decreases_multiple(self):
        result = compute_justified_multiple(**self._neutral_kwargs(roic_pct=3.0, cost_of_capital_pct=9.0))
        quality_adj = next(a for a in result.adjustments if a.factor == "quality")
        assert quality_adj.points < 0

    def test_high_leverage_penalizes_multiple(self):
        result = compute_justified_multiple(**self._neutral_kwargs(net_debt_to_ebitda=6.0))
        leverage_adj = next(a for a in result.adjustments if a.factor == "leverage")
        assert leverage_adj.points < 0

    def test_low_interest_coverage_penalizes_multiple(self):
        result = compute_justified_multiple(**self._neutral_kwargs(interest_coverage=1.5))
        leverage_adj = next(a for a in result.adjustments if a.factor == "leverage")
        assert leverage_adj.points < 0

    def test_leverage_never_rewards_low_debt(self):
        result = compute_justified_multiple(**self._neutral_kwargs(net_debt_to_ebitda=-2.0, interest_coverage=50.0))
        leverage_adj = next(a for a in result.adjustments if a.factor == "leverage")
        assert leverage_adj.points == 0.0

    def test_dividend_adds_a_small_capped_premium(self):
        result = compute_justified_multiple(**self._neutral_kwargs(dividend_yield_pct=3.0))
        div_adj = next(a for a in result.adjustments if a.factor == "dividend")
        assert 0 < div_adj.points <= 2.0

    def test_dividend_is_capped_for_extreme_yields(self):
        result = compute_justified_multiple(**self._neutral_kwargs(dividend_yield_pct=50.0))
        div_adj = next(a for a in result.adjustments if a.factor == "dividend")
        assert div_adj.points == 2.0

    def test_high_moat_and_management_scores_increase_multiple(self):
        result = compute_justified_multiple(**self._neutral_kwargs(moat_score=95.0, management_score=95.0))
        mm_adj = next(a for a in result.adjustments if a.factor == "moat_management")
        assert mm_adj.points > 0

    def test_low_moat_and_management_scores_decrease_multiple(self):
        result = compute_justified_multiple(**self._neutral_kwargs(moat_score=5.0, management_score=5.0))
        mm_adj = next(a for a in result.adjustments if a.factor == "moat_management")
        assert mm_adj.points < 0

    def test_final_multiple_is_bounded_even_with_extreme_inputs(self):
        result = compute_justified_multiple(
            sector="Technology", expected_eps_growth_pct=500.0, roic_pct=200.0, cost_of_capital_pct=1.0,
            fcf_margin_pct=90.0, net_debt_to_ebitda=0.0, interest_coverage=100.0,
            dividend_yield_pct=10.0, moat_score=100.0, management_score=100.0,
        )
        assert _MULTIPLE_LO <= result.justified_multiple <= _MULTIPLE_HI

    def test_final_multiple_never_goes_below_floor_with_terrible_inputs(self):
        result = compute_justified_multiple(
            sector="Technology", expected_eps_growth_pct=-90.0, roic_pct=-50.0, cost_of_capital_pct=15.0,
            fcf_margin_pct=-50.0, net_debt_to_ebitda=20.0, interest_coverage=0.1,
            dividend_yield_pct=None, moat_score=0.0, management_score=0.0,
        )
        assert result.justified_multiple == _MULTIPLE_LO

    def test_missing_all_optional_inputs_returns_just_the_sector_base(self):
        result = compute_justified_multiple(
            sector="Technology", expected_eps_growth_pct=None, roic_pct=None, cost_of_capital_pct=None,
            fcf_margin_pct=None, net_debt_to_ebitda=None, interest_coverage=None,
            dividend_yield_pct=None, moat_score=None, management_score=None,
        )
        assert result.justified_multiple == pytest.approx(sector_base_multiple("Technology"))
        assert all(a.points == 0.0 for a in result.adjustments)

    def test_every_adjustment_has_a_real_reason_string(self):
        result = compute_justified_multiple(**self._neutral_kwargs())
        assert all(a.reason and len(a.reason) > 0 for a in result.adjustments)


class TestComputeFairValue:
    def test_multiplies_eps_by_multiple(self):
        assert compute_fair_value(eps=5.0, justified_multiple=20.0) == 100.0

    def test_returns_none_for_zero_eps(self):
        assert compute_fair_value(eps=0.0, justified_multiple=20.0) is None

    def test_returns_none_for_negative_eps(self):
        assert compute_fair_value(eps=-2.0, justified_multiple=20.0) is None

    def test_returns_none_for_missing_eps(self):
        assert compute_fair_value(eps=None, justified_multiple=20.0) is None
