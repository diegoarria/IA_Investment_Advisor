"""Post-launch daily recap emails — 7 days, 2026-09-25 .. 2026-10-01, 12:00 ET,
every user who hasn't opted out. One-time per (user, day) via notification_log.

Also the two NEW launch promos, granted AUTOMATICALLY (no claim step) by
run_promo_grants() every 30 min from 2026-09-25 to 2026-10-03:
  - watchlist: 3+ stocks in the watchlist  -> +7 Premium days (once)
  - portfolio: first investment loaded     -> +7 Premium days (once)
Both stack on top of any existing bonus via referral._extend_premium, and are
claimed (notification_log row, type='grant') BEFORE granting so a re-run can
never double-grant.

Segment (no last-seen column exists, so this is by setup, not by recency):
  "new"    = nothing in watchlist AND no portfolio positions
  "active" = has at least one of them
"""
import asyncio
import logging
import random
from collections import defaultdict

from app.core.config import settings
from app.services.email_service import _nuvos_email_header
from app.services.launch_emails import _fetch_all, _lang

logger = logging.getLogger(__name__)

RECAP_DAYS = {1: (9, 25), 2: (9, 26), 3: (9, 27), 4: (9, 28), 5: (9, 29), 6: (9, 30), 7: (10, 1)}
PROMO_UNTIL_ES, PROMO_UNTIL_EN = "3 de octubre", "October 3"
GRANT_DAYS = 7

_REF = {
    "es": {
        1: ("Invita a 1 amigo y gana 14 días de Premium gratis", "Tu amigo también recibe 14 días al unirse con tu enlace."),
        2: ("2 amigos = 14 días más de Premium + 1 sesión 1 a 1 gratis", "Cuando tu segundo amigo se una, se suman otros 14 días de Premium y una sesión 1 a 1."),
        4: ("3 amigos = 30 días más de Premium + otra sesión 1 a 1", "Es el tercer nivel del programa de referidos: se suman 30 días de Premium y una sesión 1 a 1 más."),
        6: ("Invita a 1 amigo y gana 14 días de Premium gratis", "Tu amigo también recibe 14 días al unirse con tu enlace."),
    },
    "en": {
        1: ("Invite 1 friend and earn 14 days of Premium free", "Your friend also gets 14 days when they join with your link."),
        2: ("2 friends = 14 more Premium days + 1 free 1:1 session", "When your second friend joins, another 14 Premium days and a 1:1 session are added."),
        4: ("3 friends = 30 more Premium days + another 1:1 session", "It's the third referral level: 30 more Premium days and one more 1:1 session."),
        6: ("Invite 1 friend and earn 14 days of Premium free", "Your friend also gets 14 days when they join with your link."),
    },
}
_WATCH_PROMO = {
    "es": ("Agrega 3 acciones a tu watchlist y te regalamos 7 días de Premium", f"Se activa solo, sin código. Válido hasta el {PROMO_UNTIL_ES}."),
    "en": ("Add 3 stocks to your watchlist and get 7 days of Premium on us", f"It activates automatically, no code needed. Valid until {PROMO_UNTIL_EN}."),
}
_PORT_PROMO = {
    "es": ("Carga tu primera inversión y te regalamos 7 días de Premium", f"Se activa solo, sin código. Válido hasta el {PROMO_UNTIL_ES}."),
    "en": ("Load your first investment and get 7 days of Premium on us", f"It activates automatically, no code needed. Valid until {PROMO_UNTIL_EN}."),
}
# which promo each day's box shows: "ref" | "watch" | "port" | "duo"
_DAY_PROMO = {1: "watch", 2: "ref", 3: "port", 4: "ref", 5: "port", 6: "ref", 7: "duo"}
_DUO = {
    "es": ("Premium para dos, con precio en pesos mexicanos", "El plan Duo te deja compartir Premium con alguien más. Míralo con calma en tu cuenta."),
    "en": ("Premium for two, priced in Mexican pesos", "The Duo plan lets you share Premium with someone else. Take a look in your account."),
}

