"""Read-only admin panel — lets an admin (you) look up any user by email and
see their complete profile, portfolio, watchlist, progress, and behavioral
memory in one view. Deliberately NOT a real "log in as" — that would mean
generating a second active session in the same browser, which is exactly
the kind of cross-account data collision that caused accounts to show each
other's data (fixed separately). This is a one-way, read-only snapshot
instead: safer, simpler, and sufficient for support/debugging."""
import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.database import get_supabase, run_query
from app.services import fmg_service, investor_progress_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])


def _admin_emails() -> set[str]:
    return {e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()}


async def _require_admin(user: dict) -> None:
    if (user.get("email") or "").lower() not in _admin_emails():
        raise HTTPException(status_code=403, detail="No autorizado")


async def _find_user_by_email(email: str, db) -> dict | None:
    try:
        users = await asyncio.to_thread(lambda: db.auth.admin.list_users())
        for u in users:
            if (u.email or "").lower() == email.lower():
                return {"id": u.id, "email": u.email}
    except Exception as e:
        logger.warning("_find_user_by_email failed: %s", e)
    return None


def _agg_positions(rows: list[dict]) -> list:
    """Same aggregation used across worker.py — a user can have positions
    spread across multiple portfolio rows (premium multi-portfolio)."""
    positions: list = []
    for row in rows:
        raw = row.get("positions", [])
        if isinstance(raw, dict) and "_v" in raw:
            raw = raw.get("positions", [])
        if isinstance(raw, list):
            positions.extend(raw)
    return positions


@router.post("/test-price-alert-why")
async def test_price_alert_why(ticker: str, pct: float = 5.0, user: dict = Depends(get_current_user)):
    """Diagnoses, stage by stage, why the price-mover push keeps saying
    NO_CATALYST instead of a real reason: is Perplexity even configured? Did
    it return anything? Did Finnhub's news return anything? Did we even
    reach the Claude call? Runs the REAL pipeline functions live — no
    guessing, no reading logs after the fact."""
    await _require_admin(user)
    import os
    from app.services.price_alert_service import (
        search_price_catalyst, fetch_ticker_news, generate_price_alert_why, NO_CATALYST,
    )

    ticker = ticker.upper().strip()
    perplexity_configured = bool(getattr(settings, "perplexity_api_key", "") or os.getenv("PERPLEXITY_API_KEY", ""))

    perplexity_error = None
    try:
        web_context = await search_price_catalyst(ticker, pct)
    except Exception as e:
        web_context = ""
        perplexity_error = str(e)

    finnhub_error = None
    try:
        news_items = await asyncio.to_thread(fetch_ticker_news, ticker)
    except Exception as e:
        news_items = []
        finnhub_error = str(e)

    if not web_context and not news_items:
        claude_called = False
        final_result = NO_CATALYST
    else:
        claude_called = True
        final_result = await generate_price_alert_why(ticker, pct, 100.0, news_items, extra_context=web_context)

    return {
        "ticker": ticker,
        "perplexity_api_key_configured": perplexity_configured,
        "perplexity_web_context_length": len(web_context),
        "perplexity_web_context_preview": web_context[:400],
        "perplexity_error": perplexity_error,
        "finnhub_news_count": len(news_items),
        "finnhub_news_preview": news_items[:3],
        "finnhub_error": finnhub_error,
        "claude_was_called": claude_called,
        "final_result": final_result,
        "is_no_catalyst": final_result == NO_CATALYST,
    }


