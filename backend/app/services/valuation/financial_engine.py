"""
Financial Sector Fair Value Engine — Residual Income / Excess Return Model.

Banks/insurers/credit-card networks/brokers/asset managers don't generate a
normal "free cash flow" the way the standard 2-stage FCF DCF
(`dcf_engine.project_driver_based_dcf`) assumes — deposits, underwriting
float, and regulatory capital requirements make "operating cash flow minus
capex" close to meaningless for these businesses (confirmed for real with
Progressive Corp, whose FCF-DCF produced a 7x-of-price intrinsic value
purely from this mismatch — see `_is_financial_sector`'s docstring in
`fundamental_analysis_service.py`). Real economic value for a financial
institution comes from its capacity to earn a return on capital (ROE) ABOVE
its own cost of that capital (Cost of Equity) — this module values that
directly.

Same 3-scenario (Bear/Base/Bull) architecture and output shape as the
non-financial `nuvos_fair_value` (see `fundamental_analysis_service.py`'s
BEAR_BASE_BULL loop) — the user never sees "Residual Income Model" vs "DCF"
as two different things, only ONE "Nuvos AI Fair Value Engine" with three
scenarios. The method differs internally depending on the company's economic
nature; the shape returned here is deliberately compatible with
`combine_fair_value_range`/`compute_confidence_meter_v3`/the checklist/the
screener, which all already read `nuvos_fair_value` generically.

Math (verified to collapse exactly onto the closed-form Justified P/B
formula — (ROE-g)/(CoE-g) — when ROE is held constant from year 0, i.e.
this is a strict generalization, not a reinvention):

    Year 1..N (N=10, explicit projection, ROE glides from today's real
    level toward a normalized terminal level — never assumed constant
    forever):
        net_income_t    = book_value_(t-1) * roe_path[t]
        dividends_t      = net_income_t * payout_path[t]
        book_value_t     = book_value_(t-1) + net_income_t - dividends_t
        equity_charge_t  = book_value_(t-1) * cost_of_equity
        residual_income_t = net_income_t - equity_charge_t
        pv_ri_t          = residual_income_t / (1+cost_of_equity)^t

    Terminal (perpetuity of RESIDUAL income only, from year N+1 onward —
    NOT "book value", which is why book_value_0 is added exactly once,
    never double-counted):
        terminal_residual_value = book_value_N * (terminal_roe - cost_of_equity) / (cost_of_equity - terminal_growth)
        pv_terminal              = terminal_residual_value / (1+cost_of_equity)^N

    equity_value     = book_value_0 + sum(pv_ri_t) + pv_terminal
    value_per_share  = equity_value / shares_outstanding

ROE > Cost of Equity => residual_income_t > 0 => creates value.
ROE < Cost of Equity => residual_income_t < 0 => destroys value.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Optional

from scipy.optimize import brentq

from app.services.valuation.numeric_helpers import (
    _cagr, _score, _coefficient_of_variation, calc_margin_of_safety, STABILITY_CV_TIERS,
)
from app.services.valuation.robustness import clamp
from app.services.valuation.assumptions_engine import compute_weighted_assumption, AssumptionFactor
from app.services.valuation.dcf_engine import recency_weighted_average
from app.services.quality.quality_engine import compute_cagr_windows

_PROJECTION_YEARS = 10
_TERMINAL_GROWTH_CEILING = 0.04  # same long-run real-GDP-ish ceiling the previous model used
_COST_OF_EQUITY_FLOOR = 0.07     # practitioner floor (Damodaran-style) — CAPM with a low beta understates a financial's real equity risk
_MIN_ROE_POINTS = 2              # a single data point isn't a trend
_MIN_PEERS_FOR_BENCHMARK = 3

SCENARIO_CONFIG_VERSION = "financial-v1.0.0"


# ── 1. Sub-sector classification (informational only — never a separate visible method) ──

_SUBSECTOR_KEYWORDS = [
    ("banks", ("bank", "banks")),
    ("insurance", ("insurance", "reinsurance")),
    ("credit_cards_payments", ("credit services", "credit card", "payment")),
    ("asset_management", ("asset management", "investment management")),
    ("capital_markets", ("capital markets", "investment banking", "brokerage", "exchange")),
    ("consumer_finance", ("consumer finance", "consumer lending")),
    ("diversified_financials", ("diversified financial", "financial services", "financial data")),
]


def classify_financial_subsector(sector: Optional[str], industry: Optional[str]) -> str:
    """Keyword-based classification over the REAL sector/industry strings
    the data provider already returns — never guesses from the ticker
    alone. Purely informational (surfaced in the payload for transparency
    and used for one small payout-floor nudge below); does NOT branch the
    core valuation math into visibly different "methods"."""
    haystack = f"{industry or ''} {sector or ''}".lower()
    for label, keywords in _SUBSECTOR_KEYWORDS:
        if any(k in haystack for k in keywords):
            return label
    return "other_financial"


# ── 2. Core math — pure, no network ──────────────────────────────────────────

@dataclass
class ResidualIncomeYearRow:
    year: int
    book_value_start: float
    roe_pct: float
    net_income: float
    dividends: float
    retained_earnings: float
    book_value_end: float
    equity_charge: float
    residual_income: float
    discounted_residual_income: float


@dataclass
class ResidualIncomeResult:
    yearly: list[ResidualIncomeYearRow]
    pv_of_residual_income_sum: float
    terminal_value: float
    pv_of_terminal_value: float
    equity_value: float
    value_per_share: Optional[float]
    implied_terminal_pb: Optional[float]
    terminal_growth_used: float
    terminal_growth_clamped: bool


def project_residual_income_valuation(
    book_value_0: float,
    roe_path: list[float],
    payout_path: list[float],
    cost_of_equity: float,
    terminal_growth: float,
    terminal_roe: float,
    shares_out: Optional[float] = None,
) -> ResidualIncomeResult:
    """Pure residual-income projection — see module docstring for the full
    derivation. `roe_path`/`payout_path` are decimals (0.15 = 15%), one
    entry per explicit year (same length, oldest/nearest year first).
    `cost_of_equity` is held constant across the explicit period (a single
    scenario-level input, not a path) — the SCENARIO itself is what varies
    cost of equity, not the year-by-year path within one scenario, matching
    how CAPM cost of equity is a point-in-time estimate, not something that
    predictably drifts year to year.

    Guard: the terminal perpetuity requires `cost_of_equity > terminal_growth`
    strictly, same as any Gordon-growth terminal value — clamps
    `terminal_growth` to `cost_of_equity - 0.005` rather than dividing by a
    ~zero or negative denominator, and reports the clamp via
    `terminal_growth_clamped` so the caller can flag it as a real data-
    quality signal rather than silently absorbing it."""
    n = len(roe_path)
    terminal_growth_clamped = cost_of_equity <= terminal_growth
    g = min(terminal_growth, cost_of_equity - 0.005) if terminal_growth_clamped else terminal_growth

    yearly: list[ResidualIncomeYearRow] = []
    bv = book_value_0
    pv_sum = 0.0
    for t, (roe, payout) in enumerate(zip(roe_path, payout_path), start=1):
        bv_start = bv
        net_income = bv_start * roe
        dividends = net_income * payout
        retained = net_income - dividends
        bv_end = bv_start + retained
        equity_charge = bv_start * cost_of_equity
        residual_income = net_income - equity_charge
        discounted = residual_income / (1 + cost_of_equity) ** t
        pv_sum += discounted
        yearly.append(ResidualIncomeYearRow(
            year=t, book_value_start=round(bv_start, 2), roe_pct=round(roe * 100, 2),
            net_income=round(net_income, 2), dividends=round(dividends, 2),
            retained_earnings=round(retained, 2), book_value_end=round(bv_end, 2),
            equity_charge=round(equity_charge, 2), residual_income=round(residual_income, 2),
            discounted_residual_income=round(discounted, 2),
        ))
        bv = bv_end

    book_value_n = bv
    coe_minus_g = cost_of_equity - g
    if coe_minus_g > 1e-6:
        terminal_residual_value = book_value_n * (terminal_roe - cost_of_equity) / coe_minus_g
        implied_terminal_pb = (terminal_roe - g) / coe_minus_g
    else:
        terminal_residual_value = 0.0
        implied_terminal_pb = None
    pv_terminal = terminal_residual_value / (1 + cost_of_equity) ** n if n > 0 else 0.0

    equity_value = book_value_0 + pv_sum + pv_terminal
    value_per_share = round(equity_value / shares_out, 2) if shares_out else None

    return ResidualIncomeResult(
        yearly=yearly,
        pv_of_residual_income_sum=round(pv_sum, 2),
        terminal_value=round(terminal_residual_value, 2),
        pv_of_terminal_value=round(pv_terminal, 2),
        equity_value=round(equity_value, 2),
        value_per_share=value_per_share,
        implied_terminal_pb=round(implied_terminal_pb, 2) if implied_terminal_pb is not None else None,
        terminal_growth_used=round(g, 4),
        terminal_growth_clamped=terminal_growth_clamped,
    )


def _fade_path(start: float, target: float, years: int = _PROJECTION_YEARS) -> list[float]:
    """Linear fade from `start` (year-1 level) to `target` (by year N) —
    same fade shape `legacy_dcf_core._project_path` already uses for the
    FCF engine's growth glide (`g(yr) = g1 + (terminal-g1)*(yr/years)`), so
    a company's ROE isn't assumed to snap to its terminal level abruptly,
    nor held at today's level for 10 years and THEN jump."""
    return [start + (target - start) * (y / years) for y in range(1, years + 1)]


