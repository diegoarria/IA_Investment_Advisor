"""
Divergence — Nuvos Fair Value Engine, Block 2 ("anti-crazy-valuation").

When Fair Value diverges materially from the current price, attempts to
attribute the gap to a real, already-computed cause rather than letting
an unexplained number stand. This is deliberately NOT a new heuristic
invented from scratch — every attribution channel below reads a signal
this package's other modules already computed
(`earnings_state.EarningsState`, `fair_pe.FairPEResult`,
`growth_quality.EpsGrowthDecomposition`, the provenance ledger).

If none of the real signals explain the gap, `explained=False` — this
feeds directly into `confidence_engine.py` and Reality Gate check #10
(plan §11/§12), never gets papered over with a fabricated justification.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.services.valuation.nuvos_engine.earnings_state import EarningsState
from app.services.valuation.nuvos_engine.provenance import ProvenanceLedger

_DIVERGENCE_THRESHOLD_PCT = 50.0


@dataclass
class DivergenceExplanation:
    divergence_pct: float
    material: bool
    explained: bool
    causes: list[str] = field(default_factory=list)
    reason: str = ""


def explain_divergence(
    *,
    fair_value: Optional[float],
    current_price: Optional[float],
    earnings_state: EarningsState,
    fair_pe_primary_anchor: Optional[str],
    historical_median_pe: Optional[float],
    peer_median_pe: Optional[float],
    growth_based_multiple: Optional[float],
    ledger: Optional[ProvenanceLedger] = None,
) -> DivergenceExplanation:
    """Single entry point. `material` = the gap is large enough to require
    an explanation at all; `explained` = a real cause was actually found
    for it."""
    if fair_value is None or current_price is None or current_price <= 0:
        return DivergenceExplanation(
            divergence_pct=0.0, material=False, explained=True,
            reason="Fair Value o precio actual no disponibles — sin análisis de divergencia.",
        )

    divergence_pct = round((fair_value - current_price) / current_price * 100, 1)
    material = abs(divergence_pct) > _DIVERGENCE_THRESHOLD_PCT
    if not material:
        return DivergenceExplanation(
            divergence_pct=divergence_pct, material=False, explained=True,
            reason=f"Diferencia de {divergence_pct:+.1f}% entre Fair Value y precio — dentro de un rango normal, no requiere explicación adicional.",
        )

    causes: list[str] = []

    if earnings_state in (EarningsState.CYCLICAL_TROUGH, EarningsState.DEPRESSED):
        causes.append("Ganancias actuales deprimidas/en valle de ciclo — el Fair Value usa ganancias normalizadas, más altas que las reportadas hoy.")
    if earnings_state in (EarningsState.CYCLICAL_PEAK, EarningsState.ELEVATED):
        causes.append("Ganancias actuales en pico/elevadas — el Fair Value usa ganancias normalizadas, más bajas que las reportadas hoy.")
    if earnings_state == EarningsState.RECOVERY:
        causes.append("Empresa en recuperación (Turnaround) — alta incertidumbre inherente al punto del ciclo de recuperación.")

    if historical_median_pe is not None and growth_based_multiple is not None:
        if abs(historical_median_pe - growth_based_multiple) / max(historical_median_pe, 1e-6) > 0.4:
            causes.append(
                f"El múltiplo justificado por crecimiento/calidad ({growth_based_multiple:.1f}x) difiere significativamente "
                f"del P/E histórico propio ({historical_median_pe:.1f}x) — posible cambio estructural en el negocio o en su valoración de mercado."
            )
    if peer_median_pe is not None and growth_based_multiple is not None:
        if abs(peer_median_pe - growth_based_multiple) / max(peer_median_pe, 1e-6) > 0.4:
            causes.append(
                f"El múltiplo justificado ({growth_based_multiple:.1f}x) difiere significativamente del P/E mediano de comparables "
                f"({peer_median_pe:.1f}x) — el mercado podría estar valorando esta empresa distinto a sus pares por una razón real (calidad, crecimiento) o por sentimiento."
            )

    if ledger is not None and ledger.stale_or_missing():
        causes.append(f"Datos incompletos o no verificables para: {', '.join(ledger.stale_or_missing())} — parte de la divergencia puede deberse a calidad de datos, no a la valoración en sí.")

    explained = len(causes) > 0
    reason = (
        f"Diferencia de {divergence_pct:+.1f}% entre Fair Value y precio actual — "
        + (f"explicada por {len(causes)} causa(s) real(es) identificada(s)." if explained
           else "no se identificó una causa real que la explique; se reduce la confianza en vez de forzar una justificación.")
    )
    return DivergenceExplanation(divergence_pct=divergence_pct, material=material, explained=explained, causes=causes, reason=reason)
