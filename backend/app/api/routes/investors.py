"""
Investor Tracker — tracks public portfolio disclosures of famous investors.

Data sources (all free & public):
- SEC EDGAR Form 13F: institutional investors >$100M AUM (quarterly, ~45-day delay)
- House STOCK Act disclosures: US Congress members (up to 45-day delay)
- ARK Invest daily holdings CSV (published daily by ARK)
"""
import re
import csv
import io
import httpx
import asyncio
import statistics
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from app.api.deps import get_current_user_id
from app.core.cache import cache_get, cache_set
import anthropic
import os

router = APIRouter(prefix="/investors", tags=["investors"])

_ANTHROPIC = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

# ── Known investors with their SEC CIK numbers and display info ───────────────
TRACKED_INVESTORS = [
    {
        "id": "buffett",
        "name": "Warren Buffett",
        "fund": "Berkshire Hathaway",
        "avatar": "🏦",
        "bio": "El Oráculo de Omaha. El inversor value más famoso del mundo con 60+ años de retornos excepcionales.",
        "style": "Value investing · Largo plazo · Foso competitivo",
        "source": "sec_13f",
        "cik": "0001067983",
    },
    {
        "id": "munger",
        "name": "Charlie Munger",
        "fund": "Daily Journal Corporation (histórico)",
        "avatar": "📚",
        "bio": "Socio de Buffett durante décadas. Filósofo del value investing. Falleció en noviembre 2023.",
        "style": "Value profundo · Concentración extrema · Psicología del mercado",
        "source": "sec_13f",
        "cik": "0000783412",
    },
    {
        "id": "burry",
        "name": "Michael Burry",
        "fund": "Scion Asset Management",
        "avatar": "🐻",
        "bio": "El inversor de 'The Big Short'. Conocido por apostar contra el mercado hipotecario en 2008.",
        "style": "Value contrarian · Apuestas asimétricas",
        "source": "sec_13f",
        "cik": "0001649339",
    },
    {
        "id": "ackman",
        "name": "Bill Ackman",
        "fund": "Pershing Square Capital",
        "avatar": "📣",
        "bio": "Activista con posiciones concentradas y tesis públicas muy detalladas. Habla directo.",
        "style": "Activismo · Posiciones concentradas · Catalizadores",
        "source": "sec_13f",
        "cik": "0001336528",
    },
    {
        "id": "dalio",
        "name": "Ray Dalio",
        "fund": "Bridgewater Associates",
        "avatar": "🌊",
        "bio": "Fundador del hedge fund más grande del mundo. Creador de los Principios y del 'All Weather Portfolio'.",
        "style": "Macro global · Risk parity · Diversificación extrema",
        "source": "sec_13f",
        "cik": "0001350694",
    },
    {
        "id": "druckenmiller",
        "name": "Stanley Druckenmiller",
        "fund": "Duquesne Family Office",
        "avatar": "⚡",
        "bio": "Trabajó con Soros para quebrar el Banco de Inglaterra. Uno de los mejores macro traders de la historia.",
        "style": "Global macro · Momentum · Alta convicción",
        "source": "sec_13f",
        "cik": "0001536411",
    },
    {
        "id": "klarman",
        "name": "Seth Klarman",
        "fund": "Baupost Group",
        "avatar": "🔍",
        "bio": "Autor de 'Margin of Safety'. El más secreto de los grandes inversores value. Fondo de $30B+.",
        "style": "Deep value · Margen de seguridad · Paciencia extrema",
        "source": "sec_13f",
        "cik": "0001061768",
    },
    {
        "id": "tepper",
        "name": "David Tepper",
        "fund": "Appaloosa Management",
        "avatar": "🦁",
        "bio": "Uno de los hedge fund managers más rentables de la historia. Sus declaraciones mueven mercados.",
        "style": "Macro · Distressed assets · Oportunismo",
        "source": "sec_13f",
        "cik": "0001656456",
    },
    {
        "id": "coleman",
        "name": "Chase Coleman",
        "fund": "Tiger Global Management",
        "avatar": "🐯",
        "bio": "Discípulo de Julian Robertson. Pionero en inversión en tecnología y startups globales.",
        "style": "Growth tech · Venture híbrido · Global",
        "source": "sec_13f",
        "cik": "0001167483",
    },
    {
        "id": "ark",
        "name": "Cathie Wood",
        "fund": "ARK Investment Management",
        "avatar": "🚀",
        "bio": "Fundadora de ARK. Apuesta por tecnología disruptiva e innovación con horizonte de 5 años.",
        "style": "Disruptive tech · Alto crecimiento · Largo plazo",
        "source": "sec_13f",
        "cik": "0001697748",
    },
    {
        "id": "pelosi",
        "name": "Nancy Pelosi",
        "fund": "Divulgaciones Congresistas (STOCK Act)",
        "avatar": "🏛️",
        "bio": "Ex-Speaker de la Cámara. Sus trades en opciones tech han superado al S&P 500 consistentemente.",
        "style": "Tech · Semiconductores · Opciones",
        "source": "congress",
        "bioguide_id": "P000197",
    },
    {
        "id": "congress",
        "name": "Portafolio Congresistas EE.UU.",
        "fund": "Agregado STOCK Act (Cámara + Senado)",
        "avatar": "🇺🇸",
        "bio": "Agregado de las transacciones más recientes de todos los miembros del Congreso bajo el STOCK Act.",
        "style": "Diversificado · Insider político · Todas las industrias",
        "source": "congress_all",
    },
]

