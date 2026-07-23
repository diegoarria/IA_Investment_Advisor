"""
Referral program endpoints.

GET  /referral/code   — get (or auto-generate) the user's unique referral code
GET  /referral/stats  — referred_count and pending reward
POST /referral/apply  — called after signup to credit a referrer
"""

import random
import string
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query

router = APIRouter(prefix="/referral", tags=["referral"])

# Flat reward, both sides: referrer and the friend they referred each get
# REFERRAL_BONUS_DAYS of bonus premium per successful referral (not tiered —
# every referral pays out the same reward, stacking with any active streak
# or prior referral bonus already on the account).
REFERRAL_BONUS_DAYS = 14


async def _grant_referral_bonus(user_id: str, db) -> None:
    """Extend the user's bonus-premium window by REFERRAL_BONUS_DAYS, stacking
    on top of any streak/referral bonus that's still active. No-op for
    already-paid premium users — they don't need it."""
    row = await run_query(
        db.table("user_profiles")
        .select("subscription_tier, streak_bonus_premium_until")
        .eq("user_id", user_id)
        .maybe_single()
    )
    data = (row.data if row else None) or {}
    if data.get("subscription_tier") == "premium":
        return

    base = datetime.now(timezone.utc)
    current_bonus = data.get("streak_bonus_premium_until")
    if current_bonus:
        try:
            existing = datetime.fromisoformat(current_bonus.replace("Z", "+00:00"))
            if existing > base:
                base = existing
        except Exception:
            pass

    new_until = (base + timedelta(days=REFERRAL_BONUS_DAYS)).isoformat()
    await run_query(
        db.table("user_profiles").update({"streak_bonus_premium_until": new_until}).eq("user_id", user_id)
    )


def _generate_code() -> str:
    chars = string.ascii_uppercase + string.digits
    return "".join(random.choices(chars, k=8))


async def _ensure_code(user_id: str) -> str:
    db = get_supabase()
    row = await run_query(
        db.table("user_profiles").select("referral_code").eq("user_id", user_id).maybe_single()
    )
    code = ((row.data if row else None) or {}).get("referral_code")
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
        db.table("user_profiles").select("referral_code, referred_count").eq("user_id", user_id).maybe_single()
    )
    data = (row.data if row else None) or {}
    code = data.get("referral_code") or await _ensure_code(user_id)
    count = int(data.get("referred_count") or 0)
    return {
        "code": code,
        "link": f"https://nuvosai.app/join?ref={code}",
        "referred_count": count,
        # The frontend renders this via i18n (t("profile.pendingRewardValue",
        # {days})) — a hardcoded Spanish string used to live here regardless
        # of the user's language setting.
        "bonus_days": REFERRAL_BONUS_DAYS,
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
        db.table("user_profiles").select("referred_by").eq("user_id", user_id).maybe_single()
    )
    if ((my_row.data if my_row else None) or {}).get("referred_by"):
        raise HTTPException(status_code=409, detail="Ya tienes un referido aplicado")

    # Credit referrer and mark new user
    new_count = int(referrer.get("referred_count") or 0) + 1
    await run_query(
        db.table("user_profiles").update({"referred_count": new_count}).eq("user_id", referrer_id)
    )
    await run_query(
        db.table("user_profiles").update({"referred_by": referrer_id}).eq("user_id", user_id)
    )

    # Flat reward: both the referrer and the new friend get REFERRAL_BONUS_DAYS
    # of bonus premium, right away — not gated on any milestone.
    await _grant_referral_bonus(referrer_id, db)
    await _grant_referral_bonus(user_id, db)

    return {"ok": True, "referred_count": new_count, "bonus_days": REFERRAL_BONUS_DAYS}
