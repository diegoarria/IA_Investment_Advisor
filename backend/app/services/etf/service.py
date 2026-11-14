"""
Orchestrator — the one function the rest of the app should call:
get_etf_overview(ticker). Fetches all 7 Fase-1 endpoints via provider.py,
normalizes each via normalize.py, derives metrics.py's concentration/cost/
price-change signals, and returns one structured dict with an explicit
`missing_fields` list and per-group `fetched_at`/source stamps — never a
partial result presented as if it were complete.

Caching: reuses app.core.cache (Redis-backed in production, in-memory
locally — same shared layer Nuvos Radar's own sector_lookup.py already
uses) rather than building new cache infrastructure.

Fase 2A review split this into two independently cached groups, per
Diego's explicit ask to separate price caching from structural caching:
  - STRUCTURAL (etf/info, sector-weightings, country-weightings, profile):
    identification/costs/exposure data that changes at most a few times a
    year. Long TTL.
  - PRICE (quote, dividends, historical-price-eod): time-sensitive, cheap
    to refetch. Short TTL — so a user looking at "current price" a few
    hours later isn't shown a stale number just because the structural
    data around it is still valid for weeks.
Each group carries its own `fetched_at`, so the UI can honestly show "cost
data as of X, price as of Y" instead of one blended timestamp implying
everything is equally fresh.
"""
import logging
import time
from datetime import date, timedelta

from app.core.cache import cache_get, cache_set
from app.services.asset_classification import classify_asset, ETF
from app.services.etf import normalize
from app.services.etf.metrics import concentration_metrics, cost_tier, price_returns
from app.services.etf.provider import fetch

# How far back we ask FMP for daily closes — covers YTD/1-year/5-year real
# windows in a single call, within FMP's confirmed ~5,000-row-per-request
# cap (10y of daily closes is ~2,600 rows, comfortable margin). Not every
# fund's full since-inception history (some ETFs are 20+ years old) — see
# price_returns()'s docstring for how "max" stays honest about that.
_PRICE_HISTORY_YEARS = 10

logger = logging.getLogger(__name__)

_TTL_STRUCTURAL_S = 86400  # 24h — identification/costs/exposure
_TTL_PRICE_S = 1800        # 30min — quote/dividends/price history

# No real ETF charges anywhere near this — if FMP's expenseRatio field
# ever came back as a fraction instead of percentage-points (see
# normalize.py's docstring for the confirmed live shape) a 0.09 value
# would still look sane, but something like 9.0 would not. Flagged, not
# silently trusted or auto-corrected — a guess at the "right" scale could
# just as easily hide a real data problem.
_SUSPICIOUS_EXPENSE_RATIO_PCT = 5.0


class NotAnETFError(Exception):
    """Raised by get_etf_overview when `ticker` does not classify as ETF —
    this package must never silently build "ETF data" for an equity."""
    def __init__(self, ticker: str):
        self.ticker = ticker
        super().__init__(f"{ticker} did not classify as an ETF — refusing to fetch ETF-shaped data for it")


def _record(field: str, result, missing_fields: list, provider_errors: dict):
    if not result.ok:
        missing_fields.append(field)
        provider_errors[field] = result.reason or "unknown"
    return result


def _fetch_structural(ticker: str, use_cache: bool) -> dict:
    cache_key = f"etf_structural:{ticker}"
    if use_cache:
        cached = cache_get(cache_key)
        if cached is not None:
            return cached

    missing_fields: list[str] = []
    provider_errors: dict[str, str] = {}

    info_res = _record("info", fetch("/etf/info", ticker), missing_fields, provider_errors)
    sector_res = _record("sector_weightings", fetch("/etf/sector-weightings", ticker), missing_fields, provider_errors)
    country_res = _record("country_weightings", fetch("/etf/country-weightings", ticker), missing_fields, provider_errors)
    profile_res = _record("profile", fetch("/profile", ticker), missing_fields, provider_errors)

    info = normalize.normalize_etf_info(info_res.data[0]) if info_res.ok and info_res.data else {}
    sector_w = normalize.normalize_weightings(sector_res.data if sector_res.ok else [], name_key="sector")
    country_w = normalize.normalize_weightings(country_res.data if country_res.ok else [], name_key="country")
    profile = normalize.normalize_profile(profile_res.data[0]) if profile_res.ok and profile_res.data else {}

    expense_ratio = info.get("expense_ratio_pct")
    suspicious_expense_ratio = expense_ratio is not None and expense_ratio > _SUSPICIOUS_EXPENSE_RATIO_PCT

    result = {
        "info": info,
        "profile": profile,
        "sector_weightings": sector_w,
        "country_weightings": country_w,
        "missing_fields": missing_fields,
        "provider_errors": provider_errors,
        "suspicious_expense_ratio": suspicious_expense_ratio,
        "fetched_at": time.time(),
    }

    if len(missing_fields) < 4:
        cache_set(cache_key, result, ttl=_TTL_STRUCTURAL_S)
    else:
        logger.warning("etf/service._fetch_structural(%s): all structural fetches failed, not caching", ticker)

    return result