# ── CUSIP → ticker mapping (common stocks held by tracked investors) ──────────
CUSIP_TICKER: dict[str, str] = {
    # Big Tech
    "037833100": "AAPL", "594918104": "MSFT", "023135106": "AMZN",
    "02079K305": "GOOGL", "02079K107": "GOOG", "30303M102": "META",
    "67066G104": "NVDA", "88160R101": "TSLA", "79466L302": "SHOP",
    # Financials
    "025816109": "AXP", "060505104": "BAC", "172967424": "C",
    "46625H100": "JPM", "808513105": "SCHW", "451055106": "BK",
    "38141G104": "GS", "14040H105": "COF", "02005N100": "ALLY",
    "913017109": "USB", "718172109": "PGR", "125509109": "CB",
    "29977A105": "EVR", "03748R747": "BLK", "844741108": "SPGI",
    # Berkshire staples
    "49327M100": "KO", "61166W101": "MCO", "500754106": "KHC",
    "26441C204": "DVA", "097023105": "BOH",
    # Energy
    "984121103": "XOM", "12189T104": "CVX", "682095102": "OXY",
    "413216109": "HAL", "29273V100": "ENB",
    # Healthcare & Pharma
    "532457108": "LLY", "023586100": "AMGN", "09243R107": "BIIB",
    "58492M109": "MRK", "719413100": "PFE", "585055106": "MDT",
    # Consumer & Other
    "742718109": "PG", "72971M104": "PM", "871000103": "SYX",
    "064058100": "BAX", "92108H102": "V", "571748102": "MA",
    "58155Q103": "MCD", "G76720132": "QSR", "11120U105": "BN",
    # Tech & Growth
    "639734107": "NFLX", "204448104": "CPRT", "456837104": "ISRG",
    "G2519Y108": "AXON", "741503207": "RH", "22788C105": "CROX",
    "64110D104": "NWSA", "879585209": "TDG", "370334104": "GE",
    "92189F106": "VZ", "44919V101": "HPQ",
    # ETFs
    "78464A870": "QQQ", "464287614": "IVV", "78462F103": "SPY",
    # Burry picks
    "69366A100": "PLTR", "67066G104": "NVDA", "717081103": "PFE",
    # International
    "G8056D108": "RY", "T67604100": "BCE", "S8126G103": "SE",
    "G40404148": "HTHT",
}

# ── SEC EDGAR helpers ─────────────────────────────────────────────────────────

