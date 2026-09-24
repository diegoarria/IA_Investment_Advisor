"""Offers + "share Nuvos on WhatsApp" email — one-time, 2026-09-24 12:00 ET
(10:00 AM Monterrey). Every user who hasn't opted out of email.

What it carries (only offers that really exist in the product):
- the restarted 30-day Premium trial (no card);
- the two automatic launch promos (3 watchlist stocks / first investment
  loaded -> +7 Premium days each, until Oct 3);
- the referral ladder (1 friend -> 14 days, 2 -> 14 + a 1:1 session, 3 -> 30 +
  another session; the friend also gets 14 days);
- a ready-to-send WhatsApp message summarising Nuvos with the reader's own
  referral link. Emails can't run JavaScript, so "interactive" means: every
  line of the summary is a tappable link into the app, and the WhatsApp button
  is a wa.me deep link that opens WhatsApp with the message pre-filled (the
  user picks the contact).

Idempotent per user via notification_log (category below).
"""
import asyncio
import html as _html
import logging
import random
from urllib.parse import quote

from app.core.config import settings
from app.services.email_service import _nuvos_email_header
from app.services.launch_emails import _fetch_all, _lang

logger = logging.getLogger(__name__)

CATEGORY = "offers_share_email"
SITE = "https://nuvosai.com"

# The message the reader forwards. Plain text (WhatsApp), the friend's view.
_SHARE_MESSAGE = {
    "es": (
        "¡Hola! 👋 Quiero compartirte Nuvos, es una plataforma de IA que te ayuda a entender tus inversiones y tomar mejores decisiones con tu capital.\n\n"
        "Todos empezamos a ganar dinero, ahorrar y construir patrimonio, pero pocas veces nos enseñan algo tan importante:\n\n"
        "¿Qué hacer con nuestro dinero?\n\n"
        "Tienes $20,000, $50,000 o $100,000 ahorrados y te preguntas:\n"
        "¿Lo dejo en el banco?\n"
        "¿Lo invierto?\n"
        "¿En qué?\n"
        "¿Qué riesgos hay?\n\n"
        "Para eso existe Nuvos.\n\n"
        "🧠 Puedes hablar con Arthur, el mentor de IA, sobre tu situación y tus objetivos.\n"
        "📊 También puedes analizar inversiones, empresas, valuaciones y tu portafolio.\n"
        "⚠️ Y entender los riesgos y distintos escenarios antes de decidir.\n\n"
        "Nuvos no te dice qué hacer con tu dinero. Te ayuda a decidir mejor.\n\n"
        "🎁 Te dejo 14 días de Premium gratis:\n\n"
        "👉 {link}\n\n"
        "Pruébalo y dime qué opinas.\n\n"
        "Nuvos es una herramienta educativa y de análisis; no proporciona recomendaciones personalizadas de inversión."
    ),
    "en": (
        "Hi! 👋 I want to share Nuvos with you. It's an AI platform that helps you understand your investments and make better decisions with your capital.\n\n"
        "We all start earning money, saving and building wealth, but we're rarely taught something so important:\n\n"
        "What should we do with our money?\n\n"
        "You have $20,000, $50,000 or $100,000 saved and you wonder:\n"
        "Do I leave it in the bank?\n"
        "Do I invest it?\n"
        "In what?\n"
        "What are the risks?\n\n"
        "That's what Nuvos is for.\n\n"
        "🧠 You can talk to Arthur, the AI mentor, about your situation and your goals.\n"
        "📊 You can also analyze investments, companies, valuations and your portfolio.\n"
        "⚠️ And understand the risks and different scenarios before you decide.\n\n"
        "Nuvos doesn't tell you what to do with your money. It helps you decide better.\n\n"
        "🎁 I'm giving you 14 days of Premium free:\n\n"
        "👉 {link}\n\n"
        "Try it and tell me what you think.\n\n"
        "Nuvos is an educational and analysis tool; it doesn't provide personalized investment recommendations."
    ),
}

