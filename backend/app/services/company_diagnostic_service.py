"""
Company Diagnostic Service — real-data backing for the web
`CompanyDiagnosticCard` component (frontend/web/src/components/subvaluadas/
CompanyDiagnosticCard.tsx). See /Users/diegoarria/.claude/plans/
cosmic-munching-crown.md for the full design rationale.

Everything in this module is deterministic — zero AI, zero new network
calls beyond the two `get_fundamental_analysis()` calls (target company +
one competitor) this module itself makes. The one genuinely new AI call
this feature needs (`investmentThesis`/`noiseVsReality`/`actionPlan`) lives
in `ai_service.generate_company_diagnostic_narrative()` and is invoked by
the caller (the API route), not here — this module's own output is a
complete, valid `CompanyDiagnosticData` shape MINUS those 3 narrative
fields, which the caller fills in afterward.

Every templated string here has an English variant selected by `lang`
(default "es") — this is the one deterministic-reasoning module in the
codebase whose output renders directly in the UI's own language toggle
(`CompanyDiagnosticCard.tsx`), unlike `outlier_detection_engine.py`'s
`detail` strings etc., which stay Spanish-only because nothing downstream
of them is locale-aware.
"""

from __future__ import annotations

import logging
import statistics
from typing import Optional

from app.services.fundamental_analysis_service import get_fundamental_analysis
from app.services.relative_valuation_service import _find_peers
from app.services.quality.moat_engine import compute_moat_score

logger = logging.getLogger(__name__)

_COMPETITOR_METRICS_ES = [
    ("Deuda Financiera", "total_debt"),
    ("Margen Operativo", "operating_margin_pct"),
    ("Margen Neto", "net_margin_pct"),
    ("ROIC", "roic_pct"),
    ("Crecimiento de Ingresos", "revenue_cagr_pct"),
]
_COMPETITOR_METRICS_EN = [
    ("Financial Debt", "total_debt"),
    ("Operating Margin", "operating_margin_pct"),
    ("Net Margin", "net_margin_pct"),
    ("ROIC", "roic_pct"),
    ("Revenue Growth", "revenue_cagr_pct"),
]


def _competitor_metrics(lang: str) -> list[tuple[str, str]]:
    return _COMPETITOR_METRICS_EN if lang == "en" else _COMPETITOR_METRICS_ES


def _na(lang: str) -> str:
    return "N/A" if lang == "en" else "N/D"


def _fmt_money(v: Optional[float], lang: str = "es") -> str:
    if v is None:
        return _na(lang)
    if abs(v) >= 1e9:
        return f"${v / 1e9:.1f}B"
    if abs(v) >= 1e6:
        return f"${v / 1e6:.0f}M"
    return f"${v:,.0f}"


def _fmt_pct(v: Optional[float], lang: str = "es") -> str:
    return f"{v:.1f}%" if v is not None else _na(lang)


