"""Saved intrinsic valuations — a Premium user freezes their own DCF
assumptions (growth/discount-rate/terminal-growth) for a ticker from the
Valor Intrínseco screen, then gets notified as the live margin of safety
(recomputed with those frozen assumptions against fresh fundamentals/
price) crosses meaningful thresholds.

MILESTONES is asymmetric on purpose: a single downside warning (-10%,
"getting expensive relative to your own thesis") versus four upside
undervaluation milestones (0/10/20/30/40%) — this mirrors how an investor
actually uses margin of safety: one heads-up when a thesis breaks down,
several checkpoints on the way to "this is a great price."
"""
import logging
from typing import Optional

from app.services.valuation.numeric_helpers import calc_margin_of_safety

logger = logging.getLogger(__name__)

MILESTONES = [-10, 0, 10, 20, 30, 40]
_DCF_YEARS = 10


def compute_iv(
    fcf0_millions: float, growth_pct: float, discount_rate_pct: float, terminal_growth_pct: float,
    net_cash_millions: float, shares_millions: float,
) -> Optional[float]:
    """Same constant-growth two-stage DCF the frontend's dcfCalculator.ts
    uses (not fundamental_analysis_service's own fading-growth _run_dcf) —
    this must reproduce exactly what the user saw and agreed to when they
    moved the sliders, not Nuvos's own auto-computed model."""
    from app.services.fundamental_analysis_service import _run_dcf_constant_growth

    g, r, gt = growth_pct / 100, discount_rate_pct / 100, terminal_growth_pct / 100
    if not shares_millions or shares_millions <= 0:
        return None
    if r == g or r == gt:
        return None
    try:
        result = _run_dcf_constant_growth(fcf0_millions, g, r, gt, years=_DCF_YEARS)
    except ZeroDivisionError:
        return None
    equity = result["enterprise_value"] + net_cash_millions
    value = equity / shares_millions
    return value if value == value and value not in (float("inf"), float("-inf")) else None  # NaN/inf guard


def get_live_inputs(ticker: str) -> Optional[dict]:
    """Fresh company_name/sector/exchange/price/current_fcf/net_cash/
    shares_outstanding for a ticker — the same real, previously-computed
    numbers the Valor Intrínseco screen's autofill chips show. Returns None
    if the ticker's fundamentals can't be loaded right now."""
    from app.services.fundamental_analysis_service import get_fundamental_analysis

    data = get_fundamental_analysis(ticker)
    if not data:
        return None
    dcf = data.get("dcf") or {}
    fcf_trend_vals = [v for v in (data.get("fcf_trend") or []) if v is not None]
    current_fcf = fcf_trend_vals[-1] if fcf_trend_vals else None
    shares_outstanding = dcf.get("shares_outstanding")
    net_cash = (dcf.get("cash") or 0) - (dcf.get("total_debt") or 0)
    price = data.get("current_price")
    if current_fcf is None or not shares_outstanding or price is None:
        return None
    return {
        "ticker": data.get("ticker") or ticker,
        "company_name": data.get("company_name"),
        "sector": data.get("sector"),
        "exchange": data.get("exchange"),
        "price": price,
        "current_fcf": current_fcf,
        "net_cash": net_cash,
        "shares_outstanding": shares_outstanding,
        "methodology": dcf.get("methodology", "two_stage_fcf"),
    }


