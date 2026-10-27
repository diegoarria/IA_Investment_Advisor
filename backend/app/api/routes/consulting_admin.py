"""MY NUVOS admin panel (nuvosai.com/consulting/admin) — staff-only API.

Approved 2026-10-26 ("está excelente constrúyelo de manera real") after
the design review. Builds on app/api/routes/consulting.py's role/
ownership helpers (imported below, not duplicated) and migration 121's
schema additions (consulting_profiles, consulting_payments,
consulting_objectives, consulting_private_notes,
consulting_session_reports, plus the nullable
consulting_assignments.enrollment_id/due_at for one-off exercises).

Every route here is staff-only (instructor or program_admin) — a plain
student role never reaches anything in this file. An instructor is
further scoped to only the enrollments where they're the assigned
instructor (_require_staff_access_to_enrollment, same as consulting.py);
program_admin reaches everyone. Enrollment creation and staff role
changes are program_admin-only — an instructor cannot create accounts
or grant themselves (or anyone) broader access.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.api.routes.consulting import (
    _require_enrollment_by_id,
    _require_role,
    _require_staff_access_to_enrollment,
)
from app.core.database import get_supabase, run_query
from app.services.consulting_audit import log_consulting_action

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/consulting/admin", tags=["consulting-admin"])

STAFF_ROLES = ("instructor", "program_admin")


async def _staff_scope(db, user: dict) -> tuple[str, str]:
    """Returns (role, user_id) after confirming staff access — every
    list/aggregate route below uses this to decide whether to filter by
    instructor_id or show everyone."""
    role = await _require_role(user, STAFF_ROLES)
    return role, user["id"]


# ── Participants list ───────────────────────────────────────────────────

@router.get("/participants")
async def list_participants(user: dict = Depends(get_current_user)):
    db = get_supabase()
    role, uid = await _staff_scope(db, user)

    q = db.table("consulting_enrollments").select("*")
    if role == "instructor":
        q = q.eq("instructor_id", uid)
    enroll_res = await run_query(q)
    enrollments = enroll_res.data or []
    if not enrollments:
        return {"participants": []}
    ids = [e["id"] for e in enrollments]

    profiles_res, sessions_res, assignments_res, submissions_res, payments_res = await asyncio.gather(
        run_query(db.table("consulting_profiles").select("*").in_("user_id", [e["user_id"] for e in enrollments])),
        run_query(db.table("consulting_sessions").select("id,enrollment_id,scheduled_at,status").in_("enrollment_id", ids)),
        run_query(db.table("consulting_assignments").select("id,enrollment_id,module_id").in_("enrollment_id", ids)),
        run_query(db.table("consulting_submissions").select("assignment_id,enrollment_id,submitted_at").in_("enrollment_id", ids)),
        run_query(db.table("consulting_payments").select("*").in_("enrollment_id", ids)),
    )
    profile_by_user = {p["user_id"]: p for p in (profiles_res.data or [])}
    payment_by_enrollment = {p["enrollment_id"]: p for p in (payments_res.data or [])}

    sessions_by_enrollment: dict[str, list] = {}
    for s in (sessions_res.data or []):
        sessions_by_enrollment.setdefault(s["enrollment_id"], []).append(s)

    adhoc_assignment_ids_by_enrollment: dict[str, set] = {}
    for a in (assignments_res.data or []):
        if a.get("enrollment_id"):
            adhoc_assignment_ids_by_enrollment.setdefault(a["enrollment_id"], set()).add(a["id"])

    submitted_assignment_ids: set = {s["assignment_id"] for s in (submissions_res.data or [])}
    last_submission_by_enrollment: dict[str, str] = {}
    for s in (submissions_res.data or []):
        eid = s["enrollment_id"]
        if eid not in last_submission_by_enrollment or s["submitted_at"] > last_submission_by_enrollment[eid]:
            last_submission_by_enrollment[eid] = s["submitted_at"]

    now = datetime.now(timezone.utc)
    out = []
    for e in enrollments:
        eid = e["id"]
        profile = profile_by_user.get(e["user_id"], {})
        sessions = sessions_by_enrollment.get(eid, [])
        completed = [s for s in sessions if s["status"] == "completed"]
        upcoming = sorted([s for s in sessions if s["status"] == "scheduled"], key=lambda s: s["scheduled_at"])
        pending_count = len(adhoc_assignment_ids_by_enrollment.get(eid, set()) - submitted_assignment_ids)
        payment = payment_by_enrollment.get(eid, {"status": "al_dia"})

        last_session_at = max((s["scheduled_at"] for s in completed), default=None)
        last_submission_at = last_submission_by_enrollment.get(eid)
        candidates = [d for d in (last_session_at, last_submission_at, e.get("created_at")) if d]
        last_interaction = max(candidates) if candidates else None

        alerts = []
        if payment.get("status") == "atrasado":
            alerts.append("payment_overdue")
        if last_interaction:
            try:
                days_since = (now - datetime.fromisoformat(last_interaction.replace("Z", "+00:00"))).days
                if days_since >= 14 and e.get("status") == "active":
                    alerts.append("inactivity_risk")
            except Exception:
                pass
        if not upcoming and e.get("status") == "active":
            alerts.append("no_session_scheduled")

        out.append({
            "enrollment_id": eid,
            "user_id": e["user_id"],
            "full_name": profile.get("full_name") or "(sin nombre registrado)",
            "company": profile.get("company"),
            "created_at": e.get("created_at"),
            "status": e.get("status"),
            "current_module_id": e.get("current_module_id"),
            "sessions_completed": len(completed),
            "next_session_at": upcoming[0]["scheduled_at"] if upcoming else None,
            "pending_assignments": pending_count,
            "payment_status": payment.get("status"),
            "last_interaction": last_interaction,
            "alerts": alerts,
        })

    out.sort(key=lambda p: p["full_name"])
    return {"participants": out}


# ── Participant detail (expediente) ─────────────────────────────────────

@router.get("/participants/{enrollment_id}/competencies")
async def list_participant_competencies(enrollment_id: str, user: dict = Depends(get_current_user)):
    """Feeds the competency dropdown on the close-session form — resolved
    via enrollment → cohort → program, so staff only ever see the
    competency catalog that actually applies to this participant's
    program."""
    db = get_supabase()
    await _staff_scope(db, user)
    enrollment = await _require_enrollment_by_id(db, enrollment_id)
    await _require_staff_access_to_enrollment(db, user, enrollment)
    cohort_res = await run_query(db.table("consulting_cohorts").select("program_id").eq("id", enrollment["cohort_id"]).maybe_single())
    program_id = (cohort_res.data or {}).get("program_id") if cohort_res else None
    if not program_id:
        return {"competencies": []}
    res = await run_query(db.table("consulting_competencies").select("*").eq("program_id", program_id))
    return {"competencies": res.data or []}


@router.get("/participants/{enrollment_id}")
async def get_participant_detail(enrollment_id: str, user: dict = Depends(get_current_user)):
    db = get_supabase()
    role, uid = await _staff_scope(db, user)
    enrollment = await _require_enrollment_by_id(db, enrollment_id)
    await _require_staff_access_to_enrollment(db, user, enrollment)

    (profile_res, sessions_res, objectives_res, notes_res, assignments_res,
     submissions_res, assessments_res, payment_res, final_project_res, graduation_res) = await asyncio.gather(
        run_query(db.table("consulting_profiles").select("*").eq("user_id", enrollment["user_id"]).maybe_single()),
        run_query(db.table("consulting_sessions").select("*").eq("enrollment_id", enrollment_id).order("scheduled_at", desc=True)),
        run_query(db.table("consulting_objectives").select("*").eq("enrollment_id", enrollment_id).order("order_index")),
        run_query(db.table("consulting_private_notes").select("*").eq("enrollment_id", enrollment_id).order("created_at", desc=True)),
        run_query(db.table("consulting_assignments").select("*").eq("enrollment_id", enrollment_id)),
        run_query(db.table("consulting_submissions").select("*").eq("enrollment_id", enrollment_id)),
        run_query(db.table("consulting_assessments").select("*").eq("enrollment_id", enrollment_id).order("assessed_at", desc=True)),
        run_query(db.table("consulting_payments").select("*").eq("enrollment_id", enrollment_id).maybe_single()),
        run_query(db.table("consulting_final_projects").select("*").eq("enrollment_id", enrollment_id).maybe_single()),
        run_query(db.table("consulting_graduations").select("*").eq("enrollment_id", enrollment_id).maybe_single()),
        return_exceptions=True,
    )

    def _data(res):
        return None if isinstance(res, Exception) else res.data

    sessions = _data(sessions_res) or []
    total = len([s for s in sessions if s["status"] in ("completed", "scheduled")])
    attended = len([s for s in sessions if s["status"] == "completed"])

    return {
        "enrollment": enrollment,
        "profile": _data(profile_res),
        "sessions": sessions,
        "objectives": _data(objectives_res) or [],
        "private_notes": _data(notes_res) or [],
        "assignments": _data(assignments_res) or [],
        "submissions": _data(submissions_res) or [],
        "assessments": _data(assessments_res) or [],
        "attendance": {"attended": attended, "total": total},
        "payment": _data(payment_res),
        "final_project": _data(final_project_res),
        "graduation": _data(graduation_res),
    }


# ── Private notes ────────────────────────────────────────────────────────

class PrivateNoteBody(BaseModel):
    enrollment_id: str
    note: str


@router.post("/private-notes")
async def add_private_note(body: PrivateNoteBody, user: dict = Depends(get_current_user)):
    db = get_supabase()
    await _staff_scope(db, user)
    enrollment = await _require_enrollment_by_id(db, body.enrollment_id)
    await _require_staff_access_to_enrollment(db, user, enrollment)
    res = await run_query(
        db.table("consulting_private_notes").insert({
            "enrollment_id": body.enrollment_id, "author_id": user["id"], "note": body.note,
        })
    )
    log_consulting_action(user.get("email") or user["id"], "private_note_added", body.enrollment_id)
    return res.data[0] if res and res.data else {}


# ── Payments ──────────────────────────────────────────────────────────────

class PaymentUpdateBody(BaseModel):
    status: str
    plan: str | None = None
    next_charge_at: str | None = None
    notes: str | None = None


@router.put("/payments/{enrollment_id}")
async def update_payment(enrollment_id: str, body: PaymentUpdateBody, user: dict = Depends(get_current_user)):
    db = get_supabase()
    await _staff_scope(db, user)
    enrollment = await _require_enrollment_by_id(db, enrollment_id)
    await _require_staff_access_to_enrollment(db, user, enrollment)
    update = {"status": body.status, "updated_by": user["id"], "updated_at": datetime.now(timezone.utc).isoformat()}
    if body.plan:
        update["plan"] = body.plan
    if body.next_charge_at:
        update["next_charge_at"] = body.next_charge_at
    if body.notes is not None:
        update["notes"] = body.notes
    await run_query(
        db.table("consulting_payments").upsert({**update, "enrollment_id": enrollment_id}, on_conflict="enrollment_id")
    )
    log_consulting_action(user.get("email") or user["id"], "payment_status_changed", enrollment_id, body.status)
    return {"ok": True}


# ── Close a session ──────────────────────────────────────────────────────

class CloseSessionBody(BaseModel):
    enrollment_id: str
    session_id: str | None = None   # closes this scheduled session if given
    scheduled_at: str | None = None  # required when session_id is omitted
    topics: str
    objectives_met: str
    strengths: str
    growth_areas: str
    competency_id: str | None = None
    competency_level: str | None = None
    exercise_title: str | None = None
    exercise_due_at: str | None = None
    next_session_at: str | None = None


@router.post("/close-session")
async def close_session(body: CloseSessionBody, user: dict = Depends(get_current_user)):
    """The <5-minute form. Writes everything in one call and returns the
    generated draft Session Report's id so the client can route straight
    to reviewing it. The draft is built directly from these structured
    fields — no LLM call — since the form's own fields already ARE the
    report's content; a template keeps this fast, free, and predictable,
    which matters more here than narrative polish for an internal ops
    form. Staff edit the draft in /reports/{id} before publishing."""
    db = get_supabase()
    await _staff_scope(db, user)
    enrollment = await _require_enrollment_by_id(db, body.enrollment_id)
    await _require_staff_access_to_enrollment(db, user, enrollment)

    notes = f"Temas cubiertos: {body.topics}\n\nObjetivos alcanzados: {body.objectives_met}"
    if body.session_id:
        await run_query(
            db.table("consulting_sessions").update({"status": "completed", "notes": notes}).eq("id", body.session_id)
        )
        session_id = body.session_id
    else:
        if not body.scheduled_at:
            raise HTTPException(status_code=422, detail="Falta la fecha de la sesión")
        ins = await run_query(
            db.table("consulting_sessions").insert({
                "enrollment_id": body.enrollment_id, "scheduled_at": body.scheduled_at,
                "status": "completed", "notes": notes,
            })
        )
        session_id = ins.data[0]["id"]

    if body.competency_id and body.competency_level:
        await run_query(
            db.table("consulting_assessments").insert({
                "enrollment_id": body.enrollment_id, "competency_id": body.competency_id,
                "level": body.competency_level, "observation": body.strengths, "assessed_by": user["id"],
            })
        )

    next_assignment_text = None
    if body.exercise_title:
        await run_query(
            db.table("consulting_assignments").insert({
                "enrollment_id": body.enrollment_id, "module_id": None,
                "title": body.exercise_title, "due_at": body.exercise_due_at,
            })
        )
        next_assignment_text = body.exercise_title
        if body.exercise_due_at:
            next_assignment_text += f" — vence {body.exercise_due_at[:10]}"

    if body.next_session_at:
        await run_query(
            db.table("consulting_sessions").insert({
                "enrollment_id": body.enrollment_id, "scheduled_at": body.next_session_at, "status": "scheduled",
            })
        )

    report_res = await run_query(
        db.table("consulting_session_reports").insert({
            "session_id": session_id, "enrollment_id": body.enrollment_id,
            "summary": body.topics, "achievements": body.objectives_met,
            "strengths": body.strengths, "growth_areas": body.growth_areas,
            "next_assignment_text": next_assignment_text,
        })
    )
    log_consulting_action(user.get("email") or user["id"], "session_closed", body.enrollment_id, session_id)
    return report_res.data[0] if report_res and report_res.data else {}


# ── Session reports ──────────────────────────────────────────────────────

@router.get("/reports/{report_id}")
async def get_report(report_id: str, user: dict = Depends(get_current_user)):
    db = get_supabase()
    await _staff_scope(db, user)
    res = await run_query(db.table("consulting_session_reports").select("*").eq("id", report_id).maybe_single())
    if not res or not res.data:
        raise HTTPException(status_code=404, detail="Reporte no encontrado")
    enrollment = await _require_enrollment_by_id(db, res.data["enrollment_id"])
    await _require_staff_access_to_enrollment(db, user, enrollment)
    return res.data


class ReportUpdateBody(BaseModel):
    summary: str | None = None
    achievements: str | None = None
    strengths: str | None = None
    growth_areas: str | None = None
    next_assignment_text: str | None = None


@router.put("/reports/{report_id}")
async def update_report(report_id: str, body: ReportUpdateBody, user: dict = Depends(get_current_user)):
    db = get_supabase()
    await _staff_scope(db, user)
    res = await run_query(db.table("consulting_session_reports").select("enrollment_id, status").eq("id", report_id).maybe_single())
    if not res or not res.data:
        raise HTTPException(status_code=404, detail="Reporte no encontrado")
    enrollment = await _require_enrollment_by_id(db, res.data["enrollment_id"])
    await _require_staff_access_to_enrollment(db, user, enrollment)
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if update:
        await run_query(db.table("consulting_session_reports").update(update).eq("id", report_id))
    return {"ok": True}


@router.post("/reports/{report_id}/publish")
async def publish_report(report_id: str, user: dict = Depends(get_current_user)):
    """Copies the (possibly edited) draft into the session's own `notes`
    field — the exact field GET /consulting/sessions/{id} already serves
    to the student — instead of a second student-facing read path."""
    db = get_supabase()
    await _staff_scope(db, user)
    res = await run_query(db.table("consulting_session_reports").select("*").eq("id", report_id).maybe_single())
    if not res or not res.data:
        raise HTTPException(status_code=404, detail="Reporte no encontrado")
    report = res.data
    enrollment = await _require_enrollment_by_id(db, report["enrollment_id"])
    await _require_staff_access_to_enrollment(db, user, enrollment)

    parts = [report.get("summary") or ""]
    if report.get("achievements"):
        parts.append(f"Logros: {report['achievements']}")
    if report.get("strengths"):
        parts.append(f"Fortalezas: {report['strengths']}")
    if report.get("growth_areas"):
        parts.append(f"Para seguir trabajando: {report['growth_areas']}")
    if report.get("next_assignment_text"):
        parts.append(f"Tu siguiente entrega: {report['next_assignment_text']}")
    student_notes = "\n\n".join(p for p in parts if p)

    await run_query(db.table("consulting_sessions").update({"notes": student_notes}).eq("id", report["session_id"]))
    await run_query(
        db.table("consulting_session_reports").update({
            "status": "published", "published_at": datetime.now(timezone.utc).isoformat(), "published_by": user["id"],
        }).eq("id", report_id)
    )
    log_consulting_action(user.get("email") or user["id"], "report_published", report["enrollment_id"], report_id)
    return {"ok": True}


# ── Calendar ──────────────────────────────────────────────────────────────

@router.get("/calendar")
async def admin_calendar(days: int = 30, user: dict = Depends(get_current_user)):
    """Every scheduled session in the next `days` days, in the staff
    member's own scope — an instructor sees only their own students'
    sessions, program_admin sees everyone's."""
    db = get_supabase()
    role, uid = await _staff_scope(db, user)
    q = db.table("consulting_enrollments").select("id, instructor_id, user_id")
    if role == "instructor":
        q = q.eq("instructor_id", uid)
    enroll_res = await run_query(q)
    enrollments = enroll_res.data or []
    if not enrollments:
        return {"sessions": []}
    ids = [e["id"] for e in enrollments]
    enrollment_by_id = {e["id"]: e for e in enrollments}

    now = datetime.now(timezone.utc)
    sess_res = await run_query(
        db.table("consulting_sessions").select("*")
        .in_("enrollment_id", ids).eq("status", "scheduled")
        .gte("scheduled_at", now.isoformat())
        .lte("scheduled_at", (now + timedelta(days=days)).isoformat())
        .order("scheduled_at")
    )
    sessions = sess_res.data or []

    user_ids = list({enrollment_by_id[s["enrollment_id"]]["user_id"] for s in sessions if s["enrollment_id"] in enrollment_by_id})
    profile_by_user: dict[str, str] = {}
    if user_ids:
        prof_res = await run_query(db.table("consulting_profiles").select("user_id, full_name").in_("user_id", user_ids))
        profile_by_user = {p["user_id"]: p["full_name"] for p in (prof_res.data or [])}

    out = []
    for s in sessions:
        e = enrollment_by_id.get(s["enrollment_id"], {})
        out.append({
            "session_id": s["id"], "enrollment_id": s["enrollment_id"],
            "scheduled_at": s["scheduled_at"], "agenda": s.get("agenda"),
            "participant_name": profile_by_user.get(e.get("user_id", ""), "(sin nombre)"),
        })
    return {"sessions": out}


