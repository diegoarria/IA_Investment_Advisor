"""
2026-11-17 — fix for a real bug found while auditing Cohorte 2 (MSFT/AMZN/
V/META/MELI): `margin_of_safety_pct` was computed once in
scenarios.py::build_scenarios() from the PRE-blend `base` fair value, but
the dual-track blend (which runs later, in get_fundamental_analysis, at
both the rich and the recovery-DCF-fallback call sites) only ever
overwrote `base`/`bear`/`bull` `fair_value_per_share` — never refreshing
`margin_of_safety_pct` to match. That stale field is exactly what
company_diagnostic_service._primary_scenarios/_pillar_scores read for the
`value` pillar and the overall score, so any ticker whose blend actually
mixed two real tracks (earnings + FCF) carried a silently wrong
score/margin while its shown intrinsic value was already correct.

Confirmed live before the fix (read-only investigation, no persistence):
  GOOGL  base $269.60  stale mos -56.2%  coherent mos  -9.7%   value pillar 0 -> 40
  NVDA   base $157.64  stale mos -27.1%  coherent mos  -3.3%   value pillar 23 -> 47
  MELI   base $1,910.82 stale mos -50.8% coherent mos +24.8%   value pillar 0 -> 77
  AMZN   base $215.46  stale mos -135.5% coherent mos -19.7%

These tests exercise ONLY the pure, now-shared
`_apply_dual_track_blend_to_scenarios()` helper with controlled, frozen
inputs reconstructed from those real numbers — no Supabase, no live
engine call, no network, no provider fetch of any kind.
"""
import math

from app.services.fundamental_analysis_service import _apply_dual_track_blend_to_scenarios
from app.services.valuation.numeric_helpers import calc_margin_of_safety


def _scenarios(base_fv, bear_fv, bull_fv, price, stale_mos):
    """Mirrors `asdict(ScenarioSet)` — the real post-build_scenarios shape
    `_apply_dual_track_blend_to_scenarios` actually receives."""
    return {
        "bear": {"eps": None, "fair_pe": 10.0, "fair_value_per_share": bear_fv},
        "base": {"eps": None, "fair_pe": 15.0, "fair_value_per_share": base_fv},
        "bull": {"eps": None, "fair_pe": 20.0, "fair_value_per_share": bull_fv},
        "current_price": price,
        "margin_of_safety_pct": stale_mos,
    }


# ---------------------------------------------------------------------------
# 1. Margin corresponds to the FINAL post-blend value, for real tickers with
#    a genuine 2-track blend.
# ---------------------------------------------------------------------------

def test_googl_margin_matches_post_blend_value_not_stale_pre_blend():
    price = 298.0  # approximate real reference price used during the audit
    blended = 269.60
    s = _scenarios(base_fv=160.0, bear_fv=120.0, bull_fv=210.0, price=price, stale_mos=-56.2)
    _apply_dual_track_blend_to_scenarios(s, blended)

    assert s["base"]["fair_value_per_share"] == blended
    expected_mos = calc_margin_of_safety(blended, price)
    assert s["margin_of_safety_pct"] == expected_mos
    assert s["margin_of_safety_pct"] != -56.2  # stale value must be gone


def test_nvda_score_pillar_uses_corrected_margin():
    from app.services.company_diagnostic_service import _pillar_scores

    price = 152.4
    blended = 157.64
    s = _scenarios(base_fv=100.0, bear_fv=70.0, bull_fv=140.0, price=price, stale_mos=-27.1)
    _apply_dual_track_blend_to_scenarios(s, blended)

    data = {"business_quality_score": 80, "financial_strength_score": 75}
    pillars = _pillar_scores(data, s, fallback_simplicity=60)
    assert pillars is not None
    expected_mos = calc_margin_of_safety(blended, price)
    expected_value_pillar = round(min(100, max(0, 50 + expected_mos)))
    assert pillars["value"] == expected_value_pillar
    # Sanity: with a real positive margin this must land well above the
    # clamped-to-0 result the stale -27.1% field used to force.
    assert pillars["value"] > 0


def test_meli_margin_flips_from_negative_stale_to_real_positive():
    price = 1436.83
    blended = 1910.82
    s = _scenarios(base_fv=1200.0, bear_fv=900.0, bull_fv=1600.0, price=price, stale_mos=-50.8)
    _apply_dual_track_blend_to_scenarios(s, blended)

    assert s["margin_of_safety_pct"] > 0  # real coherent margin is positive (~+24.8%)
    assert math.isclose(s["margin_of_safety_pct"], calc_margin_of_safety(blended, price))


def test_amzn_margin_matches_post_blend_value():
    price = 257.89
    blended = 215.46
    s = _scenarios(base_fv=300.0, bear_fv=240.0, bull_fv=380.0, price=price, stale_mos=-135.5)
    _apply_dual_track_blend_to_scenarios(s, blended)

    assert s["margin_of_safety_pct"] == calc_margin_of_safety(blended, price)
    assert s["margin_of_safety_pct"] != -135.5


# ---------------------------------------------------------------------------
# 2. Intrinsic VALUES (base/bear/bull) are unchanged by this fix — the fix
#    only ever touches the already-correct blend-overwrite logic for values,
#    and the margin derived from it; nothing about how base/bear/bull
#    themselves get computed changes.
# ---------------------------------------------------------------------------

