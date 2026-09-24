"""Friday upsell of the 1:1 guide call ("aprende a usar Nuvos") — push at
13:00 ET (via nudge_pushes.job_midday_nudge, replacing that Friday's nudge for
anyone who qualifies) and an email at 10:00 ET, same day (Diego, 2026-09-23).

Framing: a guide teaches you to get the most out of Nuvos. Never advice, never
"what to buy", no urgency tricks, and no price hard-coded in the email (Stripe
is the source of truth; the checkout shows the price, in MXN, before paying).

Who qualifies (per channel, so a push and an email are counted independently):
- account at least 7 days old;
- has never paid for a session (redeemed_1on1_checkouts) and holds no unused
  paid credit;
- not contacted on this channel in the last 13 days, and at most 3 times ever.
Users holding a free 1:1 credit (from referrals) get a different message that
points them at redeeming it, not at paying.

Where the link goes: the email opens the WEB app directly
(https://nuvosai.com/products?open=session -> session checkout; not signed in
-> login, then straight back). Users with a free credit go to /profile, where
the credit is redeemed. The mobile push opens the in-app Products sheet
(info only — no purchase CTA on mobile).
"""
import asyncio
import logging
import random
from datetime import datetime, timedelta, timezone

from app.core.config import settings

logger = logging.getLogger(__name__)

PUSH_CATEGORY = "upsell_session_friday"
EMAIL_CATEGORY = "upsell_session_email"
MIN_ACCOUNT_AGE_DAYS = 7
MIN_GAP_DAYS = 14
MAX_SENDS = 3

BUY_URL = "https://nuvosai.com/products?open=session"
REDEEM_URL = "https://nuvosai.com/profile"

_PUSH = {
    "es": {
        "buy": ("¿Quieres que te enseñemos a usar Nuvos? 🤝",
                "Una llamada 1:1 con un guía de nuestro equipo: te enseñamos a sacarle provecho a Nuvos según tus metas y tu ritmo. Sin jerga y sin recomendarte qué comprar."),
        "free": ("Tienes una sesión 1:1 gratis 🎁",
                 "Úsala para que un guía te enseñe a sacarle provecho a Nuvos según tus metas. Sin jerga y sin recomendarte qué comprar."),
    },
    "en": {
        "buy": ("Want us to show you how to use Nuvos? 🤝",
                "A 1:1 call with a guide from our team: we show you how to get the most out of Nuvos for your goals and your pace. No jargon, and no telling you what to buy."),
        "free": ("You have a free 1:1 session 🎁",
                 "Use it so a guide shows you how to get the most out of Nuvos for your goals. No jargon, and no telling you what to buy."),
    },
}

