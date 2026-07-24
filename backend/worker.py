"""
Background worker — runs scheduled jobs in a SEPARATE process from the web server.

Why separate:
- If the web process scales to N instances, each would run the jobs N times.
- This process is always a single instance, so jobs run exactly once.

Railway setup:
  Add a second service pointing to the same repo with start command:
    python worker.py
"""

import asyncio
import logging
import os
import random
import concurrent.futures
from datetime import datetime, timezone, timedelta, date
from apscheduler.schedulers.asyncio import AsyncIOScheduler

# ── NYSE holiday calendar (observed dates) ────────────────────────────────────
_NYSE_HOLIDAYS: set[date] = {
    # 2025
    date(2025, 1, 1), date(2025, 1, 20), date(2025, 2, 17), date(2025, 4, 18),
    date(2025, 5, 26), date(2025, 6, 19), date(2025, 7, 4), date(2025, 9, 1),
    date(2025, 11, 27), date(2025, 12, 25),
    # 2026
    date(2026, 1, 1), date(2026, 1, 19), date(2026, 2, 16), date(2026, 4, 3),
    date(2026, 5, 25), date(2026, 6, 19), date(2026, 7, 3), date(2026, 9, 7),
    date(2026, 11, 26), date(2026, 12, 25),
    # 2027
    date(2027, 1, 1), date(2027, 1, 18), date(2027, 2, 15), date(2027, 3, 26),
    date(2027, 5, 31), date(2027, 6, 18), date(2027, 7, 5), date(2027, 9, 6),
    date(2027, 11, 25), date(2027, 12, 24),
}


def _agg_positions(rows: list[dict]) -> list:
    """Aggregate positions from multiple portfolio rows (multi-broker support)."""
    result = []
    for row in rows:
        raw = row.get("positions") or {}
        pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
        result.extend(pos)
    return result


def _build_portfolio_map(rows: list[dict]) -> dict:
    """Build {user_id: [positions]} from multi-portfolio rows, aggregating per user."""
    mapping: dict[str, list] = {}
    for row in rows:
        uid = row.get("user_id")
        if not uid:
            continue
        raw = row.get("positions") or {}
        pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
        if pos:
            mapping.setdefault(uid, []).extend(pos)
    return mapping


def _is_market_open_today() -> bool:
    """True if NYSE is open right now (ET). Excludes weekends and observed holidays."""
    import pytz
    today = datetime.now(pytz.timezone("America/New_York")).date()
    if today.weekday() >= 5:          # Saturday=5, Sunday=6
        return False
    return today not in _NYSE_HOLIDAYS


def _is_market_holiday_today() -> bool:
    """True if today is a weekday NYSE holiday (closed due to holiday, not weekend)."""
    import pytz
    today = datetime.now(pytz.timezone("America/New_York")).date()
    if today.weekday() >= 5:
        return False
    return today in _NYSE_HOLIDAYS
from app.core.config import settings
from app.services.notification_service import scan_and_notify_all_users
from app.services.email_service import (
    generate_and_send_weekly_summary,
    build_enhanced_weekly_html, build_earnings_results_html,
    build_birthday_html, build_reengagement_html, send_email,
)
from app.services.paper_service import notify_rank_changes

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


# ── Shared price cache (populated once per job run, reused per-user) ──────────
_price_cache: dict = {}
_price_cache_ts: datetime | None = None
_PRICE_CACHE_TTL = 300  # seconds


async def _batch_fetch_prices(tickers: list[str]) -> dict:
    """Fetch current price + prev_close for a list of tickers via Finnhub."""
    if not tickers:
        return {}

    def _fetch():
        from app.core.finnhub import fh_quote
        result = {}
        for t in set(tickers):
            try:
                q = fh_quote(t)
                if q and q.get("price") and q.get("prev_close"):
                    result[t] = {"prev": q["prev_close"], "curr": q["price"]}
            except Exception:
                pass
        return result

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
        return await asyncio.get_event_loop().run_in_executor(ex, _fetch)


def _calc_portfolio_pct(positions: list, prices: dict) -> float | None:
    """Compute portfolio day-change % given positions and prices dict."""
    total_val = 0.0
    total_prev = 0.0
    for p in positions:
        ticker = p.get("ticker")
        shares = float(p.get("shares", 0))
        if not ticker or not shares or ticker not in prices:
            continue
        px = prices[ticker]
        total_val  += px["curr"] * shares
        total_prev += px["prev"] * shares
    if total_prev > 0:
        return ((total_val - total_prev) / total_prev) * 100
    return None


def _calc_portfolio_close_data(
    positions: list, prices: dict
) -> tuple[float | None, float | None, list, list]:
    """Return (pct, total_curr, top_gainers, top_losers) for email building."""
    total_curr = total_prev = 0.0
    movers = []
    for p in positions:
        ticker = p.get("ticker")
        shares = float(p.get("shares") or 0)
        if not ticker or not shares or ticker not in prices:
            continue
        px  = prices[ticker]
        val = px["curr"] * shares
        prv = px["prev"] * shares
        total_curr += val
        total_prev += prv
        if px["prev"] > 0:
            pct = round((px["curr"] - px["prev"]) / px["prev"] * 100, 2)
            movers.append({
                "ticker": ticker,
                "pct": pct,
                "price": px["curr"],
                "dollar_change": round(val - prv, 2),
            })
    if total_prev <= 0:
        return None, None, [], []
    port_pct    = round((total_curr - total_prev) / total_prev * 100, 2)
    gainers     = sorted([m for m in movers if m["pct"] >= 0], key=lambda x: x["pct"], reverse=True)
    losers      = sorted([m for m in movers if m["pct"] < 0],  key=lambda x: x["pct"])
    return port_pct, round(total_curr, 2), gainers, losers


def _is_premium_user(tier: str, trial_started: str | None) -> bool:
    """Consistent premium check used by all notification jobs. Delegates to
    app.core.subscription.is_premium_active — the single canonical
    trial-window check shared across the whole app."""
    from app.core.subscription import is_premium_active
    return is_premium_active(tier, trial_started)


def _top_performer(positions: list, prices: dict) -> tuple[str | None, float | None]:
    """Return (ticker, pct) for best-performing position today (by %)."""
    best_ticker, best_pct = None, None
    for p in positions:
        ticker = p.get("ticker")
        shares = float(p.get("shares", 0))
        if not ticker or not shares or ticker not in prices:
            continue
        px = prices[ticker]
        pct = (px["curr"] - px["prev"]) / px["prev"] * 100 if px["prev"] else None
        if pct is not None and (best_pct is None or pct > best_pct):
            best_ticker, best_pct = ticker, pct
    return best_ticker, best_pct


def _top_performer_by_impact(positions: list, prices: dict) -> tuple[str | None, float | None]:
    """Return (ticker, pct) for position with highest absolute dollar P&L today.
    This is the 'hecho clave' — the move that actually moved the needle most."""
    best_ticker, best_pct, best_impact = None, None, 0.0
    for p in positions:
        ticker = p.get("ticker")
        shares = float(p.get("shares", 0))
        if not ticker or not shares or ticker not in prices:
            continue
        px = prices[ticker]
        if not px.get("prev"):
            continue
        pct = (px["curr"] - px["prev"]) / px["prev"] * 100
        dollar_impact = abs(pct / 100 * px["curr"] * shares)
        if dollar_impact > best_impact:
            best_ticker, best_pct, best_impact = ticker, pct, dollar_impact
    return best_ticker, best_pct


def _pct_emoji(pct: float | None) -> str:
    if pct is None:
        return "—"
    if pct >= 2.0:
        return "🚀"
    if pct >= 0.0:
        return "🟢"
    if pct >= -2.0:
        return "🔴"
    return "📉"


def _market_comparison_push(
    sp500_pct: float | None,
    nasdaq_pct: float | None,
    user_pct: float | None = None,
) -> str:
    """Compact Market Wrap line for push body:
    'S&P +1.8% 🟢 | NQ +2.8% 🟢 | Tú +3.5% 🚀'"""
    sp = f"S&P {sp500_pct:+.1f}% {_pct_emoji(sp500_pct)}" if sp500_pct is not None else "S&P —"
    nq = f"NQ {nasdaq_pct:+.1f}% {_pct_emoji(nasdaq_pct)}" if nasdaq_pct is not None else "NQ —"
    if user_pct is not None:
        tu_emoji = "🚀" if user_pct > (sp500_pct or 0) else "📊"
        return f"{sp} | {nq} | Tú {user_pct:+.1f}% {tu_emoji}"
    return f"{sp} | {nq}"


# ── Company name map (ticker → short display name) ────────────────────────────
# Fallback: if ticker not here, use the ticker symbol itself.

_COMPANY_NAMES: dict[str, str] = {
    "AAPL": "Apple",           "MSFT": "Microsoft",     "GOOGL": "Alphabet",
    "GOOG": "Alphabet",        "AMZN": "Amazon",         "META": "Meta",
    "TSLA": "Tesla",           "NVDA": "NVIDIA",         "AMD": "AMD",
    "INTC": "Intel",           "ORCL": "Oracle",         "CRM": "Salesforce",
    "ADBE": "Adobe",           "NFLX": "Netflix",        "DIS": "Disney",
    "SBUX": "Starbucks",       "V": "Visa",              "MA": "Mastercard",
    "JPM": "JPMorgan",         "BAC": "Bank of America", "GS": "Goldman Sachs",
    "MS": "Morgan Stanley",    "WFC": "Wells Fargo",     "C": "Citigroup",
    "JNJ": "Johnson & Johnson","PFE": "Pfizer",          "ABBV": "AbbVie",
    "UNH": "UnitedHealth",     "MRK": "Merck",           "AMGN": "Amgen",
    "XOM": "ExxonMobil",       "CVX": "Chevron",         "COP": "ConocoPhillips",
    "KO": "Coca-Cola",         "PEP": "PepsiCo",         "WMT": "Walmart",
    "COST": "Costco",          "HD": "Home Depot",       "MCD": "McDonald's",
    "AMGN": "Amgen",           "BA": "Boeing",           "CAT": "Caterpillar",
    "GE": "GE",                "MMM": "3M",              "NKE": "Nike",
    "PG": "Procter & Gamble",  "VZ": "Verizon",          "T": "AT&T",
    "NEE": "NextEra Energy",   "SO": "Southern Company", "O": "Realty Income",
    "SPY": "S&P 500 ETF",      "QQQ": "NASDAQ ETF",      "IWM": "Russell 2000 ETF",
    "VOO": "Vanguard S&P 500", "VTI": "Vanguard Total Market",
    "PLTR": "Palantir",        "COIN": "Coinbase",       "SOFI": "SoFi",
    "RKLB": "Rocket Lab",      "MSTR": "MicroStrategy",  "SMCI": "Super Micro",
    "BE": "Bloom Energy",      "BRK-B": "Berkshire",     "BRK.B": "Berkshire",
    "SHOP": "Shopify",         "SQ": "Block",            "PYPL": "PayPal",
    "UBER": "Uber",            "ABNB": "Airbnb",         "HOOD": "Robinhood",
    "RIVN": "Rivian",          "LCID": "Lucid",          "NIO": "NIO",
    "BABA": "Alibaba",         "TSM": "TSMC",            "ASML": "ASML",
    "SNOW": "Snowflake",       "DDOG": "Datadog",        "ZM": "Zoom",
    "CRWD": "CrowdStrike",     "PANW": "Palo Alto",      "OKTA": "Okta",
    "ARM": "Arm Holdings",     "AVGO": "Broadcom",       "QCOM": "Qualcomm",
    "TXN": "Texas Instruments","MU": "Micron Technology","AMAT": "Applied Materials",
    "GEV": "GE Vernova",       "MELI": "Mercado Libre",
}


def _company_name(ticker: str) -> str:
    """Real company name for a ticker — never just falls back to the bare
    ticker symbol silently. Checks the hand-curated short-name map first
    (fastest, no I/O, and gives nicer short names like "Amazon" instead of
    "Amazon.com, Inc." for the ~90 most common tickers), then the curated
    screener UNIVERSE (also no I/O), then a real Finnhub company-profile
    lookup (cached 24h) for any other real ticker — e.g. "GE Vernova" or
    "MercadoLibre" previously showed up as the bare ticker in push
    notifications simply because they weren't in the hardcoded map. Only
    returns the bare ticker if Finnhub itself has no profile for it."""
    if ticker in _COMPANY_NAMES:
        return _COMPANY_NAMES[ticker]
    try:
        from app.api.routes.screener import UNIVERSE
        universe_match = next((u["name"] for u in UNIVERSE if u["ticker"] == ticker), None)
        if universe_match:
            return universe_match
    except Exception:
        pass
    try:
        from app.core.finnhub import fh_profile
        profile = fh_profile(ticker)
        if profile and profile.get("name"):
            return profile["name"]
    except Exception as e:
        logger.warning("_company_name(%s): Finnhub profile fallback failed: %s", ticker, e)
    return ticker


# strftime's %B depends on the server's locale, which isn't guaranteed to be
# Spanish (or English) on Railway — that's what produced "10 de July" instead
# of "10 de julio". Spelled out explicitly instead, shared across every job
# that needs a localized month name.
_SPANISH_MONTHS = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]
_ENGLISH_MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


# A few recognizable brand emojis for the compact price-mover push (matches
# the requested "🍎 Apple", "📦 Amazon" style) — everything else falls back to
# a plain up/down chart emoji rather than guessing a brand icon that isn't
# actually associated with the company.
_TICKER_EMOJIS: dict[str, str] = {
    "AAPL": "🍎", "AMZN": "📦", "NFLX": "🎬", "MCD": "🍔", "SBUX": "☕",
    "DIS": "🏰", "KO": "🥤", "NKE": "👟",
}


def _move_emoji(ticker: str, pct: float) -> str:
    if ticker in _TICKER_EMOJIS:
        return _TICKER_EMOJIS[ticker]
    return "📈" if pct >= 0 else "📉"


# ── Risk-tiered ticker universes ───────────────────────────────────────────────

_RISK_SUGGESTIONS: dict[str, list[str]] = {
    "aggressive":   ["NVDA", "TSLA", "META", "AMD", "PLTR", "COIN", "SOFI", "BE", "RKLB", "SMCI", "MSTR"],
    "moderate":     ["AAPL", "MSFT", "JPM", "V",    "AMZN", "GOOGL", "HD",  "UNH", "CRM", "ADBE"],
    "conservative": ["KO",   "JNJ",  "PEP", "WMT",  "PG",   "VZ",   "MCD", "NEE", "O",   "BRK-B", "DVY"],
}


def get_risk_filtered_suggestions(risk_tolerance: str) -> list[str]:
    """Return curated ticker list that matches user's risk profile.
    Aggressive → high-beta/growth only. Conservative → dividend/value only."""
    r = (risk_tolerance or "").lower()
    if "conserv" in r:
        return _RISK_SUGGESTIONS["conservative"]
    if "agres" in r or "aggres" in r:
        return _RISK_SUGGESTIONS["aggressive"]
    return _RISK_SUGGESTIONS["moderate"]


async def _batch_fetch_weekly_prices(tickers: list[str]) -> dict:
    """Fetch Mon→Fri performance for weekly % comparison via Finnhub candles."""
    if not tickers:
        return {}

    def _fetch():
        import time as _time
        from app.core.finnhub import fh_candles
        result = {}
        now_ts  = int(_time.time())
        from_ts = now_ts - 7 * 86400  # 7 days back to cover a full trading week
        for t in set(tickers):
            try:
                candles = fh_candles(t, "D", from_ts, now_ts)
                if candles and len(candles) >= 2:
                    result[t] = {
                        "prev": float(candles[0]["c"]),
                        "curr": float(candles[-1]["c"]),
                    }
            except Exception:
                pass
        return result

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
        return await asyncio.get_event_loop().run_in_executor(ex, _fetch)


async def send_weekly_emails():
    """Personalized weekly summary — every Friday after market close."""
    if not settings.resend_api_key:
        logger.info("RESEND_API_KEY not set — skipping weekly emails")
        return
    from app.core.database import get_supabase, run_query
    db = get_supabase()
    try:
        users_res = await run_query(
            db.table("user_profiles").select("user_id,name,risk_tolerance,subscription_tier")
        )
        users = users_res.data
        auth_users = {u.id: u.email for u in await asyncio.to_thread(lambda: db.auth.admin.list_users())}

        # Fetch all portfolios at once (multiple rows per user for multi-broker)
        port_res = await run_query(db.table("user_portfolio").select("user_id,positions"))
        portfolio_map: dict[str, list] = _build_portfolio_map(port_res.data or [])

        # Collect all tickers across all portfolios + market indices
        all_tickers = list({p["ticker"] for positions in portfolio_map.values() for p in positions if p.get("ticker")})
        all_tickers += ["SPY", "QQQ"]
        weekly_prices = await _batch_fetch_weekly_prices(all_tickers)

        sp500_pct  = None
        nasdaq_pct = None
        if "SPY" in weekly_prices:
            px = weekly_prices["SPY"]
            sp500_pct = (px["curr"] - px["prev"]) / px["prev"] * 100 if px["prev"] else None
        if "QQQ" in weekly_prices:
            px = weekly_prices["QQQ"]
            nasdaq_pct = (px["curr"] - px["prev"]) / px["prev"] * 100 if px["prev"] else None

        sent = 0
        for u in users:
            email = auth_users.get(u["user_id"])
            if not email:
                continue
            is_premium = u.get("subscription_tier") == "premium"
            snippets = []
            if is_premium:
                chats_res = await run_query(
                    db.table("chat_history")
                    .select("content")
                    .eq("user_id", u["user_id"])
                    .eq("role", "user")
                    .order("created_at", desc=True)
                    .limit(10)
                )
                snippets = [c["content"][:150] for c in (chats_res.data or [])]

            # Build per-user portfolio_data
            portfolio_data = None
            positions = portfolio_map.get(u["user_id"], [])
            if positions:
                enriched = []
                total_val   = 0.0
                total_prev  = 0.0
                best_ticker, best_pct = None, None
                for p in positions:
                    ticker = p.get("ticker")
                    shares = float(p.get("shares") or 0)
                    if not ticker or not shares or ticker not in weekly_prices:
                        continue
                    px       = weekly_prices[ticker]
                    curr_val = px["curr"] * shares
                    prev_val = px["prev"] * shares
                    w_pct    = (px["curr"] - px["prev"]) / px["prev"] * 100 if px["prev"] else 0.0
                    w_usd    = curr_val - prev_val
                    total_val  += curr_val
                    total_prev += prev_val
                    enriched.append({
                        "ticker":       ticker,
                        "shares":       shares,
                        "curr_price":   px["curr"],
                        "week_pct":     round(w_pct, 2),
                        "week_dollars": round(w_usd, 2),
                        "total_value":  round(curr_val, 2),
                    })
                    if best_pct is None or w_pct > best_pct:
                        best_ticker, best_pct = ticker, w_pct
                if enriched and total_prev > 0:
                    week_pct = (total_val - total_prev) / total_prev * 100
                    enriched.sort(key=lambda x: x["week_pct"], reverse=True)
                    portfolio_data = {
                        "positions":    enriched,
                        "total_value":  round(total_val, 2),
                        "week_dollars": round(total_val - total_prev, 2),
                        "week_pct":     round(week_pct, 2),
                        "top_ticker":   best_ticker,
                        "top_pct":      round(best_pct, 2) if best_pct is not None else None,
                        "sp500_pct":    sp500_pct,
                        "nasdaq_pct":   nasdaq_pct,
                    }

            ok = await generate_and_send_weekly_summary(
                user_id=u["user_id"],
                email=email,
                name=u["name"].split()[0],
                risk=u["risk_tolerance"],
                chat_snippets=snippets,
                portfolio_data=portfolio_data,
            )
            if ok:
                sent += 1
            else:
                logger.error("Weekly email failed for %s (%s)", email, u["user_id"])
        logger.info("Weekly emails sent: %d / %d users", sent, len(users))
    except Exception as e:
        logger.error("Weekly email job failed: %s", e)


async def run_notifications():
    """Scan for significant market moves and push notifications — 9am & 4pm ET."""
    try:
        await scan_and_notify_all_users()
        logger.info("Notification scan completed")
    except Exception as e:
        logger.error("Notification scan failed: %s", e)



async def run_league_notifications():
    """Compare league rankings and notify users who lost positions — every 2h."""
    try:
        await notify_rank_changes()
    except Exception as e:
        logger.error("League notification job failed: %s", e)


# ── Notification engine jobs ──────────────────────────────────────────────────

def _fetch_realtime_pct(symbols: list[str]) -> dict[str, float | None]:
    """Get real-time % change vs previous close via Finnhub.
    Works at any time of day including market open."""
    from app.core.finnhub import fh_quote
    result: dict[str, float | None] = {}
    for sym in symbols:
        try:
            q = fh_quote(sym)
            if q and q.get("price") and q.get("prev_close"):
                result[sym] = q["change_pct"]
            else:
                result[sym] = None
        except Exception:
            result[sym] = None
    return result


def _finnhub_quote(symbol: str) -> dict | None:
    """Fetch real-time quote from Finnhub. Returns {curr, prev, pct} or None.
    Works on Railway (no IP block). Supports indices like ^VIX.
    At market open, Finnhub may return c=0 before the first tick — falls back to o (open price)."""
    import requests as _req
    key = os.getenv("FINNHUB_API_KEY", "")
    if not key:
        logger.warning("_finnhub_quote(%s): FINNHUB_API_KEY not set", symbol)
        return None
    try:
        r = _req.get(
            "https://finnhub.io/api/v1/quote",
            params={"symbol": symbol, "token": key},
            timeout=8,
        )
        d = r.json()
        # c = current price, o = open price (fallback at market open when c=0)
        curr = float(d.get("c") or 0) or float(d.get("o") or 0)
        prev = float(d.get("pc") or 0)
        if curr > 0 and prev > 0:
            return {"curr": curr, "prev": prev,
                    "pct": round((curr - prev) / prev * 100, 2)}
        logger.warning("_finnhub_quote(%s): no usable price in response: %s", symbol, d)
    except Exception as e:
        logger.warning("_finnhub_quote(%s) failed: %s", symbol, e)
    return None


def _finnhub_dividend_amount(ticker: str) -> float | None:
    """Return the most recent per-share dividend for a ticker via Finnhub.
    Three-level fallback so free-plan keys still return usable data:
      1. /stock/dividend2  — exact per-payment (premium)
      2. /stock/dividend   — historical payments (free, broader coverage)
      3. /stock/metric     — indicatedAnnualDividend / 4 (free, always present)"""
    import requests as _req
    from datetime import date, timedelta
    key = os.getenv("FINNHUB_API_KEY", "")
    if not key:
        return None

    today     = date.today()
    from_date = (today - timedelta(days=365)).strftime("%Y-%m-%d")
    to_date   = (today + timedelta(days=180)).strftime("%Y-%m-%d")

    # 1. /stock/dividend2 (premium, exact per-payment)
    try:
        r = _req.get("https://finnhub.io/api/v1/stock/dividend2",
                     params={"symbol": ticker, "from": from_date, "to": to_date, "token": key}, timeout=8)
        divs = (r.json().get("data") or [])
        if divs:
            divs.sort(key=lambda d: d.get("exDate", ""), reverse=True)
            amt = divs[0].get("amount")
            if amt is not None:
                return float(amt)
    except Exception:
        pass

    # 2. /stock/dividend (free, historical payments)
    try:
        r = _req.get("https://finnhub.io/api/v1/stock/dividend",
                     params={"symbol": ticker, "from": from_date, "to": to_date, "token": key}, timeout=8)
        resp = r.json()
        divs = resp if isinstance(resp, list) else []
        if divs:
            divs.sort(key=lambda d: d.get("date", ""), reverse=True)
            amt = divs[0].get("amount")
            if amt is not None:
                return float(amt)
    except Exception:
        pass

    # 3. /stock/metric → indicatedAnnualDividend / 4
    try:
        r = _req.get("https://finnhub.io/api/v1/stock/metric",
                     params={"symbol": ticker, "metric": "all", "token": key}, timeout=8)
        metrics = (r.json().get("metric") or {})
        annual = metrics.get("dividendPerShareAnnual") or metrics.get("dividendPerShareTTM")
        if annual and float(annual) > 0:
            return round(float(annual) / 4, 4)
    except Exception:
        pass

    return None


