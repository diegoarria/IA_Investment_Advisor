"""
Background worker — runs scheduled jobs in a SEPARATE process from the web server.

Why separate:
- If the web process scales to N instances, each would run the jobs N times.
- This process is always a single instance, so jobs run exactly once.

Railway setup:
  Add a second service pointing to the same repo with start command:
    python worker.py
"""

import asyncio
import logging
import random
import concurrent.futures
from datetime import datetime, timezone, timedelta
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from app.core.config import settings
from app.services.notification_service import scan_and_notify_all_users
from app.services.email_service import (
    generate_and_send_weekly_summary, generate_and_send_monthly_report,
    build_enhanced_weekly_html, build_earnings_results_html,
    build_birthday_html, build_reengagement_html, send_email,
)
from app.services.paper_service import notify_rank_changes

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


# ── Shared price cache (populated once per job run, reused per-user) ──────────
_price_cache: dict = {}
_price_cache_ts: datetime | None = None
_PRICE_CACHE_TTL = 300  # seconds


async def _batch_fetch_prices(tickers: list[str]) -> dict:
    """Fetch last-2-close prices for a list of tickers via yfinance (one batch call)."""
    if not tickers:
        return {}

    def _fetch():
        try:
            import yfinance as yf
            data = yf.download(list(set(tickers)), period="2d", progress=False, group_by="ticker")
            result = {}
            if len(tickers) == 1:
                # Single ticker: data is a plain DataFrame
                t = tickers[0]
                closes = data["Close"].dropna()
                if len(closes) >= 2:
                    result[t] = {"prev": float(closes.iloc[-2]), "curr": float(closes.iloc[-1])}
            else:
                for t in tickers:
                    try:
                        closes = data[t]["Close"].dropna()
                        if len(closes) >= 2:
                            result[t] = {"prev": float(closes.iloc[-2]), "curr": float(closes.iloc[-1])}
                    except Exception:
                        pass
            return result
        except Exception as e:
            logger.warning("_batch_fetch_prices failed: %s", e)
            return {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
        return await asyncio.get_event_loop().run_in_executor(ex, _fetch)


def _calc_portfolio_pct(positions: list, prices: dict) -> float | None:
    """Compute portfolio day-change % given positions and prices dict."""
    total_val = 0.0
    total_prev = 0.0
    for p in positions:
        ticker = p.get("ticker")
        shares = float(p.get("shares", 0))
        if not ticker or not shares or ticker not in prices:
            continue
        px = prices[ticker]
        total_val  += px["curr"] * shares
        total_prev += px["prev"] * shares
    if total_prev > 0:
        return ((total_val - total_prev) / total_prev) * 100
    return None


def _top_performer(positions: list, prices: dict) -> tuple[str | None, float | None]:
    """Return (ticker, pct) for best-performing position today."""
    best_ticker, best_pct = None, None
    for p in positions:
        ticker = p.get("ticker")
        shares = float(p.get("shares", 0))
        if not ticker or not shares or ticker not in prices:
            continue
        px = prices[ticker]
        pct = (px["curr"] - px["prev"]) / px["prev"] * 100 if px["prev"] else None
        if pct is not None and (best_pct is None or pct > best_pct):
            best_ticker, best_pct = ticker, pct
    return best_ticker, best_pct


async def send_weekly_emails():
    """Personalized weekly summary — every Friday after market close."""
    if not settings.resend_api_key:
        logger.info("RESEND_API_KEY not set — skipping weekly emails")
        return
    from app.core.database import get_supabase, run_query
    db = get_supabase()
    try:
        users_res = await run_query(
            db.table("user_profiles").select("user_id,name,risk_tolerance,subscription_tier")
        )
        users = users_res.data
        auth_users = {u.id: u.email for u in await asyncio.to_thread(lambda: db.auth.admin.list_users())}
        sent = 0
        for u in users:
            email = auth_users.get(u["user_id"])
            if not email:
                continue
            is_premium = u.get("subscription_tier") == "premium"
            snippets = []
            if is_premium:
                chats_res = await run_query(
                    db.table("chat_history")
                    .select("content")
                    .eq("user_id", u["user_id"])
                    .eq("role", "user")
                    .order("created_at", desc=True)
                    .limit(10)
                )
                snippets = [c["content"][:150] for c in (chats_res.data or [])]
            ok = await generate_and_send_weekly_summary(
                user_id=u["user_id"],
                email=email,
                name=u["name"].split()[0],
                risk=u["risk_tolerance"],
                chat_snippets=snippets,
            )
            if ok:
                sent += 1
            else:
                logger.error("Weekly email failed for %s (%s)", email, u["user_id"])
        logger.info("Weekly emails sent: %d / %d users", sent, len(users))
    except Exception as e:
        logger.error("Weekly email job failed: %s", e)


async def run_notifications():
    """Scan for significant market moves and push notifications — 9am & 4pm ET."""
    try:
        await scan_and_notify_all_users()
        logger.info("Notification scan completed")
    except Exception as e:
        logger.error("Notification scan failed: %s", e)


async def send_monthly_reports():
    """Generate and email monthly portfolio report to all premium users — 1st of each month."""
    if not settings.resend_api_key:
        logger.info("RESEND_API_KEY not set — skipping monthly reports")
        return
    from app.core.database import get_supabase, run_query
    db = get_supabase()
    try:
        users_res = await run_query(
            db.table("user_profiles").select("user_id,name,subscription_tier")
        )
        users = users_res.data
        auth_users = {u.id: u.email for u in await asyncio.to_thread(lambda: db.auth.admin.list_users())}
        sent = errors = skipped = 0
        for u in users:
            if u.get("subscription_tier") != "premium":
                skipped += 1
                continue
            email = auth_users.get(u["user_id"])
            if not email:
                skipped += 1
                continue
            try:
                ok = await generate_and_send_monthly_report(
                    user_id=u["user_id"],
                    email=email,
                    name=u.get("name") or "Inversor",
                )
                if ok:
                    sent += 1
                else:
                    skipped += 1  # no portfolio or empty
            except Exception as e:
                logger.error("Monthly report failed for %s: %s", u["user_id"], e)
                errors += 1
        logger.info("Monthly reports — sent: %d, skipped: %d, errors: %d", sent, skipped, errors)
    except Exception as e:
        logger.error("Monthly report job failed: %s", e)


async def run_league_notifications():
    """Compare league rankings and notify users who lost positions — every 2h."""
    try:
        await notify_rank_changes()
    except Exception as e:
        logger.error("League notification job failed: %s", e)


# ── Notification engine jobs ──────────────────────────────────────────────────

async def job_market_open():
    """9:30 AM ET weekdays — Free: generic open alert. Premium: portfolio vs S&P/NASDAQ."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push, get_market_summary_text
    db = get_supabase()
    try:
        market   = await get_market_summary_text()
        indices  = market.get("indices", {})
        sp500_d  = indices.get("S&P 500", {})
        nasdaq_d = indices.get("NASDAQ",  {})
        sp500_pct  = sp500_d.get("change_pct")
        nasdaq_pct = nasdaq_d.get("change_pct")

        prefs_res = await run_query(
            db.table("notification_preferences")
            .select("user_id")
            .eq("push_market_open", True)
        )
        users_data = prefs_res.data or []
        uids = [u["user_id"] for u in users_data]
        if not uids:
            return

        # Fetch subscription tiers
        tiers_res = await run_query(
            db.table("user_profiles").select("user_id,subscription_tier").in_("user_id", uids)
        )
        tier_map = {r["user_id"]: r.get("subscription_tier") for r in (tiers_res.data or [])}

        # Fetch all premium portfolio positions to batch-price later
        premium_uids = [uid for uid in uids if tier_map.get(uid) == "premium"]
        all_tickers: set[str] = set()
        portfolio_map: dict[str, list] = {}
        for uid in premium_uids:
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if port_res.data:
                raw = port_res.data[0].get("positions") or {}
                pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                portfolio_map[uid] = pos
                all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        prices = await _batch_fetch_prices(list(all_tickers)) if all_tickers else {}

        sent = 0
        for i, uid in enumerate(uids):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))

            is_premium = tier_map.get(uid) == "premium"
            if is_premium and uid in portfolio_map and prices:
                user_pct = _calc_portfolio_pct(portfolio_map[uid], prices)
                if user_pct is not None and sp500_pct is not None:
                    sp_str = f"{sp500_pct:+.1f}%"
                    nq_str = f"{nasdaq_pct:+.1f}%" if nasdaq_pct is not None else "—"
                    if user_pct > sp500_pct:
                        body = f"¡Mercado abierto! Tu portafolio {user_pct:+.1f}%, S&P 500 ({sp_str}) y NASDAQ ({nq_str}). ¡Los estás superando!"
                        title = "🚀 Mercado Abierto"
                    else:
                        body = f"¡Mercado abierto! Tu portafolio {user_pct:+.1f}%, frente al S&P 500 ({sp_str}). Entra a revisar tu estrategia."
                        title = "🚀 Mercado Abierto"
                else:
                    body = "¡El mercado ha abierto! Entra a ver cómo se está comportando el día de hoy."
                    title = "🚀 Mercado Abierto"
            else:
                body  = "¡El mercado ha abierto! Entra a ver cómo se está comportando el día de hoy."
                title = "🔔 Mercado Abierto"

            await send_push(uid, "market_open", title, body, {"screen": "portfolio"}, db)
            sent += 1
        logger.info("Market open push: %d sent", sent)
    except Exception as e:
        logger.error("job_market_open failed: %s", e)


async def job_market_open_reminder():
    """11:30 AM ET weekdays — reminder only to users who haven't opened the app."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    from datetime import timedelta
    import random
    db = get_supabase()
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id,last_opened_app").eq("push_market_open", True)
        )
        sent = 0
        for i, row in enumerate(prefs_res.data or []):
            last = row.get("last_opened_app") or ""
            if last >= cutoff:
                continue  # already opened today
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))
            await send_push(
                row["user_id"], "market_open_reminder",
                "Mercado activo", "Los mercados siguen abiertos. ¿Ya revisaste tu portafolio?",
                {"screen": "portfolio"}, db,
            )
            sent += 1
        logger.info("Market open reminder: %d sent", sent)
    except Exception as e:
        logger.error("job_market_open_reminder failed: %s", e)


