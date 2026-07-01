"""
Sync endpoints — persist user data that was previously AsyncStorage-only.
Every endpoint is an upsert (last-write-wins). Called silently in background
from the mobile app so the user's data survives reinstalls and device changes.

Scalability notes:
  - GET endpoints are cached with short TTLs to reduce DB hits at scale.
  - POST endpoints invalidate the relevant cache key after a successful write.
  - Portfolio/paper writes are last-write-wins (no locking). Under normal usage
    this is safe because clients always send the full state. If two devices write
    simultaneously, the last write wins — acceptable for eventual-consistency sync.
  - updated_at is returned on all reads so clients can detect stale local state.
"""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query
from app.core.cache import cache_get, cache_set, cache_delete

MAX_PORTFOLIOS = 3

router = APIRouter(prefix="/sync", tags=["sync"])

_NOW = lambda: datetime.now(timezone.utc).isoformat()

# Cache TTLs (seconds) — kept short because sync endpoints carry mutable state
_TTL_PORTFOLIO = 30    # portfolio changes on every trade
_TTL_PAPER     = 30    # paper trades change frequently
_TTL_MATURITY  = 120   # score updated on lesson completion
_TTL_ALL       = 20    # full restore — called on login, keep fresh
_TTL_MISC      = 60    # nav-order, theme, behavioral-risk


# ─── Portfolio ────────────────────────────────────────────────────────────────

def _parse_portfolio(raw) -> dict:
    """Parse portfolio data regardless of storage format (v1 array or v2 object)."""
    if isinstance(raw, list):
        return {"currency": "USD", "positions": raw}
    if isinstance(raw, dict) and "_v" in raw:
        return {"currency": raw.get("currency", "USD"), "positions": raw.get("positions", [])}
    return {"currency": "USD", "positions": []}


@router.post("/portfolio")
async def sync_portfolio(body: dict, user_id: str = Depends(get_current_user_id)):
    """Upsert portfolio positions + currency.
    body: { positions: [...], currency: 'USD', portfolio_id?: 'default', portfolio_name?: '...' }
    """
    positions     = body.get("positions", [])
    currency      = body.get("currency", "USD")
    portfolio_id  = body.get("portfolio_id", "default") or "default"
    portfolio_name = body.get("portfolio_name", "Mi portafolio") or "Mi portafolio"
    portfolio_state = {"_v": 2, "currency": currency, "positions": positions}
    db = get_supabase()
    await run_query(db.table("user_portfolio").upsert({
        "user_id":        user_id,
        "portfolio_id":   portfolio_id,
        "portfolio_name": portfolio_name,
        "positions":      portfolio_state,
        "updated_at":     _NOW(),
    }, on_conflict="user_id,portfolio_id"))
    cache_delete(f"sync:portfolio:{user_id}:{portfolio_id}")
    cache_delete(f"sync:portfolios:{user_id}")
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


@router.get("/portfolio")
async def get_portfolio(portfolio_id: str = "default", user_id: str = Depends(get_current_user_id)):
    ck = f"sync:portfolio:{user_id}:{portfolio_id}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    db = get_supabase()
    result = await run_query(
        db.table("user_portfolio")
        .select("positions, portfolio_name, updated_at")
        .eq("user_id", user_id)
        .eq("portfolio_id", portfolio_id)
    )
    if result.data:
        parsed = _parse_portfolio(result.data[0]["positions"])
        resp = {**parsed, "portfolio_name": result.data[0]["portfolio_name"], "updated_at": result.data[0]["updated_at"]}
    else:
        resp = {"positions": [], "currency": "USD", "portfolio_name": "Mi portafolio", "updated_at": None}
    cache_set(ck, resp, ttl=_TTL_PORTFOLIO)
    return resp


# ─── Multi-portfolio management (Premium) ─────────────────────────────────────

