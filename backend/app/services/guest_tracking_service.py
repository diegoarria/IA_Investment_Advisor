"""Anonymous visitor ("invitado") tracking — Diego, 2026-09-27: see who uses
the web app without an account and what they ask Arthur.

Only what can legitimately be known without an account: an anonymous
per-browser id, approximate location (from Vercel's edge geo headers — the
IP itself is never stored), device/browser/OS, referrer + UTM, pages and
Arthur questions. No name/email/phone, no fingerprinting.

Every write here is best-effort: tracking must never be the reason a page
or a guest chat message fails."""
import logging
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import unquote

from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)

_MAX = 300  # cap for any free-text field coming from the browser


def _clip(value, n: int = _MAX) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s[:n] or None


def parse_user_agent(ua: str | None) -> dict:
    """Tiny, dependency-free UA parse — good enough for "celular / Chrome / iOS"."""
    ua = ua or ""
    low = ua.lower()
    if re.search(r"bot|crawl|spider|slurp|preview|headless", low):
        device = "bot"
    elif "ipad" in low or ("tablet" in low) or ("android" in low and "mobile" not in low):
        device = "tablet"
    elif "mobi" in low or "iphone" in low or "android" in low:
        device = "celular"
    else:
        device = "computadora" if ua else None

    if "edg/" in low:
        browser = "Edge"
    elif "opr/" in low or "opera" in low:
        browser = "Opera"
    elif "samsungbrowser" in low:
        browser = "Samsung Internet"
    elif "fban" in low or "fbav" in low:
        browser = "Facebook"
    elif "instagram" in low:
        browser = "Instagram"
    elif "crios" in low or ("chrome" in low and "chromium" not in low):
        browser = "Chrome"
    elif "fxios" in low or "firefox" in low:
        browser = "Firefox"
    elif "safari" in low:
        browser = "Safari"
    else:
        browser = None

    if "iphone" in low or "ipad" in low or "ios" in low:
        os_name = "iOS"
    elif "android" in low:
        os_name = "Android"
    elif "windows" in low:
        os_name = "Windows"
    elif "mac os" in low or "macintosh" in low:
        os_name = "macOS"
    elif "linux" in low:
        os_name = "Linux"
    else:
        os_name = None
    return {"device": device, "browser": browser, "os": os_name}


def geo_from_headers(headers) -> dict:
    """Vercel adds x-vercel-ip-* on the edge; our Next.js /api/guest/track
    route forwards them as x-nuvos-geo-*. City arrives URL-encoded."""
    def h(name):
        v = headers.get(name)
        return _clip(unquote(v), 80) if v else None
    return {"country": h("x-nuvos-geo-country"), "region": h("x-nuvos-geo-region"), "city": h("x-nuvos-geo-city")}


async def track_visit(guest_id: str, path: str | None, referrer: str | None, utm: dict,
                      user_agent: str | None, geo: dict) -> None:
    guest_id = _clip(guest_id, 80)
    if not guest_id:
        return
    ua = parse_user_agent(user_agent)
    if ua["device"] == "bot":
        return
    try:
        db = get_supabase()
        await run_query(db.rpc("track_guest_visit", {
            "p_guest_id": guest_id, "p_path": _clip(path, 200),
            "p_country": geo.get("country"), "p_region": geo.get("region"), "p_city": geo.get("city"),
            "p_device": ua["device"], "p_browser": ua["browser"], "p_os": ua["os"],
            "p_referrer": _clip(referrer),
            "p_utm_source": _clip(utm.get("utm_source"), 100),
            "p_utm_medium": _clip(utm.get("utm_medium"), 100),
            "p_utm_campaign": _clip(utm.get("utm_campaign"), 100),
        }))
    except Exception as e:
        logger.warning("track_guest_visit failed: %s", e)


async def record_chat(guest_id: str, message: str | None, hit_limit: bool = False) -> None:
    guest_id = _clip(guest_id, 80)
    if not guest_id:
        return
    try:
        db = get_supabase()
        await run_query(db.rpc("record_guest_chat", {
            "p_guest_id": guest_id, "p_message": (message or "")[:2000], "p_hit_limit": hit_limit,
        }))
    except Exception as e:
        logger.warning("record_guest_chat failed: %s", e)


def _source_label(r: dict) -> str:
    if r.get("utm_source"):
        return r["utm_source"] + (f" / {r['utm_campaign']}" if r.get("utm_campaign") else "")
    ref = r.get("referrer") or ""
    m = re.match(r"https?://(?:www\.)?([^/]+)", ref)
    if m:
        host = m.group(1)
        if "nuvosai" in host:
            return "Directo"
        return host
    return "Directo"


async def get_guests_overview(days: int = 7, limit: int = 100) -> dict:
    from app.services.business_overview_service import _day_start_utc
    from app.services.launch_emails import _fetch_all
    db = get_supabase()
    today_start = _day_start_utc()
    since = datetime.now(timezone.utc) - timedelta(days=days)

    visitors = await _fetch_all(lambda: db.table("guest_visitors").select("*")
                                .gte("last_seen", since.isoformat()).order("guest_id"))
    visitors.sort(key=lambda r: r.get("last_seen") or "", reverse=True)

    msgs = await _fetch_all(lambda: db.table("guest_chat_messages").select("id,guest_id,message,created_at")
                            .gte("created_at", since.isoformat()).order("id"))
    by_guest: dict[str, list[dict]] = {}
    for m in msgs:
        by_guest.setdefault(m["guest_id"], []).append({"message": m["message"], "created_at": m["created_at"]})

    def _dt(s):
        try:
            return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        except Exception:
            return None

    today = [v for v in visitors if (_dt(v.get("last_seen")) or since) >= today_start]
    msgs_today = [m for m in msgs if (_dt(m.get("created_at")) or since) >= today_start]

    rows = []
    for v in visitors[:limit]:
        q = sorted(by_guest.get(v["guest_id"], []), key=lambda m: m["created_at"], reverse=True)
        rows.append({
            "guest_id": v["guest_id"],
            "first_seen": v.get("first_seen"),
            "last_seen": v.get("last_seen"),
            "location": ", ".join(x for x in (v.get("city"), v.get("region"), v.get("country")) if x) or None,
            "device": " · ".join(x for x in (v.get("device"), v.get("browser"), v.get("os")) if x) or None,
            "source": _source_label(v),
            "landing_path": v.get("landing_path"),
            "last_path": v.get("last_path"),
            "pageviews": v.get("pageviews") or 0,
            "chat_messages": v.get("chat_messages") or 0,
            "hit_chat_limit": bool(v.get("hit_chat_limit")),
            "questions": q[:20],
        })

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "days": days,
        "today": {
            "visitors": len(today),
            "chatted": len({m["guest_id"] for m in msgs_today}),
            "messages": len(msgs_today),
        },
        "period": {
            "visitors": len(visitors),
            "chatted": sum(1 for v in visitors if (v.get("chat_messages") or 0) > 0),
            "messages": len(msgs),
            "hit_limit": sum(1 for v in visitors if v.get("hit_chat_limit")),
        },
        "guests": rows,
    }