async def _fetch_sec_13f(cik: str) -> dict:
    """
    Fetch latest 13F holdings from SEC EDGAR.

    Bugs fixed vs. original:
    1. Index URL was .json (404) — now uses .htm and parses href links
    2. Company CIK (not filer CIK) is used for the data directory
    3. 13F values are in full USD since ~2024 — we divide by 1000 for display
    """
    headers = {
        "User-Agent": "NuvosAI research@nuvosai.com",
        "Accept-Encoding": "gzip",
    }
    cik_int = int(cik.lstrip("0") or "0")
    cik_padded = str(cik_int).zfill(10)

    async with httpx.AsyncClient(timeout=30, headers=headers, follow_redirects=True) as client:
        # 1. Get list of all filings for this entity
        r = await client.get(f"https://data.sec.gov/submissions/CIK{cik_padded}.json")
        r.raise_for_status()
        sub = r.json()

        recent = sub.get("filings", {}).get("recent", {})
        forms = recent.get("form", [])
        accessions = recent.get("accessionNumber", [])
        dates = recent.get("filingDate", [])
        primary_docs = recent.get("primaryDocument", [])

        # Find the most recent 13F-HR (not amendment)
        filing_idx = next((i for i, f in enumerate(forms) if f == "13F-HR"), None)
        if filing_idx is None:
            return {"holdings": [], "filing_date": ""}

        acc_raw = accessions[filing_idx]           # e.g. "0001193125-26-226661"
        acc_nodash = acc_raw.replace("-", "")      # "000119312526226661"
        filing_date = dates[filing_idx]

        # 2. The data directory always uses the COMPANY CIK (not the filing agent CIK).
        #    Parse the .htm index to discover XML file names.
        index_htm = (
            f"https://www.sec.gov/Archives/edgar/data/"
            f"{cik_int}/{acc_nodash}/{acc_raw}-index.htm"
        )
        ir = await client.get(index_htm)
        if ir.status_code != 200:
            return {"holdings": [], "filing_date": filing_date}

        # Extract .xml hrefs from the index page
        xml_links = re.findall(
            r'href="(/Archives/edgar/data/[^"]+\.xml)"',
            ir.text, re.IGNORECASE,
        )
        # Filter out primary/cover/header docs, keep infotable candidates
        infotable_urls: list[str] = []
        primary_url: str = ""
        for lnk in xml_links:
            base = lnk.split("/")[-1].lower()
            if "infotable" in base or "information_table" in base:
                infotable_urls.insert(0, "https://www.sec.gov" + lnk)
            elif "primary" in base or "cover" in base:
                primary_url = "https://www.sec.gov" + lnk
            else:
                infotable_urls.append("https://www.sec.gov" + lnk)

        # Remove duplicates while preserving order
        seen: set[str] = set()
        candidates = [u for u in infotable_urls if not (u in seen or seen.add(u))]

        # 3. Try each candidate XML until we find one with holdings
        for url in candidates:
            xr = await client.get(url)
            if xr.status_code != 200:
                continue
            holdings = _parse_13f_xml(xr.text)
            if holdings:
                return {"holdings": holdings, "filing_date": filing_date}

        return {"holdings": [], "filing_date": filing_date}


def _parse_13f_xml(xml_text: str) -> list[dict]:
    """
    Parse 13F infotable XML. Handles namespace prefixes and auto-detects
    whether values are in full USD (2024+ format) or old thousands format.
    Detection: median(value / shares) > 5 → full USD → divide by 1000.
    """
    clean = re.sub(r"<(/?)[\w-]+:([\w-]+)", r"<\1\2", xml_text)
    entries = re.findall(
        r"<infoTable\b[^>]*>(.*?)</infoTable>", clean, re.DOTALL | re.IGNORECASE
    )
    if not entries:
        return []

    def tag(t: str, entry: str) -> str:
        m = re.search(rf"<{t}\b[^>]*>(.*?)</{t}>", entry, re.DOTALL | re.IGNORECASE)
        return m.group(1).strip() if m else ""

    # First pass: collect raw data and compute value/shares ratios
    rows: list[tuple] = []
    ratios: list[float] = []
    for entry in entries:
        name  = tag("nameOfIssuer", entry).strip()
        val   = re.sub(r"[^\d]", "", tag("value", entry))
        shrs  = re.sub(r"[^\d]", "", tag("sshPrnamt", entry))
        cusip = tag("cusip", entry).replace(" ", "")
        if not name or not val:
            continue
        raw_val = int(val)
        shares  = int(shrs) if shrs else 0
        if shares > 0:
            ratios.append(raw_val / shares)
        rows.append((name, raw_val, shares, cusip))

    if not rows:
        return []

    # If median(value/shares) > 5, values are in full USD — divide by 1000
    median_ratio = statistics.median(ratios) if ratios else 0
    is_full_usd = median_ratio > 5

    holdings: list[dict] = []
    for name, raw_val, shares, cusip in rows:
        value_thousands = raw_val // 1000 if is_full_usd else raw_val
        holdings.append({
            "ticker": CUSIP_TICKER.get(cusip, ""),
            "name": name.title(),
            "cusip": cusip,
            "value_thousands": value_thousands,
            "shares": shares,
            "weight_pct": 0.0,
        })

    # Aggregate duplicates (e.g. different share classes filed separately)
    agg: dict[str, dict] = {}
    for h in holdings:
        key = h["cusip"] or h["name"]
        if key in agg:
            agg[key]["value_thousands"] += h["value_thousands"]
            agg[key]["shares"] += h["shares"]
        else:
            agg[key] = dict(h)
    merged = sorted(agg.values(), key=lambda x: x["value_thousands"], reverse=True)[:20]

    total = sum(h["value_thousands"] for h in merged)
    if total:
        for h in merged:
            h["weight_pct"] = round(h["value_thousands"] / total * 100, 1)

    return merged


