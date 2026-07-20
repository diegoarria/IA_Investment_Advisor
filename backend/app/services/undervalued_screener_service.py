"""
Undervalued Stocks Screener
============================
Runs the real deterministic DCF/fundamental-analysis engine
(fundamental_analysis_service.get_fundamental_analysis) across the curated
ticker universe (screener.py's UNIVERSE) and caches the ones with a real
positive margin of safety — this is a genuinely different tool than the
existing screener.py endpoints, which layer an LLM narrative over live
Finnhub metrics, not the DCF engine.

Precomputed on a weekly schedule (see worker.py's job_refresh_undervalued_
screener) because get_fundamental_analysis makes several real API calls per
ticker — running it live across ~150 tickers on every request would be far
too slow. The user-facing read (get_undervalued) is cache-only, fast.

Two self-heal mechanisms guarantee the list is never empty (a fresh deploy,
a flushed cache, or a missed weekly run should never show a blank screen):
1. worker.py runs a full refresh once at startup if the cache is empty,
   instead of waiting for the next scheduled Sunday run.
2. The read path (get_undervalued, called from the API endpoint and the
   chat trigger) triggers a smaller, faster BOOTSTRAP scan (a subset of the
   universe) synchronously if the cache is still completely empty — slower
   than a normal cache read, but only ever happens once, and the full
   weekly job overwrites it with the complete/accurate scan on schedule.
"""

from __future__ import annotations

import copy
import logging
from typing import Optional

from app.core.cache import cache_set, cache_get_with_ts

logger = logging.getLogger(__name__)

CACHE_KEY = "undervalued_screener:v1"
CACHE_TTL = 8 * 24 * 3600      # slightly over a week — one missed weekly run doesn't go stale/empty
BOOTSTRAP_TTL = 24 * 3600      # short-lived — the next full weekly/startup refresh supersedes this
_BOOTSTRAP_LIMIT = 20          # small subset so a cold-cache request stays reasonably fast
_MAX_PER_SECTOR = 5            # never more than 5 candidates from the same sector in the results shown


_WEAK_DIMENSION_THRESHOLD = 40  # below this on any of these dimensions, flag it — a real value-trap signal, not just "cheap"
_WEAK_DIMENSIONS = [
    ("financial_strength", "Financial Strength"),
    ("predictability", "Predictability"),
]


def _weak_dimension(thesis_scores: Optional[dict]) -> Optional[dict]:
    """Real signal (from the same Investment Thesis Scorecard already
    computed, not a new estimate) that a high margin of safety might be a
    value trap rather than a genuine bargain — flags the weakest dimension
    below the threshold. Returns the raw {label, score} instead of a
    formatted string so the caller can render it in the requested language
    at read time (see _format_weak_dimension_warning) rather than baking a
    single language in at scan time."""
    if not thesis_scores:
        return None
    worst_label, worst_score = None, 100
    for key, label in _WEAK_DIMENSIONS:
        score = thesis_scores.get(key)
        if score is not None and score < _WEAK_DIMENSION_THRESHOLD and score < worst_score:
            worst_label, worst_score = label, score
    return {"label": worst_label, "score": worst_score} if worst_label else None


def _format_weak_dimension_warning(weak_dimension: Optional[dict], lang: str) -> Optional[str]:
    if not weak_dimension:
        return None
    suffix = "low" if lang == "en" else "bajo"
    return f"{weak_dimension['label']} {suffix} ({weak_dimension['score']}/100)"


