from unittest.mock import patch

from app.services.valuation.shadow_dual_track_service import compute_shadow_dual_track
from app.services.valuation.earnings_normalization_engine import NormalizedEpsResult, CapexSupercycleResult
from app.services.valuation.nuvos_engine.fair_pe import MultipleAdjustment


def _real_meta_adjustments():
    return [
        MultipleAdjustment("growth", 3.6, "..."),
        MultipleAdjustment("quality", 6.18, "..."),
        MultipleAdjustment("fcf_margin", 1.94, "..."),
        MultipleAdjustment("leverage", 0.0, "..."),
        MultipleAdjustment("dividend", 0.07, "..."),
        MultipleAdjustment("moat_management", 2.56, "..."),
    ]


def test_matches_real_meta_case_end_to_end():
    eps = NormalizedEpsResult(raw_ttm_eps=26.54, normalized_ttm_eps=30.16, normalized_tax_rate_pct=11.5,
                               flagged_quarters=["2025-09-30", "2026-03-31"])
    capex = CapexSupercycleResult(applicable=True, normalized_fcf_margin_pct=31.5,
                                    current_year_elevated_capex=True, n_normal_years=6, n_elevated_years=2)
    with patch("app.services.valuation.shadow_dual_track_service.normalized_ttm_eps", return_value=eps), \
         patch("app.services.valuation.shadow_dual_track_service.capex_supercycle_state", return_value=capex):
        r = compute_shadow_dual_track(
            "META", sector="Media", industry=None,
            fair_pe_base_multiple=17.0, fair_pe_adjustments=_real_meta_adjustments(),
            historical_median_pe=24.4, classification_confidence=80.0, confidence_score=58.0,
            wacc_pct=10.1, revenue_per_share_today=78.23, fcf_per_share_today=17.95, growth_pct=14.0,
        )
    assert r is not None
    # real final validated META number from this session (after the
    # correlation discount, multi-year recovery DCF, the 3.0% default
    # terminal growth fix from the Fase 2 batch, AND the 2026-09-04 blend-
    # weighting fix — averaging classification_confidence into the
    # broader confidence_score composite for the earnings side, plus the
    # weight floor raised 15%->30% — down from an earlier $713.45
    # checkpoint computed with the old, single-signal earnings-confidence
    # input, itself down from an even earlier $788 checkpoint).
    assert abs(r["blended_fair_value"] - 702.07) < 5.0
    assert r["eps_flagged_quarters"] == ["2025-09-30", "2026-03-31"]
    assert "recovery DCF" in r["fcf_track_note"]


def test_financial_sector_falls_back_to_earnings_track_only():
    eps = NormalizedEpsResult(raw_ttm_eps=23.21, normalized_ttm_eps=23.49, normalized_tax_rate_pct=21.8)
    capex = CapexSupercycleResult(applicable=False, reason="financial sector: Banking")
    with patch("app.services.valuation.shadow_dual_track_service.normalized_ttm_eps", return_value=eps), \
         patch("app.services.valuation.shadow_dual_track_service.capex_supercycle_state", return_value=capex):
        r = compute_shadow_dual_track(
            "JPM", sector="Banking", industry=None,
            fair_pe_base_multiple=10.0, fair_pe_adjustments=[MultipleAdjustment("growth", 1.0, "...")],
            historical_median_pe=11.0, classification_confidence=70.0, confidence_score=60.0,
            wacc_pct=9.0, revenue_per_share_today=50.0, fcf_per_share_today=5.0, growth_pct=5.0,
        )
    assert r is not None
    assert r["fcf_track_value"] is None
    assert r["blend"] is None
    assert r["blended_fair_value"] == r["earnings_track_value"]


