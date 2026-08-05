"""
Conviction Engine — Fase 2, Incremento 9 (Parte H — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

100% deterministic, real, zero AI, zero new network calls — a low-risk
SYNTHESIS layer, exactly as the plan calls for. It blends FOUR signals
that already exist as real, independently-computed numbers by the time
this runs, never re-deriving any of them:

- `quality_score` — the Quality Engine's real level of business quality
  (Incremento 2): profitability, margins, cash flow, growth, balance
  sheet.
- `moat_score` — the Moat Engine's real ROIC/margin premium over actual
  industry peers (Incremento 7): is the quality level DEFENSIBLE, not
  just currently true.
- `stability_score` — the Moat Engine's own ROIC/margin coefficient-of-
  variation stability sub-score (Incremento 7): is that premium a durable
  pattern or a one-off spike. Reused verbatim, never recomputed here —
  the whole point of Fase 2's "no dupliques lógica" rule.
- `beta_score` — derived from the company's real CAPM beta (already
  fetched by the DCF engine for WACC, `dcf["wacc_details"]["beta"]` — no
  new fetch). This is the closest real, already-available proxy this
  codebase has for "how volatile is the market's view of this business
  relative to its sector/industry" — a lower beta means outside investors
  already treat this as a more predictable, lower-risk business, which is
  a real (if imperfect) input to how much conviction a thesis built on
  the OTHER three real signals deserves.

Conviction is deliberately NOT a valuation signal and never touches
price/DCF/multiples beyond borrowing the already-computed beta — a cheap
stock with a weak, unstable, moat-less business must never score high
conviction just because it's cheap, exactly the separation Fase 2's brief
requires throughout.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.services.valuation.numeric_helpers import _score, weighted_mean

# Lower beta = the market already treats this business as more predictable
# = more conviction-worthy, all else equal — same "lower is better" tier
# shape as STABILITY_CV_TIERS.
_BETA_TIERS = [(0.7, 90), (1.0, 75), (1.3, 55), (1.6, 35), (999, 15)]


@dataclass
class ConvictionFactor:
    name: str
    value: Optional[float]
    score: Optional[float]
    reason: str


@dataclass
class ConvictionScoreResult:
    conviction_score: int
    quality_score: Optional[float]
    moat_score: Optional[float]
    stability_score: Optional[float]
    beta_score: Optional[float]
    factors: list[ConvictionFactor] = field(default_factory=list)

    @property
    def has_any_signal(self) -> bool:
        return any(s is not None for s in (self.quality_score, self.moat_score, self.stability_score, self.beta_score))


def compute_conviction_score(
    *,
    quality_score: Optional[float], moat_score: Optional[float],
    stability_score: Optional[float], beta: Optional[float],
) -> ConvictionScoreResult:
    """The single entry point. All four inputs are already-computed real
    values from other Fase 2 engines (or, for `beta`, from the DCF engine)
    — this function performs zero fetching, zero AI, and only blends via
    `numeric_helpers.weighted_mean`."""
    factors: list[ConvictionFactor] = []

    factors.append(ConvictionFactor(
        "quality_level", quality_score, quality_score,
        f"Nivel real de calidad del negocio (Quality Engine): {quality_score}/100." if quality_score is not None
        else "Quality Engine no disponible.",
    ))
    factors.append(ConvictionFactor(
        "moat_strength", moat_score, moat_score,
        f"Ventaja competitiva real medida (Moat Engine, premium de ROIC/margen vs. industria real): {moat_score}/100." if moat_score is not None
        else "Moat Engine no disponible.",
    ))
    factors.append(ConvictionFactor(
        "durability", stability_score, stability_score,
        f"Estabilidad real del ROIC/margen a lo largo del tiempo (Moat Engine): {stability_score}/100 — un premium estable "
        f"pesa más que uno de un solo año." if stability_score is not None
        else "Estabilidad no evaluable (historial insuficiente).",
    ))

    beta_score = _score(beta, _BETA_TIERS) if beta is not None else None
    factors.append(ConvictionFactor(
        "market_perceived_volatility", beta, beta_score,
        f"Beta real (CAPM, ya calculado por el motor de DCF): {beta} — un beta más bajo indica que el mercado ya trata "
        f"a esta empresa como un negocio más predecible." if beta is not None
        else "Beta no disponible.",
    ))

    conviction_score_raw = weighted_mean([
        (quality_score, 0.35), (moat_score, 0.30), (stability_score, 0.20), (beta_score, 0.15),
    ])
    conviction_score = round(conviction_score_raw) if conviction_score_raw is not None else 0

    return ConvictionScoreResult(
        conviction_score=conviction_score,
        quality_score=quality_score, moat_score=moat_score,
        stability_score=stability_score, beta_score=beta_score,
        factors=factors,
    )
