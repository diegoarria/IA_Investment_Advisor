"""Official-launch email sequence — 2026-09-24, three sends (11:00 / 15:00 /
20:00 ET), every user. Promo: invite 1 friend, earn 14 free Premium days
(referral.py's REFERRAL_TIERS tier 1; the friend also gets WELCOME_BONUS_DAYS,
also 14). Each email carries the reader's own referral link.

Idempotent per (user, email): notification_log is checked before every send,
so a worker restart or a misfire re-run can never double-send.
"""
import asyncio
import logging
import random

from app.core.config import settings
from app.services.email_service import _nuvos_email_header

logger = logging.getLogger(__name__)

LAUNCH_CATEGORIES = {1: "launch_email_1", 2: "launch_email_2", 3: "launch_email_3"}

_COPY = {
    1: {
        "es": {
            "subject": "🚀 Nuvos ya es oficial: entra hoy",
            "tagline": "Lanzamiento oficial",
            "heading": "Hoy es el lanzamiento oficial de Nuvos",
            "body": "Nuvos te ayuda a tomar mejores decisiones con tu dinero: entiende tus inversiones, sigue las acciones que te interesan y aprende con Arthur, tu mentor, en lenguaje sencillo. Hoy abrimos oficialmente las puertas y queremos que estés aquí.",
            "features": [("📈", "Tu portafolio claro", "Ve cómo van tus inversiones en un solo lugar."),
                         ("👀", "Tu watchlist", "Sigue las acciones que te interesan y recibe avisos cuando se mueven."),
                         ("🧠", "Arthur, tu mentor", "Pregúntale lo que quieras y aprende sin jerga.")],
            "cta": "Entrar a Nuvos →",
        },
        "en": {
            "subject": "🚀 Nuvos is officially live: come in today",
            "tagline": "Official launch",
            "heading": "Today is Nuvos's official launch",
            "body": "Nuvos helps you make better decisions with your money: understand your investments, follow the stocks you care about, and learn with Arthur, your mentor, in plain language. Today we officially open our doors and we want you here.",
            "features": [("📈", "Your portfolio, clear", "See how your investments are doing in one place."),
                         ("👀", "Your watchlist", "Follow the stocks you care about and get alerts when they move."),
                         ("🧠", "Arthur, your mentor", "Ask anything and learn with no jargon.")],
            "cta": "Enter Nuvos →",
        },
    },
    2: {
        "es": {
            "subject": "¿Esa acción está cara o barata? Nuvos te ayuda a verlo",
            "tagline": "Un ejemplo de lo que hace Nuvos",
            "heading": "¿Está cara o barata esa acción?",
            "body": "Nuvos calcula un valor justo para cada empresa con tres escenarios (conservador, base y optimista) y lo compara con su precio actual. No te dice qué comprar: te da la información clara para que decidas tú, con más confianza.",
            "features": [],
            "cta": "Ver una acción en Nuvos →",
        },
        "en": {
            "subject": "Is that stock expensive or cheap? Nuvos helps you see it",
            "tagline": "One example of what Nuvos does",
            "heading": "Is that stock expensive or cheap?",
            "body": "Nuvos estimates a fair value for each company with three scenarios (conservative, base and optimistic) and compares it with today's price. It doesn't tell you what to buy: it gives you clear information so you can decide with more confidence.",
            "features": [],
            "cta": "See a stock in Nuvos →",
        },
    },
    3: {
        "es": {
            "subject": "Hoy fue el lanzamiento: tu lugar en Nuvos te espera",
            "tagline": "Gracias por ser parte",
            "heading": "Hoy fue un gran día para Nuvos",
            "body": "Gracias por estar aquí desde el inicio. Si todavía no entraste, tu cuenta te está esperando. Y si conoces a alguien que quiera entender mejor su dinero, este es el mejor momento para invitarlo.",
            "features": [],
            "cta": "Entrar a Nuvos →",
        },
        "en": {
            "subject": "Launch day is almost over: your spot in Nuvos is waiting",
            "tagline": "Thank you for being part of it",
            "heading": "Today was a big day for Nuvos",
            "body": "Thank you for being here from the start. If you haven't stepped in yet, your account is waiting. And if you know someone who wants to understand their money better, now is the best time to invite them.",
            "features": [],
            "cta": "Enter Nuvos →",
        },
    },
}

_BETA = {
    "es": ("¿Tienes iPhone?", "Prueba la app en beta →"),
    "en": ("Have an iPhone?", "Try the beta app →"),
}

_PROMO = {
    "es": {"title": "Invita a 1 amigo y gana 14 días de Premium gratis",
           "body": "Tu amigo también recibe 14 días de Premium al unirse con tu enlace.",
           "link_label": "Tu enlace personal:",
           "footer": "Recibes este correo porque tienes una cuenta en Nuvos. Nuvos es una herramienta educativa; no da recomendaciones de inversión."},
    "en": {"title": "Invite 1 friend and earn 14 days of Premium free",
           "body": "Your friend also gets 14 days of Premium when they join with your link.",
           "link_label": "Your personal link:",
           "footer": "You're receiving this because you have a Nuvos account. Nuvos is an educational tool; it doesn't give investment recommendations."},
}


def _lang(language: str | None) -> str:
    return "en" if language == "en" else "es"


