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
import statistics
from typing import Optional

from app.services.financial_data_service import get_financials, get_revenue_segments, get_beta, get_risk_free_rate
from app.core.finnhub import fh_quote, fh_profile, fh_price_target

logger = logging.getLogger(__name__)

_MIN_YEARS = 3
_PROJECTION_YEARS = 10
_SENSITIVITY_DISCOUNT_RATES = (0.08, 0.10, 0.12)  # classic Wall-Street-style sensitivity table, independent of the real WACC used for the 3 growth scenarios
_DEFAULT_DISCOUNT_RATE = 0.09  # fallback when WACC inputs (beta/risk-free rate) aren't available

# ── Sector-proxy discount rate — FALLBACK ONLY ────────────────────────────────
# Used only when a real CAPM-based WACC can't be computed (beta or the live
# risk-free rate is unavailable). When both are available, _calc_wacc() below
# is authoritative and this table is skipped entirely.
_SECTOR_DISCOUNT_RATES: list[tuple[str, float]] = [
    ("utilities", 0.065),
    ("real estate", 0.07),
    ("consumer defensive", 0.075),
    ("financial services", 0.075),
    ("bank", 0.075),
    ("insurance", 0.075),
    ("healthcare", 0.08),
    ("drug", 0.08),
    ("industrials", 0.08),
    ("basic materials", 0.085),
    ("consumer cyclical", 0.085),
    ("retail", 0.085),
    ("energy", 0.085),
    ("communication services", 0.09),
    ("technology", 0.095),
    ("biotechnology", 0.11),
]


def _sector_discount_rate(sector: str | None) -> float:
    if not sector:
        return _DEFAULT_DISCOUNT_RATE
    s = sector.lower()
    for key, rate in _SECTOR_DISCOUNT_RATES:
        if key in s:
            return rate
    return _DEFAULT_DISCOUNT_RATE


# ── Terminal growth rate — varies by sector, bounded by long-run nominal GDP
# growth (~2-3.5% in the US) so the perpetuity never implies a business
# outgrowing the overall economy forever, which is what makes a Gordon-growth
# terminal value economically meaningful in the first place. Higher for
# secularly-growing sectors (tech, healthcare — larger realistic long-run
# TAM expansion), lower for mature/regulated/cyclical ones.
_SECTOR_TERMINAL_GROWTH: list[tuple[str, float]] = [
    ("utilities", 0.015),
    ("energy", 0.018),
    ("consumer defensive", 0.02),
    ("financial services", 0.02),
    ("bank", 0.02),
    ("insurance", 0.02),
    ("basic materials", 0.02),
    ("industrials", 0.0225),
    ("consumer cyclical", 0.0225),
    ("retail", 0.0225),
    ("real estate", 0.0225),
    ("communication services", 0.025),
    ("healthcare", 0.025),
    ("biotechnology", 0.028),
    ("technology", 0.03),
]
_DEFAULT_TERMINAL_GROWTH = 0.025


def _sector_terminal_growth(sector: str | None) -> float:
    if not sector:
        return _DEFAULT_TERMINAL_GROWTH
    s = sector.lower()
    for key, rate in _SECTOR_TERMINAL_GROWTH:
        if key in s:
            return rate
    return _DEFAULT_TERMINAL_GROWTH


# ── Financial-sector detection ────────────────────────────────────────────────
# Banks/insurers/brokers don't generate a normal "free cash flow" the way the
# 2-stage DCF below assumes (deposits, underwriting float, and regulatory
# capital requirements make "operating cash flow minus capex" meaningless) —
# confirmed for real with Progressive Corp (PGR), whose DCF produced a
# 7x-of-price intrinsic value purely from this mismatch, not a real signal.
# Reuses the exact same substring keys already used for the WACC/terminal-
# growth sector tables, for consistency.
_FINANCIAL_SECTOR_KEYS = ("financial services", "bank", "insurance")


def _is_financial_sector(sector: str | None) -> bool:
    if not sector:
        return False
    s = sector.lower()
    return any(k in s for k in _FINANCIAL_SECTOR_KEYS)


# ── Real CAPM-based WACC ──────────────────────────────────────────────────────
_EQUITY_RISK_PREMIUM = 0.046  # long-run US equity risk premium (Damodaran-style estimate)
_MIN_COST_OF_DEBT = 0.03
_MAX_COST_OF_DEBT = 0.15


def _calc_wacc(
    beta: Optional[float],
    risk_free_rate: Optional[float],
    market_cap: Optional[float],
    total_debt: float,
    interest_expense: Optional[float],
    tax_rate: float,
    sector: Optional[str],
) -> tuple[float, dict]:
    """Real WACC via CAPM: cost of equity = risk-free + beta × ERP, cost of
    debt = interest expense / total debt (with a floor/ceiling), blended by
    market-value weights of equity and debt, net of the tax shield on debt.
    Falls back to the sector-proxy table ONLY if beta or the live risk-free
    rate genuinely isn't available (e.g. FMP down) — this is disclosed
    explicitly in the output so it's never silently mistaken for a real WACC."""
    if beta is None or risk_free_rate is None or not market_cap:
        return _sector_discount_rate(sector), {"method": "sector_fallback (beta o tasa libre de riesgo no disponibles)"}

    beta_clamped = max(min(beta, 3.0), 0.3)  # sanity clamp — an extreme/negative beta breaks CAPM
    cost_of_equity = risk_free_rate + beta_clamped * _EQUITY_RISK_PREMIUM

    if total_debt > 0 and interest_expense:
        cost_of_debt = min(max(abs(interest_expense) / total_debt, _MIN_COST_OF_DEBT), _MAX_COST_OF_DEBT)
    else:
        cost_of_debt = risk_free_rate + 0.015  # investment-grade-ish spread floor for debt-light/debt-free companies

    e, d = market_cap, total_debt
    v = e + d
    wacc = (e / v) * cost_of_equity + (d / v) * cost_of_debt * (1 - tax_rate)
    wacc = max(min(wacc, 0.20), 0.04)  # sanity floor/ceiling — CAPM with an extreme beta can otherwise produce nonsense

    return wacc, {
        "method": "capm",
        "beta": round(beta, 2),
        "risk_free_rate_pct": round(risk_free_rate * 100, 2),
        "equity_risk_premium_pct": round(_EQUITY_RISK_PREMIUM * 100, 2),
        "cost_of_equity_pct": round(cost_of_equity * 100, 2),
        "cost_of_debt_pct": round(cost_of_debt * 100, 2),
        "tax_rate_pct": round(tax_rate * 100, 1),
        "equity_weight_pct": round(e / v * 100, 1),
        "debt_weight_pct": round(d / v * 100, 1),
    }


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


def _coefficient_of_variation(values: list[Optional[float]]) -> Optional[float]:
    """Real (not eyeballed) measure of how volatile a series is: stdev/|mean|.
    Used so 'is this company's FCF stable or all over the place' is a
    computed number, not a narrative guess — a low-volatility FCF series
    (Coca-Cola-like) should genuinely produce a higher confidence than a
    choppy one (early-stage/capex-supercycle company), and now it does."""
    valid = [v for v in values if v is not None]
    if len(valid) < 3:
        return None
    mean = statistics.mean(valid)
    if mean == 0:
        return None
    return abs(statistics.pstdev(valid) / mean)


def _confidence_score(
    fcf_cv: Optional[float], roic_trend: list[Optional[float]], years_available: int,
) -> int:
    """0-100 confidence in the DCF/projection — how much should the user
    trust the specific growth numbers, as opposed to just the direction.
    Built from three real, computed signals: FCF volatility (coefficient of
    variation), ROIC stability (stdev of the ROIC trend — a genuinely
    predictable moat shows up as low ROIC variance), and how many years of
    real data back the whole analysis. This is NOT the same as the Business
    Quality Score — a company can be excellent (high quality) but still
    unpredictable (low confidence), e.g. early in a capex supercycle."""
    # FCF stability: CV of 0 -> 100, CV of 1.0+ (as volatile as the mean itself) -> ~10
    fcf_stability_score = _score(fcf_cv, [(0.05, 95), (0.15, 80), (0.30, 60), (0.50, 40), (0.80, 20), (999, 10)]) if fcf_cv is not None else 50

    roic_valid = [v for v in roic_trend if v is not None]
    roic_stdev = statistics.pstdev(roic_valid) if len(roic_valid) >= 3 else None
    roic_stability_score = _score(roic_stdev, [(3, 95), (8, 80), (15, 60), (25, 40), (999, 20)]) if roic_stdev is not None else 50

    data_completeness_score = min(100, round(years_available / 10 * 100))

    return round(fcf_stability_score * 0.4 + roic_stability_score * 0.4 + data_completeness_score * 0.2)


def _build_checklist_items(dcf: dict, thesis_scores: dict, evidence: Optional[dict] = None) -> list[dict]:
    """6 of the 7 items of the investment checklist (in order of importance,
    skipping item 1 "Entender el negocio" — that one is inherently
    qualitative/subjective and added separately by the caller via Claude's
    judgment, disclosed as such). "passed" is always a real, deterministic
    threshold computed from numbers already produced by this module — never
    an AI guess. The templated "reason" strings here are only a FALLBACK,
    used if the AI call (which reasons over `evidence`, the real multi-factor
    data for each dimension) fails or is skipped — see
    ai_service.generate_quick_valuation_summary/generate_candidate_blurb,
    which overwrite "reason" with a nuanced, non-absolutist explanation
    grounded in `evidence` without changing "passed"."""
    items = []
    evidence = evidence or {}

    gb = dcf.get("growth_buildup") or {}
    avg_roic = gb.get("avg_roic_pct")
    moat_pass = avg_roic is not None and avg_roic >= 15
    items.append({
        "key": "moat",
        "name": "Ventaja competitiva (Moat)",
        "passed": moat_pass,
        "reason": (
            f"ROIC promedio real de {avg_roic}% — {'evidencia real de ventaja competitiva duradera' if moat_pass else 'no muestra evidencia clara de un moat sostenido'}."
            if avg_roic is not None else "No hay suficiente historial de ROIC real para evaluar esto."
        ),
        "evidence": evidence.get("moat"),
    })

    bq = thesis_scores.get("business_quality")
    items.append({
        "key": "business_quality",
        "name": "Calidad del negocio",
        "passed": bq is not None and bq >= 60,
        "reason": f"Business Quality Score real: {bq}/100." if bq is not None else "No disponible.",
        "evidence": evidence.get("business_quality"),
    })

    mgmt = thesis_scores.get("management_capital_allocation")
    items.append({
        "key": "management_capital_allocation",
        "name": "Management y asignación de capital",
        "passed": mgmt is not None and mgmt >= 60,
        "reason": f"Management & Capital Allocation Score real: {mgmt}/100." if mgmt is not None else "No disponible.",
        "evidence": evidence.get("management_capital_allocation"),
    })

    fs = thesis_scores.get("financial_strength")
    items.append({
        "key": "financial_strength",
        "name": "Fortaleza financiera",
        "passed": fs is not None and fs >= 60,
        "reason": f"Financial Strength Score real: {fs}/100." if fs is not None else "No disponible.",
        "evidence": evidence.get("financial_strength"),
    })

    go = thesis_scores.get("growth_outlook")
    pred = thesis_scores.get("predictability")
    growth_pass = go is not None and pred is not None and go >= 50 and pred >= 50
    items.append({
        "key": "growth_predictability",
        "name": "Crecimiento futuro predecible",
        "passed": growth_pass,
        "reason": (
            f"Growth Outlook real {go}/100, Predictability real {pred}/100."
            if go is not None and pred is not None else "No disponible."
        ),
        "evidence": evidence.get("growth_predictability"),
    })

    mos = dcf.get("margin_of_safety_pct")
    items.append({
        "key": "valuation",
        "name": "Valor intrínseco y margen de seguridad",
        "passed": mos is not None and mos > 0,
        "reason": f"Margen de seguridad real: {'+' if mos >= 0 else ''}{mos}%." if mos is not None else "No se pudo calcular el DCF.",
        "evidence": evidence.get("valuation"),
    })

    return items


