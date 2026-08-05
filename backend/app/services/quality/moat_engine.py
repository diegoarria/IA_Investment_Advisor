"""
Moat Engine — Fase 2, Incremento 7 (Parte B — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Two independent layers, matching the same "real numbers first, AI narrates
around them, never silently mixed" pattern already established throughout
this codebase (NIF's data/nuvos_estimate/explanation split, the DCF
engine's confidence score vs. its AI narrative):

1. `compute_moat_score` — 100% deterministic, real, zero AI, zero network.
   The financial SIGNATURE of a durable competitive advantage: does this
   business sustainably earn more than its REAL industry peers (ROIC/
   margin premium via `industry_engine.IndustryBenchmarks`, Incremento 1),
   and is that premium STABLE over time rather than a one-off spike? This
   is deliberately the same ROIC-centric philosophy `_stars_from_roic`
   already used in Fase 1 (Buffett's own heuristic: a durable moat shows
   up as sustained above-average returns on capital), extended with a
   real peer-relative comparison instead of a fixed threshold. THIS is
   the number shown as "Moat Score" — never a black box, every factor
   listed with its value/sub-score/reason.

2. `moat_deep_dive` (below) — the 11 moat-TYPE qualitative breakdown the
   brief asks for (network effects, switching costs, brand, etc.) is
   necessarily AI-narrated (no deterministic formula can classify "does
   this have a network effect" from financial statements alone) and lives
   in `ai_service.generate_moat_deep_dive`, grounded in the REAL evidence
   `evidence_sources.gather_evidence_bundle` collects (Incremento 6).
   Deliberately kept SEPARATE from the Moat Score number computed here —
   the qualitative detail explains and enriches the real score, it never
   silently determines it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.services.valuation.numeric_helpers import _score, _coefficient_of_variation, weighted_mean, STABILITY_CV_TIERS

# Premium over the real peer-group median, in percentage points — how much
# MORE this company earns than a typical real competitor in the same
# industry. This is the closest real, computable proxy for "does this
# business have some structural advantage peers don't" — a business that
# merely matches its peers has no measurable moat by this definition, even
# if it's a perfectly fine business.
_ROIC_PREMIUM_TIERS = [(0, 15), (3, 35), (7, 55), (12, 75), (20, 90), (999, 95)]
_MARGIN_PREMIUM_TIERS = [(0, 15), (2, 35), (5, 55), (10, 75), (18, 90), (999, 95)]
_GROSS_MARGIN_LEVEL_TIERS = [(20, 15), (35, 35), (50, 55), (65, 75), (80, 90), (999, 95)]


@dataclass
class MoatFactor:
    name: str
    value: Optional[float]
    score: Optional[float]
    reason: str


@dataclass
class MoatScoreResult:
    moat_score: int
    roic_premium_score: Optional[float]
    margin_premium_score: Optional[float]
    stability_score: Optional[float]
    factors: list[MoatFactor] = field(default_factory=list)

    @property
    def has_any_signal(self) -> bool:
        return any(s is not None for s in (self.roic_premium_score, self.margin_premium_score, self.stability_score))


def compute_moat_score(
    *,
    avg_roic_pct: Optional[float], roic_trend: list[Optional[float]],
    avg_operating_margin_pct: Optional[float], operating_margin_trend: list[Optional[float]],
    gross_margin_latest_pct: Optional[float],
    industry_median_roic_pct: Optional[float], industry_median_operating_margin_pct: Optional[float],
) -> MoatScoreResult:
    """The single entry point for the deterministic Moat Score. All inputs
    are already-computed real values/trends (from `quality_engine` and
    `industry_engine`) — this function performs zero fetching, zero AI,
    and reuses `numeric_helpers` primitives (`_score`, `weighted_mean`,
    `_coefficient_of_variation`) rather than re-deriving scoring math."""
    factors: list[MoatFactor] = []

    roic_premium = (
        round(avg_roic_pct - industry_median_roic_pct, 1)
        if avg_roic_pct is not None and industry_median_roic_pct is not None else None
    )
    roic_premium_score = _score(roic_premium, _ROIC_PREMIUM_TIERS) if roic_premium is not None else None
    factors.append(MoatFactor(
        "roic_premium_vs_industry", roic_premium, roic_premium_score,
        f"ROIC promedio ({avg_roic_pct}%) vs. mediana real de la industria ({industry_median_roic_pct}%) → "
        f"premium de {roic_premium:+.1f}pp." if roic_premium is not None
        else "No hay suficientes peers reales en la industria para comparar ROIC — sin este factor.",
    ))

    margin_premium = (
        round(avg_operating_margin_pct - industry_median_operating_margin_pct, 1)
        if avg_operating_margin_pct is not None and industry_median_operating_margin_pct is not None else None
    )
    margin_premium_score = _score(margin_premium, _MARGIN_PREMIUM_TIERS) if margin_premium is not None else None
    factors.append(MoatFactor(
        "margin_premium_vs_industry", margin_premium, margin_premium_score,
        f"Margen operativo promedio ({avg_operating_margin_pct}%) vs. mediana real de la industria "
        f"({industry_median_operating_margin_pct}%) → premium de {margin_premium:+.1f}pp." if margin_premium is not None
        else "No hay suficientes peers reales en la industria para comparar margen — sin este factor.",
    ))

    roic_cv = _coefficient_of_variation(roic_trend)
    margin_cv = _coefficient_of_variation(operating_margin_trend)
    roic_stability_score = _score(roic_cv, STABILITY_CV_TIERS) if roic_cv is not None else None
    margin_stability_score = _score(margin_cv, STABILITY_CV_TIERS) if margin_cv is not None else None
    stability_score = weighted_mean([(roic_stability_score, 0.5), (margin_stability_score, 0.5)])
    factors.append(MoatFactor(
        "roic_stability", round(roic_cv, 2) if roic_cv is not None else None, roic_stability_score,
        "Un ROIC estable a lo largo de los años es más evidencia de un moat real y duradero que un pico aislado — "
        f"coeficiente de variación {round(roic_cv, 2)}." if roic_cv is not None else "Historial insuficiente para evaluar estabilidad del ROIC.",
    ))
    factors.append(MoatFactor(
        "margin_stability", round(margin_cv, 2) if margin_cv is not None else None, margin_stability_score,
        f"Estabilidad del margen operativo a lo largo de los años — coeficiente de variación {round(margin_cv, 2)}."
        if margin_cv is not None else "Historial insuficiente para evaluar estabilidad del margen.",
    ))

    gross_margin_score = _score(gross_margin_latest_pct, _GROSS_MARGIN_LEVEL_TIERS) if gross_margin_latest_pct is not None else None
    factors.append(MoatFactor(
        "gross_margin_level", gross_margin_latest_pct, gross_margin_score,
        f"Margen bruto más reciente: {gross_margin_latest_pct}% — un margen bruto estructuralmente alto suele "
        f"reflejar poder de fijación de precios (pricing power) real." if gross_margin_latest_pct is not None
        else "Margen bruto no disponible.",
    ))

    moat_score_raw = weighted_mean([
        (roic_premium_score, 0.35), (margin_premium_score, 0.25), (stability_score, 0.25), (gross_margin_score, 0.15),
    ])
    moat_score = round(moat_score_raw) if moat_score_raw is not None else 0

    return MoatScoreResult(
        moat_score=moat_score,
        roic_premium_score=roic_premium_score,
        margin_premium_score=margin_premium_score,
        stability_score=round(stability_score, 1) if stability_score is not None else None,
        factors=factors,
    )


def _format_moat_score_summary(result: MoatScoreResult) -> str:
    """Renders the deterministic score's real factors into plain text for
    the AI deep-dive prompt — the AI gets the real numbers as CONTEXT, it
    never recomputes or overrides them."""
    lines = [f"Moat Score (real, calculado): {result.moat_score}/100"]
    for f in result.factors:
        lines.append(f"- {f.name}: {f.reason}")
    return "\n".join(lines)


def _format_evidence_bundle(bundle) -> str:
    """Renders an `evidence_sources.EvidenceBundle` into plain text for the
    AI deep-dive prompt — real filing excerpts, real search answer with
    real citation URLs, real scraped excerpts. Truncated per-field so one
    very long section can't blow out the prompt budget."""
    lines: list[str] = []
    filing = bundle.filing_evidence or {}
    if filing.get("business"):
        lines.append(f"[10-K, sección Business, real, fuente: {filing.get('source_url')}]\n{filing['business'][:2000]}")
    if filing.get("risk_factors"):
        lines.append(f"[10-K, sección Risk Factors, real]\n{filing['risk_factors'][:2000]}")
    if filing.get("mda"):
        lines.append(f"[10-K, sección MD&A, real]\n{filing['mda'][:1500]}")
    if bundle.search_answer:
        lines.append(f"[Búsqueda web real con fuentes citadas]\n{bundle.search_answer}")
    for excerpt in bundle.scraped_excerpts:
        lines.append(f"[Extracto real de {excerpt.url}{f' ({excerpt.title})' if excerpt.title else ''}]\n{excerpt.excerpt[:1000]}")
    return "\n\n".join(lines)


