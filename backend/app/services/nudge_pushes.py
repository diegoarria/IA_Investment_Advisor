"""Push nudges for users WITHOUT an imported portfolio (Diego, 2026-09-23).

One push per weekday at 13:00 ET, rotating so nobody gets the same message
twice in a row; plus the no-portfolio copy used by the 9:30 open push and the
4:05 close push (see worker.py).

Rules (all deliberate):
- Never recommends anything: no asset, sector, amount, or "good time to buy".
  The invest nudge is conditional ("Si ya decidiste invertir...") and points
  at registering/following, never at what to buy. Nuvos is educational.
- Market days only: skipped on weekends, NYSE holidays (only the holiday push
  fires those days) and early-close days (the market shuts at 1 PM ET).
- Stops by itself: anyone with a position in any portfolio is never nudged.
- At most one nudge per user per day: every nudge shares ONE category, and
  send_push dedups per user + category + day.
- Respects quiet hours / caps (send_push) and the push_market_open opt-out.
- No LLM calls: fixed copy, zero AI cost.
"""
import asyncio
import logging
import random
from datetime import date

logger = logging.getLogger(__name__)

NUDGE_CATEGORY = "nudge_no_portfolio"
FOLLOW_PROMO_UNTIL = date(2026, 10, 3)  # launch promo: 3 watchlist stocks -> +7 Premium days

# weekday() -> nudge kind. Mon/Fri: the "first step" invite Diego asked for.
ROTATION = {0: "invest", 1: "paper", 2: "follow", 3: "concept", 4: "invest"}

# (term, one-line definition) — neutral, educational, no advice.
CONCEPTS = {
    "es": [
        ("valor justo", "es una estimación de cuánto vale una empresa según lo que gana y crece, para compararla con su precio de hoy."),
        ("diversificación", "es repartir tu dinero en varias inversiones para que un solo golpe no lo afecte todo."),
        ("P/E", "es el precio de una acción dividido entre lo que la empresa gana por acción; sirve para comparar."),
        ("dividendo", "es la parte de las ganancias que algunas empresas reparten a quienes tienen sus acciones."),
        ("interés compuesto", "es ganar intereses sobre tus intereses: con el tiempo, el efecto crece."),
        ("ETF", "es un fondo que se compra como una acción y agrupa muchas inversiones en una sola."),
        ("volatilidad", "es qué tanto sube y baja el precio de algo; más movimiento, más incertidumbre."),
        ("margen de seguridad", "es la diferencia entre el valor estimado de una empresa y su precio; mientras más grande, más colchón."),
    ],
    "en": [
        ("fair value", "is an estimate of what a company is worth based on what it earns and grows, to compare with today's price."),
        ("diversification", "means spreading your money across several investments so one blow doesn't hit everything."),
        ("P/E", "is a stock's price divided by what the company earns per share; it helps you compare."),
        ("dividend", "is the part of profits some companies pay out to the people who own their shares."),
        ("compound interest", "is earning interest on your interest: over time, the effect snowballs."),
        ("ETF", "is a fund you buy like a stock that bundles many investments into one."),
        ("volatility", "is how much the price of something moves up and down; more movement, more uncertainty."),
        ("margin of safety", "is the gap between a company's estimated value and its price; the wider it is, the more cushion."),
    ],
}


