"""
Tests — app.services.quality.deterioration_engine (Fase 2, Incremento 10).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from app.services.quality.deterioration_engine import compute_deterioration_signals, _trend_direction


class TestTrendDirection:
    def test_clear_improvement(self):
        direction, change_pct = _trend_direction([10.0, 11.0, 20.0, 21.0])
        assert direction == "mejorando"
        assert change_pct > 0

    def test_clear_deterioration(self):
        direction, change_pct = _trend_direction([20.0, 21.0, 10.0, 11.0])
        assert direction == "deteriorando"
        assert change_pct < 0

    def test_roughly_flat_is_stable(self):
        direction, change_pct = _trend_direction([20.0, 20.5, 20.2, 20.4])
        assert direction == "estable"

    def test_fewer_than_4_points_returns_none(self):
        assert _trend_direction([10.0, 20.0, 30.0]) is None

    def test_all_none_returns_none(self):
        assert _trend_direction([None, None, None, None]) is None

    def test_zero_first_half_average_returns_none(self):
        assert _trend_direction([0.0, 0.0, 10.0, 10.0]) is None


class TestComputeDeteriorationSignals:
    def test_deteriorating_metric_is_flagged(self):
        result = compute_deterioration_signals(
            roic_trend=[30.0, 29.0, 15.0, 14.0],
            operating_margin_trend=[20.0, 20.5, 20.2, 20.4],
            net_margin_trend=[10.0, 10.2, 10.1, 10.3],
            fcf_margin_trend=[15.0, 15.5, 15.2, 15.3],
            revenue_trend=[100.0, 110.0, 121.0, 133.0],
        )
        assert result.deteriorating_count == 1
        assert result.highest_concern == "roic"
        assert result.has_any_signal is True

    def test_all_stable_or_improving_has_no_concern(self):
        result = compute_deterioration_signals(
            roic_trend=[20.0, 20.5, 20.2, 20.4],
            operating_margin_trend=[10.0, 11.0, 20.0, 21.0],
            net_margin_trend=[10.0, 10.2, 10.1, 10.3],
            fcf_margin_trend=[15.0, 15.5, 15.2, 15.3],
            revenue_trend=[100.0, 110.0, 121.0, 133.0],
        )
        assert result.deteriorating_count == 0
        assert result.highest_concern is None

    def test_insufficient_data_produces_no_signal(self):
        result = compute_deterioration_signals(
            roic_trend=[10.0, 20.0], operating_margin_trend=[], net_margin_trend=[],
            fcf_margin_trend=[], revenue_trend=[],
        )
        assert result.has_any_signal is False
        assert all(f.direction is None for f in result.factors)

    def test_worst_deteriorating_metric_is_highest_concern(self):
        result = compute_deterioration_signals(
            roic_trend=[30.0, 29.0, 25.0, 24.0],  # mild deterioration
            operating_margin_trend=[30.0, 29.0, 10.0, 9.0],  # severe deterioration
            net_margin_trend=[10.0, 10.2, 10.1, 10.3],
            fcf_margin_trend=[15.0, 15.5, 15.2, 15.3],
            revenue_trend=[100.0, 110.0, 121.0, 133.0],
        )
        assert result.highest_concern == "operating_margin"

    def test_every_factor_has_a_real_reason(self):
        result = compute_deterioration_signals(
            roic_trend=[30.0, 29.0, 15.0, 14.0], operating_margin_trend=[], net_margin_trend=[],
            fcf_margin_trend=[], revenue_trend=[],
        )
        assert len(result.factors) == 5
        assert all(f.reason for f in result.factors)

    def test_does_not_duplicate_stability_cv_math(self):
        """Deterioration answers 'which direction' — a smooth linear
        decline (very low CV, would score HIGH on Moat's stability tiers)
        must still be flagged as deteriorating here; the two signals are
        deliberately independent."""
        result = compute_deterioration_signals(
            roic_trend=[30.0, 27.0, 24.0, 21.0, 18.0, 15.0],  # perfectly smooth decline
            operating_margin_trend=[], net_margin_trend=[], fcf_margin_trend=[], revenue_trend=[],
        )
        roic_factor = next(f for f in result.factors if f.name == "roic")
        assert roic_factor.direction == "deteriorando"
