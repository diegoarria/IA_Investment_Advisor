"""MY NUVOS admin panel — access-control unit tests.

Mirrors tests/test_consulting_access_control.py's approach: exercise the
permission primitives directly rather than a full fake Supabase chain.
The two guarantees that matter most for an internal staff tool: (1) a
student role never reaches ANY /consulting/admin/* route, and (2) an
instructor is scoped to only their own assigned students even for staff
actions (close a session, publish a report, change payment status) —
never another instructor's.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.routes import consulting_admin as ca


class TestStaffScope:
    @pytest.mark.asyncio
    async def test_student_role_rejected(self):
        with patch("app.api.routes.consulting._get_role", new=AsyncMock(return_value="student")):
            with pytest.raises(HTTPException) as exc:
                await ca._staff_scope(object(), {"id": "u1"})
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_instructor_role_allowed(self):
        with patch("app.api.routes.consulting._get_role", new=AsyncMock(return_value="instructor")):
            role, uid = await ca._staff_scope(object(), {"id": "instr1"})
        assert role == "instructor"
        assert uid == "instr1"

    @pytest.mark.asyncio
    async def test_program_admin_allowed(self):
        with patch("app.api.routes.consulting._get_role", new=AsyncMock(return_value="program_admin")):
            role, _ = await ca._staff_scope(object(), {"id": "admin1"})
        assert role == "program_admin"


class TestCrossInstructorIsolation:
    @pytest.mark.asyncio
    async def test_close_session_rejects_a_different_instructors_student(self):
        other_enrollment = {"id": "enroll_B", "user_id": "student_B", "instructor_id": "instr_B"}
        body = ca.CloseSessionBody(
            enrollment_id="enroll_B", scheduled_at="2026-11-01T10:00:00Z",
            topics="x", objectives_met="x", strengths="x", growth_areas="x",
        )
        with patch.object(ca, "get_supabase", return_value=object()), \
             patch("app.api.routes.consulting._get_role", new=AsyncMock(return_value="instructor")), \
             patch.object(ca, "_require_enrollment_by_id", new=AsyncMock(return_value=other_enrollment)):
            with pytest.raises(HTTPException) as exc:
                await ca.close_session(body, {"id": "instr_A", "email": "a@nuvosai.com"})
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_publish_report_rejects_a_different_instructors_student(self):
        report = {"id": "r1", "session_id": "s1", "enrollment_id": "enroll_B",
                  "summary": "x", "achievements": None, "strengths": None, "growth_areas": None, "next_assignment_text": None}
        other_enrollment = {"id": "enroll_B", "user_id": "student_B", "instructor_id": "instr_B"}
        fake_select = AsyncMock()
        fake_select.data = report
        with patch.object(ca, "get_supabase", return_value=MagicMock()), \
             patch("app.api.routes.consulting._get_role", new=AsyncMock(return_value="instructor")), \
             patch.object(ca, "run_query", new=AsyncMock(return_value=fake_select)), \
             patch.object(ca, "_require_enrollment_by_id", new=AsyncMock(return_value=other_enrollment)):
            with pytest.raises(HTTPException) as exc:
                await ca.publish_report("r1", {"id": "instr_A", "email": "a@nuvosai.com"})
        assert exc.value.status_code == 403


class TestEnrollmentCreationIsAdminOnly:
    @pytest.mark.asyncio
    async def test_instructor_cannot_create_enrollments(self):
        body = ca.NewEnrollmentBody(full_name="Nueva Alumna", email="nueva@empresa.com", cohort_id="cohort1")
        with patch.object(ca, "get_supabase", return_value=object()), \
             patch("app.api.routes.consulting._get_role", new=AsyncMock(return_value="instructor")):
            with pytest.raises(HTTPException) as exc:
                await ca.create_enrollment(body, {"id": "instr1", "email": "i@nuvosai.com"})
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_student_cannot_create_enrollments(self):
        body = ca.NewEnrollmentBody(full_name="Nueva Alumna", email="nueva@empresa.com", cohort_id="cohort1")
        with patch.object(ca, "get_supabase", return_value=object()), \
             patch("app.api.routes.consulting._get_role", new=AsyncMock(return_value="student")):
            with pytest.raises(HTTPException) as exc:
                await ca.create_enrollment(body, {"id": "stu1", "email": "s@empresa.com"})
        assert exc.value.status_code == 403


class TestTeamManagementIsAdminOnly:
    @pytest.mark.asyncio
    async def test_instructor_cannot_change_staff_roles(self):
        with patch.object(ca, "get_supabase", return_value=object()), \
             patch("app.api.routes.consulting._get_role", new=AsyncMock(return_value="instructor")):
            with pytest.raises(HTTPException) as exc:
                await ca.update_team_role("someone", ca.RoleUpdateBody(role="program_admin"), {"id": "instr1", "email": "i@nuvosai.com"})
        assert exc.value.status_code == 403