def test_bear_and_bull_scale_by_the_same_ratio_as_before_the_fix():
    price = 100.0
    old_base, bear_fv, bull_fv = 100.0, 80.0, 130.0
    blended = 120.0  # 1.2x old base
    s = _scenarios(base_fv=old_base, bear_fv=bear_fv, bull_fv=bull_fv, price=price, stale_mos=0.0)
    _apply_dual_track_blend_to_scenarios(s, blended)

    ratio = blended / old_base
    assert s["base"]["fair_value_per_share"] == round(blended, 2)
    assert s["bear"]["fair_value_per_share"] == round(bear_fv * ratio, 2)
    assert s["bull"]["fair_value_per_share"] == round(bull_fv * ratio, 2)


# ---------------------------------------------------------------------------
# 3. JPM's sector-specific (bank) model never runs this function at all —
#    confirmed structurally, not just by convention: financial_engine.py's
#    Residual Income path builds its own margin_of_safety_pct independently
#    and is never passed through _apply_dual_track_blend_to_scenarios.
# ---------------------------------------------------------------------------

def test_jpm_sector_model_module_does_not_import_the_blend_helper():
    import app.services.valuation.financial_engine as financial_engine
    assert not hasattr(financial_engine, "_apply_dual_track_blend_to_scenarios")


# ---------------------------------------------------------------------------
# 4. Tickers without a real second track (blend ratio == 1, e.g. COST/MCD
#    when the FCF track is null and the blended value equals the old base)
#    keep their current, already-correct behavior — no regression.
# ---------------------------------------------------------------------------

def test_no_real_second_track_leaves_values_effectively_unchanged():
    price = 1113.74
    old_base = 544.53
    s = _scenarios(base_fv=old_base, bear_fv=400.0, bull_fv=700.0, price=price, stale_mos=-104.5)
    # blended == old_base: the blend engine returned the earnings track only
    # (no usable FCF track), same as COST/MCD today.
    _apply_dual_track_blend_to_scenarios(s, old_base)

    assert s["base"]["fair_value_per_share"] == old_base
    # The margin still gets refreshed (it's recomputed from base+price
    # regardless of whether the blend "moved" anything) — this is correct:
    # the stale field was wrong here too, just coincidentally closer to the
    # truth when the blend is a no-op. Confirm it now matches the formula.
    assert s["margin_of_safety_pct"] == calc_margin_of_safety(old_base, price)


def test_blend_not_run_is_a_genuine_noop():
    # V/META today: blended fair value is absent entirely (dual_track={}),
    # so `blended` is None — the function must leave scenarios completely
    # untouched, not fabricate anything.
    s = _scenarios(base_fv=339.03, bear_fv=281.55, bull_fv=400.0, price=338.21, stale_mos=-62.9)
    original = {
        "base": dict(s["base"]), "bear": dict(s["bear"]), "bull": dict(s["bull"]),
        "margin_of_safety_pct": s["margin_of_safety_pct"],
    }
    _apply_dual_track_blend_to_scenarios(s, None)
    assert s["base"] == original["base"]
    assert s["bear"] == original["bear"]
    assert s["bull"] == original["bull"]
    assert s["margin_of_safety_pct"] == original["margin_of_safety_pct"]


# ---------------------------------------------------------------------------
# 5. Missing-data cases never fabricate a margin.
# ---------------------------------------------------------------------------

def test_missing_old_base_is_a_noop_no_fabricated_margin():
    s = _scenarios(base_fv=None, bear_fv=None, bull_fv=None, price=100.0, stale_mos=None)
    _apply_dual_track_blend_to_scenarios(s, 150.0)
    assert s["margin_of_safety_pct"] is None
    assert s["base"]["fair_value_per_share"] is None


def test_missing_price_leaves_margin_none_not_fabricated():
    # If current_price was ever genuinely None, build_scenarios' own
    # calc_margin_of_safety(base, None) would already have returned None —
    # so the only realistic "stale" value here is None itself. Confirm the
    # fix never invents a number to replace it just because a blend ran.
    s = _scenarios(base_fv=100.0, bear_fv=80.0, bull_fv=130.0, price=None, stale_mos=None)
    _apply_dual_track_blend_to_scenarios(s, 120.0)
    # Value DOES update (price isn't needed to scale base/bear/bull)...
    assert s["base"]["fair_value_per_share"] == 120.0
    # ...but margin is never fabricated without a real price.
    assert s["margin_of_safety_pct"] is None


def test_negative_or_zero_blended_value_never_produces_a_margin():
    s = _scenarios(base_fv=100.0, bear_fv=80.0, bull_fv=130.0, price=50.0, stale_mos=10.0)
    _apply_dual_track_blend_to_scenarios(s, 0.0)
    # blended <= 0 fails the guard entirely — nothing changes, same as the
    # function's pre-fix guard already required.
    assert s["base"]["fair_value_per_share"] == 100.0
    assert s["margin_of_safety_pct"] == 10.0


# ---------------------------------------------------------------------------
# 6. Determinism — same frozen inputs twice must produce the same output.
# ---------------------------------------------------------------------------

def test_deterministic_with_frozen_inputs():
    def run():
        s = _scenarios(base_fv=200.0, bear_fv=150.0, bull_fv=260.0, price=180.0, stale_mos=-15.0)
        _apply_dual_track_blend_to_scenarios(s, 230.0)
        return s

    first, second = run(), run()
    assert first == second