async def job_market_close():
    """4:00 PM ET weekdays — Free: S&P/NASDAQ close. Premium: portfolio beat/lag + prompt."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push, get_market_summary_text
    db = get_supabase()
    try:
        market   = await get_market_summary_text()
        indices  = market.get("indices", {})
        sp500_d  = indices.get("S&P 500", {})
        nasdaq_d = indices.get("NASDAQ",  {})
        sp500_pct  = sp500_d.get("change_pct")
        nasdaq_pct = nasdaq_d.get("change_pct")

        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("push_market_close", True)
        )
        uids = [u["user_id"] for u in (prefs_res.data or [])]
        if not uids:
            return

        tiers_res = await run_query(
            db.table("user_profiles").select("user_id,subscription_tier").in_("user_id", uids)
        )
        tier_map = {r["user_id"]: r.get("subscription_tier") for r in (tiers_res.data or [])}

        premium_uids = [uid for uid in uids if tier_map.get(uid) == "premium"]
        all_tickers: set[str] = set()
        portfolio_map: dict[str, list] = {}
        for uid in premium_uids:
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if port_res.data:
                raw = port_res.data[0].get("positions") or {}
                pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                portfolio_map[uid] = pos
                all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        prices = await _batch_fetch_prices(list(all_tickers)) if all_tickers else {}

        sent = 0
        for i, uid in enumerate(uids):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))

            is_premium = tier_map.get(uid) == "premium"
            if is_premium and uid in portfolio_map and prices:
                user_pct = _calc_portfolio_pct(portfolio_map[uid], prices)
                sp_str   = f"{sp500_pct:+.1f}%" if sp500_pct is not None else "—"
                nq_str   = f"{nasdaq_pct:+.1f}%" if nasdaq_pct is not None else "—"
                if user_pct is not None and sp500_pct is not None:
                    if user_pct > sp500_pct:
                        title = "🏆 ¡Superaste al mercado hoy!"
                        body  = f"Tu portafolio {user_pct:+.1f}% vs S&P 500 ({sp_str}). ¡Excelente día, sigue así!"
                    else:
                        title = "📊 Mercados cerraron"
                        body  = f"Tu portafolio {user_pct:+.1f}% vs S&P 500 ({sp_str}). Entra a Nuvos AI para revisar tu estrategia."
                else:
                    title = "📊 Mercados cerraron"
                    body  = f"S&P 500 {sp_str}, NASDAQ {nq_str}. Entra a revisar tu portafolio."
            else:
                sp_str = f"{sp500_pct:+.1f}%" if sp500_pct is not None else "—"
                nq_str = f"{nasdaq_pct:+.1f}%" if nasdaq_pct is not None else "—"
                emoji  = "📈" if (sp500_pct or 0) >= 0 else "📉"
                title  = f"{emoji} Mercados cerraron"
                body   = f"S&P 500 {sp_str} | NASDAQ {nq_str}. Revisa el resumen del día en Nuvos."

            await send_push(uid, "market_close", title, body, {"screen": "portfolio"}, db)
            sent += 1
        logger.info("Market close push: %d sent", sent)
    except Exception as e:
        logger.error("job_market_close failed: %s", e)


async def job_daily_email():
    """6:00 PM ET weekdays — daily summary email to all opted-in users."""
    if not settings.resend_api_key:
        return
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_email_notification, get_market_summary_text
    from app.services.email_templates import daily_summary_email
    db = get_supabase()
    try:
        market = await get_market_summary_text()
        html   = daily_summary_email(market, [])
        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("email_daily_summary", True)
        )
        sent = 0
        for i, u in enumerate(prefs_res.data or []):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await send_email_notification(
                u["user_id"], "daily_summary", "Tu resumen diario del mercado — Nuvos AI", html, db
            )
            sent += 1
        logger.info("Daily email: %d sent", sent)
    except Exception as e:
        logger.error("job_daily_email failed: %s", e)


async def job_portfolio_alerts():
    """Every 30 min weekday market hours — check premium portfolios for ±4%/±8% moves."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push, check_portfolio_alerts
    import random
    db = get_supabase()
    try:
        users_res = await run_query(
            db.table("user_profiles").select("user_id").eq("subscription_tier", "premium")
        )
        processed = 0
        for u in (users_res.data or []):
            uid      = u["user_id"]
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if not port_res.data:
                continue
            raw = port_res.data[0].get("positions") or {}
            positions = raw.get("positions", []) if isinstance(raw, dict) else raw if isinstance(raw, list) else []
            if not positions:
                continue
            alerts = await check_portfolio_alerts(uid, positions, db)
            for alert in alerts:
                ticker    = alert["ticker"]
                pct       = alert["change_pct"]
                emoji     = "🚀" if pct > 0 else "📉"
                direction = "subió" if pct > 0 else "cayó"
                category  = "portfolio_extreme" if alert["level"] == "extreme" else "portfolio_alert"
                await send_push(
                    uid, category,
                    f"{emoji} {ticker} {direction} {abs(pct):.1f}%",
                    f"Tu posición en {ticker} tiene un movimiento significativo hoy.",
                    {"ticker": ticker, "change_pct": pct, "screen": "portfolio"},
                    db,
                )
                await asyncio.sleep(random.uniform(0.05, 0.3))
            processed += 1
        logger.info("Portfolio alerts: %d premium users scanned", processed)
    except Exception as e:
        logger.error("job_portfolio_alerts failed: %s", e)