def _scan(tickers: list[dict], analysis_cache: Optional[dict[str, Optional[dict]]] = None) -> list[dict]:
    """Runs the real DCF engine over the given ticker entries, keeps only
    positive-margin-of-safety results, sorted descending. Per-ticker
    try/except — one bad ticker must never abort the whole batch. This is
    blocking (real HTTP calls) — callers on the async side must wrap it in
    asyncio.to_thread.

    `analysis_cache`, when passed, is populated with EVERY scanned ticker's
    full analysis (not just the positive-margin-of-safety survivors kept in
    the return value) — a scan of the whole curated universe already
    computes most of what Method 3 (Relative Valuation)'s peer lookups need
    later in the same refresh, so this avoids re-fetching a same-sector
    peer that just isn't itself undervalued right now."""
    from app.services.fundamental_analysis_service import get_fundamental_analysis

    results = []
    for entry in tickers:
        try:
            data = get_fundamental_analysis(entry["ticker"])
            if analysis_cache is not None:
                analysis_cache[entry["ticker"]] = data
            dcf = data.get("dcf") if data else None
            mos = dcf.get("margin_of_safety_pct") if dcf else None
            if dcf and mos is not None and mos > 0:
                thesis_scores = data.get("thesis_scores")
                results.append({
                    "ticker": entry["ticker"],
                    "company_name": data.get("company_name"),
                    "sector": entry.get("sector"),
                    "price": data.get("current_price"),
                    "intrinsic_value_base": dcf["scenarios"]["base"]["intrinsic_value_per_share"],
                    "margin_of_safety_pct": mos,
                    "composite_score": data.get("composite_score"),
                    "fair_value_range": dcf.get("fair_value_range"),
                    "confidence_meter": dcf.get("confidence_meter"),
                    "momentum": None,  # only computed in the full weekly refresh (see refresh_undervalued_screener) — real historical-price fetch, too costly for the bootstrap subset scan
                    "thesis_scores": thesis_scores,
                    "weak_dimension": _weak_dimension(thesis_scores),
                    "liquidity_gate": data.get("liquidity_gate"),
                    # AI text (blurb + checklist reasons), keyed by language —
                    # filled in during the full weekly refresh only (see
                    # refresh_undervalued_screener). get_undervalued() reads
                    # the requested language at serve time.
                    "blurb_by_lang": {},
                    "business_understanding_by_lang": {},
                    "checklist_reasons_by_lang": {},
                    "checklist_items_real": data.get("checklist_items_real") or [],
                })
        except Exception as exc:
            logger.warning("undervalued_screener_service: %s failed: %s", entry["ticker"], exc)
    # "Best Overall" default — the composite score (real business quality +
    # financial strength + predictability + growth + management, not just
    # discount) beats sorting by margin of safety alone, which rewards a
    # value trap just as readily as a real opportunity. Falls back to
    # margin of safety only for the rare case composite_score couldn't be
    # computed (missing thesis_scores), so a result is never silently
    # dropped for lack of one derived field.
    results.sort(key=lambda r: (r["composite_score"] if r["composite_score"] is not None else -1, r["margin_of_safety_pct"]), reverse=True)
    return results


_CHECKLIST_REASON_KEYS = ["moat", "business_quality", "management_capital_allocation", "financial_strength", "growth_predictability", "valuation"]
_SUPPORTED_LANGS = ("es", "en")


def _finalize_checklist(entry: dict, business_understanding: Optional[dict] = None, checklist_reasons: Optional[dict] = None) -> None:
    """Merges checklist item 1 ("Entender el negocio"/"Understanding the
    business" — Claude's judgment, or None if not evaluated) with items 2-7
    (real "stars" ratings, 1-5, computed by fundamental_analysis_service.
    _build_checklist_items) into the final 7-item checklist + average-stars
    score, mutating `entry` in place. If Claude returned `checklist_reasons`
    (see ai_service._CHECKLIST_INSTRUCTIONS), those nuanced ~70-word
    explanations OVERWRITE items 2-7's templated "reason" text — never their
    "stars" rating, which stays the real, deterministic value. The
    internal-only `evidence` field (raw numbers fed to Claude) is stripped
    before the checklist reaches the frontend. Only called on a per-request
    COPY of a cached entry (see get_undervalued) — never on the shared
    cached object, since it destructively pops `checklist_items_real` and
    this needs to run once per requested language, not once ever.

    Uses average stars (not "X/7 passed") deliberately — counting pass/fail
    made an excellent-but-currently-expensive business (e.g. PepsiCo: real
    moat, real quality, just not cheap right now) read as "mediocre" to
    users, the opposite of what the underlying scores say. See
    fundamental_analysis_service._stars_from_score's docstring."""
    items = list(entry.pop("checklist_items_real", []))
    checklist_reasons = checklist_reasons or {}
    for item, key in zip(items, _CHECKLIST_REASON_KEYS):
        reason_text = checklist_reasons.get(key)
        if reason_text:
            item["reason"] = reason_text
        item.pop("evidence", None)
    items.insert(0, business_understanding or {
        "key": "business_understanding",
        "name": "Entender el negocio",
        "stars": None,
        "reason": "No evaluado en esta carga rápida.",
    })
    rated = [it["stars"] for it in items if it.get("stars") is not None]
    avg_stars = round(sum(rated) / len(rated), 1) if rated else None
    entry["checklist"] = {"items": items, "avg_stars": avg_stars}


