"""
Regression test — the annual Investor Wrapped's access window. Diego:
"quiero que dure del 15 de diciembre al 15 de enero de cada año que pase en
la historia de la vida, antes de esa fecha no hay acceso." A fixed calendar
window, recurring forever — these tests pin down the exact boundary and the
year-wrap behavior (Jan still celebrates the PREVIOUS year).
"""
from datetime import datetime, timezone

from app.core.wrapped_window import is_wrapped_window_open, wrapped_year_for


class TestIsWrappedWindowOpen:
    def test_dec_14_is_closed(self):
        assert is_wrapped_window_open(datetime(2026, 12, 14, 23, 59, tzinfo=timezone.utc)) is False

    def test_dec_15_is_open(self):
        assert is_wrapped_window_open(datetime(2026, 12, 15, 0, 0, tzinfo=timezone.utc)) is True

    def test_dec_31_is_open(self):
        assert is_wrapped_window_open(datetime(2026, 12, 31, 23, 59, tzinfo=timezone.utc)) is True

    def test_jan_1_is_open(self):
        assert is_wrapped_window_open(datetime(2027, 1, 1, 0, 0, tzinfo=timezone.utc)) is True

    def test_jan_15_is_open(self):
        assert is_wrapped_window_open(datetime(2027, 1, 15, 23, 59, tzinfo=timezone.utc)) is True

    def test_jan_16_is_closed(self):
        assert is_wrapped_window_open(datetime(2027, 1, 16, 0, 0, tzinfo=timezone.utc)) is False

    def test_july_is_closed(self):
        assert is_wrapped_window_open(datetime(2026, 7, 4, 12, 0, tzinfo=timezone.utc)) is False

    def test_recurs_every_year(self):
        # Same boundary re-checked a decade later — no per-year update needed.
        assert is_wrapped_window_open(datetime(2035, 12, 20, tzinfo=timezone.utc)) is True
        assert is_wrapped_window_open(datetime(2035, 2, 1, tzinfo=timezone.utc)) is False


class TestWrappedYearFor:
    def test_december_celebrates_that_year(self):
        assert wrapped_year_for(datetime(2026, 12, 20, tzinfo=timezone.utc)) == 2026

    def test_january_still_celebrates_previous_year(self):
        # Opening Wrapped on Jan 10 must show the 2026 recap, not an
        # almost-empty 2027 one.
        assert wrapped_year_for(datetime(2027, 1, 10, tzinfo=timezone.utc)) == 2026
