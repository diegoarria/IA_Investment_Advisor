"""
Nuvos Investment Framework (NIF) — Phase 1: 4-pillar dashboard.

Every pillar in the response follows the same 3-bucket envelope, which
LATER PHASES (Monte Carlo, Risk Analysis, Bull/Base/Bear) must also adopt
rather than inventing a new shape:

{
  "pillar": "business_quality",
  "score": 78,                  # (b) the blended 0-100 score — a Nuvos estimate
  "data": {...},                # (a) 100%-verifiable real financial numbers
  "nuvos_estimate": {...},      # (b) Nuvos-derived/scored values (sub-scores, DCF outputs)
  "explanation": {"sub_factors": [{"key": ..., "text": ...}]} | None,  # (c) AI narration
}

The `data`/`nuvos_estimate` buckets come ENTIRELY from
fundamental_analysis_service.get_fundamental_analysis() — this module
never computes or invents a financial number itself, exactly like
ai_service's narrative functions. The `explanation` bucket is the only
LLM-touched part, and only ever explains numbers that already exist above
it — it must never be the source of a number shown elsewhere in the UI.
"""
import asyncio
import logging
from typing import Optional

from app.services.fundamental_analysis_service import get_fundamental_analysis
from app.services.quality.quality_engine import build_quality_score_from_analysis
from app.services import ai_service
from app.core.finnhub import fh_insider_transactions, fh_insider_sentiment

logger = logging.getLogger(__name__)

# Documented, tunable weights for the Overall NIF Score — not hidden inside
# the aggregation math. Business Quality weighted highest (Buffett/Fisher/
# Smith all prioritize "is this a good business" over price), Management
# Quality lowest of the four since it's the pillar with the thinnest data
# (no analyst-grade governance data source integrated yet).
_NIF_WEIGHTS = {
    "business_quality": 0.30,
    "financial_strength": 0.25,
    "management_quality": 0.20,
    "valuation": 0.25,
}


def compute_overall_nif_score(pillar_scores: dict) -> Optional[dict]:
    """Pure function, no I/O — unit-testable without any LLM/network call.

    `pillar_scores`: {"business_quality": int|None, "financial_strength": int|None,
    "management_quality": int|None, "valuation": int|None}.

    Returns None if every pillar is None (not enough data at all). If only
    some pillars are available, re-normalizes weights across just those so
    a missing pillar doesn't silently drag the score toward zero.

    Also surfaces `weakest_pillar` alongside the blended score — a single
    catastrophic pillar (e.g. Financial Strength = 15) must never get
    laundered into a comfortable-looking weighted average without the user
    seeing which pillar is dragging it down.
    """
    available = {k: v for k, v in pillar_scores.items() if v is not None}
    if not available:
        return None
    total_weight = sum(_NIF_WEIGHTS[k] for k in available)
    weighted = sum(v * _NIF_WEIGHTS[k] for k, v in available.items()) / total_weight
    weakest_key = min(available, key=lambda k: available[k])
    return {
        "score": round(weighted),
        "weakest_pillar": weakest_key,
        "weakest_pillar_score": available[weakest_key],
        "pillar_breakdown": {
            k: {"score": pillar_scores.get(k), "weight": _NIF_WEIGHTS[k]} for k in _NIF_WEIGHTS
        },
    }


async def _safe(coro, fallback, ticker: str, label: str, timeout: float = 20.0):
    """Every NIF sub-call (insider data, each explanation call) must degrade
    independently — a slow/failed Finnhub call or a truncated Haiku response
    must never take down the whole dashboard, matching the same philosophy
    already used throughout fundamental_analysis_service/screener.py."""
    try:
        return await asyncio.wait_for(coro, timeout=timeout)
    except Exception as e:
        logger.warning("build_nif_dashboard(%s): %s failed: %s", ticker, label, e)
        return fallback


def _factor_score(factors: list, name: str) -> Optional[float]:
    """Looks up one named factor's sub-score from a
    `quality_engine.QualityScoreResult.factors` list — used to keep
    business_quality's `nuvos_estimate` key names
    (`roic_score`/`operating_margin_score`/etc.) backward-compatible with
    the frontend's existing `buildNifRows` (which reads those exact keys),
    now sourced from the new Quality Engine instead of the old formula."""
    return next((f.score for f in factors if f.name == name), None)