def test_fcf_track_capped_when_it_diverges_too_far_from_earnings_track():
    """Real systemic bias found running the Fase 2 batch across ~130
    diverse tickers: the single-period Gordon FCF track ran 2.6x-3.9x
    higher than the earnings track for names like TKO/ADM. Two
    independent estimates of the same company shouldn't diverge that
    far — cap rather than blend the raw, over-extrapolated figure."""
    eps = NormalizedEpsResult(raw_ttm_eps=4.0, normalized_ttm_eps=4.0, normalized_tax_rate_pct=22.0)
    capex = CapexSupercycleResult(applicable=True, current_year_elevated_capex=False,
                                    n_normal_years=8, n_elevated_years=0)
    with patch("app.services.valuation.shadow_dual_track_service.normalized_ttm_eps", return_value=eps), \
         patch("app.services.valuation.shadow_dual_track_service.capex_supercycle_state", return_value=capex):
        r = compute_shadow_dual_track(
            "TKOTEST", sector="Media", industry=None,
            fair_pe_base_multiple=20.0, fair_pe_adjustments=[MultipleAdjustment("growth", 5.0, "...")],
            historical_median_pe=None, classification_confidence=70.0, confidence_score=60.0,
            # wacc_pct=10.1 (not the original 7.5) and fcf_per_share_today=15.0
            # (not 10.0) — 2026-09-04, after the minimum WACC-terminal spread
            # was raised 4.0pp->7.0pp (see dcf_recovery_engine.py), the
            # original 7.5% WACC (spread only 4.5pp against the 3.0% default
            # terminal growth) no longer clears the floor and returned None.
            # Re-tuned to still produce a real >2x raw divergence (still the
            # thing this test verifies) at a WACC that clears the new floor.
            wacc_pct=10.1, revenue_per_share_today=50.0, fcf_per_share_today=15.0, growth_pct=8.0,
        )
    assert r is not None
    # earnings track: (20 + 5*0.85) * 4.0 = 97.0; uncapped FCF track would
    # be ~217.6 (2.24x) -> capped at exactly 2.0x the earnings track.
    assert abs(r["earnings_track_value"] - 97.0) < 0.5
    assert abs(r["fcf_track_value"] - 194.0) < 0.5
    assert "capped" in r["fcf_track_note"]


def test_reit_sector_excludes_earnings_track():
    """Real gap found live for CCI (Crown Castle, a REIT) running the
    Fase 2 batch: shadow's tax-normalized TTM EPS came out 2.4x the real
    production normalized EPS, because GAAP D&A structurally distorts a
    REIT's reported earnings — the same reasoning the live production
    `dcf_engine.is_reit_sector` exclusion already documents. Excluded
    entirely rather than silently misapplied, matching production's own
    documented scope (FFO/AFFO is future-phase work, not built here)."""
    r = compute_shadow_dual_track(
        "CCITEST", sector="Real Estate", industry="REIT - Specialty",
        fair_pe_base_multiple=15.0, fair_pe_adjustments=[MultipleAdjustment("growth", 2.0, "...")],
        historical_median_pe=18.0, classification_confidence=70.0, confidence_score=60.0,
        wacc_pct=8.0, revenue_per_share_today=30.0, fcf_per_share_today=5.0, growth_pct=5.0,
    )
    assert r is not None
    assert "REIT" in r["note"]


def test_final_multiple_clamped_to_the_live_fair_pe_band():
    """Real bug found live for APPF (AppFolio) running the Fase 2 batch:
    its own real historical P/E is a genuine but extreme 1267.4x (a past
    near-zero-earnings quarter), and blending it in at 25% weight blew
    the earnings track's multiple up to 338.76x (vs. a real production
    fair_pe of 60.0). The live production `compute_fair_pe` already
    clamps its own result to a real band — reuse it here instead of
    reinventing a second bound."""
    eps = NormalizedEpsResult(raw_ttm_eps=4.5, normalized_ttm_eps=4.5, normalized_tax_rate_pct=20.0)
    capex = CapexSupercycleResult(applicable=True, current_year_elevated_capex=False,
                                    n_normal_years=8, n_elevated_years=0)
    with patch("app.services.valuation.shadow_dual_track_service.normalized_ttm_eps", return_value=eps), \
         patch("app.services.valuation.shadow_dual_track_service.capex_supercycle_state", return_value=capex):
        r = compute_shadow_dual_track(
            "APPFTEST", sector="Technology", industry=None,
            fair_pe_base_multiple=23.0, fair_pe_adjustments=[MultipleAdjustment("growth", 4.26, "...")],
            historical_median_pe=1267.4, classification_confidence=70.0, confidence_score=60.0,
            wacc_pct=8.5, revenue_per_share_today=50.0, fcf_per_share_today=10.0, growth_pct=15.7,
            fair_pe_band=(30.3, 60.0),
        )
    assert r is not None
    assert r["earnings_track_multiple"] == 60.0
    assert "clamped" in r["multiple_note"]
    assert abs(r["earnings_track_value"] - 270.0) < 0.5  # 4.5 * 60.0