# ── ARK helper ────────────────────────────────────────────────────────────────

async def _fetch_ark_holdings(fund: str = "ARKK") -> dict:
    """Fetch ARK daily holdings CSV."""
    url = f"https://ark-funds.com/wp-content/uploads/funds-etf-csv/ARK_INNOVATION_ETF_{fund}_HOLDINGS.csv"
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.get(url)
            r.raise_for_status()
        except Exception:
            # Fallback URL format
            url2 = f"https://ark-funds.com/wp-content/uploads/funds-etf-csv/ARK_INNOVATION_ETF_ARKK_HOLDINGS.csv"
            r = await client.get(url2)

        reader = csv.DictReader(io.StringIO(r.text))
        holdings = []
        date_str = ""
        for row in reader:
            if not date_str and row.get("date"):
                date_str = row["date"]
            ticker = row.get("ticker", "").strip()
            company = row.get("company", "").strip()
            weight = row.get("weight(%)", row.get("weight", "0")).strip().replace("%", "")
            shares = row.get("shares", "0").strip().replace(",", "")
            if ticker and company:
                try:
                    holdings.append({
                        "ticker": ticker,
                        "name": company,
                        "weight_pct": float(weight) if weight else 0,
                        "shares": int(shares) if shares.isdigit() else 0,
                        "value_thousands": 0,
                    })
                except Exception:
                    pass

        holdings.sort(key=lambda x: x["weight_pct"], reverse=True)
        return {"holdings": holdings[:20], "filing_date": date_str}


# ── AI analysis helper ────────────────────────────────────────────────────────

async def _ai_portfolio_analysis(investor_name: str, fund: str, holdings: list[dict], style: str) -> str:
    """Generate a concise AI analysis of the investor's current portfolio."""
    top = holdings[:10]
    names = ", ".join(h.get("ticker") or h.get("name", "") for h in top if h.get("ticker") or h.get("name"))
    prompt = (
        f"Eres un analista financiero experto. Analiza brevemente el portafolio actual de {investor_name} ({fund}).\n"
        f"Estilo conocido: {style}\n"
        f"Top posiciones: {names}\n\n"
        f"En 3-4 oraciones en español explica: qué sectores domina, qué nos dice sobre su visión actual del mercado, "
        f"y qué pueden aprender los inversionistas retail de esta cartera."
    )
    loop = asyncio.get_event_loop()
    def _call():
        msg = _ANTHROPIC.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        return msg.content[0].text
    return await loop.run_in_executor(None, _call)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_investors(_: str = Depends(get_current_user_id)):
    """Return the list of tracked investors (metadata only, no holdings)."""
    return {"investors": [
        {k: v for k, v in inv.items() if k not in ("cik", "bioguide_id", "ark_fund", "source")}
        for inv in TRACKED_INVESTORS
    ]}


