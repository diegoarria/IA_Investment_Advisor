"""Company logo proxy — GET /api/logo/{ticker}.

Wrapped's screenshot/share feature (wrapped/screens.tsx's TickerLogo) needs
company logos loaded as CORS-clean <img crossOrigin="anonymous"> so
html2canvas's useCORS export can paint them into a canvas without tainting
it. The logo CDN used there (parqet.com) doesn't send an
Access-Control-Allow-Origin header on its image responses (confirmed live,
2026-08-20 — every company logo on the Wrapped screens fell back to
initials-only for every user, not just during screenshot export), so a
direct crossOrigin fetch of it fails outright in the browser.

This endpoint fetches the image bytes server-side (an origin restriction is
meaningless to a server-to-server request) and re-serves them from our own
domain, where the app's already-configured CORSMiddleware (main.py) adds
Access-Control-Allow-Origin automatically — no per-route header wrangling
needed here.

`?format=png` (Diego, 2026-08-30): React Native's <Image> component has no
SVG support at all — parqet's default response here is SVG, so mobile's
TickerLogo silently failed onError -> initials-only for every ticker,
confirmed live (assets.parqet.com/logos/symbol/AAPL?format=png returns a
real 200 image/png; ?format=svg returns image/svg+xml). Web keeps calling
this endpoint with no format param (defaults to svg, which <img> renders
fine) — this is additive, not a behavior change for web.
"""
import base64
import logging

import httpx
from fastapi import APIRouter, HTTPException, Response

from app.core.cache import cache_get, cache_set

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/logo", tags=["logo"])

_TTL = 24 * 3600  # matches parqet's own Cache-Control: max-age=86400


async def _fetch(url: str) -> tuple[bytes, str] | None:
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(url, timeout=8)
        if r.status_code != 200 or not r.content:
            return None
        return r.content, r.headers.get("content-type", "image/svg+xml")
    except Exception as e:
        logger.debug("logo proxy fetch failed for %s: %s", url, e)
        return None


@router.get("/{ticker}")
async def get_logo(ticker: str, format: str = "svg"):
    ticker = ticker.strip().upper()
    if not ticker:
        raise HTTPException(status_code=404, detail="No logo")
    fmt = format if format in ("svg", "png") else "svg"

    cache_key = f"logo_proxy:{ticker}:{fmt}"
    cached = cache_get(cache_key)
    if cached:
        return Response(
            content=base64.b64decode(cached["body_b64"]),
            media_type=cached["content_type"],
            headers={"Cache-Control": "public, max-age=86400"},
        )

    clean = ticker.replace(".", "-")
    result = await _fetch(f"https://assets.parqet.com/logos/symbol/{clean}?format={fmt}")

    if not result:
        # Fallback chain mirrors watchlist.py's _fetch_logo_url (Finnhub
        # profile2 -> logo, or weburl -> Clearbit) for tickers parqet
        # doesn't cover.
        from app.api.routes.watchlist import _fetch_logo_url
        import asyncio
        fallback_url = await asyncio.to_thread(_fetch_logo_url, ticker)
        if fallback_url:
            result = await _fetch(fallback_url)

    if not result:
        raise HTTPException(status_code=404, detail="No logo")

    body, content_type = result
    cache_set(cache_key, {"body_b64": base64.b64encode(body).decode(), "content_type": content_type}, ttl=_TTL)
    return Response(content=body, media_type=content_type, headers={"Cache-Control": "public, max-age=86400"})
