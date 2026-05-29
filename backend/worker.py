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
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from app.core.config import settings
from app.services.notification_service import scan_and_notify_all_users
from app.services.email_service import generate_and_send_weekly_summary

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def send_weekly_emails():
    """Personalized weekly summary — every Friday after market close."""
    if not settings.resend_api_key:
        logger.info("RESEND_API_KEY not set — skipping weekly emails")
        return
    from app.core.database import get_supabase
    db = get_supabase()
    try:
        users = db.table("user_profiles").select("user_id,name,risk_tolerance,subscription_tier").execute().data
        auth_users = {u["id"]: u["email"] for u in db.auth.admin.list_users()}
        sent = 0
        for u in users:
            email = auth_users.get(u["user_id"])
            if not email:
                continue
            is_premium = u.get("subscription_tier") == "premium"
            snippets = []
            if is_premium:
                chats = (
                    db.table("chat_history")
                    .select("content")
                    .eq("user_id", u["user_id"])
                    .eq("role", "user")
                    .order("created_at", desc=True)
                    .limit(10)
                    .execute()
                    .data
                )
                snippets = [c["content"][:150] for c in chats]
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


async def main():
    scheduler = AsyncIOScheduler()
    # Market alerts: 9am and 4pm Eastern (market open + close)
    scheduler.add_job(run_notifications, "cron", hour="9,16", minute="0", timezone="America/New_York")
    # Weekly recap: Friday 6:30pm Eastern (2h after NYSE close)
    scheduler.add_job(send_weekly_emails, "cron", day_of_week="fri", hour=18, minute=30, timezone="America/New_York")
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
