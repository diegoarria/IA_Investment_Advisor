"""
Tests — app.services.valuation.nuvos_engine.growth_quality.

See /Users/diegoarria/.claude/plans/cosmic-munching-crown.md.
"""
from app.services.valuation.nuvos_engine.growth_quality import decompose_eps_growth


class TestDecomposeEpsGrowth:
    def test_missing_eps_cagr_returns_all_none(self):
        result = decompose_eps_growth(eps_cagr_pct=None, revenue_cagr_pct=10.0, implied_shares_trend=[100, 99, 98])
        assert result.from_revenue_pct is None
        assert result.from_buybacks_pct is None

    def test_shrinking_share_count_is_attributed_to_buybacks(self):
        # 6 years, ~5%/yr share reduction -> real negative shares CAGR.
        shares = [100, 95, 90.25, 85.7, 81.5, 77.4]
        result = decompose_eps_growth(eps_cagr_pct=12.0, revenue_cagr_pct=6.0, implied_shares_trend=shares)
        assert result.shares_cagr_pct is not None and result.shares_cagr_pct < 0
        assert result.from_buybacks_pct is not None and result.from_buybacks_pct > 0

    def test_growing_share_count_is_not_credited_as_buybacks(self):
        shares = [100, 102, 104, 106, 108, 110]
        result = decompose_eps_growth(eps_cagr_pct=12.0, revenue_cagr_pct=6.0, implied_shares_trend=shares)
        assert result.shares_cagr_pct is not None and result.shares_cagr_pct > 0
        # dilution -> negative buyback contribution (a drag), never a bonus
        assert result.from_buybacks_pct is not None and result.from_buybacks_pct < 0

    def test_missing_revenue_cagr_still_attributes_buyback_slice(self):
        shares = [100, 95, 90.25, 85.7, 81.5, 77.4]
        result = decompose_eps_growth(eps_cagr_pct=12.0, revenue_cagr_pct=None, implied_shares_trend=shares)
        assert result.from_revenue_pct is None
        assert result.from_buybacks_pct is not None

    def test_large_residual_is_labeled_unexplained_not_silently_folded_into_margin(self):
        # EPS growth wildly exceeds revenue growth with flat share count —
        # the residual should be flagged, not presented as confident margin
        # expansion.
        result = decompose_eps_growth(eps_cagr_pct=80.0, revenue_cagr_pct=2.0, implied_shares_trend=[100, 100, 100, 100, 100, 100])
        assert result.from_unexplained_pct != 0.0

    def test_reconciling_case_produces_no_unexplained_residual(self):
        result = decompose_eps_growth(eps_cagr_pct=8.0, revenue_cagr_pct=6.0, implied_shares_trend=[100, 100, 100, 100, 100, 100])
        assert result.from_unexplained_pct == 0.0
        assert result.from_revenue_pct == 6.0
