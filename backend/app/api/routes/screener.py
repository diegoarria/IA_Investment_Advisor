import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import get_current_user_id
from app.services import ai_service
from app.services import nif_service
from app.api.routes.market import _get_user_profile
from app.core.cache import cache_get, cache_set
from app.core.database import get_supabase, run_query
from app.core.finnhub import fh_quote, fh_metrics, fh_search

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/market/screener", tags=["screener"])

UNIVERSE = [
    # ── Technology ─────────────────────────────────────────────────────────────
    # Consumer Electronics
    {"ticker": "AAPL",  "name": "Apple",              "sector": "Technology",             "industry": "Consumer Electronics"},
    # Software – Infrastructure
    {"ticker": "MSFT",  "name": "Microsoft",          "sector": "Technology",             "industry": "Software - Infrastructure"},
    {"ticker": "ORCL",  "name": "Oracle",             "sector": "Technology",             "industry": "Software - Infrastructure"},
    {"ticker": "PANW",  "name": "Palo Alto Networks", "sector": "Technology",             "industry": "Software - Infrastructure"},
    {"ticker": "NET",   "name": "Cloudflare",         "sector": "Technology",             "industry": "Software - Infrastructure"},
    # Software – Application
    {"ticker": "CRM",   "name": "Salesforce",         "sector": "Technology",             "industry": "Software - Application"},
    {"ticker": "ADBE",  "name": "Adobe",              "sector": "Technology",             "industry": "Software - Application"},
    {"ticker": "SHOP",  "name": "Shopify",            "sector": "Technology",             "industry": "Software - Application"},
    {"ticker": "NOW",   "name": "ServiceNow",         "sector": "Technology",             "industry": "Software - Application"},
    {"ticker": "INTU",  "name": "Intuit",             "sector": "Technology",             "industry": "Software - Application"},
    {"ticker": "SNOW",  "name": "Snowflake",          "sector": "Technology",             "industry": "Software - Application"},
    {"ticker": "PLTR",  "name": "Palantir",           "sector": "Technology",             "industry": "Software - Application"},
    {"ticker": "DDOG",  "name": "Datadog",            "sector": "Technology",             "industry": "Software - Application"},
    # Semiconductors
    {"ticker": "NVDA",  "name": "NVIDIA",             "sector": "Technology",             "industry": "Semiconductors"},
    {"ticker": "AMD",   "name": "AMD",                "sector": "Technology",             "industry": "Semiconductors"},
    {"ticker": "AVGO",  "name": "Broadcom",           "sector": "Technology",             "industry": "Semiconductors"},
    {"ticker": "QCOM",  "name": "Qualcomm",           "sector": "Technology",             "industry": "Semiconductors"},
    {"ticker": "TSM",   "name": "TSMC",               "sector": "Technology",             "industry": "Semiconductors"},
    {"ticker": "TXN",   "name": "Texas Instruments",  "sector": "Technology",             "industry": "Semiconductors"},
    {"ticker": "INTC",  "name": "Intel",              "sector": "Technology",             "industry": "Semiconductors"},
    {"ticker": "AMAT",  "name": "Applied Materials",  "sector": "Technology",             "industry": "Semiconductor Equipment & Materials"},
    {"ticker": "ARM",   "name": "Arm Holdings",       "sector": "Technology",             "industry": "Semiconductors"},
    # Communication Equipment
    {"ticker": "CSCO",  "name": "Cisco",              "sector": "Technology",             "industry": "Communication Equipment"},
    # Solar
    {"ticker": "ENPH",  "name": "Enphase Energy",     "sector": "Technology",             "industry": "Solar"},
    {"ticker": "FSLR",  "name": "First Solar",        "sector": "Technology",             "industry": "Solar"},

    # ── Communication Services ─────────────────────────────────────────────────
    # Internet Content & Information
    {"ticker": "GOOGL", "name": "Alphabet",           "sector": "Communication Services", "industry": "Internet Content & Information"},
    {"ticker": "META",  "name": "Meta Platforms",     "sector": "Communication Services", "industry": "Internet Content & Information"},
    {"ticker": "SNAP",  "name": "Snap",               "sector": "Communication Services", "industry": "Internet Content & Information"},
    {"ticker": "PINS",  "name": "Pinterest",          "sector": "Communication Services", "industry": "Internet Content & Information"},
    # Entertainment
    {"ticker": "NFLX",  "name": "Netflix",            "sector": "Communication Services", "industry": "Entertainment"},
    {"ticker": "DIS",   "name": "Walt Disney",        "sector": "Communication Services", "industry": "Entertainment"},
    {"ticker": "RBLX",  "name": "Roblox",             "sector": "Communication Services", "industry": "Electronic Gaming & Multimedia"},
    {"ticker": "SPOT",  "name": "Spotify",            "sector": "Communication Services", "industry": "Entertainment"},
    # Telecom Services
    {"ticker": "VZ",    "name": "Verizon",            "sector": "Communication Services", "industry": "Telecom Services"},
    {"ticker": "T",     "name": "AT&T",               "sector": "Communication Services", "industry": "Telecom Services"},
    {"ticker": "TMUS",  "name": "T-Mobile",           "sector": "Communication Services", "industry": "Telecom Services"},
    {"ticker": "CMCSA", "name": "Comcast",            "sector": "Communication Services", "industry": "Telecom Services"},

    # ── Consumer Discretionary ─────────────────────────────────────────────────
    # Internet Retail
    {"ticker": "AMZN",  "name": "Amazon",             "sector": "Consumer Discretionary", "industry": "Internet Retail"},
    {"ticker": "MELI",  "name": "MercadoLibre",       "sector": "Consumer Discretionary", "industry": "Internet Retail"},
    {"ticker": "BABA",  "name": "Alibaba",            "sector": "Consumer Discretionary", "industry": "Internet Retail"},
    {"ticker": "EBAY",  "name": "eBay",               "sector": "Consumer Discretionary", "industry": "Internet Retail"},
    # Auto Manufacturers
    {"ticker": "TSLA",  "name": "Tesla",              "sector": "Consumer Discretionary", "industry": "Auto Manufacturers"},
    {"ticker": "GM",    "name": "General Motors",     "sector": "Consumer Discretionary", "industry": "Auto Manufacturers"},
    {"ticker": "F",     "name": "Ford",               "sector": "Consumer Discretionary", "industry": "Auto Manufacturers"},
    {"ticker": "RIVN",  "name": "Rivian",             "sector": "Consumer Discretionary", "industry": "Auto Manufacturers"},
    # Restaurants
    {"ticker": "MCD",   "name": "McDonald's",         "sector": "Consumer Discretionary", "industry": "Restaurants"},
    {"ticker": "SBUX",  "name": "Starbucks",          "sector": "Consumer Discretionary", "industry": "Restaurants"},
    {"ticker": "CMG",   "name": "Chipotle",           "sector": "Consumer Discretionary", "industry": "Restaurants"},
    # Home Improvement Retail
    {"ticker": "HD",    "name": "Home Depot",         "sector": "Consumer Discretionary", "industry": "Home Improvement Retail"},
    {"ticker": "LOW",   "name": "Lowe's",             "sector": "Consumer Discretionary", "industry": "Home Improvement Retail"},
    # Travel Services
    {"ticker": "BKNG",  "name": "Booking Holdings",  "sector": "Consumer Discretionary", "industry": "Travel Services"},
    {"ticker": "ABNB",  "name": "Airbnb",             "sector": "Consumer Discretionary", "industry": "Travel Services"},
    # Apparel / Footwear
    {"ticker": "NKE",   "name": "Nike",               "sector": "Consumer Discretionary", "industry": "Footwear & Accessories"},
    # Specialty Retail
    {"ticker": "TJX",   "name": "TJX Companies",      "sector": "Consumer Discretionary", "industry": "Apparel Retail"},
    {"ticker": "UBER",  "name": "Uber",               "sector": "Consumer Discretionary", "industry": "Specialty Retail"},

    # ── Consumer Staples ────────────────────────────────────────────────────────
    {"ticker": "WMT",   "name": "Walmart",            "sector": "Consumer Staples",        "industry": "Discount Stores"},
    {"ticker": "COST",  "name": "Costco",             "sector": "Consumer Staples",        "industry": "Discount Stores"},
    {"ticker": "TGT",   "name": "Target",             "sector": "Consumer Staples",        "industry": "Discount Stores"},
    {"ticker": "KO",    "name": "Coca-Cola",          "sector": "Consumer Staples",        "industry": "Beverages - Non-Alcoholic"},
    {"ticker": "PEP",   "name": "PepsiCo",            "sector": "Consumer Staples",        "industry": "Beverages - Non-Alcoholic"},
    {"ticker": "PG",    "name": "Procter & Gamble",   "sector": "Consumer Staples",        "industry": "Household & Personal Products"},
    {"ticker": "MDLZ",  "name": "Mondelez",           "sector": "Consumer Staples",        "industry": "Packaged Foods"},
    {"ticker": "GIS",   "name": "General Mills",      "sector": "Consumer Staples",        "industry": "Packaged Foods"},
    {"ticker": "PM",    "name": "Philip Morris",      "sector": "Consumer Staples",        "industry": "Tobacco"},
    {"ticker": "MO",    "name": "Altria",             "sector": "Consumer Staples",        "industry": "Tobacco"},

    # ── Healthcare ─────────────────────────────────────────────────────────────
    # Drug Manufacturers – General
    {"ticker": "LLY",   "name": "Eli Lilly",          "sector": "Healthcare",              "industry": "Drug Manufacturers - General"},
    {"ticker": "JNJ",   "name": "Johnson & Johnson",  "sector": "Healthcare",              "industry": "Drug Manufacturers - General"},
    {"ticker": "ABBV",  "name": "AbbVie",             "sector": "Healthcare",              "industry": "Drug Manufacturers - General"},
    {"ticker": "MRK",   "name": "Merck",              "sector": "Healthcare",              "industry": "Drug Manufacturers - General"},
    {"ticker": "PFE",   "name": "Pfizer",             "sector": "Healthcare",              "industry": "Drug Manufacturers - General"},
    {"ticker": "NVO",   "name": "Novo Nordisk",       "sector": "Healthcare",              "industry": "Drug Manufacturers - General"},
    {"ticker": "AZN",   "name": "AstraZeneca",        "sector": "Healthcare",              "industry": "Drug Manufacturers - General"},
    {"ticker": "BMY",   "name": "Bristol-Myers Squibb","sector": "Healthcare",             "industry": "Drug Manufacturers - General"},
    # Biotechnology
    {"ticker": "AMGN",  "name": "Amgen",              "sector": "Healthcare",              "industry": "Biotechnology"},
    {"ticker": "GILD",  "name": "Gilead Sciences",    "sector": "Healthcare",              "industry": "Biotechnology"},
    {"ticker": "REGN",  "name": "Regeneron",          "sector": "Healthcare",              "industry": "Biotechnology"},
    {"ticker": "VRTX",  "name": "Vertex Pharma",      "sector": "Healthcare",              "industry": "Biotechnology"},
    {"ticker": "MRNA",  "name": "Moderna",            "sector": "Healthcare",              "industry": "Biotechnology"},
    # Healthcare Plans
    {"ticker": "UNH",   "name": "UnitedHealth",       "sector": "Healthcare",              "industry": "Healthcare Plans"},
    {"ticker": "CVS",   "name": "CVS Health",         "sector": "Healthcare",              "industry": "Healthcare Plans"},
    {"ticker": "CI",    "name": "Cigna",              "sector": "Healthcare",              "industry": "Healthcare Plans"},
    # Medical Devices
    {"ticker": "ABT",   "name": "Abbott Labs",        "sector": "Healthcare",              "industry": "Medical Devices"},
    {"ticker": "MDT",   "name": "Medtronic",          "sector": "Healthcare",              "industry": "Medical Devices"},
    {"ticker": "ISRG",  "name": "Intuitive Surgical", "sector": "Healthcare",              "industry": "Medical Instruments & Supplies"},

    # ── Financials ─────────────────────────────────────────────────────────────
    # Banks – Diversified
    {"ticker": "JPM",   "name": "JPMorgan Chase",     "sector": "Financials",              "industry": "Banks - Diversified"},
    {"ticker": "BAC",   "name": "Bank of America",    "sector": "Financials",              "industry": "Banks - Diversified"},
    {"ticker": "WFC",   "name": "Wells Fargo",        "sector": "Financials",              "industry": "Banks - Diversified"},
    {"ticker": "C",     "name": "Citigroup",          "sector": "Financials",              "industry": "Banks - Diversified"},
    # Capital Markets
    {"ticker": "GS",    "name": "Goldman Sachs",      "sector": "Financials",              "industry": "Capital Markets"},
    {"ticker": "MS",    "name": "Morgan Stanley",     "sector": "Financials",              "industry": "Capital Markets"},
    {"ticker": "BX",    "name": "Blackstone",         "sector": "Financials",              "industry": "Asset Management - Global"},
    {"ticker": "BLK",   "name": "BlackRock",          "sector": "Financials",              "industry": "Asset Management - Global"},
    {"ticker": "SCHW",  "name": "Charles Schwab",     "sector": "Financials",              "industry": "Capital Markets"},
    {"ticker": "SPGI",  "name": "S&P Global",         "sector": "Financials",              "industry": "Financial Data & Stock Exchanges"},
    # Credit Services
    {"ticker": "V",     "name": "Visa",               "sector": "Financials",              "industry": "Credit Services"},
    {"ticker": "MA",    "name": "Mastercard",         "sector": "Financials",              "industry": "Credit Services"},
    {"ticker": "AXP",   "name": "American Express",   "sector": "Financials",              "industry": "Credit Services"},
    {"ticker": "PYPL",  "name": "PayPal",             "sector": "Financials",              "industry": "Credit Services"},
    # Insurance
    {"ticker": "BRK-B", "name": "Berkshire Hathaway", "sector": "Financials",              "industry": "Insurance - Diversified"},
    {"ticker": "PGR",   "name": "Progressive",        "sector": "Financials",              "industry": "Insurance - Property & Casualty"},
    {"ticker": "CB",    "name": "Chubb",              "sector": "Financials",              "industry": "Insurance - Property & Casualty"},
    # Crypto / Blockchain
    {"ticker": "COIN",  "name": "Coinbase",           "sector": "Financials",              "industry": "Capital Markets"},

    # ── Energy ─────────────────────────────────────────────────────────────────
    {"ticker": "XOM",   "name": "ExxonMobil",         "sector": "Energy",                  "industry": "Oil & Gas Integrated"},
    {"ticker": "CVX",   "name": "Chevron",            "sector": "Energy",                  "industry": "Oil & Gas Integrated"},
    {"ticker": "COP",   "name": "ConocoPhillips",     "sector": "Energy",                  "industry": "Oil & Gas E&P"},
    {"ticker": "OXY",   "name": "Occidental",         "sector": "Energy",                  "industry": "Oil & Gas E&P"},
    {"ticker": "SLB",   "name": "Schlumberger",       "sector": "Energy",                  "industry": "Oil & Gas Equipment & Services"},
    {"ticker": "EOG",   "name": "EOG Resources",      "sector": "Energy",                  "industry": "Oil & Gas E&P"},
    {"ticker": "PSX",   "name": "Phillips 66",        "sector": "Energy",                  "industry": "Oil & Gas Refining & Marketing"},

    # ── Industrials ─────────────────────────────────────────────────────────────
    {"ticker": "GE",    "name": "GE Aerospace",       "sector": "Industrials",             "industry": "Aerospace & Defense"},
    {"ticker": "BA",    "name": "Boeing",             "sector": "Industrials",             "industry": "Aerospace & Defense"},
    {"ticker": "LMT",   "name": "Lockheed Martin",    "sector": "Industrials",             "industry": "Aerospace & Defense"},
    {"ticker": "RTX",   "name": "RTX Corp",           "sector": "Industrials",             "industry": "Aerospace & Defense"},
    {"ticker": "NOC",   "name": "Northrop Grumman",   "sector": "Industrials",             "industry": "Aerospace & Defense"},
    {"ticker": "CAT",   "name": "Caterpillar",        "sector": "Industrials",             "industry": "Farm & Heavy Construction Machinery"},
    {"ticker": "DE",    "name": "Deere & Co",         "sector": "Industrials",             "industry": "Farm & Heavy Construction Machinery"},
    {"ticker": "HON",   "name": "Honeywell",          "sector": "Industrials",             "industry": "Specialty Industrial Machinery"},
    {"ticker": "UNP",   "name": "Union Pacific",      "sector": "Industrials",             "industry": "Railroads"},
    {"ticker": "UPS",   "name": "UPS",                "sector": "Industrials",             "industry": "Integrated Freight & Logistics"},
    {"ticker": "FDX",   "name": "FedEx",              "sector": "Industrials",             "industry": "Integrated Freight & Logistics"},
    {"ticker": "ODFL",  "name": "Old Dominion",       "sector": "Industrials",             "industry": "Trucking"},

    # ── Materials ────────────────────────────────────────────────────────────────
    {"ticker": "LIN",   "name": "Linde",              "sector": "Materials",               "industry": "Specialty Chemicals"},
    {"ticker": "SHW",   "name": "Sherwin-Williams",   "sector": "Materials",               "industry": "Specialty Chemicals"},
    {"ticker": "NEM",   "name": "Newmont",            "sector": "Materials",               "industry": "Gold"},
    {"ticker": "FCX",   "name": "Freeport-McMoRan",  "sector": "Materials",               "industry": "Copper"},
    {"ticker": "ALB",   "name": "Albemarle",          "sector": "Materials",               "industry": "Specialty Chemicals"},
    {"ticker": "NUE",   "name": "Nucor",              "sector": "Materials",               "industry": "Steel"},

    # ── Real Estate ──────────────────────────────────────────────────────────────
    {"ticker": "AMT",   "name": "American Tower",     "sector": "Real Estate",             "industry": "REIT - Specialty"},
    {"ticker": "PLD",   "name": "Prologis",           "sector": "Real Estate",             "industry": "REIT - Industrial"},
    {"ticker": "EQIX",  "name": "Equinix",            "sector": "Real Estate",             "industry": "REIT - Specialty"},
    {"ticker": "O",     "name": "Realty Income",      "sector": "Real Estate",             "industry": "REIT - Retail"},
    {"ticker": "SPG",   "name": "Simon Property",     "sector": "Real Estate",             "industry": "REIT - Retail"},
    {"ticker": "VICI",  "name": "VICI Properties",    "sector": "Real Estate",             "industry": "REIT - Specialty"},

    # ── Utilities ────────────────────────────────────────────────────────────────
    {"ticker": "NEE",   "name": "NextEra Energy",     "sector": "Utilities",               "industry": "Utilities - Regulated Electric"},
    {"ticker": "DUK",   "name": "Duke Energy",        "sector": "Utilities",               "industry": "Utilities - Regulated Electric"},
    {"ticker": "SO",    "name": "Southern Co",        "sector": "Utilities",               "industry": "Utilities - Regulated Electric"},
    {"ticker": "AEP",   "name": "AEP",                "sector": "Utilities",               "industry": "Utilities - Regulated Electric"},

    # ── ETFs ─────────────────────────────────────────────────────────────────────
    {"ticker": "SPY",   "name": "S&P 500 ETF",        "sector": "ETF",                     "industry": "ETF"},
    {"ticker": "QQQ",   "name": "Nasdaq 100 ETF",     "sector": "ETF",                     "industry": "ETF"},
    {"ticker": "VTI",   "name": "Total Market ETF",   "sector": "ETF",                     "industry": "ETF"},
    {"ticker": "GLD",   "name": "Gold ETF",           "sector": "ETF",                     "industry": "ETF"},
    {"ticker": "ARKK",  "name": "ARK Innovation ETF", "sector": "ETF",                     "industry": "ETF"},
    {"ticker": "IWM",   "name": "Russell 2000 ETF",   "sector": "ETF",                     "industry": "ETF"},
    {"ticker": "XLK",   "name": "Tech Sector ETF",    "sector": "ETF",                     "industry": "ETF"},
    {"ticker": "XLF",   "name": "Financial ETF",      "sector": "ETF",                     "industry": "ETF"},
    {"ticker": "XLV",   "name": "Healthcare ETF",     "sector": "ETF",                     "industry": "ETF"},
    {"ticker": "XLE",   "name": "Energy ETF",         "sector": "ETF",                     "industry": "ETF"},

    # ── High-growth / Speculative ─────────────────────────────────────────────────
    # Clean Energy / Hydrogen
    {"ticker": "BE",    "name": "Bloom Energy",       "sector": "Industrials",             "industry": "Electrical Equipment & Parts"},
    {"ticker": "PLUG",  "name": "Plug Power",         "sector": "Industrials",             "industry": "Electrical Equipment & Parts"},
    {"ticker": "RUN",   "name": "Sunrun",             "sector": "Industrials",             "industry": "Solar"},
    {"ticker": "NOVA",  "name": "Sunnova Energy",     "sector": "Industrials",             "industry": "Solar"},
    # Quantum / Deep Tech
    {"ticker": "IONQ",  "name": "IonQ",               "sector": "Technology",              "industry": "Computer Hardware"},
    {"ticker": "RGTI",  "name": "Rigetti Computing",  "sector": "Technology",              "industry": "Computer Hardware"},
    # AI / Data Infrastructure
    {"ticker": "SMCI",  "name": "Super Micro Computer","sector": "Technology",             "industry": "Computer Hardware"},
    {"ticker": "AI",    "name": "C3.ai",              "sector": "Technology",              "industry": "Software - Application"},
    {"ticker": "BBAI",  "name": "BigBear.ai",         "sector": "Technology",              "industry": "Software - Application"},
    # Fintech / BNPL
    {"ticker": "AFRM",  "name": "Affirm",             "sector": "Financials",              "industry": "Credit Services"},
    {"ticker": "UPST",  "name": "Upstart",            "sector": "Financials",              "industry": "Credit Services"},
    {"ticker": "SOFI",  "name": "SoFi Technologies",  "sector": "Financials",              "industry": "Credit Services"},
    {"ticker": "HOOD",  "name": "Robinhood",          "sector": "Financials",              "industry": "Capital Markets"},
    # Space / Aviation
    {"ticker": "RKLB",  "name": "Rocket Lab",         "sector": "Industrials",             "industry": "Aerospace & Defense"},
    {"ticker": "JOBY",  "name": "Joby Aviation",      "sector": "Industrials",             "industry": "Aerospace & Defense"},
    {"ticker": "ACHR",  "name": "Archer Aviation",    "sector": "Industrials",             "industry": "Aerospace & Defense"},
    # Biotech – high risk
    {"ticker": "RXRX",  "name": "Recursion Pharma",   "sector": "Healthcare",              "industry": "Biotechnology"},
    {"ticker": "BEAM",  "name": "Beam Therapeutics",  "sector": "Healthcare",              "industry": "Biotechnology"},
    {"ticker": "NTLA",  "name": "Intellia Therapeutics","sector": "Healthcare",            "industry": "Biotechnology"},
    # Growth – mid cap
    {"ticker": "HIMS",  "name": "Hims & Hers Health", "sector": "Healthcare",              "industry": "Health Information Services"},
    {"ticker": "CELH",  "name": "Celsius Holdings",   "sector": "Consumer Staples",        "industry": "Beverages - Non-Alcoholic"},
    {"ticker": "DUOL",  "name": "Duolingo",           "sector": "Technology",              "industry": "Software - Application"},
    {"ticker": "CAVA",  "name": "CAVA Group",         "sector": "Consumer Discretionary",  "industry": "Restaurants"},
    {"ticker": "APP",   "name": "AppLovin",           "sector": "Technology",              "industry": "Software - Application"},
    {"ticker": "RDDT",  "name": "Reddit",             "sector": "Communication Services",  "industry": "Internet Content & Information"},
    # Crypto / Bitcoin proxy
    {"ticker": "MSTR",  "name": "MicroStrategy",      "sector": "Technology",              "industry": "Software - Application"},
    {"ticker": "MARA",  "name": "MARA Holdings",      "sector": "Financials",              "industry": "Capital Markets"},
]

