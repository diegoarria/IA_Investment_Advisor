from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import get_current_user_id
from app.core.database import get_supabase
from app.models.user import UserProfile, UserProfileCreate, UserProfileUpdate
from datetime import datetime

router = APIRouter(prefix="/profile", tags=["profile"])


def _get_profile_or_404(user_id: str) -> dict:
    db = get_supabase()
    result = db.table("user_profiles").select("*").eq("user_id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Profile not found. Complete onboarding first.")
    return result.data


@router.post("", response_model=UserProfile)
async def create_profile(
    data: UserProfileCreate,
    user_id: str = Depends(get_current_user_id)
):
    db = get_supabase()
    existing = db.table("user_profiles").select("id").eq("user_id", user_id).execute()
    if existing.data:
        raise HTTPException(status_code=409, detail="Profile already exists. Use PUT to update.")

    now = datetime.utcnow().isoformat()
    record = {
        "user_id": user_id,
        **data.model_dump(),
        "investment_goals": [g.value for g in data.investment_goals],
        "interaction_count": 0,
        "learned_concepts": [],
        "weak_areas": [],
        "created_at": now,
        "updated_at": now,
    }
    result = db.table("user_profiles").insert(record).execute()
    return UserProfile(**result.data[0])


@router.get("", response_model=UserProfile)
async def get_profile(user_id: str = Depends(get_current_user_id)):
    return UserProfile(**_get_profile_or_404(user_id))


@router.put("", response_model=UserProfile)
async def update_profile(
    data: UserProfileUpdate,
    user_id: str = Depends(get_current_user_id)
):
    _get_profile_or_404(user_id)
    db = get_supabase()

    updates = {k: v for k, v in data.model_dump(exclude_none=True).items()}
    if "investment_goals" in updates:
        updates["investment_goals"] = [g.value if hasattr(g, "value") else g for g in updates["investment_goals"]]
    updates["updated_at"] = datetime.utcnow().isoformat()

    result = db.table("user_profiles").update(updates).eq("user_id", user_id).execute()
    return UserProfile(**result.data[0])


@router.post("/increment-interaction")
async def increment_interaction(user_id: str = Depends(get_current_user_id)):
    profile = _get_profile_or_404(user_id)
    db = get_supabase()
    db.table("user_profiles").update({
        "interaction_count": profile["interaction_count"] + 1,
        "updated_at": datetime.utcnow().isoformat()
    }).eq("user_id", user_id).execute()
    return {"interaction_count": profile["interaction_count"] + 1}
