"""
Notification Engine — fatigue control, dedup, quiet hours, push/email dispatch with logging.
Wraps existing push_service.send_push and email_service.send_email.
"""
import asyncio
import logging
import random
from datetime import datetime, timezone
from typing import Optional

from app.core.cache import acquire_lock

logger = logging.getLogger(__name__)


# ─── Preference helpers ───────────────────────────────────────────────────────

async def _get_prefs(user_id: str, db) -> dict:
    from app.core.cache import cache_get, cache_set
    from app.core.database import run_query
    ck = f"notif_prefs:{user_id}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    res = await run_query(db.table("notification_preferences").select("*").eq("user_id", user_id))
    prefs = res.data[0] if res.data else {
        "push_market_open": True, "push_market_close": True,
        "push_news_general": True, "push_portfolio_alerts": True,
        "push_watchlist_alerts": True, "push_ai_recommendations": True,
        "push_milestones": True, "push_volatility": True,
        "email_daily_summary": True, "email_weekly_summary": True,
        "max_push_per_day": 15, "max_push_per_week": 60,
        "quiet_hours_start": 22, "quiet_hours_end": 8,
        "consecutive_ignores": 0, "snooze_until": None,
    }
    cache_set(ck, prefs, ttl=300)
    return prefs


def _et_hour() -> int:
    import zoneinfo
    return datetime.now(zoneinfo.ZoneInfo("America/New_York")).hour


def _today_et() -> str:
    import zoneinfo
    return datetime.now(zoneinfo.ZoneInfo("America/New_York")).strftime("%Y-%m-%d")


# ─── Fatigue control ──────────────────────────────────────────────────────────

async def can_send_push(user_id: str, category: str, db) -> bool:
    from app.core.database import run_query

    prefs = await _get_prefs(user_id, db)

    # 1. Snooze check
    snooze = prefs.get("snooze_until")
    if snooze:
        try:
            snooze_dt = datetime.fromisoformat(snooze.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) < snooze_dt:
                return False
        except Exception:
            pass

    # 2. Quiet hours (ET)
    hour = _et_hour()
    qs = prefs.get("quiet_hours_start", 22)
    qe = prefs.get("quiet_hours_end", 8)
    if qs > qe:  # spans midnight
        if hour >= qs or hour < qe:
            return False
    else:
        if qs <= hour < qe:
            return False

    today = _today_et()

    # 3. Dedup: same category + same user + same day.
    #
    # Previously this was a plain SELECT-then-later-INSERT: the actual log
    # row was only written AFTER the push send completed (see send_push
    # below), so two overlapping calls for the same user/category/day (e.g.
    # a cron tick that runs long enough to overlap the next scheduled tick)
    # could both pass this SELECT before either had logged anything, and the
    # user got the same push twice. Reserving the slot atomically via a
    # distributed lock (Redis SET NX when configured — see app/core/cache.py)
    # BEFORE sending closes that race: only the first caller to reserve
    # "user:category:day" ever proceeds; every other concurrent or later
    # caller that day sees the slot already taken and skips, with no window
    # where both could have passed the check.
    dedup_key = f"pushdedup:{user_id}:{category}:{today}"
    if acquire_lock(dedup_key, ttl=26 * 3600) is None:
        return False

    return True


# ─── Push dispatch ────────────────────────────────────────────────────────────

async def send_push(user_id: str, category: str, title: str, body: str, data: dict, db, sound: str = "default"):
    from app.core.database import run_query
    from app.services.push_service import send_push as _expo_push
    from app.services.web_push_service import send_web_push_to_user

    if not await can_send_push(user_id, category, db):
        await _log_notification(db, user_id, "push", category, title, body, data, "skipped")
        return

    today = _today_et()
    dedup_key = f"{user_id}:{category}:{today}"
    status, error_text = "sent", None
    sent_any = False

    # 1. Web push (browser — primary channel for web users)
    try:
        web_sent = await send_web_push_to_user(user_id, title, body, {**data, "category": category})
        if web_sent > 0:
            sent_any = True
    except Exception as e:
        logger.warning("Web push failed for %s: %s", user_id, e)

    # 2. Expo push (mobile fallback — only if user has a mobile token)
    tok_res = await run_query(db.table("user_profiles").select("push_token").eq("user_id", user_id))
    token = (tok_res.data[0].get("push_token") or "") if tok_res.data else ""
    if token and token.startswith("ExponentPushToken"):
        try:
            await _expo_push(token, title=title, body=body, data={**data, "category": category}, sound=sound)
            sent_any = True
        except Exception as e:
            logger.warning("Expo push failed for %s: %s", user_id, e)

    if not sent_any:
        status = "no_token"
        logger.info("No push channel for user %s (category=%s)", user_id, category)

    log_id = await _log_notification(db, user_id, "push", category, title, body, data,
                                     status, dedup_key=dedup_key, error_text=error_text)
    await _track_analytics(db, "sent", category, user_id, log_id)


# ─── Email dispatch ───────────────────────────────────────────────────────────

async def send_email_notification(user_id: str, category: str, subject: str, html: str, db):
    from app.services.email_service import send_email

    try:
        users = await asyncio.to_thread(lambda: db.auth.admin.list_users())
        email = next((u.email for u in users if u.id == user_id), None)
    except Exception:
        email = None
    if not email:
        return

    status, error_text = "sent", None
    try:
        ok = await send_email(email, subject, html)
        if not ok:
            status = "failed"
    except Exception as e:
        status, error_text = "failed", str(e)

    log_id = await _log_notification(db, user_id, "email", category, subject, "", {}, status, error_text=error_text)
    await _track_analytics(db, "sent", category, user_id, log_id)


