import asyncio
import re
import json
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from app.api.deps import get_current_user_id
from app.core.database import get_supabase
from app.models.user import ChatRequest, UserProfile
from app.services import ai_service
from app.services.market_data_service import get_market_context_for_message

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
    """Append real-time market data for any companies mentioned in the message."""
    try:
        market_ctx = get_market_context_for_message(message)
        if market_ctx:
            return message + "\n\n" + market_ctx
    except Exception:
        pass
    return message


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
            profile=profile
        ):
            yield chunk

    try:
        db = get_supabase()
        if profile:
            from datetime import datetime
            db.table("user_profiles").update({
                "interaction_count": profile.interaction_count + 1,
                "updated_at": datetime.utcnow().isoformat()
            }).eq("user_id", user_id).execute()
    except Exception:
        pass

    return StreamingResponse(generate(), media_type="text/plain")


@router.post("/message")
async def chat_message(
    request: ChatRequest,
    user_id: str = Depends(get_current_user_id)
):
    profile = _get_user_profile(user_id)
    enriched = await asyncio.to_thread(_enrich_message, request.message)
    full = ""
    async for chunk in ai_service.chat_stream(
        message=enriched,
        conversation_history=request.conversation_history,
        profile=profile
    ):
        full += chunk
    clean_reply, bscore = _extract_bscore(full)
    return {"reply": clean_reply, "risk_assessment": bscore}


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
    limit: int = 50,
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
