"""
Research Orchestrator — Fase 3, Incremento 10 (see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Composes the "Company Research Dossier" — analogous to `nif_service.
build_nif_dashboard` for Fase 2's quality engines. `compose_research_dossier`
runs Business/Competitive/Industry/Management Intelligence in parallel
(each wrapped in `safe_call.safe_call`, so one slow/failed engine never
takes the whole dossier down — the same resilience pattern
`nif_service._safe` already used, now shared via `safe_call.py`), THEN the
Thesis Engine (which reads the snapshots the first four just saved, so it
sees this run's fresh data rather than a stale prior snapshot).

Quality/Moat/Conviction (Fase 2) are computed here, once, from a single
`get_fundamental_analysis` fetch — the same real numbers every other Fase
3 engine accepts as an already-computed parameter rather than re-deriving.

The Dossier is deliberately NOT the same thing as the Investment Memo
(Incremento 9): the Dossier is "everything we know about this company
right now" (read-heavy, each section independently refreshable via its
own route — see `app/api/routes/research.py`); the Memo is a frozen,
on-demand snapshot meant for export. Both read the same underlying
sources, but are two separate functions on purpose.
"""

from __future__ import annotations

from typing import Optional


async def _compute_deterministic_scores(ticker: str, data: dict) -> dict:
    """Fase 2 real scores (quality/moat/conviction) — zero AI, zero network
    beyond the industry-benchmarks lookup already required for the moat
    calc. Shared by compose_research_dossier and compose_thesis_only so
    the two never compute this differently."""
    import asyncio
    from app.services.quality.quality_engine import build_quality_score_from_analysis
    from app.services.quality.industry_engine import compute_industry_benchmarks
    from app.services.quality.moat_engine import compute_moat_score
    from app.services.quality.conviction_engine import compute_conviction_score

    sector = data.get("sector")
    dcf = data.get("dcf") or {}

    quality_result = build_quality_score_from_analysis(data)
    quality_score = quality_result.quality_score if quality_result.has_any_signal else None

    industry_benchmarks = await asyncio.to_thread(compute_industry_benchmarks, ticker, sector, None)
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

    return {
        "quality_score": quality_score,
        "moat_score": moat_score,
        "conviction_score": conviction_score,
        "margin_of_safety_pct": dcf.get("margin_of_safety_pct"),
        "fair_value_range": dcf.get("fair_value_range"),
    }


async def compose_research_dossier(ticker: str, lang: str = "es") -> Optional[dict]:
    """The single entry point. Returns None if there isn't enough real
    financial data to build on — same gate `nif_service.build_nif_dashboard`
    uses (`thesis_scores`/`dcf` only exist when `get_fundamental_analysis`
    found enough real data)."""
    import asyncio
    from app.services.fundamental_analysis_service import get_fundamental_analysis
    from app.services.safe_call import safe_call
    from app.services.research.business_understanding import compute_and_save_business_understanding
    from app.services.research.competitive_intelligence import compute_and_save_competitive_intelligence
    from app.services.research.industry_intelligence import compute_and_save_industry_intelligence
    from app.services.research.management_intelligence import compute_and_save_management_intelligence
    from app.services.research.thesis_engine import compute_and_save_thesis_draft

    data = get_fundamental_analysis(ticker)
    if not data or not data.get("dcf"):
        return None

    company_name = data.get("company_name") or ticker
    sector = data.get("sector")
    segments = data.get("segments") or []

    scores = await _compute_deterministic_scores(ticker, data)
    quality_score = scores["quality_score"]
    moat_score = scores["moat_score"]
    conviction_score = scores["conviction_score"]
    margin_of_safety_pct = scores["margin_of_safety_pct"]
    fair_value_range = scores["fair_value_range"]

    # Business/Competitive/Industry/Management Intelligence run in
    # parallel — each saves its own knowledge snapshot as a side effect,
    # which the Thesis Engine (below) then reads fresh.
    business, competitive, industry_intel, management = await asyncio.gather(
        safe_call(
            compute_and_save_business_understanding(ticker, company_name, segments, lang),
            None, "business_understanding", context=ticker,
        ),
        safe_call(
            compute_and_save_competitive_intelligence(ticker, company_name, sector, None, quality_score, lang),
            None, "competitive_intelligence", context=ticker,
        ),
        safe_call(
            compute_and_save_industry_intelligence(ticker, company_name, sector, None, lang),
            None, "industry_intelligence", context=ticker,
        ),
        safe_call(
            compute_and_save_management_intelligence(ticker, company_name, lang),
            None, "management_intelligence", context=ticker,
        ),
    )

    thesis_draft = await safe_call(
        compute_and_save_thesis_draft(
            ticker, company_name, quality_score, moat_score, conviction_score, margin_of_safety_pct, fair_value_range, lang,
        ),
        None, "thesis_draft", context=ticker,
    )

    return {
        "ticker": data["ticker"], "company_name": company_name, "sector": sector,
        "quality_score": quality_score, "moat_score": moat_score, "conviction_score": conviction_score,
        "business_understanding": business.to_snapshot_content() if business and business.has_any_signal else None,
        "competitive_intelligence": competitive.to_snapshot_content() if competitive and competitive.has_any_signal else None,
        "industry_intelligence": industry_intel.to_snapshot_content() if industry_intel and industry_intel.has_any_signal else None,
        "management_intelligence": management.to_snapshot_content() if management and management.has_any_signal else None,
        "thesis_draft": thesis_draft.to_row() if thesis_draft and thesis_draft.has_any_signal else None,
    }


async def compose_thesis_only(ticker: str, lang: str = "es") -> Optional[dict]:
    """Cost fix, Sep 2026: the proactive Smart Alerts background refresh
    (smart_alerts_service.refresh_watchlist_signal_sources) used to call
    the FULL compose_research_dossier for every Premium user's watchlist
    ticker once a day — 5 separate Claude calls per ticker (business/
    competitive/industry/management understanding + thesis draft) — but
    the `new_risk` detector only ever reads thesis_draft.key_risks; the
    other 4 are pure narrative for the human-facing Dossier UI and are
    never diffed against by any alert. Confirmed via llm_usage_log: this
    one background job alone burned $3.37 across 60 watchlist tickers in
    48h with only 3 (test) Premium users, zero of it from anything a human
    asked for.

    compute_and_save_thesis_draft reads whatever business/competitive/
    industry/management snapshot is LATEST via knowledge_store.
    get_latest_snapshot — it doesn't require this call to have just
    regenerated them, so skipping those 4 here only means the thesis
    occasionally reasons over a slightly older (or absent) snapshot until
    a real user organically opens that ticker's Dossier and
    compose_research_dossier refreshes them all for real."""
    from app.services.fundamental_analysis_service import get_fundamental_analysis
    from app.services.safe_call import safe_call
    from app.services.research.thesis_engine import compute_and_save_thesis_draft

    data = get_fundamental_analysis(ticker)
    if not data or not data.get("dcf"):
        return None

    company_name = data.get("company_name") or ticker
    scores = await _compute_deterministic_scores(ticker, data)

    thesis_draft = await safe_call(
        compute_and_save_thesis_draft(
            ticker, company_name, scores["quality_score"], scores["moat_score"], scores["conviction_score"],
            scores["margin_of_safety_pct"], scores["fair_value_range"], lang,
        ),
        None, "thesis_draft", context=ticker,
    )
    return thesis_draft.to_row() if thesis_draft and thesis_draft.has_any_signal else None
