"""
Tests — app.services.valuation.nuvos_engine.divergence.

See /Users/diegoarria/.claude/plans/cosmic-munching-crown.md.
"""
from app.services.valuation.nuvos_engine.divergence import explain_divergence
from app.services.valuation.nuvos_engine.earnings_state import EarningsState


class TestMateriality:
    def test_small_gap_is_not_material_and_needs_no_explanation(self):
        result = explain_divergence(
            fair_value=105.0, current_price=100.0, earnings_state=EarningsState.NORMAL,
            fair_pe_primary_anchor="growth_based", historical_median_pe=None, peer_median_pe=None,
            growth_based_multiple=None,
        )
        assert result.material is False
        assert result.explained is True

    def test_missing_fair_value_or_price_is_never_material(self):
        result = explain_divergence(
            fair_value=None, current_price=100.0, earnings_state=EarningsState.NORMAL,
            fair_pe_primary_anchor=None, historical_median_pe=None, peer_median_pe=None, growth_based_multiple=None,
        )
        assert result.material is False


class TestExplanation:
    def test_cyclical_trough_explains_a_large_positive_gap(self):
        result = explain_divergence(
            fair_value=200.0, current_price=100.0, earnings_state=EarningsState.CYCLICAL_TROUGH,
            fair_pe_primary_anchor="historical", historical_median_pe=None, peer_median_pe=None, growth_based_multiple=None,
        )
        assert result.material is True
        assert result.explained is True
        assert result.causes  # at least one real cause recorded

    def test_no_real_cause_leaves_it_unexplained_rather_than_forcing_a_story(self):
        result = explain_divergence(
            fair_value=200.0, current_price=100.0, earnings_state=EarningsState.NORMAL,
            fair_pe_primary_anchor="growth_based", historical_median_pe=None, peer_median_pe=None, growth_based_multiple=None,
        )
        assert result.material is True
        assert result.explained is False
        assert result.causes == []

    def test_multiple_disagreeing_with_historical_pe_is_a_real_cause(self):
        result = explain_divergence(
            fair_value=200.0, current_price=100.0, earnings_state=EarningsState.NORMAL,
            fair_pe_primary_anchor="growth_based", historical_median_pe=10.0, peer_median_pe=None,
            growth_based_multiple=30.0,
        )
        assert result.explained is True
