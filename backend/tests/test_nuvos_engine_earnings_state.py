"""
Tests — app.services.valuation.nuvos_engine.earnings_state.

See /Users/diegoarria/.claude/plans/cosmic-munching-crown.md.
"""
from app.services.quality.deterioration_engine import compute_deterioration_signals
from app.services.valuation.nuvos_engine.classification import LynchCategory
from app.services.valuation.nuvos_engine.earnings_state import detect_earnings_state, EarningsState


class TestInsufficientHistory:
    def test_short_history_never_fabricates_a_normalized_eps(self):
        result = detect_earnings_state(
            eps_trend=[1.0, 1.1], net_margin_trend=[5.0, 5.5],
            category=LynchCategory.STALWART, latest_eps=1.1,
        )
        assert result.normalized_eps is None
        assert result.reliability_note is not None


class TestCyclical:
    def test_current_margin_near_top_of_own_range_is_peak(self):
        margins = [5, 6, 7, 20, 21, 22]  # last 3 clearly the high end
        eps = [1, 1.2, 1.4, 4.0, 4.2, 4.4]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=margins, category=LynchCategory.CYCLICAL, latest_eps=eps[-1],
        )
        assert result.state == EarningsState.CYCLICAL_PEAK
        # normalized EPS should be pulled below the raw peak-margin EPS
        assert result.normalized_eps < eps[-1]

    def test_current_margin_near_bottom_of_own_range_is_trough(self):
        margins = [20, 21, 22, 23, 5, 6, 4]
        eps = [4.0, 4.2, 4.4, 4.5, 1.0, 1.1, 0.9]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=margins, category=LynchCategory.CYCLICAL, latest_eps=eps[-1],
        )
        assert result.state == EarningsState.CYCLICAL_TROUGH
        assert result.normalized_eps > eps[-1]

    def test_middle_of_range_is_normal(self):
        margins = [10, 12, 14, 13, 11, 12]
        eps = [2, 2.2, 2.4, 2.3, 2.1, 2.2]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=margins, category=LynchCategory.CYCLICAL, latest_eps=eps[-1],
        )
        assert result.state == EarningsState.NORMAL


class TestTurnaround:
    def test_negative_base_with_real_improvement_is_recovery_without_a_fabricated_number(self):
        det = compute_deterioration_signals(
            roic_trend=[1, 2, 3, 4, 5, 6], operating_margin_trend=[1, 2, 3, 4, 5, 6],
            net_margin_trend=[-5, -4, -3, -1, 0.5, 1], fcf_margin_trend=[1, 2, 3, 4, 5, 6],
            revenue_trend=[100, 102, 105, 108, 112, 116],
        )
        result = detect_earnings_state(
            eps_trend=[-1, -0.8, -0.5, -0.2, -0.1, -0.05], net_margin_trend=[-5, -4, -3, -1, 0.5, 1],
            category=LynchCategory.TURNAROUND, latest_eps=-0.05, deterioration=det,
        )
        assert result.state == EarningsState.RECOVERY
        assert result.normalized_eps is None  # never fabricated even when recovering
        assert result.reliability_note is not None

    def test_negative_base_without_improvement_is_structurally_impaired(self):
        det = compute_deterioration_signals(
            roic_trend=[6, 5, 4, 3, 2, 1], operating_margin_trend=[6, 5, 4, 3, 2, 1],
            net_margin_trend=[1, 0, -1, -2, -3, -4], fcf_margin_trend=[6, 5, 4, 3, 2, 1],
            revenue_trend=[116, 112, 108, 105, 102, 100],
        )
        result = detect_earnings_state(
            eps_trend=[0.3, 0.1, -0.2, -0.5, -0.8, -1.0], net_margin_trend=[1, 0, -1, -2, -3, -4],
            category=LynchCategory.TURNAROUND, latest_eps=-1.0, deterioration=det,
        )
        assert result.state == EarningsState.STRUCTURALLY_IMPAIRED
        assert result.normalized_eps is None


class TestNonCyclicalNonTurnaround:
    def test_eps_far_above_recent_average_is_elevated(self):
        eps = [1.0, 1.05, 1.1, 1.15, 5.0]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=[10, 10, 10, 10, 10], category=LynchCategory.STALWART, latest_eps=5.0,
        )
        assert result.state == EarningsState.ELEVATED
        assert result.normalized_eps < 5.0

    def test_eps_far_below_recent_average_is_depressed(self):
        eps = [5.0, 5.1, 5.2, 5.15, 0.5]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=[10, 10, 10, 10, 10], category=LynchCategory.STALWART, latest_eps=0.5,
        )
        assert result.state == EarningsState.DEPRESSED
        assert result.normalized_eps > 0.5

    def test_eps_in_line_with_recent_average_is_normal(self):
        eps = [2.0, 2.1, 2.2, 2.15, 2.2]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=[10, 10, 10, 10, 10], category=LynchCategory.STALWART, latest_eps=2.2,
        )
        assert result.state == EarningsState.NORMAL
        assert result.normalized_eps == 2.2
