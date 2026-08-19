"""Saved margin-of-safety alerts — a Premium user picks a ticker from
Oportunidades (/subvaluadas) and a target margin of safety they consider
attractive, then gets notified once the LIVE margin of safety (from the
current Nuvos AI Fair Value Engine, the same number the diagnostic card
itself shows) reaches or passes that threshold.

Revives migration 048's saved_valuations table (see migration 078's
docstring) — the manual-DCF-sliders methodology this table was originally
built around was retired when /subvaluadas dropped its slider UI
(valuationPanelMode.ts: no `gqv` mode anymore). This version always reads
margin_of_safety_pct straight from the same build_company_diagnostic()
path the screen itself uses, never a second, independently-computed
number that could drift from what the user saw when they set the alert.
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def get_live_margin_of_safety(ticker: str, lang: str = "es") -> Optional[dict]:
    """Real, current company_name/sector/exchange/price/margin_of_safety_pct
    for a ticker — the exact same computation the /company-diagnostic
    endpoint uses (get_fundamental_analysis -> build_company_diagnostic),
    so a saved alert's number is never a second source of truth that can
    disagree with what the user saw on /subvaluadas. Returns None if the
    diagnostic can't be built right now (missing fundamentals, etc.)."""
    from app.services.fundamental_analysis_service import get_fundamental_analysis
    from app.services.company_diagnostic_service import build_company_diagnostic

    data = get_fundamental_analysis(ticker)
    if not data:
        return None
    diagnostic = build_company_diagnostic(ticker, data, lang)
    if not diagnostic:
        return None
    valuation = diagnostic.get("valuation") or {}
    mos = valuation.get("marginOfSafetyPercent")
    price = valuation.get("currentPrice")
    if mos is None or price is None:
        return None
    return {
        "ticker": data.get("ticker") or ticker,
        "company_name": data.get("company_name"),
        "sector": data.get("sector"),
        "exchange": data.get("exchange"),
        "current_price": price,
        "margin_of_safety_pct": mos,
    }


def _with_live_data(row: dict, live: Optional[dict]) -> dict:
    """Merges a saved_valuations row with a live recompute — the shape the
    frontend (Oportunidades' alert control + Perfil's SavedValuationsSection)
    renders."""
    return {
        "ticker": row["ticker"],
        "company_name": (live or {}).get("company_name") or row.get("company_name"),
        "sector": (live or {}).get("sector"),
        "exchange": (live or {}).get("exchange"),
        "target_margin_of_safety_pct": row.get("target_margin_of_safety_pct"),
        "current_price": (live or {}).get("current_price"),
        "margin_of_safety_pct": (live or {}).get("margin_of_safety_pct"),
        "notified_at": row.get("notified_at"),
        "stale": live is None,
    }


async def list_with_live_data(user_id: str) -> list[dict]:
    import asyncio
    from app.core.database import get_supabase, run_query

    db = get_supabase()
    res = await run_query(
        db.table("saved_valuations").select("*").eq("user_id", user_id).order("created_at", desc=True)
    )
    rows = res.data or []
    if not rows:
        return []

    tickers = sorted({r["ticker"] for r in rows})
    live_list = await asyncio.gather(*[asyncio.to_thread(get_live_margin_of_safety, t) for t in tickers])
    live_map = dict(zip(tickers, live_list))

    return [_with_live_data(row, live_map.get(row["ticker"])) for row in rows]


async def save_valuation(user_id: str, ticker: str, target_margin_of_safety_pct: float) -> dict:
    import asyncio
    from app.core.database import get_supabase, run_query

    ticker = ticker.strip().upper()
    live = await asyncio.to_thread(get_live_margin_of_safety, ticker)
    if not live:
        raise ValueError(f"No hay suficientes datos financieros para {ticker} en este momento.")

    db = get_supabase()
    row = {
        "user_id": user_id,
        "ticker": ticker,
        "company_name": live.get("company_name"),
        "methodology": "fair_value_engine",
        "target_margin_of_safety_pct": target_margin_of_safety_pct,
        "price_at_save": live["current_price"],
        # Re-saving (new/edited threshold) is a new baseline — a threshold
        # already reached under a previous, different target no longer
        # applies to this one.
        "notified_at": None,
    }
    await run_query(
        db.table("saved_valuations").upsert(row, on_conflict="user_id,ticker")
    )
    saved_res = await run_query(
        db.table("saved_valuations").select("*").eq("user_id", user_id).eq("ticker", ticker)
    )
    saved_row = saved_res.data[0] if saved_res.data else row
    return _with_live_data(saved_row, live)