_COPY = {
    "es": {
        1: dict(subject="Así fue el lanzamiento de Nuvos, y tu primer paso", tagline="Recap del lanzamiento", heading="Gracias por ser parte del lanzamiento",
                new="Ayer abrimos Nuvos oficialmente. Tu primer paso toma 1 minuto: agrega 3 acciones que te interesen a tu watchlist y empieza a seguirlas.",
                active="Ayer abrimos Nuvos oficialmente y ya tienes cosas en tu cuenta. Sigue armando tu watchlist: cada acción que sigues te da avisos y contexto claro.", cta="Ir a mi watchlist →", path="/watchlist"),
        2: dict(subject="Tu semana en el mercado, en 1 minuto", tagline="Recap del mercado", heading="Lo que se movió en lo que sigues",
                new="Todavía no sigues ninguna acción. Agrega unas cuantas y aquí verás cómo se mueven cada día.",
                active="Esto es lo que pasó con las acciones que sigues. Es información para entender, no una recomendación.", cta="Ver mi watchlist →", path="/watchlist"),
        3: dict(subject="Pregúntale a Arthur lo que siempre quisiste saber", tagline="Conoce a Arthur", heading="Arthur responde en lenguaje sencillo",
                new="Arthur es tu mentor: explica conceptos de inversión sin jerga. Pregúntale, por ejemplo, qué significa que una acción esté cara o barata.",
                active="Prueba hoy una pregunta nueva a Arthur: pídele que te explique algo de lo que tienes en tu cuenta, paso a paso.", cta="Hablar con Arthur →", path="/chat"),
        4: dict(subject="¿Esa acción está cara o barata? Míralo en 3 escenarios", tagline="Valor justo", heading="Cara, barata o en su punto",
                new="Nuvos calcula un valor justo con tres escenarios (conservador, base y optimista) y lo compara con el precio de hoy. Busca cualquier acción y míralo.",
                active="Revisa el valor justo de las acciones que sigues: tres escenarios frente al precio de hoy, para decidir con más confianza. Nuvos informa, no recomienda.", cta="Ver valor justo →", path="/watchlist"),
        5: dict(subject="Tu portafolio en una sola pantalla", tagline="Tu portafolio", heading="Todo lo que tienes, claro",
                new="Carga tu primera inversión en 2 minutos y Nuvos te muestra cómo va, sin hojas de cálculo.",
                active="Revisa cómo va tu portafolio hoy y qué noticias afectan justo lo que tienes.", cta="Abrir mi portafolio →", path="/portfolio"),
        6: dict(subject="Aprende algo nuevo en 3 minutos", tagline="Aprende", heading="Una lección corta, sin jerga",
                new="En Learn hay lecciones cortas para entender mejor tu dinero, a tu ritmo.",
                active="Tómate 3 minutos hoy con una lección de Learn: entender más es la mejor forma de invertir con calma.", cta="Ir a Learn →", path="/learn"),
        7: dict(subject="Tu primera semana en Nuvos", tagline="Tu primera semana", heading="Una semana con Nuvos",
                new="Ya pasó una semana desde el lanzamiento. Todavía estás a tiempo de armar tu cuenta y activar tus 7 días de Premium.",
                active="Una semana con Nuvos. Gracias por estar. Sigue con lo que empezaste y explora lo que aún no pruebas.", cta="Entrar a Nuvos →", path="/home"),
    },
    "en": {
        1: dict(subject="Nuvos launch recap, and your first step", tagline="Launch recap", heading="Thank you for being part of the launch",
                new="Yesterday we officially opened Nuvos. Your first step takes 1 minute: add 3 stocks you care about to your watchlist and start following them.",
                active="Yesterday we officially opened Nuvos and you already have things in your account. Keep building your watchlist: every stock you follow brings alerts and clear context.", cta="Go to my watchlist →", path="/watchlist"),
        2: dict(subject="Your week in the market, in 1 minute", tagline="Market recap", heading="What moved in the stocks you follow",
                new="You aren't following any stocks yet. Add a few and you'll see how they move here each day.",
                active="Here is what happened with the stocks you follow. It's information to help you understand, not a recommendation.", cta="See my watchlist →", path="/watchlist"),
        3: dict(subject="Ask Arthur what you've always wanted to know", tagline="Meet Arthur", heading="Arthur answers in plain language",
                new="Arthur is your mentor: he explains investing concepts with no jargon. Ask him, for example, what it means for a stock to be expensive or cheap.",
                active="Try a new question for Arthur today: ask him to explain something in your account, step by step.", cta="Talk to Arthur →", path="/chat"),
        4: dict(subject="Is that stock expensive or cheap? See it in 3 scenarios", tagline="Fair value", heading="Expensive, cheap or about right",
                new="Nuvos estimates a fair value with three scenarios (conservative, base and optimistic) and compares it with today's price. Look up any stock and see it.",
                active="Check the fair value of the stocks you follow: three scenarios versus today's price, to decide with more confidence. Nuvos informs, it doesn't recommend.", cta="See fair value →", path="/watchlist"),
        5: dict(subject="Your portfolio on a single screen", tagline="Your portfolio", heading="Everything you own, made clear",
                new="Load your first investment in 2 minutes and Nuvos shows you how it's doing, no spreadsheets.",
                active="Check how your portfolio is doing today and which news affects exactly what you own.", cta="Open my portfolio →", path="/portfolio"),
        6: dict(subject="Learn something new in 3 minutes", tagline="Learn", heading="A short lesson, no jargon",
                new="Learn has short lessons to understand your money better, at your own pace.",
                active="Take 3 minutes today for a Learn lesson: understanding more is the best way to invest calmly.", cta="Go to Learn →", path="/learn"),
        7: dict(subject="Your first week on Nuvos", tagline="Your first week", heading="One week with Nuvos",
                new="A week has passed since launch. You still have time to set up your account and activate your 7 days of Premium.",
                active="One week with Nuvos. Thank you for being here. Keep going with what you started and explore what you haven't tried yet.", cta="Enter Nuvos →", path="/home"),
    },
}
_FOOT = {
    "es": "Recibes este correo porque tienes una cuenta en Nuvos. Nuvos es una herramienta educativa; no da recomendaciones de inversión.",
    "en": "You're receiving this because you have a Nuvos account. Nuvos is an educational tool; it doesn't give investment recommendations.",
}


