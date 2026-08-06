"""
Peer Comparison Engine — Fase 2, Incremento 10 (Parte J — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

100% real, zero AI. Reuses `relative_valuation_service._find_peers`
VERBATIM (the exact same peer-finding logic already proven for valuation
multiples, and already reused a second time by `industry_engine.
compute_industry_benchmarks` for its live benchmarks) — no third
peer-matching implementation. The difference from `industry_engine` is
what gets compared: instead of a single median benchmark number, this
engine computes each real peer's own Quality Score (via
`quality_engine.build_quality_score_from_analysis`, same function the
company's own score already came from) and ranks the company against that
real distribution — "how good is this business RELATIVE TO its real
competitors, not just relative to a single midpoint number."

`analysis_cache`, when shared with a caller that also calls
`compute_industry_benchmarks` in the same request (both accept the same
parameter, same convention), means a peer's full analysis is fetched at
most once per request even though both engines look at the same peer
group.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Optional

_MIN_PEERS_FOR_COMPARISON = 5  # same floor industry_engine/relative_valuation_service use


@dataclass
class PeerQualitySnapshot:
    ticker: str
    quality_score: Optional[float]
    roic_pct: Optional[float]
    operating_margin_pct: Optional[float]
    revenue_cagr_pct: Optional[float]


@dataclass
class PeerComparisonResult:
    peer_count: int
    peers_used: list[str]
    company_quality_score: Optional[float]
    quality_score_percentile: Optional[float]  # 0-100: % of real peers the company's Quality Score outranks or ties
    quality_score_rank: Optional[int]  # 1 = best in the real peer group (company included)
    peer_quality_scores: list[PeerQualitySnapshot] = field(default_factory=list)

    @property
    def has_any_signal(self) -> bool:
        return self.quality_score_percentile is not None


def compute_quality_peer_comparison(
    ticker: str, sector: Optional[str], industry: Optional[str],
    company_quality_score: Optional[float],
    analysis_cache: Optional[dict[str, Optional[dict]]] = None,
) -> Optional[PeerComparisonResult]:
    """Returns None (never a fabricated ranking) if the curated universe
    doesn't have `_MIN_PEERS_FOR_COMPARISON` real peers with computable
    Quality Scores in the same sector/industry — same None-safety
    convention as `compute_industry_benchmarks`/`compute_relative_valuation`."""
    from app.services.relative_valuation_service import _find_peers
    from app.services.fundamental_analysis_service import get_fundamental_analysis
    from app.services.quality.quality_engine import build_quality_score_from_analysis

    peers = _find_peers(ticker, sector, industry)
    if len(peers) < _MIN_PEERS_FOR_COMPARISON:
        return None

    snapshots: list[PeerQualitySnapshot] = []
    real_peers: list[str] = []
    for peer_ticker in peers:
        if analysis_cache is not None and peer_ticker in analysis_cache:
            peer_data = analysis_cache[peer_ticker]
        else:
            try:
                # _compute_consensus=False — this only needs the peer's
                # quality score (build_quality_score_from_analysis below),
                # never its Consensus fair value; skipping it avoids the
                # peer's own peer-fetching cascade for a result that would
                # just be discarded. See get_fundamental_analysis's docstring.
                peer_data = get_fundamental_analysis(peer_ticker, _compute_consensus=False)
            except Exception:
                continue
            if analysis_cache is not None:
                analysis_cache[peer_ticker] = peer_data
        if not peer_data:
            continue
        real_peers.append(peer_ticker)

        peer_quality = build_quality_score_from_analysis(peer_data)
        dcf = peer_data.get("dcf") or {}
        growth_buildup = dcf.get("growth_buildup") or {}
        om_trend = peer_data.get("operating_margin_trend") or []
        latest_om = next((v for v in reversed(om_trend) if v is not None), None)
        snapshots.append(PeerQualitySnapshot(
            ticker=peer_ticker,
            quality_score=peer_quality.quality_score if peer_quality.has_any_signal else None,
            roic_pct=growth_buildup.get("avg_roic_pct"),
            operating_margin_pct=latest_om,
            revenue_cagr_pct=peer_data.get("revenue_cagr_pct"),
        ))

    if len(real_peers) < _MIN_PEERS_FOR_COMPARISON:
        return None

    peer_scores = [s.quality_score for s in snapshots if s.quality_score is not None]
    percentile: Optional[float] = None
    rank: Optional[int] = None
    if company_quality_score is not None and peer_scores:
        outranked_or_tied = sum(1 for s in peer_scores if s <= company_quality_score)
        percentile = round(outranked_or_tied / len(peer_scores) * 100, 1)
        rank = sum(1 for s in peer_scores if s > company_quality_score) + 1

    return PeerComparisonResult(
        peer_count=len(real_peers), peers_used=real_peers,
        company_quality_score=company_quality_score,
        quality_score_percentile=percentile, quality_score_rank=rank,
        peer_quality_scores=snapshots,
    )