# ── 3. Scenario-width calibration — continuous, not a fixed table ────────────

def _financial_predictability_score(roe_trend: list[Optional[float]]) -> Optional[float]:
    """Real signal of how stable this company's ROE has actually been
    (coefficient of variation of the real historical trend) — reuses the
    same CV->score tiers (`STABILITY_CV_TIERS`) every other stability
    signal in this codebase already uses (moat/quality/capital-allocation
    engines), so "predictable" means the same thing everywhere. None when
    there isn't enough history to compute a real CV (< 3 points)."""
    cv = _coefficient_of_variation(roe_trend)
    return _score(cv, STABILITY_CV_TIERS) if cv is not None else None


def _terminal_roe_cap(cost_of_equity: float, business_quality_score: Optional[float]) -> float:
    """An elite, durable-moat financial franchise (top decile business
    quality) can sustain a real spread over its cost of equity forever —
    but even the best insurer/bank doesn't compound an extreme historical
    ROE (e.g. 30%+) into infinity; competition and regulatory capital
    requirements erode an unbounded edge over a long enough horizon. Caps
    the TERMINAL (not the explicit-year) ROE at cost_of_equity + a spread
    that scales with real business quality — 2pp for an unscored/mediocre
    business, up to 10pp for a top-quality one. `business_quality_score
    =None` (data gap) falls back to the neutral midpoint, same convention
    as `bear_base_bull_growth_cap_pct`."""
    quality = business_quality_score if business_quality_score is not None else 50.0
    max_spread_pp = 2.0 + (quality / 100.0) * 8.0
    return cost_of_equity + max_spread_pp / 100.0


