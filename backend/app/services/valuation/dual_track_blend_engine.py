"""
Dual-Track Blend Engine — the last step of the (shadow-mode) dual-track
fair value: combining the earnings track (EPS × fair P/E, correlation-
discounted) with the FCF/DCF track (`dcf_recovery_engine.py`) into one
number, weighted by how confident this app already is in each track's
own real inputs — never a fixed, arbitrary 50/50 (a real revisor caught
this: the two tracks carry very different real uncertainty and shouldn't
be treated as equally reliable by default).

Deliberately does NOT invent a new confidence metric — it reuses real
scores this app already computes elsewhere for each ticker: the
classification confidence (`nuvos_engine/classification.py`, how sure the
Lynch-category assignment is — a real proxy for how trustworthy the
earnings-based multiple's growth/anchor assumptions are) for the earnings
track, and the Confidence Score (`confidence_engine.py`, built
substantially from real FCF volatility) for the FCF/DCF track, since FCF
volatility is exactly the track's own real weak point.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

# Real bug found running the Fase 2 shadow-mode validation batch
# (2026-09-01): classification_confidence can legitimately be exactly 0.0
# when the Lynch classifier has insufficient data to categorize a company
# (confirmed live for TMUS — UNKNOWN category, real "datos insuficientes"
# reason) — that's a real signal about growth-story clarity, not a
# statement that the earnings track's own EPS x P/E math is worthless.
# Without a floor, hitting 0 here zeroed the earnings track out of the
# blend entirely and handed 100% weight to the single, more assumption-
# heavy FCF/DCF track. A floor keeps every track a real, non-zero voice
# in the blend even when one confidence input bottoms out.
#
# Diego, 2026-09-04 — raised from 15.0 after full-replacement shipped and
# a real batch review (ROKU, CIEN, TKO, FIS, BWA, TOST, TNL, CART, all
# confirmed live) showed a 15% floor still let the FCF track's single-
# period Gordon perpetuity (a structurally more aggressive method than
# the earnings-track P/E) dominate at an ~87/13 split whenever
# classification confidence bottomed out — see shadow_dual_track_
# service.py's own note on the paired fix (blending classification_
# confidence into a broader composite for the earnings side). This floor
# is the second line of defense: even after that fix, no single track
# should ever be reduced to a near-silent voice in the blend.
_MIN_TRACK_WEIGHT_FLOOR_PCT = 30.0


@dataclass
class DualTrackResult:
    earnings_track_value: float
    earnings_track_weight_pct: float
    fcf_track_value: float
    fcf_track_weight_pct: float
    blended_fair_value: float


def blend_tracks(
    *,
    earnings_track_value: float,
    earnings_confidence: float,
    fcf_track_value: float,
    fcf_confidence: float,
) -> Optional[DualTrackResult]:
    """Both confidence inputs are expected on a real 0-100 scale (same
    scale as `classification.confidence` and `ConfidenceScoreResult.
    score`). Returns None if both are zero/missing (nothing real to
    weight by) rather than silently falling back to 50/50."""
    total_confidence = (earnings_confidence or 0.0) + (fcf_confidence or 0.0)
    if total_confidence <= 0:
        return None

    earnings_weight = earnings_confidence / total_confidence
    fcf_weight = fcf_confidence / total_confidence
    # Floor each weight so a track never gets fully zeroed out by the
    # other track's confidence input bottoming out (see
    # `_MIN_TRACK_WEIGHT_FLOOR_PCT`'s module-level comment) — then
    # renormalize so the two weights still sum to 100%.
    floor = _MIN_TRACK_WEIGHT_FLOOR_PCT / 100.0
    if earnings_weight < floor or fcf_weight < floor:
        earnings_weight = max(earnings_weight, floor)
        fcf_weight = max(fcf_weight, floor)
        total_weight = earnings_weight + fcf_weight
        earnings_weight /= total_weight
        fcf_weight /= total_weight
    blended = earnings_track_value * earnings_weight + fcf_track_value * fcf_weight

    return DualTrackResult(
        earnings_track_value=round(earnings_track_value, 2),
        earnings_track_weight_pct=round(earnings_weight * 100, 1),
        fcf_track_value=round(fcf_track_value, 2),
        fcf_track_weight_pct=round(fcf_weight * 100, 1),
        blended_fair_value=round(blended, 2),
    )
