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


def _weak_dimension_warning(thesis_scores: Optional[dict]) -> Optional[str]:
    """Real signal (from the same Investment Thesis Scorecard already
    computed, not a new estimate) that a high margin of safety might be a
    value trap rather than a genuine bargain — flags the weakest dimension
    below the threshold so the UI can show a concrete reason, not just a
    generic warning icon."""
    if not thesis_scores:
        return None
    worst_label, worst_score = None, 100
    for key, label in _WEAK_DIMENSIONS:
        score = thesis_scores.get(key)
        if score is not None and score < _WEAK_DIMENSION_THRESHOLD and score < worst_score:
            worst_label, worst_score = label, score
    return f"{worst_label} bajo ({worst_score}/100)" if worst_label else None


def _scan(tickers: list[dict]) -> list[dict]:
    """Runs the real DCF engine over the given ticker entries, keeps only
    positive-margin-of-safety results, sorted descending. Per-ticker
    try/except — one bad ticker must never abort the whole batch. This is
    blocking (real HTTP calls) — callers on the async side must wrap it in
    asyncio.to_thread."""
    from app.services.fundamental_analysis_service import get_fundamental_analysis

    results = []
    for entry in tickers:
        try:
            data = get_fundamental_analysis(entry["ticker"])
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
                    "thesis_scores": thesis_scores,
                    "weak_dimension_warning": _weak_dimension_warning(thesis_scores),
                    "blurb": None,  # filled in during the full weekly refresh only (see refresh_undervalued_screener)
                    "checklist_items_real": data.get("checklist_items_real") or [],
                })
        except Exception as exc:
            logger.warning("undervalued_screener_service: %s failed: %s", entry["ticker"], exc)
    results.sort(key=lambda r: -r["margin_of_safety_pct"])
    return results


_CHECKLIST_REASON_KEYS = ["moat", "business_quality", "management_capital_allocation", "financial_strength", "growth_predictability", "valuation"]


def _finalize_checklist(entry: dict, business_understanding: Optional[dict] = None, checklist_reasons: Optional[dict] = None) -> None:
    """Merges checklist item 1 ("Entender el negocio" — Claude's judgment,
    or None if not evaluated) with items 2-7 (real "passed" flags, computed
    by fundamental_analysis_service._build_checklist_items) into the final
    7-item checklist + "X/7" score, mutating `entry` in place. If Claude
    returned `checklist_reasons` (see ai_service._CHECKLIST_INSTRUCTIONS),
    those nuanced ~70-word explanations OVERWRITE items 2-7's templated
    "reason" text — never their "passed" flag, which stays the real,
    deterministic threshold. The internal-only `evidence` field (raw numbers
    fed to Claude) is stripped before the checklist reaches the frontend."""
    items = list(entry.pop("checklist_items_real", []))
    checklist_reasons = checklist_reasons or {}
    for item, key in zip(items, _CHECKLIST_REASON_KEYS):
        reason_text = checklist_reasons.get(key)
        if reason_text:
            item["reason"] = reason_text
        item.pop("evidence", None)
    items.insert(0, business_understanding or {
        "name": "Entender el negocio",
        "passed": None,
        "reason": "No evaluado en esta carga rápida.",
    })
    passed = sum(1 for it in items if it.get("passed") is True)
    entry["checklist"] = {"items": items, "score": f"{passed}/{len(items)}"}


async def refresh_undervalued_screener() -> None:
    """Full weekly refresh — the entire curated universe. Applies the
    per-sector cap (_MAX_PER_SECTOR) here (not just at read time) so the
    one-liner blurb generation below only runs for candidates that will
    actually be shown, not every positive-margin-of-safety ticker in the
    universe — keeps the weekly Claude cost bounded (≤5 per sector)."""
    from app.api.routes.screener import UNIVERSE
    results = _scan(UNIVERSE)
    results = _cap_per_sector(results, _MAX_PER_SECTOR)

    from app.services.ai_service import generate_candidate_blurb
    for entry in results:
        try:
            blurb_result = await generate_candidate_blurb(entry)
            entry["blurb"] = blurb_result.get("blurb")
            _finalize_checklist(entry, {
                "name": "Entender el negocio",
                "passed": blurb_result.get("business_understanding_passed"),
                "reason": blurb_result.get("business_understanding_reason", ""),
            }, blurb_result.get("checklist_reasons"))
        except Exception as exc:
            logger.warning("undervalued_screener_service: blurb failed for %s: %s", entry["ticker"], exc)
            _finalize_checklist(entry)

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
    for entry in results:
        _finalize_checklist(entry)
    if results:
        cache_set(CACHE_KEY, results, BOOTSTRAP_TTL)
        logger.info("undervalued_screener_service: bootstrap-filled %d results from a %d-ticker subset", len(results), _BOOTSTRAP_LIMIT)


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


def get_undervalued(limit: int = 60, sector: Optional[str] = None) -> dict:
    """Fast, cache-only read. `generated_at` (unix timestamp, 0 if the cache
    is empty) lets callers disclose honestly how stale the snapshot is.
    Callers should call bootstrap_fill_if_empty_sync() first if they need a
    guarantee of non-empty results (see screener.py's endpoint and chat.py's
    context-block builder). Caps at 5 candidates per sector (real ones only
    — a sector with fewer than 5 qualifying stocks just shows fewer)."""
    results, ts = cache_get_with_ts(CACHE_KEY)
    results = results or []
    if sector:
        results = [r for r in results if (r.get("sector") or "").lower() == sector.lower()]
    results = _cap_per_sector(results, _MAX_PER_SECTOR)
    return {"results": results[:limit], "generated_at": ts}
