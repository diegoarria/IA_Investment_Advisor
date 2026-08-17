"""
Morning Brief — Diego's request (Aug 16): a personalized, Premium-only,
Monday-Friday 9:15am ET pre-market push that opens its own flashcard
(same pattern as the Weekly Rituals cards).

Deliberately 100% deterministic — ZERO Claude calls, by Diego's explicit
request to spend the minimum possible in tokens. Every number is real
math (portfolio snapshots, Finnhub quotes), every news item is a real
Finnhub headline scored by keyword against the exact priority list Diego
gave (earnings > guidance/CEO/M&A > regulación/deuda), and every
calendar event's impact level is the one macro_calendar_service already
computed (`_classify`'s HIGH/MEDIUM/LOW) — nothing here is synthesized
or written by a model.

No new DB table, no persistence at all: since nothing here is AI-written
(unlike Portfolio Review's one saved sentence), the flashcard just
recomputes the same real, free math/Finnhub calls live when opened —
same "cheap to redo, so don't bother persisting it" convention
weekly_rituals_service.get_sunday_prep already uses. This also avoids a
real risk the first draft of this feature had: cramming the full
news/events payload into the push notification's `data` field risks
hitting APNs/FCM/web-push's ~4KB payload limit — the push itself only
ever carries `{"screen": "morning-brief"}`.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)

_TOP_NEWS_LIMIT = 5

# Diego's exact priority list. Order matters — first match wins when a
# headline hits more than one category (e.g. "CEO resigns amid SEC probe"
# scores as ceo_change, the higher-weighted category below).
_NEWS_CATEGORY_RULES: list[tuple[str, int, list[str]]] = [
    ("earnings",     6, ["earnings", "eps", "quarterly revenue", "quarterly results", "beats estimates", "misses estimates"]),
    ("guidance",     5, ["guidance", "outlook", "forecast raised", "forecast cut", "raises forecast", "cuts forecast"]),
    ("ceo_change",   5, ["ceo", "chief executive", "steps down", "resigns", "names new president", "appoints new"]),
    ("m_and_a",      5, ["acquire", "acquisition", "merger", "buyout", "to buy", "deal to acquire"]),
    ("regulation",   4, ["sec probe", "sec investigation", "antitrust", "ftc", "lawsuit", "regulator", "doj"]),
    ("debt_capital", 4, ["credit rating", "downgrades debt", "upgrades debt", "bond offering", "buyback program", "dividend increase", "dividend cut"]),
    ("thesis",       3, ["cuts jobs", "layoffs", "recall", "supply chain", "chip shortage", "data breach"]),
]

_IMPACT_EMOJI = {"VERY_HIGH": "🔴", "HIGH": "🔴", "MEDIUM": "🟡", "LOW": "⚪"}


def _contains_keyword(text: str, keyword: str) -> bool:
    # Word-boundary match, not a naive substring `in` check — real bug
    # caught by this module's own tests: "CEO STEPS DOWN" contains "eps"
    # as a bare substring ("st-EPS-down"), silently misclassifying a CEO
    # change as earnings news. \b keeps short keywords (eps, ceo, ftc,
    # doj) from matching inside unrelated words.
    return re.search(rf"\b{re.escape(keyword)}\b", text) is not None


def _score_news_item(headline: str, summary: str) -> tuple[int, Optional[str]]:
    text = f"{headline} {summary}".lower()
    for category, weight, keywords in _NEWS_CATEGORY_RULES:
        if any(_contains_keyword(text, kw) for kw in keywords):
            return weight, category
    return 0, None


def _agg_positions(rows: list[dict]) -> list[dict]:
    # Same shape as worker.py's _agg_positions, duplicated here rather
    # than imported — worker.py is a standalone script, not a module
    # other services should depend on (see weekly_rituals_service.py's
    # own docstring for the same convention).
    result: list[dict] = []
    for row in rows:
        raw = row.get("positions") or {}
        pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
        result.extend(pos)
    return result


async def _portfolio_day_change(user_id: str) -> Optional[dict]:
    """Latest snapshot vs. the trading day before it — real $ and %
    change, no futures/live-market guessing needed since this runs
    pre-market off yesterday's real close."""
    db = get_supabase()
    res = await run_query(
        db.table("fmg_portfolio_snapshots")
        .select("snapshot_date,total_value")
        .eq("user_id", user_id)
        .order("snapshot_date", desc=True)
        .limit(2)
    )
    rows = res.data or []
    if not rows:
        return None
    latest = rows[0]
    total = latest.get("total_value") or 0
    if total <= 0:
        return None
    change_usd = change_pct = None
    if len(rows) > 1 and rows[1].get("total_value"):
        prev_total = rows[1]["total_value"]
        change_usd = total - prev_total
        change_pct = round(change_usd / prev_total * 100, 2) if prev_total else None
    return {"total_value": total, "change_usd": change_usd, "change_pct": change_pct}


def _sp500_day_change() -> Optional[float]:
    from app.core.finnhub import fh_quote
    q = fh_quote("SPY")  # SPY, not ^GSPC — same Railway-IP-block workaround worker.py uses
    if not q or not q.get("change_pct"):
        return None
    return round(q["change_pct"], 2)