def _promo_for(day: int, lang: str) -> tuple[str, str]:
    kind = _DAY_PROMO[day]
    if kind == "watch":
        return _WATCH_PROMO[lang]
    if kind == "port":
        return _PORT_PROMO[lang]
    if kind == "duo":
        return _DUO[lang]
    return _REF[lang][day]


def build_recap_email(day: int, name: str | None, language: str | None, referral_link: str,
                      segment: str = "new", movers: list[tuple[str, float]] | None = None) -> tuple[str, str]:
    """Returns (subject, html) for recap `day` (1..7)."""
    lang = _lang(language)
    c = _COPY[lang][day]
    first = (name or "").split()[0] if name else ""
    greeting = (f"Hola {first}, " if lang == "es" else f"Hi {first}, ") if first else ""
    body = c["active"] if segment == "active" else c["new"]
    movers_html = ""
    if day == 2 and segment == "active" and movers:
        rows = "".join(
            f'<tr><td style="padding:6px 0;color:#f4f5f7;font-size:14.5px;font-weight:800">{t}</td>'
            f'<td style="padding:6px 0;text-align:right;font-size:14.5px;font-weight:800;color:{"#00d47e" if p >= 0 else "#ef4444"}">{p:+.2f}%</td></tr>'
            for t, p in movers
        )
        movers_html = (f'<div style="background:#111318;border:1px solid #2a2d3a;border-radius:16px;padding:14px 20px;margin-bottom:22px">'
                       f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0">{rows}</table></div>')
    p_title, p_body = _promo_for(day, lang)
    show_link = _DAY_PROMO[day] == "ref"
    link_html = (f'<div style="margin-top:6px"><a href="{referral_link}" style="color:#00d47e;font-size:13.5px;font-weight:800;'
                 f'word-break:break-all;text-decoration:none">{referral_link}</a></div>') if show_link else ""
    cta_url = "https://nuvosai.com" + c["path"]
    html = f"""<!DOCTYPE html>
<html lang="{lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">
  <div style="border-radius:20px;overflow:hidden;border:1px solid #2a2d3a">
    {_nuvos_email_header(c['tagline'])}
    <div style="background:#1a1d27;padding:36px 32px">
      <h1 style="color:#f4f5f7;font-size:25px;font-weight:900;margin:0 0 14px;letter-spacing:-0.4px;text-align:center">{c['heading']}</h1>
      <p style="color:#9aa0ac;font-size:14.5px;margin:0 0 24px;line-height:1.7;text-align:center">{greeting}{body}</p>
      {movers_html}
      <a href="{cta_url}" style="display:block;text-align:center;background:linear-gradient(135deg,#00a85e,#00d47e);color:#04140b;font-weight:900;font-size:15.5px;padding:15px 24px;border-radius:14px;text-decoration:none;box-shadow:0 8px 24px rgba(0,168,94,0.25)">{c['cta']}</a>
      <div style="background:#111318;border:1px solid rgba(0,212,126,0.35);border-radius:16px;padding:20px;margin-top:26px;text-align:center">
        <div style="font-size:26px;margin-bottom:6px">🎁</div>
        <div style="color:#f4f5f7;font-size:16px;font-weight:900;margin-bottom:6px">{p_title}</div>
        <div style="color:#9aa0ac;font-size:13px;line-height:1.6">{p_body}</div>{link_html}
      </div>
      <div style="border-top:1px solid #2a2d3a;margin-top:26px;padding-top:18px;text-align:center">
        <p style="color:#5b6270;font-size:11px;margin:0;line-height:1.6">{_FOOT[lang]}</p>
      </div>
    </div>
  </div>
</div>
</body>
</html>"""
    return c["subject"], html


async def _user_setup(db) -> tuple[dict[str, list[str]], set[str]]:
    """(tickers per user's watchlist, users with at least one portfolio position)."""
    wl = await _fetch_all(lambda: db.table("watchlist").select("id,user_id,ticker").order("id"))
    by_user: dict[str, list[str]] = defaultdict(list)
    for r in wl:
        by_user[r["user_id"]].append(r["ticker"])
    pf = await _fetch_all(lambda: db.table("user_portfolio").select("user_id,portfolio_id,positions").order("user_id").order("portfolio_id"))
    with_port = {r["user_id"] for r in pf if r.get("positions")}
    return by_user, with_port


async def send_recap_email_job(day: int) -> None:
    if not settings.resend_api_key:
        logger.info("recap email %d: RESEND_API_KEY not set — skipping", day)
        return
    from app.core.database import get_supabase
    from app.services.notification_engine import send_email_notification
    from app.api.routes.referral import _ensure_code

    category = f"recap_email_{day}"
    db = get_supabase()
    try:
        prefs = await _fetch_all(lambda: db.table("notification_preferences").select("user_id,email_daily_summary").order("user_id"))
        disabled = {r["user_id"] for r in prefs if r.get("email_daily_summary") is False}
        sent_rows = await _fetch_all(
            lambda: db.table("notification_log").select("id,user_id").eq("category", category).eq("type", "email").eq("status", "sent").order("id"))
        already = {r["user_id"] for r in sent_rows}
        profiles = await _fetch_all(lambda: db.table("user_profiles").select("user_id,name,preferred_language,referral_code").order("user_id"))
        recipients = [r for r in profiles if r["user_id"] not in disabled and r["user_id"] not in already]
        watch, with_port = await _user_setup(db)

        prices: dict = {}
        if day == 2:
            tickers = sorted({t for r in recipients for t in watch.get(r["user_id"], [])})[:300]
            try:
                from app.api.routes.watchlist import _fetch_prices_batch
                prices = await asyncio.to_thread(_fetch_prices_batch, tickers)
            except Exception as e:
                logger.warning("recap email 2: price batch failed, sending without movers: %s", e)

        sent = 0
        for i, prof in enumerate(recipients):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.1))
            uid = prof["user_id"]
            try:
                code = prof.get("referral_code") or await _ensure_code(uid)
                link = f"https://nuvosai.com/join?ref={code}" if code else "https://nuvosai.com/home"
                segment = "active" if (watch.get(uid) or uid in with_port) else "new"
                movers = None
                if day == 2:
                    ms = [(t, float(prices[t]["change_pct"])) for t in watch.get(uid, []) if t in prices and prices[t].get("change_pct") is not None]
                    movers = sorted(ms, key=lambda x: abs(x[1]), reverse=True)[:3] or None
                subject, html = build_recap_email(day, prof.get("name"), prof.get("preferred_language"), link, segment, movers)
                await send_email_notification(uid, category, subject, html, db)
                sent += 1
            except Exception as e:
                logger.warning("recap email %d failed for %s: %s", day, uid, e)
        logger.info("recap email %d: %d/%d users processed", day, sent, len(recipients))
    except Exception as e:
        logger.error("recap email %d job failed: %s", day, e)