def _fetch_price_data(ticker: str, use_cache: bool) -> dict:
    cache_key = f"etf_price:{ticker}"
    if use_cache:
        cached = cache_get(cache_key)
        if cached is not None:
            return cached

    missing_fields: list[str] = []
    provider_errors: dict[str, str] = {}

    history_from = (date.today() - timedelta(days=365 * _PRICE_HISTORY_YEARS)).isoformat()
    history_to = date.today().isoformat()

    quote_res = _record("quote", fetch("/quote", ticker), missing_fields, provider_errors)
    dividends_res = _record("dividends", fetch("/dividends", ticker), missing_fields, provider_errors)
    history_res = _record(
        "price_history",
        fetch("/historical-price-eod/light", ticker, **{"from": history_from, "to": history_to}),
        missing_fields, provider_errors,
    )

    quote = normalize.normalize_quote(quote_res.data[0]) if quote_res.ok and quote_res.data else {}
    dividends = normalize.normalize_dividends(dividends_res.data) if dividends_res.ok else []
    price_history = normalize.normalize_price_history(history_res.data, limit=365 * _PRICE_HISTORY_YEARS) if history_res.ok else []

    result = {
        "quote": quote,
        "dividends": dividends,
        "price_history": price_history,
        "history_from": history_from,
        "missing_fields": missing_fields,
        "provider_errors": provider_errors,
        "fetched_at": time.time(),
    }

    if len(missing_fields) < 3:
        cache_set(cache_key, result, ttl=_TTL_PRICE_S)
    else:
        logger.warning("etf/service._fetch_price_data(%s): all price fetches failed, not caching", ticker)

    return result


def get_etf_card_summary(ticker: str, use_cache: bool = True, lang: str = "es") -> dict:
    """Fase 2B redesign (2nd iteration) — lightweight card data for the
    Explorer's enriched cards: name, ticker, a short description, expense
    ratio, and dominant sector. Deliberately reuses _fetch_structural's
    cache (same data get_etf_overview's identification/costs/exposure
    sections already pull from) instead of a new fetch path — showing 6
    of these costs zero extra FMP calls beyond what get_etf_overview
    already caches for 24h per ticker.

    Description: prefers editorial_descriptions.py's curated, factual
    Spanish/English one-liner (what index/theme the fund tracks — not a
    translation of FMP's English paragraph, not AI-generated) when this
    ticker is one Nuvos curates; honestly falls back to None (not a raw
    English paragraph) for anything outside that curated set — Diego,
    2026-11: "no inventes información... con fallback honesto."

    Raises NotAnETFError if `ticker` doesn't classify as ETF — same
    discipline as get_etf_overview, a card is never built for a non-ETF."""
    from app.services.etf.editorial_descriptions import get_editorial_description
    from app.services.etf.translations import translate_sector

    ticker = (ticker or "").strip().upper()
    if not ticker or classify_asset(ticker) != ETF:
        raise NotAnETFError(ticker)

    structural = _fetch_structural(ticker, use_cache)
    info = structural["info"]
    profile = structural["profile"]
    sector_items = structural["sector_weightings"]["items"]
    dominant_sector = translate_sector(sector_items[0]["name"], lang) if sector_items else None

    editorial = get_editorial_description(ticker, lang)

    return {
        "ticker": ticker,
        "name": info.get("name") or profile.get("symbol") or ticker,
        "short_description": editorial,
        "has_editorial_description": editorial is not None,
        "dominant_sector": dominant_sector,
        "expense_ratio_pct": info.get("expense_ratio_pct"),
        "cost_tier": cost_tier(info.get("expense_ratio_pct")),
        "etf_company": info.get("etf_company"),
        "unavailable_fields": structural["missing_fields"],
    }