_COPY = {
    "es": {
        "subject": "🎁 Ofertas para empezar en Nuvos y un mensaje listo para WhatsApp",
        "tagline": "Ofertas y referidos",
        "heading": "Empieza con Nuvos y compártelo",
        "intro": "Estas son las ofertas que tienes hoy para sacarle provecho a Nuvos, y un mensaje listo para mandar por WhatsApp a quien quieras.",
        "offers_title": "Tus ofertas",
        "offers": [
            ("🎉", "30 días de Premium gratis", "Tu prueba empezó de nuevo con el lanzamiento. Sin tarjeta.", f"{SITE}/home"),
            ("👀", "3 acciones en tu watchlist = 7 días más", "Se activa solo, sin código. Hasta el 3 de octubre.", f"{SITE}/watchlist"),
            ("💼", "Tu primera inversión cargada = 7 días más", "Se activa solo, sin código. Hasta el 3 de octubre.", f"{SITE}/portfolio"),
            ("🤝", "Invita amigos y gana Premium", "1 amigo: 14 días. 2 amigos: 14 días más + 1 sesión 1 a 1. 3 amigos: 30 días más + otra sesión. Tu amigo también recibe 14 días.", f"{SITE}/profile"),
        ],
        "what_title": "Qué es Nuvos, en 4 toques",
        "what": [
            ("📈", "Tu portafolio claro", "Tus inversiones en un solo lugar.", f"{SITE}/portfolio"),
            ("👀", "Tu watchlist", "Avisos cuando lo que sigues se mueve.", f"{SITE}/watchlist"),
            ("🧠", "Arthur, tu mentor", "Te explica todo sin jerga.", f"{SITE}/chat"),
            ("💡", "Valor justo", "Cada acción en 3 escenarios.", f"{SITE}/subvaluadas"),
        ],
        "share_title": "Compártelo por WhatsApp",
        "share_intro": "Este es el mensaje. Toca el botón, elige a quién enviárselo y listo:",
        "share_cta": "Enviar por WhatsApp",
        "link_label": "Tu enlace para referir amigos:",
        "refer_cta": "Ver mis referidos →",
        "footer": "Recibes este correo porque tienes una cuenta en Nuvos. Nuvos es una herramienta educativa; no da recomendaciones de inversión.",
    },
    "en": {
        "subject": "🎁 Offers to get started on Nuvos and a ready-to-send WhatsApp message",
        "tagline": "Offers and referrals",
        "heading": "Get started with Nuvos and share it",
        "intro": "These are the offers you have today to get the most out of Nuvos, plus a ready-to-send WhatsApp message for whoever you want.",
        "offers_title": "Your offers",
        "offers": [
            ("🎉", "30 days of Premium, free", "Your trial started again with the launch. No card needed.", f"{SITE}/home"),
            ("👀", "3 stocks in your watchlist = 7 more days", "Activates automatically, no code. Until October 3.", f"{SITE}/watchlist"),
            ("💼", "Load your first investment = 7 more days", "Activates automatically, no code. Until October 3.", f"{SITE}/portfolio"),
            ("🤝", "Invite friends and earn Premium", "1 friend: 14 days. 2 friends: 14 more days + a 1:1 session. 3 friends: 30 more days + another session. Your friend also gets 14 days.", f"{SITE}/profile"),
        ],
        "what_title": "What Nuvos is, in 4 taps",
        "what": [
            ("📈", "Your portfolio, clear", "Your investments in one place.", f"{SITE}/portfolio"),
            ("👀", "Your watchlist", "Alerts when what you follow moves.", f"{SITE}/watchlist"),
            ("🧠", "Arthur, your mentor", "Explains everything with no jargon.", f"{SITE}/chat"),
            ("💡", "Fair value", "Every stock in 3 scenarios.", f"{SITE}/subvaluadas"),
        ],
        "share_title": "Share it on WhatsApp",
        "share_intro": "This is the message. Tap the button, pick who to send it to, done:",
        "share_cta": "Send on WhatsApp",
        "link_label": "Your link to refer friends:",
        "refer_cta": "See my referrals →",
        "footer": "You're receiving this because you have a Nuvos account. Nuvos is an educational tool; it doesn't give investment recommendations.",
    },
}


def whatsapp_url(language: str | None, referral_link: str) -> str:
    """wa.me deep link that opens WhatsApp with the message pre-filled."""
    text = _SHARE_MESSAGE[_lang(language)].format(link=referral_link)
    return "https://wa.me/?text=" + quote(text, safe="")


