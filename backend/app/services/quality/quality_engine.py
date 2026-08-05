"""
Quality Engine — Fase 2, Incremento 2 (Parte A — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

100% quantitative, zero AI, zero price/DCF/multiples. Answers "how good is
this business, purely from its own operating and financial record" — a
question completely independent of what the market currently pays for it.
A company can score high here and be expensive, or score low and be cheap;
this engine has no opinion on either.

Reuses `valuation.numeric_helpers` (`_score`, `_cagr`,
`_coefficient_of_variation`) and `valuation.robustness` (`safe_divide`,
`clamp`) — the exact primitives Fase 1 already built and tested. No
duplicated scoring math between the two packages.

Deliberately does NOT classify trend DIRECTION (expanding vs.
deteriorating) — that's the Deterioration Engine's job (Incremento 10).
This engine measures LEVEL (how good, on average/most-recently) and
STABILITY (how consistent via coefficient of variation), never direction —
a clean separation of concerns so "is ROIC volatile" isn't computed twice
by two different engines with two different formulas.

Every score is fully explainable: `QualityScoreResult.factors` lists every
individual metric that fed the score, its raw value, its own 0-100
sub-score, and a plain-language reason — never a black box (brief rule 6).
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Optional

from app.services.valuation.numeric_helpers import _score, _cagr, _coefficient_of_variation
from app.services.valuation.robustness import safe_divide


def _latest(trend: list[Optional[float]]) -> Optional[float]:
    return next((v for v in reversed(trend) if v is not None), None)


def _avg(trend: list[Optional[float]]) -> Optional[float]:
    valid = [v for v in trend if v is not None]
    return statistics.mean(valid) if valid else None


# ── New ratio calculators (not computed anywhere else in the codebase) ────

def compute_roce(
    operating_income: Optional[float], total_assets: Optional[float], current_liabilities: Optional[float],
) -> Optional[float]:
    """ROCE = EBIT / (Total Assets − Current Liabilities), as a percent.
    Uses Operating Income as the EBIT proxy (same convention this codebase
    already uses for NOPAT/ROIC). Distinct from ROIC: ROIC nets out ALL
    interest-bearing debt and cash from invested capital; ROCE nets out
    only current liabilities — a different, standard capital-efficiency
    lens, not a restatement of ROIC."""
    if operating_income is None or total_assets is None or current_liabilities is None:
        return None
    capital_employed = total_assets - current_liabilities
    result = safe_divide(operating_income, capital_employed)
    return round(result * 100, 1) if result is not None else None


def compute_incremental_roic(
    nopat_trend: list[Optional[float]], invested_capital_trend: list[Optional[float]],
) -> Optional[float]:
    """(NOPAT_latest − NOPAT_oldest) / (InvestedCapital_latest −
    InvestedCapital_oldest), as a percent — the return on NEW capital
    deployed since the oldest available year. A materially different
    signal than the ROIC trend's level: a business can have a high but
    STATIC ROIC (capital already deployed years ago stays productive) or a
    high INCREMENTAL ROIC (every new dollar reinvested also earns well,
    which is what actually justifies continued growth/reinvestment).
    Returns None with fewer than 2 real data points, or if the capital
    base didn't grow — "return on incremental capital" is undefined (not
    zero) when there was no real incremental capital."""
    pairs = [(n, c) for n, c in zip(nopat_trend, invested_capital_trend) if n is not None and c is not None]
    if len(pairs) < 2:
        return None
    nopat_oldest, capital_oldest = pairs[0]
    nopat_latest, capital_latest = pairs[-1]
    delta_capital = capital_latest - capital_oldest
    if delta_capital <= 0:
        return None
    result = safe_divide(nopat_latest - nopat_oldest, delta_capital)
    return round(result * 100, 1) if result is not None else None


def compute_current_ratio(current_assets: Optional[float], current_liabilities: Optional[float]) -> Optional[float]:
    if current_assets is None or current_liabilities is None:
        return None
    result = safe_divide(current_assets, current_liabilities)
    return round(result, 2) if result is not None else None


def compute_quick_ratio(
    current_assets: Optional[float], inventory: Optional[float], current_liabilities: Optional[float],
) -> Optional[float]:
    """(Current Assets − Inventory) / Current Liabilities — excludes the
    least-liquid current asset (inventory can't reliably be converted to
    cash on short notice), a stricter solvency test than the Current
    Ratio. `inventory` defaults to 0 when None (e.g. a software company
    genuinely carries none) rather than making the whole ratio
    uncomputable."""
    if current_assets is None or current_liabilities is None:
        return None
    quick_assets = current_assets - (inventory or 0)
    result = safe_divide(quick_assets, current_liabilities)
    return round(result, 2) if result is not None else None


def compute_net_debt_to_ebitda(
    total_debt: Optional[float], cash: Optional[float], ebitda: Optional[float],
) -> Optional[float]:
    """(Total Debt − Cash) / EBITDA — the standard leverage-coverage
    multiple (how many years of EBITDA to pay off net debt). None when
    EBITDA isn't positive — the ratio is not economically meaningful for
    an EBITDA-negative company."""
    if total_debt is None or cash is None or ebitda is None or ebitda <= 0:
        return None
    result = safe_divide(total_debt - cash, ebitda)
    return round(result, 2) if result is not None else None


def compute_cagr_windows(trend: list[Optional[float]], windows: tuple[int, ...] = (3, 5, 10)) -> dict[str, Optional[float]]:
    """CAGR over the last N years for each window in `windows` — never
    relies on a single (potentially unusual) full-history start/end pair
    the way one plain CAGR can be. `trend` must be ordered oldest-to-newest
    (same convention as every other trend array in this codebase). A
    window longer than the available history returns None for that key
    rather than silently substituting a shorter period under the same
    label — brief rule: "no depender únicamente de un período."""
    result: dict[str, Optional[float]] = {}
    for w in windows:
        key = f"{w}y"
        if len(trend) <= w:
            result[key] = None
            continue
        first, last = trend[-(w + 1)], trend[-1]
        result[key] = _cagr(first, last, w) if first is not None and last is not None else None
    return result


