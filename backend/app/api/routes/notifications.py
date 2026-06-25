from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from app.api.deps import get_current_user_id
from app.services import notification_service
from app.core.cache import cache_get, cache_set, cache_delete
from app.core.database import get_supabase, run_query

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.post("/test")
async def send_test_notification(user_id: str = Depends(get_current_user_id)):
    """Send a test push + email to verify the notification pipeline is working."""
    from app.services.notification_engine import send_push
    from app.services.email_service import send_email
    from app.core.config import settings
    import asyncio

    db = get_supabase()
    results: dict = {}

    # Test push
    try:
        await send_push(
            user_id, "test",
            "Nuvos AI — Test de notificación",
            "Si ves esto, las notificaciones push funcionan correctamente.",
            {"screen": "home", "test": True},
            db,
        )
        results["push"] = "sent"
    except Exception as e:
        results["push"] = f"error: {e}"

    # Test email
    if settings.resend_api_key:
        try:
            users = await asyncio.to_thread(lambda: db.auth.admin.list_users())
            email = next((u.email for u in users if u.id == user_id), None)
            if email:
                ok = await send_email(
                    email,
                    "Nuvos AI — Test de email",
                    "<h2>Si recibes este email, el sistema de emails funciona correctamente.</h2>",
                )
                results["email"] = "sent" if ok else "send_email_returned_false"
            else:
                results["email"] = "user_email_not_found"
        except Exception as e:
            results["email"] = f"error: {e}"
    else:
        results["email"] = "RESEND_API_KEY_not_set"

    # Check push token
    try:
        tok_res = await run_query(db.table("user_profiles").select("push_token").eq("user_id", user_id))
        token = (tok_res.data[0].get("push_token") or "") if tok_res.data else ""
        results["push_token"] = token[:30] + "..." if len(token) > 30 else (token or "NOT_SET")
    except Exception:
        results["push_token"] = "error_reading"

    return results


@router.post("/trigger/market-close")
async def trigger_market_close(
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    """Manually send today's market-close push + email to the requesting user."""
    import asyncio, os, requests as _req

    def _fh_quote(symbol: str):
        key = os.getenv("FINNHUB_API_KEY", "")
        if not key:
            return None
        try:
            r = _req.get("https://finnhub.io/api/v1/quote",
                         params={"symbol": symbol, "token": key}, timeout=8)
            d = r.json()
            curr, prev = d.get("c"), d.get("pc")
            if curr and prev and prev > 0:
                return {"curr": float(curr), "prev": float(prev),
                        "pct": round((float(curr) - float(prev)) / float(prev) * 100, 2)}
        except Exception:
            pass
        return None

    async def _run():
        from app.services.notification_engine import send_push, send_email_notification
        from app.services.email_templates import daily_email_v2

        db = get_supabase()

        spy_q = await asyncio.to_thread(_fh_quote, "SPY")
        qqq_q = await asyncio.to_thread(_fh_quote, "QQQ")
        sp500_pct  = spy_q["pct"]  if spy_q else None
        nasdaq_pct = qqq_q["pct"]  if qqq_q else None
        sp_px      = spy_q["curr"] if spy_q else None
        nq_px      = qqq_q["curr"] if qqq_q else None

        # Load portfolio
        port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", user_id))
        positions = []
        if port_res.data:
            raw = port_res.data[0].get("positions") or {}
            positions = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])

        # Profile
        prof_res = await run_query(db.table("user_profiles").select("name").eq("user_id", user_id))
        first = ((prof_res.data[0].get("name") or "Inversor").split()[0]) if prof_res.data else "Inversor"

        # Prices
        tickers = list({p["ticker"] for p in positions if p.get("ticker")})
        prices = {}
        for t in tickers:
            q = await asyncio.to_thread(_fh_quote, t)
            if q:
                prices[t] = {"curr": q["curr"], "prev": q["prev"]}

        # Compute portfolio change
        total_val = total_prev = 0.0
        movers = []
        for p in positions:
            t, s = p.get("ticker"), float(p.get("shares") or 0)
            if not t or not s or t not in prices:
                continue
            px = prices[t]
            cv, pv = px["curr"] * s, px["prev"] * s
            total_val += cv; total_prev += pv
            if px["prev"] > 0:
                pct = round((px["curr"] - px["prev"]) / px["prev"] * 100, 2)
                movers.append({"ticker": t, "pct": pct, "price": px["curr"],
                               "dollar_change": round(cv - pv, 2)})

        user_pct = round((total_val - total_prev) / total_prev * 100, 2) if total_prev > 0 else None
        port_usd = round(total_val, 2) if total_prev > 0 else None
        top_gainers = sorted([m for m in movers if m["pct"] >= 0], key=lambda x: x["pct"], reverse=True)[:3]
        top_losers  = sorted([m for m in movers if m["pct"] < 0],  key=lambda x: x["pct"])[:3]

        sp_line = f"S&P 500: {sp500_pct:+.2f}%" if sp500_pct is not None else "S&P 500: N/D"
        nq_line = f"Nasdaq: {nasdaq_pct:+.2f}%"  if nasdaq_pct is not None else "Nasdaq: N/D"
        indices  = f"{sp_line} · {nq_line}"

        if user_pct is not None:
            beating    = sp500_pct is not None and user_pct > sp500_pct
            push_title = "🏆 Superaste al mercado hoy" if beating else "📊 El mercado ha cerrado"
            push_body  = (f"Tu portafolio: {user_pct:+.2f}% · {indices}\n\n"
                          + ("¡Enhorabuena! Hoy superaste al mercado." if beating
                             else "El mercado tuvo mejor desempeño hoy. Mañana es otra oportunidad."))
            sign    = "+" if user_pct >= 0 else ""
            subject = f"Tu portafolio hoy: {sign}{user_pct:.2f}% — Nuvos AI"
        else:
            push_title = "📊 El mercado ha cerrado"
            push_body  = indices
            subject    = "El mercado ha cerrado — Nuvos AI"

        await send_push(user_id, "market_close", push_title, push_body, {"screen": "portfolio"}, db)

        html = daily_email_v2(
            first_name=first, port_pct=user_pct, port_usd=port_usd,
            sp_pct=sp500_pct, sp_px=sp_px, nq_pct=nasdaq_pct, nq_px=nq_px,
            top_gainers=top_gainers, top_losers=top_losers, ai_summary=None,
        )
        await send_email_notification(user_id, "market_close", subject, html, db)

    background_tasks.add_task(_run)
    return {"triggered": "market_close"}


@router.get("")
async def get_notifications(
    limit: int = 20,
    user_id: str = Depends(get_current_user_id)
):
    cache_key = f"notif:{user_id}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    notifications = await notification_service.get_user_notifications(user_id, limit=limit)
    unread_count = sum(1 for n in notifications if not n.get("read"))
    result = {"notifications": notifications, "unread_count": unread_count}
    cache_set(cache_key, result, ttl=30)
    return result


@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    user_id: str = Depends(get_current_user_id)
):
    await notification_service.mark_notification_read(notification_id)
    cache_delete(f"notif:{user_id}")
    return {"marked_read": True}


@router.post("/mark-all-read")
async def mark_all_read(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    await run_query(
        db.table("notifications").update({"read": True}).eq("user_id", user_id).eq("read", False)
    )
    cache_delete(f"notif:{user_id}")
    return {"marked_all_read": True}