async def _finnhub_prices_batch(tickers: list[str]) -> dict:
    """Fetch {curr, prev} for multiple tickers concurrently via Finnhub. Railway-safe.
    Replaces _batch_fetch_prices (yfinance) for all daily jobs."""
    if not tickers:
        return {}
    async def _fq(t: str):
        q = await asyncio.to_thread(_finnhub_quote, t)
        return t, q
    results = await asyncio.gather(*[_fq(t) for t in tickers], return_exceptions=True)
    return {
        t: {"curr": q["curr"], "prev": q["prev"]}
        for t, q in results
        if isinstance(q, dict) and q
    }


def _finnhub_closes(ticker: str, days: int = 35) -> list[float]:
    """Fetch daily close prices for the last N days via Finnhub /stock/candle.
    Returns list of floats (oldest→newest). Used for RSI calculation."""
    import requests as _req, time as _time
    key = os.getenv("FINNHUB_API_KEY", "")
    if not key:
        logger.warning("_finnhub_closes(%s): FINNHUB_API_KEY not set", ticker)
        return []
    try:
        to_ts   = int(_time.time())
        from_ts = to_ts - days * 86400
        r = _req.get(
            "https://finnhub.io/api/v1/stock/candle",
            params={"symbol": ticker, "resolution": "D",
                    "from": from_ts, "to": to_ts, "token": key},
            timeout=8,
        )
        d = r.json()
        if d.get("s") == "ok" and d.get("c"):
            return [float(c) for c in d["c"]]
        logger.warning("_finnhub_closes(%s): candle status not ok: %s", ticker, d.get("s"))
    except Exception as e:
        logger.warning("_finnhub_closes(%s) failed: %s", ticker, e)
    return []


def _finnhub_closes_with_dates(ticker: str, days: int) -> list[tuple]:
    """Same as _finnhub_closes but keeps each close's actual trading date
    (from Finnhub's own `t` timestamps) alongside it — (date, close) pairs,
    oldest→newest. Needed so the weekly comparison below can match specific
    calendar dates instead of counting a fixed number of array slots back,
    which drifts whenever a holiday shifts the trading calendar."""
    import requests as _req, time as _time
    from datetime import date as _date, timezone as _tz
    key = os.getenv("FINNHUB_API_KEY", "")
    if not key:
        logger.warning("_finnhub_closes_with_dates(%s): FINNHUB_API_KEY not set", ticker)
        return []
    try:
        to_ts   = int(_time.time())
        from_ts = to_ts - days * 86400
        r = _req.get(
            "https://finnhub.io/api/v1/stock/candle",
            params={"symbol": ticker, "resolution": "D",
                    "from": from_ts, "to": to_ts, "token": key},
            timeout=8,
        )
        d = r.json()
        if d.get("s") == "ok" and d.get("c") and d.get("t"):
            return [
                (_date.fromtimestamp(t, tz=_tz.utc), float(c))
                for t, c in zip(d["t"], d["c"])
            ]
        logger.warning("_finnhub_closes_with_dates(%s): candle status not ok: %s", ticker, d.get("s"))
    except Exception as e:
        logger.warning("_finnhub_closes_with_dates(%s) failed: %s", ticker, e)
    return []


def _finnhub_weekly_pct(ticker: str, as_of=None) -> dict | None:
    """Real Mon-Fri week-over-week change: the last trading day BEFORE this
    week's Monday (i.e. last Friday, or Thursday if that Friday was itself a
    holiday, etc.) vs the most recent trading day at or before `as_of`
    (defaults to today). NOT the single-day change _finnhub_quote gives.

    This adjusts for holidays automatically, for any week of the year,
    because it matches against the ACTUAL calendar dates Finnhub returns
    (which simply omit closed days) instead of assuming a fixed number of
    trading days always separates one Friday from the next.

    Returns {curr, start, pct} or None if there isn't enough history yet.
    """
    from datetime import date as _date, timedelta as _td

    today = as_of or _date.today()
    monday_this_week = today - _td(days=today.weekday())  # Mon=0 ... Sun=6

    # 21 calendar days back comfortably covers two full weeks even around a
    # holiday cluster (e.g. Thanksgiving week + the week before it).
    closes = _finnhub_closes_with_dates(ticker, days=21)
    if not closes:
        return None

    # "curr" = most recent trading day at or before `today`.
    on_or_before_today = [(d, c) for d, c in closes if d <= today]
    if not on_or_before_today:
        logger.warning("_finnhub_weekly_pct(%s): no trading day at or before %s", ticker, today)
        return None
    curr_date, curr = on_or_before_today[-1]

    # "start" = last trading day strictly before this week's Monday (i.e.
    # the previous week's final close — last Friday in a normal week).
    before_this_week = [(d, c) for d, c in closes if d < monday_this_week]
    if not before_this_week:
        logger.warning(
            "_finnhub_weekly_pct(%s): no trading day before %s (week start) in the fetched window",
            ticker, monday_this_week,
        )
        return None
    start_date, start = before_this_week[-1]

    if curr <= 0 or start <= 0:
        return None
    return {
        "curr": curr, "start": start,
        "pct": round((curr - start) / start * 100, 2),
        "curr_date": curr_date, "start_date": start_date,
    }


async def _fetch_market_open_indices() -> dict:
    """Real S&P 500 / Nasdaq data for the market-open push — points + %.
    Tries ^GSPC/^IXIC directly via Finnhub first (that IP block only ever
    applied to yfinance, not Finnhub — ^VIX already works the same way
    elsewhere in this file). Falls back to SPY/QQQ (%-only, no points) if
    the index quote fails — never fabricates a point value from the ETF
    proxy price, since SPY/QQQ trade at a totally different scale than the
    real indices.
    Returns {sp500_pct, sp500_points, nasdaq_pct, nasdaq_points, used_fallback}.
    """
    spx_q = await asyncio.to_thread(_finnhub_quote, "^GSPC")
    ixic_q = await asyncio.to_thread(_finnhub_quote, "^IXIC")
    sp500_pct   = spx_q["pct"] if spx_q else None
    nasdaq_pct  = ixic_q["pct"] if ixic_q else None
    sp500_points  = spx_q["curr"] if spx_q else None
    nasdaq_points = ixic_q["curr"] if ixic_q else None
    used_fallback = False

    if not spx_q or not ixic_q:
        used_fallback = True
        logger.warning("_fetch_market_open_indices: ^GSPC/^IXIC quote failed, falling back to SPY/QQQ %% only")
        spy_q = await asyncio.to_thread(_finnhub_quote, "SPY")
        qqq_q = await asyncio.to_thread(_finnhub_quote, "QQQ")
        if sp500_pct is None:
            sp500_pct = spy_q["pct"] if spy_q else None
        if nasdaq_pct is None:
            nasdaq_pct = qqq_q["pct"] if qqq_q else None

    return {
        "sp500_pct": sp500_pct, "sp500_points": sp500_points,
        "nasdaq_pct": nasdaq_pct, "nasdaq_points": nasdaq_points,
        "used_fallback": used_fallback,
    }


def _market_open_lines(sp500_pct, sp500_points, nasdaq_pct, nasdaq_points, language: str = "es") -> tuple[str, str]:
    """Renders the two index lines shared by job_market_open and the
    admin test-trigger endpoint, so they can never drift apart."""
    def _pct_str(pct):
        return f"{pct:+.2f}%" if pct is not None else ("n/a" if language == "en" else "s/d")

    def _points_str(points):
        return f"{points:,.0f}" if points is not None else None

    sp_pct_str = _pct_str(sp500_pct)
    nq_pct_str = _pct_str(nasdaq_pct)
    sp_points_str = _points_str(sp500_points)
    nq_points_str = _points_str(nasdaq_points)

    today_word = "today" if language == "en" else "hoy"
    sp_line = f"S&P 500: {sp_points_str} ({sp_pct_str} {today_word})" if sp_points_str else f"S&P 500 {sp_pct_str}"
    nq_line = f"Nasdaq: {nq_points_str} ({nq_pct_str} {today_word})" if nq_points_str else f"Nasdaq {nq_pct_str}"
    return sp_line, nq_line


async def job_market_open():
    """9:30 AM ET weekdays — personalized open alert for ALL users."""
    if not _is_market_open_today():
        logger.info("job_market_open: market closed today — skipping")
        return

    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    try:
        idx = await _fetch_market_open_indices()
        sp500_pct, sp500_points = idx["sp500_pct"], idx["sp500_points"]
        nasdaq_pct, nasdaq_points = idx["nasdaq_pct"], idx["nasdaq_points"]

        # Opt-out model: send to all push-capable users unless push_market_open = False
        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id,push_market_open")
        )
        disabled = {p["user_id"] for p in (prefs_res.data or []) if p.get("push_market_open") is False}

        token_res = await run_query(
            db.table("user_profiles").select("user_id,push_token")
            .neq("push_token", "").not_.is_("push_token", "null")
        )
        expo_uids = {r["user_id"] for r in (token_res.data or [])}
        web_res   = await run_query(db.table("web_push_subscriptions").select("user_id"))
        web_uids  = {r["user_id"] for r in (web_res.data or [])}
        uids = list((expo_uids | web_uids) - disabled)
        if not uids:
            return

        profiles_res = await run_query(
            db.table("user_profiles")
            .select("user_id,name,subscription_tier,trial_started_at,preferred_language").in_("user_id", uids)
        )
        name_map      = {r["user_id"]: (r.get("name") or "Inversor").split()[0] for r in (profiles_res.data or [])}
        premium_map   = {r["user_id"]: _is_premium_user(r.get("subscription_tier") or "free", r.get("trial_started_at")) for r in (profiles_res.data or [])}
        lang_map      = {r["user_id"]: (r.get("preferred_language") or "es") for r in (profiles_res.data or [])}

        # Bulk-load portfolios for all users (needed for portfolio % in premium body)
        portfolio_map: dict[str, list] = {}
        all_tickers: set[str] = set()
        for uid in [u for u in uids if premium_map.get(u)]:
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            pos = _agg_positions(port_res.data or [])
            if pos:
                portfolio_map[uid] = pos
                all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        prices = await _finnhub_prices_batch(list(all_tickers)) if all_tickers else {}

        # "S&P 500: 7,538 (+0.58% hoy)" when we have real index points, or the
        # old "S&P 500 +0.58%" style if the ^GSPC/^IXIC fetch failed today.
        sp_line_es, nq_line_es = _market_open_lines(sp500_pct, sp500_points, nasdaq_pct, nasdaq_points, "es")
        sp_line_en, nq_line_en = _market_open_lines(sp500_pct, sp500_points, nasdaq_pct, nasdaq_points, "en")

        sent = 0
        for i, uid in enumerate(uids):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.1))

            first      = name_map.get(uid, "Inversor")
            is_premium = premium_map.get(uid, False)
            is_en      = lang_map.get(uid, "es") == "en"
            sp_line, nq_line = (sp_line_en, nq_line_en) if is_en else (sp_line_es, nq_line_es)
            title = f"{first}, the market is open 🔔" if is_en else f"{first}, el mercado ha abierto 🔔"

            if is_premium:
                user_pct = _calc_portfolio_pct(portfolio_map.get(uid, []), prices)
                if user_pct is not None:
                    body = (
                        f"{sp_line}\n{nq_line}\n\nYour portfolio: {user_pct:+.2f}% today. Tap for details."
                        if is_en else
                        f"{sp_line}\n{nq_line}\n\nTu portafolio: {user_pct:+.2f}% hoy. Entra a ver el detalle."
                    )
                else:
                    body = (
                        f"{sp_line}\n{nq_line}\n\nAdd your portfolio to see your performance."
                        if is_en else
                        f"{sp_line}\n{nq_line}\n\nAgrega tu portafolio para ver tu rendimiento."
                    )
            else:
                body = (
                    f"{sp_line}\n{nq_line}\n\nTap to see how your portfolio is doing."
                    if is_en else
                    f"{sp_line}\n{nq_line}\n\nEntra a ver cómo se está comportando tu portafolio."
                )

            await send_push(uid, "market_open", title, body, {"screen": "portfolio"}, db)
            sent += 1
        logger.info("Market open push: %d sent | S&P %s (%s pts) | Nasdaq %s (%s pts)",
                    sent, sp500_pct, sp500_points, nasdaq_pct, nasdaq_points)
    except Exception as e:
        logger.error("job_market_open failed: %s", e)


async def job_holiday_midday():
    """12:00 PM ET weekdays — midday nudge on NYSE holidays (market closed today)."""
    if not _is_market_holiday_today():
        logger.info("job_holiday_midday: today is not a market holiday — skipping")
        return

    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    try:
        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id,push_market_open")
        )
        disabled = {p["user_id"] for p in (prefs_res.data or []) if p.get("push_market_open") is False}

        token_res = await run_query(
            db.table("user_profiles").select("user_id,push_token")
            .neq("push_token", "").not_.is_("push_token", "null")
        )
        expo_uids = {r["user_id"] for r in (token_res.data or [])}
        web_res = await run_query(db.table("web_push_subscriptions").select("user_id"))
        web_uids = {r["user_id"] for r in (web_res.data or [])}
        uids = list((expo_uids | web_uids) - disabled)
        if not uids:
            return

        profiles_res = await run_query(
            db.table("user_profiles").select("user_id,name,preferred_language").in_("user_id", uids)
        )
        name_map = {r["user_id"]: (r.get("name") or "Inversor").split()[0] for r in (profiles_res.data or [])}
        lang_map = {r["user_id"]: (r.get("preferred_language") or "es") for r in (profiles_res.data or [])}

        for uid in uids:
            first = name_map.get(uid, "Inversor")
            if lang_map.get(uid, "es") == "en":
                title = "Markets are closed today 🏖️"
                body = f"{first}, a good time to review your stocks without market pressure. How's your portfolio doing?"
            else:
                title = "Hoy la bolsa descansa 🏖️"
                body = f"{first}, buen momento para analizar tus acciones sin la presión del mercado. ¿Cómo va tu portafolio?"
            await send_push(uid, "holiday_midday", title, body, {"screen": "portfolio"}, db)
            await asyncio.sleep(0.05)

        logger.info("job_holiday_midday: sent to %d users", len(uids))
    except Exception as e:
        logger.error("job_holiday_midday failed: %s", e)


async def job_market_close():
    """4:00 PM ET weekdays — personalized market close push + email per user.
    Skips weekends and NYSE holidays via _is_market_open_today().
    Uses SPY/QQQ as S&P 500/Nasdaq proxies (^GSPC/^IXIC are IP-blocked on Railway).
    """
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push, send_email_notification
    from app.services.email_templates import daily_email_v2

    # ── 0. Holiday / weekend guard ────────────────────────────────────────────
    if not _is_market_open_today():
        logger.info("job_market_close: market closed today (holiday or weekend) — skipping")
        return

    db = get_supabase()
    try:
        # ── 1. Fetch indices via Finnhub (Railway-safe, no yfinance) ────────────
        spy_q = await asyncio.to_thread(_finnhub_quote, "SPY")
        qqq_q = await asyncio.to_thread(_finnhub_quote, "QQQ")
        sp500_pct  = spy_q["pct"]  if spy_q else None
        nasdaq_pct = qqq_q["pct"]  if qqq_q else None
        sp_px      = spy_q["curr"] if spy_q else None
        nq_px      = qqq_q["curr"] if qqq_q else None

        # ── 2. Discover users: start from portfolio (not push token) ─────────
        # Gate: user must have at least one position imported.
        # Push is best-effort (sent if they have a channel); email always goes.
        port_uid_res = await run_query(db.table("user_portfolio").select("user_id,positions"))
        port_rows    = [r for r in (port_uid_res.data or []) if r.get("positions")]

        # Filter to users who actually have positions (not empty list/dict)
        def _has_positions(raw) -> bool:
            if not raw:
                return False
            pos = raw.get("positions", []) if isinstance(raw, dict) else raw
            return isinstance(pos, list) and len(pos) > 0

        portfolio_map: dict[str, list] = _build_portfolio_map(port_uid_res.data or [])
        all_tickers: set[str] = {p["ticker"] for pos in portfolio_map.values() for p in pos if p.get("ticker")}

        if not portfolio_map:
            logger.warning("job_market_close: no users with imported portfolios")
            return

        uids = list(portfolio_map.keys())

        # Users who opted out of market_close notifications
        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id,push_market_close")
        )
        disabled = {p["user_id"] for p in (prefs_res.data or []) if p.get("push_market_close") is False}

        # Push-capable users (Expo token OR web push subscription)
        token_res = await run_query(
            db.table("user_profiles").select("user_id,push_token")
            .neq("push_token", "").not_.is_("push_token", "null")
        )
        expo_uids = {r["user_id"] for r in (token_res.data or [])}
        web_res   = await run_query(db.table("web_push_subscriptions").select("user_id"))
        web_uids  = {r["user_id"] for r in (web_res.data or [])}
        push_capable = (expo_uids | web_uids) - disabled

        # ── 3. Profiles: name + email + tier + language in one query ─────────────
        # Covers portfolio users AND push-capable users without a portfolio (the
        # "generic push" branch below) — both need language for their push text.
        profiles_res = await run_query(
            db.table("user_profiles")
            .select("user_id,name,email,subscription_tier,trial_started_at,preferred_language")
            .in_("user_id", list(set(uids) | push_capable))
        )
        profile_map = {
            r["user_id"]: {
                "first":      (r.get("name") or "Inversor").split()[0],
                "email":      r.get("email") or "",
                "is_premium": _is_premium_user(r.get("subscription_tier") or "free", r.get("trial_started_at")),
                "language":   r.get("preferred_language") or "es",
            }
            for r in (profiles_res.data or [])
        }

        # ── 4. Fetch all portfolio prices concurrently via Finnhub ───────────────
        prices = await _finnhub_prices_batch(list(all_tickers)) if all_tickers else {}

        # ── 5. Build shared index lines ───────────────────────────────────────
        sp_line = f"S&P 500: {sp500_pct:+.2f}%"  if sp500_pct  is not None else "S&P 500: N/D"
        nq_line = f"Nasdaq: {nasdaq_pct:+.2f}%"   if nasdaq_pct is not None else "Nasdaq: N/D"
        indices  = f"{sp_line} · {nq_line}"

        # ── 6. Fan out ────────────────────────────────────────────────────────
        # • Has portfolio  → personalized push (if capable) + personalized email
        # • No portfolio   → generic push only (if capable), no email
        generic_push_uids = (push_capable - set(portfolio_map.keys())) - disabled
        all_uids          = (set(portfolio_map.keys()) | generic_push_uids) - disabled

        sent_push = sent_email = 0
        for i, uid in enumerate(sorted(all_uids)):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.1))

            has_portfolio = uid in portfolio_map
            p             = profile_map.get(uid, {})
            first         = p.get("first", "Inversor")
            is_premium    = p.get("is_premium", False)
            is_en         = p.get("language", "es") == "en"

            if is_premium and has_portfolio:
                # Premium: personalized push only (email goes out Fridays via job_daily_email)
                user_pct, total_curr, top_gainers, top_losers = _calc_portfolio_close_data(
                    portfolio_map[uid], prices
                )
                if uid in push_capable:
                    no_data = "n/a" if is_en else "s/d"
                    sp_cl  = f"{sp500_pct:+.1f}%"  if sp500_pct  is not None else no_data
                    nq_cl  = f"{nasdaq_pct:+.1f}%"  if nasdaq_pct is not None else no_data
                    if user_pct is not None:
                        beating    = sp500_pct is not None and user_pct > sp500_pct
                        if is_en:
                            push_title = "🏆 You beat the market today" if beating else "📊 Market close"
                        else:
                            push_title = "🏆 Superaste al mercado hoy" if beating else "📊 Cierre de mercado"
                        your_word  = "Your portfolio" if is_en else "Tu portafolio"
                        push_body  = f"S&P 500 {sp_cl} · Nasdaq {nq_cl} · {your_word} {user_pct:+.1f}%"
                    else:
                        push_title = "📊 Market close" if is_en else "📊 Cierre de mercado"
                        push_body  = f"S&P 500 {sp_cl} · Nasdaq {nq_cl}"
                    await send_push(uid, "market_close", push_title, push_body, {"screen": "portfolio"}, db)
                    sent_push += 1

            elif uid in push_capable:
                # Free: generic push only, no portfolio data, subtle upgrade nudge
                if is_en:
                    body = f"The market closed. {indices}. With Premium you can see your portfolio's exact performance. 📊"
                    await send_push(uid, "market_close", "📊 The market has closed", body, {"screen": "portfolio"}, db)
                else:
                    body = f"El mercado cerró. {indices}. Con Premium puedes ver el rendimiento exacto de tu portafolio. 📊"
                    await send_push(uid, "market_close", "📊 El mercado ha cerrado", body, {"screen": "portfolio"}, db)
                sent_push += 1

        logger.info(
            "Market close: %d total | %d push | %d email | S&P %s | NQ %s",
            len(all_uids), sent_push, sent_email, sp500_pct, nasdaq_pct,
        )
    except Exception as e:
        logger.error("job_market_close failed: %s", e)


async def _generate_market_wrap(
    sp_pct: float | None, nq_pct: float | None, top_movers: list[dict],
    period: str = "día", language: str = "es",
) -> str:
    """Generate a 2-3 paragraph market wrap narrative. `period` is "día" for
    the real daily context or "semana" for the Friday weekly email (and
    sp_pct/nq_pct are expected to already match: single-day vs Mon-Fri,
    respectively). `language` picks Spanish or English — this is generated
    once per language among the batch of users being emailed (not per user),
    since the narrative content is identical for everyone in that language."""
    if sp_pct is None and nq_pct is None and not top_movers:
        # Nothing real to summarize — never let the model freely improvise a
        # narrative about "no data available" and have that get sent to
        # users looking like a real analysis (see the 2026-07-17 incident,
        # where exactly this happened). Callers should ideally not reach
        # this point at all (job_daily_email now skips sending rather than
        # calling this with empty data), but this is the last line of
        # defense for any other caller.
        return ""

    try:
        import anthropic
        from app.services.price_alert_service import fetch_ticker_news

        is_weekly = period == "semana"
        is_en     = language == "en"
        market_str = ""
        if sp_pct is not None:
            market_str += f"S&P 500: {sp_pct:+.2f}%"
        if nq_pct is not None:
            market_str += f", Nasdaq: {nq_pct:+.2f}%"

        # Fetch news for top 5 movers for context
        news_lines: list[str] = []
        for m in top_movers[:5]:
            try:
                news_items = await asyncio.to_thread(fetch_ticker_news, m["ticker"])
                for item in (news_items or [])[:2]:
                    h = item["headline"] if isinstance(item, dict) else item
                    news_lines.append(f"- [{m['ticker']} {m.get('pct', m.get('day_pct', 0)):+.1f}%] {h}")
            except Exception:
                pass
        news_str = "\n".join(news_lines) if news_lines else ("No news available." if is_en else "Sin noticias disponibles.")

        moves_str = "\n".join(
            f"- {x['ticker']}: {x.get('pct', x.get('day_pct', 0)):+.2f}%"
            for x in top_movers[:8]
        )

        if is_en:
            time_frame = "this week (Monday through Friday)" if is_weekly else "today"
            look_ahead = "next week" if is_weekly else "tomorrow"
            prompt = f"""You are a financial analyst writing the {time_frame} market wrap for Latin American investors.

Market data {time_frame}:
{market_str}

Relevant news and movements:
{news_str}

Key movers:
{moves_str}

Write a {time_frame} narrative summary in 2 short paragraphs (3-4 sentences each):
- Paragraph 1: What happened in the market {time_frame} and why (macro, Fed, earnings, sector, etc.)
- Paragraph 2: What to watch {look_ahead} or what this means for investors

English, analytical but accessible tone. No bullet points, no markdown, no asterisks, no title or heading — just the 2 paragraphs directly."""
        else:
            time_frame  = "esta semana (lunes a viernes)" if is_weekly else "hoy"
            look_ahead  = "la próxima semana" if is_weekly else "mañana"
            prompt = f"""Eres un analista financiero escribiendo el resumen de mercado de {time_frame} para inversores latinoamericanos.

Datos del mercado {time_frame}:
{market_str}

Noticias y movimientos relevantes:
{news_str}

Principales movimientos:
{moves_str}

Escribe un resumen narrativo de {time_frame} en 2 párrafos cortos (3-4 oraciones cada uno):
- Párrafo 1: Qué pasó en el mercado {time_frame} y por qué (macro, Fed, resultados, sector, etc.)
- Párrafo 2: Qué vigilar en {look_ahead} o qué significa esto para los inversores

Español, tono analítico pero accesible. Sin viñetas, sin markdown, sin asteriscos, sin título ni encabezado — solo los 2 párrafos directamente."""

        client = anthropic.AsyncAnthropic()
        resp = await asyncio.wait_for(
            client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=400,
                messages=[{"role": "user", "content": prompt}],
            ),
            timeout=15,
        )
        in_tok = getattr(resp.usage, "input_tokens", 0)
        out_tok = getattr(resp.usage, "output_tokens", 0)
        logger.info("LLM market_wrap: in=%d out=%d cost=$%.5f", in_tok, out_tok,
                    in_tok / 1e6 * 0.80 + out_tok / 1e6 * 4.0)
        from app.services.llm_usage import log_llm_usage
        asyncio.create_task(log_llm_usage(None, "job_daily_email_market_wrap", "claude-haiku-4-5-20251001", resp.usage))
        raw = (resp.content[0].text or "").strip()
        # Strip any accidental markdown (model sometimes ignores the no-markdown instruction)
        import re as _re
        raw = _re.sub(r"#+ ?", "", raw)
        raw = _re.sub(r"\*\*(.+?)\*\*", r"\1", raw)
        raw = _re.sub(r"\*(.+?)\*", r"\1", raw)
        return raw
    except Exception:
        return ""


