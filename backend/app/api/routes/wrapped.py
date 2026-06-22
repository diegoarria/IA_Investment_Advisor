"""
Annual Nuvos Wrapped — user year-in-review stats.
GET /api/wrapped/annual
"""
import asyncio
import logging
from datetime import datetime, timezone

import yfinance as yf
from fastapi import APIRouter, Depends, Request
from app.api.deps import get_current_user
from app.core.database import get_supabase, run_query
from app.core.limiter import limiter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/wrapped", tags=["wrapped"])


async def _ytd_return(ticker: str, year: int) -> float | None:
    """Return YTD % gain for ticker in given year. None if unavailable."""
    try:
        start = f"{year}-01-01"
        end   = f"{year}-12-31"
        data  = await asyncio.to_thread(
            lambda: yf.download(ticker, start=start, end=end, progress=False, auto_adjust=True)
        )
        if data.empty or len(data) < 2:
            return None
        first = float(data["Close"].dropna().iloc[0])
        last  = float(data["Close"].dropna().iloc[-1])
        if first == 0:
            return None
        return round((last - first) / first * 100, 2)
    except Exception:
        return None


async def _ticker_sector(ticker: str) -> str:
    """Return sector string from yfinance, 'Otro' on failure."""
    try:
        info = await asyncio.to_thread(lambda: yf.Ticker(ticker).info)
        return info.get("sector") or "Otro"
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


@router.get("/annual")
@limiter.limit("10/hour")
async def get_wrapped(
    request: Request,
    user: dict = Depends(get_current_user),
):
    db        = get_supabase()
    user_id   = user["id"]
    now       = datetime.now(timezone.utc)
    year      = now.year

    # ── 1. User profile ──────────────────────────────────────────────────────
    prof_res = await run_query(
        db.table("user_profiles")
          .select("full_name, sim_count, debate_count, msg_count, created_at")
          .eq("user_id", user_id)
    )
    prof = prof_res.data[0] if prof_res.data else {}

    full_name   = prof.get("full_name") or "Inversor"
    sim_count   = prof.get("sim_count") or 0
    debate_count= prof.get("debate_count") or 0
    lessons     = sim_count + debate_count

    created_raw = prof.get("created_at")
    if created_raw:
        try:
            joined = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
            days_active = max(1, (now - joined).days)
        except Exception:
            days_active = 1
    else:
        days_active = 1

    # ── 2. Portfolio positions ────────────────────────────────────────────────
    port_res = await run_query(
        db.table("user_portfolio").select("positions").eq("user_id", user_id)
    )
    raw = (port_res.data[0].get("positions") or {}) if port_res.data else {}
    positions: list = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
    tickers = [p["ticker"] for p in positions if p.get("ticker")]

    # ── 3. Top 3 stocks by YTD return ────────────────────────────────────────
    ytd_results: list[dict] = []
    if tickers:
        returns = await asyncio.gather(*[_ytd_return(t, year) for t in tickers])
        for ticker, ret in zip(tickers, returns):
            if ret is not None:
                ytd_results.append({"ticker": ticker, "ytd_pct": ret})
        ytd_results.sort(key=lambda x: x["ytd_pct"], reverse=True)
    top3 = ytd_results[:3]

    # ── 4. Dominant sector ───────────────────────────────────────────────────
    top_sector = "Tecnología"
    if tickers:
        sector_tasks = await asyncio.gather(*[_ticker_sector(t) for t in tickers])
        sector_counts: dict[str, float] = {}
        for ticker, sector in zip(tickers, sector_tasks):
            # Weight by value if available
            value = next((p.get("value", 1) for p in positions if p.get("ticker") == ticker), 1)
            sector_counts[sector] = sector_counts.get(sector, 0) + float(value or 1)
        if sector_counts:
            dominant = max(sector_counts, key=lambda k: sector_counts[k])
            top_sector = _es_sector(dominant)

    return {
        "year":        year,
        "user_name":   full_name,
        "top_stocks":  top3,           # [{ticker, ytd_pct}, ...]
        "lessons":     lessons,        # sim + debates
        "days_active": days_active,
        "top_sector":  top_sector,
        "sim_count":   sim_count,
        "debate_count": debate_count,
    }