_TTL        = 4 * 3600   # 4 hours — individual ticker cache
_WEEKLY_TTL = 7 * 86400  # 7 days — weekly picks cache (one set per week per user)


def _fetch_one(entry: dict) -> dict:
    ticker = entry["ticker"]
    cached = cache_get(f"screener:{ticker}")
    if cached:
        return cached
    try:
        q       = fh_quote(ticker)
        metrics = fh_metrics(ticker)

        price   = q["price"]     if q else None
        chg_pct = q["change_pct"] if q else None

        # market cap: Finnhub returns in millions — convert to units
        mkt_cap_m = metrics.get("marketCapitalization")
        mkt_cap   = mkt_cap_m * 1_000_000 if mkt_cap_m else None

        pe      = metrics.get("peBasicExclExtraTTM") or metrics.get("peNormalizedAnnual")
        fwd_pe  = metrics.get("peForwardTTM")
        # revenueGrowthTTMYoy is already in % (e.g. 15.3 = 15.3%), convert to ratio for score logic
        rev_gr_pct = metrics.get("revenueGrowthTTMYoy")
        rev_gr     = rev_gr_pct / 100.0 if rev_gr_pct is not None else None
        # netProfitMarginTTM is already in % (e.g. 21.5), convert to ratio for score logic
        margin_pct = metrics.get("netProfitMarginTTM")
        margin     = margin_pct / 100.0 if margin_pct is not None else None
        div_yield  = metrics.get("dividendYieldIndicatedAnnual")

        # Simple composite score 0-100
        score = 50
        if rev_gr   and rev_gr   > 0.20: score += 15
        elif rev_gr and rev_gr   > 0.10: score += 8
        if margin   and margin   > 0.20: score += 15
        elif margin and margin   > 0.10: score += 8
        if fwd_pe:
            if fwd_pe < 20:   score += 15
            elif fwd_pe < 30: score += 8
            elif fwd_pe > 50: score -= 10
        score = max(0, min(100, score))

        data = {
            "ticker":     ticker,
            "name":       entry["name"],
            "sector":     entry["sector"],
            "industry":   entry.get("industry", ""),
            "price":      round(price, 2)    if price     else None,
            "change_pct": chg_pct,
            "market_cap": mkt_cap,
            "pe":         round(pe, 1)       if pe        else None,
            "fwd_pe":     round(fwd_pe, 1)   if fwd_pe    else None,
            "rev_growth": round(rev_gr_pct, 1) if rev_gr_pct is not None else None,
            "margin":     round(margin_pct, 1) if margin_pct is not None else None,
            "div_yield":  round(div_yield, 2)  if div_yield  else None,
            "recom":      "",
            "score":      score,
        }
        cache_set(f"screener:{ticker}", data, ttl=_TTL)
        return data
    except Exception:
        return {**entry, "industry": entry.get("industry", ""), "price": None, "score": 0}