async def refresh_undervalued_screener() -> None:
    """Full weekly refresh — the entire curated universe. Applies the
    per-sector cap (_MAX_PER_SECTOR) here (not just at read time) so the
    one-liner blurb generation below only runs for candidates that will
    actually be shown, not every positive-margin-of-safety ticker in the
    universe — keeps the weekly Claude cost bounded (≤5 per sector).

    Generates the AI text (blurb, business-understanding judgment, checklist
    reasons) ONCE PER SUPPORTED LANGUAGE per candidate — doubling the Claude
    calls here (still a weekly batch job, not a live request) is how English
    UI users get real, non-mixed-language checklist text instead of either
    always seeing Spanish or paying for a live translation call per read.
    Nothing is finalized into a single "checklist" here — that merge
    happens per-request, per-language, in get_undervalued()."""
    from app.api.routes.screener import UNIVERSE
    analysis_cache: dict[str, Optional[dict]] = {}
    results = _scan(UNIVERSE, analysis_cache=analysis_cache)
    results = _cap_per_sector(results, _MAX_PER_SECTOR)

    # Methods 3 (Relative), 4 (Historical) and 5 (Consensus) of the
    # valuation engine — deliberately only run here, on the already-capped
    # candidate list (~30-40 tickers), never in the live quick-analysis
    # path: Method 3 alone means a full analysis per real peer, and Method 4
    # means a real historical-price fetch — exactly the kind of per-request
    # cost this weekly batch job exists to amortize instead.
    from app.services.relative_valuation_service import compute_relative_valuation
    from app.services.historical_valuation_service import compute_historical_valuation
    from app.services.consensus_valuation_service import classify_archetype, compute_consensus_fair_value
    from app.services.fundamental_analysis_service import _is_financial_sector, _sector_cyclicality_dampener, get_financials

    for entry in results:
        try:
            candidate_data = analysis_cache.get(entry["ticker"]) or {}
            dcf = candidate_data.get("dcf") or {}
            thesis_scores = candidate_data.get("thesis_scores") or {}
            price = entry.get("price")
            shares_out = dcf.get("shares_outstanding") or dcf.get("shares_out")
            total_debt = candidate_data.get("total_debt") or 0
            cash = candidate_data.get("cash") or 0
            sector = entry.get("sector")

            fin = get_financials(entry["ticker"], limit=10)
            income = fin.get("incomeStatement", {}).get("annual", [])
            balance = fin.get("balanceSheet", {}).get("annual", [])
            cashflow = fin.get("cashFlow", {}).get("annual", [])
            n = min(len(income), len(balance), len(cashflow))
            income, balance, cashflow = income[-n:], balance[-n:], cashflow[-n:]
            latest_income = income[-1] if income else {}
            latest_eps = latest_income.get("Diluted EPS") or latest_income.get("Basic EPS")
            latest_ebitda = latest_income.get("EBITDA")
            fcf_trend_vals = [v for v in (candidate_data.get("fcf_trend") or []) if v is not None]
            latest_fcf = fcf_trend_vals[-1] if fcf_trend_vals else None
            industry = next((u["industry"] for u in UNIVERSE if u["ticker"] == entry["ticker"]), None)

            relative = None
            historical = None
            if price and shares_out:
                relative = compute_relative_valuation(
                    entry["ticker"], price, shares_out, latest_eps, latest_ebitda, latest_fcf,
                    total_debt, cash, sector, industry, analysis_cache=analysis_cache,
                )
                if n >= 5:
                    historical = compute_historical_valuation(
                        entry["ticker"], income, balance, cashflow, price, shares_out, total_debt, cash,
                        latest_eps, latest_ebitda, latest_fcf,
                    )

            archetype = classify_archetype(
                _is_financial_sector(sector), thesis_scores.get("business_quality"),
                thesis_scores.get("predictability"), _sector_cyclicality_dampener(sector),
            )
            scenarios = dcf.get("scenarios") or {}
            conservative_dcf_value = (scenarios.get("pessimistic") or {}).get("intrinsic_value_per_share")
            professional_dcf_value = (scenarios.get("base") or {}).get("intrinsic_value_per_share")
            consensus = compute_consensus_fair_value(archetype, conservative_dcf_value, professional_dcf_value, relative, historical)

            entry["relative_valuation"] = relative
            entry["historical_valuation"] = historical
            entry["consensus_valuation"] = consensus
        except Exception as exc:
            logger.warning("undervalued_screener_service: valuation engine (methods 3-5) failed for %s: %s", entry["ticker"], exc)
            entry["relative_valuation"] = None
            entry["historical_valuation"] = None
            entry["consensus_valuation"] = None

        try:
            entry["momentum"] = _compute_momentum(entry["ticker"], entry.get("price"))
        except Exception as exc:
            logger.warning("undervalued_screener_service: momentum failed for %s: %s", entry["ticker"], exc)
            entry["momentum"] = None

    from app.services.ai_service import generate_candidate_blurb
    for entry in results:
        for lang in _SUPPORTED_LANGS:
            try:
                blurb_result = await generate_candidate_blurb(entry, lang=lang)
                entry["blurb_by_lang"][lang] = blurb_result.get("blurb")
                entry["business_understanding_by_lang"][lang] = {
                    "key": "business_understanding",
                    "name": "Entender el negocio" if lang == "es" else "Understanding the business",
                    "stars": blurb_result.get("business_understanding_stars"),
                    "reason": blurb_result.get("business_understanding_reason", ""),
                }
                entry["checklist_reasons_by_lang"][lang] = blurb_result.get("checklist_reasons") or {}
            except Exception as exc:
                logger.warning("undervalued_screener_service: blurb (%s) failed for %s: %s", lang, entry["ticker"], exc)

    cache_set(CACHE_KEY, results, CACHE_TTL)
    logger.info("undervalued_screener_service: refreshed, %d/%d tickers had positive margin of safety", len(results), len(UNIVERSE))


