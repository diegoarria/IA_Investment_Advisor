"""
Unit normalization + validation for raw FMP ETF responses.

Confirmed live during the Fase 1 audit (2026-11) — these fields are NOT
uniformly shaped across FMP's own endpoints, and getting this wrong would
silently show numbers off by 100x or as the wrong type:

  - /etf/info's `expenseRatio` is already a percentage-point NUMBER
    (0.09 means "0.09%", not "9%" — confirmed against SPY's real,
    published 0.09% expense ratio).
  - /etf/sector-weightings' `weightPercentage` is already a
    percentage-point FLOAT (38.62 means "38.62%").
  - /etf/country-weightings' `weightPercentage` is a STRING with a literal
    "%" suffix ("97.27%") — NOT a number, and NOT the same shape as the
    sector endpoint despite both being "a weight percentage."
  - /dividends' `yield` field is also already a percentage-point number
    (0.42 means "0.42%" — confirmed against QQQ's real, published ~0.4%
    yield; VXUS's real ~2.3% yield matches a raw value of ~2.31 exactly).

Every normalizer here returns `None` (never a fabricated 0 or guessed
value) for a field it cannot parse — that absence is what service.py's
missing-field tracking surfaces, per the explicit "no inventar datos
faltantes" requirement.
"""
import logging

logger = logging.getLogger(__name__)

# A real ETF's sector/country weights should sum close to 100% — FMP's own
# rounding, cash positions, and derivatives exposure mean exact 100.0 is
# rare. Flagged (not rejected) outside this band as a data-quality signal,
# since FMP occasionally returns a partial/stale weighting set.
_WEIGHT_SUM_TOLERANCE_PCT = (85.0, 115.0)


def _parse_percent_string(value) -> float | None:
    """'97.27%' -> 97.27. Returns None (not 0) for anything unparseable —
    0 would misleadingly claim "this country/sector is 0% of the fund"."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.strip().rstrip("%").strip()
        try:
            return float(cleaned)
        except ValueError:
            logger.debug("normalize: could not parse percent string %r", value)
            return None
    return None


def normalize_weightings(raw: list[dict], name_key: str) -> dict:
    """Shared normalizer for both /etf/sector-weightings (weightPercentage
    as float) and /etf/country-weightings (weightPercentage as "X%"
    string) — _parse_percent_string handles both shapes transparently.

    Returns {"items": [{"name": str, "weight_pct": float}, ...] sorted
    descending, "sum_pct": float | None, "sum_in_expected_range": bool}."""
    items = []
    for row in raw or []:
        name = row.get(name_key)
        weight = _parse_percent_string(row.get("weightPercentage"))
        if name is None or weight is None:
            continue  # silently dropped, never fabricated — caller sees fewer items, not wrong ones
        items.append({"name": name, "weight_pct": round(weight, 4)})
    items.sort(key=lambda x: x["weight_pct"], reverse=True)
    total = round(sum(i["weight_pct"] for i in items), 2) if items else None
    in_range = total is not None and _WEIGHT_SUM_TOLERANCE_PCT[0] <= total <= _WEIGHT_SUM_TOLERANCE_PCT[1]
    return {"items": items, "sum_pct": total, "sum_in_expected_range": in_range}


def normalize_etf_info(raw: dict) -> dict:
    """raw is the single object from /etf/info's array (already unwrapped
    by the caller). Returns only fields confirmed present in the live
    response shape — never invents a field FMP didn't return."""
    def _num(key):
        v = raw.get(key)
        return float(v) if isinstance(v, (int, float)) else None

    return {
        "name": raw.get("name"),
        "description": raw.get("description"),
        "etf_company": raw.get("etfCompany"),
        "expense_ratio_pct": _num("expenseRatio"),
        "aum_usd": _num("assetsUnderManagement"),
        "nav": _num("nav"),
        "nav_currency": raw.get("navCurrency"),
        "inception_date": raw.get("inceptionDate"),
        "holdings_count": raw.get("holdingsCount") if isinstance(raw.get("holdingsCount"), int) else None,
        "domicile": raw.get("domicile"),
        "asset_class": raw.get("assetClass"),
        "is_actively_trading": raw.get("isActivelyTrading"),
        "provider_updated_at": raw.get("updatedAt"),
    }


def normalize_profile(raw: dict) -> dict:
    return {
        "symbol": raw.get("symbol"),
        "price": raw.get("price") if isinstance(raw.get("price"), (int, float)) else None,
        "market_cap_usd": raw.get("marketCap") if isinstance(raw.get("marketCap"), (int, float)) else None,
        "exchange": raw.get("exchange"),
        "exchange_full_name": raw.get("exchangeFullName"),
        "currency": raw.get("currency"),
        "isin": raw.get("isin"),
        "year_range": raw.get("range"),
    }


def normalize_quote(raw: dict) -> dict:
    return {
        "price": raw.get("price") if isinstance(raw.get("price"), (int, float)) else None,
        "change": raw.get("change") if isinstance(raw.get("change"), (int, float)) else None,
        "change_pct": raw.get("changePercentage") if isinstance(raw.get("changePercentage"), (int, float)) else None,
        "day_low": raw.get("dayLow"),
        "day_high": raw.get("dayHigh"),
        "year_low": raw.get("yearLow"),
        "year_high": raw.get("yearHigh"),
        "volume": raw.get("volume"),
        "avg_volume": raw.get("averageVolume"),
    }


def normalize_dividends(raw: list[dict], limit: int = 8) -> list[dict]:
    """Most recent `limit` dividend payments, newest first (FMP already
    returns them that way — not re-sorted here to avoid silently masking
    a provider ordering change; service.py's tests cover ordering)."""
    out = []
    for row in (raw or [])[:limit]:
        out.append({
            "ex_date": row.get("date"),
            "payment_date": row.get("paymentDate"),
            "amount": row.get("adjDividend") if isinstance(row.get("adjDividend"), (int, float)) else None,
            "yield_pct": row.get("yield") if isinstance(row.get("yield"), (int, float)) else None,
            "frequency": row.get("frequency"),
        })
    return out


def normalize_price_history(raw: list[dict], limit: int = 260) -> list[dict]:
    """Most recent `limit` daily closes (~1 trading year by default)."""
    out = []
    for row in (raw or [])[:limit]:
        price = row.get("price")
        if not isinstance(price, (int, float)):
            continue
        out.append({"date": row.get("date"), "price": float(price), "volume": row.get("volume")})
    return out
