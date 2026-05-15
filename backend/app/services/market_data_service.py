import re
import time
import yfinance as yf
from datetime import datetime

# ── Company name → ticker map ─────────────────────────────────────────────
COMPANY_TICKERS: dict[str, str] = {
    # Tech
    "nvidia": "NVDA", "nvda": "NVDA",
    "apple": "AAPL", "aapl": "AAPL",
    "amazon": "AMZN", "amzn": "AMZN",
    "microsoft": "MSFT", "msft": "MSFT",
    "tesla": "TSLA", "tsla": "TSLA",
    "google": "GOOGL", "alphabet": "GOOGL", "googl": "GOOGL", "goog": "GOOGL",
    "meta": "META", "facebook": "META",
    "netflix": "NFLX", "nflx": "NFLX",
    "amd": "AMD", "advanced micro": "AMD",
    "intel": "INTC", "intc": "INTC",
    "qualcomm": "QCOM", "qcom": "QCOM",
    "broadcom": "AVGO", "avgo": "AVGO",
    "oracle": "ORCL", "orcl": "ORCL",
    "salesforce": "CRM", "crm": "CRM",
    "adobe": "ADBE", "adbe": "ADBE",
    "palantir": "PLTR", "pltr": "PLTR",
    "uber": "UBER",
    "airbnb": "ABNB", "abnb": "ABNB",
    "spotify": "SPOT", "spot": "SPOT",
    "shopify": "SHOP", "shop": "SHOP",
    "snowflake": "SNOW", "snow": "SNOW",
    "coinbase": "COIN", "coin": "COIN",
    "arm": "ARM",
    "asml": "ASML",
    # Finance
    "jpmorgan": "JPM", "jp morgan": "JPM", "jpm": "JPM",
    "goldman": "GS", "goldman sachs": "GS", "gs": "GS",
    "berkshire": "BRK-B", "buffett": "BRK-B",
    "visa": "V",
    "mastercard": "MA",
    "paypal": "PYPL", "pypl": "PYPL",
    # Consumer
    "walmart": "WMT", "wmt": "WMT",
    "disney": "DIS", "dis": "DIS",
    "nike": "NKE", "nke": "NKE",
    "starbucks": "SBUX", "sbux": "SBUX",
    "mcdonald": "MCD", "mcdonalds": "MCD", "mcd": "MCD",
    "coca cola": "KO", "coca-cola": "KO", "ko": "KO",
    "pepsi": "PEP", "pepsico": "PEP", "pep": "PEP",
    # Health
    "johnson": "JNJ", "j&j": "JNJ", "jnj": "JNJ",
    "pfizer": "PFE", "pfe": "PFE",
    "eli lilly": "LLY", "lilly": "LLY", "lly": "LLY",
    "novo nordisk": "NVO", "novo": "NVO", "nvo": "NVO",
    # Energy / commodities
    "exxon": "XOM", "xom": "XOM",
    "chevron": "CVX", "cvx": "CVX",
    # Mexico
    "femsa": "FMX", "fmx": "FMX",
    "walmex": "WALMEX.MX",
    "cemex": "CX", "cx": "CX",
    "grupo bimbo": "BIMBOA.MX", "bimbo": "BIMBOA.MX",
    "amx": "AMX", "america movil": "AMX",
    # ETFs comunes
    "spy": "SPY", "s&p 500": "SPY", "sp500": "SPY",
    "qqq": "QQQ", "nasdaq": "QQQ",
    "vti": "VTI",
    "arkk": "ARKK",
    "gld": "GLD", "oro": "GLD", "gold": "GLD",
    "btc": "BTC-USD", "bitcoin": "BTC-USD",
    "eth": "ETH-USD", "ethereum": "ETH-USD",
}

# ── Simple TTL cache (30 min) ─────────────────────────────────────────────
_cache: dict[str, tuple[str, float]] = {}
CACHE_TTL = 1800  # 30 minutes


def _cached(ticker: str, builder) -> str:
    entry = _cache.get(ticker)
    if entry and time.time() - entry[1] < CACHE_TTL:
        return entry[0]
    result = builder(ticker)
    _cache[ticker] = (result, time.time())
    return result


# ── Ticker detection ──────────────────────────────────────────────────────

def detect_tickers(message: str) -> list[str]:
    found: set[str] = set()
    msg_lower = message.lower()

    for name, ticker in COMPANY_TICKERS.items():
        if name in msg_lower:
            found.add(ticker)

    # Direct uppercase tickers in the original message (e.g. "NVDA", "AAPL")
    for word in re.findall(r'\b[A-Z]{2,5}\b', message):
        if word in {t.upper() for t in COMPANY_TICKERS.values()}:
            found.add(word)

    return list(found)[:4]  # cap at 4 to avoid slow responses


# ── Data fetching ─────────────────────────────────────────────────────────

def _fmt_pct(v) -> str:
    return f"{v * 100:.1f}%" if v is not None else "N/D"


def _fmt_num(v, prefix="$", suffix="") -> str:
    if v is None:
        return "N/D"
    if abs(v) >= 1e12:
        return f"{prefix}{v/1e12:.2f}T{suffix}"
    if abs(v) >= 1e9:
        return f"{prefix}{v/1e9:.2f}B{suffix}"
    if abs(v) >= 1e6:
        return f"{prefix}{v/1e6:.2f}M{suffix}"
    return f"{prefix}{v:.2f}{suffix}"