@router.get("/portfolios")
async def list_portfolios(user_id: str = Depends(get_current_user_id)):
    """List all portfolios for this user (id, name, position count, updated_at)."""
    ck = f"sync:portfolios:{user_id}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    db = get_supabase()
    result = await run_query(
        db.table("user_portfolio")
        .select("portfolio_id, portfolio_name, positions, updated_at")
        .eq("user_id", user_id)
        .order("updated_at")
    )
    portfolios = []
    for row in (result.data or []):
        parsed = _parse_portfolio(row["positions"])
        portfolios.append({
            "portfolio_id":   row["portfolio_id"],
            "portfolio_name": row["portfolio_name"],
            "positions":      parsed["positions"],
            "currency":       parsed["currency"],
            "updated_at":     row["updated_at"],
        })
    resp = {"portfolios": portfolios}
    cache_set(ck, resp, ttl=_TTL_PORTFOLIO)
    return resp


@router.post("/portfolios")
async def create_portfolio(body: dict, user_id: str = Depends(get_current_user_id)):
    """Create a new empty portfolio. Premium only, max 3 total."""
    db = get_supabase()
    profile_res = await run_query(
        db.table("user_profiles").select("subscription_tier").eq("user_id", user_id)
    )
    tier = (profile_res.data[0].get("subscription_tier") or "free") if profile_res.data else "free"
    if tier != "premium":
        raise HTTPException(status_code=403, detail="Los portafolios múltiples son exclusivos para usuarios Premium.")
    existing = await run_query(
        db.table("user_portfolio").select("portfolio_id").eq("user_id", user_id)
    )
    if len(existing.data or []) >= MAX_PORTFOLIOS:
        raise HTTPException(status_code=400, detail=f"Máximo {MAX_PORTFOLIOS} portafolios por cuenta.")
    portfolio_id   = f"p_{int(datetime.now(timezone.utc).timestamp() * 1000)}"
    portfolio_name = (body.get("name") or "Nuevo portafolio").strip()[:50]
    await run_query(db.table("user_portfolio").insert({
        "user_id":        user_id,
        "portfolio_id":   portfolio_id,
        "portfolio_name": portfolio_name,
        "positions":      {"_v": 2, "currency": "USD", "positions": []},
        "updated_at":     _NOW(),
    }))
    cache_delete(f"sync:portfolios:{user_id}")
    cache_delete(f"sync:all:{user_id}")
    return {"portfolio_id": portfolio_id, "portfolio_name": portfolio_name}


@router.put("/portfolios/{portfolio_id}")
async def rename_portfolio(portfolio_id: str, body: dict, user_id: str = Depends(get_current_user_id)):
    """Rename a portfolio."""
    name = (body.get("name") or "").strip()[:50]
    if not name:
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío.")
    db = get_supabase()
    await run_query(
        db.table("user_portfolio")
        .update({"portfolio_name": name, "updated_at": _NOW()})
        .eq("user_id", user_id)
        .eq("portfolio_id", portfolio_id)
    )
    cache_delete(f"sync:portfolios:{user_id}")
    return {"ok": True}


@router.delete("/portfolios/{portfolio_id}")
async def delete_portfolio(portfolio_id: str, user_id: str = Depends(get_current_user_id)):
    """Delete a portfolio. Cannot delete 'default'."""
    if portfolio_id == "default":
        raise HTTPException(status_code=400, detail="No puedes eliminar el portafolio principal.")
    db = get_supabase()
    await run_query(
        db.table("user_portfolio")
        .delete()
        .eq("user_id", user_id)
        .eq("portfolio_id", portfolio_id)
    )
    cache_delete(f"sync:portfolios:{user_id}")
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


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
    # Invalidate cached reads
    cache_delete(f"sync:paper:{user_id}")
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


@router.get("/paper")
async def get_paper(user_id: str = Depends(get_current_user_id)):
    ck = f"sync:paper:{user_id}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    db = get_supabase()
    result = await run_query(
        db.table("user_paper_trading")
        .select("cash, positions, trades, free_trade_month, free_trade_count, updated_at")
        .eq("user_id", user_id)
    )
    if result.data:
        r = result.data[0]
        resp = {
            "cash":           r["cash"],
            "positions":      r["positions"],
            "trades":         r["trades"],
            "freeTradeMonth": r["free_trade_month"],
            "freeTradeCount": r["free_trade_count"],
            "updated_at":     r["updated_at"],
        }
    else:
        resp = {"cash": 10000, "positions": [], "trades": [],
                "freeTradeMonth": None, "freeTradeCount": 0, "updated_at": None}
    cache_set(ck, resp, ttl=_TTL_PAPER)
    return resp


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
    cache_delete(f"sync:maturity:{user_id}")
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


