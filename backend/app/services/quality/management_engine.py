"""
Management Engine — Fase 2, Incremento 8 (Parte D — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Same two-layer split as the Moat Engine (Incremento 7):

1. `compute_management_score` — 100% deterministic, real, zero AI, zero
   network. Blends THREE already-real signals rather than inventing a new
   one: the Capital Allocation Engine's score (Incremento 4 — buyback
   timing, dividend consistency, reinvestment discipline: the richest real
   signal for "how does management deploy capital"), and two Finnhub
   insider signals (`fh_insider_sentiment`'s MSPR, `fh_insider_transactions`'
   trailing-12mo buyer/seller counts) — both already fetched by
   `nif_service.build_nif_dashboard` today, just never turned into a score.
   THIS is the number shown as "Management Score" — every factor listed
   with its value/sub-score/reason, no black box.

2. `compute_management_deep_dive` (below) — a real guidance-track-record
   qualitative read (did management's own past guidance hold up? any
   public governance red flags?) is necessarily AI-narrated (no
   deterministic formula can grade "did they under/over-promise" from
   financial statements alone) and lives in
   `ai_service.generate_management_deep_dive`, grounded in the REAL
   evidence `evidence_sources.gather_evidence_bundle` collects (Incremento
   6: real 10-K text + real cited web search + real scraped excerpts).
   Returns None — and the prompt is instructed to say so explicitly per
   sub-factor — when there simply isn't enough real public evidence,
   rather than filling the gap with generic narrative filler.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.services.valuation.numeric_helpers import _score, weighted_mean

# Finnhub's MSPR (Monthly Share Purchase Ratio) ranges roughly -100 (heavy
# net selling) to +100 (heavy net buying) — see app.core.finnhub.
# fh_insider_sentiment's docstring.
_INSIDER_SENTIMENT_TIERS = [(-50, 15), (-15, 35), (15, 60), (50, 80), (999, 95)]

# Real, discrete signal: how many distinct insiders bought vs. sold in the
# trailing 12 months (open-market Form 4 transactions only — see
# app.core.finnhub.fh_insider_transactions). More buyers than sellers is a
# real (if noisy) alignment signal; the reverse is a real caution signal.
_INSIDER_BUYER_SELLER_DIFF_TIERS = [(-5, 15), (-1, 35), (0, 55), (2, 75), (999, 90)]


@dataclass
class ManagementFactor:
    name: str
    value: Optional[float]
    score: Optional[float]
    reason: str


@dataclass
class ManagementScoreResult:
    management_score: int
    capital_allocation_score: Optional[float]
    insider_sentiment_score: Optional[float]
    insider_activity_score: Optional[float]
    factors: list[ManagementFactor] = field(default_factory=list)

    @property
    def has_any_signal(self) -> bool:
        return any(s is not None for s in (
            self.capital_allocation_score, self.insider_sentiment_score, self.insider_activity_score,
        ))


def compute_management_score(
    *,
    capital_allocation_score: Optional[float],
    insider_sentiment_avg_mspr: Optional[float],
    insider_sentiment_months_covered: Optional[int],
    insider_trailing_12mo: Optional[dict],
) -> ManagementScoreResult:
    """The single entry point for the deterministic Management Score.
    `capital_allocation_score` is accepted as an already-computed input
    (from `capital_allocation_engine.compute_capital_allocation_score`,
    Incremento 4) rather than re-derived here — this engine's job is to
    ADD the insider-alignment dimension and blend, not to recompute
    capital allocation a second time. `insider_trailing_12mo` is the
    `trailing_12mo` dict from `fh_insider_transactions`
    (`{"net_shares": int, "distinct_buyers": int, "distinct_sellers": int}`)."""
    factors: list[ManagementFactor] = []

    factors.append(ManagementFactor(
        "capital_allocation", capital_allocation_score, capital_allocation_score,
        f"Puntaje real del Capital Allocation Engine (recompras, dividendos, disciplina de reinversión): {capital_allocation_score}/100."
        if capital_allocation_score is not None
        else "Capital Allocation Engine no disponible (datos insuficientes para evaluar recompras/dividendos/reinversión).",
    ))

    insider_sentiment_score = (
        _score(insider_sentiment_avg_mspr, _INSIDER_SENTIMENT_TIERS)
        if insider_sentiment_avg_mspr is not None else None
    )
    factors.append(ManagementFactor(
        "insider_sentiment", round(insider_sentiment_avg_mspr, 1) if insider_sentiment_avg_mspr is not None else None,
        insider_sentiment_score,
        f"Sentimiento insider real (MSPR, Finnhub, {insider_sentiment_months_covered} mes(es)): "
        f"{round(insider_sentiment_avg_mspr, 1)} (rango -100 a +100, positivo = compra neta)." if insider_sentiment_avg_mspr is not None
        else "No hay datos de sentimiento insider (MSPR) disponibles para esta empresa.",
    ))

    t12 = insider_trailing_12mo or {}
    distinct_buyers = t12.get("distinct_buyers")
    distinct_sellers = t12.get("distinct_sellers")
    buyer_seller_diff = (
        distinct_buyers - distinct_sellers
        if distinct_buyers is not None and distinct_sellers is not None and (distinct_buyers + distinct_sellers) > 0
        else None
    )
    insider_activity_score = (
        _score(buyer_seller_diff, _INSIDER_BUYER_SELLER_DIFF_TIERS) if buyer_seller_diff is not None else None
    )
    factors.append(ManagementFactor(
        "insider_buying_activity", buyer_seller_diff, insider_activity_score,
        f"Transacciones reales de insiders (Form 4, mercado abierto, últimos 12 meses): {distinct_buyers} persona(s) "
        f"distinta(s) compraron, {distinct_sellers} vendieron (neto: {t12.get('net_shares'):,} acciones)."
        if buyer_seller_diff is not None
        else "No hay transacciones de insiders (compra/venta en mercado abierto) registradas en los últimos 12 meses.",
    ))

    management_score_raw = weighted_mean([
        (capital_allocation_score, 0.5), (insider_sentiment_score, 0.3), (insider_activity_score, 0.2),
    ])
    management_score = round(management_score_raw) if management_score_raw is not None else 0

    return ManagementScoreResult(
        management_score=management_score,
        capital_allocation_score=capital_allocation_score,
        insider_sentiment_score=insider_sentiment_score,
        insider_activity_score=insider_activity_score,
        factors=factors,
    )


def _format_management_score_summary(result: ManagementScoreResult) -> str:
    """Renders the deterministic score's real factors into plain text for
    the AI deep-dive prompt — the AI gets the real numbers as CONTEXT, it
    never recomputes or overrides them."""
    lines = [f"Management Score (real, calculado): {result.management_score}/100"]
    for f in result.factors:
        lines.append(f"- {f.name}: {f.reason}")
    return "\n".join(lines)


async def compute_management_deep_dive(
    ticker: str, company_name: str, management_score_result: ManagementScoreResult, lang: str = "es",
) -> Optional[dict]:
    """The single entry point for the qualitative guidance-track-record /
    governance deep dive (Parte D's real-evidence layer, beyond the
    deterministic score above). Composes:
    1. Real evidence gathering (`evidence_sources.gather_evidence_bundle`
       — Incremento 6: real 10-K text + real cited web search + real
       scraped excerpts), topic scoped to guidance/governance rather than
       moat, run in a thread since it's synchronous I/O.
    2. The AI narration grounded in that evidence
       (`ai_service.generate_management_deep_dive`).

    Returns None if there's no real evidence at all to ground the analysis
    in (never lets the model free-associate about guidance credibility with
    zero real evidence) OR if the AI call itself fails/doesn't parse — same
    degrade-gracefully philosophy as `moat_engine.compute_moat_deep_dive`."""
    import asyncio
    from app.services.quality.evidence_sources import gather_evidence_bundle, format_evidence_bundle_for_prompt
    from app.services import ai_service

    bundle = await asyncio.to_thread(
        gather_evidence_bundle, ticker, company_name,
        "track record de guidance del management y gobernanza corporativa", lang,
    )
    if not bundle.has_any_real_evidence:
        return None

    management_score_summary = _format_management_score_summary(management_score_result)
    evidence_block = format_evidence_bundle_for_prompt(bundle)
    return await ai_service.generate_management_deep_dive(
        ticker, company_name, management_score_summary, evidence_block, lang,
    )
