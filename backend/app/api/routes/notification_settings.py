"""
Notification settings API.
GET/PUT /api/notification-settings         — user preferences
POST    /api/notification-settings/track   — track open/click events
GET     /api/notification-settings/analytics — admin engagement metrics
POST    /api/notifications/send-test       — dev only
"""
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query
from app.core.cache import cache_get, cache_set, cache_delete

router = APIRouter(tags=["notification-settings"])

_ADMIN_UID = "86961402-9072-4670-9f73-b2aa91930b04"

_DEFAULT_PREFS = {
    "push_market_open": True, "push_market_close": True,
    "push_news_general": True, "push_portfolio_alerts": True,
    "push_watchlist_alerts": True, "push_ai_recommendations": True,
    "push_milestones": True, "push_volatility": True,
    "email_daily_summary": True, "email_weekly_summary": True,
    "max_push_per_day": 15, "max_push_per_week": 60,
    "quiet_hours_start": 22, "quiet_hours_end": 8,
    "consecutive_ignores": 0, "snooze_until": None,
}


class PrefsUpdate(BaseModel):
    push_market_open:        Optional[bool] = None
    push_market_close:       Optional[bool] = None
    push_news_general:       Optional[bool] = None
    push_portfolio_alerts:   Optional[bool] = None
    push_watchlist_alerts:   Optional[bool] = None
    push_ai_recommendations: Optional[bool] = None
    push_milestones:         Optional[bool] = None
    push_volatility:         Optional[bool] = None
    email_daily_summary:     Optional[bool] = None
    email_weekly_summary:    Optional[bool] = None
    max_push_per_day:        Optional[int]  = None
    max_push_per_week:       Optional[int]  = None
    quiet_hours_start:       Optional[int]  = None
    quiet_hours_end:         Optional[int]  = None
    snooze_until:            Optional[str]  = None


class TrackEvent(BaseModel):
    notification_id: str
    event_type: str  # 'opened' | 'clicked'


@router.get("/notification-settings")
async def get_notification_settings(user_id: str = Depends(get_current_user_id)):
    ck = f"notif_prefs:{user_id}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    db = get_supabase()
    res = await run_query(db.table("notification_preferences").select("*").eq("user_id", user_id))
    if res.data:
        prefs = res.data[0]
    else:
        # First time — insert defaults so the worker can find this user
        prefs = {**_DEFAULT_PREFS, "user_id": user_id}
        try:
            await run_query(db.table("notification_preferences").insert(prefs))
        except Exception:
            pass
    cache_set(ck, prefs, ttl=300)
    return prefs


@router.put("/notification-settings")
async def update_notification_settings(
    body: PrefsUpdate,
    user_id: str = Depends(get_current_user_id),
):
    db = get_supabase()
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update_data:
        return {"ok": True}
    update_data["user_id"] = user_id
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await run_query(
        db.table("notification_preferences").upsert(update_data, on_conflict="user_id")
    )
    cache_delete(f"notif_prefs:{user_id}")
    return {"ok": True}


@router.post("/notification-settings/track")
async def track_notification_event(
    body: TrackEvent,
    user_id: str = Depends(get_current_user_id),
):
    from app.services.notification_engine import track_event
    db = get_supabase()
    await track_event(body.notification_id, body.event_type, db)
    return {"ok": True}