@router.get("/maturity")
async def get_maturity(user_id: str = Depends(get_current_user_id)):
    ck = f"sync:maturity:{user_id}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    db = get_supabase()
    result = await run_query(
        db.table("user_profiles")
        .select("maturity_score, maturity_history")
        .eq("user_id", user_id)
    )
    if result.data:
        resp = {
            "score":   result.data[0].get("maturity_score", 0),
            "history": result.data[0].get("maturity_history", []),
        }
    else:
        resp = {"score": 0, "history": []}
    cache_set(ck, resp, ttl=_TTL_MATURITY)
    return resp


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
    ck = f"sync:all:{user_id}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    db = get_supabase()

    portfolio_res = await run_query(
        db.table("user_portfolio")
        .select("portfolio_id, portfolio_name, positions, updated_at")
        .eq("user_id", user_id)
        .order("updated_at")
    )
    paper_res = await run_query(
        db.table("user_paper_trading")
        .select("cash, positions, trades, free_trade_month, free_trade_count")
        .eq("user_id", user_id)
    )
    try:
        profile_res = await run_query(
            db.table("user_profiles")
            .select("maturity_score, maturity_history, trial_started_at, subscription_tier, nav_order, watchlist_order, theme, avatar_url, behavioral_risk_score, streak_count, last_learn_date, investment_goal, investment_goal_amount, completed_topic_ids, portfolio_view_mode, checklist_done, watchlist_view_mode")
            .eq("user_id", user_id)
        )
    except Exception:
        profile_res = await run_query(
            db.table("user_profiles")
            .select("maturity_score, maturity_history, trial_started_at, subscription_tier, nav_order, investment_goal, investment_goal_amount")
            .eq("user_id", user_id)
        )
    watchlist_res = await run_query(
        db.table("watchlist")
        .select("ticker, name, added_at")
        .eq("user_id", user_id)
        .order("added_at")
    )

    # Build per-portfolio list and default portfolio for backward compat
    all_portfolios = []
    default_positions, default_currency = [], "USD"
    for row in (portfolio_res.data or []):
        parsed = _parse_portfolio(row["positions"])
        all_portfolios.append({
            "portfolio_id":   row["portfolio_id"],
            "portfolio_name": row["portfolio_name"],
            "positions":      parsed["positions"],
            "currency":       parsed["currency"],
            "updated_at":     row["updated_at"],
        })
        if row["portfolio_id"] == "default":
            default_positions = parsed["positions"]
            default_currency  = parsed["currency"]
    # Fallback: if no default row, use first available
    if not default_positions and all_portfolios:
        default_positions = all_portfolios[0]["positions"]
        default_currency  = all_portfolios[0]["currency"]
    portfolio_parsed = {"positions": default_positions, "currency": default_currency}
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

    resp = {
        "portfolio": {
            "positions": portfolio_parsed["positions"],
            "currency":  portfolio_parsed["currency"],
        },
        "portfolios": all_portfolios,
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
        "watchlist_order":      profile_row.get("watchlist_order"),
        "theme":                profile_row.get("theme", "dark"),
        "avatar_url":           profile_row.get("avatar_url"),
        "behavioral_risk_score": profile_row.get("behavioral_risk_score"),
        "investment_goal":        profile_row.get("investment_goal"),
        "investment_goal_amount": profile_row.get("investment_goal_amount"),
        "streak": {
            "count":          profile_row.get("streak_count", 0) or 0,
            "last_learn_date": profile_row.get("last_learn_date"),
        },
        "completed_topic_ids": profile_row.get("completed_topic_ids") or [],
        "portfolio_view_mode":  profile_row.get("portfolio_view_mode", "basic"),
        "watchlist_view_mode":  profile_row.get("watchlist_view_mode", "basic"),
        "checklist_done":       bool(profile_row.get("checklist_done", False)),
    }
    cache_set(ck, resp, ttl=_TTL_ALL)
    return resp


# ─── Nav order ───────────────────────────────────────────────────────────────

@router.post("/nav-order")
async def sync_nav_order(body: dict, user_id: str = Depends(get_current_user_id)):
    """Persist tab navigation order for cross-device sync."""
    order = body.get("order", [])
    db = get_supabase()
    await run_query(db.table("user_profiles").update({"nav_order": order}).eq("user_id", user_id))
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


