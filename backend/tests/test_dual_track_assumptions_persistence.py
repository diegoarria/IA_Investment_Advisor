"""
2026-11-12 audit follow-up: `compute_shadow_dual_track()` already computes
the earnings track, the FCF/DCF track, and the confidence-weighted blend
(weights + combined value) on every real GQV computation — but until now
none of that survived past the in-memory call that overwrites scenarios
["base"]["fair_value_per_share"]. `_dual_track_assumptions()` in
company_valuation_service.py is the minimal, purely-additive persistence
shape for these components. These tests exercise ONLY that pure function
with controlled, deterministic inputs — no Supabase, no live engine call,
no network.
"""
from app.services.valuation.dual_track_blend_engine import blend_tracks
from app.services.company_valuation_service import (
    _dual_track_assumptions, _DUAL_TRACK_VERSION, scenarios_from_fetched_data,
)


def test_absent_shadow_result_is_none_not_zero():
    # The dual-track computation never ran (e.g. REIT sector, no real
    # WACC) — the whole sub-object must be None, not a dict of zeros.
    assert _dual_track_assumptions(None) is None


def test_full_blend_persists_same_values_as_the_real_blend_engine():
    real_blend = blend_tracks(
        earnings_track_value=162.06, earnings_confidence=70.0,
        fcf_track_value=450.0, fcf_confidence=60.0,
    )
    shadow_result = {
        "earnings_track_value": 162.06,
        "fcf_track_value": 450.0,
        "blend": {
            "earnings_track_value": real_blend.earnings_track_value,
            "earnings_track_weight_pct": real_blend.earnings_track_weight_pct,
            "fcf_track_value": real_blend.fcf_track_value,
            "fcf_track_weight_pct": real_blend.fcf_track_weight_pct,
            "blended_fair_value": real_blend.blended_fair_value,
        },
        "blended_fair_value": real_blend.blended_fair_value,
    }
    out = _dual_track_assumptions(shadow_result)

    # 1. Persisted values come from the SAME execution (the real blend
    #    engine's own dataclass), never mixed with a different run.
    assert out["earnings_track_value"] == real_blend.earnings_track_value
    assert out["fcf_track_value"] == real_blend.fcf_track_value

    # 2. Weights saved correctly, and sum to ~100% (the blend engine's own
    #    floor/renormalization invariant — confirms we didn't corrupt them
    #    in transit).
    assert out["earnings_track_weight_pct"] == real_blend.earnings_track_weight_pct
    assert out["fcf_track_weight_pct"] == real_blend.fcf_track_weight_pct
    assert abs((out["earnings_track_weight_pct"] + out["fcf_track_weight_pct"]) - 100.0) < 0.1

    # 3. The combined result reproduces the engine's actual output within a
    #    documented rounding tolerance. The real engine rounds each track
    #    value to 2 decimals and each weight to 1 decimal (see
    #    DualTrackResult/blend_tracks) BEFORE persistence — recomposing the
    #    blend from those already-rounded components can differ from the
    #    engine's own unrounded-intermediate blend by a few cents on
    #    typical per-share values (confirmed empirically: up to ~$0.15 on a
    #    ~$300 share price here). Documented tolerance: $0.50 absolute,
    #    comfortably covering this compounding-rounding effect without
    #    masking a real reconciliation bug (which would show up as a much
    #    larger, systematic gap, not a few-cent rounding residue).
    reproduced = round(
        out["earnings_track_value"] * (out["earnings_track_weight_pct"] / 100.0)
        + out["fcf_track_value"] * (out["fcf_track_weight_pct"] / 100.0),
        2,
    )
    assert abs(reproduced - out["blended_fair_value"]) < 0.50

    assert out["version"] == _DUAL_TRACK_VERSION