# ─── Automatic promo grants ──────────────────────────────────────────────────

_GRANT_CONFIRM = {
    "watchlist": {
        "es": ("🎁 Te regalamos 7 días de Premium", "Ya tienes 3 acciones en tu watchlist, así que activamos tus 7 días de Premium gratis. Gracias por usar Nuvos."),
        "en": ("🎁 We gave you 7 days of Premium", "You now have 3 stocks in your watchlist, so we activated your 7 free Premium days. Thanks for using Nuvos."),
    },
    "portfolio": {
        "es": ("🎁 Te regalamos 7 días de Premium", "Cargaste tu primera inversión, así que activamos tus 7 días de Premium gratis. Gracias por usar Nuvos."),
        "en": ("🎁 We gave you 7 days of Premium", "You loaded your first investment, so we activated your 7 free Premium days. Thanks for using Nuvos."),
    },
}


async def run_promo_grants() -> None:
    """Grants each launch promo at most once per user. The claim row is
    written BEFORE the grant (and removed if the grant fails), so a
    concurrent/re-run job can never double-grant."""
    from app.core.database import get_supabase, run_query
    from app.api.routes.referral import _extend_premium
    from app.services.notification_engine import send_email_notification

    db = get_supabase()
    try:
        watch, with_port = await _user_setup(db)
        eligible = {
            "watchlist": {u for u, t in watch.items() if len(set(t)) >= 3},
            "portfolio": with_port,
        }
        profiles = {r["user_id"]: r for r in await _fetch_all(lambda: db.table("user_profiles").select("user_id,preferred_language").order("user_id"))}
        for promo, users in eligible.items():
            category = f"promo_grant_{promo}"
            done_rows = await _fetch_all(lambda: db.table("notification_log").select("id,user_id").eq("category", category).eq("type", "grant").order("id"))
            done = {r["user_id"] for r in done_rows}
            for uid in users - done:
                if uid not in profiles:
                    continue
                claimed = False
                try:
                    await run_query(db.table("notification_log").insert(
                        {"user_id": uid, "type": "grant", "category": category, "title": f"{promo} promo +{GRANT_DAYS}d", "body": "", "data": {}, "status": "sent"}))
                    claimed = True
                    await _extend_premium(uid, GRANT_DAYS, db)
                except Exception as e:
                    logger.error("promo grant %s failed for %s: %s", promo, uid, e)
                    if claimed:
                        try:
                            await run_query(db.table("notification_log").delete().eq("user_id", uid).eq("category", category).eq("type", "grant"))
                        except Exception:
                            pass
                    continue
                lang = _lang(profiles[uid].get("preferred_language"))
                subject, msg = _GRANT_CONFIRM[promo][lang]
                try:
                    await send_email_notification(uid, f"{category}_email", subject, _confirm_html(subject, msg, lang), db)
                except Exception as e:
                    logger.warning("promo grant confirmation email failed for %s: %s", uid, e)
                logger.info("promo grant: %s +%dd -> %s", promo, GRANT_DAYS, uid)
    except Exception as e:
        logger.error("run_promo_grants failed: %s", e)


def _confirm_html(title: str, msg: str, lang: str) -> str:
    cta = "Ir a Nuvos →" if lang == "es" else "Go to Nuvos →"
    return f"""<!DOCTYPE html>
<html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 16px"><div style="border-radius:20px;overflow:hidden;border:1px solid #2a2d3a">
{_nuvos_email_header("Nuvos")}
<div style="background:#1a1d27;padding:36px 32px;text-align:center">
<h1 style="color:#f4f5f7;font-size:24px;font-weight:900;margin:0 0 14px">{title}</h1>
<p style="color:#9aa0ac;font-size:14.5px;line-height:1.7;margin:0 0 22px">{msg}</p>
<a href="https://nuvosai.com/home" style="display:block;background:linear-gradient(135deg,#00a85e,#00d47e);color:#04140b;font-weight:900;font-size:15.5px;padding:15px 24px;border-radius:14px;text-decoration:none">{cta}</a>
</div></div></div></body></html>"""
