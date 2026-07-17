"""
Fundamental Analysis Service
=============================
Deterministic (non-LLM) fundamental-analysis engine for the Mentor IA
"analyze this company" chat flow (Premium only — see chat.py's
_DEEP_ANALYSIS_RE gate). Computes real multi-year financial trends, ROIC/
ROE/ROA, and a genuine two-stage DCF from Fiscal.ai's 10-year statements
(financial_data_service.get_financials) — Claude only narrates around these
numbers in the chat prompt, it never invents them. This is what lets the
"FORMATO OBLIGATORIO" scorecard show a real computed valuation instead of
LLM-guessed assumptions.
"""

from __future__ import annotations

import logging
from typing import Optional

from app.services.financial_data_service import get_financials
from app.core.finnhub import fh_quote, fh_profile

logger = logging.getLogger(__name__)

_MIN_YEARS = 3
_PROJECTION_YEARS = 10
_TERMINAL_GROWTH = 0.025
_BASE_DISCOUNT_RATE = 0.09


def _num(v) -> Optional[float]:
    if v is None:
        return None
    try:
        n = float(v)
        return n if n == n and abs(n) < 1e18 else None  # excludes NaN/overflow
    except (TypeError, ValueError):
        return None


def _cagr(first: Optional[float], last: Optional[float], years: int) -> Optional[float]:
    if first is None or last is None or first <= 0 or last <= 0 or years <= 0:
        return None
    return round(((last / first) ** (1 / years) - 1) * 100, 1)


def _score(value: Optional[float], tiers: list[tuple[float, int]]) -> Optional[int]:
    if value is None:
        return None
    for threshold, score in tiers:
        if value <= threshold:
            return score
    return tiers[-1][1]


def _project_path(base_value: float, growth_1: float, years: int = _PROJECTION_YEARS) -> list[float]:
    """Projects `base_value` forward `years` periods, with growth fading
    linearly from `growth_1` (year 1) to _TERMINAL_GROWTH by the final year —
    the same two-stage curve used by the DCF, applied to any metric
    (revenue, FCF, Owner Earnings)."""
    v = base_value
    path = []
    for yr in range(1, years + 1):
        g = growth_1 + (_TERMINAL_GROWTH - growth_1) * (yr / years)
        v *= (1 + g)
        path.append(round(v, 0))
    return path


def _run_dcf(base_fcf: float, growth_1: float, discount_rate: float) -> dict:
    """Two-stage DCF: growth fades linearly from `growth_1` (year 1) to the
    terminal growth rate by year _PROJECTION_YEARS, then a Gordon-growth
    terminal value. Returns enterprise-value components only — caller adds
    cash/debt to get equity value."""
    path = _project_path(base_fcf, growth_1)
    pv_sum = sum(cf / ((1 + discount_rate) ** yr) for yr, cf in enumerate(path, start=1))
    final_cf = path[-1]
    terminal_value = final_cf * (1 + _TERMINAL_GROWTH) / (discount_rate - _TERMINAL_GROWTH)
    pv_terminal = terminal_value / ((1 + discount_rate) ** _PROJECTION_YEARS)
    return {
        "fcf_path": path,
        "pv_of_fcf_sum": pv_sum,
        "terminal_value": terminal_value,
        "pv_of_terminal_value": pv_terminal,
        "enterprise_value": pv_sum + pv_terminal,
    }


