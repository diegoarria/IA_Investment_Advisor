from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from app.api.deps import get_current_user_id
from app.services import notification_service
from app.core.cache import cache_get, cache_set, cache_delete
from app.core.database import get_supabase, run_query

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _agg_positions(rows: list[dict]) -> list[dict]:
    # Duplicated (not imported) from worker.py — see weekly_rituals_service.py
    # for the same convention. A user can have up to 3 portfolios (migration
    # 018), so .eq("user_id", uid) can return multiple rows; flatten all of
    # them instead of only reading the first.
    result: list[dict] = []
    for row in rows:
        raw = row.get("positions") or {}
        pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
        result.extend(pos)
    return result


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
        positions = _agg_positions(port_res.data or [])

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


@router.post("/trigger/weekly-summary")
async def trigger_weekly_summary(user_id: str = Depends(get_current_user_id)):
    """Manually send the requesting user their own real Friday weekly-summary
    email right now, synchronously (unlike /trigger/market-close's
    background task — here the whole point is to inspect the response
    immediately, not just fire-and-forget). Reuses worker.py's real
    build_weekly_email_for_user (Diego, 2026-08-21: "siento que los correos
    del resumen semanal no llegan con los datos correctos... con datos
    reales") — same function job_daily_email calls for every real user
    every Friday, so this can never quietly diverge into a nicer-looking
    fake. Returns the computed numbers inline too, so a bad send can be
    diagnosed without needing prod log access."""
    import asyncio
    import worker as _worker
    from app.services.notification_engine import send_email_notification
    from app.core.config import settings

    if not settings.resend_api_key:
        raise HTTPException(status_code=503, detail="RESEND_API_KEY no configurado")

    db = get_supabase()

    prof_res = await run_query(
        db.table("user_profiles").select("name,subscription_tier,preferred_language").eq("user_id", user_id).maybe_single()
    )
    prof = prof_res.data or {}
    first = (prof.get("name") or "Inversor").split()[0]
    is_premium = (prof.get("subscription_tier") or "free") == "premium"
    lang = prof.get("preferred_language") or "es"

    port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", user_id))
    positions = _worker._agg_positions(port_res.data or []) if port_res.data else []

    watch_res = await run_query(db.table("watchlist").select("ticker").eq("user_id", user_id))
    watchlist = {r["ticker"] for r in (watch_res.data or [])}

    # Same weekly (Mon-Fri close-to-close) window job_daily_email uses —
    # not a single-day change, since the whole email is framed as "esta
    # semana."
    spy_w, qqq_w = await asyncio.gather(
        asyncio.to_thread(_worker._finnhub_weekly_pct, "SPY"),
        asyncio.to_thread(_worker._finnhub_weekly_pct, "QQQ"),
    )
    sp_pct = spy_w["pct"] if spy_w else None
    nq_pct = qqq_w["pct"] if qqq_w else None
    sp_px  = spy_w["curr"] if spy_w else None
    nq_px  = qqq_w["curr"] if qqq_w else None

    tickers = {p["ticker"] for p in positions if p.get("ticker")}
    price_results = await asyncio.gather(
        *[asyncio.to_thread(_worker._finnhub_weekly_pct, t) for t in tickers]
    ) if tickers else []
    week_prices = {t: {"curr": q["curr"], "prev": q["start"]} for t, q in zip(tickers, price_results) if q}

    from app.core.finnhub import fh_profile
    from urllib.parse import urlparse
    meta_results = await asyncio.gather(
        *[asyncio.to_thread(fh_profile, t) for t in tickers]
    ) if tickers else []
    ticker_meta: dict[str, dict] = {}
    for t, profile in zip(tickers, meta_results):
        if not profile:
            continue
        logo = profile.get("logo")
        if not logo:
            weburl = profile.get("weburl", "")
            if weburl:
                netloc = urlparse(weburl).netloc.replace("www.", "")
                logo = f"https://logo.clearbit.com/{netloc}" if netloc else None
        ticker_meta[t] = {"company_name": profile.get("name") or t, "logo_url": logo}

    movers = []
    for t, px in week_prices.items():
        if px.get("prev") and px["prev"] > 0:
            movers.append({"ticker": t, "pct": round((px["curr"] - px["prev"]) / px["prev"] * 100, 2)})
    movers.sort(key=lambda x: abs(x["pct"]), reverse=True)

    market_wrap = await _worker._generate_market_wrap(sp_pct, nq_pct, movers, period="semana", language=lang)

    all_today_earnings = await asyncio.to_thread(_worker._finnhub_earnings_today, None)
    relevant = (tickers | watchlist) & set(all_today_earnings.keys())
    earnings_ai: dict[str, str] = {}
    if relevant:
        analyses = await asyncio.gather(*[
            _worker._generate_earnings_ai_for_email(
                ticker=t,
                eps_actual=all_today_earnings[t].get("eps_actual"),
                eps_estimate=all_today_earnings[t].get("eps_estimate"),
                beat=all_today_earnings[t].get("beat_eps", False),
                rev_actual_b=all_today_earnings[t].get("rev_actual_b"),
                rev_estimate_b=all_today_earnings[t].get("rev_estimate_b"),
                language=lang,
            )
            for t in sorted(relevant)
        ], return_exceptions=True)
        earnings_ai = {t: (a if isinstance(a, str) else "") for t, a in zip(sorted(relevant), analyses)}

    _now = datetime.now()
    week_label_by_lang = {
        "es": f"semana del {_now.day} de {_worker._SPANISH_MONTHS[_now.month - 1]}",
        "en": f"week of {_worker._ENGLISH_MONTHS[_now.month - 1]} {_now.day}",
    }
    sp_str = f"{sp_pct:+.1f}%" if sp_pct is not None else "—"
    nq_str = f"{nq_pct:+.1f}%" if nq_pct is not None else "—"

    subject, html = _worker.build_weekly_email_for_user(
        first=first, is_premium=is_premium, positions=positions, watchlist=watchlist, lang=lang,
        week_prices=week_prices, ticker_meta=ticker_meta, sp_pct=sp_pct, sp_px=sp_px, nq_pct=nq_pct, nq_px=nq_px,
        market_wrap_by_lang={lang: market_wrap}, all_today_earnings=all_today_earnings,
        earnings_ai_map_by_lang={lang: earnings_ai}, week_label_by_lang=week_label_by_lang,
        sp_str=sp_str, nq_str=nq_str,
    )
    ok = await send_email_notification(user_id, "weekly_summary", subject, html, db)

    return {
        "sent": ok,
        "subject": subject,
        "is_premium": is_premium,
        "language": lang,
        "sp500_weekly_pct": sp_pct,
        "nasdaq_weekly_pct": nq_pct,
        "portfolio_tickers_priced": len(week_prices),
        "portfolio_tickers_total": len(tickers),
        "earnings_today_relevant": sorted(relevant),
    }


