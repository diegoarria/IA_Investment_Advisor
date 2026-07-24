"""
Investment Graph — the append-only event log behind "Tu Bitácora" (Mi Perfil)
and "Tu historia con esta empresa" (stock detail). Every question asked about
a ticker, every valuation thesis viewed, every watchlist change, and every
market event that intersects a user's holdings/watchlist gets logged here,
tagged by ticker and time — so a user can come back in ten years and see
exactly how their thinking about a company evolved.

investment_decisions (migration 007, the decision diary powering Personal
Investment Memory) stays a separate table — get_company_timeline() and
get_global_timeline() merge both at read time instead of duplicating rows.

Logging is always best-effort: a failure here must never break the chat
response, the valuation screen, or a watchlist edit it's attached to.
"""
import logging
from datetime import datetime, timezone

from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)

EVENT_TYPES = ("question", "thesis", "watchlist_add", "watchlist_remove", "market_event")


async def log_event(
    user_id: str,
    ticker: str,
    event_type: str,
    payload: dict | None = None,
    parent_event_id: str | None = None,
) -> None:
    """Fire-and-forget — every call site wraps this in asyncio.create_task
    (or an equivalent best-effort pattern) so a logging failure can never
    surface to the user."""
    if not ticker or event_type not in EVENT_TYPES:
        return
    try:
        db = get_supabase()
        await run_query(
            db.table("investment_graph_events").insert({
                "user_id": user_id,
                "ticker": ticker.upper(),
                "event_type": event_type,
                "payload": payload or {},
                "parent_event_id": parent_event_id,
                "occurred_at": datetime.now(timezone.utc).isoformat(),
            })
        )
    except Exception as e:
        logger.warning("investment_graph_service.log_event failed (%s/%s): %s", user_id, ticker, e)


async def find_latest_thesis_event_id(user_id: str, ticker: str) -> str | None:
    """Used to chain a new thesis to the previous one for the same ticker
    (parent_event_id), so opinion-reversal detection has a real edge to
    walk instead of just a flat list sorted by time."""
    try:
        db = get_supabase()
        res = await run_query(
            db.table("investment_graph_events")
            .select("id")
            .eq("user_id", user_id).eq("ticker", ticker.upper()).eq("event_type", "thesis")
            .order("occurred_at", desc=True)
            .limit(1)
        )
        return res.data[0]["id"] if res.data else None
    except Exception:
        return None


def _decision_to_event(d: dict) -> dict:
    """Normalizes an investment_decisions row into the same shape as a graph
    event, so the two sources can be merged and sorted together."""
    return {
        "id": d.get("id"),
        "ticker": d.get("ticker"),
        "event_type": "decision",
        "payload": {
            "action": d.get("action"),
            "trigger": d.get("trigger"),
            "notes": d.get("notes"),
            "price_at_action": d.get("price_at_action"),
            "portfolio_value_at_action": d.get("portfolio_value_at_action"),
        },
        "occurred_at": d.get("created_at"),
    }


async def _fetch_decisions(user_id: str, ticker: str | None, limit: int) -> list[dict]:
    db = get_supabase()
    q = db.table("investment_decisions").select("*").eq("user_id", user_id)
    if ticker:
        q = q.eq("ticker", ticker.upper())
    res = await run_query(q.order("created_at", desc=True).limit(limit))
    return [_decision_to_event(d) for d in (res.data or [])]


async def _fetch_graph_events(user_id: str, ticker: str | None, limit: int) -> list[dict]:
    db = get_supabase()
    q = db.table("investment_graph_events").select("*").eq("user_id", user_id)
    if ticker:
        q = q.eq("ticker", ticker.upper())
    res = await run_query(q.order("occurred_at", desc=True).limit(limit))
    return res.data or []


async def get_company_timeline(user_id: str, ticker: str, limit: int = 100) -> list[dict]:
    """Merged, time-sorted feed for a single ticker — this is what powers
    the 'Tu historia con esta empresa' tab on the stock detail page."""
    events, decisions = await _fetch_graph_events(user_id, ticker, limit), await _fetch_decisions(user_id, ticker, limit)
    combined = events + decisions
    combined.sort(key=lambda e: e.get("occurred_at") or "", reverse=True)
    return combined[:limit]


async def get_global_timeline(user_id: str, limit: int = 100) -> list[dict]:
    """Cross-company feed — the same data with no ticker filter, this is
    what powers 'Tu Bitácora' in Mi Perfil."""
    events, decisions = await _fetch_graph_events(user_id, None, limit), await _fetch_decisions(user_id, None, limit)
    combined = events + decisions
    combined.sort(key=lambda e: e.get("occurred_at") or "", reverse=True)
    return combined[:limit]