async def job_weekly_summary_push():
    """9:30 AM ET Saturday — Free: generic weekly push. Premium: portfolio vs indices (beat/lag variant)."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push, get_market_summary_text
    db = get_supabase()
    try:
        market   = await get_market_summary_text()
        indices  = market.get("indices", {})
        sp500_pct  = (indices.get("S&P 500") or {}).get("change_pct")
        nasdaq_pct = (indices.get("NASDAQ")  or {}).get("change_pct")

        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("email_weekly_summary", True)
        )
        uids = [u["user_id"] for u in (prefs_res.data or [])]
        if not uids:
            return

        tiers_res = await run_query(
            db.table("user_profiles").select("user_id,subscription_tier").in_("user_id", uids)
        )
        tier_map = {r["user_id"]: r.get("subscription_tier") for r in (tiers_res.data or [])}

        premium_uids = [uid for uid in uids if tier_map.get(uid) == "premium"]
        all_tickers: set[str] = set()
        portfolio_map: dict[str, list] = {}
        for uid in premium_uids:
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if port_res.data:
                raw = port_res.data[0].get("positions") or {}
                pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                portfolio_map[uid] = pos
                all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        prices = await _batch_fetch_prices(list(all_tickers)) if all_tickers else {}

        sent = 0
        for i, uid in enumerate(uids):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))

            is_premium = tier_map.get(uid) == "premium"
            if is_premium and uid in portfolio_map and prices:
                user_pct = _calc_portfolio_pct(portfolio_map[uid], prices)
                sp_str   = f"{sp500_pct:+.1f}%" if sp500_pct is not None else "—"
                nq_str   = f"{nasdaq_pct:+.1f}%" if nasdaq_pct is not None else "—"
                if user_pct is not None and sp500_pct is not None:
                    if user_pct > sp500_pct:
                        title = "🏆 Semana ganadora"
                        body  = f"Tu portafolio {user_pct:+.1f}% superó al S&P 500 ({sp_str}) esta semana. ¡Sigue así!"
                    else:
                        title = "📊 Tu resumen semanal"
                        body  = f"Tu portafolio {user_pct:+.1f}% vs S&P 500 ({sp_str}). Entra a Nuvos AI para analizar tu estrategia."
                else:
                    title = "📊 Tu resumen semanal"
                    body  = f"S&P 500 {sp_str}, NASDAQ {nq_str}. Tu análisis personalizado está listo."
            else:
                sp_str = f"{sp500_pct:+.1f}%" if sp500_pct is not None else "—"
                title  = "📊 Resumen Semanal"
                body   = f"S&P 500 {sp_str} esta semana. Tu resumen personalizado está listo en Nuvos AI."

            await send_push(uid, "weekly_summary", title, body, {"screen": "portfolio"}, db)
            sent += 1
        logger.info("Weekly summary push: %d sent", sent)
    except Exception as e:
        logger.error("job_weekly_summary_push failed: %s", e)


async def job_events_alerts():
    """8:00 AM ET weekdays — push for today/tomorrow ex-div, dividend payment, and earnings dates."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    from app.api.routes.earnings import _fetch_events_for_symbol
    from datetime import timedelta
    import random

    db       = get_supabase()
    today    = datetime.now(timezone.utc).date()
    tomorrow = today + timedelta(days=1)
    targets  = {str(today), str(tomorrow)}

    try:
        prefs_res = await run_query(
            db.table("notification_preferences")
            .select("user_id,push_portfolio_alerts,push_watchlist_alerts")
            .or_("push_portfolio_alerts.eq.true,push_watchlist_alerts.eq.true")
        )
        if not prefs_res.data:
            return
        prefs_by_uid = {p["user_id"]: p for p in prefs_res.data}

        processed = notified = 0
        for i, (uid, prefs) in enumerate(prefs_by_uid.items()):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)

            port_tickers: set = set()
            watch_tickers: set = set()

            if prefs.get("push_portfolio_alerts"):
                port_res = await run_query(
                    db.table("user_portfolio").select("positions").eq("user_id", uid)
                )
                if port_res.data:
                    raw = port_res.data[0].get("positions") or {}
                    positions = raw.get("positions", []) if isinstance(raw, dict) else raw if isinstance(raw, list) else []
                    port_tickers = {p["ticker"] for p in positions if p.get("ticker")}

            if prefs.get("push_watchlist_alerts"):
                watch_res = await run_query(
                    db.table("watchlist").select("ticker").eq("user_id", uid)
                )
                watch_tickers = {r["ticker"] for r in (watch_res.data or [])} - port_tickers

            all_tickers = port_tickers | watch_tickers
            if not all_tickers:
                processed += 1
                continue

            for ticker in all_tickers:
                events = await asyncio.to_thread(_fetch_events_for_symbol, ticker)
                for evt in events:
                    if evt.get("event_date") not in targets:
                        continue
                    is_today   = evt["event_date"] == str(today)
                    when       = "hoy" if is_today else "mañana"
                    event_type = evt.get("event_type")

                    if event_type == "earnings":
                        title    = f"📊 Resultados: {ticker}"
                        eps      = evt.get("eps_estimate")
                        body     = f"{ticker} reporta ganancias {when}." + (f" EPS est. ${eps:.2f}." if eps else "")
                        category = "earnings_report"
                    elif event_type == "ex_dividend":
                        title    = f"✂️ Ex-Dividendo: {ticker}"
                        amt      = evt.get("dividend_amount")
                        body     = f"Fecha ex-dividendo de {ticker} es {when}." + (f" ${amt:.4f}/acción." if amt else "")
                        category = "ex_dividend"
                    elif event_type == "dividend":
                        title    = f"💰 Dividendo: {ticker}"
                        body     = f"{ticker} paga dividendo {when}."
                        category = "dividend_payment"
                    else:
                        continue

                    is_portfolio = ticker in port_tickers
                    await send_push(
                        uid, category, title, body,
                        {"ticker": ticker, "screen": "portfolio" if is_portfolio else "watchlist"},
                        db,
                    )
                    notified += 1
                    await asyncio.sleep(random.uniform(0.05, 0.15))

            processed += 1

        logger.info("Events alerts: %d users processed, %d notifications sent", processed, notified)
    except Exception as e:
        logger.error("job_events_alerts failed: %s", e)