def _fetch_batch(entries: list[dict]) -> list[dict]:
    results = [_fetch_one(e) for e in entries]
    return [r for r in results if r.get("price") is not None]


@router.post("")
async def screen(request: dict, user_id: str = Depends(get_current_user_id)):
    sector  = request.get("sector")   # None = all
    query   = request.get("query", "").strip()

    subset = [s for s in UNIVERSE if not sector or s["sector"] == sector]

    # Fetch up to 20 stocks (cached after first call)
    stocks = await asyncio.to_thread(_fetch_batch, subset[:20])
    stocks.sort(key=lambda x: x.get("score", 0), reverse=True)

    ai_insight = None
    if query and stocks:
        profile = await _get_user_profile_safe(user_id)
        ai_insight = await ai_service.screen_stocks(stocks, query, profile)

    return {"results": stocks[:15], "ai_insight": ai_insight}


@router.get("/undervalued")
async def undervalued(sector: str | None = None, limit: int = 60, lang: str | None = None, user_id: str = Depends(get_current_user_id)):
    """Real, DCF-backed undervalued candidates — cache-only read (see
    undervalued_screener_service), refreshed weekly by a background job.
    Distinct from screen()/weekly_picks() above, which layer an LLM
    narrative over live Finnhub metrics, not the real DCF engine.

    `lang` is passed explicitly by the frontend (its live i18n.language) —
    preferred over reading profile.preferred_language, since the checklist
    item NAMES are translated client-side purely off i18n.language, and a
    stale/unsynced profile field would otherwise generate AI text in a
    different language than what the item names show (a real bug: profile
    sync to the backend can lag or fail silently, and there's no way for
    the user to notice a desync between "what I see" and "what the profile
    says"). Falls back to the profile field only if the frontend didn't
    send one (e.g. an older client build)."""
    from app.api.routes.chat import _is_premium
    profile = await _get_user_profile_safe(user_id)
    if not _is_premium(profile):
        raise HTTPException(status_code=403, detail="El screener de subvaluadas requiere Premium")
    if lang not in ("es", "en"):
        lang = getattr(profile, "preferred_language", None) or "es"
    from app.services.undervalued_screener_service import get_undervalued, bootstrap_fill_if_empty_sync
    try:
        result = get_undervalued(limit=limit, sector=sector, lang=lang)
        if not result["results"]:
            # Cache is completely empty (worker hasn't run its startup/weekly
            # refresh yet) — never return a blank screen. Slower this one time
            # (small subset scan), fast for every request after.
            await asyncio.to_thread(bootstrap_fill_if_empty_sync)
            result = get_undervalued(limit=limit, sector=sector, lang=lang)
    except Exception as exc:
        # This list must never fail visibly — worst case, show an empty
        # (but honest) list rather than a raw 500.
        logger.error("undervalued(): get_undervalued/bootstrap failed: %s", exc, exc_info=True)
        result = {"results": [], "generated_at": 0}
    return result