# ── Availability (what students see as open slots) ──────────────────────

@router.get("/availability")
async def get_my_availability(user: dict = Depends(get_current_user)):
    db = get_supabase()
    _, uid = await _staff_scope(db, user)
    res = await run_query(db.table("consulting_availability").select("*").eq("instructor_id", uid).order("weekday"))
    return {"availability": res.data or []}


class AvailabilityBlock(BaseModel):
    weekday: int
    start_time: str
    end_time: str
    slot_minutes: int = 50


class AvailabilityBody(BaseModel):
    blocks: list[AvailabilityBlock]


@router.put("/availability")
async def set_my_availability(body: AvailabilityBody, user: dict = Depends(get_current_user)):
    """Replaces the whole weekly pattern in one call — staff edits their
    hours as a set, not row by row, so a changed schedule can never leave
    a stale block behind that they forgot to delete."""
    db = get_supabase()
    _, uid = await _staff_scope(db, user)
    await run_query(db.table("consulting_availability").delete().eq("instructor_id", uid))
    if body.blocks:
        await run_query(
            db.table("consulting_availability").insert([
                {"instructor_id": uid, "weekday": b.weekday, "start_time": b.start_time, "end_time": b.end_time, "slot_minutes": b.slot_minutes}
                for b in body.blocks
            ])
        )
    log_consulting_action(user.get("email") or user["id"], "availability_updated", None, f"{len(body.blocks)} bloques")
    return {"ok": True}


