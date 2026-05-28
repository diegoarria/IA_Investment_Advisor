import re
import time
import math
import concurrent.futures
import requests
import yfinance as yf
from datetime import datetime, timedelta

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

# ── Simple TTL cache (30 min for company data, 15 min for global) ─────────
_cache: dict[str, tuple[str, float]] = {}
CACHE_TTL = 1800  # 30 minutes
_global_cache: dict[str, tuple[str, float]] = {}
GLOBAL_CACHE_TTL = 900  # 15 minutes


def _cached(ticker: str, builder) -> str:
    entry = _cache.get(ticker)
    if entry and time.time() - entry[1] < CACHE_TTL:
        return entry[0]
    result = builder(ticker)
    _cache[ticker] = (result, time.time())
    return result


# ── Global market context (indices + IPOs, injected on every message) ──────

def _get_index_summary(ticker: str, label: str) -> str:
    try:
        t = yf.Ticker(ticker)
        info = t.info or {}
        price = info.get("regularMarketPrice") or info.get("currentPrice")
        prev = info.get("previousClose")
        if price and prev:
            chg = (price - prev) / prev * 100
            arrow = "⬆" if chg >= 0 else "⬇"
            return f"  {label}: {price:,.2f} {arrow} {chg:+.2f}%"
        elif price:
            return f"  {label}: {price:,.2f}"
        return f"  {label}: N/D"
    except Exception:
        return f"  {label}: N/D"


def _fetch_recent_ipos() -> str:
    """Fetch recent and upcoming IPOs from Nasdaq public API (no key required)."""
    try:
        today = datetime.today()
        months = [today.strftime("%Y-%m")]
        if today.day <= 10:
            prev = (today.replace(day=1) - timedelta(days=1))
            months.append(prev.strftime("%Y-%m"))

        seen: set[str] = set()
        ipo_lines: list[str] = []

        for month in months:
            url = f"https://api.nasdaq.com/api/ipo/calendar?date={month}"
            r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=3)
            if r.status_code != 200:
                continue
            data = r.json().get("data", {})

            for section_key in ("priced", "upcoming", "filed"):
                section = data.get(section_key, {})
                table_key = next(iter(section), None)
                rows = section.get(table_key, {}).get("rows") or [] if table_key else []
                for row in rows:
                    symbol = row.get("proposedTickerSymbol", "").strip()
                    name   = row.get("companyName", "").strip()
                    date   = (row.get("pricedDate") or row.get("expectedPriceDate") or "").strip()
                    price_range = row.get("proposedSharePrice", "").strip()
                    if not symbol or symbol in seen:
                        continue
                    seen.add(symbol)
                    status = {"priced": "COTIZA YA", "upcoming": "PRÓXIMA", "filed": "REGISTRADA"}.get(section_key, "")
                    ipo_lines.append(
                        f"  [{status}] {symbol} — {name}"
                        + (f" | Precio: {price_range}" if price_range else "")
                        + (f" | Fecha: {date}" if date else "")
                    )
                    if len(ipo_lines) >= 10:
                        break
                if len(ipo_lines) >= 10:
                    break
            if len(ipo_lines) >= 10:
                break

        if ipo_lines:
            return "**IPOs recientes / próximas (Nasdaq):**\n" + "\n".join(ipo_lines)
        return ""
    except Exception:
        return ""


_INDICES = [
    ("^GSPC",   "S&P 500"),
    ("^IXIC",   "NASDAQ Composite"),
    ("^DJI",    "Dow Jones"),
    ("^RUT",    "Russell 2000"),
    ("^VIX",    "VIX (volatilidad / miedo)"),
    ("BTC-USD", "Bitcoin"),
    ("GC=F",    "Oro"),
    ("CL=F",    "Petróleo WTI"),
]


