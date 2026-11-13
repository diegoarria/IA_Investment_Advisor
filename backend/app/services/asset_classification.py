"""
Asset classification — Nuvos ETF Phase 0, 2026-11.

Nuvos Radar's fundamental-analysis/valuation pipeline (app/services/valuation/,
nuvos_engine/, fundamental_analysis_service.get_fundamental_analysis) assumes
every ticker it receives is an equity. It has no guard against an ETF ticker
(SPY, QQQ, ...) reaching it — confirmed by reading the code: a user typing an
ETF ticker to Arthur or Research Engine today would silently attempt a
stock-style valuation on a fund and likely produce nonsense output, not an
error. This module exists to classify a ticker BEFORE it reaches that
pipeline, so callers can route ETFs to a different (not-yet-built) path
instead of Radar's equity valuation engine.

Classification method: two FMP calls, in order —
  1. GET /stable/etf/info?symbol=X — returns a non-empty array only for a
     real ETF/fund (confirmed live: SPY/QQQ/VOO/BOTZ return full profile
     data; AAPL/MSFT/NVDA return `[]`). This is FMP's own purpose-built ETF
     identification, not a side-effect of some other field.
  2. If step 1 is empty, GET /stable/profile?symbol=X — non-empty means a
     real company (equity). Empty means the ticker doesn't exist, or exists
     but isn't a plain equity/ETF (ADRs, mutual funds, etc. — treated as
     unknown rather than guessed at).

Deliberately does NOT use yfinance (team decision, 2026-11: FMP stays the
sole ETF data source for now).

Fase 8-hotfix (2026-11-12): until this pass, this module deliberately did
NOT route through app.core.fmp_budget's shared call budget, on the
assumption that aggressive caching kept its call volume negligible. That
assumption broke the moment ETF Explorer/Distribución opened to every
authenticated user (Fase 8C) — confirmed live in production: a burst of
real traffic tripped FMP's actual 300/min plan limit (a real 429 "Limit
Reach", not a guess), and because a FAILED classification used to be
cached as UNKNOWN for a flat 10 minutes with no distinction from a
genuinely-confirmed negative, several real ETFs (SPY, QQQ, VOO, VXUS...)
got stuck showing "not an ETF"/"unclassified_asset" to real users for
up to 10 minutes after FMP's own rate limit had already recovered.

Three changes fix this, reusing existing primitives only:
  1. `_fmp_get` now checks `fmp_call_allowed()` (the same shared budget
     every other FMP call site already respects) immediately before each
     real HTTP request — never makes the request at all when the budget
     is exhausted, so it can't blow through FMP's real limit, and it
     automatically inherits whatever live/background priority split the
     calling context already set up (`fmp_background()`), with zero new
     code needed for that.
  2. `_fmp_get` now distinguishes a TRANSIENT failure (429, 5xx, timeout,
     network error, no API key, exhausted shared budget) from a REAL
     confirmed answer (a 200 with a parseable JSON array — empty or not).
     Only a transient failure gets the short cooldown treatment below;
     a genuine "FMP looked and found nothing" still caches UNKNOWN for
     `_TTL_CONFIRMED_UNKNOWN_S`, unchanged from before.
  3. A transient failure never produces a 10-minute wrong answer: it sets
     a short cooldown key (`_TTL_TRANSIENT_COOLDOWN_S`, a few seconds —
     just enough to stop a burst of concurrent requests from each
     independently retrying FMP during the same brief episode) and falls
     back to the ticker's own last confirmed classification
     (`asset_class_last_known:{ticker}`, written only on a real success,
     kept far longer than the display cache) if one exists, or an honest
     UNKNOWN if this ticker has never been confirmed before. A ticker's
     instrument type does not change, so serving a slightly older
     confirmed answer during a brief provider hiccup is safe and never
     fabricates anything the provider hasn't itself said at some point.

A few concurrent requests landing in the exact same instant before the
very first one sets the cooldown key may each independently call FMP
once — the same accepted "peek-then-increment" race fmp_budget.py's own
shared counter already documents, not a new risk introduced here.
"""
import logging
import os
from dataclasses import dataclass

import requests

from app.core.cache import cache_get, cache_set
from app.core.config import settings

logger = logging.getLogger(__name__)

FMP_KEY = settings.fmp_api_key or os.getenv("FMP_API_KEY", "")
FMP_BASE = "https://financialmodelingprep.com/stable"
_REQ_HEADERS = {"User-Agent": "Nuvos/1.0"}
_REQ_TIMEOUT = 10

# A real classification (equity or etf) is stable — tickers don't change
# instrument type. A confirmed-unknown (FMP positively returned no match
# for either check) is cached much more briefly so a newly-listed ticker
# gets retried soon instead of being stuck unclassified for a full day
# (same reasoning as sector_lookup.py's existing is_etf cache TTL split).
_TTL_KNOWN_S = 86400
_TTL_CONFIRMED_UNKNOWN_S = 600
# A TRANSIENT failure (429/5xx/timeout/network/no-key/budget-exhausted)
# gets only this short cooldown — long enough to stop an immediate retry
# storm, short enough that a real FMP recovery seconds later is reflected
# almost immediately instead of waiting out a flat 10-minute window.
_TTL_TRANSIENT_COOLDOWN_S = 15
# How long a confirmed classification is remembered as a fallback for a
# later transient hiccup, independent of the main display cache's own
# (shorter, for UNKNOWN) TTL. Generous on purpose — instrument type is
# permanent, so there's no real cost to remembering it for a month.
_TTL_LAST_KNOWN_S = 30 * 86400

EQUITY = "equity"
ETF = "etf"
UNKNOWN = "unknown"

