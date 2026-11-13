"""
Nuvos Plus — Fase 4A: minimal, read-only FMP /profile fetch for individual
equities, scoped to exactly what the exposure combiner needs and nothing
already in `financial_data_service.get_company_profile_fmp` exposes.

Why a new (tiny) fetcher instead of reusing get_company_profile_fmp: that
function deliberately maps only name/sector/exchange/shares/market-cap
(mirroring Finnhub's own profile shape, per its own docstring) — it does
NOT surface `currency` or `country`, both of which this combiner needs
(currency to convert a foreign-listed equity's market value into the
portfolio's own currency; country as the ONLY geographic signal available
for an individual equity, explicitly labeled "domicile" per Diego's
2026-11 requirement never to conflate it with an ETF's underlying-asset
geography). Modifying get_company_profile_fmp's shape would risk every
other caller of that function (fundamental_analysis_service, earnings,
etc.) — out of scope and unnecessary when this is three extra fields
behind the exact same FMP endpoint.

Same honesty discipline as app.services.etf.provider: never raises, never
fabricates a value, returns {} on any failure. Cached 24h (country/sector/
currency change essentially never for an existing listed company)."""
import logging

import requests

from app.core.cache import cache_get, cache_set
from app.core.config import settings

logger = logging.getLogger(__name__)

FMP_KEY = settings.fmp_api_key or ""
FMP_BASE = "https://financialmodelingprep.com/stable"
_REQ_HEADERS = {"User-Agent": "Nuvos/1.0"}
_REQ_TIMEOUT = 10
_TTL_S = 86400


def get_equity_profile(ticker: str) -> dict:
    """Returns {"sector": str|None, "country": str|None, "currency": str|None,
    "company_name": str|None} — each field independently None when FMP
    didn't return it, never a guessed default (a missing currency must NOT
    be assumed as "USD" by the caller; see combiner.py's valuation step).

    `company_name` (Fase 5D, 2026-11: logo/ticker/name identity across
    "Antes de invertir") is FMP's own `companyName` from the SAME /profile
    call this function already makes for sector/country/currency — never
    a second request, never a guessed/derived name."""
    ticker = (ticker or "").strip().upper()
    if not ticker:
        return {}
    if not FMP_KEY:
        return {}

    ck = f"portfolio_exposure:equity_profile:{ticker}"
    cached = cache_get(ck)
    if cached is not None:
        return cached

    result = _fetch_equity_profile_raw(ticker)
    if not result:
        # Fase 8-hotfix (BRK.B, confirmed live against FMP): a dual-class
        # suffix written with a dot ("BRK.B") returns an empty /profile —
        # FMP's real symbol is the hyphen form ("BRK-B"). Retried ONLY
        # after the original attempt fails (a ticker that already works
        # never pays for a second request) and ONLY when
        # canonicalize_ticker_suffix actually changes something (most
        # tickers have no dot suffix at all).
        from app.services.company_valuation_service import canonicalize_ticker_suffix
        canonical = canonicalize_ticker_suffix(ticker)
        if canonical != ticker:
            result = _fetch_equity_profile_raw(canonical)

    if result:
        cache_set(ck, result, ttl=_TTL_S)
    return result or {}


def _fetch_equity_profile_raw(ticker: str) -> dict:
    """One real, budget-checked /profile attempt for the EXACT `ticker`
    string given — no caching, no fallback retry (that's the caller's
    job). Never raises, returns {} on any failure."""
    from app.core.fmp_budget import fmp_call_allowed
    if not fmp_call_allowed():
        return {}

    try:
        r = requests.get(
            f"{FMP_BASE}/profile",
            params={"symbol": ticker, "apikey": FMP_KEY},
            headers=_REQ_HEADERS,
            timeout=_REQ_TIMEOUT,
        )
        if r.status_code != 200:
            return {}
        data = r.json()
        if not isinstance(data, list) or not data:
            return {}
        d = data[0]
        return {
            "sector": d.get("sector") or None,
            "country": d.get("country") or None,
            "currency": d.get("currency") or None,
            "company_name": d.get("companyName") or None,
        }
    except Exception as exc:
        logger.debug("portfolio_exposure.equity_profile(%s) failed: %s", ticker, exc)
        return {}
