"""
Referral program endpoints.

GET  /referral/code   — get (or auto-generate) the user's unique referral code
GET  /referral/stats  — referred_count and pending reward
POST /referral/apply  — called after signup to credit a referrer
"""

import random
import string
from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query

router = APIRouter(prefix="/referral", tags=["referral"])

_REWARD_TIERS = [
    (1,  "1 semana Premium gratis"),
    (3,  "1 mes Premium gratis"),
    (5,  "3 meses Premium gratis"),
    (10, "1 año Premium gratis"),
]


def _pending_reward(count: int) -> str:
    reward = ""
    for threshold, label in _REWARD_TIERS:
        if count >= threshold:
            reward = label
    return reward or f"¡Invita {_REWARD_TIERS[0][0] - count} amigo(s) más para ganar tu primera recompensa!"


def _generate_code() -> str:
    chars = string.ascii_uppercase + string.digits
    return "".join(random.choices(chars, k=8))


async def _ensure_code(user_id: str) -> str:
    db = get_supabase()
    row = await run_query(
        db.table("user_profiles").select("referral_code").eq("user_id", user_id).single()
    )
    code = (row.data or {}).get("referral_code")
    if not code:
        for _ in range(5):
            candidate = _generate_code()
            try:
                await run_query(
                    db.table("user_profiles").update({"referral_code": candidate}).eq("user_id", user_id)
                )
                code = candidate
                break
            except Exception:
                continue
    return code or ""


@router.get("/code")
async def get_code(user_id: str = Depends(get_current_user_id)):
    code = await _ensure_code(user_id)
    return {"code": code, "link": f"https://nuvosai.app/join?ref={code}"}


@router.get("/stats")
async def get_stats(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    row = await run_query(
        db.table("user_profiles").select("referral_code, referred_count").eq("user_id", user_id).single()
    )
    data = row.data or {}
    code = data.get("referral_code") or await _ensure_code(user_id)
    count = int(data.get("referred_count") or 0)
    return {
        "code": code,
        "link": f"https://nuvosai.app/join?ref={code}",
        "referred_count": count,
        "pending_reward": _pending_reward(count),
    }


@router.post("/apply")
async def apply_referral(body: dict, user_id: str = Depends(get_current_user_id)):
    """Credit the referrer when a new user signs up with a referral code."""
    code = (body.get("code") or "").strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="Código requerido")

    db = get_supabase()

    # Find referrer
    result = await run_query(
        db.table("user_profiles").select("user_id, referred_count").eq("referral_code", code)
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Código inválido")

    referrer = result.data[0]
    referrer_id = referrer["user_id"]

    if referrer_id == user_id:
        raise HTTPException(status_code=400, detail="No puedes referirte a ti mismo")

    # Check new user hasn't already been referred
    my_row = await run_query(
        db.table("user_profiles").select("referred_by").eq("user_id", user_id).single()
    )
    if (my_row.data or {}).get("referred_by"):
        raise HTTPException(status_code=409, detail="Ya tienes un referido aplicado")

    # Credit referrer and mark new user
    new_count = int(referrer.get("referred_count") or 0) + 1
    await run_query(
        db.table("user_profiles").update({"referred_count": new_count}).eq("user_id", referrer_id)
    )
    await run_query(
        db.table("user_profiles").update({"referred_by": referrer_id}).eq("user_id", user_id)
    )

    return {"ok": True, "referred_count": new_count}