@router.get("/notification-settings/analytics")
async def get_analytics(user_id: str = Depends(get_current_user_id)):
    if user_id != _ADMIN_UID:
        raise HTTPException(status_code=403, detail="Admin only")
    db = get_supabase()
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    week_start  = (now - timedelta(days=7)).isoformat()
    month_start = (now - timedelta(days=30)).isoformat()

    today_res = await run_query(
        db.table("notification_log").select("id", count="exact")
        .gte("sent_at", today_start).eq("status", "sent")
    )
    week_res = await run_query(
        db.table("notification_log").select("id", count="exact")
        .gte("sent_at", week_start).eq("status", "sent")
    )
    month_res = await run_query(
        db.table("notification_log").select("id", count="exact")
        .gte("sent_at", month_start).eq("status", "sent")
    )

    logs_res = await run_query(
        db.table("notification_log").select("category,status,opened_at,type")
        .gte("sent_at", month_start).eq("type", "push")
    )
    category_stats: dict = {}
    for row in (logs_res.data or []):
        cat = row["category"]
        if cat not in category_stats:
            category_stats[cat] = {"sent": 0, "opened": 0}
        category_stats[cat]["sent"] += 1
        if row.get("opened_at"):
            category_stats[cat]["opened"] += 1

    open_rates = sorted([
        {
            "category":  cat,
            "sent":      v["sent"],
            "opened":    v["opened"],
            "open_rate": round(v["opened"] / v["sent"] * 100, 1) if v["sent"] else 0,
        }
        for cat, v in category_stats.items()
    ], key=lambda x: x["open_rate"], reverse=True)

    return {
        "totals": {
            "today": today_res.count or 0,
            "week":  week_res.count  or 0,
            "month": month_res.count or 0,
        },
        "open_rates_by_category": open_rates,
    }


@router.post("/admin/send-notification")
async def admin_send_notification(
    body: dict,
    user_id: str = Depends(get_current_user_id),
):
    """Admin-only: send a custom push notification to yourself."""
    if user_id != _ADMIN_UID:
        raise HTTPException(status_code=403, detail="Admin only")
    from app.services.push_service import send_push as expo_push
    from app.core.database import run_query
    db = get_supabase()
    tok_res = await run_query(db.table("user_profiles").select("push_token").eq("user_id", user_id))
    token = (tok_res.data[0].get("push_token") or "") if tok_res.data else ""
    if not token:
        return {"ok": False, "error": "no push token"}
    await expo_push(
        token,
        title=body.get("title", "Test"),
        body=body.get("body", ""),
        data=body.get("data", {}),
    )
    return {"ok": True, "token": token[:30] + "..."}


@router.post("/notifications/send-test")
async def send_test_notification(
    body: dict,
    user_id: str = Depends(get_current_user_id),
):
    from app.core.config import settings
    if settings.environment != "development":
        raise HTTPException(status_code=403, detail="Dev only")
    from app.services.notification_engine import send_push
    db = get_supabase()
    await send_push(
        user_id,
        body.get("category", "test"),
        body.get("title", "Test"),
        body.get("body", "Notificación de prueba"),
        body.get("data", {}),
        db,
    )
    return {"ok": True}


class PricePayload(BaseModel):
    prices: dict  # {ticker: {curr: float, prev: float}}