def build_nudge(kind: str, lang: str, first: str, today: date) -> tuple[str, str, dict]:
    """(title, body, data) for a nudge kind. `today` only drives the weekly
    concept rotation and whether the follow-3 promo is still live."""
    en = lang == "en"
    if kind == "invest":
        return (
            "The market is active right now 📈" if en else "El mercado está activo ahora 📈",
            ("If you've already decided to invest, this is a moment to take the first step: register your position in Nuvos and follow it. You decide what; Nuvos helps you understand it."
             if en else
             "Si ya decidiste invertir, este es un momento para dar el primer paso: registra tu posición en Nuvos y síguela. Tú decides qué; Nuvos te ayuda a entenderlo."),
            {"screen": "portfolio"},
        )
    if kind == "paper":
        return (
            "Practice with no risk 🎮" if en else "Practica sin riesgo 🎮",
            ("Try the simulator with $10,000 of virtual money before investing for real. See how decisions play out without risking yours."
             if en else
             "Prueba el simulador con $10,000 virtuales antes de invertir de verdad. Aprende cómo se ven las decisiones sin arriesgar tu dinero."),
            {"screen": "paper"},
        )
    if kind == "follow":
        promo = today <= FOLLOW_PROMO_UNTIL
        if en:
            body = "Add them to your watchlist and get alerts when they move." + (" With 3 stocks we give you 7 days of Premium (until Oct 3)." if promo else "")
        else:
            body = "Agrégalas a tu watchlist y recibe avisos cuando se muevan." + (" Con 3 acciones te regalamos 7 días de Premium (hasta el 3 de oct)." if promo else "")
        return ("Follow 3 stocks you're curious about 👀" if en else "Sigue 3 acciones que te den curiosidad 👀", body, {"screen": "watchlist"})
    # concept of the week — same concept all week, rotates by ISO week number
    terms = CONCEPTS["en" if en else "es"]
    term, definition = terms[today.isocalendar()[1] % len(terms)]
    ask = "Ask Arthur for an example." if en else "Pídele a Arthur un ejemplo."
    return (
        "Concept of the week 🧠" if en else "Concepto de la semana 🧠",
        f"{term[0].upper() + term[1:]} {definition} {ask}",
        {"screen": "chat"},
    )


def nudge_kind_for(d: date) -> str | None:
    """None on weekends."""
    return ROTATION.get(d.weekday())


# ─── Audience ────────────────────────────────────────────────────────────────

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


def _has_positions(raw) -> bool:
    pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
    return bool(pos)


async def users_with_positions(db) -> set[str]:
    """Every user with at least one position in ANY of their portfolios."""
    rows = await _paged(lambda: db.table("user_portfolio").select("user_id,portfolio_id,positions").order("user_id").order("portfolio_id"))
    return {r["user_id"] for r in rows if _has_positions(r.get("positions"))}


# ─── Job ─────────────────────────────────────────────────────────────────────

async def job_midday_nudge() -> None:
    """13:00 ET weekdays. See module docstring for the rules."""
    from app.services.market_holidays import is_market_open_today, is_early_close_today, _today_et
    if not is_market_open_today() or is_early_close_today():
        logger.info("job_midday_nudge: market closed or early-close day — skipping")
        return
    today = _today_et()
    kind = nudge_kind_for(today)
    if kind is None:
        return

    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    try:
        prefs = await _paged(lambda: db.table("notification_preferences").select("user_id,push_market_open").order("user_id"))
        disabled = {p["user_id"] for p in prefs if p.get("push_market_open") is False}
        has_pos = await users_with_positions(db)
        profiles = await _paged(lambda: db.table("user_profiles").select("user_id,name,preferred_language,push_token").order("user_id"))
        web = await _paged(lambda: db.table("web_push_subscriptions").select("id,user_id").order("id"))
        web_uids = {r["user_id"] for r in web}
        recipients = [
            p for p in profiles
            if (p.get("push_token") or p["user_id"] in web_uids)
            and p["user_id"] not in disabled and p["user_id"] not in has_pos
        ]
        sent = 0
        for i, prof in enumerate(recipients):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.1))
            try:
                first = (prof.get("name") or "Inversor").split()[0]
                title, body, data = build_nudge(kind, prof.get("preferred_language") or "es", first, today)
                await send_push(prof["user_id"], NUDGE_CATEGORY, title, body, data, db)
                sent += 1
            except Exception as e:
                logger.warning("job_midday_nudge failed for %s: %s", prof["user_id"], e)
        logger.info("job_midday_nudge: kind=%s, %d/%d users processed", kind, sent, len(recipients))
    except Exception as e:
        logger.error("job_midday_nudge failed: %s", e)
