from app.services.macro_calendar_service import (
    _classify, _strip_period_suffix, _event_id, why_it_matters,
)


class TestStripPeriodSuffix:
    def test_strips_month_parenthetical(self):
        assert _strip_period_suffix("Non Farm Payrolls (Oct)") == "non farm payrolls"

    def test_lowercases(self):
        assert _strip_period_suffix("CPI (Oct)") == "cpi"

    def test_no_suffix(self):
        assert _strip_period_suffix("Fed Interest Rate Decision") == "fed interest rate decision"


class TestClassify:
    def test_fomc_rate_decision(self):
        result = _classify("Fed Interest Rate Decision")
        assert result == ("fomc_rate_decision", "VERY_HIGH", None)

    def test_headline_cpi(self):
        result = _classify("Inflation Rate YoY (Sep)")
        assert result == ("cpi", "VERY_HIGH", None)

    def test_core_cpi_not_confused_with_headline_cpi(self):
        result = _classify("Core Inflation Rate YoY (Sep)")
        assert result[0] == "core_cpi"

    def test_nfp_matches_but_not_private_payrolls(self):
        assert _classify("Non Farm Payrolls (Oct)")[0] == "nfp"
        assert _classify("Nonfarm Payrolls Private (Sep)") is None
        assert _classify("Government Payrolls (Sep)") is None

    def test_unemployment_rate_not_confused_with_u6(self):
        assert _classify("Unemployment Rate (Oct)")[0] == "unemployment_rate"
        assert _classify("U-6 Unemployment Rate (Oct)") is None

    def test_gdp(self):
        assert _classify("GDP Growth Rate QoQ (Q3)")[0] == "gdp"

    def test_ppi_representative(self):
        assert _classify("PPI Ex Food, Energy and Trade YoY (Oct)")[0] == "ppi"

    def test_housing_starts_and_building_permits_both_map(self):
        assert _classify("Housing Starts (Oct)")[0] == "housing_starts"
        assert _classify("Building Permits (Oct)")[0] == "housing_starts"
        # MoM variants intentionally excluded (same release, avoid duplicate rows)
        assert _classify("Housing Starts MoM (Oct)") is None

    def test_fed_speaker_extracts_real_name(self):
        event_type, impact, speaker = _classify("Fed Barkin Speech")
        assert event_type == "fed_speaker"
        assert speaker == "Barkin"

    def test_powell_detected_even_without_speech_pattern(self):
        result = _classify("Fed Chair Powell Testimony")
        assert result is not None
        assert result[0] == "fed_speaker"
        assert result[2] == "Powell"

    def test_unrelated_events_filtered_out(self):
        assert _classify("Michigan Inflation Expectations (Aug)") is None
        assert _classify("3-Month Bill Auction") is None
        assert _classify("Existing Home Sales (Oct)") is None


class TestEventId:
    def test_deterministic(self):
        a = _event_id("cpi", "Inflation Rate YoY (Sep)", "2026-09-11T12:30:00+00:00")
        b = _event_id("cpi", "Inflation Rate YoY (Sep)", "2026-09-11T12:30:00+00:00")
        assert a == b

    def test_changes_with_inputs(self):
        a = _event_id("cpi", "Inflation Rate YoY (Sep)", "2026-09-11T12:30:00+00:00")
        b = _event_id("cpi", "Inflation Rate YoY (Oct)", "2026-10-11T12:30:00+00:00")
        assert a != b


class TestWhyItMatters:
    def test_returns_spanish_by_default(self):
        text = why_it_matters("cpi", "es")
        assert text and "inflaci" in text.lower()

    def test_returns_english(self):
        text = why_it_matters("cpi", "en")
        assert text and "inflation" in text.lower()

    def test_unknown_type_returns_empty(self):
        assert why_it_matters("not_a_real_type", "es") == ""


