"""
Investment Research Engine — Fase 3, Incremento 10 (see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Routes for the NEW Investment Research Engine (Business/Competitive/
Industry/Management Intelligence, Thesis Engine, Investment Memo, company
Timeline). Deliberately a SEPARATE router/file/prefix from `research.py`
(the existing Deep Research feature — `research_jobs`/`research_reports`,
a per-user paid one-off report pipeline) to avoid any naming collision —
these are two unrelated features that happen to share the English word
"research."

Every route follows `investment_graph.py`'s simpler style (auth-gated via
`get_current_user_id`, no premium gating, no free-text ticker resolution)
rather than `screener.py`'s heavier `/nif-dashboard` pattern — premium
gating for this brand-new engine is a product decision left for later,
not invented here.

The Dossier route composes everything at once
(`research_orchestrator.compose_research_dossier`); every other route
refreshes ONE section independently, fetching only the real data that
section actually needs — so the frontend never re-pays the cost of the
whole dossier to refresh a single card.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/research-engine", tags=["research-engine"])


async def _get_fundamental_data_or_404(ticker: str) -> dict:
    from app.services.fundamental_analysis_service import get_fundamental_analysis
    import asyncio

    data = await asyncio.to_thread(get_fundamental_analysis, ticker)
    if not data or not data.get("dcf"):
        raise HTTPException(status_code=404, detail=f"No hay suficientes datos financieros reales para investigar {ticker}")
    return data


@router.get("/company/{ticker}/dossier")
async def get_research_dossier(ticker: str, lang: str = "es", user_id: str = Depends(get_current_user_id)):
    """The full Company Research Dossier — Business/Competitive/Industry/
    Management Intelligence + real Quality/Moat/Conviction scores + the
    current Nuvos thesis draft, all in one call. Expensive (multiple real
    evidence-gathering + AI calls) — the frontend should prefer the
    per-section routes below when only one card needs refreshing."""
    from app.services.research.research_orchestrator import compose_research_dossier

    result = await compose_research_dossier(ticker, lang)
    if not result:
        raise HTTPException(status_code=404, detail=f"No hay suficientes datos financieros reales para investigar {ticker}")
    return result


@router.get("/company/{ticker}/business-understanding")
async def get_business_understanding(ticker: str, lang: str = "es", user_id: str = Depends(get_current_user_id)):
    from app.services.research.business_understanding import compute_and_save_business_understanding

    data = await _get_fundamental_data_or_404(ticker)
    result = await compute_and_save_business_understanding(
        ticker, data.get("company_name") or ticker, data.get("segments") or [], lang,
    )
    return result.to_snapshot_content()


@router.get("/company/{ticker}/competitive-intelligence")
async def get_competitive_intelligence(ticker: str, lang: str = "es", user_id: str = Depends(get_current_user_id)):
    from app.services.research.competitive_intelligence import compute_and_save_competitive_intelligence
    from app.services.quality.quality_engine import build_quality_score_from_analysis

    data = await _get_fundamental_data_or_404(ticker)
    quality_result = build_quality_score_from_analysis(data)
    quality_score = quality_result.quality_score if quality_result.has_any_signal else None
    result = await compute_and_save_competitive_intelligence(
        ticker, data.get("company_name") or ticker, data.get("sector"), None, quality_score, lang,
    )
    return result.to_snapshot_content()


@router.get("/company/{ticker}/industry-intelligence")
async def get_industry_intelligence(ticker: str, lang: str = "es", user_id: str = Depends(get_current_user_id)):
    from app.services.research.industry_intelligence import compute_and_save_industry_intelligence

    data = await _get_fundamental_data_or_404(ticker)
    result = await compute_and_save_industry_intelligence(ticker, data.get("company_name") or ticker, data.get("sector"), None, lang)
    return result.to_snapshot_content()


@router.get("/company/{ticker}/management-intelligence")
async def get_management_intelligence(ticker: str, lang: str = "es", user_id: str = Depends(get_current_user_id)):
    from app.services.research.management_intelligence import compute_and_save_management_intelligence
    from app.services.fundamental_analysis_service import get_fundamental_analysis
    import asyncio

    # Only the company name is needed here — a lighter fetch than the
    # other section routes, but still real (never guessed).
    data = await asyncio.to_thread(get_fundamental_analysis, ticker)
    company_name = (data or {}).get("company_name") or ticker
    result = await compute_and_save_management_intelligence(ticker, company_name, lang)
    return result.to_snapshot_content()


@router.get("/company/{ticker}/timeline")
async def get_company_research_timeline(ticker: str, limit: int = 100, user_id: str = Depends(get_current_user_id)):
    """The company's own OBJECTIVE event history (populated by Change
    Detection) — NOT `investment_graph.router`'s `/graph/company/{ticker}`,
    which is this user's personal activity log for the same ticker."""
    from app.services.research.timeline_engine import get_company_timeline

    timeline = await get_company_timeline(ticker, limit=limit)
    return {"ticker": ticker.upper(), "timeline": timeline}


