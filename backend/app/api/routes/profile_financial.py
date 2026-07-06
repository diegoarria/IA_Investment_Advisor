"""Structured Financial Profile — goals, sector preferences, and the typed
fields (net worth, expenses, currency, style, freedom target) every agent
and habit job reads, instead of the free-form quiz_answers JSON blob."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Literal, Optional

from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query

router = APIRouter(prefix="/profile/financial", tags=["profile-financial"])

INVESTING_STYLES = ("value", "growth", "dividend", "index", "momentum", "not_set")
GOAL_TYPES = ("retirement", "house", "freedom_number", "education", "emergency_fund", "custom")

_FIELDS = (
    "net_worth_usd, monthly_expenses_usd, currency, preferred_language, "
    "investing_style, time_horizon_years, financial_freedom_target_usd"
)


# ── GET /api/profile/financial ────────────────────────────────────────────────
@router.get("")
async def get_financial_profile(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    res = await run_query(
        db.table("user_profiles").select(_FIELDS).eq("user_id", user_id).limit(1)
    )
    row = (res.data or [{}])[0]
    return {
        "net_worth_usd":               row.get("net_worth_usd"),
        "monthly_expenses_usd":        row.get("monthly_expenses_usd"),
        "currency":                    row.get("currency") or "USD",
        "preferred_language":          row.get("preferred_language") or "es",
        "investing_style":             row.get("investing_style") or "not_set",
        "time_horizon_years":          row.get("time_horizon_years"),
        "financial_freedom_target_usd": row.get("financial_freedom_target_usd"),
    }


# ── PATCH /api/profile/financial ──────────────────────────────────────────────
class FinancialProfileUpdate(BaseModel):
    net_worth_usd: Optional[float] = Field(None, ge=0)
    monthly_expenses_usd: Optional[float] = Field(None, ge=0)
    currency: Optional[str] = Field(None, min_length=3, max_length=3)
    preferred_language: Optional[str] = Field(None, min_length=2, max_length=5)
    investing_style: Optional[Literal[*INVESTING_STYLES]] = None
    time_horizon_years: Optional[int] = Field(None, ge=0, le=80)
    financial_freedom_target_usd: Optional[float] = Field(None, ge=0)


@router.patch("")
async def update_financial_profile(
    body: FinancialProfileUpdate,
    user_id: str = Depends(get_current_user_id),
):
    update = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No hay campos para actualizar")
    db = get_supabase()
    await run_query(db.table("user_profiles").update(update).eq("user_id", user_id))
    return {"updated": list(update.keys())}


# ── Goals ──────────────────────────────────────────────────────────────────────
class GoalCreate(BaseModel):
    goal_type: Literal[*GOAL_TYPES]
    label: Optional[str] = Field(None, max_length=80)
    target_usd: Optional[float] = Field(None, ge=0)
    target_date: Optional[str] = None
    is_primary: bool = False


@router.get("/goals")
async def list_goals(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    res = await run_query(
        db.table("user_financial_goals").select("*")
        .eq("user_id", user_id).order("is_primary", desc=True).order("created_at")
    )
    return {"goals": res.data or []}


@router.post("/goals", status_code=201)
async def add_goal(body: GoalCreate, user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    if body.is_primary:
        await run_query(
            db.table("user_financial_goals").update({"is_primary": False}).eq("user_id", user_id)
        )
    res = await run_query(
        db.table("user_financial_goals").insert({
            "user_id":     user_id,
            "goal_type":   body.goal_type,
            "label":       body.label,
            "target_usd":  body.target_usd,
            "target_date": body.target_date,
            "is_primary":  body.is_primary,
        })
    )
    return {"id": res.data[0]["id"] if res.data else None}


@router.delete("/goals/{goal_id}")
async def delete_goal(goal_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    res = await run_query(
        db.table("user_financial_goals").delete().eq("id", goal_id).eq("user_id", user_id)
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Meta no encontrada")
    return {"deleted": True}


# ── Sector preferences ────────────────────────────────────────────────────────
class SectorPreferences(BaseModel):
    sectors: list[str] = Field(..., max_length=15)


@router.put("/sectors")
async def set_sector_preferences(
    body: SectorPreferences,
    user_id: str = Depends(get_current_user_id),
):
    db = get_supabase()
    await run_query(db.table("user_sector_preferences").delete().eq("user_id", user_id))
    if body.sectors:
        await run_query(
            db.table("user_sector_preferences").insert([
                {"user_id": user_id, "sector": s, "weight": 1.0, "source": "declared"}
                for s in body.sectors
            ])
        )
    return {"sectors": body.sectors}


@router.get("/sectors")
async def get_sector_preferences(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    res = await run_query(
        db.table("user_sector_preferences").select("sector, weight, source")
        .eq("user_id", user_id).order("weight", desc=True)
    )
    return {"sectors": res.data or []}