def _latest_reported_earnings_period(ticker: str) -> str | None:
    """Most recent fiscal period (e.g. '2026-06-30') this ticker has actually
    reported earnings for, per Finnhub /stock/earnings. Used as the
    invalidation signal for the quick-analysis cache: the DCF+AI analysis is
    kept for up to _QUICK_ANALYSIS_CACHE_TTL (3 months), but gets recomputed
    the moment this value changes — i.e. right after the company's next
    earnings report — rather than on a dumb calendar timer. Cached 12h since
    this is just a cheap metadata check, not the analysis itself; returns
    None (never invented) on any failure, in which case the caller falls
    back to serving the existing cache untouched."""
    ck = f"fh:latest_earnings_period:{ticker}"
    cached = cache_get(ck)
    if cached is not None:
        return cached or None
    try:
        import os
        import requests as _req
        key = os.getenv("FINNHUB_API_KEY", "")
        if not key:
            return None
        r = _req.get(
            "https://finnhub.io/api/v1/stock/earnings",
            params={"symbol": ticker, "token": key},
            timeout=8,
        )
        items = r.json() if r.status_code == 200 else None
        if not items or not isinstance(items, list):
            cache_set(ck, "", ttl=3600 * 12)
            return None
        periods = [i.get("period") for i in items if i.get("period")]
        latest = max(periods) if periods else None
        cache_set(ck, latest or "", ttl=3600 * 12)
        return latest
    except Exception:
        return None


def _with_live_price(result: dict, ticker: str) -> dict:
    """Overlays a live (≤60s-old, Finnhub-cached) quote onto an otherwise
    long-cached quick-analysis payload — the DCF/AI narrative can safely sit
    in cache for months, but the price and day-change shown next to it
    should always track the market. Falls back to whatever price the cached
    payload already has if the live quote is unavailable."""
    quote = fh_quote(ticker)
    if not quote or not quote.get("price"):
        return result
    result = dict(result)
    result["price"] = quote["price"]
    result["change_pct"] = quote.get("change_pct", result.get("change_pct"))
    return result


async def _get_user_profile_safe(user_id: str):
    """Wraps market._get_user_profile (a blocking sync DB call made directly
    inside async routes throughout this file) in a thread so it can never
    block the event loop, plus one retry on a transient failure — this is
    the premium-gate check for every screener/quick-analysis endpoint, and a
    single flaky read here must never look identical to "not premium" to a
    real Premium user."""
    for attempt in range(2):
        try:
            return await asyncio.to_thread(_get_user_profile, user_id)
        except Exception as exc:
            if attempt == 1:
                logger.error("_get_user_profile_safe(%s): failed after retry: %s", user_id, exc)
                return None
            await asyncio.sleep(0.3)


def _resolve_quick_ticker(query: str) -> str | None:
    """Resolves free-text (a ticker or a company name) to a real ticker
    symbol for the quick-analysis search below."""
    stripped = query.strip()
    candidate = stripped.upper()
    looks_like_ticker = candidate.replace(".", "").replace("-", "").isalpha() and 1 <= len(candidate) <= 6

    # Only trust the input as a literal ticker when the user typed it in
    # caps already (a deliberate ticker, e.g. "AAPL", "BRK.B") — a plain
    # company name ("Apple", "Tesla", "Nike", "Ford") ALSO passes the same
    # shape check (short, all letters) but isn't a real ticker under that
    # literal spelling. This used to return "APPLE"/"TESLA" as-is and fail
    # every single-word company-name search downstream instead of ever
    # reaching the search below, which would have found AAPL/TSLA.
    if looks_like_ticker and stripped == candidate:
        return candidate

    # Deliberately NOT filtered to "common stock"/"equity" only — Finnhub
    # tags plenty of legitimately searchable, valuable tickers (ADRs, REITs,
    # ETFs, preferred shares) under other `type` strings, and excluding them
    # here was silently telling users "no se pudo identificar esa empresa"
    # for real, valid tickers. Only skip the types that can never resolve to
    # tradeable equity fundamentals (get_fundamental_analysis degrades to a
    # clean 404 downstream for anything else that has no real data).
    _NEVER_RESOLVABLE = {"crypto", "forex", "index"}
    try:
        for r in fh_search(stripped):
            if r.get("symbol") and r.get("type", "").strip().lower() not in _NEVER_RESOLVABLE:
                return r["symbol"]
    except Exception as exc:
        logger.warning("_resolve_quick_ticker(%r): fh_search failed: %s", query, exc)

    # Finnhub found nothing (or is having a bad day) — this search is meant
    # to find ANY US-listed ticker/company, so fall back to an independent
    # second source (Yahoo Finance's symbol search, the same one
    # /market/search already relies on) rather than giving up after a single
    # provider's hiccup.
    try:
        import requests as _requests
        resp = _requests.get(
            "https://query2.finance.yahoo.com/v1/finance/search",
            params={"q": stripped, "lang": "en-US", "region": "US", "quotesCount": 5, "newsCount": 0, "listsCount": 0},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=6,
        )
        quotes = (resp.json() or {}).get("quotes", [])
        for item in quotes:
            if item.get("symbol") and item.get("quoteType") in ("EQUITY", "ETF"):
                return item["symbol"]
    except Exception as exc:
        logger.warning("_resolve_quick_ticker(%r): Yahoo fallback failed: %s", query, exc)

    # Last resort: both search providers came up empty (or errored) — if the
    # input still has the shape of a real ticker (e.g. lowercase "tsla"),
    # trust it rather than refusing outright. get_fundamental_analysis
    # degrades to a clean 404 downstream if it turns out not to be real.
    if looks_like_ticker:
        return candidate

    return None


def _asdict_or_none(obj) -> Optional[dict]:
    """Converts a dataclass instance (e.g. `IndustryBenchmarks`) to a plain
    JSON-serializable dict, or passes None through — small local helper so
    the quality-engine dataclasses don't need every caller to import
    `dataclasses.asdict` separately."""
    if obj is None:
        return None
    from dataclasses import asdict
    return asdict(obj)


async def _compute_extra_valuations(ticker: str, data: dict, dcf: dict):
    """Methods 3/4/5 of the valuation engine (Relative, Historical, Consensus)
    for quick_analysis's single-ticker live search. Split out from
    quick_analysis so the whole block can be bounded by one asyncio.wait_for
    — a stalled peer/history fetch must never hang the request past a few
    seconds; the quick-analysis card just degrades to the base DCF result."""
    from app.services.consensus_valuation_service import classify_archetype, compute_consensus_fair_value
    from app.services.fundamental_analysis_service import _is_financial_sector, _sector_cyclicality_dampener, get_financials
    from app.services.historical_valuation_service import compute_historical_valuation
    from app.services.relative_valuation_service import compute_relative_valuation

    relative_valuation = None
    historical_valuation = None

    price = data.get("current_price")
    shares_out = dcf.get("shares_outstanding")
    total_debt = data.get("total_debt") or 0
    cash = data.get("cash") or 0
    sector = data.get("sector")
    industry = next((u["industry"] for u in UNIVERSE if u["ticker"] == ticker), None)
    thesis_scores = data.get("thesis_scores") or {}

    fin = await asyncio.to_thread(get_financials, ticker, 10)
    income = fin.get("incomeStatement", {}).get("annual", [])
    balance = fin.get("balanceSheet", {}).get("annual", [])
    cashflow = fin.get("cashFlow", {}).get("annual", [])
    n = min(len(income), len(balance), len(cashflow))
    income, balance, cashflow = income[-n:], balance[-n:], cashflow[-n:]
    latest_income = income[-1] if income else {}
    latest_eps = latest_income.get("Diluted EPS") or latest_income.get("Basic EPS")
    latest_ebitda = latest_income.get("EBITDA")
    fcf_trend_vals = [v for v in (data.get("fcf_trend") or []) if v is not None]
    latest_fcf = fcf_trend_vals[-1] if fcf_trend_vals else None

    if price and shares_out:
        relative_valuation = await asyncio.to_thread(
            compute_relative_valuation, ticker, price, shares_out, latest_eps, latest_ebitda, latest_fcf,
            total_debt, cash, sector, industry,
        )
        if n >= 5:
            historical_valuation = await asyncio.to_thread(
                compute_historical_valuation, ticker, income, balance, cashflow, price, shares_out, total_debt, cash,
                latest_eps, latest_ebitda, latest_fcf,
            )

    archetype = classify_archetype(
        _is_financial_sector(sector), thesis_scores.get("business_quality"),
        thesis_scores.get("predictability"), _sector_cyclicality_dampener(sector),
    )
    scenarios = dcf.get("scenarios") or {}
    conservative_dcf_value = (scenarios.get("pessimistic") or {}).get("intrinsic_value_per_share")
    professional_dcf_value = (scenarios.get("base") or {}).get("intrinsic_value_per_share")
    consensus_valuation = compute_consensus_fair_value(archetype, conservative_dcf_value, professional_dcf_value, relative_valuation, historical_valuation)

    # Fase 2, Incremento 1 (Quality Engine — Industry Engine, see
    # /Users/diegoarria/.claude/plans/stateful-painting-flurry.md): real,
    # live peer-derived benchmarks — same peer group this function already
    # resolved above, no separate fetch. `peer_analysis_cache` is returned
    # so the Peer Comparison Engine (Incremento 10, called later in
    # _build_quick_analysis once the company's own Quality Score exists)
    # can reuse the SAME warmed peer analyses instead of re-fetching them —
    # both engines resolve the identical real peer group via
    # `relative_valuation_service._find_peers`.
    from app.services.quality.industry_engine import compute_industry_benchmarks
    peer_analysis_cache: dict = {}
    industry_benchmarks = compute_industry_benchmarks(ticker, sector, industry, analysis_cache=peer_analysis_cache)

    return relative_valuation, historical_valuation, consensus_valuation, industry_benchmarks, peer_analysis_cache


