"""
Nuvos ETF — Fase 2A: the HTTP surface for the ETF engine (app/services/etf/).

Fase 8C (2026-11-12, Diego): "no Nuvos Plus subscription for now — ship
what's built as free for every authenticated user, decide monetization
later." The admin-only gate from Fase 2A is gone; every route below now
only requires a verified session (`get_current_user`), same as any other
free screen in the app. Nothing else changed here — rate limits, FMP
caching/budget and input validation are exactly as they were.
"""
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.deps import get_current_user
from app.core.limiter import limiter
from app.services.etf.categories import get_categories
from app.services.etf.comparison import MAX_COMPARE, MIN_COMPARE, ComparisonValidationError, compare_etfs
from app.services.etf.service import NotAnETFError, get_etf_card_summary, get_etf_overview
from app.services.etf.universe import search_etf_universe

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/etf", tags=["etf"])

_TICKER_RE = re.compile(r"^[A-Z]{1,6}(\.[A-Z]{1,3})?$")


@router.get("/categories")
@limiter.limit("20/minute")
async def get_etf_categories(request: Request, user: dict = Depends(get_current_user)):
    """Curated, explicitly limited category buckets — see categories.py's
    docstring for why these are hand-picked rather than inferred."""
    import asyncio
    categories = await asyncio.to_thread(get_categories)
    return {"categories": categories}


@router.get("/search")
@limiter.limit("30/minute")
async def search_etf(request: Request, q: str = "", limit: int = 20, user: dict = Depends(get_current_user)):
    """Real-time search against the cached FMP ETF universe (7k+ real
    ETFs, one shared cache entry — see universe.py). No per-result
    classification calls; every entry is already a confirmed ETF by
    construction (it's FMP's own ETF list)."""
    q = (q or "").strip()
    if len(q) < 1:
        return {"query": q, "results": []}
    limit = max(1, min(limit, 50))
    import asyncio
    results = await asyncio.to_thread(search_etf_universe, q, limit)
    return {"query": q, "results": results}


_MAX_CARDS_PER_REQUEST = 6
_CARD_FETCH_CONCURRENCY = 3


@router.get("/cards")
@limiter.limit("20/minute")
async def get_etf_cards(request: Request, tickers: str = "", lang: str = "es", user: dict = Depends(get_current_user)):
    """Enriched-card data for the Explorer — Fase 2B redesign. Capped at
    _MAX_CARDS_PER_REQUEST per call (the frontend's "cargar más" loads the
    next batch as a separate request, never more at once) and fetched
    with bounded concurrency (_CARD_FETCH_CONCURRENCY) so one request
    can't fire off an unbounded burst of FMP calls — each ticker's
    underlying data is cached 24h after its first fetch regardless.

    Returns one entry per requested ticker, success or a clearly-marked
    unavailable one — never silently drops a ticker from the response."""
    requested = [t.strip().upper() for t in tickers.split(",") if t.strip()][:_MAX_CARDS_PER_REQUEST]
    if not requested:
        return {"cards": []}
    for t in requested:
        if not _TICKER_RE.match(t):
            raise HTTPException(status_code=400, detail=f"'{t}' no parece un símbolo de ticker válido")

    import asyncio
    semaphore = asyncio.Semaphore(_CARD_FETCH_CONCURRENCY)

    async def _fetch_one(ticker: str) -> dict:
        async with semaphore:
            try:
                return await asyncio.to_thread(get_etf_card_summary, ticker, True, lang)
            except NotAnETFError:
                return {"ticker": ticker, "available": False, "reason": "not_etf"}
            except Exception:
                logger.exception("etf route: get_etf_card_summary(%s) raised unexpectedly", ticker)
                return {"ticker": ticker, "available": False, "reason": "unavailable"}

    cards = await asyncio.gather(*(_fetch_one(t) for t in requested))
    for c in cards:
        c.setdefault("available", True)
    return {"cards": cards}


@router.get("/compare")
@limiter.limit("15/minute")
async def compare_etf_route(request: Request, tickers: str = "", lang: str = "es", user: dict = Depends(get_current_user)):
    """Fase 3A, Etapa 1 — educational ETF comparator (backend only, no UI
    yet). Reuses get_etf_overview()'s cache entirely — comparing 2-3
    tickers already visited in the ficha individual costs zero new FMP
    calls. 400 for a malformed ticker, wrong count, or duplicates; never
    silently drops a requested ticker — one that isn't an ETF or whose
    fetch fails shows up in the response's `unavailable` list instead."""
    requested = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if len(requested) < MIN_COMPARE or len(requested) > MAX_COMPARE:
        raise HTTPException(status_code=400, detail=f"Se requieren entre {MIN_COMPARE} y {MAX_COMPARE} tickers para comparar.")
    if len(set(requested)) != len(requested):
        raise HTTPException(status_code=400, detail="No se puede comparar un ticker consigo mismo — hay tickers duplicados.")
    for t in requested:
        if not _TICKER_RE.match(t):
            raise HTTPException(status_code=400, detail=f"'{t}' no parece un símbolo de ticker válido")

    import asyncio
    try:
        result = await asyncio.to_thread(compare_etfs, requested, lang, True)
    except ComparisonValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        logger.exception("etf route: compare_etfs(%s) raised unexpectedly", requested)
        raise HTTPException(status_code=503, detail="No pudimos generar la comparación en este momento. Intenta de nuevo en unos segundos.")

    return result


# Must come AFTER /categories, /search and /compare — a literal path segment always
# matches before this catch-all {ticker} path parameter in FastAPI's
# routing, but keeping declaration order correct here too avoids ever
# depending on that implementation detail.
@router.get("/{ticker}")
@limiter.limit("20/minute")
async def get_etf(request: Request, ticker: str, lang: str = "es", user: dict = Depends(get_current_user)):
    """Returns get_etf_overview()'s structured result for `ticker`. 422 if
    it isn't an ETF, 400 for a malformed ticker, 503 if every provider
    call failed (degrades, never a raw 500)."""
    ticker = (ticker or "").strip().upper()
    if not ticker or not _TICKER_RE.match(ticker):
        raise HTTPException(status_code=400, detail=f"'{ticker}' no parece un símbolo de ticker válido")

    import asyncio
    try:
        overview = await asyncio.to_thread(get_etf_overview, ticker, True, lang)
    except NotAnETFError:
        raise HTTPException(
            status_code=422,
            detail={"is_etf": False, "ticker": ticker, "message": f"{ticker} no se clasifica como un ETF."},
        )
    except Exception:
        logger.exception("etf route: get_etf_overview(%s) raised unexpectedly", ticker)
        raise HTTPException(status_code=503, detail=f"No pudimos obtener los datos de {ticker} en este momento. Intenta de nuevo en unos segundos.")

    if len(overview["data_quality"]["missing_fields"]) >= 7:
        raise HTTPException(status_code=503, detail=f"No pudimos obtener los datos de {ticker} en este momento. Intenta de nuevo en unos segundos.")

    return overview
