"""
Investment Memo Engine — Fase 3, Incremento 9 (Parte I — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

A PURE assembler — zero new computation, zero new AI calls, zero new
fetches. Every field in the memo is either a real number already computed
by Fase 1 (`valuation/`) or Fase 2 (`quality/`), or real text already
produced by a Fase 3 engine (Business/Competitive/Industry/Management
Intelligence, Incrementos 3-5; Thesis Engine, Incremento 7) and read
straight from the knowledge store / thesis tables. Nothing here invents a
new judgment.

Two brief-requested sections map DIRECTLY onto fields the Thesis Engine
already produces, without needing a new concept:
- "variables que deben monitorearse" = the current thesis's
  `critical_variables` (what has to hold true).
- "razones para vender" = the current thesis's `invalidation_events`
  (what would fully invalidate the thesis) — these ARE the same thing by
  construction: an event serious enough to invalidate the thesis is, by
  definition, a reason to reconsider the position.

The brief also asks for a "Risk Score" — no such score exists in Fase 2
(only Quality/Moat/Management/Conviction/Capital Allocation/Earnings
Quality/Peer Comparison/Deterioration were built; a standalone Risk Engine
was never scoped as its own increment). Rather than inventing a number
Fase 2 never computed, the memo's `risks` section is composed from real
signals that already exist: the thesis's own `key_risks`, and — when
provided — `quality.earnings_quality_engine`'s real accounting-quality
alerts (SBC load, margin anomalies, FCF/NI divergence).

Output is a structured dict, section by section (never HTML/PDF) — so a
future PDF/DOCX export is a rendering layer on top of this, never a change
to this module.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

_SECTION_ORDER = (
    "executive_summary", "business_description", "business_model", "segments", "industry", "competitors",
    "moat", "management", "capital_allocation", "risks", "catalysts",
    "quality_score", "moat_score", "management_score", "conviction_score",
    "intrinsic_value", "fair_value", "reverse_dcf", "scenarios",
    "conclusion", "variables_to_monitor", "reasons_to_sell",
)


@dataclass
class InvestmentMemoResult:
    ticker: str
    company_name: str
    generated_at: str
    sections: dict = field(default_factory=dict)

    @property
    def has_any_signal(self) -> bool:
        return any(v is not None for v in self.sections.values())

    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker, "company_name": self.company_name, "generated_at": self.generated_at,
            "sections": {k: self.sections.get(k) for k in _SECTION_ORDER},
        }


def _content(snapshot: Optional[dict]) -> dict:
    return (snapshot or {}).get("content") or {}


def _texts(claims: Optional[list]) -> list[str]:
    """Extracts plain text from a stored `EvidenceTaggedClaim.to_dict()`
    list (thesis JSONB columns) — the memo presents the real claim text,
    it never re-derives or re-scores it."""
    return [c.get("text", "") for c in (claims or []) if c.get("text")]


def _compose_conclusion(thesis_summary: Optional[str], confidence: Optional[str], conviction_score: Optional[float]) -> Optional[str]:
    """Deterministic string composition — NOT a new AI judgment. The
    conclusion is literally the thesis's own summary plus its own real
    confidence/conviction numbers, formatted for the memo's closing
    section."""
    if not thesis_summary:
        return None
    pieces = [thesis_summary]
    if confidence:
        pieces.append(f"Confianza de la tesis: {confidence}.")
    if conviction_score is not None:
        pieces.append(f"Conviction Score real: {conviction_score}/100.")
    return " ".join(pieces)


async def compute_investment_memo(
    ticker: str, company_name: str,
    *,
    quality_score: Optional[float] = None, moat_score: Optional[float] = None,
    management_score: Optional[float] = None, conviction_score: Optional[float] = None,
    intrinsic_value_per_share: Optional[float] = None, fair_value_range: Optional[dict] = None,
    reverse_dcf: Optional[dict] = None, scenarios: Optional[dict] = None,
    capital_allocation_result: Optional[dict] = None, earnings_quality_result: Optional[dict] = None,
    catalysts: Optional[dict] = None, segments: Optional[list] = None,
    user_id: Optional[str] = None,
) -> InvestmentMemoResult:
    """The single entry point. Every quantitative input is accepted as an
    already-computed parameter (Fase 1/2 owns all of them) — this function
    only reads the Fase 3 knowledge snapshots + thesis and assembles.

    `user_id`, when given, prefers that user's own current thesis
    (`thesis_engine.get_user_current_thesis`) over Nuvos's shared draft
    (`thesis_engine.get_thesis_draft`) — a memo built for a specific
    investor should reflect THEIR thesis, not just Nuvos's research view,
    when one exists."""
    from app.services.research.knowledge_store import get_latest_snapshot
    from app.services.research import thesis_engine

    business = _content(await get_latest_snapshot(ticker, "business_understanding"))
    competitive = _content(await get_latest_snapshot(ticker, "competitive"))
    industry = _content(await get_latest_snapshot(ticker, "industry"))
    management = _content(await get_latest_snapshot(ticker, "management"))

    thesis = None
    if user_id:
        thesis = await thesis_engine.get_user_current_thesis(user_id, ticker)
    if not thesis:
        thesis = await thesis_engine.get_thesis_draft(ticker)

    key_risks = _texts(thesis.get("key_risks")) if thesis else []
    if earnings_quality_result and earnings_quality_result.get("alerts"):
        key_risks += [f"{a.get('description')} (severidad: {a.get('severity')})" for a in earnings_quality_result["alerts"]]

    sections = {
        "executive_summary": thesis.get("thesis_summary") if thesis else None,
        "business_description": business.get("how_it_makes_money"),
        "business_model": {
            "what_it_sells": business.get("what_it_sells"), "who_pays": business.get("who_pays"),
            "key_customers": business.get("key_customers"),
            "most_profitable_segment": business.get("most_profitable_segment"),
            "value_destroying_segment": business.get("value_destroying_segment"),
        },
        "segments": segments,
        "industry": {
            "category": industry.get("category"), "market_size_and_growth": industry.get("market_size_and_growth"),
            "trends": industry.get("trends"), "structural_risks": industry.get("structural_risks"),
        },
        "competitors": {
            "direct_competitors": competitive.get("direct_competitors"),
            "competitive_advantages_vs_peers": competitive.get("competitive_advantages_vs_peers"),
            "peer_comparison": competitive.get("peer_comparison"),
        },
        "moat": {"moat_score": moat_score},
        "management": {
            "strategic_priorities": management.get("strategic_priorities"),
            "consistency_assessment": management.get("consistency_assessment"),
            "guidance_track_record_note": management.get("guidance_track_record_note"),
        },
        "capital_allocation": capital_allocation_result,
        "risks": key_risks,
        "catalysts": (catalysts or {}).get("catalysts", []),
        "quality_score": quality_score, "moat_score": moat_score,
        "management_score": management_score, "conviction_score": conviction_score,
        "intrinsic_value": intrinsic_value_per_share, "fair_value": fair_value_range,
        "reverse_dcf": reverse_dcf, "scenarios": scenarios,
        "conclusion": _compose_conclusion(
            thesis.get("thesis_summary") if thesis else None,
            thesis.get("confidence") if thesis else None, conviction_score,
        ),
        "variables_to_monitor": _texts(thesis.get("critical_variables")) if thesis else [],
        "reasons_to_sell": _texts(thesis.get("invalidation_events")) if thesis else [],
    }

    return InvestmentMemoResult(
        ticker=ticker.upper(), company_name=company_name,
        generated_at=datetime.now(timezone.utc).isoformat(), sections=sections,
    )