async def refresh_if_empty_on_startup() -> None:
    """Called once when worker.py boots — if the cache is already empty
    (fresh deploy, flushed Redis, or the weekly job hasn't run yet), do the
    FULL refresh immediately instead of waiting for the next scheduled
    Sunday run. A no-op if the cache already has data."""
    _, ts = cache_get_with_ts(CACHE_KEY)
    if ts:
        return
    logger.info("undervalued_screener_service: cache empty at worker startup, refreshing now")
    await refresh_undervalued_screener()


def bootstrap_fill_if_empty_sync() -> None:
    """Blocking. Called from the read path (API endpoint / chat trigger)
    when the cache is completely empty — scans a small subset of the
    universe so the screener never shows a blank list, even before the
    worker's startup/weekly refresh has had a chance to run. Cached with a
    short TTL so the next full refresh (worker startup or the Sunday job)
    overwrites it with the complete, accurate scan."""
    from app.api.routes.screener import UNIVERSE
    results = _scan(UNIVERSE[:_BOOTSTRAP_LIMIT])
    results = _cap_per_sector(results, _MAX_PER_SECTOR)
    # Deliberately NOT finalized here (no AI calls, no language pref known
    # yet at this layer) — left in the same un-finalized shape as a full
    # refresh's results, so get_undervalued()'s per-request/per-language
    # finalize step works identically regardless of which path populated
    # the cache. Real checklist "reason" text still shows the deterministic
    # Python templates until the next full refresh replaces this bootstrap
    # entry with real AI-generated text in both languages.
    if results:
        cache_set(CACHE_KEY, results, BOOTSTRAP_TTL)
        logger.info("undervalued_screener_service: bootstrap-filled %d results from a %d-ticker subset", len(results), _BOOTSTRAP_LIMIT)


