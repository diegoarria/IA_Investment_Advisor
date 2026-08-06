"""
Confidence Engine — Fase 1, Incremento 5 of the Nuvos AI valuation
redesign (see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md,
Parte F). This is a real, disclosed follow-through on a gap
`fundamental_analysis_service._confidence_meter` already flags in its own
docstring: the "method agreement" component was a PROXY (the bear/bull
scenario spread already in `fair_value_range`) because, at the point
`_confidence_meter` runs, Methods 3 (Relative) and 4 (Historical) haven't
been computed yet — they're computed later, in the API layer
(`screener.py`'s `_build_quick_analysis`), from a live peer/historical
price fetch that `get_fundamental_analysis()` itself doesn't do.

This module provides the upgrade: once Methods 3/4 ARE available (in the
API layer, after `_compute_extra_valuations` returns), recompute the
"agreement" component from the REAL spread across independent valuation
methods (DCF base case, Relative, Historical) instead of the scenario-range
proxy. When fewer than 2 real method values are available (e.g. a recent
IPO with no 5-year price history, or a thinly-covered ticker with no real
peer group), this degrades EXACTLY to the original proxy — same score,
same behavior — so this is additive, not a silent behavior change for
every ticker.
"""

from __future__ import annotations

import statistics
from typing import Optional

from app.services.valuation.numeric_helpers import _score, weighted_mean


def compute_cross_method_spread_pct(values: list[Optional[float]]) -> Optional[float]:
    """(max - min) / median * 100 across the real, positive values in
    `values` — the same "how much do independent methods agree" question
    the proxy was already answering, just measured directly across DCF/
    Relative/Historical instead of inferred from the DCF's own bear/bull
    scenario spread. Requires at least 2 real values (spread is undefined
    with 0 or 1); returns None otherwise so the caller knows to fall back
    to the proxy rather than treating a single value as "perfect
    agreement." Capped at 100 to match the original proxy's own cap."""
    valid = [v for v in values if v is not None and v > 0]
    if len(valid) < 2:
        return None
    median = statistics.median(valid)
    if median <= 0:
        return None
    return min(100.0, (max(valid) - min(valid)) / median * 100)


def compute_confidence_meter_v2(
    predictability_score: Optional[float], years_available: int,
    fair_value_range: dict, liquidity_ok: bool,
    business_quality_score: Optional[float] = None,
    financial_strength_score: Optional[float] = None,
    method_values: Optional[list[Optional[float]]] = None,
) -> Optional[dict]:
    """Same weights/formula as `fundamental_analysis_service._confidence_meter`
    (0.25 predictability + 0.15 business quality + 0.10 financial strength +
    0.20 data completeness + 0.20 method agreement + 0.10 liquidity) — only
    the "agreement" component's SOURCE changes: real cross-method spread
    (`method_values`, typically [dcf_base, relative, historical]) when at
    least 2 of those are real values, else the exact same scenario-range
    proxy the v1 function used. `dispersion_source` in the result discloses
    which one was actually used for this specific ticker, so the frontend/
    prompt layer can be honest about it rather than implying every score
    used real cross-method data."""
    if predictability_score is None:
        return None
    completeness = min(100, round(years_available / 10 * 100))

    cross_method_dispersion = compute_cross_method_spread_pct(method_values) if method_values else None
    if cross_method_dispersion is not None:
        dispersion_pct = cross_method_dispersion
        dispersion_source = "cross_method"
    else:
        base, low, high = fair_value_range.get("base"), fair_value_range.get("low"), fair_value_range.get("high")
        dispersion_pct = min(100, abs(high - low) / base * 100) if base and base > 0 else 50.0
        dispersion_source = "scenario_range_proxy"
    agreement = 100 - dispersion_pct

    liquidity_component = 100 if liquidity_ok else 40
    bq = business_quality_score if business_quality_score is not None else predictability_score
    fs = financial_strength_score if financial_strength_score is not None else predictability_score

    score = round(
        0.25 * predictability_score
        + 0.15 * bq
        + 0.10 * fs
        + 0.20 * completeness
        + 0.20 * agreement
        + 0.10 * liquidity_component
    )
    if score >= 85: label = "Alta confianza"
    elif score >= 65: label = "Confianza moderada"
    elif score >= 45: label = "Confianza baja"
    else: label = "Especulativo — rango amplio de incertidumbre"
    stars = max(1, min(5, round(score / 20)))
    return {"score": int(score), "label": label, "stars": stars, "dispersion_source": dispersion_source}