async def _generate_earnings_ai_for_email(
    ticker: str,
    eps_actual: float | None,
    eps_estimate: float | None,
    beat: bool,
    rev_actual_b: float | None,
    rev_estimate_b: float | None,
    language: str = "es",
) -> str:
    """1-2 sentence earnings analysis for the daily email earnings section."""
    try:
        import anthropic
        is_en = language == "en"
        if is_en:
            eps_str = f"EPS ${eps_actual:.2f} vs ${eps_estimate:.2f} estimated" if eps_actual is not None and eps_estimate is not None else ""
            rev_str = f"Revenue ${rev_actual_b:.2f}B vs ${rev_estimate_b:.2f}B" if rev_actual_b and rev_estimate_b else ""
            result  = "beat" if beat else "missed"
            prompt = (
                f"{ticker} {result} expectations: {eps_str}. {rev_str}. "
                f"In 1-2 sentences in English, explain what drove these results and what they imply for the stock. "
                f"No markdown, no asterisks, accessible analyst language."
            )
        else:
            eps_str = f"EPS ${eps_actual:.2f} vs ${eps_estimate:.2f} estimado" if eps_actual is not None and eps_estimate is not None else ""
            rev_str = f"Ingresos ${rev_actual_b:.2f}B vs ${rev_estimate_b:.2f}B" if rev_actual_b and rev_estimate_b else ""
            result  = "superó" if beat else "no alcanzó"
            prompt = (
                f"{ticker} {result} las expectativas: {eps_str}. {rev_str}. "
                f"En 1-2 oraciones en español, explica qué impulsó estos resultados y qué implican para la acción. "
                f"Sin markdown, sin asteriscos, lenguaje de analista accesible."
            )
        client = anthropic.AsyncAnthropic()
        resp = await asyncio.wait_for(
            client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=150,
                messages=[{"role": "user", "content": prompt}],
            ),
            timeout=10,
        )
        in_tok = getattr(resp.usage, "input_tokens", 0)
        out_tok = getattr(resp.usage, "output_tokens", 0)
        logger.info("LLM earnings_email(%s): in=%d out=%d cost=$%.5f", ticker, in_tok, out_tok,
                    in_tok / 1e6 * 0.80 + out_tok / 1e6 * 4.0)
        from app.services.llm_usage import log_llm_usage
        asyncio.create_task(log_llm_usage(None, "job_daily_email_earnings", "claude-haiku-4-5-20251001", resp.usage))
        return (resp.content[0].text or "").strip()
    except Exception:
        return ""


async def _generate_daily_ai_summary(tickers_with_moves: list[dict], sp_pct: float | None, nq_pct: float | None) -> str:
    """Kept for backward compatibility — wraps _generate_market_wrap."""
    return await _generate_market_wrap(sp_pct, nq_pct, tickers_with_moves)


# Copy for the free-tier weekly summary email built inline in job_daily_email
# (the premium path instead uses daily_email_v2 / _DAILY_EMAIL_COPY in
# email_templates.py). {first}/{week_label}/{sp_str}/{nq_str} are filled in
# with .format() at send time.
_FREE_WEEKLY_COPY = {
    "es": {
        "header_tagline": "Nuvos AI · Resumen Semanal",
        "greeting": "Hola {first}, ¿cómo estuvo la semana? 👋",
        "subheading": "El mercado cerró. Aquí está lo que pasó en la {week_label}.",
        "this_week": "esta semana",
        "analysis_header": "ANÁLISIS DE LA SEMANA",
        "upsell_title": "🔒 ¿Cuánto rindió tu portafolio esta semana?",
        "upsell_body": "Con Premium ves el rendimiento exacto de tus inversiones vs S&P 500, recibes alertas de movimientos y hablas con tu mentor IA sin límites.",
        "upsell_cta": "Activar Premium →",
        "slogan": "Con Nuvos, invierte sin miedo.",
        "disclaimer": "Nuvos AI · Solo educativo. No constituye asesoramiento financiero profesional.",
        "subject": "📊 El mercado esta semana: S&P 500 {sp_str}, Nasdaq {nq_str} — Nuvos AI",
    },
    "en": {
        "header_tagline": "Nuvos AI · Weekly Summary",
        "greeting": "Hi {first}, how was your week? 👋",
        "subheading": "The market closed. Here's what happened during the {week_label}.",
        "this_week": "this week",
        "analysis_header": "THIS WEEK'S ANALYSIS",
        "upsell_title": "🔒 How did your portfolio perform this week?",
        "upsell_body": "With Premium you see your investments' exact performance vs the S&P 500, get alerted on big moves, and chat with your AI mentor with no limits.",
        "upsell_cta": "Activate Premium →",
        "slogan": "With Nuvos, invest without fear.",
        "disclaimer": "Nuvos AI · Educational only. Not professional financial advice.",
        "subject": "📊 The market this week: S&P 500 {sp_str}, Nasdaq {nq_str} — Nuvos AI",
    },
}


async def job_daily_email():
    """6:00 PM ET weekdays — personalized daily email for ALL users.

    Structure:
      1. Tu portafolio vs S&P 500 vs Nasdaq (comparison table)
      2. AI summary of the day's key events for user's positions
      3. Top 3 up + Top 3 down from the user's portfolio
    """
    if not settings.resend_api_key:
        return
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_email_notification
    from app.services.email_templates import daily_email_v2
    db = get_supabase()
    try:
        # ── 1. Index prices via Finnhub (SPY/QQQ proxies — Railway-safe) ──────
        # ^GSPC/^IXIC are IP-blocked on Railway via yfinance; use SPY/QQQ instead.
        # This is the actual Mon-Fri weekly move (last Friday's close → today's
        # close) — NOT _finnhub_quote's single-day change, which is what this
        # email used to show mislabeled as "esta semana."
        spy_w = await asyncio.to_thread(_finnhub_weekly_pct, "SPY")
        qqq_w = await asyncio.to_thread(_finnhub_weekly_pct, "QQQ")
        if not spy_w and not qqq_w:
            # Both index fetches failing together points at a transient
            # Finnhub hiccup (rate limit, brief outage) rather than a real
            # "no data" condition — one retry after a short backoff usually
            # recovers. If it still fails, skip sending entirely: a broken
            # email with "—" indices and an AI paragraph admitting it has no
            # data to work with is worse than no email, and previously went
            # out anyway (see the 2026-07-17 incident).
            logger.warning("job_daily_email: SPY/QQQ weekly fetch both failed, retrying once in 30s")
            await asyncio.sleep(30)
            spy_w = await asyncio.to_thread(_finnhub_weekly_pct, "SPY")
            qqq_w = await asyncio.to_thread(_finnhub_weekly_pct, "QQQ")
            if not spy_w and not qqq_w:
                logger.error("job_daily_email: SPY/QQQ weekly fetch failed twice — skipping this send, not sending a dataless email")
                return
        sp_pct = spy_w["pct"] if spy_w else None
        nq_pct = qqq_w["pct"] if qqq_w else None
        sp_px  = spy_w["curr"] if spy_w else None
        nq_px  = qqq_w["curr"] if qqq_w else None

        # ── 2. All users, excluding explicit opt-outs ─────────────────────────
        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id,email_daily_summary")
        )
        disabled = {p["user_id"] for p in (prefs_res.data or []) if p.get("email_daily_summary") is False}

        profiles_res = await run_query(
            db.table("user_profiles").select("user_id,name,subscription_tier,preferred_language")
        )
        all_profile_data = [r for r in (profiles_res.data or []) if r["user_id"] not in disabled]
        opted_ids = [r["user_id"] for r in all_profile_data]
        if not opted_ids:
            return

        name_map = {r["user_id"]: r.get("name") or "Inversor" for r in all_profile_data}
        tier_map = {r["user_id"]: (r.get("subscription_tier") or "free") for r in all_profile_data}
        lang_map = {r["user_id"]: (r.get("preferred_language") or "es") for r in all_profile_data}

        # ── 4. Portfolios — premium users only ────────────────────────────────
        premium_uids = {uid for uid in opted_ids if tier_map.get(uid) == "premium"}
        portfolio_map: dict[str, list] = {}
        all_tickers: set[str] = set()
        for uid in premium_uids:
            port_res = await run_query(
                db.table("user_portfolio").select("positions").eq("user_id", uid)
            )
            if port_res.data:
                pos = _agg_positions(port_res.data or [])
                if pos:
                    portfolio_map[uid] = pos
                    all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        # ── 5. Fetch stock prices via Finnhub (Railway-safe, no IP block) ─────
        # Weekly closes (last Friday → today), not _finnhub_quote's single-day
        # change — this whole email is framed as "esta semana," so the
        # portfolio comparison below needs to actually span the week too.
        async def _fq(t: str):
            q = await asyncio.to_thread(_finnhub_weekly_pct, t)
            return t, q

        price_results = await asyncio.gather(*[_fq(t) for t in all_tickers]) if all_tickers else []
        week_prices = {t: {"curr": q["curr"], "prev": q["start"]} for t, q in price_results if q}

        # ── 6. Collect all unique tickers + watchlist for market wrap context ─
        watch_res   = await run_query(db.table("watchlist").select("user_id,ticker"))
        watch_by_uid: dict[str, set] = {}
        all_watch_tickers: set[str] = set()
        for r in (watch_res.data or []):
            watch_by_uid.setdefault(r["user_id"], set()).add(r["ticker"])
            all_watch_tickers.add(r["ticker"])

        # ── 7. Compute global top movers (all portfolio tickers combined) ─────
        global_movers: list[dict] = []
        for ticker, px in week_prices.items():
            if px.get("prev") and px["prev"] > 0:
                pct = round((px["curr"] - px["prev"]) / px["prev"] * 100, 2)
                global_movers.append({"ticker": ticker, "pct": pct})
        global_movers.sort(key=lambda x: abs(x["pct"]), reverse=True)

        # ── 8. Market Wrap — generated ONCE PER LANGUAGE actually needed among
        # today's recipients (not per user — the narrative is identical for
        # everyone sharing a language, so this stays cheap regardless of how
        # many users are on each).
        needed_langs = {lang_map.get(uid, "es") for uid in opted_ids} or {"es"}
        market_wrap_by_lang: dict[str, str] = {}
        for lang in needed_langs:
            market_wrap_by_lang[lang] = await _generate_market_wrap(
                sp_pct, nq_pct, global_movers, period="semana", language=lang
            )

        # ── 9. Today's earnings from Finnhub — fetched ONCE ──────────────────
        # At 6 PM both BMO (pre-market) and AMC (after-hours early) have likely reported
        all_today_earnings = await asyncio.to_thread(_finnhub_earnings_today, None)

        # Generate AI analysis per unique ticker that reported today, once per
        # needed language (concurrent within each language batch)
        earning_tickers = list(all_today_earnings.keys())
        earnings_ai_map_by_lang: dict[str, dict[str, str]] = {}
        if earning_tickers:
            for lang in needed_langs:
                analyses = await asyncio.gather(
                    *[
                        _generate_earnings_ai_for_email(
                            ticker=t,
                            eps_actual=all_today_earnings[t].get("eps_actual"),
                            eps_estimate=all_today_earnings[t].get("eps_estimate"),
                            beat=all_today_earnings[t].get("beat_eps", False),
                            rev_actual_b=all_today_earnings[t].get("rev_actual_b"),
                            rev_estimate_b=all_today_earnings[t].get("rev_estimate_b"),
                            language=lang,
                        )
                        for t in earning_tickers
                    ],
                    return_exceptions=True,
                )
                earnings_ai_map_by_lang[lang] = {
                    t: (a if isinstance(a, str) else "")
                    for t, a in zip(earning_tickers, analyses)
                }
        else:
            earnings_ai_map_by_lang = {lang: {} for lang in needed_langs}

        # ── 10. Build and send per-user email ─────────────────────────────────
        from datetime import datetime as _dt
        _now = _dt.now()
        week_label_by_lang = {
            "es": f"semana del {_now.day} de {_SPANISH_MONTHS[_now.month - 1]}",
            "en": f"week of {_ENGLISH_MONTHS[_now.month - 1]} {_now.day}",
        }
        sp_str = f"{sp_pct:+.1f}%" if sp_pct is not None else "—"
        nq_str = f"{nq_pct:+.1f}%" if nq_pct is not None else "—"

        sent = 0
        for i, uid in enumerate(opted_ids):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.1))

            first      = name_map.get(uid, "Inversor").split()[0]
            is_premium = tier_map.get(uid) == "premium"
            positions  = portfolio_map.get(uid, [])
            watchlist  = watch_by_uid.get(uid, set())
            lang       = lang_map.get(uid, "es")
            is_en      = lang == "en"

            if is_premium and positions:
                # ── Premium: personalized portfolio summary ────────────────────
                enriched: list[dict] = []
                total_val  = 0.0
                total_prev = 0.0
                for p in positions:
                    ticker = p.get("ticker")
                    shares = float(p.get("shares") or 0)
                    if not ticker or not shares or ticker not in week_prices:
                        continue
                    px    = week_prices[ticker]
                    cv    = px["curr"] * shares
                    pv    = px["prev"] * shares
                    pct   = (px["curr"] - px["prev"]) / px["prev"] * 100 if px["prev"] else 0.0
                    d_usd = cv - pv
                    total_val  += cv
                    total_prev += pv
                    enriched.append({
                        "ticker":        ticker,
                        "pct":           round(pct, 2),
                        "dollar_change": round(d_usd, 2),
                        "total_value":   round(cv, 2),
                    })

                port_pct = round((total_val - total_prev) / total_prev * 100, 2) if total_prev > 0 else None
                port_usd = round(total_val - total_prev, 2) if total_prev > 0 else None

                sorted_pos  = sorted(enriched, key=lambda x: x["pct"], reverse=True)
                top_gainers = sorted_pos[:3]
                top_losers  = list(reversed(sorted_pos))[:3]

                port_tickers = {p["ticker"] for p in positions if p.get("ticker")}
                relevant_earnings = (port_tickers | watchlist) & set(all_today_earnings.keys())
                earnings_items: list[dict] = []
                for t in sorted(relevant_earnings):
                    e = all_today_earnings[t]
                    earnings_items.append({
                        "ticker":         t,
                        "company_name":   t,
                        "eps_actual":     e.get("eps_actual"),
                        "eps_estimate":   e.get("eps_estimate"),
                        "beat_eps":       e.get("beat_eps", False),
                        "rev_actual_b":   e.get("rev_actual_b"),
                        "rev_estimate_b": e.get("rev_estimate_b"),
                        "beat_rev":       e.get("beat_rev", False),
                        "hour":           e.get("hour", ""),
                        "ai_analysis":    earnings_ai_map_by_lang.get(lang, {}).get(t, ""),
                    })

                html = daily_email_v2(
                    first_name=first,
                    port_pct=port_pct,
                    port_usd=port_usd,
                    sp_pct=sp_pct,
                    sp_px=sp_px,
                    nq_pct=nq_pct,
                    nq_px=nq_px,
                    top_gainers=top_gainers,
                    top_losers=top_losers,
                    ai_summary="",
                    market_wrap=market_wrap_by_lang.get(lang, ""),
                    earnings_items=earnings_items,
                    period="semana",
                    language=lang,
                )
                sign = "+" if port_pct and port_pct >= 0 else ""
                if is_en:
                    subject = (
                        f"Your portfolio this week: {sign}{port_pct:.2f}% — Nuvos AI"
                        if port_pct is not None
                        else "Your weekly market summary — Nuvos AI"
                    )
                else:
                    subject = (
                        f"Tu portafolio esta semana: {sign}{port_pct:.2f}% — Nuvos AI"
                        if port_pct is not None
                        else "Tu resumen semanal del mercado — Nuvos AI"
                    )
            else:
                # ── Free: general market summary for the week ──────────────────
                # Convert plain-text paragraphs to HTML (AI sometimes ignores no-markdown instruction)
                def _plain_to_html(text: str) -> str:
                    import re
                    text = re.sub(r"#+ ?", "", text)           # strip any markdown headers
                    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
                    paras = [p.strip() for p in text.split("\n\n") if p.strip()]
                    if not paras:
                        paras = [p.strip() for p in text.split("\n") if p.strip()]
                    return "".join(f'<p style="color:#d1d5db;font-size:14px;line-height:1.75;margin:0 0 14px">{p}</p>' for p in paras)

                market_body = _plain_to_html(market_wrap_by_lang.get(lang, "")) if market_wrap_by_lang.get(lang) else ""
                sp_color  = "#22c55e" if sp_pct is not None and sp_pct >= 0 else "#ef4444"
                nq_color  = "#22c55e" if nq_pct is not None and nq_pct >= 0 else "#ef4444"
                sp_border = "rgba(34,197,94,0.25)"  if sp_pct is not None and sp_pct >= 0 else "rgba(239,68,68,0.25)"
                nq_border = "rgba(34,197,94,0.25)"  if nq_pct is not None and nq_pct >= 0 else "rgba(239,68,68,0.25)"
                week_label = week_label_by_lang.get(lang, week_label_by_lang["es"])
                fc = _FREE_WEEKLY_COPY.get(lang, _FREE_WEEKLY_COPY["es"])
                html = f"""<!DOCTYPE html>
<html lang="{lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nuvos AI</title></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
  <div style="border-radius:20px;overflow:hidden;border:1px solid #2a2d3a">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0d1f14,#0f2a1a);padding:28px 32px;text-align:center;border-bottom:1px solid #1e3a28">
      <img src="https://www.nuvosai.com/logo.png" alt="Nuvos AI" width="48" height="48" style="display:block;margin:0 auto 10px;border-radius:12px"/>
      <p style="margin:0;color:#00d47e;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase">{fc["header_tagline"]}</p>
    </div>

    <!-- Body -->
    <div style="background:#161b27;padding:28px 32px">
      <h1 style="color:#fff;font-size:20px;font-weight:900;margin:0 0 4px;letter-spacing:-0.3px">{fc["greeting"].format(first=first)}</h1>
      <p style="color:#6b7280;font-size:13px;margin:0 0 24px">{fc["subheading"].format(week_label=week_label)}</p>

      <!-- Index cards -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px">
        <tr>
          <td style="width:49%;vertical-align:top;padding-right:6px">
            <div style="background:#111318;border:1px solid {sp_border};border-radius:14px;padding:18px;text-align:center">
              <p style="color:#9ca3af;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 8px">S&amp;P 500</p>
              <p style="color:{sp_color};font-size:26px;font-weight:900;margin:0;letter-spacing:-0.5px">{sp_str}</p>
              <p style="color:#4b5563;font-size:11px;margin:4px 0 0">{fc["this_week"]}</p>
            </div>
          </td>
          <td style="width:49%;vertical-align:top;padding-left:6px">
            <div style="background:#111318;border:1px solid {nq_border};border-radius:14px;padding:18px;text-align:center">
              <p style="color:#9ca3af;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 8px">NASDAQ</p>
              <p style="color:{nq_color};font-size:26px;font-weight:900;margin:0;letter-spacing:-0.5px">{nq_str}</p>
              <p style="color:#4b5563;font-size:11px;margin:4px 0 0">{fc["this_week"]}</p>
            </div>
          </td>
        </tr>
      </table>

      <!-- Market wrap narrative -->
      {f'<div style="background:#111318;border:1px solid #2a2d3a;border-radius:14px;padding:22px;margin-bottom:20px"><p style="color:#00d47e;font-size:10px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 14px">{fc["analysis_header"]}</p>' + market_body + '</div>' if market_body else ''}

      <!-- Premium upsell -->
      <div style="background:linear-gradient(135deg,rgba(0,168,94,0.08),rgba(0,212,126,0.04));border:1px solid rgba(0,212,126,0.2);border-radius:14px;padding:20px;margin-bottom:20px">
        <p style="color:#00d47e;font-size:13px;font-weight:800;margin:0 0 6px">{fc["upsell_title"]}</p>
        <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:0 0 16px">{fc["upsell_body"]}</p>
        <div style="text-align:center">
          <a href="https://nuvosai.com/portfolio" style="display:inline-block;background:#00d47e;color:#000;font-weight:900;font-size:14px;padding:13px 28px;border-radius:12px;text-decoration:none">{fc["upsell_cta"]}</a>
        </div>
      </div>

      <!-- Footer -->
      <div style="border-top:1px solid #2a2d3a;padding-top:16px;text-align:center">
        <p style="color:#00a85e;font-size:12px;font-weight:700;margin:0 0 4px">{fc["slogan"]}</p>
        <p style="color:#374151;font-size:11px;margin:0">{fc["disclaimer"]}</p>
      </div>
    </div>
  </div>
</div>
</body></html>"""
                subject = fc["subject"].format(sp_str=sp_str, nq_str=nq_str)

            await send_email_notification(uid, "weekly_summary", subject, html, db)
            sent += 1

        logger.info(
            "Friday email: %d sent (%d premium, %d free) | S&P %s | NQ %s",
            sent, len([u for u in opted_ids if tier_map.get(u) == "premium"]),
            len([u for u in opted_ids if tier_map.get(u) != "premium"]),
            sp_pct, nq_pct,
        )
    except Exception as e:
        logger.error("job_daily_email failed: %s", e)


async def get_price_alert_why_with_diagnostics(ticker: str, pct: float, price: float) -> dict:
    """The exact WHY-resolution logic job_portfolio_alerts uses per mover —
    factored out so an admin test endpoint can produce the identical
    "Portfolio alerts WHY diagnostic" log line on demand, for a ticker/pct
    chosen right now, instead of needing to wait for a real market mover to
    exercise this same code path. Returns the raw per-stage data too (not
    just the final string) so a caller building a diagnostic JSON response
    doesn't have to re-run the same Perplexity/Finnhub/Claude calls again."""
    from app.services.price_alert_service import NO_CATALYST, search_price_catalyst, generate_price_alert_why

    news = await asyncio.to_thread(_fetch_ticker_news, ticker)
    web_context = await search_price_catalyst(ticker, pct)
    if not web_context and not news:
        why = NO_CATALYST
        logger.info(
            "Portfolio alerts WHY diagnostic — %s (%+.2f%%): finnhub_news=0, "
            "perplexity_context_len=0 -> NO_CATALYST (no data from either source at all)",
            ticker, pct,
        )
    else:
        why = await generate_price_alert_why(ticker, pct, price, news, extra_context=web_context)
        # Full preview even when data WAS found — if this still shows a real
        # catalyst in the raw text but `why` comes back NO_CATALYST anyway,
        # that proves it's Claude's judgment call being too strict, not a
        # missing-data problem, and the fix is in generate_price_alert_why's
        # prompt rather than anything upstream.
        logger.info(
            "Portfolio alerts WHY diagnostic — %s (%+.2f%%): finnhub_news=%d, "
            "perplexity_context_len=%d, perplexity_preview=%r, finnhub_headlines=%r -> result=%r",
            ticker, pct, len(news), len(web_context), web_context[:500],
            [n.get("headline", n) if isinstance(n, dict) else n for n in news][:5], why,
        )
    return {"why": why, "finnhub_news": news, "perplexity_context": web_context}


