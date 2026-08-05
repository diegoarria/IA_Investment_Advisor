"""
Competitive Intelligence Engine — Fase 3, Incremento 4 (Parte C — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Two layers, same split as every Fase 2 deep-dive engine:

1. Real, deterministic peer comparison — reuses
   `quality.peer_comparison_engine.compute_quality_peer_comparison`
   VERBATIM (Fase 2, Incremento 10) rather than recomputing it: the same
   real peer group (`relative_valuation_service._find_peers`), the same
   real per-peer Quality Score/ROIC/margin/growth numbers. This IS the
   "compare the company vs its main competitors automatically" the brief
   asks for — no second implementation.

2. AI-narrated qualitative competitive landscape — direct/indirect
   competitors, substitute products, new entrants, barriers to entry,
   market share, competitive advantages, structural changes — grounded in
   the REAL peer tickers from layer 1 (so "direct competitors" cites real
   company tickers instead of the model inventing names) plus
   `evidence_sources.gather_evidence_bundle` (Fase 2, Incremento 6).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.services.research.claim_schema import EvidenceTaggedClaim

_AI_FIELDS = (
    "direct_competitors", "indirect_competitors", "substitute_products", "new_entrants",
    "barriers_to_entry", "market_share_estimate", "competitive_advantages_vs_peers", "structural_industry_changes",
)


@dataclass
class CompetitiveIntelligenceResult:
    ticker: str
    peer_comparison: Optional[dict]  # PeerComparisonResult, as a dict — real, from Fase 2
    direct_competitors: Optional[str] = None
    indirect_competitors: Optional[str] = None
    substitute_products: Optional[str] = None
    new_entrants: Optional[str] = None
    barriers_to_entry: Optional[str] = None
    market_share_estimate: Optional[str] = None
    competitive_advantages_vs_peers: Optional[str] = None
    structural_industry_changes: Optional[str] = None
    claims: list[EvidenceTaggedClaim] = field(default_factory=list)

    @property
    def has_any_signal(self) -> bool:
        return bool(self.peer_comparison) or self.direct_competitors is not None

    def to_snapshot_content(self) -> dict:
        return {
            "peer_comparison": self.peer_comparison,
            **{k: getattr(self, k) for k in _AI_FIELDS},
            "claims": [c.to_dict() for c in self.claims],
        }


def _format_peer_tickers_summary(peers_used: list[str]) -> str:
    if not peers_used:
        return ""
    return f"Peers reales del universo curado: {', '.join(peers_used)}."


def _format_peer_comparison_summary(peer_comparison: Optional[dict]) -> str:
    if not peer_comparison or peer_comparison.get("quality_score_percentile") is None:
        return ""
    lines = [
        f"Quality Score de {peer_comparison.get('company_quality_score')}/100 — percentil {peer_comparison['quality_score_percentile']} "
        f"(posición #{peer_comparison.get('quality_score_rank')} de {peer_comparison.get('peer_count', 0) + 1}, empresa incluida).",
    ]
    for s in peer_comparison.get("peer_quality_scores") or []:
        lines.append(
            f"- {s.get('ticker')}: Quality Score {s.get('quality_score')}, ROIC {s.get('roic_pct')}%, "
            f"margen operativo {s.get('operating_margin_pct')}%, CAGR ingresos {s.get('revenue_cagr_pct')}%."
        )
    return "\n".join(lines)


def _build_claims(peer_comparison: Optional[dict], ai_result: Optional[dict], has_real_evidence: bool) -> list[EvidenceTaggedClaim]:
    claims: list[EvidenceTaggedClaim] = []
    if peer_comparison and peer_comparison.get("quality_score_percentile") is not None:
        claims.append(EvidenceTaggedClaim(
            text=(
                f"Quality Score real en el percentil {peer_comparison['quality_score_percentile']} de "
                f"{peer_comparison.get('peer_count', 0)} peers reales del mismo sector/industria."
            ),
            kind="fact", source="Nuvos: Peer Comparison Engine (Fase 2)", confidence="high",
        ))
    if ai_result:
        confidence = "medium" if has_real_evidence else "low"
        source = (
            "Nuvos: inferido de peers reales + evidencia pública real" if has_real_evidence
            else "Nuvos: inferido únicamente de la comparación cuantitativa de peers (sin evidencia web adicional)"
        )
        for key in _AI_FIELDS:
            text = ai_result.get(key)
            if text:
                claims.append(EvidenceTaggedClaim(text=text, kind="inference", source=source, confidence=confidence))
    return claims


async def compute_competitive_intelligence(
    ticker: str, company_name: str, sector: Optional[str], industry: Optional[str],
    company_quality_score: Optional[float], lang: str = "es",
    analysis_cache: Optional[dict] = None,
) -> CompetitiveIntelligenceResult:
    """The single entry point. `company_quality_score` is accepted as an
    already-computed input (from `quality_engine.build_quality_score_from_analysis`)
    rather than recomputed here. `analysis_cache`, when shared with a
    caller that also calls `industry_engine.compute_industry_benchmarks`
    or `industry_intelligence.compute_industry_intelligence` in the same
    request, avoids re-fetching a peer's full analysis twice."""
    import asyncio
    from app.services.quality.peer_comparison_engine import compute_quality_peer_comparison
    from app.services.quality.evidence_sources import gather_evidence_bundle, format_evidence_bundle_for_prompt
    from app.services import ai_service

    peer_result, bundle = await asyncio.gather(
        asyncio.to_thread(
            compute_quality_peer_comparison, ticker, sector, industry, company_quality_score, analysis_cache,
        ),
        asyncio.to_thread(
            gather_evidence_bundle, ticker, company_name,
            "competidores directos e indirectos, productos sustitutos, nuevos entrantes, barreras de entrada, cuota de mercado",
            lang,
        ),
        return_exceptions=True,
    )
    peer_comparison_dict: Optional[dict] = None
    if not isinstance(peer_result, Exception) and peer_result is not None:
        peer_comparison_dict = {
            "peer_count": peer_result.peer_count, "peers_used": peer_result.peers_used,
            "company_quality_score": peer_result.company_quality_score,
            "quality_score_percentile": peer_result.quality_score_percentile,
            "quality_score_rank": peer_result.quality_score_rank,
            "peer_quality_scores": [
                {"ticker": s.ticker, "quality_score": s.quality_score, "roic_pct": s.roic_pct,
                 "operating_margin_pct": s.operating_margin_pct, "revenue_cagr_pct": s.revenue_cagr_pct}
                for s in peer_result.peer_quality_scores
            ],
        }

    has_real_evidence = not isinstance(bundle, Exception) and bundle is not None and bundle.has_any_real_evidence
    evidence_block = format_evidence_bundle_for_prompt(bundle) if not isinstance(bundle, Exception) and bundle else ""

    peers_used = peer_comparison_dict.get("peers_used", []) if peer_comparison_dict else []
    ai_result = await ai_service.generate_competitive_intelligence(
        ticker, company_name,
        _format_peer_tickers_summary(peers_used), _format_peer_comparison_summary(peer_comparison_dict),
        evidence_block, lang,
    )

    claims = _build_claims(peer_comparison_dict, ai_result, has_real_evidence)
    return CompetitiveIntelligenceResult(
        ticker=ticker.upper(), peer_comparison=peer_comparison_dict,
        **{k: (ai_result or {}).get(k) for k in _AI_FIELDS},
        claims=claims,
    )


async def compute_and_save_competitive_intelligence(
    ticker: str, company_name: str, sector: Optional[str], industry: Optional[str],
    company_quality_score: Optional[float], lang: str = "es",
    analysis_cache: Optional[dict] = None,
) -> CompetitiveIntelligenceResult:
    from app.services.research.knowledge_store import save_snapshot

    result = await compute_competitive_intelligence(
        ticker, company_name, sector, industry, company_quality_score, lang, analysis_cache,
    )
    await save_snapshot(ticker, "competitive", result.to_snapshot_content(), source_period=None)
    return result