def compute_financial_statement_quality_score(years_flagged: list[str]) -> float:
    """Fase 1.5, Incremento 18 (Confidence Engine 2.0) — connects the
    `data_validation` cross-check (`fundamental_analysis_service.py`'s
    Revenue-COGS-OpEx vs. reported Operating Income comparison, per year)
    to the Confidence Score for the first time; previously only used to
    warn in the LLM prompt (`ai_service.py`), never scored. Always returns
    a real value (never None) — every ticker has this check available, no
    optional network dependency. 100 with zero flagged years; each flagged
    year costs 25 points (a genuine accounting inconsistency, not rounding
    noise — see `financial_data_service._income_period`'s validation
    tolerance), floored at 20 rather than 0 so this one signal alone can't
    zero out an otherwise-strong overall confidence score."""
    return 100.0 if not years_flagged else max(20.0, 100.0 - 25.0 * len(years_flagged))


def compute_management_consistency_score(
    dividend_consistency_score: Optional[float], reinvestment_quality_score: Optional[float],
) -> Optional[float]:
    """Fase 1.5, Incremento 18 — "consistencia de management," built from 2
    already-real, network-free signals `quality.capital_allocation_engine`
    already computes (`evaluate_dividend_consistency`/
    `evaluate_reinvestment_quality`): has the company avoided real dividend
    cuts, and is its reinvestment-rate policy stable year to year rather
    than erratic. Deliberately excludes `evaluate_buyback_timing` (needs a
    real historical-price fetch per year) — `get_fundamental_analysis()`
    stays network-free for this component, same discipline the Growth
    Engine (Incremento 8) already established. None (never a fabricated
    50) when NEITHER signal is available (e.g. no dividend history and too
    few reinvestment-rate years) — `weighted_mean` renormalizes over
    whichever signal IS present otherwise."""
    return weighted_mean([(dividend_consistency_score, 0.5), (reinvestment_quality_score, 0.5)])


