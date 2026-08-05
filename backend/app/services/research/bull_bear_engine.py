"""
Bull vs Bear Engine — Fase 3, Incremento 7 (Parte G — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Two INDEPENDENT, SOLID cases (never a superficial summary, per the brief)
built from the SAME real evidence pool `thesis_engine.
format_real_inputs_summary` already assembles (Quality/Moat/Conviction/
valuation + Business/Competitive/Industry/Management snapshots + real
timeline), extended here with two more already-real Fase 2 sources that
map naturally onto each side:

- Bull side: `quality.catalysts_engine.compute_catalysts` (Fase 2,
  Incremento 9) — real, evidence-grounded near-term catalysts.
- Bear side: `quality.deterioration_engine.compute_deterioration_signals`
  (Fase 2, Incremento 10) — real trend-direction deterioration signals.

Both are accepted as already-computed parameters (same convention as
every other Fase 3 engine) — this module never recomputes either.

`BullBearResult.bull_case`/`bear_case` are STRUCTURED lists of
`EvidenceTaggedClaim`, never a single prose paragraph — "Juicio nuevo #4"
from the plan: a future Debate Engine (explicitly out of scope this
phase) can iterate `bull_case[i]` vs `bear_case[j]` as turns without this
module's shape needing to change.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Optional

from app.services.research.claim_schema import EvidenceTaggedClaim

if TYPE_CHECKING:
    from app.services.quality.deterioration_engine import DeteriorationResult


@dataclass
class BullBearResult:
    ticker: str
    bull_case: list[EvidenceTaggedClaim] = field(default_factory=list)
    bear_case: list[EvidenceTaggedClaim] = field(default_factory=list)

    @property
    def has_any_signal(self) -> bool:
        return bool(self.bull_case or self.bear_case)

    def to_dict(self) -> dict:
        return {"bull_case": [c.to_dict() for c in self.bull_case], "bear_case": [c.to_dict() for c in self.bear_case]}


def _format_catalysts_summary(catalysts: Optional[dict]) -> str:
    items = (catalysts or {}).get("catalysts") or []
    if not items:
        return ""
    lines = ["Catalizadores reales identificados (evidencia real, Fase 2):"]
    for c in items:
        lines.append(f"- {c.get('catalyst')} ({c.get('time_horizon')}): {c.get('evidence')}")
    return "\n".join(lines)


def _format_deterioration_summary(deterioration_result: Optional["DeteriorationResult"]) -> str:
    if not deterioration_result:
        return ""
    lines = []
    for f in deterioration_result.factors:
        if f.direction in ("mejorando", "deteriorando"):
            lines.append(f"- {f.name}: {f.reason}")
    if not lines:
        return ""
    return "Señales reales de dirección de tendencia (Fase 2):\n" + "\n".join(lines)


def _claims_from_points(points: list[dict], confidence: str, source: str) -> list[EvidenceTaggedClaim]:
    claims = []
    for p in points:
        text = p.get("text")
        if not text:
            continue
        category = p.get("category")
        claim_source = f"{source} — categoría: {category}" if category else source
        claims.append(EvidenceTaggedClaim(text=text, kind="inference", source=claim_source, confidence=confidence))
    return claims


async def compute_bull_bear(
    ticker: str, company_name: str,
    quality_score: Optional[float], moat_score: Optional[float], conviction_score: Optional[float],
    margin_of_safety_pct: Optional[float], fair_value_range: Optional[dict],
    catalysts: Optional[dict], deterioration_result: Optional["DeteriorationResult"],
    lang: str = "es",
) -> BullBearResult:
    """The single entry point. All quantitative/Fase-2 inputs are accepted
    as already-computed parameters; the Business/Competitive/Industry/
    Management snapshots and real timeline are read from the knowledge
    store directly, reusing `thesis_engine.format_real_inputs_summary` so
    both engines see an identical view of "what do we really know" —
    never two slightly-diverging formatters of the same real data."""
    from app.services.research.knowledge_store import get_latest_snapshot
    from app.services.research.timeline_engine import get_company_timeline, format_timeline_for_prompt
    from app.services.research.thesis_engine import format_real_inputs_summary
    from app.services import ai_service

    business = await get_latest_snapshot(ticker, "business_understanding")
    competitive = await get_latest_snapshot(ticker, "competitive")
    industry = await get_latest_snapshot(ticker, "industry")
    management = await get_latest_snapshot(ticker, "management")
    timeline = await get_company_timeline(ticker, limit=10)

    base_summary = format_real_inputs_summary(
        quality_score, moat_score, conviction_score, margin_of_safety_pct, fair_value_range,
        business.get("content") if business else None, competitive.get("content") if competitive else None,
        industry.get("content") if industry else None, management.get("content") if management else None,
        format_timeline_for_prompt(timeline),
    )
    parts = [base_summary, _format_catalysts_summary(catalysts), _format_deterioration_summary(deterioration_result)]
    real_inputs_summary = "\n\n".join(p for p in parts if p)

    ai_result = await ai_service.generate_bull_bear_case(ticker, company_name, real_inputs_summary, lang)
    if not ai_result:
        return BullBearResult(ticker=ticker.upper())

    source = "Nuvos: Bull vs Bear Engine, síntesis de la misma evidencia real para ambos lados"
    return BullBearResult(
        ticker=ticker.upper(),
        bull_case=_claims_from_points(ai_result.get("bull_points", []), "medium", source),
        bear_case=_claims_from_points(ai_result.get("bear_points", []), "medium", source),
    )
