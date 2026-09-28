"""
Type-ahead company/ticker search (Diego, 2026-09-27: "que no tenga que
escribir todo sino que salten opciones de tickers o empresas").

Finnhub's /search alone made a poor autocomplete: ~10 results per query,
mostly foreign listings (APP.BK, NVD.DE...), and a partial ticker like
"NVD" never surfaced NVDA at all. This searches a local universe first —
the SEC's official list of US-listed companies (company_tickers.json,
~10k rows, ordered by market cap, so its position doubles as a popularity
rank) — matching ticker prefixes and company-name words, and only then
tops up from the existing Finnhub/Yahoo search (non-US listings, ETFs the
SEC list doesn't carry).

The universe is fetched at most once a day (Redis + in-process cache);
if the SEC is unreachable this silently returns [] and the caller falls
back to the network search exactly as before.
"""

from __future__ import annotations

import logging
import re
import time
import unicodedata
from typing import Optional

logger = logging.getLogger(__name__)

_SEC_URL = "https://www.sec.gov/files/company_tickers.json"
# The SEC requires a User-Agent with a contact address.
_SEC_UA = "Nuvos AI legal@nuvosai.com"
_CACHE_KEY = "ticker_search:universe:v1"
_CACHE_TTL = 24 * 3600

# Popular ETFs aren't in the SEC company list — without these, typing
# "VOO" or "S&P" would only find them through the slower network fallback.
_EXTRA_ETFS: list[tuple[str, str]] = [
    ("SPY", "SPDR S&P 500 ETF"), ("VOO", "Vanguard S&P 500 ETF"), ("IVV", "iShares Core S&P 500 ETF"),
    ("QQQ", "Invesco QQQ Trust (NASDAQ 100)"), ("VTI", "Vanguard Total Stock Market ETF"),
    ("IWM", "iShares Russell 2000 ETF"), ("DIA", "SPDR Dow Jones Industrial Average ETF"),
    ("VT", "Vanguard Total World Stock ETF"), ("VEA", "Vanguard FTSE Developed Markets ETF"),
    ("VWO", "Vanguard FTSE Emerging Markets ETF"), ("SCHD", "Schwab US Dividend Equity ETF"),
    ("VYM", "Vanguard High Dividend Yield ETF"), ("VGT", "Vanguard Information Technology ETF"),
    ("XLK", "Technology Select Sector SPDR"), ("XLF", "Financial Select Sector SPDR"),
    ("XLE", "Energy Select Sector SPDR"), ("XLV", "Health Care Select Sector SPDR"),
    ("GLD", "SPDR Gold Shares"), ("SLV", "iShares Silver Trust"), ("TLT", "iShares 20+ Year Treasury Bond ETF"),
    ("BND", "Vanguard Total Bond Market ETF"), ("ARKK", "ARK Innovation ETF"), ("SMH", "VanEck Semiconductor ETF"),
    ("SOXX", "iShares Semiconductor ETF"), ("EWW", "iShares MSCI Mexico ETF"), ("EWZ", "iShares MSCI Brazil ETF"),
]

_mem: dict = {"at": 0.0, "rows": None}


def _norm(text: str) -> str:
    """Upper-case, accent-free, punctuation → space (so "coca-cola" matches "COCA COLA")."""
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^A-Z0-9 ]+", " ", text.upper()).strip()


def _pretty(name: str) -> str:
    """SEC titles are often ALL CAPS ("NVIDIA CORP") — title-case those for display."""
    return name.title() if name.isupper() else name


def _load_universe() -> list[dict]:
    now = time.time()
    if _mem["rows"] is not None and now - _mem["at"] < _CACHE_TTL:
        return _mem["rows"]

    from app.core.cache import cache_get, cache_set

    rows = cache_get(_CACHE_KEY)
    if not rows:
        try:
            import httpx
            r = httpx.get(_SEC_URL, headers={"User-Agent": _SEC_UA}, timeout=10)
            r.raise_for_status()
            data = r.json()
            rows = []
            seen: set[str] = set()
            for item in data.values():  # already ordered by market cap
                ticker = str(item.get("ticker") or "").upper()
                title = str(item.get("title") or "").strip()
                if not ticker or ticker in seen:
                    continue
                seen.add(ticker)
                rows.append({"ticker": ticker, "name": _pretty(title)})
            if rows:
                cache_set(_CACHE_KEY, rows, ttl=_CACHE_TTL)
        except Exception as exc:
            logger.warning("ticker_search: SEC universe fetch failed: %s", exc)
            rows = _mem["rows"] or []

    have = {r["ticker"] for r in rows}
    extras = [{"ticker": t, "name": n} for t, n in _EXTRA_ETFS if t not in have]
    # ETFs sit after the ~500 largest companies in the popularity order.
    rows = rows[:500] + extras + rows[500:]

    for i, r in enumerate(rows):
        r["_rank"] = i
        r["_name"] = _norm(r["name"])
        r["_tick"] = r["ticker"].replace("-", "").replace(".", "")
    _mem.update(at=now, rows=rows)
    return rows


def search_local(query: str, limit: int = 8) -> list[dict]:
    """Best local matches for a partial ticker or company name, most
    relevant first: exact ticker → ticker prefix → a name word starting
    with the query → name containing it; ties broken by company size."""
    q = _norm(query)
    if not q:
        return []
    q_tick = q.replace(" ", "")
    rows = _load_universe()
    if not rows:
        return []

    scored: list[tuple[int, int, dict]] = []
    for r in rows:
        tick = r["_tick"]
        name = r["_name"]
        tier: Optional[int] = None
        if tick == q_tick:
            tier = 0
        elif tick.startswith(q_tick):
            tier = 1
        elif name.startswith(q) or f" {q}" in f" {name}":
            tier = 2
        elif len(q) >= 3 and q in name:
            tier = 3
        if tier is not None:
            scored.append((tier, r["_rank"], r))
    # A big company whose NAME starts with the query ("apple" → AAPL)
    # should beat an obscure ticker that merely starts with it.
    scored.sort(key=lambda x: (x[0] if x[0] != 1 else (1 if x[1] < 1500 else 2.5), x[1]))
    return [{"ticker": r["ticker"], "name": r["name"]} for _, _, r in scored[:limit]]