async def delete_valuation(user_id: str, ticker: str) -> bool:
    from app.core.database import get_supabase, run_query

    db = get_supabase()
    res = await run_query(
        db.table("saved_valuations").delete().eq("user_id", user_id).eq("ticker", ticker.strip().upper())
    )
    return bool(res.data)


def _reached_threshold(margin_pct: Optional[float], target_pct: Optional[float]) -> bool:
    """True once the live margin of safety reaches or passes the user's
    own configured target — the whole trigger condition (Diego: "cuando
    una acción llegue a cierto margen de seguridad"), a single one-shot
    threshold rather than the old fixed milestone ladder."""
    if margin_pct is None or target_pct is None:
        return False
    return margin_pct >= target_pct


async def run_milestone_check() -> None:
    """Daily job (see worker.py's job_saved_valuation_alerts): recomputes
    every saved alert's live margin of safety, and pushes ONE notification
    per user for the single most-exceeded newly-crossed threshold — same
    one-push-per-category-per-day discipline the rest of the notification
    system follows (notification_engine.can_send_push). Any other tickers
    that also crossed their own threshold the same day simply get picked
    up on a later run — nothing is lost, just delayed a day."""
    import asyncio
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push

    db = get_supabase()
    res = await run_query(
        db.table("saved_valuations").select("*").not_.is_("target_margin_of_safety_pct", "null").is_("notified_at", "null")
    )
    rows = res.data or []
    if not rows:
        return

    tickers = sorted({r["ticker"] for r in rows})
    live_list = await asyncio.gather(*[asyncio.to_thread(get_live_margin_of_safety, t) for t in tickers])
    live_map = dict(zip(tickers, live_list))

    lang_res = await run_query(db.table("user_profiles").select("user_id,preferred_language"))
    lang_map = {r["user_id"]: (r.get("preferred_language") or "es") for r in (lang_res.data or [])}

    by_user: dict[str, list[dict]] = {}
    for row in rows:
        by_user.setdefault(row["user_id"], []).append(row)

    for user_id, user_rows in by_user.items():
        candidates = []  # (margin_pct - target, row, margin_pct, live)
        for row in user_rows:
            live = live_map.get(row["ticker"])
            if not live:
                continue
            margin_pct = live["margin_of_safety_pct"]
            target = row["target_margin_of_safety_pct"]
            if not _reached_threshold(margin_pct, target):
                continue
            candidates.append((margin_pct - target, row, margin_pct, live))

        if not candidates:
            continue

        # The one furthest past its own threshold — most decision-relevant.
        _, best_row, best_margin, best_live = max(candidates, key=lambda c: c[0])
        lang = lang_map.get(user_id, "es")
        title, body = _threshold_copy(best_row["ticker"], best_row["target_margin_of_safety_pct"], best_margin, best_live["current_price"], lang)

        try:
            await send_push(
                user_id, "saved_valuation_milestone", title, body,
                {"screen": "profile", "ticker": best_row["ticker"], "margin_of_safety_pct": best_margin}, db,
            )
        except Exception as exc:
            logger.warning("run_milestone_check: push failed for %s/%s: %s", user_id, best_row["ticker"], exc)

        # Only the row actually pushed gets marked — the rest stay pending
        # and get their own turn (and push) on a later run.
        try:
            from datetime import datetime, timezone
            await run_query(
                db.table("saved_valuations").update({"notified_at": datetime.now(timezone.utc).isoformat()})
                .eq("id", best_row["id"])
            )
        except Exception as exc:
            logger.warning("run_milestone_check: failed to persist notified_at for %s: %s", best_row["id"], exc)


def _threshold_copy(ticker: str, target_pct: float, margin_pct: float, price: float, lang: str) -> tuple[str, str]:
    if lang == "en":
        title = f"🎯 {ticker} reached your target margin of safety"
        body = f"At ${price:.2f}, {ticker} is now {margin_pct:.1f}% below its estimated fair value — you set an alert at {target_pct:.0f}%."
        return title, body
    title = f"🎯 {ticker} alcanzó tu margen de seguridad objetivo"
    body = f"A ${price:.2f}, {ticker} está {margin_pct:.1f}% por debajo de su valor razonable estimado — configuraste una alerta en {target_pct:.0f}%."
    return title, body