@router.get("/company/{ticker}/thesis/draft")
async def get_thesis_draft_route(ticker: str, user_id: str = Depends(get_current_user_id)):
    """Nuvos's own shared research draft — regenerate it via `POST
    /company/{ticker}/thesis/draft/refresh`."""
    from app.services.research.thesis_engine import get_thesis_draft

    draft = await get_thesis_draft(ticker)
    if not draft:
        raise HTTPException(status_code=404, detail=f"Todavía no hay una tesis de investigación para {ticker}")
    return draft


@router.post("/company/{ticker}/thesis/draft/refresh")
async def refresh_thesis_draft_route(ticker: str, lang: str = "es", user_id: str = Depends(get_current_user_id)):
    from app.services.research.thesis_engine import compute_and_save_thesis_draft
    from app.services.quality.quality_engine import build_quality_score_from_analysis
    from app.services.quality.industry_engine import compute_industry_benchmarks
    from app.services.quality.moat_engine import compute_moat_score
    from app.services.quality.conviction_engine import compute_conviction_score
    import asyncio

    data = await _get_fundamental_data_or_404(ticker)
    dcf = data.get("dcf") or {}
    quality_result = build_quality_score_from_analysis(data)
    quality_score = quality_result.quality_score if quality_result.has_any_signal else None

    industry_benchmarks = await asyncio.to_thread(compute_industry_benchmarks, ticker, data.get("sector"), None)
    growth_buildup = dcf.get("growth_buildup") or {}
    op_margin_trend = data.get("operating_margin_trend") or []
    op_margin_valid = [v for v in op_margin_trend if v is not None]
    avg_operating_margin_pct = round(sum(op_margin_valid) / len(op_margin_valid), 1) if op_margin_valid else None
    gross_margin_trend = data.get("gross_margin_trend") or []
    gross_margin_latest_pct = next((v for v in reversed(gross_margin_trend) if v is not None), None)
    moat_result = compute_moat_score(
        avg_roic_pct=growth_buildup.get("avg_roic_pct"), roic_trend=data.get("roic_trend") or [],
        avg_operating_margin_pct=avg_operating_margin_pct, operating_margin_trend=op_margin_trend,
        gross_margin_latest_pct=gross_margin_latest_pct,
        industry_median_roic_pct=(industry_benchmarks.median_roic_pct if industry_benchmarks else None),
        industry_median_operating_margin_pct=(industry_benchmarks.median_operating_margin_pct if industry_benchmarks else None),
    )
    moat_score = moat_result.moat_score if moat_result.has_any_signal else None
    conviction_result = compute_conviction_score(
        quality_score=quality_score, moat_score=moat_score, stability_score=moat_result.stability_score,
        beta=(dcf.get("wacc_details") or {}).get("beta"),
    )
    conviction_score = conviction_result.conviction_score if conviction_result.has_any_signal else None

    result = await compute_and_save_thesis_draft(
        ticker, data.get("company_name") or ticker, quality_score, moat_score, conviction_score,
        dcf.get("margin_of_safety_pct"), dcf.get("fair_value_range"), lang,
    )
    if not result.has_any_signal:
        raise HTTPException(status_code=503, detail=f"No pudimos generar una tesis para {ticker} en este momento.")
    return result.to_row()