_EMAIL = {
    "es": {
        "buy": dict(
            subject="¿Quieres que te enseñemos a usar Nuvos? Una llamada 1:1",
            heading="Aprende a usar Nuvos con un guía",
            body="Este fin de semana puedes dejar tu cuenta lista. En una llamada 1:1 de 45 minutos, un guía de nuestro equipo te acompaña en vivo: te muestra cómo aprovechar Nuvos según tus metas y a tu ritmo.",
            points=["45 minutos en vivo con un guía", "Resolvemos tus dudas, sin jerga", "Ruta de aprendizaje personalizada según tus metas", "No te decimos qué comprar: Nuvos es una herramienta educativa"],
            cta="Reservar mi llamada →",
            note="Verás el precio en pesos mexicanos antes de pagar.",
            url=BUY_URL),
        "free": dict(
            subject="Tienes una sesión 1:1 gratis en Nuvos",
            heading="Tienes una sesión 1:1 gratis",
            body="Ganaste una sesión con un guía de nuestro equipo. Úsala para que te enseñe a sacarle provecho a Nuvos según tus metas y a tu ritmo.",
            points=["45 minutos en vivo con un guía", "Resolvemos tus dudas, sin jerga", "Ruta de aprendizaje personalizada según tus metas", "No te decimos qué comprar: Nuvos es una herramienta educativa"],
            cta="Usar mi sesión gratis →",
            note="No tiene costo: ya la ganaste.",
            url=REDEEM_URL),
        "footer": "Recibes este correo porque tienes una cuenta en Nuvos. Nuvos es una herramienta educativa; no da recomendaciones de inversión.",
        "tagline": "Llamadas 1:1",
    },
    "en": {
        "buy": dict(
            subject="Want us to show you how to use Nuvos? A 1:1 call",
            heading="Learn to use Nuvos with a guide",
            body="This weekend you can get your account ready. In a 45-minute 1:1 call, a guide from our team walks you through it live: how to get the most out of Nuvos for your goals and at your pace.",
            points=["45 minutes live with a guide", "We answer your questions, no jargon", "A learning path built around your goals", "We don't tell you what to buy: Nuvos is an educational tool"],
            cta="Book my call →",
            note="You'll see the price in Mexican pesos before you pay.",
            url=BUY_URL),
        "free": dict(
            subject="You have a free 1:1 session on Nuvos",
            heading="You have a free 1:1 session",
            body="You earned a session with a guide from our team. Use it to learn how to get the most out of Nuvos for your goals and at your pace.",
            points=["45 minutes live with a guide", "We answer your questions, no jargon", "A learning path built around your goals", "We don't tell you what to buy: Nuvos is an educational tool"],
            cta="Use my free session →",
            note="It's free: you already earned it.",
            url=REDEEM_URL),
        "footer": "You're receiving this because you have a Nuvos account. Nuvos is an educational tool; it doesn't give investment recommendations.",
        "tagline": "1:1 calls",
    },
}


def _lang(language: str | None) -> str:
    return "en" if language == "en" else "es"


def build_upsell_push(language: str | None, free_credit: bool) -> tuple[str, str, dict]:
    title, body = _PUSH[_lang(language)]["free" if free_credit else "buy"]
    # Mobile opens the in-app Products sheet (info only) for buyers; free-credit
    # holders go to Profile where the credit is redeemed.
    return title, body, {"screen": "profile"} if free_credit else {"screen": "products_session"}


def build_upsell_email(name: str | None, language: str | None, free_credit: bool) -> tuple[str, str]:
    from app.services.email_service import _nuvos_email_header
    lang = _lang(language)
    c = _EMAIL[lang]["free" if free_credit else "buy"]
    first = (name or "").split()[0] if name else ""
    greeting = (f"Hola {first}, " if lang == "es" else f"Hi {first}, ") if first else ""
    rows = "".join(
        f'<tr><td style="padding:0 0 10px;color:#00d47e;font-size:15px;width:24px;vertical-align:top">✓</td>'
        f'<td style="padding:0 0 10px;color:#f4f5f7;font-size:13.5px;line-height:1.5">{p}</td></tr>'
        for p in c["points"]
    )
    return c["subject"], f"""<!DOCTYPE html>
<html lang="{lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">
  <div style="border-radius:20px;overflow:hidden;border:1px solid #2a2d3a">
    {_nuvos_email_header(_EMAIL[lang]['tagline'])}
    <div style="background:#1a1d27;padding:36px 32px">
      <div style="font-size:44px;line-height:1;text-align:center;margin-bottom:12px">🤝</div>
      <h1 style="color:#f4f5f7;font-size:24px;font-weight:900;margin:0 0 14px;letter-spacing:-0.4px;text-align:center">{c['heading']}</h1>
      <p style="color:#9aa0ac;font-size:14.5px;margin:0 0 22px;line-height:1.7;text-align:center">{greeting}{c['body']}</p>
      <div style="background:#111318;border:1px solid #2a2d3a;border-radius:16px;padding:20px 20px 10px;margin-bottom:22px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">{rows}</table>
      </div>
      <a href="{c['url']}" style="display:block;text-align:center;background:linear-gradient(135deg,#00a85e,#00d47e);color:#04140b;font-weight:900;font-size:15.5px;padding:15px 24px;border-radius:14px;text-decoration:none;box-shadow:0 8px 24px rgba(0,168,94,0.25)">{c['cta']}</a>
      <p style="color:#9aa0ac;font-size:12px;margin:12px 0 0;text-align:center">{c['note']}</p>
      <div style="border-top:1px solid #2a2d3a;margin-top:26px;padding-top:18px;text-align:center">
        <p style="color:#5b6270;font-size:11px;margin:0;line-height:1.6">{_EMAIL[lang]['footer']}</p>
      </div>
    </div>
  </div>
</div>
</body>
</html>"""