def _build_company_context(ticker: str) -> str:
    try:
        stock = yf.Ticker(ticker)
        info = stock.info or {}
        name = info.get("longName") or info.get("shortName") or ticker

        lines: list[str] = [f"\n### 📊 DATOS EN TIEMPO REAL — {name} ({ticker})"]

        # ── Price & performance ──
        price = info.get("currentPrice") or info.get("regularMarketPrice")
        prev_close = info.get("previousClose")
        week52_high = info.get("fiftyTwoWeekHigh")
        week52_low = info.get("fiftyTwoWeekLow")

        if price:
            lines.append(f"**Precio:** ${price:.2f}")
        if price and prev_close:
            day_chg = (price - prev_close) / prev_close * 100
            lines.append(f"**Cambio hoy:** {day_chg:+.2f}%")
        if price and week52_high:
            from_high = (price - week52_high) / week52_high * 100
            from_low = (price - week52_low) / week52_low * 100 if week52_low else None
            lines.append(f"**Rango 52 semanas:** ${week52_low:.2f} – ${week52_high:.2f}")
            lines.append(f"**Vs máximo 52 sem:** {from_high:+.1f}% | **Vs mínimo:** {from_low:+.1f}%")

        # ── Business health ──
        lines.append("\n**Salud del negocio:**")
        rev_growth = info.get("revenueGrowth")
        earnings_growth = info.get("earningsGrowth")
        gross_margin = info.get("grossMargins")
        op_margin = info.get("operatingMargins")
        profit_margin = info.get("profitMargins")
        total_revenue = info.get("totalRevenue")
        free_cashflow = info.get("freeCashflow")
        debt_equity = info.get("debtToEquity")
        cash = info.get("totalCash")

        lines.append(f"- Ingresos totales: {_fmt_num(total_revenue)}")
        lines.append(f"- Crecimiento ingresos (YoY): {_fmt_pct(rev_growth)}")
        lines.append(f"- Crecimiento ganancias (YoY): {_fmt_pct(earnings_growth)}")
        lines.append(f"- Margen bruto: {_fmt_pct(gross_margin)}")
        lines.append(f"- Margen operativo: {_fmt_pct(op_margin)}")
        lines.append(f"- Margen neto: {_fmt_pct(profit_margin)}")
        lines.append(f"- Flujo de caja libre: {_fmt_num(free_cashflow)}")
        lines.append(f"- Deuda/Equity: {f'{debt_equity:.1f}' if debt_equity else 'N/D'}")
        lines.append(f"- Efectivo en caja: {_fmt_num(cash)}")

        # ── Valuation ──
        pe = info.get("trailingPE")
        fwd_pe = info.get("forwardPE")
        ps = info.get("priceToSalesTrailing12Months")
        peg = info.get("pegRatio")
        mkt_cap = info.get("marketCap")

        lines.append("\n**Valuación:**")
        lines.append(f"- Market cap: {_fmt_num(mkt_cap)}")
        lines.append(f"- P/E trailing: {f'{pe:.1f}' if pe else 'N/D'}")
        lines.append(f"- P/E forward: {f'{fwd_pe:.1f}' if fwd_pe else 'N/D'}")
        lines.append(f"- P/S: {f'{ps:.1f}' if ps else 'N/D'}")
        lines.append(f"- PEG: {f'{peg:.1f}' if peg else 'N/D'}")

        # ── Analyst consensus ──
        target = info.get("targetMeanPrice")
        recom = info.get("recommendationKey", "").replace("_", " ").upper()
        num_analysts = info.get("numberOfAnalystOpinions")
        if target or recom:
            lines.append("\n**Consenso analistas:**")
            if recom:
                lines.append(f"- Recomendación: {recom} ({num_analysts or '?'} analistas)")
            if target and price:
                upside = (target - price) / price * 100
                lines.append(f"- Precio objetivo promedio: ${target:.2f} ({upside:+.1f}% vs precio actual)")

        # ── Recent news ──
        try:
            raw_news = stock.news or []
            news_items = raw_news[:6]
            if news_items:
                lines.append("\n**Noticias recientes:**")
                for article in news_items:
                    title = article.get("title", "")
                    publisher = article.get("publisher", "")
                    ts = article.get("providerPublishTime", 0)
                    date_str = datetime.fromtimestamp(ts).strftime("%d/%m/%Y") if ts else "?"
                    lines.append(f"- [{date_str}] {title} — *{publisher}*")
        except Exception:
            pass

        lines.append(
            "\n*Fuente: Yahoo Finance (tiempo real). Úsala para contextualizar "
            "si la caída responde a fundamentos o es ruido de mercado.*"
        )
        return "\n".join(lines)

    except Exception as e:
        return f"\n[No se pudo obtener datos para {ticker}: {e}]"


def get_company_context(ticker: str) -> str:
    return _cached(ticker, _build_company_context)


def get_market_context_for_message(message: str) -> str:
    """Detect companies in a message and return their real-time context block."""
    tickers = detect_tickers(message)
    if not tickers:
        return ""
    blocks = [get_company_context(t) for t in tickers]
    header = "\n---\n[CONTEXTO DE MERCADO ACTUALIZADO — extraído de Yahoo Finance ahora mismo]\n"
    return header + "\n".join(blocks) + "\n---"