def get_global_market_context() -> str:
    """
    Returns a global market context block injected into every AI chat request.
    Includes current date/time, major indices, and recent IPOs.
    Cached 15 minutes. All network calls run in parallel.
    """
    cache_key = "__global__"
    entry = _global_cache.get(cache_key)
    if entry and time.time() - entry[1] < GLOBAL_CACHE_TTL:
        return entry[0]

    now = datetime.now()

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(_INDICES) + 1) as ex:
        index_futs = {ex.submit(_get_index_summary, t, l): (t, l) for t, l in _INDICES}
        ipo_fut = ex.submit(_fetch_recent_ipos)

        ordered_results: dict[tuple, str] = {}
        for fut, key in index_futs.items():
            try:
                ordered_results[key] = fut.result(timeout=10)
            except Exception:
                ordered_results[key] = f"  {key[1]}: N/D"

        try:
            ipo_section = ipo_fut.result(timeout=8)
        except Exception:
            ipo_section = ""

    lines = [
        "---",
        f"[CONTEXTO GLOBAL DE MERCADO — actualizado {now.strftime('%d/%m/%Y %H:%M')}]",
        "",
        "**Fecha y hora actual del servidor:** " + now.strftime("%A %d de %B de %Y, %H:%M"),
        "",
        "**Mercados principales (tiempo real):**",
    ]
    for key in _INDICES:
        lines.append(ordered_results[key])

    if ipo_section:
        lines.append("")
        lines.append(ipo_section)

    lines.append("")
    lines.append(
        "*Usa estos datos como contexto actualizado. Para empresas específicas mencionadas en "
        "la conversación, se inyecta su contexto detallado de forma separada.*"
    )
    lines.append("---")

    result = "\n".join(lines)
    _global_cache[cache_key] = (result, time.time())
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


# ── Financial statement helpers ───────────────────────────────────────────

def _safe_val(df, keys: list[str], col: int = 0):
    """Extract a float from a yfinance DataFrame, trying multiple key names."""
    if df is None or df.empty or df.shape[1] <= col:
        return None
    for key in keys:
        if key in df.index:
            try:
                v = float(df.iloc[:, col].loc[key])
                return None if math.isnan(v) or math.isinf(v) else v
            except Exception:
                pass
    return None


def _yoy(curr, prev) -> str:
    if curr is not None and prev:
        return f"{(curr - prev) / abs(prev) * 100:+.1f}%"
    return "—"


def _margin(num, denom) -> str:
    if num is not None and denom:
        return f"{num / denom * 100:.1f}%"
    return "—"


def _eps_fmt(v) -> str:
    return f"${v:.2f}" if v is not None else "N/D"


def _col_year(df, col: int) -> str:
    try:
        return str(df.columns[col])[:4]
    except Exception:
        return "—"