def _primary_scenarios(dcf: dict) -> Optional[dict]:
    """Same GQV-first/DCF-fallback priority as `undervalued_screener_
    service._primary_valuation` — extended here to also carry bear/bull
    (that function only returns the base case) since the diagnostic card's
    thermometer needs all 3. Never re-derives the priority rule itself,
    just applies the identical one."""
    gqv = dcf.get("gqv_fair_value")
    if gqv and gqv.get("status") == "ok" and gqv.get("scenarios"):
        s = gqv["scenarios"]
        bear, base, bull = s.get("bear") or {}, s.get("base") or {}, s.get("bull") or {}
        if base.get("fair_value_per_share") is None:
            return None
        return {
            "bear": bear.get("fair_value_per_share"),
            "base": base.get("fair_value_per_share"),
            "bull": bull.get("fair_value_per_share"),
            "current_price": s.get("current_price"),
            "margin_of_safety_pct": s.get("margin_of_safety_pct"),
            "uncertainty_profile": gqv.get("uncertainty_profile"),
            "reality_gate_pass_rate": (gqv.get("reality_gate") or {}).get("pass_rate"),
            "source": "gqv",
            # Methodology-audit transparency (see /Users/diegoarria/.claude/
            # plans/cosmic-munching-crown.md, point 4) — only real on the
            # GQV path (the legacy DCF branch below has no equivalent).
            "fcf_assumptions": gqv.get("fcf_assumptions"),
            "wacc_details": gqv.get("wacc_details"),
            "pe_on_normalized_eps": gqv.get("pe_on_normalized_eps"),
            "pe_gaap": gqv.get("pe_gaap"),
        }
    legacy = dcf.get("scenarios")
    if legacy and (legacy.get("base") or {}).get("intrinsic_value_per_share") is not None:
        return {
            "bear": (legacy.get("pessimistic") or {}).get("intrinsic_value_per_share"),
            "base": legacy["base"].get("intrinsic_value_per_share"),
            "bull": (legacy.get("optimistic") or {}).get("intrinsic_value_per_share"),
            "current_price": dcf.get("current_price"),
            "margin_of_safety_pct": dcf.get("margin_of_safety_pct"),
            "uncertainty_profile": dcf.get("uncertainty_profile"),
            "reality_gate_pass_rate": None,
            "source": "dcf",
            # Real for the financial-sector Residual Income path (financial_
            # engine.py's own book-value×ROE projection) — was previously
            # never carried here, unlike the GQV branch above, which could
            # 404 the whole card whenever peCurrent/peForward were also both
            # unavailable (confirmed live for BRK.B).
            "pe_on_normalized_eps": dcf.get("pe_on_normalized_eps"),
        }
    return None


def _pillar_scores(data: dict, scenarios: dict) -> Optional[dict]:
    # Read from the unconditional top-level keys (real, always computed),
    # not `thesis_scores` — that dict is only built when the LEGACY DCF
    # produced its own `scenarios` (see fundamental_analysis_service.py's
    # own comment at that gate), which silently excluded every ticker on
    # the GQV-without-DCF fallback path (capital-intensive names like
    # utilities, whose average FCF margin is often negative, plus MU/
    # Micron-style single-bad-year cyclicals) — confirmed live for
    # NEE/SO/DUK during this feature's broader rollout testing.
    quality = data.get("business_quality_score")
    trust = data.get("financial_strength_score")
    if quality is None or trust is None:
        return None

    mos = scenarios.get("margin_of_safety_pct")
    # v2 heuristic — requires empirical validation. 0% margin -> neutral 50;
    # +/-50pp margin -> the 0/100 ends. Same "disclose new heuristics"
    # convention as outlier_detection_engine.py's thresholds.
    value = round(min(100, max(0, 50 + mos))) if mos is not None else None
    if value is None:
        return None

    up = scenarios.get("uncertainty_profile") or {}
    data_conf = (up.get("data_confidence") or {}).get("score")
    rg_pass = scenarios.get("reality_gate_pass_rate")
    simplicity_components = [v for v in (data_conf, rg_pass) if v is not None]
    simplicity = round(sum(simplicity_components) / len(simplicity_components)) if simplicity_components else None
    if simplicity is None:
        return None

    return {"quality": quality, "trust": trust, "value": value, "simplicity": simplicity}


_SCORE_TIER_LABEL_ES = [
    (80, "Calidad Máxima"),
    (60, "Buen Negocio"),
    (40, "Calidad Moderada"),
    (0, "Calidad Débil"),
]
_SCORE_TIER_LABEL_EN = [
    (80, "Top Quality"),
    (60, "Good Business"),
    (40, "Moderate Quality"),
    (0, "Weak Quality"),
]


def _score_label(overall_score: int, mos: Optional[float], lang: str = "es") -> str:
    en = lang == "en"
    tiers = _SCORE_TIER_LABEL_EN if en else _SCORE_TIER_LABEL_ES
    tier = next(label for floor, label in tiers if overall_score >= floor)
    if mos is None:
        return tier
    if mos >= 5:
        return f"{tier} + Discount" if en else f"{tier} + Descuento"
    if mos <= -5:
        return f"{tier}, Expensive" if en else f"{tier}, Cara"
    return f"{tier}, Fair Price" if en else f"{tier}, Precio Justo"


