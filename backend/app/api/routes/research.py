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
@limiter.limit("10/minute")
async def start_research(request: Request, body: dict, user_id: str = Depends(get_current_user_id)):
    """Verifies the Stripe checkout session paid for this exact job, then
    marks it eligible for pickup. Does NOT run the pipeline itself —
    execution is owned entirely by worker.py's job_deep_research_worker(),
    which claims pending jobs atomically (see claim_research_job() in
    migrations/034_research_job_queue.sql). This is what makes the job
    survive a web-process restart: nothing about running the pipeline lives
    in this request's process anymore, only the durable job row does."""
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
        session = await asyncio.to_thread(stripe.checkout.Session.retrieve, stripe_session_id)
    except Exception:
        raise HTTPException(status_code=400, detail="No se pudo verificar el pago — intenta de nuevo en unos segundos")

    metadata = session.get("metadata") or {}
    if (
        session.get("payment_status") != "paid"
        or metadata.get("offer") != "deep_research"
        or metadata.get("job_id") != job_id
    ):
        raise HTTPException(status_code=402, detail="Pago no confirmado para esta investigación")

    # Left as 'pending' deliberately — the worker's atomic claim is what
    # transitions it to 'researching'. Recording stripe_session_id here is
    # what lets a later failure/cancellation issue a refund against this
    # specific payment (see research_service._maybe_refund).
    await run_query(
        db.table("research_jobs").update({
            "stripe_session_id": stripe_session_id,
        }).eq("id", job_id)
    )
    return {"job_id": job_id, "status": "pending"}


@router.post("/jobs/{job_id}/cancel")
@limiter.limit("20/minute")
async def cancel_job(request: Request, job_id: str, user_id: str = Depends(get_current_user_id)):
    """Requests cancellation of a job that hasn't finished yet. The pipeline
    itself checks this flag between stages (see research_service._check_cancelled)
    and stops promptly rather than continuing to burn Anthropic/API cost on
    work nobody wants — a cancelled-after-payment job is refunded automatically."""
    db = get_supabase()
    job_res = await run_query(
        db.table("research_jobs").select("status").eq("id", job_id).eq("user_id", user_id).single()
    )
    if not job_res.data:
        raise HTTPException(status_code=404, detail="Investigación no encontrada")
    if job_res.data["status"] not in ("pending", "researching"):
        return {"job_id": job_id, "status": job_res.data["status"]}
    await run_query(db.table("research_jobs").update({"cancel_requested": True}).eq("id", job_id))
    # A job still sitting in 'pending' (never claimed by a worker) has no
    # pipeline loop watching cancel_requested — cancel it outright here.
    if job_res.data["status"] == "pending":
        from datetime import datetime, timezone
        await run_query(
            db.table("research_jobs").update({
                "status": "cancelled", "current_stage": "Cancelado",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", job_id)
        )
        job_full = await run_query(db.table("research_jobs").select("*").eq("id", job_id).single())
        await research_service._maybe_refund(job_full.data)
        return {"job_id": job_id, "status": "cancelled"}
    return {"job_id": job_id, "status": "researching", "cancel_requested": True}


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
