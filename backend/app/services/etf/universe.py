"""
Nuvos ETF — Fase 2B: the searchable ETF universe.

Confirmed live during the Fase 2B audit (2026-11): `/stable/etf-list`
returns FMP's own full, curated list of every ETF symbol they track —
7,463 real {symbol, name} pairs in ONE call. This is the key piece that
makes search cheap and honest: every entry in this list is a real ETF
by FMP's own classification, so searching it needs zero additional
per-result classification calls (no "llamadas individuales masivas a
FMP"), and a search UI built on it can never surface a non-ETF result.

Fetched once, cached for a long time (the set of tradeable ETFs changes
at most a handful of times a week) — not re-fetched per search request.
"""
import logging
import time

from app.core.cache import cache_get, cache_set
from app.services.etf.provider import FMP_BASE, FMP_KEY, _REQ_HEADERS, _REQ_TIMEOUT

import requests

logger = logging.getLogger(__name__)

_CACHE_KEY = "etf_universe:list"
_TTL_S = 7 * 86400  # 7 days — this list doesn't meaningfully change day to day


def _fetch_universe() -> list[dict]:
    if not FMP_KEY:
        return []
    try:
        r = requests.get(f"{FMP_BASE}/etf-list", params={"apikey": FMP_KEY}, headers=_REQ_HEADERS, timeout=_REQ_TIMEOUT)
        if r.status_code != 200:
            logger.warning("etf/universe: /etf-list returned status %s", r.status_code)
            return []
        data = r.json()
        if not isinstance(data, list):
            return []
        return [{"symbol": row.get("symbol"), "name": row.get("name")} for row in data if row.get("symbol")]
    except Exception as exc:
        logger.warning("etf/universe: /etf-list fetch failed: %s", exc)
        return []


def get_etf_universe(use_cache: bool = True) -> list[dict]:
    """The full {symbol, name} list, cached. Returns [] (never raises) if
    FMP is unreachable — callers must treat that as "search unavailable
    right now," not "there are zero ETFs."""
    if use_cache:
        cached = cache_get(_CACHE_KEY)
        if cached is not None:
            return cached
    universe = _fetch_universe()
    if universe:
        cache_set(_CACHE_KEY, universe, ttl=_TTL_S)
    return universe


def search_etf_universe(query: str, limit: int = 20) -> list[dict]:
    """Case-insensitive substring match against symbol OR name — real,
    local, zero extra FMP calls per search.

    Ranked in tiers (found live, 2026-11: without this, a query like
    "Vanguard" buried VOO/VTI under dozens of less-relevant "...Vanguard
    ... ETF" matches, because the raw FMP list isn't alphabetized or
    relevance-sorted — a full scan + tiered rank fixes it, not an early
    stop, since 7,463 in-memory string comparisons is cheap and a partial
    scan was the actual bug):
      0 — exact symbol match
      1 — symbol starts with query
      2 — name starts with query
      3 — query is a whole word inside name (e.g. "Technology" in
          "Technology Select Sector SPDR Fund")
      4 — query is a substring anywhere in name or symbol
    Within a tier, alphabetical by symbol — deterministic, not an
    artifact of FMP's own list order."""
    query = (query or "").strip().lower()
    if not query:
        return []
    universe = get_etf_universe()
    ranked: list[tuple[int, dict]] = []
    for row in universe:
        symbol = (row.get("symbol") or "")
        name = (row.get("name") or "")
        symbol_l, name_l = symbol.lower(), name.lower()
        if symbol_l == query:
            tier = 0
        elif symbol_l.startswith(query):
            tier = 1
        elif name_l.startswith(query):
            tier = 2
        elif f" {query} " in f" {name_l} " or name_l.startswith(f"{query} ") or name_l.endswith(f" {query}"):
            tier = 3
        elif query in name_l or query in symbol_l:
            tier = 4
        else:
            continue
        ranked.append((tier, row))
    ranked.sort(key=lambda t: (t[0], t[1].get("symbol") or ""))
    return [row for _, row in ranked[:limit]]
