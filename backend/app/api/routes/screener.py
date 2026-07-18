import asyncio
from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import get_current_user_id
from app.services import ai_service
from app.api.routes.market import _get_user_profile
from app.core.cache import cache_get, cache_set
from app.core.finnhub import fh_quote, fh_metrics, fh_search

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
        profile = _get_user_profile(user_id)
        ai_insight = await ai_service.screen_stocks(stocks, query, profile)

    return {"results": stocks[:15], "ai_insight": ai_insight}


@router.get("/undervalued")
async def undervalued(sector: str | None = None, limit: int = 60, user_id: str = Depends(get_current_user_id)):
    """Real, DCF-backed undervalued candidates — cache-only read (see
    undervalued_screener_service), refreshed weekly by a background job.
    Distinct from screen()/weekly_picks() above, which layer an LLM
    narrative over live Finnhub metrics, not the real DCF engine."""
    from app.api.routes.chat import _is_premium
    profile = _get_user_profile(user_id)
    if not _is_premium(profile):
        raise HTTPException(status_code=403, detail="El screener de subvaluadas requiere Premium")
    lang = getattr(profile, "preferred_language", None) or "es"
    from app.services.undervalued_screener_service import get_undervalued, bootstrap_fill_if_empty_sync
    result = get_undervalued(limit=limit, sector=sector, lang=lang)
    if not result["results"]:
        # Cache is completely empty (worker hasn't run its startup/weekly
        # refresh yet) — never return a blank screen. Slower this one time
        # (small subset scan), fast for every request after.
        await asyncio.to_thread(bootstrap_fill_if_empty_sync)
        result = get_undervalued(limit=limit, sector=sector, lang=lang)
    return result


def _resolve_quick_ticker(query: str) -> str | None:
    """Resolves free-text (a ticker or a company name) to a real ticker
    symbol for the quick-analysis search below. Tries the input as a
    ticker directly first (cheapest — no extra API call); only falls back
    to a live Finnhub symbol search for company-name input."""
    candidate = query.strip().upper()
    if candidate.isalpha() and 1 <= len(candidate) <= 5:
        return candidate
    try:
        results = fh_search(query.strip())
    except Exception:
        return None
    for r in results:
        if r.get("symbol") and r.get("type", "").lower() in ("common stock", "equity", ""):
            return r["symbol"]
    return None


@router.get("/quick-analysis")
async def quick_analysis(query: str, user_id: str = Depends(get_current_user_id)):
    """Ad-hoc single-ticker valuation search — the real DCF engine (same one
    behind Mentor IA and the undervalued screener) plus a SHORT narrative
    summary (see ai_service.generate_quick_valuation_summary), for any
    ticker/company name, not just the curated screener universe. Live —
    unlike the screener, this is a single ticker so it's fast enough to
    compute per-request, no caching needed."""
    from app.api.routes.chat import _is_premium
    profile = _get_user_profile(user_id)
    if not _is_premium(profile):
        raise HTTPException(status_code=403, detail="La búsqueda de valor intrínseco requiere Premium")

    if not query or not query.strip():
        raise HTTPException(status_code=400, detail="Escribe un ticker o nombre de empresa")

    ticker = await asyncio.to_thread(_resolve_quick_ticker, query)
    if not ticker:
        raise HTTPException(status_code=404, detail="No se pudo identificar esa empresa/ticker")

    from app.services.fundamental_analysis_service import get_fundamental_analysis
    data = await asyncio.to_thread(get_fundamental_analysis, ticker)
    if not data or not data.get("dcf"):
        raise HTTPException(status_code=404, detail=f"No hay suficientes datos financieros reales para calcular el valor intrínseco de {ticker}")

    lang = getattr(profile, "preferred_language", None) or "es"
    ai_result = await ai_service.generate_quick_valuation_summary(data, lang=lang)
    dcf = data["dcf"]

    # 7-point investment checklist — item 1 (Entender el negocio) is Claude's
    # qualitative judgment from ai_result above; items 2-7's "passed" flags
    # are real, computed by fundamental_analysis_service, and their "reason"
    # text is Claude's nuanced explanation grounded in real multi-factor
    # evidence (see undervalued_screener_service._finalize_checklist, reused
    # here so both entry points merge identically).
    from app.services.undervalued_screener_service import _finalize_checklist
    _finalize_checklist(data, {
        "key": "business_understanding",
        "name": "Entender el negocio" if lang != "en" else "Understanding the business",
        "passed": ai_result.get("business_understanding_passed"),
        "reason": ai_result.get("business_understanding_reason", ""),
    }, ai_result.get("checklist_reasons"))
    checklist = data["checklist"]

    return {
        "ticker": data["ticker"],
        "company_name": data.get("company_name"),
        "sector": data.get("sector"),
        "price": data.get("current_price"),
        "intrinsic_value_base": dcf["scenarios"]["base"]["intrinsic_value_per_share"],
        "expected_value_per_share": dcf.get("expected_value_per_share"),
        "margin_of_safety_pct": dcf.get("margin_of_safety_pct"),
        "implied_growth_pct": dcf.get("implied_growth_pct"),
        "thesis_scores": data.get("thesis_scores"),
        "summary": ai_result.get("summary", ""),
        "checklist": checklist,
    }


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

    profile = _get_user_profile(user_id)
    result  = await ai_service.generate_weekly_picks(candidates, profile, existing)
    result["generated_at"] = _dt.now().isoformat()

    cache_set(cache_key, result, ttl=_WEEKLY_TTL)
    return result


@router.post("/alert-context")
async def alert_context(request: dict, user_id: str = Depends(get_current_user_id)):
    """Return AI context for a price alert (called when user taps an alert)."""
    ticker    = request.get("ticker", "").upper()
    change_pct = request.get("change_pct", 0)
    profile   = _get_user_profile(user_id)
    direction = "subió" if change_pct >= 0 else "cayó"
    event     = f"{ticker} {direction} {abs(change_pct):.1f}% hoy"
    insight   = await ai_service.generate_alert_context(ticker, change_pct, profile)
    return {"ticker": ticker, "change_pct": change_pct, "insight": insight}