async def compute_moat_deep_dive(
    ticker: str, company_name: str, moat_score_result: MoatScoreResult, lang: str = "es",
) -> Optional[dict]:
    """The single entry point for the qualitative 11-moat-type deep dive
    (Parte B's full ask, beyond the deterministic score above). Composes:
    1. Real evidence gathering (`evidence_sources.gather_evidence_bundle`
       — Incremento 6: real 10-K text + real cited web search + real
       scraped excerpts), run in a thread since it's synchronous I/O.
    2. The AI narration grounded in that evidence
       (`ai_service.generate_moat_deep_dive`).

    Returns None if there's no real evidence at all to ground the analysis
    in (never lets the model free-associate about moat types with zero
    real evidence) OR if the AI call itself fails/doesn't parse — the
    caller (e.g. a NIF-dashboard-style orchestrator) should treat None as
    "deep dive not available right now", same degrade-gracefully
    philosophy as every other AI narration call in this codebase."""
    import asyncio
    from app.services.quality.evidence_sources import gather_evidence_bundle
    from app.services import ai_service

    bundle = await asyncio.to_thread(
        gather_evidence_bundle, ticker, company_name, "moat y ventaja competitiva sostenible", lang,
    )
    if not bundle.has_any_real_evidence:
        return None

    moat_score_summary = _format_moat_score_summary(moat_score_result)
    evidence_block = _format_evidence_bundle(bundle)
    return await ai_service.generate_moat_deep_dive(ticker, company_name, moat_score_summary, evidence_block, lang)