def test_no_fcf_track_means_weights_are_absent_not_defaulted():
    # FCF track never produced a usable value (e.g. negative/zero FCF) —
    # blend_tracks() itself would return None in the real engine. Weights
    # must be None (genuinely absent), never silently defaulted to 50/50
    # or 0/100.
    shadow_result = {
        "earnings_track_value": 162.06,
        "fcf_track_value": None,
        "blend": None,
        "blended_fair_value": 162.06,  # engine's own fallback: earnings-track value stands alone
    }
    out = _dual_track_assumptions(shadow_result)
    assert out["earnings_track_value"] == 162.06
    assert out["fcf_track_value"] is None
    assert out["earnings_track_weight_pct"] is None
    assert out["fcf_track_weight_pct"] is None
    # No fabricated adjustment layer: blended_fair_value just mirrors the
    # single available track, exactly as the real engine does.
    assert out["blended_fair_value"] == 162.06


def test_component_absence_never_coerced_to_zero():
    # A genuinely-zero earnings track value (if it ever legitimately
    # occurred) must stay 0.0 and be distinguishable from an absent
    # component (None) — this test documents that these are different
    # states the persistence layer must not conflate.
    shadow_result = {"earnings_track_value": 0.0, "fcf_track_value": None, "blend": None, "blended_fair_value": 0.0}
    out = _dual_track_assumptions(shadow_result)
    assert out["earnings_track_value"] == 0.0  # a real zero, preserved as such
    assert out["fcf_track_value"] is None       # genuinely absent, never coerced to 0.0


def _synthetic_dcf(*, base_value: float, bear_value: float, bull_value: float, shadow_dual_track):
    """Minimal `dcf` shape that satisfies `_primary_scenarios`'s GQV branch
    (company_diagnostic_service.py) — only the fields that function and
    `_anomaly_review_reason` actually read."""
    return {
        "gqv_fair_value": {
            "status": "ok",
            "scenarios": {
                "bear": {"fair_value_per_share": bear_value},
                "base": {"fair_value_per_share": base_value},
                "bull": {"fair_value_per_share": bull_value},
                "current_price": 296.32,
                "margin_of_safety_pct": 12.3,
            },
            "shadow_dual_track": shadow_dual_track,
        },
    }


def test_full_pipeline_persists_dual_track_without_changing_intrinsic_value_or_status():
    # Confirms this is purely additive at the full assumptions-dict-
    # building level, not just at the isolated helper: the SAME base/bear/
    # bull/validation_status come out whether or not shadow_dual_track is
    # present, and the new "dual_track" key only ever adds information.
    #
    # 2026-11-12 follow-up (Diego caught this): the numbers below are a
    # HAND-AUTHORED, ILLUSTRATIVE fixture for exercising the plumbing
    # (_synthetic_dcf -> scenarios_from_fetched_data) — they do NOT come
    # from a real `blend_tracks()` call, and 339.48 does NOT reconcile
    # against 162.06/450.0 with weights 47.9/52.1 under the real formula
    # (0.479*162.06 + 0.521*450.0 = 312.08, not 339.48). An earlier report
    # mistakenly presented this illustrative fixture as if it were a real,
    # internally-consistent single execution — it never was. This test
    # only proves the dict passes through _primary_scenarios unmodified;
    # it is NOT a reconciliation check (see
    # test_single_execution_blend_reconciles_exactly below for that).
    shadow = {
        "earnings_track_value": 162.06, "fcf_track_value": 450.0,
        "blend": {
            "earnings_track_value": 162.06, "earnings_track_weight_pct": 47.9,
            "fcf_track_value": 450.0, "fcf_track_weight_pct": 52.1,
            "blended_fair_value": 339.48,
        },
        "blended_fair_value": 339.48,
    }
    dcf_with = _synthetic_dcf(base_value=339.48, bear_value=170.33, bull_value=444.14, shadow_dual_track=shadow)
    dcf_without = _synthetic_dcf(base_value=339.48, bear_value=170.33, bull_value=444.14, shadow_dual_track=None)

    result_with = scenarios_from_fetched_data("GOOGL", {"dcf": dcf_with})
    result_without = scenarios_from_fetched_data("GOOGL", {"dcf": dcf_without})

    # Same intrinsic value and validation_status either way — the new
    # field never influences the headline number or the valid/under_
    # review decision (confirmed structurally too: _anomaly_review_reason
    # only reads `scenarios`/`dcf`, never `assumptions`).
    assert result_with["intrinsic_value_usd"] == result_without["intrinsic_value_usd"] == 339.48
    assert result_with["validation_status"] == result_without["validation_status"] == "valid"
    assert result_with["assumptions"]["bear"] == result_without["assumptions"]["bear"] == 170.33
    assert result_with["assumptions"]["bull"] == result_without["assumptions"]["bull"] == 444.14

    assert result_with["assumptions"]["dual_track"]["blended_fair_value"] == 339.48
    assert result_with["assumptions"]["dual_track"]["earnings_track_weight_pct"] == 47.9
    assert result_without["assumptions"]["dual_track"] is None  # genuinely absent, old-row-compatible shape


