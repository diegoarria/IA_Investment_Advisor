"""
Tests — app.services.valuation.exit_multiple_engine (Nuvos AI Fair Value
Engine redesign, Incremento 1).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
import pytest

from app.services.valuation.exit_multiple_engine import (
    select_exit_metric,
    derive_exit_multiple,
    derive_exit_multiple_ladder,
    _FALLBACK_ANCHOR,
    _MAX_RELATIVE_ADJUSTMENT,
)


class TestSelectExitMetric:
    def test_growth_categories_use_ev_sales(self):
        assert select_exit_metric("Software") == "ev_sales"
        assert select_exit_metric("Marketplace") == "ev_sales"

    def test_capital_intensive_categories_use_ev_ebit(self):
        assert select_exit_metric("Semiconductors") == "ev_ebit"
        assert select_exit_metric("Industrials") == "ev_ebit"
        assert select_exit_metric("Utilities") == "ev_ebit"

    def test_mature_cash_generative_categories_use_ev_fcf(self):
        assert select_exit_metric("Healthcare") == "ev_fcf"
        assert select_exit_metric("Consumer") == "ev_fcf"

    def test_unknown_category_defaults_to_ev_ebit(self):
        assert select_exit_metric("Something Nuvos Has Never Seen") == "ev_ebit"

    def test_diversified_defaults_to_ev_ebit(self):
        assert select_exit_metric("Diversified") == "ev_ebit"


class TestDeriveExitMultipleAnchorPreference:
    def test_prefers_own_historical_over_peer_and_fallback(self):
        result = derive_exit_multiple(
            metric="ev_ebit",
            own_historical_ev_ebitda=12.0, peer_median_ev_ebitda=8.0,
            own_ebitda=100.0, own_ebit=80.0,
        )
        assert result.anchor_source == "own_historical"
        assert result.anchor == pytest.approx(12.0 * (100.0 / 80.0))

    def test_falls_back_to_peer_median_without_own_historical(self):
        result = derive_exit_multiple(
            metric="ev_ebit",
            peer_median_ev_ebitda=8.0,
            own_ebitda=100.0, own_ebit=80.0,
        )
        assert result.anchor_source == "peer_median"
        assert result.anchor == pytest.approx(8.0 * (100.0 / 80.0))

    def test_falls_back_to_sector_table_without_any_real_anchor(self):
        result = derive_exit_multiple(metric="ev_ebit")
        assert result.anchor_source == "sector_table_fallback"
        assert result.anchor == _FALLBACK_ANCHOR["ev_ebit"]

    def test_ev_fcf_anchor_used_directly_without_bridging(self):
        result = derive_exit_multiple(metric="ev_fcf", peer_median_ev_fcf=22.0)
        assert result.anchor_source == "peer_median"
        assert result.anchor == 22.0

    def test_bridges_to_ev_sales_via_own_ebitda_margin(self):
        result = derive_exit_multiple(
            metric="ev_sales",
            peer_median_ev_ebitda=10.0, own_ebitda=30.0, own_revenue=100.0,
        )
        assert result.anchor_source == "peer_median"
        assert result.anchor == pytest.approx(10.0 * (30.0 / 100.0))

    def test_missing_bridge_inputs_falls_back_to_sector_table(self):
        # peer_median_ev_ebitda present but own_revenue missing -> can't bridge to ev_sales
        result = derive_exit_multiple(metric="ev_sales", peer_median_ev_ebitda=10.0, own_ebitda=30.0)
        assert result.anchor_source == "sector_table_fallback"


class TestDeriveExitMultipleAdjustments:
    def test_strong_business_adjusts_multiple_upward(self):
        result = derive_exit_multiple(
            metric="ev_ebit", peer_median_ev_ebitda=10.0, own_ebitda=30.0, own_ebit=25.0,
            expected_eps_growth_pct=25.0, roic_pct=30.0, cost_of_capital_pct=9.0,
            fcf_margin_pct=20.0, moat_score=90.0, management_score=85.0,
        )
        assert result.adjustment_fraction > 0
        assert result.exit_multiple > result.anchor

    def test_weak_business_adjusts_multiple_downward(self):
        result = derive_exit_multiple(
            metric="ev_ebit", peer_median_ev_ebitda=10.0, own_ebitda=30.0, own_ebit=25.0,
            expected_eps_growth_pct=-5.0, roic_pct=4.0, cost_of_capital_pct=10.0,
            net_debt_to_ebitda=6.0, interest_coverage=1.0, moat_score=15.0,
        )
        assert result.adjustment_fraction < 0
        assert result.exit_multiple < result.anchor

    def test_relative_clamp_bounds_the_final_multiple(self):
        # Every adjustment maxed out in the same direction — exit_multiple
        # must never exceed anchor * (1 + _MAX_RELATIVE_ADJUSTMENT).
        result = derive_exit_multiple(
            metric="ev_ebit", peer_median_ev_ebitda=10.0, own_ebitda=30.0, own_ebit=25.0,
            expected_eps_growth_pct=200.0, roic_pct=90.0, cost_of_capital_pct=5.0,
            fcf_margin_pct=90.0, dividend_yield_pct=50.0, moat_score=100.0, management_score=100.0,
        )
        assert result.exit_multiple <= result.anchor * (1 + _MAX_RELATIVE_ADJUSTMENT) + 1e-6

    def test_no_signals_available_returns_anchor_unadjusted(self):
        result = derive_exit_multiple(metric="ev_ebit", peer_median_ev_ebitda=10.0, own_ebitda=30.0, own_ebit=25.0)
        assert result.adjustment_fraction == 0.0
        assert result.exit_multiple == result.anchor

    def test_adjustments_are_explainable_without_an_adapter(self):
        result = derive_exit_multiple(
            metric="ev_ebit", peer_median_ev_ebitda=10.0, own_ebitda=30.0, own_ebit=25.0,
            expected_eps_growth_pct=15.0,
        )
        assert len(result.adjustments) == 6
        for adj in result.adjustments:
            assert hasattr(adj, "factor") and hasattr(adj, "points") and hasattr(adj, "reason")
            assert adj.reason


class TestDeriveExitMultipleLadder:
    def test_all_three_candidates_present_with_full_real_inputs(self):
        ladder = derive_exit_multiple_ladder(
            metric="ev_ebit",
            own_historical_ev_ebitda=12.0, peer_median_ev_ebitda=10.0,
            own_ebitda=30.0, own_ebit=25.0,
        )
        assert ladder["own_historical"] is not None
        assert ladder["peer_median"] is not None
        assert ladder["sector_table_fallback"] == _FALLBACK_ANCHOR["ev_ebit"]

    def test_missing_source_data_yields_none_not_a_guess(self):
        # No own_historical/peer inputs at all — only the sector fallback
        # (a constant, not a "real" candidate) should be non-None.
        ladder = derive_exit_multiple_ladder(metric="ev_sales", own_ebitda=30.0, own_ebit=25.0, own_revenue=100.0)
        assert ladder["own_historical"] is None
        assert ladder["peer_median"] is None
        assert ladder["sector_table_fallback"] == _FALLBACK_ANCHOR["ev_sales"]

    def test_never_raises_with_partial_inputs(self):
        # Own EBIT/EBITDA missing entirely — bridging should degrade to
        # None for the affected candidates rather than throwing.
        ladder = derive_exit_multiple_ladder(metric="ev_ebit", own_historical_ev_ebitda=12.0)
        assert ladder["own_historical"] is None
        assert ladder["sector_table_fallback"] == _FALLBACK_ANCHOR["ev_ebit"]

    def test_ev_fcf_peer_anchor_used_directly_without_bridging(self):
        ladder = derive_exit_multiple_ladder(metric="ev_fcf", peer_median_ev_fcf=18.0)
        assert ladder["peer_median"] == 18.0