def _project_path(base_value: float, growth_1: float, terminal_growth: float, years: int = _PROJECTION_YEARS) -> list[float]:
    """Projects `base_value` forward `years` periods, with growth fading
    linearly from `growth_1` (year 1) to `terminal_growth` by the final year —
    the same two-stage curve used by the DCF, applied to any metric
    (revenue, FCF, Owner Earnings)."""
    v = base_value
    path = []
    for yr in range(1, years + 1):
        g = growth_1 + (terminal_growth - growth_1) * (yr / years)
        v *= (1 + g)
        path.append(round(v, 0))
    return path


def _run_dcf(base_fcf: float, growth_1: float, discount_rate: float, terminal_growth: float) -> dict:
    """Two-stage DCF: growth fades linearly from `growth_1` (year 1) to the
    terminal growth rate by year _PROJECTION_YEARS, then a Gordon-growth
    terminal value. Returns enterprise-value components only — caller adds
    cash/debt to get equity value."""
    path = _project_path(base_fcf, growth_1, terminal_growth)
    pv_sum = sum(cf / ((1 + discount_rate) ** yr) for yr, cf in enumerate(path, start=1))
    final_cf = path[-1]
    terminal_value = final_cf * (1 + terminal_growth) / (discount_rate - terminal_growth)
    pv_terminal = terminal_value / ((1 + discount_rate) ** _PROJECTION_YEARS)
    return {
        "fcf_path": path,
        "pv_of_fcf_sum": pv_sum,
        "terminal_value": terminal_value,
        "pv_of_terminal_value": pv_terminal,
        "enterprise_value": pv_sum + pv_terminal,
    }


def _implied_growth_rate(
    base_fcf: float, discount_rate: float, terminal_growth: float,
    total_debt: float, cash: float, shares_out: float, target_price: float,
) -> Optional[float]:
    """Reverse DCF: holding WACC and terminal growth fixed at the base
    scenario's real values, solves (by binary search — intrinsic value is
    monotonic increasing in growth) for the year-1 growth rate that would
    make the DCF's intrinsic value equal today's actual market price. This
    answers "what growth is the market actually pricing in?" with a real
    computed number instead of a vague narrative guess — it's the concrete
    answer to "what is the investor buying at this price." Returns None if
    no growth rate in a wide, sane search range reconciles the two (e.g. the
    market price implies a genuinely absurd/impossible growth rate)."""
    def intrinsic_at(g: float) -> float:
        result = _run_dcf(base_fcf, g, discount_rate, terminal_growth)
        equity = result["enterprise_value"] - total_debt + cash
        return equity / shares_out

    lo, hi = -0.30, 1.50
    if intrinsic_at(lo) > target_price or intrinsic_at(hi) < target_price:
        return None
    for _ in range(60):
        mid = (lo + hi) / 2
        if intrinsic_at(mid) < target_price:
            lo = mid
        else:
            hi = mid
    return round((lo + hi) / 2 * 100, 1)


def _run_dcf_constant_growth(base_fcf: float, growth: float, discount_rate: float, terminal_growth: float, years: int = _PROJECTION_YEARS) -> dict:
    """Same 2-stage structure as _run_dcf (explicit years + Gordon-growth
    terminal value), but FCF grows at a CONSTANT rate every year instead of
    fading linearly toward terminal growth. This is deliberate: Expectations
    Investing (Rappaport) asks "what constant growth rate, held flat for the
    whole explicit period, reconciles today's price" — a fading path would
    answer a different, less standard question."""
    v = base_fcf
    path = []
    for _ in range(years):
        v *= (1 + growth)
        path.append(v)
    pv_sum = sum(cf / ((1 + discount_rate) ** yr) for yr, cf in enumerate(path, start=1))
    final_cf = path[-1]
    terminal_value = final_cf * (1 + terminal_growth) / (discount_rate - terminal_growth)
    pv_terminal = terminal_value / ((1 + discount_rate) ** years)
    return {
        "fcf_path": path,
        "pv_of_fcf_sum": pv_sum,
        "terminal_value": terminal_value,
        "pv_of_terminal_value": pv_terminal,
        "enterprise_value": pv_sum + pv_terminal,
    }


def _implied_constant_growth_rate(
    base_fcf: float, discount_rate: float, terminal_growth: float,
    total_debt: float, cash: float, shares_out: float, target_price: float,
) -> Optional[float]:
    """Reverse DCF for Expectations Investing: same binary-search approach as
    _implied_growth_rate, but solving for a CONSTANT annual growth rate
    (not a year-1 rate that fades to terminal) — the standard formulation
    for "what growth rate, sustained flat for 10 years, justifies this
    price." Returns None if no rate in a sane range reconciles the price."""
    def intrinsic_at(g: float) -> float:
        result = _run_dcf_constant_growth(base_fcf, g, discount_rate, terminal_growth)
        equity = result["enterprise_value"] - total_debt + cash
        return equity / shares_out

    lo, hi = -0.30, 1.50
    if intrinsic_at(lo) > target_price or intrinsic_at(hi) < target_price:
        return None
    for _ in range(60):
        mid = (lo + hi) / 2
        if intrinsic_at(mid) < target_price:
            lo = mid
        else:
            hi = mid
    return round((lo + hi) / 2 * 100, 1)