ETF_NOTICE_ES = (
    "{ticker} es un ETF (fondo cotizado), no una acción individual. El "
    "análisis fundamental y la valuación de Nuvos Radar aplican a empresas, "
    "no a fondos — por eso no se calcula aquí. El análisis especializado "
    "para ETFs estará disponible próximamente en Nuvos."
)


def etf_placeholder_response(ticker: str) -> dict:
    """The controlled, non-misleading response every fundamental-analysis
    caller should substitute for a real computed result when `ticker`
    classifies as ETF — never a fabricated valuation. Tagged with
    `is_etf: True` so callers can distinguish this from genuine
    insufficient-data (`None`) and surface the right message instead of a
    generic 404/"no data" response."""
    return {
        "is_etf": True,
        "ticker": ticker,
        "message": ETF_NOTICE_ES.format(ticker=ticker),
    }


@dataclass
class _FMPResult:
    ok: bool                       # True only for a real, trustworthy FMP answer
    data: list[dict] | None = None  # parsed array when ok=True (possibly empty — a real "no match")
    reason: str | None = None       # set when ok=False: no_key/budget_exhausted/timeout/http_429/http_5xx/http_other/network_error/malformed_body


def _fmp_get(path: str, symbol: str) -> _FMPResult:
    """Returns a real, trustworthy answer (`ok=True`, `data` a possibly-empty
    list) or a transient/unknown failure (`ok=False`, `reason` set) — never
    raises. Callers must never treat `ok=False` the same as `ok=True` with
    an empty list: the former means "couldn't tell," the latter means FMP
    positively looked and found nothing."""
    if not FMP_KEY:
        return _FMPResult(ok=False, reason="no_key")

    from app.core.fmp_budget import fmp_call_allowed
    if not fmp_call_allowed():
        return _FMPResult(ok=False, reason="budget_exhausted")

    try:
        r = requests.get(
            f"{FMP_BASE}{path}",
            params={"symbol": symbol, "apikey": FMP_KEY},
            headers=_REQ_HEADERS,
            timeout=_REQ_TIMEOUT,
        )
    except requests.exceptions.Timeout:
        return _FMPResult(ok=False, reason="timeout")
    except Exception as exc:
        logger.debug("asset_classification: FMP call %s(%s) failed: %s", path, symbol, exc)
        return _FMPResult(ok=False, reason="network_error")

    if r.status_code == 429:
        return _FMPResult(ok=False, reason="http_429")
    if r.status_code >= 500:
        return _FMPResult(ok=False, reason="http_5xx")
    if r.status_code != 200:
        return _FMPResult(ok=False, reason="http_other")

    try:
        data = r.json()
    except Exception:
        return _FMPResult(ok=False, reason="malformed_body")

    if not isinstance(data, list):
        return _FMPResult(ok=False, reason="malformed_body")

    return _FMPResult(ok=True, data=data)


def _remember_confirmed(ticker: str, result: str) -> None:
    cache_set(f"asset_class_last_known:{ticker}", result, ttl=_TTL_LAST_KNOWN_S)


def _fall_back_after_transient_failure(ticker: str, cooldown_key: str) -> str:
    cache_set(cooldown_key, True, ttl=_TTL_TRANSIENT_COOLDOWN_S)
    last_known = cache_get(f"asset_class_last_known:{ticker}")
    return last_known if last_known is not None else UNKNOWN


def classify_asset(ticker: str) -> str:
    """Returns one of EQUITY, ETF, or UNKNOWN for the given ticker symbol.

    UNKNOWN covers both "ticker doesn't exist" and "FMP couldn't be reached
    (and we have no prior confirmed classification to fall back on)" —
    callers must not treat UNKNOWN as a hard failure. In particular, a
    fundamental-analysis caller seeing UNKNOWN should still allow the equity
    valuation path to proceed rather than permanently blocking a valid
    ticker because of a transient provider hiccup (see
    fundamental_analysis_guard.py)."""
    ticker = (ticker or "").strip().upper()
    if not ticker:
        return UNKNOWN

    cache_key = f"asset_class:{ticker}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    cooldown_key = f"asset_class_cooldown:{ticker}"
    if cache_get(cooldown_key) is not None:
        # A transient failure for this exact ticker was recorded within
        # the last _TTL_TRANSIENT_COOLDOWN_S seconds — don't hammer FMP
        # again this soon, just serve whatever we already know.
        last_known = cache_get(f"asset_class_last_known:{ticker}")
        return last_known if last_known is not None else UNKNOWN

    etf_info = _fmp_get("/etf/info", ticker)
    if etf_info.ok and etf_info.data:
        cache_set(cache_key, ETF, ttl=_TTL_KNOWN_S)
        _remember_confirmed(ticker, ETF)
        return ETF

    profile = _fmp_get("/profile", ticker)
    if profile.ok and profile.data:
        # A transient failure on the OTHER half of the check means this
        # positive profile match hasn't fully ruled out also being an ETF
        # (the /etf/info side was inconclusive) — cache it for less long,
        # same caution the original design already applied here.
        ttl = _TTL_CONFIRMED_UNKNOWN_S if not etf_info.ok else _TTL_KNOWN_S
        cache_set(cache_key, EQUITY, ttl=ttl)
        _remember_confirmed(ticker, EQUITY)
        return EQUITY

    if not etf_info.ok or not profile.ok:
        # At least one half of the check was a real transient failure,
        # not FMP positively confirming "no match" — never let this turn
        # into a 10-minute-wrong persistent classification.
        return _fall_back_after_transient_failure(ticker, cooldown_key)

    # Both calls genuinely succeeded and both came back empty — FMP
    # positively has no record of this ticker as either instrument type.
    # Nothing confirmed to remember as a last-known fallback.
    cache_set(cache_key, UNKNOWN, ttl=_TTL_CONFIRMED_UNKNOWN_S)
    return UNKNOWN
