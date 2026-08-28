"""
Smart Alerts Service — Fase 4, Incremento 10 (Alertas Inteligentes, Parte J
— see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Bridges signals Fase 2/3 ALREADY compute into push notifications — this
module detects NOTHING new. Every category below reads an existing engine
output and tracks "have I already notified this user about this exact real
value" via `smart_alert_state` (migration 067), a "store last-seen state,
notify on transition" pattern.

Deliberately only 5 of the original brief's 8 categories — "moat change"
and "capital allocation change" have no real detected-change signal
anywhere in the codebase (confirmed via audit before building this; adding
them would mean extending the Change Detection Engine's classifier, i.e.
new detection logic, which this phase's own rule forbids). Confirmed with
the user before scoping this increment down.

Category → real existing signal:
  thesis_change            → company_timeline_events, event_type =
                              "strategy_change" (Change Detection Engine)
  guidance_change           → company_timeline_events, event_type =
                              "guidance_change" (Change Detection Engine)
  roic_fcf_deterioration    → the cached NIF dashboard's
                              deterioration.factors — "roic"/"fcf_margin"
                              turning "deteriorando" (Deterioration Engine)
  new_risk                  → research_thesis_drafts.key_risks — a risk
                              text present now that wasn't in the last
                              seen list (Thesis Engine, no new AI call)
  price_in_range            → the cached NIF/quick-analysis
                              fair_value_range vs. the last cached price
                              (DCF, already computed)

Cache-only for the NIF/quick-analysis reads (never triggers a fresh
valuation run) — same discipline as watchlist.py's batch-scores endpoint
(Incremento 9). `price_in_range` therefore compares against whatever price
was cached the last time someone viewed that ticker's analysis, not a
fresh live quote — an accepted trade-off for a once-daily background job,
documented here rather than silently assumed.
"""

from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)

CATEGORIES = (
    "thesis_change", "guidance_change", "roic_fcf_deterioration", "new_risk", "price_in_range",
)

_TOGGLE_COLUMN = {
    "thesis_change": "push_thesis_changes",
    "guidance_change": "push_guidance_changes",
    "roic_fcf_deterioration": "push_roic_fcf_deterioration",
    "new_risk": "push_new_risks",
    "price_in_range": "push_price_in_range",
}


def _detect_thesis_or_guidance(events: list[dict], event_type: str) -> Optional[tuple[str, str]]:
    """Returns (id, headline) of the most recent real event of this type,
    or None if there isn't one — never fabricates an event."""
    matches = [e for e in events if e.get("event_type") == event_type]
    if not matches:
        return None
    latest = matches[0]  # events arrive already sorted most-recent-first
    return str(latest.get("id")), latest.get("headline") or ""


def _detect_roic_fcf_direction(nif_cached: Optional[dict]) -> Optional[str]:
    """The worse of ROIC/FCF-margin direction, straight from the
    Deterioration Engine's own factors — never re-derived here."""
    factors = ((nif_cached or {}).get("deterioration") or {}).get("factors") or []
    directions = {f.get("name"): f.get("direction") for f in factors}
    for key in ("roic", "fcf_margin"):
        if directions.get(key) == "deteriorando":
            return "deteriorando"
    for key in ("roic", "fcf_margin"):
        if directions.get(key) == "mejorando":
            return "mejorando"
    return None


def _detect_new_risks(current_risks: list[str], last_value: Optional[str]) -> Optional[list[str]]:
    """Risk texts present now that weren't in the last-seen serialized
    list — None (no notification) if there's no real previous state to
    diff against (first time seeing this ticker) or nothing new."""
    if last_value is None or not current_risks:
        return None
    previous = set(last_value.split("\x1f")) if last_value else set()
    new_ones = [r for r in current_risks if r and r not in previous]
    return new_ones or None


def _detect_price_in_range(price: Optional[float], fair_value_range: Optional[dict]) -> Optional[str]:
    """'in_range' | 'out_of_range' | None (no real price/range to judge)."""
    if price is None or not fair_value_range:
        return None
    low, high = fair_value_range.get("low"), fair_value_range.get("high")
    if low is None or high is None:
        return None
    return "in_range" if low <= price <= high else "out_of_range"