def build_launch_email(n: int, name: str | None, language: str | None, referral_link: str) -> tuple[str, str]:
    """Returns (subject, html) for launch email `n` (1, 2 or 3)."""
    lang = _lang(language)
    c = _COPY[n][lang]
    p = _PROMO[lang]
    first = (name or "").split()[0] if name else ""
    greeting = (f"Hola {first}," if lang == "es" else f"Hi {first},") if first else ""
    rows = "".join(
        f'<tr><td style="padding:0 0 14px;font-size:22px;width:38px;vertical-align:top">{icon}</td>'
        f'<td style="padding:0 0 14px"><div style="color:#f4f5f7;font-size:14.5px;font-weight:800">{title}</div>'
        f'<div style="color:#9aa0ac;font-size:13px;line-height:1.5">{desc}</div></td></tr>'
        for icon, title, desc in c["features"]
    )
    features_html = (
        f'<div style="background:#111318;border:1px solid #2a2d3a;border-radius:16px;padding:20px 20px 6px;margin-bottom:22px">'
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0">{rows}</table></div>'
        if rows else ""
    )
    home = "https://nuvosai.com/home"
    beta_html = ""
    if settings.testflight_url:
        q, label = _BETA[lang]
        beta_html = (f'<p style="text-align:center;margin:14px 0 0;color:#9aa0ac;font-size:13px">{q} '
                     f'<a href="{settings.testflight_url}" style="color:#00d47e;font-weight:800;text-decoration:none">{label}</a></p>')
    return c["subject"], f"""<!DOCTYPE html>
<html lang="{lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">
  <div style="border-radius:20px;overflow:hidden;border:1px solid #2a2d3a">
    {_nuvos_email_header(c['tagline'])}
    <div style="background:#1a1d27;padding:36px 32px">
      <h1 style="color:#f4f5f7;font-size:25px;font-weight:900;margin:0 0 14px;letter-spacing:-0.4px;text-align:center">{c['heading']}</h1>
      <p style="color:#9aa0ac;font-size:14.5px;margin:0 0 24px;line-height:1.7;text-align:center">{(greeting + ' ') if greeting else ''}{c['body']}</p>
      {features_html}
      <a href="{home}" style="display:block;text-align:center;background:linear-gradient(135deg,#00a85e,#00d47e);color:#04140b;font-weight:900;font-size:15.5px;padding:15px 24px;border-radius:14px;text-decoration:none;box-shadow:0 8px 24px rgba(0,168,94,0.25)">{c['cta']}</a>
      {beta_html}
      <div style="background:#111318;border:1px solid rgba(0,212,126,0.35);border-radius:16px;padding:20px;margin-top:26px;text-align:center">
        <div style="font-size:26px;margin-bottom:6px">🎁</div>
        <div style="color:#f4f5f7;font-size:16px;font-weight:900;margin-bottom:6px">{p['title']}</div>
        <div style="color:#9aa0ac;font-size:13px;line-height:1.6;margin-bottom:12px">{p['body']}</div>
        <div style="color:#5b6270;font-size:11.5px;margin-bottom:4px">{p['link_label']}</div>
        <a href="{referral_link}" style="color:#00d47e;font-size:13.5px;font-weight:800;word-break:break-all;text-decoration:none">{referral_link}</a>
      </div>
      <div style="border-top:1px solid #2a2d3a;margin-top:26px;padding-top:18px;text-align:center">
        <p style="color:#5b6270;font-size:11px;margin:0;line-height:1.6">{p['footer']}</p>
      </div>
    </div>
  </div>
</div>
</body>
</html>"""


async def _fetch_all(make_query, page: int = 1000) -> list[dict]:
    """Pages through a PostgREST query (default cap is 1000 rows)."""
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


async def send_launch_email_job(n: int) -> None:
    """Sends launch email `n` to every user who hasn't opted out of email and
    hasn't already received this exact one."""
    if not settings.resend_api_key:
        logger.info("launch email %d: RESEND_API_KEY not set — skipping", n)
        return
    from app.core.database import get_supabase
    from app.services.notification_engine import send_email_notification
    from app.api.routes.referral import _ensure_code

    category = LAUNCH_CATEGORIES[n]
    db = get_supabase()
    try:
        prefs = await _fetch_all(lambda: db.table("notification_preferences").select("user_id,email_daily_summary").order("user_id"))
        disabled = {r["user_id"] for r in prefs if r.get("email_daily_summary") is False}
        sent_rows = await _fetch_all(
            lambda: db.table("notification_log").select("id,user_id").eq("category", category).eq("type", "email").eq("status", "sent").order("id")
        )
        already = {r["user_id"] for r in sent_rows}
        profiles = await _fetch_all(
            lambda: db.table("user_profiles").select("user_id,name,preferred_language,referral_code").order("user_id")
        )
        recipients = [r for r in profiles if r["user_id"] not in disabled and r["user_id"] not in already]
        sent = 0
        for i, prof in enumerate(recipients):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.1))
            uid = prof["user_id"]
            try:
                code = prof.get("referral_code") or await _ensure_code(uid)
                link = f"https://nuvosai.com/join?ref={code}" if code else "https://nuvosai.com/home"
                subject, html = build_launch_email(n, prof.get("name"), prof.get("preferred_language"), link)
                await send_email_notification(uid, category, subject, html, db)
                sent += 1
            except Exception as e:
                logger.warning("launch email %d failed for %s: %s", n, uid, e)
        logger.info("launch email %d: %d/%d users processed", n, sent, len(recipients))
    except Exception as e:
        logger.error("launch email %d job failed: %s", n, e)
