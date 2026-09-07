"""
Tests — app.services.valuation.nuvos_engine.earnings_state.

See /Users/diegoarria/.claude/plans/cosmic-munching-crown.md.
"""
from app.services.quality.deterioration_engine import compute_deterioration_signals
from app.services.valuation.nuvos_engine.classification import LynchCategory
from app.services.valuation.nuvos_engine.earnings_state import detect_earnings_state, EarningsState


class TestInsufficientHistory:
    def test_short_history_never_fabricates_a_normalized_eps(self):
        result = detect_earnings_state(
            eps_trend=[1.0, 1.1], net_margin_trend=[5.0, 5.5],
            category=LynchCategory.STALWART, latest_eps=1.1,
        )
        assert result.normalized_eps is None
        assert result.reliability_note is not None


class TestCyclical:
    def test_current_margin_near_top_of_own_range_is_peak(self):
        margins = [5, 6, 7, 20, 21, 22]  # last 3 clearly the high end
        eps = [1, 1.2, 1.4, 4.0, 4.2, 4.4]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=margins, category=LynchCategory.CYCLICAL, latest_eps=eps[-1],
        )
        assert result.state == EarningsState.CYCLICAL_PEAK
        # normalized EPS should be pulled below the raw peak-margin EPS
        assert result.normalized_eps < eps[-1]

    def test_current_margin_near_bottom_of_own_range_is_trough(self):
        margins = [20, 21, 22, 23, 5, 6, 4]
        eps = [4.0, 4.2, 4.4, 4.5, 1.0, 1.1, 0.9]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=margins, category=LynchCategory.CYCLICAL, latest_eps=eps[-1],
        )
        assert result.state == EarningsState.CYCLICAL_TROUGH
        assert result.normalized_eps > eps[-1]

    def test_middle_of_range_is_normal(self):
        margins = [10, 12, 14, 13, 11, 12]
        eps = [2, 2.2, 2.4, 2.3, 2.1, 2.2]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=margins, category=LynchCategory.CYCLICAL, latest_eps=eps[-1],
        )
        assert result.state == EarningsState.NORMAL

    def test_median_floored_at_half_the_average_when_dragged_down_by_a_real_trough(self):
        """Diego, 2026-09-05 — real bug found auditing the full Energy
        sector: FTI (TechnipFMC), a real oilfield-services cyclical, spent
        several real years near-breakeven during the 2015-2020 industry
        downturn — its historical median net margin (0.3%) collapsed
        normalized EPS to near-zero ($0.07) even at a genuine, real
        current-margin peak, producing an economically meaningless fair
        value ($1.58 vs. a real $79.84 price). Mirrors this with a
        synthetic margin history dominated by near-zero trough years plus
        one real peak year: median alone would floor normalized EPS far
        below half the real historical average — the floor must lift it."""
        # 5 near-breakeven trough years + 1 real peak year. Median ~= 0.4%
        # (far below the average ~2.6%); floor = 50% of the average (~1.3%)
        # must win, pulling the anchor up from the unfloored median.
        margins = [0.3, 0.4, 0.5, 0.3, 0.4, 14.0]
        eps = [0.05, 0.07, 0.08, 0.05, 0.07, 2.0]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=margins, category=LynchCategory.CYCLICAL, latest_eps=eps[-1],
        )
        assert result.state == EarningsState.CYCLICAL_PEAK
        import statistics
        unfloored_median = statistics.median(margins)
        avg_margin = statistics.mean(margins)
        # Real revenue implied by the peak year, same formula the engine uses.
        revenue_implied = eps[-1] / margins[-1]
        unfloored_normalized = revenue_implied * unfloored_median
        floored_normalized = revenue_implied * (avg_margin * 0.5)
        assert result.normalized_eps > unfloored_normalized
        assert abs(result.normalized_eps - round(floored_normalized, 2)) < 0.01

    def test_no_floor_applied_when_average_margin_is_itself_negative(self):
        """A business with a genuinely negative average margin over its
        real history has no meaningful positive floor to lift toward —
        the plain median still applies unmodified."""
        import statistics
        margins = [-5.0, -3.0, -1.0, 8.0]
        eps = [-0.5, -0.3, -0.1, 1.0]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=margins, category=LynchCategory.CYCLICAL, latest_eps=eps[-1],
        )
        avg_margin = statistics.mean(margins)
        assert avg_margin < 0
        median_margin = statistics.median(margins)
        revenue_implied = eps[-1] / margins[-1]
        expected = round(revenue_implied * median_margin, 2)
        assert result.normalized_eps == expected

    def test_peak_with_real_structural_improvement_is_not_mean_reverted(self):
        """Diego, 2026-09-05 — real gap found auditing the full Energy
        sector: TRGP (Targa Resources) has real structural growth (LNG
        export buildout, Permian gathering/processing volumes), not a
        one-off commodity-price spike, but a Cyclical classification
        always mean-reverted a percentile-extreme margin regardless of
        real structural evidence — unlike the non-cyclical branches below,
        which already check `_is_structural` first. Real, matching
        evidence (ROIC, operating margin, net margin all improving,
        nothing contradicting) must now produce STRUCTURALLY_ELEVATED
        instead of CYCLICAL_PEAK, with normalized EPS recency-weighted
        toward the recent years, not reverted to the historical median."""
        det = compute_deterioration_signals(
            roic_trend=[8, 9, 10, 12, 14, 17],
            operating_margin_trend=[9, 10, 11, 13, 15, 18],
            net_margin_trend=[5, 6, 7, 8, 9, 20],
            fcf_margin_trend=[7, 8, 9, 10, 11, 14],
            revenue_trend=[100, 108, 116, 126, 137, 150],
        )
        margins = [5, 6, 7, 8, 9, 20]
        eps = [1.0, 1.2, 1.4, 1.6, 1.8, 4.0]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=margins, category=LynchCategory.CYCLICAL,
            latest_eps=eps[-1], deterioration=det,
        )
        assert result.state == EarningsState.STRUCTURALLY_ELEVATED
        assert result.structural_evidence_count == 3
        # Recency-weighted toward real recent earnings power — meaningfully
        # ABOVE what the old mean-reversion-to-mid-cycle-margin approach
        # would have given (1.5: mid_cycle_margin 7.5% floored from a 9.2%
        # average, times revenue implied by the peak year), but still a
        # genuine blend, not full credit for the single latest year (4.0).
        old_mean_reverted_value = 1.5
        assert old_mean_reverted_value < result.normalized_eps < eps[-1]

    def test_peak_without_structural_evidence_still_mean_reverts(self):
        """Same percentile-extreme shape as above, but with NO real
        deterioration signal supplied — must still fall through to the
        original CYCLICAL_PEAK mean-reversion behavior, unchanged."""
        margins = [5, 6, 7, 8, 9, 20]
        eps = [1.0, 1.2, 1.4, 1.6, 1.8, 4.0]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=margins, category=LynchCategory.CYCLICAL, latest_eps=eps[-1],
        )
        assert result.state == EarningsState.CYCLICAL_PEAK
        assert result.normalized_eps < eps[-1]


