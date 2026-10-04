from datetime import date

from app.services.macro_calendar_service import (
    _classify, _strip_period_suffix, why_it_matters,
    event_period, build_event_id,
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


class TestEventPeriod:
    """Stable period extraction — the backbone of build_event_id. Real FMP
    label shapes inspected live 2026-10-04 (see macro_calendar_service.py's
    module docstring): monthly "(Sep)", weekly "(Oct/03)", quarterly
    "(Q3)" — never a year in the suffix itself."""

    def test_monthly_release(self):
        assert event_period("cpi", "Inflation Rate YoY (Sep)", date(2026, 10, 13)) == "2026-09"

    def test_weekly_release_uses_month_and_day_from_suffix(self):
        assert event_period("initial_jobless_claims", "Initial Jobless Claims (Oct/03)", date(2026, 10, 9)) == "2026-10-03"

    def test_quarterly_release(self):
        assert event_period("gdp", "GDP Growth Rate QoQ (Q3)", date(2026, 10, 29)) == "2026-Q3"

    def test_fomc_has_no_suffix_uses_release_date_itself(self):
        assert event_period("fomc_rate_decision", "Fed Interest Rate Decision", date(2026, 10, 28)) == "2026-10-28"

    def test_fed_speaker_uses_release_date_itself(self):
        assert event_period("fed_speaker", "Fed Bowman Speech", date(2026, 10, 6)) == "2026-10-06"

    def test_january_release_reporting_december_period_uses_prior_year(self):
        # A real, recurring case: e.g. December jobs data released in
        # January always carries just "(Dec)" — no year — in FMP's label.
        assert event_period("nfp", "Non Farm Payrolls (Dec)", date(2027, 1, 9)) == "2026-12"

    def test_same_year_release_never_misfires_into_prior_year(self):
        assert event_period("cpi", "Inflation Rate YoY (Oct)", date(2026, 11, 10)) == "2026-10"

    def test_weekly_release_across_year_boundary(self):
        assert event_period("initial_jobless_claims", "Initial Jobless Claims (Dec/26)", date(2027, 1, 2)) == "2026-12-26"

    def test_unrecognized_suffix_shape_falls_back_to_slug_never_raises(self):
        result = event_period("cpi", "Something Weird (abc!!def)", date(2026, 10, 1))
        assert result and "/" not in result

    def test_rescheduled_release_keeps_the_same_period(self):
        # The entire point: FMP moving a release's DATE must never change
        # its period, since the period — not the date — is what event_id
        # is built from.
        original = event_period("nfp", "Non Farm Payrolls (Sep)", date(2026, 10, 2))
        rescheduled = event_period("nfp", "Non Farm Payrolls (Sep)", date(2026, 10, 9))
        assert original == rescheduled == "2026-09"


class TestBuildEventId:
    def test_deterministic(self):
        a = build_event_id("cpi", "2026-09")
        b = build_event_id("cpi", "2026-09")
        assert a == b

    def test_human_readable_and_stable_format(self):
        assert build_event_id("cpi", "2026-09") == "cpi|2026-09"
        assert build_event_id("fomc_rate_decision", "2026-10-28") == "fomc_rate_decision|2026-10-28"

    def test_changes_with_period_not_with_date_or_name(self):
        a = build_event_id("cpi", "2026-09")
        b = build_event_id("cpi", "2026-10")
        assert a != b

    def test_fed_speaker_disambiguated_by_speaker_name(self):
        bowman = build_event_id("fed_speaker", "2026-10-06", "Bowman")
        powell = build_event_id("fed_speaker", "2026-10-06", "Powell")
        assert bowman != powell

    def test_same_speaker_same_day_is_one_identity(self):
        a = build_event_id("fed_speaker", "2026-10-06", "Bowman")
        b = build_event_id("fed_speaker", "2026-10-06", "bowman")  # case-insensitive
        assert a == b

    def test_a_reschedule_produces_the_same_id_the_whole_point(self):
        # End-to-end: event_period + build_event_id together must survive
        # exactly the FMP reschedule scenario this whole feature exists for.
        period_before = event_period("nfp", "Non Farm Payrolls (Sep)", date(2026, 10, 2))
        period_after = event_period("nfp", "Non Farm Payrolls (Sep)", date(2026, 10, 9))
        assert build_event_id("nfp", period_before) == build_event_id("nfp", period_after)


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


class TestMacroEventsStayFixed:
    """Diego, 2026-10-02: macro events must stay fixed on the calendar —
    a past release never vanishes, and a release FMP moved to another day
    never shows twice."""

    @staticmethod
    def _row(event_type, name, date_utc, actual=None, updated_at="2026-09-01T00:00:00+00:00"):
        return {
            "event_id": f"{event_type}|{name}|{date_utc}", "event_type": event_type, "event_name": name,
            "event_date_utc": date_utc, "impact_level": "VERY_HIGH", "actual_value": actual,
            "updated_at": updated_at,
        }

    def test_release_moved_to_another_day_shows_once_on_its_new_day(self):
        from app.services.macro_calendar_service import _dedupe_rescheduled
        old = self._row("nfp", "Non Farm Payrolls (Sep)", "2026-10-02T12:30:00+00:00", updated_at="2026-09-20T00:00:00+00:00")
        new = self._row("nfp", "Non Farm Payrolls (Sep)", "2026-10-09T12:30:00+00:00", updated_at="2026-10-01T00:00:00+00:00")
        out = _dedupe_rescheduled([old, new])
        assert [r["event_date_utc"] for r in out] == ["2026-10-09T12:30:00+00:00"]

    def test_same_name_a_year_apart_is_two_releases(self):
        from app.services.macro_calendar_service import _dedupe_rescheduled
        a = self._row("nfp", "Non Farm Payrolls (Oct)", "2025-11-07T13:30:00+00:00", actual="100K")
        b = self._row("nfp", "Non Farm Payrolls (Oct)", "2026-11-06T13:30:00+00:00")
        assert len(_dedupe_rescheduled([a, b])) == 2

    def test_fed_speakers_never_collapsed(self):
        from app.services.macro_calendar_service import _dedupe_rescheduled
        a = self._row("fed_speaker", "Fed Powell Speech", "2026-10-01T14:00:00+00:00")
        b = self._row("fed_speaker", "Fed Powell Speech", "2026-10-08T14:00:00+00:00")
        assert len(_dedupe_rescheduled([a, b])) == 2

    async def test_past_release_stays_on_calendar_with_history_window(self, monkeypatch):
        from datetime import date
        from types import SimpleNamespace
        from unittest.mock import AsyncMock, MagicMock
        import app.services.macro_calendar_service as svc

        rows = [self._row("cpi", "Inflation Rate YoY (Aug)", "2026-09-11T12:30:00+00:00", actual="2.9%")]
        monkeypatch.setattr("app.core.database.get_supabase", lambda: MagicMock())
        monkeypatch.setattr("app.core.database.get_fresh_supabase", lambda: MagicMock())
        monkeypatch.setattr("app.core.database.run_query", AsyncMock(return_value=SimpleNamespace(data=rows)))
        TestGetMacroEventsHolidayMerge._freeze_today(monkeypatch, date(2026, 10, 2))

        default = await svc.get_macro_events(days_ahead=30, lang="es")
        history = await svc.get_macro_events(days_ahead=30, lang="es", days_behind=400)
        assert not any(e["event_type"] == "cpi" for e in default)
        cpi = [e for e in history if e["event_type"] == "cpi"]
        assert len(cpi) == 1 and cpi[0]["status"] == "past" and cpi[0]["date_et"] == "2026-09-11"


class TestLosslessUpsertNeverDeletes:
    """Section 16 scenarios 4-7: FMP returning less than before — empty,
    partial, or a hard failure — must never remove anything already in
    Supabase. The real guarantee is architectural (no DELETE exists
    anywhere in the live sync path) — these tests prove that at the call
    level: refresh_macro_calendar/_upsert_rows_lossless only ever INSERT/
    UPDATE via the RPC (or the plain-upsert fallback), and the mocked
    Supabase client's `.delete` is never invoked for any input shape."""

    @staticmethod
    def _mock_db(monkeypatch, rpc_return=None):
        from types import SimpleNamespace
        from unittest.mock import AsyncMock, MagicMock
        db = MagicMock()
        db.rpc.return_value = "rpc_query"
        db.table.return_value.delete = MagicMock(side_effect=AssertionError("delete() must never be called on macro_economic_events"))
        monkeypatch.setattr("app.services.macro_calendar_service.get_supabase", lambda: db)

        async def _run_query(query, *a, **kw):
            if query == "rpc_query":
                return SimpleNamespace(data=rpc_return or [])
            return SimpleNamespace(data=[])

        monkeypatch.setattr("app.services.macro_calendar_service.run_query", AsyncMock(side_effect=_run_query))
        return db

    async def test_empty_fmp_response_touches_nothing(self, monkeypatch):
        import app.services.macro_calendar_service as svc
        db = self._mock_db(monkeypatch)
        monkeypatch.setattr(svc, "fetch_and_normalize_macro_events", lambda *a, **kw: [])

        count = await svc.refresh_macro_calendar()
        assert count == 0
        db.rpc.assert_not_called()
        db.table.return_value.delete.assert_not_called()

    async def test_fmp_hard_failure_touches_nothing(self, monkeypatch):
        # _fetch_fmp_window already swallows a hard HTTP failure into [] (its
        # own retry-then-give-up contract) — so a total FMP outage surfaces
        # to refresh_macro_calendar exactly like an empty response.
        import app.services.macro_calendar_service as svc
        db = self._mock_db(monkeypatch)
        monkeypatch.setattr(svc, "_fetch_fmp_window", lambda *a, **kw: [])
        monkeypatch.setattr(svc, "_fmp_key", lambda: "fake-key")

        count = await svc.refresh_macro_calendar()
        assert count == 0
        db.table.return_value.delete.assert_not_called()

    async def test_partial_fmp_response_only_upserts_what_it_got(self, monkeypatch):
        # FMP returning only 1 of the 15 tracked types this run must not
        # trigger any cleanup/removal logic for the other 14 — there isn't
        # any, by construction, but this proves the call site stays that way.
        import app.services.macro_calendar_service as svc
        rpc_result = [{"event_id": "cpi|2026-09", "was_insert": True, "value_changed": True}]
        db = self._mock_db(monkeypatch, rpc_return=rpc_result)
        one_row = [{
            "event_id": "cpi|2026-09", "event_type": "cpi", "event_period": "2026-09",
            "event_name": "Inflation Rate YoY (Sep)", "event_date_utc": "2026-10-13T12:30:00+00:00",
            "country": "US", "impact_source": "High", "impact_level": "VERY_HIGH",
            "actual_value": "2.9", "estimate_value": None, "previous_value": "2.8",
            "unit": "%", "speaker_name": None, "source": "fmp",
        }]
        monkeypatch.setattr(svc, "fetch_and_normalize_macro_events", lambda *a, **kw: one_row)

        count = await svc.refresh_macro_calendar()
        assert count == 1
        db.rpc.assert_called_once()
        assert db.rpc.call_args[0][0] == "upsert_macro_events_batch"
        db.table.return_value.delete.assert_not_called()

    async def test_rpc_missing_falls_back_to_plain_upsert_still_no_delete(self, monkeypatch):
        # Migration 075 not yet applied in this environment — the RPC call
        # itself raises. Must degrade to the old plain upsert, never crash
        # the whole refresh, and still never delete anything.
        import app.services.macro_calendar_service as svc
        from types import SimpleNamespace
        from unittest.mock import AsyncMock, MagicMock
        db = MagicMock()
        db.table.return_value.delete = MagicMock(side_effect=AssertionError("must never delete"))
        monkeypatch.setattr("app.services.macro_calendar_service.get_supabase", lambda: db)

        calls = []

        async def _run_query(query, *a, **kw):
            calls.append(query)
            if query == "rpc_fail":
                raise RuntimeError("function upsert_macro_events_batch does not exist")
            return SimpleNamespace(data=[])

        db.rpc.return_value = "rpc_fail"
        db.table.return_value.upsert.return_value = "plain_upsert_query"
        monkeypatch.setattr("app.services.macro_calendar_service.run_query", AsyncMock(side_effect=_run_query))
        monkeypatch.setattr(svc, "fetch_and_normalize_macro_events", lambda *a, **kw: [
            {"event_id": "cpi|2026-09", "event_type": "cpi", "event_period": "2026-09",
             "event_name": "Inflation Rate YoY (Sep)", "event_date_utc": "2026-10-13T12:30:00+00:00"},
        ])

        count = await svc.refresh_macro_calendar()
        assert count == 1
        assert "plain_upsert_query" in calls
        db.table.return_value.delete.assert_not_called()


class TestBackfillStableEventIdentity:
    """Section 11/16: the one-time migration backfill — merges old
    duplicate rows (same release, old timestamp-based ids) into one row
    under the new stable identity, losslessly, then removes only the
    now-redundant old rows (never a release with no surviving duplicate)."""

    @staticmethod
    def _mock_db(monkeypatch, existing_rows):
        from types import SimpleNamespace
        from unittest.mock import AsyncMock, MagicMock
        db = MagicMock()
        db.rpc.return_value = "rpc_query"
        deleted_ids: list[str] = []

        def _delete_in(col, ids):
            deleted_ids.extend(ids)
            return "delete_query"

        db.table.return_value.delete.return_value.in_.side_effect = _delete_in

        async def _run_query(query, *a, **kw):
            if query == "select_all":
                return SimpleNamespace(data=existing_rows)
            if query == "rpc_query":
                return SimpleNamespace(data=[])
            return SimpleNamespace(data=[])

        db.table.return_value.select.return_value = "select_all"
        monkeypatch.setattr("app.services.macro_calendar_service.get_supabase", lambda: db)
        monkeypatch.setattr("app.services.macro_calendar_service.run_query", AsyncMock(side_effect=_run_query))
        return db, deleted_ids

    async def test_merges_duplicate_rows_from_a_reschedule(self, monkeypatch):
        import app.services.macro_calendar_service as svc
        old_row = {
            "event_id": "oldhash1", "event_type": "nfp", "event_name": "Non Farm Payrolls (Sep)",
            "event_date_utc": "2026-10-02T12:30:00+00:00", "country": "US", "impact_source": "High",
            "impact_level": "VERY_HIGH", "actual_value": None, "estimate_value": "150",
            "previous_value": "140", "unit": "K", "speaker_name": None, "source": "fmp",
            "created_at": "2026-09-20T00:00:00+00:00", "updated_at": "2026-09-20T00:00:00+00:00",
        }
        new_row = {
            "event_id": "oldhash2", "event_type": "nfp", "event_name": "Non Farm Payrolls (Sep)",
            "event_date_utc": "2026-10-09T12:30:00+00:00", "country": "US", "impact_source": "High",
            "impact_level": "VERY_HIGH", "actual_value": "152", "estimate_value": "150",
            "previous_value": "140", "unit": "K", "speaker_name": None, "source": "fmp",
            "created_at": "2026-10-01T00:00:00+00:00", "updated_at": "2026-10-09T13:00:00+00:00",
        }
        db, deleted_ids = self._mock_db(monkeypatch, [old_row, new_row])

        upserted = {}
        async def _fake_upsert(rows):
            for r in rows:
                upserted[r["event_id"]] = r
            return len(rows)
        monkeypatch.setattr(svc, "_upsert_rows_lossless", _fake_upsert)

        result = await svc.backfill_stable_event_identity()

        assert result["old_rows"] == 2
        assert result["stable_releases"] == 1
        assert result["redundant_rows_removed"] == 2  # both old ids get replaced by the new stable one
        merged = list(upserted.values())[0]
        assert merged["event_id"] == "nfp|2026-09"
        assert merged["event_date_utc"] == "2026-10-09T12:30:00+00:00"  # most recent
        assert merged["actual_value"] == "152"  # the real confirmed value, never lost
        assert set(deleted_ids) == {"oldhash1", "oldhash2"}

    async def test_already_stable_row_is_untouched_idempotent(self, monkeypatch):
        import app.services.macro_calendar_service as svc
        row = {
            "event_id": "cpi|2026-09", "event_type": "cpi", "event_name": "Inflation Rate YoY (Sep)",
            "event_date_utc": "2026-10-13T12:30:00+00:00", "country": "US", "impact_source": "High",
            "impact_level": "VERY_HIGH", "actual_value": "2.9", "estimate_value": None,
            "previous_value": "2.8", "unit": "%", "speaker_name": None, "source": "fmp",
            "created_at": "2026-10-13T00:00:00+00:00", "updated_at": "2026-10-13T13:00:00+00:00",
        }
        db, deleted_ids = self._mock_db(monkeypatch, [row])
        monkeypatch.setattr(svc, "_upsert_rows_lossless", AsyncMock_return(1))

        result = await svc.backfill_stable_event_identity()
        assert result["stable_releases"] == 1
        assert result["redundant_rows_removed"] == 0
        assert deleted_ids == []

    async def test_empty_table_is_a_noop(self, monkeypatch):
        import app.services.macro_calendar_service as svc
        db, deleted_ids = self._mock_db(monkeypatch, [])
        result = await svc.backfill_stable_event_identity()
        assert result == {"old_rows": 0, "stable_releases": 0, "redundant_rows_removed": 0}
        assert deleted_ids == []


def AsyncMock_return(value):
    from unittest.mock import AsyncMock
    return AsyncMock(return_value=value)


class TestGetMacroEventsWorkerConsistency:
    """Section 16 scenarios 9/10: multiple workers / a restart must see the
    identical calendar, since it's derived purely from Supabase + "today" —
    no worker-local state is part of the normal (DB available) path."""

    async def test_two_independent_calls_return_identical_data(self, monkeypatch):
        from datetime import date
        from types import SimpleNamespace
        from unittest.mock import AsyncMock, MagicMock
        import app.services.macro_calendar_service as svc

        rows = [{
            "event_id": "cpi|2026-09", "event_type": "cpi", "event_name": "Inflation Rate YoY (Sep)",
            "event_date_utc": "2026-10-13T12:30:00+00:00", "impact_level": "VERY_HIGH",
            "actual_value": "2.9", "updated_at": "2026-10-13T13:00:00+00:00",
        }]
        monkeypatch.setattr(svc, "_LAST_GOOD_ROWS", [])
        monkeypatch.setattr("app.core.database.get_supabase", lambda: MagicMock())
        monkeypatch.setattr("app.core.database.get_fresh_supabase", lambda: MagicMock())
        monkeypatch.setattr("app.core.database.run_query", AsyncMock(return_value=SimpleNamespace(data=rows)))
        TestGetMacroEventsHolidayMerge._freeze_today(monkeypatch, date(2026, 10, 14))

        # Simulates two different gunicorn worker processes each making
        # their own independent call — same mocked Supabase response for
        # both, since that's the one real shared source of truth.
        worker_a = await svc.get_macro_events(days_ahead=30, lang="es")
        worker_b = await svc.get_macro_events(days_ahead=30, lang="es")
        a_macro = [e for e in worker_a if e["event_type"] == "cpi"]
        b_macro = [e for e in worker_b if e["event_type"] == "cpi"]
        assert a_macro == b_macro
        assert len(a_macro) == 1

    async def test_last_good_rows_is_last_resort_only_not_required_for_consistency(self, monkeypatch):
        # A process that has NEVER made a successful read (fresh restart,
        # _LAST_GOOD_ROWS == []) must still serve exactly what's in
        # Supabase on its first real call — no dependency on prior process
        # state, confirming _LAST_GOOD_ROWS is optional, not load-bearing.
        from datetime import date
        from types import SimpleNamespace
        from unittest.mock import AsyncMock, MagicMock
        import app.services.macro_calendar_service as svc

        rows = [{
            "event_id": "nfp|2026-09", "event_type": "nfp", "event_name": "Non Farm Payrolls (Sep)",
            "event_date_utc": "2026-10-09T12:30:00+00:00", "impact_level": "VERY_HIGH",
            "actual_value": "152", "updated_at": "2026-10-09T13:00:00+00:00",
        }]
        monkeypatch.setattr(svc, "_LAST_GOOD_ROWS", [])  # fresh process, never read before
        monkeypatch.setattr("app.core.database.get_supabase", lambda: MagicMock())
        monkeypatch.setattr("app.core.database.get_fresh_supabase", lambda: MagicMock())
        monkeypatch.setattr("app.core.database.run_query", AsyncMock(return_value=SimpleNamespace(data=rows)))
        TestGetMacroEventsHolidayMerge._freeze_today(monkeypatch, date(2026, 10, 14))

        events = await svc.get_macro_events(days_ahead=30, lang="es", days_behind=7)
        assert any(e["event_type"] == "nfp" and e["actual_value"] == "152" for e in events)
