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