class TestTurnaround:
    def test_negative_base_with_real_improvement_is_recovery_without_a_fabricated_number(self):
        det = compute_deterioration_signals(
            roic_trend=[1, 2, 3, 4, 5, 6], operating_margin_trend=[1, 2, 3, 4, 5, 6],
            net_margin_trend=[-5, -4, -3, -1, 0.5, 1], fcf_margin_trend=[1, 2, 3, 4, 5, 6],
            revenue_trend=[100, 102, 105, 108, 112, 116],
        )
        result = detect_earnings_state(
            eps_trend=[-1, -0.8, -0.5, -0.2, -0.1, -0.05], net_margin_trend=[-5, -4, -3, -1, 0.5, 1],
            category=LynchCategory.TURNAROUND, latest_eps=-0.05, deterioration=det,
        )
        assert result.state == EarningsState.RECOVERY
        assert result.normalized_eps is None  # never fabricated even when recovering
        assert result.reliability_note is not None

    def test_negative_base_without_improvement_is_structurally_impaired(self):
        det = compute_deterioration_signals(
            roic_trend=[6, 5, 4, 3, 2, 1], operating_margin_trend=[6, 5, 4, 3, 2, 1],
            net_margin_trend=[1, 0, -1, -2, -3, -4], fcf_margin_trend=[6, 5, 4, 3, 2, 1],
            revenue_trend=[116, 112, 108, 105, 102, 100],
        )
        result = detect_earnings_state(
            eps_trend=[0.3, 0.1, -0.2, -0.5, -0.8, -1.0], net_margin_trend=[1, 0, -1, -2, -3, -4],
            category=LynchCategory.TURNAROUND, latest_eps=-1.0, deterioration=det,
        )
        assert result.state == EarningsState.STRUCTURALLY_IMPAIRED
        assert result.normalized_eps is None


