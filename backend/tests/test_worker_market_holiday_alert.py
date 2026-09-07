"""
Tests — worker.py's holiday-calendar wiring: the re-exported aliases from
app.services.market_holidays (single source of truth, see that module's
docstring) still work under their original private names, and the new
job_market_holiday_alert job skips cleanly on a non-holiday and sends the
requested "market is closed today" copy on a real holiday.
"""
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import worker


class TestReExportedHolidayHelpers:
    def test_is_trading_day_alias_matches_the_shared_module(self):
        assert worker._is_trading_day(date(2026, 9, 7)) is False  # Labor Day
        assert worker._is_trading_day(date(2026, 9, 8)) is True

    def test_is_first_and_last_trading_day_of_week_aliases_work(self):
        assert worker._is_first_trading_day_of_week(date(2026, 9, 8)) is True
        assert worker._is_last_trading_day_of_week(date(2026, 9, 11)) is True


class TestJobMarketHolidayAlert:
    @pytest.mark.asyncio
    async def test_skips_cleanly_when_today_is_not_a_holiday(self, monkeypatch):
        monkeypatch.setattr(worker, "_is_market_holiday_today", lambda: False)
        with patch("app.core.database.get_supabase") as mock_get_db:
            await worker.job_market_holiday_alert()
            mock_get_db.assert_not_called()

    @pytest.mark.asyncio
    async def test_sends_the_requested_copy_on_a_real_holiday(self, monkeypatch):
        monkeypatch.setattr(worker, "_is_market_holiday_today", lambda: True)
        monkeypatch.setattr(worker, "_holiday_name_today", lambda lang: "Labor Day" if lang == "en" else "Día del Trabajo")

        mock_db = MagicMock()
        prefs_rows = [{"user_id": "u1", "push_market_open": True}]
        token_rows = [{"user_id": "u1", "push_token": "ExponentPushToken[abc]"}]
        web_rows: list[dict] = []
        profile_rows = [{"user_id": "u1", "preferred_language": "es"}]

        call_order = [prefs_rows, token_rows, web_rows, profile_rows]

        async def run_query_side_effect(*_a, **_kw):
            from types import SimpleNamespace
            return SimpleNamespace(data=call_order.pop(0))

        sent_calls = []

        async def fake_send_push(user_id, category, title, body, data, db, **kwargs):
            sent_calls.append({"user_id": user_id, "category": category, "title": title, "body": body})

        with patch("app.core.database.get_supabase", return_value=mock_db), \
             patch("app.core.database.run_query", side_effect=run_query_side_effect), \
             patch("app.services.notification_engine.send_push", side_effect=fake_send_push):
            await worker.job_market_holiday_alert()

        assert len(sent_calls) == 1
        call = sent_calls[0]
        assert call["category"] == "market_holiday_alert"
        assert call["user_id"] == "u1"
        assert "Día del Trabajo" in call["title"]
        assert call["body"] == (
            'Hoy es "Día del Trabajo" en Estados Unidos. '
            "Por lo tanto la bolsa hoy no opera. ¡Te esperamos mañana!"
        )

    @pytest.mark.asyncio
    async def test_english_speaking_user_gets_english_copy(self, monkeypatch):
        monkeypatch.setattr(worker, "_is_market_holiday_today", lambda: True)
        monkeypatch.setattr(worker, "_holiday_name_today", lambda lang: "Labor Day" if lang == "en" else "Día del Trabajo")

        mock_db = MagicMock()
        prefs_rows = [{"user_id": "u1", "push_market_open": True}]
        token_rows = [{"user_id": "u1", "push_token": "ExponentPushToken[abc]"}]
        web_rows: list[dict] = []
        profile_rows = [{"user_id": "u1", "preferred_language": "en"}]
        call_order = [prefs_rows, token_rows, web_rows, profile_rows]

        async def run_query_side_effect(*_a, **_kw):
            from types import SimpleNamespace
            return SimpleNamespace(data=call_order.pop(0))

        sent_calls = []

        async def fake_send_push(user_id, category, title, body, data, db, **kwargs):
            sent_calls.append({"body": body})

        with patch("app.core.database.get_supabase", return_value=mock_db), \
             patch("app.core.database.run_query", side_effect=run_query_side_effect), \
             patch("app.services.notification_engine.send_push", side_effect=fake_send_push):
            await worker.job_market_holiday_alert()

        assert sent_calls[0]["body"] == (
            'Today is "Labor Day" in the United States, so the market isn\'t operating today. '
            "See you tomorrow!"
        )

    @pytest.mark.asyncio
    async def test_opted_out_user_never_receives_the_push(self, monkeypatch):
        monkeypatch.setattr(worker, "_is_market_holiday_today", lambda: True)
        monkeypatch.setattr(worker, "_holiday_name_today", lambda lang: "Labor Day" if lang == "en" else "Día del Trabajo")

        mock_db = MagicMock()
        prefs_rows = [{"user_id": "u1", "push_market_open": False}]
        token_rows = [{"user_id": "u1", "push_token": "ExponentPushToken[abc]"}]
        web_rows: list[dict] = []
        call_order = [prefs_rows, token_rows, web_rows]

        async def run_query_side_effect(*_a, **_kw):
            from types import SimpleNamespace
            return SimpleNamespace(data=call_order.pop(0) if call_order else [])

        with patch("app.core.database.get_supabase", return_value=mock_db), \
             patch("app.core.database.run_query", side_effect=run_query_side_effect), \
             patch("app.services.notification_engine.send_push", new_callable=AsyncMock) as mock_push:
            await worker.job_market_holiday_alert()

        mock_push.assert_not_called()