# ── Explainability + score aggregation ──────────────────────────────────────

@dataclass
class QualityFactor:
    name: str
    value: Optional[float]
    score: Optional[float]
    reason: str


@dataclass
class QualityScoreResult:
    quality_score: int
    profitability_score: Optional[float]
    margins_score: Optional[float]
    cash_flow_score: Optional[float]
    growth_score: Optional[float]
    balance_sheet_score: Optional[float]
    factors: list[QualityFactor] = field(default_factory=list)

    @property
    def has_any_signal(self) -> bool:
        """False only when EVERY sub-pillar was uncomputable (no real data
        at all) — lets a caller distinguish "genuinely nothing to show"
        from "computed a real (possibly low) score of 0." Callers that
        blend this into a further weighted average (e.g. the NIF overall
        score) should treat `has_any_signal=False` as None, not as a real
        0 — a real 0 unfairly drags a blend down; genuinely missing data
        should just be excluded and the remaining weights renormalized."""
        return any(s is not None for s in (
            self.profitability_score, self.margins_score, self.cash_flow_score,
            self.growth_score, self.balance_sheet_score,
        ))


# Same-shaped tiers as the existing ROIC-based scores elsewhere in this
# codebase (fundamental_analysis_service.py's roic_score) — reused for
# ROE/ROA/ROCE too since they're all "return on X" percentages in a
# comparable range, so a 15% ROIC and a 15% ROE mean roughly the same
# thing quality-wise. Kept as one shared tier table to avoid four near-
# duplicate tier lists that could quietly drift apart.
_RETURN_ON_CAPITAL_TIERS = [(4, 20), (7, 40), (10, 55), (15, 70), (20, 85), (999, 95)]
_MARGIN_LEVEL_TIERS = [(0, 10), (10, 35), (15, 55), (20, 70), (30, 85), (999, 95)]
_GROWTH_TIERS = [(0, 15), (5, 40), (10, 60), (15, 75), (20, 88), (999, 95)]
_CURRENT_RATIO_TIERS = [(0.8, 15), (1.0, 35), (1.5, 65), (2.5, 85), (999, 90)]
_QUICK_RATIO_TIERS = [(0.5, 15), (0.8, 40), (1.0, 65), (1.5, 85), (999, 90)]
_NET_DEBT_EBITDA_TIERS = [(0, 90), (1, 80), (2, 60), (4, 35), (999, 15)]  # lower leverage = higher score
_STABILITY_CV_TIERS = [(0.10, 95), (0.25, 80), (0.45, 60), (0.70, 35), (999, 15)]  # lower CV = higher score


def _factor(name: str, value: Optional[float], score: Optional[float], reason: str) -> QualityFactor:
    return QualityFactor(name=name, value=value, score=score, reason=reason)


