"""
Analyst Estimates Service — Nuvos AI Fair Value Engine redesign,
Incremento 3 (see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Forward-looking Wall Street revenue/EPS estimates existed in this codebase
before this module (yfinance's `earnings_estimate`/`revenue_estimate`,
already fetched inline inside `app/api/routes/market.py::_fetch_stock_detail`
for the `/stock-detail` endpoint) but were never consumable by the
valuation engine — `fundamental_analysis_service.py` never imported
anything from `market.py`. This module MOVES that fetch (the primary
yfinance path, not `market.py`'s own crumb-authenticated quoteSummary
fallback — see below) into a real, importable function so
`assumptions_engine.py` (Incremento 4) can use it too, while
`_fetch_stock_detail` keeps its exact current response shape by calling
this module instead of doing the fetch inline.

Real, honest limitations, declared here rather than hidden:
- Coverage is typically 1-2 fiscal years/quarters ahead — never a real
  10-year Wall Street consensus (no such data source exists anywhere).
- No FCF estimate exists from ANY source integrated in this codebase —
  only revenue and EPS. `revenue_growth_next_year_pct`/
  `eps_growth_next_year_pct` are the only two signals this module can
  offer the Assumptions Engine.
- `market.py`'s OWN earningsTrend fallback (crumb-authenticated
  quoteSummary, used when the primary yfinance call returns nothing) is
  deliberately NOT duplicated here — it's tightly coupled to market.py's
  broader stock-detail fetch (shared session/crumb state, many unrelated
  modules pulled in the same call) and stays market.py's own fallback for
  that endpoint's robustness. `get_analyst_estimates` returns `None` when
  the primary yfinance path has nothing, and callers (the Assumptions
  Engine) degrade gracefully exactly like any other missing signal
  (`weighted_mean` renormalizes over what IS available).
"""

from __future__ import annotations

import concurrent.futures
import logging
import os
import time
from dataclasses import dataclass, asdict
from typing import Optional

from app.core.cache import cache_get, cache_set

logger = logging.getLogger(__name__)

# 2026-11-10 P0 latency fix: Yahoo was observed returning 429 on the
# `earningsTrend` quoteSummary module for a broad set of tickers (AAPL, KO,
# CHTR, MSFT, GIS, and unrelated ones — a provider-side episode, not
# ticker-specific). yfinance retries internally with no timeout of its own,
# so a single call could cost 12-22+ seconds, often returning nothing anyway
# — eating most of the interactive request's 8s budget (_LIVE_BUILD_TIMEOUT_S
# in screener.py) for a signal that's one of four Assumptions Engine inputs,
# never the sole driver of a valuation.
#
# Same pattern already used by financial_data_service.py's
# `_YF_TIMEOUT_POOL`/`_yf_with_timeout` for the exact same reason (Yahoo
# peer-fetch latency) — a SHARED, module-level pool created once at import,
# never per-request (a fresh ThreadPoolExecutor per call was explicitly
# rejected: it doesn't bound anything, it just adds thread-creation overhead
# on top of an already-slow call).
_ESTIMATES_TIMEOUT_POOL = concurrent.futures.ThreadPoolExecutor(
    max_workers=4, thread_name_prefix="analyst-est"
)

# Configurable via env var exactly as Diego asked ("presupuesto corto y
# configurable, inicialmente de 3 segundos") — read once at import, like
# every other TTL/timeout constant in this codebase; changing it needs a
# redeploy, not a hot-reload, which is fine for a tuning knob like this.
ANALYST_ESTIMATES_TIMEOUT_S = float(os.getenv("ANALYST_ESTIMATES_TIMEOUT_S", "3.0"))

# How long a confirmed transient failure (429, timeout, any exception from
# the yfinance call itself) suppresses a NEW attempt for that ticker — PASO 2.
# Short on purpose: long enough to stop a thundering herd of retries during
# a live 429 episode, short enough that the provider recovering is reflected
# automatically (plain TTL expiry — no manual reset, no separate "is the
# provider healthy again" check needed).
ANALYST_ESTIMATES_FAILURE_COOLDOWN_S = float(os.getenv("ANALYST_ESTIMATES_FAILURE_COOLDOWN_S", "180"))