@router.get("/nav-order")
async def get_nav_order(user_id: str = Depends(get_current_user_id)):
    ck = f"sync:nav_order:{user_id}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    db = get_supabase()
    result = await run_query(db.table("user_profiles").select("nav_order").eq("user_id", user_id))
    resp = {"nav_order": result.data[0].get("nav_order")} if result.data else {"nav_order": None}
    cache_set(ck, resp, ttl=_TTL_MISC)
    return resp


# ─── Watchlist order ─────────────────────────────────────────────────────────

@router.post("/watchlist-order")
async def sync_watchlist_order(body: dict, user_id: str = Depends(get_current_user_id)):
    """Persist watchlist ticker order for cross-device sync."""
    order = body.get("order", [])
    db = get_supabase()
    await run_query(db.table("user_profiles").update({"watchlist_order": order}).eq("user_id", user_id))
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


# ─── Theme ───────────────────────────────────────────────────────────────────

@router.post("/theme")
async def sync_theme(body: dict, user_id: str = Depends(get_current_user_id)):
    """Persist the user's dark/light theme preference for cross-device sync."""
    theme = body.get("theme", "dark")
    if theme not in ("dark", "light"):
        theme = "dark"
    db = get_supabase()
    await run_query(db.table("user_profiles").update({"theme": theme}).eq("user_id", user_id))
    cache_delete(f"sync:theme:{user_id}")
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


@router.get("/theme")
async def get_theme(user_id: str = Depends(get_current_user_id)):
    ck = f"sync:theme:{user_id}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    db = get_supabase()
    result = await run_query(db.table("user_profiles").select("theme").eq("user_id", user_id))
    resp = {"theme": result.data[0].get("theme", "dark")} if result.data else {"theme": "dark"}
    cache_set(ck, resp, ttl=_TTL_MISC)
    return resp


# ─── Portfolio view mode ─────────────────────────────────────────────────────

@router.post("/portfolio-view-mode")
async def sync_portfolio_view_mode(body: dict, user_id: str = Depends(get_current_user_id)):
    """Persist the user's portfolio view mode (basic/advanced) for cross-device sync."""
    mode = body.get("mode", "basic")
    if mode not in ("basic", "advanced"):
        mode = "basic"
    db = get_supabase()
    await run_query(db.table("user_profiles").update({"portfolio_view_mode": mode}).eq("user_id", user_id))
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


# ─── Watchlist view mode ─────────────────────────────────────────────────────

@router.post("/watchlist-view-mode")
async def sync_watchlist_view_mode(body: dict, user_id: str = Depends(get_current_user_id)):
    """Persist the user's watchlist view mode (basic/advanced) for cross-device sync."""
    mode = body.get("mode", "basic")
    if mode not in ("basic", "advanced"):
        mode = "basic"
    db = get_supabase()
    await run_query(db.table("user_profiles").update({"watchlist_view_mode": mode}).eq("user_id", user_id))
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


# ─── Checklist done ───────────────────────────────────────────────────────────

@router.post("/checklist-done")
async def sync_checklist_done(user_id: str = Depends(get_current_user_id)):
    """Mark the onboarding checklist as permanently completed."""
    db = get_supabase()
    await run_query(db.table("user_profiles").update({"checklist_done": True}).eq("user_id", user_id))
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


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
        cache_delete(f"sync:all:{user_id}")
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
    # Ensure a notification_preferences row exists so scheduled jobs pick up this user.
    # ignore_duplicates=True preserves existing user preferences on conflict.
    await run_query(
        db.table("notification_preferences").upsert(
            {
                "user_id": user_id,
                "push_market_open": True,
                "push_market_close": True,
                "push_news_general": True,
                "push_portfolio_alerts": True,
                "push_watchlist_alerts": True,
                "push_ai_recommendations": True,
                "push_milestones": True,
                "push_volatility": True,
                "email_daily_summary": True,
                "email_weekly_summary": True,
                "max_push_per_day": 5,
                "max_push_per_week": 20,
            },
            on_conflict="user_id",
            ignore_duplicates=True,
        )
    )
    return {"ok": True}