def _build_company_context(ticker: str) -> str:
    try:
        # Fetch all 5 data sources in parallel — each uses its own Ticker instance
        # NOTE: never use `or None` on a DataFrame — bool(df) raises ValueError
        def _fetch(attr: str):
            try:
                return getattr(yf.Ticker(ticker), attr)
            except Exception:
                return None

        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
            f_info = ex.submit(_fetch, "info")
            f_fin  = ex.submit(_fetch, "financials")
            f_bs   = ex.submit(_fetch, "balance_sheet")
            f_cf   = ex.submit(_fetch, "cashflow")
            f_news = ex.submit(_fetch, "news")

            info     = {}; fin = None; bs = None; cf = None; raw_news = []
            try:
                result = f_info.result(timeout=15)
                info = result if isinstance(result, dict) else {}
            except Exception: pass
            try: fin      = f_fin.result(timeout=15)
            except Exception: pass
            try: bs       = f_bs.result(timeout=15)
            except Exception: pass
            try: cf       = f_cf.result(timeout=15)
            except Exception: pass
            try:
                result = f_news.result(timeout=15)
                raw_news = result if isinstance(result, list) else []
            except Exception: pass

        name = info.get("longName") or info.get("shortName") or ticker
        lines: list[str] = [f"\n### 📊 DATOS EN TIEMPO REAL — {name} ({ticker})"]

        # ── Price ──
        price      = info.get("currentPrice") or info.get("regularMarketPrice")
        prev_close = info.get("previousClose")
        wk52_hi    = info.get("fiftyTwoWeekHigh")
        wk52_lo    = info.get("fiftyTwoWeekLow")

        if price:
            lines.append(f"**Precio actual:** ${price:.2f}")
        if price and prev_close:
            chg = (price - prev_close) / prev_close * 100
            lines.append(f"**Cambio hoy:** {'⬆' if chg >= 0 else '⬇'} {chg:+.2f}%")
        if price and wk52_hi:
            from_hi = (price - wk52_hi) / wk52_hi * 100
            rng = f"${wk52_lo:.2f} – ${wk52_hi:.2f}" if wk52_lo else f"máx ${wk52_hi:.2f}"
            lines.append(f"**Rango 52 sem:** {rng} | vs máximo: {from_hi:+.1f}%")

        # ── Valuación rápida (from info) ──
        mkt_cap = info.get("marketCap")
        pe      = info.get("trailingPE")
        fwd_pe  = info.get("forwardPE")
        ps      = info.get("priceToSalesTrailing12Months")
        peg     = info.get("pegRatio")
        roe     = info.get("returnOnEquity")
        roa     = info.get("returnOnAssets")
        de      = info.get("debtToEquity")
        rev_g   = info.get("revenueGrowth")
        earn_g  = info.get("earningsGrowth")
        gm      = info.get("grossMargins")
        om      = info.get("operatingMargins")
        pm      = info.get("profitMargins")
        fcf_inf = info.get("freeCashflow")
        cash_inf= info.get("totalCash")

        lines.append("\n**Valuación y métricas clave:**")
        lines.append(f"- Market cap: {_fmt_num(mkt_cap)}")
        lines.append(f"- P/E: {f'{pe:.1f}' if pe else 'N/D'} | P/E fwd: {f'{fwd_pe:.1f}' if fwd_pe else 'N/D'} | P/S: {f'{ps:.1f}' if ps else 'N/D'} | PEG: {f'{peg:.1f}' if peg else 'N/D'}")
        lines.append(f"- ROE: {_fmt_pct(roe)} | ROA: {_fmt_pct(roa)} | D/E: {f'{de:.1f}' if de else 'N/D'}")
        lines.append(f"- Crecimiento ingresos YoY: {_fmt_pct(rev_g)} | Ganancias YoY: {_fmt_pct(earn_g)}")
        lines.append(f"- Márgenes: Bruto {_fmt_pct(gm)} | Operativo {_fmt_pct(om)} | Neto {_fmt_pct(pm)}")
        lines.append(f"- FCF: {_fmt_num(fcf_inf)} | Efectivo en caja: {_fmt_num(cash_inf)}")

        # ── Income Statement (from financials DataFrame) ──
        if fin is not None and not fin.empty and fin.shape[1] >= 1:
            y0 = _col_year(fin, 0)
            y1 = _col_year(fin, 1) if fin.shape[1] > 1 else "Anterior"

            rev_c  = _safe_val(fin, ["Total Revenue", "TotalRevenue"])
            rev_p  = _safe_val(fin, ["Total Revenue", "TotalRevenue"], 1)
            gp_c   = _safe_val(fin, ["Gross Profit", "GrossProfit"])
            gp_p   = _safe_val(fin, ["Gross Profit", "GrossProfit"], 1)
            ebitda_c = _safe_val(fin, ["EBITDA", "Ebitda"])
            ebitda_p = _safe_val(fin, ["EBITDA", "Ebitda"], 1)
            ebit_c = _safe_val(fin, ["EBIT", "Operating Income", "OperatingIncome", "Ebit"])
            ebit_p = _safe_val(fin, ["EBIT", "Operating Income", "OperatingIncome", "Ebit"], 1)
            ni_c   = _safe_val(fin, ["Net Income", "NetIncome", "Net Income Common Stockholders"])
            ni_p   = _safe_val(fin, ["Net Income", "NetIncome", "Net Income Common Stockholders"], 1)
            eps_c  = _safe_val(fin, ["Diluted EPS", "DilutedEPS", "Basic EPS", "BasicEPS"])
            eps_p  = _safe_val(fin, ["Diluted EPS", "DilutedEPS", "Basic EPS", "BasicEPS"], 1)

            lines.append(f"\n**📊 Estado de Resultados — {y0} vs {y1}:**")
            lines.append(f"| Métrica | {y0} | {y1} | Var. YoY |")
            lines.append("|---|---|---|---|")
            lines.append(f"| Ingresos | {_fmt_num(rev_c)} | {_fmt_num(rev_p)} | {_yoy(rev_c, rev_p)} |")
            lines.append(f"| Utilidad bruta | {_fmt_num(gp_c)} | {_fmt_num(gp_p)} | {_yoy(gp_c, gp_p)} |")
            lines.append(f"| Margen bruto | {_margin(gp_c, rev_c)} | {_margin(gp_p, rev_p)} | — |")
            lines.append(f"| EBITDA | {_fmt_num(ebitda_c)} | {_fmt_num(ebitda_p)} | {_yoy(ebitda_c, ebitda_p)} |")
            lines.append(f"| EBIT | {_fmt_num(ebit_c)} | {_fmt_num(ebit_p)} | {_yoy(ebit_c, ebit_p)} |")
            lines.append(f"| Utilidad neta | {_fmt_num(ni_c)} | {_fmt_num(ni_p)} | {_yoy(ni_c, ni_p)} |")
            lines.append(f"| Margen neto | {_margin(ni_c, rev_c)} | {_margin(ni_p, rev_p)} | — |")
            if eps_c is not None or eps_p is not None:
                lines.append(f"| EPS (diluido) | {_eps_fmt(eps_c)} | {_eps_fmt(eps_p)} | {_yoy(eps_c, eps_p)} |")

        # ── Balance Sheet ──
        if bs is not None and not bs.empty:
            cash_bs = _safe_val(bs, ["Cash And Cash Equivalents", "CashAndCashEquivalents",
                                     "Cash Cash Equivalents And Short Term Investments", "Cash"])
            assets  = _safe_val(bs, ["Total Assets", "TotalAssets"])
            debt    = _safe_val(bs, ["Total Debt", "TotalDebt", "Long Term Debt", "LongTermDebt"])
            net_dbt = _safe_val(bs, ["Net Debt", "NetDebt"])
            equity  = _safe_val(bs, ["Stockholders Equity", "StockholdersEquity",
                                     "Common Stock Equity", "CommonStockEquity"])

            lines.append("\n**🏦 Balance General (último período):**")
            lines.append(f"- Efectivo y equiv.: {_fmt_num(cash_bs)}")
            lines.append(f"- Activos totales: {_fmt_num(assets)}")
            lines.append(f"- Deuda total: {_fmt_num(debt)}")
            lines.append(f"- Deuda neta: {_fmt_num(net_dbt)}")
            lines.append(f"- Patrimonio neto: {_fmt_num(equity)}")

        # ── Cash Flow ──
        if cf is not None and not cf.empty:
            fco   = _safe_val(cf, ["Operating Cash Flow", "OperatingCashFlow",
                                   "Total Cash From Operating Activities"])
            capex = _safe_val(cf, ["Capital Expenditure", "CapitalExpenditure",
                                   "Purchase Of PPE", "Capital Expenditures"])
            fcf_cf = _safe_val(cf, ["Free Cash Flow", "FreeCashFlow"])
            if fcf_cf is None and fco is not None and capex is not None:
                fcf_cf = fco + capex  # capex is typically negative
            buyback = _safe_val(cf, ["Repurchase Of Capital Stock", "RepurchaseOfCapitalStock",
                                     "Common Stock Repurchased"])
            divs    = _safe_val(cf, ["Cash Dividends Paid", "CashDividendsPaid",
                                     "Payment Of Dividends", "Dividends Paid"])

            lines.append("\n**💵 Flujo de Caja (TTM/Anual):**")
            lines.append(f"- FCO (Operaciones): {_fmt_num(fco)}")
            lines.append(f"- Capex: {_fmt_num(capex)}")
            lines.append(f"- Free Cash Flow: {_fmt_num(fcf_cf)}")
            if buyback is not None:
                lines.append(f"- Recompra de acciones: {_fmt_num(buyback)}")
            if divs is not None:
                lines.append(f"- Dividendos pagados: {_fmt_num(divs)}")

        # ── Analyst consensus ──
        target     = info.get("targetMeanPrice")
        recom      = info.get("recommendationKey", "").replace("_", " ").upper()
        n_analysts = info.get("numberOfAnalystOpinions")
        if target or recom:
            lines.append("\n**Consenso analistas:**")
            if recom:
                lines.append(f"- Recomendación: {recom} ({n_analysts or '?'} analistas)")
            if target and price:
                upside = (target - price) / price * 100
                lines.append(f"- Precio objetivo promedio: ${target:.2f} ({upside:+.1f}% vs precio actual)")

        # ── Recent news ──
        news_items = (raw_news or [])[:6]
        if news_items:
            lines.append("\n**Noticias recientes:**")
            for art in news_items:
                title = art.get("title", "")
                pub   = art.get("publisher", "")
                ts    = art.get("providerPublishTime", 0)
                dt    = datetime.fromtimestamp(ts).strftime("%d/%m/%Y") if ts else "?"
                lines.append(f"- [{dt}] {title} — *{pub}*")

        lines.append(
            "\n*Fuente: Yahoo Finance (tiempo real). Estados financieros extraídos directamente.*"
        )
        return "\n".join(lines)

    except Exception as e:
        return f"\n[No se pudo obtener datos para {ticker}: {e}]"


def get_company_context(ticker: str) -> str:
    return _cached(ticker, _build_company_context)


def get_market_context_for_message(message: str) -> str:
    """Detect companies in a message and return their real-time context block. Fetches in parallel."""
    tickers = detect_tickers(message)
    if not tickers:
        return ""
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(tickers)) as ex:
        futs = {ex.submit(get_company_context, t): t for t in tickers}
        blocks = []
        for fut in concurrent.futures.as_completed(futs, timeout=15):
            try:
                blocks.append(fut.result())
            except Exception:
                pass
    if not blocks:
        return ""
    header = "\n---\n[CONTEXTO DE MERCADO ACTUALIZADO — extraído de Yahoo Finance ahora mismo]\n"
    return header + "\n".join(blocks) + "\n---"