def _weighted_mean(scored: list[tuple[Optional[float], float]]) -> Optional[float]:
    """Mean of (score, weight) pairs, skipping any with score=None and
    renormalizing by the weights actually used — same "missing components
    don't silently count as zero" philosophy as
    consensus_valuation_service.compute_consensus_fair_value."""
    present = [(s, w) for s, w in scored if s is not None]
    if not present:
        return None
    total_weight = sum(w for _, w in present)
    return sum(s * w for s, w in present) / total_weight


def compute_quality_score(
    *,
    roic_trend: list[Optional[float]], roe_trend: list[Optional[float]], roa_trend: list[Optional[float]],
    nopat_trend: list[Optional[float]], invested_capital_trend: list[Optional[float]],
    operating_income_latest: Optional[float], total_assets_latest: Optional[float],
    current_liabilities_latest: Optional[float], current_assets_latest: Optional[float],
    inventory_latest: Optional[float],
    gross_margin_trend: list[Optional[float]], operating_margin_trend: list[Optional[float]],
    net_margin_trend: list[Optional[float]], fcf_margin_trend: list[Optional[float]],
    fcf_trend: list[Optional[float]], net_income_trend: list[Optional[float]],
    revenue_trend: list[Optional[float]], eps_trend: list[Optional[float]],
    total_debt: Optional[float], cash: Optional[float], ebitda_latest: Optional[float],
    interest_coverage: Optional[float] = None,
) -> QualityScoreResult:
    """The single entry point: takes already-computed real trends (the
    exact same arrays `get_fundamental_analysis()` already produces, plus
    the new ones added in this increment) and returns a fully-explained
    0-100 Quality Score. Deliberately takes plain data, not a ticker or an
    API call — same "pure function over real inputs" pattern
    `valuation.dcf_engine` already established, so this is independently
    testable with synthetic data and has zero network/DB dependency."""
    factors: list[QualityFactor] = []

    # ── Profitability ────────────────────────────────────────────────────
    roic_latest = _latest(roic_trend)
    roe_latest = _latest(roe_trend)
    roa_latest = _latest(roa_trend)
    roce = compute_roce(operating_income_latest, total_assets_latest, current_liabilities_latest)
    incremental_roic = compute_incremental_roic(nopat_trend, invested_capital_trend)

    roic_score = _score(roic_latest, _RETURN_ON_CAPITAL_TIERS)
    roe_score = _score(roe_latest, _RETURN_ON_CAPITAL_TIERS)
    roa_score = _score(roa_latest, _RETURN_ON_CAPITAL_TIERS)
    roce_score = _score(roce, _RETURN_ON_CAPITAL_TIERS)
    incremental_roic_score = _score(incremental_roic, _RETURN_ON_CAPITAL_TIERS)

    factors.append(_factor("roic", roic_latest, roic_score, f"ROIC más reciente: {roic_latest}%." if roic_latest is not None else "ROIC no disponible."))
    factors.append(_factor("roe", roe_latest, roe_score, f"ROE más reciente: {roe_latest}%." if roe_latest is not None else "ROE no disponible."))
    factors.append(_factor("roa", roa_latest, roa_score, f"ROA más reciente: {roa_latest}%." if roa_latest is not None else "ROA no disponible."))
    factors.append(_factor("roce", roce, roce_score, f"ROCE (EBIT / Capital Empleado): {roce}%." if roce is not None else "ROCE no disponible (falta EBIT, activos o pasivos corrientes)."))
    factors.append(_factor(
        "incremental_roic", incremental_roic, incremental_roic_score,
        f"Retorno sobre el capital NUEVO invertido desde el año más antiguo disponible: {incremental_roic}%."
        if incremental_roic is not None else "ROIC incremental no disponible (capital invertido no creció, o datos insuficientes).",
    ))
    profitability_score = _weighted_mean([
        (roic_score, 0.30), (roe_score, 0.20), (roa_score, 0.15), (roce_score, 0.20), (incremental_roic_score, 0.15),
    ])

    # ── Margins (level + stability, never direction) ────────────────────
    margin_defs = [
        ("gross_margin", gross_margin_trend), ("operating_margin", operating_margin_trend),
        ("net_margin", net_margin_trend), ("fcf_margin", fcf_margin_trend),
    ]
    margin_scores: list[tuple[Optional[float], float]] = []
    for name, trend in margin_defs:
        latest = _latest(trend)
        level_score = _score(latest, _MARGIN_LEVEL_TIERS)
        cv = _coefficient_of_variation(trend)
        stability_score = _score(cv, _STABILITY_CV_TIERS)
        combined = _weighted_mean([(level_score, 0.7), (stability_score, 0.3)])
        margin_scores.append((combined, 0.25))
        factors.append(_factor(
            f"{name}_level", latest, level_score,
            f"{name.replace('_', ' ').title()} más reciente: {latest}%." if latest is not None else f"{name.replace('_', ' ').title()} no disponible.",
        ))
        factors.append(_factor(
            f"{name}_stability", round(cv, 2) if cv is not None else None, stability_score,
            f"Estabilidad histórica del {name.replace('_', ' ')} (coeficiente de variación {round(cv, 2)}) — más bajo es más estable." if cv is not None else "Estabilidad no evaluable (menos de 3 años de datos).",
        ))
    margins_score = _weighted_mean(margin_scores)

    # ── Cash flow (growth, stability, conversion) ────────────────────────
    fcf_cv = _coefficient_of_variation(fcf_trend)
    fcf_stability_score = _score(fcf_cv, _STABILITY_CV_TIERS)
    latest_fcf, latest_ni = _latest(fcf_trend), _latest(net_income_trend)
    fcf_conversion = safe_divide(latest_fcf, latest_ni) if latest_fcf is not None and latest_ni is not None and latest_ni > 0 else None
    fcf_conversion_pct = round(fcf_conversion * 100, 1) if fcf_conversion is not None else None
    # Conversion tiers: &lt;50% (earnings not backed by cash) scores low,
    # 80-130% is the healthy band, &gt;130% sustained (e.g. heavy D&A vs.
    # capex) still scores well but isn't rewarded further past that.
    fcf_conversion_score = _score(fcf_conversion_pct, [(50, 25), (70, 50), (80, 75), (130, 95), (999, 85)]) if fcf_conversion_pct is not None else None
    factors.append(_factor(
        "fcf_stability", round(fcf_cv, 2) if fcf_cv is not None else None, fcf_stability_score,
        f"Estabilidad histórica del FCF (coeficiente de variación {round(fcf_cv, 2)})." if fcf_cv is not None else "Estabilidad de FCF no evaluable (menos de 3 años de datos).",
    ))
    factors.append(_factor(
        "fcf_conversion", fcf_conversion_pct, fcf_conversion_score,
        f"FCF / Utilidad Neta: {fcf_conversion_pct}% — mide si las ganancias reportadas se convierten en efectivo real." if fcf_conversion_pct is not None else "FCF/Utilidad Neta no disponible.",
    ))
    cash_flow_score = _weighted_mean([(fcf_stability_score, 0.5), (fcf_conversion_score, 0.5)])

    # ── Growth (3/5/10y windows, never a single period) ──────────────────
    growth_scores: list[tuple[Optional[float], float]] = []
    for name, trend in [("revenue", revenue_trend), ("eps", eps_trend), ("fcf", fcf_trend)]:
        windows = compute_cagr_windows(trend)
        window_scores = {k: _score(v, _GROWTH_TIERS) for k, v in windows.items()}
        combined = _weighted_mean([(s, 1.0) for s in window_scores.values()])
        growth_scores.append((combined, 1.0))
        for w_key, w_val in windows.items():
            factors.append(_factor(
                f"{name}_cagr_{w_key}", w_val, window_scores[w_key],
                f"CAGR de {name.upper()} a {w_key}: {w_val}%." if w_val is not None else f"CAGR de {name.upper()} a {w_key} no disponible (historial insuficiente).",
            ))
    growth_score = _weighted_mean(growth_scores)

    # ── Balance sheet (liquidity + leverage) ─────────────────────────────
    current_ratio = compute_current_ratio(current_assets_latest, current_liabilities_latest)
    quick_ratio = compute_quick_ratio(current_assets_latest, inventory_latest, current_liabilities_latest)
    net_debt_to_ebitda = compute_net_debt_to_ebitda(total_debt, cash, ebitda_latest)
    current_ratio_score = _score(current_ratio, _CURRENT_RATIO_TIERS)
    quick_ratio_score = _score(quick_ratio, _QUICK_RATIO_TIERS)
    net_debt_score = _score(net_debt_to_ebitda, _NET_DEBT_EBITDA_TIERS)
    interest_coverage_score = _score(interest_coverage, [(1, 15), (2, 35), (4, 55), (8, 75), (15, 88), (999, 95)]) if interest_coverage is not None else None

    factors.append(_factor("current_ratio", current_ratio, current_ratio_score, f"Current Ratio: {current_ratio}x." if current_ratio is not None else "Current Ratio no disponible."))
    factors.append(_factor("quick_ratio", quick_ratio, quick_ratio_score, f"Quick Ratio: {quick_ratio}x." if quick_ratio is not None else "Quick Ratio no disponible."))
    factors.append(_factor("net_debt_to_ebitda", net_debt_to_ebitda, net_debt_score, f"Deuda Neta / EBITDA: {net_debt_to_ebitda}x." if net_debt_to_ebitda is not None else "Deuda Neta/EBITDA no disponible."))
    if interest_coverage is not None:
        factors.append(_factor("interest_coverage", interest_coverage, interest_coverage_score, f"Cobertura de intereses: {interest_coverage}x."))

    balance_sheet_score = _weighted_mean([
        (current_ratio_score, 0.25), (quick_ratio_score, 0.25), (net_debt_score, 0.30), (interest_coverage_score, 0.20),
    ])

    # ── Final blend ───────────────────────────────────────────────────────
    quality_score_raw = _weighted_mean([
        (profitability_score, 0.30), (margins_score, 0.25), (cash_flow_score, 0.20),
        (growth_score, 0.15), (balance_sheet_score, 0.10),
    ])
    quality_score = round(quality_score_raw) if quality_score_raw is not None else 0

    return QualityScoreResult(
        quality_score=quality_score,
        profitability_score=round(profitability_score, 1) if profitability_score is not None else None,
        margins_score=round(margins_score, 1) if margins_score is not None else None,
        cash_flow_score=round(cash_flow_score, 1) if cash_flow_score is not None else None,
        growth_score=round(growth_score, 1) if growth_score is not None else None,
        balance_sheet_score=round(balance_sheet_score, 1) if balance_sheet_score is not None else None,
        factors=factors,
    )


