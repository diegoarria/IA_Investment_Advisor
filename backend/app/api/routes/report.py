import asyncio
from datetime import datetime
from fastapi import APIRouter, Depends
import yfinance as yf
from app.api.deps import get_current_user_id
from app.api.routes.market import _get_user_profile
from app.core.cache import cache_get, cache_set
from app.services import ai_service

router = APIRouter(prefix="/report", tags=["report"])

_TTL = 3600 * 6  # 6 hours — report doesn't change within a session


def _compute_performance(portfolio: list[dict]) -> dict:
    """Compute basic performance metrics from portfolio positions."""
    total_value    = 0.0
    total_invested = 0.0
    positions_perf = []

    for pos in portfolio:
        try:
            shares       = float(pos.get("shares", 0) or 0)
            avg_cost     = float(pos.get("avg_cost", 0) or 0)
            curr_price   = float(pos.get("current_price", 0) or 0)

            if not curr_price and pos.get("ticker"):
                try:
                    fi = yf.Ticker(pos["ticker"]).fast_info
                    curr_price = float(fi.last_price or 0)
                except Exception:
                    pass

            value    = shares * curr_price
            invested = shares * avg_cost
            gain_pct = ((curr_price - avg_cost) / avg_cost * 100) if avg_cost else 0

            total_value    += value
            total_invested += invested
            positions_perf.append({
                "ticker":   pos.get("ticker", ""),
                "name":     pos.get("name", pos.get("ticker", "")),
                "shares":   shares,
                "value":    round(value, 2),
                "gain_pct": round(gain_pct, 2),
                "weight_pct": 0,  # filled below
            })
        except Exception:
            continue

    for p in positions_perf:
        p["weight_pct"] = round((p["value"] / total_value * 100), 1) if total_value else 0

    total_return_pct = ((total_value - total_invested) / total_invested * 100) if total_invested else 0
    best   = max(positions_perf, key=lambda x: x["gain_pct"], default=None)
    worst  = min(positions_perf, key=lambda x: x["gain_pct"], default=None)

    return {
        "total_value":       round(total_value, 2),
        "total_invested":    round(total_invested, 2),
        "unrealized_gain":   round(total_value - total_invested, 2),
        "total_return_pct":  round(total_return_pct, 2),
        "best_performer":    {"ticker": best["ticker"],  "gain_pct": best["gain_pct"]}  if best  else None,
        "worst_performer":   {"ticker": worst["ticker"], "loss_pct": worst["gain_pct"]} if worst else None,
        "positions":         sorted(positions_perf, key=lambda x: x["value"], reverse=True)[:10],
    }


@router.post("/monthly")
async def generate_monthly_report(
    request: dict,
    user_id: str = Depends(get_current_user_id),
):
    """Generate a monthly portfolio report with AI narrative."""
    portfolio = request.get("portfolio", [])
    if not portfolio:
        return {"error": "Se requiere el portafolio para generar el reporte."}

    month_key = datetime.now().strftime("%Y-%m")
    cache_key = f"report:monthly:{user_id}:{month_key}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    performance = await asyncio.to_thread(_compute_performance, portfolio)
    profile     = _get_user_profile(user_id)
    report      = await ai_service.generate_monthly_report(portfolio, performance, profile)

    # Merge computed performance into report
    report["performance"] = {
        **report.get("performance", {}),
        "total_return_pct":  performance["total_return_pct"],
        "total_value":       performance["total_value"],
        "total_invested":    performance["total_invested"],
        "unrealized_gain":   performance["unrealized_gain"],
        "best_performer":    performance["best_performer"],
        "worst_performer":   performance["worst_performer"],
    }
    report["top_positions"] = performance["positions"]
    report["generated_at"]  = datetime.now().isoformat()
    report["month"]         = datetime.now().strftime("%B %Y")

    cache_set(cache_key, report, ttl=_TTL)
    return report
