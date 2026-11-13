"""
Raw FMP access for the ETF engine — the only file in app/services/etf/ that
makes an HTTP call. Every other module in this package consumes its output,
never requests directly.

Confirmed live during the Nuvos ETF Fase 1 audit (2026-11), against the
real FMP stable API with the project's actual plan:
  - /etf/info, /etf/sector-weightings, /etf/country-weightings: 200, real
    data, for all 10 tickers in the test set (SPY/VOO/VTI/QQQ/VXUS/XLK/
    XLV/VNQ/IBB/BOTZ).
  - /profile, /quote, /dividends, /historical-price-eod/light: 200, shared
    with the equity pipeline, work unchanged for ETF tickers.
  - /etf/holdings, /etf/asset-exposure: 402 Restricted under the current
    plan — NOT called anywhere in this package (team decision, Fase 1
    scope). Do not add calls to these without first confirming plan access.

Every function here returns an FMPResult. It never raises — a network
failure, a non-200 status, or a malformed body all come back as
`ok=False` with `reason` set, exactly like FMPProvider._get in
financial_data_service.py already does for the equity pipeline (same
"never take down the caller" convention, re-derived here rather than
imported so this package has zero import-time dependency on that file).
"""
import logging
from dataclasses import dataclass
from typing import Any

import requests

from app.core.config import settings

logger = logging.getLogger(__name__)

FMP_KEY = settings.fmp_api_key or ""
FMP_BASE = "https://financialmodelingprep.com/stable"
_REQ_HEADERS = {"User-Agent": "Nuvos/1.0"}
_REQ_TIMEOUT = 12

# Fase 1 scope, deliberately — see module docstring. Do not add
# "/etf/holdings" or "/etf/asset-exposure" here without re-confirming plan
# access first (they returned 402 under the plan active at audit time).
_ALLOWED_PATHS = {
    "/etf/info",
    "/etf/sector-weightings",
    "/etf/country-weightings",
    "/profile",
    "/quote",
    "/dividends",
    "/historical-price-eod/light",
}


@dataclass
class FMPResult:
    ok: bool
    data: Any = None           # the parsed JSON array/dict on success
    status: int | None = None  # HTTP status code, when one was received
    reason: str | None = None  # short machine-readable cause, e.g. "timeout", "restricted_402", "rate_limited_429", "server_error_5xx", "empty", "malformed_body", "no_api_key"


def fetch(path: str, symbol: str, **extra_params) -> FMPResult:
    """GET {FMP_BASE}{path}?symbol={symbol}&... — path must be one of
    _ALLOWED_PATHS (a programming error, not a runtime one, if not)."""
    if path not in _ALLOWED_PATHS:
        raise ValueError(f"etf/provider.fetch: {path!r} is outside Fase 1's confirmed-available endpoint set")

    if not FMP_KEY:
        return FMPResult(ok=False, reason="no_api_key")

    # Fase 8C (2026-11-12): ETF Explorer loses its admin-only gate this
    # phase and becomes reachable by every authenticated user — this
    # package's only real HTTP call site had no cross-request throttle at
    # all (unlike get_fmp_quote_price/get_beta in financial_data_service.py
    # and historical.py's fetch_adjusted_price_series, which already guard
    # with the same shared budget). Per-ticker results are still cached
    # 24h, but that doesn't cap a burst across many DIFFERENT tickers.
    from app.core.fmp_budget import fmp_call_allowed
    if not fmp_call_allowed():
        return FMPResult(ok=False, reason="budget_exhausted")

    params = {"symbol": symbol, "apikey": FMP_KEY, **extra_params}
    try:
        r = requests.get(f"{FMP_BASE}{path}", params=params, headers=_REQ_HEADERS, timeout=_REQ_TIMEOUT)
    except requests.exceptions.Timeout:
        logger.warning("etf/provider.fetch(%s, %s): timeout", path, symbol)
        return FMPResult(ok=False, reason="timeout")
    except Exception as exc:
        logger.warning("etf/provider.fetch(%s, %s): request failed: %s", path, symbol, exc)
        return FMPResult(ok=False, reason="request_failed")

    if r.status_code == 402:
        logger.warning("etf/provider.fetch(%s, %s): 402 restricted — plan does not include this endpoint", path, symbol)
        return FMPResult(ok=False, status=402, reason="restricted_402")
    if r.status_code == 429:
        logger.warning("etf/provider.fetch(%s, %s): 429 rate limited", path, symbol)
        return FMPResult(ok=False, status=429, reason="rate_limited_429")
    if r.status_code >= 500:
        logger.warning("etf/provider.fetch(%s, %s): %s server error", path, symbol, r.status_code)
        return FMPResult(ok=False, status=r.status_code, reason="server_error_5xx")
    if r.status_code != 200:
        logger.warning("etf/provider.fetch(%s, %s): unexpected status %s", path, symbol, r.status_code)
        return FMPResult(ok=False, status=r.status_code, reason="unexpected_status")

    try:
        body = r.json()
    except Exception:
        logger.warning("etf/provider.fetch(%s, %s): 200 but malformed JSON body", path, symbol)
        return FMPResult(ok=False, status=200, reason="malformed_body")

    if not body:
        return FMPResult(ok=False, status=200, reason="empty")

    return FMPResult(ok=True, data=body, status=200)
