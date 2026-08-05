"""
Catalysts Engine — Fase 2, Incremento 9 (Parte G — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Purely qualitative by nature (no deterministic formula can predict "will
this specific product launch move the business" from financial statements
alone) — same AI-narrated, evidence-grounded pattern as the Moat/
Management deep dives (Incrementos 7-8), never a black box:

1. Real, structured grounding: the company's own REAL revenue-segment
   breakdown (`fundamental_analysis_service`'s `segments` — sourced from
   `financial_data_service.get_revenue_segments`, i.e. the company's own
   filings, not a guess) — the model is told exactly which segments are
   big/small TODAY, so a claimed catalyst about a segment that's actually
   immaterial to revenue is easy for a reader to sanity-check against real
   numbers shown alongside it.

2. Real evidence: `evidence_sources.gather_evidence_bundle` (Incremento
   6 — real 10-K text + real cited web search + real scraped excerpts),
   topic-scoped to near-term catalysts rather than moat/governance.

Returns None when there's neither real segment data NOR real web evidence
to ground catalysts in — never lets the model invent catalysts from
nothing.
"""

from __future__ import annotations

from typing import Optional


def _format_segments_summary(segments: list[dict]) -> str:
    """Thin alias — the real implementation is `fundamental_analysis_
    service.format_segments_summary` (promoted there in Fase 3, Incremento
    3 so `research.business_understanding` reuses it too). Kept here under
    the original name for backward compatibility with existing imports/tests."""
    from app.services.fundamental_analysis_service import format_segments_summary
    return format_segments_summary(segments)


async def compute_catalysts(
    ticker: str, company_name: str, segments: list[dict], lang: str = "es",
) -> Optional[dict]:
    """The single entry point. Composes:
    1. Real segment data (already computed, passed in as a parameter).
    2. Real evidence gathering (`evidence_sources.gather_evidence_bundle`
       — Incremento 6), topic scoped to near-term catalysts, run in a
       thread since it's synchronous I/O.
    3. The AI narration grounded in both (`ai_service.generate_catalysts`).

    Returns None if there's neither real segment data nor real evidence to
    ground the analysis in, OR if the AI call itself fails/doesn't parse —
    same degrade-gracefully philosophy as `moat_engine.compute_moat_deep_dive`
    and `management_engine.compute_management_deep_dive`."""
    import asyncio
    from app.services.quality.evidence_sources import gather_evidence_bundle, format_evidence_bundle_for_prompt
    from app.services import ai_service

    bundle = await asyncio.to_thread(
        gather_evidence_bundle, ticker, company_name,
        "catalizadores de crecimiento a corto y mediano plazo: nuevos productos, expansión geográfica, lanzamientos próximos, cambios regulatorios relevantes",
        lang,
    )
    segments_summary = _format_segments_summary(segments)
    if not bundle.has_any_real_evidence and not segments_summary:
        return None

    evidence_block = format_evidence_bundle_for_prompt(bundle)
    return await ai_service.generate_catalysts(ticker, company_name, segments_summary, evidence_block, lang)