def _build_financial_sector_valuation(
    roe_trend: list[Optional[float]], latest_equity: float, shares_out: float, price: float,
    cost_of_equity: float, latest_dividends_paid: float, latest_net_income: Optional[float],
    total_debt: float, cash: float, sector: Optional[str], wacc_details: dict,
) -> Optional[dict]:
    """Real valuation for banks/insurers/brokers — Justified Price-to-Book
    (mathematically the closed-form, Gordon-growth version of a Residual
    Income Model): Justified P/B = (ROE - g) / (Cost of Equity - g), where
    g is the REAL sustainable growth rate (ROE × retention ratio, from real
    dividend/net-income data) — not the 2-stage FCF-based DCF above, which
    is unreliable for this sector (confirmed with Progressive Corp — see
    _is_financial_sector's docstring). Every input is real: ROE trend,
    book value, dividends paid, and the same CAPM cost of equity already
    computed for the standard DCF. Populates the same dict shape as the
    normal `dcf` return (scenarios/margin_of_safety_pct/etc.) so downstream
    code (checklist, screener, prompt formatting) doesn't need to
    special-case the methodology — just reads a "methodology" label."""
    roe_valid = [v for v in roe_trend if v is not None]
    if not roe_valid or not latest_equity or latest_equity <= 0 or not shares_out or not price:
        return None

    # Real-world floor on cost of equity — CAPM with an unusually low beta
    # (seen for real with Progressive Corp's beta of 0.25) understates equity
    # risk for financial institutions, whose leverage/underwriting risk isn't
    # fully captured by market beta. 7% is a standard practitioner floor
    # (Damodaran uses a similar convention) — disclosed, not silently hidden.
    cost_of_equity = max(cost_of_equity, 0.07)

    # Recency-weighted average ROE — same rationale as avg_fcf_margin above:
    # the latest year alone can be noisy, a flat average lets stale years
    # drag down a genuinely improving trend.
    weight_sum = sum(i + 1 for i in range(len(roe_valid)))
    avg_roe = sum((i + 1) * v for i, v in enumerate(roe_valid)) / weight_sum / 100  # decimal

    book_value_per_share = latest_equity / shares_out

    payout_ratio = (
        min(max(latest_dividends_paid / latest_net_income, 0.0), 1.0)
        if latest_net_income and latest_net_income > 0 else 0.0
    )
    retention_ratio = 1 - payout_ratio
    # Cap sustainable growth at a realistic long-run ceiling: a mature
    # financial institution's book value can't keep compounding at its
    # current high ROE forever — real long-run growth converges toward
    # overall economic growth. 6% is generous relative to the 2% terminal
    # growth used for this sector in the standard DCF table, but bounded
    # (not the raw, sometimes 15-20%+, ROE × retention product).
    sustainable_growth = min(avg_roe * retention_ratio, 0.06)

    def justified_pb_and_value(coe: float, g: float) -> tuple[float, float]:
        # Guard: the Gordon-growth form requires coe > g, or it's undefined/
        # explosive — clamp g to a safe margin below coe rather than let the
        # formula blow up (disclosed, not hidden). P/B ceiling of 6x matches
        # what even excellent real-world financials rarely exceed.
        g_safe = min(g, coe - 0.005)
        pb = max(0.0, min((avg_roe - g_safe) / (coe - g_safe), 6.0))
        return pb, book_value_per_share * pb

    scenarios = {}
    for name, coe_delta, label_g in [("pessimistic", 0.01, sustainable_growth), ("base", 0.0, sustainable_growth), ("optimistic", -0.01, sustainable_growth)]:
        coe_scenario = max(cost_of_equity + coe_delta, 0.02)
        pb, value = justified_pb_and_value(coe_scenario, label_g)
        scenarios[name] = {
            "stage1_growth_pct": round(sustainable_growth * 100, 1),
            "discount_rate_pct": round(coe_scenario * 100, 1),
            "intrinsic_value_per_share": round(value, 2),
            "justified_pb": round(pb, 2),
        }

    base_value = scenarios["base"]["intrinsic_value_per_share"]
    if base_value <= 0:
        return None

    margin_of_safety = round((base_value - price) / base_value * 100, 1)
    expected_value_per_share = round(
        scenarios["pessimistic"]["intrinsic_value_per_share"] * 0.25
        + scenarios["base"]["intrinsic_value_per_share"] * 0.5
        + scenarios["optimistic"]["intrinsic_value_per_share"] * 0.25, 2,
    )

    # Reverse formula: solve for g such that price = BVPS × (ROE-g)/(r-g).
    # Linear in g — closed form, no binary search needed.
    implied_growth_pct = None
    denom = price - book_value_per_share
    if abs(denom) > 1e-6:
        g_implied = (price * cost_of_equity - book_value_per_share * avg_roe) / denom
        if -0.30 < g_implied < cost_of_equity:
            implied_growth_pct = round(g_implied * 100, 1)

    roe_stdev = statistics.pstdev(roe_valid) if len(roe_valid) >= 3 else None
    confidence_score = _score(roe_stdev, [(5, 90), (10, 75), (18, 55), (30, 35), (999, 15)]) if roe_stdev is not None else 50

    net_cash = cash - total_debt
    valuation_risk_label = "Bajo" if margin_of_safety >= 0 else "Medio" if margin_of_safety >= -30 else "Alto" if margin_of_safety >= -100 else "Muy alto"
    operational_risk_label = "Bajo" if confidence_score >= 80 else "Medio" if confidence_score >= 60 else "Alto" if confidence_score >= 40 else "Muy alto"

    return {
        "methodology": "residual_income_justified_pb",
        "sector": sector,
        "book_value_per_share": round(book_value_per_share, 2),
        "avg_roe_pct": round(avg_roe * 100, 1),
        "cost_of_equity_pct": round(cost_of_equity * 100, 2),
        "base_discount_rate_pct": round(cost_of_equity * 100, 2),
        "wacc_details": wacc_details,
        "sustainable_growth_pct": round(sustainable_growth * 100, 1),
        "terminal_growth_pct": round(sustainable_growth * 100, 1),
        "payout_ratio_pct": round(payout_ratio * 100, 1),
        "justified_pb": scenarios["base"]["justified_pb"],
        "total_debt": round(total_debt, 0),
        "cash": round(cash, 0),
        "net_cash": round(net_cash, 0),
        "shares_outstanding": round(shares_out, 0),
        "projected_shares_outstanding": round(shares_out, 0),
        "current_price": price,
        "scenarios": scenarios,
        "margin_of_safety_pct": margin_of_safety,
        "expected_value_per_share": expected_value_per_share,
        "implied_growth_pct": implied_growth_pct,
        "confidence_score": confidence_score,
        "operational_risk_label": operational_risk_label,
        "valuation_risk_label": valuation_risk_label,
        "growth_buildup": {
            "historical_growth_pct": round(sustainable_growth * 100, 1),
            "moat_adjustment_pct": 0.0,
            "avg_roic_pct": round(avg_roe * 100, 1),  # ROE substitutes for ROIC in this sector — same moat-evidence role
            "quality_metric_label": "ROE",
            "quality_adjusted_growth_pct": round(sustainable_growth * 100, 1),
            "buyback_rate_pct": 0.0,
            "fcf_per_share_cagr_pct": None,
        },
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

    # Analyst consensus price target — a SEPARATE reference point, never
    # blended into the DCF math. It answers a different question (where
    # sell-side analysts expect the price to go, largely multiple-based and
    # momentum-sensitive) than the DCF does (what the cash flows are
    # actually worth today) — showing both, clearly labeled, is more honest
    # than picking one.
    try:
        analyst_target = fh_price_target(ticker)
    except Exception as e:
        logger.warning("get_fundamental_analysis(%s): analyst price target fetch failed: %s", ticker, e)
        analyst_target = None

    # Real segment revenue straight from the company's own filings (FMP-only —
    # no equivalent on Fiscal.ai/yfinance). Replaces the LLM's "approximate,
    # from general knowledge" segment guess in the chat prompt with actual
    # numbers. [] (not fabricated) if the plan/ticker doesn't have it.
    try:
        segments_raw = get_revenue_segments(ticker, by="product", limit=1)
    except Exception as e:
        logger.warning("get_fundamental_analysis(%s): segments failed: %s", ticker, e)
        segments_raw = []
    segments: list[dict] = []
    if segments_raw:
        seg_data = segments_raw[0].get("data") or {}
        seg_total = sum(v for v in seg_data.values() if isinstance(v, (int, float)))
        for name, rev in sorted(seg_data.items(), key=lambda kv: kv[1] if isinstance(kv[1], (int, float)) else 0, reverse=True):
            if not isinstance(rev, (int, float)) or rev <= 0:
                continue
            segments.append({
                "name": name,
                "revenue": round(rev, 0),
                "pct_of_total": round(rev / seg_total * 100, 1) if seg_total else None,
            })

    # ── Per-year trends: revenue, FCF, net income, margins, ROIC/ROE/ROA ──
    revenue_trend, fcf_trend, net_income_trend = [], [], []
    gross_margin_trend, operating_margin_trend, net_margin_trend = [], [], []
    roic_trend, roe_trend, roa_trend = [], [], []
    owner_earnings_trend = []
    fcf_per_share_trend, implied_shares_trend = [], []
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
        fcf_i = ocf - abs(capex) if ocf is not None and capex is not None else None
        fcf_trend.append(fcf_i)

        # Implied diluted share count for this year (Net Income / Diluted
        # EPS) — real per-year buybacks aren't a clean field on any
        # provider, but this backs it out from two numbers we do have.
        # Lets FCF-per-share growth diverge from total-FCF growth exactly
        # when buybacks are shrinking the share count — the concrete,
        # computable version of "management is returning capital well."
        diluted_eps = _num(inc.get("Diluted EPS"))
        implied_shares = ni / diluted_eps if ni is not None and diluted_eps else None
        implied_shares_trend.append(implied_shares)
        fcf_per_share_trend.append(fcf_i / implied_shares if fcf_i is not None and implied_shares and implied_shares > 0 else None)

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

    # FCF-per-share CAGR — real capital-allocation signal (buybacks shrinking
    # the share count make per-share value grow faster than total FCF; this
    # is the concrete, computed version of "management is returning capital
    # well," not a narrative guess).
    fcf_ps_valid = [v for v in fcf_per_share_trend if v is not None]
    fcf_per_share_cagr = _cagr(fcf_ps_valid[0], fcf_ps_valid[-1], len(fcf_ps_valid) - 1) if len(fcf_ps_valid) >= 2 else None

    # Average ROIC — real moat-strength proxy. A business that has SUSTAINED
    # an extraordinary ROIC across every available year has proven it can
    # redeploy capital at high returns, which is real evidence supporting a
    # more durable growth assumption than the raw historical CAGR alone
    # implies — this is what lets a mature-but-excellent compounder (Apple-
    # like: low revenue CAGR, ROIC ~95%) get a growth boost a pure CAGR
    # projection would never give it.
    roic_valid_all = [v for v in roic_trend if v is not None]
    avg_roic = statistics.mean(roic_valid_all) if roic_valid_all else None

    # Recency-weighted average FCF margin across the available years (paired
    # by index with revenue, not just fcf_valid[-1] in isolation) — a flat
    # (unweighted) average was tried first and traded one distortion for
    # another: it fixed a single temporarily-depressed recent year (e.g. a
    # capex ramp dragging down FCF while revenue keeps growing), but let old,
    # no-longer-representative years drag the average the WRONG way for
    # companies with a genuinely improving margin trend, and produced a
    # near-zero base for companies mid-way through a multi-year capex
    # supercycle (their oldest positive years averaged against their newest
    # deeply-negative one). Weighting each year by its recency (oldest=1,
    # newest=n) keeps the current trend dominant while still smoothing out
    # any single outlier year — the newest year alone is never the entire
    # signal, but it's no longer diluted equally against years that may no
    # longer represent the business.
    fcf_margin_pairs = [(i, f / r) for i, (f, r) in enumerate(zip(fcf_trend, revenue_trend)) if f is not None and r]
    if fcf_margin_pairs:
        weight_sum = sum(i + 1 for i, _ in fcf_margin_pairs)
        avg_fcf_margin = sum((i + 1) * m for i, m in fcf_margin_pairs) / weight_sum
    else:
        avg_fcf_margin = None

    latest_bal  = balance[-1]
    total_debt  = (_num(latest_bal.get("Long Term Debt")) or 0) + (_num(latest_bal.get("Short Term Debt")) or 0)
    cash_latest = _num(latest_bal.get("Cash And Short Term Investments")) or _num(latest_bal.get("Cash And Cash Equivalents")) or 0
    net_cash    = cash_latest - total_debt

    # ── Deterministic 2-stage DCF, 3 scenarios (pessimistic/base/optimistic) ──
    # Both FCF and revenue in every scenario grow at the SAME rate (revenue
    # CAGR, a stable demand-driven signal) applied to a margin-normalized FCF
    # base — i.e. the model assumes a roughly stable FCF margin going
    # forward, disclosed as such, rather than extrapolating whatever the
    # single most recent year's margin happened to be.
    dcf = None
    latest_rev = rev_valid[-1] if rev_valid else None
    sector = profile.get("finnhubIndustry")
    terminal_growth = _sector_terminal_growth(sector)

    market_cap = price * shares_out if price and shares_out else None
    beta = None
    risk_free_rate = None
    try:
        beta = get_beta(ticker)
    except Exception as e:
        logger.warning("get_fundamental_analysis(%s): beta fetch failed: %s", ticker, e)
    try:
        risk_free_rate = get_risk_free_rate()
    except Exception as e:
        logger.warning("get_fundamental_analysis(%s): risk-free rate fetch failed: %s", ticker, e)
    latest_interest_expense = _num(income[-1].get("Interest Expense")) if income else None
    base_discount_rate, wacc_details = _calc_wacc(
        beta, risk_free_rate, market_cap, total_debt, latest_interest_expense, tax_rate, sector,
    )

    if _is_financial_sector(sector):
        # Banks/insurers/brokers: the FCF-based DCF below is unreliable for
        # this sector (confirmed with Progressive Corp) — use the real
        # Justified Price-to-Book / Residual Income model instead.
        cost_of_equity = (
            wacc_details.get("cost_of_equity_pct") / 100
            if wacc_details.get("method") == "capm" and wacc_details.get("cost_of_equity_pct") is not None
            else base_discount_rate
        )
        latest_equity = _num(latest_bal.get("Stockholders Equity"))
        latest_dividends_paid_fin = abs(_num(cashflow[-1].get("Dividends Paid")) or 0) if cashflow else 0
        latest_net_income = ni_valid[-1] if ni_valid else None
        dcf = _build_financial_sector_valuation(
            roe_trend, latest_equity, shares_out, price, cost_of_equity,
            latest_dividends_paid_fin, latest_net_income, total_debt, cash_latest, sector, wacc_details,
        )

    elif avg_fcf_margin and avg_fcf_margin > 0 and latest_rev and shares_out and price:
        base_fcf = avg_fcf_margin * latest_rev

        # ── Quality-adjusted growth rate ──────────────────────────────────
        # A pure historical-CAGR projection is exactly the trap flagged after
        # testing this against real companies: a mature, low-revenue-growth
        # compounder with an extraordinary moat (Apple: 3.3% revenue CAGR,
        # 95% ROIC, heavy buybacks) got projected as if it were a mediocre
        # business, because the CAGR alone can't see the moat or the capital
        # allocation. Two REAL, computed adjustments are added on top of the
        # historical base — never invented, never from "general knowledge":
        #
        # 1) Moat adjustment: sustained high ROIC is real evidence a business
        #    can redeploy capital at extraordinary returns for a long time —
        #    that supports a higher/more durable growth assumption than the
        #    raw CAGR implies, in proportion to how exceptional the ROIC is.
        # 2) Capital-allocation adjustment: FCF-per-share growing faster than
        #    total FCF (from real buybacks shrinking the share count) is
        #    literally more value delivered per share than the topline
        #    growth number alone shows — this captures Apple/buyback-style
        #    compounders correctly instead of penalizing them.
        #
        # TAM/industry growth (the other classic input a human analyst would
        # use) has no clean numeric source on any provider here — that stays
        # a qualitative overlay for Claude's narrative (section 14), not
        # faked into this formula.
        base_historical_growth = max(rev_cagr / 100, 0.0) if rev_cagr is not None else 0.08

        moat_adjustment = 0.0
        if avg_roic is not None:
            if avg_roic >= 40:
                moat_adjustment = 0.03
            elif avg_roic >= 25:
                moat_adjustment = 0.02
            elif avg_roic >= 15:
                moat_adjustment = 0.01

        # Buyback rate — real annual % reduction in share count implied by
        # FCF-per-share growing faster than total FCF. This does NOT get
        # folded into the revenue/FCF growth rate below: buybacks don't make
        # the underlying BUSINESS grow faster in absolute (total-dollar)
        # terms, they make PER-SHARE value grow faster by shrinking the
        # denominator. Blending it into g1 would inflate the projected
        # revenue/FCF path for a business that isn't actually growing that
        # fast, AND separately shrink the share count — double-counting the
        # same real phenomenon. Kept separate: applied only to the share-
        # count path used for the per-share conversion below (Fase 6).
        buyback_rate = 0.0
        if fcf_per_share_cagr is not None and fcf_cagr is not None:
            implied_buyback_rate = (fcf_per_share_cagr - fcf_cagr) / 100
            buyback_rate = max(min(implied_buyback_rate, 0.05), 0.0)

        g1_rev_raw = base_historical_growth + moat_adjustment

        # Projected share count path — gradual reduction if the company has a
        # real, sustained buyback track record (never assumed constant when
        # real buybacks are happening). Average of the projected path over
        # the projection horizon is used as the per-share denominator instead
        # of today's static share count, since the EV/terminal-value split is
        # aggregate (not year-by-year), so a single representative share
        # count is needed — the average is a reasonable middle ground between
        # "ignore future buybacks entirely" (today's count) and "assume all
        # value crystallizes only at the terminal year" (year-10 count).
        if buyback_rate > 0:
            shares_path = [shares_out * ((1 - buyback_rate) ** t) for t in range(1, _PROJECTION_YEARS + 1)]
            projected_shares = statistics.mean(shares_path)
        else:
            projected_shares = shares_out
        # Raw (unclamped) quality-adjusted growth rate — clamping happens PER
        # SCENARIO below, each with its own ceiling. Clamping here first (to
        # the base scenario's own ceiling) before applying the optimistic/
        # pessimistic multiplier used to collapse base and optimistic into
        # the exact same number for any real high-growth company (e.g. a
        # ~68% revenue CAGR — NVIDIA-like — hit the old 25% ceiling before
        # the 1.3x optimistic multiplier ever got a chance to differentiate
        # it).

        scenarios = {}
        for name, mult, dr, rev_cap, fcf_cap in [
            ("pessimistic", 0.5, base_discount_rate + 0.015, 0.15, 0.15),
            ("base",        1.0, base_discount_rate,          0.25, 0.25),
            ("optimistic",  1.3, base_discount_rate - 0.01,   0.40, 0.35),
        ]:
            g1_fcf = min(g1_rev_raw * mult, fcf_cap)
            dcf_result = _run_dcf(base_fcf, g1_fcf, dr, terminal_growth)
            ev = dcf_result["enterprise_value"]
            equity_value = ev - total_debt + cash_latest
            intrinsic_per_share = equity_value / projected_shares

            scenario = {
                "stage1_growth_pct": round(g1_fcf * 100, 1),
                "discount_rate_pct": round(dr * 100, 1),
                "intrinsic_value_per_share": round(intrinsic_per_share, 2),
                "fcf_year1": dcf_result["fcf_path"][0],
                "fcf_year5": dcf_result["fcf_path"][_PROJECTION_YEARS - 1],
            }
            if latest_rev:
                g1_rev = min(g1_rev_raw * mult, rev_cap)
                rev_path = _project_path(latest_rev, g1_rev, terminal_growth)
                scenario.update({
                    "revenue_growth_pct": round(g1_rev * 100, 1),
                    "revenue_year1": rev_path[0],
                    "revenue_year5": rev_path[_PROJECTION_YEARS - 1],
                })
            scenarios[name] = scenario

        base_scenario = scenarios["base"]
        # Sanity floor: a negative "intrinsic value per share" is never a
        # meaningful number to show a user — it means debt so overwhelms the
        # DCF-derived enterprise value that the model itself is unreliable
        # for this company right now (seen on a company mid-way through a
        # multi-year capex supercycle with heavy debt, e.g. Oracle's 2025
        # AI-datacenter buildout). Suppress the whole DCF rather than present
        # a nonsensical negative price — the prompt is instructed to say so
        # explicitly instead of inventing a number.
        if base_scenario["intrinsic_value_per_share"] > 0:
            margin_of_safety = round(
                (base_scenario["intrinsic_value_per_share"] - price) / base_scenario["intrinsic_value_per_share"] * 100, 1
            )
            # Classic sensitivity table: same base-case growth rate, only the
            # discount rate changes (8%/10%/12%) — separate from the 3
            # growth scenarios above, which vary growth AND discount rate
            # together. This isolates how much the discount-rate assumption
            # alone moves the valuation.
            base_g1_fcf = base_scenario["stage1_growth_pct"] / 100
            sensitivity = []
            for rate in _SENSITIVITY_DISCOUNT_RATES:
                sens_result = _run_dcf(base_fcf, base_g1_fcf, rate, terminal_growth)
                sens_equity = sens_result["enterprise_value"] - total_debt + cash_latest
                sensitivity.append((round(rate * 100), round(sens_equity / projected_shares, 2)))

            # Reverse DCF: what growth rate would the CURRENT price actually
            # require, holding the real WACC and terminal growth fixed? This
            # is the concrete, computed answer to "what is the investor
            # buying at this price" — not a narrative guess.
            implied_growth_pct = _implied_growth_rate(
                base_fcf, base_discount_rate, terminal_growth, total_debt, cash_latest, projected_shares, price,
            )

            # ── Reverse DCF — Expectations Investing (Rappaport) ───────────
            # A distinct question from the "DCF inverso" above: instead of
            # the year-1-fading-to-terminal growth rate, this solves for a
            # CONSTANT annual growth rate held flat for the full 10-year
            # explicit period — the standard formulation of "what growth,
            # sustained without interruption, does today's price require."
            # Uses the latest year's real Owner Earnings (Buffett's actual
            # cash-generation definition) as FCF_0, not the recency-weighted
            # margin-normalized base used in the forward DCF — this module
            # is anchored to "what did the business actually generate last
            # year," not a smoothed multi-year average, since the exercise
            # is explicitly about today's price vs. today's real number.
            latest_oe = next((v for v in reversed(owner_earnings_trend) if v is not None), None)
            if latest_oe is not None and latest_oe > 0:
                fcf0_expectations = latest_oe
                fcf0_source = "owner_earnings_latest_year"
            else:
                fcf0_expectations = base_fcf
                fcf0_source = "dcf_base_fcf_fallback"

            expectations_investing = None
            if market_cap and fcf0_expectations > 0:
                implied_multiple_pfcf = round(market_cap / fcf0_expectations, 1)
                growth_by_rate = []
                for name in ("pessimistic", "base", "optimistic"):
                    dr = scenarios[name]["discount_rate_pct"] / 100
                    g = _implied_constant_growth_rate(
                        fcf0_expectations, dr, terminal_growth, total_debt, cash_latest, projected_shares, price,
                    )
                    growth_by_rate.append({
                        "scenario": name,
                        "discount_rate_pct": scenarios[name]["discount_rate_pct"],
                        "implied_growth_pct": g,
                    })
                base_g = next((r["implied_growth_pct"] for r in growth_by_rate if r["scenario"] == "base"), None)
                fcf_year10_base = round(fcf0_expectations * (1 + base_g / 100) ** 10, 0) if base_g is not None else None

                # Real evidence of cyclicality: count actual YoY FCF declines
                # in the historical trend — objective, not a narrative guess.
                fcf_valid_pairs = [v for v in fcf_trend if v is not None]
                fcf_decline_years = sum(
                    1 for i in range(1, len(fcf_valid_pairs)) if fcf_valid_pairs[i] < fcf_valid_pairs[i - 1]
                )

                expectations_investing = {
                    "fcf0": round(fcf0_expectations, 0),
                    "fcf0_source": fcf0_source,
                    "implied_multiple_pfcf": implied_multiple_pfcf,
                    "growth_by_rate": growth_by_rate,
                    "fcf_year10_base_scenario": fcf_year10_base,
                    "historical_fcf_decline_years": fcf_decline_years,
                    "years_available": n,
                }

            # Confidence Score (0-100): a REAL measure of how volatile/
            # predictable this business's FCF and ROIC actually are — not
            # how good the business is (that's the Business Quality Score).
            # A capex-supercycle company can be an excellent business with
            # LOW confidence in the near-term projection; a mature, stable
            # compounder can have a mediocre Quality Score but HIGH
            # confidence. Feeds the probability weights below: a low-
            # confidence company gets a wider bear/bull spread instead of
            # pretending the base case is as reliable as a predictable one.
            fcf_cv = _coefficient_of_variation(fcf_trend)
            confidence_score = _confidence_score(fcf_cv, roic_trend, n)
            if confidence_score >= 80:
                prob_weights = (0.15, 0.70, 0.15)
            elif confidence_score >= 60:
                prob_weights = (0.20, 0.60, 0.20)
            elif confidence_score >= 40:
                prob_weights = (0.25, 0.50, 0.25)
            else:
                prob_weights = (0.30, 0.40, 0.30)
            expected_value_per_share = round(
                scenarios["pessimistic"]["intrinsic_value_per_share"] * prob_weights[0]
                + scenarios["base"]["intrinsic_value_per_share"] * prob_weights[1]
                + scenarios["optimistic"]["intrinsic_value_per_share"] * prob_weights[2],
                2,
            )

            # ── Value drivers ("why $X and not $Y") — real counterfactual
            # DCFs, each changing ONE assumption at a time and holding
            # everything else at the base scenario's real values. The delta
            # vs. the actual base value is a real, computed answer to "what
            # is pulling the value up or down," not a narrative guess.
            base_value = base_scenario["intrinsic_value_per_share"]

            g1_no_moat = min(base_historical_growth, 0.25)
            no_moat_result = _run_dcf(base_fcf, g1_no_moat, base_discount_rate, terminal_growth)
            no_moat_equity = no_moat_result["enterprise_value"] - total_debt + cash_latest
            moat_impact = round(base_value - no_moat_equity / projected_shares, 2)

            base_ev = _run_dcf(base_fcf, base_g1_fcf, base_discount_rate, terminal_growth)["enterprise_value"]
            no_buyback_equity = base_ev - total_debt + cash_latest
            buyback_impact = round(base_value - no_buyback_equity / shares_out, 2)

            lower_wacc_result = _run_dcf(base_fcf, base_g1_fcf, max(base_discount_rate - 0.01, 0.01), terminal_growth)
            lower_wacc_equity = lower_wacc_result["enterprise_value"] - total_debt + cash_latest
            wacc_impact_per_1pp = round(lower_wacc_equity / projected_shares - base_value, 2)

            latest_fcf_raw = fcf_valid[-1] if fcf_valid else None
            if latest_fcf_raw:
                raw_margin_result = _run_dcf(latest_fcf_raw, base_g1_fcf, base_discount_rate, terminal_growth)
                raw_margin_equity = raw_margin_result["enterprise_value"] - total_debt + cash_latest
                margin_normalization_impact = round(base_value - raw_margin_equity / projected_shares, 2)
            else:
                margin_normalization_impact = None

            value_drivers = {
                "moat_impact_per_share": moat_impact,
                "buyback_impact_per_share": buyback_impact,
                "wacc_impact_per_1pp_lower_per_share": wacc_impact_per_1pp,
                "margin_normalization_impact_per_share": margin_normalization_impact,
            }

            # ── Sensitivity heatmap — WACC (rows) x FCF growth (columns),
            # both centered on the real base-case values, real _run_dcf calls
            # for every cell (no interpolation/estimation).
            wacc_rows = [round(base_discount_rate - 0.01, 4), round(base_discount_rate, 4), round(base_discount_rate + 0.01, 4)]
            growth_cols = [
                max(base_g1_fcf - 0.04, 0.0), max(base_g1_fcf - 0.02, 0.0),
                base_g1_fcf, base_g1_fcf + 0.02,
            ]
            sensitivity_matrix = {
                "wacc_rows_pct": [round(r * 100, 1) for r in wacc_rows],
                "growth_cols_pct": [round(g * 100, 1) for g in growth_cols],
                "values": [
                    [
                        round((_run_dcf(base_fcf, g, r, terminal_growth)["enterprise_value"] - total_debt + cash_latest) / projected_shares, 2)
                        for g in growth_cols
                    ]
                    for r in wacc_rows
                ],
            }

            dcf = {
                "base_fcf": round(base_fcf, 0),
                "avg_fcf_margin_pct": round(avg_fcf_margin * 100, 1),
                "base_revenue": round(latest_rev, 0) if latest_rev else None,
                "sector": sector,
                "base_discount_rate_pct": round(base_discount_rate * 100, 2),
                "wacc_details": wacc_details,
                "terminal_growth_pct": round(terminal_growth * 100, 2),
                "projection_years": _PROJECTION_YEARS,
                "total_debt": round(total_debt, 0),
                "cash": round(cash_latest, 0),
                "shares_outstanding": round(shares_out, 0),
                "projected_shares_outstanding": round(projected_shares, 0),
                "buyback_rate_pct": round(buyback_rate * 100, 1),
                "current_price": price,
                "scenarios": scenarios,
                "margin_of_safety_pct": margin_of_safety,
                "sensitivity": sensitivity,
                "implied_growth_pct": implied_growth_pct,
                "expectations_investing": expectations_investing,
                "confidence_score": confidence_score,
                "fcf_volatility_cv": round(fcf_cv, 2) if fcf_cv is not None else None,
                "probability_weights": {"pessimistic": prob_weights[0], "base": prob_weights[1], "optimistic": prob_weights[2]},
                "expected_value_per_share": expected_value_per_share,
                "value_drivers": value_drivers,
                "sensitivity_matrix": sensitivity_matrix,
                "growth_buildup": {
                    "historical_growth_pct": round(base_historical_growth * 100, 1),
                    "moat_adjustment_pct": round(moat_adjustment * 100, 1),
                    "avg_roic_pct": round(avg_roic, 1) if avg_roic is not None else None,
                    "quality_adjusted_growth_pct": round(g1_rev_raw * 100, 1),
                    "buyback_rate_pct": round(buyback_rate * 100, 1),
                    "fcf_per_share_cagr_pct": fcf_per_share_cagr,
                },
            }

    # ── Quality score (0-10, matches the "Calidad del negocio: X.X/10" format) ──
    latest_roic = next((v for v in reversed(roic_trend) if v is not None), None)
    latest_om   = next((v for v in reversed(operating_margin_trend) if v is not None), None)
    latest_nm   = next((v for v in reversed(net_margin_trend) if v is not None), None)

    roic_score   = _score(latest_roic, [(4, 20), (7, 40), (10, 55), (15, 70), (20, 85), (999, 95)])
    margin_score = _score(latest_om,   [(0, 10), (10, 35), (15, 55), (20, 70), (30, 85), (999, 95)])
    net_margin_score = _score(latest_nm, [(0, 15), (5, 40), (10, 55), (15, 70), (25, 85), (999, 95)])
    growth_score = _score(rev_cagr,    [(0, 15), (5, 40), (10, 60), (15, 75), (20, 88), (999, 95)])
    fcf_margin_score = _score(avg_fcf_margin * 100 if avg_fcf_margin is not None else None, [(0, 15), (5, 40), (10, 55), (15, 70), (25, 85), (999, 95)])
    if cash_latest > 0:
        debt_score = _score(total_debt / cash_latest, [(0.5, 90), (1, 75), (2, 55), (4, 35), (999, 15)])
    else:
        debt_score = 90 if net_cash >= 0 else 20

    # Interest coverage — real, from actual interest expense, a genuine
    # additional (not redundant with net-debt/cash) signal of financial
    # resilience: a company can carry debt comfortably if operating income
    # covers interest many times over, even with modest net cash.
    interest_coverage_score = None
    if latest_interest_expense and latest_interest_expense > 0 and latest_om is not None and latest_rev:
        operating_income_latest = latest_om / 100 * latest_rev
        interest_coverage = operating_income_latest / latest_interest_expense
        interest_coverage_score = _score(interest_coverage, [(1, 15), (2, 35), (4, 55), (8, 75), (15, 88), (999, 95)])
    financial_strength_components = [s for s in [debt_score, interest_coverage_score] if s is not None]
    financial_strength_score = round(sum(financial_strength_components) / len(financial_strength_components)) if financial_strength_components else debt_score

    # Business Quality — a genuine blend across profitability, margin
    # quality, cash generation and growth, NOT a single metric (ROIC alone
    # used to be the entire score here — replaced per the Buffett-checklist
    # redesign, which explicitly requires multi-factor evaluation for every
    # criterion).
    business_quality_components = [s for s in [roic_score, margin_score, net_margin_score, fcf_margin_score, growth_score] if s is not None]
    business_quality_score = round(sum(business_quality_components) / len(business_quality_components)) if business_quality_components else None

    # Payout sanity — real, from actual dividends paid vs. net income:
    # penalizes distributing more than the business earns (unsustainable),
    # rewards disciplined, sustainable capital return. Distinct from
    # financial_strength's leverage focus — this is about capital
    # allocation judgment, not balance-sheet resilience.
    payout_sanity_score = None
    latest_ni_for_payout = ni_valid[-1] if ni_valid else None
    latest_dividends_paid_mgmt = abs(_num(cashflow[-1].get("Dividends Paid")) or 0) if cashflow else 0
    if latest_ni_for_payout and latest_ni_for_payout > 0:
        payout_ratio_mgmt = latest_dividends_paid_mgmt / latest_ni_for_payout if latest_dividends_paid_mgmt else 0.0
        payout_sanity_score = _score(payout_ratio_mgmt, [(0.6, 90), (0.8, 75), (1.0, 55), (1.2, 30), (999, 10)])

    comp_scores = [s for s in [roic_score, margin_score, growth_score, debt_score] if s is not None]
    quality_score_100 = round(sum(comp_scores) / len(comp_scores)) if comp_scores else None
    quality_score_10 = round(quality_score_100 / 10, 1) if quality_score_100 is not None else None

    # ── Relative valuation (P/E, EV/EBITDA, PEG) — real, from the latest
    # reported year + current price. A "5-year historical average P/E" would
    # need historical daily prices at each fiscal year-end, which isn't
    # wired up yet — flagged as a known gap rather than faked.
    latest_income = income[-1] if income else {}
    latest_eps = _num(latest_income.get("Diluted EPS")) or _num(latest_income.get("Basic EPS"))
    latest_ebitda = _num(latest_income.get("EBITDA"))
    market_cap = price * shares_out if price and shares_out else None
    pe_ratio = round(price / latest_eps, 1) if price and latest_eps and latest_eps > 0 else None
    ev_ebitda = (
        round((market_cap + total_debt - cash_latest) / latest_ebitda, 1)
        if market_cap and latest_ebitda and latest_ebitda > 0 else None
    )
    growth_for_peg = rev_cagr if rev_cagr is not None else ni_cagr
    peg_ratio = round(pe_ratio / growth_for_peg, 2) if pe_ratio and growth_for_peg and growth_for_peg > 0 else None

    # ── Multiple Check (Fase 9) — never trust the DCF in isolation. EV/FCF
    # and P/FCF use the latest reported year's actual FCF (not the DCF's
    # margin-normalized base), so they're an independent cross-check, not a
    # restatement of the DCF's own assumptions. Dividend Yield is real, from
    # actual dividends paid in the latest cash-flow statement.
    latest_fcf_actual = fcf_valid[-1] if fcf_valid else None
    ev_fcf = (
        round((market_cap + total_debt - cash_latest) / latest_fcf_actual, 1)
        if market_cap and latest_fcf_actual and latest_fcf_actual > 0 else None
    )
    p_fcf = (
        round(market_cap / latest_fcf_actual, 1)
        if market_cap and latest_fcf_actual and latest_fcf_actual > 0 else None
    )
    latest_dividends_paid = abs(_num(cashflow[-1].get("Dividends Paid")) or 0) if cashflow else 0
    dividend_yield_pct = (
        round(latest_dividends_paid / market_cap * 100, 2)
        if market_cap and latest_dividends_paid > 0 else None
    )

    # ── Fair Value Score (0-100) — how attractive is the PRICE, distinct from
    # how good the BUSINESS is (quality_score_100 above). Derived from the
    # DCF's margin of safety on a bounded curve, not from PE/EV-EBITDA/PEG
    # directly (those vary too much by sector/growth stage to score fairly
    # without historical/peer context this engine doesn't have yet — they're
    # shown as real supporting data instead, for Claude to interpret in
    # context, not folded into a falsely-precise score).
    fair_value_score = None
    if dcf and dcf.get("margin_of_safety_pct") is not None:
        fair_value_score = _score(-dcf["margin_of_safety_pct"], [
            (-50, 95), (-20, 85), (0, 70), (20, 55), (50, 40), (100, 25), (999, 10),
        ])

    # ── Investment Opportunity Score — kept internally for backward
    # compatibility, no longer the headline metric shown to the user (see
    # thesis_scores below, which decomposes this into 6 dimensions instead of
    # forcing a single blended number).
    investment_opportunity_score = None
    if quality_score_100 is not None and fair_value_score is not None:
        investment_opportunity_score = round(quality_score_100 * 0.6 + fair_value_score * 0.4)

    # ── Investment Thesis Scorecard — 6 real, independently-computed
    # dimensions instead of one blended "should I buy this" number. Forces
    # the user to weigh several factors at once (a business can be a 92 on
    # quality and a 58 on valuation at the same time — that's information a
    # single averaged score destroys).
    growth_score_adj = None
    buyback_component = None
    thesis_scores = None
    if dcf:
        gb = dcf.get("growth_buildup") or {}
        qual_growth = gb.get("quality_adjusted_growth_pct")
        growth_score_adj = _score(qual_growth, [(0, 15), (5, 40), (10, 60), (15, 75), (20, 88), (999, 95)])
        buyback_rate_pct = gb.get("buyback_rate_pct") or 0.0
        buyback_component = _score(buyback_rate_pct, [(0, 30), (1, 50), (2, 65), (3, 80), (5, 90), (999, 95)])
        # Management & Capital Allocation — buyback discipline blended with
        # payout sustainability (NOT leverage, which financial_strength
        # already covers — duplicating it here would make the two
        # dimensions redundant instead of independent signals).
        mgmt_components = [s for s in [buyback_component, payout_sanity_score] if s is not None]
        management_capital_allocation = round(sum(mgmt_components) / len(mgmt_components)) if mgmt_components else None
        thesis_scores = {
            "business_quality": business_quality_score,  # blend: ROIC, operating margin, net margin, FCF margin, growth — not a single metric
            "valuation": fair_value_score,
            "predictability": dcf.get("confidence_score"),
            "financial_strength": financial_strength_score,  # blend: net-debt/cash coverage + interest coverage
            "growth_outlook": growth_score_adj,  # scored from the quality-adjusted growth rate, not raw historical CAGR
            "management_capital_allocation": management_capital_allocation,  # real buyback-rate + payout-sustainability blend
        }

        # ── Operational risk vs. Valuation risk — kept as two SEPARATE labels
        # (never blended) because they answer different questions: can the
        # BUSINESS deteriorate (operational) vs. is the PRICE vulnerable to a
        # re-rating even if the business performs fine (valuation). A
        # low-operational/high-valuation-risk profile (e.g. a wonderful,
        # stable business trading at a rich multiple) is a completely
        # different situation than the reverse, and averaging them into one
        # "risk score" would hide that.
        conf = dcf.get("confidence_score")
        if conf is not None:
            if conf >= 80: operational_risk_label = "Bajo"
            elif conf >= 60: operational_risk_label = "Medio"
            elif conf >= 40: operational_risk_label = "Alto"
            else: operational_risk_label = "Muy alto"
        else:
            operational_risk_label = None

        mos = dcf.get("margin_of_safety_pct")
        if mos is not None:
            if mos >= 0: valuation_risk_label = "Bajo"
            elif mos >= -30: valuation_risk_label = "Medio"
            elif mos >= -100: valuation_risk_label = "Alto"
            else: valuation_risk_label = "Muy alto"
        else:
            valuation_risk_label = None

        dcf["operational_risk_label"] = operational_risk_label
        dcf["valuation_risk_label"] = valuation_risk_label

        # ── Confidence interval around the intrinsic value — an honest
        # approximation (NOT a rigorous statistical distribution, disclosed
        # as such in the prompt) built from the real pessimistic/base/
        # optimistic scenarios already computed: the widest real spread
        # (pessimistic-optimistic) anchors the 90% band, narrowing
        # proportionally for 70%/50% — communicates uncertainty instead of
        # a single point estimate.
        pess_v = dcf["scenarios"]["pessimistic"]["intrinsic_value_per_share"]
        opt_v = dcf["scenarios"]["optimistic"]["intrinsic_value_per_share"]
        center = dcf["expected_value_per_share"]
        half_spread = (opt_v - pess_v) / 2
        dcf["confidence_interval"] = {
            "90": [round(center - half_spread, 2), round(center + half_spread, 2)],
            "70": [round(center - half_spread * 0.6, 2), round(center + half_spread * 0.6, 2)],
            "50": [round(center - half_spread * 0.35, 2), round(center + half_spread * 0.35, 2)],
        }

    # Real, multi-factor evidence per checklist dimension — handed to Claude
    # (see ai_service.generate_quick_valuation_summary/generate_candidate_blurb)
    # so it can write a nuanced, non-absolutist explanation grounded in
    # actual numbers instead of a single templated metric per item. Every
    # value here is already computed above from real financial-statement
    # data — nothing here is invented for the sake of narration.
    checklist_evidence = {
        "moat": {
            "avg_roic_pct": (dcf.get("growth_buildup") or {}).get("avg_roic_pct") if dcf else None,
            "quality_metric_label": (dcf.get("growth_buildup") or {}).get("quality_metric_label", "ROIC") if dcf else "ROIC",
            "roic_trend_pct": roic_trend if not _is_financial_sector(sector) else roe_trend,
            "gross_margin_trend_pct": gross_margin_trend,
            "operating_margin_trend_pct": operating_margin_trend,
            "revenue_cagr_pct": rev_cagr,
            "market_cap": round(market_cap, 0) if market_cap else None,
            "sector": sector,
        } if dcf else None,
        "business_quality": {
            "roic_score": roic_score, "operating_margin_score": margin_score,
            "net_margin_score": net_margin_score, "fcf_margin_score": fcf_margin_score,
            "growth_score": growth_score,
            "latest_operating_margin_pct": latest_om, "latest_net_margin_pct": latest_nm,
            "avg_fcf_margin_pct": round(avg_fcf_margin * 100, 1) if avg_fcf_margin is not None else None,
            "revenue_cagr_pct": rev_cagr,
        },
        "management_capital_allocation": {
            "buyback_rate_pct": (dcf.get("growth_buildup") or {}).get("buyback_rate_pct") if dcf else None,
            "payout_ratio_pct": round(payout_ratio_mgmt * 100, 1) if latest_ni_for_payout and latest_ni_for_payout > 0 else None,
            "net_income_cagr_pct": ni_cagr,
            "data_years_available": n,
        },
        "financial_strength": {
            "total_debt": round(total_debt, 0), "cash": round(cash_latest, 0), "net_cash": round(net_cash, 0),
            "interest_coverage_score": interest_coverage_score, "net_debt_to_cash_score": debt_score,
        },
        "growth_predictability": {
            "growth_outlook_score": growth_score_adj,
            "revenue_cagr_pct": rev_cagr, "fcf_cagr_pct": fcf_cagr, "net_income_cagr_pct": ni_cagr,
            "predictability_score": dcf.get("confidence_score") if dcf else None,
        },
        "valuation": dcf,
    }

    checklist_items_real = _build_checklist_items(dcf, thesis_scores, checklist_evidence) if dcf and thesis_scores else []

    return {
        "ticker": ticker,
        "company_name": profile.get("name", ticker),
        "sector": profile.get("finnhubIndustry"),
        "segments": segments,
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
        "quality_score_100": quality_score_100,
        "fair_value_score_100": fair_value_score,
        "investment_opportunity_score_100": investment_opportunity_score,
        "thesis_scores": thesis_scores,
        "checklist_items_real": checklist_items_real,
        "pe_ratio": pe_ratio,
        "ev_ebitda": ev_ebitda,
        "peg_ratio": peg_ratio,
        "ev_fcf": ev_fcf,
        "p_fcf": p_fcf,
        "dividend_yield_pct": dividend_yield_pct,
        "analyst_target": analyst_target,
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


def _fmt_yoy_trend(years: list[str], values: list[Optional[float]]) -> str:
    """Year-over-year % change per year (first year has no prior, skipped) —
    additional guidance for Claude on top of the raw per-year figures
    already shown, so an anomalous year (a capex ramp, a one-off dip) is an
    explicit, impossible-to-miss signal instead of something Claude would
    otherwise have to notice by eyeballing raw dollar figures."""
    pairs = []
    for i in range(1, len(values)):
        v, prev = values[i], values[i - 1]
        if v is None or prev is None or prev == 0:
            continue
        pct = (v - prev) / abs(prev) * 100
        pairs.append(f"{years[i]}: {pct:+.1f}%")
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
    ]
    segments = data.get("segments") or []
    if segments:
        lines.append("Segmentos de negocio (ingresos del último año fiscal reportado, reales — de los filings de la empresa vía FMP):")
        for s in segments:
            pct = f" ({s['pct_of_total']}% del total)" if s.get("pct_of_total") is not None else ""
            lines.append(f"  - {s['name']}: {_fmt_money(s['revenue'])}{pct}")
        lines.append("")
    else:
        lines.append("Segmentos de negocio: no disponibles para esta empresa — no los inventes, dilo explícitamente si el usuario pregunta por el desglose.")
        lines.append("")
    lines += [
        f"Ingresos por año ($): {_fmt_trend(years, [_fmt_money(v) if v is not None else None for v in data['revenue_trend']])}",
        f"Ingresos — variación % año contra año: {_fmt_yoy_trend(years, data['revenue_trend'])}",
        f"Ingresos CAGR ({data['data_years_available']}a): {data['revenue_cagr_pct']}%" if data["revenue_cagr_pct"] is not None else "Ingresos CAGR: N/D",
        f"FCF por año ($): {_fmt_trend(years, [_fmt_money(v) if v is not None else None for v in data['fcf_trend']])}",
        f"FCF — variación % año contra año (revisa si algún año destaca — puede indicar un pico/caída de capex u otro evento puntual, coméntalo si es relevante): {_fmt_yoy_trend(years, data['fcf_trend'])}",
        f"FCF CAGR: {data['fcf_cagr_pct']}%" if data["fcf_cagr_pct"] is not None else "FCF CAGR: N/D",
        f"Utilidad neta — variación % año contra año: {_fmt_yoy_trend(years, data['net_income_trend'])}",
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
        "",
        f"P/E actual: {data['pe_ratio']}x" if data.get("pe_ratio") is not None else "P/E actual: N/D",
        f"EV/EBITDA actual: {data['ev_ebitda']}x" if data.get("ev_ebitda") is not None else "EV/EBITDA actual: N/D",
        f"PEG ratio (P/E ÷ CAGR de ingresos real): {data['peg_ratio']}" if data.get("peg_ratio") is not None else "PEG ratio: N/D",
        f"EV/FCF actual (del FCF real del último año reportado, NO del FCF normalizado del DCF): {data['ev_fcf']}x" if data.get("ev_fcf") is not None else "EV/FCF: N/D",
        f"P/FCF actual: {data['p_fcf']}x" if data.get("p_fcf") is not None else "P/FCF: N/D",
        f"Dividend Yield actual (de dividendos reales pagados): {data['dividend_yield_pct']}%" if data.get("dividend_yield_pct") is not None else "Dividend Yield: N/D (no paga dividendos o no hay dato)",
        "Fase 9 — Multiple Check: NUNCA confíes solo en el DCF. Si el DCF da un resultado muy distinto a estos múltiplos "
        "(p.ej. el DCF dice 'barata' pero el P/E y el EV/EBITDA están en máximos históricos del sector), explícalo — no lo ignores ni asumas automáticamente que el mercado está equivocado.",
        "(Nota: no tengo el P/E histórico promedio de esta empresa — solo el actual. Si el usuario pregunta cómo se compara con su propio historial, dilo explícitamente en vez de inventarlo.)",
        "",
        f"Business Quality Score legacy (financiero, no lo muestres como tabla principal — usa el Investment Thesis Scorecard de abajo): {data['quality_score_100']}/100" if data["quality_score_100"] is not None else "Business Quality Score: N/D",
    ]

    ts = data.get("thesis_scores")
    if ts:
        lines.append("")
        lines.append(
            "Investment Thesis Scorecard (6 dimensiones reales, calculadas independientemente — NUNCA las promedies "
            "en un solo número, ese es justo el punto: una empresa puede ser 92 en calidad y 58 en valuation al mismo tiempo):"
        )
        lines.append(f"  - Business Quality (rentabilidad/ROIC, proxy de moat): {ts.get('business_quality')}/100" if ts.get('business_quality') is not None else "  - Business Quality: N/D")
        lines.append(f"  - Valuation (qué tan atractivo está el precio, del margen de seguridad real): {ts.get('valuation')}/100" if ts.get('valuation') is not None else "  - Valuation: N/D")
        lines.append(f"  - Predictability (qué tan predecible es el FCF — mismo Confidence Score real): {ts.get('predictability')}/100" if ts.get('predictability') is not None else "  - Predictability: N/D")
        lines.append(f"  - Financial Strength (deuda vs. caja real): {ts.get('financial_strength')}/100" if ts.get('financial_strength') is not None else "  - Financial Strength: N/D")
        lines.append(f"  - Growth Outlook (de la tasa de crecimiento ajustada por calidad real, no CAGR crudo): {ts.get('growth_outlook')}/100" if ts.get('growth_outlook') is not None else "  - Growth Outlook: N/D")
        lines.append(f"  - Management & Capital Allocation (tasa de recompra real + disciplina de deuda real): {ts.get('management_capital_allocation')}/100" if ts.get('management_capital_allocation') is not None else "  - Management & Capital Allocation: N/D")

    dcf = data.get("dcf")
    if dcf:
        lines.append("")
        lines.append(
            f"DCF calculado (2 etapas, {dcf['projection_years']} años, FCF base {_fmt_money(dcf['base_fcf'])} "
            f"[margen de FCF promedio {dcf['avg_fcf_margin_pct']}% × ingresos del último año — normalizado, no el "
            f"FCF crudo del último año, que puede estar distorsionado por un año de capex inusualmente alto o bajo], "
            f"tasa de descuento (WACC) {dcf['base_discount_rate_pct']}%, "
            f"crecimiento terminal {dcf['terminal_growth_pct']}% [ajustado por sector: {dcf.get('sector') or 'N/D'}], "
            f"deuda {_fmt_money(dcf['total_debt'])}, "
            f"caja {_fmt_money(dcf['cash'])}, acciones en circulación hoy {dcf['shares_outstanding']:,.0f}):"
        )
        wd = dcf.get("wacc_details") or {}
        if wd.get("method") == "capm":
            lines.append(
                f"WACC calculado con CAPM real: Beta {wd['beta']}, tasa libre de riesgo (bono Tesoro 10 años) "
                f"{wd['risk_free_rate_pct']}%, prima de riesgo de mercado {wd['equity_risk_premium_pct']}% → "
                f"costo de equity {wd['cost_of_equity_pct']}%. Costo de deuda {wd['cost_of_debt_pct']}% "
                f"(neto de escudo fiscal, tasa efectiva {wd['tax_rate_pct']}%). Ponderación: "
                f"{wd['equity_weight_pct']}% equity / {wd['debt_weight_pct']}% deuda (por valor de mercado)."
            )
        else:
            lines.append(
                f"WACC: no se pudo calcular con CAPM real (falta beta o tasa libre de riesgo en vivo) — "
                f"se usó una tasa proxy por sector como respaldo. Dilo explícitamente si el usuario pregunta cómo se calculó."
            )
        gb = dcf.get("growth_buildup") or {}
        if gb:
            lines.append(
                f"Cómo se construyó la tasa de crecimiento del NEGOCIO (ingresos/FCF totales) en el escenario base "
                f"(NUNCA solo el CAGR histórico — esto es real, no una estimación): CAGR histórico de ingresos "
                f"{gb['historical_growth_pct']}% + ajuste por moat (ROIC promedio real de {gb['avg_roic_pct']}%"
                f"{', sostenido — evidencia real de ventaja competitiva duradera' if gb.get('avg_roic_pct') and gb['avg_roic_pct'] >= 25 else ''}): "
                f"+{gb['moat_adjustment_pct']}pp "
                f"= **{gb['quality_adjusted_growth_pct']}% tasa de crecimiento ajustada por calidad** (antes de aplicar "
                f"el multiplicador de cada escenario pesimista/base/optimista). El TAM/crecimiento de la industria NO "
                f"está en este cálculo (no hay fuente de datos limpia) — usa tu conocimiento general de la industria "
                f"para ajustar cualitativamente hacia arriba o abajo en tu narrativa, dejando claro que esa parte es tu juicio."
            )
            if gb.get("buyback_rate_pct", 0) > 0:
                lines.append(
                    f"Recompras reales (Fase 6 — NUNCA se asume que las acciones en circulación se mantienen constantes): "
                    f"CAGR de FCF por acción real {gb['fcf_per_share_cagr_pct']}% creciendo más rápido que el FCF total "
                    f"→ tasa de reducción anual de acciones implícita {gb['buyback_rate_pct']}%/año (capada en 5%/año). "
                    f"Esto se proyecta hacia adelante como una REDUCCIÓN GRADUAL del conteo de acciones (no como un boost al "
                    f"crecimiento del negocio, para no contar el mismo efecto dos veces): acciones hoy {dcf['shares_outstanding']:,.0f} "
                    f"→ acciones proyectadas promedio durante el horizonte de 10 años {dcf['projected_shares_outstanding']:,.0f} "
                    f"— este es el denominador real usado en el valor intrínseco por acción de abajo, no el conteo actual."
                )
            else:
                lines.append(
                    "Recompras: no hay evidencia real de una tasa de recompra sostenida en los datos disponibles — se usa el "
                    "conteo de acciones actual sin proyectar reducción."
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
                    f"año {dcf['projection_years']} (último año proyectado) {_fmt_money(s['revenue_year5'])}"
                )
                lines.append(
                    f"      Proyección de FCF ({label.lower()}): año 1 {_fmt_money(s['fcf_year1'])}, "
                    f"año {dcf['projection_years']} (último año proyectado, base del valor terminal) {_fmt_money(s['fcf_year5'])}"
                )
        conf = dcf.get("confidence_score")
        if conf is not None:
            vol = dcf.get("fcf_volatility_cv")
            pw = dcf.get("probability_weights", {})
            lines.append(
                f"Confidence Score (0-100, qué tan predecible es el FCF real de esta empresa — NO es lo mismo que "
                f"la calidad del negocio): {conf}/100 (volatilidad de FCF, coef. de variación: {vol if vol is not None else 'N/D'}). "
                f"Esto determina las probabilidades usadas abajo: pesimista {round(pw.get('pessimistic', 0)*100)}%, "
                f"base {round(pw.get('base', 0)*100)}%, optimista {round(pw.get('optimistic', 0)*100)}% "
                f"(mayor confianza → más peso al escenario base; menor confianza → rango más amplio)."
            )
            lines.append(
                f"Valor esperado ponderado por probabilidad: ${dcf['expected_value_per_share']} "
                f"(= pesimista×{round(pw.get('pessimistic', 0)*100)}% + base×{round(pw.get('base', 0)*100)}% + "
                f"optimista×{round(pw.get('optimistic', 0)*100)}% — este es el número más honesto para comparar contra "
                f"el precio actual, más que cualquier escenario individual)."
            )
        ci = dcf.get("confidence_interval")
        if ci:
            lines.append(
                f"Intervalo de confianza del valor intrínseco (aproximación real basada en el rango pesimista-optimista "
                f"ya calculado, NO una distribución estadística formal — dilo así si el usuario pregunta cómo se calculó): "
                f"90% de confianza ${ci['90'][0]}-${ci['90'][1]} | 70% de confianza ${ci['70'][0]}-${ci['70'][1]} | "
                f"50% de confianza ${ci['50'][0]}-${ci['50'][1]}."
            )
        vd = dcf.get("value_drivers")
        if vd:
            lines.append(
                "Por qué el valor intrínseco es lo que es (contrafactuales reales — cada número es el DCF recalculado "
                "cambiando SOLO ese supuesto, manteniendo todo lo demás igual; NO son estimaciones):"
            )
            lines.append(f"  - Moat (ajuste por ROIC alto sostenido): {'+' if vd['moat_impact_per_share'] >= 0 else ''}{vd['moat_impact_per_share']}$/acción vs. si no existiera ese ajuste")
            lines.append(f"  - Recompras (reducción proyectada de acciones): {'+' if vd['buyback_impact_per_share'] >= 0 else ''}{vd['buyback_impact_per_share']}$/acción vs. si el conteo de acciones no cambiara")
            lines.append(f"  - Cada 1pp MENOS de WACC: {'+' if vd['wacc_impact_per_1pp_lower_per_share'] >= 0 else ''}{vd['wacc_impact_per_1pp_lower_per_share']}$/acción (así de sensible es el valor a la tasa de descuento)")
            if vd.get("margin_normalization_impact_per_share") is not None:
                lines.append(f"  - Normalizar el margen de FCF (promedio ponderado vs. el margen crudo del último año): {'+' if vd['margin_normalization_impact_per_share'] >= 0 else ''}{vd['margin_normalization_impact_per_share']}$/acción")
            lines.append(
                "Ordénalos de mayor a menor impacto absoluto para responder 'los 3 factores que más aumentan/reducen el valor' — nunca inventes un factor que no esté en esta lista."
            )
        sm = dcf.get("sensitivity_matrix")
        if sm:
            lines.append(
                f"Heatmap de sensibilidad (WACC en filas {sm['wacc_rows_pct']}%, crecimiento de FCF año 1 en columnas "
                f"{sm['growth_cols_pct']}%, valor intrínseco/acción en cada celda, todo real):"
            )
            for row_rate, row_vals in zip(sm["wacc_rows_pct"], sm["values"]):
                lines.append(f"  - WACC {row_rate}%: " + " | ".join(f"{g}%→${v}" for g, v in zip(sm["growth_cols_pct"], row_vals)))
        op_risk = dcf.get("operational_risk_label")
        val_risk = dcf.get("valuation_risk_label")
        if op_risk or val_risk:
            lines.append(
                f"Riesgo operativo (¿puede deteriorarse el NEGOCIO? — del Confidence Score real): {op_risk or 'N/D'}. "
                f"Riesgo de valoración (¿está el PRECIO vulnerable a una re-valuación aunque el negocio funcione bien? — "
                f"del margen de seguridad real): {val_risk or 'N/D'}. NUNCA los mezcles en un solo 'riesgo' — son preguntas distintas."
            )
        lines.append(
            f"Margen de seguridad (escenario base vs. precio actual ${dcf['current_price']}): {dcf['margin_of_safety_pct']}%"
        )
        sens = dcf.get("sensitivity")
        if sens:
            lines.append(
                f"Sensibilidad del valor intrínseco a la tasa de descuento (escenario base, crecimiento fijo en "
                f"{dcf['scenarios']['base']['stage1_growth_pct']}%, terminal {dcf['terminal_growth_pct']}%) — "
                f"muestra qué tan sensible es la valoración al supuesto de tasa, independientemente del sector:"
            )
            for rate_pct, val in sens:
                lines.append(f"  - Tasa de descuento {rate_pct}%: valor intrínseco/acción ${val}")
        implied = dcf.get("implied_growth_pct")
        if implied is not None:
            lines.append(
                f"DCF INVERSO — qué está pagando el mercado hoy: manteniendo el mismo WACC ({dcf['base_discount_rate_pct']}%) "
                f"y crecimiento terminal ({dcf['terminal_growth_pct']}%) fijos, el precio actual (${dcf['current_price']}) "
                f"implica un crecimiento de FCF en el año 1 de **{implied}%** para que el DCF cuadre con ese precio. "
                f"Compara este {implied}% contra el CAGR de FCF/ingresos real de la empresa (arriba) para explicarle al "
                f"usuario qué tan optimista o realista es esa expectativa — esto es lo que el inversionista está comprando: "
                f"la apuesta de que la empresa va a crecer a ese ritmo, no solo un número de 'cara/barata'."
            )
        else:
            lines.append(
                "DCF INVERSO: no se pudo calcular un crecimiento implícito razonable para el precio actual "
                "(el precio requeriría una tasa de crecimiento fuera de un rango realista) — dilo explícitamente si es relevante."
            )

        ei = dcf.get("expectations_investing")
        if ei:
            src_label = (
                "Owner Earnings del año más reciente real" if ei["fcf0_source"] == "owner_earnings_latest_year"
                else "FCF base normalizado del DCF (fallback — Owner Earnings del último año no estaba disponible o era negativo)"
            )
            lines.append(
                f"\nMÓDULO REVERSE DCF — EXPECTATIONS INVESTING (real, calculado — describe una apuesta implícita "
                f"verificable, NUNCA un veredicto de compra/venta): FCF base usado = {_fmt_money(ei['fcf0'])} ({src_label}). "
                f"El mercado está pagando {ei['implied_multiple_pfcf']}x ese FCF (Market Cap / FCF base)."
            )
            lines.append(
                "Tasa de crecimiento CONSTANTE de FCF (10 años, sin desvanecimiento a terminal — a diferencia del DCF "
                "INVERSO de arriba) que reconcilia el precio actual, para cada una de las 3 tasas de descuento ya usadas "
                "en los escenarios de la sección 15 (real, misma estructura EV = Σ FCF/(1+r)^t + Terminal Value):"
            )
            for row in ei["growth_by_rate"]:
                g_txt = f"{row['implied_growth_pct']}%" if row["implied_growth_pct"] is not None else "N/D (fuera de rango razonable)"
                lines.append(f"  - Tasa de descuento {row['discount_rate_pct']}% ({row['scenario']}): crecimiento de FCF implícito {g_txt}")
            if ei.get("fcf_year10_base_scenario") is not None:
                lines.append(
                    f"Sanity check (Paso 3, escenario de tasa media/base): a esa tasa de crecimiento, el FCF del año 10 "
                    f"proyectado sería {_fmt_money(ei['fcf_year10_base_scenario'])} (partiendo de {_fmt_money(ei['fcf0'])} hoy). "
                    f"Compara esta cifra contra una referencia externa reconocible (ingresos/FCF de una empresa conocida de "
                    f"tamaño similar, o el tamaño actual del TAM de la industria) para darle contexto tangible — esto es tu "
                    f"conocimiento general, dilo como tal."
                )
                lines.append(
                    "Precedentes históricos de sostener esa tasa de crecimiento de FCF constante 10 años seguidos (no "
                    "promedio): si no puedes verificarlo con precisión desde tu conocimiento, dilo explícitamente en vez "
                    "de inventar una cifra o un número de empresas."
                )
            lines.append(
                f"Evidencia real de ciclicidad: en los {ei['years_available']} años de historial disponibles, el FCF tuvo "
                f"{ei['historical_fcf_decline_years']} año(s) de caída interanual real — {'consistente con una historia de crecimiento genuinamente irregular, no hipotética' if ei['historical_fcf_decline_years'] > 0 else 'sin caídas registradas en el periodo disponible'}. "
                f"Confronta esto contra los riesgos ya identificados (sección 9: concentración, competencia, ciclicidad) al "
                f"evaluar si sostener el crecimiento implícito sin interrupción es consistente con el historial real."
            )
            if ei["years_available"] < 5:
                lines.append(
                    "Advertencia: menos de 5 años de historial disponible — la comparación contra el CAGR histórico propio "
                    "tiene menor poder predictivo aquí. Dilo explícitamente."
                )
    else:
        lines.append("")
        lines.append("DCF: no se pudo calcular (falta FCF positivo, precio o acciones en circulación reales) — dilo explícitamente, no inventes un valor intrínseco.")

    at = data.get("analyst_target")
    if at and at.get("target_mean"):
        lines.append("")
        lines.append(
            f"[REFERENCIA SEPARADA — NO ES UN DCF] Precio objetivo de consenso de analistas de Wall Street: "
            f"promedio ${at['target_mean']}, rango ${at.get('target_low', 'N/D')}-${at.get('target_high', 'N/D')}. "
            f"Esto normalmente sale de aplicar un múltiplo (P/E, EV/EBITDA) a ganancias futuras estimadas, NO de un "
            f"DCF de flujo de caja — puede diverger mucho del valor intrínseco calculado arriba, especialmente en "
            f"empresas con múltiplos altos. Preséntalo como una referencia adicional, aclarando esta diferencia de "
            f"metodología — nunca lo mezcles con el valor intrínseco calculado ni promedies ambos."
        )

    return "\n".join(lines)
