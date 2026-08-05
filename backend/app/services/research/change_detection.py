"""
Change Detection Engine — Fase 3, Incremento 6 (Parte K — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

"No quiero únicamente comparar números. Quiero entender qué cambió
realmente" — this module combines THREE already-real signals, none
recomputed here, into a short list of INTERPRETED events:

1. Real numeric trend DIRECTION — `quality.deterioration_engine.
   compute_deterioration_signals` (Fase 2, Incremento 10), accepted as an
   already-computed parameter (same convention every Fase 3 engine uses
   for Fase 2 inputs it doesn't own).
2. Business Understanding's own `business_change_since_last_review`
   (Incremento 3) — already a real comparison against the prior snapshot.
3. Management Intelligence's own `strategy_change_classification`/
   `_explanation` (Incremento 5) — already a real comparison against the
   prior snapshot.

Business and Management Intelligence were BOTH deliberately designed
(Incrementos 3 and 5) to already detect their own change against history
— Change Detection's job is not to re-derive that, but to combine it with
the numeric direction signal and ask for a causal INTERPRETATION, per
"Juicio nuevo #2": every inference must cite the real fact it depends on,
mitigating the hallucinated-causality risk explicit in the plan.

Persists each detected event to `company_timeline_events`
(`knowledge_store.save_timeline_event`) — this is what feeds the Timeline
Engine (Parte L, read-only, same increment, see `timeline_engine.py`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Optional

from app.services.research.claim_schema import EvidenceTaggedClaim, min_confidence

if TYPE_CHECKING:
    from app.services.quality.deterioration_engine import DeteriorationResult

_NO_REAL_CHANGE_CLASSIFICATIONS = ("no_prior_data", "no_change")


@dataclass
class DetectedChange:
    event_type: str
    headline: str
    claims: list[EvidenceTaggedClaim] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"event_type": self.event_type, "headline": self.headline, "claims": [c.to_dict() for c in self.claims]}


@dataclass
class ChangeDetectionResult:
    ticker: str
    detected_changes: list[DetectedChange] = field(default_factory=list)

    @property
    def has_any_signal(self) -> bool:
        return len(self.detected_changes) > 0


def _format_deterioration_summary(deterioration_result: Optional["DeteriorationResult"]) -> str:
    """Only real MOVEMENT is a change — 'estable'/None factors are
    deliberately excluded, since a metric that isn't moving isn't
    something to interpret."""
    if not deterioration_result:
        return ""
    lines = []
    for f in deterioration_result.factors:
        if f.direction in ("mejorando", "deteriorando"):
            lines.append(f"- {f.name}: {f.reason}")
    return "\n".join(lines)


def _format_management_change_note(management_snapshot_content: Optional[dict]) -> Optional[str]:
    if not management_snapshot_content:
        return None
    classification = management_snapshot_content.get("strategy_change_classification")
    if not classification or classification in _NO_REAL_CHANGE_CLASSIFICATIONS:
        return None
    explanation = management_snapshot_content.get("strategy_change_explanation") or ""
    return f"{classification}: {explanation}".strip()


def _build_detected_changes(
    ai_result: Optional[dict], has_real_deterioration_signal: bool, has_real_business_or_management_signal: bool,
) -> list[DetectedChange]:
    if not ai_result or not ai_result.get("events"):
        return []
    changes: list[DetectedChange] = []
    for event in ai_result["events"]:
        what_changed = event.get("what_changed_fact")
        why = event.get("why_inference")
        event_type = event.get("event_type") or "other"
        headline = event.get("headline")
        if not what_changed or not headline:
            continue
        # A fact restating a real numeric deterioration signal is more
        # directly grounded (a deterministic trend computation) than one
        # restating an upstream AI inference (business/management change
        # notes, themselves already interpretations) — "high" vs "medium".
        fact_confidence = "high" if has_real_deterioration_signal else "medium"
        fact_claim = EvidenceTaggedClaim(
            text=what_changed, kind="fact",
            source="Nuvos: Change Detection Engine, combinando deterioration/business/management",
            confidence=fact_confidence,
        )
        claims = [fact_claim]
        if why:
            claims.append(EvidenceTaggedClaim(
                text=why, kind="inference", source=f"Nuvos: interpretación de '{what_changed}'",
                confidence=min_confidence([fact_claim]),
            ))
        changes.append(DetectedChange(event_type=event_type, headline=headline, claims=claims))
    return changes


async def compute_change_detection(
    ticker: str, company_name: str,
    deterioration_result: Optional["DeteriorationResult"], lang: str = "es",
) -> ChangeDetectionResult:
    """The single entry point. `deterioration_result` is accepted as an
    already-computed input (from `quality.deterioration_engine.
    compute_deterioration_signals`, which itself needs real multi-year
    trends this module doesn't fetch) — same convention every Fase 3
    engine uses for Fase 2 inputs it doesn't own. Reads the Business
    Understanding and Management Intelligence snapshots itself (this
    engine's whole job is combining what's already in the knowledge base,
    not taking more parameters than it needs)."""
    from app.services.research.knowledge_store import get_latest_snapshot
    from app.services import ai_service

    business_snapshot = await get_latest_snapshot(ticker, "business_understanding")
    business_change_note = (
        (business_snapshot.get("content") or {}).get("business_change_since_last_review") if business_snapshot else None
    )

    management_snapshot = await get_latest_snapshot(ticker, "management")
    management_change_note = _format_management_change_note(management_snapshot.get("content") if management_snapshot else None)

    deterioration_summary = _format_deterioration_summary(deterioration_result)

    ai_result = await ai_service.generate_change_interpretation(
        ticker, company_name, deterioration_summary, business_change_note or "", management_change_note or "", lang,
    )

    detected_changes = _build_detected_changes(
        ai_result,
        has_real_deterioration_signal=bool(deterioration_summary),
        has_real_business_or_management_signal=bool(business_change_note or management_change_note),
    )
    return ChangeDetectionResult(ticker=ticker.upper(), detected_changes=detected_changes)


async def compute_and_save_change_detection(
    ticker: str, company_name: str,
    deterioration_result: Optional["DeteriorationResult"], lang: str = "es",
) -> ChangeDetectionResult:
    """Computes and persists every detected change as a
    `company_timeline_events` row. Idempotent per event (see
    `knowledge_store.save_timeline_event`'s headline_hash dedup) — running
    this twice for the same real change never duplicates the timeline
    entry."""
    from app.services.research.knowledge_store import save_timeline_event

    result = await compute_change_detection(ticker, company_name, deterioration_result, lang)
    for change in result.detected_changes:
        fact_claim = next((c for c in change.claims if c.kind == "fact"), None)
        await save_timeline_event(
            ticker, change.event_type, change.headline,
            detail={"claims": [c.to_dict() for c in change.claims]},
            source_claim=fact_claim.to_dict() if fact_claim else None,
        )
    return result
