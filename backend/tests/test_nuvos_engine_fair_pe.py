"""
Tests — app.services.valuation.nuvos_engine.fair_pe.

See /Users/diegoarria/.claude/plans/cosmic-munching-crown.md.
"""
from app.services.valuation.nuvos_engine.classification import LynchCategory
from app.services.valuation.nuvos_engine.fair_pe import compute_fair_pe, _CATEGORY_BOUNDS
from app.services.valuation.nuvos_engine.growth_quality import decompose_eps_growth
from app.services.valuation.nuvos_engine.growth_evidence import resolve_growth_evidence


def _ge(forward=None, eps_cagr=None, revenue_cagr=None, normalized=None):
    return resolve_growth_evidence(
        forward_consensus_pct=forward, eps_cagr_pct=eps_cagr,
        revenue_cagr_pct=revenue_cagr, normalized_growth_pct=normalized,
    )


def _neutral_kwargs(**overrides):
    kwargs = dict(
        category=LynchCategory.STALWART, sector="Technology",
        growth_evidence=_ge(forward=5.0), roic_pct=9.0, cost_of_capital_pct=9.0,
        fcf_margin_pct=10.0, net_debt_to_ebitda=1.0, interest_coverage=10.0,
        dividend_yield_pct=None, moat_score=50.0, management_score=50.0,
    )
    kwargs.update(overrides)
    return kwargs


class TestAnchorBlending:
    def test_no_market_evidence_falls_back_to_growth_based_only(self):
        result = compute_fair_pe(**_neutral_kwargs())
        assert result.primary_anchor == "growth_based"

    def test_real_historical_and_peer_pe_change_the_blended_result(self):
        no_anchors = compute_fair_pe(**_neutral_kwargs())
        with_anchors = compute_fair_pe(**_neutral_kwargs(historical_median_pe=40.0, peer_median_pe=42.0))
        assert with_anchors.fair_pe != no_anchors.fair_pe

    def test_band_widens_when_anchors_disagree(self):
        result = compute_fair_pe(**_neutral_kwargs(historical_median_pe=10.0, peer_median_pe=40.0))
        assert result.band[1] > result.band[0]


class TestCategoryBounds:
    def test_result_never_exceeds_the_categorys_ceiling(self):
        for category, (lo, hi) in _CATEGORY_BOUNDS.items():
            result = compute_fair_pe(**_neutral_kwargs(category=category, growth_evidence=_ge(forward=200.0), roic_pct=99.0, cost_of_capital_pct=1.0))
            assert result.fair_pe <= hi

    def test_result_never_falls_below_the_categorys_floor(self):
        for category, (lo, hi) in _CATEGORY_BOUNDS.items():
            result = compute_fair_pe(**_neutral_kwargs(category=category, growth_evidence=_ge(forward=-90.0), roic_pct=1.0, cost_of_capital_pct=30.0))
            assert result.fair_pe >= lo

    def test_cyclical_ceiling_is_between_industrial_and_fast_grower_levels(self):
        cyclical_hi = _CATEGORY_BOUNDS[LynchCategory.CYCLICAL][1]
        fast_grower_hi = _CATEGORY_BOUNDS[LynchCategory.FAST_GROWER][1]
        assert cyclical_hi < fast_grower_hi


class TestBuybackDiscount:
    def test_growth_dominated_by_buybacks_is_discounted_vs_organic_growth(self):
        organic_gq = decompose_eps_growth(eps_cagr_pct=10.0, revenue_cagr_pct=10.0, implied_shares_trend=[100] * 6)
        buyback_shares = [100, 95, 90.25, 85.7, 81.5, 77.4]
        buyback_gq = decompose_eps_growth(eps_cagr_pct=10.0, revenue_cagr_pct=2.0, implied_shares_trend=buyback_shares)

        organic = compute_fair_pe(**_neutral_kwargs(growth_evidence=_ge(forward=10.0), growth_quality=organic_gq))
        buyback = compute_fair_pe(**_neutral_kwargs(growth_evidence=_ge(forward=10.0), growth_quality=buyback_gq))
        organic_growth_pts = next(a.points for a in organic.adjustments if a.factor == "growth")
        buyback_growth_pts = next(a.points for a in buyback.adjustments if a.factor == "growth")
        assert buyback_growth_pts <= organic_growth_pts


class TestGrowthEvidenceTraceability:
    """Priority 1 (methodology audit) — the growth adjustment must never be
    silently 0 when real historical evidence exists, and the result must
    always say which evidence tier it used."""

    def test_no_forward_consensus_falls_back_to_historical_eps_cagr(self):
        result = compute_fair_pe(**_neutral_kwargs(growth_evidence=_ge(eps_cagr=25.0)))
        assert result.growth_source == "historical_eps_cagr"
        growth_pts = next(a.points for a in result.adjustments if a.factor == "growth")
        assert growth_pts > 0  # NVDA-like case: real historical growth, no forward consensus available

    def test_insufficient_evidence_leaves_growth_adjustment_at_zero_not_fabricated(self):
        result = compute_fair_pe(**_neutral_kwargs(growth_evidence=_ge()))
        assert result.growth_source == "insufficient"
        growth_pts = next(a.points for a in result.adjustments if a.factor == "growth")
        assert growth_pts == 0.0

    def test_forward_consensus_is_preferred_over_historical_when_both_present(self):
        result = compute_fair_pe(**_neutral_kwargs(growth_evidence=_ge(forward=8.0, eps_cagr=25.0)))
        assert result.growth_source == "forward_consensus"

    def test_growth_reason_is_populated_and_traceable(self):
        result = compute_fair_pe(**_neutral_kwargs(growth_evidence=_ge(eps_cagr=25.0)))
        assert result.growth_reason is not None and "25.0%" in result.growth_reason
