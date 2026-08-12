"""
Reality Gate — Nuvos Fair Value Engine, Block 2.

The formal pre-publish validation gate the audit found missing entirely
(ad hoc sanity checks existed scattered across the DCF path, but no
single codified checklist). This is a CHECKLIST WRAPPER, not new
analysis — every check reads a signal this package's other modules
already computed. If the gate fails, the engine must return
`insufficient_data` rather than force a number (plan §11, the direct fix
for the audit's biggest gap).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.services.valuation.nuvos_engine.earnings_state import EarningsState
from app.services.valuation.nuvos_engine.divergence import DivergenceExplanation
from app.services.valuation.nuvos_engine.provenance import ProvenanceLedger

# A growth or Fair P/E adjustment sitting within this fraction of its
# allowed clamp range is treated as "at the extreme" — evidence-anchored
# to the same clamp bounds `growth_engine.py`/`fair_pe.py` already define,
# not a new arbitrary threshold.
_EXTREME_CLAMP_FRACTION = 0.95


@dataclass
class GateCheck:
    name: str
    passed: bool
    detail: str
    critical: bool = True


@dataclass
class RealityGateResult:
    checks: list[GateCheck] = field(default_factory=list)
    overall_pass: bool = True

    @property
    def pass_rate(self) -> float:
        if not self.checks:
            return 100.0
        return round(sum(1 for c in self.checks if c.passed) / len(self.checks) * 100, 1)

    @property
    def failed_checks(self) -> list[GateCheck]:
        return [c for c in self.checks if not c.passed]


def run_reality_gate(
    *,
    growth_adjustment_pct: Optional[float],
    growth_adjustment_bound_pp: float,
    fair_pe_primary_anchor: Optional[str],
    fair_pe_value: Optional[float],
    fair_pe_band: Optional[tuple[float, float]],
    earnings_state: EarningsState,
    normalized_eps_used: bool,
    buyback_share_of_eps_growth_pct: Optional[float],
    fcf_divergence_flag: Optional[str],
    leverage_adjustment_applied: bool,
    eps_source_consistent: bool,
    ledger: ProvenanceLedger,
    divergence: DivergenceExplanation,
    earnings_quality_warning: bool = False,
    earnings_quality_reason: Optional[str] = None,
) -> RealityGateResult:
    """Single entry point — runs all 10 checks and returns the composite
    result. Each `GateCheck.detail` is meant to be shown to the user in
    plain language when the gate fails (Trust principle: never hide why a
    valuation was withheld)."""
    checks: list[GateCheck] = []

    # 1. Growth assumptions supported (not pinned at the clamp extreme).
    # Advisory: an extreme-but-real growth adjustment is a genuine
    # confidence concern, not by itself proof the valuation is unusable.
    if growth_adjustment_pct is None:
        checks.append(GateCheck("growth_supported", True, "Sin ajuste de crecimiento aplicado — no aplica.", critical=False))
    else:
        at_extreme = abs(growth_adjustment_pct) >= growth_adjustment_bound_pp * _EXTREME_CLAMP_FRACTION
        checks.append(GateCheck(
            "growth_supported", not at_extreme,
            "Ajuste de crecimiento dentro de un rango razonable." if not at_extreme
            else f"El ajuste de crecimiento ({growth_adjustment_pct:+.1f}pp) está en el límite de lo permitido — la evidencia que lo respalda es débil.",
            critical=False,
        ))

    # 2. Fair P/E supported by evidence (has a real anchor, not just the formula).
    has_anchor = fair_pe_primary_anchor is not None and fair_pe_value is not None
    checks.append(GateCheck(
        "fair_pe_supported", has_anchor,
        f"Múltiplo respaldado por evidencia real ({fair_pe_primary_anchor})." if has_anchor
        else "No se pudo anclar el Fair P/E a evidencia real (histórico propio o comparables).",
    ))

    # 3. Not using peak cyclical or elevated earnings as if sustainable.
    # ELEVATED added alongside CYCLICAL_PEAK (2026-08-12) — the original
    # check only covered cyclicals, leaving no critical gate for a
    # non-cyclical whose earnings_state.py normalization bailed out to
    # None on an ELEVATED read (e.g. a spike from non-operating gains with
    # no reliable baseline to normalize against, confirmed on UBER); the
    # symmetric DEPRESSED/CYCLICAL_TROUGH check below already existed for
    # the understated-earnings direction, so this closes the same gap for
    # overstated earnings rather than introducing a new kind of check.
    peak_ok = not (earnings_state in (EarningsState.CYCLICAL_PEAK, EarningsState.ELEVATED) and not normalized_eps_used)
    checks.append(GateCheck(
        "not_peak_earnings", peak_ok,
        "Ganancias normalizadas usadas correctamente." if peak_ok
        else "Se detectaron ganancias en pico de ciclo o anormalmente elevadas, pero no se pudo aplicar una normalización confiable.",
    ))

    # 4. Not using abnormally depressed earnings as if sustainable.
    trough_ok = not (earnings_state in (EarningsState.CYCLICAL_TROUGH, EarningsState.DEPRESSED) and not normalized_eps_used)
    checks.append(GateCheck(
        "not_depressed_earnings", trough_ok,
        "Ganancias normalizadas usadas correctamente." if trough_ok
        else "Se detectaron ganancias deprimidas pero no se aplicó normalización.",
    ))

    # 5. EPS growth not primarily buyback-driven. Advisory: buybacks are
    # already discounted in fair_pe.py's growth input (see
    # `_growth_input_for_adjustment`) — this check flags it for
    # confidence, doesn't need to also block the whole valuation.
    buyback_ok = buyback_share_of_eps_growth_pct is None or buyback_share_of_eps_growth_pct <= 60.0
    checks.append(GateCheck(
        "not_buyback_driven", buyback_ok,
        "Crecimiento no dominado por recompras." if buyback_ok
        else f"{buyback_share_of_eps_growth_pct:.0f}% del crecimiento de EPS proviene de recompras — riesgo de sobreestimar el crecimiento operativo real.",
        critical=False,
    ))

    # 6. EPS/FCF aligned. Advisory, not critical — calibration against
    # real tickers (e.g. a mature dividend payer with one soft FCF year)
    # showed a single-year divergence blocking an otherwise reliable
    # valuation is a false positive; this should lower confidence, not
    # withhold the number by itself (spec explicitly allows EITHER
    # response to a failed check, not always the strictest one).
    fcf_ok = fcf_divergence_flag is None
    checks.append(GateCheck("eps_fcf_aligned", fcf_ok, fcf_divergence_flag or "EPS y FCF crecen de forma consistente.", critical=False))

    # 7. Balance sheet risk accounted for. Advisory — missing leverage
    # data is a completeness gap (already reflected in provenance/
    # confidence), not grounds to withhold an otherwise-supported number.
    checks.append(GateCheck(
        "leverage_accounted", leverage_adjustment_applied,
        "Ajuste por apalancamiento aplicado." if leverage_adjustment_applied
        else "No se pudo evaluar el riesgo de balance (datos de deuda/cobertura no disponibles).",
        critical=False,
    ))

    # 8. GAAP vs Adjusted EPS not mixed. Advisory in this increment (the
    # underlying check itself is a simplified single-source-consistency
    # proxy, see engine.py's `eps_source_consistent` parameter — not yet
    # sophisticated enough to be a hard blocker on its own).
    checks.append(GateCheck(
        "gaap_consistent", eps_source_consistent,
        "EPS usado de forma consistente en todo el cálculo." if eps_source_consistent
        else "Se detectó una posible mezcla de EPS GAAP y ajustado entre distintas fuentes.",
        critical=False,
    ))

    # 9. Data current/traceable.
    missing = ledger.stale_or_missing()
    checks.append(GateCheck(
        "data_traceable", len(missing) == 0,
        "Todas las métricas clave tienen fuente y fecha verificables." if not missing
        else f"Métricas sin fuente verificable o desactualizadas: {', '.join(missing)}.",
    ))

    # 10. Result not an unexplained extreme. Critical only past a much
    # larger (>100%) unexplained gap — calibration against real tickers
    # showed a merely-material (>50%) unexplained divergence is common
    # enough (thin peer coverage, a genuinely fast-moving growth stock)
    # that hard-blocking on it produced too many false "insufficient
    # data" results; the spec's own wording allows EITHER lowering
    # confidence OR withholding the number, not always the strictest.
    # Confidence still takes the hit either way via `divergence_explained`
    # in `compute_confidence_meter_v4`.
    divergence_ok = not divergence.material or divergence.explained
    divergence_critical = divergence.material and not divergence.explained and abs(divergence.divergence_pct) > 100.0
    checks.append(GateCheck(
        "divergence_explained", divergence_ok,
        divergence.reason,
        critical=divergence_critical,
    ))

    # 11. Earnings quality (Priority 5, methodology audit) — FCF running far
    # above GAAP net income (fcf_quality.py's earnings_quality_warning) is
    # the observable symptom of heavy SBC/amortization distorting GAAP EPS
    # below real cash earning power (confirmed real cases: DDOG, SHOP, AMD,
    # AXON). Advisory only — the EPS itself is never modified or swapped
    # for an adjusted figure; this only lowers confidence and surfaces the
    # caveat.
    checks.append(GateCheck(
        "earnings_quality_ok", not earnings_quality_warning,
        earnings_quality_reason or "Sin señal de distorsión GAAP/SBC material.",
        critical=False,
    ))

    # overall_pass gates on CRITICAL checks only (2/3/4/9, plus 10 when the
    # divergence is extreme) — advisory checks still count toward
    # `pass_rate` (and therefore `reality_gate_pass_rate` in
    # `compute_confidence_meter_v4`), they just don't unilaterally force
    # `insufficient_data` on their own. See each check's own comment above
    # for why it's critical vs advisory; this split itself is a direct
    # result of calibrating against real tickers, not a spec change.
    overall_pass = all(c.passed for c in checks if c.critical)
    return RealityGateResult(checks=checks, overall_pass=overall_pass)
