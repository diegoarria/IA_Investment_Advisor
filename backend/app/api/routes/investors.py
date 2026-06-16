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
        "cik": "0001350683",
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
        "cik": "0001480770",
    },
    {
        "id": "pabrai",
        "name": "Mohnish Pabrai",
        "fund": "Pabrai Investment Funds",
        "avatar": "🎯",
        "bio": "Discípulo de Buffett. Copiador sistemático de las mejores ideas de inversión del mundo.",
        "style": "Cloning · Value concentrado · Paciencia",
        "source": "sec_13f",
        "cik": "0001492222",
    },
    {
        "id": "ark",
        "name": "Cathie Wood",
        "fund": "ARK Invest",
        "avatar": "🚀",
        "bio": "Fundadora de ARK. Apuesta por tecnología disruptiva e innovación con horizonte de 5 años.",
        "style": "Disruptive tech · Alto crecimiento · Largo plazo",
        "source": "ark",
        "ark_fund": "ARKK",
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
        "sec_13f": "Datos trimestrales con hasta 45 días de retraso (SEC Form 13F)",
        "ark": "Holdings publicados diariamente por ARK Invest",
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
