"""
Sync endpoints — persist user data that was previously AsyncStorage-only.
Every endpoint is an upsert (last-write-wins). Called silently in background
from the mobile app so the user's data survives reinstalls and device changes.
"""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends
from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query

router = APIRouter(prefix="/sync", tags=["sync"])

_NOW = lambda: datetime.now(timezone.utc).isoformat()


# ─── Portfolio ────────────────────────────────────────────────────────────────

@router.post("/portfolio")
async def sync_portfolio(body: dict, user_id: str = Depends(get_current_user_id)):
    """Upsert portfolio positions + currency. body: { positions: [...], currency: 'USD' }"""
    positions = body.get("positions", [])
    currency = body.get("currency", "USD")
    # Store as versioned wrapper object inside the JSONB field (no schema migration needed)
    portfolio_state = {"_v": 2, "currency": currency, "positions": positions}
    db = get_supabase()
    await run_query(db.table("user_portfolio").upsert({
        "user_id": user_id,
        "positions": portfolio_state,
        "updated_at": _NOW(),
    }, on_conflict="user_id"))
    return {"ok": True}


def _parse_portfolio(raw) -> dict:
    """Parse portfolio data regardless of storage format (v1 array or v2 object)."""
    if isinstance(raw, list):
        return {"currency": "USD", "positions": raw}
    if isinstance(raw, dict) and "_v" in raw:
        return {"currency": raw.get("currency", "USD"), "positions": raw.get("positions", [])}
    return {"currency": "USD", "positions": []}


