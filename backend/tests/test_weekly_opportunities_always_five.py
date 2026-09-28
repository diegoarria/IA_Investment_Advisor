"""
Diego, 2026-09-27: "SIEMPRE debe mostrar las 5 opciones de la semana para
cada usuario" — the Screener Semanal endpoint always returns this week's
5 (anchored to the Sunday 12:10 ET job), topping up with real picks and
never showing last week's list once the job has had time to run.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.routes import screener


def _pick(t):
    return {"ticker": t, "company_name": t, "sector": "Tecnología", "price": 10, "margin_of_safety_pct": 20}


def _row(t, sent_at):
    return {"ticker": t, "sent_at": sent_at.isoformat(), "snapshot": _pick(t)}


class _Db:
    def __init__(self, rows):
        self.rows = rows
        self.upserts = []

    def table(self, _name):
        q = MagicMock()
        q.select.return_value = q
        q.eq.return_value = q
        q.order.return_value = q
        q._result = SimpleNamespace(data=self.rows)
        def upsert(rows, on_conflict=None):
            self.upserts.append(rows)
            u = MagicMock(); u._result = SimpleNamespace(data=rows); return u
        q.upsert.side_effect = upsert
        return q


async def _run_query(q):
    return q._result


async def _call(rows, picker, now_offset_hours=24):
    week_start = datetime(2026, 9, 27, 16, 10, tzinfo=timezone.utc)  # Sun 12:10 ET
    db = _Db(rows)
    fake_now = week_start + timedelta(hours=now_offset_hours)

    class _DT(datetime):
        @classmethod
        def now(cls, tz=None):
            return fake_now if tz else fake_now.replace(tzinfo=None)

    with patch.object(screener, "_get_user_profile_safe", new=AsyncMock(return_value=SimpleNamespace(preferred_language="es", risk_tolerance="moderate"))), \
         patch("app.api.routes.chat._is_premium", return_value=True), \
         patch.object(screener, "get_supabase", return_value=db), \
         patch.object(screener, "run_query", new=_run_query), \
         patch.object(screener, "_weekly_opportunities_week_start", return_value=week_start), \
         patch.object(screener, "datetime", _DT), \
         patch("app.services.undervalued_screener_service.pick_weekly_opportunities_for_user", side_effect=picker), \
         patch("app.services.undervalued_screener_service.bootstrap_fill_if_empty_sync"):
        res = await screener.weekly_opportunities("es", "user1")
    return res, db, week_start


class TestWeeklyOpportunitiesAlwaysFive:
    @pytest.mark.asyncio
    async def test_full_week_batch_is_returned_as_is(self):
        ws = datetime(2026, 9, 27, 16, 10, 30, tzinfo=timezone.utc)
        rows = [_row(t, ws) for t in "ABCDE"]
        res, db, _ = await _call(rows, picker=lambda *a, **k: pytest.fail("must not pick"))
        assert [r["ticker"] for r in res["results"]] == list("ABCDE")
        assert db.upserts == []

    @pytest.mark.asyncio
    async def test_short_batch_is_topped_up_to_five_with_real_picks(self):
        ws = datetime(2026, 9, 27, 16, 10, 30, tzinfo=timezone.utc)
        rows = [_row(t, ws) for t in "ABC"]
        res, db, _ = await _call(rows, picker=lambda risk, excl, n: [_pick(t) for t in "XYZ" if t not in excl][:n])
        assert len(res["results"]) == 5
        assert {r["ticker"] for r in res["results"]} >= set("ABC")
        assert len(db.upserts) == 1 and len(db.upserts[0]) == 2

    @pytest.mark.asyncio
    async def test_no_history_picks_five_now(self):
        res, db, _ = await _call([], picker=lambda risk, excl, n: [_pick(t) for t in "VWXYZ"][:n])
        assert len(res["results"]) == 5
        assert db.upserts

    @pytest.mark.asyncio
    async def test_last_weeks_list_is_replaced_after_job_grace(self):
        old = datetime(2026, 9, 20, 16, 10, tzinfo=timezone.utc)
        rows = [_row(t, old) for t in "ABCDE"]
        res, _, _ = await _call(rows, picker=lambda risk, excl, n: [_pick(t) for t in "VWXYZ" if t not in excl][:n], now_offset_hours=24)
        assert [r["ticker"] for r in res["results"]] == list("VWXYZ")

    @pytest.mark.asyncio
    async def test_during_job_grace_last_weeks_list_still_shows(self):
        old = datetime(2026, 9, 20, 16, 10, tzinfo=timezone.utc)
        rows = [_row(t, old) for t in "ABCDE"]
        res, db, _ = await _call(rows, picker=lambda *a, **k: pytest.fail("must not race the job"), now_offset_hours=1)
        assert [r["ticker"] for r in res["results"]] == list("ABCDE")
        assert db.upserts == []

    @pytest.mark.asyncio
    async def test_exhausted_never_sent_pool_falls_back_to_older_real_tickers(self):
        ws = datetime(2026, 9, 27, 16, 10, 30, tzinfo=timezone.utc)
        rows = [_row(t, ws) for t in "ABC"] + [_row(t, ws - timedelta(days=7)) for t in "QR"]
        universe = list("ABCQR")
        res, _, _ = await _call(rows, picker=lambda risk, excl, n: [_pick(t) for t in universe if t not in excl][:n])
        assert sorted(r["ticker"] for r in res["results"]) == list("ABCQR")


def test_week_start_is_most_recent_sunday_1210_et():
    ws = screener._weekly_opportunities_week_start()
    from zoneinfo import ZoneInfo
    et = ws.astimezone(ZoneInfo("America/New_York"))
    assert et.weekday() == 6 and (et.hour, et.minute) == (12, 10)
    assert timedelta(0) <= datetime.now(timezone.utc) - ws < timedelta(days=7)
