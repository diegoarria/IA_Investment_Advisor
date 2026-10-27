"""MY NUVOS (Nuvos Consulting, learn.nuvosai.com) API.

Approved 2026-10-26 after the architecture review in this session (see
migrations 119/120 for the schema/bucket this depends on). Deliberately
isolated from every Nuvos AI (investing app) table and route: nothing
here reads or writes user_profiles, subscription_tier, or any portfolio/
watchlist table, and a consulting role (student/instructor/program_admin)
grants zero access to investing-app data — see consulting_user_roles'
migration comment for why this is its own table rather than reusing
is_admin or settings.admin_emails.

Auth: reuses the SAME Supabase-Auth-backed get_current_user/
get_current_user_id this whole backend already uses (same httpOnly
cookie / Bearer token, same auth.users row) — MY NUVOS participants are
new accounts in that same table, never linked to a Nuvos AI profile.

Primary access control is the explicit ownership filter in every query
below (enrollment.user_id == current user, or instructor_id == current
user for instructor routes) — RLS on the consulting_* tables (migration
119) is a defense-in-depth backstop, not the primary control, because
this backend always queries with the service-role key, which bypasses
RLS. See that migration's header comment.

File storage: the private `consulting-documents` bucket (migration 120).
The backend is the only thing that ever touches it directly; the browser
only ever gets a short-lived signed URL via GET /documents/{path}/signed-url,
after that route's own ownership check on the path's enrollment_id prefix.
"""
import asyncio
import logging
import zoneinfo
from datetime import datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.core.database import get_supabase, run_query
from app.services.consulting_audit import log_consulting_action

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/consulting", tags=["consulting"])

BUCKET = "consulting-documents"


# ── Role / ownership helpers ────────────────────────────────────────────

async def _get_role(db, user_id: str) -> str | None:
    res = await run_query(db.table("consulting_user_roles").select("role").eq("user_id", user_id).maybe_single())
    return (res.data or {}).get("role") if res and res.data else None


async def _require_role(user: dict, allowed: tuple[str, ...]) -> str:
    db = get_supabase()
    role = await _get_role(db, user["id"])
    if role not in allowed:
        raise HTTPException(status_code=403, detail="No autorizado para MY NUVOS")
    return role


async def _get_active_enrollment(db, user_id: str) -> dict | None:
    res = await run_query(
        db.table("consulting_enrollments").select("*").eq("user_id", user_id).eq("status", "active").limit(1)
    )
    return res.data[0] if res and res.data else None


async def _require_own_active_enrollment(user_id: str) -> dict:
    db = get_supabase()
    enrollment = await _get_active_enrollment(db, user_id)
    if not enrollment:
        raise HTTPException(status_code=404, detail="No tienes una inscripción activa en MY NUVOS")
    return enrollment


async def _require_enrollment_by_id(db, enrollment_id: str) -> dict:
    res = await run_query(db.table("consulting_enrollments").select("*").eq("id", enrollment_id).maybe_single())
    if not res or not res.data:
        raise HTTPException(status_code=404, detail="Inscripción no encontrada")
    return res.data


async def _require_staff_access_to_enrollment(db, user: dict, enrollment: dict) -> None:
    """An instructor may only touch enrollments where they're the assigned
    instructor; program_admin may touch any enrollment. Raises 403
    otherwise — never silently narrows results."""
    role = await _get_role(db, user["id"])
    if role == "program_admin":
        return
    if role == "instructor" and enrollment.get("instructor_id") == user["id"]:
        return
    raise HTTPException(status_code=403, detail="No autorizado para este alumno")


# ── Identity ─────────────────────────────────────────────────────────────

@router.get("/me")
async def consulting_me(user: dict = Depends(get_current_user)):
    db = get_supabase()
    role = await _get_role(db, user["id"])
    if not role:
        raise HTTPException(status_code=403, detail="No tienes acceso a MY NUVOS")
    enrollment = await _get_active_enrollment(db, user["id"]) if role == "student" else None
    return {"user_id": user["id"], "email": user.get("email"), "role": role, "enrollment": enrollment}


# ── Program / modules ────────────────────────────────────────────────────

@router.get("/program")
async def get_program(user: dict = Depends(get_current_user)):
    await _require_role(user, ("student",))
    db = get_supabase()
    enrollment = await _require_own_active_enrollment(user["id"])
    cohort_res = await run_query(db.table("consulting_cohorts").select("*").eq("id", enrollment["cohort_id"]).maybe_single())
    cohort = cohort_res.data if cohort_res else None
    program_id = (cohort or {}).get("program_id")
    modules_res = await run_query(
        db.table("consulting_modules").select("*").eq("program_id", program_id).order("order_index")
    )
    return {"cohort": cohort, "modules": modules_res.data or [], "current_module_id": enrollment.get("current_module_id")}