@router.get("/portfolio")
async def get_portfolio(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    result = await run_query(
        db.table("user_portfolio").select("positions, updated_at").eq("user_id", user_id)
    )
    if result.data:
        parsed = _parse_portfolio(result.data[0]["positions"])
        return {**parsed, "updated_at": result.data[0]["updated_at"]}
    return {"positions": [], "currency": "USD", "updated_at": None}


# ─── Paper Trading ────────────────────────────────────────────────────────────

@router.post("/paper")
async def sync_paper(body: dict, user_id: str = Depends(get_current_user_id)):
    """Upsert full paper trading state.
    freeTradeMonth/Count are only updated when explicitly included in the body,
    so web-only pushes (which omit them) don't clear mobile-specific state.
    """
    db = get_supabase()
    update_data: dict = {
        "user_id":   user_id,
        "cash":      body.get("cash", 10000),
        "positions": body.get("positions", []),
        "trades":    body.get("trades", []),
        "updated_at": _NOW(),
    }
    if "freeTradeMonth" in body:
        update_data["free_trade_month"] = body["freeTradeMonth"]
    if "freeTradeCount" in body:
        update_data["free_trade_count"] = body["freeTradeCount"]
    await run_query(db.table("user_paper_trading").upsert(update_data, on_conflict="user_id"))
    return {"ok": True}


@router.get("/paper")
async def get_paper(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    result = await run_query(
        db.table("user_paper_trading")
        .select("cash, positions, trades, free_trade_month, free_trade_count, updated_at")
        .eq("user_id", user_id)
    )
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
    await run_query(
        db.table("user_profiles").update({
            "maturity_score":   body.get("score", 0),
            "maturity_history": body.get("history", []),
        }).eq("user_id", user_id)
    )
    return {"ok": True}


@router.get("/maturity")
async def get_maturity(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    result = await run_query(
        db.table("user_profiles")
        .select("maturity_score, maturity_history")
        .eq("user_id", user_id)
    )
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
    result = await run_query(
        db.table("user_profiles")
        .select("trial_started_at, subscription_tier")
        .eq("user_id", user_id)
    )
    if not result.data:
        return {"ok": False, "reason": "profile_not_found"}
    row = result.data[0]
    if row.get("subscription_tier") == "premium":
        return {"ok": False, "reason": "already_premium"}
    if row.get("trial_started_at"):
        return {"ok": True, "trial_started_at": row["trial_started_at"], "already_started": True}
    now = _NOW()
    await run_query(
        db.table("user_profiles")
        .update({"trial_started_at": now})
        .eq("user_id", user_id)
    )
    return {"ok": True, "trial_started_at": now, "already_started": False}


@router.get("/trial/status")
async def get_trial_status(user_id: str = Depends(get_current_user_id)):
    """Returns trial_started_at so the client can compute days remaining."""
    db = get_supabase()
    result = await run_query(
        db.table("user_profiles")
        .select("trial_started_at, subscription_tier")
        .eq("user_id", user_id)
    )
    if not result.data:
        return {"trial_started_at": None, "tier": "free"}
    row = result.data[0]
    trial_started_at = row.get("trial_started_at")
    is_active = False
    if trial_started_at:
        try:
            started = datetime.fromisoformat(trial_started_at.replace("Z", "+00:00"))
            is_active = datetime.now(timezone.utc) < started + timedelta(days=90)
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

    portfolio_res = await run_query(
        db.table("user_portfolio").select("positions").eq("user_id", user_id)
    )
    paper_res = await run_query(
        db.table("user_paper_trading")
        .select("cash, positions, trades, free_trade_month, free_trade_count")
        .eq("user_id", user_id)
    )
    try:
        profile_res = await run_query(
            db.table("user_profiles")
            .select("maturity_score, maturity_history, trial_started_at, subscription_tier, nav_order, theme, avatar_url, behavioral_risk_score, streak_count, last_learn_date")
            .eq("user_id", user_id)
        )
    except Exception:
        profile_res = await run_query(
            db.table("user_profiles")
            .select("maturity_score, maturity_history, trial_started_at, subscription_tier, nav_order")
            .eq("user_id", user_id)
        )
    watchlist_res = await run_query(
        db.table("watchlist")
        .select("ticker, name, added_at")
        .eq("user_id", user_id)
        .order("added_at")
    )

    raw_portfolio = portfolio_res.data[0]["positions"] if portfolio_res.data else []
    portfolio_parsed = _parse_portfolio(raw_portfolio)
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
            trial_active = datetime.now(timezone.utc) < started + timedelta(days=90)
        except Exception:
            pass

    return {
        "portfolio": {
            "positions": portfolio_parsed["positions"],
            "currency":  portfolio_parsed["currency"],
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
        "watchlist":   watchlist_res.data if watchlist_res.data else [],
        "nav_order":            profile_row.get("nav_order"),
        "theme":                profile_row.get("theme", "dark"),
        "avatar_url":           profile_row.get("avatar_url"),
        "behavioral_risk_score": profile_row.get("behavioral_risk_score"),
        "streak": {
            "count":          profile_row.get("streak_count", 0) or 0,
            "last_learn_date": profile_row.get("last_learn_date"),
        },
    }


# ─── Nav order ───────────────────────────────────────────────────────────────

@router.post("/nav-order")
async def sync_nav_order(body: dict, user_id: str = Depends(get_current_user_id)):
    """Persist tab navigation order for cross-device sync."""
    order = body.get("order", [])
    db = get_supabase()
    await run_query(db.table("user_profiles").update({"nav_order": order}).eq("user_id", user_id))
    return {"ok": True}


@router.get("/nav-order")
async def get_nav_order(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    result = await run_query(db.table("user_profiles").select("nav_order").eq("user_id", user_id))
    if result.data:
        return {"nav_order": result.data[0].get("nav_order")}
    return {"nav_order": None}


# ─── Theme ───────────────────────────────────────────────────────────────────

@router.post("/theme")
async def sync_theme(body: dict, user_id: str = Depends(get_current_user_id)):
    """Persist the user's dark/light theme preference for cross-device sync."""
    theme = body.get("theme", "dark")
    if theme not in ("dark", "light"):
        theme = "dark"
    db = get_supabase()
    await run_query(db.table("user_profiles").update({"theme": theme}).eq("user_id", user_id))
    return {"ok": True}


@router.get("/theme")
async def get_theme(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    result = await run_query(db.table("user_profiles").select("theme").eq("user_id", user_id))
    if result.data:
        return {"theme": result.data[0].get("theme", "dark")}
    return {"theme": "dark"}


# ─── Behavioral risk score ────────────────────────────────────────────────────

@router.post("/behavioral-risk")
async def sync_behavioral_risk(body: dict, user_id: str = Depends(get_current_user_id)):
    """Persist the user's computed behavioral risk score (0-100) for cross-device sync."""
    score = body.get("score")
    if score is None:
        return {"ok": False, "reason": "missing_score"}
    try:
        db = get_supabase()
        await run_query(
            db.table("user_profiles").update({"behavioral_risk_score": int(score)}).eq("user_id", user_id)
        )
        return {"ok": True}
    except Exception:
        return {"ok": False, "reason": "column_missing"}


@router.get("/behavioral-risk")
async def get_behavioral_risk(user_id: str = Depends(get_current_user_id)):
    try:
        db = get_supabase()
        result = await run_query(
            db.table("user_profiles").select("behavioral_risk_score").eq("user_id", user_id)
        )
        if result.data:
            return {"score": result.data[0].get("behavioral_risk_score")}
    except Exception:
        pass
    return {"score": None}


# ─── Push token ───────────────────────────────────────────────────────────────

@router.post("/push-token")
async def save_push_token(body: dict, user_id: str = Depends(get_current_user_id)):
    """Save or update the Expo push token for this device."""
    token = (body.get("token") or "").strip()
    if not token:
        return {"ok": False}
    db = get_supabase()
    await run_query(db.table("user_profiles").update({"push_token": token}).eq("user_id", user_id))
    return {"ok": True}
