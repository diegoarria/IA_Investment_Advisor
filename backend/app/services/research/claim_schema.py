"""
Claim Schema — Fase 3, Incremento 1 (Parte M, "Evidence Engine" — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

The brief asks for an "Evidence Engine" that tags every AI claim with its
source, date, and confidence level, and that never mixes evidence with
interpretation. A standalone `evidence_engine.py` service would have no
callers of its own — evidence-GATHERING is already `app.services.quality.
evidence_sources.gather_evidence_bundle` (Fase 2, Incremento 6), which stays
the only way to fetch real evidence. What's missing is a shared way to TAG
every claim any Fase 3 engine produces, so this module is a data contract,
not a service: every engine in `app.services.research` returns
`EvidenceTaggedClaim`s instead of raw strings.

Three kinds, deliberately never conflated:
- "fact": a claim traceable to real, cited evidence (a real 10-K excerpt, a
  real cited web search result). Requires a non-empty `source`.
- "inference": a conclusion Nuvos derives by combining >=1 facts (e.g. "the
  margin is improving because the product mix shifted," combining two real
  numbers). `source` points at what it was derived from, not an external URL.
- "ai_opinion": the most restricted category — a qualitative read (e.g.
  "management's tone reads more cautious than last quarter") that isn't a
  simple combination of facts. Always carries an explicit `confidence`.

The one hard invariant every engine must respect: a derived claim's
confidence can never exceed the lowest confidence among the facts it cites
— see `min_confidence`. This is checked in tests, not enforced by the
dataclass itself (the dataclass has no access to the source claims at
construction time in every call site), so every engine that builds an
"inference"/"ai_opinion" claim from other claims MUST call `min_confidence`
itself rather than picking a confidence by feel.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

CLAIM_KINDS = ("fact", "inference", "ai_opinion")
CONFIDENCE_LEVELS = ("low", "medium", "high")
_CONFIDENCE_RANK = {"low": 0, "medium": 1, "high": 2}


class InvalidClaimError(ValueError):
    """Raised by `EvidenceTaggedClaim.__post_init__` when a claim violates
    one of the schema's hard invariants (bad kind/confidence, or a "fact"
    claim without a source) — these are programming errors in a Fase 3
    engine, not something to degrade gracefully from, unlike a failed
    network call."""


@dataclass
class EvidenceTaggedClaim:
    text: str
    kind: str                       # "fact" | "inference" | "ai_opinion"
    source: Optional[str] = None    # e.g. "SEC 10-K FY2025, Business" | a real URL | "Nuvos: derivado de roic_trend + margin_trend"
    source_date: Optional[str] = None
    confidence: str = "medium"      # "low" | "medium" | "high"

    def __post_init__(self):
        if self.kind not in CLAIM_KINDS:
            raise InvalidClaimError(f"kind must be one of {CLAIM_KINDS}, got {self.kind!r}")
        if self.confidence not in CONFIDENCE_LEVELS:
            raise InvalidClaimError(f"confidence must be one of {CONFIDENCE_LEVELS}, got {self.confidence!r}")
        if not self.text or not self.text.strip():
            raise InvalidClaimError("text cannot be empty")
        if self.kind == "fact" and not self.source:
            raise InvalidClaimError(
                "a 'fact' claim requires a non-empty source — without one it is at "
                "most an inference, never a fact"
            )

    def to_dict(self) -> dict:
        return {
            "text": self.text, "kind": self.kind, "source": self.source,
            "source_date": self.source_date, "confidence": self.confidence,
        }

    @staticmethod
    def from_dict(d: dict) -> "EvidenceTaggedClaim":
        return EvidenceTaggedClaim(
            text=d["text"], kind=d["kind"], source=d.get("source"),
            source_date=d.get("source_date"), confidence=d.get("confidence", "medium"),
        )


def min_confidence(claims: list[EvidenceTaggedClaim]) -> str:
    """The hard invariant every derived claim must respect: an inference or
    ai_opinion built from other claims can never claim MORE confidence than
    its weakest source. Returns "low" if `claims` is empty (nothing to
    ground the derived claim in — the safest possible default, never
    silently defaults to "medium")."""
    if not claims:
        return "low"
    return min(claims, key=lambda c: _CONFIDENCE_RANK[c.confidence]).confidence


def claims_to_dicts(claims: list[EvidenceTaggedClaim]) -> list[dict]:
    """Convenience for JSONB storage — every `content`/`detail` column in
    `company_knowledge_snapshots`/`company_timeline_events` stores claims
    via this, never a hand-rolled dict shape."""
    return [c.to_dict() for c in claims]


def claims_from_dicts(dicts: list[dict]) -> list[EvidenceTaggedClaim]:
    return [EvidenceTaggedClaim.from_dict(d) for d in dicts]