def _serialize_risks(risks: list[str]) -> str:
    return "\x1f".join(risks)


async def _gather_ticker_signals(ticker: str, lang: str = "es") -> dict:
    """Every real value this job can compare against state for ONE ticker
    — computed once per ticker per run regardless of how many users watch
    it. Pure cache/DB reads, zero fresh computation."""
    from app.core.cache import cache_get
    from app.api.routes.screener import _nif_dashboard_cache_key, _quick_analysis_cache_key
    from app.services.research.knowledge_store import get_company_timeline
    from app.services.research.thesis_engine import get_thesis_draft

    nif_cached = cache_get(_nif_dashboard_cache_key(ticker, lang)) or cache_get(_nif_dashboard_cache_key(ticker, "es"))
    quick_cached = cache_get(_quick_analysis_cache_key(ticker, lang)) or cache_get(_quick_analysis_cache_key(ticker, "es"))
    events = await get_company_timeline(ticker, limit=20)
    draft = await get_thesis_draft(ticker)

    price = (nif_cached or {}).get("price")
    if price is None:
        price = (quick_cached or {}).get("price")
    fair_value_range = ((nif_cached or {}).get("pillars") or {}).get("valuation", {}).get("nuvos_estimate", {}).get("fair_value_range")
    if fair_value_range is None:
        fair_value_range = (quick_cached or {}).get("fair_value_range")
    risks = [r.get("text") for r in ((draft or {}).get("key_risks") or []) if r.get("text")]

    return {
        "thesis_change": _detect_thesis_or_guidance(events, "strategy_change"),
        "guidance_change": _detect_thesis_or_guidance(events, "guidance_change"),
        "roic_fcf_deterioration": _detect_roic_fcf_direction(nif_cached),
        "new_risks_current": risks,
        "price_in_range_current": _detect_price_in_range(price, fair_value_range),
    }


