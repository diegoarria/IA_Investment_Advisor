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
from datetime import datetime, timezone
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from app.core.config import settings
from app.services.notification_service import scan_and_notify_all_users
from app.services.email_service import generate_and_send_weekly_summary, generate_and_send_monthly_report
from app.services.paper_service import notify_rank_changes

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


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
            await generate_and_send_weekly_summary(
                user_id=u["user_id"],
                email=email,
                name=u["name"].split()[0],
                risk=u["risk_tolerance"],
                chat_snippets=snippets,
            )
            sent += 1
        logger.info("Weekly emails sent: %d", sent)
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
    """9:30 AM ET weekdays — push market open to all opted-in users."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push, get_market_summary_text
    import random
    db = get_supabase()
    try:
        market = await get_market_summary_text()
        sp500  = market.get("indices", {}).get("S&P 500", {})
        pct    = sp500.get("change_pct")
        if pct is not None:
            emoji = "📈" if pct >= 0 else "📉"
            body  = f"S&P 500 {emoji} {pct:+.1f}% ayer. La sesión comienza ahora."
        else:
            body = "Los mercados acaban de abrir. Revisa tus inversiones."
        users_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("push_market_open", True)
        )
        sent = 0
        for i, u in enumerate(users_res.data or []):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))
            await send_push(u["user_id"], "market_open", "Mercado Abierto", body, {"screen": "portfolio"}, db)
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
    """4:00 PM ET weekdays — push market close summary."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push, get_market_summary_text
    import random
    db = get_supabase()
    try:
        market = await get_market_summary_text()
        sp500  = market.get("indices", {}).get("S&P 500", {})
        pct    = sp500.get("change_pct")
        if pct is not None:
            emoji = "📈" if pct >= 0 else "📉"
            body  = f"Mercados cerraron. S&P 500 {emoji} {pct:+.1f}% hoy."
        else:
            body = "Los mercados cerraron. Revisa el resumen del día."
        users_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("push_market_close", True)
        )
        sent = 0
        for i, u in enumerate(users_res.data or []):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))
            await send_push(u["user_id"], "market_close", "Cierre del Mercado", body, {"screen": "portfolio"}, db)
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
    """9:30 AM ET Saturday — weekly summary push to opted-in users."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push, get_market_summary_text
    import random
    db = get_supabase()
    try:
        market = await get_market_summary_text()
        sp500  = market.get("indices", {}).get("S&P 500", {})
        pct    = sp500.get("change_pct")
        body   = f"S&P 500 {pct:+.1f}% esta semana. Tu resumen personalizado está listo." if pct else "Tu resumen semanal está listo."
        users_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("email_weekly_summary", True)
        )
        for i, u in enumerate(users_res.data or []):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))
            await send_push(u["user_id"], "weekly_summary", "Resumen Semanal", body, {"screen": "portfolio"}, db)
        logger.info("Weekly summary push: %d sent", len(users_res.data or []))
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
    from datetime import timezone as tz
    scheduler = AsyncIOScheduler()
    # Existing jobs
    scheduler.add_job(run_notifications, "cron", hour="9,16", minute="0", timezone="America/New_York")
    scheduler.add_job(run_league_notifications, "interval", hours=2)
    scheduler.add_job(send_weekly_emails, "cron", day_of_week="fri", hour=18, minute=30, timezone="America/New_York")
    scheduler.add_job(send_monthly_reports, "cron", day=1, hour=9, minute=0, timezone="America/New_York")
    # New notification engine jobs
    scheduler.add_job(job_market_open,          "cron", day_of_week="mon-fri", hour=9,       minute=30,    timezone="America/New_York")
    scheduler.add_job(job_market_open_reminder, "cron", day_of_week="mon-fri", hour=11,      minute=30,    timezone="America/New_York")
    scheduler.add_job(job_market_close,         "cron", day_of_week="mon-fri", hour=16,      minute=0,     timezone="America/New_York")
    scheduler.add_job(job_daily_email,          "cron", day_of_week="mon-fri", hour=18,      minute=0,     timezone="America/New_York")
    scheduler.add_job(job_portfolio_alerts,     "cron", day_of_week="mon-fri", hour="9-15",  minute="0,30",timezone="America/New_York")
    scheduler.add_job(job_weekly_summary_push,  "cron", day_of_week="sat",     hour=9,       minute=30,    timezone="America/New_York")
    scheduler.add_job(job_events_alerts,        "cron", day_of_week="mon-fri", hour=8,       minute=0,     timezone="America/New_York")
    scheduler.add_job(job_cleanup_analytics,    "interval", hours=1)
    scheduler.start()
    logger.info("Worker started — scheduler running")
    try:
        while True:
            await asyncio.sleep(60)
    except (KeyboardInterrupt, SystemExit):
        scheduler.shutdown()
        logger.info("Worker stopped")


if __name__ == "__main__":
    asyncio.run(main())