_QUICK_ANALYSIS_CACHE_TTL = 90 * 24 * 3600  # 3 months — a ceiling, not the real invalidation trigger.
# The DCF+AI analysis is only actually stale once the company reports new
# earnings (see _latest_reported_earnings_period), which is checked on every
# cache hit; this TTL just guarantees a hard refresh even for a ticker that
# somehow never reports again. The live price is never subject to this at
# all — see _with_live_price.


def _quick_analysis_cache_key(ticker: str, lang: str) -> str:
    # v2 — bumped so a stale English-requested cache entry generated before
    # the "summary"/"blurb" schema's hardcoded "español" instruction was
    # fixed (it silently overrode the top-level language directive) doesn't
    # keep serving Spanish text under an English UI for its remaining TTL.
    return f"quick_analysis:v2:{lang}:{ticker}"


async def _build_quick_analysis(ticker: str, lang: str) -> dict:
    """Computes the full quick-analysis payload for one ticker+lang — the
    real DCF engine plus a short AI narrative. Pure compute: doesn't touch
    cache or the per-user thesis-event log, so it can be called both by the
    /quick-analysis route (cache miss path) and by worker.py's cache-warming
    job for the screen's default ticker, without depending on a request or
    user_id."""
    import time

    from app.services.fundamental_analysis_service import get_fundamental_analysis
    try:
        # Bounded so a stalled FMP/Finnhub call can never hang this endpoint
        # indefinitely — the frontend gets a fast, clear failure to retry
        # instead of an infinite spinner on a screen that must always open.
        # _compute_peer_dependent_data=False: this function computes its OWN, better
        # (industry-aware, not just sector-aware) Consensus a few lines
        # below via _compute_extra_valuations — paying for get_fundamental_
        # analysis's internal sector-only Consensus too would just be
        # duplicate peer-fetching for a result this overwrites anyway (see
        # combine_fair_value_range call below).
        data = await asyncio.wait_for(
            asyncio.to_thread(get_fundamental_analysis, ticker, _compute_peer_dependent_data=False), timeout=20.0,
        )
    except Exception as exc:
        # A real data-provider hiccup (FMP/Finnhub timeout, rate limit,
        # malformed response) must never surface as a raw 500 — this
        # search box is meant to never fail visibly to the user.
        logger.error("quick_analysis(%s): get_fundamental_analysis failed: %s", ticker, exc, exc_info=True)
        raise HTTPException(status_code=503, detail=f"No pudimos obtener los datos financieros de {ticker} en este momento. Intenta de nuevo en unos segundos.")
    if not data or not data.get("dcf"):
        raise HTTPException(status_code=404, detail=f"No hay suficientes datos financieros reales para calcular el valor intrínseco de {ticker}")

    # The AI narrative is a nice-to-have layer on top of the real DCF
    # numbers already in `data` — a Claude timeout/error must degrade to a
    # plain-numbers card, never take down the whole request.
    try:
        ai_result = await asyncio.wait_for(ai_service.generate_quick_valuation_summary(data, lang=lang), timeout=20.0)
    except Exception as exc:
        logger.error("quick_analysis(%s): generate_quick_valuation_summary failed: %s", ticker, exc, exc_info=True)
        ai_result = {
            "summary": (
                "We couldn't generate the AI summary right now. The real numbers above are still accurate."
                if lang == "en" else
                "No pudimos generar el resumen con IA en este momento. Las cifras reales de arriba siguen siendo correctas."
            ),
            "business_understanding_stars": None, "business_understanding_reason": "", "checklist_reasons": {},
        }
    dcf = data["dcf"]

    # Methods 3/4/5 of the valuation engine (Relative, Historical, Consensus)
    # — computed live here for this ONE ticker (unlike the weekly screener's
    # whole-universe batch, a single-ticker peer/history fetch is cheap
    # enough for a live search) and cached alongside the rest of this
    # response for 24h, so a repeat search of the same ticker never re-pays
    # this cost. A failure here must never break the base DCF result — the
    # quick-analysis card degrades to showing only the base Fair Value Range.
    relative_valuation = None
    historical_valuation = None
    consensus_valuation = None
    industry_benchmarks = None
    peer_analysis_cache: dict = {}
    try:
        relative_valuation, historical_valuation, consensus_valuation, industry_benchmarks, peer_analysis_cache = await asyncio.wait_for(
            _compute_extra_valuations(ticker, data, dcf), timeout=15.0,
        )
        # Fase 1.5, Incremento 10 — refresh the range with this call's
        # industry-aware Consensus (better than the sector-only one
        # get_fundamental_analysis would have computed itself, which is why
        # _compute_peer_dependent_data=False was passed above). Same helper used
        # inside get_fundamental_analysis, never a re-derived formula.
        from app.services.fundamental_analysis_service import combine_fair_value_range
        dcf["consensus_valuation"] = consensus_valuation
        dcf["fair_value_range"] = combine_fair_value_range(dcf.get("monte_carlo"), consensus_valuation, dcf["fair_value_range"])
    except Exception as exc:
        logger.warning("quick_analysis(%s): valuation engine (methods 3-5) failed: %s", ticker, exc)

    # 7-point investment checklist — item 1 (Entender el negocio) is Claude's
    # qualitative judgment from ai_result above; items 2-7's "stars" ratings
    # are real, computed by fundamental_analysis_service, and their "reason"
    # text is Claude's nuanced explanation grounded in real multi-factor
    # evidence (see undervalued_screener_service._finalize_checklist, reused
    # here so both entry points merge identically).
    from app.services.undervalued_screener_service import _finalize_checklist
    try:
        _finalize_checklist(data, {
            "key": "business_understanding",
            "name": "Entender el negocio" if lang != "en" else "Understanding the business",
            "stars": ai_result.get("business_understanding_stars"),
            "reason": ai_result.get("business_understanding_reason", ""),
        }, ai_result.get("checklist_reasons"))
        checklist = data.get("checklist")
    except Exception as exc:
        logger.error("quick_analysis(%s): _finalize_checklist failed: %s", ticker, exc, exc_info=True)
        checklist = None

    # DCF calculator inputs (frontend "Calculadora de Valor Intrínseco") —
    # re-derived independently from `data`/`dcf` rather than reusing locals
    # from _compute_extra_valuations, since that call may have timed out or
    # raised before producing anything.
    _fcf_trend_vals = [v for v in (data.get("fcf_trend") or []) if v is not None]
    current_fcf = _fcf_trend_vals[-1] if _fcf_trend_vals else None
    net_cash = (data.get("cash") or 0) - (data.get("total_debt") or 0)
    shares_outstanding = dcf.get("shares_outstanding")
    from app.services.undervalued_screener_service import build_dcf_guidance
    dcf_assumptions = build_dcf_guidance(dcf, data.get("thesis_scores"))

    # Confidence Meter v3 (Fase 1, Incremento 5 — Parte F; extended Fase 1.5,
    # Incremento 18): upgrades the "method agreement" component from the
    # scenario-range proxy to the REAL spread across DCF/Relative/Historical,
    # now that Methods 3/4 are available at this point in the request (they
    # aren't yet inside get_fundamental_analysis() itself — see
    # confidence_engine.py's docstring). financial_statement_quality_score/
    # management_consistency_score were already computed once inside
    # get_fundamental_analysis() (network-free) and are just read back from
    # `dcf` here, never re-derived. Degrades gracefully when fewer real
    # signals are available, so this never worsens the number for any
    # ticker — only improves it when there's real independent evidence.
    from app.services.valuation.confidence_engine import compute_confidence_meter_v3
    thesis_scores = data.get("thesis_scores") or {}
    confidence_meter_v3 = compute_confidence_meter_v3(
        predictability_score=dcf.get("confidence_score"),
        years_available=data.get("data_years_available", 0),
        fair_value_range=dcf.get("fair_value_range") or {},
        liquidity_ok=(data.get("liquidity_gate") or {}).get("paso", True),
        business_quality_score=thesis_scores.get("business_quality"),
        financial_strength_score=thesis_scores.get("financial_strength"),
        method_values=[
            dcf["scenarios"]["base"]["intrinsic_value_per_share"],
            relative_valuation.get("intrinsic_value_per_share") if relative_valuation else None,
            historical_valuation.get("intrinsic_value_per_share") if historical_valuation else None,
        ],
        financial_statement_quality_score=dcf.get("financial_statement_quality_score"),
        management_consistency_score=dcf.get("management_consistency_score"),
    )

    # Fair Value Engine (Fase 1, Incremento 6 — Parte G): completely
    # independent second valuation method — "is the price reasonable given
    # this business's growth/quality" rather than the DCF's "what are the
    # cash flows worth." Every input here is already real/computed
    # elsewhere (never a new fabricated metric) — see
    # valuation/fair_value_engine.py for the full formula documentation.
    # Skipped for companies without a real DCF (financial sector uses ROE/
    # book value, not EPS multiples the same way; REITs are excluded from
    # standard multiples too) — matches the same sector gating already
    # applied to the driver-based DCF and Monte Carlo above.
    from app.services.valuation.fair_value_engine import compute_justified_multiple, compute_fair_value
    fair_value_engine_result = None
    growth_buildup = dcf.get("growth_buildup") or {}
    if dcf.get("methodology") != "residual_income_justified_pb":
        total_debt = dcf.get("total_debt")
        cash = dcf.get("cash")
        ebitda = data.get("ebitda")
        net_debt_to_ebitda = (
            (total_debt - cash) / ebitda
            if total_debt is not None and cash is not None and ebitda and ebitda > 0 else None
        )
        justified = compute_justified_multiple(
            sector=data.get("sector"),
            expected_eps_growth_pct=growth_buildup.get("quality_adjusted_growth_pct"),
            roic_pct=growth_buildup.get("avg_roic_pct"),
            cost_of_capital_pct=dcf.get("base_discount_rate_pct"),
            fcf_margin_pct=dcf.get("avg_fcf_margin_pct"),
            net_debt_to_ebitda=net_debt_to_ebitda,
            interest_coverage=data.get("interest_coverage"),
            dividend_yield_pct=data.get("dividend_yield_pct"),
            moat_score=thesis_scores.get("business_quality"),
            management_score=thesis_scores.get("management_capital_allocation"),
        )
        fair_value = compute_fair_value(data.get("latest_eps"), justified.justified_multiple)
        fair_value_engine_result = {
            "sector": justified.sector,
            "base_multiple": justified.base_multiple,
            "justified_multiple": justified.justified_multiple,
            "adjustments": [
                {"factor": a.factor, "points": a.points, "reason": a.reason} for a in justified.adjustments
            ],
            "eps": data.get("latest_eps"),
            "fair_value": fair_value,
            "margin_of_safety_pct": (
                round((fair_value - data["current_price"]) / fair_value * 100, 1)
                if fair_value and data.get("current_price") else None
            ),
        }

    # Fase 2, Incremento 2 (Quality Engine — "¿qué tan buena es esta
    # empresa?", completely independent of the DCF/price above — see
    # /Users/diegoarria/.claude/plans/stateful-painting-flurry.md).
    # Extraction logic lives once in quality_engine.py (also used by
    # nif_service.py's business_quality pillar, Incremento 3) — never
    # duplicated across callers.
    from app.services.quality.quality_engine import build_quality_score_from_analysis
    quality_result = build_quality_score_from_analysis(data)
    quality_engine_result = {
        "quality_score": quality_result.quality_score,
        "profitability_score": quality_result.profitability_score,
        "margins_score": quality_result.margins_score,
        "cash_flow_score": quality_result.cash_flow_score,
        "growth_score": quality_result.growth_score,
        "balance_sheet_score": quality_result.balance_sheet_score,
        "factors": [
            {"name": f.name, "value": f.value, "score": f.score, "reason": f.reason} for f in quality_result.factors
        ],
    }

    # Fase 2, Incremento 10 (Peer Comparison Engine — Parte J). Reuses the
    # exact real peer group `industry_benchmarks` above already resolved
    # (`peer_analysis_cache`, warmed by `_compute_extra_valuations`) — no
    # second peer-finding pass, no re-fetched peer analyses.
    from app.services.quality.peer_comparison_engine import compute_quality_peer_comparison
    industry_for_peers = next((u["industry"] for u in UNIVERSE if u["ticker"] == ticker), None)
    peer_comparison_result_obj = compute_quality_peer_comparison(
        ticker, data.get("sector"), industry_for_peers,
        company_quality_score=(quality_result.quality_score if quality_result.has_any_signal else None),
        analysis_cache=peer_analysis_cache,
    )
    peer_comparison_result = (
        {
            "peer_count": peer_comparison_result_obj.peer_count,
            "peers_used": peer_comparison_result_obj.peers_used,
            "company_quality_score": peer_comparison_result_obj.company_quality_score,
            "quality_score_percentile": peer_comparison_result_obj.quality_score_percentile,
            "quality_score_rank": peer_comparison_result_obj.quality_score_rank,
            "peer_quality_scores": [
                {
                    "ticker": s.ticker, "quality_score": s.quality_score, "roic_pct": s.roic_pct,
                    "operating_margin_pct": s.operating_margin_pct, "revenue_cagr_pct": s.revenue_cagr_pct,
                }
                for s in peer_comparison_result_obj.peer_quality_scores
            ],
        }
        if peer_comparison_result_obj is not None else None
    )

    # Fase 2, Incremento 10 (Deterioration Engine — Parte K). Mechanical
    # first-half-vs-second-half trend DIRECTION on the same real multi-year
    # arrays every other Fase 2 engine already reuses — complements (never
    # duplicates) the Moat Engine's non-directional CV-based stability.
    from app.services.quality.deterioration_engine import compute_deterioration_signals
    fcf_trend_for_deterioration = data.get("fcf_trend") or []
    revenue_trend_for_deterioration = data.get("revenue_trend") or []
    fcf_margin_trend_for_deterioration = [
        (f / r) * 100 if f is not None and r else None
        for f, r in zip(fcf_trend_for_deterioration, revenue_trend_for_deterioration)
    ]
    deterioration_result_obj = compute_deterioration_signals(
        roic_trend=data.get("roic_trend") or [],
        operating_margin_trend=data.get("operating_margin_trend") or [],
        net_margin_trend=data.get("net_margin_trend") or [],
        fcf_margin_trend=fcf_margin_trend_for_deterioration,
        revenue_trend=revenue_trend_for_deterioration,
    )
    deterioration_result = {
        "deteriorating_count": deterioration_result_obj.deteriorating_count,
        "improving_count": deterioration_result_obj.improving_count,
        "stable_count": deterioration_result_obj.stable_count,
        "highest_concern": deterioration_result_obj.highest_concern,
        "factors": [
            {"name": f.name, "direction": f.direction, "change_pct": f.change_pct, "reason": f.reason}
            for f in deterioration_result_obj.factors
        ],
    }

    # Fase 2, Incremento 7 (Moat Engine — deterministic score only, Parte B).
    # Reuses avg_roic_pct/growth_buildup already computed for the DCF and
    # the industry_benchmarks computed above (same peer group, no second
    # fetch). The AI-narrated 11-moat-type qualitative deep dive is
    # deliberately NOT called here (real network + AI cost per request) —
    # it's wired into nif_service.build_nif_dashboard instead, alongside
    # that flow's existing parallel AI narration calls.
    from app.services.quality.moat_engine import compute_moat_score
    growth_buildup = dcf.get("growth_buildup") or {}
    op_margin_trend_for_moat = data.get("operating_margin_trend") or []
    op_margin_valid = [v for v in op_margin_trend_for_moat if v is not None]
    avg_operating_margin_pct = round(sum(op_margin_valid) / len(op_margin_valid), 1) if op_margin_valid else None
    gross_margin_trend_for_moat = data.get("gross_margin_trend") or []
    gross_margin_latest_pct = next((v for v in reversed(gross_margin_trend_for_moat) if v is not None), None)
    moat_result_obj = compute_moat_score(
        avg_roic_pct=growth_buildup.get("avg_roic_pct"), roic_trend=data.get("roic_trend") or [],
        avg_operating_margin_pct=avg_operating_margin_pct, operating_margin_trend=op_margin_trend_for_moat,
        gross_margin_latest_pct=gross_margin_latest_pct,
        industry_median_roic_pct=(industry_benchmarks.median_roic_pct if industry_benchmarks else None),
        industry_median_operating_margin_pct=(industry_benchmarks.median_operating_margin_pct if industry_benchmarks else None),
    )
    moat_engine_result = {
        "moat_score": moat_result_obj.moat_score,
        "roic_premium_score": moat_result_obj.roic_premium_score,
        "margin_premium_score": moat_result_obj.margin_premium_score,
        "stability_score": moat_result_obj.stability_score,
        "factors": [
            {"name": f.name, "value": f.value, "score": f.score, "reason": f.reason} for f in moat_result_obj.factors
        ],
    }

    # Fase 2, Incremento 9 (Conviction Engine — Parte H). Pure synthesis of
    # three already-computed real scores above (quality_score, moat_score,
    # moat's own stability_score) plus the real CAPM beta the DCF engine
    # already computed for WACC (dcf["wacc_details"]["beta"]) — zero new
    # fetches, zero AI.
    from app.services.quality.conviction_engine import compute_conviction_score
    conviction_result_obj = compute_conviction_score(
        quality_score=quality_result.quality_score if quality_result.has_any_signal else None,
        moat_score=moat_result_obj.moat_score if moat_result_obj.has_any_signal else None,
        stability_score=moat_result_obj.stability_score,
        beta=(dcf.get("wacc_details") or {}).get("beta"),
    )
    conviction_engine_result = {
        "conviction_score": conviction_result_obj.conviction_score,
        "quality_score": conviction_result_obj.quality_score,
        "moat_score": conviction_result_obj.moat_score,
        "stability_score": conviction_result_obj.stability_score,
        "beta_score": conviction_result_obj.beta_score,
        "factors": [
            {"name": f.name, "value": f.value, "score": f.score, "reason": f.reason} for f in conviction_result_obj.factors
        ],
    }

    # Fase 2, Incremento 4 (Capital Allocation Engine — "¿cómo administra
    # el capital esta empresa?", Parte C). Reuses buyback_rate_pct/
    # payout_ratio_pct already computed for management_capital_allocation
    # evidence, and the reinvestment_rate_trend the DCF engine already
    # builds — the only NEW work here is checking real historical buyback
    # timing against real prices.
    from app.services.quality.capital_allocation_engine import compute_capital_allocation_score
    mgmt_evidence = (data.get("checklist_evidence") or {}).get("management_capital_allocation") or {}
    payout_ratio_pct = mgmt_evidence.get("payout_ratio_pct")
    capital_allocation_result_obj = compute_capital_allocation_score(
        ticker=ticker, current_price=data.get("current_price"),
        implied_shares_trend=data.get("implied_shares_trend") or [],
        fiscal_period_dates=data.get("fiscal_period_dates") or [],
        dividends_paid_trend=data.get("dividends_paid_trend") or [],
        reinvestment_rate_trend=data.get("reinvestment_rate_trend") or [],
        buyback_rate_pct=mgmt_evidence.get("buyback_rate_pct"),
        payout_ratio=(payout_ratio_pct / 100) if payout_ratio_pct is not None else None,
    )
    capital_allocation_result = {
        "capital_allocation_score": capital_allocation_result_obj.capital_allocation_score,
        "buyback_timing_score": capital_allocation_result_obj.buyback_timing_score,
        "dividend_consistency_score": capital_allocation_result_obj.dividend_consistency_score,
        "reinvestment_quality_score": capital_allocation_result_obj.reinvestment_quality_score,
        "buyback_years": [
            {
                "fiscal_period": b.fiscal_period, "shares_reduced_pct": b.shares_reduced_pct,
                "price_at_buyback": b.price_at_buyback, "current_price": b.current_price,
                "looks_good_in_hindsight": b.looks_good_in_hindsight,
            }
            for b in capital_allocation_result_obj.buyback_years
        ],
        "factors": [
            {"name": f.name, "value": f.value, "score": f.score, "reason": f.reason}
            for f in capital_allocation_result_obj.factors
        ],
        "acquisitions_note": capital_allocation_result_obj.acquisitions_note,
    }

    # Fase 2, Incremento 5 (Earnings Quality Engine — Parte E). Reuses
    # data_validation (Fase 1's accounting cross-check) and the margin/FCF/
    # net-income trends already computed; sbc_latest is the one new field
    # (added to fundamental_analysis_service.py's return dict this
    # increment — the raw statement field was already fetched, just never
    # read downstream).
    from app.services.quality.earnings_quality_engine import compute_earnings_quality
    fcf_trend_for_eq = data.get("fcf_trend") or []
    revenue_trend_for_eq = data.get("revenue_trend") or []
    earnings_quality_result_obj = compute_earnings_quality(
        sbc_latest=data.get("sbc_latest"),
        revenue_latest=(revenue_trend_for_eq[-1] if revenue_trend_for_eq else None),
        fcf_latest=(fcf_trend_for_eq[-1] if fcf_trend_for_eq else None),
        data_validation=data.get("data_validation"),
        gross_margin_trend=data.get("gross_margin_trend") or [], operating_margin_trend=data.get("operating_margin_trend") or [],
        net_margin_trend=data.get("net_margin_trend") or [],
        fcf_trend=fcf_trend_for_eq, net_income_trend=data.get("net_income_trend") or [],
        years=data.get("years") or [],
        revenue_cagr_pct=data.get("revenue_cagr_pct"), fcf_cagr_pct=data.get("fcf_cagr_pct"),
    )
    earnings_quality_result = {
        "alert_count": earnings_quality_result_obj.alert_count,
        "highest_severity": earnings_quality_result_obj.highest_severity,
        "sbc_to_revenue_pct": earnings_quality_result_obj.sbc_to_revenue_pct,
        "sbc_to_fcf_pct": earnings_quality_result_obj.sbc_to_fcf_pct,
        "alerts": [
            {"key": a.key, "severity": a.severity, "description": a.description, "evidence": a.evidence}
            for a in earnings_quality_result_obj.alerts
        ],
        "acquisitions_note": earnings_quality_result_obj.acquisitions_note,
    }

    result = {
        "ticker": data["ticker"],
        "company_name": data.get("company_name"),
        "sector": data.get("sector"),
        "price": data.get("current_price"),
        "change_pct": data.get("change_pct"),
        "exchange": data.get("exchange"),
        "current_fcf": current_fcf,
        "net_cash": net_cash,
        "shares_outstanding": shares_outstanding,
        "dcf_assumptions": dcf_assumptions,
        "intrinsic_value_base": dcf["scenarios"]["base"]["intrinsic_value_per_share"],
        "expected_value_per_share": dcf.get("expected_value_per_share"),
        "margin_of_safety_pct": dcf.get("margin_of_safety_pct"),
        "implied_growth_pct": dcf.get("implied_growth_pct"),
        "yearly_detail": dcf.get("yearly_detail"),
        "pv_of_fcf_sum": dcf.get("pv_of_fcf_sum"),
        "pv_of_terminal_value": dcf.get("pv_of_terminal_value"),
        "enterprise_value": dcf.get("enterprise_value"),
        "total_debt": dcf.get("total_debt"),
        "cash": dcf.get("cash"),
        "thesis_scores": data.get("thesis_scores"),
        "composite_score": data.get("composite_score"),
        "fair_value_range": dcf.get("fair_value_range"),
        "confidence_meter": confidence_meter_v3 or dcf.get("confidence_meter"),
        "market_expectations": dcf.get("market_expectations"),
        # Fase 1, Incremento 4 (see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md):
        # these were already computed by fundamental_analysis_service but
        # never reached the frontend — scenarios+probability_weights let the
        # UI let the user configure their own probability weighting instead
        # of only showing the confidence-derived expected value;
        # sensitivity_matrix lets the frontend stop reimplementing its own
        # client-side heatmap (dcfCalculator.ts) and show the REAL backend
        # matrix instead; reverse_dcf_sanity_check/expectations_investing
        # expose the reverse-DCF the backend already solves for (Parte E)
        # but the frontend has never shown; driver_based_valuation/
        # monte_carlo/sector_model_note are the Incremento 2/3 additions.
        "scenarios": dcf.get("scenarios"),
        "probability_weights": dcf.get("probability_weights"),
        "sensitivity_matrix": dcf.get("sensitivity_matrix"),
        "reverse_dcf_sanity_check": dcf.get("reverse_dcf_sanity_check"),
        "expectations_investing": dcf.get("expectations_investing"),
        "driver_based_valuation": dcf.get("driver_based_valuation"),
        # Fase 1.5, Incrementos 4/5/8 (see /Users/diegoarria/.claude/plans/
        # stateful-painting-flurry.md) — same shadow-mode discipline as
        # driver_based_valuation above: computed on every request, not yet
        # the production number. Exposed here so the frontend's Profesional-
        # tier preview panel (Incremento 9) can show them; NOT wired into
        # the primary valuation display until the production flip
        # (Incremento 7, blocked on the validation harness).
        "driver_based_scenarios": dcf.get("driver_based_scenarios"),
        "driver_based_sensitivity_matrix": dcf.get("driver_based_sensitivity_matrix"),
        "driver_based_value_drivers": dcf.get("driver_based_value_drivers"),
        "growth_engine": dcf.get("growth_engine"),
        "monte_carlo": dcf.get("monte_carlo"),
        "sector_model_note": data.get("sector_model_note"),
        "fair_value_engine": fair_value_engine_result,
        "industry_benchmarks": _asdict_or_none(industry_benchmarks),
        "quality_engine": quality_engine_result,
        "moat_engine": moat_engine_result,
        "conviction_engine": conviction_engine_result,
        "peer_comparison_engine": peer_comparison_result,
        "deterioration_engine": deterioration_result,
        "capital_allocation_engine": capital_allocation_result,
        "earnings_quality_engine": earnings_quality_result,
        "relative_valuation": relative_valuation,
        "historical_valuation": historical_valuation,
        "consensus_valuation": consensus_valuation,
        "summary": ai_result.get("summary", ""),
        "checklist": checklist,
        "liquidity_gate": data.get("liquidity_gate"),
        "generated_at": int(time.time()),
        # Internal bookkeeping field — not part of the documented response
        # shape, only read by quick_analysis() to decide whether this cache
        # entry is still valid (see _latest_reported_earnings_period).
        "_earnings_period": await asyncio.to_thread(_latest_reported_earnings_period, ticker),
    }
    return result