def _financial_scenario_deltas(predictability_score: Optional[float], business_quality_score: Optional[float]) -> dict:
    """Bear/Base/Bull deltas (ROE in pp, Cost of Equity in pct, terminal
    growth in pp) that WIDEN for a volatile/lower-quality financial and
    NARROW for a predictable, high-quality one — the same "no arbitrary
    +-30%" principle `bear_base_bull_growth_cap_pct` already applies to the
    FCF engine's growth ceiling, applied here to the two levers (ROE, cost
    of equity) that actually drive this model's value. Both missing inputs
    fall back to the neutral midpoint (50) rather than skipping the
    scenario."""
    predictability = predictability_score if predictability_score is not None else 50.0
    quality = business_quality_score if business_quality_score is not None else 50.0
    combined = (predictability + quality) / 2.0
    # combined=100 (very predictable + very high quality) -> swing=0.4 (narrow band)
    # combined=50  (neutral, unscored)                    -> swing=1.0 (base band)
    # combined=0   (unpredictable + low quality)           -> swing=2.2 (wide band)
    swing = clamp(1.0 + (50.0 - combined) / 50.0 * 1.2, 0.4, 2.2)

    base_roe_delta_pp = 3.0 * swing
    base_coe_delta_pct = clamp(0.6 * swing, 0.3, 2.0)
    base_terminal_growth_delta_pp = 0.5 * swing

    return {
        "bear": {
            "roe_delta_pp": -base_roe_delta_pp,
            "coe_delta_pct": base_coe_delta_pct,
            "terminal_growth_delta_pp": -base_terminal_growth_delta_pp,
            "payout_delta": 0.0,
        },
        "base": {
            "roe_delta_pp": 0.0,
            "coe_delta_pct": 0.0,
            "terminal_growth_delta_pp": 0.0,
            "payout_delta": 0.0,
        },
        "bull": {
            "roe_delta_pp": base_roe_delta_pp,
            "coe_delta_pct": -base_coe_delta_pct * 0.7,  # asymmetric: cost of equity rarely drops as much as it rises in stress
            "terminal_growth_delta_pp": base_terminal_growth_delta_pp,
            "payout_delta": 0.0,
        },
    }


# ── 4. Real peer benchmarks (ROE / P-B / P-E) — none exist elsewhere in the codebase ──

@dataclass
class FinancialPeerBenchmarks:
    peer_count: int
    peers_used: list[str]
    median_roe_pct: Optional[float]
    median_pb: Optional[float]
    median_pe: Optional[float]


def compute_financial_peer_benchmarks(
    ticker: str, sector: Optional[str], industry: Optional[str],
    analysis_cache: Optional[dict[str, Optional[dict]]] = None,
) -> Optional[FinancialPeerBenchmarks]:
    """Real median ROE/P-B/P-E across the company's actual real peers (same
    universe + peer-matching `relative_valuation_service._find_peers`
    already uses — real tickers only, never invented). Returns None if
    fewer than `_MIN_PEERS_FOR_BENCHMARK` real peers have computable data —
    same "no fabricated benchmark" convention as `industry_engine.
    compute_industry_benchmarks`, whose peer-fetch/analysis_cache pattern
    this mirrors exactly (nothing here duplicates ROIC/margin/FCF
    benchmarks — those stay in industry_engine)."""
    from app.services.relative_valuation_service import _find_peers
    from app.services.fundamental_analysis_service import get_fundamental_analysis

    peers = _find_peers(ticker, sector, industry)
    if len(peers) < _MIN_PEERS_FOR_BENCHMARK:
        return None

    roe_vals, pb_vals, pe_vals = [], [], []
    real_peers: list[str] = []
    for peer_ticker in peers:
        if analysis_cache is not None and peer_ticker in analysis_cache:
            peer_data = analysis_cache[peer_ticker]
        else:
            try:
                peer_data = get_fundamental_analysis(peer_ticker, _compute_peer_dependent_data=False)
            except Exception:
                continue
            if analysis_cache is not None:
                analysis_cache[peer_ticker] = peer_data
        if not peer_data:
            continue
        real_peers.append(peer_ticker)

        peer_dcf = peer_data.get("dcf") or {}
        if peer_dcf.get("avg_roe_pct") is not None:
            roe_vals.append(peer_dcf["avg_roe_pct"])
        book_value_per_share = peer_dcf.get("book_value_per_share")
        peer_price = peer_data.get("current_price")
        if book_value_per_share and peer_price:
            pb_vals.append(peer_price / book_value_per_share)
        if peer_data.get("pe_ratio") is not None:
            pe_vals.append(peer_data["pe_ratio"])

    if len(real_peers) < _MIN_PEERS_FOR_BENCHMARK:
        return None

    return FinancialPeerBenchmarks(
        peer_count=len(real_peers), peers_used=real_peers,
        median_roe_pct=round(statistics.median(roe_vals), 1) if roe_vals else None,
        median_pb=round(statistics.median(pb_vals), 2) if pb_vals else None,
        median_pe=round(statistics.median(pe_vals), 1) if pe_vals else None,
    )


