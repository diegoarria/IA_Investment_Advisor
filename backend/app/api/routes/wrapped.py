"""
Nuvos Wrapped 2026 — 8-screen annual year-in-review.
GET /api/wrapped/annual

Only accessible Dec 15 - Jan 15 (inclusive), every year, forever — see
app/core/wrapped_window.py, the single source of truth for that check.
Available to every user, free and premium alike (Diego: the whole point is
that everyone gets one, same as Spotify Wrapped) — unlike the rest of the
Investor Progress Engine, nothing here is premium-gated.

The 8 screens and where each one's data comes from:
  1. Personalidad     — investor_progress_service.classify_investor_archetype
  2. Números           — invested this year, growth_pct, companies analyzed,
                          Arthur conversations, longest streak, days active
  3. Percentil         — investor_score percentile within risk cohort
                          (never return/patrimonio — see worker.py's
                          job_compute_benchmarks)
  4. Empresa favorita  — investment_graph_service.get_most_analyzed_companies
  5. Top posiciones    — real cost-basis return %, not a market YTD proxy
  6. Peor decisión     — investor_progress_service.worst_closed_position,
                          falls back to worst unrealized open position
  7. Tipo de inversionista — investor_progress_service.classify_investor_type
  8. Compartir         — reuses fields from 1-7, no new computation
"""
import asyncio
import logging
import traceback
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from app.api.deps import get_current_user
from app.api.routes.sync import _parse_portfolio
from app.core.database import get_supabase, run_query
from app.core.limiter import limiter
from app.core.wrapped_window import is_wrapped_window_open, wrapped_year_for
from app.services import investor_progress_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/wrapped", tags=["wrapped"])


async def _position_returns(positions: list[dict]) -> list[dict]:
    """Real return % per ticker, aggregated across every lot, using the
    user's own cost basis (shares * avgPrice) vs. a live quote — not a
    market-YTD proxy, so a position bought mid-year is automatically
    correct without any special-casing (the real entry price already *is*
    the real entry date). Skips — never fabricates — any ticker whose
    current price isn't fetchable."""
    from app.core.finnhub import fh_quote

    tickers = list(dict.fromkeys(p["ticker"] for p in positions if p.get("ticker")))

    async def _one(ticker: str) -> dict | None:
        lots = [p for p in positions if p.get("ticker") == ticker]
        shares = sum(float(p.get("shares", 0) or 0) for p in lots)
        invested = sum(float(p.get("shares", 0) or 0) * float(p.get("avgPrice", 0) or 0) for p in lots)
        if shares <= 0 or invested <= 0:
            return None
        quote = await asyncio.to_thread(fh_quote, ticker)
        if not quote or not quote.get("price"):
            return None
        current_value = shares * float(quote["price"])
        return {
            "ticker": ticker,
            "return_pct": round((current_value - invested) / invested * 100, 2),
            "invested": round(invested, 2),
            "current_value": round(current_value, 2),
        }

    results = await asyncio.gather(*[_one(t) for t in tickers])
    return [r for r in results if r]


async def _arthur_conversations_this_year(user_id: str, year: int) -> int:
    """Real count of user-sent chat_history rows in the year — count="exact"
    query, same convention already used by watchlist.py /
    smart_alerts_service.py."""
    db = get_supabase()
    res = await run_query(
        db.table("chat_history")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .eq("role", "user")
        .gte("created_at", f"{year}-01-01")
        .lte("created_at", f"{year}-12-31T23:59:59")
    )
    return res.count or 0


def _invested_during_year(positions: list[dict], closed_positions: list[dict], year: int) -> float:
    """Real $ deployed during the calendar year — every lot (still open or
    already closed) whose purchaseDate falls in the year, at the price
    actually paid. Not lifetime capital_invested, and not current value."""
    total = 0.0
    for item in positions + closed_positions:
        pd = str(item.get("purchaseDate") or "")[:10]
        if pd[:4] == str(year):
            total += float(item.get("shares", 0) or 0) * float(item.get("avgPrice", 0) or 0)
    return round(total, 2)