@router.post("/company/{ticker}/thesis/fork")
async def fork_thesis_route(ticker: str, user_id: str = Depends(get_current_user_id)):
    """Explicit user action: copies Nuvos's current research draft as the
    starting point for this user's own editable thesis."""
    from app.services.research.thesis_engine import fork_thesis_from_draft

    result = await fork_thesis_from_draft(user_id, ticker)
    if not result:
        raise HTTPException(status_code=404, detail=f"Todavía no hay una tesis de investigación de Nuvos para {ticker} — no hay nada que adoptar.")
    return result


@router.get("/company/{ticker}/thesis/mine")
async def get_my_thesis_route(ticker: str, user_id: str = Depends(get_current_user_id)):
    from app.services.research.thesis_engine import get_user_current_thesis

    thesis = await get_user_current_thesis(user_id, ticker)
    if not thesis:
        raise HTTPException(status_code=404, detail="No tienes una tesis propia para esta empresa todavía.")
    return thesis


@router.post("/company/{ticker}/thesis/review")
async def review_thesis_route(ticker: str, lang: str = "es", user_id: str = Depends(get_current_user_id)):
    """Thesis Tracker: compares the user's current thesis against real
    events since it was created, creates a NEW version (never overwrites
    the prior one), and records hypothesis outcomes."""
    from app.services.research.thesis_tracker import compute_and_save_thesis_review
    from app.services.fundamental_analysis_service import get_fundamental_analysis
    import asyncio

    data = await asyncio.to_thread(get_fundamental_analysis, ticker)
    company_name = (data or {}).get("company_name") or ticker
    result = await compute_and_save_thesis_review(user_id, ticker, company_name, lang)
    if not result.has_any_signal:
        raise HTTPException(status_code=404, detail="No hay una tesis propia previa para revisar en esta empresa.")
    return {
        "what_changed": result.what_changed, "thesis_change_explanation": result.thesis_change_explanation,
        "new_thesis_version": result.new_thesis_version,
    }


