"""
Earnings State — Nuvos Fair Value Engine, Block 1.

Determines whether current earnings are Normal / Elevated / Depressed /
Cyclical Peak / Cyclical Trough / Recovery / Structurally Impaired, and
derives `normalized_eps` accordingly — the direct fix for the audit's
biggest gap: the DCF path had no earnings-state detection at all and
could misvalue a cyclical at exactly the wrong point in its cycle.

Reuses the same margin-normalization pattern already live in
`fundamental_analysis_service.py` (~L1001-1006, applying a mid-cycle
margin to the DCF base) rather than inventing a new normalization
technique — this module just makes that pattern explicit, reusable, and
gated behind a real state classification instead of applied unconditionally.

Absolute rule (mirrors the module's governing philosophy): if the
available history can't support a reliable normalization, `normalized_eps`
is None and `reliability_note` says why — never silently falls back to
raw latest EPS as if it were normalized.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from enum import Enum
from typing import Optional

from app.services.valuation.nuvos_engine.classification import LynchCategory
from app.services.valuation.numeric_helpers import weighted_mean
from app.services.quality.deterioration_engine import DeteriorationResult

_MIN_YEARS_FOR_NORMALIZATION = 4
# Where in its own historical margin range current-period margin sits —
# top/bottom deciles read as peak/trough for a Cyclical; a range roughly
# in the middle is Normal. Documented, evidence-anchored bucket edges,
# same "honest v1" disclosure convention as this package's other
# thresholds.
_PEAK_PERCENTILE = 0.85
_TROUGH_PERCENTILE = 0.15

# Phase 1 (Nuvos Fair Value Engine V2, 2026-08-12) — which of
# deterioration_engine's 5 tracked metrics actually prove a DURABLE change
# in earnings power, as opposed to just moving. ROIC and margins measure
# how much the business earns per dollar deployed/sold; revenue and
# FCF-margin are deliberately excluded from this bar — revenue can grow
# while economics get WORSE (subsidized/discounted growth), and FCF margin
# can swing from working-capital timing or capex phasing unrelated to the
# earnings-power question being asked here. Both stay available as
# supporting color in the returned `reason` text, they just don't count
# toward the evidence threshold below.
_STRUCTURAL_METRICS = {"roic", "operating_margin", "net_margin"}
_STRUCTURAL_MIN_MATCHING = 2   # of the 3 profitability metrics available
_STRUCTURAL_MAX_CONTRADICTING = 0  # zero tolerance — this is a stricter bar than Turnaround's "more improving than deteriorating" above, since this decides whether to STOP mean-reverting, not just whether recovery is plausible


class EarningsState(str, Enum):
    NORMAL = "normal"
    ELEVATED = "elevated"
    DEPRESSED = "depressed"
    CYCLICAL_PEAK = "cyclical_peak"
    CYCLICAL_TROUGH = "cyclical_trough"
    RECOVERY = "recovery"
    STRUCTURALLY_IMPAIRED = "structurally_impaired"
    STRUCTURALLY_ELEVATED = "structurally_elevated"
    STRUCTURALLY_DEPRESSED = "structurally_depressed"


@dataclass
class EarningsStateResult:
    state: EarningsState
    normalized_eps: Optional[float]
    reliability_note: Optional[str]
    reason: str
    # Phase 1 — how many of the 3 structural-profitability metrics actually
    # backed a STRUCTURALLY_ELEVATED/DEPRESSED call, so Reality Gate can
    # re-verify the claim instead of trusting the state tag on faith. None
    # for every other state (never set defensively — its presence itself
    # signals "this was a structural claim").
    structural_evidence_count: Optional[int] = None


def _percentile_rank(value: float, series: list[float]) -> float:
    below = sum(1 for v in series if v <= value)
    return below / len(series)


def _structural_profitability_evidence(
    deterioration: Optional[DeteriorationResult], direction: str,
) -> tuple[int, int, list[str]]:
    """Counts how many of {roic, operating_margin, net_margin} moved in
    `direction` ("mejorando"/"deteriorando") vs. how many moved the
    opposite way. Returns (matching, contradicting, matching_reasons) —
    the reasons feed the caller's `reason` string so this is never a
    silent flag with no evidence shown."""
    if deterioration is None:
        return 0, 0, []
    opposite = "deteriorando" if direction == "mejorando" else "mejorando"
    relevant = [f for f in deterioration.factors if f.name in _STRUCTURAL_METRICS]
    matching = [f for f in relevant if f.direction == direction]
    contradicting = [f for f in relevant if f.direction == opposite]
    return len(matching), len(contradicting), [f.reason for f in matching]


def _is_structural(deterioration: Optional[DeteriorationResult], direction: str) -> bool:
    matching, contradicting, _ = _structural_profitability_evidence(deterioration, direction)
    return matching >= _STRUCTURAL_MIN_MATCHING and contradicting <= _STRUCTURAL_MAX_CONTRADICTING


def _recency_weighted_normalized_eps(values: list[float]) -> float:
    """Linear-ramp recency weighting (oldest=1 ... newest=N) — the
    simplest defensible tilt toward the years that actually belong to the
    now-evidenced structural regime, without collapsing to "just use the
    latest EPS" (which would defeat the point of normalizing at all). No
    decay constant to justify beyond the linear ramp — an exponential
    weighting would need one, with no backtested basis to anchor it yet;
    same "honest v1, not backtested" disclosure as this module's other
    thresholds."""
    weighted = [(v, i + 1) for i, v in enumerate(values)]
    result = weighted_mean(weighted)
    assert result is not None  # weighted is never empty when this is called
    return result


def detect_earnings_state(
    *,
    eps_trend: list[Optional[float]],
    net_margin_trend: list[Optional[float]],
    category: LynchCategory,
    latest_eps: Optional[float],
    deterioration: Optional[DeteriorationResult] = None,
) -> EarningsStateResult:
    """Single entry point. `eps_trend`/`net_margin_trend` are ordered
    oldest-to-newest, same convention as every other trend array in this
    codebase (`quality_engine.compute_cagr_windows`)."""
    valid_eps = [v for v in eps_trend if v is not None]
    valid_margin = [v for v in net_margin_trend if v is not None]

    if len(valid_eps) < _MIN_YEARS_FOR_NORMALIZATION or len(valid_margin) < _MIN_YEARS_FOR_NORMALIZATION:
        note = (
            f"Historial insuficiente ({len(valid_eps)} años de EPS, {len(valid_margin)} de margen neto; "
            f"se requieren al menos {_MIN_YEARS_FOR_NORMALIZATION}) para normalizar ganancias con confianza."
        )
        state = EarningsState.STRUCTURALLY_IMPAIRED if (latest_eps is not None and latest_eps <= 0) else EarningsState.NORMAL
        return EarningsStateResult(
            state=state, normalized_eps=None, reliability_note=note,
            reason="Sin normalización — historial insuficiente; se usará el EPS reportado con confianza reducida, nunca como si fuera 'normalizado'.",
        )

    if category == LynchCategory.CYCLICAL:
        current_margin = valid_margin[-1]
        rank = _percentile_rank(current_margin, valid_margin)
        mid_cycle_margin = statistics.median(valid_margin)
        current_revenue_implied = valid_eps[-1] / current_margin if current_margin else None
        normalized = round(current_revenue_implied * mid_cycle_margin, 2) if current_revenue_implied is not None else None
        if rank >= _PEAK_PERCENTILE:
            return EarningsStateResult(
                state=EarningsState.CYCLICAL_PEAK, normalized_eps=normalized, reliability_note=None,
                reason=f"Margen neto actual ({current_margin:.1f}%) está en el percentil {rank*100:.0f} de su propio historial — pico de ciclo. EPS normalizado usando el margen mediano histórico ({mid_cycle_margin:.1f}%), no el margen pico.",
            )
        if rank <= _TROUGH_PERCENTILE:
            return EarningsStateResult(
                state=EarningsState.CYCLICAL_TROUGH, normalized_eps=normalized, reliability_note=None,
                reason=f"Margen neto actual ({current_margin:.1f}%) está en el percentil {rank*100:.0f} de su propio historial — valle de ciclo. EPS normalizado usando el margen mediano histórico ({mid_cycle_margin:.1f}%), no el margen deprimido.",
            )
        return EarningsStateResult(
            state=EarningsState.NORMAL, normalized_eps=normalized, reliability_note=None,
            reason=f"Margen neto actual ({current_margin:.1f}%) está dentro del rango medio de su propio historial (percentil {rank*100:.0f}) — ganancias normales para un negocio cíclico.",
        )

    if category == LynchCategory.TURNAROUND:
        depressed_base = latest_eps is not None and latest_eps <= 0
        improving = deterioration is not None and deterioration.has_any_signal and deterioration.improving_count >= 2 and deterioration.improving_count > deterioration.deteriorating_count
        if depressed_base and improving:
            return EarningsStateResult(
                state=EarningsState.RECOVERY, normalized_eps=None, reliability_note=(
                    "Evidencia real de mejora reciente, pero no hay suficiente historial de una recuperación "
                    "completa para fabricar un EPS normalizado creíble — se reporta como Recovery con Fair Value "
                    "de baja confiabilidad en vez de inventar una cifra."
                ),
                reason=f"{deterioration.improving_count} factor(es) mejorando vs. {deterioration.deteriorating_count} deteriorando, desde una base deprimida/negativa.",
            )
        return EarningsStateResult(
            state=EarningsState.STRUCTURALLY_IMPAIRED, normalized_eps=None,
            reliability_note="Ganancias deprimidas o negativas sin evidencia clara de recuperación — no se puede normalizar de forma confiable.",
            reason="Turnaround sin señal de mejora consistente.",
        )

    # Non-cyclical, non-turnaround categories: compare latest EPS to its
    # own recent average rather than assuming it's automatically "normal."
    # Baseline excludes the current/latest year itself — averaging it in
    # (the original v1 bug) partially dilutes the very distortion it's
    # meant to correct for instead of measuring against an independent
    # prior baseline.
    baseline_years = valid_eps[:-1]
    baseline_window = baseline_years[-min(5, len(baseline_years)):]
    recent_avg = statistics.mean(baseline_window)
    if latest_eps is None or recent_avg == 0:
        return EarningsStateResult(
            state=EarningsState.NORMAL, normalized_eps=latest_eps, reliability_note=None,
            reason="Sin base suficiente para comparar contra el promedio reciente — se usa el EPS reportado.",
        )
    deviation_pct = (latest_eps - recent_avg) / abs(recent_avg) * 100
    # A baseline window that mixes profit and loss years isn't a stable
    # "normal" regime to average into a single figure — e.g. UBER's
    # 2019-2021 losses and 2024 spike both stem from the same source
    # (equity-method mark-to-market on Aurora/Didi/Grab, unrelated to core
    # ride-hailing/delivery economics), so blending them produces a number
    # that represents neither the loss years nor the current year
    # honestly. Confirmed live 2026-08-12 investigating UBER's Fair Value.
    baseline_mixed_regime = any(v <= 0 for v in baseline_window) and any(v > 0 for v in baseline_window)
    if deviation_pct >= 30:
        # Phase 1 (Nuvos Fair Value Engine V2) — before assuming this is a
        # transient spike to be mean-reverted, ask whether the business's
        # own economics (ROIC, margins) have genuinely, durably improved.
        # This is the direct fix for the Copart-style case: a business that
        # got structurally better must not get dragged back down to a
        # historical average that no longer reflects its real earning
        # power. Checked BEFORE baseline_mixed_regime deliberately — a
        # mixed-regime baseline (loss years + profit years) can still
        # coexist with real structural evidence (e.g. a genuine turnaround
        # into sustainably higher ROIC), in which case only the loss years
        # get excluded below, not the whole normalization.
        if _is_structural(deterioration, "mejorando"):
            matching, _, matching_reasons = _structural_profitability_evidence(deterioration, "mejorando")
            window = baseline_window + [latest_eps]
            eligible = [v for v in window if v > 0] if baseline_mixed_regime else window
            normalized = round(_recency_weighted_normalized_eps(eligible), 2) if eligible else None
            return EarningsStateResult(
                state=EarningsState.STRUCTURALLY_ELEVATED, normalized_eps=normalized,
                reliability_note=(
                    "Base excluye años de pérdida de un régimen distinto — ver evidencia de mejora estructural en 'reason'."
                    if baseline_mixed_regime and normalized is not None else None
                ),
                reason=(
                    f"EPS actual ({latest_eps}) está {deviation_pct:+.0f}% por encima del promedio histórico, pero "
                    f"{matching} de 3 métricas de rentabilidad (ROIC, margen operativo, margen neto) muestran mejora "
                    f"estructural real, sin ninguna en dirección contraria: {' | '.join(matching_reasons)}. Se trata "
                    f"como mejora estructural, no como pico transitorio — el EPS normalizado usa un promedio "
                    f"ponderado hacia los años recientes en vez de revertir a la media histórica completa."
                ),
                structural_evidence_count=matching,
            )
        if baseline_mixed_regime:
            return EarningsStateResult(
                state=EarningsState.ELEVATED, normalized_eps=None,
                reliability_note=(
                    f"EPS actual ({latest_eps}) está {deviation_pct:+.0f}% por encima del promedio de años previos, pero esos años "
                    f"mezclan pérdidas y ganancias — no son un régimen estable del que derivar una base normalizada confiable. Se "
                    f"reporta como ganancias elevadas sin normalizar en vez de promediar años que no son comparables entre sí."
                ),
                reason=f"EPS actual ({latest_eps}) está {deviation_pct:+.0f}% por encima del promedio de los últimos {len(baseline_window)} años previos — ganancias elevadas, base histórica no confiable para normalizar.",
            )
        return EarningsStateResult(
            state=EarningsState.ELEVATED, normalized_eps=round(recent_avg, 2), reliability_note=None,
            reason=f"EPS actual ({latest_eps}) está {deviation_pct:+.0f}% por encima del promedio de los últimos {len(baseline_window)} años previos — ganancias elevadas; se usa ese promedio como base normalizada.",
        )
    if deviation_pct <= -30:
        # Symmetric to the ELEVATED case above — a genuinely eroding
        # business must not get mean-reverted UP to a stale historical
        # average that no longer reflects its real (now worse) earning
        # power.
        if _is_structural(deterioration, "deteriorando"):
            matching, _, matching_reasons = _structural_profitability_evidence(deterioration, "deteriorando")
            window = baseline_window + [latest_eps]
            eligible = [v for v in window if v > 0] if baseline_mixed_regime else window
            normalized = round(_recency_weighted_normalized_eps(eligible), 2) if eligible else None
            return EarningsStateResult(
                state=EarningsState.STRUCTURALLY_DEPRESSED, normalized_eps=normalized,
                reliability_note=(
                    "Base excluye años de pérdida de un régimen distinto — ver evidencia de deterioro estructural en 'reason'."
                    if baseline_mixed_regime and normalized is not None else None
                ),
                reason=(
                    f"EPS actual ({latest_eps}) está {deviation_pct:+.0f}% por debajo del promedio histórico, pero "
                    f"{matching} de 3 métricas de rentabilidad (ROIC, margen operativo, margen neto) muestran deterioro "
                    f"estructural real, sin ninguna en dirección contraria: {' | '.join(matching_reasons)}. Se trata "
                    f"como deterioro estructural, no como valle transitorio — el EPS normalizado usa un promedio "
                    f"ponderado hacia los años recientes en vez de revertir a una media histórica que ya no refleja "
                    f"la economía real del negocio."
                ),
                structural_evidence_count=matching,
            )
        if baseline_mixed_regime:
            return EarningsStateResult(
                state=EarningsState.DEPRESSED, normalized_eps=None,
                reliability_note=(
                    f"EPS actual ({latest_eps}) está {deviation_pct:+.0f}% por debajo del promedio de años previos, pero esos años "
                    f"mezclan pérdidas y ganancias — no son un régimen estable del que derivar una base normalizada confiable. Se "
                    f"reporta como ganancias deprimidas sin normalizar en vez de promediar años que no son comparables entre sí."
                ),
                reason=f"EPS actual ({latest_eps}) está {deviation_pct:+.0f}% por debajo del promedio de los últimos {len(baseline_window)} años previos — ganancias deprimidas, base histórica no confiable para normalizar.",
            )
        return EarningsStateResult(
            state=EarningsState.DEPRESSED, normalized_eps=round(recent_avg, 2), reliability_note=None,
            reason=f"EPS actual ({latest_eps}) está {deviation_pct:+.0f}% por debajo del promedio de los últimos {len(baseline_window)} años previos — ganancias deprimidas; se usa ese promedio como base normalizada.",
        )
    return EarningsStateResult(
        state=EarningsState.NORMAL, normalized_eps=round(latest_eps, 2), reliability_note=None,
        reason=f"EPS actual ({latest_eps}) está en línea con el promedio de los últimos {len(baseline_window)} años previos ({deviation_pct:+.0f}%) — ganancias normales.",
    )
