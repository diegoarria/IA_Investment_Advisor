"""
Sync endpoints — persist user data that was previously AsyncStorage-only.
Every endpoint is an upsert (last-write-wins). Called silently in background
from the mobile app so the user's data survives reinstalls and device changes.
"""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends
from app.api.deps import get_current_user_id
from app.core.database import get_supabase

router = APIRouter(prefix="/sync", tags=["sync"])

_NOW = lambda: datetime.now(timezone.utc).isoformat()


# ─── Portfolio ────────────────────────────────────────────────────────────────

@router.post("/portfolio")
async def sync_portfolio(body: dict, user_id: str = Depends(get_current_user_id)):
    """Upsert portfolio positions. body: { positions: [...] }"""
    positions = body.get("positions", [])
    db = get_supabase()
    db.table("user_portfolio").upsert({
        "user_id": user_id,
        "positions": positions,
        "updated_at": _NOW(),
    }, on_conflict="user_id").execute()
    return {"ok": True}


@router.get("/portfolio")
async def get_portfolio(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    result = db.table("user_portfolio").select("positions, updated_at") \
        .eq("user_id", user_id).execute()
    if result.data:
        return result.data[0]
    return {"positions": [], "updated_at": None}


# ─── Paper Trading ────────────────────────────────────────────────────────────

@router.post("/paper")
async def sync_paper(body: dict, user_id: str = Depends(get_current_user_id)):
    """Upsert full paper trading state."""
    db = get_supabase()
    db.table("user_paper_trading").upsert({
        "user_id":          user_id,
        "cash":             body.get("cash", 10000),
        "positions":        body.get("positions", []),
        "trades":           body.get("trades", []),
        "free_trade_month": body.get("freeTradeMonth"),
        "free_trade_count": body.get("freeTradeCount", 0),
        "updated_at":       _NOW(),
    }, on_conflict="user_id").execute()
    return {"ok": True}


@router.get("/paper")
async def get_paper(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    result = db.table("user_paper_trading") \
        .select("cash, positions, trades, free_trade_month, free_trade_count, updated_at") \
        .eq("user_id", user_id).execute()
    if result.data:
        r = result.data[0]
        return {
            "cash":           r["cash"],
            "positions":      r["positions"],
            "trades":         r["trades"],
            "freeTradeMonth": r["free_trade_month"],
            "freeTradeCount": r["free_trade_count"],
            "updated_at":     r["updated_at"],
        }
    return {"cash": 10000, "positions": [], "trades": [],
            "freeTradeMonth": None, "freeTradeCount": 0, "updated_at": None}


# ─── Maturity Score ───────────────────────────────────────────────────────────

@router.post("/maturity")
async def sync_maturity(body: dict, user_id: str = Depends(get_current_user_id)):
    """Upsert maturity score + history."""
    db = get_supabase()
    db.table("user_profiles").update({
        "maturity_score":   body.get("score", 0),
        "maturity_history": body.get("history", []),
    }).eq("user_id", user_id).execute()
    return {"ok": True}


@router.get("/maturity")
async def get_maturity(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    result = db.table("user_profiles") \
        .select("maturity_score, maturity_history") \
        .eq("user_id", user_id).execute()
    if result.data:
        return {
            "score":   result.data[0].get("maturity_score", 0),
            "history": result.data[0].get("maturity_history", []),
        }
    return {"score": 0, "history": []}


# ─── Trial ────────────────────────────────────────────────────────────────────

@router.post("/trial/start")
async def start_trial(user_id: str = Depends(get_current_user_id)):
    """Record trial start date in the DB. Idempotent — only sets if not already set."""
    db = get_supabase()
    result = db.table("user_profiles") \
        .select("trial_started_at, subscription_tier") \
        .eq("user_id", user_id).execute()
    if not result.data:
        return {"ok": False, "reason": "profile_not_found"}
    row = result.data[0]
    if row.get("subscription_tier") == "premium":
        return {"ok": False, "reason": "already_premium"}
    if row.get("trial_started_at"):
        return {"ok": True, "trial_started_at": row["trial_started_at"], "already_started": True}
    now = _NOW()
    db.table("user_profiles") \
        .update({"trial_started_at": now}) \
        .eq("user_id", user_id).execute()
    return {"ok": True, "trial_started_at": now, "already_started": False}


@router.get("/trial/status")
async def get_trial_status(user_id: str = Depends(get_current_user_id)):
    """Returns trial_started_at so the client can compute days remaining."""
    db = get_supabase()
    result = db.table("user_profiles") \
        .select("trial_started_at, subscription_tier") \
        .eq("user_id", user_id).execute()
    if not result.data:
        return {"trial_started_at": None, "tier": "free"}
    row = result.data[0]
    trial_started_at = row.get("trial_started_at")
    is_active = False
    if trial_started_at:
        try:
            started = datetime.fromisoformat(trial_started_at.replace("Z", "+00:00"))
            is_active = datetime.now(timezone.utc) < started + timedelta(days=7)
        except Exception:
            pass
    return {
        "trial_started_at": trial_started_at,
        "trial_active":     is_active,
        "tier":             row.get("subscription_tier", "free"),
    }


# ─── Full restore (called on login) ──────────────────────────────────────────

@router.get("/all")
async def get_all(user_id: str = Depends(get_current_user_id)):
    """Single call that returns everything needed to restore user state after login."""
    db = get_supabase()

    portfolio_res = db.table("user_portfolio") \
        .select("positions").eq("user_id", user_id).execute()
    paper_res = db.table("user_paper_trading") \
        .select("cash, positions, trades, free_trade_month, free_trade_count") \
        .eq("user_id", user_id).execute()
    profile_res = db.table("user_profiles") \
        .select("maturity_score, maturity_history, trial_started_at, subscription_tier") \
        .eq("user_id", user_id).execute()

    portfolio = portfolio_res.data[0]["positions"] if portfolio_res.data else []
    paper = paper_res.data[0] if paper_res.data else {
        "cash": 10000, "positions": [], "trades": [],
        "free_trade_month": None, "free_trade_count": 0,
    }
    profile_row = profile_res.data[0] if profile_res.data else {}

    trial_started_at = profile_row.get("trial_started_at")
    trial_active = False
    if trial_started_at:
        try:
            started = datetime.fromisoformat(trial_started_at.replace("Z", "+00:00"))
            trial_active = datetime.now(timezone.utc) < started + timedelta(days=7)
        except Exception:
            pass

    return {
        "portfolio": {
            "positions": portfolio,
        },
        "paper": {
            "cash":           paper["cash"],
            "positions":      paper["positions"],
            "trades":         paper["trades"],
            "freeTradeMonth": paper["free_trade_month"],
            "freeTradeCount": paper["free_trade_count"],
        },
        "maturity": {
            "score":   profile_row.get("maturity_score", 0),
            "history": profile_row.get("maturity_history", []),
        },
        "trial": {
            "trial_started_at": trial_started_at,
            "trial_active":     trial_active,
            "tier":             profile_row.get("subscription_tier", "free"),
        },
    }


# ─── Push token ───────────────────────────────────────────────────────────────

@router.post("/push-token")
async def save_push_token(body: dict, user_id: str = Depends(get_current_user_id)):
    """Save or update the Expo push token for this device."""
    token = (body.get("token") or "").strip()
    if not token:
        return {"ok": False}
    db = get_supabase()
    db.table("user_profiles").update({"push_token": token}).eq("user_id", user_id).execute()
    return {"ok": True}
