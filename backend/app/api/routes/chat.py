import asyncio
import concurrent.futures
import re
import json
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from app.api.deps import get_current_user_id
from app.core.database import get_supabase
from app.models.user import ChatRequest, UserProfile
from app.services import ai_service
from app.services.market_data_service import (
    get_market_context_for_message,
    get_global_market_context,
    detect_tickers,
)
from app.core.limiter import limiter

FREE_MSG_LIMIT = 20
FREE_MSG_WINDOW_HOURS = 24


def _check_and_increment_msg_limit(user_id: str, profile: UserProfile) -> None:
    if profile.subscription_tier == "premium":
        return
    db = get_supabase()
    now = datetime.now(timezone.utc)
    window_start = None
    if profile.msg_window_start:
        try:
            window_start = datetime.fromisoformat(profile.msg_window_start.replace("Z", "+00:00"))
        except Exception:
            pass

    if window_start is None or (now - window_start) >= timedelta(hours=FREE_MSG_WINDOW_HOURS):
        db.table("user_profiles").update({
            "msg_count": 1,
            "msg_window_start": now.isoformat(),
        }).eq("user_id", user_id).execute()
        return

    if profile.msg_count >= FREE_MSG_LIMIT:
        reset_at = window_start + timedelta(hours=FREE_MSG_WINDOW_HOURS)
        mins = max(1, int((reset_at - now).total_seconds() / 60))
        raise HTTPException(
            status_code=429,
            detail={
                "code": "msg_limit",
                "message": f"Alcanzaste el límite de {FREE_MSG_LIMIT} mensajes. Vuelve en {mins} min o activa Premium.",
                "reset_in_minutes": mins,
            },
        )

    db.table("user_profiles").update({"msg_count": profile.msg_count + 1}).eq("user_id", user_id).execute()

router = APIRouter(prefix="/chat", tags=["chat"])


def _get_user_profile(user_id: str) -> UserProfile | None:
    try:
        db = get_supabase()
        result = db.table("user_profiles").select("*").eq("user_id", user_id).execute()
        if result.data:
            return UserProfile(**result.data[0])
    except Exception:
        pass
    return None


def _extract_bscore(reply: str) -> tuple[str, dict | None]:
    """Strip the hidden BSCORE tag from Claude's reply and parse it."""
    match = re.search(r'<!--\s*BSCORE:\s*(\{.*?\})\s*-->', reply, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group(1))
            clean = reply[:match.start()].rstrip()
            return clean, data
        except Exception:
            pass
    return reply, None


def _enrich_message(message: str) -> str:
    """Prepend global market context + append per-company context. Both fetched in parallel."""
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        f_global  = ex.submit(get_global_market_context)
        f_company = ex.submit(get_market_context_for_message, message)
        global_ctx  = ""
        company_ctx = ""
        try:
            global_ctx = f_global.result(timeout=12)
        except Exception:
            pass
        try:
            company_ctx = f_company.result(timeout=12)
        except Exception:
            pass
    parts = [message]
    if global_ctx:
        parts.append("\n\n" + global_ctx)
    if company_ctx:
        parts.append(company_ctx)
    return "\n".join(parts) if len(parts) > 1 else message


@router.post("/stream")
async def chat_stream(
    request: ChatRequest,
    user_id: str = Depends(get_current_user_id)
):
    profile = _get_user_profile(user_id)
    enriched = await asyncio.to_thread(_enrich_message, request.message)

    async def generate():
        async for chunk in ai_service.chat_stream(
            message=enriched,
            conversation_history=request.conversation_history,
            profile=profile,
            mentor=request.mentor,
        ):
            yield chunk

    return StreamingResponse(generate(), media_type="text/plain")


@router.post("/message")
@limiter.limit("30/minute")
async def chat_message(
    request: Request,
    body: ChatRequest,
    user_id: str = Depends(get_current_user_id)
):
    profile = _get_user_profile(user_id)
    if profile:
        _check_and_increment_msg_limit(user_id, profile)
    tickers  = await asyncio.to_thread(detect_tickers, body.message)
    enriched = await asyncio.to_thread(_enrich_message, body.message) if not body.image_data else body.message
    full = ""
    async for chunk in ai_service.chat_stream(
        message=enriched,
        conversation_history=body.conversation_history,
        profile=profile,
        mentor=body.mentor,
        image_data=body.image_data,
        image_type=body.image_type,
    ):
        full += chunk
    clean_reply, bscore = _extract_bscore(full)
    return {"reply": clean_reply, "risk_assessment": bscore, "tickers": tickers}


@router.post("/save-message")
async def save_message(
    request: dict,
    user_id: str = Depends(get_current_user_id)
):
    try:
        from datetime import datetime
        db = get_supabase()
        record = {
            "user_id": user_id,
            "role": request.get("role"),
            "content": request.get("content"),
            "created_at": datetime.utcnow().isoformat(),
        }
        db.table("chat_history").insert(record).execute()
    except Exception:
        pass
    return {"saved": True}


@router.get("/history")
async def get_history(
    limit: int = 100,
    user_id: str = Depends(get_current_user_id)
):
    try:
        db = get_supabase()
        result = (
            db.table("chat_history")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return {"messages": list(reversed(result.data))}
    except Exception:
        return {"messages": []}