@router.post("/admin/trigger-price-alerts")
async def trigger_price_alerts(
    body: PricePayload,
    user_id: str = Depends(get_current_user_id),
):
    """Admin-only: fan out push notifications using caller-provided prices.
    Prices are fetched locally (yfinance works there) and POSTed here,
    bypassing Railway IP blocks on Yahoo Finance."""
    if user_id != _ADMIN_UID:
        raise HTTPException(status_code=403, detail="Admin only")
    from app.core.database import run_query
    from app.services.notification_engine import send_push

    db = get_supabase()

    # 1. Compute moves from provided prices
    moves: dict = {}
    for t, px in body.prices.items():
        prev = px.get("prev", 0)
        curr = px.get("curr", 0)
        if prev and prev > 0:
            pct = round((curr - prev) / prev * 100, 2)
            if abs(pct) >= 2.0:
                moves[t] = {"pct": pct, "price": curr}

    if not moves:
        return {"error": "no movers ≥2% in provided prices", "prices_received": len(body.prices)}

    # 2. Discover all eligible users — don't gate on notification_preferences
    prefs_res = await run_query(
        db.table("notification_preferences").select("user_id,push_portfolio_alerts,push_watchlist_alerts")
    )
    explicit_prefs: dict = {p["user_id"]: p for p in (prefs_res.data or [])}

    token_res = await run_query(
        db.table("user_profiles").select("user_id,push_token").neq("push_token", "").not_.is_("push_token", "null")
    )
    token_uids = {r["user_id"] for r in (token_res.data or [])}
    watch_uid_res = await run_query(db.table("watchlist").select("user_id"))
    watch_uids = {r["user_id"] for r in (watch_uid_res.data or [])}
    port_uid_res = await run_query(db.table("user_portfolio").select("user_id"))
    port_uids_all = {r["user_id"] for r in (port_uid_res.data or [])}

    all_candidate_uids = (token_uids & (watch_uids | port_uids_all)) | (set(explicit_prefs.keys()) & (watch_uids | port_uids_all))
    if not all_candidate_uids:
        return {"error": "no eligible users found"}

    user_tickers: dict = {}
    for uid in all_candidate_uids:
        port_map: dict = {}
        watch_set: set = set()
        wants_port  = explicit_prefs.get(uid, {}).get("push_portfolio_alerts", True)
        wants_watch = explicit_prefs.get(uid, {}).get("push_watchlist_alerts", True)
        if wants_port and uid in port_uids_all:
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if port_res.data:
                raw = port_res.data[0].get("positions") or {}
                pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                port_map = {
                    x["ticker"]: {
                        "shares": float(x.get("shares") or 0),
                        "avg_cost": float(x.get("avg_cost") or x.get("avg_price") or x.get("avgPrice") or 0),
                    }
                    for x in pos if x.get("ticker")
                }
        if wants_watch and uid in watch_uids:
            w_res = await run_query(db.table("watchlist").select("ticker").eq("user_id", uid))
            watch_set = {r["ticker"] for r in (w_res.data or [])} - set(port_map.keys())
        if port_map or watch_set:
            user_tickers[uid] = {"port": port_map, "watch": watch_set}

    # 3. Batch-fetch names + tiers (including trial_started_at for trial detection)
    def _check_premium(tier: str, trial_started: str | None) -> bool:
        if tier in ("premium", "pro"):
            return True
        if trial_started:
            try:
                from datetime import datetime, timezone
                started = datetime.fromisoformat(trial_started.replace("Z", "+00:00"))
                return (datetime.now(timezone.utc) - started).days < 90
            except Exception:
                pass
        return False

    all_uids = list(user_tickers.keys())
    prof_res = await run_query(
        db.table("user_profiles")
        .select("user_id,name,subscription_tier,trial_started_at")
        .in_("user_id", all_uids)
    )
    user_meta = {
        r["user_id"]: {
            "first":      (r.get("name") or "Inversor").split()[0],
            "is_premium": _check_premium(r.get("subscription_tier", "free"), r.get("trial_started_at")),
        }
        for r in (prof_res.data or [])
    }

    # 4. Pre-generate WHY explanations via Claude — once per ticker, reused across users
    import asyncio
    from app.services.price_alert_service import fetch_ticker_news, generate_price_alert_why

    ticker_why:   dict = {}
    ticker_title: dict = {}
    for ticker, mv in moves.items():
        pct   = mv["pct"]
        price = mv["price"]
        news  = await asyncio.to_thread(fetch_ticker_news, ticker)
        why   = await generate_price_alert_why(ticker, pct, price, news)
        ticker_why[ticker]   = why
        emoji = "📉" if pct <= -5 else "🔻" if pct < 0 else "🚀" if pct >= 5 else "📈"
        ticker_title[ticker] = f"{emoji} {ticker} {pct:+.1f}% hoy"

    # 5. Fan out — personalized for premium, generic for free
    sent_pushes = []
    for uid, sets in user_tickers.items():
        meta     = user_meta.get(uid, {"first": "Inversor", "is_premium": False})
        first    = meta["first"]
        is_prem  = meta["is_premium"]
        port_map = sets["port"]
        port_movers  = sorted(set(port_map.keys()) & moves.keys(),
                              key=lambda t: abs(moves[t]["pct"]), reverse=True)
        watch_movers = sorted(sets["watch"] & moves.keys(),
                              key=lambda t: abs(moves[t]["pct"]), reverse=True)

        for ticker in port_movers + watch_movers:
            pct          = moves[ticker]["pct"]
            price        = moves[ticker]["price"]
            is_portfolio = ticker in port_map
            screen       = "portfolio" if is_portfolio else "watchlist"
            title        = ticker_title[ticker]

            if is_prem:
                why = ticker_why[ticker]
                if is_portfolio:
                    shares         = port_map[ticker].get("shares", 0.0)
                    position_value = shares * price if shares else 0.0
                    dollar_delta   = position_value * pct / 100 if position_value else None
                    if position_value and dollar_delta is not None:
                        gl         = "perdiste" if pct < 0 else "ganaste"
                        shares_fmt = f"{shares:.4f}".rstrip("0").rstrip(".") if shares < 1 else f"{shares:.2f}".rstrip("0").rstrip(".")
                        impact     = f" {first}, {gl} ~${abs(dollar_delta):,.0f} hoy ({shares_fmt} acciones × ${price:.2f})."
                        max_b      = 230 - len(impact)
                        body       = (why[:max_b] if len(why) > max_b else why) + impact
                    else:
                        body = why
                else:
                    suffix = " La tienes en tu watchlist."
                    max_b  = 230 - len(suffix)
                    body   = (why[:max_b] if len(why) > max_b else why) + suffix
            else:
                direction = "bajó" if pct < 0 else "subió"
                if is_portfolio:
                    body = (
                        f"{ticker} {direction} {abs(pct):.1f}% hoy a ${price:.2f}. "
                        f"Activa Premium para ver el impacto en tu portafolio."
                    )
                else:
                    body = (
                        f"{ticker} {direction} {abs(pct):.1f}% hoy a ${price:.2f}. "
                        f"Activa Premium para ver el análisis completo."
                    )

            await send_push(uid, f"price_mover_{ticker}", title, body,
                            {"ticker": ticker, "change_pct": pct, "price": price, "screen": screen}, db)
            sent_pushes.append({"user": uid[:8], "ticker": ticker, "pct": pct,
                                 "price": price, "body": body, "premium": is_prem,
                                 "source": "portfolio" if is_portfolio else "watchlist"})

    return {
        "movers": {t: v for t, v in sorted(moves.items(), key=lambda x: abs(x[1]["pct"]), reverse=True)},
        "pushes_sent": sent_pushes,
    }


