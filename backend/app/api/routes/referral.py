"""
Referral program endpoints.

GET  /referral/code           — get (or auto-generate) the user's unique referral code
GET  /referral/stats          — referred_count, tier progress, and reward credits
POST /referral/apply          — called after signup to credit a referrer
POST /referral/redeem-session — spend one earned free 1:1 session credit
"""

import random
import string
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query

router = APIRouter(prefix="/referral", tags=["referral"])

# One-time bonus for the new user who signs up with someone else's code —
# flat, unrelated to the referrer's milestone tiers below.
WELCOME_BONUS_DAYS = 14

# The referrer's reward ladder: (referred_count threshold, premium days
# granted at that tier, grants a free 1:1 session, grants a free deep
# research report). Each tier pays out exactly once — see
# referral_reward_tier, the highest tier already paid — even if
# referred_count keeps climbing past 3.
REFERRAL_TIERS = [
    (1, 14, False, False),
    (2, 14, True, False),
    (3, 30, True, True),
]


async def _extend_premium(user_id: str, days: int, db) -> None:
    """Extend the user's bonus-premium window by `days`, stacking on top of
    any streak/referral bonus that's still active. No-op for already-paid
    premium users — they don't need it."""
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

    new_until = (base + timedelta(days=days)).isoformat()
    await run_query(
        db.table("user_profiles").update({"streak_bonus_premium_until": new_until}).eq("user_id", user_id)
    )


async def _grant_tier_rewards(referrer_id: str, new_count: int, db) -> None:
    """Pay out every tier newly crossed by `new_count` that the referrer
    hasn't already been paid for — additive (a referrer who reaches tier 3
    has been paid tier 1 + tier 2 + tier 3's rewards, not just tier 3's)."""
    row = await run_query(
        db.table("user_profiles")
        .select("referral_reward_tier, free_1on1_sessions, free_deep_research_credits")
        .eq("user_id", referrer_id)
        .maybe_single()
    )
    data = (row.data if row else None) or {}
    current_tier = int(data.get("referral_reward_tier") or 0)
    sessions = int(data.get("free_1on1_sessions") or 0)
    research_credits = int(data.get("free_deep_research_credits") or 0)
    highest = current_tier

    for tier, days, grants_session, grants_research in REFERRAL_TIERS:
        if new_count >= tier and current_tier < tier:
            await _extend_premium(referrer_id, days, db)
            if grants_session:
                sessions += 1
            if grants_research:
                research_credits += 1
            highest = tier

    if highest > current_tier:
        await run_query(
            db.table("user_profiles").update({
                "referral_reward_tier": highest,
                "free_1on1_sessions": sessions,
                "free_deep_research_credits": research_credits,
            }).eq("user_id", referrer_id)
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
    return {"code": code, "link": f"https://nuvosai.com/join?ref={code}"}


@router.get("/stats")
async def get_stats(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    row = await run_query(
        db.table("user_profiles")
        .select("referral_code, referred_count, referral_reward_tier, free_1on1_sessions, free_deep_research_credits")
        .eq("user_id", user_id)
        .maybe_single()
    )
    data = (row.data if row else None) or {}
    code = data.get("referral_code") or await _ensure_code(user_id)
    count = int(data.get("referred_count") or 0)
    return {
        "code": code,
        "link": f"https://nuvosai.com/join?ref={code}",
        "referred_count": count,
        "reward_tier": int(data.get("referral_reward_tier") or 0),
        "free_1on1_sessions": int(data.get("free_1on1_sessions") or 0),
        "free_deep_research_credits": int(data.get("free_deep_research_credits") or 0),
        "tiers": [
            {"friends": tier, "days": days, "session": grants_session, "research": grants_research}
            for tier, days, grants_session, grants_research in REFERRAL_TIERS
        ],
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

    # The frontend calls this immediately after register() succeeds — but the
    # new user's user_profiles row doesn't exist yet at that point (it's only
    # created when onboarding finishes, see profile.py's create_profile). The
    # UPDATE-only version of this claim always matched zero rows for that
    # near-universal case and raised the exact same 409 as "already referred",
    # silently dropping the referral on essentially every real signup.
    #
    # Try an upsert first: if no row exists yet, this creates a minimal
    # placeholder (just user_id + referred_by) that create_profile's own
    # upsert(on_conflict="user_id") later fills in via its UPDATE branch —
    # which never touches referred_by — without clobbering it.
    # ignore_duplicates means a row that already exists (the common case for
    # a user who already finished onboarding) makes this a no-op (empty
    # data), so we fall through to the atomic UPDATE below for that case.
    claim = await run_query(
        db.table("user_profiles")
        .upsert({"user_id": user_id, "referred_by": referrer_id}, on_conflict="user_id", ignore_duplicates=True)
    )
    if not claim.data:
        # Row already existed (or we lost a race creating it) — same atomic
        # claim as before: scoping the UPDATE's WHERE clause to
        # `referred_by IS NULL` makes Postgres itself the arbiter between
        # concurrent /apply calls (two different friends' codes at once);
        # only the request that actually flips the column from null wins,
        # and the loser's UPDATE matches zero rows and comes back empty.
        claim = await run_query(
            db.table("user_profiles")
            .update({"referred_by": referrer_id})
            .eq("user_id", user_id)
            .is_("referred_by", "null")
        )
    if not claim.data:
        raise HTTPException(status_code=409, detail="Ya tienes un referido aplicado")

    # Credit referrer (only reached by whichever request won the claim above)
    new_count = int(referrer.get("referred_count") or 0) + 1
    await run_query(
        db.table("user_profiles").update({"referred_count": new_count}).eq("user_id", referrer_id)
    )

    await _grant_tier_rewards(referrer_id, new_count, db)
    await _extend_premium(user_id, WELCOME_BONUS_DAYS, db)

    return {"ok": True, "referred_count": new_count, "bonus_days": WELCOME_BONUS_DAYS}


@router.post("/redeem-session")
async def redeem_session(user_id: str = Depends(get_current_user_id)):
    """Spend one earned free 1:1 session credit. Booking itself still happens
    manually (same flow as the existing "request a session" chat message) —
    this just marks the credit as used so it can't be redeemed twice."""
    db = get_supabase()
    row = await run_query(
        db.table("user_profiles").select("free_1on1_sessions").eq("user_id", user_id).maybe_single()
    )
    count = int(((row.data if row else None) or {}).get("free_1on1_sessions") or 0)
    if count <= 0:
        raise HTTPException(status_code=400, detail="No tienes sesiones 1:1 gratis disponibles")

    # Compare-and-swap on the exact value just read, not a blind
    # decrement — two concurrent requests (double-click, retry) both
    # reading count=1 would otherwise both pass the check above and both
    # write free_1on1_sessions=0, spending the same single credit twice.
    # If a concurrent request already consumed it between our read and
    # this write, free_1on1_sessions no longer equals `count` and this
    # update matches zero rows instead of silently double-spending.
    result = await run_query(
        db.table("user_profiles")
        .update({"free_1on1_sessions": count - 1})
        .eq("user_id", user_id)
        .eq("free_1on1_sessions", count)
    )
    if not result.data:
        raise HTTPException(status_code=409, detail="Esa sesión ya fue redimida, intenta de nuevo")
    return {"ok": True, "remaining": count - 1}