# ── 5. Reverse valuation — "what ROE is the market pricing in?" ─────────────

def _implied_roe(
    book_value_0: float, payout_path: list[float], cost_of_equity: float,
    terminal_growth: float, shares_out: float, target_price: float,
) -> Optional[float]:
    """Financial-sector version of the reverse DCF (see reverse_dcf_engine.
    _implied_growth_rate's identical bracket-then-brentq pattern) — holds
    cost of equity and terminal growth fixed at Nuvos's own base-scenario
    estimates, solves for the flat ROE level that reconciles today's price
    with the model. Returns None if no ROE in a wide, sane search range
    reconciles the two."""
    def equity_at(roe_flat: float) -> Optional[float]:
        n = len(payout_path)
        roe_path = [roe_flat] * n
        result = project_residual_income_valuation(
            book_value_0, roe_path, payout_path, cost_of_equity, terminal_growth, roe_flat, shares_out,
        )
        return result.value_per_share

    lo, hi = -0.10, 0.80
    v_lo, v_hi = equity_at(lo), equity_at(hi)
    if v_lo is None or v_hi is None or v_lo > target_price or v_hi < target_price:
        return None
    roe_implied = brentq(lambda r: equity_at(r) - target_price, lo, hi, xtol=1e-6)
    return round(roe_implied * 100, 1)


# ── 6. One scenario, end to end ──────────────────────────────────────────────

def build_financial_scenario(
    book_value_0: float, shares_out: float, roe_initial: float, roe_target_base: float,
    cost_of_equity_base: float, payout_current: float, base_terminal_growth: float,
    deltas: dict, business_quality_score: Optional[float],
) -> dict:
    """One Bear/Base/Bull scenario. `roe_target_base` (already blended from
    historical/peers/business-quality via compute_weighted_assumption) gets
    the scenario's ROE delta; `cost_of_equity_base` gets its cost-of-equity
    delta; the terminal ROE is additionally capped (`_terminal_roe_cap`) so
    even the Bull case doesn't extrapolate an extraordinary ROE forever."""
    roe_target = roe_target_base + deltas["roe_delta_pp"] / 100
    cost_of_equity = max(cost_of_equity_base + deltas["coe_delta_pct"] / 100, 0.02)
    terminal_growth = clamp(base_terminal_growth + deltas["terminal_growth_delta_pp"] / 100, 0.0, _TERMINAL_GROWTH_CEILING)
    terminal_roe = min(roe_target, _terminal_roe_cap(cost_of_equity, business_quality_score))

    roe_path = _fade_path(roe_initial, terminal_roe, _PROJECTION_YEARS)
    terminal_payout = clamp(1 - terminal_growth / terminal_roe, 0.0, 1.0) if terminal_roe > 1e-6 else 1.0
    payout_path = _fade_path(payout_current, terminal_payout, _PROJECTION_YEARS)

    result = project_residual_income_valuation(
        book_value_0, roe_path, payout_path, cost_of_equity, terminal_growth, terminal_roe, shares_out,
    )

    return {
        "fair_value_per_share": result.value_per_share,
        "assumptions": {
            "revenue_growth_1_pct": round(roe_path[0] * 100, 2),  # reused key: EPS/ROE-driven growth in year 1 (see NuvosScenarioAssumptions — field names are generic in the frontend, never inspected semantically)
            "terminal_growth_pct": round(terminal_growth * 100, 2),
            "discount_rate_pct": round(cost_of_equity * 100, 2),  # cost of equity, not WACC
            "terminal_operating_margin_pct": round(terminal_roe * 100, 2),  # reused key: terminal ROE
            "operating_margin_anchor_pct": round(roe_initial * 100, 2),      # reused key: initial ROE
            "exit_multiple": result.implied_terminal_pb,
            "exit_metric": "price_to_book",
            "terminal_value_method": "residual_income_perpetuity",
            "high_growth_years": 0,
            "tax_rate_pct": None,
            "reinvestment_rate_anchor_pct": round(payout_path[0] * 100, 2),   # reused key: year-1 payout ratio
            "terminal_reinvestment_rate_pct": round(terminal_payout * 100, 2),  # reused key: terminal payout ratio
            "gordon_terminal_value": result.terminal_value,
            "gordon_sanity_check_ratio": None,
            "implied_fcf_margin_pct_year_n": None,
        },
        "yearly": [
            {
                "year": row.year, "revenue": row.book_value_start, "revenue_growth_pct": row.roe_pct,
                "operating_margin_pct": row.roe_pct, "ebit": row.net_income, "tax_rate_pct": None,
                "nopat": row.net_income, "reinvestment_rate_pct": round((row.dividends / row.net_income * 100), 2) if row.net_income else None,
                "reinvestment": row.retained_earnings, "fcf": row.residual_income, "discounted_fcf": row.discounted_residual_income,
            }
            for row in result.yearly
        ],
        "pv_of_fcf_sum": result.pv_of_residual_income_sum,
        "terminal_value": result.terminal_value,
        "pv_of_terminal_value": result.pv_of_terminal_value,
        "enterprise_value": result.equity_value,  # no separate EV concept for a financial — equity IS the value bridge
        "equity_value": result.equity_value,
        "fcf_conversion_pct": None,
        "_roe_initial_pct": round(roe_initial * 100, 2),
        "_roe_terminal_pct": round(terminal_roe * 100, 2),
        "_cost_of_equity_pct": round(cost_of_equity * 100, 2),
        "_terminal_growth_pct": round(terminal_growth * 100, 2),
        "_terminal_growth_clamped": result.terminal_growth_clamped,
    }


