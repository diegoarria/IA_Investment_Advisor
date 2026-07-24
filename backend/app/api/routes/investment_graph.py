"""
Investment Graph — read endpoints for "Tu Bitácora" (Mi Perfil) and
"Tu historia con esta empresa" (stock detail). Write-side logging happens
inline in chat.py, screener.py, watchlist.py, and worker.py's earnings
dispatch — see investment_graph_service.py for the shared log_event().
"""
import asyncio
import logging

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user_id
from app.services import investment_graph_service as graph_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/graph", tags=["investment-graph"])


@router.get("/company/{ticker}")
async def get_company_timeline(ticker: str, limit: int = 100, user_id: str = Depends(get_current_user_id)):
    """Merged, time-sorted feed for one ticker — 'Tu historia con esta empresa'."""
    timeline = await graph_service.get_company_timeline(user_id, ticker, limit=limit)
    return {"ticker": ticker.upper(), "timeline": timeline}


@router.get("/timeline")
async def get_global_timeline(limit: int = 100, user_id: str = Depends(get_current_user_id)):
    """Cross-company feed — 'Tu Bitácora'."""
    timeline = await graph_service.get_global_timeline(user_id, limit=limit)
    return {"timeline": timeline}


@router.get("/metrics")
async def get_metrics(user_id: str = Depends(get_current_user_id)):
    """The 6 Investment Graph metrics. Fetches live prices only for the
    small set of tickers with theses old enough to evaluate (>=30 days) —
    never blocks on the full history, and thesis_accuracy_pct stays null
    rather than guessed when a quote can't be fetched."""
    from datetime import datetime, timezone
    from worker import _finnhub_quote

    events = await graph_service._fetch_graph_events(user_id, None, limit=1000)
    theses = [e for e in events if e["event_type"] == "thesis"]
    now = datetime.now(timezone.utc)

    stale_tickers: set[str] = set()
    for t in theses:
        occurred_at = t.get("occurred_at")
        if not occurred_at:
            continue
        try:
            thesis_dt = datetime.fromisoformat(occurred_at.replace("Z", "+00:00"))
        except Exception:
            continue
        if (now - thesis_dt).days >= 30:
            stale_tickers.add(t["ticker"])

    price_lookup: dict[str, float] = {}
    if stale_tickers:
        quotes = await asyncio.gather(
            *[asyncio.to_thread(_finnhub_quote, t) for t in stale_tickers],
            return_exceptions=True,
        )
        for ticker, quote in zip(stale_tickers, quotes):
            if isinstance(quote, dict) and quote.get("curr"):
                price_lookup[ticker] = quote["curr"]

    metrics = await graph_service.compute_metrics(user_id, price_lookup=price_lookup)
    return metrics
