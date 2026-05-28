import re
import json
from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import get_current_user_id
from app.core.database import get_supabase
from app.models.user import UserProfile, UserProfileCreate, UserProfileUpdate
from app.services import ai_service
from datetime import datetime, timezone

router = APIRouter(prefix="/profile", tags=["profile"])


def _get_profile_or_404(user_id: str) -> dict:
    db = get_supabase()
    result = db.table("user_profiles").select("*").eq("user_id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Profile not found. Complete onboarding first.")
    return result.data[0]


@router.post("", response_model=UserProfile)
async def create_profile(
    data: UserProfileCreate,
    user_id: str = Depends(get_current_user_id),
):
    db = get_supabase()
    existing = db.table("user_profiles").select("id").eq("user_id", user_id).execute()
    if existing.data:
        # Update instead of failing — idempotent
        now = datetime.now(timezone.utc).isoformat()
        updates = {**data.model_dump(), "updated_at": now}
        result = db.table("user_profiles").update(updates).eq("user_id", user_id).execute()
        return UserProfile(**result.data[0])

    now = datetime.now(timezone.utc).isoformat()
    record = {
        "user_id": user_id,
        **data.model_dump(),
        "created_at": now,
        "updated_at": now,
    }
    result = db.table("user_profiles").insert(record).execute()
    return UserProfile(**result.data[0])


@router.get("", response_model=UserProfile)
async def get_profile(user_id: str = Depends(get_current_user_id)):
    return UserProfile(**_get_profile_or_404(user_id))


@router.get("/insights")
async def get_ai_insights(user_id: str = Depends(get_current_user_id)):
    """Analyze chat history to detect behavioral patterns and suggest profile updates."""
    try:
        db = get_supabase()
        result = (
            db.table("chat_history")
            .select("content")
            .eq("user_id", user_id)
            .eq("role", "user")
            .order("created_at", desc=True)
            .limit(40)
            .execute()
        )
        msgs = result.data
        if len(msgs) < 8:
            return {"ready": False, "reason": "few_messages"}

        combined = "\n".join(f"- {m['content'][:200]}" for m in msgs)
        profile_row = db.table("user_profiles").select("risk_tolerance,mentor").eq("user_id", user_id).execute()
        declared_risk = profile_row.data[0].get("risk_tolerance", "moderate") if profile_row.data else "moderate"

        prompt = f"""Analiza los mensajes de un usuario de una app de inversión y detecta patrones.
Perfil declarado: {declared_risk}

MENSAJES:
{combined}

Responde SOLO con este JSON (sin texto adicional):
{{
  "topics": ["max 4 temas más frecuentes que pregunta"],
  "risk_behavior": "conservative|moderate|aggressive",
  "risk_match": true/false,
  "risk_note": "si no coincide con {declared_risk}, explica en 1 oración qué comportamiento revela",
  "interests": ["max 3 sectores o activos que más menciona"],
  "suggestion": "recomendación personalizada de 1 oración sobre qué debería explorar o aprender",
  "maturity_signal": "beginner|intermediate|advanced"
}}"""

        response = ""
        async for chunk in ai_service.chat_stream(
            message=prompt, conversation_history=[], profile=None, mentor=None,
        ):
            response += chunk

        match = re.search(r'\{.*\}', response, re.DOTALL)
        if match:
            data = json.loads(match.group())
            return {"ready": True, "declared_risk": declared_risk, **data}
    except Exception:
        pass
    return {"ready": False, "reason": "error"}


@router.put("", response_model=UserProfile)
async def update_profile(
    data: UserProfileUpdate,
    user_id: str = Depends(get_current_user_id),
):
    _get_profile_or_404(user_id)
    db = get_supabase()
    updates = {k: v for k, v in data.model_dump(exclude_none=True).items()}
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = db.table("user_profiles").update(updates).eq("user_id", user_id).execute()
    return UserProfile(**result.data[0])
