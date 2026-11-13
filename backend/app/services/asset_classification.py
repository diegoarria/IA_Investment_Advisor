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
sole ETF data source for now) and does NOT route through
app.core.fmp_budget's shared call budget — that budget is deliberately
scoped to FMPProvider._get's much higher-volume fundamental-analysis path
(see fmp_budget.py's own docstring); classification is cached aggressively
below specifically so it adds negligible call volume instead of needing to
share that budget.
"""
import logging
import os

import requests

from app.core.cache import cache_get, cache_set
from app.core.config import settings

logger = logging.getLogger(__name__)

FMP_KEY = settings.fmp_api_key or os.getenv("FMP_API_KEY", "")
FMP_BASE = "https://financialmodelingprep.com/stable"
_REQ_HEADERS = {"User-Agent": "Nuvos/1.0"}
_REQ_TIMEOUT = 10

# A real classification (equity or etf) is stable — tickers don't change
# instrument type. A classification of "unknown" is cached much more
# briefly so a transient FMP outage or a newly-listed ticker gets retried
# soon instead of being stuck unclassified for a full day (same reasoning
# as sector_lookup.py's existing is_etf cache TTL split).
_TTL_KNOWN_S = 86400
_TTL_UNKNOWN_S = 600

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


def _fmp_get(path: str, symbol: str) -> list[dict] | None:
    """Returns the parsed JSON array on success, or None on any failure
    (timeout, non-200, malformed body, missing API key). Never raises —
    callers treat None the same as "couldn't tell," not as "not an ETF."""
    if not FMP_KEY:
        return None
    try:
        r = requests.get(
            f"{FMP_BASE}{path}",
            params={"symbol": symbol, "apikey": FMP_KEY},
            headers=_REQ_HEADERS,
            timeout=_REQ_TIMEOUT,
        )
        if r.status_code != 200:
            return None
        data = r.json()
        return data if isinstance(data, list) else None
    except Exception as exc:
        logger.debug("asset_classification: FMP call %s(%s) failed: %s", path, symbol, exc)
        return None


def classify_asset(ticker: str) -> str:
    """Returns one of EQUITY, ETF, or UNKNOWN for the given ticker symbol.

    UNKNOWN covers both "ticker doesn't exist" and "FMP couldn't be reached"
    — callers must not treat UNKNOWN as a hard failure. In particular, a
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

    etf_info = _fmp_get("/etf/info", ticker)
    if etf_info:
        cache_set(cache_key, ETF, ttl=_TTL_KNOWN_S)
        return ETF
    if etf_info is None:
        # The /etf/info call itself failed (network/provider issue, not
        # "confirmed not an ETF") — still worth trying /profile below, but
        # don't let a confirmed equity get cached as long-TTL if this half
        # of the check was inconclusive. Tracked via `inconclusive` below.
        inconclusive = True
    else:
        inconclusive = False  # etf_info == [] — FMP positively says "not an ETF"

    profile = _fmp_get("/profile", ticker)
    if profile:
        ttl = _TTL_UNKNOWN_S if inconclusive else _TTL_KNOWN_S
        cache_set(cache_key, EQUITY, ttl=ttl)
        return EQUITY

    cache_set(cache_key, UNKNOWN, ttl=_TTL_UNKNOWN_S)
    return UNKNOWN