_FREE_VI_SEARCH_LIMIT = 1
_VI_SEARCH_WINDOW_HOURS = 24 * 7  # 1 week


async def _check_and_increment_vi_search_limit(user_id: str, profile) -> None:
    """Free users get 1 Valor Intrínseco search per rolling 7-day window;
    Premium is unlimited — the caller checks _is_premium and skips this
    entirely for a Premium user. Same counter+window pattern as chat.py's
    msg_count/msg_window_start free-message limit."""
    db = get_supabase()
    now = datetime.now(timezone.utc)
    window_start = None
    if profile.vi_search_window_start:
        try:
            window_start = datetime.fromisoformat(profile.vi_search_window_start.replace("Z", "+00:00"))
        except Exception:
            pass

    if window_start is None or (now - window_start) >= timedelta(hours=_VI_SEARCH_WINDOW_HOURS):
        await run_query(
            db.table("user_profiles").update({
                "vi_search_count": 1,
                "vi_search_window_start": now.isoformat(),
            }).eq("user_id", user_id)
        )
        return

    if profile.vi_search_count >= _FREE_VI_SEARCH_LIMIT:
        reset_at = window_start + timedelta(hours=_VI_SEARCH_WINDOW_HOURS)
        days_left = max(1, int((reset_at - now).total_seconds() / 86400))
        raise HTTPException(
            status_code=429,
            detail={
                "code": "vi_search_limit",
                "message": f"Ya usaste tu búsqueda gratis de esta semana. Actívate Premium para búsquedas ilimitadas, o vuelve en {days_left} día(s).",
                "reset_in_days": days_left,
            },
        )

    await run_query(
        db.table("user_profiles").update({"vi_search_count": profile.vi_search_count + 1}).eq("user_id", user_id)
    )


