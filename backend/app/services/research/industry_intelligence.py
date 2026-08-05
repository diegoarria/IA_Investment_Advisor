"""
Industry Intelligence Engine — Fase 3, Incremento 4 (Parte D — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Analyzes the INDUSTRY {company_name} competes in as a whole — market size,
expected growth, trends, disruptive technologies, industry leaders, how
the industry looked 10 years ago / might look in 10 years, structural
risks. Distinct from Competitive Intelligence (Parte C, same increment):
C asks "how does this company stack up against its named peers," D asks
"what does the whole arena look like, independent of any one company."

Reuses, never recomputes:
- `industry_engine.classify_industry` (Fase 2, Incremento 1) — the
  deterministic industry category.
- `industry_engine.compute_industry_benchmarks` (Fase 2, Incremento 1) —
  real median ROIC/margins/growth across the company's real peers, used
  to ground "expected growth" in an actual number instead of an AI guess.
- `evidence_sources.gather_evidence_bundle` (Fase 2, Incremento 6) for
  everything a financial-statement peer comparison can't answer (market
  size, disruptive tech, 10-year outlook, structural risk).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.services.research.claim_schema import EvidenceTaggedClaim

_AI_FIELDS = (
    "market_size_and_growth", "trends", "disruptive_technologies", "industry_leaders",
    "industry_10_years_ago", "industry_in_10_years", "structural_risks",
)


@dataclass
class IndustryIntelligenceResult:
    ticker: str
    category: Optional[str]
    industry_benchmarks: Optional[dict]  # from industry_engine.compute_industry_benchmarks, real
    market_size_and_growth: Optional[str] = None
    trends: Optional[str] = None
    disruptive_technologies: Optional[str] = None
    industry_leaders: Optional[str] = None
    industry_10_years_ago: Optional[str] = None
    industry_in_10_years: Optional[str] = None
    structural_risks: Optional[str] = None
    claims: list[EvidenceTaggedClaim] = field(default_factory=list)

    @property
    def has_any_signal(self) -> bool:
        return self.market_size_and_growth is not None

    def to_snapshot_content(self) -> dict:
        return {
            "category": self.category, "industry_benchmarks": self.industry_benchmarks,
            **{k: getattr(self, k) for k in _AI_FIELDS},
            "claims": [c.to_dict() for c in self.claims],
        }


def _format_benchmarks_summary(benchmarks: Optional[dict]) -> str:
    if not benchmarks or benchmarks.get("median_roic_pct") is None and benchmarks.get("median_revenue_cagr_pct") is None:
        return ""
    return (
        f"Categoría: {benchmarks.get('category')}. Mediana real entre {benchmarks.get('peer_count', 0)} peers reales — "
        f"ROIC: {benchmarks.get('median_roic_pct')}%, margen operativo: {benchmarks.get('median_operating_margin_pct')}%, "
        f"margen FCF: {benchmarks.get('median_fcf_margin_pct')}%, CAGR de ingresos: {benchmarks.get('median_revenue_cagr_pct')}%."
    )


def _build_claims(category: Optional[str], benchmarks: Optional[dict], ai_result: Optional[dict], has_real_evidence: bool) -> list[EvidenceTaggedClaim]:
    claims: list[EvidenceTaggedClaim] = []
    if category:
        claims.append(EvidenceTaggedClaim(
            text=f"Industria clasificada como '{category}' (clasificación determinística, Fase 2).",
            kind="fact", source="Nuvos: Industry Engine (Fase 2)", confidence="high",
        ))
    if benchmarks and benchmarks.get("median_revenue_cagr_pct") is not None:
        claims.append(EvidenceTaggedClaim(
            text=f"Crecimiento mediano real de ingresos entre {benchmarks.get('peer_count', 0)} peers reales: {benchmarks['median_revenue_cagr_pct']}%.",
            kind="fact", source="Nuvos: Industry Engine, benchmarks en vivo (Fase 2)", confidence="high",
        ))
    if ai_result:
        confidence = "medium" if has_real_evidence else "low"
        source = (
            "Nuvos: inferido de evidencia pública real + benchmarks reales de industria" if has_real_evidence
            else "Nuvos: inferido únicamente de benchmarks de industria (sin evidencia web adicional)"
        )
        for key in _AI_FIELDS:
            text = ai_result.get(key)
            if text:
                claims.append(EvidenceTaggedClaim(text=text, kind="inference", source=source, confidence=confidence))
    return claims


async def compute_industry_intelligence(
    ticker: str, company_name: str, sector: Optional[str], industry: Optional[str],
    lang: str = "es", analysis_cache: Optional[dict] = None,
) -> IndustryIntelligenceResult:
    """The single entry point. `analysis_cache`, when shared with a caller
    that also calls `industry_engine.compute_industry_benchmarks` or
    `competitive_intelligence.compute_competitive_intelligence` in the
    same request, avoids re-fetching a peer's full analysis twice."""
    import asyncio
    from app.services.quality.industry_engine import classify_industry, compute_industry_benchmarks
    from app.services.quality.evidence_sources import gather_evidence_bundle, format_evidence_bundle_for_prompt
    from app.services import ai_service

    category = classify_industry(sector, industry)

    benchmarks_result, bundle = await asyncio.gather(
        asyncio.to_thread(compute_industry_benchmarks, ticker, sector, industry, analysis_cache),
        asyncio.to_thread(
            gather_evidence_bundle, ticker, company_name,
            "tamaño de mercado, crecimiento esperado, tendencias estructurales, tecnologías disruptivas de la industria",
            lang,
        ),
        return_exceptions=True,
    )
    benchmarks_dict: Optional[dict] = None
    if not isinstance(benchmarks_result, Exception) and benchmarks_result is not None:
        benchmarks_dict = {
            "category": benchmarks_result.category, "peer_count": benchmarks_result.peer_count,
            "median_roic_pct": benchmarks_result.median_roic_pct,
            "median_operating_margin_pct": benchmarks_result.median_operating_margin_pct,
            "median_fcf_margin_pct": benchmarks_result.median_fcf_margin_pct,
            "median_revenue_cagr_pct": benchmarks_result.median_revenue_cagr_pct,
        }

    has_real_evidence = not isinstance(bundle, Exception) and bundle is not None and bundle.has_any_real_evidence
    evidence_block = format_evidence_bundle_for_prompt(bundle) if not isinstance(bundle, Exception) and bundle else ""

    ai_result = await ai_service.generate_industry_intelligence(
        ticker, company_name, category, _format_benchmarks_summary(benchmarks_dict), evidence_block, lang,
    )

    claims = _build_claims(category, benchmarks_dict, ai_result, has_real_evidence)
    return IndustryIntelligenceResult(
        ticker=ticker.upper(), category=category, industry_benchmarks=benchmarks_dict,
        **{k: (ai_result or {}).get(k) for k in _AI_FIELDS},
        claims=claims,
    )


async def compute_and_save_industry_intelligence(
    ticker: str, company_name: str, sector: Optional[str], industry: Optional[str],
    lang: str = "es", analysis_cache: Optional[dict] = None,
) -> IndustryIntelligenceResult:
    from app.services.research.knowledge_store import save_snapshot

    result = await compute_industry_intelligence(ticker, company_name, sector, industry, lang, analysis_cache)
    await save_snapshot(ticker, "industry", result.to_snapshot_content(), source_period=None)
    return result