def test_single_execution_blend_reconciles_exactly():
    """2026-11-12: Diego's math check (0.479*162.06 + 0.521*450.0 ~= 312.08,
    not 339.48) was correct — but those four numbers were never produced by
    the SAME execution (see the docstring on
    test_full_pipeline_persists_dual_track_without_changing_intrinsic_value_
    or_status above: that fixture is hand-authored/illustrative, not real
    engine output). This test is the genuine identity check: ONE real call
    to `blend_tracks()`, then an INDEPENDENT recomposition from the exact
    values `_dual_track_assumptions()` would persist, asserting the real
    formula (weighted average of the two track values by the engine's own
    confidence-derived, floor-renormalized weights -- confirmed by reading
    dual_track_blend_engine.py, no log-space/clamp/other transform) holds
    within the documented rounding tolerance.
    """
    # Raw inputs to a single real execution.
    earnings_value, earnings_confidence = 162.06, 70.0
    fcf_value, fcf_confidence = 450.0, 60.0

    real_blend = blend_tracks(
        earnings_track_value=earnings_value, earnings_confidence=earnings_confidence,
        fcf_track_value=fcf_value, fcf_confidence=fcf_confidence,
    )
    assert real_blend is not None

    # Effective weights ACTUALLY used by the formula -- confirm they are
    # NOT the naive confidence ratio (70/130=53.85%, 60/130=46.15%) by
    # coincidence alone; they're the engine's own post-floor/renormalize
    # weights, which for this particular pair of confidences happen not to
    # need flooring (both already exceed the 30% floor), so they equal the
    # raw ratio here -- but the point is we read them FROM the engine's own
    # output, never re-derive them independently.
    assert real_blend.earnings_track_weight_pct == 53.8
    assert real_blend.fcf_track_weight_pct == 46.2
    assert abs((real_blend.earnings_track_weight_pct + real_blend.fcf_track_weight_pct) - 100.0) < 0.1

    # What _dual_track_assumptions() would actually persist for this one
    # real execution.
    shadow_result = {
        "earnings_track_value": real_blend.earnings_track_value,
        "fcf_track_value": real_blend.fcf_track_value,
        "blend": {
            "earnings_track_value": real_blend.earnings_track_value,
            "earnings_track_weight_pct": real_blend.earnings_track_weight_pct,
            "fcf_track_value": real_blend.fcf_track_value,
            "fcf_track_weight_pct": real_blend.fcf_track_weight_pct,
            "blended_fair_value": real_blend.blended_fair_value,
        },
        "blended_fair_value": real_blend.blended_fair_value,
    }
    persisted = _dual_track_assumptions(shadow_result)

    # Independent recomposition from ONLY the persisted (already-rounded)
    # components -- this is the real mathematical identity check Diego
    # asked for: final result == f(raw track values, effective weights).
    reconciled = (
        persisted["earnings_track_value"] * (persisted["earnings_track_weight_pct"] / 100.0)
        + persisted["fcf_track_value"] * (persisted["fcf_track_weight_pct"] / 100.0)
    )
    # Tolerance justified by compounding rounding of two already-rounded
    # components (2-decimal track values, 1-decimal weights) -- confirmed
    # empirically at ~$0.13 for this pair, well under the documented $0.50
    # ceiling, and nowhere near the ~$27 gap a genuine reconciliation
    # failure would produce.
    assert abs(reconciled - persisted["blended_fair_value"]) < 0.50
    assert persisted["blended_fair_value"] == real_blend.blended_fair_value == 294.96
