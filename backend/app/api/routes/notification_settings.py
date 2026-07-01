"""
Notification settings API.
GET/PUT /api/notification-settings         — user preferences
POST    /api/notification-settings/track   — track open/click events
GET     /api/notification-settings/analytics — admin engagement metrics
POST    /api/notifications/send-test       — dev only
"""
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
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


@router.post("/admin/send-monthly-report")
async def admin_send_monthly_report(
    body: dict,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    """Admin-only: trigger monthly report email in background (returns immediately)."""
    if user_id != _ADMIN_UID:
        raise HTTPException(status_code=403, detail="Admin only")
    target_email = body.get("email", "").strip().lower()
    month_override = body.get("month", "")
    if not target_email:
        raise HTTPException(status_code=400, detail="email required")

    import asyncio
    db = get_supabase()

    # Resolve user_id from email synchronously before returning
    try:
        auth_users = await asyncio.to_thread(lambda: db.auth.admin.list_users())
        target_uid = next((u.id for u in auth_users if (u.email or "").lower() == target_email), None)
    except Exception:
        target_uid = None
    if not target_uid:
        raise HTTPException(status_code=404, detail=f"User not found: {target_email}")

    prof_res = await run_query(db.table("user_profiles").select("name").eq("user_id", target_uid))
    name = (prof_res.data[0].get("name") or "Inversor") if prof_res.data else "Inversor"

    async def _build_and_send():
        from app.services.email_service import build_monthly_report_html, send_email
        from app.services import ai_service
        from app.api.routes.market import _get_user_profile
        from app.core.finnhub import fh_candles, fh_quote
        from datetime import datetime as _dt, timezone as _tz
        import calendar
        import time as _time
        import logging
        _log = logging.getLogger(__name__)
        try:
            # ── Parse month label → date range ─────────────────────────────
            label = month_override or "Julio 2026"
            _MONTHS = {
                "enero":1,"febrero":2,"marzo":3,"abril":4,"mayo":5,"junio":6,
                "julio":7,"agosto":8,"septiembre":9,"octubre":10,"noviembre":11,"diciembre":12,
            }
            parts = label.lower().split()
            month_num = _MONTHS.get(parts[0], 7)
            year_num  = int(parts[1]) if len(parts) > 1 else _dt.now().year
            last_day  = calendar.monthrange(year_num, month_num)[1]
            start_dt  = _dt(year_num, month_num, 1, tzinfo=_tz.utc)
            end_dt    = _dt(year_num, month_num, last_day, 23, 59, 59, tzinfo=_tz.utc)
            # If end is in the future, cap at now
            now_dt    = _dt.now(_tz.utc)
            if end_dt > now_dt:
                end_dt = now_dt
            from_ts = int(start_dt.timestamp())
            to_ts   = int(end_dt.timestamp())

            # ── Load portfolio positions ─────────────────────────────────────
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", target_uid))
            if not port_res.data:
                _log.error("admin monthly report: no portfolio for %s", target_uid); return
            raw = port_res.data[0]["positions"]
            positions = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
            if not positions:
                _log.error("admin monthly report: empty portfolio for %s", target_uid); return

            # ── Fetch monthly candles per ticker ─────────────────────────────
            # Use first close of month as start_price, last close as end_price.
            # Fallback to live quote if candles unavailable.
            portfolio = []
            total_start_value = 0.0
            total_end_value   = 0.0

            for p in positions:
                ticker = p.get("ticker")
                if not ticker:
                    continue
                shares = float(p.get("shares", 0) or 0)
                if shares <= 0:
                    continue

                candles = await asyncio.to_thread(fh_candles, ticker, "D", from_ts, to_ts)
                if candles and len(candles) >= 1:
                    start_price = float(candles[0]["c"])   # first trading day of month
                    end_price   = float(candles[-1]["c"])  # last trading day so far
                else:
                    # Fallback: live quote for both (shows 0% if no history)
                    q = await asyncio.to_thread(fh_quote, ticker)
                    start_price = end_price = float(q["price"]) if q and q.get("price") else 0.0

                month_return_pct = ((end_price - start_price) / start_price * 100) if start_price > 0 else 0.0
                start_val = shares * start_price
                end_val   = shares * end_price
                total_start_value += start_val
                total_end_value   += end_val

                portfolio.append({
                    "ticker":        ticker,
                    "name":          p.get("name", ticker),
                    "shares":        shares,
                    "avg_cost":      start_price,   # monthly baseline
                    "current_price": end_price,
                    "gain_pct":      round(month_return_pct, 2),
                    "value":         round(end_val, 2),
                })

            if not portfolio:
                _log.error("admin monthly report: could not price any position"); return

            # ── Build performance dict (monthly) ──────────────────────────────
            portfolio_month_pct = ((total_end_value - total_start_value) / total_start_value * 100) if total_start_value > 0 else 0.0
            monthly_gain        = total_end_value - total_start_value
            sorted_pos = sorted(portfolio, key=lambda x: x["gain_pct"], reverse=True)

            performance = {
                "total_value":      round(total_end_value, 2),
                "total_invested":   round(total_start_value, 2),
                "unrealized_gain":  round(monthly_gain, 2),
                "total_return_pct": round(portfolio_month_pct, 2),
                "best_performer":   {"ticker": sorted_pos[0]["ticker"],  "gain_pct": sorted_pos[0]["gain_pct"]}  if sorted_pos else None,
                "worst_performer":  {"ticker": sorted_pos[-1]["ticker"], "loss_pct": sorted_pos[-1]["gain_pct"]} if sorted_pos else None,
                "positions":        sorted_pos[:10],
            }

            profile = _get_user_profile(target_uid)
            report  = await ai_service.generate_monthly_report(portfolio, performance, profile)
            report["performance"] = {**report.get("performance", {}),
                "total_return_pct": performance["total_return_pct"],
                "total_value":      performance["total_value"],
                "unrealized_gain":  performance["unrealized_gain"],
                "best_performer":   performance["best_performer"],
                "worst_performer":  performance["worst_performer"],
            }
            report["metrics"]       = {**report.get("metrics", {}), "total_value": performance["total_value"], "unrealized_gain": performance["unrealized_gain"]}
            report["top_positions"] = performance["positions"]

            html  = build_monthly_report_html(name, report, label)
            first = name.split()[0]
            ok    = await send_email(target_email, f"📊 Tu reporte mensual de {label}, {first}", html)
            _log.info("admin monthly report sent=%s to %s (month_pct=%.2f%%)", ok, target_email, portfolio_month_pct)
        except Exception as e:
            _log.error("admin monthly report failed for %s: %s", target_email, e, exc_info=True)

    background_tasks.add_task(_build_and_send)
    return {"ok": True, "status": "queued", "sent_to": target_email}


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


# ── Admin: test earnings notification ────────────────────────────────────────

class EarningsTestPayload(BaseModel):
    ticker: str
    eps_actual: float
    eps_estimate: float
    hour: str = "AMC"          # "BMO" | "AMC"
    rev_actual_b: float | None = None
    rev_estimate_b: float | None = None


def _get_pos_field(pos: dict, *keys: str) -> float:
    """Read a field from a position dict supporting both camelCase and snake_case keys."""
    for k in keys:
        v = pos.get(k)
        if v is not None:
            return float(v)
    return 0.0


def _finnhub_current_price(ticker: str) -> float | None:
    """Fetch real-time price from Finnhub /quote."""
    import os, requests as req_lib
    key = os.getenv("FINNHUB_API_KEY", "")
    if not key:
        return None
    try:
        r = req_lib.get(
            "https://finnhub.io/api/v1/quote",
            params={"symbol": ticker, "token": key},
            timeout=8,
        )
        data = r.json()
        price = data.get("c")
        return float(price) if price else None
    except Exception:
        return None


async def _earnings_ai_summary(
    ticker: str,
    eps_actual: float,
    eps_estimate: float,
    beat: bool,
    beat_pct: float | None,
    rev_actual_b: float | None,
    rev_estimate_b: float | None,
    shares: float | None,
    cost_basis: float | None,
    current_value: float | None,
    unrealized_pct: float | None,
) -> str:
    """Generate a 2-3 sentence AI summary of earnings impact in Spanish."""
    import asyncio
    from app.core.config import settings
    import anthropic as _anthropic

    if not settings.anthropic_api_key:
        return ""

    beat_str  = f"superó (+{beat_pct:.1f}%)" if beat and beat_pct else "no alcanzó"
    rev_str   = (f" Los ingresos fueron ${rev_actual_b:.2f}B vs ${rev_estimate_b:.2f}B est." if rev_actual_b and rev_estimate_b else "")
    pos_str   = (f" El inversor tiene {shares:.4f} acciones con un valor actual de ${current_value:,.2f} ({unrealized_pct:+.1f}% vs costo promedio)." if shares and current_value and unrealized_pct is not None else "")

    prompt = (
        f"{ticker} {beat_str} el consenso de EPS: reportó ${eps_actual:.2f} vs ${eps_estimate:.2f} estimado.{rev_str}{pos_str}\n\n"
        "Escribe en español un análisis breve (2-3 oraciones) explicando qué significa esto para el inversor: "
        "¿es un resultado positivo o negativo, qué lo impulsó probablemente, y qué podría implicar para la acción? "
        "Sé específico, conciso y usa lenguaje financiero claro. No uses markdown."
    )

    try:
        client = _anthropic.Anthropic(api_key=settings.anthropic_api_key)
        msg = await asyncio.to_thread(
            client.messages.create,
            model="claude-haiku-4-5-20251001",
            max_tokens=220,
            messages=[{"role": "user", "content": prompt}],
        )
        return msg.content[0].text.strip()
    except Exception:
        return ""


def _build_earnings_email(
    first: str,
    ticker: str,
    push_title: str,
    eps_actual: float,
    eps_estimate: float,
    beat: bool,
    beat_pct: float | None,
    rev_actual_b: float | None,
    rev_estimate_b: float | None,
    hour: str,
    # position data (all optional)
    shares: float | None,
    avg_px: float | None,
    current_px: float | None,
    cost_basis: float | None,
    current_value: float | None,
    unrealized_pnl: float | None,
    unrealized_pct: float | None,
    ai_summary: str,
) -> str:
    accent = "#22c55e" if beat else "#ef4444"
    timing = "Pre-market" if hour == "BMO" else "After-hours"

    # Position block HTML
    pos_html = ""
    if shares and avg_px:
        gain_color = "#22c55e" if (unrealized_pct or 0) >= 0 else "#ef4444"
        gain_sign  = "+" if (unrealized_pct or 0) >= 0 else ""
        pos_html = f"""
        <div style="background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:18px;margin:20px 0">
          <p style="margin:0 0 12px;color:#999;font-size:12px;text-transform:uppercase;letter-spacing:.08em">Tu posición en {ticker}</p>
          <div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:8px">
            <div>
              <p style="margin:0;font-size:28px;font-weight:800;color:#fff">{shares:.4f} <span style="font-size:14px;font-weight:400;color:#666">acciones</span></p>
              {'<p style="margin:4px 0 0;font-size:13px;color:#666">Precio actual: $' + f'{current_px:,.2f}' + '</p>' if current_px else ''}
            </div>
            <div style="text-align:right">
              <p style="margin:0;font-size:22px;font-weight:700;color:#fff">${current_value:,.2f}</p>
              <p style="margin:4px 0 0;font-size:13px;color:{gain_color}">{gain_sign}{unrealized_pnl:,.2f} ({gain_sign}{unrealized_pct:.1f}%)</p>
            </div>
          </div>
          <div style="display:flex;gap:24px;margin-top:14px;padding-top:14px;border-top:1px solid #2a2a2a">
            <div><p style="margin:0;color:#666;font-size:11px">PRECIO PROMEDIO</p><p style="margin:4px 0 0;font-size:14px;font-weight:600">${avg_px:,.2f}</p></div>
            <div><p style="margin:0;color:#666;font-size:11px">COSTO TOTAL</p><p style="margin:4px 0 0;font-size:14px;font-weight:600">${cost_basis:,.2f}</p></div>
          </div>
        </div>"""

    # AI insight block
    ai_html = ""
    if ai_summary:
        ai_html = f"""
        <div style="background:#0d1f17;border:1px solid #1a3a28;border-radius:10px;padding:16px;margin:16px 0">
          <p style="margin:0 0 8px;color:#4ade80;font-size:11px;text-transform:uppercase;letter-spacing:.08em">✦ Análisis Nuvos AI</p>
          <p style="margin:0;color:#d1fae5;font-size:14px;line-height:1.6">{ai_summary}</p>
        </div>"""

    rev_row = ""
    if rev_actual_b and rev_estimate_b:
        rev_beat     = rev_actual_b >= rev_estimate_b
        rev_color    = "#22c55e" if rev_beat else "#ef4444"
        rev_diff_pct = round((rev_actual_b - rev_estimate_b) / rev_estimate_b * 100, 1)
        rev_sign     = "+" if rev_diff_pct >= 0 else ""
        rev_row = f"""
        <tr style="border-bottom:1px solid #222">
          <td style="padding:10px 0;color:#888;font-size:13px">Ingresos</td>
          <td style="padding:10px 0;text-align:right;font-size:13px">${rev_actual_b:.2f}B <span style="color:#555">vs ${rev_estimate_b:.2f}B est.</span></td>
          <td style="padding:10px 0;text-align:right;color:{rev_color};font-size:13px;padding-left:12px">{rev_sign}{rev_diff_pct:.1f}%</td>
        </tr>"""

    beat_pct_str = f"+{beat_pct:.1f}%" if beat and beat_pct else (f"{beat_pct:.1f}%" if beat_pct else "")

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:580px;margin:0 auto;padding:24px 16px">

  <!-- Header -->
  <div style="text-align:center;padding:28px 24px;background:linear-gradient(135deg,#0f1f0f,#111);border:1px solid #1e3a1e;border-radius:14px;margin-bottom:20px">
    <p style="margin:0 0 6px;font-size:12px;color:#4ade80;letter-spacing:.12em;text-transform:uppercase">{timing} · Earnings Alert</p>
    <h1 style="margin:0;font-size:32px;font-weight:900;color:#fff">{ticker}</h1>
    <div style="display:inline-block;margin-top:10px;padding:6px 18px;background:{accent}22;border:1px solid {accent}44;border-radius:20px">
      <span style="color:{accent};font-size:18px;font-weight:800">{'✅ Beat' if beat else '❌ Miss'}{f'  {beat_pct_str}' if beat_pct_str else ''}</span>
    </div>
  </div>

  <!-- EPS Table -->
  <div style="background:#111;border:1px solid #222;border-radius:10px;padding:16px 20px;margin-bottom:16px">
    <p style="margin:0 0 12px;color:#666;font-size:11px;text-transform:uppercase;letter-spacing:.08em">Resultados del trimestre</p>
    <table style="width:100%;border-collapse:collapse">
      <tr style="border-bottom:1px solid #222">
        <td style="padding:10px 0;color:#888;font-size:13px">EPS Reportado</td>
        <td style="padding:10px 0;text-align:right;font-size:13px"></td>
        <td style="padding:10px 0;text-align:right;font-size:20px;font-weight:800;color:{accent}">${eps_actual:.2f}</td>
      </tr>
      <tr style="border-bottom:1px solid #222">
        <td style="padding:10px 0;color:#888;font-size:13px">Consenso analistas</td>
        <td style="padding:10px 0;text-align:right;font-size:13px"></td>
        <td style="padding:10px 0;text-align:right;font-size:15px;color:#aaa">${eps_estimate:.2f}</td>
      </tr>
      {rev_row}
    </table>
  </div>

  <!-- Position block -->
  {pos_html}

  <!-- AI insight -->
  {ai_html}

  <!-- Footer -->
  <p style="text-align:center;color:#333;font-size:11px;margin-top:28px">
    Nuvos AI · {timing} Earnings · {ticker}<br>
    <span style="color:#222">Hola {first}, este análisis es solo informativo.</span>
  </p>
</div>
</body>
</html>"""


@router.post("/admin/trigger-earnings-test")
async def trigger_earnings_test(
    body: EarningsTestPayload,
    user_id: str = Depends(get_current_user_id),
):
    """Send a test earnings push + email to the admin user with real data."""
    if user_id != _ADMIN_UID:
        raise HTTPException(status_code=403, detail="Admin only")

    import asyncio, time
    from app.services.notification_engine import send_push, send_email_notification

    db     = get_supabase()
    ticker = body.ticker.upper()
    beat   = body.eps_actual >= body.eps_estimate
    beat_pct = round((body.eps_actual - body.eps_estimate) / abs(body.eps_estimate) * 100, 1) if body.eps_estimate else None

    result_emoji = "✅" if beat else "❌"
    result_word  = "Beat" if beat else "Miss"
    timing_tag   = " · Pre-market" if body.hour == "BMO" else " · After-hours"
    push_title   = f"{ticker} {result_emoji} {result_word}{timing_tag}"

    # ── Portfolio position ────────────────────────────────────────────────────
    port_res  = await run_query(db.table("user_portfolio").select("positions").eq("user_id", user_id))
    positions: list = []
    if port_res.data:
        raw = port_res.data[0].get("positions") or {}
        positions = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])

    pos_match = next((p for p in positions if p.get("ticker") == ticker), None)

    shares       = _get_pos_field(pos_match, "shares")       if pos_match else None
    avg_px       = _get_pos_field(pos_match, "avgPrice", "avg_price") if pos_match else None
    cost_basis   = round(shares * avg_px, 2)                 if shares and avg_px else None

    # Current price from Finnhub
    current_px    = await asyncio.to_thread(_finnhub_current_price, ticker)
    current_value = round(shares * current_px, 2) if shares and current_px else None
    unrealized_pnl = round(current_value - cost_basis, 2)    if current_value and cost_basis else None
    unrealized_pct = round(unrealized_pnl / cost_basis * 100, 1) if unrealized_pnl and cost_basis else None

    # ── Push body (short, with position if available) ─────────────────────────
    push_body = f"EPS ${body.eps_actual:.2f} vs ${body.eps_estimate:.2f} est."
    if shares and current_value:
        push_body += f" · {shares:.4f} acc. · ${current_value:,.2f} actual"
    elif shares and avg_px and cost_basis:
        push_body += f" · {shares:.4f} acc. · ${cost_basis:,.2f} invertido"

    # ── AI summary ────────────────────────────────────────────────────────────
    ai_summary = await _earnings_ai_summary(
        ticker=ticker,
        eps_actual=body.eps_actual, eps_estimate=body.eps_estimate,
        beat=beat, beat_pct=beat_pct,
        rev_actual_b=body.rev_actual_b, rev_estimate_b=body.rev_estimate_b,
        shares=shares, cost_basis=cost_basis,
        current_value=current_value, unrealized_pct=unrealized_pct,
    )

    # ── Profile name ──────────────────────────────────────────────────────────
    profile_res = await run_query(db.table("user_profiles").select("name").eq("user_id", user_id).single())
    first = ((profile_res.data or {}).get("name") or "Inversor").split()[0]

    # ── Send push ─────────────────────────────────────────────────────────────
    category = f"earnings_test_{ticker.lower()}_{int(time.time())}"
    await send_push(user_id, category, push_title, push_body, {"ticker": ticker, "screen": "stock_detail"}, db)

    # ── Send email ────────────────────────────────────────────────────────────
    html = _build_earnings_email(
        first=first, ticker=ticker, push_title=push_title,
        eps_actual=body.eps_actual, eps_estimate=body.eps_estimate,
        beat=beat, beat_pct=beat_pct,
        rev_actual_b=body.rev_actual_b, rev_estimate_b=body.rev_estimate_b,
        hour=body.hour,
        shares=shares, avg_px=avg_px, current_px=current_px,
        cost_basis=cost_basis, current_value=current_value,
        unrealized_pnl=unrealized_pnl, unrealized_pct=unrealized_pct,
        ai_summary=ai_summary,
    )
    subject = f"{ticker} {result_emoji} {result_word} · EPS ${body.eps_actual:.2f} vs ${body.eps_estimate:.2f} est. — Nuvos AI"
    await send_email_notification(user_id, category, subject, html, db)

    return {
        "ok": True,
        "push_title": push_title,
        "push_body": push_body,
        "email_subject": subject,
        "beat": beat,
        "beat_pct": beat_pct,
        "shares": shares,
        "avg_px": avg_px,
        "current_px": current_px,
        "cost_basis": cost_basis,
        "current_value": current_value,
        "unrealized_pct": unrealized_pct,
        "ai_summary": ai_summary,
    }


# ── Admin: test dividend notification ────────────────────────────────────────

class DividendTestPayload(BaseModel):
    ticker: str
    event_type: str = "ex_dividend"   # "ex_dividend" | "dividend"
    event_date: str = ""              # "mañana", "hoy", ISO date — displayed in push body


def _finnhub_dividend_amount_sync(ticker: str) -> tuple[float | None, str | None]:
    """Fetch the most recent per-share dividend amount + ex-date from Finnhub.
    Tries three endpoints in order (free plan coverage increases with fallbacks):
      1. /stock/dividend2  — exact per-payment amounts (premium, may be empty)
      2. /stock/dividend   — basic dividend history (free, broader coverage)
      3. /stock/metric     — indicated annual dividend / 4 (free, always available)
    Returns (amount_per_share, ex_date_str) or (None, None)."""
    import os, requests as req_lib
    from datetime import date, timedelta
    key = os.getenv("FINNHUB_API_KEY", "")
    if not key:
        return None, None

    today     = date.today()
    from_date = (today - timedelta(days=365)).strftime("%Y-%m-%d")
    to_date   = (today + timedelta(days=180)).strftime("%Y-%m-%d")

    # ── 1. /stock/dividend2 (premium, exact per-payment) ─────────────────────
    try:
        r = req_lib.get(
            "https://finnhub.io/api/v1/stock/dividend2",
            params={"symbol": ticker, "from": from_date, "to": to_date, "token": key},
            timeout=8,
        )
        divs = (r.json().get("data") or [])
        if divs:
            divs.sort(key=lambda d: d.get("exDate", ""), reverse=True)
            amt = divs[0].get("amount")
            ex  = divs[0].get("exDate")
            if amt is not None:
                return float(amt), ex
    except Exception:
        pass

    # ── 2. /stock/dividend (free, historical payments) ────────────────────────
    try:
        r = req_lib.get(
            "https://finnhub.io/api/v1/stock/dividend",
            params={"symbol": ticker, "from": from_date, "to": to_date, "token": key},
            timeout=8,
        )
        divs = r.json() if isinstance(r.json(), list) else []
        if divs:
            divs.sort(key=lambda d: d.get("date", ""), reverse=True)
            amt = divs[0].get("amount")
            ex  = divs[0].get("date")
            if amt is not None:
                return float(amt), ex
    except Exception:
        pass

    # ── 3. /stock/metric → indicatedAnnualDividend / 4 (free, always present) ─
    try:
        r = req_lib.get(
            "https://finnhub.io/api/v1/stock/metric",
            params={"symbol": ticker, "metric": "all", "token": key},
            timeout=8,
        )
        metrics = (r.json().get("metric") or {})
        # dividendPerShareAnnual or dividendPerShareTTM divided by 4 (quarterly assumed)
        annual = metrics.get("dividendPerShareAnnual") or metrics.get("dividendPerShareTTM")
        if annual and float(annual) > 0:
            return round(float(annual) / 4, 4), None
    except Exception:
        pass

    return None, None


@router.post("/admin/trigger-dividend-test")
async def trigger_dividend_test(
    body: DividendTestPayload,
    user_id: str = Depends(get_current_user_id),
):
    """Admin-only: send a test dividend push to the admin with real per-share payout
    fetched from Finnhub /stock/dividend2, personalized by portfolio shares."""
    if user_id != _ADMIN_UID:
        raise HTTPException(status_code=403, detail="Admin only")

    import asyncio, time
    from app.services.notification_engine import send_push

    db     = get_supabase()
    ticker = body.ticker.upper()

    # ── Portfolio shares ──────────────────────────────────────────────────────
    port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", user_id))
    positions: list = []
    if port_res.data:
        raw = port_res.data[0].get("positions") or {}
        positions = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])

    pos_match   = next((p for p in positions if p.get("ticker") == ticker), None)
    shares_held = float(pos_match.get("shares") or 0) if pos_match else 0.0

    # ── Finnhub dividend data ─────────────────────────────────────────────────
    amt, ex_date = await asyncio.to_thread(_finnhub_dividend_amount_sync, ticker)

    # Resolve display date: use body.event_date if set, else Finnhub exDate, else "próximamente"
    when = body.event_date or ex_date or "próximamente"

    # ── Build notification ────────────────────────────────────────────────────
    if body.event_type == "ex_dividend":
        title = f"✂️ Ex-Dividendo: {ticker}"
        if amt and shares_held:
            pago  = shares_held * amt
            notif_body = (
                f"Fecha ex-dividendo de {ticker} es {when}. "
                f"Tienes {shares_held:.4f} acciones — "
                f"tu pago estimado: ${pago:.2f} USD (${amt:.4f}/acción)."
            )
        elif amt:
            notif_body = f"Fecha ex-dividendo de {ticker} es {when}. ${amt:.4f}/acción."
        else:
            notif_body = f"Fecha ex-dividendo de {ticker} es {when}."
    else:
        title = f"💰 Pago de Dividendo: {ticker}"
        if amt and shares_held:
            pago  = shares_held * amt
            notif_body = (
                f"{ticker} paga dividendo {when}. "
                f"Con tus {shares_held:.4f} acciones recibirás "
                f"${pago:.2f} USD (${amt:.4f}/acción)."
            )
        elif amt:
            notif_body = f"{ticker} paga dividendo {when}. ${amt:.4f}/acción."
        else:
            notif_body = f"{ticker} paga dividendo {when}."

    category = f"dividend_test_{ticker.lower()}_{int(time.time())}"
    await send_push(user_id, category, title, notif_body, {"ticker": ticker, "screen": "portfolio"}, db)

    return {
        "ok": True,
        "ticker": ticker,
        "shares_held": shares_held,
        "dividend_per_share": amt,
        "ex_date_finnhub": ex_date,
        "push_title": title,
        "push_body": notif_body,
        "pago_total": round(shares_held * amt, 4) if amt and shares_held else None,
    }