def build_offers_share_email(name: str | None, language: str | None, referral_link: str) -> tuple[str, str]:
    lang = _lang(language)
    c = _COPY[lang]
    first = (name or "").split()[0] if name else ""
    greeting = (f"Hola {first}, " if lang == "es" else f"Hi {first}, ") if first else ""
    wa = whatsapp_url(lang, referral_link)
    esc = _html.escape

    def row(icon, title, desc, url):
        return (
            f'<tr><td style="padding:0 0 10px"><a href="{url}" style="display:block;text-decoration:none;background:#111318;'
            f'border:1px solid #2a2d3a;border-radius:14px;padding:14px 16px">'
            f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>'
            f'<td style="width:36px;font-size:22px;vertical-align:top">{icon}</td>'
            f'<td><div style="color:#f4f5f7;font-size:14.5px;font-weight:800;line-height:1.3">{title}</div>'
            f'<div style="color:#9aa0ac;font-size:12.5px;line-height:1.5;margin-top:2px">{desc}</div></td>'
            f'<td style="width:16px;color:#00d47e;font-size:18px;vertical-align:middle;text-align:right">›</td>'
            f'</tr></table></a></td></tr>'
        )

    offers = "".join(row(*o) for o in c["offers"])
    what = "".join(row(*w) for w in c["what"])
    bubble = esc(_SHARE_MESSAGE[lang].format(link=referral_link)).replace("\n", "<br>")
    html = f"""<!DOCTYPE html>
<html lang="{lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">
  <div style="border-radius:20px;overflow:hidden;border:1px solid #2a2d3a">
    {_nuvos_email_header(c['tagline'])}
    <div style="background:#1a1d27;padding:32px 24px">
      <h1 style="color:#f4f5f7;font-size:24px;font-weight:900;margin:0 0 12px;letter-spacing:-0.4px;text-align:center">{c['heading']}</h1>
      <p style="color:#9aa0ac;font-size:14.5px;margin:0 0 24px;line-height:1.7;text-align:center">{greeting}{c['intro']}</p>

      <h2 style="color:#f4f5f7;font-size:15px;font-weight:900;margin:0 0 10px">{c['offers_title']}</h2>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">{offers}</table>

      <h2 style="color:#f4f5f7;font-size:15px;font-weight:900;margin:22px 0 10px">{c['share_title']}</h2>
      <p style="color:#9aa0ac;font-size:13px;margin:0 0 10px;line-height:1.6">{c['share_intro']}</p>
      <div style="background:#0f2a1c;border:1px solid rgba(37,211,102,0.35);border-radius:16px;padding:16px 16px;color:#e6f7ee;font-size:13px;line-height:1.6;margin-bottom:14px">{bubble}</div>
      <a href="{wa}" style="display:block;text-align:center;background:#25D366;color:#04140b;font-weight:900;font-size:15.5px;padding:15px 24px;border-radius:14px;text-decoration:none">💬 {c['share_cta']}</a>

      <div style="background:#111318;border:1px solid #2a2d3a;border-radius:16px;padding:16px;margin-top:16px;text-align:center">
        <div style="color:#5b6270;font-size:11.5px;margin-bottom:4px">{c['link_label']}</div>
        <a href="{referral_link}" style="color:#00d47e;font-size:13.5px;font-weight:800;word-break:break-all;text-decoration:none">{referral_link}</a>
        <div style="margin-top:12px"><a href="{SITE}/profile" style="color:#00d47e;font-size:13px;font-weight:800;text-decoration:none">{c['refer_cta']}</a></div>
      </div>

      <h2 style="color:#f4f5f7;font-size:15px;font-weight:900;margin:24px 0 10px">{c['what_title']}</h2>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">{what}</table>

      <div style="border-top:1px solid #2a2d3a;margin-top:20px;padding-top:18px;text-align:center">
        <p style="color:#5b6270;font-size:11px;margin:0;line-height:1.6">{c['footer']}</p>
      </div>
    </div>
  </div>
</div>
</body>
</html>"""
    return c["subject"], html


async def send_offers_share_email_job() -> None:
    if not settings.resend_api_key:
        logger.info("offers share email: RESEND_API_KEY not set — skipping")
        return
    from app.core.database import get_supabase
    from app.services.notification_engine import send_email_notification
    from app.api.routes.referral import _ensure_code

    db = get_supabase()
    try:
        prefs = await _fetch_all(lambda: db.table("notification_preferences").select("user_id,email_daily_summary").order("user_id"))
        disabled = {r["user_id"] for r in prefs if r.get("email_daily_summary") is False}
        sent_rows = await _fetch_all(
            lambda: db.table("notification_log").select("id,user_id").eq("category", CATEGORY).eq("type", "email").eq("status", "sent").order("id"))
        already = {r["user_id"] for r in sent_rows}
        profiles = await _fetch_all(lambda: db.table("user_profiles").select("user_id,name,preferred_language,referral_code").order("user_id"))
        recipients = [p for p in profiles if p["user_id"] not in disabled and p["user_id"] not in already]
        sent = 0
        for i, prof in enumerate(recipients):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.1))
            uid = prof["user_id"]
            try:
                code = prof.get("referral_code") or await _ensure_code(uid)
                link = f"{SITE}/join?ref={code}" if code else f"{SITE}/home"
                subject, html = build_offers_share_email(prof.get("name"), prof.get("preferred_language"), link)
                await send_email_notification(uid, CATEGORY, subject, html, db)
                sent += 1
            except Exception as e:
                logger.warning("offers share email failed for %s: %s", uid, e)
        logger.info("offers share email: %d/%d users processed", sent, len(recipients))
    except Exception as e:
        logger.error("offers share email job failed: %s", e)