async def run_smart_alerts_check() -> None:
    """Daily job (see worker.py's job_smart_alerts): for every (user,
    watchlist ticker) pair where the user has at least one relevant push
    toggle enabled, checks each enabled category's real current value
    against smart_alert_state and pushes ONE notification per user for the
    single most relevant newly-detected change — same
    one-push-per-category-per-day discipline `notification_engine.
    can_send_push` already enforces, and the same "pick the single best
    candidate, others get picked up next run" philosophy."""
    import asyncio
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push

    db = get_supabase()

    prefs_res = await run_query(
        db.table("notification_preferences").select(
            "user_id," + ",".join(_TOGGLE_COLUMN.values())
        ).or_(",".join(f"{col}.eq.true" for col in _TOGGLE_COLUMN.values()))
    )
    prefs_by_user = {r["user_id"]: r for r in (prefs_res.data or [])}
    if not prefs_by_user:
        return

    watchlist_res = await run_query(
        db.table("watchlist").select("user_id,ticker").in_("user_id", list(prefs_by_user.keys()))
    )
    watchlist_rows = watchlist_res.data or []
    if not watchlist_rows:
        return

    lang_res = await run_query(db.table("user_profiles").select("user_id,preferred_language"))
    lang_map = {r["user_id"]: (r.get("preferred_language") or "es") for r in (lang_res.data or [])}

    # Smart Alerts is 100% Premium (Diego's Aug 16 Free/Premium spec, §7) —
    # state is still tracked for free users below (so a later upgrade
    # doesn't dump a backlog of stale "new" alerts on them), but the push
    # itself must never reach a free user.
    from app.core.subscription import is_premium_active
    tier_res = await run_query(
        db.table("user_profiles")
        .select("user_id,subscription_tier,trial_started_at,streak_bonus_premium_until")
        .in_("user_id", list(prefs_by_user.keys()))
    )
    premium_user_ids = {
        r["user_id"] for r in (tier_res.data or [])
        if is_premium_active(r.get("subscription_tier"), r.get("trial_started_at"), r.get("streak_bonus_premium_until"))
    }

    tickers = sorted({row["ticker"] for row in watchlist_rows})
    signals_list = await asyncio.gather(*[_gather_ticker_signals(t) for t in tickers])
    signals_by_ticker = dict(zip(tickers, signals_list))

    state_res = await run_query(
        db.table("smart_alert_state").select("*").in_("user_id", list(prefs_by_user.keys()))
    )
    state_by_key = {(r["user_id"], r["ticker"], r["category"]): r for r in (state_res.data or [])}

    by_user: dict[str, list[dict]] = {}
    for row in watchlist_rows:
        by_user.setdefault(row["user_id"], []).append(row)

    for user_id, user_rows in by_user.items():
        prefs = prefs_by_user.get(user_id, {})
        candidates = []  # (priority, ticker, category, copy_kwargs, new_last_value)

        for row in user_rows:
            ticker = row["ticker"]
            signals = signals_by_ticker.get(ticker) or {}

            if prefs.get("push_thesis_changes") and signals.get("thesis_change"):
                event_id, headline = signals["thesis_change"]
                prior = state_by_key.get((user_id, ticker, "thesis_change"))
                if prior is None or prior.get("last_value") != event_id:
                    candidates.append((3, ticker, "thesis_change", {"headline": headline}, event_id))

            if prefs.get("push_guidance_changes") and signals.get("guidance_change"):
                event_id, headline = signals["guidance_change"]
                prior = state_by_key.get((user_id, ticker, "guidance_change"))
                if prior is None or prior.get("last_value") != event_id:
                    candidates.append((3, ticker, "guidance_change", {"headline": headline}, event_id))

            if prefs.get("push_roic_fcf_deterioration") and signals.get("roic_fcf_deterioration") == "deteriorando":
                prior = state_by_key.get((user_id, ticker, "roic_fcf_deterioration"))
                if prior is None or prior.get("last_value") != "deteriorando":
                    candidates.append((2, ticker, "roic_fcf_deterioration", {}, "deteriorando"))
            elif prefs.get("push_roic_fcf_deterioration") and signals.get("roic_fcf_deterioration") == "mejorando":
                prior = state_by_key.get((user_id, ticker, "roic_fcf_deterioration"))
                if prior and prior.get("last_value") == "deteriorando":
                    # clears the "deteriorating" state silently (no push for the recovery itself)
                    candidates.append((0, ticker, "roic_fcf_deterioration", None, "mejorando"))

            if prefs.get("push_new_risks"):
                prior = state_by_key.get((user_id, ticker, "new_risk"))
                current_risks = signals.get("new_risks_current") or []
                new_ones = _detect_new_risks(current_risks, prior.get("last_value") if prior else None)
                if new_ones:
                    candidates.append((2, ticker, "new_risk", {"risk": new_ones[0]}, _serialize_risks(current_risks)))
                elif current_risks and prior is None:
                    # first time seeing this ticker — record the baseline, no push
                    candidates.append((0, ticker, "new_risk", None, _serialize_risks(current_risks)))

            if prefs.get("push_price_in_range"):
                current = signals.get("price_in_range_current")
                if current:
                    prior = state_by_key.get((user_id, ticker, "price_in_range"))
                    if current == "in_range" and (prior is None or prior.get("last_value") != "in_range"):
                        candidates.append((1, ticker, "price_in_range", {}, current))
                    elif prior is None or prior.get("last_value") != current:
                        candidates.append((0, ticker, "price_in_range", None, current))

        if not candidates:
            continue

        # State updates happen for every real candidate (even the ones that
        # don't win the single daily push) — nothing is lost, a losing
        # candidate just doesn't re-win on a later run since its state is
        # already current.
        for _, ticker, category, _copy, new_value in candidates:
            try:
                await run_query(
                    db.table("smart_alert_state").upsert(
                        {"user_id": user_id, "ticker": ticker, "category": category, "last_value": new_value},
                        on_conflict="user_id,ticker,category",
                    )
                )
            except Exception as exc:
                logger.warning("run_smart_alerts_check: state upsert failed for %s/%s/%s: %s", user_id, ticker, category, exc)

        pushable = [c for c in candidates if c[3] is not None]
        if not pushable:
            continue
        priority, ticker, category, copy_kwargs, _ = max(pushable, key=lambda c: c[0])
        lang = lang_map.get(user_id, "es")
        title, body = _alert_copy(ticker, category, copy_kwargs, lang)

        if user_id not in premium_user_ids:
            # Free: no push delivered (§7 — 100% Premium), but the real
            # detection still gets a persisted, cross-process-readable
            # record so the teaser ("Arthur detectó N cosas...") can source
            # a real number from notification_log instead of a fabricated
            # one — see get_smart_alerts_teaser below.
            from app.services.notification_engine import _log_notification
            try:
                await _log_notification(db, user_id, "teaser", f"smart_alert_{category}", title, body, {"ticker": ticker}, "skipped")
            except Exception as exc:
                logger.warning("run_smart_alerts_check: teaser log failed for %s/%s/%s: %s", user_id, ticker, category, exc)
            continue

        try:
            await send_push(user_id, f"smart_alert_{category}", title, body, {"screen": "subvaluadas", "ticker": ticker}, db)
        except Exception as exc:
            logger.warning("run_smart_alerts_check: push failed for %s/%s/%s: %s", user_id, ticker, category, exc)


