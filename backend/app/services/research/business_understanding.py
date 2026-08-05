"""
Business Understanding Engine — Fase 3, Incremento 3 (Parte B — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Answers, specifically for THIS company (never a generic template): how
does it make money, what does it sell, who pays, who are its key
customers, what drives/limits growth, which part is most/least
profitable, and — once a prior snapshot exists — how has the business
changed since the last review.

Necessarily AI-narrated (no deterministic formula turns "which segment is
most profitable" into a number from financial statements alone without
segment-level cost allocation this codebase doesn't have), grounded in two
already-real sources, neither re-fetched here:
1. `fundamental_analysis_service`'s real revenue-segment breakdown
   (`segments`), rendered via the shared `format_segments_summary`
   formatter (promoted there in this increment so
   `quality.catalysts_engine` and this module share one formatter).
2. The company's real 10-K Business-section text, read from the
   `document_intel` knowledge snapshot (Incremento 2) — never re-fetched
   from SEC EDGAR here.

The "how has the business changed" question is answered by passing the
PRIOR `business_understanding` snapshot's own `how_it_makes_money` field
(via `knowledge_store.get_latest_snapshot`) into the prompt as a real
comparison anchor — on a ticker's first-ever run there is no prior
snapshot, and the result's `business_change_since_last_review` is `None`,
never invented.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.services.research.claim_schema import EvidenceTaggedClaim

_CLAIM_FIELDS = (
    "how_it_makes_money", "what_it_sells", "who_pays", "key_customers",
    "growth_drivers", "growth_limiters", "most_profitable_segment", "value_destroying_segment",
)


@dataclass
class BusinessUnderstandingResult:
    ticker: str
    how_it_makes_money: Optional[str]
    what_it_sells: Optional[str]
    who_pays: Optional[str]
    key_customers: Optional[str]
    growth_drivers: Optional[str]
    growth_limiters: Optional[str]
    most_profitable_segment: Optional[str]
    value_destroying_segment: Optional[str]
    business_change_since_last_review: Optional[str]
    claims: list[EvidenceTaggedClaim] = field(default_factory=list)

    @property
    def has_any_signal(self) -> bool:
        return self.how_it_makes_money is not None

    def to_snapshot_content(self) -> dict:
        return {
            "how_it_makes_money": self.how_it_makes_money, "what_it_sells": self.what_it_sells,
            "who_pays": self.who_pays, "key_customers": self.key_customers,
            "growth_drivers": self.growth_drivers, "growth_limiters": self.growth_limiters,
            "most_profitable_segment": self.most_profitable_segment,
            "value_destroying_segment": self.value_destroying_segment,
            "business_change_since_last_review": self.business_change_since_last_review,
            "claims": [c.to_dict() for c in self.claims],
        }


def _build_claims(ai_result: dict, grounded_in_real_filing_text: bool) -> list[EvidenceTaggedClaim]:
    """Every field the model returned becomes an 'inference' claim (a
    synthesis of real segments/filing text, never a verbatim quote) —
    confidence is 'medium' when grounded in the company's own real 10-K
    Business-section text, 'low' when the model had only the real segment
    breakdown to work from (a materially thinner evidence base). Never
    'high' — even when the source text is real, turning it into an answer
    about "who pays" or "what limits growth" is genuine interpretation,
    not extraction, matching the fact/inference distinction in
    claim_schema.py."""
    confidence = "medium" if grounded_in_real_filing_text else "low"
    source = (
        "Nuvos: inferido de segmentos reales + texto real del 10-K (Business)" if grounded_in_real_filing_text
        else "Nuvos: inferido únicamente de segmentos de ingresos reales (sin texto de 10-K disponible)"
    )
    claims: list[EvidenceTaggedClaim] = []
    for key in _CLAIM_FIELDS:
        text = ai_result.get(key)
        if text:
            claims.append(EvidenceTaggedClaim(text=text, kind="inference", source=source, confidence=confidence))
    if ai_result.get("business_change_since_last_review"):
        claims.append(EvidenceTaggedClaim(
            text=ai_result["business_change_since_last_review"], kind="inference",
            source="Nuvos: comparado contra la revisión anterior de Business Understanding", confidence=confidence,
        ))
    return claims


async def compute_business_understanding(
    ticker: str, company_name: str, segments: list[dict], lang: str = "es",
) -> BusinessUnderstandingResult:
    """The single entry point. `segments` is accepted as an already-
    computed real input (from `get_fundamental_analysis(ticker)
    ["segments"]`) rather than re-fetched here, same convention as every
    other Fase 2 engine. Reads the `document_intel` and prior
    `business_understanding` snapshots from the knowledge store itself
    (this engine's whole job is synthesizing what's already stored, not
    taking more parameters than it needs)."""
    from app.services.fundamental_analysis_service import format_segments_summary
    from app.services.research.knowledge_store import get_latest_snapshot
    from app.services import ai_service

    document_intel = await get_latest_snapshot(ticker, "document_intel")
    filing_business_text = ""
    if document_intel:
        filing_10k = (document_intel.get("content") or {}).get("filing_10k") or {}
        filing_business_text = filing_10k.get("business") or ""

    prior = await get_latest_snapshot(ticker, "business_understanding")
    prior_summary = (prior.get("content") or {}).get("how_it_makes_money") if prior else None

    segments_summary = format_segments_summary(segments)
    ai_result = await ai_service.generate_business_understanding(
        ticker, company_name, segments_summary, filing_business_text, prior_summary, lang,
    )

    if not ai_result:
        return BusinessUnderstandingResult(
            ticker=ticker.upper(), how_it_makes_money=None, what_it_sells=None, who_pays=None,
            key_customers=None, growth_drivers=None, growth_limiters=None,
            most_profitable_segment=None, value_destroying_segment=None,
            business_change_since_last_review=None, claims=[],
        )

    claims = _build_claims(ai_result, grounded_in_real_filing_text=bool(filing_business_text.strip()))
    return BusinessUnderstandingResult(
        ticker=ticker.upper(),
        how_it_makes_money=ai_result.get("how_it_makes_money"), what_it_sells=ai_result.get("what_it_sells"),
        who_pays=ai_result.get("who_pays"), key_customers=ai_result.get("key_customers"),
        growth_drivers=ai_result.get("growth_drivers"), growth_limiters=ai_result.get("growth_limiters"),
        most_profitable_segment=ai_result.get("most_profitable_segment"),
        value_destroying_segment=ai_result.get("value_destroying_segment"),
        business_change_since_last_review=ai_result.get("business_change_since_last_review"),
        claims=claims,
    )


async def compute_and_save_business_understanding(
    ticker: str, company_name: str, segments: list[dict], lang: str = "es",
) -> BusinessUnderstandingResult:
    """Convenience wrapper: computes and persists in one call. `source_period`
    inherits from the `document_intel` snapshot this run was grounded in
    (if any) — same convention as `document_intelligence.
    compute_and_save_document_intelligence`."""
    from app.services.research.knowledge_store import save_snapshot, get_latest_snapshot

    result = await compute_business_understanding(ticker, company_name, segments, lang)
    document_intel = await get_latest_snapshot(ticker, "document_intel")
    source_period = document_intel.get("source_period") if document_intel else None
    await save_snapshot(ticker, "business_understanding", result.to_snapshot_content(), source_period=source_period)
    return result