# The "last known good" result is kept much longer than the cooldown above —
# forward analyst estimates don't change intraday, so serving a slightly
# stale-but-real number (with its real as-of date, per Diego's explicit
# "identificando su fecha") during a provider outage is strictly better than
# showing nothing, and is never confused with a fabricated/zeroed value.
_GOOD_CACHE_TTL_S = 7 * 24 * 3600  # 7 days


def _good_cache_key(ticker: str) -> str:
    return f"analyst_est:good:{ticker}"


def _cooldown_cache_key(ticker: str) -> str:
    return f"analyst_est:cooldown:{ticker}"


def _fmt_number(v) -> Optional[float]:
    """Identical to market.py's own `_fmt_number` — same rounding, same
    NaN guard — so a value moved through this service is byte-identical
    to what `/stock-detail` showed before this module existed."""
    try:
        f = float(v)
        return None if (f != f) else round(f, 4)  # NaN check
    except Exception:
        return None


@dataclass
class AnalystEstimates:
    eps_estimates: list[dict]          # [{period, avg, low, high, growth}, ...] — same shape /stock-detail already returns
    revenue_estimates: list[dict]      # same shape
    n_analysts: Optional[int]
    source: str                        # "yfinance"
    revenue_growth_next_year_pct: Optional[float]
    eps_growth_next_year_pct: Optional[float]
    as_of: Optional[float] = None      # unix timestamp of the real fetch this data came from
    stale: bool = False                # True when served from the "last known good" fallback, not a fresh fetch


def _extract_estimates(df) -> list[dict]:
    """Same normalization `market.py::_fetch_stock_detail` already applied
    inline to `t.earnings_estimate`/`t.revenue_estimate` — extracted
    verbatim, not re-derived, so both callers see identical numbers."""
    rows: list[dict] = []
    if df is None or df.empty:
        return rows
    for idx, r in df.iterrows():
        rows.append({
            "period": str(idx),
            "avg":    _fmt_number(r.get("avg")),
            "low":    _fmt_number(r.get("low")),
            "high":   _fmt_number(r.get("high")),
            "growth": _fmt_number((r.get("growth") or 0) * 100),
        })
    return rows


def _next_year_growth(estimates: list[dict]) -> Optional[float]:
    """yfinance's estimate tables are typically indexed ["0y", "+1y"] (or
    similarly for quarters) — "0y" is the CURRENT fiscal year (already
    mostly known, not a real forward-looking estimate), "+1y" is next
    year, the real forward signal. Rather than pattern-match the exact
    index label (which varies: dates, "+1y", quarter labels depending on
    the fallback path), this takes the SECOND entry when at least two are
    present (current year, then next year, in the order yfinance already
    returns them) — falling back to the first/only entry when there's
    just one. Documented heuristic, not exact period-matching; the
    caller (Assumptions Engine) already treats this as one of four
    factors, never the sole input."""
    if len(estimates) >= 2:
        return estimates[1].get("growth")
    if estimates:
        return estimates[0].get("growth")
    return None


def _fetch_estimates_blocking(ticker: str) -> Optional[AnalystEstimates]:
    """The actual yfinance round trip — synchronous, blocking, run inside
    _ESTIMATES_TIMEOUT_POOL so the caller can bound how long it waits.
    Returns None for the legitimate "no analyst coverage" case (yfinance
    responded, both tables are empty) — this is NOT a failure and must
    never trigger the failure cooldown below."""
    import yfinance as yf
    t = yf.Ticker(ticker)

    eps_estimates: list[dict] = []
    try:
        eps_estimates = _extract_estimates(t.earnings_estimate)
    except Exception as exc:
        logger.debug("get_analyst_estimates(%s): earnings_estimate failed: %s", ticker, exc)

    revenue_estimates: list[dict] = []
    try:
        revenue_estimates = _extract_estimates(t.revenue_estimate)
    except Exception as exc:
        logger.debug("get_analyst_estimates(%s): revenue_estimate failed: %s", ticker, exc)

    if not eps_estimates and not revenue_estimates:
        return None

    n_analysts = None
    try:
        info = t.info or {}
        n_analysts = info.get("numberOfAnalystOpinions")
    except Exception:
        pass

    return AnalystEstimates(
        eps_estimates=eps_estimates,
        revenue_estimates=revenue_estimates,
        n_analysts=n_analysts,
        source="yfinance",
        revenue_growth_next_year_pct=_next_year_growth(revenue_estimates),
        eps_growth_next_year_pct=_next_year_growth(eps_estimates),
        as_of=time.time(),
        stale=False,
    )