class TestNonCyclicalNonTurnaround:
    def test_eps_far_above_recent_average_is_elevated(self):
        eps = [1.0, 1.05, 1.1, 1.15, 5.0]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=[10, 10, 10, 10, 10], category=LynchCategory.STALWART, latest_eps=5.0,
        )
        assert result.state == EarningsState.ELEVATED
        assert result.normalized_eps < 5.0

    def test_eps_far_below_recent_average_is_depressed(self):
        eps = [5.0, 5.1, 5.2, 5.15, 0.5]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=[10, 10, 10, 10, 10], category=LynchCategory.STALWART, latest_eps=0.5,
        )
        assert result.state == EarningsState.DEPRESSED
        assert result.normalized_eps > 0.5

    def test_eps_in_line_with_recent_average_is_normal(self):
        eps = [2.0, 2.1, 2.2, 2.15, 2.2]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=[10, 10, 10, 10, 10], category=LynchCategory.STALWART, latest_eps=2.2,
        )
        assert result.state == EarningsState.NORMAL
        assert result.normalized_eps == 2.2


class TestStructuralImprovement:
    """Phase 1 (Nuvos Fair Value Engine V2, 2026-08-12) — an elevated/
    depressed EPS reading backed by real, multi-metric profitability-trend
    evidence should be treated as a structural regime change, not mean-
    reverted to a stale historical average. See
    /Users/diegoarria/.claude/plans/cosmic-munching-crown.md."""

    def test_elevated_with_real_profitability_improvement_is_structural(self):
        det = compute_deterioration_signals(
            roic_trend=[8, 9, 10, 11, 14, 16],
            operating_margin_trend=[10, 11, 12, 14, 17, 19],
            net_margin_trend=[6, 6.5, 7, 8, 10, 11],
            fcf_margin_trend=[8, 8.5, 9, 10, 12, 13],
            revenue_trend=[100, 108, 116, 125, 135, 146],
        )
        eps = [1.0, 1.05, 1.1, 1.15, 2.0]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=[10, 10.5, 11, 11.5, 15],
            category=LynchCategory.STALWART, latest_eps=2.0, deterioration=det,
        )
        assert result.state == EarningsState.STRUCTURALLY_ELEVATED
        assert result.normalized_eps is not None
        # Recency-weighted, not mean-reverted (below stale avg) and not
        # just "trust latest" (below latest) — genuinely in between.
        recent_avg = sum(eps[:-1]) / len(eps[:-1])
        assert recent_avg < result.normalized_eps < eps[-1]
        assert result.structural_evidence_count == 3

    def test_depressed_with_real_profitability_deterioration_is_structural(self):
        det = compute_deterioration_signals(
            roic_trend=[16, 14, 11, 10, 9, 8],
            operating_margin_trend=[19, 17, 14, 12, 11, 10],
            net_margin_trend=[11, 10, 8, 7, 6.5, 6],
            fcf_margin_trend=[13, 12, 10, 9, 8.5, 8],
            revenue_trend=[146, 135, 125, 116, 108, 100],
        )
        eps = [2.0, 1.9, 1.8, 1.7, 0.8]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=[15, 14, 12, 11, 8],
            category=LynchCategory.STALWART, latest_eps=0.8, deterioration=det,
        )
        assert result.state == EarningsState.STRUCTURALLY_DEPRESSED
        assert result.normalized_eps is not None
        recent_avg = sum(eps[:-1]) / len(eps[:-1])
        # Not reverted UP to the stale (better) historical average.
        assert eps[-1] < result.normalized_eps < recent_avg
        assert result.structural_evidence_count == 3

    def test_elevated_with_weak_evidence_falls_through_to_plain_elevated(self):
        # Only revenue improving (not a structural metric) — no
        # roic/margin evidence at all.
        det = compute_deterioration_signals(
            roic_trend=[10, 10, 10, 10, 10, 10],
            operating_margin_trend=[12, 12, 12, 12, 12, 12],
            net_margin_trend=[8, 8, 8, 8, 8, 8],
            fcf_margin_trend=[9, 9, 9, 9, 9, 9],
            revenue_trend=[100, 108, 116, 125, 135, 146],
        )
        eps = [1.0, 1.05, 1.1, 1.15, 2.0]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=[10, 10, 10, 10, 10],
            category=LynchCategory.STALWART, latest_eps=2.0, deterioration=det,
        )
        assert result.state == EarningsState.ELEVATED
        assert result.normalized_eps == round(sum(eps[:-1]) / len(eps[:-1]), 2)
        assert result.structural_evidence_count is None

    def test_elevated_with_contradicting_metric_falls_through_to_plain_elevated(self):
        # ROIC and operating margin improve, but net margin deteriorates —
        # one real contradiction is enough to reject the structural claim
        # (zero-tolerance bar).
        det = compute_deterioration_signals(
            roic_trend=[8, 9, 10, 11, 14, 16],
            operating_margin_trend=[10, 11, 12, 14, 17, 19],
            net_margin_trend=[11, 10, 8, 7, 6.5, 6],
            fcf_margin_trend=[9, 9, 9, 9, 9, 9],
            revenue_trend=[100, 108, 116, 125, 135, 146],
        )
        eps = [1.0, 1.05, 1.1, 1.15, 2.0]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=[10, 10, 10, 10, 10],
            category=LynchCategory.STALWART, latest_eps=2.0, deterioration=det,
        )
        assert result.state == EarningsState.ELEVATED
        assert result.structural_evidence_count is None

    def test_structural_elevated_excludes_loss_years_from_mixed_regime_baseline(self):
        # UBER-shaped baseline (losses then profit) but WITH real
        # structural improvement evidence — loss years must still be
        # excluded from the recency-weighted blend, and a real
        # normalized_eps must still be produced (never bails to None the
        # way plain ELEVATED does for a mixed-regime baseline).
        det = compute_deterioration_signals(
            roic_trend=[-10, -6, -2, 5, 12, 18],
            operating_margin_trend=[-8, -4, 0, 6, 12, 18],
            net_margin_trend=[-12, -8, -3, 3, 9, 14],
            fcf_margin_trend=[-5, -2, 1, 4, 7, 10],
            revenue_trend=[80, 85, 92, 100, 115, 135],
        )
        eps = [-4.0, -2.0, -0.5, 1.0, 4.73]
        result = detect_earnings_state(
            eps_trend=eps, net_margin_trend=[-10, -6, -2, 4, 12],
            category=LynchCategory.FAST_GROWER, latest_eps=4.73, deterioration=det,
        )
        assert result.state == EarningsState.STRUCTURALLY_ELEVATED
        assert result.normalized_eps is not None
        assert result.normalized_eps > 0  # never lets negative years leak into the blend
        assert result.reliability_note is not None  # discloses the loss-year exclusion