async def job_monthly_report_push():
    """9:00 AM ET on 1st of month — Free: generic monthly summary. Premium: portfolio vs indices (beat/lag)."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push, get_market_summary_text
    now = datetime.now(timezone.utc)
    if now.day != 1:
        return
    db = get_supabase()
    try:
        market    = await get_market_summary_text()
        indices   = market.get("indices", {})
        sp500_pct = (indices.get("S&P 500") or {}).get("change_pct")
        nasdaq_pct = (indices.get("NASDAQ") or {}).get("change_pct")

        users_res = await run_query(
            db.table("user_profiles").select("user_id,subscription_tier,name")
        )
        uids = [u["user_id"] for u in (users_res.data or [])]
        tier_map = {u["user_id"]: u.get("subscription_tier") for u in (users_res.data or [])}

        premium_uids = [uid for uid in uids if tier_map.get(uid) == "premium"]
        all_tickers: set[str] = set()
        portfolio_map: dict[str, list] = {}
        for uid in premium_uids:
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if port_res.data:
                raw = port_res.data[0].get("positions") or {}
                pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                portfolio_map[uid] = pos
                all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        prices = await _batch_fetch_prices(list(all_tickers)) if all_tickers else {}
        month_name = now.strftime("%B")

        sent = 0
        for i, uid in enumerate(uids):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))

            is_premium = tier_map.get(uid) == "premium"
            if is_premium and uid in portfolio_map and prices:
                user_pct = _calc_portfolio_pct(portfolio_map[uid], prices)
                sp_str   = f"{sp500_pct:+.1f}%" if sp500_pct is not None else "—"
                if user_pct is not None and sp500_pct is not None:
                    if user_pct > sp500_pct:
                        title = "🏆 Reporte mensual listo"
                        body  = f"¡Excelente mes! Tu portafolio {user_pct:+.1f}% superó al S&P 500 ({sp_str}). Ver análisis completo."
                    else:
                        title = "📋 Reporte mensual de {month_name}"
                        body  = f"Tu portafolio {user_pct:+.1f}% vs S&P 500 ({sp_str}). Entra a Nuvos AI para optimizar tu estrategia."
                else:
                    title = f"📋 Reporte mensual de {month_name}"
                    body  = f"Tu análisis de portafolio del mes está listo. Entra a Nuvos AI para revisarlo."
            else:
                title = f"📋 Resumen de {month_name}"
                body  = "Tu resumen mensual está disponible. Revisa cómo se comportaron los mercados."

            await send_push(uid, "monthly_report", title, body, {"screen": "portfolio"}, db)
            sent += 1
        logger.info("Monthly report push: %d sent", sent)
    except Exception as e:
        logger.error("job_monthly_report_push failed: %s", e)


async def job_reengagement_push():
    """11:00 AM ET daily — push to users inactive for 3+ days (3 notable portfolio movers)."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    try:
        prefs_res = await run_query(
            db.table("notification_preferences")
            .select("user_id,last_opened_app,push_market_open")
            .eq("push_market_open", True)
        )
        inactive_uids = [
            r["user_id"]
            for r in (prefs_res.data or [])
            if not r.get("last_opened_app") or r["last_opened_app"] < cutoff
        ]
        if not inactive_uids:
            return

        # Collect tickers from each inactive user's portfolio
        all_tickers: set[str] = set()
        port_map: dict[str, list] = {}
        for uid in inactive_uids:
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if port_res.data:
                raw = port_res.data[0].get("positions") or {}
                pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                port_map[uid] = pos
                all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        prices = await _batch_fetch_prices(list(all_tickers)) if all_tickers else {}

        sent = 0
        for i, uid in enumerate(inactive_uids):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))
            positions = port_map.get(uid, [])
            movers = []
            for p in positions:
                ticker = p.get("ticker")
                if ticker and ticker in prices:
                    px = prices[ticker]
                    if px["prev"] > 0:
                        pct = (px["curr"] - px["prev"]) / px["prev"] * 100
                        movers.append((ticker, abs(pct), pct))
            movers.sort(key=lambda x: x[1], reverse=True)
            top = movers[:3]
            if top:
                names = ", ".join(t[0] for t in top)
                body  = f"3 de tus activos favoritos tuvieron movimientos interesantes: {names}. ¿Ya los revisaste?"
            else:
                body = "Te has perdido algunos movimientos en tus activos. Entra a revisar tu portafolio."
            await send_push(
                uid, "reengagement",
                "📱 Tu portafolio te está esperando",
                body,
                {"screen": "portfolio"},
                db,
            )
            sent += 1
        logger.info("Re-engagement push: %d sent to %d inactive users", sent, len(inactive_uids))
    except Exception as e:
        logger.error("job_reengagement_push failed: %s", e)


_EDUCATION_TIPS = [
    ("💡 Dato curioso del mercado", "¿Sabías que los lunes son los días con más volatilidad histórica? Esta semana obsérvalo en tus activos desde Nuvos AI."),
    ("💡 El poder del interés compuesto", "Einstein lo llamó la 8va maravilla del mundo. $100/mes al 10% anual = $1M en 45 años. Explora en la Academia Nuvos cómo aplicarlo."),
    ("💡 ¿Qué es el P/E ratio?", "Es la métrica más usada para valorar empresas. Aprende a interpretar el P/E de tus acciones en la Academia Nuvos hoy."),
    ("💡 Dollar Cost Averaging", "Invertir montos fijos periódicamente elimina la angustia de 'cuándo entrar'. Descubre cómo DCA puede reducir tu costo promedio."),
    ("💡 Diversificación real vs. ilusoria", "¿Tienes 8 acciones de tecnología? Eso no es diversificación. Aprende qué sí lo es en Nuvos AI."),
    ("💡 Earnings Season: oportunidad única", "4 veces al año hay volatilidad extrema post-earnings. Aprende a anticiparla en Nuvos AI antes de que llegue."),
    ("💡 'Comprar el rumor, vender la noticia'", "Es uno de los fenómenos más contraintuitivos del mercado. ¿Sabes cuándo ocurre con tus acciones? Entra a la Academia."),
    ("💡 ¿Qué mueve las tasas de interés?", "La Fed tiene más poder del que crees sobre tu portafolio. Aprende el mecanismo en la Academia Nuvos."),
    ("💡 La regla del 72", "Divide 72 entre tu tasa de retorno anual y obtendrás los años que tardará en duplicarse tu dinero. ¿Cuánto tardaría el tuyo?"),
    ("💡 ¿Qué es el VIX?", "El 'índice del miedo' mide la volatilidad esperada del mercado. Aprende a usarlo como señal en Nuvos AI."),
]


async def job_education_push():
    """2:00 PM ET Mon/Wed/Fri — rotating educational/curiosity push."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    try:
        day_idx = datetime.now(timezone.utc).timetuple().tm_yday
        tip = _EDUCATION_TIPS[day_idx % len(_EDUCATION_TIPS)]
        title, body = tip

        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("push_market_open", True)
        )
        sent = 0
        for i, u in enumerate(prefs_res.data or []):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))
            await send_push(u["user_id"], "education_push", title, body, {"screen": "academy"}, db)
            sent += 1
        logger.info("Education push: %d sent (tip index %d)", sent, day_idx % len(_EDUCATION_TIPS))
    except Exception as e:
        logger.error("job_education_push failed: %s", e)


async def job_social_proof_push():
    """3:00 PM ET Saturday — 'Most users with similar portfolios are watching {{Ticker}}'."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    try:
        # Find the most-watched ticker across all watchlists this week
        watch_res = await run_query(db.table("watchlist").select("ticker"))
        ticker_counts: dict[str, int] = {}
        for row in (watch_res.data or []):
            t = row.get("ticker")
            if t:
                ticker_counts[t] = ticker_counts.get(t, 0) + 1
        if not ticker_counts:
            return
        trending = sorted(ticker_counts, key=lambda x: ticker_counts[x], reverse=True)[:5]

        users_res = await run_query(
            db.table("user_profiles").select("user_id")
        )
        sent = 0
        for i, u in enumerate(users_res.data or []):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))
            ticker = random.choice(trending)
            body   = f"La mayoría de los inversores con portafolios similares al tuyo están siguiendo {ticker} esta semana. ¿Ya lo tienes en tu watchlist?"
            await send_push(
                u["user_id"], "social_proof",
                f"👀 {ticker} está en tendencia",
                body,
                {"ticker": ticker, "screen": "watchlist"},
                db,
            )
            sent += 1
        logger.info("Social proof push: %d sent, top tickers: %s", sent, trending[:3])
    except Exception as e:
        logger.error("job_social_proof_push failed: %s", e)


