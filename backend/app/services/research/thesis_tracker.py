"""
Thesis Tracker — Fase 3, Incremento 8 (Parte H — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

"Guardar todas las tesis históricas... explicar claramente por qué la
tesis cambió." Depends on the Thesis Engine (Parte F, Incremento 7) for a
prior thesis to review, and on Change Detection (Parte K, Incremento 6)
for the real events that justify a change — via `timeline_engine.
get_company_timeline`, itself populated by Change Detection. Nothing here
is recomputed: this module's job is comparing what already exists, never
re-deriving scores or re-gathering evidence.

Two real outputs per review:
1. A NEW `user_investment_theses` version — via `thesis_engine.
   create_thesis_version`, the ONE place "insert new, never update
   content, only flip is_current" is implemented (Incremento 7). Thesis
   Tracker never touches thesis content storage directly.
2. `research_hypothesis_outcomes` rows (migration 063, Benchmark Engine's
   schema, populated starting THIS increment) — every prior critical
   variable/risk gets a real outcome (confirmed/refuted) now that there's
   real evidence to judge it by, and every new critical variable/risk in
   the updated thesis gets a fresh `outcome=NULL` row, pending the NEXT
   review.

If there's no prior thesis for (user_id, ticker), there is nothing to
track yet — `compute_thesis_review` returns a no-signal result rather than
fabricating a "first ever" review.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from app.services.research.claim_schema import EvidenceTaggedClaim

_REVIEW_LIST_FIELDS = ("confirmed_variables", "broken_variables", "still_valid_risks", "invalidated_risks", "new_risks")
_UPDATED_LIST_FIELDS = ("updated_strengths", "updated_critical_variables", "updated_key_risks", "updated_invalidation_events")


@dataclass
class ThesisReviewResult:
    ticker: str
    user_id: str
    what_changed: Optional[str] = None
    thesis_change_explanation: Optional[str] = None
    confirmed_variables: list[EvidenceTaggedClaim] = field(default_factory=list)
    broken_variables: list[EvidenceTaggedClaim] = field(default_factory=list)
    still_valid_risks: list[EvidenceTaggedClaim] = field(default_factory=list)
    invalidated_risks: list[EvidenceTaggedClaim] = field(default_factory=list)
    new_risks: list[EvidenceTaggedClaim] = field(default_factory=list)
    updated_thesis_summary: Optional[str] = None
    updated_strengths: list[EvidenceTaggedClaim] = field(default_factory=list)
    updated_critical_variables: list[EvidenceTaggedClaim] = field(default_factory=list)
    updated_key_risks: list[EvidenceTaggedClaim] = field(default_factory=list)
    updated_invalidation_events: list[EvidenceTaggedClaim] = field(default_factory=list)
    new_thesis_version: Optional[dict] = None  # populated after persistence, see compute_and_save_thesis_review

    @property
    def has_any_signal(self) -> bool:
        return self.what_changed is not None


def _claims_from_texts(texts: list[str], confidence: str, source: str) -> list[EvidenceTaggedClaim]:
    return [EvidenceTaggedClaim(text=t, kind="inference", source=source, confidence=confidence) for t in texts if t]


async def compute_thesis_review(
    user_id: str, ticker: str, company_name: str, lang: str = "es",
) -> ThesisReviewResult:
    """The single entry point. Reads the user's prior thesis and the
    company's real timeline itself (this engine's whole job is comparing
    what's already stored) — returns a no-signal result if there is no
    prior thesis for this (user_id, ticker), never a fabricated first
    review."""
    from app.services.research.thesis_engine import get_user_current_thesis
    from app.services.research.timeline_engine import get_company_timeline, format_timeline_for_prompt
    from app.services import ai_service

    prior = await get_user_current_thesis(user_id, ticker)
    if not prior:
        return ThesisReviewResult(ticker=ticker.upper(), user_id=user_id)

    all_events = await get_company_timeline(ticker, limit=50)
    prior_created_at = prior.get("created_at")
    recent_events = (
        [e for e in all_events if e.get("created_at") and prior_created_at and e["created_at"] > prior_created_at]
        if prior_created_at else all_events
    )
    timeline_summary = format_timeline_for_prompt(recent_events)

    prior_critical_variables = "\n".join(f"- {v}" for v in _texts_from_jsonb(prior.get("critical_variables")))
    prior_key_risks = "\n".join(f"- {v}" for v in _texts_from_jsonb(prior.get("key_risks")))
    prior_invalidation_events = "\n".join(f"- {v}" for v in _texts_from_jsonb(prior.get("invalidation_events")))

    ai_result = await ai_service.generate_thesis_review(
        ticker, company_name, prior.get("thesis_summary", ""),
        prior_critical_variables, prior_key_risks, prior_invalidation_events, timeline_summary, lang,
    )
    if not ai_result:
        return ThesisReviewResult(ticker=ticker.upper(), user_id=user_id)

    confidence = "medium" if recent_events else "low"
    review_source = "Nuvos: Thesis Tracker, comparación real contra la tesis anterior"
    update_source = "Nuvos: Thesis Tracker, tesis actualizada tras revisión real"
    return ThesisReviewResult(
        ticker=ticker.upper(), user_id=user_id,
        what_changed=ai_result.get("what_changed"), thesis_change_explanation=ai_result.get("thesis_change_explanation"),
        updated_thesis_summary=ai_result.get("updated_thesis_summary"),
        **{f: _claims_from_texts(ai_result.get(f, []), confidence, review_source) for f in _REVIEW_LIST_FIELDS},
        **{f: _claims_from_texts(ai_result.get(f, []), confidence, update_source) for f in _UPDATED_LIST_FIELDS},
    )


def _texts_from_jsonb(claims_jsonb: Optional[list]) -> list[str]:
    """`user_investment_theses`'s JSONB columns store claim dicts
    (`EvidenceTaggedClaim.to_dict()`) — this extracts just the text for
    the review prompt."""
    if not claims_jsonb:
        return []
    return [c.get("text", "") for c in claims_jsonb if c.get("text")]


async def _record_hypothesis_outcomes(
    ticker: str, prior: dict, result: ThesisReviewResult,
    sector: Optional[str] = None, industry: Optional[str] = None,
) -> None:
    """Populates `research_hypothesis_outcomes` (migration 063, Benchmark
    Engine's schema) — every prior critical variable/risk gets a real
    outcome now that there's real evidence to judge it, and every new
    critical variable/risk in the updated thesis gets a fresh
    `outcome=NULL` row pending the NEXT review. `sector`/`industry` are
    stored per-row so the Benchmark Engine (Incremento 11) can answer
    "which industries does Nuvos analyze best" without a second join —
    optional/backward-compatible since earlier reviews may not have
    passed them."""
    from app.core.database import get_supabase, run_query

    db = get_supabase()
    predicted_at = prior.get("created_at") or datetime.now(timezone.utc).isoformat()
    now = datetime.now(timezone.utc).isoformat()
    source_thesis_id = prior.get("forked_from_draft_id")

    confirmed_texts = {c.text for c in result.confirmed_variables}
    broken_texts = {c.text for c in result.broken_variables}
    still_valid_texts = {c.text for c in result.still_valid_risks}
    invalidated_texts = {c.text for c in result.invalidated_risks}

    rows: list[dict] = []
    for text in confirmed_texts:
        rows.append({"claim_text": text, "claim_type": "critical_variable", "outcome": "confirmed", "evaluated_at": now})
    for text in broken_texts:
        rows.append({"claim_text": text, "claim_type": "critical_variable", "outcome": "refuted", "evaluated_at": now})
    for text in still_valid_texts:
        rows.append({"claim_text": text, "claim_type": "risk", "outcome": "confirmed", "evaluated_at": now})
    for text in invalidated_texts:
        rows.append({"claim_text": text, "claim_type": "risk", "outcome": "refuted", "evaluated_at": now})

    for c in result.updated_critical_variables:
        rows.append({"claim_text": c.text, "claim_type": "critical_variable", "outcome": None, "evaluated_at": None})
    for c in result.updated_key_risks:
        rows.append({"claim_text": c.text, "claim_type": "risk", "outcome": None, "evaluated_at": None})

    for row in rows:
        row.update({
            "ticker": ticker.upper(), "source_thesis_id": source_thesis_id, "predicted_at": predicted_at,
            "sector": sector, "industry": industry,
        })
    if rows:
        await run_query(db.table("research_hypothesis_outcomes").insert(rows))


async def compute_and_save_thesis_review(
    user_id: str, ticker: str, company_name: str, lang: str = "es",
    sector: Optional[str] = None, industry: Optional[str] = None,
) -> ThesisReviewResult:
    """Computes the review, creates the new thesis version (via
    `thesis_engine.create_thesis_version` — never touches thesis content
    storage directly), and records hypothesis outcomes for the Benchmark
    Engine. A no-signal result (no prior thesis, or the AI call failed)
    persists nothing."""
    from app.services.research.thesis_engine import get_user_current_thesis, create_thesis_version

    result = await compute_thesis_review(user_id, ticker, company_name, lang)
    if not result.has_any_signal:
        return result

    prior = await get_user_current_thesis(user_id, ticker)
    new_version = await create_thesis_version(
        user_id, ticker, result.updated_thesis_summary,
        [c.to_dict() for c in result.updated_strengths],
        [c.to_dict() for c in result.updated_critical_variables],
        [c.to_dict() for c in result.updated_key_risks],
        [c.to_dict() for c in result.updated_invalidation_events],
        forked_from_draft_id=(prior.get("forked_from_draft_id") if prior else None),
    )
    result.new_thesis_version = new_version

    if prior:
        await _record_hypothesis_outcomes(ticker, prior, result, sector=sector, industry=industry)

    return result