async def _company_names(tickers: list[str]) -> dict[str, str | None]:
    from app.core.finnhub import fh_profile
    profiles = await asyncio.gather(*[asyncio.to_thread(fh_profile, t) for t in tickers])
    return {t: (p or {}).get("name") for t, p in zip(tickers, profiles)}


@router.get("/annual")
@limiter.limit("10/hour")
async def get_wrapped(
    request: Request,
    user: dict = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    # TEMP TEST BYPASS — revert this commit once Diego confirms the report
    # looks right. Lets diego.arria19@gmail.com view his own real 2026
    # Wrapped-in-progress outside the Dec15-Jan15 window; no other account
    # is affected.
    _test_bypass = user.get("email") == "diego.arria19@gmail.com"
    if not is_wrapped_window_open(now) and not _test_bypass:
        # 404, not 403 — "not available" reads honestly, "forbidden" implies
        # a permission the user is missing rather than a date that hasn't
        # arrived yet. The frontend shows a "vuelve el 15 de diciembre"
        # locked screen off this status, same contract on web and mobile.
        raise HTTPException(status_code=404, detail={
            "code": "wrapped_window_closed",
            "message": "Tu Investor Wrapped está disponible del 15 de diciembre al 15 de enero.",
        })

    try:
        db      = get_supabase()
        user_id = user["id"]
        year    = wrapped_year_for(now) if not _test_bypass else now.year

        # ── 1. User profile ───────────────────────────────────────────────
        prof_res = await run_query(
            db.table("user_profiles")
              .select("name, avatar_url, created_at, risk_tolerance")
              .eq("user_id", user_id)
        )
        prof = prof_res.data[0] if prof_res.data else {}
        full_name = prof.get("name") or "Inversor"
        avatar_url = prof.get("avatar_url")

        created_raw = prof.get("created_at")
        if created_raw:
            try:
                joined = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
                days_active = max(1, (now - joined).days)
            except Exception:
                days_active = 1
        else:
            days_active = 1

        # longest_streak_count is a brand-new column (migration
        # 077_wrapped_longest_streak.sql) — read it in its own query so a
        # not-yet-migrated database only omits this one field instead of
        # 500ing the whole report.
        longest_streak: int | None = None
        try:
            streak_res = await run_query(
                db.table("user_profiles").select("longest_streak_count").eq("user_id", user_id).maybe_single()
            )
            val = (streak_res.data or {}).get("longest_streak_count")
            if val:
                longest_streak = int(val)
        except Exception:
            logger.warning("wrapped: longest_streak_count read failed (migration not run yet?)", exc_info=True)

        # ── 2. Portfolio ─────────────────────────────────────────────────
        port_res = await run_query(
            db.table("user_portfolio").select("portfolio_id, positions").eq("user_id", user_id)
        )
        port_rows = port_res.data or []
        default_row = next((r for r in port_rows if r.get("portfolio_id") == "default"), None)
        parsed = _parse_portfolio((default_row or port_rows[0])["positions"]) if port_rows else \
            {"positions": [], "closed_positions": []}
        positions = parsed["positions"]
        closed_positions = parsed["closed_positions"]

        invested_this_year = _invested_during_year(positions, closed_positions, year)

        # ── 3. Top posiciones que más crecieron (real cost-basis return) ──
        position_returns = await _position_returns(positions)
        position_returns.sort(key=lambda r: r["return_pct"], reverse=True)
        top_positions_raw = position_returns[:3]
        if top_positions_raw:
            names = await _company_names([r["ticker"] for r in top_positions_raw])
            for r in top_positions_raw:
                r["company_name"] = names.get(r["ticker"])

        # ── 4. Empresa favorita + empresas analizadas ──────────────────────
        from app.services import investment_graph_service
        companies = await investment_graph_service.get_most_analyzed_companies(user_id, year, limit=3)
        favorite_companies = companies["top"]
        companies_analyzed = companies["total_companies"]
        if favorite_companies:
            total_cost = sum(float(p.get("shares", 0) or 0) * float(p.get("avgPrice", 0) or 0) for p in positions)
            for f in favorite_companies:
                lots = [p for p in positions if p.get("ticker") == f["ticker"]]
                if lots and total_cost > 0:
                    cost = sum(float(p.get("shares", 0) or 0) * float(p.get("avgPrice", 0) or 0) for p in lots)
                    f["in_portfolio"] = True
                    f["weight_pct"] = round(cost / total_cost * 100, 1)
                else:
                    f["in_portfolio"] = False
                    f["weight_pct"] = None

        # ── 5. Arthur conversations this year ──────────────────────────────
        arthur_conversations = await _arthur_conversations_this_year(user_id, year)

        # ── 6. Investor Progress Engine signals — one shared ctx ───────────
        ctx = await investor_progress_service._build_context(user_id)
        archetype = await investor_progress_service.classify_investor_archetype(user_id, ctx=ctx)
        investor_type = await investor_progress_service.classify_investor_type(user_id, ctx=ctx)
        investor_score = await investor_progress_service.compute_investor_score(user_id, ctx=ctx)

        year_returns = investor_progress_service._compute_year_returns(ctx["snapshots"])
        growth_pct = round(year_returns[year], 2) if year in year_returns else None

        # ── 7. Peor decisión — realized loss first, unrealized fallback ────
        worst_decision = investor_progress_service.worst_closed_position(ctx)
        if not worst_decision and position_returns:
            worst_open = min(position_returns, key=lambda r: r["return_pct"])
            if worst_open["return_pct"] < 0:
                worst_decision = {
                    "ticker": worst_open["ticker"],
                    "pnl": round(worst_open["current_value"] - worst_open["invested"], 2),
                    "pnl_pct": worst_open["return_pct"],
                    "realized": False,
                }
        if worst_decision:
            names = await _company_names([worst_decision["ticker"]])
            worst_decision["company_name"] = names.get(worst_decision["ticker"])

        # ── 8. Percentil — investor_score dentro de la cohorte de riesgo ───
        # Never returns/patrimonio, never another user's raw score — only
        # this user's own percentile + the (anonymous) cohort size.
        percentile_block = None
        if investor_score:
            try:
                from app.api.routes.benchmark import _cohort_for, _percentile_rank
                cohort = _cohort_for(prof.get("risk_tolerance"))
                stats_res = await run_query(
                    db.table("benchmark_cohort_stats")
                    .select("values, sample_size")
                    .eq("cohort_key", cohort)
                    .eq("metric_key", "investor_score")
                    .maybe_single()
                )
                row = stats_res.data or {}
                if row.get("values") and row.get("sample_size", 0) >= 5:
                    percentile_block = {
                        "percentile": _percentile_rank(investor_score["score"], row["values"]),
                        "cohort_size": row["sample_size"],
                    }
            except Exception:
                logger.warning("wrapped: percentile computation failed for %s", user_id, exc_info=True)

        return {
            "year":       year,
            "user_name":  full_name,
            "avatar_url": avatar_url,
            "archetype":       archetype,
            "investor_type":   investor_type,
            "invested_this_year": invested_this_year,
            "growth_pct":        growth_pct,
            "companies_analyzed": companies_analyzed,
            "arthur_conversations": arthur_conversations,
            "longest_streak":    longest_streak,
            "days_active":       days_active,
            "percentile":        percentile_block,
            "favorite_companies": favorite_companies,   # [{ticker, company_name, times_analyzed, in_portfolio, weight_pct}, ...] top 3
            "top_positions":     top_positions_raw,      # [{ticker, company_name, return_pct, invested, current_value}, ...] top 3
            "worst_decision":    worst_decision,         # {ticker, company_name, pnl, pnl_pct, realized} | None
            "investor_score":    investor_score,         # {score, sub_scores} | None
        }
    except Exception:
        if _test_bypass:
            raise HTTPException(status_code=500, detail={"debug_traceback": traceback.format_exc()})
        raise