# ── Sessions ─────────────────────────────────────────────────────────────

class CreateSessionBody(BaseModel):
    enrollment_id: str
    scheduled_at: str
    mode: str = "video"
    agenda: str | None = None


@router.get("/sessions")
async def list_sessions(user: dict = Depends(get_current_user)):
    await _require_role(user, ("student",))
    enrollment = await _require_own_active_enrollment(user["id"])
    db = get_supabase()
    res = await run_query(
        db.table("consulting_sessions").select("*").eq("enrollment_id", enrollment["id"]).order("scheduled_at", desc=True)
    )
    return {"sessions": res.data or []}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, user: dict = Depends(get_current_user)):
    db = get_supabase()
    res = await run_query(db.table("consulting_sessions").select("*").eq("id", session_id).maybe_single())
    if not res or not res.data:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")
    session = res.data
    enrollment = await _require_enrollment_by_id(db, session["enrollment_id"])
    role = await _get_role(db, user["id"])
    if role == "student" and enrollment["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    if role in ("instructor", "program_admin"):
        await _require_staff_access_to_enrollment(db, user, enrollment)
    return session


@router.post("/sessions")
async def create_session(body: CreateSessionBody, user: dict = Depends(get_current_user)):
    await _require_role(user, ("instructor", "program_admin"))
    db = get_supabase()
    enrollment = await _require_enrollment_by_id(db, body.enrollment_id)
    await _require_staff_access_to_enrollment(db, user, enrollment)
    res = await run_query(
        db.table("consulting_sessions").insert({
            "enrollment_id": body.enrollment_id, "scheduled_at": body.scheduled_at,
            "mode": body.mode, "agenda": body.agenda,
        })
    )
    log_consulting_action(user.get("email") or user["id"], "session_created", body.enrollment_id)
    return res.data[0] if res and res.data else {}


# ── Self-service scheduling ───────────────────────────────────────────────
# consulting_availability (migration 122) is an instructor's RECURRING
# weekly pattern, not individual slot rows — open slots are computed here
# by expanding that pattern over the next few weeks and subtracting
# already-booked sessions, so there's nothing to keep in sync when an
# instructor changes their hours (see app/api/routes/consulting_admin.py's
# PUT /availability, where staff set that pattern).

_TZ = zoneinfo.ZoneInfo("America/Mexico_City")


def _parse_time(s: str) -> time:
    return datetime.strptime(s[:8], "%H:%M:%S").time()


async def _compute_open_slots(db, instructor_id: str, days_ahead: int = 21) -> list[str]:
    avail_res = await run_query(db.table("consulting_availability").select("*").eq("instructor_id", instructor_id))
    availability = avail_res.data or []
    if not availability:
        return []

    enroll_res = await run_query(db.table("consulting_enrollments").select("id").eq("instructor_id", instructor_id))
    enrollment_ids = [e["id"] for e in (enroll_res.data or [])]
    taken: set[datetime] = set()
    if enrollment_ids:
        now_utc = datetime.now(timezone.utc)
        sess_res = await run_query(
            db.table("consulting_sessions").select("scheduled_at")
            .in_("enrollment_id", enrollment_ids)
            .neq("status", "canceled")
            .gte("scheduled_at", now_utc.isoformat())
            .lte("scheduled_at", (now_utc + timedelta(days=days_ahead)).isoformat())
        )
        for s in (sess_res.data or []):
            try:
                taken.add(datetime.fromisoformat(s["scheduled_at"].replace("Z", "+00:00")))
            except Exception:
                pass

    now_local = datetime.now(_TZ)
    slots: list[str] = []
    for offset in range(days_ahead):
        day = (now_local + timedelta(days=offset)).date()
        weekday = day.weekday()
        for a in availability:
            if a["weekday"] != weekday:
                continue
            start_t, end_t = _parse_time(a["start_time"]), _parse_time(a["end_time"])
            step = timedelta(minutes=a["slot_minutes"])
            cur = datetime.combine(day, start_t, tzinfo=_TZ)
            end_dt = datetime.combine(day, end_t, tzinfo=_TZ)
            while cur + step <= end_dt:
                if cur > now_local and cur.astimezone(timezone.utc) not in taken:
                    slots.append(cur.astimezone(timezone.utc).isoformat())
                cur += step
    slots.sort()
    return slots


@router.get("/availability")
async def get_availability(user: dict = Depends(get_current_user)):
    await _require_role(user, ("student",))
    enrollment = await _require_own_active_enrollment(user["id"])
    if not enrollment.get("instructor_id"):
        return {"slots": [], "has_instructor": False}
    db = get_supabase()
    slots = await _compute_open_slots(db, enrollment["instructor_id"])
    return {"slots": slots, "has_instructor": True}


class BookSessionBody(BaseModel):
    scheduled_at: str  # must be one of the slots GET /availability just returned


@router.post("/sessions/book")
async def book_session(body: BookSessionBody, user: dict = Depends(get_current_user)):
    await _require_role(user, ("student",))
    enrollment = await _require_own_active_enrollment(user["id"])
    if not enrollment.get("instructor_id"):
        raise HTTPException(status_code=422, detail="Todavía no tienes un mentor asignado para agendar sesiones.")
    db = get_supabase()
    try:
        requested = datetime.fromisoformat(body.scheduled_at.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(status_code=422, detail="Fecha inválida")
    # Re-check against live availability right before booking — the slot
    # list the client has could be a few minutes stale (another student
    # booked it meanwhile).
    open_slots = await _compute_open_slots(db, enrollment["instructor_id"])
    if not any(abs((requested - datetime.fromisoformat(s.replace("Z", "+00:00"))).total_seconds()) < 60 for s in open_slots):
        raise HTTPException(status_code=409, detail="Ese horario ya no está disponible. Elige otro.")
    res = await run_query(
        db.table("consulting_sessions").insert({
            "enrollment_id": enrollment["id"], "scheduled_at": body.scheduled_at, "status": "scheduled",
        })
    )
    log_consulting_action(user.get("email") or user["id"], "session_booked", enrollment["id"])
    return res.data[0] if res and res.data else {}


# ── Assignments / submissions ───────────────────────────────────────────

@router.get("/assignments")
async def list_assignments(user: dict = Depends(get_current_user)):
    await _require_role(user, ("student",))
    enrollment = await _require_own_active_enrollment(user["id"])
    db = get_supabase()
    # Two sources: module-wide assignments (shared by everyone in the
    # current module) and one-off exercises assigned to THIS enrollment
    # specifically (migration 121 — e.g. one assigned when a staff member
    # closes a session, see consulting_admin.py's close-session route).
    module_res, adhoc_res, submissions_res = await asyncio.gather(
        run_query(db.table("consulting_assignments").select("*").eq("module_id", enrollment.get("current_module_id"))),
        run_query(db.table("consulting_assignments").select("*").eq("enrollment_id", enrollment["id"])),
        run_query(db.table("consulting_submissions").select("*").eq("enrollment_id", enrollment["id"])),
    )
    assignments = (module_res.data or []) + (adhoc_res.data or [])
    return {"assignments": assignments, "submissions": submissions_res.data or []}


@router.post("/assignments/{assignment_id}/submit")
async def submit_assignment(assignment_id: str, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    await _require_role(user, ("student",))
    enrollment = await _require_own_active_enrollment(user["id"])
    db = get_supabase()
    content = await file.read()
    path = f"{enrollment['id']}/assignments/{assignment_id}/{file.filename}"
    await run_query(db.storage.from_(BUCKET).upload(path, content, {"upsert": "true"}))
    res = await run_query(
        db.table("consulting_submissions").insert({
            "assignment_id": assignment_id, "enrollment_id": enrollment["id"], "storage_path": path,
        })
    )
    log_consulting_action(user.get("email") or user["id"], "assignment_submitted", enrollment["id"], assignment_id)
    return res.data[0] if res and res.data else {}


class FeedbackBody(BaseModel):
    feedback: str


@router.put("/submissions/{submission_id}/feedback")
async def set_submission_feedback(submission_id: str, body: FeedbackBody, user: dict = Depends(get_current_user)):
    await _require_role(user, ("instructor", "program_admin"))
    db = get_supabase()
    sub_res = await run_query(db.table("consulting_submissions").select("*").eq("id", submission_id).maybe_single())
    if not sub_res or not sub_res.data:
        raise HTTPException(status_code=404, detail="Entrega no encontrada")
    enrollment = await _require_enrollment_by_id(db, sub_res.data["enrollment_id"])
    await _require_staff_access_to_enrollment(db, user, enrollment)
    await run_query(
        db.table("consulting_submissions").update({"feedback": body.feedback, "reviewed_by": user["id"]}).eq("id", submission_id)
    )
    log_consulting_action(user.get("email") or user["id"], "submission_reviewed", enrollment["id"], submission_id)
    return {"ok": True}


# ── Progress / competencies ──────────────────────────────────────────────

@router.get("/progress")
async def get_progress(user: dict = Depends(get_current_user)):
    await _require_role(user, ("student",))
    enrollment = await _require_own_active_enrollment(user["id"])
    db = get_supabase()
    res = await run_query(
        db.table("consulting_assessments").select("*").eq("enrollment_id", enrollment["id"]).order("assessed_at", desc=True)
    )
    return {"assessments": res.data or []}


class AssessmentBody(BaseModel):
    enrollment_id: str
    competency_id: str
    level: str
    observation: str | None = None


@router.post("/assessments")
async def create_assessment(body: AssessmentBody, user: dict = Depends(get_current_user)):
    await _require_role(user, ("instructor", "program_admin"))
    db = get_supabase()
    enrollment = await _require_enrollment_by_id(db, body.enrollment_id)
    await _require_staff_access_to_enrollment(db, user, enrollment)
    res = await run_query(
        db.table("consulting_assessments").insert({
            "enrollment_id": body.enrollment_id, "competency_id": body.competency_id,
            "level": body.level, "observation": body.observation, "assessed_by": user["id"],
        })
    )
    log_consulting_action(user.get("email") or user["id"], "assessment_created", body.enrollment_id)
    return res.data[0] if res and res.data else {}


# ── Resources ─────────────────────────────────────────────────────────────

@router.get("/resources")
async def list_resources(user: dict = Depends(get_current_user)):
    await _require_role(user, ("student",))
    enrollment = await _require_own_active_enrollment(user["id"])
    db = get_supabase()
    res = await run_query(
        db.table("consulting_resources").select("*").eq("module_id", enrollment.get("current_module_id"))
    )
    return {"resources": res.data or []}


# ── Final project / graduation ───────────────────────────────────────────

@router.get("/final-project")
async def get_final_project(user: dict = Depends(get_current_user)):
    await _require_role(user, ("student",))
    enrollment = await _require_own_active_enrollment(user["id"])
    db = get_supabase()
    res = await run_query(db.table("consulting_final_projects").select("*").eq("enrollment_id", enrollment["id"]).maybe_single())
    return res.data if res and res.data else None


@router.post("/final-project/submit")
async def submit_final_project(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    await _require_role(user, ("student",))
    enrollment = await _require_own_active_enrollment(user["id"])
    db = get_supabase()
    content = await file.read()
    path = f"{enrollment['id']}/final-project/{file.filename}"
    await run_query(db.storage.from_(BUCKET).upload(path, content, {"upsert": "true"}))
    await run_query(
        db.table("consulting_final_projects")
        .upsert({"enrollment_id": enrollment["id"], "storage_path": path, "status": "submitted"}, on_conflict="enrollment_id")
    )
    log_consulting_action(user.get("email") or user["id"], "final_project_submitted", enrollment["id"])
    return {"ok": True}


@router.get("/graduation")
async def get_graduation(user: dict = Depends(get_current_user)):
    await _require_role(user, ("student",))
    enrollment = await _require_own_active_enrollment(user["id"])
    db = get_supabase()
    res = await run_query(db.table("consulting_graduations").select("*").eq("enrollment_id", enrollment["id"]).maybe_single())
    return res.data if res and res.data else None


# ── Documents (signed URLs) ──────────────────────────────────────────────

@router.get("/documents/{path:path}/signed-url")
async def get_signed_url(path: str, user: dict = Depends(get_current_user)):
    """Ownership check: every stored path is prefixed with the owning
    enrollment_id (see the upload routes above) — a student may only
    request a signed URL for a path under their OWN enrollment_id;
    instructor/program_admin may request any path they have staff access
    to via that same enrollment. 10-minute expiry, generated fresh on
    every call — never a permanent public URL."""
    db = get_supabase()
    enrollment_id = path.split("/", 1)[0]
    enrollment = await _require_enrollment_by_id(db, enrollment_id)
    role = await _get_role(db, user["id"])
    if role == "student" and enrollment["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    if role in ("instructor", "program_admin"):
        await _require_staff_access_to_enrollment(db, user, enrollment)
    if role not in ("student", "instructor", "program_admin"):
        raise HTTPException(status_code=403, detail="No autorizado")
    signed = await run_query(db.storage.from_(BUCKET).create_signed_url(path, 600))
    return {"url": (signed.data or {}).get("signedUrl") if signed else None}


# ── Staff: roster ─────────────────────────────────────────────────────────

@router.get("/cohorts/{cohort_id}/students")
async def list_cohort_students(cohort_id: str, user: dict = Depends(get_current_user)):
    role = await _require_role(user, ("instructor", "program_admin"))
    db = get_supabase()
    q = db.table("consulting_enrollments").select("*").eq("cohort_id", cohort_id)
    if role == "instructor":
        q = q.eq("instructor_id", user["id"])
    res = await run_query(q)
    return {"enrollments": res.data or []}