def test_earnings_trough_floored_by_real_historical_average():
    """Real case caught live for MOH (Molina Healthcare) in the Fase 2
    batch: a genuine Q4 2025 GAAP loss (real medical-cost-trend miss, not
    a tax anomaly) drove raw TTM EPS to ~$0.19, which multiplied by a
    real fair P/E produced an implausible ~$3/share fair value for a
    company with a real ~$16 5-year normalized EPS. The floor should
    lift the near-zero TTM figure to 50% of that historical average
    rather than using it as-is."""
    eps = NormalizedEpsResult(raw_ttm_eps=0.19, normalized_ttm_eps=None, normalized_tax_rate_pct=None,
                               note="insufficient clean, meaningful quarters to trust a normalized tax rate")
    capex = CapexSupercycleResult(applicable=False, reason="near-zero real capex in almost every available year")
    with patch("app.services.valuation.shadow_dual_track_service.normalized_ttm_eps", return_value=eps), \
         patch("app.services.valuation.shadow_dual_track_service.capex_supercycle_state", return_value=capex):
        r = compute_shadow_dual_track(
            "MOH", sector="Healthcare", industry=None,
            fair_pe_base_multiple=14.0, fair_pe_adjustments=[MultipleAdjustment("growth", 2.29, "...")],
            historical_median_pe=None, classification_confidence=55.0, confidence_score=50.0,
            wacc_pct=9.0, revenue_per_share_today=800.0, fcf_per_share_today=10.0, growth_pct=3.0,
            historical_normalized_eps=16.0,
        )
    assert r is not None
    assert r["eps_used"] == 8.0  # 50% of the real 16.0 historical normalized EPS
    assert "floored" in r["eps_note"]


def test_earnings_peak_capped_by_real_historical_average():
    """Mirror-image real case caught live for MU (Micron) in the
    full-universe Fase 2 batch: a genuine cyclical peak (Micron swung
    from real 2023-2024 losses to a real 2025-2026 AI-driven memory
    boom) drove TTM normalized EPS to $45.13 — 6.4x the real production
    5-year normalized EPS ($7.06) — even though both pipelines' fair P/E
    multiples matched almost exactly. The ceiling should cap the inflated
    TTM figure at 2.0x the historical average rather than using it raw."""
    eps = NormalizedEpsResult(raw_ttm_eps=45.13, normalized_ttm_eps=45.13, normalized_tax_rate_pct=21.0)
    capex = CapexSupercycleResult(applicable=True, current_year_elevated_capex=False,
                                    n_normal_years=7, n_elevated_years=1)
    with patch("app.services.valuation.shadow_dual_track_service.normalized_ttm_eps", return_value=eps), \
         patch("app.services.valuation.shadow_dual_track_service.capex_supercycle_state", return_value=capex):
        r = compute_shadow_dual_track(
            "MUTEST", sector="Technology", industry=None,
            fair_pe_base_multiple=17.0, fair_pe_adjustments=[MultipleAdjustment("growth", -0.6, "...")],
            historical_median_pe=None, classification_confidence=55.0, confidence_score=50.0,
            wacc_pct=9.0, revenue_per_share_today=100.0, fcf_per_share_today=10.0, growth_pct=3.0,
            historical_normalized_eps=7.06,
        )
    assert r is not None
    assert r["eps_used"] == 14.12  # 2.0x the real 7.06 historical normalized EPS
    assert "capped" in r["eps_note"]


def test_earnings_peak_capped_by_production_raw_eps_when_no_historical_available():
    """Real gap found live for ROKU in the full-universe batch: production's
    OWN earnings_state engine already flagged ROKU's regime as "elevated"
    with an unreliable mixed-loss/gain prior history and returned
    normalized_eps=None (using raw EPS 0.59 as the safer answer) — so
    historical_normalized_eps is None here and the ceiling above has
    nothing to compare against. Shadow's own tax-normalized EPS ($2.48,
    4.2x production's raw EPS) shouldn't be trusted unchecked either —
    fall back to capping against production's raw EPS instead."""
    eps = NormalizedEpsResult(raw_ttm_eps=2.48, normalized_ttm_eps=2.48, normalized_tax_rate_pct=19.0)
    capex = CapexSupercycleResult(applicable=True, current_year_elevated_capex=False,
                                    n_normal_years=7, n_elevated_years=1)
    with patch("app.services.valuation.shadow_dual_track_service.normalized_ttm_eps", return_value=eps), \
         patch("app.services.valuation.shadow_dual_track_service.capex_supercycle_state", return_value=capex):
        r = compute_shadow_dual_track(
            "ROKUTEST", sector="Communication Services", industry=None,
            fair_pe_base_multiple=11.5, fair_pe_adjustments=[MultipleAdjustment("growth", 0.5, "...")],
            historical_median_pe=None, classification_confidence=55.0, confidence_score=50.0,
            wacc_pct=9.0, revenue_per_share_today=40.0, fcf_per_share_today=1.0, growth_pct=3.0,
            historical_normalized_eps=None, production_raw_eps=0.59,
        )
    assert r is not None
    assert r["eps_used"] == 1.18  # 2.0x production's raw 0.59 EPS
    assert "capped" in r["eps_note"]
    assert "raw GAAP EPS" in r["eps_note"]


