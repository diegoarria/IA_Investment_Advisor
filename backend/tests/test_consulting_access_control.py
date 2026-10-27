"""MY NUVOS (Nuvos Consulting) — access-control unit tests.

The security-critical guarantee of app/api/routes/consulting.py is that
a student can never reach another student's data, and an instructor can
never reach a student outside their own assigned cohort — these tests
exercise exactly that, directly against the permission primitives rather
than a full fake Supabase query chain (which can't meaningfully express
"only this one filtered row comes back").
"""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.api.routes import consulting


def _result(data):
    r = AsyncMock()
    r.data = data
    return r


class TestRequireRole:
    @pytest.mark.asyncio
    async def test_allowed_role_passes(self):
        with patch.object(consulting, "get_supabase", return_value=object()), \
             patch.object(consulting, "_get_role", new=AsyncMock(return_value="student")):
            role = await consulting._require_role({"id": "u1"}, ("student",))
        assert role == "student"

    @pytest.mark.asyncio
    async def test_disallowed_role_raises_403(self):
        with patch.object(consulting, "get_supabase", return_value=object()), \
             patch.object(consulting, "_get_role", new=AsyncMock(return_value="student")):
            with pytest.raises(HTTPException) as exc:
                await consulting._require_role({"id": "u1"}, ("instructor", "program_admin"))
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_no_role_at_all_raises_403(self):
        """A Nuvos AI user with no consulting_user_roles row — the default
        for every existing investing-app user — must never pass any
        consulting role check."""
        with patch.object(consulting, "get_supabase", return_value=object()), \
             patch.object(consulting, "_get_role", new=AsyncMock(return_value=None)):
            with pytest.raises(HTTPException) as exc:
                await consulting._require_role({"id": "u1"}, ("student", "instructor", "program_admin"))
        assert exc.value.status_code == 403


class TestStaffAccessToEnrollment:
    @pytest.mark.asyncio
    async def test_program_admin_may_access_any_enrollment(self):
        with patch.object(consulting, "_get_role", new=AsyncMock(return_value="program_admin")):
            await consulting._require_staff_access_to_enrollment(
                object(), {"id": "admin1"}, {"instructor_id": "someone_else"}
            )  # must not raise

    @pytest.mark.asyncio
    async def test_instructor_may_access_their_own_assigned_enrollment(self):
        with patch.object(consulting, "_get_role", new=AsyncMock(return_value="instructor")):
            await consulting._require_staff_access_to_enrollment(
                object(), {"id": "instr1"}, {"instructor_id": "instr1"}
            )  # must not raise

    @pytest.mark.asyncio
    async def test_instructor_cannot_access_a_different_instructors_student(self):
        """The core cross-user guarantee for staff: Instructor A must never
        reach Instructor B's student, even though both are 'instructor'."""
        with patch.object(consulting, "_get_role", new=AsyncMock(return_value="instructor")):
            with pytest.raises(HTTPException) as exc:
                await consulting._require_staff_access_to_enrollment(
                    object(), {"id": "instr_A"}, {"instructor_id": "instr_B"}
                )
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_student_role_never_passes_staff_check(self):
        with patch.object(consulting, "_get_role", new=AsyncMock(return_value="student")):
            with pytest.raises(HTTPException) as exc:
                await consulting._require_staff_access_to_enrollment(
                    object(), {"id": "student1"}, {"instructor_id": "student1"}
                )
        assert exc.value.status_code == 403


class TestSignedUrlOwnership:
    """GET /documents/{path}/signed-url — a student must only ever get a
    signed URL for a path prefixed with THEIR OWN enrollment_id."""

    @pytest.mark.asyncio
    async def test_student_cannot_request_another_students_document(self):
        other_enrollment = {"id": "enroll_B", "user_id": "student_B", "instructor_id": "instr1"}
        with patch.object(consulting, "get_supabase", return_value=object()), \
             patch.object(consulting, "_require_enrollment_by_id", new=AsyncMock(return_value=other_enrollment)), \
             patch.object(consulting, "_get_role", new=AsyncMock(return_value="student")):
            with pytest.raises(HTTPException) as exc:
                await consulting.get_signed_url("enroll_B/final-project/plan.pdf", {"id": "student_A"})
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_student_can_request_their_own_document(self):
        own_enrollment = {"id": "enroll_A", "user_id": "student_A", "instructor_id": "instr1"}
        fake_signed = AsyncMock()
        fake_signed.data = {"signedUrl": "https://signed.example/enroll_A/final-project/plan.pdf?token=abc"}
        with patch.object(consulting, "get_supabase") as mock_get_db, \
             patch.object(consulting, "_require_enrollment_by_id", new=AsyncMock(return_value=own_enrollment)), \
             patch.object(consulting, "_get_role", new=AsyncMock(return_value="student")), \
             patch.object(consulting, "run_query", new=AsyncMock(return_value=fake_signed)):
            mock_get_db.return_value.storage.from_.return_value.create_signed_url.return_value = None
            result = await consulting.get_signed_url("enroll_A/final-project/plan.pdf", {"id": "student_A"})
        assert result["url"] == "https://signed.example/enroll_A/final-project/plan.pdf?token=abc"