async def job_portfolio_alerts():
    """Every 30 min weekday market hours — push price movers (≥2%) for portfolio + watchlist.
    All users (no premium gate). Batch-fetches all tickers once, fans out per user.
    Each ticker deduplicates per-user per-day via dedup key price_mover_{ticker}."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    import random

    db = get_supabase()
    try:
        # 1. Discover all eligible users: anyone with a push token OR watchlist/portfolio data.
        # Don't gate on notification_preferences — users who never opened settings still deserve alerts.
        # Pull explicit prefs where they exist; default everything to ON for users without a prefs row.
        prefs_res = await run_query(
            db.table("notification_preferences")
            .select("user_id,push_portfolio_alerts,push_watchlist_alerts")
        )
        explicit_prefs: dict[str, dict] = {p["user_id"]: p for p in (prefs_res.data or [])}

        # All users who have any push channel (Expo mobile OR web push browser)
        token_res = await run_query(
            db.table("user_profiles").select("user_id,push_token").neq("push_token", "").not_.is_("push_token", "null")
        )
        expo_uids_pa: set[str] = {r["user_id"] for r in (token_res.data or [])} if token_res.data else set()
        web_res_pa = await run_query(db.table("web_push_subscriptions").select("user_id"))
        web_uids_pa: set[str] = {r["user_id"] for r in (web_res_pa.data or [])}
        token_uids: set[str] = expo_uids_pa | web_uids_pa

        # All users who have watchlist entries
        watch_uid_res = await run_query(db.table("watchlist").select("user_id"))
        watch_uids: set[str] = {r["user_id"] for r in (watch_uid_res.data or [])}

        # All users who have portfolio data
        port_uid_res = await run_query(db.table("user_portfolio").select("user_id"))
        port_uids: set[str] = {r["user_id"] for r in (port_uid_res.data or [])}

        # Union: every user who has something to alert on and a way to receive it
        all_candidate_uids = token_uids & (watch_uids | port_uids)
        # Also include users from explicit prefs even without a token (they may have web push sub)
        all_candidate_uids |= set(explicit_prefs.keys()) & (watch_uids | port_uids)

        if not all_candidate_uids:
            return

        def _wants_portfolio(uid: str) -> bool:
            return explicit_prefs.get(uid, {}).get("push_portfolio_alerts", True)

        def _wants_watchlist(uid: str) -> bool:
            return explicit_prefs.get(uid, {}).get("push_watchlist_alerts", True)

        # 2. Collect tickers + position details per user (portfolio + watchlist)
        user_tickers: dict[str, dict] = {}  # uid → {"port": {ticker: {shares, avg_cost}}, "watch": set}
        all_tickers: set[str] = set()

        for uid in all_candidate_uids:
            port_positions: dict[str, dict] = {}
            watch_set:  set[str] = set()

            if _wants_portfolio(uid) and uid in port_uids:
                port_res = await run_query(
                    db.table("user_portfolio").select("positions").eq("user_id", uid)
                )
                if port_res.data:
                    pos = _agg_positions(port_res.data or [])
                    port_positions = {
                        p["ticker"]: {
                            "shares": float(p.get("shares") or 0),
                            "avg_cost": float(
                                p.get("avg_cost") or p.get("avg_price") or p.get("avgPrice") or 0
                            ),
                        }
                        for p in pos if p.get("ticker")
                    }

            if _wants_watchlist(uid) and uid in watch_uids:
                watch_res = await run_query(
                    db.table("watchlist").select("ticker").eq("user_id", uid)
                )
                watch_set = {r["ticker"] for r in (watch_res.data or [])} - set(port_positions.keys())

            if port_positions or watch_set:
                user_tickers[uid] = {"port": port_positions, "watch": watch_set}
                all_tickers |= set(port_positions.keys()) | watch_set

        if not all_tickers:
            return

        # 3. Fetch intraday prices via Nasdaq API (real-time, no API key, works from cloud IPs).
        #    Primary: api.nasdaq.com/api/quote/{sym}/info — returns lastSalePrice + netChange.
        #    prev = curr - netChange (official previous close equivalent).
        #    Fallback: yfinance download for any tickers the Nasdaq API doesn't cover.
        def _fetch_prices_for_alerts(tickers_list: list[str]) -> dict[str, dict]:
            import requests
            import time

            result: dict[str, dict] = {}
            tickers_clean = list(set(tickers_list))
            if not tickers_clean:
                return result

            HEADERS = {
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                ),
                "Accept": "application/json",
                "Accept-Language": "en-US,en;q=0.9",
            }

            for sym in tickers_clean:
                for assetclass in ("stocks", "etf"):
                    try:
                        r = requests.get(
                            f"https://api.nasdaq.com/api/quote/{sym}/info",
                            params={"assetclass": assetclass},
                            headers=HEADERS,
                            timeout=8,
                        )
                        if r.status_code != 200:
                            continue
                        d    = r.json()["data"]["primaryData"]
                        curr = float(d["lastSalePrice"].replace("$", "").replace(",", ""))
                        net  = float(d["netChange"].replace("+", "").replace(",", ""))
                        prev = curr - net
                        if curr > 0 and prev > 0:
                            result[sym] = {"curr": curr, "prev": prev}
                        break  # got data — stop trying asset classes
                    except Exception:
                        pass
                time.sleep(0.15)  # respectful rate limit

            # Finnhub fallback for tickers Nasdaq API missed (e.g. BRK-B, ETFs)
            missing = [t for t in tickers_clean if t not in result]
            if missing:
                try:
                    from app.core.finnhub import fh_quote as _fh_q
                    for t in missing:
                        try:
                            q = _fh_q(t)
                            if q and q.get("price") and q.get("prev_close"):
                                result[t] = {"prev": q["prev_close"], "curr": q["price"]}
                        except Exception:
                            pass
                except Exception as e:
                    logger.warning("Finnhub fallback: %s", e)

            return result

        prices = await asyncio.to_thread(_fetch_prices_for_alerts, list(all_tickers))
        logger.info("Portfolio alerts: fetched %d/%d tickers", len(prices), len(all_tickers))
        if not prices:
            logger.warning("Portfolio alerts: price fetch returned empty")
            return

        # 4. Filter tickers that moved ≥3.70% vs yesterday's close
        movers: dict[str, float] = {}
        for ticker, px in prices.items():
            pct = round((px["curr"] - px["prev"]) / px["prev"] * 100, 2)
            if abs(pct) >= 3.70:
                movers[ticker] = pct

        logger.info("Portfolio alerts: %d movers ≥3.70%%: %s",
                    len(movers), {t: f"{p:+.1f}%" for t, p in movers.items()})
        if not movers:
            return

        # 5. Pre-generate WHY explanations — 1 Claude call per mover, reused across users.
        # Tickers with no specific catalyst are stored as NO_CATALYST and skipped for premium users;
        # free users still get a plain price-move notification without the WHY.
        #
        # This job runs every 5 min for ~6.5 market hours (~78 runs/day). A ticker that
        # stays a mover for hours used to pay for a fresh Perplexity search + 2 Haiku
        # calls (WHY + EN translation) on EVERY one of those runs, even though the
        # answer barely changes and the push itself only ever fires once per user per
        # day (should_send_price_alert below). Caching per ticker per ET trading day
        # cuts that to exactly 1 generation per ticker per day, no matter how long it
        # stays elevated or how many users hold it.
        from app.core.cache import cache_get, cache_set
        from app.services.notification_engine import _today_et
        from app.services.price_alert_service import NO_CATALYST, should_send_price_alert, translate_why_to_english
        ticker_why:    dict[str, str] = {}
        ticker_why_en: dict[str, str] = {}
        ticker_title:  dict[str, str] = {}
        today_et = _today_et()
        for ticker, pct in movers.items():
            ticker_title[ticker] = await asyncio.to_thread(_company_name, ticker)

            cache_key = f"price_why:{ticker}:{today_et}"
            cached = cache_get(cache_key)
            if cached:
                ticker_why[ticker] = cached["why"]
                if cached.get("why_en"):
                    ticker_why_en[ticker] = cached["why_en"]
                continue

            price = prices[ticker]["curr"]
            why = (await get_price_alert_why_with_diagnostics(ticker, pct, price))["why"]
            ticker_why[ticker] = why
            why_en = None
            if why == NO_CATALYST:
                logger.info("Portfolio alerts: no catalyst for %s — premium users will not receive this", ticker)
            else:
                why_en = await translate_why_to_english(why)
                ticker_why_en[ticker] = why_en
            # TTL well past market close but short of the next trading day, so a
            # stale answer never survives to bias tomorrow's re-generation.
            cache_set(cache_key, {"why": why, "why_en": why_en}, ttl=12 * 3600)
            await asyncio.sleep(0.05)

        # 6. Batch-fetch user profiles (name + tier + trial + language) once
        all_uids  = list(user_tickers.keys())
        prof_res  = await run_query(
            db.table("user_profiles")
            .select("user_id,name,subscription_tier,trial_started_at,preferred_language")
            .in_("user_id", all_uids)
        )
        user_meta: dict[str, dict] = {
            r["user_id"]: {
                "is_premium": _is_premium_user(r.get("subscription_tier", "free"), r.get("trial_started_at")),
                "language": r.get("preferred_language") or "es",
            }
            for r in (prof_res.data or [])
        }

        # 7. Fan out — portfolio vs watchlist distinction + premium vs free
        sent = 0
        for uid, sets in user_tickers.items():
            meta      = user_meta.get(uid, {"is_premium": False, "language": "es"})
            is_prem   = meta["is_premium"]
            is_en     = meta.get("language", "es") == "en"
            port_map  = sets["port"]
            # Portfolio tickers ranked first (user owns them — higher priority)
            port_movers  = sorted(set(port_map.keys()) & movers.keys(),
                                  key=lambda t: abs(movers[t]), reverse=True)
            watch_movers = sorted(sets["watch"] & movers.keys(),
                                  key=lambda t: abs(movers[t]), reverse=True)
            ranked = port_movers + watch_movers

            for ticker in ranked:
                pct          = movers[ticker]
                price        = prices[ticker]["curr"]
                title        = ticker_title[ticker]
                is_portfolio = ticker in port_map
                screen       = "portfolio" if is_portfolio else "watchlist"

                why = ticker_why_en[ticker] if (is_en and ticker in ticker_why_en) else ticker_why[ticker]
                emoji = _move_emoji(ticker, pct)
                verb = ("rose" if is_en else "subió") if pct >= 0 else ("fell" if is_en else "bajó")
                # Title carries the company name ("Micron Technology"); the body
                # leads with the ticker instead — "MU subió +4.78%" — since the
                # user reads tickers faster than full names once already looking
                # at a specific stock's alert. Always 2 decimals for precision.
                prefix = f"{emoji} {ticker} {verb} {pct:+.2f}%"
                push_category = f"price_mover_{ticker}"

                # Hard cap of one push per ticker per user per day — applies to
                # free AND premium alike (this used to only gate premium users,
                # so free users got re-pinged on every 5-min cycle a ticker
                # stayed a mover, and premium users could still get a second
                # "here's why" correction later the same day).
                if not await should_send_price_alert(uid, ticker, db):
                    continue

                if is_prem:
                    if why == NO_CATALYST:
                        body = (
                            f"{prefix} — no clear catalyst, possible market volatility."
                            if is_en else
                            f"{prefix} — sin catalizador claro, posible volatilidad de mercado."
                        )
                    else:
                        body = f"{prefix} {why}."
                else:
                    # Free tier — plain price alert, no WHY
                    body = (
                        f"{prefix}. Activate Premium to see why."
                        if is_en else
                        f"{prefix}. Activa Premium para ver por qué."
                    )

                await send_push(
                    uid,
                    push_category,
                    title, body,
                    {"ticker": ticker, "change_pct": pct, "price": price, "screen": screen},
                    db,
                )
                sent += 1
                await asyncio.sleep(random.uniform(0.05, 0.2))

        logger.info("Portfolio alerts: %d movers, %d pushes sent", len(movers), sent)
    except Exception as e:
        logger.error("job_portfolio_alerts failed: %s", e)


async def job_weekly_screener_push():
    """11:00 AM ET Saturday — personalized weekly screener: 4 picks per user based on
    risk profile, investment horizon, mentor, and existing portfolio (excluded).
    Strategy: 1 Haiku call per risk group (~6 total) → cheap regardless of user count.
    Sends both push notification and email."""
    import anthropic
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    from app.services.email_service import send_email
    from app.core.config import settings as cfg

    db = get_supabase()
    try:
        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("push_ai_recommendations", True)
        )
        pref_uids = {u["user_id"] for u in (prefs_res.data or [])}
        if not pref_uids:
            return

        # Premium-only
        profiles_res = await run_query(
            db.table("user_profiles")
            .select("user_id,name,risk_tolerance,quiz_answers,mentor,subscription_tier,preferred_language")
            .in_("user_id", list(pref_uids))
        )
        uids = [r["user_id"] for r in (profiles_res.data or []) if r.get("subscription_tier") == "premium"]
        if not uids:
            return

        auth_users = {u.id: u.email for u in await asyncio.to_thread(lambda: db.auth.admin.list_users())}
        profile_map = {r["user_id"]: r for r in (profiles_res.data or []) if r["user_id"] in set(uids)}

        portfolio_map: dict[str, set] = {}
        for uid in uids:
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if port_res.data:
                pos = _agg_positions(port_res.data or [])
                portfolio_map[uid] = {p["ticker"] for p in pos if p.get("ticker")}

        RISK_LABELS = {
            "conservative": "conservador", "conservative_moderate": "conservador-moderado",
            "moderate": "moderado", "moderate_growth": "moderado con enfoque en crecimiento",
            "growth": "de crecimiento", "aggressive": "agresivo",
            "aggressive_speculative": "agresivo-especulativo", "speculative": "especulativo",
        }
        RISK_LABELS_EN = {
            "conservative": "conservative", "conservative_moderate": "conservative-moderate",
            "moderate": "moderate", "moderate_growth": "moderate with a growth focus",
            "growth": "growth-oriented", "aggressive": "aggressive",
            "aggressive_speculative": "aggressive-speculative", "speculative": "speculative",
        }
        HORIZON_MAP = {"A": "corto plazo", "B": "mediano plazo", "C": "largo plazo", "D": "muy largo plazo"}
        HORIZON_MAP_EN = {"A": "short term", "B": "medium term", "C": "long term", "D": "very long term"}

        RISK_UNIVERSES = {
            "conservative":           "BRK-B, KO, PG, JNJ, O, NEE, WMT, PEP, V, MA, ABT, MCD, CVX, T, VZ",
            "conservative_moderate":  "BRK-B, MSFT, AAPL, V, COST, UNH, ABT, KO, GOOGL, HD, LOW, JPM, PG, TGT",
            "moderate":               "MSFT, GOOGL, AMZN, V, UNH, COST, NVDA, META, AAPL, JPM, MA, ADBE, CRM, NOW",
            "moderate_growth":        "NVDA, META, AMZN, NOW, DDOG, NET, SHOP, PLTR, ABNB, UBER, SNOW, ZS, MDB",
            "growth":                 "NVDA, META, DDOG, NET, SHOP, PLTR, APP, DUOL, CELH, HIMS, RDDT, IOT, TTD",
            "aggressive":             "PLTR, APP, SMCI, AFRM, SOFI, HIMS, CELH, RDDT, RKLB, BE, MELI, NU, DLO, GLOB",
            "aggressive_speculative": "BE, PLUG, IONQ, RKLB, JOBY, RXRX, BEAM, UPST, MSTR, AI, SNDK, SOUN, BBAI",
            "speculative":            "IONQ, RGTI, JOBY, ACHR, RKLB, RXRX, BEAM, NTLA, MARA, BBAI, LUNR, RDW, ASTS",
        }

        # Pre-generate 8 picks per risk group — 1 Haiku call per group, reused across all users of that group
        client = anthropic.Anthropic(api_key=cfg.anthropic_api_key)
        picks_by_risk: dict[str, list[dict]] = {}

        risk_groups: dict[str, list] = {}
        for uid in uids:
            r = (profile_map.get(uid) or {}).get("risk_tolerance") or "moderate"
            risk_groups.setdefault(r, []).append(uid)

        for risk, group_uids in risk_groups.items():
            universe = RISK_UNIVERSES.get(risk, RISK_UNIVERSES["moderate"])
            try:
                resp = await asyncio.to_thread(
                    lambda r=risk, u=universe: client.messages.create(
                        model="claude-haiku-4-5-20251001",
                        max_tokens=280,
                        messages=[{"role": "user", "content": (
                            f"Eres un screener de inversiones. Perfil del inversor: {r}.\n"
                            f"Universo de acciones candidatas: {u}\n\n"
                            "Elige exactamente 8 acciones para que este inversor investigue esta semana. "
                            "Considera el contexto actual de mercado y elige las más relevantes para este perfil.\n"
                            "Responde SOLO con este formato JSON, sin texto adicional:\n"
                            '[{"ticker":"XX","name":"Nombre completo"},{"ticker":"XX","name":"Nombre completo"},...]'
                        )}],
                    )
                )
                in_tok = getattr(resp.usage, "input_tokens", 0)
                out_tok = getattr(resp.usage, "output_tokens", 0)
                logger.info("LLM screener(risk=%s): in=%d out=%d cost=$%.5f", risk, in_tok, out_tok,
                            in_tok / 1e6 * 0.80 + out_tok / 1e6 * 4.0)
                from app.services.llm_usage import log_llm_usage
                asyncio.create_task(log_llm_usage(None, "job_weekly_screener_push", "claude-haiku-4-5-20251001", resp.usage))
                raw = resp.content[0].text.strip() if resp.content else "[]"
                import json as _json
                parsed = _json.loads(raw)
                if isinstance(parsed, list):
                    picks_by_risk[risk] = parsed[:8]
            except Exception as e:
                logger.warning("Weekly screener Haiku call failed for risk=%s: %s", risk, e)
                picks_by_risk[risk] = []

        sent = 0
        for i, uid in enumerate(uids):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.1))

            p       = profile_map.get(uid) or {}
            name    = (p.get("name") or "Inversor").split()[0]
            risk    = p.get("risk_tolerance") or "moderate"
            quiz    = (p.get("quiz_answers") or {})
            is_en   = (p.get("preferred_language") or "es") == "en"
            horizon = (HORIZON_MAP_EN if is_en else HORIZON_MAP).get(str(quiz.get("q2", "")), "long term" if is_en else "largo plazo")
            risk_label = (RISK_LABELS_EN if is_en else RISK_LABELS).get(risk, "moderate" if is_en else "moderado")
            owned   = portfolio_map.get(uid, set())

            all_picks = picks_by_risk.get(risk, [])
            # Exclude tickers the user already owns
            picks = [pk for pk in all_picks if pk.get("ticker") not in owned][:4]

            if len(picks) < 2:
                continue  # not enough picks after exclusions — skip silently

            lines = "\n".join(f"{idx+1}. {pk['ticker']} ({pk['name']})" for idx, pk in enumerate(picks))
            if is_en:
                body = (
                    f"Hi {name}! Based on your {risk_label} profile and {horizon} mindset "
                    f"here are some positions worth a look this week:\n\n"
                    f"{lines}\n\n"
                    f"Talk to your mentor to analyze them! 💬"
                )
                push_title = "📊 Your 4 ideas for this week"
            else:
                body = (
                    f"¡Hola {name}! Basado en tu perfil {risk_label} y mentalidad de {horizon} "
                    f"quiero sugerirte algunas posiciones que deberías echarles un ojo:\n\n"
                    f"{lines}\n\n"
                    f"¡Habla con tu mentor para analizarlas! 💬"
                )
                push_title = "📊 Tus 4 ideas para esta semana"

            await send_push(
                uid, "weekly_screener",
                push_title,
                body,
                {"screen": "chat", "picks": [pk["ticker"] for pk in picks]},
                db,
            )

            # Email
            email_addr = auth_users.get(uid)
            if email_addr:
                pick_rows = "".join(
                    f'<div style="display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid #1e2235">'
                    f'<span style="background:#00d47e22;color:#00d47e;font-size:13px;font-weight:900;width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0">{idx+1}</span>'
                    f'<div><span style="color:#fff;font-size:16px;font-weight:800">{pk["ticker"]}</span>'
                    f'<span style="color:#6b7280;font-size:13px;margin-left:8px">{pk["name"]}</span></div>'
                    f'</div>'
                    for idx, pk in enumerate(picks)
                )
                if is_en:
                    html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nuvos AI</title></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
  <div style="border-radius:20px;overflow:hidden;border:1px solid #2a2d3a">
    <div style="background:linear-gradient(135deg,#0d1f14,#0f2a1a);padding:28px 32px;text-align:center;border-bottom:1px solid #1e3a28">
      <img src="https://www.nuvosai.com/logo.png" alt="Nuvos AI" width="48" height="48" style="display:block;margin:0 auto 10px;border-radius:12px"/>
      <p style="margin:0;color:#00d47e;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase">Nuvos AI · Weekly Screener</p>
    </div>
    <div style="background:#161b27;padding:28px 32px">
      <h1 style="color:#fff;font-size:20px;font-weight:900;margin:0 0 4px;letter-spacing:-0.3px">Your 4 ideas for this week 📊</h1>
      <p style="color:#6b7280;font-size:13px;margin:0 0 20px">Selected for your <strong style="color:#d1d5db">{risk_label}</strong> profile — {horizon} outlook</p>
      <div style="background:#111318;border:1px solid #2a2d3a;border-radius:14px;padding:8px 16px;margin-bottom:20px">
        {pick_rows}
      </div>
      <div style="background:#111318;border:1px solid rgba(0,212,126,0.2);border-radius:14px;padding:18px;margin-bottom:20px">
        <p style="color:#d1d5db;font-size:13px;line-height:1.7;margin:0">💬 <strong style="color:#00d47e">What do I do with these ideas?</strong> Talk to your AI Mentor to analyze them: do they fit your portfolio? what's the real risk? when's a good entry point?</p>
      </div>
      <div style="text-align:center;margin-bottom:20px">
        <a href="https://nuvosai.com/chat" style="display:inline-block;background:#00d47e;color:#000;font-weight:900;font-size:14px;padding:13px 28px;border-radius:12px;text-decoration:none">Talk to my mentor →</a>
      </div>
      <div style="border-top:1px solid #2a2d3a;padding-top:16px;text-align:center">
        <p style="color:#00a85e;font-size:12px;font-weight:700;margin:0 0 4px">With Nuvos, invest without fear.</p>
        <p style="color:#374151;font-size:11px;margin:0">Nuvos AI · For educational purposes only. Not professional financial advice.</p>
      </div>
    </div>
  </div>
</div>
</body></html>"""
                else:
                    html = f"""<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nuvos AI</title></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
  <div style="border-radius:20px;overflow:hidden;border:1px solid #2a2d3a">
    <div style="background:linear-gradient(135deg,#0d1f14,#0f2a1a);padding:28px 32px;text-align:center;border-bottom:1px solid #1e3a28">
      <img src="https://www.nuvosai.com/logo.png" alt="Nuvos AI" width="48" height="48" style="display:block;margin:0 auto 10px;border-radius:12px"/>
      <p style="margin:0;color:#00d47e;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase">Nuvos AI · Screener Semanal</p>
    </div>
    <div style="background:#161b27;padding:28px 32px">
      <h1 style="color:#fff;font-size:20px;font-weight:900;margin:0 0 4px;letter-spacing:-0.3px">Tus 4 ideas para esta semana 📊</h1>
      <p style="color:#6b7280;font-size:13px;margin:0 0 20px">Seleccionadas para tu perfil <strong style="color:#d1d5db">{risk_label}</strong> — visión de {horizon}</p>
      <div style="background:#111318;border:1px solid #2a2d3a;border-radius:14px;padding:8px 16px;margin-bottom:20px">
        {pick_rows}
      </div>
      <div style="background:#111318;border:1px solid rgba(0,212,126,0.2);border-radius:14px;padding:18px;margin-bottom:20px">
        <p style="color:#d1d5db;font-size:13px;line-height:1.7;margin:0">💬 <strong style="color:#00d47e">¿Qué hago con estas ideas?</strong> Habla con tu mentor IA para analizarlas: ¿encajan en tu portafolio? ¿cuál es el riesgo real? ¿cuándo conviene entrar?</p>
      </div>
      <div style="text-align:center;margin-bottom:20px">
        <a href="https://nuvosai.com/chat" style="display:inline-block;background:#00d47e;color:#000;font-weight:900;font-size:14px;padding:13px 28px;border-radius:12px;text-decoration:none">Hablar con mi mentor →</a>
      </div>
      <div style="border-top:1px solid #2a2d3a;padding-top:16px;text-align:center">
        <p style="color:#00a85e;font-size:12px;font-weight:700;margin:0 0 4px">Con Nuvos, invierte sin miedo.</p>
        <p style="color:#374151;font-size:11px;margin:0">Nuvos AI · Solo educativo. No constituye asesoramiento financiero profesional.</p>
      </div>
    </div>
  </div>
</div>
</body></html>"""
                subject = "📊 Your 4 investment ideas for this week — Nuvos AI" if is_en else "📊 Tus 4 ideas de inversión para esta semana — Nuvos AI"
                try:
                    await send_email(email_addr, subject, html)
                except Exception as e:
                    logger.warning("Weekly screener email failed for %s: %s", uid, e)

            sent += 1

        logger.info("Weekly screener push+email: %d sent across %d risk groups", sent, len(picks_by_risk))
    except Exception as e:
        logger.error("job_weekly_screener_push failed: %s", e)


