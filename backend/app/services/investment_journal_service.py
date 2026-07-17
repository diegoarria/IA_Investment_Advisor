"""
Investment Journal service
============================
Append-only log of investment theses (see migrations/039_investment_journal.sql).
Every full Premium "Analízame X" reply from Mentor IA gets one row here — real
numbers pulled straight from fundamental_analysis_service's already-computed
dict, plus the full narrative reply verbatim (no fragile section-parsing of
the bull/bear/catalysts prose). On-demand only: comparing a saved thesis
against today's real data happens when the user asks for it (see
app/api/routes/journal.py's /review endpoint) — there is no scheduler/push
here, deliberately, matching this app's removal of prior proactive-push
features (valuation_alert_state, thesis_drift_state).
"""

from __future__ import annotations

import logging
from typing import Optional

from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)


async def save_thesis(user_id: str, ticker: str, data: dict, reply_text: str) -> None:
    """Best-effort save — never raises. A failure here must never break the
    chat response the user is actually waiting for."""
    try:
        dcf = data.get("dcf") or {}
        base_scenario = (dcf.get("scenarios") or {}).get("base") or {}
        db = get_supabase()
        await run_query(
            db.table("investment_theses").insert({
                "user_id": user_id,
                "ticker": ticker,
                "company_name": data.get("company_name"),
                "price_at_creation": data.get("current_price"),
                "intrinsic_value_base": base_scenario.get("intrinsic_value_per_share"),
                "intrinsic_value_expected": dcf.get("expected_value_per_share"),
                "margin_of_safety_pct": dcf.get("margin_of_safety_pct"),
                "thesis_scores": data.get("thesis_scores"),
                "thesis_text": reply_text,
            })
        )
    except Exception as exc:
        logger.warning("investment_journal_service.save_thesis(%s, %s) failed: %s", user_id, ticker, exc)


async def list_theses(user_id: str, ticker: Optional[str] = None, limit: int = 50) -> list[dict]:
    db = get_supabase()
    query = (
        db.table("investment_theses")
        .select("id, ticker, company_name, price_at_creation, intrinsic_value_base, "
                "intrinsic_value_expected, margin_of_safety_pct, thesis_scores, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
    )
    if ticker:
        query = query.eq("ticker", ticker.upper())
    res = await run_query(query)
    return res.data or []


async def get_thesis(user_id: str, thesis_id: str) -> Optional[dict]:
    db = get_supabase()
    res = await run_query(
        db.table("investment_theses").select("*").eq("user_id", user_id).eq("id", thesis_id).limit(1)
    )
    rows = res.data or []
    return rows[0] if rows else None