def _top_mover(positions: list[dict]) -> Optional[dict]:
    from app.core.finnhub import fh_quote
    best = None
    for p in positions:
        ticker = p.get("ticker")
        shares = float(p.get("shares", 0) or 0)
        if not ticker or not shares:
            continue
        q = fh_quote(ticker)
        if not q or not q.get("prev_close"):
            continue
        pct = (q["price"] - q["prev_close"]) / q["prev_close"] * 100
        dollar_impact = abs(pct / 100 * q["price"] * shares)
        if best is None or dollar_impact > best["impact_usd"]:
            best = {"ticker": ticker, "change_pct": round(pct, 2), "impact_usd": round(dollar_impact, 2)}
    return best


def _top_news_for_positions(tickers: list[str]) -> list[dict]:
    from app.services.price_alert_service import fetch_ticker_news
    scored: list[dict] = []
    for ticker in tickers:
        try:
            items = fetch_ticker_news(ticker)
        except Exception as exc:
            logger.warning("morning_brief: fetch_ticker_news failed for %s: %s", ticker, exc)
            continue
        for item in items:
            headline = item.get("headline") or ""
            summary = item.get("summary") or ""
            score, category = _score_news_item(headline, summary)
            if score > 0:
                scored.append({"ticker": ticker, "headline": headline, "category": category, "_score": score})
    scored.sort(key=lambda x: x["_score"], reverse=True)
    top = scored[:_TOP_NEWS_LIMIT]
    for item in top:
        item.pop("_score", None)
    return top


def _todays_earnings_hours() -> dict[str, str]:
    """Real Finnhub earnings calendar for today — {ticker: "BMO"|"AMC"|"DMT"}.
    Same endpoint/shape as worker.py's _finnhub_earnings_today, duplicated
    here (not imported — worker.py is a standalone script) since this
    only needs the hour, not the full EPS/revenue beat-analysis shape."""
    import os
    import requests as req_lib

    fh_key = os.getenv("FINNHUB_API_KEY", "")
    if not fh_key:
        return {}
    today_str = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d")
    try:
        resp = req_lib.get(
            "https://finnhub.io/api/v1/calendar/earnings",
            params={"from": today_str, "to": today_str, "token": fh_key},
            timeout=10,
        )
        resp.raise_for_status()
        events = resp.json().get("earningsCalendar") or []
    except Exception as exc:
        logger.warning("morning_brief: earnings calendar fetch failed: %s", exc)
        return {}
    return {ev["symbol"]: (ev.get("hour") or "").upper() for ev in events if ev.get("symbol")}


async def _today_events_for_user(tickers: list[str], lang: str) -> list[dict]:
    """Macro events (real impact_level already classified by
    macro_calendar_service) + today's earnings for held positions (HIGH,
    same as a real macro print — it's the user's own money reporting)."""
    from app.services.macro_calendar_service import get_macro_events

    events: list[dict] = []
    try:
        macro = await get_macro_events(days_ahead=0, lang=lang)
        for e in macro:
            if e.get("status") != "today":
                continue
            events.append({
                "time_et": e.get("time_et"),
                "label": e.get("event_name") or e.get("event_type"),
                "impact": (e.get("impact_level") or "LOW").upper(),
                "type": "macro",
            })
    except Exception as exc:
        logger.warning("morning_brief: get_macro_events failed: %s", exc)

    try:
        held = set(tickers)
        if held:
            for symbol, hour in _todays_earnings_hours().items():
                if symbol in held:
                    events.append({
                        "time_et": {"BMO": "09:00", "AMC": "16:30"}.get(hour, None),
                        "label": f"Earnings de {symbol}" if lang != "en" else f"{symbol} earnings",
                        "impact": "HIGH",
                        "type": "earnings",
                    })
    except Exception as exc:
        logger.warning("morning_brief: earnings calendar fetch failed: %s", exc)

    events.sort(key=lambda e: (e.get("time_et") is None, e.get("time_et") or ""))
    return events


async def build_morning_brief(user_id: str, lang: str = "es") -> Optional[dict]:
    """Returns None when this user has no real portfolio yet (never a
    fabricated brief)."""
    db = get_supabase()
    port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", user_id))
    positions = _agg_positions(port_res.data or [])
    if not positions:
        return None

    portfolio = await _portfolio_day_change(user_id)
    if portfolio is None:
        return None

    tickers = sorted({p["ticker"] for p in positions if p.get("ticker")})
    sp500_change_pct = _sp500_day_change()
    top_mover = _top_mover(positions)
    news = _top_news_for_positions(tickers)
    events = await _today_events_for_user(tickers, lang)

    return {
        "portfolio_value": portfolio["total_value"],
        "change_usd": portfolio["change_usd"],
        "change_pct": portfolio["change_pct"],
        "sp500_change_pct": sp500_change_pct,
        "top_mover": top_mover,
        "news": news,
        "events": events,
    }


async def get_morning_brief(user_id: str, lang: str = "es") -> Optional[dict]:
    """Content for the flashcard the push deep-links to — recomputed
    live (real, free math + Finnhub calls, no AI), same convention as
    get_sunday_prep. Returns None if this user has no real portfolio yet."""
    return await build_morning_brief(user_id, lang=lang)
