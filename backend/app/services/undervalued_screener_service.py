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
                results.append({
                    "ticker": entry["ticker"],
                    "company_name": data.get("company_name"),
                    "sector": entry.get("sector"),
                    "price": data.get("current_price"),
                    "intrinsic_value_base": dcf["scenarios"]["base"]["intrinsic_value_per_share"],
                    "margin_of_safety_pct": mos,
                    "thesis_scores": data.get("thesis_scores"),
                })
        except Exception as exc:
            logger.warning("undervalued_screener_service: %s failed: %s", entry["ticker"], exc)
    results.sort(key=lambda r: -r["margin_of_safety_pct"])
    return results


async def refresh_undervalued_screener() -> None:
    """Full weekly refresh — the entire curated universe, cached with the
    normal week-long TTL."""
    from app.api.routes.screener import UNIVERSE
    results = _scan(UNIVERSE)
    cache_set(CACHE_KEY, results[:30], CACHE_TTL)
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
    if results:
        cache_set(CACHE_KEY, results, BOOTSTRAP_TTL)
        logger.info("undervalued_screener_service: bootstrap-filled %d results from a %d-ticker subset", len(results), _BOOTSTRAP_LIMIT)


def get_undervalued(limit: int = 10, sector: Optional[str] = None) -> dict:
    """Fast, cache-only read. `generated_at` (unix timestamp, 0 if the cache
    is empty) lets callers disclose honestly how stale the snapshot is.
    Callers should call bootstrap_fill_if_empty_sync() first if they need a
    guarantee of non-empty results (see screener.py's endpoint and chat.py's
    context-block builder)."""
    results, ts = cache_get_with_ts(CACHE_KEY)
    results = results or []
    if sector:
        results = [r for r in results if (r.get("sector") or "").lower() == sector.lower()]
    return {"results": results[:limit], "generated_at": ts}