def _compute_momentum(ticker: str, current_price: Optional[float]) -> Optional[dict]:
    """Real short/medium-term price-momentum signal for the "Momentum Turns"
    ranking lens, computed from actual historical closes (financial_data_
    service.get_historical_prices_near_dates — the same real FMP historical-
    price endpoint Method 4 uses), never invented. `turn_score` is
    return_1m_pct - return_6m_pct: positive when a stock has been recovering
    recently (up over the last month) after a longer decline (down over the
    last six months) — a genuine "turning around while still cheap" signal,
    distinct from raw momentum-chasing. Returns None (never a fabricated 0)
    if either real historical price is unavailable."""
    if not current_price:
        return None
    import datetime
    from app.services.financial_data_service import get_historical_prices_near_dates

    today = datetime.date.today()
    date_1m = (today - datetime.timedelta(days=30)).isoformat()
    date_6m = (today - datetime.timedelta(days=182)).isoformat()
    try:
        prices = get_historical_prices_near_dates(ticker, [date_1m, date_6m])
    except Exception:
        return None
    price_1m, price_6m = prices.get(date_1m), prices.get(date_6m)
    if not price_1m or not price_6m:
        return None
    return_1m_pct = round((current_price - price_1m) / price_1m * 100, 1)
    return_6m_pct = round((current_price - price_6m) / price_6m * 100, 1)
    return {
        "return_1m_pct": return_1m_pct,
        "return_6m_pct": return_6m_pct,
        "turn_score": round(return_1m_pct - return_6m_pct, 1),
    }


def _cap_per_sector(results: list[dict], max_per_sector: int) -> list[dict]:
    """Keeps at most `max_per_sector` entries per sector — results are
    already sorted by margin of safety descending, so this keeps each
    sector's BEST candidates, not an arbitrary subset. A sector with fewer
    than max_per_sector real candidates just contributes fewer — never
    padded to reach the cap."""
    counts: dict[str, int] = {}
    capped = []
    for r in results:
        sector = r.get("sector") or "N/D"
        counts[sector] = counts.get(sector, 0) + 1
        if counts[sector] <= max_per_sector:
            capped.append(r)
    return capped


def get_undervalued(limit: int = 60, sector: Optional[str] = None, lang: str = "es") -> dict:
    """Fast, cache-only read. `generated_at` (unix timestamp, 0 if the cache
    is empty) lets callers disclose honestly how stale the snapshot is.
    Callers should call bootstrap_fill_if_empty_sync() first if they need a
    guarantee of non-empty results (see screener.py's endpoint and chat.py's
    context-block builder). Caps at 5 candidates per sector (real ones only
    — a sector with fewer than 5 qualifying stocks just shows fewer).

    The cache stores AI text keyed by language (see refresh_undervalued_
    screener) — this is where the requested `lang` is actually applied,
    on a per-request DEEP COPY of each cached entry (never mutating the
    shared cached object, since the same cache entry is finalized
    differently for an "es" request and an "en" request)."""
    lang = lang if lang in _SUPPORTED_LANGS else "es"
    results, ts = cache_get_with_ts(CACHE_KEY)
    results = results or []
    if sector:
        results = [r for r in results if (r.get("sector") or "").lower() == sector.lower()]
    results = _cap_per_sector(results, _MAX_PER_SECTOR)

    finalized = []
    for r in results[:limit]:
        # One malformed/stale cached entry (e.g. from an older cache-schema
        # version) must never take down the entire list — same "one bad
        # ticker can't abort the batch" rule already used in _scan().
        try:
            entry = copy.deepcopy(r)
            blurb_by_lang = entry.pop("blurb_by_lang", {}) or {}
            business_understanding_by_lang = entry.pop("business_understanding_by_lang", {}) or {}
            checklist_reasons_by_lang = entry.pop("checklist_reasons_by_lang", {}) or {}
            weak_dimension = entry.pop("weak_dimension", None)

            entry["blurb"] = blurb_by_lang.get(lang) or blurb_by_lang.get("es")
            entry["weak_dimension_warning"] = _format_weak_dimension_warning(weak_dimension, lang)
            # checklist_items_real may already be gone if this entry was
            # finalized once by an older cache version — nothing to merge in
            # that case, "checklist" (if present) is left as-is.
            if "checklist_items_real" in entry:
                _finalize_checklist(
                    entry,
                    business_understanding_by_lang.get(lang) or business_understanding_by_lang.get("es"),
                    checklist_reasons_by_lang.get(lang) or checklist_reasons_by_lang.get("es"),
                )
            finalized.append(entry)
        except Exception as exc:
            logger.warning("get_undervalued: skipping malformed cached entry for %s: %s", r.get("ticker"), exc)

    return {"results": finalized, "generated_at": ts}