def test_none_fair_pe_input_returns_note_not_crash():
    r = compute_shadow_dual_track(
        "TEST", sector="Media", industry=None,
        fair_pe_base_multiple=None, fair_pe_adjustments=None,
        historical_median_pe=None, classification_confidence=None, confidence_score=None,
        wacc_pct=None, revenue_per_share_today=None, fcf_per_share_today=None, growth_pct=None,
    )
    assert r is not None
    assert "note" in r


def test_sbc_per_share_reduces_fcf_track_to_owner_earnings():
    """Diego, 2026-09-04 — real fix for a systemic overvaluation found
    live for ROKU: raw reported FCF/share ($3.22) doesn't subtract
    stock-based comp ($2.39/share), a real ongoing dilution cost. With
    sbc_per_share supplied, the FCF track must be built off the real
    owner-earnings figure ($3.22 - $2.39 = $0.83), producing a materially
    LOWER fcf_track_value than the same inputs without the SBC
    adjustment — and the note must disclose the adjustment."""
    eps = NormalizedEpsResult(raw_ttm_eps=1.18, normalized_ttm_eps=1.18, normalized_tax_rate_pct=21.0)
    capex = CapexSupercycleResult(applicable=True, current_year_elevated_capex=False,
                                    n_normal_years=7, n_elevated_years=1)
    kwargs = dict(
        sector="Communication Services", industry=None,
        fair_pe_base_multiple=11.5, fair_pe_adjustments=[MultipleAdjustment("growth", 0.5, "...")],
        historical_median_pe=None, classification_confidence=55.0, confidence_score=50.0,
        wacc_pct=13.97, revenue_per_share_today=40.0, fcf_per_share_today=3.22, growth_pct=3.0,
    )
    with patch("app.services.valuation.shadow_dual_track_service.normalized_ttm_eps", return_value=eps), \
         patch("app.services.valuation.shadow_dual_track_service.capex_supercycle_state", return_value=capex):
        without_sbc = compute_shadow_dual_track("ROKUTEST", **kwargs)
        with_sbc = compute_shadow_dual_track("ROKUTEST", sbc_per_share=2.39, **kwargs)

    assert without_sbc is not None and with_sbc is not None
    assert with_sbc["fcf_track_value"] < without_sbc["fcf_track_value"]
    assert "owner earnings" in with_sbc["fcf_track_note"]
    assert "owner earnings" not in without_sbc["fcf_track_note"]


def test_sbc_per_share_can_push_owner_earnings_non_positive():
    """When SBC/share exceeds real FCF/share, the FCF track must decline
    to value it (same discipline as any other non-positive-FCF case) —
    never silently fall back to the richer pre-SBC number."""
    eps = NormalizedEpsResult(raw_ttm_eps=1.0, normalized_ttm_eps=1.0, normalized_tax_rate_pct=21.0)
    capex = CapexSupercycleResult(applicable=True, current_year_elevated_capex=False,
                                    n_normal_years=7, n_elevated_years=1)
    with patch("app.services.valuation.shadow_dual_track_service.normalized_ttm_eps", return_value=eps), \
         patch("app.services.valuation.shadow_dual_track_service.capex_supercycle_state", return_value=capex):
        r = compute_shadow_dual_track(
            "SBCHEAVY", sector="Technology", industry=None,
            fair_pe_base_multiple=15.0, fair_pe_adjustments=[MultipleAdjustment("growth", 0.5, "...")],
            historical_median_pe=None, classification_confidence=55.0, confidence_score=50.0,
            wacc_pct=12.0, revenue_per_share_today=20.0, fcf_per_share_today=1.5, growth_pct=5.0,
            sbc_per_share=2.0,
        )
    assert r is not None
    assert r["fcf_track_value"] is None
    assert "non-positive" in r["fcf_track_note"]
