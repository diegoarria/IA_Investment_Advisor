import asyncio
import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from app.services.financial_data_service import get_financials, invalidate_cache
from app.core.limiter import limiter
from fastapi import Request

router = APIRouter(prefix="/stocks", tags=["financials"])
logger = logging.getLogger(__name__)


@router.get("/{ticker}/financials")
@limiter.limit("30/minute")
async def get_stock_financials(
    request: Request,
    ticker: str,
    limit: int = Query(default=5, ge=1, le=10),
):
    """
    Return normalized financial statements for a ticker.

    Response shape:
    {
      "ticker": "AAPL",
      "provider": "fmp" | "yfinance",
      "incomeStatement":   { "annual": [...], "quarterly": [...] },
      "balanceSheet":      { "annual": [...], "quarterly": [...] },
      "cashFlow":          { "annual": [...], "quarterly": [...] },
      "calculatedMetrics": { "revenue": ..., "grossMarginPct": ..., ... },
      "fetchedAt": "2026-01-15T12:00:00Z"
    }

    Each period dict in the arrays has consistent field names regardless of provider.
    Values are in USD (automatically converted for foreign-listed stocks).
    """
    sym = ticker.upper().strip()
    if not sym or not sym.replace(".", "").replace("-", "").isalnum():
        raise HTTPException(status_code=400, detail="Invalid ticker symbol")

    try:
        data = await asyncio.get_event_loop().run_in_executor(
            None, lambda: get_financials(sym, limit=limit)
        )
    except Exception as exc:
        logger.error("financials endpoint error for %s: %s", sym, exc)
        raise HTTPException(status_code=500, detail="Failed to fetch financial data")

    if not data or data.get("provider") == "none":
        if (
            not data.get("incomeStatement", {}).get("annual")
            and not data.get("balanceSheet", {}).get("annual")
        ):
            raise HTTPException(
                status_code=404,
                detail=f"No financial data found for {sym}",
            )

    return JSONResponse(content=data)


@router.delete("/{ticker}/financials/cache")
async def bust_financials_cache(ticker: str):
    """Dev/admin endpoint to force a cache invalidation for a ticker."""
    sym = ticker.upper().strip()
    invalidate_cache(sym)
    return {"ok": True, "ticker": sym}