def get_fundamental_analysis(ticker: str) -> Optional[dict]:
    """Returns a fully computed fundamental-analysis dict for `ticker`, or
    None if there isn't enough real financial data to compute one reliably
    (fewer than 3 years of statements, or no live quote)."""
    ticker = ticker.upper().strip()
    try:
        fin = get_financials(ticker, limit=10)
    except Exception as e:
        logger.warning("get_fundamental_analysis(%s): get_financials failed: %s", ticker, e)
        return None

    income   = fin.get("incomeStatement", {}).get("annual", [])
    balance  = fin.get("balanceSheet", {}).get("annual", [])
    cashflow = fin.get("cashFlow", {}).get("annual", [])
    n = min(len(income), len(balance), len(cashflow))
    if n < _MIN_YEARS:
        return None

    income, balance, cashflow = income[-n:], balance[-n:], cashflow[-n:]
    years = [str(row.get("period", ""))[:4] for row in income]

    quote   = fh_quote(ticker) or {}
    profile = fh_profile(ticker) or {}
    price = _num(quote.get("price"))
    shares_out_m = _num(profile.get("shareOutstanding"))  # Finnhub reports this in millions
    shares_out = shares_out_m * 1_000_000 if shares_out_m else None

    # ── Per-year trends: revenue, FCF, net income, margins, ROIC/ROE/ROA ──
    revenue_trend, fcf_trend, net_income_trend = [], [], []
    gross_margin_trend, operating_margin_trend, net_margin_trend = [], [], []
    roic_trend, roe_trend, roa_trend = [], [], []
    owner_earnings_trend = []
    prev_working_capital: Optional[float] = None

    for i in range(n):
        inc, bal, cf = income[i], balance[i], cashflow[i]

        rev = _num(inc.get("Total Revenue"))
        gp  = _num(inc.get("Gross Profit"))
        oi  = _num(inc.get("Operating Income"))
        ni  = _num(inc.get("Net Income"))
        revenue_trend.append(rev)
        net_income_trend.append(ni)
        gross_margin_trend.append(round(gp / rev * 100, 1) if rev and gp is not None else None)
        operating_margin_trend.append(round(oi / rev * 100, 1) if rev and oi is not None else None)
        net_margin_trend.append(round(ni / rev * 100, 1) if rev and ni is not None else None)

        ocf   = _num(cf.get("Operating Cash Flow"))
        capex = _num(cf.get("Capital Expenditure"))
        fcf_trend.append(ocf - abs(capex) if ocf is not None and capex is not None else None)

        # Owner Earnings (Buffett's definition): Net Income + D&A - CapEx -
        # Δ Working Capital. CapEx here is treated as maintenance capex (no
        # growth/maintenance split is available from any provider) — a
        # standard simplification, disclosed as such in the prompt.
        da = _num(cf.get("Depreciation And Amortization")) or _num(inc.get("Depreciation And Amortization"))
        working_capital = _num(bal.get("Working Capital"))
        delta_wc = (working_capital - prev_working_capital) if (working_capital is not None and prev_working_capital is not None) else None
        if ni is not None and da is not None and capex is not None:
            oe = ni + da - abs(capex) - (delta_wc or 0)
            owner_earnings_trend.append(round(oe, 0))
        else:
            owner_earnings_trend.append(None)
        prev_working_capital = working_capital if working_capital is not None else prev_working_capital

        pretax  = _num(inc.get("Pretax Income"))
        tax     = _num(inc.get("Tax Provision"))
        equity  = _num(bal.get("Stockholders Equity"))
        assets  = _num(bal.get("Total Assets"))
        lt_debt = _num(bal.get("Long Term Debt")) or 0
        st_debt = _num(bal.get("Short Term Debt")) or 0
        cash    = _num(bal.get("Cash And Short Term Investments")) or _num(bal.get("Cash And Cash Equivalents")) or 0

        if pretax and pretax > 0 and tax is not None and tax >= 0:
            tax_rate = min(max(tax / pretax, 0.0), 0.40)
        else:
            tax_rate = 0.21  # US statutory-ish fallback when pretax/tax data is missing
        if oi is not None and equity is not None:
            nopat = oi * (1 - tax_rate)
            inv_cap = equity + lt_debt + st_debt - cash
            roic_trend.append(round(nopat / inv_cap * 100, 1) if inv_cap > 0 else None)
        else:
            roic_trend.append(None)
        roe_trend.append(round(ni / equity * 100, 1) if ni is not None and equity else None)
        roa_trend.append(round(ni / assets * 100, 1) if ni is not None and assets else None)

    rev_valid = [v for v in revenue_trend if v is not None]
    fcf_valid = [v for v in fcf_trend if v is not None]
    ni_valid  = [v for v in net_income_trend if v is not None]
    rev_cagr = _cagr(rev_valid[0], rev_valid[-1], len(rev_valid) - 1) if len(rev_valid) >= 2 else None
    fcf_cagr = _cagr(fcf_valid[0], fcf_valid[-1], len(fcf_valid) - 1) if len(fcf_valid) >= 2 else None
    ni_cagr  = _cagr(ni_valid[0], ni_valid[-1], len(ni_valid) - 1) if len(ni_valid) >= 2 else None

    latest_bal  = balance[-1]
    total_debt  = (_num(latest_bal.get("Long Term Debt")) or 0) + (_num(latest_bal.get("Short Term Debt")) or 0)
    cash_latest = _num(latest_bal.get("Cash And Short Term Investments")) or _num(latest_bal.get("Cash And Cash Equivalents")) or 0
    net_cash    = cash_latest - total_debt

    # ── Deterministic 2-stage DCF, 3 scenarios (pessimistic/base/optimistic) ──
    # Each scenario also projects revenue forward 10 years (same fading-
    # growth curve as the DCF's FCF projection) so section 14's "conservador/
    # base/optimista" projections are real computed numbers, not LLM guesses.
    dcf = None
    latest_rev = rev_valid[-1] if rev_valid else None
    if fcf_valid and fcf_valid[-1] and fcf_valid[-1] > 0 and shares_out and price:
        base_fcf = fcf_valid[-1]
        g1_fcf_base = fcf_cagr / 100 if fcf_cagr is not None else 0.08
        g1_fcf_base = max(min(g1_fcf_base, 0.20), 0.0)  # clamp so one freak year can't blow up the projection
        g1_rev_base = rev_cagr / 100 if rev_cagr is not None else 0.08
        g1_rev_base = max(min(g1_rev_base, 0.25), 0.0)

        scenarios = {}
        for name, mult, dr in [
            ("pessimistic", 0.5, _BASE_DISCOUNT_RATE + 0.015),
            ("base",        1.0, _BASE_DISCOUNT_RATE),
            ("optimistic",  1.3, _BASE_DISCOUNT_RATE - 0.01),
        ]:
            g1_fcf = max(min(g1_fcf_base * mult, 0.25), 0.0)
            dcf_result = _run_dcf(base_fcf, g1_fcf, dr)
            ev = dcf_result["enterprise_value"]
            equity_value = ev - total_debt + cash_latest
            intrinsic_per_share = equity_value / shares_out

            scenario = {
                "stage1_growth_pct": round(g1_fcf * 100, 1),
                "discount_rate_pct": round(dr * 100, 1),
                "intrinsic_value_per_share": round(intrinsic_per_share, 2),
                "fcf_year1": dcf_result["fcf_path"][0],
                "fcf_year5": dcf_result["fcf_path"][4],
                "fcf_year10": dcf_result["fcf_path"][9],
            }
            if latest_rev:
                g1_rev = max(min(g1_rev_base * mult, 0.30), 0.0)
                rev_path = _project_path(latest_rev, g1_rev)
                scenario.update({
                    "revenue_growth_pct": round(g1_rev * 100, 1),
                    "revenue_year1": rev_path[0],
                    "revenue_year5": rev_path[4],
                    "revenue_year10": rev_path[9],
                })
            scenarios[name] = scenario

        base_scenario = scenarios["base"]
        margin_of_safety = round(
            (base_scenario["intrinsic_value_per_share"] - price) / base_scenario["intrinsic_value_per_share"] * 100, 1
        )
        dcf = {
            "base_fcf": round(base_fcf, 0),
            "base_revenue": round(latest_rev, 0) if latest_rev else None,
            "terminal_growth_pct": round(_TERMINAL_GROWTH * 100, 1),
            "projection_years": _PROJECTION_YEARS,
            "total_debt": round(total_debt, 0),
            "cash": round(cash_latest, 0),
            "shares_outstanding": round(shares_out, 0),
            "current_price": price,
            "scenarios": scenarios,
            "margin_of_safety_pct": margin_of_safety,
        }

    # ── Quality score (0-10, matches the "Calidad del negocio: X.X/10" format) ──
    latest_roic = next((v for v in reversed(roic_trend) if v is not None), None)
    latest_om   = next((v for v in reversed(operating_margin_trend) if v is not None), None)

    roic_score   = _score(latest_roic, [(4, 20), (7, 40), (10, 55), (15, 70), (20, 85), (999, 95)])
    margin_score = _score(latest_om,   [(0, 10), (10, 35), (15, 55), (20, 70), (30, 85), (999, 95)])
    growth_score = _score(rev_cagr,    [(0, 15), (5, 40), (10, 60), (15, 75), (20, 88), (999, 95)])
    if cash_latest > 0:
        debt_score = _score(total_debt / cash_latest, [(0.5, 90), (1, 75), (2, 55), (4, 35), (999, 15)])
    else:
        debt_score = 90 if net_cash >= 0 else 20

    comp_scores = [s for s in [roic_score, margin_score, growth_score, debt_score] if s is not None]
    quality_score_100 = round(sum(comp_scores) / len(comp_scores)) if comp_scores else None
    quality_score_10 = round(quality_score_100 / 10, 1) if quality_score_100 is not None else None

    return {
        "ticker": ticker,
        "company_name": profile.get("name", ticker),
        "sector": profile.get("finnhubIndustry"),
        "years": years,
        "current_price": price,
        "revenue_trend": revenue_trend,
        "net_income_trend": net_income_trend,
        "fcf_trend": fcf_trend,
        "owner_earnings_trend": owner_earnings_trend,
        "gross_margin_trend": gross_margin_trend,
        "operating_margin_trend": operating_margin_trend,
        "net_margin_trend": net_margin_trend,
        "roic_trend": roic_trend,
        "roe_trend": roe_trend,
        "roa_trend": roa_trend,
        "revenue_cagr_pct": rev_cagr,
        "fcf_cagr_pct": fcf_cagr,
        "net_income_cagr_pct": ni_cagr,
        "total_debt": round(total_debt, 0),
        "cash": round(cash_latest, 0),
        "net_cash": round(net_cash, 0),
        "dcf": dcf,
        "quality_score_10": quality_score_10,
        "data_years_available": n,
        "data_source": fin.get("provider"),
    }


