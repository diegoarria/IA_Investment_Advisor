"""
Tests — app.services.valuation.nuvos_engine.classification.

See /Users/diegoarria/.claude/plans/cosmic-munching-crown.md.
"""
from app.services.quality.deterioration_engine import compute_deterioration_signals
from app.services.valuation.nuvos_engine.classification import classify_business, LynchCategory

_NO_SIGNAL_DET = compute_deterioration_signals(
    roic_trend=[None, None], operating_margin_trend=[None, None],
    net_margin_trend=[None, None], fcf_margin_trend=[None, None], revenue_trend=[None, None],
)


def _improving_det():
    return compute_deterioration_signals(
        roic_trend=[5, 5.5, 6, 7, 8, 9], operating_margin_trend=[5, 5.5, 6, 7, 8, 9],
        net_margin_trend=[1, 1.5, 2, 3, 4, 5], fcf_margin_trend=[1, 1.5, 2, 3, 4, 5],
        revenue_trend=[100, 102, 105, 108, 112, 116],
    )


class TestFinancialRouting:
    def test_financial_sector_always_wins_first(self):
        result = classify_business(
            revenue_cagr_3y_pct=50.0, eps_trend=[1, 2, 3], deterioration=_NO_SIGNAL_DET,
            sector_category="Financials", roic_avg_pct=99.0, industry_median_roic_pct=1.0,
            is_financial_sector=True,
        )
        assert result.category == LynchCategory.FINANCIAL
        assert result.confidence == 100.0


class TestTurnaround:
    def test_negative_eps_with_real_improvement_is_turnaround_recovery_leaning(self):
        result = classify_business(
            revenue_cagr_3y_pct=5.0, eps_trend=[-2, -1, -0.5], deterioration=_improving_det(),
            sector_category="Software", roic_avg_pct=None, industry_median_roic_pct=None,
            is_financial_sector=False, latest_eps=-0.5,
        )
        assert result.category == LynchCategory.TURNAROUND
        assert result.confidence > 40.0

    def test_negative_eps_without_improvement_is_low_confidence_turnaround(self):
        result = classify_business(
            revenue_cagr_3y_pct=5.0, eps_trend=[-1, -1, -1], deterioration=_NO_SIGNAL_DET,
            sector_category="Software", roic_avg_pct=None, industry_median_roic_pct=None,
            is_financial_sector=False, latest_eps=-1.0,
        )
        assert result.category == LynchCategory.TURNAROUND
        assert result.confidence <= 30.0


class TestCyclical:
    def test_volatile_eps_in_cyclical_sector_is_cyclical(self):
        result = classify_business(
            revenue_cagr_3y_pct=8.0, eps_trend=[1, 5, 0.5, 6, 0.2, 7],  # high CV
            deterioration=_NO_SIGNAL_DET, sector_category="Semiconductors",
            roic_avg_pct=15.0, industry_median_roic_pct=12.0,
            is_financial_sector=False, latest_eps=7.0,
        )
        assert result.category == LynchCategory.CYCLICAL

    def test_volatile_eps_outside_a_cyclical_sector_does_not_default_to_cyclical(self):
        result = classify_business(
            revenue_cagr_3y_pct=8.0, eps_trend=[1, 5, 0.5, 6, 0.2, 7],
            deterioration=_NO_SIGNAL_DET, sector_category="Software",
            roic_avg_pct=15.0, industry_median_roic_pct=12.0,
            is_financial_sector=False, latest_eps=7.0,
        )
        assert result.category != LynchCategory.CYCLICAL


class TestFastGrower:
    def test_sustained_high_growth_with_stable_earnings_is_fast_grower(self):
        result = classify_business(
            revenue_cagr_3y_pct=25.0, eps_trend=[1, 1.2, 1.4, 1.6, 1.8, 2.0],
            deterioration=_NO_SIGNAL_DET, sector_category="Software",
            roic_avg_pct=20.0, industry_median_roic_pct=10.0,
            is_financial_sector=False, latest_eps=2.0,
        )
        assert result.category == LynchCategory.FAST_GROWER