def _text_explanation(text: Optional[str]) -> Optional[dict]:
    """Wraps a single already-written narrative string (reused from
    generate_quick_valuation_summary's checklist_reasons) into the same
    sub_factors envelope shape the two new structured explanations use, so
    the frontend renders all 4 pillars identically regardless of whether
    the text came from a dedicated NIF call or was repackaged."""
    if not text:
        return None
    return {"sub_factors": [{"key": "overview", "text": text}]}


async def build_nif_dashboard(ticker: str, lang: str = "es") -> Optional[dict]:
    """Orchestrates the NIF dashboard for `ticker`. Returns None if there
    isn't enough real financial data (same gate as get_fundamental_analysis
    itself — no dashboard is better than one built on too little data)."""
    data = get_fundamental_analysis(ticker)
    # Same gate as quick_analysis's route (screener.py): thesis_scores is
    # only ever populated when a real dcf exists (fundamental_analysis_
    # service.py only builds it inside `if dcf:`) — without this check we'd
    # return a "dashboard" full of None scores instead of no dashboard at
    # all, which is worse than a clear 404 the frontend can hide cleanly.
    if not data or not data.get("dcf"):
        return None

    thesis = data.get("thesis_scores") or {}
    evidence = data.get("checklist_evidence") or {}
    dcf = data.get("dcf") or {}

    # Fase 2, Incremento 3 (cutover — see
    # /Users/diegoarria/.claude/plans/stateful-painting-flurry.md): the
    # business_quality pillar's SCORE now comes from the real, independent
    # Quality Engine (never touches price/DCF/multiples) instead of
    # fundamental_analysis_service's older thesis_scores["business_quality"]
    # formula. `has_any_signal` guards against a real 0 masquerading as "no
    # data" — see QualityScoreResult's docstring.
    quality_result = build_quality_score_from_analysis(data)
    business_quality_score = quality_result.quality_score if quality_result.has_any_signal else None

    insider_txn, insider_sentiment = await asyncio.gather(
        _safe(asyncio.to_thread(fh_insider_transactions, ticker), None, ticker, "insider_transactions", timeout=8),
        _safe(asyncio.to_thread(fh_insider_sentiment, ticker), None, ticker, "insider_sentiment", timeout=8),
    )

    # Two NEW structured explanations (business quality, management quality)
    # plus ONE call to the existing generate_quick_valuation_summary purely
    # to source financial_strength/valuation's explanation text (already
    # ~70-word narratives — no need for a 3rd/4th dedicated NIF call, keeps
    # LLM cost down). All three run in parallel.
    bq_explanation, mgmt_explanation, summary_result = await asyncio.gather(
        _safe(ai_service.generate_business_quality_explanation(data, lang), None, ticker, "business_quality_explanation"),
        _safe(ai_service.generate_management_quality_explanation(data, insider_txn, insider_sentiment, lang), None, ticker, "management_quality_explanation"),
        _safe(ai_service.generate_quick_valuation_summary(data, lang), {"checklist_reasons": {}}, ticker, "quick_valuation_summary"),
    )
    checklist_reasons = (summary_result or {}).get("checklist_reasons") or {}

    business_quality_evidence = evidence.get("business_quality") or {}
    moat_evidence = evidence.get("moat") or {}
    financial_strength_evidence = evidence.get("financial_strength") or {}
    management_evidence = evidence.get("management_capital_allocation") or {}

    pillars = {
        "business_quality": {
            "pillar": "business_quality",
            "score": business_quality_score,
            "data": {
                "roic_pct": moat_evidence.get("avg_roic_pct"),
                "roic_trend_pct": moat_evidence.get("roic_trend_pct"),
                "gross_margin_trend_pct": moat_evidence.get("gross_margin_trend_pct"),
                "operating_margin_pct": business_quality_evidence.get("latest_operating_margin_pct"),
                "net_margin_pct": business_quality_evidence.get("latest_net_margin_pct"),
                "fcf_margin_pct": business_quality_evidence.get("avg_fcf_margin_pct"),
                "revenue_cagr_pct": business_quality_evidence.get("revenue_cagr_pct"),
            },
            "nuvos_estimate": {
                # Backward-compatible key names (the frontend's buildNifRows
                # already reads these exact keys) — now sourced from the
                # Quality Engine's own named factors instead of the old
                # formula, not recomputed a second time.
                "roic_score": _factor_score(quality_result.factors, "roic"),
                "operating_margin_score": _factor_score(quality_result.factors, "operating_margin_level"),
                "net_margin_score": _factor_score(quality_result.factors, "net_margin_level"),
                "fcf_margin_score": _factor_score(quality_result.factors, "fcf_margin_level"),
                "growth_score": quality_result.growth_score,
                "composite_score": business_quality_score,
                # New, richer breakdown (Fase 2) — additive, for the
                # Dashboard (Incremento 11) to consume without another
                # backend round-trip.
                "profitability_score": quality_result.profitability_score,
                "margins_score": quality_result.margins_score,
                "cash_flow_score": quality_result.cash_flow_score,
                "balance_sheet_score": quality_result.balance_sheet_score,
                "factors": [
                    {"name": f.name, "value": f.value, "score": f.score, "reason": f.reason}
                    for f in quality_result.factors
                ],
            },
            "explanation": bq_explanation,
        },
        "financial_strength": {
            "pillar": "financial_strength",
            "score": thesis.get("financial_strength"),
            "data": {
                "total_debt": financial_strength_evidence.get("total_debt"),
                "cash": financial_strength_evidence.get("cash"),
                "net_cash": financial_strength_evidence.get("net_cash"),
            },
            "nuvos_estimate": {
                "interest_coverage_score": financial_strength_evidence.get("interest_coverage_score"),
                "net_debt_to_cash_score": financial_strength_evidence.get("net_debt_to_cash_score"),
                "composite_score": thesis.get("financial_strength"),
            },
            "explanation": _text_explanation(checklist_reasons.get("financial_strength")),
        },
        "management_quality": {
            "pillar": "management_quality",
            "score": thesis.get("management_capital_allocation"),
            "data": {
                "buyback_rate_pct": management_evidence.get("buyback_rate_pct"),
                "payout_ratio_pct": management_evidence.get("payout_ratio_pct"),
                "insider_trailing_12mo": (insider_txn or {}).get("trailing_12mo"),
                "insider_most_recent_transaction_date": (insider_txn or {}).get("most_recent_transaction_date"),
                "insider_sentiment_avg_mspr": (insider_sentiment or {}).get("avg_mspr"),
            },
            "nuvos_estimate": {
                "composite_score": thesis.get("management_capital_allocation"),
            },
            "explanation": mgmt_explanation,
        },
        "valuation": {
            "pillar": "valuation",
            "score": thesis.get("valuation"),
            "data": {
                "current_price": data.get("current_price"),
                "pe_ratio": data.get("pe_ratio"),
                "ev_ebitda": data.get("ev_ebitda"),
                "peg_ratio": data.get("peg_ratio"),
            },
            "nuvos_estimate": {
                "fair_value_range": dcf.get("fair_value_range"),
                "margin_of_safety_pct": dcf.get("margin_of_safety_pct"),
                "expected_value_per_share": dcf.get("expected_value_per_share"),
                "composite_score": thesis.get("valuation"),
            },
            "explanation": _text_explanation(checklist_reasons.get("valuation")),
        },
    }

    overall = compute_overall_nif_score({k: v["score"] for k, v in pillars.items()})

    return {
        "ticker": data["ticker"],
        "company_name": data.get("company_name"),
        "sector": data.get("sector"),
        # Named "price"/"change_pct" (not "current_price") to match
        # screener.py's _with_live_price(), which overlays a live quote onto
        # these exact keys on every request regardless of cache state — same
        # convention as quick-analysis's response.
        "price": data.get("current_price"),
        "change_pct": data.get("change_pct"),
        "overall_nif_score": overall,
        "pillars": pillars,
    }
