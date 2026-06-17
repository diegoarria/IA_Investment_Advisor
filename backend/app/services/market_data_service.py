import re
import time
import math
import concurrent.futures
import requests
import yfinance as yf
from datetime import datetime, timedelta
from app.core.cache import cache_get, cache_set

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

CACHE_TTL        = 600   # 10 minutes — fresher financial data
GLOBAL_CACHE_TTL = 900   # 15 minutes


def _cached(ticker: str, builder) -> str:
    ck = f"mds:company:{ticker}"
    cached = cache_get(ck)
    if cached:
        return cached
    result = builder(ticker)
    cache_set(ck, result, ttl=CACHE_TTL)
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
    cached_global = cache_get("mds:global_market")
    if cached_global:
        return cached_global

    now = datetime.now()

    # Check for a stale fallback before making any network calls
    stale = cache_get("mds:global_market_stale")

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(_INDICES) + 1) as ex:
            index_futs = {ex.submit(_get_index_summary, t, l): (t, l) for t, l in _INDICES}
            ipo_fut = ex.submit(_fetch_recent_ipos)

            ordered_results: dict[tuple, str] = {}
            all_nd = True
            for fut, key in index_futs.items():
                try:
                    val = fut.result(timeout=6)
                    ordered_results[key] = val
                    if "N/D" not in val:
                        all_nd = False
                except Exception:
                    ordered_results[key] = f"  {key[1]}: N/D"

            try:
                ipo_section = ipo_fut.result(timeout=6)
            except Exception:
                ipo_section = ""

        # If Yahoo Finance rate-limited everything, return stale cache to avoid hammering
        if all_nd and stale:
            return stale
    except Exception:
        if stale:
            return stale
        ordered_results = {(t, l): f"  {l}: N/D" for t, l in _INDICES}
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
    cache_set("mds:global_market", result, ttl=GLOBAL_CACHE_TTL)
    cache_set("mds:global_market_stale", result, ttl=7200)  # 2h fallback when YF is rate-limited
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


def _ttm_val(df, keys: list[str]) -> float | None:
    """Sum of the 4 most recent quarterly periods (Trailing Twelve Months)."""
    if df is None or df.empty:
        return None
    for key in keys:
        if key in df.index:
            try:
                n = min(4, df.shape[1])
                vals = [float(df.iloc[:, i].loc[key]) for i in range(n)]
                valid = [v for v in vals if not (math.isnan(v) or math.isinf(v))]
                return sum(valid) if valid else None
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


def _col_label(df, col: int) -> str:
    """Format column as 'Mar 2026' for quarterly or '2025' for annual."""
    try:
        ts = df.columns[col]
        if hasattr(ts, 'strftime'):
            return ts.strftime("%b %Y")
        s = str(ts)[:10]
        from datetime import datetime as _dt
        return _dt.fromisoformat(s).strftime("%b %Y")
    except Exception:
        try:
            return str(df.columns[col])[:7]
        except Exception:
            return "—"