_BADGE_CATALOG_ES = {
    "no_debt": "Cero Deuda", "net_cash": "Caja Neta Fuerte", "roic": "ROIC Excepcional",
    "moat": "Moat Duradero", "margins": "Márgenes Líderes", "discount": "Descuento Significativo",
    "recovery": "Recuperación en Curso", "cyclical": "Ajuste Cíclico Temporal",
}
_BADGE_CATALOG_EN = {
    "no_debt": "Zero Debt", "net_cash": "Strong Net Cash", "roic": "Exceptional ROIC",
    "moat": "Durable Moat", "margins": "Leading Margins", "discount": "Significant Discount",
    "recovery": "Recovery Underway", "cyclical": "Temporary Cyclical Adjustment",
}


def _badges(*, data: dict, scenarios: dict, dcf: dict, lang: str = "es") -> list[str]:
    """Fixed catalog, real numeric triggers, top 3 by priority order — same
    'never ticker-specific' discipline as every engine built this session
    (no `if ticker == X` anywhere)."""
    labels = _BADGE_CATALOG_EN if lang == "en" else _BADGE_CATALOG_ES
    total_debt = data.get("total_debt") or 0.0
    net_cash = data.get("net_cash") or 0.0
    shares_out = (dcf.get("shares_outstanding") or 0.0)
    price = scenarios.get("current_price") or 0.0
    market_cap = shares_out * price if shares_out and price else None
    avg_roic = (dcf.get("growth_buildup") or {}).get("avg_roic_pct")
    mos = scenarios.get("margin_of_safety_pct")
    moat_duration_bucket = ((dcf.get("nuvos_fair_value") or {}).get("moat_duration") or {}).get("bucket")
    earnings_state = ((dcf.get("gqv_fair_value") or {}).get("earnings_state") or {}).get("state")
    industry_benchmarks = dcf.get("industry_benchmarks") or {}
    latest_om = (data.get("operating_margin_trend") or [None])[-1] if data.get("operating_margin_trend") else None
    industry_om = industry_benchmarks.get("median_operating_margin_pct")

    candidates: list[tuple[bool, str]] = [
        (market_cap is not None and total_debt < 0.02 * market_cap, labels["no_debt"]),
        (market_cap is not None and net_cash > 0.10 * market_cap, labels["net_cash"]),
        (avg_roic is not None and avg_roic > 20, labels["roic"]),
        (moat_duration_bucket in ("10_15", "15_plus"), labels["moat"]),
        (latest_om is not None and industry_om is not None and latest_om - industry_om > 10, labels["margins"]),
        (mos is not None and mos >= 25, labels["discount"]),
        (earnings_state in ("recovery",), labels["recovery"]),
        (earnings_state in ("depressed", "cyclical_trough", "structurally_depressed"), labels["cyclical"]),
    ]
    return [name for fires, name in candidates if fires][:3]


def _moat_points(data: dict, dcf: dict, lang: str = "es") -> list[str]:
    industry_benchmarks = dcf.get("industry_benchmarks") or {}
    roic_trend = data.get("roic_trend") or []
    operating_margin_trend = data.get("operating_margin_trend") or []
    gross_margin_trend = data.get("gross_margin_trend") or []
    avg_roic = (dcf.get("growth_buildup") or {}).get("avg_roic_pct")
    om_valid = [v for v in operating_margin_trend if v is not None]
    avg_om = statistics.mean(om_valid) if om_valid else None
    gm_valid = [v for v in gross_margin_trend if v is not None]
    latest_gm = gm_valid[-1] if gm_valid else None

    result = compute_moat_score(
        avg_roic_pct=avg_roic, roic_trend=roic_trend,
        avg_operating_margin_pct=avg_om, operating_margin_trend=operating_margin_trend,
        gross_margin_latest_pct=latest_gm,
        industry_median_roic_pct=industry_benchmarks.get("median_roic_pct"),
        industry_median_operating_margin_pct=industry_benchmarks.get("median_operating_margin_pct"),
        lang=lang,
    )
    return [f.reason for f in result.factors if f.reason][:3]


def _competitor_metric_values(data: dict, dcf: dict, scenarios: Optional[dict]) -> dict:
    thesis_scores = data.get("thesis_scores") or {}
    return {
        "total_debt": data.get("total_debt"),
        "operating_margin_pct": (data.get("operating_margin_trend") or [None])[-1] if data.get("operating_margin_trend") else None,
        "net_margin_pct": (data.get("net_margin_trend") or [None])[-1] if data.get("net_margin_trend") else None,
        "roic_pct": (dcf.get("growth_buildup") or {}).get("avg_roic_pct"),
        "revenue_cagr_pct": data.get("revenue_cagr_pct"),
    }


