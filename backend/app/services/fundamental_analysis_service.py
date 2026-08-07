"""
Fundamental Analysis Service
=============================
Deterministic (non-LLM) fundamental-analysis engine for the Arthur
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
from dataclasses import asdict
from typing import Optional

from app.services.financial_data_service import get_financials, get_revenue_segments, get_beta, get_risk_free_rate, get_shares_float
from app.core.finnhub import fh_quote, fh_profile, fh_price_target, fh_metrics, fh_recommendation
from app.services.valuation.dcf_engine import (
    project_driver_based_dcf, recency_weighted_average, compute_reinvestment_rate_anchor, is_reit_sector,
)
from app.services.valuation.robustness import UnstableGordonGrowthError, clamp
# Fase 1, Incremento 7 (Parte I — modular reorganization): these used to be
# private functions defined in this file. They're now real, independently
# testable modules under valuation/, imported back here under their
# original names so every internal call site below (`_run_dcf(...)`,
# `_num(...)`, etc.) keeps working completely unchanged — see each new
# module's docstring for the full rationale.
from app.services.valuation.numeric_helpers import _num, _cagr, _score, _coefficient_of_variation, calc_margin_of_safety
from app.services.valuation.legacy_dcf_core import _project_path, _run_dcf, _run_dcf_constant_growth
from app.services.valuation.reverse_dcf_engine import (
    _implied_growth_rate, _implied_fcf_margin_at_fixed_growth, _implied_constant_growth_rate,
    _implied_operating_margin, _implied_terminal_roic, _implied_base_revenue,
    sanity_check_reverse_dcf,
)
from app.services.valuation.confidence_engine import (
    _confidence_score, compute_confidence_meter_v3,
    compute_financial_statement_quality_score, compute_management_consistency_score,
)
from app.services.quality.capital_allocation_engine import evaluate_dividend_consistency, evaluate_reinvestment_quality
from app.services.valuation.growth_engine import compute_weighted_growth
from app.services.quality.moat_engine import compute_moat_score
from app.services.quality.deterioration_engine import compute_deterioration_signals
from app.services.quality.quality_engine import compute_incremental_roic, compute_cagr_windows

logger = logging.getLogger(__name__)

_MIN_YEARS = 3
_PROJECTION_YEARS = 10
# Fase 1.5, Incremento 2 — placeholder high-growth plateau for the driver-
# based DCF's three-stage growth (dcf_engine.project_driver_based_dcf's
# high_growth_years), fixed until the Growth Engine (Fase 1.5, Incremento 8)
# determines this per-company from real signals (business maturity, moat,
# industry growth stage) instead of one constant for every ticker. A short,
# conservative plateau was chosen over 0 (which would make Incremento 1's
# work invisible even in shadow mode) and over a longer one (which would
# overstate durability for companies the Growth Engine hasn't assessed yet).
_DEFAULT_HIGH_GROWTH_YEARS = 2
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
    # Lowered from 0.03 — real testing (TSM/Adobe/Intuit all showing
    # 55-67% "margin of safety") traced back to this being the single
    # highest terminal-growth ceiling combined with a high-ROIC moat bonus,
    # producing systematically inflated intrinsic values for quality tech
    # names. Terminal value dominates a DCF (often 60-70%+ of EV), so this
    # is the highest-leverage lever — 2% matches the more conservative
    # standard practitioner ceiling (~long-run inflation) instead of
    # assuming tech keeps outgrowing the economy forever.
    ("technology", 0.02),
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


# ── Sector cyclicality dampener (Top Opportunities ranking score) ────────────
# A commodity/cyclical business mid-upcycle can show a real, honestly-computed
# margin of safety that's really just "the cycle hasn't turned yet" — not the
# same kind of opportunity as a durable compounder trading cheap for no good
# reason. This damps the composite ranking score for structurally cyclical
# sectors, [0.9, 1.0], so a cyclical name needs a genuinely stronger score to
# out-rank a defensive/durable one — never a hard exclusion, just a fair tilt.
_SECTOR_CYCLICALITY_DAMPENER: list[tuple[str, float]] = [
    ("energy", 0.90),
    ("basic materials", 0.90),
    ("consumer cyclical", 0.92),
    ("industrials", 0.93),
    ("retail", 0.93),
    ("financial services", 0.95),
    ("bank", 0.95),
    ("insurance", 0.95),
    ("real estate", 0.95),
    ("utilities", 0.95),
    ("biotechnology", 0.95),
    ("communication services", 0.97),
    ("healthcare", 0.98),
    ("consumer defensive", 1.0),
    ("technology", 1.0),
]
_DEFAULT_CYCLICALITY_DAMPENER = 0.95


def _sector_cyclicality_dampener(sector: str | None) -> float:
    if not sector:
        return _DEFAULT_CYCLICALITY_DAMPENER
    s = sector.lower()
    for key, factor in _SECTOR_CYCLICALITY_DAMPENER:
        if key in s:
            return factor
    return _DEFAULT_CYCLICALITY_DAMPENER


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


# ── Liquidity gate ─────────────────────────────────────────────────────────────
# Running a full DCF on a stock with minimal free float or trading volume
# produces a precise-looking number built on a price that barely trades —
# a real case seen with GNP Seguros (thin ADR/foreign-ordinary volume). This
# must run BEFORE the valuation is presented with normal confidence, not as
# an afterthought — a low-liquidity stock's price itself is less trustworthy,
# independent of whether the underlying business or the DCF math is sound.
_MIN_AVG_VOLUME_30D = 50_000       # shares/day — below this, price discovery itself is suspect
_MIN_FREE_FLOAT_PCT = 10.0         # % of shares outstanding actually tradeable
_MIN_ANALYST_COVERAGE = 1          # at least one analyst actively covering


def check_liquidity_gate(ticker: str) -> dict:
    """Real, pre-valuation liquidity check — average 3-month daily trading
    volume (Finnhub), free float % (FMP shares-float), and analyst coverage
    count (Finnhub recommendation trend). Returns:
    {"paso": bool, "avg_volume_30d": float|None, "free_float_pct": float|None,
     "analyst_coverage": int, "detalle": str}

    `paso=False` (gate failed) only when we have REAL data showing volume or
    float below threshold — never fabricated. If both volume and float are
    genuinely unavailable (data gap, not a real low-liquidity signal), the
    gate reports `paso=True` but with `detalle` disclosing the data gap
    honestly, rather than either silently passing as if fully verified or
    blocking a legitimate ticker just because one data source lacks
    coverage."""
    metrics = fh_metrics(ticker) or {}
    avg_volume = _num(metrics.get("3MonthAverageTradingVolume"))
    # Finnhub reports this in MILLIONS of shares — normalize to raw shares
    # so it's comparable against _MIN_AVG_VOLUME_30D.
    if avg_volume is not None:
        avg_volume = avg_volume * 1_000_000

    float_data = get_shares_float(ticker)
    free_float_pct = float_data.get("free_float_pct") if float_data else None

    rec = fh_recommendation(ticker)
    analyst_coverage = (
        (rec.get("buy", 0) + rec.get("hold", 0) + rec.get("sell", 0) + rec.get("strong_buy", 0) + rec.get("strong_sell", 0))
        if rec else 0
    )

    reasons = []
    if avg_volume is not None and avg_volume < _MIN_AVG_VOLUME_30D:
        reasons.append(f"volumen promedio real de {avg_volume:,.0f} acciones/día (mínimo esperado: {_MIN_AVG_VOLUME_30D:,})")
    if free_float_pct is not None and free_float_pct < _MIN_FREE_FLOAT_PCT:
        reasons.append(f"free float real de {free_float_pct}% (mínimo esperado: {_MIN_FREE_FLOAT_PCT}%)")

    if reasons:
        return {
            "paso": False,
            "avg_volume_30d": avg_volume,
            "free_float_pct": free_float_pct,
            "analyst_coverage": analyst_coverage,
            "detalle": "Liquidez real baja: " + "; ".join(reasons) + ". El precio de mercado es menos confiable como referencia — trátalo con más cautela que una acción líquida.",
        }

    data_gap = avg_volume is None and free_float_pct is None
    return {
        "paso": True,
        "avg_volume_30d": avg_volume,
        "free_float_pct": free_float_pct,
        "analyst_coverage": analyst_coverage,
        "detalle": (
            "No se pudo verificar volumen/free float real para este ticker (dato no disponible) — no es una señal de baja liquidez, solo un vacío de datos."
            if data_gap else "Liquidez real dentro de rangos esperados."
        ),
    }


# ── Versioned scenario assumptions ────────────────────────────────────────────
# Single source of truth for the 3-scenario (pessimistic/base/optimistic)
# multipliers used in every DCF run — never improvised inline. Every `dcf`
# dict this module returns carries `scenario_config_version`, so a stored or
# cached result is always traceable to exactly which assumption-set produced
# it; bump the version string whenever these numbers change, so an old
# cached result is never silently compared against a new one as if they used
# the same methodology.
SCENARIO_CONFIG_VERSION = "v1.0.0"

# FCF-based 2-stage DCF (non-financial companies) — growth_multiplier scales
# the raw quality-adjusted growth rate; discount_rate_delta_pct shifts WACC;
# the caps bound how high growth can go even after the multiplier, so a
# very-high-growth company doesn't blow through a sane ceiling.
FCF_DCF_SCENARIOS = {
    "pessimistic": {"growth_multiplier": 0.5, "discount_rate_delta_pct": 1.5, "revenue_growth_cap_pct": 15.0, "fcf_growth_cap_pct": 15.0},
    "base":        {"growth_multiplier": 1.0, "discount_rate_delta_pct": 0.0, "revenue_growth_cap_pct": 25.0, "fcf_growth_cap_pct": 25.0},
    "optimistic":  {"growth_multiplier": 1.3, "discount_rate_delta_pct": -1.0, "revenue_growth_cap_pct": 40.0, "fcf_growth_cap_pct": 35.0},
}

# Nuvos AI Fair Value Engine redesign, Incremento 5 — Bear/Base/Bull for the
# NEW engine (nuvos_fair_value, wired in Incremento 6). Deliberately
# separate from FCF_DCF_SCENARIOS above, not a replacement of it yet — the
# legacy `scenarios` block keeps using FCF_DCF_SCENARIOS unchanged until
# Incremento 12's teardown (never break the screen mid-migration).
#
# Structurally different from FCF_DCF_SCENARIOS in the 2 ways the audit
# flagged as the actual mechanism of the "same treatment for an exceptional
# business and an average one" bias Diego wants gone:
#
# 1. `growth_delta_pp` is a DELTA in percentage points applied on top of the
#    Assumptions Engine's real blended growth (Incremento 4), not a flat
#    multiplier (FCF_DCF_SCENARIOS' 0.5x/1.0x/1.3x) — a multiplier punishes
#    a low-growth business less in absolute terms than a high-growth one
#    for the identical "how much worse could this go" judgment.
# 2. There is no static `revenue_growth_cap_pct` here — see
#    `bear_base_bull_growth_cap_pct` below, which scales the ceiling with
#    the business's own real quality signal instead of applying the same
#    flat cap (15/25/40, FCF_DCF_SCENARIOS) to every company regardless of
#    whether it's an exceptional compounder or an average business.
#
# `operating_margin_start_delta_pp`/`operating_margin_terminal_delta_pp` are
# genuinely separate (unlike every current production call site, which
# passes the SAME margin value to both `operating_margin_anchor_pct` and
# `terminal_operating_margin_pct` — dcf_engine.py has always supported an
# evolving margin, nothing in the orchestrator ever used it until now).
#
# `exit_multiple_delta_fraction` scales the multiple exit_multiple_engine.py
# derives (Incremento 1) — bear contracts it, bull expands it, same
# direction as the growth/margin deltas so all three levers agree on which
# story each scenario is telling.
BEAR_BASE_BULL = {
    "bear": {
        "growth_delta_pp": -4.0,
        "discount_rate_delta_pct": 1.5,
        "operating_margin_start_delta_pp": -2.0,
        "operating_margin_terminal_delta_pp": -3.0,
        "exit_multiple_delta_fraction": -0.15,
        "high_growth_years": 1,
    },
    "base": {
        "growth_delta_pp": 0.0,
        "discount_rate_delta_pct": 0.0,
        "operating_margin_start_delta_pp": 0.0,
        "operating_margin_terminal_delta_pp": 0.0,
        "exit_multiple_delta_fraction": 0.0,
        "high_growth_years": 2,
    },
    "bull": {
        "growth_delta_pp": 4.0,
        "discount_rate_delta_pct": -1.0,
        "operating_margin_start_delta_pp": 1.5,
        "operating_margin_terminal_delta_pp": 2.5,
        "exit_multiple_delta_fraction": 0.15,
        "high_growth_years": 3,
    },
}


def bear_base_bull_growth_cap_pct(business_quality_score: Optional[float], scenario: str) -> float:
    """Growth ceiling that SCALES with the business's own real quality
    signal (0-100 Business Quality score, same one thesis_scores already
    computes) instead of the flat 15/25/40 cap FCF_DCF_SCENARIOS applies to
    every company alike — an exceptional compounder (high, stable ROIC, a
    durable moat) genuinely can sustain faster growth for longer than an
    average business, and a cap that can't reflect that is, mechanically,
    the "same treatment for the exceptional and the average business" bias
    the audit flagged (docs/FAIR_VALUE_ENGINE_REDESIGN_AUDIT.md, section
    1.12). `business_quality_score=None` (data gap, not a real 50) falls
    back to the neutral midpoint so an unscored company still gets a real,
    sane cap rather than an exception."""
    quality = business_quality_score if business_quality_score is not None else 50.0
    base_cap = {"bear": 12.0, "base": 20.0, "bull": 30.0}[scenario]
    quality_swing_pp = (quality - 50.0) / 50.0 * 10.0  # +-10pp across the full 0-100 range
    return max(base_cap + quality_swing_pp, 5.0)


# Excess Return / Justified P-B (banks, insurers, brokers) — cost_of_equity_
# delta_pct shifts the discount rate; growth_multiplier scales sustainable
# growth (ROE × retention), still bounded by the model's own growth ceiling.
EXCESS_RETURN_SCENARIOS = {
    "pessimistic": {"cost_of_equity_delta_pct": 1.0, "growth_multiplier": 0.5},
    "base":        {"cost_of_equity_delta_pct": 0.0, "growth_multiplier": 1.0},
    "optimistic":  {"cost_of_equity_delta_pct": -1.0, "growth_multiplier": 1.3},
}


# ── Real CAPM-based WACC ──────────────────────────────────────────────────────
_EQUITY_RISK_PREMIUM = 0.046  # long-run US equity risk premium (Damodaran-style estimate)
_MIN_COST_OF_DEBT = 0.03
_MAX_COST_OF_DEBT = 0.15


_QUALITATIVE_ADJUSTMENT_MIN_PCT = -0.5
_QUALITATIVE_ADJUSTMENT_MAX_PCT = 2.0


def _calc_wacc(
    beta: Optional[float],
    risk_free_rate: Optional[float],
    market_cap: Optional[float],
    total_debt: float,
    interest_expense: Optional[float],
    tax_rate: float,
    sector: Optional[str],
    qualitative_adjustment_pct: float = 0.0,
    qualitative_adjustment_reason: Optional[str] = None,
) -> tuple[float, dict]:
    """Real WACC via CAPM: cost of equity = risk-free + beta × ERP, cost of
    debt = interest expense / total debt (with a floor/ceiling), blended by
    market-value weights of equity and debt, net of the tax shield on debt.
    Falls back to the sector-proxy table ONLY if beta or the live risk-free
    rate genuinely isn't available (e.g. FMP down) — this is disclosed
    explicitly in the output so it's never silently mistaken for a real WACC.

    `qualitative_adjustment_pct`: an optional analyst override added directly
    to the discount rate for a company-specific risk not captured by beta
    (e.g. "active DOJ antitrust investigation", "customer concentration in
    4 hyperscalers") — range [-0.5%, +2.0%]. This is infrastructure for a
    future analyst-driven override (no caller sets it yet; defaults to 0/
    None, i.e. no adjustment). It's deliberately NEVER allowed as a bare
    number: any non-zero value MUST come with `qualitative_adjustment_
    reason`, or this raises — a discount-rate fudge factor with no recorded
    justification is exactly the "ad hoc" failure mode this whole hardening
    effort exists to prevent."""
    if qualitative_adjustment_pct != 0.0:
        if not qualitative_adjustment_reason:
            raise ValueError("qualitative_adjustment_pct distinto de 0 requiere qualitative_adjustment_reason — nunca un ajuste sin justificación registrada.")
        if not (_QUALITATIVE_ADJUSTMENT_MIN_PCT <= qualitative_adjustment_pct <= _QUALITATIVE_ADJUSTMENT_MAX_PCT):
            raise ValueError(f"qualitative_adjustment_pct debe estar en [{_QUALITATIVE_ADJUSTMENT_MIN_PCT}%, {_QUALITATIVE_ADJUSTMENT_MAX_PCT}%], recibido {qualitative_adjustment_pct}%.")

    if beta is None or risk_free_rate is None or not market_cap:
        return _sector_discount_rate(sector), {"method": "sector_fallback (beta o tasa libre de riesgo no disponibles)"}

    beta_clamped = max(min(beta, 3.0), 0.3)  # sanity clamp — an extreme/negative beta breaks CAPM
    cost_of_equity = risk_free_rate + beta_clamped * _EQUITY_RISK_PREMIUM + qualitative_adjustment_pct / 100

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
        "qualitative_adjustment_pct": round(qualitative_adjustment_pct, 2),
        "qualitative_adjustment_reason": qualitative_adjustment_reason,
        "cost_of_equity_pct": round(cost_of_equity * 100, 2),
        "cost_of_debt_pct": round(cost_of_debt * 100, 2),
        "tax_rate_pct": round(tax_rate * 100, 1),
        "equity_weight_pct": round(e / v * 100, 1),
        "debt_weight_pct": round(d / v * 100, 1),
    }


def _stars_from_score(score: Optional[float]) -> Optional[int]:
    """Maps a real 0-100 score onto a 1-5 star rating — deliberately
    graduated instead of a single pass/fail threshold. Counting "X/7 passed"
    made an excellent-but-expensive business (high moat/quality/management,
    just not currently cheap) read as "mediocre" to users, which is the
    opposite of what the underlying scores actually say — a real user
    complaint about PepsiCo scoring 4/7 despite being a business Buffett
    would call excellent. Stars per dimension avoid collapsing "great
    business, rich price" into the same bucket as "weak business"."""
    if score is None:
        return None
    if score >= 80: return 5
    if score >= 60: return 4
    if score >= 40: return 3
    if score >= 20: return 2
    return 1


def _stars_from_roic(avg_roic: Optional[float]) -> Optional[int]:
    """Moat stars — graduated on real ROIC (or ROE for financials, see
    _is_financial_sector), not a single 15% pass/fail cutoff. Still a real,
    measured number (never a fabricated composite of unmeasured factors
    like brand/network-effect/switching-costs — see the AI's qualitative
    moat-type reasoning for that nuance), just presented with more
    resolution than a boolean."""
    if avg_roic is None:
        return None
    if avg_roic >= 22: return 5
    if avg_roic >= 16: return 4
    if avg_roic >= 10: return 3
    if avg_roic >= 5: return 2
    return 1


# ── Composite ranking score ("Top Opportunities" — Best Overall) ─────────────
# Sorting a discovery list by margin of safety alone rewards businesses the
# market may be right to avoid — a real value trap reads as the #1 result on
# that sort. This blends 6 already-real, already-multi-factor pillars (each
# one itself a blend, not a single metric) into one sortable number, then
# applies the sector-cyclicality dampener above so a cyclical name mid-upcycle
# needs a genuinely stronger score to out-rank a durable compounder.
_COMPOSITE_SCORE_WEIGHTS: dict[str, float] = {
    "valuation": 0.25,
    "business_quality": 0.20,
    "financial_strength": 0.15,
    "predictability": 0.15,
    "growth_outlook": 0.15,
    "management_capital_allocation": 0.10,
}


def _fair_value_range(scenarios: dict) -> dict:
    """Real range, not a single point estimate — reuses the pessimistic/base/
    optimistic scenarios already computed (no new math, no waiting on a
    multi-method consensus engine to exist first). "An analyst thinks in
    ranges, not exact figures" — low/high are the real bear/bull intrinsic
    values already in `scenarios`, base is the real base-case value."""
    low = scenarios["pessimistic"]["intrinsic_value_per_share"]
    high = scenarios["optimistic"]["intrinsic_value_per_share"]
    return {
        "low": round(min(low, high), 2),
        "high": round(max(low, high), 2),
        "base": scenarios["base"]["intrinsic_value_per_share"],
    }


def combine_fair_value_range(nuvos_fair_value: Optional[dict], fallback_range: dict) -> dict:
    """Nuvos AI Fair Value Engine redesign, Incremento 11 (THE FLIP — see
    /Users/diegoarria/.claude/plans/stateful-painting-flurry.md) — supersedes
    Fase 1.5's Monte Carlo + Consensus combination formula. `fair_value_range`
    is now simply the single engine's own Bear/Base/Bull scenarios: `low` is
    the Bear Case fair value, `high` is the Bull Case fair value, `base` is
    the Base Case fair value. No more blending two independently-uncertain
    sources (a Monte Carlo distribution AND a spread across separately-
    computed methods) — one engine, three real scenarios, done. Never None:
    falls back to `fallback_range` (the legacy scenario-based range) when
    `nuvos_fair_value` isn't available (e.g. financials/REITs, which the
    engine skips — decision #5) or any of its 3 scenario values is missing,
    so every caller can rely on this always returning a real low/base/high
    dict.

    Pulled out as a single reusable function (not inlined at each call site)
    per Diego's dedup mandate — used inside get_fundamental_analysis() and
    by screener.py/undervalued_screener_service.py, which just read back
    `dcf["nuvos_fair_value"]` (or their own candidate's) rather than
    re-deriving the formula."""
    scenarios = (nuvos_fair_value or {}).get("scenarios") or {}
    bear = (scenarios.get("bear") or {}).get("fair_value_per_share")
    base = (scenarios.get("base") or {}).get("fair_value_per_share")
    bull = (scenarios.get("bull") or {}).get("fair_value_per_share")

    if bear is None or base is None or bull is None:
        return fallback_range

    low, high = min(bear, bull), max(bear, bull)
    return {"low": round(low, 2), "high": round(high, 2), "base": round(base, 2)}


def _composite_ranking_score(thesis_scores: Optional[dict], sector: Optional[str]) -> Optional[float]:
    """Weighted blend of the 6 Investment Thesis Scorecard dimensions (all
    already real, already computed) — never a fresh metric of its own.
    Gracefully degrades: if one pillar is missing (rare), its weight is
    redistributed proportionally across the pillars that ARE available,
    rather than either failing outright or silently treating a missing
    pillar as a zero (which would unfairly punish a company just because
    one input couldn't be computed)."""
    if not thesis_scores:
        return None
    available = {k: v for k, v in thesis_scores.items() if k in _COMPOSITE_SCORE_WEIGHTS and v is not None}
    if not available:
        return None
    total_weight = sum(_COMPOSITE_SCORE_WEIGHTS[k] for k in available)
    raw = sum(_COMPOSITE_SCORE_WEIGHTS[k] * v for k, v in available.items()) / total_weight
    dampener = _sector_cyclicality_dampener(sector)
    return round(raw * dampener, 1)


def _build_checklist_items(dcf: dict, thesis_scores: dict, evidence: Optional[dict] = None) -> list[dict]:
    """6 of the 7 items of the investment checklist (in order of importance,
    skipping item 1 "Entender el negocio" — that one is inherently
    qualitative/subjective and added separately by the caller via Claude's
    judgment, disclosed as such). "stars" (1-5, or None if not enough data)
    is always a real, deterministic rating computed from numbers already
    produced by this module — never an AI guess — graduated rather than a
    pass/fail boolean so a great-but-pricey business doesn't read as
    mediocre (see _stars_from_score's docstring). The templated "reason"
    strings here are only a FALLBACK, used if the AI call (which reasons
    over `evidence`, the real multi-factor data for each dimension) fails
    or is skipped — see ai_service.generate_quick_valuation_summary/
    generate_candidate_blurb, which overwrite "reason" with a nuanced,
    non-absolutist explanation grounded in `evidence` without changing
    "stars"."""
    items = []
    evidence = evidence or {}

    gb = dcf.get("growth_buildup") or {}
    avg_roic = gb.get("avg_roic_pct")
    moat_stars = _stars_from_roic(avg_roic)
    items.append({
        "key": "moat",
        "name": "Ventaja competitiva (Moat)",
        "stars": moat_stars,
        "reason": (
            f"ROIC promedio real de {avg_roic}%."
            if avg_roic is not None else "No hay suficiente historial de ROIC real para evaluar esto."
        ),
        "evidence": evidence.get("moat"),
    })

    bq = thesis_scores.get("business_quality")
    items.append({
        "key": "business_quality",
        "name": "Calidad del negocio",
        "stars": _stars_from_score(bq),
        "reason": f"Business Quality Score real: {bq}/100." if bq is not None else "No disponible.",
        "evidence": evidence.get("business_quality"),
    })

    mgmt = thesis_scores.get("management_capital_allocation")
    items.append({
        "key": "management_capital_allocation",
        "name": "Management y asignación de capital",
        "stars": _stars_from_score(mgmt),
        "reason": f"Management & Capital Allocation Score real: {mgmt}/100." if mgmt is not None else "No disponible.",
        "evidence": evidence.get("management_capital_allocation"),
    })

    fs = thesis_scores.get("financial_strength")
    items.append({
        "key": "financial_strength",
        "name": "Fortaleza financiera",
        "stars": _stars_from_score(fs),
        "reason": f"Financial Strength Score real: {fs}/100." if fs is not None else "No disponible.",
        "evidence": evidence.get("financial_strength"),
    })

    go = thesis_scores.get("growth_outlook")
    pred = thesis_scores.get("predictability")
    growth_pred_avg = (go + pred) / 2 if go is not None and pred is not None else None
    items.append({
        "key": "growth_predictability",
        "name": "Crecimiento futuro predecible",
        "stars": _stars_from_score(growth_pred_avg),
        "reason": (
            f"Growth Outlook real {go}/100, Predictability real {pred}/100."
            if go is not None and pred is not None else "No disponible."
        ),
        "evidence": evidence.get("growth_predictability"),
    })

    mos = dcf.get("margin_of_safety_pct")
    valuation_score = thesis_scores.get("valuation")
    items.append({
        "key": "valuation",
        "name": "Valor intrínseco y margen de seguridad",
        "stars": _stars_from_score(valuation_score),
        "reason": f"Margen de seguridad real: {'+' if mos >= 0 else ''}{mos}%." if mos is not None else "No se pudo calcular el DCF.",
        "evidence": evidence.get("valuation"),
    })

    return items




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
    # Cap sustainable growth at a realistic long-run ceiling. A mature
    # financial institution's book value can't keep compounding at its
    # current ROE forever — real long-run growth converges toward overall
    # economic growth (~long-run nominal GDP, roughly 3-4%). A 6% cap
    # (this model's first version) was calibrated against an extreme case
    # (Progressive Corp's 26%+ ROIC) to prevent a blow-up, but for a
    # NORMAL, merely-good insurer (e.g. Chubb, ROE ~12-13%, cost of equity
    # ~8%) it still leaves too thin an (r-g) spread — the Gordon-growth
    # formula is extremely sensitive there, and 6% inflated the justified
    # P/B well above what real-world justified P/B multiples for insurers
    # actually look like (rarely above ~3x book even for excellent
    # underwriters). 4% is the standard long-run ceiling instead.
    sustainable_growth = min(avg_roe * retention_ratio, 0.04)

    def justified_pb_and_value(coe: float, g: float) -> tuple[float, float]:
        # Guard: the Gordon-growth form requires coe > g, or it's undefined/
        # explosive — clamp g to a safe margin below coe rather than let the
        # formula blow up (disclosed, not hidden).
        #
        # Ceiling of 8x is a backstop against pathological inputs (the
        # original Progressive Corp blow-up), NOT an active constraint on
        # legitimate high-ROE companies — confirmed by testing against 9
        # real cases (see section-10 validation): Chubb's justified P/B
        # (~1.95x, ROE ~12%) was never anywhere near even the old 4x
        # ceiling, proving the ceiling wasn't what fixed that case (the
        # growth cap and cost-of-equity floor above did the real work).
        # A 4x ceiling, however, DID incorrectly cap American Express
        # (ROE ~30%, real-world P/B genuinely 4-6x) — a flat cap can't
        # serve both a merely-good insurer and an exceptional, sustained
        # high-ROE franchise. 8x lets the formula do its job for real
        # outliers like AXP while still catching genuine blow-ups.
        g_safe = min(g, coe - 0.005)
        pb = max(0.0, min((avg_roe - g_safe) / (coe - g_safe), 8.0))
        return pb, book_value_per_share * pb

    # Vary BOTH cost of equity AND growth per scenario — mirrors the
    # standard FCF-DCF's pattern (mult 0.5/1.0/1.3 on growth) above, so the
    # three scenarios actually differentiate instead of only moving the
    # discount rate while holding growth fixed (a real inconsistency in
    # the first version of this model — a wide legitimate risk this
    # dimension should reflect, e.g. a soft insurance cycle depressing ROE,
    # is invisible if growth never varies across scenarios).
    scenarios = {}
    for name, assumptions in EXCESS_RETURN_SCENARIOS.items():
        coe_delta = assumptions["cost_of_equity_delta_pct"] / 100
        g_mult = assumptions["growth_multiplier"]
        coe_scenario = max(cost_of_equity + coe_delta, 0.02)
        g_scenario = min(sustainable_growth * g_mult, 0.04)
        pb, value = justified_pb_and_value(coe_scenario, g_scenario)
        scenarios[name] = {
            "stage1_growth_pct": round(g_scenario * 100, 1),
            "discount_rate_pct": round(coe_scenario * 100, 1),
            "intrinsic_value_per_share": round(value, 2),
            "justified_pb": round(pb, 2),
        }

    base_value = scenarios["base"]["intrinsic_value_per_share"]
    if base_value <= 0:
        return None

    margin_of_safety = calc_margin_of_safety(base_value, price)
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

    # Fase 1.5, Incremento 14 (dedup) — this is a THIRD, genuinely different
    # "confidence_score" formula in this codebase: a simple ROE-volatility
    # heuristic, unrelated to `_confidence_score` (confidence_engine.py,
    # FCF-CV + ROIC-trend based, used by the standard FCF-DCF branch below)
    # or `confidence_engine.compute_...` more broadly. Named distinctly here
    # (`roe_volatility_confidence_score`) so a reader/grep never confuses
    # the three. Still returned under the JSON key "confidence_score" below
    # — that polymorphism (whichever methodology ran populates the same
    # generic key) is deliberate, documented where confidence_meter reads it
    # (~line 2118), and left unchanged so downstream consumers that treat
    # dcf's shape as methodology-agnostic keep working for financial-sector
    # tickers exactly as before.
    roe_stdev = statistics.pstdev(roe_valid) if len(roe_valid) >= 3 else None
    roe_volatility_confidence_score = _score(roe_stdev, [(5, 90), (10, 75), (18, 55), (30, 35), (999, 15)]) if roe_stdev is not None else 50

    net_cash = cash - total_debt
    valuation_risk_label = "Bajo" if margin_of_safety >= 0 else "Medio" if margin_of_safety >= -30 else "Alto" if margin_of_safety >= -100 else "Muy alto"
    operational_risk_label = "Bajo" if roe_volatility_confidence_score >= 80 else "Medio" if roe_volatility_confidence_score >= 60 else "Alto" if roe_volatility_confidence_score >= 40 else "Muy alto"

    return {
        "methodology": "residual_income_justified_pb",
        "scenario_config_version": SCENARIO_CONFIG_VERSION,
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
        "fair_value_range": _fair_value_range(scenarios),
        "margin_of_safety_pct": margin_of_safety,
        "expected_value_per_share": expected_value_per_share,
        "implied_growth_pct": implied_growth_pct,
        "confidence_score": roe_volatility_confidence_score,
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


def get_fundamental_analysis(ticker: str, _compute_peer_dependent_data: bool = True) -> Optional[dict]:
    """Returns a fully computed fundamental-analysis dict for `ticker`, or
    None if there isn't enough real financial data to compute one reliably
    (fewer than 3 years of statements, or no live quote).

    `_compute_peer_dependent_data` (Fase 1.5, Incremento 10; broadened in
    the Nuvos AI Fair Value Engine redesign, Incremento 3b — see
    /Users/diegoarria/.claude/plans/stateful-painting-flurry.md) guards
    against real recursion: Consensus (Method 5), industry benchmarks
    (`industry_engine.compute_industry_benchmarks`), and Relative/
    Historical Valuation all fetch real PEERS via
    `relative_valuation_service._find_peers`, and each peer fetch calls
    get_fundamental_analysis() again — peers are frequently mutual (AAPL
    and MSFT are each other's peer in the curated UNIVERSE), so an
    unguarded call would recurse: AAPL → industry benchmarks → peer MSFT →
    MSFT's own industry benchmarks → peer AAPL → ... Internal callers that
    fetch a PEER's analysis (relative_valuation_service, industry_engine,
    peer_comparison_engine, the undervalued screener's universe scan) pass
    `_compute_peer_dependent_data=False` to cut the recursion at depth 1 —
    that peer's own analysis skips Consensus AND industry/relative/
    historical, since none of those would ever be used for a peer lookup
    anyway. Every real top-level caller (the API routes, Arthur, the
    thesis engine) keeps the default and gets all of it."""
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

    # Cross-validation summary — each period's Revenue-COGS-OpEx≈Operating
    # Income check was already computed per-period in financial_data_service.
    # _income_period (applies uniformly across providers). Aggregate here so
    # a real inconsistency in ANY reported year surfaces as "requiere
    # revisión manual" instead of being silently absorbed into the trends/
    # DCF as if every year were equally clean.
    flagged_years = [
        y for y, row in zip(years, income)
        if (row.get("validation") or {}).get("valido") is False
    ]
    data_validation = {
        "requiere_revision_manual": bool(flagged_years),
        "years_flagged": flagged_years,
        "detalle": (
            f"Los años {', '.join(flagged_years)} tienen inconsistencias reales entre Revenue-COGS-OpEx y el Operating "
            f"Income reportado (más allá de la tolerancia) — trátalos con cautela, podrían reflejar cargos especiales, "
            f"reclasificaciones contables, o un error del proveedor de datos."
            if flagged_years else "Todos los años disponibles pasaron la validación cruzada de consistencia contable."
        ),
    }

    quote   = fh_quote(ticker) or {}
    profile = fh_profile(ticker) or {}
    price = _num(quote.get("price"))
    if price is None:
        # Finnhub quote hiccup (rate limit/timeout/transient gap) used to
        # take down the ENTIRE valuation here — no dcf at all, even though
        # FCF/ROE/debt above were already fetched successfully from FMP.
        # Confirmed with AXP: its financial-sector model is real and
        # tested, it just had no price to anchor to that moment.
        try:
            from app.services.financial_data_service import get_fmp_quote_price
            price = get_fmp_quote_price(ticker)
        except Exception as e:
            logger.warning("get_fundamental_analysis(%s): FMP quote fallback failed: %s", ticker, e)
    shares_out_m = _num(profile.get("shareOutstanding"))  # Finnhub reports this in millions
    shares_out = shares_out_m * 1_000_000 if shares_out_m else None

    # Liquidity gate — must run before the valuation is shown with normal
    # confidence (see check_liquidity_gate's docstring: a precise-looking
    # DCF built on a barely-traded price is worse than no DCF at all).
    try:
        liquidity_gate = check_liquidity_gate(ticker)
    except Exception as e:
        logger.warning("get_fundamental_analysis(%s): liquidity gate failed: %s", ticker, e)
        liquidity_gate = {"paso": True, "avg_volume_30d": None, "free_float_pct": None, "analyst_coverage": 0, "detalle": "No se pudo verificar la liquidez real por un error técnico."}

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
    reinvestment_rate_trend = []
    dividends_paid_trend: list[Optional[float]] = []  # Fase 2, Incremento 4 (Capital Allocation Engine)
    # Fase 2, Incremento 2 (Quality Engine — see
    # /Users/diegoarria/.claude/plans/stateful-painting-flurry.md): these
    # four are NEW trend arrays, additive, feeding ROCE/Incremental ROIC/
    # Current Ratio/Quick Ratio — nothing existing reads or depends on them.
    nopat_trend, invested_capital_trend = [], []
    total_assets_trend, current_assets_trend, current_liabilities_trend, inventory_trend = [], [], [], []
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

        div_paid = _num(cf.get("Dividends Paid"))
        dividends_paid_trend.append(abs(div_paid) if div_paid is not None else None)

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
            nopat_trend.append(round(nopat, 0))
            invested_capital_trend.append(round(inv_cap, 0) if inv_cap > 0 else None)
        else:
            roic_trend.append(None)
            nopat_trend.append(None)
            invested_capital_trend.append(None)
        roe_trend.append(round(ni / equity * 100, 1) if ni is not None and equity else None)
        roa_trend.append(round(ni / assets * 100, 1) if ni is not None and assets else None)

        # Fase 2, Incremento 2 (Quality Engine): balance-sheet liquidity
        # fields, real per-year (not derived) — feed Current Ratio, Quick
        # Ratio, and ROCE (Total Assets - Current Liabilities).
        total_assets_trend.append(assets)
        current_assets_trend.append(_num(bal.get("Current Assets")))
        current_liabilities_trend.append(_num(bal.get("Current Liabilities")))
        inventory_trend.append(_num(bal.get("Inventory")))

        # Net reinvestment rate for this year — (CapEx + ΔWC − D&A) / NOPAT —
        # feeds the driver-based DCF's reinvestment-rate anchor (see
        # valuation.dcf_engine.project_driver_based_dcf). Computed
        # independently of the ROIC branch above since it only needs
        # Operating Income and the tax rate, not Stockholders Equity.
        if oi is not None:
            nopat_i = oi * (1 - tax_rate)
            if nopat_i > 0 and da is not None and capex is not None:
                reinvestment_i = abs(capex) + (delta_wc or 0) - da
                reinvestment_rate_trend.append(reinvestment_i / nopat_i)
            else:
                reinvestment_rate_trend.append(None)
        else:
            reinvestment_rate_trend.append(None)

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

    # Driver-based DCF anchors (Fase 1, Incremento 2 — valuation.dcf_engine):
    # same recency-weighting technique as avg_fcf_margin above, applied to
    # operating margin and net reinvestment rate instead of FCF margin.
    om_pairs = [(i, m / 100) for i, m in enumerate(operating_margin_trend) if m is not None]
    operating_margin_anchor = recency_weighted_average(om_pairs)
    reinvestment_pairs = [(i, v) for i, v in enumerate(reinvestment_rate_trend) if v is not None]
    reinvestment_rate_anchor = compute_reinvestment_rate_anchor(reinvestment_pairs)

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

    sector_model_note = None

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

    elif is_reit_sector(sector):
        # REITs don't generate a normal operating-company FCF the way the
        # standard DCF below assumes — GAAP depreciation on real property is
        # a real economic distortion (buildings typically appreciate, not
        # depreciate, over a REIT's holding period), so NOPAT/reinvestment
        # built on GAAP D&A systematically understates cash-generating
        # power. FFO/AFFO is the standard REIT-specific metric — not built
        # yet (future-phase work, see the Fase 1 plan's "fuera de alcance"),
        # so this shows a clear message instead of silently misapplying the
        # FCF-DCF, per the brief's explicit rule for DCF-inappropriate
        # companies. `dcf` stays None — same downstream handling already in
        # place for "insufficient data" (see format_fundamental_analysis_
        # for_prompt's `dcf is None` branch).
        sector_model_note = {
            "sector_type": "reit",
            "detalle": (
                "Este es un REIT (fideicomiso de inversión inmobiliaria) — su flujo de caja real se mide con "
                "FFO/AFFO, no con el DCF estándar de flujo de caja libre, que distorsiona su valor por cómo la "
                "depreciación contable trata las propiedades. Nuvos AI todavía no tiene un modelo FFO/AFFO "
                "dedicado; el valor intrínseco no se muestra para evitar un número engañoso."
            ),
        }

    elif avg_fcf_margin and avg_fcf_margin > 0 and latest_rev and shares_out and price:
        base_fcf = avg_fcf_margin * latest_rev

        # High-ROIC discount-rate floor — same fix already applied to the
        # financial-sector model (Chubb/Amex testing): a low measured beta
        # can make CAPM understate the true cost of capital for a genuinely
        # excellent, capital-efficient business — low beta reflects price
        # defensiveness, not the same thing as low business risk. Real
        # testing (TSM/Adobe/Intuit, all avg ROIC 25%+) showed this
        # combining with the terminal-growth ceiling to inflate intrinsic
        # value specifically for the highest-quality names.
        if avg_roic is not None and avg_roic >= 25 and wacc_details.get("method") == "capm" and base_discount_rate < 0.09:
            base_discount_rate = 0.09
            wacc_details["high_roic_floor_applied"] = True

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

        # Moat adjustment REMOVED (was up to +3pp on top of the already-real
        # historical CAGR for avg_roic >= 40%) — real testing (TSM/Adobe/
        # Intuit, all high-ROIC) showed this stacked with a generous
        # terminal-growth ceiling to systematically inflate intrinsic value
        # for exactly the highest-quality names, producing 55-67% "margin
        # of safety" that doesn't hold up. It was also arguably double-
        # counting quality already reflected in the FCF margin/ROIC feeding
        # base_fcf and the confidence/business-quality scores elsewhere —
        # a business's real moat should show up in its ACTUAL margins and
        # cash generation, not an extra speculative growth bonus on top.
        # Kept as a field (always 0.0) rather than removed outright since
        # growth_buildup's moat_adjustment_pct is read by the prompt
        # formatter and thesis-scorecard code below.
        moat_adjustment = 0.0

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

        # ── Growth Engine (Fase 1.5, Incremento 8) — feeds ONLY the driver-
        # based shadow calculations below (driver_based_valuation/scenarios/
        # sensitivity_matrix/value_drivers, Monte Carlo, and the driver-based
        # Reverse DCF calls), never the legacy model above/below (which keeps
        # using g1_rev_raw/base_historical_growth completely untouched,
        # exactly as before this increment). See growth_engine.py's module
        # docstring for why this is a more disciplined, bounded, bidirectional
        # replacement for the removed moat_adjustment, not a return to it.
        # Every input is already-computed (trends already built earlier in
        # this function) or a cheap, deterministic, NETWORK-FREE Fase 2
        # engine call (moat_engine/deterioration_engine both take real trends
        # directly, no fetching) — capital_allocation_score and
        # industry_median_revenue_cagr_pct are left as their defaults (None)
        # since computing those for real requires network I/O
        # (capital_allocation_engine's historical price lookups,
        # industry_engine's peer fetches) this otherwise-synchronous
        # function deliberately doesn't add; the engine degrades gracefully
        # (weighted_mean renormalizes over whatever signals ARE available).
        fcf_margin_trend_full = [
            round(f / r * 100, 1) if f is not None and r else None
            for f, r in zip(fcf_trend, revenue_trend)
        ]
        gross_margin_latest = next((v for v in reversed(gross_margin_trend) if v is not None), None)
        growth_engine_moat = compute_moat_score(
            avg_roic_pct=avg_roic, roic_trend=roic_trend,
            avg_operating_margin_pct=operating_margin_anchor * 100 if operating_margin_anchor is not None else None,
            operating_margin_trend=operating_margin_trend,
            gross_margin_latest_pct=gross_margin_latest,
            industry_median_roic_pct=None, industry_median_operating_margin_pct=None,
        )
        growth_engine_deterioration = compute_deterioration_signals(
            roic_trend=roic_trend, operating_margin_trend=operating_margin_trend,
            net_margin_trend=net_margin_trend, fcf_margin_trend=fcf_margin_trend_full,
            revenue_trend=revenue_trend,
        )
        growth_engine_result = compute_weighted_growth(
            historical_growth_pct=base_historical_growth,
            cagr_windows=compute_cagr_windows(revenue_trend),
            avg_roic_pct=avg_roic,
            incremental_roic_pct=compute_incremental_roic(nopat_trend, invested_capital_trend),
            moat_result=growth_engine_moat,
            deterioration_result=growth_engine_deterioration,
        )
        driver_based_g1_rev_raw = growth_engine_result.quality_adjusted_growth_pct
        # Same "base" scenario cap the legacy model applies (FCF_DCF_SCENARIOS
        # never changes) — the driver-based "base case" growth used wherever
        # a single representative growth number is needed (driver_based_
        # valuation, Monte Carlo's anchor, the driver-based Reverse DCF's
        # fixed-growth question).
        driver_based_base_g1 = min(driver_based_g1_rev_raw, FCF_DCF_SCENARIOS["base"]["revenue_growth_cap_pct"] / 100)

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
        for name, assumptions in FCF_DCF_SCENARIOS.items():
            mult = assumptions["growth_multiplier"]
            dr = base_discount_rate + assumptions["discount_rate_delta_pct"] / 100
            rev_cap = assumptions["revenue_growth_cap_pct"] / 100
            fcf_cap = assumptions["fcf_growth_cap_pct"] / 100
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

        # Year-by-year audit table (Nivel 3 / "Ver modelo completo") — real
        # numbers straight from the same _run_dcf the base scenario itself
        # used, not a re-derivation that could drift from the headline value.
        base_g1 = base_scenario["stage1_growth_pct"] / 100
        base_dr_for_detail = base_scenario["discount_rate_pct"] / 100
        base_run_detail = _run_dcf(base_fcf, base_g1, base_dr_for_detail, terminal_growth)
        yearly_detail = [
            {
                "year": yr,
                "fcf": round(cf, 0),
                "discount_factor": round(1 / ((1 + base_dr_for_detail) ** yr), 4),
                "present_value": round(cf / ((1 + base_dr_for_detail) ** yr), 0),
            }
            for yr, cf in enumerate(base_run_detail["fcf_path"], start=1)
        ]

        # Sanity floor: a negative "intrinsic value per share" is never a
        # meaningful number to show a user — it means debt so overwhelms the
        # DCF-derived enterprise value that the model itself is unreliable
        # for this company right now (seen on a company mid-way through a
        # multi-year capex supercycle with heavy debt, e.g. Oracle's 2025
        # AI-datacenter buildout). Suppress the whole DCF rather than present
        # a nonsensical negative price — the prompt is instructed to say so
        # explicitly instead of inventing a number.
        if base_scenario["intrinsic_value_per_share"] > 0:
            margin_of_safety = calc_margin_of_safety(base_scenario["intrinsic_value_per_share"], price)
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
            # require, holding every other real input (margin, reinvestment,
            # WACC, terminal growth) fixed at Nuvos's own estimates? This is
            # the concrete, computed answer to "what is the investor buying
            # at this price" — not a narrative guess. Fase 1.5, Incremento 3:
            # solved against the SAME driver-based engine that computes
            # driver_based_valuation below, not the legacy model
            # — see reverse_dcf_engine.py's module docstring for why that
            # coherence matters. None when the driver-based inputs
            # (operating margin/reinvestment anchors, ROIC) aren't
            # computable — same guard driver_based_valuation uses below.
            implied_growth_pct = None
            if (
                operating_margin_anchor is not None and reinvestment_rate_anchor is not None
                and avg_roic is not None and avg_roic > 0
            ):
                implied_growth_pct = _implied_growth_rate(
                    revenue_0=latest_rev,
                    operating_margin_anchor_pct=operating_margin_anchor,
                    terminal_operating_margin_pct=operating_margin_anchor,
                    tax_rate=tax_rate,
                    reinvestment_rate_anchor_pct=reinvestment_rate_anchor,
                    terminal_roic_pct=avg_roic / 100,
                    discount_rate=base_discount_rate,
                    terminal_growth=terminal_growth,
                    net_cash=net_cash,
                    shares_out=projected_shares,
                    target_price=price,
                    high_growth_years=_DEFAULT_HIGH_GROWTH_YEARS,
                )

            # Mandatory sanity check — never present the implied growth
            # rate as a bare percentage. Compares it against the company's
            # OWN real historical FCF CAGR and flags a "regime change"
            # signal when the market prices in more than 2x that pace.
            reverse_dcf_sanity_check = sanity_check_reverse_dcf(implied_growth_pct, base_fcf, fcf_cagr)

            # ── Reverse DCF — market expectations panel ─────────────────────
            # Complements implied_growth_pct with the OTHER half of the
            # "what does today's price assume" question: holding growth at
            # Nuvos's own real trend-based estimate (never backed out from
            # price), what FCF margin would the market need to believe in for
            # the current price to be fair? Presented as belief-vs-belief,
            # never as "the market is wrong" — both are real, disclosed model
            # outputs, not certainties.
            implied_margin_pct = None
            if (
                latest_rev and operating_margin_anchor is not None
                and avg_roic is not None and avg_roic > 0
            ):
                implied_margin_pct = _implied_fcf_margin_at_fixed_growth(
                    revenue_0=latest_rev,
                    growth_fixed=driver_based_base_g1,
                    operating_margin_anchor_pct=operating_margin_anchor,
                    terminal_operating_margin_pct=operating_margin_anchor,
                    tax_rate=tax_rate,
                    terminal_roic_pct=avg_roic / 100,
                    discount_rate=base_discount_rate,
                    terminal_growth=terminal_growth,
                    net_cash=net_cash,
                    shares_out=projected_shares,
                    target_price=price,
                    high_growth_years=_DEFAULT_HIGH_GROWTH_YEARS,
                )
            # ── Reverse DCF 2.0 — Fase 1.5, Incremento 12: three more implied
            # variables (operating margin, terminal ROIC, base revenue), same
            # "hold everything else fixed at Nuvos's real estimate, solve for
            # this one" technique as implied_growth_pct/implied_margin_pct
            # above. "Implied FCF" (the 4th variable the increment asks for)
            # is deliberately NOT a 4th root-find — in this waterfall FCF is
            # never an independent lever, it's a RESULT of margin +
            # reinvestment + revenue, so it's derived arithmetically below
            # from implied_margin_pct's own already-solved year-1 figures
            # instead of re-running Brent's method for a question the model
            # doesn't actually treat as a free variable.
            implied_operating_margin_pct = None
            implied_terminal_roic_pct = None
            implied_base_revenue = None
            implied_fcf_year_1 = None
            if (
                operating_margin_anchor is not None and reinvestment_rate_anchor is not None
                and avg_roic is not None and avg_roic > 0
            ):
                implied_operating_margin_pct = _implied_operating_margin(
                    revenue_0=latest_rev,
                    growth_fixed=driver_based_base_g1,
                    reinvestment_rate_anchor_pct=reinvestment_rate_anchor,
                    tax_rate=tax_rate,
                    terminal_roic_pct=avg_roic / 100,
                    discount_rate=base_discount_rate,
                    terminal_growth=terminal_growth,
                    net_cash=net_cash,
                    shares_out=projected_shares,
                    target_price=price,
                    high_growth_years=_DEFAULT_HIGH_GROWTH_YEARS,
                )
                implied_terminal_roic_pct = _implied_terminal_roic(
                    revenue_0=latest_rev,
                    growth_fixed=driver_based_base_g1,
                    operating_margin_anchor_pct=operating_margin_anchor,
                    terminal_operating_margin_pct=operating_margin_anchor,
                    reinvestment_rate_anchor_pct=reinvestment_rate_anchor,
                    tax_rate=tax_rate,
                    discount_rate=base_discount_rate,
                    terminal_growth=terminal_growth,
                    net_cash=net_cash,
                    shares_out=projected_shares,
                    target_price=price,
                    high_growth_years=_DEFAULT_HIGH_GROWTH_YEARS,
                )
                implied_base_revenue = _implied_base_revenue(
                    revenue_0_estimate=latest_rev,
                    growth_fixed=driver_based_base_g1,
                    operating_margin_anchor_pct=operating_margin_anchor,
                    terminal_operating_margin_pct=operating_margin_anchor,
                    reinvestment_rate_anchor_pct=reinvestment_rate_anchor,
                    tax_rate=tax_rate,
                    terminal_roic_pct=avg_roic / 100,
                    discount_rate=base_discount_rate,
                    terminal_growth=terminal_growth,
                    net_cash=net_cash,
                    shares_out=projected_shares,
                    target_price=price,
                    high_growth_years=_DEFAULT_HIGH_GROWTH_YEARS,
                )
                if implied_margin_pct is not None:
                    implied_fcf_year_1 = round(implied_margin_pct / 100 * latest_rev * (1 + driver_based_base_g1), 0)

            market_expectations = {
                "market_implied_growth_pct": implied_growth_pct,
                "market_implied_fcf_margin_pct": implied_margin_pct,
                "market_implied_operating_margin_pct": implied_operating_margin_pct,
                "market_implied_terminal_roic_pct": implied_terminal_roic_pct,
                "market_implied_base_revenue": implied_base_revenue,
                "market_implied_fcf_year_1": implied_fcf_year_1,
                "nuvos_growth_estimate_pct": round(base_historical_growth * 100, 1),
                "nuvos_fcf_margin_estimate_pct": round(avg_fcf_margin * 100, 1),
                "nuvos_operating_margin_estimate_pct": round(operating_margin_anchor * 100, 1) if operating_margin_anchor is not None else None,
                "nuvos_terminal_roic_estimate_pct": round(avg_roic, 1) if avg_roic is not None else None,
                "nuvos_base_revenue_estimate": round(latest_rev, 0) if latest_rev else None,
            }

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

            # ── Driver-based DCF (Revenue -> Operating Margin -> EBIT ->
            # NOPAT -> Reinvestment -> FCF) — Fase 1, Incremento 2 of the
            # valuation-engine redesign (see
            # /Users/diegoarria/.claude/plans/stateful-painting-flurry.md).
            # Computed IN ADDITION to (never replacing) the FCF-fade model
            # above: the existing scenarios/sensitivity/reverse-DCF/scores
            # keep using the proven model above completely untouched. This
            # is surfaced as a second, more granular figure the frontend
            # can start showing once reviewed — a failure here must never
            # affect the primary valuation, hence the broad guard.
            driver_based_valuation = None
            if (
                operating_margin_anchor is not None and reinvestment_rate_anchor is not None
                and avg_roic is not None and avg_roic > 0
            ):
                try:
                    driver_result = project_driver_based_dcf(
                        revenue_0=latest_rev,
                        revenue_growth_1=driver_based_base_g1,
                        terminal_growth=terminal_growth,
                        operating_margin_anchor_pct=operating_margin_anchor,
                        terminal_operating_margin_pct=operating_margin_anchor,
                        tax_rate=tax_rate,
                        reinvestment_rate_anchor_pct=reinvestment_rate_anchor,
                        terminal_roic_pct=avg_roic / 100,
                        discount_rate=base_discount_rate,
                        net_cash=net_cash,
                        shares_out=projected_shares,
                        high_growth_years=_DEFAULT_HIGH_GROWTH_YEARS,
                    )
                    driver_based_valuation = {
                        "value_per_share": driver_result.value_per_share,
                        "enterprise_value": driver_result.enterprise_value,
                        "assumptions": driver_result.assumptions,
                        "yearly": [asdict(row) for row in driver_result.yearly],
                    }
                except (UnstableGordonGrowthError, ValueError) as e:
                    logger.info("get_fundamental_analysis(%s): driver-based DCF not computable: %s", ticker, e)

            # ── Driver-based scenarios + sensitivity matrix — Fase 1.5,
            # Incremento 4. Same shadow-mode discipline as
            # driver_based_valuation above (computed IN ADDITION to, never
            # replacing, the legacy scenarios/sensitivity_matrix): the exact
            # same FCF_DCF_SCENARIOS multipliers/caps and the exact same
            # WACC-rows x growth-cols grid, but every run is a real
            # project_driver_based_dcf call instead of legacy _run_dcf. This
            # is what the validation harness (Incremento 6) compares against
            # the legacy numbers above before the production flip
            # (Incremento 7) — a failure here must never affect the primary
            # valuation, hence the broad guard.
            driver_based_scenarios = None
            driver_based_sensitivity_matrix = None
            driver_based_value_drivers = None
            if (
                operating_margin_anchor is not None and reinvestment_rate_anchor is not None
                and avg_roic is not None and avg_roic > 0
            ):
                try:
                    driver_based_scenarios = {}
                    for name, assumptions in FCF_DCF_SCENARIOS.items():
                        mult = assumptions["growth_multiplier"]
                        dr = base_discount_rate + assumptions["discount_rate_delta_pct"] / 100
                        rev_cap = assumptions["revenue_growth_cap_pct"] / 100
                        g1_rev = min(driver_based_g1_rev_raw * mult, rev_cap)
                        scenario_result = project_driver_based_dcf(
                            revenue_0=latest_rev,
                            revenue_growth_1=g1_rev,
                            terminal_growth=terminal_growth,
                            operating_margin_anchor_pct=operating_margin_anchor,
                            terminal_operating_margin_pct=operating_margin_anchor,
                            tax_rate=tax_rate,
                            reinvestment_rate_anchor_pct=reinvestment_rate_anchor,
                            terminal_roic_pct=avg_roic / 100,
                            discount_rate=dr,
                            net_cash=net_cash,
                            shares_out=projected_shares,
                            high_growth_years=_DEFAULT_HIGH_GROWTH_YEARS,
                        )
                        driver_based_scenarios[name] = {
                            "revenue_growth_pct": round(g1_rev * 100, 1),
                            "discount_rate_pct": round(dr * 100, 1),
                            "intrinsic_value_per_share": scenario_result.value_per_share,
                            "revenue_year1": scenario_result.yearly[0].revenue,
                            "revenue_year10": scenario_result.yearly[-1].revenue,
                            "fcf_year1": scenario_result.yearly[0].fcf,
                            "fcf_year10": scenario_result.yearly[-1].fcf,
                        }

                    base_g1_rev = driver_based_scenarios["base"]["revenue_growth_pct"] / 100
                    db_wacc_rows = [
                        round(base_discount_rate - 0.01, 4), round(base_discount_rate, 4), round(base_discount_rate + 0.01, 4),
                    ]
                    db_growth_cols = [
                        max(base_g1_rev - 0.04, 0.0), max(base_g1_rev - 0.02, 0.0),
                        base_g1_rev, base_g1_rev + 0.02,
                    ]
                    driver_based_sensitivity_matrix = {
                        "wacc_rows_pct": [round(r * 100, 1) for r in db_wacc_rows],
                        "growth_cols_pct": [round(g * 100, 1) for g in db_growth_cols],
                        "values": [
                            [
                                project_driver_based_dcf(
                                    revenue_0=latest_rev,
                                    revenue_growth_1=g,
                                    terminal_growth=terminal_growth,
                                    operating_margin_anchor_pct=operating_margin_anchor,
                                    terminal_operating_margin_pct=operating_margin_anchor,
                                    tax_rate=tax_rate,
                                    reinvestment_rate_anchor_pct=reinvestment_rate_anchor,
                                    terminal_roic_pct=avg_roic / 100,
                                    discount_rate=r,
                                    net_cash=net_cash,
                                    shares_out=projected_shares,
                                    high_growth_years=_DEFAULT_HIGH_GROWTH_YEARS,
                                ).value_per_share
                                for g in db_growth_cols
                            ]
                            for r in db_wacc_rows
                        ],
                    }

                    # ── Value drivers ("why $X and not $Y") — Fase 1.5,
                    # Incremento 5. Same four real counterfactual DCFs as the
                    # legacy value_drivers above, each changing ONE
                    # assumption at a time and holding everything else at
                    # the base scenario's real values — but every run is now
                    # project_driver_based_dcf, and the shape adaptation the
                    # plan flagged: the legacy version reads
                    # dcf_result["fcf_path"] (a plain list); the driver-based
                    # result exposes `yearly: list[YearlyDriverRow]`
                    # instead, so "the base value" here is
                    # driver_based_scenarios["base"] rather than a
                    # re-derived local, and every counterfactual reads
                    # `.value_per_share` directly instead of manually adding
                    # back debt/cash (project_driver_based_dcf already does
                    # that internally when given net_cash + shares_out).
                    db_base_value = driver_based_scenarios["base"]["intrinsic_value_per_share"]

                    g1_no_moat = min(base_historical_growth, 0.25)
                    no_moat_result = project_driver_based_dcf(
                        revenue_0=latest_rev, revenue_growth_1=g1_no_moat, terminal_growth=terminal_growth,
                        operating_margin_anchor_pct=operating_margin_anchor, terminal_operating_margin_pct=operating_margin_anchor,
                        tax_rate=tax_rate, reinvestment_rate_anchor_pct=reinvestment_rate_anchor,
                        terminal_roic_pct=avg_roic / 100, discount_rate=base_discount_rate,
                        net_cash=net_cash, shares_out=projected_shares, high_growth_years=_DEFAULT_HIGH_GROWTH_YEARS,
                    )
                    db_moat_impact = round(db_base_value - no_moat_result.value_per_share, 2)

                    # Buyback impact: today's STATIC share count instead of
                    # the buyback-projected average — same real counterfactual
                    # question as the legacy driver, same base growth/margin/
                    # reinvestment/WACC otherwise.
                    no_buyback_result = project_driver_based_dcf(
                        revenue_0=latest_rev, revenue_growth_1=base_g1_rev, terminal_growth=terminal_growth,
                        operating_margin_anchor_pct=operating_margin_anchor, terminal_operating_margin_pct=operating_margin_anchor,
                        tax_rate=tax_rate, reinvestment_rate_anchor_pct=reinvestment_rate_anchor,
                        terminal_roic_pct=avg_roic / 100, discount_rate=base_discount_rate,
                        net_cash=net_cash, shares_out=shares_out, high_growth_years=_DEFAULT_HIGH_GROWTH_YEARS,
                    )
                    db_buyback_impact = round(db_base_value - no_buyback_result.value_per_share, 2)

                    lower_wacc_result = project_driver_based_dcf(
                        revenue_0=latest_rev, revenue_growth_1=base_g1_rev, terminal_growth=terminal_growth,
                        operating_margin_anchor_pct=operating_margin_anchor, terminal_operating_margin_pct=operating_margin_anchor,
                        tax_rate=tax_rate, reinvestment_rate_anchor_pct=reinvestment_rate_anchor,
                        terminal_roic_pct=avg_roic / 100, discount_rate=max(base_discount_rate - 0.01, 0.01),
                        net_cash=net_cash, shares_out=projected_shares, high_growth_years=_DEFAULT_HIGH_GROWTH_YEARS,
                    )
                    db_wacc_impact_per_1pp = round(lower_wacc_result.value_per_share - db_base_value, 2)

                    # Margin-normalization impact: the analog of the legacy
                    # driver's "raw last-year FCF vs. recency-weighted
                    # normalized FCF" is "raw last-year operating margin vs.
                    # the recency-weighted operating_margin_anchor" — same
                    # question (what does normalizing actually buy you),
                    # same lever this model actually has.
                    latest_om_raw = next((v for v in reversed(operating_margin_trend) if v is not None), None)
                    if latest_om_raw is not None:
                        raw_margin_result = project_driver_based_dcf(
                            revenue_0=latest_rev, revenue_growth_1=base_g1_rev, terminal_growth=terminal_growth,
                            operating_margin_anchor_pct=latest_om_raw / 100, terminal_operating_margin_pct=latest_om_raw / 100,
                            tax_rate=tax_rate, reinvestment_rate_anchor_pct=reinvestment_rate_anchor,
                            terminal_roic_pct=avg_roic / 100, discount_rate=base_discount_rate,
                            net_cash=net_cash, shares_out=projected_shares, high_growth_years=_DEFAULT_HIGH_GROWTH_YEARS,
                        )
                        db_margin_normalization_impact = round(db_base_value - raw_margin_result.value_per_share, 2)
                    else:
                        db_margin_normalization_impact = None

                    driver_based_value_drivers = {
                        "moat_impact_per_share": db_moat_impact,
                        "buyback_impact_per_share": db_buyback_impact,
                        "wacc_impact_per_1pp_lower_per_share": db_wacc_impact_per_1pp,
                        "margin_normalization_impact_per_share": db_margin_normalization_impact,
                    }
                except (UnstableGordonGrowthError, ValueError) as e:
                    logger.info("get_fundamental_analysis(%s): driver-based scenarios not computable: %s", ticker, e)
                    driver_based_scenarios = None
                    driver_based_sensitivity_matrix = None
                    driver_based_value_drivers = None

            # ── Relative Valuation + Historical Valuation + Industry
            # Benchmarks. `industry` isn't known at this scope (only `sector`
            # is, from the Finnhub profile) — peer matching here falls back
            # to sector-only, a real but slightly looser peer group than
            # screener.py's industry-aware call; callers that already
            # recompute these with real `industry` (screener.py,
            # undervalued_screener_service.py) pass
            # `_compute_peer_dependent_data=False` here to avoid paying for
            # the weaker version too. Broad except: these are an enrichment
            # (they feed the exit multiple anchor — decision #1 — and
            # display), never allowed to break the primary DCF result.
            #
            # Incremento 12 — Consensus Engine (the archetype-weighted blend
            # of Conservative DCF/Professional DCF/Relative/Historical that
            # used to be shown as "5 methods") is retired: the Nuvos AI Fair
            # Value Engine's Bear/Base/Bull IS the single number shown to
            # users now (Incremento 11 — THE FLIP).
            relative_valuation = None
            historical_valuation = None
            industry_benchmarks = None
            if _compute_peer_dependent_data:
                try:
                    from app.services.relative_valuation_service import compute_relative_valuation
                    from app.services.historical_valuation_service import compute_historical_valuation
                    from app.services.quality.industry_engine import compute_industry_benchmarks

                    _latest_income_row = income[-1] if income else {}
                    _latest_eps = _num(_latest_income_row.get("Diluted EPS")) or _num(_latest_income_row.get("Basic EPS"))
                    _latest_ebitda = _num(_latest_income_row.get("EBITDA"))
                    _latest_fcf = fcf_valid[-1] if fcf_valid else None

                    # Shared across relative_valuation AND industry_benchmarks
                    # — both resolve the SAME peer group here (same sector,
                    # industry=None) via _find_peers, so without this a real
                    # live request fetched every peer's full analysis TWICE
                    # (~20 sequential peer fetches instead of ~10), found via
                    # a real-network smoke test that took 94s before this
                    # cache was added.
                    _peer_analysis_cache: dict = {}
                    if price and shares_out:
                        relative_valuation = compute_relative_valuation(
                            ticker, price, shares_out, _latest_eps, _latest_ebitda, _latest_fcf,
                            total_debt, cash_latest, sector, None,
                            analysis_cache=_peer_analysis_cache,
                        )
                        if n >= 5:
                            historical_valuation = compute_historical_valuation(
                                ticker, income, balance, cashflow, price, shares_out, total_debt, cash_latest,
                                _latest_eps, _latest_ebitda, _latest_fcf,
                            )
                    industry_benchmarks_result = compute_industry_benchmarks(
                        ticker, sector, None, analysis_cache=_peer_analysis_cache,
                    )
                    industry_benchmarks = asdict(industry_benchmarks_result) if industry_benchmarks_result else None
                except Exception as e:
                    logger.info("get_fundamental_analysis(%s): relative/historical/industry not computable: %s", ticker, e)

            # ── Nuvos AI Fair Value Engine — Incremento 6 (see
            # /Users/diegoarria/.claude/plans/stateful-painting-flurry.md).
            # The convergence point: one engine, three named scenarios
            # (Bear/Base/Bull), each with its own exit-multiple terminal
            # value (Incremento 2) derived from real anchors (Incremento 1,
            # fed by relative_valuation/historical_valuation/
            # industry_benchmarks above), and its own growth/margin/ROIC
            # assumptions blended by the Assumptions Engine (Incremento 4)
            # across BEAR_BASE_BULL's deltas (Incremento 5). Computed IN
            # ADDITION to driver_based_scenarios above — shadow mode, same
            # broad guard, until the validation gate (Incremento 8) clears
            # and the flip (Incremento 11) happens.
            nuvos_fair_value = None
            if (
                operating_margin_anchor is not None and reinvestment_rate_anchor is not None
                and avg_roic is not None and avg_roic > 0
            ):
                try:
                    from app.services.valuation.exit_multiple_engine import select_exit_metric, derive_exit_multiple
                    from app.services.valuation.assumptions_engine import compute_weighted_assumption
                    from app.services.quality.industry_engine import classify_industry
                    from app.services.analyst_estimates_service import get_analyst_estimates

                    analyst_estimates = None
                    try:
                        analyst_estimates = get_analyst_estimates(ticker)
                    except Exception as e:
                        logger.info("get_fundamental_analysis(%s): analyst estimates not computable: %s", ticker, e)

                    # Recomputed locally rather than reusing the peer-
                    # dependent block's _latest_ebitda/_latest_fcf above —
                    # those are only defined when _compute_peer_dependent_
                    # data=True, and this block must work either way.
                    _nuvos_latest_income_row = income[-1] if income else {}
                    _nuvos_own_ebitda = _num(_nuvos_latest_income_row.get("EBITDA"))
                    _nuvos_own_ebit = _num(_nuvos_latest_income_row.get("Operating Income"))
                    _nuvos_own_fcf = fcf_valid[-1] if fcf_valid else None

                    exit_category = classify_industry(sector, None)
                    exit_metric = select_exit_metric(exit_category)

                    growth_assumption = compute_weighted_assumption(
                        dimension="revenue_growth_1",
                        historical_value_pct=base_historical_growth * 100,
                        industry_value_pct=(industry_benchmarks or {}).get("median_revenue_cagr_pct"),
                        wall_street_value_pct=analyst_estimates.revenue_growth_next_year_pct if analyst_estimates else None,
                        business_quality_value_pct=growth_engine_result.quality_adjusted_growth_pct * 100,
                    )
                    margin_assumption = compute_weighted_assumption(
                        dimension="terminal_operating_margin",
                        historical_value_pct=operating_margin_anchor * 100,
                        industry_value_pct=(industry_benchmarks or {}).get("median_operating_margin_pct"),
                        wall_street_value_pct=None,
                        business_quality_value_pct=None,
                    )
                    roic_assumption = compute_weighted_assumption(
                        dimension="terminal_roic",
                        historical_value_pct=avg_roic,
                        industry_value_pct=(industry_benchmarks or {}).get("median_roic_pct"),
                        wall_street_value_pct=None,
                        business_quality_value_pct=None,
                    )

                    blended_growth_pct = growth_assumption.blended_value_pct if growth_assumption.blended_value_pct is not None else base_historical_growth * 100
                    blended_margin_pct = margin_assumption.blended_value_pct if margin_assumption.blended_value_pct is not None else operating_margin_anchor * 100
                    blended_roic_pct = roic_assumption.blended_value_pct if roic_assumption.blended_value_pct is not None else avg_roic

                    exit_multiple_result = derive_exit_multiple(
                        metric=exit_metric,
                        own_historical_ev_ebitda=(historical_valuation or {}).get("historical_median_ev_ebitda"),
                        own_historical_ev_fcf=None,
                        peer_median_ev_ebitda=(relative_valuation or {}).get("peer_median_ev_ebitda"),
                        peer_median_ev_fcf=(relative_valuation or {}).get("peer_median_ev_fcf"),
                        own_ebitda=_nuvos_own_ebitda,
                        own_ebit=_nuvos_own_ebit,
                        own_revenue=latest_rev,
                        own_fcf=_nuvos_own_fcf,
                        expected_eps_growth_pct=analyst_estimates.eps_growth_next_year_pct if analyst_estimates else None,
                        roic_pct=avg_roic,
                        cost_of_capital_pct=base_discount_rate * 100,
                        fcf_margin_pct=round(avg_fcf_margin * 100, 1),
                        net_debt_to_ebitda=round((total_debt - cash_latest) / _nuvos_own_ebitda, 2) if _nuvos_own_ebitda else None,
                        interest_coverage=None,
                        dividend_yield_pct=None,
                        moat_score=None,
                        management_score=None,
                    )

                    nuvos_scenarios = {}
                    for name, deltas in BEAR_BASE_BULL.items():
                        # business_quality_score not yet computed at this
                        # point in the function (it blends several trend
                        # scores built further down) — None falls back to
                        # the neutral midpoint, a real (if less sharp) cap
                        # rather than skipping the scenario.
                        growth_cap_pct = bear_base_bull_growth_cap_pct(None, name)
                        g1 = clamp((blended_growth_pct + deltas["growth_delta_pp"]) / 100, -0.5, growth_cap_pct / 100)
                        margin_start = max((blended_margin_pct + deltas["operating_margin_start_delta_pp"]) / 100, 0.0)
                        margin_terminal = max((blended_margin_pct + deltas["operating_margin_terminal_delta_pp"]) / 100, 0.0)
                        dr = max(base_discount_rate + deltas["discount_rate_delta_pct"] / 100, 0.04)
                        scenario_exit_multiple = exit_multiple_result.exit_multiple * (1 + deltas["exit_multiple_delta_fraction"])

                        scenario_result = project_driver_based_dcf(
                            revenue_0=latest_rev,
                            revenue_growth_1=g1,
                            terminal_growth=terminal_growth,
                            operating_margin_anchor_pct=margin_start,
                            terminal_operating_margin_pct=margin_terminal,
                            tax_rate=tax_rate,
                            reinvestment_rate_anchor_pct=reinvestment_rate_anchor,
                            terminal_roic_pct=max(blended_roic_pct, 0.5) / 100,
                            discount_rate=dr,
                            net_cash=net_cash,
                            shares_out=projected_shares,
                            high_growth_years=deltas["high_growth_years"],
                            exit_multiple=scenario_exit_multiple,
                            exit_metric=exit_metric,
                        )
                        nuvos_scenarios[name] = {
                            "fair_value_per_share": scenario_result.value_per_share,
                            "assumptions": scenario_result.assumptions,
                        }

                    price_implied_scenario = None
                    if price:
                        real_values = {k: v["fair_value_per_share"] for k, v in nuvos_scenarios.items() if v["fair_value_per_share"] is not None}
                        if real_values:
                            price_implied_scenario = min(real_values.items(), key=lambda kv: abs(kv[1] - price))[0]

                    # ── Sensitivity matrix — Nuvos AI Fair Value Engine
                    # redesign, Incremento 15. WACC x exit multiple, not WACC
                    # x growth: this engine's terminal value comes from a real
                    # exit multiple (Incremento 2), so growth alone would miss
                    # the actual lever driving the number. The 5 multiple
                    # columns use the SAME exit_multiple_delta_fraction spread
                    # BEAR_BASE_BULL already applies (-25/-15/0/+15/+25%) —
                    # the 3 middle columns ARE Bear/Base/Bull's own multiple,
                    # so this heatmap and the scenario panel tell one story,
                    # not two. Base-case growth/margin/ROIC held fixed (only
                    # WACC and the multiple vary) — same "one lever at a time"
                    # discipline as value_drivers/driver_based_sensitivity_matrix
                    # above. Own try/except: a failure here must never cost
                    # the 3 real scenarios already computed above.
                    nuvos_sensitivity_matrix = None
                    try:
                        nuvos_wacc_rows = [
                            round(base_discount_rate - 0.01, 4), round(base_discount_rate, 4), round(base_discount_rate + 0.01, 4),
                        ]
                        nuvos_multiple_cols = [
                            round(exit_multiple_result.exit_multiple * (1 + f), 2)
                            for f in (-0.25, -0.15, 0.0, 0.15, 0.25)
                        ]
                        base_g1 = clamp(blended_growth_pct / 100, -0.5, bear_base_bull_growth_cap_pct(None, "base") / 100)
                        base_margin = max(blended_margin_pct / 100, 0.0)
                        nuvos_sensitivity_matrix = {
                            "wacc_rows_pct": [round(r * 100, 1) for r in nuvos_wacc_rows],
                            "multiple_cols": nuvos_multiple_cols,
                            "exit_metric": exit_metric,
                            "values": [
                                [
                                    project_driver_based_dcf(
                                        revenue_0=latest_rev,
                                        revenue_growth_1=base_g1,
                                        terminal_growth=terminal_growth,
                                        operating_margin_anchor_pct=base_margin,
                                        terminal_operating_margin_pct=base_margin,
                                        tax_rate=tax_rate,
                                        reinvestment_rate_anchor_pct=reinvestment_rate_anchor,
                                        terminal_roic_pct=max(blended_roic_pct, 0.5) / 100,
                                        discount_rate=r,
                                        net_cash=net_cash,
                                        shares_out=projected_shares,
                                        high_growth_years=BEAR_BASE_BULL["base"]["high_growth_years"],
                                        exit_multiple=m,
                                        exit_metric=exit_metric,
                                    ).value_per_share
                                    for m in nuvos_multiple_cols
                                ]
                                for r in nuvos_wacc_rows
                            ],
                        }
                    except (UnstableGordonGrowthError, ValueError) as e:
                        logger.info("get_fundamental_analysis(%s): nuvos sensitivity matrix not computable: %s", ticker, e)

                    nuvos_fair_value = {
                        "scenarios": nuvos_scenarios,
                        "exit_metric": exit_metric,
                        "exit_multiple_anchor_source": exit_multiple_result.anchor_source,
                        "price_implied_scenario": price_implied_scenario,
                        "growth_factors": [asdict(f) for f in growth_assumption.factors],
                        "operating_margin_factors": [asdict(f) for f in margin_assumption.factors],
                        "terminal_roic_factors": [asdict(f) for f in roic_assumption.factors],
                        "sensitivity_matrix": nuvos_sensitivity_matrix,
                    }
                except (UnstableGordonGrowthError, ValueError) as e:
                    logger.info("get_fundamental_analysis(%s): nuvos_fair_value not computable: %s", ticker, e)

            dcf = {
                "base_fcf": round(base_fcf, 0),
                "avg_fcf_margin_pct": round(avg_fcf_margin * 100, 1),
                "base_revenue": round(latest_rev, 0) if latest_rev else None,
                "sector": sector,
                "base_discount_rate_pct": round(base_discount_rate * 100, 2),
                "wacc_details": wacc_details,
                "scenario_config_version": SCENARIO_CONFIG_VERSION,
                "terminal_growth_pct": round(terminal_growth * 100, 2),
                "projection_years": _PROJECTION_YEARS,
                "total_debt": round(total_debt, 0),
                "cash": round(cash_latest, 0),
                "shares_outstanding": round(shares_out, 0),
                "projected_shares_outstanding": round(projected_shares, 0),
                "buyback_rate_pct": round(buyback_rate * 100, 1),
                "current_price": price,
                "scenarios": scenarios,
                "fair_value_range": combine_fair_value_range(nuvos_fair_value, _fair_value_range(scenarios)),
                "relative_valuation": relative_valuation,
                "historical_valuation": historical_valuation,
                "industry_benchmarks": industry_benchmarks,
                "nuvos_fair_value": nuvos_fair_value,
                "margin_of_safety_pct": margin_of_safety,
                "sensitivity": sensitivity,
                "implied_growth_pct": implied_growth_pct,
                "reverse_dcf_sanity_check": reverse_dcf_sanity_check,
                "market_expectations": market_expectations,
                "expectations_investing": expectations_investing,
                "confidence_score": confidence_score,
                "fcf_volatility_cv": round(fcf_cv, 2) if fcf_cv is not None else None,
                "probability_weights": {"pessimistic": prob_weights[0], "base": prob_weights[1], "optimistic": prob_weights[2]},
                "expected_value_per_share": expected_value_per_share,
                "value_drivers": value_drivers,
                "sensitivity_matrix": sensitivity_matrix,
                "yearly_detail": yearly_detail,
                "pv_of_fcf_sum": round(base_run_detail["pv_of_fcf_sum"], 0),
                "pv_of_terminal_value": round(base_run_detail["pv_of_terminal_value"], 0),
                "enterprise_value": round(base_run_detail["enterprise_value"], 0),
                "growth_buildup": {
                    "historical_growth_pct": round(base_historical_growth * 100, 1),
                    "moat_adjustment_pct": round(moat_adjustment * 100, 1),
                    "avg_roic_pct": round(avg_roic, 1) if avg_roic is not None else None,
                    "quality_adjusted_growth_pct": round(g1_rev_raw * 100, 1),
                    "buyback_rate_pct": round(buyback_rate * 100, 1),
                    "fcf_per_share_cagr_pct": fcf_per_share_cagr,
                },
                "driver_based_valuation": driver_based_valuation,
                "driver_based_scenarios": driver_based_scenarios,
                "driver_based_sensitivity_matrix": driver_based_sensitivity_matrix,
                "driver_based_value_drivers": driver_based_value_drivers,
                "growth_engine": {
                    "historical_growth_pct": growth_engine_result.historical_growth_pct,
                    "quality_adjusted_growth_pct": round(growth_engine_result.quality_adjusted_growth_pct * 100, 1),
                    "total_adjustment_pct": growth_engine_result.total_adjustment_pct,
                    "factors": [asdict(f) for f in growth_engine_result.factors],
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
    interest_coverage = None
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
    # Fase 2, Incremento 5 (Earnings Quality Engine): the raw SBC field has
    # been fetched into every cashflow-statement row since before this
    # project started (see financial_data_service.py) but nothing ever
    # read it until now.
    latest_cashflow_row = cashflow[-1] if cashflow else {}
    sbc_latest = _num(latest_cashflow_row.get("Stock Based Compensation"))
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
        # Confidence Meter — computed once here, generically, for whichever
        # methodology produced `dcf` (FCF DCF or Justified P/B both populate
        # the same "confidence_score"/"fair_value_range" keys).
        #
        # Fase 1.5, Incremento 18 (Confidence Engine 2.0) — the 2 signals
        # the original brief asked for and the audit found missing:
        # financial-statement quality (data_validation, computed near the
        # top of this function, previously only used to warn in the LLM
        # prompt) and management consistency (dividend-cut history +
        # reinvestment-rate stability, both already-real trends this
        # function computes for the DCF engine itself — reused here, not
        # re-derived). Both network-free, so both are always computable
        # here (unlike Methods 3/4's cross-method spread, which needs the
        # peer/historical fetches only screener.py's live path does).
        financial_statement_quality_score = compute_financial_statement_quality_score(data_validation["years_flagged"])
        dividend_consistency_score, _dividend_cuts = evaluate_dividend_consistency(dividends_paid_trend)
        reinvestment_quality_score = evaluate_reinvestment_quality(reinvestment_rate_trend)
        management_consistency_score = compute_management_consistency_score(
            dividend_consistency_score, reinvestment_quality_score,
        )
        dcf["financial_statement_quality_score"] = financial_statement_quality_score
        dcf["management_consistency_score"] = management_consistency_score

        dcf["confidence_meter"] = compute_confidence_meter_v3(
            dcf.get("confidence_score"), n, dcf.get("fair_value_range") or {}, liquidity_ok=liquidity_gate.get("paso", True),
            business_quality_score=business_quality_score, financial_strength_score=financial_strength_score,
            financial_statement_quality_score=financial_statement_quality_score,
            management_consistency_score=management_consistency_score,
        )
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
        "change_pct": _num(quote.get("change_pct")),
        "exchange": profile.get("exchange"),
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
        "nopat_trend": nopat_trend,
        "invested_capital_trend": invested_capital_trend,
        "total_assets_trend": total_assets_trend,
        "current_assets_trend": current_assets_trend,
        "current_liabilities_trend": current_liabilities_trend,
        "inventory_trend": inventory_trend,
        "eps_trend": [
            _num(row.get("Diluted EPS")) or _num(row.get("Basic EPS")) for row in income
        ],
        # Fase 2, Incremento 4 (Capital Allocation Engine): real per-year
        # dividends paid and implied share count, plus the full fiscal
        # period date strings (get_historical_prices_near_dates needs real
        # "YYYY-MM-DD" dates, not the truncated 4-char `years` above) —
        # feeds buyback-timing analysis (was a real historical price cheap
        # or expensive vs. today) the same way historical_valuation_service
        # already uses this exact function for its own multiples.
        "dividends_paid_trend": dividends_paid_trend,
        "implied_shares_trend": implied_shares_trend,
        "reinvestment_rate_trend": reinvestment_rate_trend,
        "fiscal_period_dates": [row.get("period") for row in income],
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
        "composite_score": _composite_ranking_score(thesis_scores, sector),
        "checklist_items_real": checklist_items_real,
        "pe_ratio": pe_ratio,
        "ev_ebitda": ev_ebitda,
        "peg_ratio": peg_ratio,
        "ev_fcf": ev_fcf,
        "p_fcf": p_fcf,
        "dividend_yield_pct": dividend_yield_pct,
        "ebitda": round(latest_ebitda, 0) if latest_ebitda else None,
        "sbc_latest": round(sbc_latest, 0) if sbc_latest is not None else None,
        "interest_coverage": round(interest_coverage, 2) if interest_coverage is not None else None,
        "latest_eps": round(latest_eps, 2) if latest_eps is not None else None,
        "analyst_target": analyst_target,
        "data_years_available": n,
        "data_source": fin.get("provider"),
        "liquidity_gate": liquidity_gate,
        "data_validation": data_validation,
        "sector_model_note": sector_model_note,
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


def format_segments_summary(segments: list[dict]) -> str:
    """Renders the company's real revenue-segment breakdown (`segments`,
    already computed above from `financial_data_service.
    get_revenue_segments` — never re-fetched here) into plain text for an
    AI prompt. Promoted here (Fase 3, Incremento 3) from `quality.
    catalysts_engine._format_segments_summary` (which becomes a thin
    alias) so `research.business_understanding` reuses the exact same
    formatter instead of a third near-identical copy — this module is
    where `segments` itself is computed, so the formatter for it lives
    here too."""
    if not segments:
        return ""
    lines = ["Segmentos de ingresos reales (último período fiscal disponible, fuente: reportes de la empresa):"]
    for s in segments:
        pct = f"{s['pct_of_total']}%" if s.get("pct_of_total") is not None else "N/D"
        lines.append(f"- {s.get('name')}: ${s.get('revenue'):,.0f} ({pct} del total)")
    return "\n".join(lines)


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
    liquidity_gate = data.get("liquidity_gate")
    if liquidity_gate and not liquidity_gate.get("paso"):
        lines.append(
            f"⚠️ ALERTA DE LIQUIDEZ REAL (debes abrir tu respuesta con esto, ANTES de cualquier cifra de valoración): "
            f"{liquidity_gate['detalle']} No presentes el valor intrínseco/margen de seguridad con el mismo tono de "
            f"confianza que usarías para una acción líquida — dilo explícitamente."
        )
        lines.append("")
    data_validation = data.get("data_validation")
    if data_validation and data_validation.get("requiere_revision_manual"):
        lines.append(
            f"⚠️ ALERTA DE VALIDACIÓN CONTABLE (menciónalo antes de usar cifras de esos años específicos): "
            f"{data_validation['detalle']}"
        )
        lines.append("")
    sector_model_note = data.get("sector_model_note")
    if sector_model_note:
        lines.append(f"ℹ️ NOTA DE MODELO DE VALUACIÓN (explícasela al usuario, no la omitas): {sector_model_note['detalle']}")
        lines.append("")
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
            sanity = dcf.get("reverse_dcf_sanity_check")
            if sanity:
                lines.append(f"SANITY CHECK del DCF inverso (obligatorio mencionar): {sanity['detalle']}")
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
