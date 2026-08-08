"""
Tests — worker._earnings_result_badge (dividend/earnings notification
redesign): the real 🟢/🟡/🔴 classification used by both the Free and
Premium "just reported" earnings push notifications.
"""
from worker import _earnings_result_badge


class TestEarningsResultBadge:
    def test_beat_returns_green(self):
        badge, label = _earnings_result_badge(actual=2.18, estimate=2.05, is_en=False)
        assert badge == "🟢"
        assert label == "Mejor de lo esperado"

    def test_miss_returns_red(self):
        badge, label = _earnings_result_badge(actual=1.80, estimate=2.05, is_en=False)
        assert badge == "🔴"
        assert label == "Peor de lo esperado"

    def test_in_line_returns_yellow(self):
        badge, label = _earnings_result_badge(actual=2.05, estimate=2.04, is_en=False)
        assert badge == "🟡"
        assert label == "En línea con lo esperado"

    def test_english_labels(self):
        badge, label = _earnings_result_badge(actual=2.18, estimate=2.05, is_en=True)
        assert badge == "🟢"
        assert label == "Better than expected"

    def test_missing_actual_returns_none_never_a_guess(self):
        assert _earnings_result_badge(actual=None, estimate=2.05, is_en=False) == (None, None)

    def test_missing_estimate_returns_none_never_a_guess(self):
        assert _earnings_result_badge(actual=2.18, estimate=None, is_en=False) == (None, None)

    def test_zero_estimate_never_divides_by_zero(self):
        assert _earnings_result_badge(actual=0.10, estimate=0.0, is_en=False) == (None, None)

    def test_small_surprise_within_threshold_is_in_line(self):
        # 1% surprise is well inside the +-2% "in line" band
        badge, _ = _earnings_result_badge(actual=1.01, estimate=1.00, is_en=False)
        assert badge == "🟡"
