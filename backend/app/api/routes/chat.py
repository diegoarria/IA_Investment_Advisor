from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from app.api.deps import get_current_user_id
from app.core.database import get_supabase
from app.models.user import ChatRequest, UserProfile
from app.services import ai_service

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


@router.post("/stream")
async def chat_stream(
    request: ChatRequest,
    user_id: str = Depends(get_current_user_id)
):
    profile = _get_user_profile(user_id)

    async def generate():
        async for chunk in ai_service.chat_stream(
            message=request.message,
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


@router.post("/save-message")
async def save_message(
    request: dict,
    user_id: str = Depends(get_current_user_id)
):
    db = get_supabase()
    from datetime import datetime
    record = {
        "user_id": user_id,
        "role": request.get("role"),
        "content": request.get("content"),
        "created_at": datetime.utcnow().isoformat(),
    }
    db.table("chat_history").insert(record).execute()
    return {"saved": True}


@router.get("/history")
async def get_history(
    limit: int = 50,
    user_id: str = Depends(get_current_user_id)
):
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