async def job_refresh_undervalued_screener():
    """12:05 PM ET Sunday — precomputes the real DCF-backed "Oportunidades"
    (Top Opportunities) screener across the curated ticker universe,
    rotating which 5 candidates are featured first this week (see
    undervalued_screener_service._rotate_featured_order — the same real
    candidates, just a different 5 up front so it doesn't look identical
    week after week), then pushes a "this week's picks just updated" notice
    to premium users so they come back and see the new featured picks."""
    from app.services.undervalued_screener_service import refresh_undervalued_screener
    try:
        await refresh_undervalued_screener()
    except Exception as e:
        logger.error("job_refresh_undervalued_screener failed: %s", e)
        return

    try:
        await _notify_undervalued_screener_updated()
    except Exception as e:
        logger.error("job_refresh_undervalued_screener: notification failed: %s", e)


async def _notify_undervalued_screener_updated():
    """Generic (not personalized) push to premium users that this week's
    featured Oportunidades picks just rotated — Oportunidades is
    premium-gated, so free users wouldn't be able to open it anyway.
    Deliberately separate from job_weekly_screener_push (Saturday's
    per-risk-profile personalized picks) — this is just "come see what's
    new," no per-user LLM call needed."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push

    db = get_supabase()
    profiles_res = await run_query(
        db.table("user_profiles").select("user_id,subscription_tier,trial_started_at,preferred_language,push_token")
    )
    web_res = await run_query(db.table("web_push_subscriptions").select("user_id"))
    web_uids = {r["user_id"] for r in (web_res.data or [])}

    sent = 0
    for r in (profiles_res.data or []):
        uid = r["user_id"]
        if not _is_premium_user(r.get("subscription_tier") or "free", r.get("trial_started_at")):
            continue
        token = r.get("push_token") or ""
        has_push = token.startswith("ExponentPushToken") or uid in web_uids
        if not has_push:
            continue
        is_en = (r.get("preferred_language") or "es") == "en"
        title = "🔄 Opportunities updated" if is_en else "🔄 Oportunidades actualizada"
        body = (
            "This week's 5 featured stocks just rotated — come see the new picks."
            if is_en else
            "Las 5 acciones destacadas de esta semana rotaron — ven a ver las nuevas."
        )
        await send_push(uid, "undervalued_screener_weekly", title, body, {"screen": "subvaluadas"}, db)
        sent += 1
        await asyncio.sleep(random.uniform(0, 0.05))
    logger.info("job_refresh_undervalued_screener: notified %d premium users of the weekly rotation", sent)


def _fetch_historical_earnings_reactions(ticker: str) -> dict:
    """Compute avg stock reaction (%) the day after each of the last 4 earnings reports.
    Uses Finnhub /stock/earnings for EPS surprises and /stock/candle for price reactions.
    Returns {beat_avg, miss_avg, n_beats, n_misses} or empty dict on failure."""
    try:
        import time as _time
        from app.core.finnhub import fh_candles
        import requests as _req

        key = os.getenv("FINNHUB_API_KEY", "")
        if not key:
            return {}

        # Fetch EPS earnings history from Finnhub
        r = _req.get(
            "https://finnhub.io/api/v1/stock/earnings",
            params={"symbol": ticker, "token": key},
            timeout=8,
        )
        if r.status_code != 200:
            return {}
        earnings_list = r.json()
        if not earnings_list or not isinstance(earnings_list, list):
            return {}

        # Fetch 2 years of daily candles
        now_ts  = int(_time.time())
        from_ts = now_ts - 2 * 365 * 86400
        candles = fh_candles(ticker, "D", from_ts, now_ts)
        if not candles or len(candles) < 5:
            return {}

        # Build a timestamp → close dict for binary search
        ts_list = [c["t"] for c in candles]
        c_list  = [c["c"] for c in candles]

        def _find_closest_idx(target_ts: int) -> int:
            """Return index of candle closest to target_ts (but not after it)."""
            lo, hi = 0, len(ts_list) - 1
            while lo < hi:
                mid = (lo + hi + 1) // 2
                if ts_list[mid] <= target_ts:
                    lo = mid
                else:
                    hi = mid - 1
            return lo

        beats, misses = [], []
        for e in earnings_list[:8]:
            try:
                surprise = e.get("surprisePercent")
                period   = e.get("period", "")  # "2024-03-31"
                if surprise is None or not period:
                    continue
                # Convert period to unix timestamp (approximate — end of quarter)
                from datetime import datetime, timezone
                report_dt = datetime.strptime(period, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                report_ts = int(report_dt.timestamp())

                idx = _find_closest_idx(report_ts)
                # prev_close = candle before earnings date, next_close = candle after
                if idx < 1 or idx + 1 >= len(ts_list):
                    continue
                prev_close = float(c_list[idx - 1])
                next_close = float(c_list[min(idx + 1, len(c_list) - 1)])
                if prev_close == 0:
                    continue
                reaction = round((next_close - prev_close) / prev_close * 100, 1)
                if float(surprise) >= 0:
                    beats.append(reaction)
                else:
                    misses.append(reaction)
            except Exception:
                continue

        return {
            "beat_avg":  round(sum(beats)  / len(beats),  1) if beats  else None,
            "miss_avg":  round(sum(misses) / len(misses), 1) if misses else None,
            "n_beats":   len(beats),
            "n_misses":  len(misses),
        }
    except Exception:
        return {}


async def _generate_earnings_push(
    ticker: str,
    company: str,
    when: str,                   # "hoy" | "mañana"
    eps_estimate: float | None,
    eps_range: str | None,
    revenue_estimate: str | None,
    reactions: dict,             # from _fetch_historical_earnings_reactions
    shares: float,
    position_value: float,
    avg_cost: float | None,
    language: str = "es",
) -> tuple[str, str]:
    """Call Claude to generate a deeply personalized earnings push with dollar scenarios.
    Falls back to a static template if Claude fails or times out."""
    import anthropic

    beat_avg = reactions.get("beat_avg")
    miss_avg = reactions.get("miss_avg")
    n_total  = reactions.get("n_beats", 0) + reactions.get("n_misses", 0)

    # Calculate exact dollar scenarios for user's position
    beat_value = round(position_value * (1 + beat_avg / 100), 2) if beat_avg is not None and position_value else None
    miss_value = round(position_value * (1 + miss_avg / 100), 2) if miss_avg is not None and position_value else None

    # Current P&L from cost basis
    curr_price = position_value / shares if shares and position_value else None
    pnl_pct = round((curr_price - avg_cost) / avg_cost * 100, 1) if curr_price and avg_cost else None

    scenarios_str = ""
    def _scenario_verb(pct):
        return "subiría" if pct and pct > 0 else "caería" if pct and pct < 0 else "quedaría igual"

    if beat_value and miss_value and position_value:
        scenarios_str = (
            f"Si supera estimados (históricamente {'+' if beat_avg > 0 else ''}{beat_avg}% en {n_total} reportes): "
            f"tu posición de ${position_value:,.2f} {_scenario_verb(beat_avg)} a ${beat_value:,.2f}. "
            f"Si decepciona (históricamente {miss_avg}%): {_scenario_verb(miss_avg)} a ${miss_value:,.2f}."
        )
    elif beat_value and position_value:
        scenarios_str = (
            f"Históricamente siempre ha superado estimados ({n_total} reportes), "
            f"con reacción promedio de {'+' if beat_avg > 0 else ''}{beat_avg}%. "
            f"Basado en eso, tu posición de ${position_value:,.2f} {_scenario_verb(beat_avg)} a ${beat_value:,.2f}. "
            f"Importante: la reacción varía mucho — puede subir o bajar aunque bata."
        )
    elif miss_value and position_value:
        scenarios_str = f"Si decepciona: tu posición de ${position_value:,.2f} {_scenario_verb(miss_avg)} a ${miss_value:,.2f} ({miss_avg}%)."

    eps_str = f"${eps_estimate:.2f}" if eps_estimate else "no disponible"
    pnl_str = f"Actualmente {'ganando' if (pnl_pct or 0) >= 0 else 'perdiendo'} {abs(pnl_pct):.1f}% desde tu entrada." if pnl_pct is not None else ""

    has_position = shares > 0 and position_value > 0
    is_en = language == "en"

    if has_position:
        shares_disp = f"{shares:.4f}".rstrip("0").rstrip(".") if shares < 1 else f"{shares:.2f}".rstrip("0").rstrip(".")
        if is_en:
            prompt = f"""You are the Nuvos AI assistant. Write the body of a push notification in English for an investor holding {shares_disp} shares of {company} ({ticker}) worth ${position_value:,.2f}.

DATA:
- Current position: ${position_value:,.2f} | {pnl_str}
- Reports {when} | EPS estimate: {eps_str}
- {scenarios_str}

REQUIRED FORMAT:
"{company} ({ticker}) reports {when}. EPS: {eps_str}. {"If it beats: your position rises to $" + f"{beat_value:,.0f}" + f" (+{beat_avg}%)" if beat_value else ""}{"." if beat_value else ""} {"If it misses: drops to $" + f"{miss_value:,.0f}" + f" ({miss_avg}%)" if miss_value else ""}."

RULES:
- Mention the company and ticker
- Include EPS estimate and dollar scenarios if available
- Clear English, max 250 characters, no emojis, don't mention Nuvos AI
- Text only"""
        else:
            prompt = f"""Eres el asistente de Nuvos AI. Escribe el body de una notificación push en español para un inversor que tiene {shares_disp} acciones de {company} ({ticker}) valoradas en ${position_value:,.2f}.

DATOS:
- Posición actual: ${position_value:,.2f} | {pnl_str}
- Reporta {when} | EPS estimado: {eps_str}
- {scenarios_str}

FORMATO REQUERIDO:
"{company} ({ticker}) reporta {when}. EPS: {eps_str}. {"Si supera: tu posición sube a $" + f"{beat_value:,.0f}" + f" (+{beat_avg}%)" if beat_value else ""}{"." if beat_value else ""} {"Si decepciona: baja a $" + f"{miss_value:,.0f}" + f" ({miss_avg}%)" if miss_value else ""}."

REGLAS:
- Menciona la empresa y el ticker
- Incluye EPS estimado y escenarios en dólares si están disponibles
- Español claro, máximo 250 caracteres, sin emojis, sin mencionar Nuvos AI
- Solo el texto"""
    else:
        if is_en:
            prompt = f"""You are the Nuvos AI assistant. Write the body of a push notification in English for an investor following {company} ({ticker}) on their watchlist.

DATA:
- Reports {when} | EPS estimate: {eps_str}
- Historical reaction: {f"average beat {beat_avg:+.1f}% across {n_total} reports" if beat_avg is not None else "limited data"}

RULES:
- Mention the company, ticker, and when it reports
- Include EPS estimate
- Briefly mention historical reaction if data is available
- Clear English, max 200 characters, no emojis, don't mention Nuvos AI
- Text only"""
        else:
            prompt = f"""Eres el asistente de Nuvos AI. Escribe el body de una notificación push en español para un inversor que sigue {company} ({ticker}) en su watchlist.

DATOS:
- Reporta {when} | EPS estimado: {eps_str}
- Reacción histórica: {f"beat promedio {beat_avg:+.1f}% en {n_total} reportes" if beat_avg is not None else "datos limitados"}

REGLAS:
- Menciona la empresa, el ticker y cuándo reporta
- Incluye EPS estimado
- Menciona brevemente qué suele pasar históricamente si hay datos
- Español claro, máximo 200 caracteres, sin emojis, sin mencionar Nuvos AI
- Solo el texto"""

    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        resp   = await asyncio.wait_for(
            client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=200,
                messages=[{"role": "user", "content": prompt}],
            ),
            timeout=8.0,
        )
        in_tok = getattr(resp.usage, "input_tokens", 0)
        out_tok = getattr(resp.usage, "output_tokens", 0)
        logger.info("LLM earnings_push: in=%d out=%d cost=$%.5f", in_tok, out_tok,
                    in_tok / 1e6 * 0.80 + out_tok / 1e6 * 4.0)
        from app.services.llm_usage import log_llm_usage
        asyncio.create_task(log_llm_usage(None, "job_events_alerts_earnings_push", "claude-haiku-4-5-20251001", resp.usage))
        body = resp.content[0].text.strip().strip('"').strip("'")
        if len(body) > 280:
            body = body[:277] + "..."
    except Exception as e:
        logger.warning("Claude earnings push failed for %s: %s — using fallback", ticker, e)
        # Fallback: static but still with dollar scenarios
        eps_part  = f" EPS est. {eps_str}." if eps_estimate else ""
        beat_part = f" Beat: ${beat_value:,.0f} (+{beat_avg}%)." if beat_value else ""
        miss_part = f" Miss: ${miss_value:,.0f} ({miss_avg}%)." if miss_value else ""
        reports_word = "reports" if is_en else "reporta"
        body = f"{company} ({ticker}) {reports_word} {when}.{eps_part}{beat_part}{miss_part}"
        if len(body) > 280:
            body = body[:277] + "..."

    title = f"📊 {ticker} reports {when}" if is_en else f"📊 {ticker} reporta {when}"
    return title, body


def _fetch_ticker_news(ticker: str) -> list[str]:
    from app.services.price_alert_service import fetch_ticker_news
    return fetch_ticker_news(ticker)


_MAJOR_NEWS_DAILY_CAP = 5
_MAJOR_NEWS_LOOKBACK_DAYS = 5  # how far back "don't repeat the same ongoing story" checks
_MAJOR_NEWS_CATEGORY_EMOJI = {"geopolitics": "🌐", "macro": "📊", "corporate": "🏢", "leadership": "🎤", "global_event": "🌍"}
# 5 fixed daily windows (America/New_York) — one scheduled run per window,
# each one mandatory-delivers exactly 1 of the day's 5 alerts. Registered as
# 5 separate cron jobs (one per window start) further down in this file.
_MAJOR_NEWS_WINDOWS = [(8, 10), (11, 13), (14, 16), (17, 19), (20, 22)]


async def _curate_major_news(
    raw_search_text: str, already_sent_headlines: list[str], max_items: int,
    recent_days_headlines: list[str] | None = None,
) -> list[dict]:
    """Ask Claude to filter a broad news search down to ONLY genuinely major
    geopolitical/macro/big-corporate/leadership/global-event stories —
    explicitly excluding analyst opinions (price-target changes,
    upgrades/downgrades), which are noise for this feature even though
    they're valid "why" catalysts elsewhere in the app.

    This now runs once per fixed daily window (see _MAJOR_NEWS_WINDOWS) and
    is expected to deliver exactly 1 real item per run — it's a mandatory
    5-alerts-a-day product decision, not "alert only on truly rare huge
    news." Still never invents a story: it must pick the single best REAL,
    concrete item the search actually returned, relaxing how "major" it
    needs to be rather than fabricating one. Only returns [] if the search
    genuinely surfaced nothing usable in any of the 5 categories, which
    should be rare given how broad the search query is.

    `recent_days_headlines` (last _MAJOR_NEWS_LOOKBACK_DAYS days, not just
    today) fixes a real complaint: the same ongoing situation (e.g. an
    active geopolitical standoff) kept getting resent day after day because
    the old dedup only checked TODAY's sent headlines — an unrelated new
    headline about the same multi-day story always passed that check. Now
    Claude is explicitly told not to resend the same underlying situation
    unless something materially NEW happened (an escalation, a resolution,
    a concrete new development) — continuing tension alone doesn't count.
    Repeating the same CATEGORY, or a different real statement from the
    same or a different public figure (e.g. Bezos today, Musk tomorrow), is
    explicitly fine — only the exact underlying story must not repeat."""
    import anthropic, json as _json

    already_sent_str = (
        "\n".join(f"- {h}" for h in already_sent_headlines)
        if already_sent_headlines else "(ninguna todavía hoy)"
    )
    recent_days_str = (
        "\n".join(f"- {h}" for h in recent_days_headlines)
        if recent_days_headlines else "(sin historial reciente)"
    )

    prompt = f"""Eres un editor senior filtrando noticias para una alerta de "solo lo verdaderamente importante" — nada de ruido, y nada repetitivo.

RESULTADOS DE BÚSQUEDA WEB (fuente cruda, puede contener info irrelevante):
{raw_search_text}

NOTICIAS YA ENVIADAS HOY (no repitas ninguna de estas, aunque aparezcan en la búsqueda):
{already_sent_str}

NOTICIAS ENVIADAS EN LOS ÚLTIMOS {_MAJOR_NEWS_LOOKBACK_DAYS} DÍAS (para evitar fatiga de la misma historia — ver regla abajo):
{recent_days_str}

TU TAREA: de toda esa información, extrae ÚNICAMENTE historias que caigan en estas 5 categorías:

