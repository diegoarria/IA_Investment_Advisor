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
too slow. The user-facing read (get_undervalued) is cache-only, fast, and
never triggers live computation.
"""

from __future__ import annotations

import logging
from typing import Optional

from app.core.cache import cache_set, cache_get_with_ts

logger = logging.getLogger(__name__)

CACHE_KEY = "undervalued_screener:v1"
CACHE_TTL = 8 * 24 * 3600  # slightly over a week — one missed weekly run doesn't go stale/empty


async def refresh_undervalued_screener() -> None:
    """Iterates the ticker universe, runs the real DCF engine per ticker,
    keeps only positive-margin-of-safety results, caches the ranked list.
    Per-ticker try/except — one bad ticker must never abort the whole batch."""
    from app.api.routes.screener import UNIVERSE
    from app.services.fundamental_analysis_service import get_fundamental_analysis

    results = []
    for entry in UNIVERSE:
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
    cache_set(CACHE_KEY, results[:30], CACHE_TTL)
    logger.info("undervalued_screener_service: refreshed, %d/%d tickers had positive margin of safety", len(results), len(UNIVERSE))


def get_undervalued(limit: int = 10, sector: Optional[str] = None) -> dict:
    """Fast, cache-only read — never triggers live computation. `generated_at`
    (unix timestamp, 0 if the cache is empty/never refreshed) lets callers
    disclose honestly how stale the snapshot is."""
    results, ts = cache_get_with_ts(CACHE_KEY)
    results = results or []
    if sector:
        results = [r for r in results if (r.get("sector") or "").lower() == sector.lower()]
    return {"results": results[:limit], "generated_at": ts}
