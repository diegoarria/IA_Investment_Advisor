"""
Tests — app.services.valuation.nuvos_engine.scenarios.

See /Users/diegoarria/.claude/plans/cosmic-munching-crown.md.
"""
from app.services.valuation.nuvos_engine.fair_pe import FairPEResult
from app.services.valuation.nuvos_engine.scenarios import build_scenarios


def _fair_pe_result(fair_pe=20.0, band=(15.0, 25.0)):
    return FairPEResult(fair_pe=fair_pe, band=band, primary_anchor="growth_based", factors=[], adjustments=[])


class TestBuildScenarios:
    def test_no_normalized_eps_returns_none_never_fabricates_a_base_case(self):
        assert build_scenarios(normalized_eps_base=None, fair_pe_result=_fair_pe_result(), current_price=100.0) is None
        assert build_scenarios(normalized_eps_base=-1.0, fair_pe_result=_fair_pe_result(), current_price=100.0) is None

    def test_base_case_is_eps_times_fair_pe(self):
        result = build_scenarios(normalized_eps_base=5.0, fair_pe_result=_fair_pe_result(fair_pe=20.0), current_price=100.0)
        assert result.base.fair_value_per_share == 100.0

    def test_bear_never_exceeds_base_and_bull_never_falls_below_it(self):
        # Deliberately degenerate band (single-anchor case) to stress the
        # explicit ordering guard.
        result = build_scenarios(normalized_eps_base=5.0, fair_pe_result=_fair_pe_result(fair_pe=20.0, band=(20.0, 20.0)), current_price=100.0)
        assert result.bear.fair_value_per_share <= result.base.fair_value_per_share
        assert result.bull.fair_value_per_share >= result.base.fair_value_per_share

    def test_real_analyst_eps_range_is_used_over_the_fallback_spread(self):
        result = build_scenarios(
            normalized_eps_base=5.0, fair_pe_result=_fair_pe_result(), current_price=100.0,
            eps_low=4.0, eps_high=7.0,
        )
        assert result.bear.eps == 4.0
        assert result.bull.eps == 7.0

    def test_inverted_real_range_is_corrected_not_left_broken(self):
        result = build_scenarios(
            normalized_eps_base=5.0, fair_pe_result=_fair_pe_result(), current_price=100.0,
            eps_low=7.0, eps_high=4.0,  # anomalous inverted input
        )
        assert result.bear.eps <= result.bull.eps

    def test_margin_of_safety_uses_the_base_scenario(self):
        result = build_scenarios(normalized_eps_base=5.0, fair_pe_result=_fair_pe_result(fair_pe=20.0), current_price=50.0)
        assert result.margin_of_safety_pct == 50.0  # (100 - 50) / 100 * 100
