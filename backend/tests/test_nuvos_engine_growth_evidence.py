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


# Mandatory per-share Fair Value Engine (methodology audit round 5, see
# /Users/diegoarria/.claude/plans/cosmic-munching-crown.md) — real revenue
# CAGR compounded with the real historical buyback yield takes priority
# over every other tier, including forward consensus, since it's Diego's
# mandated methodology using the company's own real history.
class TestPerShareCompoundedTier:
    def test_wins_over_every_other_tier_including_forward_consensus(self):
        result = resolve_growth_evidence(
            forward_consensus_pct=12.0, eps_cagr_pct=99.0, normalized_growth_pct=99.0,
            revenue_cagr_pct=19.9, shares_cagr_pct=-2.6,  # META-like: real 19.9% revenue growth, real 2.6%/yr buybacks
        )
        assert result.source == "per_share_compounded"
        # (1.199 * 1.026 - 1) * 100 = 23.02%
        assert result.growth_pct == 23.0

    def test_requires_both_real_inputs_not_just_one(self):
        only_revenue = resolve_growth_evidence(eps_cagr_pct=10.0, revenue_cagr_pct=19.9, shares_cagr_pct=None)
        assert only_revenue.source != "per_share_compounded"
        only_shares = resolve_growth_evidence(eps_cagr_pct=10.0, revenue_cagr_pct=None, shares_cagr_pct=-2.6)
        assert only_shares.source != "per_share_compounded"

    def test_net_share_issuance_reduces_growth_correctly(self):
        # Dilution (positive shares_cagr_pct) should REDUCE the compounded
        # per-share growth below the raw organic figure — never invert
        # the sign or silently ignore it.
        result = resolve_growth_evidence(revenue_cagr_pct=10.0, shares_cagr_pct=3.0)  # 3%/yr net dilution
        assert result.source == "per_share_compounded"
        assert result.growth_pct < 10.0

    def test_reason_shows_both_real_components(self):
        result = resolve_growth_evidence(revenue_cagr_pct=19.9, shares_cagr_pct=-2.6)
        assert "19.9" in result.reason
        assert "2.6" in result.reason