def _competitor_comparison(ticker: str, data: dict, dcf: dict, scenarios: Optional[dict], sector: Optional[str], industry: Optional[str], lang: str = "es") -> Optional[dict]:
    """Picks the first same-industry peer from `_find_peers()` (not a
    market-cap-nearest search across the whole peer group — that would mean
    fetching every peer's real financials just to rank them, real extra
    cost for a UI nicety). Every row value and narrative note is a
    templated sentence off REAL numbers from both companies — zero AI."""
    peers = _find_peers(ticker, sector, industry, limit=3)
    competitor_ticker = next((p for p in peers if p != ticker.upper()), None)
    if not competitor_ticker:
        return None
    try:
        competitor_data = get_fundamental_analysis(competitor_ticker)
    except Exception as e:
        logger.warning("company_diagnostic(%s): competitor fetch failed for %s: %s", ticker, competitor_ticker, e)
        competitor_data = None
    if not competitor_data:
        return None
    competitor_dcf = competitor_data.get("dcf") or {}

    target_vals = _competitor_metric_values(data, dcf, scenarios)
    competitor_vals = _competitor_metric_values(competitor_data, competitor_dcf, None)

    en = lang == "en"
    rows = []
    target_wins = 0
    total_compared = 0
    for label, key in _competitor_metrics(lang):
        t_val, c_val = target_vals.get(key), competitor_vals.get(key)
        if key == "total_debt":
            t_str, c_str = _fmt_money(t_val, lang), _fmt_money(c_val, lang)
            higher_is_better = False
        else:
            t_str, c_str = _fmt_pct(t_val, lang), _fmt_pct(c_val, lang)
            higher_is_better = True
        note = "Not enough data to compare this row." if en else "Datos insuficientes para comparar este renglón."
        if t_val is not None and c_val is not None:
            total_compared += 1
            target_better = (t_val < c_val) if not higher_is_better else (t_val > c_val)
            if target_better:
                target_wins += 1
            delta = abs(t_val - c_val)
            winner = ticker.upper() if target_better else competitor_ticker
            pct_suffix = "%" if higher_is_better else ""
            note = (
                f"{winner} has the edge in {label.lower()} — a real difference of {delta:,.1f}{pct_suffix}." if en else
                f"{winner} tiene ventaja en {label.lower()} — diferencia real de {delta:,.1f}{pct_suffix}."
            )
        rows.append({
            "metricName": label, "targetCompanyValue": t_str, "competitorValue": c_str,
            "competitorName": competitor_ticker, "nuvosAdvantageNote": note,
        })

    if total_compared:
        conclusion = (
            f"{ticker.upper()} beats {competitor_ticker} on {target_wins} of {total_compared} real metrics compared." if en else
            f"{ticker.upper()} supera a {competitor_ticker} en {target_wins} de {total_compared} métricas reales comparadas."
        )
    else:
        conclusion = (
            f"Not enough real data to compare {ticker.upper()} against {competitor_ticker} right now." if en else
            f"No hay suficientes datos reales para comparar {ticker.upper()} contra {competitor_ticker} en este momento."
        )
    return {"competitorName": competitor_ticker, "rows": rows, "conclusion": conclusion}