async def job_risk_mgmt_push():
    """3:00 PM ET Friday — push VIX spike warning + stop loss reminder when VIX > 20."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    try:
        def _fetch_vix():
            try:
                import yfinance as yf
                hist = yf.Ticker("^VIX").history(period="2d")
                if not hist.empty:
                    return float(hist["Close"].iloc[-1])
            except Exception:
                pass
            return None

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            vix = await asyncio.get_event_loop().run_in_executor(ex, _fetch_vix)

        if vix is None or vix < 20:
            logger.info("Risk mgmt push skipped: VIX=%.1f (threshold 20)", vix or 0)
            return

        title = "⚠️ Volatilidad elevada"
        body  = f"El VIX está en {vix:.1f} — por encima del nivel de alerta. Revisa tus stop-loss y niveles de exposición en Nuvos AI."

        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("push_portfolio_alerts", True)
        )
        sent = 0
        for i, u in enumerate(prefs_res.data or []):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))
            await send_push(u["user_id"], "risk_management", title, body, {"screen": "portfolio"}, db)
            sent += 1
        logger.info("Risk mgmt push: VIX=%.1f, %d users notified", vix, sent)
    except Exception as e:
        logger.error("job_risk_mgmt_push failed: %s", e)


async def job_diversification_push():
    """11:00 AM ET Saturday — nudge users who are close to a diversification goal."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    # Sector ETF proxies: simple sector classification
    SECTOR_MAP = {
        "AAPL": "Tecnología", "MSFT": "Tecnología", "GOOGL": "Tecnología", "META": "Tecnología", "NVDA": "Tecnología",
        "JPM": "Finanzas", "BAC": "Finanzas", "GS": "Finanzas", "V": "Finanzas", "MA": "Finanzas",
        "JNJ": "Salud", "PFE": "Salud", "UNH": "Salud", "ABBV": "Salud",
        "XOM": "Energía", "CVX": "Energía", "COP": "Energía",
        "AMZN": "Consumo", "WMT": "Consumo", "COST": "Consumo", "HD": "Consumo",
        "NEE": "Utilities", "SO": "Utilities",
        "AMT": "Real Estate", "SPG": "Real Estate",
        "DIS": "Comunicaciones", "NFLX": "Comunicaciones", "T": "Comunicaciones",
        "CAT": "Industrial", "BA": "Industrial", "GE": "Industrial",
        "LIN": "Materiales", "NEM": "Materiales",
    }
    GOAL_SECTORS = 5  # target: 5 distinct sectors

    db = get_supabase()
    try:
        users_res = await run_query(db.table("user_profiles").select("user_id"))
        sent = 0
        for i, u in enumerate(users_res.data or []):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            uid = u["user_id"]
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if not port_res.data:
                continue
            raw = port_res.data[0].get("positions") or {}
            pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
            sectors = {SECTOR_MAP[p["ticker"]] for p in pos if p.get("ticker") in SECTOR_MAP}
            missing = GOAL_SECTORS - len(sectors)
            if missing <= 0 or missing > 2:
                continue  # already diversified or too far away
            sector_label = "sector" if missing == 1 else "sectores"
            body = f"Estás a {missing} {sector_label} de completar tu meta de diversificación. ¿Qué activo te falta explorar?"
            await send_push(
                uid, "diversification_goal",
                "🎯 Meta de diversificación",
                body,
                {"screen": "portfolio"},
                db,
            )
            await asyncio.sleep(random.uniform(0, 0.12))
            sent += 1
        logger.info("Diversification push: %d users notified", sent)
    except Exception as e:
        logger.error("job_diversification_push failed: %s", e)