1. GEOPOLÍTICA Y ASUNTOS DE GOBIERNO: desarrollos políticos o de gobierno realmente significativos en CUALQUIER país (no solo potencias económicas) — conflictos, sanciones, crisis o cambios de gobierno, decisiones políticas mayores, situaciones de un país que el mundo esté siguiendo (ej. la situación del gobierno de Venezuela). No tiene que mover mercados globales directamente, pero sí ser un hecho real y de relevancia genuina — no un rumor ni un comentario político menor.
2. INDICADORES MACROECONÓMICOS: decisiones de tasas de interés (Fed u otros bancos centrales), datos de desempleo, PIB, inflación (CPI/PCE), políticas monetarias, condiciones de crédito.
3. NOTICIAS CORPORATIVAS DE GRAN IMPACTO: de empresas grandes y reconocidas (no solo las 10 más grandes del mundo por capitalización) — restricciones o decisiones regulatorias/comerciales que las afecten (ej. China negándole a Nvidia licencias de exportación de chips), expansión estratégica mayor a nuevos mercados (ej. McDonald's abriendo cientos de restaurantes en India), fusiones o adquisiciones grandes, resultados que sorprenden fuertemente, decisiones que cambien significativamente su negocio. Tiene que ser un HECHO real y concreto, no una opinión de analista ni un cambio de precio objetivo.
4. DECLARACIONES O ANUNCIOS DE LÍDERES CLAVE: solo cuando un CEO/fundador de una empresa grande y reconocida comunica algo con impacto real — un anuncio de producto mayor, un acuerdo/alianza importante, una fusión o adquisición grande, un cambio de estrategia relevante, una renuncia/salida sorpresiva. NO cuenta cualquier tweet o declaración menor sin impacto real.
5. EVENTOS GLOBALES DE GRAN RELEVANCIA CULTURAL/DEPORTIVA: resultados o hitos de eventos que el mundo entero sigue (ej. final de un Mundial u Olimpiadas, una elección presidencial mayor, un evento histórico de alcance global) — no necesitan mover mercados, pero sí ser genuinamente de interés masivo y mundial, no un evento deportivo/cultural menor o regional.

En resumen: el criterio ya NO es "¿esto mueve los mercados globales?" para todas las categorías — es "¿esto es un hecho real, concreto, y genuinamente importante que alguien bien informado querría saber hoy?". Sigue siendo un filtro estricto (nada de ruido, nada trivial), pero cubre geopolítica/gobierno, macro, empresas grandes (no solo mega-caps), líderes, y eventos globales — noticias de todo tipo, mientras sean genuinamente relevantes.

REGLA CLAVE CONTRA REPETICIÓN (esto es lo más importante hoy): si una historia de "NOTICIAS ENVIADAS EN LOS ÚLTIMOS {_MAJOR_NEWS_LOOKBACK_DAYS} DÍAS" trata sobre la MISMA situación en desarrollo (ej. la misma tensión geopolítica, el mismo conflicto, la misma negociación) y lo único que cambió es que "sigue tensa" o "continúa" sin un hecho NUEVO y CONCRETO (una escalada real, una resolución, un anuncio oficial, un cambio de postura confirmado), NO la incluyas — no repitas la misma historia solo porque sigue en las noticias.

IMPORTANTE — repetir CATEGORÍA está bien: la regla de arriba es SOLO sobre la misma historia/situación específica. Está perfectamente bien tener varias historias de la misma categoría el mismo día (ej. dos noticias de "declaraciones de líderes" — Jeff Bezos habló de algo hoy en la mañana, Elon Musk habló de otra cosa en la tarde — son dos historias distintas y ambas califican). NO descartes ni penalices una historia real solo porque ya se envió otra de la misma categoría hoy o esta semana — lo único que nunca se repite es la MISMA historia/situación concreta.

EXCLUYE SIEMPRE, sin excepción (esto NO cuenta como noticia relevante aquí):
- Cualquier cosa tipo "Banco X sube/baja el precio objetivo de la acción Y" — esto es ruido, no un evento real
- Upgrades/downgrades de analistas
- Especulación o rumores sin confirmar
- Noticias de empresas pequeñas/desconocidas sin relevancia real para el público general
- Comentarios triviales o de bajo impacto de figuras públicas (chismes, declaraciones políticas sin relación con negocios/mercados, tweets sin consecuencia real)
- Eventos deportivos/culturales menores o regionales sin interés verdaderamente mundial

REGLAS:
- Este es un horario programado y OBLIGATORIO de la alerta — debes devolver EXACTAMENTE 1 historia real y concreta de las 5 categorías (nunca más de {max_items}). Si hay varias que califican, elige la más relevante/reciente. Si ninguna es "muy grande", igual elige la MEJOR historia real disponible ahora mismo entre las categorías — no necesita ser excepcional, solo real, concreta y verificable. Solo responde con items vacío si la búsqueda genuinamente no trajo NADA real y verificable en ninguna de las 5 categorías — esto debería ser rarísimo dado lo amplia que es la búsqueda. NUNCA inventes una historia que no esté en los resultados de búsqueda.
- Si de verdad no hay absolutamente nada real que califique, responde exactamente: {{"items": []}}
- Cada item debe tener una notificación push MUY corta (máximo 90-120 caracteres), directa, sin relleno — el usuario la lee en la pantalla de bloqueo.
- Genera el texto de la notificación en DOS idiomas: español (push_body_es) e inglés (push_body_en) — misma información, mismo tono directo, cada uno natural en su idioma (no una traducción literal palabra por palabra).

Responde ÚNICAMENTE con JSON válido, sin texto adicional, en este formato exacto:
{{"items": [{{"category": "geopolitics|macro|corporate|leadership|global_event", "headline": "título corto interno para dedup", "push_body_es": "texto en español, máx 90-120 caracteres", "push_body_en": "text in English, máx 90-120 characters"}}]}}"""

    try:
        client = anthropic.AsyncAnthropic()
        resp = await asyncio.wait_for(
            client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}],
            ),
            timeout=20.0,
        )
        in_tok = getattr(resp.usage, "input_tokens", 0)
        out_tok = getattr(resp.usage, "output_tokens", 0)
        logger.info("LLM major_news_curate: in=%d out=%d cost=$%.5f", in_tok, out_tok,
                    in_tok / 1e6 * 0.80 + out_tok / 1e6 * 4.0)
        from app.services.llm_usage import log_llm_usage
        asyncio.create_task(log_llm_usage(None, "job_major_news_alert", "claude-haiku-4-5-20251001", resp.usage))
        raw = resp.content[0].text.strip()
        # Strip accidental markdown code fences
        if raw.startswith("```"):
            raw = raw.strip("`")
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
        parsed = _json.loads(raw)
        items = parsed.get("items", [])
        return items[:max_items]
    except Exception as e:
        logger.warning("Major news curation failed: %s — treating as no qualifying news", e)
        return []


async def job_major_news_alert():
    """Runs once in each of 5 fixed daily windows, 7 days a week (see
    _MAJOR_NEWS_WINDOWS — registered as 5 separate cron triggers at each
    window's start: 8am, 11am, 2pm, 5pm, 8pm ET) — sends exactly 5 genuinely
    major geopolitical/macro/big-corporate/leadership/global-event news
    alerts PER DAY, one per window, MANDATORY (shared across ALL users, not
    per-user, not premium-gated). Unlike the old "up to 3, often 0" design,
    this is a guaranteed 5-a-day product decision — see _curate_major_news's
    docstring for how it stays mandatory without ever inventing a story.

    Runs on weekends too (deliberately, unlike market-hours jobs) since
    geopolitical/macro news doesn't stop when markets are closed.

    Daily cap of _MAJOR_NEWS_DAILY_CAP (5) is enforced via major_news_events
    (DB table), not an in-memory/Redis cache — same lesson as the
    price-alert dedup fix: a cache-based counter resets on every worker
    restart/redeploy.

    Also looks back _MAJOR_NEWS_LOOKBACK_DAYS days (not just today) to stop
    the same underlying story from getting resent every window just because
    it's still in the news — a real complaint (the same geopolitical
    tension alerted day after day). Repeating the same CATEGORY across
    windows/days is explicitly fine (see _curate_major_news's docstring) —
    only the exact same story must never repeat.
    """
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push, _today_et
    from app.services.perplexity_service import search_web
    import hashlib

    db = get_supabase()
    today = _today_et()

    try:
        sent_res = await run_query(
            db.table("major_news_events").select("headline_hash,headline").eq("event_date", today)
        )
        already_sent = sent_res.data or []
        slots_remaining = _MAJOR_NEWS_DAILY_CAP - len(already_sent)
        if slots_remaining <= 0:
            logger.info("job_major_news_alert: %d/%d alerts already sent today — skipping",
                        len(already_sent), _MAJOR_NEWS_DAILY_CAP)
            return

        # Real complaint fixed here: the old dedup only checked TODAY's sent
        # headlines, so an ongoing multi-day story (e.g. an active
        # geopolitical standoff) got resent day after day since each day's
        # headline text was technically "new" against an empty daily list.
        # Looking back _MAJOR_NEWS_LOOKBACK_DAYS lets the curation prompt
        # recognize "same situation, no material new development" and skip it.
        from datetime import datetime, timedelta
        lookback_start = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=_MAJOR_NEWS_LOOKBACK_DAYS)).strftime("%Y-%m-%d")
        recent_res = await run_query(
            db.table("major_news_events").select("headline")
            .gte("event_date", lookback_start).lt("event_date", today)
        )
        recent_days_headlines = [r["headline"] for r in (recent_res.data or [])]

        query = (
            "¿Cuáles son las noticias más importantes de las últimas horas a nivel mundial? Busca "
            "con la MAYOR diversidad posible de temas y regiones (no te limites a un solo conflicto "
            "o tensión si hay otras noticias igual de relevantes): 1) desarrollos políticos o de "
            "gobierno significativos en cualquier país — conflictos, sanciones, crisis o cambios de "
            "gobierno, situaciones que el mundo esté siguiendo (ej. la situación del gobierno de "
            "Venezuela), no solo entre las potencias económicas más mediáticas, 2) datos o decisiones "
            "macroeconómicas (tasas de interés, Fed, desempleo, PIB, inflación, política monetaria), "
            "3) noticias corporativas de gran impacto de empresas grandes y reconocidas — no solo las "
            "10 más grandes del mundo — incluyendo restricciones comerciales/regulatorias (ej. China "
            "negándole a Nvidia licencias de exportación de chips), expansión estratégica mayor a "
            "nuevos mercados (ej. McDonald's abriendo cientos de restaurantes en India), fusiones y "
            "adquisiciones grandes, resultados que sorprenden fuertemente, 4) declaraciones, anuncios "
            "o acuerdos importantes de líderes de empresas grandes y reconocidas — nuevos productos, "
            "fusiones y adquisiciones, alianzas estratégicas, renuncias sorpresivas, 5) eventos "
            "globales de gran relevancia cultural o deportiva que el mundo entero siga (ej. resultado "
            "de una final de Mundial u Olimpiadas, una elección presidencial mayor). Ignora cambios de "
            "precio objetivo de analistas o notas de research — eso no es lo que busco. Da fecha y "
            "fuente si es posible."
        )
        raw = await asyncio.to_thread(search_web, query, False)
        if not raw:
            logger.info("job_major_news_alert: Perplexity returned nothing this cycle")
            return

        items = await _curate_major_news(
            raw, [r["headline"] for r in already_sent], slots_remaining,
            recent_days_headlines=recent_days_headlines,
        )
        if not items:
            logger.info("job_major_news_alert: no genuinely major news found this cycle")
            return

        # Recipients: ALL users with push_news_general enabled (default on —
        # same opt-out preference used by job_ipo_alerts), not premium-gated.
        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id,push_news_general")
            .neq("push_news_general", False)
        )
        opted_in = {p["user_id"] for p in (prefs_res.data or [])}
        token_res = await run_query(
            db.table("user_profiles").select("user_id,push_token")
            .neq("push_token", "").not_.is_("push_token", "null")
        )
        expo_uids = {r["user_id"] for r in (token_res.data or [])}
        web_res   = await run_query(db.table("web_push_subscriptions").select("user_id"))
        web_uids  = {r["user_id"] for r in (web_res.data or [])}
        all_uids  = list((expo_uids | web_uids) & opted_in)
        if not all_uids:
            logger.info("job_major_news_alert: no opted-in users with a push channel")
            return
        lang_res = await run_query(
            db.table("user_profiles").select("user_id,preferred_language").in_("user_id", all_uids)
        )
        lang_map = {r["user_id"]: (r.get("preferred_language") or "es") for r in (lang_res.data or [])}

        sent_count = 0
        for item in items:
            headline = item.get("headline", "").strip()
            push_body_es = item.get("push_body_es", "").strip()
            push_body_en = item.get("push_body_en", "").strip()
            category = item.get("category", "corporate")
            if not headline or not push_body_es:
                continue
            h = hashlib.md5(headline.encode()).hexdigest()
            if h in {r["headline_hash"] for r in already_sent}:
                continue  # model re-suggested something already sent today, skip it

            try:
                # push_body column stores the Spanish version — the English
                # version only ever needs to exist at send time (this row
                # isn't re-read for content elsewhere, just for headline dedup).
                await run_query(db.table("major_news_events").insert({
                    "event_date": today, "headline_hash": h, "headline": headline,
                    "category": category, "push_body": push_body_es,
                }))
            except Exception as e:
                # Unique index on (event_date, headline_hash) — another concurrent
                # tick already inserted this exact story; skip sending a duplicate.
                logger.info("job_major_news_alert: %s already recorded today (%s) — skipping send", headline, e)
                continue

            emoji = _MAJOR_NEWS_CATEGORY_EMOJI.get(category, "📰")
            title_es = f"{emoji} Evento importante"
            title_en = f"{emoji} Important event"
            for i, uid in enumerate(all_uids):
                if i % 100 == 0 and i > 0:
                    await asyncio.sleep(12)
                await asyncio.sleep(random.uniform(0, 0.05))
                is_en = lang_map.get(uid, "es") == "en"
                title = title_en if is_en else title_es
                body  = push_body_en if (is_en and push_body_en) else push_body_es
                await send_push(uid, "major_news_alert", title, body, {"screen": "home"}, db)
            sent_count += 1
            logger.info("job_major_news_alert: sent '%s' (%s) to %d users", headline, category, len(all_uids))

        logger.info("job_major_news_alert: %d new alert(s) sent this cycle", sent_count)
    except Exception as e:
        logger.error("job_major_news_alert failed: %s", e)


async def job_ipo_alerts():
    """7:45 AM ET daily — notify all opted-in users about IPOs priced today or expected tomorrow.
    Deduped per symbol per user so each IPO fires exactly one notification."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    from app.services.market_data_service import fetch_upcoming_ipos_raw

    db   = get_supabase()
    ipos = await asyncio.to_thread(fetch_upcoming_ipos_raw, 2)
    if not ipos:
        logger.info("job_ipo_alerts: no upcoming IPOs in window — skipping")
        return

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    try:
        # Opt-in model: users with push_news_general enabled (default True)
        prefs_res = await run_query(
            db.table("notification_preferences")
            .select("user_id,push_news_general")
            .neq("push_news_general", False)
        )
        opted_in = {p["user_id"] for p in (prefs_res.data or [])}
        if not opted_in:
            return

        # Also include users who have a token but no prefs row yet (defaults to on)
        token_res = await run_query(
            db.table("user_profiles").select("user_id,push_token")
            .neq("push_token", "").not_.is_("push_token", "null")
        )
        expo_uids = {r["user_id"] for r in (token_res.data or [])}
        web_res   = await run_query(db.table("web_push_subscriptions").select("user_id"))
        web_uids  = {r["user_id"] for r in (web_res.data or [])}
        all_uids  = list((expo_uids | web_uids) & opted_in)
        if not all_uids:
            return

        lang_res = await run_query(
            db.table("user_profiles").select("user_id,preferred_language").in_("user_id", all_uids)
        )
        lang_map = {r["user_id"]: (r.get("preferred_language") or "es") for r in (lang_res.data or [])}

        sent_total = 0
        for ipo in ipos:
            symbol      = ipo["symbol"]
            name        = ipo["name"] or symbol
            ipo_date    = ipo["date"]
            price_range = ipo["price_range"]
            exchange    = ipo["exchange"] or "bolsa"
            status      = ipo["status"]

            is_today    = ipo_date == today_str
            emoji       = "🚀" if is_today else "📅"

            when_es = "hoy" if is_today else "mañana"
            title_es = f"{emoji} IPO {when_es}: {symbol}"
            body_parts_es = [f"{name} debuta {when_es} en {exchange}."]
            if price_range:
                body_parts_es.append(f"Precio esperado: {price_range}.")
            body_parts_es.append("Toca para ver el análisis.")
            body_es = " ".join(body_parts_es)

            when_en = "today" if is_today else "tomorrow"
            title_en = f"{emoji} IPO {when_en}: {symbol}"
            body_parts_en = [f"{name} debuts {when_en} on {exchange}."]
            if price_range:
                body_parts_en.append(f"Expected price: {price_range}.")
            body_parts_en.append("Tap to see the analysis.")
            body_en = " ".join(body_parts_en)

            category = f"ipo_alert:{symbol.upper()}"

            for i, uid in enumerate(all_uids):
                if i % 100 == 0 and i > 0:
                    await asyncio.sleep(8)
                await asyncio.sleep(random.uniform(0, 0.05))
                is_en = lang_map.get(uid, "es") == "en"
                title = title_en if is_en else title_es
                body  = body_en if is_en else body_es
                prefill = f"Analyze the {symbol} IPO — {name}" if is_en else f"Analiza la IPO de {symbol} — {name}"
                await send_push(
                    uid, category, title, body,
                    {"screen": "chat", "prefill": prefill},
                    db,
                )
                sent_total += 1

        logger.info("job_ipo_alerts: %d notifications sent for %d IPOs", sent_total, len(ipos))
    except Exception as e:
        logger.exception("job_ipo_alerts failed: %s", e)


async def job_events_alerts():
    """8:00 AM ET weekdays — push for today/tomorrow ex-div, dividend payment, and earnings dates.
    Skips weekends and NYSE holidays."""
    if not _is_market_open_today():
        logger.info("job_events_alerts: market closed today — skipping")
        return

    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    from app.api.routes.earnings import _fetch_events_for_symbol
    from datetime import timedelta
    import random

    db       = get_supabase()
    today    = datetime.now(timezone.utc).date()
    tomorrow = today + timedelta(days=1)
    targets  = {str(today), str(tomorrow)}

    try:
        prefs_res = await run_query(
            db.table("notification_preferences")
            .select("user_id,push_portfolio_alerts,push_watchlist_alerts")
            .or_("push_portfolio_alerts.eq.true,push_watchlist_alerts.eq.true")
        )
        if not prefs_res.data:
            return
        prefs_by_uid = {p["user_id"]: p for p in prefs_res.data}

        # Load tiers once
        tier_res = await run_query(
            db.table("user_profiles").select("user_id,subscription_tier,preferred_language").in_("user_id", list(prefs_by_uid.keys()))
        )
        tier_map = {r["user_id"]: (r.get("subscription_tier") or "free") for r in (tier_res.data or [])}
        lang_map = {r["user_id"]: (r.get("preferred_language") or "es") for r in (tier_res.data or [])}

        processed = notified = 0
        for i, (uid, prefs) in enumerate(prefs_by_uid.items()):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)

            port_tickers: set = set()
            watch_tickers: set = set()

            positions_map: dict[str, dict] = {}
            if prefs.get("push_portfolio_alerts"):
                port_res = await run_query(
                    db.table("user_portfolio").select("positions").eq("user_id", uid)
                )
                if port_res.data:
                    pos_list = _agg_positions(port_res.data or [])
                    port_tickers  = {p["ticker"] for p in pos_list if p.get("ticker")}
                    positions_map = {p["ticker"]: p for p in pos_list if p.get("ticker")}

            if prefs.get("push_watchlist_alerts"):
                watch_res = await run_query(
                    db.table("watchlist").select("ticker").eq("user_id", uid)
                )
                watch_tickers = {r["ticker"] for r in (watch_res.data or [])} - port_tickers

            all_tickers = port_tickers | watch_tickers
            if not all_tickers:
                processed += 1
                continue

            is_premium = tier_map.get(uid) == "premium"
            is_en      = lang_map.get(uid, "es") == "en"

            for ticker in all_tickers:
                events = await asyncio.to_thread(_fetch_events_for_symbol, ticker)
                for evt in events:
                    if evt.get("event_date") not in targets:
                        continue
                    is_today   = evt["event_date"] == str(today)
                    when       = ("today" if is_en else "hoy") if is_today else ("tomorrow" if is_en else "mañana")
                    event_type = evt.get("event_type")

                    if event_type == "earnings":
                        category     = "earnings_report"
                        is_portfolio = ticker in port_tickers

                        if is_premium:
                            pos            = positions_map.get(ticker, {})
                            shares         = float(pos.get("shares", 0) or 0)
                            avg_cost       = float(pos.get("avg_cost", 0) or 0) or None
                            q              = await asyncio.to_thread(_finnhub_quote, ticker)
                            curr_price     = q["curr"] if q else 0.0
                            position_value = shares * curr_price if shares and curr_price else 0.0
                            reactions      = await asyncio.to_thread(_fetch_historical_earnings_reactions, ticker)
                            title, body = await _generate_earnings_push(
                                ticker           = ticker,
                                company          = _company_name(ticker),
                                when             = when,
                                eps_estimate     = evt.get("eps_estimate"),
                                eps_range        = evt.get("eps_range"),
                                revenue_estimate = evt.get("revenue_estimate"),
                                reactions        = reactions,
                                shares           = shares if is_portfolio else 0,
                                position_value   = position_value if is_portfolio else 0,
                                avg_cost         = avg_cost if is_portfolio else None,
                                language         = "en" if is_en else "es",
                            )
                        else:
                            if is_en:
                                title = f"📅 Earnings: {ticker}"
                                body  = f"{_company_name(ticker)} reports results {when}. Activate Premium to see the impact on your portfolio."
                            else:
                                title = f"📅 Earnings: {ticker}"
                                body  = f"{_company_name(ticker)} reporta resultados {when}. Activa Premium para ver el impacto en tu portafolio."

                    elif event_type in ("ex_dividend", "dividend"):
                        is_portfolio = ticker in port_tickers
                        amt = await asyncio.to_thread(_finnhub_dividend_amount, ticker)
                        if amt is None:
                            raw_amt = evt.get("dividend_amount")
                            amt = float(raw_amt) if raw_amt else None

                        if event_type == "ex_dividend":
                            title    = f"✂️ Ex-Dividend: {ticker}" if is_en else f"✂️ Ex-Dividendo: {ticker}"
                            category = "ex_dividend"
                            if is_premium and is_portfolio:
                                pos         = positions_map.get(ticker, {})
                                shares_held = float(pos.get("shares") or 0)
                                if amt and shares_held:
                                    pago = shares_held * amt
                                    body = (
                                        f"{ticker}'s ex-dividend date is {when}. "
                                        f"You hold {shares_held:.4f} shares — "
                                        f"estimated payout: ${pago:.2f} USD (${amt:.4f}/share)."
                                        if is_en else
                                        f"Fecha ex-dividendo de {ticker} es {when}. "
                                        f"Tienes {shares_held:.4f} acciones — "
                                        f"tu pago estimado: ${pago:.2f} USD (${amt:.4f}/acción)."
                                    )
                                elif amt:
                                    body = (
                                        f"{ticker}'s ex-dividend date is {when}. ${amt:.4f}/share."
                                        if is_en else
                                        f"Fecha ex-dividendo de {ticker} es {when}. ${amt:.4f}/acción."
                                    )
                                else:
                                    body = (
                                        f"{ticker}'s ex-dividend date is {when}."
                                        if is_en else
                                        f"Fecha ex-dividendo de {ticker} es {when}."
                                    )
                            else:
                                body = (
                                    f"{ticker}'s ex-dividend date is {when}." + (f" ${amt:.4f}/share." if amt else "")
                                    if is_en else
                                    f"Fecha ex-dividendo de {ticker} es {when}." + (f" ${amt:.4f}/acción." if amt else "")
                                )
                        else:
                            title    = f"💰 Dividend Payment: {ticker}" if is_en else f"💰 Pago de Dividendo: {ticker}"
                            category = "dividend_payment"
                            if is_premium and is_portfolio:
                                pos         = positions_map.get(ticker, {})
                                shares_held = float(pos.get("shares") or 0)
                                if amt and shares_held:
                                    pago = shares_held * amt
                                    body = (
                                        f"{ticker} pays dividend {when}. "
                                        f"With your {shares_held:.4f} shares you'll receive "
                                        f"${pago:.2f} USD (${amt:.4f}/share)."
                                        if is_en else
                                        f"{ticker} paga dividendo {when}. "
                                        f"Con tus {shares_held:.4f} acciones recibirás "
                                        f"${pago:.2f} USD (${amt:.4f}/acción)."
                                    )
                                elif amt:
                                    body = (
                                        f"{ticker} pays dividend {when}. ${amt:.4f}/share."
                                        if is_en else
                                        f"{ticker} paga dividendo {when}. ${amt:.4f}/acción."
                                    )
                                else:
                                    body = (
                                        f"{ticker} pays dividend {when}."
                                        if is_en else
                                        f"{ticker} paga dividendo {when}."
                                    )
                            else:
                                body = (
                                    f"{ticker} pays dividend {when}." + (f" ${amt:.4f}/share." if amt else "")
                                    if is_en else
                                    f"{ticker} paga dividendo {when}." + (f" ${amt:.4f}/acción." if amt else "")
                                )
                    else:
                        continue

                    # Include ticker in category so each stock dedups independently
                    await send_push(
                        uid, f"{category}:{ticker}", title, body,
                        {"ticker": ticker, "screen": "portfolio" if is_portfolio else "watchlist"},
                        db,
                    )
                    notified += 1
                    await asyncio.sleep(random.uniform(0.05, 0.15))

            processed += 1

        logger.info("Events alerts: %d users processed, %d notifications sent", processed, notified)
    except Exception as e:
        logger.error("job_events_alerts failed: %s", e)


async def job_reengagement_push():
    """11:00 AM ET daily — push to users inactive for 3+ days (3 notable portfolio movers)."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    try:
        prefs_res = await run_query(
            db.table("notification_preferences")
            .select("user_id,last_opened_app,push_market_open")
            .eq("push_market_open", True)
        )
        inactive_uids = [
            r["user_id"]
            for r in (prefs_res.data or [])
            if not r.get("last_opened_app") or r["last_opened_app"] < cutoff
        ]
        if not inactive_uids:
            return

        # Only send personalized portfolio movers to premium users
        tier_res = await run_query(
            db.table("user_profiles").select("user_id,preferred_language").eq("subscription_tier", "premium").in_("user_id", inactive_uids)
        )
        premium_set = {r["user_id"] for r in (tier_res.data or [])}
        lang_map = {r["user_id"]: (r.get("preferred_language") or "es") for r in (tier_res.data or [])}
        inactive_uids = [uid for uid in inactive_uids if uid in premium_set]
        if not inactive_uids:
            return

        # Collect tickers from each inactive user's portfolio
        all_tickers: set[str] = set()
        port_map: dict[str, list] = {}
        for uid in inactive_uids:
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if port_res.data:
                pos = _agg_positions(port_res.data or [])
                port_map[uid] = pos
                all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        prices = await _finnhub_prices_batch(list(all_tickers)) if all_tickers else {}

        sent = 0
        for i, uid in enumerate(inactive_uids):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))
            positions = port_map.get(uid, [])
            movers = []
            for p in positions:
                ticker = p.get("ticker")
                if ticker and ticker in prices:
                    px = prices[ticker]
                    if px["prev"] > 0:
                        pct = (px["curr"] - px["prev"]) / px["prev"] * 100
                        movers.append((ticker, abs(pct), pct))
            movers.sort(key=lambda x: x[1], reverse=True)
            top = movers[:3]
            is_en = lang_map.get(uid, "es") == "en"
            if top:
                names = ", ".join(t[0] for t in top)
                body = (
                    f"3 of your favorite assets had interesting moves: {names}. Have you checked them yet?"
                    if is_en else
                    f"3 de tus activos favoritos tuvieron movimientos interesantes: {names}. ¿Ya los revisaste?"
                )
            else:
                body = (
                    "You've missed some moves in your assets. Come check your portfolio."
                    if is_en else
                    "Te has perdido algunos movimientos en tus activos. Entra a revisar tu portafolio."
                )
            await send_push(
                uid, "reengagement",
                "📱 Your portfolio is waiting for you" if is_en else "📱 Tu portafolio te está esperando",
                body,
                {"screen": "portfolio"},
                db,
            )
            sent += 1
        logger.info("Re-engagement push: %d sent to %d inactive users", sent, len(inactive_uids))
    except Exception as e:
        logger.error("job_reengagement_push failed: %s", e)


async def job_risk_mgmt_push():
    """3:00 PM ET Friday — push VIX spike warning + stop loss reminder when VIX > 20.
    Uses Finnhub /quote for ^VIX (yfinance blocked on Railway)."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    try:
        vix_data = await asyncio.to_thread(_finnhub_quote, "^VIX")
        vix = vix_data["curr"] if vix_data else None

        if vix is None or vix < 20:
            logger.info("Risk mgmt push skipped: VIX=%.1f (threshold 20)", vix or 0)
            return

        title_es = "⚠️ Volatilidad elevada"
        body_es  = f"El VIX está en {vix:.1f} — por encima del nivel de alerta. Revisa tus stop-loss y niveles de exposición en Nuvos AI."
        title_en = "⚠️ Elevated volatility"
        body_en  = f"The VIX is at {vix:.1f} — above the alert threshold. Review your stop-losses and exposure levels on Nuvos AI."

        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("push_portfolio_alerts", True)
        )
        uids = [u["user_id"] for u in (prefs_res.data or [])]
        lang_res = await run_query(
            db.table("user_profiles").select("user_id,preferred_language").in_("user_id", uids)
        )
        lang_map = {r["user_id"]: (r.get("preferred_language") or "es") for r in (lang_res.data or [])}

        sent = 0
        for i, uid in enumerate(uids):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))
            is_en = lang_map.get(uid, "es") == "en"
            title, body = (title_en, body_en) if is_en else (title_es, body_es)
            await send_push(uid, "risk_management", title, body, {"screen": "portfolio"}, db)
            sent += 1
        logger.info("Risk mgmt push: VIX=%.1f, %d users notified", vix, sent)
    except Exception as e:
        logger.error("job_risk_mgmt_push failed: %s", e)


_MARKET_CRASH_THRESHOLD_PCT = -3.0  # S&P 500 single-day drop that triggers the alert