# ── Cohorts (for the "alta de alumno" form) ──────────────────────────────

@router.get("/cohorts")
async def list_cohorts(user: dict = Depends(get_current_user)):
    await _require_role(user, ("program_admin",))
    db = get_supabase()
    res = await run_query(db.table("consulting_cohorts").select("*, consulting_programs(name)").order("starts_at", desc=True))
    return {"cohorts": res.data or []}


# ── Enrollment (alta de alumno) ──────────────────────────────────────────

class NewEnrollmentBody(BaseModel):
    full_name: str
    email: str
    company: str | None = None
    role_title: str | None = None
    cohort_id: str
    instructor_id: str | None = None
    payment_plan: str = "monthly"


@router.post("/enrollments")
async def create_enrollment(body: NewEnrollmentBody, user: dict = Depends(get_current_user)):
    """program_admin only — an instructor can manage their own students
    but never create accounts or assign themselves new ones. Creates the
    Supabase Auth account if it doesn't exist yet (invite email via
    GoTrue's own admin.invite_user_by_email — a failure there, e.g. SMTP
    not configured on this Supabase project, does NOT block the
    enrollment itself, it just means staff need to share access another
    way)."""
    await _require_role(user, ("program_admin",))
    db = get_supabase()
    email = body.email.strip().lower()

    from app.core.database import find_auth_user
    existing = await find_auth_user(db, email=email)
    invite_sent = False
    invite_error = None
    if existing:
        user_id = existing.id
    else:
        from app.core.config import settings
        base = settings.frontend_url.rstrip("/") if settings.frontend_url not in ("*", "", None) else "https://nuvosai.com"
        try:
            created = await asyncio.to_thread(
                db.auth.admin.invite_user_by_email, email, {"redirect_to": f"{base}/consulting"}
            )
            user_id = created.user.id
            invite_sent = True
        except Exception as e:
            logger.error("create_enrollment: invite_user_by_email failed for %s: %s", email, e)
            raise HTTPException(status_code=502, detail=f"No se pudo crear la cuenta: {e}")

    await run_query(
        db.table("consulting_profiles").upsert({
            "user_id": user_id, "full_name": body.full_name, "company": body.company, "role_title": body.role_title,
        }, on_conflict="user_id")
    )
    # Diego, 2026-10-27: confirmed live — testing this form with his own
    # (program_admin) email silently demoted him to 'student', because an
    # upsert here unconditionally overwrites whatever role already
    # existed. Enrolling someone must never touch an existing staff role
    # — only set 'student' when this account has NO role yet.
    existing_role_res = await run_query(
        db.table("consulting_user_roles").select("role").eq("user_id", user_id).maybe_single()
    )
    if not (existing_role_res and existing_role_res.data):
        await run_query(
            db.table("consulting_user_roles").insert({"user_id": user_id, "role": "student"})
        )
    enroll_res = await run_query(
        db.table("consulting_enrollments").insert({
            "user_id": user_id, "cohort_id": body.cohort_id, "instructor_id": body.instructor_id,
        })
    )
    enrollment = enroll_res.data[0] if enroll_res and enroll_res.data else {}
    if enrollment.get("id"):
        await run_query(
            db.table("consulting_payments").insert({"enrollment_id": enrollment["id"], "plan": body.payment_plan})
        )
    log_consulting_action(user.get("email") or user["id"], "enrollment_created", enrollment.get("id"), email)
    return {"enrollment": enrollment, "invite_sent": invite_sent, "invite_error": invite_error}