class TestStalwart:
    def test_high_roic_beats_low_growth_bucketing_asset_play(self):
        # Calibration finding (AAPL): a mature, high-ROIC compounder with
        # low/flat growth must be Stalwart, not Asset Play — Asset Play is
        # for WEAK-return balance-sheet stories, not strong earners that
        # simply aren't growing fast anymore.
        result = classify_business(
            revenue_cagr_3y_pct=2.0, eps_trend=[5, 5.2, 5.4, 5.6, 5.8, 6.0],
            deterioration=_NO_SIGNAL_DET, sector_category="Technology",
            roic_avg_pct=90.0, industry_median_roic_pct=15.0,
            is_financial_sector=False, net_debt_to_ebitda=0.3, latest_eps=6.0,
        )
        assert result.category == LynchCategory.STALWART
        assert result.confidence >= 60.0

    def test_moderate_growth_with_below_peer_roic_does_not_use_the_stalwart_branch(self):
        # Below-peer ROIC means the Stalwart branch's condition isn't met —
        # this falls through to the low-confidence default (which happens
        # to also default to STALWART, but at low confidence, not the real
        # Stalwart branch's 70.0) rather than a confident Stalwart call.
        result = classify_business(
            revenue_cagr_3y_pct=6.0, eps_trend=[1, 1.1, 1.15, 1.2, 1.25, 1.3],
            deterioration=_NO_SIGNAL_DET, sector_category="Retail",
            roic_avg_pct=5.0, industry_median_roic_pct=12.0,
            is_financial_sector=False, latest_eps=1.3,
        )
        assert result.confidence < 70.0


class TestAssetPlay:
    def test_weak_growth_weak_roic_low_leverage_is_asset_play(self):
        result = classify_business(
            revenue_cagr_3y_pct=1.0, eps_trend=[1, 1, 1, 1, 1, 1],
            deterioration=_NO_SIGNAL_DET, sector_category="Real Estate Services",
            roic_avg_pct=4.0, industry_median_roic_pct=10.0,
            is_financial_sector=False, net_debt_to_ebitda=0.2, latest_eps=1.0,
        )
        assert result.category == LynchCategory.ASSET_PLAY
        assert result.confidence < 60.0  # lowest-confidence bucket by design

    def test_weak_growth_but_leveraged_is_not_asset_play(self):
        result = classify_business(
            revenue_cagr_3y_pct=1.0, eps_trend=[1, 1, 1, 1, 1, 1],
            deterioration=_NO_SIGNAL_DET, sector_category="Retail",
            roic_avg_pct=4.0, industry_median_roic_pct=10.0,
            is_financial_sector=False, net_debt_to_ebitda=4.0, latest_eps=1.0,
        )
        assert result.category != LynchCategory.ASSET_PLAY


class TestSlowGrower:
    def test_flat_growth_no_other_signal_falls_to_slow_grower(self):
        result = classify_business(
            revenue_cagr_3y_pct=1.5, eps_trend=[1, 1, 1, 1, 1, 1],
            deterioration=_NO_SIGNAL_DET, sector_category="Utilities",
            roic_avg_pct=None, industry_median_roic_pct=None,
            is_financial_sector=False, net_debt_to_ebitda=3.0, latest_eps=1.0,
        )
        assert result.category == LynchCategory.SLOW_GROWER


class TestFallback:
    def test_missing_growth_data_returns_low_confidence_default_not_a_crash(self):
        result = classify_business(
            revenue_cagr_3y_pct=None, eps_trend=[], deterioration=_NO_SIGNAL_DET,
            sector_category="Diversified", roic_avg_pct=None, industry_median_roic_pct=None,
            is_financial_sector=False, latest_eps=None,
        )
        assert result.confidence <= 25.0
        assert result.category is not None  # never crashes, never raises