def build_company_diagnostic(ticker: str, data: dict, lang: str = "es") -> Optional[dict]:
    """Single entry point. `data` is an already-fetched `get_fundamental_
    analysis(ticker)` result — the CALLER fetches it once (the route also
    needs the same `data` for `generate_company_diagnostic_narrative`'s
    prompt, so fetching here too would silently double the real external
    API cost of every request). Returns a dict matching
    `CompanyDiagnosticData` (frontend/web/src/lib/types/companyDiagnostic.ts)
    MINUS `investmentThesis`/`noiseVsReality`/`actionPlan` — the caller
    attaches those after calling `ai_service.generate_company_diagnostic_
    narrative()`. Returns None (never a fabricated partial card) when the
    underlying data can't support a real diagnosis (no fair value
    scenarios, missing pillar inputs, etc.)."""
    # Every early return below logs WHY before bailing — this endpoint's
    # only failure signal used to be a generic 404 ("no hay suficientes
    # datos"), identical whether the real cause was missing DCF, no GQV/
    # legacy scenarios, a missing pillar score, or the P/E gate below.
    # Confirmed live (2026-08) that some tickers users report failing
    # (e.g. HD) build fine when tested directly with fresh data — these
    # logs are what makes a future report like that actually diagnosable
    # from Railway logs instead of needing a local repro every time.
    dcf = data.get("dcf")
    if not dcf:
        logger.warning("company_diagnostic(%s): no dcf on fundamental_analysis result", ticker)
        return None

    scenarios = _primary_scenarios(dcf)
    if not scenarios or scenarios.get("current_price") is None:
        logger.warning(
            "company_diagnostic(%s): no primary scenarios (gqv_status=%s, legacy_dcf_present=%s)",
            ticker, (dcf.get("gqv_fair_value") or {}).get("status"), bool(dcf.get("scenarios")),
        )
        return None

    pillar_scores = _pillar_scores(data, scenarios)
    if not pillar_scores:
        logger.warning(
            "company_diagnostic(%s): no pillar scores (quality=%s, trust=%s, mos=%s)",
            ticker, data.get("business_quality_score"), data.get("financial_strength_score"),
            scenarios.get("margin_of_safety_pct"),
        )
        return None

    overall_score = round(sum(pillar_scores.values()) / 4)
    mos = scenarios.get("margin_of_safety_pct")

    segments = data.get("segments") or []
    revenue_breakdown = [
        {"category": s["name"], "percentage": s["pct_of_total"]}
        for s in segments if s.get("pct_of_total") is not None
    ]

    financial_health = {
        "longTermDebt": _fmt_money(data.get("total_debt"), lang),
        "netCash": _fmt_money(data.get("net_cash"), lang),
        "roic": _fmt_pct((dcf.get("growth_buildup") or {}).get("avg_roic_pct"), lang),
        "operatingMargin": _fmt_pct((data.get("operating_margin_trend") or [None])[-1] if data.get("operating_margin_trend") else None, lang),
        "netMargin": _fmt_pct((data.get("net_margin_trend") or [None])[-1] if data.get("net_margin_trend") else None, lang),
        "operatingCashFlow": _fmt_money((data.get("fcf_trend") or [None])[-1] if data.get("fcf_trend") else None, lang),
    }
    # Methodology audit round 3 (see /Users/diegoarria/.claude/plans/
    # cosmic-munching-crown.md) — True when at least one year's ROIC used
    # the operating-invested-capital fallback (buyback-compressed equity
    # made the standard denominator explode). Disclosed, never silent.
    roic_adjusted_for_buybacks = bool(data.get("roic_adjusted_for_buybacks"))

    historical_median_pe = (dcf.get("historical_valuation") or {}).get("historical_median_pe")
    valuation = {
        "conservative": scenarios["bear"],
        "baseFairValue": scenarios["base"],
        "optimistic": scenarios["bull"],
        "currentPrice": scenarios["current_price"],
        "marginOfSafetyPercent": mos,
        "peCurrent": data.get("pe_ratio"),
        "peHistoricalAvg": historical_median_pe,
        "evFcf": data.get("ev_fcf"),
        "fcfAssumptions": scenarios.get("fcf_assumptions"),
        "waccDetails": scenarios.get("wacc_details"),
        # Methodology audit round 2 (see /Users/diegoarria/.claude/plans/
        # cosmic-munching-crown.md) — real forward P/E (Yahoo, when the live
        # fetch succeeded) and P/E on earnings-state-normalized EPS, shown
        # alongside the raw GAAP peCurrent above rather than replacing it.
        "peForward": data.get("pe_ratio_forward"),
        "peNormalized": scenarios.get("pe_on_normalized_eps"),
        # Internal (not part of the public CompanyDiagnosticData TS type,
        # never rendered directly) — lets the read-time live-price overlay
        # (screener.py's `_with_live_price_diagnostic`, methodology audit
        # round 3) cheaply recompute peCurrent/peNormalized/marginOfSafety
        # from a fresh quote without a second get_fundamental_analysis call.
        "_epsGaap": data.get("latest_eps"),
        "_epsNormalized": (
            (dcf.get("gqv_fair_value") or {}).get("earnings_state") or {}
        ).get("normalized_eps"),
    }
    # None-safe: the core scenario/price numbers must always be real before
    # this card is shown. evFcf is deliberately NOT required here — it's
    # structurally inapplicable to banks/financials (they don't report a
    # traditional operating-company "free cash flow"), so requiring it was
    # silently excluding every financial-sector ticker (confirmed live for
    # GS/WFC) even when everything else about the diagnostic was real and
    # complete; peHistoricalAvg is optional for the same "genuinely often
    # missing, not a data-quality problem" reason (see its own type comment).
    #
    # peCurrent specifically used to be hard-required too, but it's
    # `data.get("pe_ratio")` — None whenever trailing GAAP EPS is <= 0
    # (fundamental_analysis_service.py), which is an ordinary state for a
    # large, normal population of tickers (recent IPOs, names with a
    # one-off GAAP loss/gain, cyclicals in a down year — UBER hit this
    # live: real bear/base/bull fair-value scenarios, but a None peCurrent
    # silently killed the whole card). peForward/peNormalized are real,
    # EPS-sign-independent alternatives already computed above — accept
    # any ONE of the three P/E fields rather than requiring peCurrent by
    # name, same "optional, not gating" treatment evFcf/peHistoricalAvg
    # already get.
    if any(valuation[k] is None for k in ("conservative", "baseFairValue", "optimistic")):
        logger.warning(
            "company_diagnostic(%s): missing scenario value (conservative=%s, base=%s, optimistic=%s)",
            ticker, valuation["conservative"], valuation["baseFairValue"], valuation["optimistic"],
        )
        return None
    if valuation["peCurrent"] is None and valuation["peForward"] is None and valuation["peNormalized"] is None:
        logger.warning("company_diagnostic(%s): all 3 P/E fields are None (peCurrent/peForward/peNormalized)", ticker)
        return None

    sector = data.get("sector")
    industry = (dcf.get("industry_benchmarks") or {}).get("industry")
    # Optional, not gating: `_find_peers` matches on UNIVERSE's broad GICS
    # `sector` field, while `sector` here is Finnhub's much more granular
    # `finnhubIndustry` string ("Commercial Services & Supplies" vs.
    # "Industrials") — a pre-existing mismatch that already leaves
    # `relative_valuation`/`industry_benchmarks` None for plenty of real
    # tickers (confirmed live for CPRT itself). Rather than block the whole
    # card on that unrelated gap, the competitor section is simply omitted
    # when no real peer is found — same "insufficient_data per-field, never
    # block everything for one missing enrichment" discipline the rest of
    # this pipeline already uses for relative/historical valuation.
    competitor_comparison = _competitor_comparison(ticker, data, dcf, scenarios, sector, industry, lang)

    return {
        "ticker": ticker.upper(),
        "companyName": data.get("company_name") or ticker.upper(),
        "sector": sector or _na(lang),
        "exchange": data.get("exchange") or _na(lang),
        "score": overall_score,
        "scoreLabel": _score_label(overall_score, mos, lang),
        "pillarScores": pillar_scores,
        "badges": _badges(data=data, scenarios=scenarios, dcf=dcf, lang=lang),
        "revenueBreakdown": revenue_breakdown,
        "moatPoints": _moat_points(data, dcf, lang),
        "competitorComparison": competitor_comparison,
        "financialHealth": financial_health,
        "roicAdjustedForBuybacks": roic_adjusted_for_buybacks,
        "valuation": valuation,
        # Real, computed caution note — e.g. the REIT FFO/AFFO gap, or the
        # financial-sector `valuation_sanity_warning` (implied P/B too far
        # from real/peer multiples, confirmed live for BRK.B 2026-08-19).
        # Was already computed by fundamental_analysis_service.py but only
        # ever reached the RETIRED legacy GQV panel (shared.tsx) — this is
        # the only path that reaches the current, only-active diagnostic UI.
        "sectorModelNote": dcf.get("sector_model_note"),
        # investmentThesis / noiseVsReality / actionPlan attached by the caller.
    }