def build_quality_score_from_analysis(data: dict) -> QualityScoreResult:
    """Extracts every input `compute_quality_score` needs directly from
    `get_fundamental_analysis()`'s full return dict, and calls it. This is
    the ONE place that extraction logic lives — both
    `screener.py::_build_quick_analysis` (Fase 2 Incremento 2) and
    `nif_service.py::build_nif_dashboard` (Incremento 3, replacing the
    NIF's own `business_quality` formula) call this instead of each
    re-deriving the same field lookups, per the brief's explicit
    "no dupliques lógica" rule.

    `fcf_margin_trend` is derived here (fcf_trend / revenue_trend per
    year) since it isn't stored as its own array on `data` — cheaper than
    adding a 5th margin trend to fundamental_analysis_service.py for two
    callers that can trivially derive it from two trends that already
    exist there."""
    def latest_of(key: str) -> Optional[float]:
        trend = data.get(key) or []
        return next((v for v in reversed(trend) if v is not None), None)

    fcf_trend = data.get("fcf_trend") or []
    revenue_trend = data.get("revenue_trend") or []
    fcf_margin_trend = [
        round(f / r * 100, 1) if f is not None and r else None for f, r in zip(fcf_trend, revenue_trend)
    ]
    latest_om = latest_of("operating_margin_trend")
    latest_rev = latest_of("revenue_trend")
    operating_income_latest = (latest_om / 100 * latest_rev) if latest_om is not None and latest_rev else None

    dcf = data.get("dcf") or {}
    return compute_quality_score(
        roic_trend=data.get("roic_trend") or [], roe_trend=data.get("roe_trend") or [], roa_trend=data.get("roa_trend") or [],
        nopat_trend=data.get("nopat_trend") or [], invested_capital_trend=data.get("invested_capital_trend") or [],
        operating_income_latest=operating_income_latest,
        total_assets_latest=latest_of("total_assets_trend"),
        current_liabilities_latest=latest_of("current_liabilities_trend"),
        current_assets_latest=latest_of("current_assets_trend"),
        inventory_latest=latest_of("inventory_trend"),
        gross_margin_trend=data.get("gross_margin_trend") or [], operating_margin_trend=data.get("operating_margin_trend") or [],
        net_margin_trend=data.get("net_margin_trend") or [], fcf_margin_trend=fcf_margin_trend,
        fcf_trend=fcf_trend, net_income_trend=data.get("net_income_trend") or [],
        revenue_trend=revenue_trend, eps_trend=data.get("eps_trend") or [],
        total_debt=dcf.get("total_debt"), cash=dcf.get("cash"), ebitda_latest=data.get("ebitda"),
        interest_coverage=data.get("interest_coverage"),
    )
