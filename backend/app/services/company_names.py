"""
Ticker -> short display company name (e.g. "AAPL" -> "Apple").

Moved out of worker.py (2026-09-09) so weekly_rituals_service.py can reuse
it for the Premium "Prepárate para la semana" top-5 copy without violating
weekly_rituals_service's own module docstring rule against importing from
worker.py (a standalone script, not a package other modules should depend
on). worker.py keeps calling this via its existing `_company_name` name —
see the import at the top of worker.py.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# Fallback: if ticker not here, use the ticker symbol itself.
_COMPANY_NAMES: dict[str, str] = {
    "AAPL": "Apple",           "MSFT": "Microsoft",     "GOOGL": "Alphabet",
    "GOOG": "Alphabet",        "AMZN": "Amazon",         "META": "Meta",
    "TSLA": "Tesla",           "NVDA": "NVIDIA",         "AMD": "AMD",
    "INTC": "Intel",           "ORCL": "Oracle",         "CRM": "Salesforce",
    "ADBE": "Adobe",           "NFLX": "Netflix",        "DIS": "Disney",
    "SBUX": "Starbucks",       "V": "Visa",              "MA": "Mastercard",
    "JPM": "JPMorgan",         "BAC": "Bank of America", "GS": "Goldman Sachs",
    "MS": "Morgan Stanley",    "WFC": "Wells Fargo",     "C": "Citigroup",
    "JNJ": "Johnson & Johnson","PFE": "Pfizer",          "ABBV": "AbbVie",
    "UNH": "UnitedHealth",     "MRK": "Merck",           "AMGN": "Amgen",
    "XOM": "ExxonMobil",       "CVX": "Chevron",         "COP": "ConocoPhillips",
    "KO": "Coca-Cola",         "PEP": "PepsiCo",         "WMT": "Walmart",
    "COST": "Costco",          "HD": "Home Depot",       "MCD": "McDonald's",
    "BA": "Boeing",            "CAT": "Caterpillar",
    "GE": "GE",                "MMM": "3M",              "NKE": "Nike",
    "PG": "Procter & Gamble",  "VZ": "Verizon",          "T": "AT&T",
    "NEE": "NextEra Energy",   "SO": "Southern Company", "O": "Realty Income",
    "SPY": "S&P 500 ETF",      "QQQ": "NASDAQ ETF",      "IWM": "Russell 2000 ETF",
    "VOO": "Vanguard S&P 500", "VTI": "Vanguard Total Market",
    "PLTR": "Palantir",        "COIN": "Coinbase",       "SOFI": "SoFi",
    "RKLB": "Rocket Lab",      "MSTR": "MicroStrategy",  "SMCI": "Super Micro",
    "BE": "Bloom Energy",      "BRK-B": "Berkshire",     "BRK.B": "Berkshire",
    "SHOP": "Shopify",         "SQ": "Block",            "PYPL": "PayPal",
    "UBER": "Uber",            "ABNB": "Airbnb",         "HOOD": "Robinhood",
    "RIVN": "Rivian",          "LCID": "Lucid",          "NIO": "NIO",
    "BABA": "Alibaba",         "TSM": "TSMC",            "ASML": "ASML",
    "SNOW": "Snowflake",       "DDOG": "Datadog",        "ZM": "Zoom",
    "CRWD": "CrowdStrike",     "PANW": "Palo Alto",      "OKTA": "Okta",
    "ARM": "Arm Holdings",     "AVGO": "Broadcom",       "QCOM": "Qualcomm",
    "TXN": "Texas Instruments","MU": "Micron Technology","AMAT": "Applied Materials",
    "GEV": "GE Vernova",       "MELI": "Mercado Libre",
}


def company_name(ticker: str) -> str:
    """Real company name for a ticker — never just falls back to the bare
    ticker symbol silently. Checks the hand-curated short-name map first
    (fastest, no I/O, and gives nicer short names like "Amazon" instead of
    "Amazon.com, Inc." for the ~90 most common tickers), then the curated
    screener UNIVERSE (also no I/O), then a real Finnhub company-profile
    lookup (cached 24h) for any other real ticker — e.g. "GE Vernova" or
    "MercadoLibre" previously showed up as the bare ticker in push
    notifications simply because they weren't in the hardcoded map. Only
    returns the bare ticker if Finnhub itself has no profile for it."""
    if ticker in _COMPANY_NAMES:
        return _COMPANY_NAMES[ticker]
    try:
        from app.api.routes.screener import UNIVERSE
        universe_match = next((u["name"] for u in UNIVERSE if u["ticker"] == ticker), None)
        if universe_match:
            return universe_match
    except Exception:
        pass
    try:
        from app.core.finnhub import fh_profile
        profile = fh_profile(ticker)
        if profile and profile.get("name"):
            return profile["name"]
    except Exception as e:
        logger.warning("company_name(%s): Finnhub profile fallback failed: %s", ticker, e)
    return ticker