def _with_live_valuation(row: dict, inputs: Optional[dict]) -> dict:
    """Merges a saved_valuations row with a live recompute — the shape the
    frontend (profile section + the "Guardar" confirmation) renders."""
    live_price = inputs["price"] if inputs else None
    live_iv = None
    margin_of_safety_pct = None
    if inputs:
        live_iv = compute_iv(
            inputs["current_fcf"] / 1e6, row["growth_pct"], row["discount_rate_pct"], row["terminal_growth_pct"],
            inputs["net_cash"] / 1e6, inputs["shares_outstanding"] / 1e6,
        )
        if live_iv is not None and live_price:
            # Fase 1.5, Incremento 14 (dedup) — was the lone site dividing
            # by price instead of intrinsic value; see numeric_helpers.py::
            # calc_margin_of_safety's docstring for why /intrinsic is the
            # convention everywhere now. This only changes how the SAVED
            # assumptions' resulting cushion is displayed, not compute_iv()
            # itself (the fade formula those assumptions still reproduce is
            # untouched here — that migration is Incremento 16, after the
            # frontend's own fade is fixed).
            margin_of_safety_pct = calc_margin_of_safety(live_iv, live_price)
    return {
        **row,
        "company_name": (inputs or {}).get("company_name") or row.get("company_name"),
        "sector": (inputs or {}).get("sector"),
        "exchange": (inputs or {}).get("exchange"),
        "current_price": live_price,
        "live_intrinsic_value": round(live_iv, 2) if live_iv is not None else None,
        "margin_of_safety_pct": margin_of_safety_pct,
        "stale": inputs is None,
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
    inputs_list = await asyncio.gather(*[asyncio.to_thread(get_live_inputs, t) for t in tickers])
    inputs_map = dict(zip(tickers, inputs_list))

    return [_with_live_valuation(row, inputs_map.get(row["ticker"])) for row in rows]


async def save_valuation(
    user_id: str, ticker: str, growth_pct: float, discount_rate_pct: float, terminal_growth_pct: float,
) -> dict:
    import asyncio
    from app.core.database import get_supabase, run_query

    ticker = ticker.strip().upper()
    inputs = await asyncio.to_thread(get_live_inputs, ticker)
    if not inputs:
        raise ValueError(f"No hay suficientes datos financieros para {ticker} en este momento.")

    iv_at_save = compute_iv(
        inputs["current_fcf"] / 1e6, growth_pct, discount_rate_pct, terminal_growth_pct,
        inputs["net_cash"] / 1e6, inputs["shares_outstanding"] / 1e6,
    )

    db = get_supabase()
    row = {
        "user_id": user_id,
        "ticker": ticker,
        "company_name": inputs.get("company_name"),
        "methodology": inputs.get("methodology", "two_stage_fcf"),
        "growth_pct": growth_pct,
        "discount_rate_pct": discount_rate_pct,
        "terminal_growth_pct": terminal_growth_pct,
        "price_at_save": inputs["price"],
        "intrinsic_value_at_save": round(iv_at_save, 2) if iv_at_save is not None else None,
        "notified_milestones": [],  # re-saving is a new baseline — old crossings no longer apply
    }
    await run_query(
        db.table("saved_valuations").upsert(row, on_conflict="user_id,ticker")
    )
    saved_res = await run_query(
        db.table("saved_valuations").select("*").eq("user_id", user_id).eq("ticker", ticker)
    )
    saved_row = saved_res.data[0] if saved_res.data else row
    return _with_live_valuation(saved_row, inputs)


async def delete_valuation(user_id: str, ticker: str) -> bool:
    from app.core.database import get_supabase, run_query

    db = get_supabase()
    res = await run_query(
        db.table("saved_valuations").delete().eq("user_id", user_id).eq("ticker", ticker.strip().upper())
    )
    return bool(res.data)


def _newly_crossed_milestones(margin_pct: float, already_notified: list) -> list[int]:
    """Every milestone in MILESTONES that `margin_pct` has now reached/passed
    and isn't in `already_notified` yet. -10 fires when margin drops to or
    below it; the rest fire when margin rises to or past them."""
    already = set(already_notified or [])
    crossed = []
    for m in MILESTONES:
        if m in already:
            continue
        if m < 0:
            if margin_pct <= m:
                crossed.append(m)
        else:
            if margin_pct >= m:
                crossed.append(m)
    return crossed


async def run_milestone_check() -> None:
    """Daily job (see worker.py's job_saved_valuation_alerts): recomputes
    every saved valuation's margin of safety against fresh price/
    fundamentals, and pushes ONE notification per user for the single most
    significant newly-crossed milestone — same one-push-per-category-per-day
    discipline the rest of the notification system follows (see
    notification_engine.can_send_push). Any other tickers that also crossed
    a new milestone the same day simply get picked up on a later run —
    nothing is lost, just delayed a day."""
    import asyncio
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push

    db = get_supabase()
    res = await run_query(db.table("saved_valuations").select("*"))
    rows = res.data or []
    if not rows:
        return

    tickers = sorted({r["ticker"] for r in rows})
    inputs_list = await asyncio.gather(*[asyncio.to_thread(get_live_inputs, t) for t in tickers])
    inputs_map = dict(zip(tickers, inputs_list))

    # profile map for language (best-effort, defaults to Spanish)
    lang_res = await run_query(db.table("user_profiles").select("user_id,preferred_language"))
    lang_map = {r["user_id"]: (r.get("preferred_language") or "es") for r in (lang_res.data or [])}

    by_user: dict[str, list[dict]] = {}
    for row in rows:
        by_user.setdefault(row["user_id"], []).append(row)

    for user_id, user_rows in by_user.items():
        candidates = []  # (abs priority, row, crossed_milestone, margin_pct, inputs)
        for row in user_rows:
            inputs = inputs_map.get(row["ticker"])
            if not inputs:
                continue
            iv = compute_iv(
                inputs["current_fcf"] / 1e6, row["growth_pct"], row["discount_rate_pct"], row["terminal_growth_pct"],
                inputs["net_cash"] / 1e6, inputs["shares_outstanding"] / 1e6,
            )
            if iv is None or not inputs["price"]:
                continue
            margin_pct = (iv - inputs["price"]) / inputs["price"] * 100
            crossed = _newly_crossed_milestones(margin_pct, row.get("notified_milestones") or [])
            if not crossed:
                continue
            # Prefer the most extreme milestone reached (best news, or the
            # -10 warning if that's the only one) — most decision-relevant.
            best = max(crossed, key=lambda m: (m if m >= 0 else -100 + m))
            candidates.append((best, row, crossed, round(margin_pct, 1), inputs))

        if not candidates:
            continue

        # Pick the single candidate with the highest-value milestone across all this user's tickers.
        best_milestone, best_row, best_crossed, best_margin, best_inputs = max(candidates, key=lambda c: c[0])
        lang = lang_map.get(user_id, "es")
        title, body = _milestone_copy(best_row["ticker"], best_milestone, best_margin, best_inputs["price"], lang)

        try:
            await send_push(
                user_id, "saved_valuation_milestone", title, body,
                {"screen": "profile", "ticker": best_row["ticker"], "margin_of_safety_pct": best_margin}, db,
            )
        except Exception as exc:
            logger.warning("run_milestone_check: push failed for %s/%s: %s", user_id, best_row["ticker"], exc)

        # Mark ALL crossed milestones for this row as notified (not just the
        # one pushed) — they were all genuinely reached; only the push itself
        # is capped at one per day.
        updated = sorted(set((best_row.get("notified_milestones") or [])) | set(best_crossed))
        try:
            await run_query(
                db.table("saved_valuations").update({"notified_milestones": updated})
                .eq("id", best_row["id"])
            )
        except Exception as exc:
            logger.warning("run_milestone_check: failed to persist notified_milestones for %s: %s", best_row["id"], exc)


def _milestone_copy(ticker: str, milestone: int, margin_pct: float, price: float, lang: str) -> tuple[str, str]:
    if lang == "en":
        if milestone < 0:
            title = f"⚠️ {ticker} is now above your margin of safety"
            body = f"At ${price:.2f}, {ticker} is trading {abs(margin_pct):.1f}% above the intrinsic value you calculated — worth revisiting your thesis."
        else:
            title = f"🎯 {ticker} hit +{milestone}% margin of safety"
            body = f"At ${price:.2f}, {ticker} is now {margin_pct:.1f}% below the intrinsic value you calculated with your own assumptions."
        return title, body
    if milestone < 0:
        title = f"⚠️ {ticker} superó tu margen de seguridad"
        body = f"A ${price:.2f}, {ticker} cotiza un {abs(margin_pct):.1f}% por encima del valor intrínseco que calculaste — vale la pena revisar tu tesis."
    else:
        title = f"🎯 {ticker} alcanzó +{milestone}% de margen de seguridad"
        body = f"A ${price:.2f}, {ticker} está {margin_pct:.1f}% por debajo del valor intrínseco que calculaste con tus propios supuestos."
    return title, body