@router.post("/test-market-open")
async def test_market_open(user: dict = Depends(get_current_user)):
    """Fires the REAL market-open data fetch (live Finnhub ^GSPC/^IXIC quotes,
    real portfolio calc) and sends ONE test push to the calling admin's own
    account only — never touches other users. Built to answer a concrete
    question: does this actually pull real index points at request time, or
    silently fall back? The response includes the raw fetched values even if
    push delivery itself has no channel configured, so this is useful purely
    as a diagnostic even without a registered device."""
    await _require_admin(user)
    import worker
    from app.services.notification_engine import send_push

    admin_id = user["id"]
    db = get_supabase()

    idx = await worker._fetch_market_open_indices()
    sp_line, nq_line = worker._market_open_lines(
        idx["sp500_pct"], idx["sp500_points"], idx["nasdaq_pct"], idx["nasdaq_points"]
    )

    port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", admin_id))
    positions = _agg_positions(port_res.data or [])
    portfolio_pct = None
    if positions:
        tickers = {p["ticker"] for p in positions if p.get("ticker")}
        prices = await worker._finnhub_prices_batch(list(tickers))
        portfolio_pct = worker._calc_portfolio_pct(positions, prices)

    if portfolio_pct is not None:
        body = f"{sp_line}\n{nq_line}\n\nTu portafolio: {portfolio_pct:+.2f}% hoy. Entra a ver el detalle."
    elif positions:
        body = f"{sp_line}\n{nq_line}\n\nNo se pudo calcular tu portafolio (precios no disponibles)."
    else:
        body = f"{sp_line}\n{nq_line}\n\nEntra a ver cómo se está comportando tu portafolio."

    profile_res = await run_query(db.table("user_profiles").select("name").eq("user_id", admin_id).limit(1))
    first = ((profile_res.data or [{}])[0].get("name") or "Inversor").split()[0]
    title = f"{first}, el mercado ha abierto 🔔 (TEST)"

    # Distinct category so this test never consumes today's real "market_open"
    # dedup slot — the actual 9:30am job for this same admin still fires normally.
    await send_push(admin_id, "market_open_test", title, body, {"screen": "portfolio"}, db)

    return {
        "used_fallback": idx["used_fallback"],
        "sp500_points": idx["sp500_points"],
        "sp500_pct": idx["sp500_pct"],
        "nasdaq_points": idx["nasdaq_points"],
        "nasdaq_pct": idx["nasdaq_pct"],
        "portfolio_pct": portfolio_pct,
        "title": title,
        "body": body,
    }


@router.get("/user-snapshot")
async def get_user_snapshot(email: str, user: dict = Depends(get_current_user)):
    await _require_admin(user)

    db = get_supabase()
    target = await _find_user_by_email(email, db)
    if not target:
        raise HTTPException(status_code=404, detail="No existe un usuario con ese correo")
    target_id = target["id"]

    profile_res, portfolio_res, watchlist_res, fmg_res = await asyncio.gather(
        run_query(db.table("user_profiles").select("*").eq("user_id", target_id).limit(1)),
        run_query(db.table("user_portfolio").select("positions").eq("user_id", target_id)),
        run_query(db.table("watchlist").select("ticker,name,added_at").eq("user_id", target_id)),
        fmg_service.get_fmg_context(target_id),
        return_exceptions=True,
    )

    profile = {} if isinstance(profile_res, Exception) or not profile_res.data else profile_res.data[0]
    positions = [] if isinstance(portfolio_res, Exception) else _agg_positions(portfolio_res.data or [])
    watchlist = [] if isinstance(watchlist_res, Exception) else (watchlist_res.data or [])

    try:
        progress = await investor_progress_service.compute_progress_summary(target_id)
    except Exception as e:
        logger.warning("Admin snapshot: progress summary failed for %s: %s", target_id, e)
        progress = {}

    memories_res, patterns_res, events_res = await asyncio.gather(
        run_query(
            db.table("fmg_memories").select("type,content,times_reinforced")
            .eq("user_id", target_id).eq("is_active", True).order("times_reinforced", desc=True).limit(30)
        ),
        run_query(
            db.table("fmg_behavioral_patterns").select("pattern_key,description,confidence,times_observed,is_positive")
            .eq("user_id", target_id).order("confidence", desc=True).limit(20)
        ),
        run_query(
            db.table("fmg_events").select("event_type,title,description,occurred_at")
            .eq("user_id", target_id).order("occurred_at", desc=True).limit(15)
        ),
        return_exceptions=True,
    )

    return {
        "user_id": target_id,
        "email": target["email"],
        "profile": profile,
        "positions": positions,
        "watchlist": watchlist,
        "progress": progress,
        "fmg": {
            "memories": [] if isinstance(memories_res, Exception) else (memories_res.data or []),
            "patterns": [] if isinstance(patterns_res, Exception) else (patterns_res.data or []),
            "events": [] if isinstance(events_res, Exception) else (events_res.data or []),
        },
    }
