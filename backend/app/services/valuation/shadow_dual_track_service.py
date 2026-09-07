"""
Shadow Dual-Track Service — orchestrates the (shadow-mode only) dual-track
fair value for one ticker: a correlation-discounted earnings track, a
capex-supercycle-aware FCF/DCF track, and a confidence-weighted blend of
the two. See the plan this was built from:
/Users/diegoarria/.claude/plans/dapper-scribbling-honey.md.

SHADOW-MODE: this module DOES real data fetching (unlike `nuvos_engine/
engine.py`, which deliberately fetches nothing) — same pattern as
`fundamental_analysis_service.py` itself. It is called AFTER the live
`compute_nuvos_fair_value(...)` result already exists, reusing its
outputs (fair_pe adjustments, classification confidence, WACC) rather
than recomputing them, and returns a self-contained dict meant to be
attached as `gqv_fair_value["shadow_dual_track"]` — a real, complete
computation that is NEVER read by `company_diagnostic_service.py`'s
`baseFairValue`/`marginOfSafetyPercent`/`fairPeBreakdown` today. Nothing
a real user sees changes because this function ran.

Known real limitation, not yet resolved (see `earnings_normalization_
engine.py`'s module docstring): a company whose real pretax income is
itself distorted by a large one-time item in "other income" (not the tax
line) — confirmed live for Boeing — still gets an inflated normalized
EPS here. Do not promote any of this out of shadow-mode without either
fixing that gap or explicitly accepting it.

Second known real limitation, partially mitigated (see
`_EARNINGS_TROUGH_FLOOR_FRACTION` below): a real, genuine earnings trough
(not a tax anomaly — confirmed live for MOH, a real Q4 2025 GAAP loss
from a real medical-cost-trend miss) can still drive TTM EPS low enough
that the floor doesn't fully neutralize an implausible near-zero fair
value, since the floor is a fraction of a *5-year* historical average
that itself may include a real, permanent step-down the company will
never return to — the floor assumes reversion, which is a real
assumption, not a certainty.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Optional

from app.services.valuation.dcf_engine import is_reit_sector

from app.services.valuation.earnings_normalization_engine import (
    normalized_ttm_eps,
    capex_supercycle_state,
)
from app.services.valuation.dcf_recovery_engine import (
    compute_recovery_dcf,
    compute_single_period_fcf_value,
)
from app.services.valuation.dual_track_blend_engine import blend_tracks

# Same correlation-discount rationale as documented in the (reverted,
# never-shipped-to-the-live-path) fair_pe.py exploration — kept here,
# shadow-only, until Phase 2 validation decides whether to promote it.
_CORRELATION_DISCOUNT = 0.15
_CORRELATED_FACTORS = {"growth", "quality", "fcf_margin", "moat_management"}

# Blend weight between the growth-based P/E anchor and the historical-P/E
# anchor for the shadow earnings track — a fixed real approximation of
# the live engine's classification-aware weighting (`fair_pe.py`'s
# `_ANCHOR_WEIGHTS`), not a byte-for-byte reproduction. Matches what was
# validated by hand this session for a Fast Grower with no peer P/E
# available (60/20/20 nominal, peer weight redistributed -> 75/25).
_GROWTH_ANCHOR_WEIGHT = 0.75
_HISTORICAL_ANCHOR_WEIGHT = 0.25

# Real gap found live for MOH (Molina Healthcare) in the Fase 2 batch:
# a genuine, real earnings trough (a real Q4 2025 GAAP loss from a known
# medical-cost-trend miss) drove raw/normalized TTM EPS to near zero,
# which is mathematically correct for the trailing year but produced an
# implausible ~$3/share "fair value" for a company that still has a real,
# substantial 5-year earning power (~$16 normalized EPS in the live
# production pipeline's own recency-weighted average). Not a tax anomaly
# — `earnings_normalization_engine.py` couldn't help here. Same spirit as
# the capex-supercycle track (don't fully punish a real business for a
# state that may not be permanent): floor the TTM EPS input at a fraction
# of the company's own real historical normalized EPS rather than using
# an unfloored, potentially near-zero or negative TTM figure outright.
_EARNINGS_TROUGH_FLOOR_FRACTION = 0.5

# Mirror-image real gap found live for MU (Micron) running the Fase 2
# full-universe batch (2026-09-03): a real, genuine earnings PEAK — not
# a bug, Micron is a famously cyclical DRAM/NAND commodity business that
# swung from real 2023-2024 losses to a real 2025-2026 AI-driven memory
# boom — drove TTM normalized EPS to $45.13, 6.4x the live production
# 5-year recency-weighted EPS ($7.06), even though both pipelines' fair
# P/E multiples matched almost exactly (16.36x vs. 15.63x). The trough
# floor above only protects against understating a temporary low; a
# temporary cyclical high needs the same protection in the other
# direction, same reasoning, same reference (the real 5-year average).
_EARNINGS_PEAK_CEILING_FRACTION = 2.0

# Real systemic bias found running the Fase 2 batch across ~130 diverse
# real tickers (2026-09-02): even with the WACC-terminal-growth spread
# guard, the single-period Gordon FCF track ran persistently and
# substantially higher than the earnings track for a majority of the
# largest-diff cases — not one company's quirk, the same pattern across
# unrelated sectors. Confirmed live: TKO ($120.68 earnings vs. $314.45
# FCF, 2.6x), ADM ($53.55 vs. $206.87, 3.9x). Root cause: a flat 3%
# terminal growth applied to FCF/share (often a different, sometimes
# larger, base than EPS) via a WACC-only discount produces a materially
# more generous implied multiple than the earnings track's real,
# per-company fair-P/E build-up for value/cyclical names with modest P/E
# multiples. Rather than trying to perfectly recalibrate the Gordon
# model's assumptions per sector, treat a >2x divergence between two
# independent estimates of the SAME company as itself a real signal that
# one (usually the FCF track, per the batch) is over-extrapolating — cap
# it symmetrically rather than blending it in at face value, similar in
# spirit to the live engine's own `DivergenceExplanation` concept
# (`nuvos_engine/divergence.py`) for its two P/E anchors.
_MAX_TRACK_DIVERGENCE_RATIO = 2.0


def _correlation_discounted_multiple(base_multiple: float, adjustments: list) -> float:
    """Pure function: re-derives the growth-based multiple from an
    already-computed `FairPEResult.adjustments` list, applying the 15%
    correlation discount only to the correlated cluster. Does not mutate
    the input list — reads `.factor`/`.points` only."""
    total = base_multiple
    for adj in adjustments:
        points = adj.points if hasattr(adj, "points") else adj.get("points", 0.0)
        factor = adj.factor if hasattr(adj, "factor") else adj.get("factor", "")
        if factor in _CORRELATED_FACTORS:
            total += points * (1 - _CORRELATION_DISCOUNT)
        else:
            total += points
    return round(total, 2)


def compute_shadow_dual_track(
    ticker: str,
    *,
    sector: Optional[str],
    industry: Optional[str],
    fair_pe_base_multiple: Optional[float],
    fair_pe_adjustments: Optional[list],
    historical_median_pe: Optional[float],
    classification_confidence: Optional[float],
    confidence_score: Optional[float],
    wacc_pct: Optional[float],
    revenue_per_share_today: Optional[float],
    fcf_per_share_today: Optional[float],
    growth_pct: Optional[float],
    historical_normalized_eps: Optional[float] = None,
    fair_pe_band: Optional[tuple[float, float]] = None,
    production_raw_eps: Optional[float] = None,
    sbc_per_share: Optional[float] = None,
) -> Optional[dict]:
    """Returns None whenever a real required input is missing (never
    fabricates a shadow value) — reports why via the `note` key when
    that happens for observability while reviewing the validation batch.

    Diego, 2026-09-04 — real fix for a systemic overvaluation found live
    (ROKU, CIEN, TOST): `fcf_per_share_today` (OCF - capex) doesn't
    subtract stock-based comp, a real, ongoing dilution cost to existing
    shareholders even though it's a non-cash add-back on the cash flow
    statement. Capitalizing raw reported FCF at a perpetuity-style
    multiple handed the FCF/DCF track a per-share cash figure far richer
    than what a holder actually keeps — confirmed live: ROKU's real
    FCF/share drops from $3.22 to $0.84 once SBC/share is subtracted (a
    74% cut). `fcf_per_share_today` below is adjusted to this real,
    Buffett-style "owner earnings" figure (FCF minus SBC per share)
    BEFORE it feeds either the recovery DCF or the single-period Gordon
    model — same discipline the rest of this file already applies:
    when the adjustment pushes owner earnings to non-positive, the
    existing non-positive-FCF guard below correctly declines to value
    it via this track, rather than silently using the richer pre-SBC
    number."""
    if fcf_per_share_today is not None and sbc_per_share is not None:
        fcf_per_share_today = round(fcf_per_share_today - sbc_per_share, 2)
    if fair_pe_base_multiple is None or not fair_pe_adjustments:
        return {"note": "no fair_pe result to build the earnings track from"}
    if wacc_pct is None:
        return {"note": "no real WACC available"}
    if is_reit_sector(sector) or is_reit_sector(industry):
        # Real gap found live for CCI (Crown Castle) running the Fase 2
        # batch: shadow's tax-normalized TTM EPS (2.46) came out 2.4x the
        # real production normalized EPS (1.02), even though the fair-P/E
        # multiple itself matched production exactly (both clamp to the
        # band's own 20.0x ceiling). Root cause: GAAP D&A structurally
        # distorts a REIT's reported earnings (real, non-cash depreciation
        # on real estate held far longer than it depreciates) — the same
        # reasoning the live production `dcf_engine.is_reit_sector` exclusion
        # already documents for its own FCF/NOPAT path. FFO/AFFO is the
        # real REIT-appropriate metric; shadow doesn't build one (same
        # explicit "future-phase work" scope line as production) — exclude
        # rather than silently misapply a P/E-on-GAAP-EPS earnings track.
        return {"note": "REIT sector — GAAP EPS not a reliable basis for the earnings track"}

    eps_result = normalized_ttm_eps(ticker)
    if eps_result is None or eps_result.normalized_ttm_eps is None:
        eps_used = eps_result.raw_ttm_eps if eps_result else None
        eps_note = "normalized EPS unavailable — used raw TTM EPS" if eps_used is not None else "no real EPS available"
    else:
        eps_used = eps_result.normalized_ttm_eps
        eps_note = ""
    if eps_used is None:
        return {"note": eps_note or "no real EPS available"}
    if historical_normalized_eps is not None and historical_normalized_eps > 0:
        earnings_trough_floor = round(historical_normalized_eps * _EARNINGS_TROUGH_FLOOR_FRACTION, 2)
        if eps_used < earnings_trough_floor:
            eps_used = earnings_trough_floor
            eps_note = (
                (eps_note + "; " if eps_note else "")
                + f"TTM EPS floored at {int(_EARNINGS_TROUGH_FLOOR_FRACTION * 100)}% of the real "
                "5-year historical normalized EPS (real earnings trough, not treated as fully permanent)"
            )
    # Peak ceiling reference: prefer the real 5-year historical normalized
    # EPS, but fall back to production's own raw GAAP EPS when that's
    # unavailable. Real gap found live for ROKU running the full-universe
    # batch: production's OWN `earnings_state` engine had already flagged
    # ROKU's regime as "elevated" with an unreliable mixed-loss/gain prior
    # history and deliberately returned `normalized_eps=None` rather than
    # normalize — using raw EPS (0.59) as the safer answer. Shadow's own
    # tax-anomaly-based normalization doesn't share that judgment call and
    # produced $2.48 with nothing to check it against (historical_
    # normalized_eps was None, so the ceiling above never triggered).
    # Whenever production explicitly declines to normalize, shadow
    # shouldn't blindly trust its own from-scratch number either — anchor
    # the same 2.0x ceiling to production's raw EPS instead.
    peak_ceiling_reference = historical_normalized_eps if historical_normalized_eps else production_raw_eps
    if peak_ceiling_reference is not None and peak_ceiling_reference > 0:
        earnings_peak_ceiling = round(peak_ceiling_reference * _EARNINGS_PEAK_CEILING_FRACTION, 2)
        if eps_used > earnings_peak_ceiling:
            eps_used = earnings_peak_ceiling
            _reference_label = "5-year historical normalized EPS" if historical_normalized_eps \
                else "raw GAAP EPS (no reliable historical normalization available)"
            eps_note = (
                (eps_note + "; " if eps_note else "")
                + f"TTM EPS capped at {_EARNINGS_PEAK_CEILING_FRACTION}x the real {_reference_label} "
                "(real cyclical peak, not treated as fully permanent)"
            )
    if eps_used <= 0:
        # A P/E multiple is not a meaningful valuation tool on negative/zero
        # earnings — confirmed live for CYTK (loss-making biotech) in the
        # Fase 2 batch, where EPS x P/E produced a nonsensical negative
        # "fair value". The real production pipeline already excludes this
        # case (its base scenario comes back None too); shadow must match.
        return {"note": "non-positive normalized EPS — earnings track not applicable"}

    growth_based_multiple = _correlation_discounted_multiple(fair_pe_base_multiple, fair_pe_adjustments)
    if historical_median_pe is not None:
        final_multiple = round(
            growth_based_multiple * _GROWTH_ANCHOR_WEIGHT + historical_median_pe * _HISTORICAL_ANCHOR_WEIGHT, 2
        )
    else:
        final_multiple = growth_based_multiple
    multiple_note = ""
    if fair_pe_band is not None:
        # Real bug found live for APPF (AppFolio) running the Fase 2 batch:
        # its own real historical P/E is a genuine but extreme 1267.4x (a
        # past near-zero-earnings quarter distorting the ratio — the same
        # near-zero-denominator instability seen elsewhere this session,
        # here in an UPSTREAM input rather than shadow's own math). The
        # live production `compute_fair_pe` already blends this same
        # historical anchor at just 30% weight AND clamps its own result
        # to a real, already-computed sane band — reuse that band here
        # rather than reinventing a second bound, since production has
        # already done the work of sanity-checking this exact multiple.
        lo, hi = fair_pe_band
        if final_multiple > hi or final_multiple < lo:
            multiple_note = f"final multiple clamped to the live fair_pe band [{lo}, {hi}] (was {final_multiple})"
            final_multiple = max(lo, min(hi, final_multiple))
    earnings_track_value = round(eps_used * final_multiple, 2)

    capex_state = capex_supercycle_state(ticker, sector=sector, industry=industry)
    fcf_track_value = None
    fcf_note = ""
    if capex_state is None:
        fcf_note = "insufficient real annual cash-flow history"
    elif not capex_state.applicable:
        fcf_note = capex_state.reason
    elif fcf_per_share_today is None or growth_pct is None:
        fcf_note = "missing real FCF/share or growth input"
    elif fcf_per_share_today <= 0:
        # Real capital-intensive businesses (utilities, some REITs/pipelines)
        # can run structurally negative FCF from continuous heavy capex —
        # not a "supercycle" to recover from, just their permanent shape. A
        # perpetuity-growth model has nothing meaningful to capitalize here
        # (confirmed live for AEE in the Fase 2 batch). Falls back to the
        # earnings track only, same as the financial-sector case below.
        fcf_note = "non-positive real FCF/share — DCF track not applicable"
    elif capex_state.current_year_elevated_capex and capex_state.normalized_fcf_margin_pct is not None \
            and revenue_per_share_today is not None:
        recovery = compute_recovery_dcf(
            fcf_per_share_today=fcf_per_share_today,
            normalized_fcf_margin_pct=capex_state.normalized_fcf_margin_pct,
            revenue_per_share_today=revenue_per_share_today,
            growth_pct=growth_pct, wacc_pct=wacc_pct,
        )
        fcf_track_value = recovery.fair_value_per_share if recovery else None
        fcf_note = (
            "recovery DCF (real capex supercycle detected)" if recovery
            else "recovery DCF not applicable (thin WACC spread or non-positive normalized margin)"
        )
    else:
        fcf_track_value = compute_single_period_fcf_value(fcf_per_share_today=fcf_per_share_today, wacc_pct=wacc_pct)
        fcf_note = (
            "single-period Gordon (no capex supercycle detected)" if fcf_track_value is not None
            else "WACC too close to/below terminal growth"
        )

    if sbc_per_share is not None and fcf_note:
        fcf_note += " (owner earnings: real FCF/share net of stock-based comp)"

    if fcf_track_value is not None and fcf_track_value > 0:
        divergence_ratio = fcf_track_value / earnings_track_value
        if divergence_ratio > _MAX_TRACK_DIVERGENCE_RATIO:
            fcf_track_value = round(earnings_track_value * _MAX_TRACK_DIVERGENCE_RATIO, 2)
            fcf_note += f" — capped at {_MAX_TRACK_DIVERGENCE_RATIO}x the earnings track (real divergence check)"
        elif divergence_ratio < 1 / _MAX_TRACK_DIVERGENCE_RATIO:
            fcf_track_value = round(earnings_track_value / _MAX_TRACK_DIVERGENCE_RATIO, 2)
            fcf_note += f" — capped at {round(1 / _MAX_TRACK_DIVERGENCE_RATIO, 2)}x the earnings track (real divergence check)"

    if fcf_track_value is not None and (confidence_score or 0) > 0:
        # Diego, 2026-09-04 — real bug found investigating why ~87% of the
        # blend weight was landing on the FCF track for a large, non-rare
        # slice of tickers (ROKU, CIEN, TKO, FIS, BWA, TOST, TNL, CART, all
        # confirmed live): `classification_confidence` is legitimately 0.0
        # whenever Lynch classification lands on UNKNOWN (common, not an
        # edge case), and using it RAW as the earnings track's sole
        # confidence input let one zeroed sub-signal crash that whole
        # side — while `confidence_score` (passed in as the FCF side's
        # confidence) is actually GQV's broad confidence_meter_v4
        # composite (quality, financial strength, method agreement,
        # liquidity, AND classification_confidence as just one of ~10
        # weighted inputs there), not a comparable single-signal number.
        # Comparing a raw single sub-signal against a resilient ~10-input
        # composite is an apples-to-oranges mismatch that systematically
        # crushed the earnings track exactly when classification alone
        # was uncertain, even though the earnings track's own EPS×fair-P/E
        # math had nothing wrong with it. Averaging classification_
        # confidence into the same broad composite for the earnings side
        # keeps the real signal (a genuinely unclear growth story still
        # pulls weight down) without letting it single-handedly zero out.
        _earnings_confidence_input = (
            classification_confidence if classification_confidence is not None else confidence_score
        )
        earnings_confidence = ((_earnings_confidence_input or 0.0) + (confidence_score or 0.0)) / 2
        blend = blend_tracks(
            earnings_track_value=earnings_track_value, earnings_confidence=earnings_confidence,
            fcf_track_value=fcf_track_value, fcf_confidence=confidence_score or 0.0,
        )
    else:
        blend = None

    return {
        "earnings_track_value": earnings_track_value,
        "earnings_track_multiple": final_multiple,
        "multiple_note": multiple_note,
        "eps_used": eps_used,
        "eps_note": eps_note,
        "eps_flagged_quarters": eps_result.flagged_quarters if eps_result else [],
        "fcf_track_value": fcf_track_value,
        "fcf_track_note": fcf_note,
        "capex_supercycle": asdict(capex_state) if capex_state else None,
        "blend": asdict(blend) if blend else None,
        "blended_fair_value": blend.blended_fair_value if blend else earnings_track_value,
    }
