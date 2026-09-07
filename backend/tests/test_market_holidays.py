"""
Tests — app.services.market_holidays, the single source of truth for US
market (NYSE/NASDAQ) holidays shared by worker.py's job-gating and the
calendar UI's macro-events endpoint.
"""
from datetime import date

import app.services.market_holidays as market_holidays
from app.services.market_holidays import (
    holiday_name,
    holiday_name_today,
    is_first_trading_day_of_week,
    is_last_trading_day_of_week,
    is_market_holiday_today,
    is_market_open_today,
    is_trading_day,
    upcoming_holidays,
)


class TestIsTradingDay:
    def test_weekday_non_holiday_is_a_trading_day(self):
        assert is_trading_day(date(2026, 9, 8))  # Tuesday, no holiday

    def test_weekend_is_never_a_trading_day(self):
        assert not is_trading_day(date(2026, 9, 5))  # Saturday
        assert not is_trading_day(date(2026, 9, 6))  # Sunday

    def test_known_holiday_is_not_a_trading_day(self):
        assert not is_trading_day(date(2026, 9, 7))  # Labor Day 2026 (Monday)
        assert not is_trading_day(date(2026, 12, 25))  # Christmas 2026


class TestHolidayName:
    def test_known_holiday_returns_real_name_in_requested_language(self):
        assert holiday_name(date(2026, 9, 7), "es") == "Día del Trabajo"
        assert holiday_name(date(2026, 9, 7), "en") == "Labor Day"

    def test_non_holiday_returns_none_never_a_fabricated_name(self):
        assert holiday_name(date(2026, 9, 8), "es") is None
        assert holiday_name(date(2026, 9, 8), "en") is None

    def test_unknown_language_falls_back_to_spanish(self):
        assert holiday_name(date(2026, 9, 7), "fr") == "Día del Trabajo"


class TestTodayHelpers:
    def test_is_market_open_today_reflects_mocked_date(self, monkeypatch):
        monkeypatch.setattr(market_holidays, "_today_et", lambda: date(2026, 9, 7))  # Labor Day
        assert is_market_open_today() is False
        assert is_market_holiday_today() is True
        assert holiday_name_today("es") == "Día del Trabajo"

    def test_is_market_open_today_true_on_a_normal_trading_day(self, monkeypatch):
        monkeypatch.setattr(market_holidays, "_today_et", lambda: date(2026, 9, 8))
        assert is_market_open_today() is True
        assert is_market_holiday_today() is False
        assert holiday_name_today("es") is None

    def test_is_market_holiday_today_false_on_a_weekend_even_if_close_to_a_holiday(self, monkeypatch):
        # A weekend must never be reported as a "holiday" — it's closed for
        # a different reason, and job_holiday_midday-style pushes must not
        # fire on ordinary Saturdays/Sundays.
        monkeypatch.setattr(market_holidays, "_today_et", lambda: date(2026, 9, 6))  # Sunday
        assert is_market_holiday_today() is False


class TestTradingWeekBoundaries:
    def test_first_trading_day_skips_a_monday_holiday(self):
        # Labor Day 2026 is Monday Sep 7 — the first real trading day of
        # that week is Tuesday Sep 8, not the holiday Monday itself.
        assert not is_first_trading_day_of_week(date(2026, 9, 7))
        assert is_first_trading_day_of_week(date(2026, 9, 8))

    def test_last_trading_day_of_an_ordinary_week(self):
        assert is_last_trading_day_of_week(date(2026, 9, 11))  # a Friday, no holiday that week


class TestUpcomingHolidays:
    def test_returns_only_holidays_within_window(self, monkeypatch):
        monkeypatch.setattr(market_holidays, "_today_et", lambda: date(2026, 9, 1))
        result = upcoming_holidays(days_ahead=10)
        dates = [h["date"] for h in result]
        assert date(2026, 9, 7) in dates  # Labor Day, within 10 days
        assert date(2026, 11, 26) not in dates  # Thanksgiving, far outside window

    def test_entries_carry_real_bilingual_names(self, monkeypatch):
        monkeypatch.setattr(market_holidays, "_today_et", lambda: date(2026, 9, 1))
        result = upcoming_holidays(days_ahead=10)
        labor_day = next(h for h in result if h["date"] == date(2026, 9, 7))
        assert labor_day["name_es"] == "Día del Trabajo"
        assert labor_day["name_en"] == "Labor Day"

    def test_sorted_ascending_by_date(self, monkeypatch):
        monkeypatch.setattr(market_holidays, "_today_et", lambda: date(2026, 1, 1))
        result = upcoming_holidays(days_ahead=365)
        dates = [h["date"] for h in result]
        assert dates == sorted(dates)