async def get_smart_alerts_teaser(user_id: str, days: int = 7) -> int:
    """Real count of smart-alert-worthy detections (pushed to Premium
    users, silently logged for Free — see run_smart_alerts_check above) in
    the trailing `days` days. Never fabricated — 0 stays 0 (Diego's Aug 16
    spec, §7: "0 alertas → no mostrar artificialmente un número")."""
    from datetime import datetime, timedelta, timezone
    from app.core.database import get_supabase, run_query

    db = get_supabase()
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    res = await run_query(
        db.table("notification_log")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .like("category", "smart_alert_%")
        .gte("sent_at", since)
    )
    return res.count or 0


def _alert_copy(ticker: str, category: str, kwargs: dict, lang: str) -> tuple[str, str]:
    if lang == "en":
        if category == "thesis_change":
            return f"📋 {ticker}: strategy change detected", kwargs.get("headline") or f"{ticker}'s research timeline recorded a strategy change."
        if category == "guidance_change":
            return f"📊 {ticker}: guidance change detected", kwargs.get("headline") or f"{ticker}'s research timeline recorded a guidance change."
        if category == "roic_fcf_deterioration":
            return f"⚠️ {ticker}: ROIC/FCF trending down", f"{ticker}'s ROIC or FCF margin has been trending downward over its recent history."
        if category == "new_risk":
            return f"🚩 {ticker}: new risk in the thesis", kwargs.get("risk") or f"A new risk was added to {ticker}'s research thesis."
        if category == "price_in_range":
            return f"🎯 {ticker} entered its fair value range", f"{ticker}'s price is now inside the fair value range Nuvos calculated."
        return ticker, ""
    if category == "thesis_change":
        return f"📋 {ticker}: cambio de estrategia detectado", kwargs.get("headline") or f"El timeline de investigación de {ticker} registró un cambio de estrategia."
    if category == "guidance_change":
        return f"📊 {ticker}: cambio de guidance detectado", kwargs.get("headline") or f"El timeline de investigación de {ticker} registró un cambio de guidance."
    if category == "roic_fcf_deterioration":
        return f"⚠️ {ticker}: ROIC/FCF en baja", f"El ROIC o el margen de FCF de {ticker} viene deteriorándose en su historial reciente."
    if category == "new_risk":
        return f"🚩 {ticker}: nuevo riesgo en la tesis", kwargs.get("risk") or f"Se agregó un nuevo riesgo a la tesis de investigación de {ticker}."
    if category == "price_in_range":
        return f"🎯 {ticker} entró a su rango de valor razonable", f"El precio de {ticker} ahora está dentro del rango de valor razonable que calculó Nuvos."
    return ticker, ""
