"""
Annual Nuvos Investor Wrapped — 12-screen year-in-review.
GET /api/wrapped/annual

Only accessible Dec 15 - Jan 15 (inclusive), every year, forever — see
app/core/wrapped_window.py, the single source of truth for that check.
Available to every user, free and premium alike (Diego: the whole point is
that everyone gets one, same as Spotify Wrapped) — unlike the rest of the
Investor Progress Engine, nothing here is premium-gated.
"""
import asyncio
import logging
import traceback
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from app.api.deps import get_current_user
from app.core.database import get_supabase, run_query
from app.core.limiter import limiter
from app.core.wrapped_window import is_wrapped_window_open, wrapped_year_for
from app.services import investor_progress_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/wrapped", tags=["wrapped"])


async def _ytd_return(ticker: str, year: int) -> float | None:
    """Return YTD % gain for ticker in given year. None if unavailable."""
    try:
        from app.core.finnhub import fh_candles

        from_dt = datetime(year, 1, 1, tzinfo=timezone.utc)
        to_dt   = datetime(year, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
        from_ts = int(from_dt.timestamp())
        to_ts   = int(to_dt.timestamp())

        candles = await asyncio.to_thread(fh_candles, ticker, "W", from_ts, to_ts)
        if not candles or len(candles) < 2:
            return None
        first = candles[0].get("c")
        last  = candles[-1].get("c")
        if not first or first == 0:
            return None
        return round((float(last) - float(first)) / float(first) * 100, 2)
    except Exception:
        return None


async def _ticker_sector(ticker: str) -> str:
    """Return industry string from Finnhub profile, 'Otro' on failure."""
    try:
        from app.core.finnhub import fh_profile
        profile = await asyncio.to_thread(fh_profile, ticker)
        return (profile or {}).get("finnhubIndustry") or "Otro"
    except Exception:
        return "Otro"


_SECTOR_ES: dict[str, str] = {
    "Technology":             "Tecnología",
    "Financial Services":     "Servicios financieros",
    "Healthcare":             "Salud",
    "Consumer Cyclical":      "Consumo cíclico",
    "Consumer Defensive":     "Consumo básico",
    "Industrials":            "Industriales",
    "Energy":                 "Energía",
    "Real Estate":            "Bienes raíces",
    "Communication Services": "Comunicación",
    "Basic Materials":        "Materiales",
    "Utilities":              "Utilidades",
}


def _es_sector(sector: str) -> str:
    return _SECTOR_ES.get(sector, sector)


async def _position_stake(ticker: str, positions: list[dict]) -> dict | None:
    """Real $ compraste / $ valor actual for one ticker, summed across every
    lot — never a guessed/estimated figure. None if the current price isn't
    fetchable (never fabricated)."""
    from app.core.finnhub import fh_quote
    lots = [p for p in positions if p.get("ticker") == ticker]
    if not lots:
        return None
    shares = sum(float(p.get("shares", 0) or 0) for p in lots)
    invested = sum(float(p.get("shares", 0) or 0) * float(p.get("avgPrice", 0) or 0) for p in lots)
    quote = await asyncio.to_thread(fh_quote, ticker)
    if not quote or not quote.get("price"):
        return None
    current_value = shares * float(quote["price"])
    return {"invested": round(invested, 2), "current_value": round(current_value, 2)}


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
        db        = get_supabase()
        user_id   = user["id"]
        year      = wrapped_year_for(now) if not _test_bypass else now.year

        # ── 1. User profile ──────────────────────────────────────────────────────
        prof_res = await run_query(
            db.table("user_profiles")
              .select("name, created_at, investment_goal, investment_goal_amount")
              .eq("user_id", user_id)
        )
        prof = prof_res.data[0] if prof_res.data else {}

        full_name = prof.get("name") or "Inversor"

        created_raw = prof.get("created_at")
        if created_raw:
            try:
                joined = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
                days_active = max(1, (now - joined).days)
            except Exception:
                days_active = 1
        else:
            days_active = 1

        # ── 2. Yearly lesson/sim counts from user_daily_usage ────────────────────
        usage_res = await run_query(
            db.table("user_daily_usage")
              .select("sim_count, debate_count")
              .eq("user_id", user_id)
              .gte("date", f"{year}-01-01")
              .lte("date", f"{year}-12-31")
        )
        sim_count   = sum(r.get("sim_count", 0) or 0 for r in (usage_res.data or []))
        debate_count= sum(r.get("debate_count", 0) or 0 for r in (usage_res.data or []))
        lessons     = sim_count + debate_count

        # ── 3. Portfolio positions ────────────────────────────────────────────────
        port_res = await run_query(
            db.table("user_portfolio").select("portfolio_id, positions").eq("user_id", user_id)
        )
        port_rows = port_res.data or []
        default_port_row = next((r for r in port_rows if r.get("portfolio_id") == "default"), None)
        if port_rows:
            raw = (default_port_row or port_rows[0]).get("positions") or {}
        else:
            raw = {}
        positions: list = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
        tickers = list(dict.fromkeys(p["ticker"] for p in positions if p.get("ticker")))

        # ── 4. Top 3 stocks by YTD return (mejor decisión podio) ─────────────────
        ytd_results: list[dict] = []
        if tickers:
            returns = await asyncio.gather(*[_ytd_return(t, year) for t in tickers])
            for ticker, ret in zip(tickers, returns):
                if ret is not None:
                    ytd_results.append({"ticker": ticker, "ytd_pct": ret})
            ytd_results.sort(key=lambda x: x["ytd_pct"], reverse=True)
        top3 = ytd_results[:3]
        # Real $ compraste/valor actual for the #1 position — never for the
        # whole podium (extra live quote calls per open request), and never
        # fabricated when a quote isn't fetchable (the field is just omitted).
        if top3:
            stake = await _position_stake(top3[0]["ticker"], positions)
            if stake:
                top3[0].update(stake)

        # ── 5. Dominant sector ───────────────────────────────────────────────────
        top_sector = "Tecnología"
        if tickers:
            sector_tasks = await asyncio.gather(*[_ticker_sector(t) for t in tickers])
            sector_counts: dict[str, float] = {}
            for ticker, sector in zip(tickers, sector_tasks):
                value = sum(float(p.get("value", 1) or 1) for p in positions if p.get("ticker") == ticker)
                sector_counts[sector] = sector_counts.get(sector, 0) + value
            if sector_counts:
                dominant = max(sector_counts, key=lambda k: sector_counts[k])
                top_sector = _es_sector(dominant)

        # ── 6. Empresas favoritas (most analyzed, real event counts) ─────────────
        from app.services import investment_graph_service
        favoritas = await investment_graph_service.get_most_analyzed_tickers(user_id, year, limit=3)

        # ── 7. Vs. otros inversionistas Nuvos (percentile within risk cohort) ────
        percentile_block = None
        try:
            from app.api.routes.benchmark import _cohort_for, _percentile_rank
            risk_res = await run_query(
                db.table("user_profiles").select("risk_tolerance").eq("user_id", user_id).maybe_single()
            )
            cohort = _cohort_for((risk_res.data or {}).get("risk_tolerance"))
            summary = await investor_progress_service.compute_progress_summary(user_id)
            your_return = summary.get("cumulative_return_pct")
            if your_return is not None:
                stats_res = await run_query(
                    db.table("benchmark_cohort_stats")
                    .select("values, sample_size")
                    .eq("cohort_key", cohort)
                    .eq("metric_key", "cumulative_return_pct")
                    .maybe_single()
                )
                row = stats_res.data or {}
                if row.get("values") and row.get("sample_size", 0) >= 5:
                    percentile_block = {
                        "percentile": _percentile_rank(your_return, row["values"]),
                        "cohort_size": row["sample_size"],
                    }
        except Exception:
            logger.warning("wrapped: percentile computation failed for %s", user_id, exc_info=True)

        # ── 8. Vs. el mercado — SPY, same YTD-for-year basis as top_stocks ───────
        spy_ytd_pct = await _ytd_return("SPY", year)

        # ── 9. Próximo capítulo ───────────────────────────────────────────────────
        next_chapter = None
        if prof.get("investment_goal"):
            next_chapter = prof["investment_goal"]
            # Stored as a string (see UserProfile.investment_goal_amount) — cast
            # before formatting, and drop the amount rather than 500 the whole
            # report if it's not actually numeric.
            raw_amount = prof.get("investment_goal_amount")
            if raw_amount:
                try:
                    next_chapter = f"{next_chapter} — ${float(raw_amount):,.0f}"
                except (TypeError, ValueError):
                    pass

        result = {
            "year":        year,
            "user_name":   full_name,
            "top_stocks":  top3,           # [{ticker, ytd_pct[, invested, current_value]}, ...]
            "favoritas":   favoritas,      # [{ticker, times_analyzed}, ...]
            "lessons":     lessons,
            "days_active": days_active,
            "top_sector":  top_sector,
            "sim_count":   sim_count,
            "debate_count": debate_count,
            "next_chapter": next_chapter,
            "vs_community": percentile_block,
            "spy_ytd_pct": spy_ytd_pct,
        }

        # Investor Progress Engine fields — real for every account, not just
        # Premium (unlike the rest of that engine): archetype, Investor Score,
        # this year's growth, milestones, decisions logged, evolution.
        try:
            result.update(await investor_progress_service.get_wrapped_extension(user_id, year))
        except Exception:
            logger.warning("get_wrapped_extension failed for %s", user_id, exc_info=True)

        return result
    except Exception:
        if _test_bypass:
            raise HTTPException(status_code=500, detail={"debug_traceback": traceback.format_exc()})
        raise