def compute_confidence_meter_v3(
    predictability_score: Optional[float], years_available: int,
    fair_value_range: dict, liquidity_ok: bool,
    business_quality_score: Optional[float] = None,
    financial_strength_score: Optional[float] = None,
    method_values: Optional[list[Optional[float]]] = None,
    financial_statement_quality_score: Optional[float] = None,
    management_consistency_score: Optional[float] = None,
) -> Optional[dict]:
    """Fase 1.5, Incremento 18 — superset of `compute_confidence_meter_v2`,
    adding the 2 signals the original brief asked for and the audit found
    missing (docs/FASE1.5_VALUATION_ENGINE_AUDIT.md, section 5/6):
    financial-statement quality and management consistency. Weights
    rebalanced (still sum to 1.0) rather than just appended on top, so the
    two new signals genuinely count rather than being additive noise:
    predictability 0.25->0.20, completeness 0.20->0.15, agreement
    0.20->0.15 (each trimmed 0.05), funding the 2 new 0.10/0.05 slots.
    Uses `weighted_mean` (not the v1/v2 hardcoded weighted sum) so either
    new component being None (financial_statement_quality_score never is in
    practice; management_consistency_score can be, per its own docstring)
    renormalizes over what's actually available instead of silently
    counting a missing signal as zero."""
    if predictability_score is None:
        return None
    completeness = min(100, round(years_available / 10 * 100))

    cross_method_dispersion = compute_cross_method_spread_pct(method_values) if method_values else None
    if cross_method_dispersion is not None:
        dispersion_pct = cross_method_dispersion
        dispersion_source = "cross_method"
    else:
        base, low, high = fair_value_range.get("base"), fair_value_range.get("low"), fair_value_range.get("high")
        dispersion_pct = min(100, abs(high - low) / base * 100) if base and base > 0 else 50.0
        dispersion_source = "scenario_range_proxy"
    agreement = 100 - dispersion_pct

    liquidity_component = 100 if liquidity_ok else 40
    bq = business_quality_score if business_quality_score is not None else predictability_score
    fs = financial_strength_score if financial_strength_score is not None else predictability_score

    score_raw = weighted_mean([
        (predictability_score, 0.20),
        (bq, 0.15),
        (fs, 0.10),
        (completeness, 0.15),
        (agreement, 0.15),
        (liquidity_component, 0.10),
        (financial_statement_quality_score, 0.10),
        (management_consistency_score, 0.05),
    ])
    score = round(score_raw) if score_raw is not None else 0
    if score >= 85: label = "Alta confianza"
    elif score >= 65: label = "Confianza moderada"
    elif score >= 45: label = "Confianza baja"
    else: label = "Especulativo — rango amplio de incertidumbre"
    stars = max(1, min(5, round(score / 20)))
    return {"score": int(score), "label": label, "stars": stars, "dispersion_source": dispersion_source}


# ── v1 functions (Fase 1, Incremento 7 — Parte I: relocated verbatim from
# fundamental_analysis_service.py, behavior unchanged, pinned by the
# Incremento 1 regression suite in tests/test_valuation_dcf_core.py::
# TestConfidenceScore). compute_confidence_meter_v2 above is the real
# upgrade (real cross-method spread); these are the originals it degrades
# to when fewer than 2 method values are available — kept here, not
# deleted, since v2 explicitly falls back to this exact formula. ─────────

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


def _confidence_meter(
    predictability_score: Optional[float], years_available: int,
    fair_value_range: dict, liquidity_ok: bool,
    business_quality_score: Optional[float] = None,
    financial_strength_score: Optional[float] = None,
) -> Optional[dict]:
    """How much to trust the Fair Value Range shown next to it — real inputs
    only, never a decoration next to the number. The "method agreement"
    component here is the scenario-range proxy — see
    `compute_confidence_meter_v2` above for the real cross-method-spread
    upgrade, used once Methods 3/4 (Relative/Historical) are available.

    business_quality/financial_strength were added so a fragile balance
    sheet or a low-quality business can't hide behind high predictability
    alone — a company can have very stable (predictable) but structurally
    weak economics, and the original formula had no way to reflect that.
    Both are optional (None-safe) so this stays backward compatible for the
    one caller path that doesn't have them computed yet."""
    if predictability_score is None:
        return None
    completeness = min(100, round(years_available / 10 * 100))
    base, low, high = fair_value_range.get("base"), fair_value_range.get("low"), fair_value_range.get("high")
    dispersion_pct = min(100, abs(high - low) / base * 100) if base and base > 0 else 50.0
    agreement = 100 - dispersion_pct
    liquidity_component = 100 if liquidity_ok else 40
    bq = business_quality_score if business_quality_score is not None else predictability_score
    fs = financial_strength_score if financial_strength_score is not None else predictability_score

    score = round(
        0.25 * predictability_score
        + 0.15 * bq
        + 0.10 * fs
        + 0.20 * completeness
        + 0.20 * agreement
        + 0.10 * liquidity_component
    )
    if score >= 85: label = "Alta confianza"
    elif score >= 65: label = "Confianza moderada"
    elif score >= 45: label = "Confianza baja"
    else: label = "Especulativo — rango amplio de incertidumbre"
    stars = max(1, min(5, round(score / 20)))
    return {"score": int(score), "label": label, "stars": stars}