class TestGetMacroEventsHolidayMerge:
    """get_macro_events() merges real US market holidays (app.services.
    market_holidays, the same source worker.py's job-gating reads from)
    into the same event shape the web/mobile calendars already consume."""

    @staticmethod
    def _mock_empty_db(monkeypatch):
        from types import SimpleNamespace
        from unittest.mock import AsyncMock, MagicMock
        monkeypatch.setattr("app.core.database.get_supabase", lambda: MagicMock())
        monkeypatch.setattr(
            "app.core.database.run_query",
            AsyncMock(return_value=SimpleNamespace(data=[])),
        )

    @staticmethod
    def _freeze_today(monkeypatch, frozen_date):
        """Freezes BOTH the date market_holidays.upcoming_holidays() computes
        its window from, AND the "today" get_macro_events itself derives via
        `datetime.now(_ET)` for status ("past"/"today"/"upcoming") — these
        are two independent `datetime.now()` calls in two different modules,
        so a real production run always has them agree (both read the real
        clock), but a test freezing only one would leave the other reading
        the real wall-clock date and produce a flaky/wrong "status"."""
        import app.services.market_holidays as market_holidays
        import app.services.macro_calendar_service as macro_calendar_service
        from datetime import datetime as _real_datetime

        monkeypatch.setattr(market_holidays, "_today_et", lambda: frozen_date)

        class _FrozenDateTime(_real_datetime):
            @classmethod
            def now(cls, tz=None):
                return _real_datetime(frozen_date.year, frozen_date.month, frozen_date.day, 10, 0, tzinfo=tz)

        monkeypatch.setattr(macro_calendar_service, "datetime", _FrozenDateTime)

    async def test_labor_day_appears_as_a_market_holiday_event(self, monkeypatch):
        from datetime import date
        from app.services.macro_calendar_service import get_macro_events

        self._mock_empty_db(monkeypatch)
        self._freeze_today(monkeypatch, date(2026, 9, 1))

        events = await get_macro_events(days_ahead=10, lang="es")
        holidays = {e["date_et"]: e for e in events if e["event_type"] == "market_holiday"}
        h = holidays["2026-09-07"]
        assert h["event_name"] == "Día del Trabajo"
        assert h["status"] == "upcoming"
        assert h["country"] == "US"
        assert "no abre" in h["why_it_matters"]

    async def test_holidays_shown_cover_the_full_year_regardless_of_days_ahead(self, monkeypatch):
        # Diego, 2026-09: people should see every US market holiday for the
        # whole year up front, not just whichever one happens to fall
        # inside the macro-news lookahead window (the frontend's own
        # default is only 45 days). Requesting a tiny `days_ahead` for
        # macro news must NOT shrink the holiday list to match.
        from datetime import date
        from app.services.macro_calendar_service import get_macro_events

        self._mock_empty_db(monkeypatch)
        self._freeze_today(monkeypatch, date(2026, 9, 1))

        events = await get_macro_events(days_ahead=10, lang="es")
        holiday_dates = {e["date_et"] for e in events if e["event_type"] == "market_holiday"}
        # Every remaining 2026 holiday, plus (since the window intentionally
        # extends past a year) every 2027 holiday too.
        assert "2026-09-07" in holiday_dates   # Labor Day
        assert "2026-11-26" in holiday_dates   # Thanksgiving
        assert "2026-12-25" in holiday_dates   # Christmas
        assert "2027-01-01" in holiday_dates   # New Year's Day 2027

    async def test_holiday_event_name_and_copy_in_english(self, monkeypatch):
        from datetime import date
        from app.services.macro_calendar_service import get_macro_events

        self._mock_empty_db(monkeypatch)
        self._freeze_today(monkeypatch, date(2026, 9, 1))

        events = await get_macro_events(days_ahead=10, lang="en")
        holiday = next(e for e in events if e["date_et"] == "2026-09-07")
        assert holiday["event_name"] == "Labor Day"
        assert "closed" in holiday["why_it_matters"]

    async def test_holiday_on_the_day_itself_has_status_today(self, monkeypatch):
        from datetime import date
        from app.services.macro_calendar_service import get_macro_events

        self._mock_empty_db(monkeypatch)
        self._freeze_today(monkeypatch, date(2026, 9, 7))

        events = await get_macro_events(days_ahead=10, lang="es")
        holiday = next(e for e in events if e["date_et"] == "2026-09-07")
        assert holiday["status"] == "today"

    async def test_never_fabricates_a_holiday_never_returned_by_the_source_of_truth(self, monkeypatch):
        # A day with no entry in market_holidays.US_MARKET_HOLIDAYS must
        # never show up as a market_holiday event, no matter how wide the
        # (deliberately generous) holiday lookahead window is.
        from datetime import date
        from app.services.macro_calendar_service import get_macro_events

        self._mock_empty_db(monkeypatch)
        self._freeze_today(monkeypatch, date(2026, 9, 1))

        events = await get_macro_events(days_ahead=10, lang="es")
        holiday_dates = {e["date_et"] for e in events if e["event_type"] == "market_holiday"}
        assert "2026-09-08" not in holiday_dates  # the day right after Labor Day — not a holiday
