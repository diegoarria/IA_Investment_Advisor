"""
Tests — app.services.quality.moat_duration_engine (Nuvos Fair Value
Engine V2, Phase 1).

See /Users/diegoarria/.claude/plans/cosmic-munching-crown.md.
"""
from app.services.quality.moat_duration_engine import estimate_moat_duration, MoatDurationBucket
from app.services.quality.moat_engine import MoatScoreResult
from app.services.quality.deterioration_engine import compute_deterioration_signals


def _moat(score: int) -> MoatScoreResult:
    return MoatScoreResult(
        moat_score=score, roic_premium_score=score, margin_premium_score=score,
        stability_score=score, factors=[],
    )


def _flat_deterioration() -> "object":
    return compute_deterioration_signals(
        roic_trend=[10, 10, 10, 10, 10, 10],
        operating_margin_trend=[12, 12, 12, 12, 12, 12],
        net_margin_trend=[8, 8, 8, 8, 8, 8],
        fcf_margin_trend=[9, 9, 9, 9, 9, 9],
        revenue_trend=[100, 101, 100, 102, 101, 100],
    )


class TestBucketBoundaries:
    def test_score_19_is_shortest_bucket(self):
        r = estimate_moat_duration(moat_result=_moat(19), deterioration=_flat_deterioration(), years_of_real_roic_history=10)
        assert r.bucket == MoatDurationBucket.YEARS_0_3

    def test_score_21_moves_to_next_bucket(self):
        r = estimate_moat_duration(moat_result=_moat(21), deterioration=_flat_deterioration(), years_of_real_roic_history=10)
        assert r.bucket == MoatDurationBucket.YEARS_3_5

    def test_score_85_is_longest_bucket(self):
        r = estimate_moat_duration(moat_result=_moat(85), deterioration=_flat_deterioration(), years_of_real_roic_history=10)
        assert r.bucket == MoatDurationBucket.YEARS_15_PLUS


class TestTrendModifier:
    def test_deteriorating_profitability_shifts_bucket_down_one(self):
        det = compute_deterioration_signals(
            roic_trend=[16, 14, 11, 10, 9, 8],
            operating_margin_trend=[19, 17, 14, 12, 11, 10],
            net_margin_trend=[11, 10, 8, 7, 6.5, 6],
            fcf_margin_trend=[13, 12, 10, 9, 8.5, 8],
            revenue_trend=[146, 135, 125, 116, 108, 100],
        )
        r = estimate_moat_duration(moat_result=_moat(55), deterioration=det, years_of_real_roic_history=10)
        # base bucket for 55 is "5_10" -> shifted down to "3_5"
        assert r.bucket == MoatDurationBucket.YEARS_3_5

    def test_improving_profitability_with_solid_score_shifts_bucket_up_one(self):
        det = compute_deterioration_signals(
            roic_trend=[8, 9, 10, 11, 14, 16],
            operating_margin_trend=[10, 11, 12, 14, 17, 19],
            net_margin_trend=[6, 6.5, 7, 8, 10, 11],
            fcf_margin_trend=[8, 8.5, 9, 10, 12, 13],
            revenue_trend=[100, 108, 116, 125, 135, 146],
        )
        r = estimate_moat_duration(moat_result=_moat(55), deterioration=det, years_of_real_roic_history=10)
        # base bucket for 55 is "5_10" -> shifted up to "10_15"
        assert r.bucket == MoatDurationBucket.YEARS_10_15

    def test_bucket_never_shifts_past_array_bounds(self):
        det_improving = compute_deterioration_signals(
            roic_trend=[8, 9, 10, 11, 14, 16],
            operating_margin_trend=[10, 11, 12, 14, 17, 19],
            net_margin_trend=[6, 6.5, 7, 8, 10, 11],
            fcf_margin_trend=[8, 8.5, 9, 10, 12, 13],
            revenue_trend=[100, 108, 116, 125, 135, 146],
        )
        r = estimate_moat_duration(moat_result=_moat(95), deterioration=det_improving, years_of_real_roic_history=10)
        assert r.bucket == MoatDurationBucket.YEARS_15_PLUS  # already max, stays there

        det_deteriorating = compute_deterioration_signals(
            roic_trend=[16, 14, 11, 10, 9, 8],
            operating_margin_trend=[19, 17, 14, 12, 11, 10],
            net_margin_trend=[11, 10, 8, 7, 6.5, 6],
            fcf_margin_trend=[13, 12, 10, 9, 8.5, 8],
            revenue_trend=[146, 135, 125, 116, 108, 100],
        )
        r2 = estimate_moat_duration(moat_result=_moat(5), deterioration=det_deteriorating, years_of_real_roic_history=10)
        assert r2.bucket == MoatDurationBucket.YEARS_0_3  # already min, stays there


class TestThinHistoryCap:
    def test_high_score_with_thin_history_is_capped_and_low_confidence(self):
        r = estimate_moat_duration(moat_result=_moat(95), deterioration=_flat_deterioration(), years_of_real_roic_history=3)
        assert r.bucket in (MoatDurationBucket.YEARS_0_3, MoatDurationBucket.YEARS_3_5, MoatDurationBucket.YEARS_5_10, MoatDurationBucket.YEARS_10_15)
        assert r.bucket != MoatDurationBucket.YEARS_15_PLUS
        assert r.confidence == 30.0

    def test_sufficient_history_is_not_capped(self):
        r = estimate_moat_duration(moat_result=_moat(95), deterioration=_flat_deterioration(), years_of_real_roic_history=4)
        assert r.bucket == MoatDurationBucket.YEARS_15_PLUS
        assert r.confidence > 30.0


class TestYearsPointEstimate:
    def test_midpoint_years_match_bucket(self):
        r = estimate_moat_duration(moat_result=_moat(90), deterioration=_flat_deterioration(), years_of_real_roic_history=10)
        assert r.years_point_estimate == 18