# ── Audit log ─────────────────────────────────────────────────────────────

@router.get("/audit")
async def admin_audit_log(limit: int = 200, user: dict = Depends(get_current_user)):
    db = get_supabase()
    await _require_role(user, ("program_admin",))
    res = await run_query(
        db.table("consulting_audit_log").select("*").order("created_at", desc=True).limit(max(1, min(limit, 1000)))
    )
    return {"entries": res.data or []}


# ── Team / permissions ────────────────────────────────────────────────────

@router.get("/team")
async def list_team(user: dict = Depends(get_current_user)):
    db = get_supabase()
    await _require_role(user, ("program_admin",))
    roles_res = await run_query(db.table("consulting_user_roles").select("*").in_("role", list(STAFF_ROLES)))
    staff = roles_res.data or []
    if not staff:
        return {"team": []}
    staff_ids = [s["user_id"] for s in staff]
    counts_res = await run_query(db.table("consulting_enrollments").select("instructor_id").in_("instructor_id", staff_ids))
    counts: dict[str, int] = {}
    for row in (counts_res.data or []):
        counts[row["instructor_id"]] = counts.get(row["instructor_id"], 0) + 1

    out = []
    for s in staff:
        try:
            from app.core.database import find_auth_user
            auth_user = await find_auth_user(db, user_id=s["user_id"])
            email = auth_user.email if auth_user else None
        except Exception:
            email = None
        out.append({"user_id": s["user_id"], "email": email, "role": s["role"], "assigned_students": counts.get(s["user_id"], 0)})
    return {"team": out}


class RoleUpdateBody(BaseModel):
    role: str


@router.put("/team/{target_user_id}/role")
async def update_team_role(target_user_id: str, body: RoleUpdateBody, user: dict = Depends(get_current_user)):
    await _require_role(user, ("program_admin",))
    if body.role not in ("instructor", "program_admin"):
        raise HTTPException(status_code=422, detail="Rol inválido")
    db = get_supabase()
    await run_query(db.table("consulting_user_roles").upsert({"user_id": target_user_id, "role": body.role}, on_conflict="user_id"))
    log_consulting_action(user.get("email") or user["id"], "staff_role_changed", None, f"{target_user_id} -> {body.role}")
    return {"ok": True}
