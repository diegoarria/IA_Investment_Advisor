"""
Consensus Fair Value (Method 5 of the Valuation Engine)
=========================================================
Blends the independent valuation methods with weights that adapt to what
kind of business is being priced — never a flat average, and never fixed
percentages regardless of archetype.

Method 1 (Conservative DCF) and Method 2 (Professional DCF) reuse the
existing 2-stage DCF's own pessimistic/base scenarios rather than a second,
fully-separate DCF implementation: the pessimistic scenario (lower growth
multiplier, +150bps discount rate) already IS the more conservative view;
the base scenario already IS the standard, "professional" estimate. This
is a deliberate choice to avoid maintaining two structurally-duplicate DCF
engines for a difference that's already expressed by the existing
scenario framework — disclosed here, not hidden.
"""

from __future__ import annotations

from typing import Optional

_ARCHETYPE_WEIGHTS: dict[str, dict[str, float]] = {
    "financials":         {"conservative_dcf": 0.10, "professional_dcf": 0.15, "relative": 0.35, "historical": 0.40},
    "secular_compounder": {"conservative_dcf": 0.35, "professional_dcf": 0.45, "relative": 0.10, "historical": 0.10},
    "cyclical":           {"conservative_dcf": 0.10, "professional_dcf": 0.20, "relative": 0.40, "historical": 0.30},
    "balanced":           {"conservative_dcf": 0.30, "professional_dcf": 0.30, "relative": 0.20, "historical": 0.20},
}


def classify_archetype(
    is_financial_sector: bool, business_quality_score: Optional[float],
    predictability_score: Optional[float], cyclicality_dampener: float,
) -> str:
    """Real signals already computed elsewhere — no new classifier model,
    just a routing table on top of existing fields (business_quality/
    predictability from the Investment Thesis Scorecard, the sector
    cyclicality dampener already used by the composite ranking score)."""
    if is_financial_sector:
        return "financials"
    if business_quality_score is not None and business_quality_score >= 80 and predictability_score is not None and predictability_score >= 75:
        return "secular_compounder"
    if cyclicality_dampener <= 0.93:
        return "cyclical"
    return "balanced"


def compute_consensus_fair_value(
    archetype: str,
    conservative_dcf_value: Optional[float],
    professional_dcf_value: Optional[float],
    relative: Optional[dict],
    historical: Optional[dict],
) -> Optional[dict]:
    """Confidence-weighted blend — never a simple average. Each method's
    archetype base weight is scaled by a real reliability multiplier
    (0 when the method wasn't computable at all, so a missing Method 3/4
    doesn't silently count as "worth zero and included" vs. "not counted");
    remaining weights renormalize automatically since the final division
    is by the sum of weights actually used, not a fixed denominator."""
    base_weights = _ARCHETYPE_WEIGHTS.get(archetype, _ARCHETYPE_WEIGHTS["balanced"])

    candidates = {
        "conservative_dcf": (conservative_dcf_value, 1.0 if conservative_dcf_value else 0.0),
        "professional_dcf": (professional_dcf_value, 1.0 if professional_dcf_value else 0.0),
        "relative": (
            relative.get("intrinsic_value_per_share") if relative else None,
            min(1.3, 0.7 + 0.1 * relative.get("peer_count", 0)) if relative else 0.0,
        ),
        "historical": (
            historical.get("intrinsic_value_per_share") if historical else None,
            min(1.3, 0.6 + 0.08 * historical.get("years_used", 0)) if historical else 0.0,
        ),
    }

    weighted_sum, weight_total = 0.0, 0.0
    methods_used = {}
    for key, (value, reliability) in candidates.items():
        if value is None or reliability <= 0:
            continue
        w = base_weights[key] * reliability
        weighted_sum += w * value
        weight_total += w
        methods_used[key] = {"value": round(value, 2), "weight": round(w, 3)}

    if weight_total <= 0:
        return None

    consensus_value = round(weighted_sum / weight_total, 2)
    return {
        "archetype": archetype,
        "archetype_base_weights": base_weights,
        "methods_used": methods_used,
        "consensus_fair_value": consensus_value,
    }