@router.get("/{investor_id}")
async def get_investor_holdings(
    investor_id: str,
    _: str = Depends(get_current_user_id),
):
    """Return full holdings + AI analysis for one investor. Cached 6h."""
    cache_key = f"investor:{investor_id}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    inv = next((i for i in TRACKED_INVESTORS if i["id"] == investor_id), None)
    if not inv:
        return {"error": "Investor not found"}

    holdings = []
    filing_date = ""

    try:
        if inv["source"] == "sec_13f":
            result = await _fetch_sec_13f(inv["cik"])
            holdings = result.get("holdings", []) if isinstance(result, dict) else []
            filing_date = result.get("filing_date", "") if isinstance(result, dict) else ""

        elif inv["source"] == "congress":
            holdings = await _fetch_congress_trades(inv.get("bioguide_id", ""))
            filing_date = datetime.utcnow().strftime("%Y-%m-%d")

        elif inv["source"] == "congress_all":
            holdings = await _fetch_congress_all()
            filing_date = datetime.utcnow().strftime("%Y-%m-%d")

    except Exception as e:
        holdings = []
        filing_date = ""

    # AI analysis (only if we got holdings)
    analysis = ""
    if holdings:
        try:
            analysis = await _ai_portfolio_analysis(
                inv["name"], inv["fund"], holdings, inv["style"]
            )
        except Exception:
            analysis = ""

    source = inv.get("source", "")
    data_note = {
        "sec_13f": "Datos trimestrales con hasta 45 días de retraso (SEC Form 13F, valores en USD)",
        "congress": "Transacciones reportadas bajo el STOCK Act (hasta 45 días de retraso)",
        "congress_all": "Transacciones agregadas de todos los congresistas bajo el STOCK Act",
    }.get(source, "Datos de fuentes públicas")

    result = {
        **{k: v for k, v in inv.items() if k not in ("cik", "bioguide_id", "ark_fund", "source")},
        "holdings": holdings,
        "filing_date": filing_date,
        "analysis": analysis,
        "data_note": data_note,
    }

    cache_set(cache_key, result, ttl=6 * 3600)
    return result


async def _fetch_congress_trades(bioguide_id: str) -> list[dict]:
    """Fetch recent trades for one congress member via House Stock Watcher data."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                "https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json",
                headers={"User-Agent": "NuvosAI contact@nuvosai.com"},
            )
            r.raise_for_status()
            all_trades = r.json()
    except Exception:
        return []

    # Filter by representative name (Pelosi → "Nancy Pelosi")
    name_map = {"P000197": "Nancy Pelosi"}
    target_name = name_map.get(bioguide_id, "").lower()

    holdings = []
    seen: set[str] = set()
    for t in all_trades:
        rep = (t.get("representative") or "").lower()
        if target_name and target_name not in rep:
            continue
        ticker = (t.get("ticker") or "").strip().upper()
        if not ticker or ticker in seen or ticker in ("N/A", "--"):
            continue
        seen.add(ticker)
        holdings.append({
            "ticker": ticker,
            "name": t.get("asset_description") or ticker,
            "transaction": t.get("type", ""),
            "amount": t.get("amount", ""),
            "date": t.get("disclosure_date") or t.get("transaction_date", ""),
            "value_thousands": 0,
            "shares": 0,
        })
        if len(holdings) >= 25:
            break
    return holdings


async def _fetch_congress_all() -> list[dict]:
    """Aggregate recent STOCK Act transactions across ALL congress members."""
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(
                "https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json",
                headers={"User-Agent": "NuvosAI contact@nuvosai.com"},
            )
            r.raise_for_status()
            all_trades = r.json()
    except Exception:
        return []

    # Count how many times each ticker was bought by congress members
    from collections import Counter, defaultdict
    buy_count: Counter = Counter()
    sell_count: Counter = Counter()
    names: dict[str, str] = {}
    recent: dict[str, str] = {}
    reps: dict[str, set] = defaultdict(set)

    for t in all_trades:
        ticker = (t.get("ticker") or "").strip().upper()
        if not ticker or ticker in ("N/A", "--"):
            continue
        tx_type = (t.get("type") or "").lower()
        date = t.get("disclosure_date") or t.get("transaction_date") or ""
        rep = t.get("representative") or ""
        if "purchase" in tx_type or "buy" in tx_type:
            buy_count[ticker] += 1
        elif "sale" in tx_type or "sell" in tx_type:
            sell_count[ticker] += 1
        if ticker not in names:
            names[ticker] = t.get("asset_description") or ticker
        if date > recent.get(ticker, ""):
            recent[ticker] = date
        if rep:
            reps[ticker].add(rep)

    # Rank by buy activity
    top = sorted(buy_count.keys(), key=lambda t: buy_count[t], reverse=True)[:25]
    result = []
    for tk in top:
        result.append({
            "ticker": tk,
            "name": names.get(tk, tk),
            "transaction": f"Compras: {buy_count[tk]} · Ventas: {sell_count.get(tk, 0)}",
            "amount": f"{len(reps[tk])} congresistas",
            "date": recent.get(tk, ""),
            "value_thousands": 0,
            "shares": 0,
        })
    return result