class MarketClosePayload(BaseModel):
    # caller fetches locally (Railway is IP-blocked by Yahoo Finance) and sends here
    prices: dict  # {"^GSPC": {"prev": float, "curr": float}, "AAPL": {...}, ...}

@router.post("/admin/trigger-market-close-email")
async def trigger_market_close_email(
    body: MarketClosePayload,
    user_id: str = Depends(get_current_user_id),
):
    """Admin-only: fire the market close email + push for the admin user.
    Caller must supply pre-fetched prices (Railway blocks Yahoo Finance):
      prices: { "^GSPC": {prev, curr}, "^IXIC": {prev, curr}, "<TICKER>": {prev, curr}, ... }
    """
    if user_id != _ADMIN_UID:
        raise HTTPException(status_code=403, detail="Admin only")

    from app.services.notification_engine import send_push, send_email_notification
    from app.services.email_templates import daily_email_v2

    db = get_supabase()
    all_prices = body.prices  # pre-fetched by caller

    def _pct(sym):
        px = all_prices.get(sym, {})
        return round((px["curr"] - px["prev"]) / px["prev"] * 100, 2) if px.get("prev") else None

    sp500_pct  = _pct("^GSPC")
    nasdaq_pct = _pct("^IXIC")
    index_px   = all_prices

    # ── Fetch user portfolio from DB ────────────────────────────────────────────
    port_res = await run_query(
        db.table("user_portfolio").select("positions").eq("user_id", user_id)
    )
    positions = []
    if port_res.data:
        raw = port_res.data[0].get("positions") or {}
        positions = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])

    # Use caller-supplied prices for portfolio tickers
    port_prices = all_prices

    # ── Calculate portfolio % change ────────────────────────────────────────────
    user_pct = None
    total_curr = None
    if positions and port_prices:
        total_prev = 0.0
        total_curr = 0.0
        for p in positions:
            t = p.get("ticker")
            shares = float(p.get("shares") or 0)
            if t and shares and t in port_prices:
                total_prev += shares * port_prices[t]["prev"]
                total_curr += shares * port_prices[t]["curr"]
        if total_prev > 0:
            user_pct = round((total_curr - total_prev) / total_prev * 100, 2)

    # ── User name ───────────────────────────────────────────────────────────────
    prof_res = await run_query(db.table("user_profiles").select("name").eq("user_id", user_id))
    first = ((prof_res.data[0].get("name") or "Diego") if prof_res.data else "Diego").split()[0]

    # ── Build notification content ──────────────────────────────────────────────
    sp_line = f"S&P 500: {sp500_pct:+.2f}%" if sp500_pct is not None else "S&P 500: N/D"
    nq_line = f"Nasdaq: {nasdaq_pct:+.2f}%"  if nasdaq_pct is not None else "Nasdaq: N/D"
    indices  = f"{sp_line} · {nq_line}"

    if user_pct is not None:
        beating = sp500_pct is not None and user_pct > sp500_pct
        push_body = (
            f"Tu portafolio: {user_pct:+.2f}% · {indices}\n\n"
            + ("¡Enhorabuena! Hoy superaste al mercado." if beating
               else "El mercado tuvo mejor desempeño hoy. Mañana es otra oportunidad.")
        )
        push_title = "🏆 Superaste al mercado hoy" if beating else "📊 El mercado ha cerrado"
    else:
        push_body  = indices
        push_title = "📊 El mercado ha cerrado"

    # ── Send push notification ──────────────────────────────────────────────────
    # Use timestamp suffix to bypass per-day dedup on repeated test calls
    import time as _time
    test_category = f"market_close_test_{int(_time.time())}"
    await send_push(user_id, test_category, push_title, push_body, {"screen": "portfolio"}, db)

    # ── Build and send email ────────────────────────────────────────────────────
    # Collect top movers for email
    top_gainers, top_losers = [], []
    for p in positions:
        t = p.get("ticker")
        if t and t in port_prices:
            px   = port_prices[t]
            pct  = round((px["curr"] - px["prev"]) / px["prev"] * 100, 2) if px["prev"] else 0
            shares = float(p.get("shares") or 0)
            entry = {"ticker": t, "pct": pct, "price": px["curr"],
                     "dollar_change": shares * px["curr"] * pct / 100 if shares else 0}
            if pct >= 0:
                top_gainers.append(entry)
            else:
                top_losers.append(entry)
    top_gainers.sort(key=lambda x: x["pct"], reverse=True)
    top_losers.sort(key=lambda x: x["pct"])

    html = daily_email_v2(
        first_name=first,
        port_pct=user_pct,
        port_usd=total_curr if positions else None,
        sp_pct=sp500_pct,
        sp_px=index_px.get("^GSPC", {}).get("curr"),
        nq_pct=nasdaq_pct,
        nq_px=index_px.get("^IXIC", {}).get("curr"),
        top_gainers=top_gainers[:3],
        top_losers=top_losers[:3],
        ai_summary=None,
    )
    subject = (
        f"Tu portafolio hoy: {'+' if user_pct and user_pct >= 0 else ''}{user_pct:.2f}% — Nuvos AI"
        if user_pct is not None else "El mercado cerró hoy — Nuvos AI"
    )
    await send_email_notification(user_id, "market_close_test", subject, html, db)

    tickers_in_portfolio = [p["ticker"] for p in positions if p.get("ticker")]
    tickers_with_price   = [t for t in tickers_in_portfolio if t in all_prices]
    tickers_missing      = [t for t in tickers_in_portfolio if t not in all_prices]

    return {
        "ok": True,
        "push_title": push_title,
        "push_body": push_body,
        "email_subject": subject,
        "sp500_pct": sp500_pct,
        "nasdaq_pct": nasdaq_pct,
        "user_pct": user_pct,
        "positions_count": len(positions),
        "tickers_in_portfolio": tickers_in_portfolio,
        "tickers_with_price": tickers_with_price,
        "tickers_missing_price": tickers_missing,
    }