def get_etf_overview(ticker: str, use_cache: bool = True, lang: str = "es") -> dict:
    """Returns a structured overview for `ticker`, or raises NotAnETFError
    if classify_asset() doesn't confirm it as an ETF (callers that already
    know the ticker is an ETF — e.g. a future ETF Explorer route that only
    ever lists real ETFs — can skip re-checking, but this function checks
    again anyway; it's one cheap, already-cached call, and never trusting
    a caller's say-so is the same discipline Phase 0's guard applies).

    Fase 2B, ficha individual redesign (2026-11): also returns `insights`
    (up to 3 rule-based observations, insights.py) and `horizon_note` (one
    static educational paragraph, same for every ETF on purpose — see
    insights.get_horizon_note's docstring). Sector/country names in
    `exposure`/`diversification` are translated via translations.py when
    lang="es"; the identification description prefers the curated
    editorial one-liner (editorial_descriptions.py) over FMP's raw English
    paragraph, honestly None when this ticker isn't curated."""
    from app.services.etf.editorial_descriptions import get_editorial_description
    from app.services.etf.insights import build_insights, get_horizon_note
    from app.services.etf.translations import translate_country, translate_sector

    ticker = (ticker or "").strip().upper()
    if not ticker:
        raise NotAnETFError(ticker)

    if classify_asset(ticker) != ETF:
        raise NotAnETFError(ticker)

    structural = _fetch_structural(ticker, use_cache)
    price_data = _fetch_price_data(ticker, use_cache)

    info = structural["info"]
    profile = structural["profile"]
    sector_w = structural["sector_weightings"]
    country_w = structural["country_weightings"]
    quote = price_data["quote"]
    dividends = price_data["dividends"]
    price_history = price_data["price_history"]
    # .get(), not [...]: a Redis-cached entry written by the pre-returns
    # code (up to _TTL_PRICE_S old right after this deploy) won't have this
    # key yet — never let a stale cache shape 500 the whole overview.
    history_from = price_data.get("history_from")

    missing_fields = structural["missing_fields"] + price_data["missing_fields"]
    provider_errors = {**structural["provider_errors"], **price_data["provider_errors"]}

    translated_sectors = [{"name": translate_sector(i["name"], lang), "weight_pct": i["weight_pct"]} for i in sector_w["items"]]
    translated_countries = [{"name": translate_country(i["name"], lang), "weight_pct": i["weight_pct"]} for i in country_w["items"]]

    by_sector = concentration_metrics(sector_w)
    by_country = concentration_metrics(country_w)
    by_sector["top1_name"] = translate_sector(by_sector["top1_name"], lang)
    by_country["top1_name"] = translate_country(by_country["top1_name"], lang)

    overview = {
        "ticker": ticker,
        "identification": {
            "name": info.get("name") or profile.get("symbol"),
            "etf_company": info.get("etf_company"),
            "description": get_editorial_description(ticker, lang),
            "has_editorial_description": get_editorial_description(ticker, lang) is not None,
            "inception_date": info.get("inception_date"),
            "domicile": info.get("domicile"),
            "exchange": profile.get("exchange_full_name") or profile.get("exchange"),
            "isin": profile.get("isin"),
            # Fase 6B (Nuvos Pulse): FMP's own stated date for when it last
            # refreshed this fund's structural data (sector/country
            # weightings included) — from the SAME /etf/info call above,
            # never a second request. None when FMP doesn't provide it; a
            # snapshot that needs to record "¿qué tan vigente es esta
            # exposición sectorial?" must fall back to its own query time,
            # never guess this field.
            "sector_exposure_provider_updated_at": info.get("provider_updated_at"),
        },
        "costs": {
            "expense_ratio_pct": info.get("expense_ratio_pct"),
            "cost_tier": cost_tier(info.get("expense_ratio_pct")),
            "aum_usd": info.get("aum_usd"),
            "nav": info.get("nav"),
            "nav_currency": info.get("nav_currency"),
        },
        "exposure": {
            "sector_weightings": translated_sectors,
            "sector_weight_sum_pct": sector_w["sum_pct"],
            "sector_weight_sum_in_expected_range": sector_w["sum_in_expected_range"],
            "country_weightings": translated_countries,
            "country_weight_sum_pct": country_w["sum_pct"],
            "country_weight_sum_in_expected_range": country_w["sum_in_expected_range"],
            "holdings_count": info.get("holdings_count"),
        },
        "diversification": {
            "by_sector": by_sector,
            "by_country": by_country,
        },
        "price": {
            "current": quote.get("price") or profile.get("price"),
            "change_pct_today": quote.get("change_pct"),
            "year_low": quote.get("year_low"),
            "year_high": quote.get("year_high"),
            "volume": quote.get("volume"),
            "returns": price_returns(price_history, history_from),
        },
        "dividends": {
            "recent": dividends,
            "latest_yield_pct": dividends[0]["yield_pct"] if dividends else None,
        },
        "data_quality": {
            "source": "fmp",
            "structural_fetched_at": structural["fetched_at"],
            "price_fetched_at": price_data["fetched_at"],
            "missing_fields": missing_fields,
            "provider_errors": provider_errors,
            "is_actively_trading": info.get("is_actively_trading"),
            "suspicious_expense_ratio": structural["suspicious_expense_ratio"],
        },
    }
    overview["insights"] = build_insights(overview, lang)
    overview["horizon_note"] = get_horizon_note(lang)
    return overview