# ── 7. Orchestration — bear/base/bull + growth factors + reverse valuation + sensitivity + sanity checks ──

_SECTOR_NOTE_TEXT = (
    "En empresas financieras, Nuvos estima el valor principalmente a partir de la capacidad de generar "
    "retornos sobre el capital por encima de su costo de equity. Por eso el modelo utiliza ROE, crecimiento "
    "del capital y costo de equity en lugar del flujo de caja libre tradicional."
)


def build_financial_fair_value(
    ticker: str,
    sector: Optional[str],
    industry: Optional[str],
    price: float,
    shares_out: float,
    roe_trend: list[Optional[float]],
    eps_trend: list[Optional[float]],
    book_value_trend: list[Optional[float]],
    latest_dividends_paid: Optional[float],
    latest_net_income: Optional[float],
    total_debt: float,
    cash: float,
    cost_of_equity_capm: float,
    business_quality_score: Optional[float],
    latest_eps: Optional[float],
    pe_ratio: Optional[float],
    wall_street_eps_growth_next_year_pct: Optional[float],
    wacc_details: dict,
    analysis_cache: Optional[dict[str, Optional[dict]]] = None,
    compute_peer_dependent_data: bool = True,
) -> Optional[dict]:
    """Full financial-sector `dcf` dict — same top-level shape the standard
    FCF engine returns (methodology/scenarios/fair_value_range/
    margin_of_safety_pct/confidence_score/growth_buildup/...), PLUS a real
    `nuvos_fair_value` (Bear/Base/Bull, previously ABSENT for financial
    companies — the old `_build_financial_sector_valuation` never built
    this, which meant the 3-scenario UI never had real data to render for
    a bank/insurer). Returns None when there isn't enough real data to
    value the company reliably (mirrors the old model's gate: needs >=2
    real ROE points, real positive book equity, shares, and price).

    `compute_peer_dependent_data=False` (mirrors `get_fundamental_analysis`'s
    own parameter of the same name/purpose) skips
    `compute_financial_peer_benchmarks` — REQUIRED for any caller fetching a
    PEER's own analysis: financial-sector peers are frequently mutual
    (JPM and BAC are each other's peer in the curated UNIVERSE), so without
    this gate, computing JPM's peer benchmarks fetches BAC's full analysis,
    which — unguarded — would itself compute BAC's OWN peer benchmarks
    (fetching JPM again, and C, and every other mutual peer), a real
    unbounded recursion confirmed via a live smoke test (JPM's peer fetch
    of BAC/C never terminated). The top-level caller
    (fundamental_analysis_service.get_fundamental_analysis) passes its own
    `_compute_peer_dependent_data` straight through here."""
    roe_valid = [v for v in roe_trend if v is not None]
    book_value_0 = book_value_trend[-1] if book_value_trend and book_value_trend[-1] is not None else None
    if len(roe_valid) < _MIN_ROE_POINTS or not book_value_0 or book_value_0 <= 0 or not shares_out or not price:
        return None

    dividends_missing = latest_dividends_paid is None or latest_net_income is None
    cost_of_equity_base = max(cost_of_equity_capm, _COST_OF_EQUITY_FLOOR)

    roe_pairs = [(i, v / 100) for i, v in enumerate(roe_trend) if v is not None]
    roe_initial = recency_weighted_average(roe_pairs)

    payout_current = (
        clamp(latest_dividends_paid / latest_net_income, 0.0, 1.0)
        if latest_dividends_paid is not None and latest_net_income and latest_net_income > 0 else 0.0
    )

    predictability_score = _financial_predictability_score(roe_trend)

    # ── Real peer benchmarks (ROE / P-B / P-E) — real tickers only, N/D if too few.
    #    Gated by compute_peer_dependent_data — see this function's docstring
    #    for why (recursion guard, same convention as get_fundamental_analysis). ──
    peer_benchmarks = (
        compute_financial_peer_benchmarks(ticker, sector, industry, analysis_cache)
        if compute_peer_dependent_data else None
    )

    # ── EPS growth: historical (own 3Y/5Y CAGR) blended with Wall Street consensus
    #    and a business-quality view — no real per-peer EPS-CAGR source exists yet
    #    in this codebase (industry_engine only tracks ROIC/margins/FCF/revenue,
    #    see compute_financial_peer_benchmarks's docstring), so the "industry"
    #    factor is left None here rather than approximated — compute_weighted_
    #    assumption already reweights correctly over whatever IS real. ──
    eps_windows = compute_cagr_windows(eps_trend)
    historical_eps_growth_pct = eps_windows.get("5y") if eps_windows.get("5y") is not None else eps_windows.get("3y")
    # A moderate, BOUNDED quality nudge (never allowed to dominate — see
    # compute_weighted_assumption's 20% weight cap) — same spirit as
    # bear_base_bull_growth_cap_pct's quality_swing, mapped onto a plausible
    # EPS-growth range instead of a revenue-growth cap.
    quality_growth_view_pct = None
    if business_quality_score is not None:
        quality_growth_view_pct = -2.0 + (business_quality_score / 100.0) * 14.0  # -2%..12%
    eps_growth_result = compute_weighted_assumption(
        dimension="eps_growth",
        historical_value_pct=historical_eps_growth_pct,
        industry_value_pct=None,
        wall_street_value_pct=wall_street_eps_growth_next_year_pct,
        business_quality_value_pct=quality_growth_view_pct,
    )

    # ── ROE: historical (recency-weighted own trend) blended with real peer
    #    median ROE and a business-quality view — no Wall Street ROE consensus
    #    exists as a data source, left None (reweighted away, not faked). ──
    quality_roe_view_pct = None
    if business_quality_score is not None:
        quality_roe_view_pct = 5.0 + (business_quality_score / 100.0) * 20.0  # 5%..25%
    roe_result = compute_weighted_assumption(
        dimension="roe",
        historical_value_pct=round(roe_initial * 100, 2) if roe_initial is not None else None,
        industry_value_pct=peer_benchmarks.median_roe_pct if peer_benchmarks else None,
        wall_street_value_pct=None,
        business_quality_value_pct=quality_roe_view_pct,
    )
    roe_target_base = (roe_result.blended_value_pct / 100) if roe_result.blended_value_pct is not None else roe_initial

    book_value_windows = compute_cagr_windows(book_value_trend)
    # Base-scenario terminal growth: sustainable book-value growth at the
    # blended ROE and current payout — same cap the old model used (4%,
    # roughly long-run nominal GDP), never assumed higher just because a
    # company's historical ROE happens to be extreme.
    base_terminal_growth = min(max(roe_target_base * (1 - payout_current), 0.0), _TERMINAL_GROWTH_CEILING)

    deltas = _financial_scenario_deltas(predictability_score, business_quality_score)
    scenarios = {
        name: build_financial_scenario(
            book_value_0, shares_out, roe_initial, roe_target_base, cost_of_equity_base,
            payout_current, base_terminal_growth, delta, business_quality_score,
        )
        for name, delta in deltas.items()
    }

    base_scenario = scenarios["base"]
    if base_scenario["fair_value_per_share"] is None or base_scenario["fair_value_per_share"] <= 0:
        return None

    book_value_per_share = book_value_0 / shares_out
    margin_of_safety = calc_margin_of_safety(base_scenario["fair_value_per_share"], price)
    expected_value_per_share = round(
        scenarios["bear"]["fair_value_per_share"] * 0.25
        + scenarios["base"]["fair_value_per_share"] * 0.5
        + scenarios["bull"]["fair_value_per_share"] * 0.25, 2,
    )

    price_implied_scenario = min(
        scenarios.items(), key=lambda kv: abs((kv[1]["fair_value_per_share"] or 0) - price),
    )[0]

    # ── Reverse valuation — "what ROE is the market pricing in?" (financial
    #    equivalent of the Reverse DCF, held at the BASE scenario's real
    #    cost of equity/terminal growth, same convention _implied_growth_
    #    rate uses in reverse_dcf_engine.py). ──
    base_payout_path = _fade_path(
        payout_current,
        clamp(1 - base_terminal_growth / max(roe_target_base, 1e-6), 0.0, 1.0),
        _PROJECTION_YEARS,
    )
    implied_roe_pct = _implied_roe(
        book_value_0, base_payout_path, cost_of_equity_base, base_terminal_growth, shares_out, price,
    )
    financial_reverse_valuation = {
        "implied_roe_pct": implied_roe_pct,
        "historical_roe_pct": round(roe_initial * 100, 1) if roe_initial is not None else None,
        "nuvos_roe_pct": round(roe_target_base * 100, 1) if roe_target_base is not None else None,
    }

    # ── Sensitivity — Cost of Equity rows x Terminal P/B cols, closed-form
    #    (invert implied_terminal_pb = (terminal_roe-g)/(coe-g) for terminal_roe
    #    at each grid point, then project the BASE roe/payout path at that
    #    cost of equity) — cheap (15 cells), no brentq needed per cell. ──
    base_coe_pct = scenarios["base"]["_cost_of_equity_pct"]
    coe_rows_pct = [round(base_coe_pct - 1.0, 2), round(base_coe_pct, 2), round(base_coe_pct + 1.0, 2)]
    base_implied_pb = base_scenario["assumptions"]["exit_multiple"] or 1.0
    pb_cols = [round(base_implied_pb * m, 2) for m in (0.7, 0.85, 1.0, 1.15, 1.3)]
    sensitivity_values = []
    for coe_pct in coe_rows_pct:
        coe = max(coe_pct / 100, 0.02)
        row_values = []
        for pb_col in pb_cols:
            terminal_roe_at_cell = base_terminal_growth + pb_col * (coe - base_terminal_growth)
            cell_result = project_residual_income_valuation(
                book_value_0,
                _fade_path(roe_initial, terminal_roe_at_cell, _PROJECTION_YEARS),
                base_payout_path, coe, base_terminal_growth, terminal_roe_at_cell, shares_out,
            )
            row_values.append(cell_result.value_per_share)
        sensitivity_values.append(row_values)
    sensitivity_matrix = {
        "wacc_rows_pct": coe_rows_pct,  # reused key: cost-of-equity rows, see NuvosSensitivityMatrixData
        "multiple_cols": pb_cols,
        "exit_metric": "price_to_book",
        "values": sensitivity_values,
    }

    # ── Sanity checks (P/B, P/E) — descriptive only, NEVER adjust the value ──
    current_pb = price / book_value_per_share if book_value_per_share else None
    implied_pb_base = base_scenario["assumptions"]["exit_multiple"]
    valuation_sanity_warning = False
    comparable_pbs = [v for v in [current_pb, peer_benchmarks.median_pb if peer_benchmarks else None] if v]
    if implied_pb_base and comparable_pbs:
        ratio = implied_pb_base / (sum(comparable_pbs) / len(comparable_pbs))
        if ratio > 2.0 or ratio < 0.5:
            valuation_sanity_warning = True
    implied_pe_base = (base_scenario["fair_value_per_share"] / latest_eps) if latest_eps and latest_eps > 0 else None
    comparable_pes = [v for v in [pe_ratio, peer_benchmarks.median_pe if peer_benchmarks else None] if v]
    if implied_pe_base and comparable_pes:
        pe_ratio_check = implied_pe_base / (sum(comparable_pes) / len(comparable_pes))
        if pe_ratio_check > 2.5 or pe_ratio_check < 0.4:
            valuation_sanity_warning = True

    # `valuation_sanity_warning` used to be computed here and then only
    # ever nested inside `nuvos_fair_value` — never reaching the actual
    # diagnostic UI (confirmed live for BRK.B, 2026-08-19: a 2.93x implied
    # P/B against Berkshire's real ~1.5-1.7x, silently flagged True and
    # discarded). Appended onto the SAME `sector_model_note` the UI already
    # renders for every financial-sector ticker, instead of a separate
    # field nothing reads — still shows the real computed number (never
    # suppress a real model output just because the app is unsure of it),
    # just with a visible caution alongside it.
    _sector_note_detalle = _SECTOR_NOTE_TEXT
    if valuation_sanity_warning:
        _sector_note_detalle += (
            " Además, el múltiplo precio/valor en libros implícito en este cálculo se aleja bastante de cómo "
            "cotiza realmente esta empresa (y sus comparables) en el mercado — puede deberse a supuestos de "
            "crecimiento/costo de capital poco representativos para este negocio en particular. Tratá este "
            "valor intrínseco con más cautela de la habitual."
        )
    sector_model_note = {"sector_type": "financial", "detalle": _sector_note_detalle}

    roe_stdev = statistics.pstdev(roe_valid) if len(roe_valid) >= 3 else None
    confidence_score = _score(roe_stdev, [(5, 90), (10, 75), (18, 55), (30, 35), (999, 15)]) if roe_stdev is not None else 50

    net_cash = cash - total_debt
    legacy_scenarios = {
        "pessimistic": {
            "stage1_growth_pct": scenarios["bear"]["assumptions"]["revenue_growth_1_pct"],
            "discount_rate_pct": scenarios["bear"]["_cost_of_equity_pct"],
            "intrinsic_value_per_share": scenarios["bear"]["fair_value_per_share"],
            "justified_pb": scenarios["bear"]["assumptions"]["exit_multiple"],
        },
        "base": {
            "stage1_growth_pct": scenarios["base"]["assumptions"]["revenue_growth_1_pct"],
            "discount_rate_pct": scenarios["base"]["_cost_of_equity_pct"],
            "intrinsic_value_per_share": scenarios["base"]["fair_value_per_share"],
            "justified_pb": scenarios["base"]["assumptions"]["exit_multiple"],
        },
        "optimistic": {
            "stage1_growth_pct": scenarios["bull"]["assumptions"]["revenue_growth_1_pct"],
            "discount_rate_pct": scenarios["bull"]["_cost_of_equity_pct"],
            "intrinsic_value_per_share": scenarios["bull"]["fair_value_per_share"],
            "justified_pb": scenarios["bull"]["assumptions"]["exit_multiple"],
        },
    }
    fair_value_range = {
        "low": min(scenarios["bear"]["fair_value_per_share"], scenarios["bull"]["fair_value_per_share"]),
        "high": max(scenarios["bear"]["fair_value_per_share"], scenarios["bull"]["fair_value_per_share"]),
        "base": scenarios["base"]["fair_value_per_share"],
    }

    # Legacy closed-form implied growth (kept for downstream consumers that
    # still read `dcf["implied_growth_pct"]`) — the richer, real reverse
    # valuation lives in `financial_reverse_valuation.implied_roe_pct` above.
    implied_growth_pct = None
    denom = price - book_value_per_share
    if abs(denom) > 1e-6:
        g_implied = (price * cost_of_equity_base - book_value_per_share * roe_initial) / denom
        if -0.30 < g_implied < cost_of_equity_base:
            implied_growth_pct = round(g_implied * 100, 1)

    nuvos_fair_value = {
        "scenarios": {
            "bear": {k: v for k, v in scenarios["bear"].items() if not k.startswith("_")},
            "base": {k: v for k, v in scenarios["base"].items() if not k.startswith("_")},
            "bull": {k: v for k, v in scenarios["bull"].items() if not k.startswith("_")},
        },
        "exit_metric": "price_to_book",
        "exit_multiple_anchor_source": "peer_median" if (peer_benchmarks and peer_benchmarks.median_pb) else "own_historical",
        "exit_multiple_ladder": {
            "own_historical": current_pb,
            "peer_median": peer_benchmarks.median_pb if peer_benchmarks else None,
            "sector_table_fallback": None,
        },
        "price_implied_scenario": price_implied_scenario,
        "growth_factors": [
            {"name": f.name, "value": f.value, "score": f.score, "reason": f.reason} for f in eps_growth_result.factors
        ],
        "operating_margin_factors": [  # reused key: ROE factors (see module docstring — frontend labels swap when is_financial_sector)
            {"name": f.name, "value": f.value, "score": f.score, "reason": f.reason} for f in roe_result.factors
        ],
        "terminal_roic_factors": [],
        "sensitivity_matrix": sensitivity_matrix,
        "eps_cagr_3y_pct": eps_windows.get("3y"),
        "eps_cagr_5y_pct": eps_windows.get("5y"),
        "book_value_cagr_3y_pct": book_value_windows.get("3y"),
        "book_value_cagr_5y_pct": book_value_windows.get("5y"),
        "wall_street_eps_growth_next_year_pct": wall_street_eps_growth_next_year_pct,
        "is_financial_sector": True,
        "financial_subsector": classify_financial_subsector(sector, industry),
        "sector_model_note": sector_model_note,
        "financial_reverse_valuation": financial_reverse_valuation,
        "valuation_sanity_warning": valuation_sanity_warning,
    }

    return {
        "methodology": "residual_income_excess_return_v2",
        "scenario_config_version": SCENARIO_CONFIG_VERSION,
        "sector": sector,
        "book_value_per_share": round(book_value_per_share, 2),
        "avg_roe_pct": round(roe_initial * 100, 1) if roe_initial is not None else None,
        "cost_of_equity_pct": round(cost_of_equity_base * 100, 2),
        "base_discount_rate_pct": round(cost_of_equity_base * 100, 2),
        "wacc_details": wacc_details,
        "sustainable_growth_pct": round(base_terminal_growth * 100, 1),
        "terminal_growth_pct": round(base_terminal_growth * 100, 1),
        "payout_ratio_pct": round(payout_current * 100, 1),
        "justified_pb": scenarios["base"]["assumptions"]["exit_multiple"],
        "total_debt": round(total_debt, 0),
        "cash": round(cash, 0),
        "net_cash": round(net_cash, 0),
        "shares_outstanding": round(shares_out, 0),
        "projected_shares_outstanding": round(shares_out, 0),
        "current_price": price,
        "scenarios": legacy_scenarios,
        "fair_value_range": fair_value_range,
        "margin_of_safety_pct": margin_of_safety,
        "expected_value_per_share": expected_value_per_share,
        "implied_growth_pct": implied_growth_pct,
        "confidence_score": confidence_score,
        "operational_risk_label": "Bajo" if confidence_score >= 80 else "Medio" if confidence_score >= 60 else "Alto" if confidence_score >= 40 else "Muy alto",
        "valuation_risk_label": "Bajo" if margin_of_safety is not None and margin_of_safety >= 0 else "Medio" if margin_of_safety is not None and margin_of_safety >= -30 else "Alto" if margin_of_safety is not None and margin_of_safety >= -100 else "Muy alto",
        "growth_buildup": {
            "historical_growth_pct": round(base_terminal_growth * 100, 1),
            "moat_adjustment_pct": 0.0,
            "avg_roic_pct": round(roe_initial * 100, 1) if roe_initial is not None else None,  # ROE substitutes for ROIC in this sector
            "quality_metric_label": "ROE",
            "quality_adjusted_growth_pct": round(base_terminal_growth * 100, 1),
            "buyback_rate_pct": 0.0,
            "fcf_per_share_cagr_pct": None,
        },
        "nuvos_fair_value": nuvos_fair_value,
        "sector_model_note": sector_model_note,
        "data_quality_flags": {"dividends_missing": dividends_missing},
    }
