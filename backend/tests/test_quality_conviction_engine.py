"""
Tests — app.services.quality.conviction_engine (Fase 2, Incremento 9).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from app.services.quality.conviction_engine import compute_conviction_score


class TestComputeConvictionScore:
    def test_strong_signals_score_high(self):
        result = compute_conviction_score(
            quality_score=85.0, moat_score=80.0, stability_score=90.0, beta=0.6,
        )
        assert result.conviction_score >= 75
        assert result.has_any_signal is True

    def test_weak_signals_score_low(self):
        result = compute_conviction_score(
            quality_score=20.0, moat_score=15.0, stability_score=15.0, beta=1.9,
        )
        assert result.conviction_score <= 25

    def test_missing_beta_degrades_gracefully(self):
        result = compute_conviction_score(
            quality_score=80.0, moat_score=75.0, stability_score=70.0, beta=None,
        )
        assert result.beta_score is None
        assert result.has_any_signal is True
        assert result.conviction_score > 0

    def test_no_data_at_all_produces_zero_and_no_signal(self):
        result = compute_conviction_score(
            quality_score=None, moat_score=None, stability_score=None, beta=None,
        )
        assert result.conviction_score == 0
        assert result.has_any_signal is False

    def test_score_bounded_0_100(self):
        result = compute_conviction_score(
            quality_score=85.0, moat_score=80.0, stability_score=90.0, beta=0.6,
        )
        assert 0 <= result.conviction_score <= 100

    def test_every_present_factor_has_a_real_reason(self):
        result = compute_conviction_score(
            quality_score=85.0, moat_score=80.0, stability_score=90.0, beta=0.6,
        )
        assert len(result.factors) == 4
        assert all(f.reason for f in result.factors)

    def test_lower_beta_scores_higher_all_else_equal(self):
        low_beta = compute_conviction_score(quality_score=70.0, moat_score=70.0, stability_score=70.0, beta=0.5)
        high_beta = compute_conviction_score(quality_score=70.0, moat_score=70.0, stability_score=70.0, beta=2.0)
        assert low_beta.conviction_score > high_beta.conviction_score

    def test_never_touches_price_or_valuation(self):
        """A cheap-but-weak-business input never has a way to raise the
        score — there's no price/valuation parameter at all in the
        function signature, only quality/moat/stability/beta."""
        import inspect
        params = set(inspect.signature(compute_conviction_score).parameters)
        assert not (params & {"price", "fair_value", "margin_of_safety_pct", "pe_ratio"})
