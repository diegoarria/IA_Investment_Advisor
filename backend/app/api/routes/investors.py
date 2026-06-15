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
        "id": "burry",
        "name": "Michael Burry",
        "fund": "Scion Asset Management",
        "avatar": "🐻",
        "bio": "El inversor de 'The Big Short'. Conocido por apostar contra el mercado hipotecario en 2008.",
        "style": "Value contrarian · Apuestas asimétricas",
        "source": "sec_13f",
        "cik": "0001418387",
    },
    {
        "id": "buffett",
        "name": "Warren Buffett",
        "fund": "Berkshire Hathaway",
        "avatar": "🏦",
        "bio": "El Oráculo de Omaha. Inversor value más famoso del mundo.",
        "style": "Value investing · Largo plazo · Foso competitivo",
        "source": "sec_13f",
        "cik": "0001067983",
    },
    {
        "id": "ackman",
        "name": "Bill Ackman",
        "fund": "Pershing Square Capital",
        "avatar": "📣",
        "bio": "Activista con posiciones concentradas y tesis públicas muy detalladas.",
        "style": "Activismo · Posiciones concentradas",
        "source": "sec_13f",
        "cik": "0001336528",
    },
    {
        "id": "tepper",
        "name": "David Tepper",
        "fund": "Appaloosa Management",
        "avatar": "🦁",
        "bio": "Uno de los hedge fund managers más rentables de la historia.",
        "style": "Macro · Distressed assets",
        "source": "sec_13f",
        "cik": "0001656456",
    },
    {
        "id": "pelosi",
        "name": "Nancy Pelosi",
        "fund": "Divulgaciones Congresistas (STOCK Act)",
        "avatar": "🏛️",
        "bio": "Ex-Speaker de la Cámara. Sus trades han superado al S&P 500 consistentemente.",
        "style": "Tech · Semiconductores · Opciones",
        "source": "congress",
        "bioguide_id": "P000197",
    },
    {
        "id": "ark",
        "name": "Cathie Wood",
        "fund": "ARK Invest",
        "avatar": "🚀",
        "bio": "Fundadora de ARK. Apuesta por tecnología disruptiva e innovación.",
        "style": "Disruptive tech · Alto crecimiento · Largo plazo",
        "source": "ark",
        "ark_fund": "ARKK",
    },
]

# ── SEC EDGAR helpers ─────────────────────────────────────────────────────────

async def _fetch_sec_13f(cik: str) -> list[dict]:
    """Fetch latest 13F holdings from SEC EDGAR for a given CIK."""
    headers = {"User-Agent": "NuvosAI contact@nuvosai.com"}
    async with httpx.AsyncClient(timeout=15) as client:
        # Get latest 13F filing
        filings_url = f"https://data.sec.gov/submissions/CIK{cik.zfill(10)}.json"
        r = await client.get(filings_url, headers=headers)
        r.raise_for_status()
        data = r.json()

        recent = data.get("filings", {}).get("recent", {})
        forms = recent.get("form", [])
        accessions = recent.get("accessionNumber", [])
        dates = recent.get("filingDate", [])

        # Find most recent 13F-HR
        filing_idx = next((i for i, f in enumerate(forms) if f == "13F-HR"), None)
        if filing_idx is None:
            return []

        accession = accessions[filing_idx].replace("-", "")
        filing_date = dates[filing_idx]

        # Get the index of that filing
        index_url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession}/{accessions[filing_idx]}-index.json"
        idx_r = await client.get(index_url, headers=headers)
        idx_r.raise_for_status()
        idx_data = idx_r.json()

        # Find the primary XML document (infotable)
        xml_file = None
        for item in idx_data.get("directory", {}).get("item", []):
            name = item.get("name", "")
            if "infotable" in name.lower() or name.endswith(".xml"):
                xml_file = name
                break

        if not xml_file:
            return []

        xml_url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession}/{xml_file}"
        xml_r = await client.get(xml_url, headers=headers)
        xml_r.raise_for_status()
        xml_text = xml_r.text

        holdings = _parse_13f_xml(xml_text)
        return {"holdings": holdings, "filing_date": filing_date}


def _parse_13f_xml(xml_text: str) -> list[dict]:
    """Parse 13F XML infotable into a list of holdings."""
    holdings = []
    entries = re.findall(r"<infoTable>(.*?)</infoTable>", xml_text, re.DOTALL)
    for entry in entries:
        def get(tag):
            m = re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", entry, re.DOTALL)
            return m.group(1).strip() if m else ""

        name = get("nameOfIssuer")
        value = get("value")       # in thousands
        shares = get("sshPrnamt")
        ticker = ""  # 13F doesn't include ticker, we infer from name

        if name and value:
            holdings.append({
                "name": name,
                "ticker": ticker,
                "value_thousands": int(value.replace(",", "")) if value.replace(",", "").isdigit() else 0,
                "shares": int(shares.replace(",", "")) if shares.replace(",", "").isdigit() else 0,
            })

    # Sort by value descending, take top 20
    holdings.sort(key=lambda x: x["value_thousands"], reverse=True)
    return holdings[:20]


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

        elif inv["source"] == "ark":
            result = await _fetch_ark_holdings(inv.get("ark_fund", "ARKK"))
            holdings = result.get("holdings", [])
            filing_date = result.get("filing_date", "")

        elif inv["source"] == "congress":
            # Congress data: use house.gov disclosure API (returns recent transactions)
            holdings = await _fetch_congress_trades(inv.get("bioguide_id", ""))
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

    result = {
        **{k: v for k, v in inv.items() if k not in ("cik", "bioguide_id", "ark_fund", "source")},
        "holdings": holdings,
        "filing_date": filing_date,
        "analysis": analysis,
        "data_note": "Datos con hasta 45 días de retraso (SEC Form 13F / STOCK Act)",
    }

    cache_set(cache_key, result, ttl=6 * 3600)
    return result


async def _fetch_congress_trades(bioguide_id: str) -> list[dict]:
    """Fetch recent stock transactions from house.gov STOCK Act disclosures."""
    url = "https://disclosures-clerk.house.gov/public_disc/financial-pdfs/2024FD.zip"
    # Use the quiverquant or capitoltrades public API as fallback
    # Capitol Trades has a free tier that aggregates this data
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                "https://www.capitoltrades.com/politicians/P000197/trades.json",
                headers={"Accept": "application/json"},
            )
            if r.status_code == 200:
                data = r.json()
                trades = data.get("trades", data if isinstance(data, list) else [])
                holdings = []
                seen = set()
                for t in trades[:30]:
                    ticker = t.get("ticker") or t.get("asset_ticker", "")
                    name = t.get("asset_name") or t.get("company", ticker)
                    if ticker and ticker not in seen:
                        seen.add(ticker)
                        holdings.append({
                            "ticker": ticker,
                            "name": name,
                            "transaction": t.get("type") or t.get("transaction_type", ""),
                            "amount": t.get("amount") or t.get("size", ""),
                            "date": t.get("disclosed_date") or t.get("date", ""),
                            "value_thousands": 0,
                            "shares": 0,
                        })
                return holdings
    except Exception:
        pass
    return []
