"""
Tests — app.services.quality.peer_comparison_engine (Fase 2, Incremento 10).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from unittest.mock import patch

from app.services.quality.peer_comparison_engine import compute_quality_peer_comparison


def _fake_peer_data(quality_score: float, roic: float = 15.0, om: float = 20.0, growth: float = 8.0):
    """A minimal fake `get_fundamental_analysis` return dict — only the
    fields `compute_quality_peer_comparison` and
    `build_quality_score_from_analysis` actually read."""
    return {
        "dcf": {"growth_buildup": {"avg_roic_pct": roic}},
        "operating_margin_trend": [om],
        "revenue_cagr_pct": growth,
        "_fake_quality_score": quality_score,
    }


class TestComputeQualityPeerComparison:
    def _run(self, company_score, peer_scores, peers=None):
        peers = peers or [f"PEER{i}" for i in range(len(peer_scores))]
        peer_data_by_ticker = {t: _fake_peer_data(s) for t, s in zip(peers, peer_scores)}

        def fake_build_quality_score(data):
            from types import SimpleNamespace
            score = data.get("_fake_quality_score")
            return SimpleNamespace(quality_score=score, has_any_signal=score is not None)

        with patch("app.services.relative_valuation_service._find_peers", return_value=peers), \
             patch("app.services.fundamental_analysis_service.get_fundamental_analysis", side_effect=lambda t: peer_data_by_ticker.get(t)), \
             patch("app.services.quality.quality_engine.build_quality_score_from_analysis", side_effect=fake_build_quality_score):
            return compute_quality_peer_comparison("ME", "Technology", "Software", company_score)

    def test_too_few_peers_returns_none(self):
        with patch("app.services.relative_valuation_service._find_peers", return_value=["A", "B"]):
            result = compute_quality_peer_comparison("ME", "Technology", "Software", 70.0)
        assert result is None

    def test_percentile_and_rank_computed_against_real_peer_scores(self):
        # Company scores 70; peers score 20, 40, 60, 80, 90 -> company beats 3 of 5 (ties count as beaten).
        result = self._run(70.0, [20.0, 40.0, 60.0, 80.0, 90.0])
        assert result is not None
        assert result.peer_count == 5
        assert result.quality_score_percentile == 60.0  # 3 of 5 peers <= 70
        assert result.quality_score_rank == 3  # 2 peers (80, 90) beat the company -> rank 3

    def test_best_in_group_gets_rank_1(self):
        result = self._run(95.0, [20.0, 40.0, 60.0, 80.0, 90.0])
        assert result.quality_score_rank == 1
        assert result.quality_score_percentile == 100.0

    def test_missing_company_score_produces_no_rank(self):
        result = self._run(None, [20.0, 40.0, 60.0, 80.0, 90.0])
        assert result is not None
        assert result.has_any_signal is False
        assert result.quality_score_rank is None

    def test_analysis_cache_is_reused_not_refetched(self):
        peers = ["PEER0", "PEER1", "PEER2", "PEER3", "PEER4"]
        cache = {t: _fake_peer_data(50.0) for t in peers}

        def fake_build_quality_score(data):
            from types import SimpleNamespace
            return SimpleNamespace(quality_score=50.0, has_any_signal=True)

        with patch("app.services.relative_valuation_service._find_peers", return_value=peers), \
             patch("app.services.fundamental_analysis_service.get_fundamental_analysis") as mock_fetch, \
             patch("app.services.quality.quality_engine.build_quality_score_from_analysis", side_effect=fake_build_quality_score):
            result = compute_quality_peer_comparison("ME", "Technology", "Software", 70.0, analysis_cache=cache)
        assert result is not None
        mock_fetch.assert_not_called()  # every peer was already in the shared cache