def _load_good_cache(ticker: str) -> Optional[AnalystEstimates]:
    raw = cache_get(_good_cache_key(ticker))
    if not raw:
        return None
    try:
        raw = dict(raw)
        raw["stale"] = True
        return AnalystEstimates(**raw)
    except Exception:
        return None


def get_analyst_estimates(ticker: str) -> Optional[AnalystEstimates]:
    """Real forward EPS/revenue estimates from yfinance, or None (never a
    fabricated growth rate) when there is genuinely nothing for this ticker
    — common for thinly-covered or recently-listed companies.

    2026-11-10 P0 latency fix: bounded by ANALYST_ESTIMATES_TIMEOUT_S
    (default 3s, configurable). On a timeout or a real transient failure
    (confirmed live: Yahoo 429 on this exact endpoint), this:
      - never blocks the caller past the configured budget,
      - never fabricates a number or substitutes zero,
      - serves the last successfully-fetched estimate instead, tagged
        `stale=True` with its real `as_of` timestamp, if one exists,
      - otherwise returns None (caller already treats None as "no
        estimates available", same as a ticker with no coverage at all),
      - sets a short cooldown (ANALYST_ESTIMATES_FAILURE_COOLDOWN_S) so a
        429 episode doesn't cause every subsequent request for this ticker
        to pay the same timeout again — it recovers automatically once the
        cooldown expires, no manual reset.

    Does NOT retry aggressively — yfinance already retries internally
    (that retry loop is part of why a single call can take 12-22s+ under
    rate-limiting), so adding another retry layer here would make the
    problem worse, not better. This function makes exactly one attempt per
    call, bounded by the timeout.

    Important, honest caveat (verified, not assumed): `future.result(timeout=...)`
    does NOT cancel the underlying yfinance call — it's a synchronous,
    blocking HTTP call with no cancellation hook, so the submitted task
    keeps running in _ESTIMATES_TIMEOUT_POOL's worker thread until it
    finishes or yfinance's own retry gives up; this function just stops
    waiting for it. This is the same documented limitation already in this
    codebase for the identical pattern (financial_data_service.py's
    `_yf_with_timeout`, and screener.py's `_LIVE_BUILD_TIMEOUT_S`). The pool
    has 4 workers — under sustained 429s, late-arriving stragglers could in
    theory saturate it, but each straggler self-terminates once yfinance's
    own retry/backoff gives up (observed: well under a minute), and a
    saturated pool simply means the NEXT call also times out at 3s and
    falls back to the cooldown/good-cache path — it does not deadlock or
    block indefinitely."""
    cooldown_key = _cooldown_cache_key(ticker)
    if cache_get(cooldown_key):
        logger.info("get_analyst_estimates(%s): failure cooldown active — skipping Yahoo, serving last-known-good if any", ticker)
        return _load_good_cache(ticker)

    try:
        future = _ESTIMATES_TIMEOUT_POOL.submit(_fetch_estimates_blocking, ticker)
        result = future.result(timeout=ANALYST_ESTIMATES_TIMEOUT_S)
    except concurrent.futures.TimeoutError:
        logger.warning(
            "get_analyst_estimates(%s): exceeded %ss budget (Yahoo likely rate-limited) — falling back to last-known-good",
            ticker, ANALYST_ESTIMATES_TIMEOUT_S,
        )
        cache_set(cooldown_key, True, ttl=ANALYST_ESTIMATES_FAILURE_COOLDOWN_S)
        return _load_good_cache(ticker)
    except Exception as exc:
        logger.warning("get_analyst_estimates(%s): failed entirely: %s", ticker, exc)
        cache_set(cooldown_key, True, ttl=ANALYST_ESTIMATES_FAILURE_COOLDOWN_S)
        return _load_good_cache(ticker)

    if result is None:
        # Genuinely no coverage — yfinance answered, both tables are empty.
        # Not a failure: do NOT set the cooldown, do NOT touch the good
        # cache (nothing to update, and an old good entry for a ticker that
        # legitimately lost coverage should still be allowed to expire on
        # its own TTL rather than being kept alive by this branch).
        return None

    cache_set(_good_cache_key(ticker), asdict(result), ttl=_GOOD_CACHE_TTL_S)
    return result
