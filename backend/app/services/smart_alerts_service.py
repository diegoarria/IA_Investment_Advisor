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
    it. Pure cache/DB reads, zero fresh computation.

    Prefers the lightweight, AI-free signals cache (_nif_signals_cache_key
    — see build_nif_signals_only) over the full narrative NIF dashboard
    cache: the signals cache is refreshed daily by this job itself and
    never depends on some user having organically opened that ticker's
    dashboard, so it's both cheaper AND more reliably fresh. Falls back to
    the dashboard/quick-analysis caches for a ticker that has one from an
    organic view but no signals-only entry yet."""
    from app.core.cache import cache_get
    from app.api.routes.screener import _nif_dashboard_cache_key, _quick_analysis_cache_key
    from app.services.research.knowledge_store import get_company_timeline
    from app.services.research.thesis_engine import get_thesis_draft

    signals_cached = cache_get(_nif_signals_cache_key(ticker))
    nif_cached = cache_get(_nif_dashboard_cache_key(ticker, lang)) or cache_get(_nif_dashboard_cache_key(ticker, "es"))
    quick_cached = cache_get(_quick_analysis_cache_key(ticker, lang)) or cache_get(_quick_analysis_cache_key(ticker, "es"))
    events = await get_company_timeline(ticker, limit=20)
    draft = await get_thesis_draft(ticker)

    price = (signals_cached or {}).get("price")
    if price is None:
        price = (nif_cached or {}).get("price")
    if price is None:
        price = (quick_cached or {}).get("price")
    fair_value_range = (signals_cached or {}).get("fair_value_range")
    if fair_value_range is None:
        fair_value_range = ((nif_cached or {}).get("pillars") or {}).get("valuation", {}).get("nuvos_estimate", {}).get("fair_value_range")
    if fair_value_range is None:
        fair_value_range = (quick_cached or {}).get("fair_value_range")
    risks = [r.get("text") for r in ((draft or {}).get("key_risks") or []) if r.get("text")]

    return {
        "thesis_change": _detect_thesis_or_guidance(events, "strategy_change"),
        "guidance_change": _detect_thesis_or_guidance(events, "guidance_change"),
        "roic_fcf_deterioration": _detect_roic_fcf_direction(signals_cached or nif_cached),
        "new_risks_current": risks,
        "price_in_range_current": _detect_price_in_range(price, fair_value_range),
    }


_REFRESH_MIN_HOURS = 24   # same cost-discipline gate research_engine.py's dossier route uses
_REFRESH_TICKER_CAP = 80  # safety cap per run — hitting it is logged, never silently truncated forever


def _nif_signals_cache_key(ticker: str) -> str:
    return f"nif:signals_only:{ticker.upper()}"


_NIF_SIGNALS_CACHE_TTL = 86400  # 24h — matches _REFRESH_MIN_HOURS, cheap to recompute anyway (zero AI)


async def _refresh_dossier_if_stale(ticker: str, lang: str) -> None:
    """Cost fix, Sep 2026 — used to gate on ALL 4 knowledge snapshots and
    call the full compose_research_dossier (5 Claude calls: business/
    competitive/industry/management understanding + thesis draft) whenever
    ANY of them was stale. But the only thing this job's detectors read
    from the dossier is thesis_draft.key_risks (`new_risk` category) — the
    other 4 are pure narrative for the human-facing Dossier UI (see
    compose_thesis_only's docstring for the full audit trail). Gate on the
    thesis draft's OWN freshness and only regenerate that."""
    from app.services.research.knowledge_store import is_snapshot_fresh
    from app.services.research.thesis_engine import get_thesis_draft
    from app.services.research.research_orchestrator import compose_thesis_only

    draft = await get_thesis_draft(ticker)
    if is_snapshot_fresh(draft, _REFRESH_MIN_HOURS):
        return
    await compose_thesis_only(ticker, lang)


async def _refresh_nif_dashboard_if_stale(ticker: str, lang: str) -> None:
    """Cost fix, Sep 2026 — used to call the full build_nif_dashboard (6
    Claude calls: business/management quality explanations, quick
    valuation summary, moat/management deep dives, catalysts) whenever the
    cached dashboard's earnings period was stale. But this job's detectors
    (`roic_fcf_deterioration`, `price_in_range`) only ever read
    deterioration.factors and fair_value_range/price — none of which touch
    an LLM (see build_nif_signals_only's docstring for the full audit
    trail). Computes just that instead, cached under its own key
    (_nif_signals_cache_key) — deliberately NOT build_nif_dashboard's
    shared cache key, which would otherwise serve a narrative-less
    skeleton to the next real user who opens that ticker's NIF dashboard.
    That dashboard still gets a full, real refresh the normal way the
    first time an organic user opens it."""
    from app.api.routes.screener import _latest_reported_earnings_period
    from app.services import nif_service
    from app.core.cache import cache_get, cache_set
    import asyncio

    cache_key = _nif_signals_cache_key(ticker)
    cached = cache_get(cache_key)
    if cached:
        current_period = await asyncio.to_thread(_latest_reported_earnings_period, ticker)
        if not current_period or current_period == cached.get("_earnings_period"):
            return
    result = await asyncio.to_thread(nif_service.build_nif_signals_only, ticker)
    if result:
        result["_earnings_period"] = await asyncio.to_thread(_latest_reported_earnings_period, ticker)
        cache_set(cache_key, result, _NIF_SIGNALS_CACHE_TTL)


async def refresh_watchlist_signal_sources() -> None:
    """Weekdays, before the 4:20pm ET Smart Alerts check (see worker.py's
    job_refresh_smart_alerts_sources) — makes sure every Premium user's
    watchlist ticker has research data no older than _REFRESH_MIN_HOURS to
    diff against, instead of relying on someone organically opening that
    ticker's dossier/NIF dashboard. Without this, thesis_change/
    guidance_change/roic_fcf_deterioration/new_risk/price_in_range silently
    never fire for tickers nobody happens to view — the real gap flagged
    2026-08-30 in this module's own docstring.

    Only "es" is prewarmed, not both languages: the underlying signals this
    module diffs (event ids, deterioration "direction" labels, risk text
    sets, price-vs-range numbers) are language-independent data, not
    display copy — see deterioration_engine.py's `direction` field, which
    is a fixed "deteriorando"/"mejorando" literal regardless of the
    viewer's language. _gather_ticker_signals already falls back to the
    "es" cache entry when a user's own language variant isn't cached, so
    this halves the real Claude cost of this job without weakening
    detection for English-preferred users."""
    import asyncio
    import random
    from app.core.database import get_supabase, run_query
    from app.core.subscription import is_premium_active

    db = get_supabase()

    prefs_res = await run_query(
        db.table("notification_preferences").select(
            "user_id," + ",".join(_TOGGLE_COLUMN.values())
        ).or_(",".join(f"{col}.eq.true" for col in _TOGGLE_COLUMN.values()))
    )
    prefs_uids = {r["user_id"] for r in (prefs_res.data or [])}
    if not prefs_uids:
        return

    tier_res = await run_query(
        db.table("user_profiles")
        .select("user_id,subscription_tier,trial_started_at,streak_bonus_premium_until")
        .in_("user_id", list(prefs_uids))
    )
    premium_uids = {
        r["user_id"] for r in (tier_res.data or [])
        if is_premium_active(r.get("subscription_tier"), r.get("trial_started_at"), r.get("streak_bonus_premium_until"))
    }
    if not premium_uids:
        return

    watchlist_res = await run_query(
        db.table("watchlist").select("user_id,ticker").in_("user_id", list(premium_uids))
    )
    tickers = sorted({row["ticker"] for row in (watchlist_res.data or [])})
    if not tickers:
        return

    if len(tickers) > _REFRESH_TICKER_CAP:
        logger.warning(
            "refresh_watchlist_signal_sources: %d unique Premium watchlist tickers exceeds the %d/run safety cap "
            "— refreshing the first %d this run, rest stay on organic-view refresh until next run",
            len(tickers), _REFRESH_TICKER_CAP, _REFRESH_TICKER_CAP,
        )
        tickers = tickers[:_REFRESH_TICKER_CAP]

    for ticker in tickers:
        try:
            await _refresh_dossier_if_stale(ticker, "es")
        except Exception as exc:
            logger.warning("refresh_watchlist_signal_sources: dossier refresh failed for %s: %s", ticker, exc)
        try:
            await _refresh_nif_dashboard_if_stale(ticker, "es")
        except Exception as exc:
            logger.warning("refresh_watchlist_signal_sources: NIF dashboard refresh failed for %s: %s", ticker, exc)
        await asyncio.sleep(random.uniform(0.2, 0.5))


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
        return f"⚠️ {ticker}: tendencia a la baja", f"El ROIC o el margen de FCF de {ticker} viene deteriorándose en su historial reciente."
    if category == "new_risk":
        return f"🚩 {ticker}: nuevo riesgo en la tesis", kwargs.get("risk") or f"Se agregó un nuevo riesgo a la tesis de investigación de {ticker}."
    if category == "price_in_range":
        return f"🎯 {ticker} entró en su rango de valor razonable", f"El precio de {ticker} ahora está dentro del rango de valor razonable que calculó Nuvos."
    return ticker, ""
