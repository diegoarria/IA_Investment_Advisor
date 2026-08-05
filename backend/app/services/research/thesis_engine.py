"""
Thesis Engine — Fase 3, Incremento 7 (Parte F — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Synthesizes every real signal already computed elsewhere — Quality/Moat/
Conviction scores (Fase 2), valuation (Fase 1), and the Business/
Competitive/Industry/Management Intelligence snapshots + real timeline
(Incrementos 3-6) — into a structured investment thesis. Never a buy/sell
signal (enforced in the prompt, `ai_service.generate_thesis_draft`) — this
is analyst material, never advice.

Two tables, resolving a real conflict in the brief (auto-build the thesis
AND never auto-overwrite an existing one AND make it user-editable — see
"Decisión 1" in the plan):

- `research_thesis_drafts`: Nuvos's own objective, ownerless view — ONE
  row per ticker, regenerated in-place (`save_thesis_draft` upserts on
  `ticker`) whenever there's new material signal. This IS the
  "auto-construida" thesis the brief asks for.
- `user_investment_theses`: the user's personal, editable thesis —
  content is NEVER updated in place. `create_thesis_version` always
  INSERTs a new row; if a current version already exists, only its
  `is_current` FLAG is cleared (the historical content itself is
  immutable forever). `fork_thesis_from_draft` is the explicit user
  action that seeds a personal thesis from Nuvos's current draft.

This module intentionally does NOT fetch Quality/Moat/Conviction/DCF
itself — those are accepted as already-computed parameters (same
convention as `competitive_intelligence`/`industry_intelligence`), so
Thesis Engine never re-derives a score another Fase 1/2 engine already
owns.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.services.research.claim_schema import EvidenceTaggedClaim

_LIST_FIELDS = ("strengths", "critical_variables", "key_risks", "invalidation_events")


@dataclass
class ThesisDraftResult:
    ticker: str
    thesis_summary: Optional[str] = None
    strengths: list[EvidenceTaggedClaim] = field(default_factory=list)
    critical_variables: list[EvidenceTaggedClaim] = field(default_factory=list)
    key_risks: list[EvidenceTaggedClaim] = field(default_factory=list)
    invalidation_events: list[EvidenceTaggedClaim] = field(default_factory=list)
    confidence: Optional[str] = None

    @property
    def has_any_signal(self) -> bool:
        return self.thesis_summary is not None

    def to_row(self, based_on_snapshot_id: Optional[str] = None) -> dict:
        return {
            "ticker": self.ticker, "based_on_snapshot_id": based_on_snapshot_id,
            "thesis_summary": self.thesis_summary,
            "strengths": [c.to_dict() for c in self.strengths],
            "critical_variables": [c.to_dict() for c in self.critical_variables],
            "key_risks": [c.to_dict() for c in self.key_risks],
            "invalidation_events": [c.to_dict() for c in self.invalidation_events],
            "confidence": self.confidence or "low",
        }


def format_real_inputs_summary(
    quality_score: Optional[float], moat_score: Optional[float], conviction_score: Optional[float],
    margin_of_safety_pct: Optional[float], fair_value_range: Optional[dict],
    business: Optional[dict], competitive: Optional[dict], industry: Optional[dict], management: Optional[dict],
    timeline_summary: str,
) -> str:
    """Renders every already-real input into one prompt-ready block —
    the ONLY place this formatting logic lives, so both
    `compute_thesis_draft` and `bull_bear_engine.compute_bull_bear` (same
    increment) build a consistent view of "what do we really know" from
    the same real sources, matching the plan's explicit request that both
    engines see "la misma evidencia disponible" a future Debate Engine
    would also need."""
    lines = ["Señales cuantitativas reales ya calculadas:"]
    if quality_score is not None:
        lines.append(f"- Quality Score: {quality_score}/100")
    if moat_score is not None:
        lines.append(f"- Moat Score: {moat_score}/100")
    if conviction_score is not None:
        lines.append(f"- Conviction Score: {conviction_score}/100")
    if margin_of_safety_pct is not None:
        lines.append(f"- Margen de seguridad (DCF real): {margin_of_safety_pct}%")
    if fair_value_range:
        lines.append(f"- Rango de valor razonable (DCF real): ${fair_value_range.get('low')} - ${fair_value_range.get('high')}")

    if business:
        lines.append(f"\nCómo gana dinero (Business Understanding, real): {business.get('how_it_makes_money')}")
        if business.get("growth_drivers"):
            lines.append(f"Drivers de crecimiento: {business['growth_drivers']}")
        if business.get("growth_limiters"):
            lines.append(f"Límites de crecimiento: {business['growth_limiters']}")
    if competitive:
        if competitive.get("competitive_advantages_vs_peers"):
            lines.append(f"\nVentajas competitivas vs. peers reales: {competitive['competitive_advantages_vs_peers']}")
        if competitive.get("structural_industry_changes"):
            lines.append(f"Cambios estructurales de la competencia: {competitive['structural_industry_changes']}")
    if industry:
        if industry.get("market_size_and_growth"):
            lines.append(f"\nTamaño y crecimiento de la industria: {industry['market_size_and_growth']}")
        if industry.get("structural_risks"):
            lines.append(f"Riesgos estructurales de la industria: {industry['structural_risks']}")
    if management:
        if management.get("strategic_priorities"):
            lines.append(f"\nPrioridades estratégicas del management: {management['strategic_priorities']}")
        if management.get("strategy_change_classification") not in (None, "no_prior_data", "no_change"):
            lines.append(f"Cambio de estrategia detectado: {management.get('strategy_change_explanation')}")

    if timeline_summary:
        lines.append(f"\n{timeline_summary}")

    return "\n".join(lines)


def _claims_from_list(texts: list[str], confidence: str, source: str) -> list[EvidenceTaggedClaim]:
    return [EvidenceTaggedClaim(text=t, kind="inference", source=source, confidence=confidence) for t in texts if t]


async def compute_thesis_draft(
    ticker: str, company_name: str,
    quality_score: Optional[float], moat_score: Optional[float], conviction_score: Optional[float],
    margin_of_safety_pct: Optional[float], fair_value_range: Optional[dict],
    lang: str = "es",
) -> ThesisDraftResult:
    """The single entry point. Quantitative scores/valuation are accepted
    as already-computed parameters; the Business/Competitive/Industry/
    Management snapshots and the real timeline are read from the
    knowledge store directly (this engine's whole job is synthesizing
    what's already stored)."""
    from app.services.research.knowledge_store import get_latest_snapshot
    from app.services.research.timeline_engine import get_company_timeline, format_timeline_for_prompt
    from app.services import ai_service

    business = await get_latest_snapshot(ticker, "business_understanding")
    competitive = await get_latest_snapshot(ticker, "competitive")
    industry = await get_latest_snapshot(ticker, "industry")
    management = await get_latest_snapshot(ticker, "management")
    timeline = await get_company_timeline(ticker, limit=10)

    real_inputs_summary = format_real_inputs_summary(
        quality_score, moat_score, conviction_score, margin_of_safety_pct, fair_value_range,
        business.get("content") if business else None, competitive.get("content") if competitive else None,
        industry.get("content") if industry else None, management.get("content") if management else None,
        format_timeline_for_prompt(timeline),
    )

    ai_result = await ai_service.generate_thesis_draft(ticker, company_name, real_inputs_summary, lang)
    if not ai_result:
        return ThesisDraftResult(ticker=ticker.upper())

    confidence = ai_result.get("confidence", "low")
    source = "Nuvos: Thesis Engine, síntesis de Quality/Moat/Conviction/valuación/inteligencia de negocio"
    return ThesisDraftResult(
        ticker=ticker.upper(), thesis_summary=ai_result.get("thesis_summary"), confidence=confidence,
        **{field: _claims_from_list(ai_result.get(field, []), confidence, source) for field in _LIST_FIELDS},
    )


# ── Persistence: research_thesis_drafts (shared, regenerated in-place) ─────

async def save_thesis_draft(result: ThesisDraftResult, based_on_snapshot_id: Optional[str] = None) -> dict:
    """UPSERTs on `ticker` — this table intentionally IS overwritten
    in-place on every regeneration, unlike `user_investment_theses`. It
    represents "Nuvos's current research view," not a user's own thesis."""
    from app.core.database import get_supabase, run_query

    db = get_supabase()
    res = await run_query(
        db.table("research_thesis_drafts").upsert(result.to_row(based_on_snapshot_id), on_conflict="ticker")
    )
    return res.data[0] if res.data else {}


async def compute_and_save_thesis_draft(
    ticker: str, company_name: str,
    quality_score: Optional[float], moat_score: Optional[float], conviction_score: Optional[float],
    margin_of_safety_pct: Optional[float], fair_value_range: Optional[dict],
    lang: str = "es",
) -> ThesisDraftResult:
    result = await compute_thesis_draft(
        ticker, company_name, quality_score, moat_score, conviction_score,
        margin_of_safety_pct, fair_value_range, lang,
    )
    if result.has_any_signal:
        await save_thesis_draft(result)
    return result


async def get_thesis_draft(ticker: str) -> Optional[dict]:
    from app.core.database import get_supabase, run_query

    db = get_supabase()
    res = await run_query(db.table("research_thesis_drafts").select("*").eq("ticker", ticker.upper()).limit(1))
    return res.data[0] if res.data else None


# ── Persistence: user_investment_theses (personal, append-only content) ────

async def get_user_current_thesis(user_id: str, ticker: str) -> Optional[dict]:
    from app.core.database import get_supabase, run_query

    db = get_supabase()
    res = await run_query(
        db.table("user_investment_theses").select("*")
        .eq("user_id", user_id).eq("ticker", ticker.upper()).eq("is_current", True)
        .limit(1)
    )
    return res.data[0] if res.data else None


async def create_thesis_version(
    user_id: str, ticker: str, thesis_summary: str,
    strengths: list, critical_variables: list, key_risks: list, invalidation_events: list,
    forked_from_draft_id: Optional[str] = None,
) -> dict:
    """The ONLY way a `user_investment_theses` row is ever written after
    creation-time: always a new INSERT, never an UPDATE of thesis content.
    If a current version already exists, its `is_current` FLAG (and only
    that) is cleared — reused directly by the Thesis Tracker (Incremento
    8) for its own quarterly re-versioning, so there is exactly one place
    this "never overwrite, always chain" rule is implemented."""
    from app.core.database import get_supabase, run_query

    prior = await get_user_current_thesis(user_id, ticker)
    db = get_supabase()
    if prior:
        await run_query(db.table("user_investment_theses").update({"is_current": False}).eq("id", prior["id"]))

    row = {
        "user_id": user_id, "ticker": ticker.upper(),
        "version": (prior["version"] + 1) if prior else 1,
        "parent_thesis_id": prior["id"] if prior else None,
        "forked_from_draft_id": forked_from_draft_id,
        "thesis_summary": thesis_summary,
        "strengths": strengths, "critical_variables": critical_variables,
        "key_risks": key_risks, "invalidation_events": invalidation_events,
        "is_current": True,
    }
    res = await run_query(db.table("user_investment_theses").insert(row))
    return res.data[0] if res.data else {}


async def fork_thesis_from_draft(user_id: str, ticker: str) -> Optional[dict]:
    """Explicit user action: copies Nuvos's current research draft as the
    starting point for the user's own editable thesis. Returns None if
    there's no draft yet for this ticker (nothing to fork) — never
    fabricates a starting thesis with no real research behind it."""
    draft = await get_thesis_draft(ticker)
    if not draft:
        return None
    return await create_thesis_version(
        user_id, ticker, draft["thesis_summary"],
        draft["strengths"], draft["critical_variables"], draft["key_risks"], draft["invalidation_events"],
        forked_from_draft_id=draft["id"],
    )