def _build_company_context(ticker: str) -> str:
    try:
        from app.services.sec_edgar_service import get_sec_financials

        # Fetch 9 sources in parallel:
        # yfinance: info, quarterly & annual financials/bs/cf, news
        # SEC EDGAR: authoritative 10-Q/10-K financial statements
        # NOTE: never use `or None` on a DataFrame — bool(df) raises ValueError
        def _fetch(attr: str):
            try:
                return getattr(yf.Ticker(ticker), attr)
            except Exception:
                return None

        with concurrent.futures.ThreadPoolExecutor(max_workers=9) as ex:
            f_info  = ex.submit(_fetch, "info")
            f_qfin  = ex.submit(_fetch, "quarterly_financials")
            f_qbs   = ex.submit(_fetch, "quarterly_balance_sheet")
            f_qcf   = ex.submit(_fetch, "quarterly_cashflow")
            f_fin   = ex.submit(_fetch, "financials")       # annual fallback
            f_bs    = ex.submit(_fetch, "balance_sheet")    # annual fallback
            f_cf    = ex.submit(_fetch, "cashflow")         # annual fallback
            f_news  = ex.submit(_fetch, "news")
            f_sec   = ex.submit(get_sec_financials, ticker)  # SEC EDGAR XBRL

            info = {}; qfin = qbs = qcf = fin = bs = cf = None
            raw_news = []; sec_block = ""
            try:
                r = f_info.result(timeout=15)
                info = r if isinstance(r, dict) else {}
            except Exception: pass
            try: qfin = f_qfin.result(timeout=15)
            except Exception: pass
            try: qbs  = f_qbs.result(timeout=15)
            except Exception: pass
            try: qcf  = f_qcf.result(timeout=15)
            except Exception: pass
            try: fin  = f_fin.result(timeout=15)
            except Exception: pass
            try: bs   = f_bs.result(timeout=15)
            except Exception: pass
            try: cf   = f_cf.result(timeout=15)
            except Exception: pass
            try:
                r = f_news.result(timeout=15)
                raw_news = r if isinstance(r, list) else []
            except Exception: pass
            try:
                r = f_sec.result(timeout=20)
                sec_block = r if isinstance(r, str) else ""
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
        mkt_cap  = info.get("marketCap")
        pe       = info.get("trailingPE")
        fwd_pe   = info.get("forwardPE")
        ps       = info.get("priceToSalesTrailing12Months")
        peg      = info.get("pegRatio")
        roe      = info.get("returnOnEquity")
        roa      = info.get("returnOnAssets")
        de       = info.get("debtToEquity")
        rev_g    = info.get("revenueGrowth")
        earn_g   = info.get("earningsGrowth")
        gm       = info.get("grossMargins")
        om       = info.get("operatingMargins")
        pm       = info.get("profitMargins")
        fcf_inf  = info.get("freeCashflow")
        cash_inf = info.get("totalCash")

        lines.append("\n**Valuación y métricas clave:**")
        lines.append(f"- Market cap: {_fmt_num(mkt_cap)}")
        lines.append(f"- P/E: {f'{pe:.1f}' if pe else 'N/D'} | P/E fwd: {f'{fwd_pe:.1f}' if fwd_pe else 'N/D'} | P/S: {f'{ps:.1f}' if ps else 'N/D'} | PEG: {f'{peg:.1f}' if peg else 'N/D'}")
        lines.append(f"- ROE: {_fmt_pct(roe)} | ROA: {_fmt_pct(roa)} | D/E: {f'{de:.1f}' if de else 'N/D'}")
        lines.append(f"- Crecimiento ingresos YoY: {_fmt_pct(rev_g)} | Ganancias YoY: {_fmt_pct(earn_g)}")
        lines.append(f"- Márgenes: Bruto {_fmt_pct(gm)} | Operativo {_fmt_pct(om)} | Neto {_fmt_pct(pm)}")
        lines.append(f"- FCF (TTM, info): {_fmt_num(fcf_inf)} | Efectivo: {_fmt_num(cash_inf)}")

        # ── Income Statement — quarterly (most recent Q vs same Q last year) ──
        fin_src = qfin if (qfin is not None and not qfin.empty) else fin
        is_quarterly = fin_src is qfin and fin_src is not None
        if fin_src is not None and not fin_src.empty and fin_src.shape[1] >= 1:
            # For YoY: col 0 = most recent, col 4 = same quarter last year (if quarterly)
            #          or col 1 = previous year (if annual)
            yoy_col = 4 if (is_quarterly and fin_src.shape[1] >= 5) else 1
            has_prev = fin_src.shape[1] > yoy_col

            lbl0 = _col_label(fin_src, 0)
            lbl1 = _col_label(fin_src, yoy_col) if has_prev else "Anterior"
            period_note = "(trimestral, YoY)" if is_quarterly else "(anual)"

            REV  = ["Total Revenue", "TotalRevenue"]
            GP   = ["Gross Profit", "GrossProfit"]
            EBD  = ["EBITDA", "Ebitda"]
            EBT  = ["EBIT", "Operating Income", "OperatingIncome", "Ebit"]
            NI   = ["Net Income", "NetIncome", "Net Income Common Stockholders"]
            EPS  = ["Diluted EPS", "DilutedEPS", "Basic EPS", "BasicEPS"]

            rev_c = _safe_val(fin_src, REV, 0);   rev_p = _safe_val(fin_src, REV, yoy_col) if has_prev else None
            gp_c  = _safe_val(fin_src, GP, 0);    gp_p  = _safe_val(fin_src, GP, yoy_col)  if has_prev else None
            eb_c  = _safe_val(fin_src, EBD, 0);   eb_p  = _safe_val(fin_src, EBD, yoy_col) if has_prev else None
            et_c  = _safe_val(fin_src, EBT, 0);   et_p  = _safe_val(fin_src, EBT, yoy_col) if has_prev else None
            ni_c  = _safe_val(fin_src, NI, 0);    ni_p  = _safe_val(fin_src, NI, yoy_col)  if has_prev else None
            eps_c = _safe_val(fin_src, EPS, 0);   eps_p = _safe_val(fin_src, EPS, yoy_col) if has_prev else None

            # TTM from quarterly data
            rev_ttm = _ttm_val(qfin, REV) if qfin is not None and not qfin.empty else None
            ni_ttm  = _ttm_val(qfin, NI)  if qfin is not None and not qfin.empty else None

            lines.append(f"\n**📊 Estado de Resultados {period_note} — {lbl0} vs {lbl1}:**")
            if rev_ttm is not None:
                lines.append(f"*(TTM = {_fmt_num(rev_ttm)} ingresos | {_fmt_num(ni_ttm)} utilidad neta)*")
            lines.append(f"| Métrica | {lbl0} | {lbl1} | Var. YoY |")
            lines.append("|---|---|---|---|")
            lines.append(f"| Ingresos | {_fmt_num(rev_c)} | {_fmt_num(rev_p)} | {_yoy(rev_c, rev_p)} |")
            lines.append(f"| Utilidad bruta | {_fmt_num(gp_c)} | {_fmt_num(gp_p)} | {_yoy(gp_c, gp_p)} |")
            lines.append(f"| Margen bruto | {_margin(gp_c, rev_c)} | {_margin(gp_p, rev_p)} | — |")
            lines.append(f"| EBITDA | {_fmt_num(eb_c)} | {_fmt_num(eb_p)} | {_yoy(eb_c, eb_p)} |")
            lines.append(f"| EBIT | {_fmt_num(et_c)} | {_fmt_num(et_p)} | {_yoy(et_c, et_p)} |")
            lines.append(f"| Utilidad neta | {_fmt_num(ni_c)} | {_fmt_num(ni_p)} | {_yoy(ni_c, ni_p)} |")
            lines.append(f"| Margen neto | {_margin(ni_c, rev_c)} | {_margin(ni_p, rev_p)} | — |")
            if eps_c is not None or eps_p is not None:
                lines.append(f"| EPS (diluido) | {_eps_fmt(eps_c)} | {_eps_fmt(eps_p)} | {_yoy(eps_c, eps_p)} |")

        # ── Balance Sheet — most recent quarter ──
        bs_src = qbs if (qbs is not None and not qbs.empty) else bs
        if bs_src is not None and not bs_src.empty:
            bs_lbl = _col_label(bs_src, 0)
            CASH = ["Cash And Cash Equivalents", "CashAndCashEquivalents",
                    "Cash Cash Equivalents And Short Term Investments", "Cash"]
            cash_v  = _safe_val(bs_src, CASH)
            assets  = _safe_val(bs_src, ["Total Assets", "TotalAssets"])
            debt    = _safe_val(bs_src, ["Total Debt", "TotalDebt", "Long Term Debt", "LongTermDebt"])
            net_dbt = _safe_val(bs_src, ["Net Debt", "NetDebt"])
            equity  = _safe_val(bs_src, ["Stockholders Equity", "StockholdersEquity",
                                         "Common Stock Equity", "CommonStockEquity"])

            lines.append(f"\n**🏦 Balance General ({bs_lbl}):**")
            lines.append(f"- Efectivo y equiv.: {_fmt_num(cash_v)}")
            lines.append(f"- Activos totales: {_fmt_num(assets)}")
            lines.append(f"- Deuda total: {_fmt_num(debt)}")
            lines.append(f"- Deuda neta: {_fmt_num(net_dbt)}")
            lines.append(f"- Patrimonio neto: {_fmt_num(equity)}")

        # ── Cash Flow — TTM from quarterly ──
        cf_src = qcf if (qcf is not None and not qcf.empty) else cf
        if cf_src is not None and not cf_src.empty:
            FCO  = ["Operating Cash Flow", "OperatingCashFlow",
                    "Total Cash From Operating Activities"]
            CAPX = ["Capital Expenditure", "CapitalExpenditure",
                    "Purchase Of PPE", "Capital Expenditures"]
            FCF  = ["Free Cash Flow", "FreeCashFlow"]
            BUY  = ["Repurchase Of Capital Stock", "RepurchaseOfCapitalStock",
                    "Common Stock Repurchased"]
            DIV  = ["Cash Dividends Paid", "CashDividendsPaid",
                    "Payment Of Dividends", "Dividends Paid"]

            # TTM if quarterly, else most recent annual
            if cf_src is qcf:
                fco_v   = _ttm_val(cf_src, FCO)
                capex_v = _ttm_val(cf_src, CAPX)
                fcf_v   = _ttm_val(cf_src, FCF)
                buy_v   = _ttm_val(cf_src, BUY)
                div_v   = _ttm_val(cf_src, DIV)
                cf_note = "TTM"
            else:
                fco_v   = _safe_val(cf_src, FCO)
                capex_v = _safe_val(cf_src, CAPX)
                fcf_v   = _safe_val(cf_src, FCF)
                buy_v   = _safe_val(cf_src, BUY)
                div_v   = _safe_val(cf_src, DIV)
                cf_note = _col_label(cf_src, 0)

            if fcf_v is None and fco_v is not None and capex_v is not None:
                fcf_v = fco_v + capex_v

            lines.append(f"\n**💵 Flujo de Caja ({cf_note}):**")
            lines.append(f"- FCO (Operaciones): {_fmt_num(fco_v)}")
            lines.append(f"- Capex: {_fmt_num(capex_v)}")
            lines.append(f"- Free Cash Flow: {_fmt_num(fcf_v)}")
            if buy_v is not None: lines.append(f"- Recompra de acciones: {_fmt_num(buy_v)}")
            if div_v is not None: lines.append(f"- Dividendos pagados: {_fmt_num(div_v)}")

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

        # ── SEC EDGAR block (authoritative 10-Q/10-K financial statements) ──
        if sec_block:
            lines.append(sec_block)
        else:
            lines.append(
                "\n*Fuente: Yahoo Finance. Datos trimestrales del último reporte disponible. "
                "Se actualiza automáticamente cuando la empresa publica nuevos resultados.*"
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
