import asyncio
import logging

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.api.deps import get_current_user_id
from app.core.config import settings
from app.core.database import get_supabase, run_query
from app.core.limiter import limiter
from app.services import research_service
from app.services.research_pdf import build_report_pdf

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/research", tags=["research"])


@router.post("/plan")
@limiter.limit("10/minute")
async def create_plan(request: Request, body: dict, user_id: str = Depends(get_current_user_id)):
    """Stage 1 only — fast, synchronous. Persists a pending job so the
    Stripe checkout that follows has something durable to reference."""
    request_text = (body.get("request_text") or "").strip()
    if not request_text:
        return {"error": "Escribe qué quieres que investiguemos."}

    plan = await research_service.create_plan(request_text)

    db = get_supabase()
    result = await run_query(
        db.table("research_jobs").insert({
            "user_id": user_id,
            "request_text": request_text,
            "plan": plan,
            "status": "pending",
        })
    )
    job_id = result.data[0]["id"]
    return {"job_id": job_id, "plan": plan}


@router.post("/start")
async def start_research(body: dict, user_id: str = Depends(get_current_user_id)):
    """Verifies the Stripe checkout session paid for this exact job, then
    kicks off the background pipeline. Mirrors the light verification already
    used elsewhere in the upsell system — no webhook dependency required."""
    job_id = body.get("job_id")
    stripe_session_id = body.get("stripe_session_id")
    if not job_id or not stripe_session_id:
        raise HTTPException(status_code=400, detail="job_id y stripe_session_id son requeridos")

    db = get_supabase()
    job_res = await run_query(
        db.table("research_jobs").select("*").eq("id", job_id).eq("user_id", user_id).single()
    )
    if not job_res.data:
        raise HTTPException(status_code=404, detail="Investigación no encontrada")
    job = job_res.data
    if job["status"] != "pending":
        return {"job_id": job_id, "status": job["status"]}

    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="Pagos no configurados")
    stripe.api_key = settings.stripe_secret_key
    try:
        session = stripe.checkout.Session.retrieve(stripe_session_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Sesión de pago inválida")

    metadata = session.get("metadata") or {}
    if (
        session.get("payment_status") != "paid"
        or metadata.get("offer") != "deep_research"
        or metadata.get("job_id") != job_id
    ):
        raise HTTPException(status_code=402, detail="Pago no confirmado para esta investigación")

    await run_query(
        db.table("research_jobs").update({
            "status": "researching",
            "current_stage": "Entendiendo tu solicitud...",
            "stripe_session_id": stripe_session_id,
        }).eq("id", job_id)
    )
    asyncio.create_task(research_service.run_pipeline(job_id, user_id))
    return {"job_id": job_id, "status": "researching"}


@router.get("/jobs/active")
async def active_job(user_id: str = Depends(get_current_user_id)):
    """Used by mobile (and any client) to resume an in-progress job after
    returning from an out-of-app Stripe checkout, without a job_id in hand."""
    db = get_supabase()
    res = await run_query(
        db.table("research_jobs").select("id, status, current_stage")
        .eq("user_id", user_id).in_("status", ["pending", "researching"])
        .order("created_at", desc=True).limit(1)
    )
    return res.data[0] if res.data else None


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    res = await run_query(
        db.table("research_jobs").select("id, status, current_stage, report_id, error")
        .eq("id", job_id).eq("user_id", user_id).single()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="No encontrado")
    return res.data


@router.get("/reports")
async def list_reports(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    res = await run_query(
        db.table("research_reports").select("id, title, companies, created_at")
        .eq("user_id", user_id).order("created_at", desc=True)
    )
    return {"reports": res.data or []}


@router.get("/reports/{report_id}")
async def get_report(report_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    res = await run_query(
        db.table("research_reports").select("*").eq("id", report_id).eq("user_id", user_id).single()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Reporte no encontrado")
    return res.data


@router.get("/reports/{report_id}/pdf")
async def get_report_pdf(report_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    res = await run_query(
        db.table("research_reports").select("*").eq("id", report_id).eq("user_id", user_id).single()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Reporte no encontrado")
    report = res.data
    pdf_bytes = await asyncio.to_thread(build_report_pdf, report["title"], report["blocks"])
    filename = f"nuvos-deep-research-{report_id[:8]}.pdf"
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