@router.get("/company/{ticker}/memo")
async def get_investment_memo_route(ticker: str, lang: str = "es", user_id: str = Depends(get_current_user_id)):
    """Investment Memo — a frozen, on-demand document assembled from
    everything already computed/stored, never a new AI call."""
    from app.services.research.memo_engine import compute_investment_memo
    from app.services.quality.quality_engine import build_quality_score_from_analysis
    from app.services.quality.industry_engine import compute_industry_benchmarks
    from app.services.quality.moat_engine import compute_moat_score
    from app.services.quality.conviction_engine import compute_conviction_score
    from app.services.quality.capital_allocation_engine import compute_capital_allocation_score
    from app.services.quality.earnings_quality_engine import compute_earnings_quality
    from app.services.quality.catalysts_engine import compute_catalysts
    import asyncio

    data = await _get_fundamental_data_or_404(ticker)
    dcf = data.get("dcf") or {}
    company_name = data.get("company_name") or ticker
    segments = data.get("segments") or []

    quality_result = build_quality_score_from_analysis(data)
    quality_score = quality_result.quality_score if quality_result.has_any_signal else None

    industry_benchmarks = await asyncio.to_thread(compute_industry_benchmarks, ticker, data.get("sector"), None)
    growth_buildup = dcf.get("growth_buildup") or {}
    op_margin_trend = data.get("operating_margin_trend") or []
    op_margin_valid = [v for v in op_margin_trend if v is not None]
    avg_operating_margin_pct = round(sum(op_margin_valid) / len(op_margin_valid), 1) if op_margin_valid else None
    gross_margin_trend = data.get("gross_margin_trend") or []
    gross_margin_latest_pct = next((v for v in reversed(gross_margin_trend) if v is not None), None)
    moat_result = compute_moat_score(
        avg_roic_pct=growth_buildup.get("avg_roic_pct"), roic_trend=data.get("roic_trend") or [],
        avg_operating_margin_pct=avg_operating_margin_pct, operating_margin_trend=op_margin_trend,
        gross_margin_latest_pct=gross_margin_latest_pct,
        industry_median_roic_pct=(industry_benchmarks.median_roic_pct if industry_benchmarks else None),
        industry_median_operating_margin_pct=(industry_benchmarks.median_operating_margin_pct if industry_benchmarks else None),
    )
    moat_score = moat_result.moat_score if moat_result.has_any_signal else None
    conviction_result = compute_conviction_score(
        quality_score=quality_score, moat_score=moat_score, stability_score=moat_result.stability_score,
        beta=(dcf.get("wacc_details") or {}).get("beta"),
    )
    conviction_score = conviction_result.conviction_score if conviction_result.has_any_signal else None

    mgmt_evidence = (data.get("checklist_evidence") or {}).get("management_capital_allocation") or {}
    payout_ratio_pct = mgmt_evidence.get("payout_ratio_pct")
    capital_allocation_result_obj = await asyncio.to_thread(
        compute_capital_allocation_score,
        ticker=ticker, current_price=data.get("current_price"),
        implied_shares_trend=data.get("implied_shares_trend") or [],
        fiscal_period_dates=data.get("fiscal_period_dates") or [],
        dividends_paid_trend=data.get("dividends_paid_trend") or [],
        reinvestment_rate_trend=data.get("reinvestment_rate_trend") or [],
        buyback_rate_pct=mgmt_evidence.get("buyback_rate_pct"),
        payout_ratio=(payout_ratio_pct / 100) if payout_ratio_pct is not None else None,
    )
    capital_allocation_result = {
        "capital_allocation_score": capital_allocation_result_obj.capital_allocation_score,
        "factors": [{"name": f.name, "value": f.value, "score": f.score, "reason": f.reason} for f in capital_allocation_result_obj.factors],
    }

    fcf_trend = data.get("fcf_trend") or []
    revenue_trend = data.get("revenue_trend") or []
    earnings_quality_result_obj = compute_earnings_quality(
        sbc_latest=data.get("sbc_latest"),
        revenue_latest=(revenue_trend[-1] if revenue_trend else None),
        fcf_latest=(fcf_trend[-1] if fcf_trend else None),
        data_validation=data.get("data_validation"),
        gross_margin_trend=data.get("gross_margin_trend") or [], operating_margin_trend=op_margin_trend,
        net_margin_trend=data.get("net_margin_trend") or [],
        fcf_trend=fcf_trend, net_income_trend=data.get("net_income_trend") or [],
        years=data.get("years") or [],
        revenue_cagr_pct=data.get("revenue_cagr_pct"), fcf_cagr_pct=data.get("fcf_cagr_pct"),
    )
    earnings_quality_result = {
        "alerts": [{"key": a.key, "severity": a.severity, "description": a.description} for a in earnings_quality_result_obj.alerts],
    }

    catalysts = await compute_catalysts(ticker, company_name, segments, lang)

    memo = await compute_investment_memo(
        ticker, company_name,
        quality_score=quality_score, moat_score=moat_score,
        management_score=None, conviction_score=conviction_score,
        intrinsic_value_per_share=dcf.get("expected_value_per_share"), fair_value_range=dcf.get("fair_value_range"),
        reverse_dcf=dcf.get("reverse_dcf_sanity_check"), scenarios=dcf.get("scenarios"),
        capital_allocation_result=capital_allocation_result, earnings_quality_result=earnings_quality_result,
        catalysts=catalysts, segments=segments, user_id=user_id,
    )
    return memo.to_dict()