@router.get("/quick-analysis")
async def quick_analysis(query: str, lang: str | None = None, user_id: str = Depends(get_current_user_id)):
    """Ad-hoc single-ticker valuation search — the real DCF engine (same one
    behind Arthur and the undervalued screener) plus a SHORT narrative
    summary (see ai_service.generate_quick_valuation_summary), for any
    ticker/company name, not just the curated screener universe.

    The DCF+AI analysis is cached for up to 3 months per (ticker, lang) —
    this used to be fully live on every request (both the Claude call AND
    the FMP/Finnhub fetches behind get_fundamental_analysis re-ran every
    search), which meant a popular ticker got re-billed on every single
    search with no cost tracking at all. Fundamentals only meaningfully
    change once the company reports new earnings, so on every cache hit we
    cheaply check _latest_reported_earnings_period and recompute the whole
    analysis (numbers + AI text together, never just one or the other) the
    moment it changes — the 3-month TTL is just a safety-net ceiling, not
    the real trigger. The price/change_pct shown, however, is NEVER served
    stale: _with_live_price overlays a live (≤60s-old) quote on top of the
    cached analysis on every request, cache hit or not.

    `lang` is passed explicitly by the frontend (see /undervalued's
    docstring for why this is preferred over profile.preferred_language)."""
    from app.api.routes.chat import _is_premium
    profile = await _get_user_profile_safe(user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found. Complete onboarding first.")
    # Free users get 1 search per week as a taste of the real feature —
    # Premium is unlimited. Checked here (not a flat block) so the search
    # box itself is never fully behind a paywall.
    if not _is_premium(profile):
        await _check_and_increment_vi_search_limit(user_id, profile)

    if not query or not query.strip():
        raise HTTPException(status_code=400, detail="Escribe un ticker o nombre de empresa")

    if lang not in ("es", "en"):
        lang = getattr(profile, "preferred_language", None) or "es"

    ticker = await asyncio.to_thread(_resolve_quick_ticker, query)
    if not ticker:
        raise HTTPException(status_code=404, detail="No se pudo identificar esa empresa/ticker")

    cache_key = _quick_analysis_cache_key(ticker, lang)
    cached = cache_get(cache_key)
    if cached:
        current_period = await asyncio.to_thread(_latest_reported_earnings_period, ticker)
        cached_period = cached.get("_earnings_period")
        # Only recompute when we positively KNOW a new period was reported —
        # if the live check fails (rate-limited, Finnhub hiccup) we fall back
        # to the cache rather than pay for a full recompute on a false alarm.
        if not current_period or current_period == cached_period:
            _log_thesis_event(user_id, ticker, cached)
            return _with_live_price(cached, ticker)

    result = await _build_quick_analysis(ticker, lang)
    # Only successful, complete results are cached — never a 404/503, so a
    # transient provider hiccup doesn't get "stuck" wrong for 3 months.
    cache_set(cache_key, result, _QUICK_ANALYSIS_CACHE_TTL)
    _log_thesis_event(user_id, ticker, result)
    return _with_live_price(result, ticker)


_NIF_DASHBOARD_CACHE_TTL = _QUICK_ANALYSIS_CACHE_TTL  # same ceiling philosophy as quick-analysis


def _nif_dashboard_cache_key(ticker: str, lang: str) -> str:
    return f"nif_dashboard:v1:{lang}:{ticker}"


@router.get("/nif-dashboard")
async def nif_dashboard(query: str, lang: str | None = None, user_id: str = Depends(get_current_user_id)):
    """Nuvos Investment Framework (NIF) — the 4-pillar (Business Quality,
    Financial Strength, Management Quality, Valuation) AI-driven dashboard
    for a single ticker. Separate endpoint from /quick-analysis on purpose:
    different cache lifetime/failure domain, and /quick-analysis's response
    shape is load-bearing for the manual Intrinsic Value Calculator, which
    must never change. The frontend calls both in parallel for the same
    search — a NIF failure must never affect the calculator, and vice versa.

    Premium-only in this first phase (unlike /quick-analysis, which gives
    free users one search/week) — this avoids the free-tier weekly search
    counter being decremented twice for what the user experiences as one
    search action."""
    from app.api.routes.chat import _is_premium
    profile = await _get_user_profile_safe(user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found. Complete onboarding first.")
    if not _is_premium(profile):
        raise HTTPException(status_code=403, detail={
            "code": "premium_required",
            "message": "El análisis Nuvos Investment Framework es exclusivo para Premium.",
        })

    if not query or not query.strip():
        raise HTTPException(status_code=400, detail="Escribe un ticker o nombre de empresa")

    if lang not in ("es", "en"):
        lang = getattr(profile, "preferred_language", None) or "es"

    ticker = await asyncio.to_thread(_resolve_quick_ticker, query)
    if not ticker:
        raise HTTPException(status_code=404, detail="No se pudo identificar esa empresa/ticker")

    cache_key = _nif_dashboard_cache_key(ticker, lang)
    cached = cache_get(cache_key)
    if cached:
        current_period = await asyncio.to_thread(_latest_reported_earnings_period, ticker)
        cached_period = cached.get("_earnings_period")
        if not current_period or current_period == cached_period:
            return _with_live_price(cached, ticker)

    try:
        result = await nif_service.build_nif_dashboard(ticker, lang)
    except Exception as exc:
        logger.error("nif_dashboard(%s): build_nif_dashboard failed: %s", ticker, exc, exc_info=True)
        raise HTTPException(status_code=503, detail=f"No pudimos generar el análisis NIF de {ticker} en este momento. Intenta de nuevo en unos segundos.")
    if not result:
        raise HTTPException(status_code=404, detail=f"No hay suficientes datos financieros reales para analizar {ticker}")

    result["_earnings_period"] = await asyncio.to_thread(_latest_reported_earnings_period, ticker)
    cache_set(cache_key, result, _NIF_DASHBOARD_CACHE_TTL)
    return _with_live_price(result, ticker)


def _log_thesis_event(user_id: str, ticker: str, result: dict) -> None:
    """Investment Graph — every time a user views this ticker's valuation
    (whether freshly computed or served from cache), it's logged as a
    'thesis' node in that company's history. Logged on BOTH exit paths of
    quick_analysis (cache hit and fresh compute) since viewing the analysis
    is the event that matters here, not whether the numbers were recomputed."""
    from app.services import investment_graph_service as graph_service
    asyncio.create_task(graph_service.log_event(
        user_id, ticker, "thesis",
        payload={
            "company_name": result.get("company_name"),
            "price": result.get("price"),
            "margin_of_safety_pct": result.get("margin_of_safety_pct"),
            "composite_score": result.get("composite_score"),
            "confidence_meter": result.get("confidence_meter"),
        },
    ))


@router.get("/weekly")
async def weekly_picks(
    tickers: str = "",
    user_id: str = Depends(get_current_user_id),
):
    """Return 5 personalized weekly picks based on user profile and existing portfolio."""
    from datetime import datetime as _dt
    existing = [t.strip().upper() for t in tickers.split(",") if t.strip()]

    # Cache per user per week (Mon–Sun)
    week_num  = _dt.now().isocalendar()[1]
    year      = _dt.now().year
    cache_key = f"screener:weekly:{user_id}:{year}:{week_num}"
    cached    = cache_get(cache_key)
    if cached:
        return cached

    # Fetch all universe stocks (cached 4h by _fetch_one)
    stocks = await asyncio.to_thread(_fetch_batch, UNIVERSE)
    stocks.sort(key=lambda x: x.get("score", 0), reverse=True)
    # Filter out stocks already in portfolio
    candidates = [s for s in stocks if s["ticker"] not in existing]

    profile = await _get_user_profile_safe(user_id)
    result  = await ai_service.generate_weekly_picks(candidates, profile, existing)
    result["generated_at"] = _dt.now().isoformat()

    cache_set(cache_key, result, ttl=_WEEKLY_TTL)
    return result


@router.post("/alert-context")
async def alert_context(request: dict, user_id: str = Depends(get_current_user_id)):
    """Return AI context for a price alert (called when user taps an alert)."""
    ticker    = request.get("ticker", "").upper()
    change_pct = request.get("change_pct", 0)
    profile   = await _get_user_profile_safe(user_id)
    direction = "subió" if change_pct >= 0 else "cayó"
    event     = f"{ticker} {direction} {abs(change_pct):.1f}% hoy"
    insight   = await ai_service.generate_alert_context(ticker, change_pct, profile)
    return {"ticker": ticker, "change_pct": change_pct, "insight": insight}