async def job_earnings_results():
    """5:00 PM ET weekdays — detect tickers that reported earnings today and push/email results."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    today = datetime.now(timezone.utc).date()

    def _fetch_earnings_results(ticker: str):
        try:
            import yfinance as yf
            t = yf.Ticker(ticker)
            cal = t.get_earnings_dates(limit=4)
            if cal is None or cal.empty:
                return None
            # Find a row with today's date
            cal.index = cal.index.tz_convert("UTC")
            today_rows = cal[cal.index.date == today]
            if today_rows.empty:
                return None
            row = today_rows.iloc[0]
            eps_real  = row.get("Reported EPS")
            eps_est   = row.get("EPS Estimate")
            # Revenue from quarterly financials
            info = t.info
            hist = t.history(period="5d")
            change_pct = None
            if len(hist) >= 2:
                prev = float(hist["Close"].iloc[-2])
                curr = float(hist["Close"].iloc[-1])
                if prev > 0:
                    change_pct = (curr - prev) / prev * 100
            return {
                "eps_real": float(eps_real) if eps_real is not None else None,
                "eps_est":  float(eps_est)  if eps_est  is not None else None,
                "change_pct": change_pct,
                "company_name": info.get("shortName", ticker),
            }
        except Exception:
            return None

    try:
        users_res = await run_query(
            db.table("user_profiles").select("user_id,name,subscription_tier")
        )
        auth_users = {u.id: u.email for u in await asyncio.to_thread(lambda: db.auth.admin.list_users())}

        # Gather all unique portfolio tickers
        all_tickers: set[str] = set()
        port_by_uid: dict[str, list] = {}
        for u in (users_res.data or []):
            uid = u["user_id"]
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if port_res.data:
                raw = port_res.data[0].get("positions") or {}
                pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                port_by_uid[uid] = pos
                all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        if not all_tickers:
            return

        # Fetch earnings results for all tickers (only today's reporters)
        results_map: dict[str, dict] = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            futures = {ticker: ex.submit(_fetch_earnings_results, ticker) for ticker in all_tickers}
            for ticker, fut in futures.items():
                try:
                    result = fut.result(timeout=15)
                    if result:
                        results_map[ticker] = result
                except Exception:
                    pass

        if not results_map:
            logger.info("Earnings results job: no reports found for today (%s)", today)
            return

        notified = 0
        for u in (users_res.data or []):
            uid   = u["user_id"]
            email = auth_users.get(uid)
            pos   = port_by_uid.get(uid, [])
            held  = {p["ticker"] for p in pos if p.get("ticker")}
            for ticker, res in results_map.items():
                if ticker not in held:
                    continue
                eps_real    = res.get("eps_real")
                eps_est     = res.get("eps_est")
                change_pct  = res.get("change_pct")
                beat_eps    = (eps_real is not None and eps_est is not None and eps_real >= eps_est)
                emoji       = "✅" if beat_eps else "❌"
                eps_str     = f"${eps_real:.2f}" if eps_real is not None else "—"
                est_str     = f"${eps_est:.2f}"  if eps_est  is not None else "—"
                pct_str     = f"{change_pct:+.1f}%" if change_pct is not None else "—"
                push_body   = f"{emoji} EPS {eps_str} (est. {est_str}). Precio {pct_str} post-earnings. Entra a analizar."
                await send_push(
                    uid, "earnings_results",
                    f"📊 {ticker} reportó resultados",
                    push_body,
                    {"ticker": ticker, "screen": "portfolio"},
                    db,
                )
                if email and settings.resend_api_key:
                    html = build_earnings_results_html(
                        name=u.get("name") or "Inversor",
                        ticker=ticker,
                        eps_real=eps_real,
                        eps_est=eps_est,
                        rev_real_b=None,
                        rev_est_b=None,
                        change_pct=change_pct,
                    )
                    await send_email(email, f"📊 {ticker} acaba de reportar resultados", html)
                notified += 1
                await asyncio.sleep(random.uniform(0.05, 0.2))

        logger.info("Earnings results: %d notifications sent for tickers: %s", notified, list(results_map.keys()))
    except Exception as e:
        logger.error("job_earnings_results failed: %s", e)


# ─────────────────────────────────────────────────────────────────────────────
# Email jobs
# ─────────────────────────────────────────────────────────────────────────────

async def send_enhanced_weekly_emails():
    """Enhanced weekly email with portfolio performance vs indices — every Saturday."""
    if not settings.resend_api_key:
        logger.info("RESEND_API_KEY not set — skipping enhanced weekly emails")
        return
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import get_market_summary_text
    db = get_supabase()
    try:
        market     = await get_market_summary_text()
        indices    = market.get("indices", {})
        sp500_pct  = (indices.get("S&P 500") or {}).get("change_pct")
        nasdaq_pct = (indices.get("NASDAQ")  or {}).get("change_pct")

        users_res = await run_query(
            db.table("user_profiles").select("user_id,name,subscription_tier,risk_tolerance,investment_goal")
        )
        auth_users = {u.id: u.email for u in await asyncio.to_thread(lambda: db.auth.admin.list_users())}

        all_tickers: set[str] = set()
        port_map: dict[str, list] = {}
        for u in (users_res.data or []):
            uid = u["user_id"]
            if u.get("subscription_tier") != "premium":
                continue
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if port_res.data:
                raw = port_res.data[0].get("positions") or {}
                pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                port_map[uid] = pos
                all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        prices = await _batch_fetch_prices(list(all_tickers)) if all_tickers else {}

        # Build generic AI market summary once (reused for free users)
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
            sp_label = f"{sp500_pct:+.1f}%" if sp500_pct is not None else "datos no disponibles"
            nq_label = f"{nasdaq_pct:+.1f}%" if nasdaq_pct is not None else "datos no disponibles"
            ai_resp = await asyncio.to_thread(
                lambda: client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=400,
                    messages=[{
                        "role": "user",
                        "content": (
                            f"Escribe 2 párrafos cortos en español sobre el contexto del mercado esta semana. "
                            f"S&P 500: {sp_label}, NASDAQ: {nq_label}. "
                            "Menciona los principales factores macroeconómicos y qué deben considerar los inversores. "
                            "Tono profesional pero accesible. Sin bullets, solo prosa."
                        ),
                    }],
                )
            )
            ai_summary = ai_resp.content[0].text if ai_resp.content else "Los mercados esta semana reflejaron las condiciones macro globales."
        except Exception:
            ai_summary = "Los mercados esta semana reflejaron las condiciones macro globales. Mantén tu estrategia de largo plazo y no tomes decisiones apresuradas basadas en la volatilidad de corto plazo."

        sent = 0
        for u in (users_res.data or []):
            uid   = u["user_id"]
            email = auth_users.get(uid)
            if not email:
                continue
            is_premium = u.get("subscription_tier") == "premium"
            user_pct   = None
            top_ticker = None
            top_perf   = None
            sector     = None

            if is_premium and uid in port_map and prices:
                user_pct               = _calc_portfolio_pct(port_map[uid], prices)
                top_ticker, top_perf   = _top_performer(port_map[uid], prices)

            html = build_enhanced_weekly_html(
                name=u.get("name") or "Inversor",
                is_premium=is_premium,
                user_perf=user_pct,
                sp500_perf=sp500_pct,
                nasdaq_perf=nasdaq_pct,
                top_ticker=top_ticker,
                top_perf=top_perf,
                sector=sector,
                ai_summary=ai_summary,
            )
            ok = await send_email(email, "📊 Tu resumen semanal está listo — Nuvos AI", html)
            if ok:
                sent += 1
        logger.info("Enhanced weekly emails: %d sent", sent)
    except Exception as e:
        logger.error("send_enhanced_weekly_emails failed: %s", e)


async def send_birthday_emails():
    """Daily at 8:00 AM ET — send birthday email + 7-day Premium trial to users with birthday today."""
    if not settings.resend_api_key:
        return
    from app.core.database import get_supabase, run_query
    db = get_supabase()
    today = datetime.now(timezone.utc).date()
    try:
        users_res = await run_query(
            db.table("user_profiles").select("user_id,name,birth_date")
        )
        auth_users = {u.id: u.email for u in await asyncio.to_thread(lambda: db.auth.admin.list_users())}
        sent = 0
        for u in (users_res.data or []):
            bd_str = u.get("birth_date")
            if not bd_str:
                continue
            try:
                from datetime import date
                bd = date.fromisoformat(str(bd_str)[:10])
                if bd.month != today.month or bd.day != today.day:
                    continue
            except Exception:
                continue
            email = auth_users.get(u["user_id"])
            if not email:
                continue
            html = build_birthday_html(u.get("name") or "Inversor")
            ok   = await send_email(email, "🎂 ¡Feliz cumpleaños! Tu regalo de Nuvos AI", html)
            if ok:
                sent += 1
                logger.info("Birthday email sent to %s", u["user_id"])
        logger.info("Birthday emails: %d sent", sent)
    except Exception as e:
        logger.error("send_birthday_emails failed: %s", e)


async def send_reengagement_emails():
    """Saturdays — email users inactive for 7+ days with 3 notable portfolio movers."""
    if not settings.resend_api_key:
        return
    from app.core.database import get_supabase, run_query
    db = get_supabase()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    try:
        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id,last_opened_app")
        )
        inactive_uids = [
            r["user_id"]
            for r in (prefs_res.data or [])
            if not r.get("last_opened_app") or r["last_opened_app"] < cutoff
        ]
        if not inactive_uids:
            logger.info("Re-engagement email: no inactive users found")
            return

        users_res = await run_query(
            db.table("user_profiles").select("user_id,name").in_("user_id", inactive_uids)
        )
        auth_users = {u.id: u.email for u in await asyncio.to_thread(lambda: db.auth.admin.list_users())}

        all_tickers: set[str] = set()
        port_map: dict[str, list] = {}
        for u in (users_res.data or []):
            uid = u["user_id"]
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if port_res.data:
                raw = port_res.data[0].get("positions") or {}
                pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                port_map[uid] = pos
                all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        prices = await _batch_fetch_prices(list(all_tickers)) if all_tickers else {}

        sent = 0
        for u in (users_res.data or []):
            uid   = u["user_id"]
            email = auth_users.get(uid)
            if not email:
                continue
            positions = port_map.get(uid, [])
            movers = []
            for p in positions:
                ticker = p.get("ticker")
                if ticker and ticker in prices:
                    px = prices[ticker]
                    if px["prev"] > 0:
                        pct = (px["curr"] - px["prev"]) / px["prev"] * 100
                        movers.append({"ticker": ticker, "change_pct": pct})
            movers.sort(key=lambda x: abs(x["change_pct"]), reverse=True)

            html = build_reengagement_html(u.get("name") or "Inversor", movers[:3])
            ok   = await send_email(email, "📱 Tu portafolio te extraña — Nuvos AI", html)
            if ok:
                sent += 1
        logger.info("Re-engagement emails: %d sent to %d inactive users", sent, len(inactive_uids))
    except Exception as e:
        logger.error("send_reengagement_emails failed: %s", e)


_EDUCATIONAL_CONCEPTS = [
    {
        "concept": "El poder del interés compuesto",
        "explanation": "El interés compuesto es la capacidad de tus ganancias de generar más ganancias a lo largo del tiempo. A diferencia del interés simple, donde solo ganas sobre el capital inicial, con el compuesto tus rendimientos se reinvierten y trabajan junto al capital original.\n\nEinstein lo llamó la octava maravilla del mundo. La clave está en el tiempo: cuanto antes comiences, mayor es el efecto multiplicador. Incluso pequeñas contribuciones periódicas pueden convertirse en sumas significativas a largo plazo gracias a este principio.",
        "example": "Si inviertes $200 al mes desde los 25 años con un 8% anual promedio, a los 65 tendrás aproximadamente $702,000. Si empiezas a los 35, tendrás solo $298,000 — menos de la mitad, aunque inviertas la misma cantidad mensual.",
    },
    {
        "concept": "Dollar Cost Averaging (DCA)",
        "explanation": "El Dollar Cost Averaging consiste en invertir una cantidad fija de dinero en intervalos regulares, independientemente de si el mercado está subiendo o bajando. Con esto, compras más participaciones cuando los precios son bajos y menos cuando son altos, reduciendo tu costo promedio por acción a lo largo del tiempo.\n\nEsta estrategia elimina la presión de intentar 'timing' del mercado — uno de los errores más comunes entre inversores. En lugar de preguntarte '¿es el mejor momento para entrar?', simplemente inviertes con consistencia.",
        "example": "Si inviertes $100 cada semana en un ETF: cuando está a $50/acción compras 2, cuando baja a $25 compras 4, cuando sube a $100 compras 1. Tu precio promedio resulta mejor que si hubieras comprado todo de una sola vez.",
    },
    {
        "concept": "El ratio P/E (Precio/Ganancias)",
        "explanation": "El P/E ratio es la métrica más utilizada para valorar empresas en bolsa. Te dice cuántos dólares estás pagando por cada dólar de ganancia anual que genera la empresa. Un P/E alto puede indicar que el mercado espera mucho crecimiento futuro; uno bajo puede señalar que la acción está 'barata' o que el mercado tiene dudas sobre la empresa.\n\nNo existe un P/E 'correcto' universal — depende del sector, el ciclo económico y el crecimiento esperado. Lo más útil es comparar el P/E de una empresa con el de sus competidoras directas y con su propio historial.",
        "example": "Si Apple genera $6 de ganancias por acción y cotiza a $180, su P/E es 30x. Eso significa que pagas $30 por cada $1 de ganancia. Compara eso con el P/E histórico de Apple (que ha variado entre 15x y 35x) para evaluar si está cara o barata.",
    },
    {
        "concept": "Diversificación: real vs. ilusoria",
        "explanation": "Diversificar significa repartir el riesgo entre activos que no se mueven de la misma manera. El problema es que muchos inversores creen que tienen un portafolio diversificado cuando en realidad todos sus activos están correlacionados y caen juntos en momentos de crisis.\n\nLa diversificación real implica combinar activos de distintos sectores, geografías, tamaños de empresa, y clases de activo (acciones, bonos, commodities). Una cartera de 10 acciones tecnológicas norteamericanas tiene muy poca diversificación real.",
        "example": "En la caída del mercado de 2022, quien tenía solo tecnología perdió un 35-40%. Quien tenía también energía, commodities y bonos a corto plazo vio caídas mucho menores, porque esos sectores se comportaron de manera diferente.",
    },
    {
        "concept": "'Comprar el rumor, vender la noticia'",
        "explanation": "Uno de los fenómenos más contraintuitivos del mercado: cuando se confirma una buena noticia, la acción muchas veces baja en lugar de subir. ¿Por qué? Porque los inversores más informados ya habían comprado anticipando la noticia (el 'rumor'), y cuando se confirma, aprovechan para vender y tomar ganancias.\n\nEste patrón aparece constantemente en earnings, anuncios de productos, aprobaciones regulatorias y datos económicos. La buena noticia ya estaba 'descontada' en el precio antes de que fuera pública.",
        "example": "Apple anuncia un iPhone revolucionario. La acción sube semanas antes del evento (el rumor). El día del lanzamiento oficial, aunque las reseñas son excelentes, la acción cae 3%. Los que compraron en el rumor están vendiendo en la noticia.",
    },
    {
        "concept": "El VIX: índice del miedo del mercado",
        "explanation": "El VIX (Volatility Index) mide cuánta volatilidad espera el mercado en los próximos 30 días, calculada a partir de las opciones del S&P 500. Se lo conoce como el 'índice del miedo': cuando el mercado está tranquilo, el VIX es bajo; cuando hay pánico o incertidumbre extrema, el VIX sube.\n\nHabituamente el VIX ronda entre 12 y 20. Por encima de 30 indica turbulencia significativa; sobre 40 es pánico extremo. Para inversores de largo plazo, los picos del VIX han sido históricamente buenos momentos de compra.",
        "example": "Durante el crash de COVID-19 en marzo 2020, el VIX llegó a 85 — el nivel más alto de su historia. Quienes compraron S&P 500 en ese punto vieron retornos del 100%+ en los siguientes 18 meses.",
    },
]


async def send_educational_emails():
    """Biweekly (1st and 15th of month) — rotating educational concept email to all users."""
    if not settings.resend_api_key:
        return
    from app.core.database import get_supabase, run_query
    from app.services.email_service import build_educational_email_html
    db = get_supabase()
    today = datetime.now(timezone.utc).date()
    # Only run on 1st and 15th
    if today.day not in (1, 15):
        return
    # Pick concept: day-1 = first half of month, day-15 = second half
    # Rotate through concepts by (year * 24 + month * 2 + (0 if day==1 else 1))
    idx = (today.year * 24 + (today.month - 1) * 2 + (0 if today.day == 1 else 1)) % len(_EDUCATIONAL_CONCEPTS)
    concept_data = _EDUCATIONAL_CONCEPTS[idx]
    try:
        users_res  = await run_query(db.table("user_profiles").select("user_id,name"))
        auth_users = {u.id: u.email for u in await asyncio.to_thread(lambda: db.auth.admin.list_users())}
        sent = 0
        for u in (users_res.data or []):
            email = auth_users.get(u["user_id"])
            if not email:
                continue
            html = build_educational_email_html(
                name=u.get("name") or "Inversor",
                concept=concept_data["concept"],
                explanation=concept_data["explanation"],
                example=concept_data["example"],
            )
            ok = await send_email(email, f"📚 Concepto quincenal: {concept_data['concept']}", html)
            if ok:
                sent += 1
        logger.info("Educational emails: %d sent (concept #%d)", sent, idx)
    except Exception as e:
        logger.error("send_educational_emails failed: %s", e)


async def job_opportunity_push():
    """1:00 PM ET Wed/Fri — detect technical signals based on user's risk profile and push opportunity alerts."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()

    # Tickers to scan per risk profile (curated watchlist proxies)
    RISK_TICKERS = {
        "conservative":  ["JNJ", "KO", "PG", "MCD", "VZ", "NEE", "WMT", "BRK-B"],
        "moderate":      ["AAPL", "MSFT", "JPM", "V", "UNH", "AMZN", "HD", "GOOGL"],
        "aggressive":    ["NVDA", "TSLA", "META", "AMD", "PLTR", "SHOP", "COIN", "SOFI"],
    }
    RSI_OVERSOLD = 35.0  # signal: potential bounce

    def _compute_rsi(closes, period=14):
        if len(closes) < period + 1:
            return None
        deltas = [closes[i+1] - closes[i] for i in range(len(closes)-1)]
        gains  = [max(d, 0) for d in deltas]
        losses = [abs(min(d, 0)) for d in deltas]
        avg_g  = sum(gains[:period]) / period
        avg_l  = sum(losses[:period]) / period
        for i in range(period, len(deltas)):
            avg_g = (avg_g * (period-1) + gains[i]) / period
            avg_l = (avg_l * (period-1) + losses[i]) / period
        if avg_l == 0:
            return 100.0
        rs = avg_g / avg_l
        return round(100 - 100 / (1 + rs), 2)

    def _scan_signals(tickers):
        import yfinance as yf
        signals = []
        for ticker in tickers:
            try:
                hist = yf.Ticker(ticker).history(period="30d")
                if len(hist) < 16:
                    continue
                closes = [float(c) for c in hist["Close"]]
                rsi = _compute_rsi(closes)
                if rsi is not None and rsi <= RSI_OVERSOLD:
                    curr_pct = (closes[-1] - closes[-2]) / closes[-2] * 100 if closes[-2] else 0
                    signals.append({"ticker": ticker, "rsi": rsi, "change_pct": round(curr_pct, 2)})
            except Exception:
                pass
        return signals

    try:
        users_res = await run_query(
            db.table("user_profiles").select("user_id,risk_tolerance,subscription_tier")
        )
        if not users_res.data:
            return

        # Pre-compute signals per risk level (3 yfinance batch calls total)
        signals_by_risk: dict[str, list] = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
            futures = {
                risk: ex.submit(_scan_signals, tickers)
                for risk, tickers in RISK_TICKERS.items()
            }
            for risk, fut in futures.items():
                try:
                    signals_by_risk[risk] = fut.result(timeout=30)
                except Exception:
                    signals_by_risk[risk] = []

        sent = 0
        for i, u in enumerate(users_res.data):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            risk    = (u.get("risk_tolerance") or "moderate").lower()
            profile = "conservative" if "conserv" in risk else ("aggressive" if "agres" in risk or "aggres" in risk else "moderate")
            signals = signals_by_risk.get(profile, [])
            if not signals:
                continue
            # Pick a different signal per user using their index for variety
            sig = signals[i % len(signals)]
            ticker = sig["ticker"]
            rsi    = sig["rsi"]
            pct    = sig["change_pct"]
            body   = f"{ticker} muestra señal técnica de posible rebote (RSI {rsi:.0f}, {pct:+.1f}% hoy). Coincide con tu perfil de riesgo. Analiza en Nuvos AI."
            await send_push(
                u["user_id"], "opportunity_detection",
                f"🔍 Señal técnica: {ticker}",
                body,
                {"ticker": ticker, "screen": "portfolio"},
                db,
            )
            await asyncio.sleep(random.uniform(0, 0.12))
            sent += 1
        logger.info("Opportunity push: %d sent, signals: %s", sent, {k: [s["ticker"] for s in v] for k, v in signals_by_risk.items()})
    except Exception as e:
        logger.error("job_opportunity_push failed: %s", e)


