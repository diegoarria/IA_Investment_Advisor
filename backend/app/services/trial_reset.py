"""Official-launch trial reset — 2026-09-24 00:05 ET.

Diego, 2026-09-23: "a partir de mañana, todos los usuarios actuales vuelvan a
tener su prueba de 30 días premium". Same product decision as migration 038
(2026-07-16), but automated: every existing user who is NOT a paying/comp
premium subscriber gets trial_started_at = now, i.e. a fresh TRIAL_DAYS (30)
window starting at launch.

Idempotent per user: a notification_log row (type='grant',
category='trial_reset_2026_09_24') is written BEFORE the update and removed
again if the update fails, so a restart/misfire re-run never resets anyone's
clock a second time.
"""
import logging
from datetime import datetime, timezone

from app.services.launch_emails import _fetch_all

logger = logging.getLogger(__name__)

CATEGORY = "trial_reset_2026_09_24"
_PAID_TIERS = {"premium", "pro"}
_CHUNK = 200


async def reset_trials_for_launch() -> None:
    from app.core.database import get_supabase, run_query
    from app.core.cache import cache_delete

    db = get_supabase()
    try:
        profiles = await _fetch_all(lambda: db.table("user_profiles").select("user_id,subscription_tier").order("user_id"))
        done_rows = await _fetch_all(
            lambda: db.table("notification_log").select("id,user_id").eq("category", CATEGORY).eq("type", "grant").order("id"))
        done = {r["user_id"] for r in done_rows}
        eligible = [
            r["user_id"] for r in profiles
            if (r.get("subscription_tier") or "free") not in _PAID_TIERS and r["user_id"] not in done
        ]
        reset = 0
        for i in range(0, len(eligible), _CHUNK):
            chunk = eligible[i:i + _CHUNK]
            claimed = False
            try:
                await run_query(db.table("notification_log").insert(
                    [{"user_id": u, "type": "grant", "category": CATEGORY, "title": "launch trial reset",
                      "body": "", "data": {}, "status": "sent"} for u in chunk]))
                claimed = True
                now = datetime.now(timezone.utc).isoformat()
                await run_query(db.table("user_profiles").update({"trial_started_at": now}).in_("user_id", chunk))
            except Exception as e:
                logger.error("trial reset chunk %d failed: %s", i // _CHUNK, e)
                if claimed:
                    try:
                        await run_query(db.table("notification_log").delete().eq("category", CATEGORY).eq("type", "grant").in_("user_id", chunk))
                    except Exception:
                        pass
                continue
            for u in chunk:
                cache_delete(f"profile:{u}")
                cache_delete(f"sync:all:{u}")
            reset += len(chunk)
        logger.info("launch trial reset: %d/%d eligible users reset", reset, len(eligible))
    except Exception as e:
        logger.error("launch trial reset failed: %s", e)


# ─── Notification email ──────────────────────────────────────────────────────

EMAIL_CATEGORY = "trial_reset_email"

_EMAIL_COPY = {
    "es": {
        "subject": "🎉 Tu prueba Premium en Nuvos ha comenzado de nuevo",
        "tagline": "Lanzamiento oficial",
        "heading": "Tu prueba Premium empezó de nuevo",
        "body": "Para celebrar el lanzamiento oficial de Nuvos, reiniciamos tu prueba: tienes 30 días de Premium completos, gratis y sin poner tarjeta. Disfruta de Arthur, tus alertas inteligentes y el análisis profundo de tus acciones.",
        "cta": "Entrar a Nuvos →",
        "footer": "Recibes este correo porque tienes una cuenta en Nuvos. Nuvos es una herramienta educativa; no da recomendaciones de inversión.",
    },
    "en": {
        "subject": "🎉 Your Premium trial on Nuvos has started again",
        "tagline": "Official launch",
        "heading": "Your Premium trial started again",
        "body": "To celebrate Nuvos's official launch, we restarted your trial: you get a full 30 days of Premium, free and with no card needed. Enjoy Arthur, your smart alerts and deep analysis on your stocks.",
        "cta": "Enter Nuvos →",
        "footer": "You're receiving this because you have a Nuvos account. Nuvos is an educational tool; it doesn't give investment recommendations.",
    },
}


def build_trial_reset_email(name: str | None, language: str | None) -> tuple[str, str]:
    from app.services.email_service import _nuvos_email_header
    from app.services.launch_emails import _lang
    lang = _lang(language)
    c = _EMAIL_COPY[lang]
    first = (name or "").split()[0] if name else ""
    greeting = (f"Hola {first}, " if lang == "es" else f"Hi {first}, ") if first else ""
    return c["subject"], f"""<!DOCTYPE html>
<html lang="{lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">
  <div style="border-radius:20px;overflow:hidden;border:1px solid #2a2d3a">
    {_nuvos_email_header(c['tagline'])}
    <div style="background:#1a1d27;padding:36px 32px;text-align:center">
      <div style="font-size:48px;line-height:1;margin-bottom:14px">🎉</div>
      <h1 style="color:#f4f5f7;font-size:25px;font-weight:900;margin:0 0 14px;letter-spacing:-0.4px">{c['heading']}</h1>
      <p style="color:#9aa0ac;font-size:14.5px;margin:0 0 26px;line-height:1.7">{greeting}{c['body']}</p>
      <a href="https://nuvosai.com/home" style="display:block;background:linear-gradient(135deg,#00a85e,#00d47e);color:#04140b;font-weight:900;font-size:15.5px;padding:15px 24px;border-radius:14px;text-decoration:none;box-shadow:0 8px 24px rgba(0,168,94,0.25)">{c['cta']}</a>
      <div style="border-top:1px solid #2a2d3a;margin-top:26px;padding-top:18px">
        <p style="color:#5b6270;font-size:11px;margin:0;line-height:1.6">{c['footer']}</p>
      </div>
    </div>
  </div>
</div>
</body>
</html>"""


async def send_trial_reset_emails() -> None:
    """Emails exactly the users whose trial was actually reset (they have the
    reset marker), minus email opt-outs, once each. Runs at 10:00 ET so it
    lands in the morning rather than at the 00:05 reset itself."""
    import asyncio
    import random
    from app.core.config import settings
    if not settings.resend_api_key:
        return
    from app.core.database import get_supabase
    from app.services.notification_engine import send_email_notification

    db = get_supabase()
    try:
        marked = {r["user_id"] for r in await _fetch_all(
            lambda: db.table("notification_log").select("id,user_id").eq("category", CATEGORY).eq("type", "grant").order("id"))}
        already = {r["user_id"] for r in await _fetch_all(
            lambda: db.table("notification_log").select("id,user_id").eq("category", EMAIL_CATEGORY).eq("type", "email").eq("status", "sent").order("id"))}
        prefs = await _fetch_all(lambda: db.table("notification_preferences").select("user_id,email_daily_summary").order("user_id"))
        disabled = {r["user_id"] for r in prefs if r.get("email_daily_summary") is False}
        profiles = await _fetch_all(lambda: db.table("user_profiles").select("user_id,name,preferred_language").order("user_id"))
        recipients = [p for p in profiles if p["user_id"] in marked and p["user_id"] not in already and p["user_id"] not in disabled]
        sent = 0
        for i, prof in enumerate(recipients):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.1))
            try:
                subject, html = build_trial_reset_email(prof.get("name"), prof.get("preferred_language"))
                await send_email_notification(prof["user_id"], EMAIL_CATEGORY, subject, html, db)
                sent += 1
            except Exception as e:
                logger.warning("trial reset email failed for %s: %s", prof["user_id"], e)
        logger.info("trial reset email: %d/%d users processed", sent, len(recipients))
    except Exception as e:
        logger.error("trial reset email job failed: %s", e)