# ─── Audience ────────────────────────────────────────────────────────────────

def is_eligible(profile: dict, buyers: set[str], history: dict[str, list[datetime]], now: datetime) -> bool:
    """Pure eligibility rule (see module docstring)."""
    uid = profile["user_id"]
    created = profile.get("created_at")
    try:
        created_dt = datetime.fromisoformat(str(created).replace("Z", "+00:00")) if created else None
    except ValueError:
        created_dt = None
    if created_dt is None or now - created_dt < timedelta(days=MIN_ACCOUNT_AGE_DAYS):
        return False
    if uid in buyers or int(profile.get("paid_1on1_sessions") or 0) > 0:
        return False
    sent = sorted(history.get(uid, []))
    if len(sent) >= MAX_SENDS:
        return False
    if sent and now - sent[-1] < timedelta(days=MIN_GAP_DAYS - 1):
        return False
    return True


async def _paged(make_query, page: int = 1000) -> list[dict]:
    from app.core.database import run_query
    rows: list[dict] = []
    start = 0
    while True:
        res = await run_query(make_query().range(start, start + page - 1))
        chunk = res.data or []
        rows.extend(chunk)
        if len(chunk) < page:
            return rows
        start += page


async def eligible_profiles(db, category: str) -> list[dict]:
    """Profiles (user_id, name, preferred_language, push_token, free_1on1_sessions)
    that qualify for an upsell on the channel identified by `category`."""
    now = datetime.now(timezone.utc)
    profiles = await _paged(lambda: db.table("user_profiles").select(
        "user_id,name,preferred_language,push_token,created_at,paid_1on1_sessions,free_1on1_sessions").order("user_id"))
    buyers = {r["user_id"] for r in await _paged(lambda: db.table("redeemed_1on1_checkouts").select("stripe_session_id,user_id").order("stripe_session_id"))}
    log = await _paged(lambda: db.table("notification_log").select("id,user_id,created_at").eq("category", category).eq("status", "sent").order("id"))
    history: dict[str, list[datetime]] = {}
    for r in log:
        try:
            history.setdefault(r["user_id"], []).append(datetime.fromisoformat(str(r["created_at"]).replace("Z", "+00:00")))
        except (KeyError, ValueError):
            continue
    return [p for p in profiles if is_eligible(p, buyers, history, now)]


# ─── Friday email job ────────────────────────────────────────────────────────

async def job_session_upsell_email() -> None:
    """Fridays 10:00 ET."""
    if not settings.resend_api_key:
        return
    from app.core.database import get_supabase
    from app.services.notification_engine import send_email_notification

    db = get_supabase()
    try:
        prefs = await _paged(lambda: db.table("notification_preferences").select("user_id,email_daily_summary").order("user_id"))
        disabled = {r["user_id"] for r in prefs if r.get("email_daily_summary") is False}
        recipients = [p for p in await eligible_profiles(db, EMAIL_CATEGORY) if p["user_id"] not in disabled]
        sent = 0
        for i, prof in enumerate(recipients):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.1))
            try:
                free_credit = int(prof.get("free_1on1_sessions") or 0) > 0
                subject, html = build_upsell_email(prof.get("name"), prof.get("preferred_language"), free_credit)
                await send_email_notification(prof["user_id"], EMAIL_CATEGORY, subject, html, db)
                sent += 1
            except Exception as e:
                logger.warning("session upsell email failed for %s: %s", prof["user_id"], e)
        logger.info("session upsell email: %d/%d users processed", sent, len(recipients))
    except Exception as e:
        logger.error("session upsell email job failed: %s", e)