async def job_market_crash_alert():
    """Cada 5 min, 9:30 AM–4:00 PM ET lun-vie — detecta una caída del S&P 500
    de -3% o más en un solo día (vía SPY como proxy, igual que job_market_open/
    job_market_close) y manda una alerta urgente. send_push dedupea por
    categoría+día, así que aunque el job corra cada 5 min mientras el mercado
    siga en rojo, cada usuario recibe como máximo un push por día."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    try:
        spy_q = await asyncio.to_thread(_finnhub_quote, "SPY")
        pct = spy_q["pct"] if spy_q else None

        if pct is None or pct > _MARKET_CRASH_THRESHOLD_PCT:
            return

        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("push_portfolio_alerts", True)
        )
        uids = [r["user_id"] for r in (prefs_res.data or [])]
        if not uids:
            return

        prof_res = await run_query(
            db.table("user_profiles")
            .select("user_id,subscription_tier,trial_started_at,preferred_language")
            .in_("user_id", uids)
        )
        prof_map = {r["user_id"]: r for r in (prof_res.data or [])}

        premium_title_es = "🚨 ¡URGENTE!"
        premium_body_es  = (
            f"Tenemos que hablar de lo que está pasando en la bolsa de valores — "
            f"el S&P 500 cayó {abs(pct):.1f}% hoy. Abre Nuvos y hablemos."
        )
        free_title_es = "📉 El mercado está cayendo fuerte"
        free_body_es  = (
            f"El S&P 500 cayó {abs(pct):.1f}% hoy. Activa Premium para que tu Mentor IA "
            f"te explique qué está pasando y qué hacer al respecto."
        )
        premium_title_en = "🚨 URGENT!"
        premium_body_en  = (
            f"We need to talk about what's happening in the stock market — "
            f"the S&P 500 dropped {abs(pct):.1f}% today. Open Nuvos and let's talk."
        )
        free_title_en = "📉 The market is dropping hard"
        free_body_en  = (
            f"The S&P 500 dropped {abs(pct):.1f}% today. Activate Premium so your AI Mentor "
            f"can explain what's happening and what to do about it."
        )

        sent = 0
        for i, uid in enumerate(uids):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            prof = prof_map.get(uid, {})
            is_prem = _is_premium_user(prof.get("subscription_tier", "free"), prof.get("trial_started_at"))
            is_en   = (prof.get("preferred_language") or "es") == "en"
            if is_en:
                title, body = (premium_title_en, premium_body_en) if is_prem else (free_title_en, free_body_en)
            else:
                title, body = (premium_title_es, premium_body_es) if is_prem else (free_title_es, free_body_es)
            await send_push(
                uid, "market_crash_alert", title, body,
                {"screen": "chat", "sp500_pct": pct}, db,
            )
            sent += 1
            await asyncio.sleep(random.uniform(0, 0.12))

        logger.info("Market crash alert: S&P 500 %.2f%%, %d users notified", pct, sent)
    except Exception as e:
        logger.error("job_market_crash_alert failed: %s", e)


def _finnhub_earnings_today(hour_filter: str | None = None) -> dict[str, dict]:
    """Fetch today's earnings from Finnhub calendar.

    Args:
        hour_filter: "BMO" | "AMC" | None (all). Finnhub values: BMO, AMC, DMT.

    Returns:
        {ticker: {eps_actual, eps_estimate, rev_actual_b, rev_estimate_b, beat_eps, beat_rev, hour}}
    """
    import pytz
    import requests as req_lib

    fh_key = os.getenv("FINNHUB_API_KEY", "")
    if not fh_key:
        return {}

    today_str = datetime.now(pytz.timezone("America/New_York")).strftime("%Y-%m-%d")
    try:
        resp = req_lib.get(
            "https://finnhub.io/api/v1/calendar/earnings",
            params={"from": today_str, "to": today_str, "token": fh_key},
            timeout=10,
        )
        resp.raise_for_status()
        events = resp.json().get("earningsCalendar") or []
    except Exception as e:
        logger.warning("Finnhub earnings calendar failed: %s", e)
        return {}

    out: dict[str, dict] = {}
    for ev in events:
        hour = (ev.get("hour") or "").upper()
        if hour_filter and hour != hour_filter:
            continue
        eps_actual   = ev.get("epsActual")
        eps_estimate = ev.get("epsEstimate")
        # Finnhub revenue is in raw USD — convert to billions for display
        rev_a = ev.get("revenueActual")
        rev_e = ev.get("revenueEstimate")
        beat_eps = (
            eps_actual is not None and eps_estimate is not None and eps_actual >= eps_estimate
        )
        beat_rev = (
            rev_a is not None and rev_e is not None and rev_e > 0 and rev_a >= rev_e
        )
        out[ev["symbol"]] = {
            "eps_actual":     round(float(eps_actual),   2) if eps_actual   is not None else None,
            "eps_estimate":   round(float(eps_estimate), 2) if eps_estimate is not None else None,
            "rev_actual_b":   round(float(rev_a) / 1e9, 2) if rev_a        is not None else None,
            "rev_estimate_b": round(float(rev_e) / 1e9, 2) if rev_e        is not None else None,
            "beat_eps":  beat_eps,
            "beat_rev":  beat_rev,
            "hour":      hour,
            "quarter":   ev.get("quarter"),
            "year":      ev.get("year"),
        }
    return out


def _earnings_push_content(
    ticker: str,
    res: dict,
    language: str = "es",
) -> tuple[str, str]:
    """Return (title, body) for an earnings push notification.

    Title: "Reporte Q{quarter} {year} {Company}". Body: one line for EPS and
    one for Revenue, each "actual vs estimado {✅/❌}" — ✅ when actual beat
    (or matched) the estimate, ❌ on a miss. A line is omitted entirely if
    Finnhub didn't report that figure for this company. Deliberately just
    these lines — no position/watchlist context added.
    """
    is_en = language == "en"
    eps_a = res.get("eps_actual")
    eps_e = res.get("eps_estimate")
    beat_eps = res.get("beat_eps", False)
    rev_a = res.get("rev_actual_b")
    rev_e = res.get("rev_estimate_b")
    beat_rev = res.get("beat_rev", False)
    hour  = res.get("hour", "")
    quarter = res.get("quarter")
    year    = res.get("year")

    company = _company_name(ticker)
    if quarter and year:
        title = f"Q{quarter} {year} Report {company}" if is_en else f"Reporte Q{quarter} {year} {company}"
    else:
        timing_tag = " · Pre-market" if hour == "BMO" else (" · After-hours" if hour == "AMC" else "")
        title = f"{ticker} Earnings{timing_tag}" if is_en else f"Resultados {ticker}{timing_tag}"

    lines = []
    if eps_a is not None:
        eps_emoji = "✅" if beat_eps else "❌"
        if eps_e is not None:
            lines.append(
                f"EPS: ${eps_a:.2f} vs ${eps_e:.2f} est. {eps_emoji}" if is_en else
                f"EPS: ${eps_a:.2f} vs ${eps_e:.2f} estimado {eps_emoji}"
            )
        else:
            lines.append(f"EPS: ${eps_a:.2f}")
    if rev_a is not None:
        rev_emoji = "✅" if beat_rev else "❌"
        if rev_e is not None:
            lines.append(
                f"Revenue: ${rev_a:.1f}B vs ${rev_e:.1f}B est. {rev_emoji}" if is_en else
                f"Ingresos: ${rev_a:.1f}B vs ${rev_e:.1f}B estimado {rev_emoji}"
            )
        else:
            lines.append(f"Revenue: ${rev_a:.1f}B" if is_en else f"Ingresos: ${rev_a:.1f}B")

    body = "\n".join(lines) if lines else (f"{ticker} just reported earnings" if is_en else f"{ticker} acaba de reportar resultados")
    return title, body


async def _job_earnings_dispatch(hour_filter: str):
    """Shared logic for BMO + AMC earnings jobs."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push

    if not _is_market_open_today():
        return

    db = get_supabase()

    # 1. Fetch today's earnings from Finnhub for the given session
    results_map = await asyncio.to_thread(_finnhub_earnings_today, hour_filter)
    if not results_map:
        logger.info("job_earnings [%s]: no earnings reported today", hour_filter)
        return

    reported_tickers = set(results_map.keys())
    logger.info("job_earnings [%s]: %d tickers reported: %s", hour_filter, len(reported_tickers), reported_tickers)

    # 2. Load all users
    users_res = await run_query(db.table("user_profiles").select("user_id,name,preferred_language,subscription_tier,trial_started_at"))
    users = users_res.data or []
    if not users:
        return

    # 3. For efficiency: bulk load all portfolios + watchlists
    port_res  = await run_query(db.table("user_portfolio").select("user_id,positions"))
    watch_res = await run_query(db.table("watchlist").select("user_id,ticker"))

    port_by_uid: dict[str, list] = {}
    for r in (port_res.data or []):
        raw = r.get("positions") or {}
        pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
        if pos:
            port_by_uid[r["user_id"]] = pos

    # watchlist: {user_id: set(tickers)}
    watch_by_uid: dict[str, set] = {}
    for r in (watch_res.data or []):
        watch_by_uid.setdefault(r["user_id"], set()).add(r["ticker"])

    # 4. Fan out
    notified = 0
    for u in users:
        uid       = u["user_id"]
        positions = port_by_uid.get(uid, [])
        watchlist = watch_by_uid.get(uid, set())

        port_tickers  = {p["ticker"] for p in positions if p.get("ticker")}
        relevant      = (port_tickers | watchlist) & reported_tickers
        if not relevant:
            continue

        language  = (u.get("preferred_language") or "es")
        is_prem   = _is_premium_user(u.get("subscription_tier") or "free", u.get("trial_started_at"))
        await asyncio.sleep(random.uniform(0, 0.05))
        for ticker in relevant:
            res  = results_map[ticker]
            title, body = _earnings_push_content(ticker, res, language=language)
            if is_prem:
                # Premium-only teaser + deep link into the real structured
                # Earnings Analysis screen (segments/guidance/rating grounded
                # in real data) — free users keep the plain beat/miss body
                # and generic stock_detail link, since they don't have
                # access to that screen.
                body += ("\nCome see the full analysis." if language == "en" else "\nVen a ver el análisis de lo que pasó.")
                data = {"ticker": ticker, "screen": f"earnings/{ticker}"}
            else:
                data = {"ticker": ticker, "screen": "stock_detail"}
            await send_push(
                uid, f"earnings_{ticker.lower()}",
                title, body,
                data,
                db,
            )
            notified += 1

    logger.info("job_earnings [%s]: %d notifications sent", hour_filter, notified)


async def job_earnings_bmo():
    """9:15 AM ET — notify users about pre-market earnings (BMO)."""
    try:
        await _job_earnings_dispatch("BMO")
    except Exception as e:
        logger.error("job_earnings_bmo failed: %s", e)


async def job_earnings_results():
    """4:30 PM ET — notify users about after-hours earnings (AMC)."""
    try:
        await _job_earnings_dispatch("AMC")
    except Exception as e:
        logger.error("job_earnings_results failed: %s", e)


# ─────────────────────────────────────────────────────────────────────────────
# Email jobs
# ─────────────────────────────────────────────────────────────────────────────

async def send_birthday_emails():
    """Daily at 8:00 AM ET — send birthday email + 7-day Premium trial to users with birthday today."""
    if not settings.resend_api_key:
        return
    from app.core.database import get_supabase, run_query
    db = get_supabase()
    today = datetime.now(timezone.utc).date()
    try:
        users_res = await run_query(
            db.table("user_profiles").select("user_id,name,birth_date,preferred_language")
        )
        auth_users = {u.id: u.email for u in await asyncio.to_thread(lambda: db.auth.admin.list_users())}
        sent = 0
        for u in (users_res.data or []):
            bd_str = u.get("birth_date")
            if not bd_str:
                continue
            try:
                from datetime import date
                bd = date.fromisoformat(str(bd_str)[:10])
                if bd.month != today.month or bd.day != today.day:
                    continue
            except Exception:
                continue
            email = auth_users.get(u["user_id"])
            if not email:
                continue
            is_en = (u.get("preferred_language") or "es") == "en"
            html = build_birthday_html(u.get("name") or "Inversor", language="en" if is_en else "es")
            subject = "🎂 Happy Birthday! Your gift from Nuvos AI" if is_en else "🎂 ¡Feliz cumpleaños! Tu regalo de Nuvos AI"
            ok   = await send_email(email, subject, html)
            if ok:
                sent += 1
                logger.info("Birthday email sent to %s", u["user_id"])
        logger.info("Birthday emails: %d sent", sent)
    except Exception as e:
        logger.error("send_birthday_emails failed: %s", e)


async def send_reengagement_emails():
    """Saturdays — email users inactive for 7+ days with 3 notable portfolio movers."""
    if not settings.resend_api_key:
        return
    from app.core.database import get_supabase, run_query
    db = get_supabase()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    try:
        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id,last_opened_app")
        )
        inactive_uids = [
            r["user_id"]
            for r in (prefs_res.data or [])
            if not r.get("last_opened_app") or r["last_opened_app"] < cutoff
        ]
        if not inactive_uids:
            logger.info("Re-engagement email: no inactive users found")
            return

        users_res = await run_query(
            db.table("user_profiles").select("user_id,name").in_("user_id", inactive_uids)
        )
        auth_users = {u.id: u.email for u in await asyncio.to_thread(lambda: db.auth.admin.list_users())}

        all_tickers: set[str] = set()
        port_map: dict[str, list] = {}
        for u in (users_res.data or []):
            uid = u["user_id"]
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if port_res.data:
                pos = _agg_positions(port_res.data or [])
                port_map[uid] = pos
                all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        prices = await _finnhub_prices_batch(list(all_tickers)) if all_tickers else {}

        sent = 0
        for u in (users_res.data or []):
            uid   = u["user_id"]
            email = auth_users.get(uid)
            if not email:
                continue
            positions = port_map.get(uid, [])
            movers = []
            for p in positions:
                ticker = p.get("ticker")
                if ticker and ticker in prices:
                    px = prices[ticker]
                    if px["prev"] > 0:
                        pct = (px["curr"] - px["prev"]) / px["prev"] * 100
                        movers.append({"ticker": ticker, "change_pct": pct})
            movers.sort(key=lambda x: abs(x["change_pct"]), reverse=True)

            html = build_reengagement_html(u.get("name") or "Inversor", movers[:3])
            ok   = await send_email(email, "📱 Tu portafolio te extraña — Nuvos AI", html)
            if ok:
                sent += 1
        logger.info("Re-engagement emails: %d sent to %d inactive users", sent, len(inactive_uids))
    except Exception as e:
        logger.error("send_reengagement_emails failed: %s", e)


_EDUCATIONAL_CONCEPTS = [
    {
        "concept": "El poder del interés compuesto",
        "explanation": "El interés compuesto es la capacidad de tus ganancias de generar más ganancias a lo largo del tiempo. A diferencia del interés simple, donde solo ganas sobre el capital inicial, con el compuesto tus rendimientos se reinvierten y trabajan junto al capital original.\n\nEinstein lo llamó la octava maravilla del mundo. La clave está en el tiempo: cuanto antes comiences, mayor es el efecto multiplicador. Incluso pequeñas contribuciones periódicas pueden convertirse en sumas significativas a largo plazo gracias a este principio.",
        "example": "Si inviertes $200 al mes desde los 25 años con un 8% anual promedio, a los 65 tendrás aproximadamente $702,000. Si empiezas a los 35, tendrás solo $298,000 — menos de la mitad, aunque inviertas la misma cantidad mensual.",
    },
    {
        "concept": "Dollar Cost Averaging (DCA)",
        "explanation": "El Dollar Cost Averaging consiste en invertir una cantidad fija de dinero en intervalos regulares, independientemente de si el mercado está subiendo o bajando. Con esto, compras más participaciones cuando los precios son bajos y menos cuando son altos, reduciendo tu costo promedio por acción a lo largo del tiempo.\n\nEsta estrategia elimina la presión de intentar 'timing' del mercado — uno de los errores más comunes entre inversores. En lugar de preguntarte '¿es el mejor momento para entrar?', simplemente inviertes con consistencia.",
        "example": "Si inviertes $100 cada semana en un ETF: cuando está a $50/acción compras 2, cuando baja a $25 compras 4, cuando sube a $100 compras 1. Tu precio promedio resulta mejor que si hubieras comprado todo de una sola vez.",
    },
    {
        "concept": "El ratio P/E (Precio/Ganancias)",
        "explanation": "El P/E ratio es la métrica más utilizada para valorar empresas en bolsa. Te dice cuántos dólares estás pagando por cada dólar de ganancia anual que genera la empresa. Un P/E alto puede indicar que el mercado espera mucho crecimiento futuro; uno bajo puede señalar que la acción está 'barata' o que el mercado tiene dudas sobre la empresa.\n\nNo existe un P/E 'correcto' universal — depende del sector, el ciclo económico y el crecimiento esperado. Lo más útil es comparar el P/E de una empresa con el de sus competidoras directas y con su propio historial.",
        "example": "Si Apple genera $6 de ganancias por acción y cotiza a $180, su P/E es 30x. Eso significa que pagas $30 por cada $1 de ganancia. Compara eso con el P/E histórico de Apple (que ha variado entre 15x y 35x) para evaluar si está cara o barata.",
    },
    {
        "concept": "Diversificación: real vs. ilusoria",
        "explanation": "Diversificar significa repartir el riesgo entre activos que no se mueven de la misma manera. El problema es que muchos inversores creen que tienen un portafolio diversificado cuando en realidad todos sus activos están correlacionados y caen juntos en momentos de crisis.\n\nLa diversificación real implica combinar activos de distintos sectores, geografías, tamaños de empresa, y clases de activo (acciones, bonos, commodities). Una cartera de 10 acciones tecnológicas norteamericanas tiene muy poca diversificación real.",
        "example": "En la caída del mercado de 2022, quien tenía solo tecnología perdió un 35-40%. Quien tenía también energía, commodities y bonos a corto plazo vio caídas mucho menores, porque esos sectores se comportaron de manera diferente.",
    },
    {
        "concept": "'Comprar el rumor, vender la noticia'",
        "explanation": "Uno de los fenómenos más contraintuitivos del mercado: cuando se confirma una buena noticia, la acción muchas veces baja en lugar de subir. ¿Por qué? Porque los inversores más informados ya habían comprado anticipando la noticia (el 'rumor'), y cuando se confirma, aprovechan para vender y tomar ganancias.\n\nEste patrón aparece constantemente en earnings, anuncios de productos, aprobaciones regulatorias y datos económicos. La buena noticia ya estaba 'descontada' en el precio antes de que fuera pública.",
        "example": "Apple anuncia un iPhone revolucionario. La acción sube semanas antes del evento (el rumor). El día del lanzamiento oficial, aunque las reseñas son excelentes, la acción cae 3%. Los que compraron en el rumor están vendiendo en la noticia.",
    },
    {
        "concept": "El VIX: índice del miedo del mercado",
        "explanation": "El VIX (Volatility Index) mide cuánta volatilidad espera el mercado en los próximos 30 días, calculada a partir de las opciones del S&P 500. Se lo conoce como el 'índice del miedo': cuando el mercado está tranquilo, el VIX es bajo; cuando hay pánico o incertidumbre extrema, el VIX sube.\n\nHabituamente el VIX ronda entre 12 y 20. Por encima de 30 indica turbulencia significativa; sobre 40 es pánico extremo. Para inversores de largo plazo, los picos del VIX han sido históricamente buenos momentos de compra.",
        "example": "Durante el crash de COVID-19 en marzo 2020, el VIX llegó a 85 — el nivel más alto de su historia. Quienes compraron S&P 500 en ese punto vieron retornos del 100%+ en los siguientes 18 meses.",
    },
]


async def send_educational_emails():
    """Biweekly (1st and 15th of month) — rotating educational concept email to all users."""
    if not settings.resend_api_key:
        return
    from app.core.database import get_supabase, run_query
    from app.services.email_service import build_educational_email_html
    db = get_supabase()
    today = datetime.now(timezone.utc).date()
    # Only run on 1st and 15th
    if today.day not in (1, 15):
        return
    # Pick concept: day-1 = first half of month, day-15 = second half
    # Rotate through concepts by (year * 24 + month * 2 + (0 if day==1 else 1))
    idx = (today.year * 24 + (today.month - 1) * 2 + (0 if today.day == 1 else 1)) % len(_EDUCATIONAL_CONCEPTS)
    concept_data = _EDUCATIONAL_CONCEPTS[idx]
    try:
        users_res  = await run_query(db.table("user_profiles").select("user_id,name"))
        auth_users = {u.id: u.email for u in await asyncio.to_thread(lambda: db.auth.admin.list_users())}
        sent = 0
        for u in (users_res.data or []):
            email = auth_users.get(u["user_id"])
            if not email:
                continue
            html = build_educational_email_html(
                name=u.get("name") or "Inversor",
                concept=concept_data["concept"],
                explanation=concept_data["explanation"],
                example=concept_data["example"],
            )
            ok = await send_email(email, f"📚 Concepto quincenal: {concept_data['concept']}", html)
            if ok:
                sent += 1
        logger.info("Educational emails: %d sent (concept #%d)", sent, idx)
    except Exception as e:
        logger.error("send_educational_emails failed: %s", e)


