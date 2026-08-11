"""
Tests — app.services.valuation.nuvos_engine.growth_evidence.

See /Users/diegoarria/.claude/plans/cosmic-munching-crown.md, Priority 1
(methodology audit): the growth adjustment must never be silently zero
just because forward analyst consensus wasn't available.
"""
from app.services.valuation.nuvos_engine.growth_evidence import resolve_growth_evidence


class TestHierarchy:
    def test_forward_consensus_wins_when_present(self):
        result = resolve_growth_evidence(forward_consensus_pct=12.0, eps_cagr_pct=99.0, revenue_cagr_pct=99.0, normalized_growth_pct=99.0)
        assert result.source == "forward_consensus"
        assert result.growth_pct == 12.0

    def test_falls_back_to_historical_eps_cagr(self):
        result = resolve_growth_evidence(forward_consensus_pct=None, eps_cagr_pct=25.0, revenue_cagr_pct=10.0, normalized_growth_pct=5.0)
        assert result.source == "historical_eps_cagr"
        assert result.growth_pct == 25.0

    def test_falls_back_to_historical_revenue_cagr(self):
        result = resolve_growth_evidence(forward_consensus_pct=None, eps_cagr_pct=None, revenue_cagr_pct=10.0, normalized_growth_pct=5.0)
        assert result.source == "historical_revenue_cagr"
        assert result.growth_pct == 10.0

    def test_falls_back_to_normalized_growth(self):
        result = resolve_growth_evidence(forward_consensus_pct=None, eps_cagr_pct=None, revenue_cagr_pct=None, normalized_growth_pct=5.0)
        assert result.source == "normalized_growth"
        assert result.growth_pct == 5.0

    def test_insufficient_when_nothing_is_available(self):
        result = resolve_growth_evidence(forward_consensus_pct=None, eps_cagr_pct=None, revenue_cagr_pct=None, normalized_growth_pct=None)
        assert result.source == "insufficient"
        assert result.growth_pct is None

    def test_never_fabricates_a_rate_when_insufficient(self):
        result = resolve_growth_evidence()
        assert result.growth_pct is None
        assert "no se fabrica" in result.reason.lower()


class TestReasonTraceability:
    def test_reason_names_the_actual_source_used(self):
        result = resolve_growth_evidence(eps_cagr_pct=42.0)
        assert "42.0%" in result.reason
        assert "histórico" in result.reason.lower()