async def compute_metrics(user_id: str, price_lookup: dict[str, float] | None = None) -> dict:
    """The 6 metrics from the design doc. Deliberately simple, honest
    heuristics for v1 — not a full backtesting engine. Every number here is
    derived directly from real logged events, never estimated or guessed.

    `price_lookup` (ticker -> current price) is optional and only affects
    thesis_accuracy_pct — the route layer fetches live quotes for tickers
    with theses old enough to evaluate (>=30 days) and passes them in here,
    since this service function has no business making network calls
    itself. Without it, thesis_accuracy_pct is simply null (never guessed)."""
    price_lookup = price_lookup or {}
    events = await _fetch_graph_events(user_id, None, limit=1000)
    decisions = await _fetch_decisions(user_id, None, limit=1000)

    theses = [e for e in events if e["event_type"] == "thesis"]
    watchlist_adds = [e for e in events if e["event_type"] == "watchlist_add"]

    total_theses = len(theses)

    # Opinion reversals: two thesis events on the same ticker where the
    # margin-of-safety sign flipped (bullish -> bearish or vice versa).
    by_ticker: dict[str, list[dict]] = {}
    for t in theses:
        by_ticker.setdefault(t["ticker"], []).append(t)
    reversals = 0
    for ticker_theses in by_ticker.values():
        ticker_theses.sort(key=lambda e: e.get("occurred_at") or "")
        for prev, curr in zip(ticker_theses, ticker_theses[1:]):
            prev_mos = (prev.get("payload") or {}).get("margin_of_safety_pct")
            curr_mos = (curr.get("payload") or {}).get("margin_of_safety_pct")
            if prev_mos is not None and curr_mos is not None and (prev_mos > 0) != (curr_mos > 0):
                reversals += 1

    # Analyzed but never bought: tickers with a thesis but no buy decision ever.
    bought_tickers = {d["ticker"] for d in decisions if (d.get("payload") or {}).get("action") == "buy"}
    analyzed_never_bought = len({t for t in by_ticker if t not in bought_tickers})

    # Deliberation speed: avg days between a ticker's first thesis and its
    # first buy decision, for tickers where both exist.
    deliberation_days: list[float] = []
    for ticker, ticker_theses in by_ticker.items():
        first_thesis_at = min(t["occurred_at"] for t in ticker_theses if t.get("occurred_at"))
        buys = sorted(
            (d["occurred_at"] for d in decisions if d["ticker"] == ticker and (d.get("payload") or {}).get("action") == "buy" and d.get("occurred_at")),
        )
        if buys and first_thesis_at and buys[0] > first_thesis_at:
            try:
                delta = datetime.fromisoformat(buys[0].replace("Z", "+00:00")) - datetime.fromisoformat(first_thesis_at.replace("Z", "+00:00"))
                deliberation_days.append(delta.total_seconds() / 86400)
            except Exception:
                pass
    avg_deliberation_days = round(sum(deliberation_days) / len(deliberation_days), 1) if deliberation_days else None

    # Longest conviction: ticker with the longest span between its first and
    # last thesis without a reversal in between.
    longest_conviction_ticker = None
    longest_conviction_days = 0.0
    for ticker, ticker_theses in by_ticker.items():
        if len(ticker_theses) < 2:
            continue
        has_reversal = False
        for prev, curr in zip(ticker_theses, ticker_theses[1:]):
            prev_mos = (prev.get("payload") or {}).get("margin_of_safety_pct")
            curr_mos = (curr.get("payload") or {}).get("margin_of_safety_pct")
            if prev_mos is not None and curr_mos is not None and (prev_mos > 0) != (curr_mos > 0):
                has_reversal = True
        if has_reversal:
            continue
        try:
            start = datetime.fromisoformat(ticker_theses[0]["occurred_at"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(ticker_theses[-1]["occurred_at"].replace("Z", "+00:00"))
            span_days = (end - start).total_seconds() / 86400
            if span_days > longest_conviction_days:
                longest_conviction_days = span_days
                longest_conviction_ticker = ticker
        except Exception:
            pass

    # Thesis accuracy: for theses older than 30 days claiming a positive
    # margin of safety (bullish), compare the price recorded at thesis time
    # vs the current price — did it actually go up? Deliberately excludes
    # anything younger than 30 days (not enough time to mean anything) and
    # never fabricates a result when price data is missing.
    accurate = evaluable = 0
    now = datetime.now(timezone.utc)
    for t in theses:
        payload = t.get("payload") or {}
        price_then = payload.get("price")
        mos = payload.get("margin_of_safety_pct")
        occurred_at = t.get("occurred_at")
        if price_then is None or mos is None or not occurred_at:
            continue
        try:
            thesis_dt = datetime.fromisoformat(occurred_at.replace("Z", "+00:00"))
        except Exception:
            continue
        if (now - thesis_dt).days < 30:
            continue
        current_price = price_lookup.get(t["ticker"])
        if current_price is None:
            continue
        evaluable += 1
        went_up = current_price > price_then
        if (mos > 0) == went_up:
            accurate += 1
    thesis_accuracy_pct = round(accurate / evaluable * 100, 1) if evaluable else None

    return {
        "total_theses": total_theses,
        "opinion_reversals": reversals,
        "analyzed_never_bought": analyzed_never_bought,
        "avg_deliberation_days": avg_deliberation_days,
        "longest_conviction_ticker": longest_conviction_ticker,
        "longest_conviction_days": round(longest_conviction_days) if longest_conviction_ticker else None,
        "thesis_accuracy_pct": thesis_accuracy_pct,
        "thesis_accuracy_sample_size": evaluable,
        "watchlist_adds": len(watchlist_adds),
    }