# ─── Logging helpers ──────────────────────────────────────────────────────────

async def _log_notification(db, user_id: str, type_: str, category: str,
                             title: str, body: str, data: dict, status: str,
                             dedup_key: Optional[str] = None,
                             error_text: Optional[str] = None) -> Optional[str]:
    from app.core.database import run_query
    record = {"user_id": user_id, "type": type_, "category": category,
              "title": title, "body": body, "data": data, "status": status}
    if dedup_key:
        record["dedup_key"] = dedup_key
    if error_text:
        record["error_text"] = error_text
    try:
        await run_query(db.table("notification_log").insert(record))
        return None
    except Exception as e:
        logger.warning("Failed to log notification: %s", e)
        return None


async def _track_analytics(db, event_type: str, category: str, user_id: str,
                            notification_id: Optional[str] = None):
    from app.core.database import run_query
    try:
        tier_res = await run_query(
            db.table("user_profiles").select("subscription_tier").eq("user_id", user_id)
        )
        tier = tier_res.data[0].get("subscription_tier", "free") if tier_res.data else "free"
    except Exception:
        tier = "unknown"
    try:
        await run_query(db.table("notification_analytics").insert({
            "event_type": event_type, "category": category,
            "user_id": user_id, "user_tier": tier, "notification_id": notification_id,
        }))
    except Exception as e:
        logger.warning("Failed to track analytics: %s", e)


# ─── Track open/click (called by frontend) ───────────────────────────────────

async def track_event(notification_id: str, event_type: str, db):
    from app.core.database import run_query
    from app.core.cache import cache_delete
    now = datetime.now(timezone.utc).isoformat()
    update = {}
    if event_type == "opened":
        update["opened_at"] = now
    elif event_type == "clicked":
        update["clicked_at"] = now
    if not update:
        return
    try:
        await run_query(db.table("notification_log").update(update).eq("id", notification_id))
        if event_type == "opened":
            log_res = await run_query(
                db.table("notification_log").select("user_id").eq("id", notification_id)
            )
            if log_res.data:
                uid = log_res.data[0]["user_id"]
                await run_query(
                    db.table("notification_preferences")
                    .update({"consecutive_ignores": 0, "last_opened_app": now})
                    .eq("user_id", uid)
                )
                cache_delete(f"notif_prefs:{uid}")
    except Exception as e:
        logger.warning("Failed to track event %s: %s", event_type, e)


# ─── Market data helpers ──────────────────────────────────────────────────────

async def get_market_summary_text() -> dict:
    def _fetch():
        try:
            from app.core.finnhub import fh_quote
            INDEX_MAP = {
                "S&P 500":           "SPY",
                "NASDAQ":            "QQQ",
                "Dow Jones":         "DIA",
                "México (IPC)":      "EWW",
                "Europa (STOXX 50)": "FEZ",
                "Japón (Nikkei)":    "EWJ",
                "China (CSI 300)":   "MCHI",
            }
            results = {}
            for name, sym in INDEX_MAP.items():
                try:
                    q = fh_quote(sym)
                    if q and q.get("price"):
                        results[name] = {
                            "price":      q["price"],
                            "change_pct": q["change_pct"],
                        }
                except Exception:
                    pass  # silently skip

            SECTOR_MAP = {
                "Tecnología": "XLK",
                "Salud":      "XLV",
                "Finanzas":   "XLF",
                "Energía":    "XLE",
                "Consumo":    "XLY",
            }
            sector_perf = {}
            for sname, sym in SECTOR_MAP.items():
                try:
                    q = fh_quote(sym)
                    if q and q.get("price"):
                        sector_perf[sname] = q["change_pct"]
                except Exception:
                    pass

            # Default to "—" (not None) so templates never render the word "None"
            best  = max(sector_perf, key=sector_perf.get) if sector_perf else "—"
            worst = min(sector_perf, key=sector_perf.get) if sector_perf else "—"
            return {"indices": results, "sectors": sector_perf, "best_sector": best, "worst_sector": worst}
        except Exception as e:
            logger.warning("Market summary fetch failed: %s", e)
            return {"indices": {}, "sectors": {}, "best_sector": "—", "worst_sector": "—"}

    return await asyncio.to_thread(_fetch)


async def check_portfolio_alerts(user_id: str, positions: list, db) -> list[dict]:
    tickers = []
    for p in positions:
        t = p.get("ticker") if isinstance(p, dict) else str(p)
        if t:
            tickers.append(t)
    if not tickers:
        return []

    def _fetch():
        from app.core.finnhub import fh_quote
        alerts = []
        for ticker in tickers[:10]:
            try:
                q = fh_quote(ticker)
                if not q or not q.get("price"):
                    continue
                pct = q["change_pct"]
                if abs(pct) >= 3.5:
                    alerts.append({
                        "ticker":     ticker,
                        "change_pct": pct,
                        "price":      q["price"],
                        "level":      "extreme" if abs(pct) >= 8.0 else "significant",
                    })
            except Exception:
                pass
        return alerts

    return await asyncio.to_thread(_fetch)


async def check_watchlist_alerts(user_id: str, tickers: list, db) -> list[dict]:
    return await check_portfolio_alerts(user_id, [{"ticker": t} for t in tickers], db)