def _fmt_money(v: Optional[float]) -> str:
    if v is None:
        return "N/D"
    a = abs(v)
    sign = "-" if v < 0 else ""
    if a >= 1e9:
        return f"{sign}${a / 1e9:.2f}B"
    if a >= 1e6:
        return f"{sign}${a / 1e6:.1f}M"
    return f"{sign}${a:,.0f}"


def _fmt_trend(years: list[str], values: list[Optional[float]], suffix: str = "") -> str:
    pairs = [f"{y}: {v}{suffix}" for y, v in zip(years, values) if v is not None]
    return ", ".join(pairs) if pairs else "N/D"


def format_fundamental_analysis_for_prompt(data: dict) -> str:
    """Renders the computed dict as a compact text block for injection into
    the chat system context. Every number here is REAL and COMPUTED — the
    prompt instructs Claude to present these as-is, not re-estimate them."""
    years = data["years"]
    lines = [
        f"[ANÁLISIS FUNDAMENTAL CALCULADO — DATOS REALES, NO ESTIMACIONES DEL MODELO]",
        f"Empresa: {data['company_name']} ({data['ticker']}) — Sector: {data.get('sector') or 'N/D'}",
        f"Precio actual: ${data['current_price']}" if data.get("current_price") else "Precio actual: N/D",
        f"Años con datos reales disponibles: {data['data_years_available']} (fuente: {data.get('data_source', 'N/D')})",
        "",
        f"Ingresos por año ($): {_fmt_trend(years, [_fmt_money(v) if v is not None else None for v in data['revenue_trend']])}",
        f"Ingresos CAGR ({data['data_years_available']}a): {data['revenue_cagr_pct']}%" if data["revenue_cagr_pct"] is not None else "Ingresos CAGR: N/D",
        f"FCF por año ($): {_fmt_trend(years, [_fmt_money(v) if v is not None else None for v in data['fcf_trend']])}",
        f"FCF CAGR: {data['fcf_cagr_pct']}%" if data["fcf_cagr_pct"] is not None else "FCF CAGR: N/D",
        f"Utilidad neta CAGR: {data['net_income_cagr_pct']}%" if data["net_income_cagr_pct"] is not None else "Utilidad neta CAGR: N/D",
        f"Owner Earnings por año ($) [Beneficio Neto + D&A - CapEx - ΔCapital de Trabajo]: {_fmt_trend(years, [_fmt_money(v) if v is not None else None for v in data['owner_earnings_trend']])}",
        "",
        f"Margen bruto por año: {_fmt_trend(years, data['gross_margin_trend'], '%')}",
        f"Margen operativo por año: {_fmt_trend(years, data['operating_margin_trend'], '%')}",
        f"Margen neto por año: {_fmt_trend(years, data['net_margin_trend'], '%')}",
        "",
        f"ROIC por año: {_fmt_trend(years, data['roic_trend'], '%')}",
        f"ROE por año: {_fmt_trend(years, data['roe_trend'], '%')}",
        f"ROA por año: {_fmt_trend(years, data['roa_trend'], '%')}",
        "",
        f"Deuda total: {_fmt_money(data['total_debt'])} | Caja: {_fmt_money(data['cash'])} | Caja neta: {_fmt_money(data['net_cash'])}",
        f"Puntuación de calidad calculada: {data['quality_score_10']}/10" if data["quality_score_10"] is not None else "Puntuación de calidad: N/D",
    ]

    dcf = data.get("dcf")
    if dcf:
        lines.append("")
        lines.append(
            f"DCF calculado (2 etapas, {dcf['projection_years']} años, FCF base {_fmt_money(dcf['base_fcf'])}, "
            f"crecimiento terminal {dcf['terminal_growth_pct']}%, deuda {_fmt_money(dcf['total_debt'])}, "
            f"caja {_fmt_money(dcf['cash'])}, acciones en circulación {dcf['shares_outstanding']:,.0f}):"
        )
        for name, label in [("pessimistic", "Pesimista"), ("base", "Base"), ("optimistic", "Optimista")]:
            s = dcf["scenarios"][name]
            lines.append(
                f"  - {label}: crecimiento FCF año 1 {s['stage1_growth_pct']}%, tasa de descuento {s['discount_rate_pct']}% "
                f"→ valor intrínseco/acción ${s['intrinsic_value_per_share']}"
            )
            if "revenue_year1" in s:
                lines.append(
                    f"      Proyección de ingresos ({label.lower()}, crecimiento {s['revenue_growth_pct']}%→"
                    f"{dcf['terminal_growth_pct']}%): año 1 {_fmt_money(s['revenue_year1'])}, "
                    f"año 5 {_fmt_money(s['revenue_year5'])}, año 10 {_fmt_money(s['revenue_year10'])}"
                )
                lines.append(
                    f"      Proyección de FCF ({label.lower()}): año 1 {_fmt_money(s['fcf_year1'])}, "
                    f"año 5 {_fmt_money(s['fcf_year5'])}, año 10 {_fmt_money(s['fcf_year10'])}"
                )
        lines.append(
            f"Margen de seguridad (escenario base vs. precio actual ${dcf['current_price']}): {dcf['margin_of_safety_pct']}%"
        )
    else:
        lines.append("")
        lines.append("DCF: no se pudo calcular (falta FCF positivo, precio o acciones en circulación reales) — dilo explícitamente, no inventes un valor intrínseco.")

    return "\n".join(lines)
