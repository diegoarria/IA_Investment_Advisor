"""
Management Intelligence Engine — Fase 3, Incremento 5 (Parte E — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Extracts strategic priorities, capital allocation commentary, guidance
track record, and consistency from real evidence
(`evidence_sources.gather_evidence_bundle`, Fase 2, Incremento 6) — the
same evidence layer `quality.management_engine.compute_management_deep_dive`
already uses for its one-shot guidance/governance read. This module's job
is the dimension Fase 2 never needed: TIME. It reads the PRIOR
`management` knowledge snapshot (`knowledge_store.get_latest_snapshot`)
and asks the model to compare the new evidence against it, classifying any
real change (`no_change`/`tone_shift`/`priority_reorder`/`strategy_change`)
— this is "Juicio nuevo #1" from the Fase 3 plan: detecting a strategy
change is structurally impossible as a single-turn call, it requires an
anchor from the knowledge base.

`strategy_change_classification` is defensively forced to `"no_prior_data"`
in code (not just via the prompt) whenever there IS no prior snapshot —
never letting a model mistake report "no_change" when no real comparison
was actually possible, which would misrepresent "nothing to compare
against" as "we compared and nothing changed."
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.services.research.claim_schema import EvidenceTaggedClaim

_AI_TEXT_FIELDS = ("strategic_priorities", "capital_allocation_notes", "guidance_track_record_note", "consistency_assessment")
_NO_PRIOR_DATA = "no_prior_data"


@dataclass
class ManagementIntelligenceResult:
    ticker: str
    strategic_priorities: Optional[str] = None
    capital_allocation_notes: Optional[str] = None
    guidance_track_record_note: Optional[str] = None
    consistency_assessment: Optional[str] = None
    strategy_change_classification: Optional[str] = None
    strategy_change_explanation: Optional[str] = None
    claims: list[EvidenceTaggedClaim] = field(default_factory=list)

    @property
    def has_any_signal(self) -> bool:
        return self.strategic_priorities is not None

    def to_snapshot_content(self) -> dict:
        return {
            **{k: getattr(self, k) for k in _AI_TEXT_FIELDS},
            "strategy_change_classification": self.strategy_change_classification,
            "strategy_change_explanation": self.strategy_change_explanation,
            "claims": [c.to_dict() for c in self.claims],
        }


def _build_claims(ai_result: dict, has_real_evidence: bool) -> list[EvidenceTaggedClaim]:
    confidence = "medium" if has_real_evidence else "low"
    source = (
        "Nuvos: inferido de evidencia pública real sobre el management" if has_real_evidence
        else "Nuvos: inferido sin evidencia pública adicional — conclusión débil"
    )
    claims: list[EvidenceTaggedClaim] = []
    for key in _AI_TEXT_FIELDS:
        text = ai_result.get(key)
        if text:
            claims.append(EvidenceTaggedClaim(text=text, kind="inference", source=source, confidence=confidence))

    classification = ai_result.get("strategy_change_classification")
    if classification and classification != _NO_PRIOR_DATA:
        # A change classification is explicitly a qualitative READ (does
        # this discourse shift represent a real strategy change), not a
        # simple combination of facts — "ai_opinion", per claim_schema.py's
        # three-way kind distinction, never "inference".
        explanation = ai_result.get("strategy_change_explanation") or f"Clasificado como '{classification}'."
        claims.append(EvidenceTaggedClaim(
            text=explanation, kind="ai_opinion",
            source="Nuvos: comparación real contra la revisión anterior de Management Intelligence",
            confidence=confidence,
        ))
    return claims


async def compute_management_intelligence(
    ticker: str, company_name: str, lang: str = "es",
) -> ManagementIntelligenceResult:
    """The single entry point. Reads its own prior snapshot from the
    knowledge store (this engine's whole point is comparing against its
    own history) rather than taking it as a parameter."""
    from app.services.quality.evidence_sources import gather_evidence_bundle, format_evidence_bundle_for_prompt
    from app.services.research.knowledge_store import get_latest_snapshot
    from app.services import ai_service
    import asyncio

    prior = await get_latest_snapshot(ticker, "management")
    prior_summary = (prior.get("content") or {}).get("strategic_priorities") if prior else None

    bundle = await asyncio.to_thread(
        gather_evidence_bundle, ticker, company_name,
        "prioridades estratégicas, cumplimiento de guidance, asignación de capital, cambios de tono del "
        "management, cartas a accionistas, earnings calls, investor day, entrevistas",
        lang,
    )
    has_real_evidence = bundle.has_any_real_evidence
    evidence_block = format_evidence_bundle_for_prompt(bundle)

    ai_result = await ai_service.generate_management_intelligence(ticker, company_name, evidence_block, prior_summary, lang)
    if not ai_result:
        return ManagementIntelligenceResult(ticker=ticker.upper())

    # Defensive invariant enforcement (see module docstring): never trust
    # the model alone to get "no prior data" right.
    classification = ai_result.get("strategy_change_classification")
    explanation = ai_result.get("strategy_change_explanation")
    if prior_summary is None:
        classification = _NO_PRIOR_DATA
        explanation = None
    ai_result = {**ai_result, "strategy_change_classification": classification, "strategy_change_explanation": explanation}

    claims = _build_claims(ai_result, has_real_evidence)
    return ManagementIntelligenceResult(
        ticker=ticker.upper(),
        strategic_priorities=ai_result.get("strategic_priorities"),
        capital_allocation_notes=ai_result.get("capital_allocation_notes"),
        guidance_track_record_note=ai_result.get("guidance_track_record_note"),
        consistency_assessment=ai_result.get("consistency_assessment"),
        strategy_change_classification=classification,
        strategy_change_explanation=explanation,
        claims=claims,
    )


async def compute_and_save_management_intelligence(
    ticker: str, company_name: str, lang: str = "es",
) -> ManagementIntelligenceResult:
    from app.services.research.knowledge_store import save_snapshot

    result = await compute_management_intelligence(ticker, company_name, lang)
    await save_snapshot(ticker, "management", result.to_snapshot_content(), source_period=None)
    return result