@router.get("/morning-brief")
async def get_morning_brief(user_id: str = Depends(get_current_user_id)):
    """Data for the "Morning Brief" card shown on Home when the user opens
    the app — NOT a push notification, NOT a full screen. Cached per user
    per ET calendar day so opening the app twice in a day doesn't recompute.
    Reuses saved_valuation_service.list_with_live_data (fair-value
    proximity) and the same live-quote/goal math used elsewhere in the app —
    no new external data source. Returns `{}` (empty) when there's nothing
    genuinely worth telling the user, so the frontend renders no card
    rather than a hollow one."""
    import asyncio
    import zoneinfo
    from app.core.finnhub import fh_quote
    from app.services.saved_valuation_service import list_with_live_data

    today_et = datetime.now(zoneinfo.ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    cache_key = f"morning_brief:{user_id}:{today_et}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    db = get_supabase()
    profile_res = await run_query(db.table("user_profiles").select("*").eq("user_id", user_id))
    profile = profile_res.data[0] if profile_res.data else {}
    is_en = (profile.get("preferred_language") or "es") == "en"
    first = (profile.get("name") or ("Investor" if is_en else "Inversor")).split()[0]

    port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", user_id))
    positions = _agg_positions(port_res.data or [])

    bullets: list[str] = []
    total_curr = 0.0

    if positions:
        tickers = list({p["ticker"] for p in positions if p.get("ticker")})
        quotes = dict(zip(tickers, await asyncio.gather(*[asyncio.to_thread(fh_quote, t) for t in tickers])))

        total_prev = 0.0
        for p in positions:
            t, shares = p.get("ticker"), float(p.get("shares") or 0)
            q = quotes.get(t)
            if not t or not shares or not q or not q.get("price"):
                continue
            price = q["price"]
            prev = q.get("prev_close") or price
            total_curr += price * shares
            total_prev += prev * shares

        if total_prev > 0:
            pct = round((total_curr - total_prev) / total_prev * 100, 2)
            verb = ("rose" if pct >= 0 else "fell") if is_en else ("subió" if pct >= 0 else "bajó")
            bullets.append(
                f"Your portfolio {verb} {pct:+.2f}%" if is_en else f"Tu portafolio {verb} {pct:+.2f}%"
            )

        # Earnings reported by a holding since yesterday — cheap per-ticker
        # Finnhub calendar check, capped so this never balloons into a wall
        # of bullets (value over volume, same philosophy as everything else
        # in this notification system).
        try:
            import os, httpx
            key = os.getenv("FINNHUB_API_KEY", "")
            if key:
                from_d = (datetime.now(zoneinfo.ZoneInfo("America/New_York")) - timedelta(days=2)).strftime("%Y-%m-%d")
                async def _check_earnings(ticker: str) -> str | None:
                    try:
                        r = await asyncio.to_thread(
                            httpx.get, "https://finnhub.io/api/v1/calendar/earnings",
                            params={"symbol": ticker, "from": from_d, "to": today_et, "token": key}, timeout=8,
                        )
                        items = (r.json() or {}).get("earningsCalendar") or []
                        return ticker if any(i.get("epsActual") is not None for i in items) else None
                    except Exception:
                        return None
                reported = [t for t in await asyncio.gather(*[_check_earnings(t) for t in tickers[:15]]) if t]
                for t in reported[:1]:
                    bullets.append(f"{t} reported earnings." if is_en else f"{t} publicó resultados.")
        except Exception:
            pass

    # Saved valuations approaching (but not yet deep into) their fair-value
    # range — reuses the exact live margin-of-safety math the Valor
    # Intrínseco screen and its milestone alerts already use.
    try:
        saved = await list_with_live_data(user_id)
        approaching = [
            s for s in saved
            if s.get("margin_of_safety_pct") is not None and 0 <= s["margin_of_safety_pct"] <= 15
        ]
        for s in approaching[:1]:
            bullets.append(
                f"{s['ticker']} is getting close to your target price." if is_en else
                f"{s['ticker']} se acerca a tu precio objetivo."
            )
    except Exception:
        pass

    # Progress toward the user's annual/long-term goal
    goal_amount = profile.get("investment_goal_amount")
    try:
        goal_amount = float(goal_amount) if goal_amount else 0.0
    except (TypeError, ValueError):
        goal_amount = 0.0
    if goal_amount > 0 and total_curr > 0:
        goal_pct = round(total_curr / goal_amount * 100)
        bullets.append(
            f"You're at {goal_pct}% of your goal." if is_en else
            f"Tu patrimonio está al {goal_pct}% de tu meta."
        )

    if not bullets:
        result = {}
    else:
        title = f"🌅 Good morning, {first}" if is_en else f"🌅 Buenos días, {first}"
        result = {"title": title, "bullets": bullets[:4], "generated_at": int(datetime.now(timezone.utc).timestamp())}

    cache_set(cache_key, result, ttl=86400)
    return result


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
    await notification_service.mark_notification_read(notification_id, user_id)
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