# ── Daily habit system — Sunday portfolio review ──────────────────────────────
async def job_sunday_portfolio_review():
    """Domingo 5:00 PM ET — resumen semanal del portafolio: cambio de valor
    vs. hace 7 días + top mover, usando los snapshots de fmg_portfolio_snapshots
    que ya se calculan a diario. Premium recibe una versión con IA que referencia
    su patrimonio y estilo declarado; free recibe la versión con solo datos."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    from app.services.portfolio_manager_service import _haiku_insight
    db = get_supabase()
    try:
        week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).date().isoformat()
        snap_res = await run_query(
            db.table("fmg_portfolio_snapshots")
            .select("user_id,snapshot_date,total_value,top_sector")
            .order("snapshot_date", desc=True)
            .limit(8000)
        )
        latest_by_user: dict[str, dict] = {}
        weekago_by_user: dict[str, dict] = {}
        for row in (snap_res.data or []):
            uid = row["user_id"]
            if uid not in latest_by_user:
                latest_by_user[uid] = row
            if row["snapshot_date"] <= week_ago and uid not in weekago_by_user:
                weekago_by_user[uid] = row

        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id,push_portfolio_alerts")
        )
        explicit_prefs = {p["user_id"]: p.get("push_portfolio_alerts", True) for p in (prefs_res.data or [])}

        uids = [uid for uid in latest_by_user if explicit_prefs.get(uid, True)]
        if not uids:
            return
        prof_res = await run_query(
            db.table("user_profiles")
            .select("user_id,name,subscription_tier,trial_started_at,investing_style,preferred_language")
            .in_("user_id", uids)
        )
        prof_map = {r["user_id"]: r for r in (prof_res.data or [])}

        sent = 0
        for uid in uids:
            latest = latest_by_user[uid]
            prev   = weekago_by_user.get(uid)
            total  = latest.get("total_value") or 0
            if total <= 0:
                continue
            prof  = prof_map.get(uid, {})
            first = (prof.get("name") or "Inversor").split()[0]
            is_prem = _is_premium_user(prof.get("subscription_tier", "free"), prof.get("trial_started_at"))
            is_en   = (prof.get("preferred_language") or "es") == "en"

            change_str = ""
            if prev and prev.get("total_value"):
                delta = total - prev["total_value"]
                pct   = delta / prev["total_value"] * 100 if prev["total_value"] else 0
                sign  = "+" if delta >= 0 else ""
                change_str = (
                    f" ({sign}${delta:,.0f}, {sign}{pct:.1f}% vs. 7 days ago)"
                    if is_en else
                    f" ({sign}${delta:,.0f}, {sign}{pct:.1f}% vs. hace 7 días)"
                )

            body = None
            if is_prem:
                style = prof.get("investing_style")
                if is_en:
                    style_note = f" Declared style: {style}." if style and style != "not_set" else ""
                    prompt = (
                        f"You are Nuvos' AI Portfolio Manager. Write ONE push notification (max 200 characters) "
                        f"as a weekly review for {first}: their portfolio is worth ${total:,.0f} USD{change_str}, "
                        f"their main sector is {latest.get('top_sector') or 'diversified'}.{style_note} "
                        f"End-of-week tone, no alarmism, invite them to check the details. "
                        f"No emojis at the start, don't mention \"Nuvos AI\", text only. Write in English."
                    )
                else:
                    style_note = f" Estilo declarado: {style}." if style and style != "not_set" else ""
                    prompt = (
                        f"Eres el Portfolio Manager IA de Nuvos. Escribe UNA notificación push (máximo 200 caracteres) "
                        f"de revisión semanal para {first}: su portafolio vale ${total:,.0f} USD{change_str}, "
                        f"su sector principal es {latest.get('top_sector') or 'diversificado'}.{style_note} "
                        f"Tono de cierre de semana, sin alarmismo, invita a revisar el detalle. "
                        f"Sin emojis al inicio, sin mencionar \"Nuvos AI\", solo el texto de la notificación."
                    )
                body = await _haiku_insight(prompt, max_tokens=120)
            if not body:
                body = (
                    f"Your portfolio closed the week at ${total:,.0f} USD{change_str}. Check the details on Nuvos."
                    if is_en else
                    f"Tu portafolio cerró la semana en ${total:,.0f} USD{change_str}. Revisa el detalle en Nuvos."
                )

            await send_push(
                uid, "sunday_portfolio_review",
                "📅 Your week on Nuvos" if is_en else "📅 Tu semana en Nuvos",
                body,
                {"screen": "portfolio"},
                db,
            )
            sent += 1
            await asyncio.sleep(random.uniform(0.05, 0.2))

        logger.info("Sunday portfolio review: %d sent", sent)
    except Exception as e:
        logger.error("job_sunday_portfolio_review failed: %s", e)


_BENCHMARK_MIN_SAMPLE = 5  # never store/serve a cohort distribution smaller than this — privacy floor


def _benchmark_cohort(risk_tolerance: str | None) -> str:
    r = (risk_tolerance or "moderate").lower()
    if "conserv" in r:
        return "conservative"
    if "agres" in r or "aggres" in r:
        return "aggressive"
    return "moderate"


async def job_compute_benchmarks():
    """Domingo 6:00 AM ET — recalcula las distribuciones anónimas de retorno
    acumulado y constancia por cohorte de riesgo (conservador/moderado/
    agresivo), usadas para el benchmarking entre inversionistas ("le ganas
    al 62% de inversionistas con tu perfil"). Solo usuarios Premium con
    portafolio (mismo universo que ya usa el Investor Progress Engine).
    Nunca se guarda qué valor pertenece a qué usuario — solo la distribución
    agregada y anónima de cada cohorte."""
    from app.core.database import get_supabase, run_query
    from app.services import investor_progress_service
    db = get_supabase()
    try:
        prof_res = await run_query(
            db.table("user_profiles").select("user_id,risk_tolerance,subscription_tier,trial_started_at")
        )
        candidates = [
            r for r in (prof_res.data or [])
            if r.get("risk_tolerance") and _is_premium_user(r.get("subscription_tier", "free"), r.get("trial_started_at"))
        ]
        if not candidates:
            return

        port_res = await run_query(db.table("user_portfolio").select("user_id"))
        has_portfolio = {r["user_id"] for r in (port_res.data or [])}
        candidates = [r for r in candidates if r["user_id"] in has_portfolio]
        if not candidates:
            return

        return_by_cohort: dict[str, list[float]] = {"conservative": [], "moderate": [], "aggressive": []}
        streak_by_cohort: dict[str, list[float]] = {"conservative": [], "moderate": [], "aggressive": []}

        sem = asyncio.Semaphore(8)  # bounds concurrent network-bound progress computations

        async def _one(uid: str, cohort: str):
            async with sem:
                try:
                    summary = await investor_progress_service.compute_progress_summary(uid)
                except Exception:
                    return
                if "cumulative_return_pct" in summary:
                    return_by_cohort[cohort].append(summary["cumulative_return_pct"])
                if "consecutive_months_contributing" in summary:
                    streak_by_cohort[cohort].append(float(summary["consecutive_months_contributing"]))

        await asyncio.gather(*[_one(r["user_id"], _benchmark_cohort(r["risk_tolerance"])) for r in candidates])

        stored = 0
        now_iso = datetime.now(timezone.utc).isoformat()
        for metric_key, by_cohort in (
            ("cumulative_return_pct", return_by_cohort),
            ("consecutive_months_contributing", streak_by_cohort),
        ):
            for cohort, values in by_cohort.items():
                if len(values) < _BENCHMARK_MIN_SAMPLE:
                    continue
                await run_query(
                    db.table("benchmark_cohort_stats").upsert(
                        {
                            "cohort_key": cohort,
                            "metric_key": metric_key,
                            "values": sorted(values),
                            "sample_size": len(values),
                            "computed_at": now_iso,
                        },
                        on_conflict="cohort_key,metric_key",
                    )
                )
                stored += 1

        logger.info("Benchmark cohorts: %d distributions stored from %d users", stored, len(candidates))
    except Exception as e:
        logger.error("job_compute_benchmarks failed: %s", e)


# ── Daily habit system — quarterly earnings season digest ────────────────────
async def job_quarterly_earnings_digest():
    """Día 5 de enero/abril/julio/octubre, 9:00 AM ET — resumen de qué activos
    del usuario reportan ganancias esta temporada (los próximos ~45 días),
    reutilizando el mismo calendario de earnings que ya usa el preview diario."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    from app.api.routes.earnings import _fetch_events_for_symbol
    db = get_supabase()
    try:
        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("push_portfolio_alerts", True)
        )
        uids = [r["user_id"] for r in (prefs_res.data or [])]
        if not uids:
            return

        lang_res = await run_query(
            db.table("user_profiles").select("user_id,preferred_language").in_("user_id", uids)
        )
        lang_map = {r["user_id"]: (r.get("preferred_language") or "es") for r in (lang_res.data or [])}

        window_end = (datetime.now(timezone.utc) + timedelta(days=45)).date()
        today = datetime.now(timezone.utc).date()

        sent = 0
        for i, uid in enumerate(uids):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if not port_res.data:
                continue
            positions = _agg_positions(port_res.data or [])
            tickers = [p["ticker"] for p in positions if p.get("ticker")]
            if not tickers:
                continue

            reporting: list[str] = []
            for ticker in tickers[:20]:
                events = await asyncio.to_thread(_fetch_events_for_symbol, ticker)
                for ev in events:
                    if ev.get("event_type") == "earnings":
                        try:
                            ev_date = datetime.strptime(ev["event_date"], "%Y-%m-%d").date()
                        except Exception:
                            continue
                        if today <= ev_date <= window_end:
                            reporting.append(ticker)
                            break

            if not reporting:
                continue
            is_en = lang_map.get(uid, "es") == "en"
            names = ", ".join(reporting[:5])
            if is_en:
                extra = f" and {len(reporting) - 5} more" if len(reporting) > 5 else ""
                body = f"Reporting this earnings season: {names}{extra}. Get ready by reviewing expectations on Nuvos."
                push_title = "📈 Earnings season"
            else:
                extra = f" y {len(reporting) - 5} más" if len(reporting) > 5 else ""
                body = f"Esta temporada de earnings reportan: {names}{extra}. Prepárate revisando expectativas en Nuvos."
                push_title = "📈 Temporada de resultados"
            await send_push(
                uid, "quarterly_earnings_digest",
                push_title,
                body,
                {"screen": "portfolio"},
                db,
            )
            sent += 1
            await asyncio.sleep(random.uniform(0.05, 0.2))

        logger.info("Quarterly earnings digest: %d sent", sent)
    except Exception as e:
        logger.error("job_quarterly_earnings_digest failed: %s", e)


async def job_fmg_snapshot():
    """Daily at 16:05 ET — take portfolio snapshots for all active users."""
    from app.services import fmg_service
    try:
        await fmg_service.snapshot_all_active_users()
        logger.info("FMG portfolio snapshots done")
    except Exception as e:
        logger.error("job_fmg_snapshot failed: %s", e)


async def job_cleanup_analytics():
    """Hourly — delete notification_log entries older than 90 days."""
    from app.core.database import get_supabase, run_query
    from datetime import timedelta
    db = get_supabase()
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
        await run_query(db.table("notification_log").delete().lt("sent_at", cutoff))
        logger.debug("Analytics cleanup done")
    except Exception as e:
        logger.warning("Analytics cleanup failed: %s", e)


async def _backfill_notification_prefs():
    """Insert default prefs for users who don't have a row, and bump the daily
    push cap for existing users who still have the old limit of 5."""
    from app.core.database import get_supabase, run_query
    from app.api.routes.notification_settings import _DEFAULT_PREFS
    try:
        db = get_supabase()
        existing = await run_query(db.table("notification_preferences").select("user_id,max_push_per_day"))
        existing_rows = existing.data or []
        existing_ids  = {r["user_id"] for r in existing_rows}

        all_users = await run_query(db.table("user_profiles").select("user_id"))
        missing = [r["user_id"] for r in (all_users.data or []) if r["user_id"] not in existing_ids]

        if missing:
            rows = [{**_DEFAULT_PREFS, "user_id": uid} for uid in missing]
            for i in range(0, len(rows), 100):
                await run_query(db.table("notification_preferences").insert(rows[i:i+100]))
            logger.info("Notification prefs backfill: inserted %d rows", len(missing))
        else:
            logger.info("Notification prefs backfill: all users already have a row")

        # Bump cap from old default (5) to new default (15) for existing users
        stale = [r["user_id"] for r in existing_rows if (r.get("max_push_per_day") or 0) < 15]
        if stale:
            for uid in stale:
                await run_query(
                    db.table("notification_preferences")
                    .update({"max_push_per_day": 15, "max_push_per_week": 60})
                    .eq("user_id", uid)
                )
            logger.info("Notification prefs backfill: bumped push cap for %d users", len(stale))
    except Exception as e:
        logger.warning("Notification prefs backfill failed: %s", e)


async def _send_mobile_push(uid: str, category: str, title: str, body: str, data: dict, db) -> bool:
    """Send push notification to mobile (Expo) only — skips web push entirely."""
    from app.core.database import run_query
    from app.services.notification_engine import can_send_push, _log_notification, _today_et
    from app.services.push_service import send_push as _expo_push
    if not await can_send_push(uid, category, db):
        return False
    tok_res = await run_query(db.table("user_profiles").select("push_token").eq("user_id", uid))
    token = (tok_res.data[0].get("push_token") or "") if tok_res.data else ""
    if not token or not token.startswith("ExponentPushToken"):
        return False
    try:
        await _expo_push(token, title=title, body=body, data={**data, "category": category})
        dedup_key = f"{uid}:{category}:{_today_et()}"
        await _log_notification(db, uid, "push", category, title, body, data, "sent", dedup_key=dedup_key)
        return True
    except Exception as e:
        logger.warning("_send_mobile_push failed for %s: %s", uid, e)
        return False


async def job_proactive_vs_market():
    """4:45 PM ET Mon-Fri — alert users whose portfolio moved significantly vs S&P today."""
    from app.core.database import get_supabase, run_query
    import httpx
    db = get_supabase()
    try:
        # Fetch S&P 500 daily change
        sp_pct: float | None = None
        try:
            r = httpx.get(
                "https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC",
                params={"interval": "1d", "range": "2d"},
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=10,
            )
            data = r.json()
            closes = data["chart"]["result"][0]["indicators"]["quote"][0]["close"]
            closes = [c for c in closes if c is not None]
            if len(closes) >= 2:
                sp_pct = (closes[-1] - closes[-2]) / closes[-2] * 100
        except Exception:
            pass

        if sp_pct is None:
            return

        users_res = await run_query(
            db.table("notification_preferences")
            .select("user_id")
            .eq("push_ai_recommendations", True)
        )
        user_ids = [r["user_id"] for r in (users_res.data or [])]
        if not user_ids:
            return

        prof_res = await run_query(
            db.table("user_profiles")
            .select("user_id,name,subscription_tier,mentor,preferred_language")
            .in_("user_id", user_ids)
        )
        premium_ids = {p["user_id"] for p in (prof_res.data or []) if p.get("subscription_tier") == "premium"}
        lang_map = {p["user_id"]: (p.get("preferred_language") or "es") for p in (prof_res.data or [])}

        sent = 0
        for uid in premium_ids:
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if not port_res.data:
                continue
            positions = _agg_positions(port_res.data)
            if not positions:
                continue

            # Compute portfolio daily change
            tickers = [p["ticker"] for p in positions if p.get("ticker")]
            if not tickers:
                continue
            try:
                prices = await asyncio.to_thread(_batch_prices, tickers[:20])
            except Exception:
                continue

            total_val = day_gain_val = 0.0
            for p in positions:
                t = p.get("ticker", "")
                q = prices.get(t) or {}
                price = q.get("price") or 0
                prev  = q.get("prev_close") or price
                shares = p.get("shares") or 0
                val   = price * shares
                total_val   += val
                day_gain_val += (price - prev) * shares

            if total_val == 0:
                continue
            port_pct = (day_gain_val / total_val) * 100
            diff = port_pct - sp_pct

            # Only notify if divergence > 1.5%
            if abs(diff) < 1.5:
                continue

            sign = "+" if day_gain_val >= 0 else ""
            sp_sign = "+" if sp_pct >= 0 else ""
            is_en = lang_map.get(uid, "es") == "en"
            if is_en:
                if diff > 0:
                    msg = f"Your portfolio rose {sign}{port_pct:.1f}% today vs S&P {sp_sign}{sp_pct:.1f}%. Want me to analyze what drove it?"
                else:
                    msg = f"Your portfolio fell {port_pct:.1f}% vs S&P {sp_sign}{sp_pct:.1f}%. Want me to explain the difference?"
                push_title = "📊 Your portfolio vs the market today"
            else:
                if diff > 0:
                    msg = f"Tu portafolio subió {sign}{port_pct:.1f}% hoy vs S&P {sp_sign}{sp_pct:.1f}%. ¿Quieres que analice qué lo impulsó?"
                else:
                    msg = f"Tu portafolio bajó {port_pct:.1f}% vs S&P {sp_sign}{sp_pct:.1f}%. ¿Quieres que te explique la diferencia?"
                push_title = "📊 Tu portafolio vs el mercado hoy"

            encoded_msg = msg.replace("&", "%26").replace("?", "%3F")
            ok = await _send_mobile_push(
                uid, "proactive_vs_market",
                push_title,
                msg,
                {"screen": "chat", "msg": encoded_msg},
                db,
            )
            if ok:
                sent += 1
            await asyncio.sleep(0.05)

        logger.info("job_proactive_vs_market: %d notifications sent (S&P %.2f%%)", sent, sp_pct)
    except Exception as e:
        logger.error("job_proactive_vs_market failed: %s", e)


async def job_proactive_earnings_preview():
    """8:30 AM ET Mon-Fri — warn users about earnings TODAY or TOMORROW for their holdings."""
    from app.core.database import get_supabase, run_query
    from app.api.routes.earnings import _fetch_events_for_symbol
    db = get_supabase()
    today     = datetime.now(timezone.utc).date()
    tomorrow  = today + timedelta(days=1)
    target_dates = {str(today), str(tomorrow)}
    try:
        users_res = await run_query(
            db.table("notification_preferences")
            .select("user_id")
            .eq("push_portfolio_alerts", True)
        )
        user_ids = [r["user_id"] for r in (users_res.data or [])]

        prof_res = await run_query(
            db.table("user_profiles")
            .select("user_id,subscription_tier,preferred_language")
            .in_("user_id", user_ids)
        )
        premium_ids = {p["user_id"] for p in (prof_res.data or []) if p.get("subscription_tier") == "premium"}
        lang_map = {p["user_id"]: (p.get("preferred_language") or "es") for p in (prof_res.data or [])}

        sent = 0
        for uid in premium_ids:
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if not port_res.data:
                continue
            positions = _agg_positions(port_res.data)
            tickers = [p["ticker"] for p in positions if p.get("ticker")]
            if not tickers:
                continue

            is_en = lang_map.get(uid, "es") == "en"
            hits: list[dict] = []
            for ticker in tickers[:20]:
                events = await asyncio.to_thread(_fetch_events_for_symbol, ticker)
                for ev in events:
                    if ev.get("event_type") == "earnings" and ev.get("event_date") in target_dates:
                        pos = next((p for p in positions if p["ticker"] == ticker), {})
                        hits.append({
                            "ticker": ticker,
                            "date": ev["event_date"],
                            "shares": pos.get("shares", 0),
                            "eps_est": ev.get("eps_estimate"),
                        })

            if not hits:
                continue

            for hit in hits[:3]:
                if is_en:
                    when = "today" if hit["date"] == str(today) else "tomorrow"
                    shares_str = f" · You hold {hit['shares']:.0f} shares" if hit["shares"] else ""
                    eps_str = f" · EPS est. ${hit['eps_est']}" if hit.get("eps_est") else ""
                    msg = f"{hit['ticker']} reports earnings {when}{shares_str}{eps_str}. Want me to explain what to watch for?"
                    push_title = f"📅 {hit['ticker']} reports {when}"
                else:
                    when = "hoy" if hit["date"] == str(today) else "mañana"
                    shares_str = f" · Tienes {hit['shares']:.0f} acciones" if hit["shares"] else ""
                    eps_str = f" · EPS est. ${hit['eps_est']}" if hit.get("eps_est") else ""
                    msg = f"{hit['ticker']} reporta earnings {when}{shares_str}{eps_str}. ¿Quieres que te explique qué vigilar?"
                    push_title = f"📅 {hit['ticker']} reporta {when}"
                encoded = msg.replace("&", "%26").replace("?", "%3F")
                ok = await _send_mobile_push(
                    uid, "earnings_preview",
                    push_title,
                    msg,
                    {"screen": "chat", "msg": encoded},
                    db,
                )
                if ok:
                    sent += 1
                await asyncio.sleep(0.05)

        logger.info("job_proactive_earnings_preview: %d sent", sent)
    except Exception as e:
        logger.error("job_proactive_earnings_preview failed: %s", e)


# ── Deep Research job queue worker ────────────────────────────────────────────
#
# Deep Research jobs are claimed atomically from Postgres (see
# claim_research_job() in migrations/034_research_job_queue.sql — FOR UPDATE
# SKIP LOCKED) and run HERE, in this always-single-instance process, instead
# of via a fire-and-forget asyncio.create_task in the web request that called
# /api/research/start. That's what makes an in-flight paid research job
# survive a Railway restart/redeploy of the web service: nothing about
# running the pipeline lives in the web process anymore, only the durable
# job row does. This same claim-based design is also what makes it safe to
# later run MULTIPLE worker instances for true horizontal scaling (to
# "hundreds of simultaneous jobs," per the product requirement) — SKIP
# LOCKED guarantees two workers can never claim the same row, so scaling out
# is just "run more of this process," no code change required.
_RESEARCH_MAX_CONCURRENT = int(os.getenv("RESEARCH_MAX_CONCURRENT_JOBS", "5"))
_research_tasks: set[asyncio.Task] = set()


async def job_deep_research_worker():
    """Ticked every 10s (see scheduler.add_job below). Tops up concurrently-
    running Deep Research jobs up to _RESEARCH_MAX_CONCURRENT by claiming
    pending jobs and running each as its own task."""
    from app.services import research_service
    _research_tasks.difference_update({t for t in list(_research_tasks) if t.done()})
    open_slots = _RESEARCH_MAX_CONCURRENT - len(_research_tasks)
    for _ in range(max(0, open_slots)):
        try:
            job = await research_service.claim_one_job()
        except Exception as e:
            logger.error("claim_one_job failed: %s", e)
            break
        if not job:
            break
        task = asyncio.create_task(research_service.run_claimed_job(job))
        _research_tasks.add(task)
        task.add_done_callback(_research_tasks.discard)
        logger.info("Deep Research job %s claimed and started (worker now running %d)", job["id"], len(_research_tasks))


async def job_reap_stale_research_jobs():
    """Every 5 minutes: requeue (or permanently fail + auto-refund) any job
    whose claiming worker went silent — see reap_stale_research_jobs() in
    migrations/034_research_job_queue.sql and research_service.reap_stale_jobs()."""
    try:
        from app.services import research_service
        await research_service.reap_stale_jobs()
    except Exception as e:
        logger.error("job_reap_stale_research_jobs failed: %s", e)


async def main():
    # misfire_grace_time: if Railway restarts the worker near a job's fire time,
    # APScheduler will still run the job if it missed by less than this window.
    scheduler = AsyncIOScheduler(job_defaults={"misfire_grace_time": 600})

    # ── 7 days/week: major geopolitical/macro/corporate news alerts ─────────────
    # Mandatory 5/day, one per fixed window (see _MAJOR_NEWS_WINDOWS) — 5
    # separate cron triggers at each window's start (8am/11am/2pm/5pm/8pm ET).
    # Deliberately includes weekends — unlike the market-hours jobs below,
    # geopolitical/macro news doesn't pause when markets are closed.
    for _window_start_hour in (w[0] for w in _MAJOR_NEWS_WINDOWS):
        scheduler.add_job(job_major_news_alert, "cron", hour=_window_start_hour, minute=0, timezone="America/New_York")

    # ── Mon-Fri: core daily jobs ──────────────────────────────────────────────
    scheduler.add_job(job_ipo_alerts,            "cron",                        hour=7,       minute=45,    timezone="America/New_York")
    scheduler.add_job(job_events_alerts,        "cron", day_of_week="mon-fri", hour=8,       minute=0,     timezone="America/New_York")
    scheduler.add_job(job_earnings_bmo,         "cron", day_of_week="mon-fri", hour=9,       minute=15,    timezone="America/New_York")
    scheduler.add_job(job_market_open,          "cron", day_of_week="mon-fri", hour=9,       minute=30,    timezone="America/New_York")
    scheduler.add_job(job_holiday_midday,       "cron", day_of_week="mon-fri", hour=12,      minute=0,     timezone="America/New_York")
    # Market opens 9:30 ET — first two runs (9:30, 9:35) get their own cron
    # since a single hour="9-15" field can't start mid-hour; 10-15 continues
    # the normal every-5-min cadence.
    scheduler.add_job(job_portfolio_alerts,     "cron", day_of_week="mon-fri", hour=9,       minute="30,35,40,45,50,55", timezone="America/New_York")
    scheduler.add_job(job_portfolio_alerts,     "cron", day_of_week="mon-fri", hour="10-15", minute="*/5", timezone="America/New_York")
    scheduler.add_job(job_market_close,         "cron", day_of_week="mon-fri", hour=16,      minute=0,     timezone="America/New_York")
    scheduler.add_job(job_earnings_results,     "cron", day_of_week="mon-fri", hour=16,      minute=30,    timezone="America/New_York")
    scheduler.add_job(job_daily_email,          "cron", day_of_week="fri",     hour=18,      minute=0,     timezone="America/New_York")

    # ── Saturday: weekly screener (premium only) ──────────────────────────────
    scheduler.add_job(job_weekly_screener_push, "cron", day_of_week="sat",     hour=11,      minute=0,     timezone="America/New_York")

    # ── Sunday: undervalued-stocks screener cache refresh (real DCF engine) ───
    scheduler.add_job(job_refresh_undervalued_screener, "cron", day_of_week="sun", hour=12,  minute=5,     timezone="America/New_York")

    # ── AI Portfolio Manager — proactive alerts (written earlier, now scheduled) ──
    scheduler.add_job(job_risk_mgmt_push,        "cron", day_of_week="fri",     hour=15, minute=0, timezone="America/New_York")
    scheduler.add_job(job_market_crash_alert,    "cron", day_of_week="mon-fri", hour="9-15", minute="*/5", timezone="America/New_York")
    scheduler.add_job(job_reengagement_push,     "cron",                        hour=11, minute=0, timezone="America/New_York")

    # ── Daily habit system ──────────────────────────────────────────────────────
    scheduler.add_job(job_sunday_portfolio_review,   "cron", day_of_week="sun", hour=17, minute=0,  timezone="America/New_York")
    scheduler.add_job(job_compute_benchmarks,        "cron", day_of_week="sun", hour=6,  minute=0,  timezone="America/New_York")
    scheduler.add_job(job_quarterly_earnings_digest, "cron", month="1,4,7,10", day=5, hour=9, minute=0, timezone="America/New_York")

    # ── Specials ──────────────────────────────────────────────────────────────
    scheduler.add_job(send_birthday_emails,     "cron",                     hour=8,       minute=0,     timezone="America/New_York")

    # ── Proactive Mentor IA ───────────────────────────────────────────────────
    scheduler.add_job(job_proactive_vs_market,        "cron", day_of_week="mon-fri", hour=16, minute=45, timezone="America/New_York")
    scheduler.add_job(job_proactive_earnings_preview, "cron", day_of_week="mon-fri", hour=8,  minute=30, timezone="America/New_York")

    # ── Financial Memory Graph — daily portfolio snapshot ─────────────────────
    scheduler.add_job(job_fmg_snapshot,         "cron", day_of_week="mon-fri", hour=16, minute=5, timezone="America/New_York")

    # ── Cleanup ───────────────────────────────────────────────────────────────
    scheduler.add_job(job_cleanup_analytics,    "interval", hours=1)

    # ── Deep Research job queue (see job_deep_research_worker's docstring) ────
    scheduler.add_job(job_deep_research_worker,          "interval", seconds=10)
    scheduler.add_job(job_reap_stale_research_jobs,      "interval", minutes=5)

    # Backfill notification_preferences for existing users who never opened settings.
    # Without this row the worker can't find them and push never fires.
    asyncio.create_task(_backfill_notification_prefs())

    # Populate the undervalued-stocks screener immediately if the cache is
    # empty (fresh deploy, flushed Redis) — never wait until the next
    # scheduled Sunday run to have real data for users to see.
    from app.services.undervalued_screener_service import refresh_if_empty_on_startup
    asyncio.create_task(refresh_if_empty_on_startup())

    scheduler.start()
    logger.info("Worker started — %d jobs scheduled", len(scheduler.get_jobs()))
    try:
        while True:
            await asyncio.sleep(60)
    except (KeyboardInterrupt, SystemExit):
        scheduler.shutdown()
        logger.info("Worker stopped")


if __name__ == "__main__":
    asyncio.run(main())
