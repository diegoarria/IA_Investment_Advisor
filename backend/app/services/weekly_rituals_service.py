"""
Nuvos Weekly Rituals — three cadence-based touchpoints (confirmed with
Diego before building): a daily "Pregunta del Día" (one question shared by
every user, vote A/B, see the community %; Premium also sees Nuvos's own
pick + a short explanation), a Sunday "Prepárate para la semana" event
rollup (Free sees counts only, Premium sees which of their own portfolio
tickers have an event), and a Saturday "Reflexión de la semana" (3 saved
free-text prompts).

None of this existed before — no poll/vote table, no curated-content bank,
no weekly event rollup anywhere in the codebase (see migration
070_weekly_rituals.sql for the new tables). This module is deliberately
self-contained (doesn't import from worker.py) even though worker.py is
the only caller of the `send_*` functions — worker.py is a standalone
script, not a package other modules should depend on.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)

_SUNDAY_PREP_WINDOW_DAYS = 7


def _today_et() -> date:
    # Same convention as notification_engine._today_et — the trading-day
    # calendar this whole feature runs on is US market time, not UTC.
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/New_York")).date()


def _week_start_monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _agg_positions(rows: list[dict]) -> list:
    """Same aggregation worker.py's _agg_positions does — duplicated here
    (not imported) since worker.py is a standalone script, not a module
    other code should depend on. Multi-broker portfolio rows -> one flat
    list of position dicts."""
    result: list[dict] = []
    for row in rows:
        raw = row.get("positions") or {}
        pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
        result.extend(pos)
    return result


# ── Pregunta del Día ──────────────────────────────────────────────────────────

def pick_next_question_row(rows: list[dict]) -> Optional[dict]:
    """Pure selection logic — given every active `daily_questions` row,
    returns the one that should run today: never-used first (`last_used_at`
    is None), then the least-recently-used. Guarantees no question repeats
    until the entire bank has cycled once, regardless of bank size. Returns
    None only when there are no active questions at all."""
    active = [r for r in rows if r.get("active", True)]
    if not active:
        return None
    return min(active, key=lambda r: (r.get("last_used_at") is not None, r.get("last_used_at") or ""))


def _current_question_week_key() -> str:
    # The question now only rotates weekly (Diego: push only goes out
    # Sundays 2pm ET) — keyed by the Monday of the current week rather
    # than the exact day, so a user opening the screen on, say, Wednesday
    # sees the SAME question already sent Sunday instead of silently
    # burning a fresh one from the bank (which would exhaust the never-
    # repeat bank far faster than one per week). Reuses the
    # `daily_question_of_the_day.date` column as-is — just a different
    # value goes into it now, no schema change needed.
    return str(_week_start_monday(_today_et()))


async def ensure_todays_question() -> Optional[dict]:
    """Idempotent — if this week already has a question assigned, returns
    it; otherwise picks the next one (never-repeat), marks it used, and
    records it for the week. Safe to call from both the push job and the
    on-demand read endpoint without double-assigning."""
    db = get_supabase()
    week_key = _current_question_week_key()

    existing = await run_query(
        db.table("daily_question_of_the_day").select("question_id").eq("date", week_key)
    )
    if existing.data:
        q_res = await run_query(
            db.table("daily_questions").select("*").eq("id", existing.data[0]["question_id"])
        )
        return q_res.data[0] if q_res.data else None

    bank_res = await run_query(db.table("daily_questions").select("*").eq("active", True))
    picked = pick_next_question_row(bank_res.data or [])
    if not picked:
        logger.warning("weekly_rituals: no active daily_questions rows — cannot pick this week's question")
        return None

    now_iso = datetime.now(timezone.utc).isoformat()
    await run_query(db.table("daily_questions").update({"last_used_at": now_iso}).eq("id", picked["id"]))
    await run_query(db.table("daily_question_of_the_day").insert({"date": week_key, "question_id": picked["id"]}))
    picked["last_used_at"] = now_iso
    return picked


async def _vote_counts(question_id: str) -> dict:
    db = get_supabase()
    res = await run_query(db.table("daily_question_votes").select("choice").eq("question_id", question_id))
    votes = res.data or []
    n_a = sum(1 for v in votes if v["choice"] == "a")
    n_b = sum(1 for v in votes if v["choice"] == "b")
    total = n_a + n_b
    return {
        "total_votes": total,
        "pct_a": round(n_a / total * 100) if total else None,
        "pct_b": round(n_b / total * 100) if total else None,
    }


async def get_today_question(user_id: str, lang: str = "es") -> Optional[dict]:
    """Full payload the question screen needs in one call: this week's
    question text (in the requested language), whether this user already
    voted this week (and what they chose), and the community % once they
    have."""
    question = await ensure_todays_question()
    if not question:
        return None

    db = get_supabase()
    week_key = _current_question_week_key()
    my_vote_res = await run_query(
        db.table("daily_question_votes").select("choice").eq("user_id", user_id).eq("date", week_key)
    )
    my_choice = my_vote_res.data[0]["choice"] if my_vote_res.data else None

    is_en = lang == "en"
    payload = {
        "question_id": question["id"],
        "date": week_key,
        "question": question["question_en"] if is_en else question["question_es"],
        "option_a": question["option_a_en"] if is_en else question["option_a_es"],
        "option_b": question["option_b_en"] if is_en else question["option_b_es"],
        "voted": my_choice is not None,
        "my_choice": my_choice,
        "nuvos_choice": None,
        "nuvos_explanation": None,
    }
    if my_choice is not None:
        counts = await _vote_counts(question["id"])
        payload.update(counts)
        # Nuvos's own pick + explanation only reveal AFTER the user has
        # voted (matches the requested UX: "¿Quieres saber qué elegiría
        # Nuvos?" is only meaningful once you've already committed to one).
        payload["nuvos_choice"] = question["nuvos_choice"]
        payload["nuvos_explanation"] = question["nuvos_explanation_en"] if is_en else question["nuvos_explanation_es"]
    return payload


async def record_vote(user_id: str, choice: str) -> dict:
    """Idempotent per (user, week) via the UNIQUE(user_id, date) constraint
    — a second vote attempt the same week raises, the caller (route) turns
    that into a clean 409 rather than silently double-counting."""
    if choice not in ("a", "b"):
        raise ValueError("choice debe ser 'a' o 'b'")
    question = await ensure_todays_question()
    if not question:
        raise ValueError("No hay pregunta del día disponible")

    db = get_supabase()
    week_key = _current_question_week_key()
    await run_query(db.table("daily_question_votes").insert({
        "user_id": user_id, "question_id": question["id"], "date": week_key, "choice": choice,
    }))
    counts = await _vote_counts(question["id"])
    return {"question_id": question["id"], "my_choice": choice, **counts}


# ── Domingo: preparación para la semana ────────────────────────────────────────

async def _week_events_for_user(user_id: str) -> dict:
    """Real event count for this user's own portfolio+watchlist over the
    next 7 days — same per-ticker fetch worker.py's job_events_alerts
    already uses (`_fetch_events_for_symbol`), just aggregated across a
    week instead of checked against today/tomorrow. Returns the raw
    ingredients; Free vs Premium formatting happens in the caller."""
    import asyncio
    from app.api.routes.earnings import _fetch_events_for_symbol

    db = get_supabase()
    today = _today_et()
    window_end = today + timedelta(days=_SUNDAY_PREP_WINDOW_DAYS)

    port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", user_id))
    port_tickers = {p["ticker"] for p in _agg_positions(port_res.data or []) if p.get("ticker")}

    watch_res = await run_query(db.table("watchlist").select("ticker").eq("user_id", user_id))
    watch_tickers = {r["ticker"] for r in (watch_res.data or [])} - port_tickers

    all_tickers = port_tickers | watch_tickers
    event_dates: set[str] = set()
    reporting_tickers: set[str] = set()
    portfolio_events: list[dict] = []

    for ticker in all_tickers:
        events = await asyncio.to_thread(_fetch_events_for_symbol, ticker)
        for evt in events:
            evt_date_str = evt.get("event_date")
            if not evt_date_str:
                continue
            try:
                evt_date = datetime.strptime(evt_date_str, "%Y-%m-%d").date()
            except ValueError:
                continue
            if not (today <= evt_date <= window_end):
                continue
            event_dates.add(f"{ticker}:{evt_date_str}")
            if evt.get("event_type") == "earnings":
                reporting_tickers.add(ticker)
            if ticker in port_tickers:
                portfolio_events.append({
                    "ticker": ticker, "event_type": evt.get("event_type"), "event_date": evt_date_str,
                })

    return {
        "total_events": len(event_dates),
        "reporting_count": len(reporting_tickers),
        "portfolio_events": sorted(portfolio_events, key=lambda e: e["event_date"]),
    }


async def get_sunday_prep(user_id: str, is_premium: bool) -> dict:
    data = await _week_events_for_user(user_id)
    if is_premium:
        return {
            "total_events": data["total_events"],
            "reporting_count": data["reporting_count"],
            "portfolio_events": data["portfolio_events"],
        }
    return {"total_events": data["total_events"], "reporting_count": data["reporting_count"]}


async def send_weekly_prep_push(tier_filter: str) -> None:
    """Cron entry point — `tier_filter` is "free" or "premium". Split into
    two separate calls/schedules (Diego wants Free's "Prepárate para la
    semana" on Sunday 12:10pm ET and Premium's "Tu semana en Nuvos" on
    Saturday 3:30pm ET — different days, so this can no longer be one loop
    branching per-user like the original single-Sunday-run version).
    Free gets counts only, Premium gets the real list of which of their OWN
    portfolio tickers have an event (never watchlist, per the confirmed
    spec — watchlist still counts toward the total but isn't named for
    Premium either, same "portafolio" framing the copy uses)."""
    import asyncio
    import random
    from app.services.notification_engine import send_push

    if tier_filter not in ("free", "premium"):
        raise ValueError("tier_filter debe ser 'free' o 'premium'")

    db = get_supabase()
    prefs_res = await run_query(
        db.table("notification_preferences").select("user_id").eq("push_weekly_rituals", True)
    )
    if not prefs_res.data:
        return
    uids = [r["user_id"] for r in prefs_res.data]

    tier_res = await run_query(
        db.table("user_profiles")
        .select("user_id,subscription_tier,trial_started_at,streak_bonus_premium_until,preferred_language")
        .in_("user_id", uids)
    )
    # Bug fix (2026-08-12): this used to bucket users by raw
    # subscription_tier=="premium", ignoring trial_started_at/
    # streak_bonus_premium_until entirely — a trial user got the "free"
    # variant of this push even while genuinely premium. Delegates to
    # is_premium_active(), the single canonical trial-window check, same
    # as every other premium gate in the app.
    from app.core.subscription import is_premium_active
    is_premium_map = {
        r["user_id"]: is_premium_active(r.get("subscription_tier"), r.get("trial_started_at"), r.get("streak_bonus_premium_until"))
        for r in (tier_res.data or [])
    }
    lang_map = {r["user_id"]: (r.get("preferred_language") or "es") for r in (tier_res.data or [])}

    target_uids = [
        uid for uid in uids
        if is_premium_map.get(uid, False) == (tier_filter == "premium")
    ]

    sent = 0
    for i, uid in enumerate(target_uids):
        if i % 100 == 0 and i > 0:
            await asyncio.sleep(12)
        try:
            is_en = lang_map.get(uid, "es") == "en"
            data = await _week_events_for_user(uid)
            if data["total_events"] == 0:
                continue  # nothing real to report — never send an empty "prepárate" push

            if tier_filter == "premium":
                title = "🔭 Your week at Nuvos" if is_en else "🔭 Tu semana en Nuvos"
                n_port = len({e["ticker"] for e in data["portfolio_events"]})
                if n_port:
                    body = (
                        f"👀 {n_port} {'companies in your portfolio have events.' if is_en else 'empresas de tu portafolio tienen eventos.'}"
                    )
                else:
                    body = (
                        f"📅 {data['total_events']} {'important events this week.' if is_en else 'eventos importantes esta semana.'}"
                    )
            else:
                title = "🔭 Get ready for the week" if is_en else "🔭 Prepárate para la semana"
                if is_en:
                    body = f"📅 {data['total_events']} important events\n📊 {data['reporting_count']} companies report"
                else:
                    body = f"📅 {data['total_events']} eventos importantes\n📊 {data['reporting_count']} empresas reportan"

            await send_push(uid, "weekly_rituals_sunday", title, body, {"screen": "weekly-ritual/sunday"}, db)
            sent += 1
            await asyncio.sleep(random.uniform(0.05, 0.15))
        except Exception as e:
            logger.warning("send_weekly_prep_push(%s) failed for %s: %s", tier_filter, uid, e)

    logger.info("send_weekly_prep_push(%s): %d/%d users notified", tier_filter, sent, len(target_uids))


async def send_daily_question_push() -> None:
    """Cron entry point — Sundays only, 2:00 PM ET (despite the "daily
    question" name/copy — Diego confirmed the push itself only goes out
    once a week). Assigns/reuses today's question (never-repeat, see
    ensure_todays_question) and pushes the same Free-tier copy to everyone
    with push_weekly_rituals=true. The Premium-only "see Nuvos's answer"
    reveal happens IN the app after voting, not as a second push."""
    import asyncio
    import random
    from app.services.notification_engine import send_push

    question = await ensure_todays_question()
    if not question:
        return

    db = get_supabase()
    prefs_res = await run_query(
        db.table("notification_preferences").select("user_id").eq("push_weekly_rituals", True)
    )
    if not prefs_res.data:
        return
    uids = [r["user_id"] for r in prefs_res.data]

    lang_res = await run_query(
        db.table("user_profiles").select("user_id,preferred_language").in_("user_id", uids)
    )
    lang_map = {r["user_id"]: (r.get("preferred_language") or "es") for r in (lang_res.data or [])}

    sent = 0
    for i, uid in enumerate(uids):
        if i % 100 == 0 and i > 0:
            await asyncio.sleep(12)
        try:
            is_en = lang_map.get(uid, "es") == "en"
            q_text = question["question_en"] if is_en else question["question_es"]
            opt_a  = question["option_a_en"] if is_en else question["option_a_es"]
            opt_b  = question["option_b_en"] if is_en else question["option_b_es"]
            title = "🎯 Question of the Day" if is_en else "🎯 Pregunta del Día"
            if is_en:
                body = f"You can only pick one:\n\n{q_text}\n{opt_a}\n{opt_b}\n\nVote →"
            else:
                body = f"Solo puedes elegir una:\n\n{q_text}\n{opt_a}\n{opt_b}\n\nVotar →"
            await send_push(uid, "weekly_rituals_question", title, body, {"screen": "weekly-ritual/question"}, db)
            sent += 1
            await asyncio.sleep(random.uniform(0.05, 0.15))
        except Exception as e:
            logger.warning("send_daily_question_push failed for %s: %s", uid, e)

    logger.info("send_daily_question_push: %d/%d users notified", sent, len(uids))


# ── Sábado: reflexión de la semana ────────────────────────────────────────────

async def send_saturday_reflection_push() -> None:
    """Saturday cron entry point — same simple push to every user with
    push_weekly_rituals=true, no per-user computation (the 3 prompts are
    generic, answered inside the app)."""
    import asyncio
    import random
    from app.services.notification_engine import send_push

    db = get_supabase()
    prefs_res = await run_query(
        db.table("notification_preferences").select("user_id").eq("push_weekly_rituals", True)
    )
    if not prefs_res.data:
        return
    uids = [r["user_id"] for r in prefs_res.data]

    lang_res = await run_query(
        db.table("user_profiles").select("user_id,preferred_language").in_("user_id", uids)
    )
    lang_map = {r["user_id"]: (r.get("preferred_language") or "es") for r in (lang_res.data or [])}

    sent = 0
    for i, uid in enumerate(uids):
        if i % 100 == 0 and i > 0:
            await asyncio.sleep(12)
        try:
            is_en = lang_map.get(uid, "es") == "en"
            title = "🪞 Time to reflect on your week" if is_en else "🪞 Hora de reflexionar tu semana"
            body = (
                "What went well? What did you learn? What would you do differently?"
                if is_en else
                "¿Qué salió bien? ¿Qué aprendiste? ¿Qué harías diferente?"
            )
            await send_push(uid, "weekly_rituals_saturday", title, body, {"screen": "weekly-ritual/saturday"}, db)
            sent += 1
            await asyncio.sleep(random.uniform(0.05, 0.15))
        except Exception as e:
            logger.warning("send_saturday_reflection_push failed for %s: %s", uid, e)

    logger.info("send_saturday_reflection_push: %d/%d users notified", sent, len(uids))


async def save_reflection(
    user_id: str, went_well: Optional[str], learned: Optional[str], would_do_differently: Optional[str],
) -> dict:
    db = get_supabase()
    week_start = str(_week_start_monday(_today_et()))
    row = {
        "user_id": user_id, "week_start_date": week_start,
        "went_well": (went_well or "").strip() or None,
        "learned": (learned or "").strip() or None,
        "would_do_differently": (would_do_differently or "").strip() or None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await run_query(db.table("weekly_reflections").upsert(row, on_conflict="user_id,week_start_date"))
    return row


async def get_reflection_history(user_id: str, limit: int = 26) -> list[dict]:
    db = get_supabase()
    res = await run_query(
        db.table("weekly_reflections").select("*").eq("user_id", user_id)
        .order("week_start_date", desc=True).limit(limit)
    )
    return res.data or []


# ── Revisión de Portafolio Dominical ────────────────────────────────────────
# Diego's request (Aug 16): tapping this push should open its own flashcard
# with the user's real numbers, same as the other three rituals — it
# previously deep-linked to the generic "portfolio" screen. Real cost
# discipline (see today's Aug 15 spend-cap work): this NEVER calls Claude —
# the numbers are recomputed live from weekly_range_snapshots (free, real
# math), and the AI-written sentence is read back verbatim from
# notification_log (the exact text job_sunday_portfolio_review already
# generated once and logged at send time), never regenerated on open.
#
# weekly_range_snapshots (migration 082) replaced fmg_portfolio_snapshots as
# the source here — fmg_portfolio_snapshots is cost-basis (shares * avgPrice)
# and barely moves unless the user trades; weekly_range_snapshots holds
# live-priced Monday-open and Friday-close values written by
# worker.py's job_weekly_open_snapshot / job_weekly_close_snapshot, so this
# now reflects real market movement across the week (Diego's Aug 21 request).

_PORTFOLIO_REVIEW_LOOKBACK_DAYS = 8  # generous: covers "opened the push a few days late"


async def _portfolio_review_numbers(user_id: str) -> Optional[dict]:
    db = get_supabase()
    week_start = str(_week_start_monday(_today_et()))
    res = await run_query(
        db.table("weekly_range_snapshots")
        .select("snapshot_type,total_value")
        .eq("user_id", user_id)
        .eq("week_start", week_start)
    )
    rows = res.data or []
    close = next((r["total_value"] for r in rows if r["snapshot_type"] == "close"), None)
    open_ = next((r["total_value"] for r in rows if r["snapshot_type"] == "open"), None)
    # Mid-week (or the close job hasn't run yet) — fall back to the open
    # value as "current" so the card still shows something real rather than
    # nothing, same spirit as the old code's "opened the push a few days
    # late" lookback tolerance.
    total = close if close is not None else open_
    if total is None or total <= 0:
        return None

    top_sector = None
    sector_res = await run_query(
        db.table("fmg_portfolio_snapshots")
        .select("top_sector")
        .eq("user_id", user_id)
        .order("snapshot_date", desc=True)
        .limit(1)
    )
    if sector_res.data:
        top_sector = sector_res.data[0].get("top_sector")

    change_usd = change_pct = None
    if close is not None and open_:
        change_usd = close - open_
        change_pct = round(change_usd / open_ * 100, 2) if open_ else None
    return {
        "total_value": total,
        "change_usd": change_usd,
        "change_pct": change_pct,
        "top_sector": top_sector,
    }


async def get_portfolio_review(user_id: str, is_premium: bool) -> Optional[dict]:
    """Re-fetchable content for the Sunday Portfolio Review flashcard.
    Returns None when this user has no real snapshot yet (never a
    fabricated card). Free users get the real numbers (never hidden —
    they already own this data) but not `insight`, the AI-written
    takeaway sentence, which is the Premium-only value-add (Diego's Aug 16
    Free/Premium spec, §9: teaser only, never the full content)."""
    numbers = await _portfolio_review_numbers(user_id)
    if numbers is None:
        return None

    if not is_premium:
        return {**numbers, "insight": None, "is_premium": False}

    db = get_supabase()
    since = (datetime.now(timezone.utc) - timedelta(days=_PORTFOLIO_REVIEW_LOOKBACK_DAYS)).isoformat()
    log_res = await run_query(
        db.table("notification_log")
        .select("body,sent_at")
        .eq("user_id", user_id).eq("category", "sunday_portfolio_review")
        .gte("sent_at", since)
        .order("sent_at", desc=True)
        .limit(1)
    )
    insight = log_res.data[0]["body"] if log_res.data else None
    return {**numbers, "insight": insight, "is_premium": True}