async def job_cleanup_analytics():
    """Hourly — delete notification_log entries older than 90 days."""
    from app.core.database import get_supabase, run_query
    from datetime import timedelta
    db = get_supabase()
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
        await run_query(db.table("notification_log").delete().lt("sent_at", cutoff))
        logger.debug("Analytics cleanup done")
    except Exception as e:
        logger.warning("Analytics cleanup failed: %s", e)


async def main():
    scheduler = AsyncIOScheduler()

    # ── Core market jobs ──────────────────────────────────────────────────────
    scheduler.add_job(run_notifications,        "cron", day_of_week="mon-fri", hour="9,16",  minute=0,     timezone="America/New_York")
    scheduler.add_job(run_league_notifications, "interval", hours=2)
    scheduler.add_job(job_market_open,          "cron", day_of_week="mon-fri", hour=9,       minute=30,    timezone="America/New_York")
    scheduler.add_job(job_market_open_reminder, "cron", day_of_week="mon-fri", hour=11,      minute=30,    timezone="America/New_York")
    scheduler.add_job(job_market_close,         "cron", day_of_week="mon-fri", hour=16,      minute=0,     timezone="America/New_York")
    scheduler.add_job(job_daily_email,          "cron", day_of_week="mon-fri", hour=18,      minute=0,     timezone="America/New_York")
    scheduler.add_job(job_portfolio_alerts,     "cron", day_of_week="mon-fri", hour="9-15",  minute="0,30",timezone="America/New_York")
    scheduler.add_job(job_events_alerts,        "cron", day_of_week="mon-fri", hour=8,       minute=0,     timezone="America/New_York")
    scheduler.add_job(job_earnings_results,     "cron", day_of_week="mon-fri", hour=17,      minute=0,     timezone="America/New_York")

    # ── Weekly jobs ───────────────────────────────────────────────────────────
    scheduler.add_job(job_weekly_summary_push,  "cron", day_of_week="sat",     hour=9,       minute=30,    timezone="America/New_York")
    scheduler.add_job(job_social_proof_push,    "cron", day_of_week="sat",     hour=15,      minute=0,     timezone="America/New_York")
    scheduler.add_job(job_diversification_push, "cron", day_of_week="sat",     hour=11,      minute=0,     timezone="America/New_York")
    scheduler.add_job(job_risk_mgmt_push,       "cron", day_of_week="fri",     hour=15,      minute=0,     timezone="America/New_York")

    # ── M/W/F education push ──────────────────────────────────────────────────
    scheduler.add_job(job_education_push,       "cron", day_of_week="mon,wed,fri", hour=14,  minute=0,     timezone="America/New_York")

    # ── Daily re-engagement push ──────────────────────────────────────────────
    scheduler.add_job(job_reengagement_push,    "cron", hour=11,               minute=0,                   timezone="America/New_York")

    # ── Monthly jobs ──────────────────────────────────────────────────────────
    scheduler.add_job(job_monthly_report_push,  "cron", day=1,                 hour=9,       minute=0,     timezone="America/New_York")
    scheduler.add_job(send_monthly_reports,     "cron", day=1,                 hour=9,       minute=0,     timezone="America/New_York")

    # ── Opportunity Detection push ────────────────────────────────────────────
    scheduler.add_job(job_opportunity_push,        "cron", day_of_week="wed,fri", hour=13,   minute=0,     timezone="America/New_York")

    # ── Email jobs ────────────────────────────────────────────────────────────
    scheduler.add_job(send_enhanced_weekly_emails, "cron", day_of_week="sat",  hour=10,      minute=0,     timezone="America/New_York")
    scheduler.add_job(send_reengagement_emails,    "cron", day_of_week="sat",  hour=12,      minute=0,     timezone="America/New_York")
    scheduler.add_job(send_birthday_emails,        "cron",                     hour=8,       minute=0,     timezone="America/New_York")
    scheduler.add_job(send_educational_emails,     "cron",                     hour=9,       minute=0,     timezone="America/New_York")

    # ── Cleanup ───────────────────────────────────────────────────────────────
    scheduler.add_job(job_cleanup_analytics,    "interval", hours=1)

    scheduler.start()
    logger.info("Worker started — %d jobs scheduled", len(scheduler.get_jobs()))
    try:
        while True:
            await asyncio.sleep(60)
    except (KeyboardInterrupt, SystemExit):
        scheduler.shutdown()
        logger.info("Worker stopped")


if __name__ == "__main__":
    asyncio.run(main())
