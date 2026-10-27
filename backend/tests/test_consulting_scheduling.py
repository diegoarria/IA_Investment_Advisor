"""MY NUVOS self-service scheduling — slot generation + booking tests.

_compute_open_slots is pure date math once its 3 Supabase reads
(availability pattern, this instructor's enrollments, already-booked
sessions) are in hand, so these mock those reads directly rather than a
full fake query chain — the thing actually worth testing here is the
date/weekday/taken-slot logic, not Supabase's query builder.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.routes import consulting as c


def _result(data):
    r = AsyncMock()
    r.data = data
    return r


class TestComputeOpenSlots:
    @pytest.mark.asyncio
    async def test_no_availability_returns_no_slots(self):
        with patch.object(c, "run_query", new=AsyncMock(return_value=_result([]))):
            slots = await c._compute_open_slots(MagicMock(), "instr1")
        assert slots == []

    @pytest.mark.asyncio
    async def test_generates_slots_on_the_matching_weekday_only(self):
        # Pick a weekday far enough in the future that "today" never
        # collides with it, so the test doesn't depend on which day it runs.
        target_weekday = (datetime.now(timezone.utc).weekday() + 3) % 7
        availability = [{"weekday": target_weekday, "start_time": "09:00:00", "end_time": "11:00:00", "slot_minutes": 50}]
        with patch.object(c, "run_query", new=AsyncMock(side_effect=[
            _result(availability),  # consulting_availability
            _result([]),            # consulting_enrollments (no existing enrollments -> no taken slots)
        ])):
            slots = await c._compute_open_slots(MagicMock(), "instr1", days_ahead=21)
        assert len(slots) > 0
        for s in slots:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(c._TZ)
            assert dt.weekday() == target_weekday

    @pytest.mark.asyncio
    async def test_already_booked_slot_is_excluded(self):
        target_weekday = (datetime.now(timezone.utc).weekday() + 3) % 7
        availability = [{"weekday": target_weekday, "start_time": "09:00:00", "end_time": "09:50:00", "slot_minutes": 50}]
        # Find the exact slot datetime _compute_open_slots would generate,
        # then mark it as already taken.
        now_local = datetime.now(c._TZ)
        for offset in range(1, 22):
            day = (now_local + timedelta(days=offset)).date()
            if day.weekday() == target_weekday:
                from datetime import time as _time
                slot_dt = datetime.combine(day, _time(9, 0), tzinfo=c._TZ)
                break
        taken_iso = slot_dt.astimezone(timezone.utc).isoformat()

        with patch.object(c, "run_query", new=AsyncMock(side_effect=[
            _result(availability),
            _result([{"id": "enroll1"}]),
            _result([{"scheduled_at": taken_iso}]),
        ])):
            slots = await c._compute_open_slots(MagicMock(), "instr1", days_ahead=21)
        assert taken_iso not in slots


class TestBookSession:
    @pytest.mark.asyncio
    async def test_booking_a_slot_not_in_current_availability_is_rejected(self):
        enrollment = {"id": "enroll1", "user_id": "student1", "instructor_id": "instr1"}
        future = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
        with patch.object(c, "get_supabase", return_value=object()), \
             patch.object(c, "_require_role", new=AsyncMock(return_value="student")), \
             patch.object(c, "_require_own_active_enrollment", new=AsyncMock(return_value=enrollment)), \
             patch.object(c, "_compute_open_slots", new=AsyncMock(return_value=[])):
            from fastapi import HTTPException
            with pytest.raises(HTTPException) as exc:
                await c.book_session(c.BookSessionBody(scheduled_at=future), {"id": "student1", "email": "s@e.com"})
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_student_with_no_instructor_cannot_book(self):
        enrollment = {"id": "enroll1", "user_id": "student1", "instructor_id": None}
        future = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
        with patch.object(c, "get_supabase", return_value=object()), \
             patch.object(c, "_require_role", new=AsyncMock(return_value="student")), \
             patch.object(c, "_require_own_active_enrollment", new=AsyncMock(return_value=enrollment)):
            from fastapi import HTTPException
            with pytest.raises(HTTPException) as exc:
                await c.book_session(c.BookSessionBody(scheduled_at=future), {"id": "student1", "email": "s@e.com"})
        assert exc.value.status_code == 422
