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
    generate_and_send_weekly_summary, generate_and_send_monthly_report,
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
    """Consistent premium check used by all notification jobs.
    Covers: explicit premium/pro tier, and active 90-day trial."""
    if tier in ("premium", "pro"):
        return True
    if trial_started:
        try:
            from datetime import datetime as _dt, timezone as _tz
            started = _dt.fromisoformat(trial_started.replace("Z", "+00:00"))
            return (_dt.now(_tz.utc) - started).days < 90
        except Exception:
            pass
    return False


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
    "TXN": "Texas Instruments","MU": "Micron",           "AMAT": "Applied Materials",
}


def _company_name(ticker: str) -> str:
    return _COMPANY_NAMES.get(ticker, ticker)


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


async def send_monthly_reports():
    """Email monthly report — 1st of each month.
    Premium: full AI portfolio analysis. Free: general market summary + upgrade CTA."""
    if not settings.resend_api_key:
        logger.info("RESEND_API_KEY not set — skipping monthly reports")
        return
    from app.core.database import get_supabase, run_query
    from app.services.email_service import send_email
    from datetime import datetime, timezone
    db = get_supabase()
    try:
        users_res = await run_query(
            db.table("user_profiles").select("user_id,name,subscription_tier,trial_started_at")
        )
        users = users_res.data
        auth_users = {u.id: u.email for u in await asyncio.to_thread(lambda: db.auth.admin.list_users())}
        month_name = datetime.now(timezone.utc).strftime("%B %Y")
        sent = errors = skipped = 0
        for u in users:
            email = auth_users.get(u["user_id"])
            if not email:
                skipped += 1
                continue
            name = (u.get("name") or "Inversor").split()[0]
            is_premium = _is_premium_user(u.get("subscription_tier") or "free", u.get("trial_started_at"))
            try:
                if is_premium:
                    ok = await generate_and_send_monthly_report(
                        user_id=u["user_id"],
                        email=email,
                        name=u.get("name") or "Inversor",
                    )
                    if ok:
                        sent += 1
                    else:
                        skipped += 1
                else:
                    html = f"""<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nuvos AI</title></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
  <div style="border-radius:20px;overflow:hidden;border:1px solid #2a2d3a">
    <div style="background:linear-gradient(135deg,#0d1f14,#0f2a1a);padding:28px 32px;text-align:center;border-bottom:1px solid #1e3a28">
      <img src="https://www.nuvosai.com/logo.png" alt="Nuvos AI" width="48" height="48" style="display:block;margin:0 auto 10px;border-radius:12px"/>
      <p style="margin:0;color:#00d47e;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase">Nuvos AI · Reporte Mensual</p>
    </div>
    <div style="background:#161b27;padding:28px 32px">
      <h1 style="color:#fff;font-size:20px;font-weight:900;margin:0 0 4px;letter-spacing:-0.3px">Hola {name}, así fue {month_name} 📅</h1>
      <p style="color:#6b7280;font-size:13px;margin:0 0 24px">Cerramos otro mes. Los usuarios Premium ya tienen su análisis completo.</p>
      <div style="background:#111318;border:1px solid rgba(0,212,126,0.2);border-radius:14px;padding:20px;margin-bottom:20px">
        <p style="color:#00d47e;font-size:10px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 12px">📊 Reporte Premium incluye:</p>
        <p style="color:#d1d5db;font-size:13px;line-height:1.75;margin:0">
          ✅ Tu portafolio vs S&amp;P 500 y NASDAQ — rendimiento real del mes<br>
          ✅ Análisis IA de tus mejores y peores posiciones<br>
          ✅ 4 ideas de inversión personalizadas para el próximo mes<br>
          ✅ Mentor IA ilimitado para analizar cualquier acción
        </p>
      </div>
      <div style="text-align:center;margin-bottom:20px">
        <a href="https://nuvosai.com/portfolio" style="display:inline-block;background:#00d47e;color:#000;font-weight:900;font-size:14px;padding:13px 28px;border-radius:12px;text-decoration:none">Activar Premium →</a>
      </div>
      <div style="border-top:1px solid #2a2d3a;padding-top:16px;text-align:center">
        <p style="color:#00a85e;font-size:12px;font-weight:700;margin:0 0 4px">Con Nuvos, construye tu futuro.</p>
        <p style="color:#374151;font-size:11px;margin:0">Nuvos AI · Solo educativo. No constituye asesoramiento financiero profesional.</p>
      </div>
    </div>
  </div>
</div>
</body></html>"""
                    ok = await send_email(email, f"📊 Tu resumen mensual {month_name} — Nuvos AI", html)
                    if ok:
                        sent += 1
                    else:
                        skipped += 1
            except Exception as e:
                logger.error("Monthly report failed for %s: %s", u["user_id"], e)
                errors += 1
        logger.info("Monthly reports — sent: %d, skipped: %d, errors: %d", sent, skipped, errors)
    except Exception as e:
        logger.error("Monthly report job failed: %s", e)


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
    except Exception:
        pass
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
    except Exception:
        pass
    return []


async def job_market_open():
    """9:30 AM ET weekdays — personalized open alert for ALL users.
    Uses SPY/QQQ as S&P 500/Nasdaq proxies (^GSPC/^IXIC blocked on Railway).
    Uses _batch_fetch_prices (Nasdaq API) for all prices — works at open."""
    if not _is_market_open_today():
        logger.info("job_market_open: market closed today — skipping")
        return

    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    try:
        # SPY ≈ S&P 500, QQQ ≈ Nasdaq 100 — via Finnhub (Railway-safe)
        spy_q = await asyncio.to_thread(_finnhub_quote, "SPY")
        qqq_q = await asyncio.to_thread(_finnhub_quote, "QQQ")
        sp500_pct  = spy_q["pct"] if spy_q else None
        nasdaq_pct = qqq_q["pct"] if qqq_q else None

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
            .select("user_id,name,subscription_tier,trial_started_at").in_("user_id", uids)
        )
        name_map      = {r["user_id"]: (r.get("name") or "Inversor").split()[0] for r in (profiles_res.data or [])}
        premium_map   = {r["user_id"]: _is_premium_user(r.get("subscription_tier") or "free", r.get("trial_started_at")) for r in (profiles_res.data or [])}

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

        sp_str = f"{sp500_pct:+.1f}%" if sp500_pct is not None else "s/d"
        nq_str = f"{nasdaq_pct:+.1f}%" if nasdaq_pct is not None else "s/d"

        sent = 0
        for i, uid in enumerate(uids):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.1))

            first      = name_map.get(uid, "Inversor")
            is_premium = premium_map.get(uid, False)

            if is_premium:
                user_pct = _calc_portfolio_pct(portfolio_map.get(uid, []), prices)
                if user_pct is not None:
                    port_str = f"{user_pct:+.1f}%"
                    body = f"S&P 500 {sp_str} · Nasdaq {nq_str} · Tu portafolio {port_str}"
                else:
                    body = f"S&P 500 {sp_str} · Nasdaq {nq_str} · Agrega tu portafolio para ver tu rendimiento."
            else:
                body = f"Buenos días {first}! S&P 500 {sp_str} · Nasdaq {nq_str}. Activa Premium para ver el rendimiento de tu portafolio."

            await send_push(uid, "market_open", "🔔 Mercado Abierto", body, {"screen": "portfolio"}, db)
            sent += 1
        logger.info("Market open push: %d sent | SPY %s | QQQ %s", sent, sp500_pct, nasdaq_pct)
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
            db.table("user_profiles").select("user_id,name").in_("user_id", uids)
        )
        name_map = {r["user_id"]: (r.get("name") or "Inversor").split()[0] for r in (profiles_res.data or [])}

        for uid in uids:
            first = name_map.get(uid, "Inversor")
            title = "Hoy la bolsa descansa 🏖️"
            body = f"{first}, buen momento para analizar tus acciones sin la presión del mercado. ¿Cómo va tu portafolio?"
            await send_push(uid, "holiday_midday", title, body, {"screen": "portfolio"}, db)
            await asyncio.sleep(0.05)

        logger.info("job_holiday_midday: sent to %d users", len(uids))
    except Exception as e:
        logger.error("job_holiday_midday failed: %s", e)


async def job_market_open_reminder():
    """11:30 AM ET weekdays — reminder only to users who haven't opened the app."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    from datetime import timedelta
    import random
    db = get_supabase()
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id,last_opened_app").eq("push_market_open", True)
        )
        sent = 0
        for i, row in enumerate(prefs_res.data or []):
            last = row.get("last_opened_app") or ""
            if last >= cutoff:
                continue  # already opened today
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))
            await send_push(
                row["user_id"], "market_open_reminder",
                "Mercado activo", "Los mercados siguen abiertos. ¿Ya revisaste tu portafolio?",
                {"screen": "portfolio"}, db,
            )
            sent += 1
        logger.info("Market open reminder: %d sent", sent)
    except Exception as e:
        logger.error("job_market_open_reminder failed: %s", e)


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

        # ── 3. Profiles: name + email + tier in one query ────────────────────────────
        profiles_res = await run_query(
            db.table("user_profiles")
            .select("user_id,name,email,subscription_tier,trial_started_at").in_("user_id", uids)
        )
        profile_map = {
            r["user_id"]: {
                "first":      (r.get("name") or "Inversor").split()[0],
                "email":      r.get("email") or "",
                "is_premium": _is_premium_user(r.get("subscription_tier") or "free", r.get("trial_started_at")),
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

            if is_premium and has_portfolio:
                # Premium: personalized push only (email goes out Fridays via job_daily_email)
                user_pct, total_curr, top_gainers, top_losers = _calc_portfolio_close_data(
                    portfolio_map[uid], prices
                )
                if uid in push_capable:
                    sp_cl  = f"{sp500_pct:+.1f}%"  if sp500_pct  is not None else "s/d"
                    nq_cl  = f"{nasdaq_pct:+.1f}%"  if nasdaq_pct is not None else "s/d"
                    if user_pct is not None:
                        beating    = sp500_pct is not None and user_pct > sp500_pct
                        push_title = "🏆 Superaste al mercado hoy" if beating else "📊 Cierre de mercado"
                        push_body  = f"S&P 500 {sp_cl} · Nasdaq {nq_cl} · Tu portafolio {user_pct:+.1f}%"
                    else:
                        push_title = "📊 Cierre de mercado"
                        push_body  = f"S&P 500 {sp_cl} · Nasdaq {nq_cl}"
                    await send_push(uid, "market_close", push_title, push_body, {"screen": "portfolio"}, db)
                    sent_push += 1

            elif uid in push_capable:
                # Free: generic push only, no portfolio data, subtle upgrade nudge
                body = f"El mercado cerró. {indices}. Con Premium puedes ver el rendimiento exacto de tu portafolio. 📊"
                await send_push(uid, "market_close", "📊 El mercado ha cerrado", body, {"screen": "portfolio"}, db)
                sent_push += 1

        logger.info(
            "Market close: %d total | %d push | %d email | S&P %s | NQ %s",
            len(all_uids), sent_push, sent_email, sp500_pct, nasdaq_pct,
        )
    except Exception as e:
        logger.error("job_market_close failed: %s", e)


async def _generate_market_wrap(sp_pct: float | None, nq_pct: float | None, top_movers: list[dict]) -> str:
    """Generate a 2-3 paragraph market wrap narrative, shared across all users."""
    try:
        import anthropic
        from app.services.price_alert_service import fetch_ticker_news

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
        news_str = "\n".join(news_lines) if news_lines else "Sin noticias disponibles."

        moves_str = "\n".join(
            f"- {x['ticker']}: {x.get('pct', x.get('day_pct', 0)):+.2f}%"
            for x in top_movers[:8]
        )

        prompt = f"""Eres un analista financiero escribiendo el Market Wrap del día para inversores latinoamericanos.

Datos del mercado hoy:
{market_str}

Noticias y movimientos relevantes:
{news_str}

Principales movimientos:
{moves_str}

Escribe un resumen narrativo del día en 2 párrafos cortos (3-4 oraciones cada uno):
- Párrafo 1: Qué pasó hoy en el mercado y por qué (macro, Fed, resultados, sector, etc.)
- Párrafo 2: Qué vigilar mañana o qué significa esto para los inversores

Español, tono analítico pero accesible. Sin viñetas, sin markdown, sin asteriscos. Solo párrafos."""

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
) -> str:
    """1-2 sentence earnings analysis for the daily email earnings section."""
    try:
        import anthropic
        eps_str = f"EPS ${eps_actual:.2f} vs ${eps_estimate:.2f} estimado" if eps_actual is not None and eps_estimate is not None else ""
        rev_str = f"Ingresos ${rev_actual_b:.2f}B vs ${rev_estimate_b:.2f}B" if rev_actual_b and rev_estimate_b else ""
        result  = "superó" if beat else "no alcanzó"
        beat_pct = round((eps_actual - eps_estimate) / abs(eps_estimate) * 100, 1) if eps_actual is not None and eps_estimate else None
        beat_str = f" (+{beat_pct:.1f}% vs consenso)" if beat and beat_pct else (f" ({beat_pct:.1f}% vs consenso)" if beat_pct else "")

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
        return (resp.content[0].text or "").strip()
    except Exception:
        return ""


async def _generate_daily_ai_summary(tickers_with_moves: list[dict], sp_pct: float | None, nq_pct: float | None) -> str:
    """Kept for backward compatibility — wraps _generate_market_wrap."""
    return await _generate_market_wrap(sp_pct, nq_pct, tickers_with_moves)


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
        # ^GSPC/^IXIC are IP-blocked on Railway via yfinance; use SPY/QQQ instead
        spy_q = await asyncio.to_thread(_finnhub_quote, "SPY")
        qqq_q = await asyncio.to_thread(_finnhub_quote, "QQQ")
        sp_pct = spy_q["pct"] if spy_q else None
        nq_pct = qqq_q["pct"] if qqq_q else None
        sp_px  = spy_q["curr"] if spy_q else None
        nq_px  = qqq_q["curr"] if qqq_q else None

        # ── 2. All users, excluding explicit opt-outs ─────────────────────────
        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id,email_daily_summary")
        )
        disabled = {p["user_id"] for p in (prefs_res.data or []) if p.get("email_daily_summary") is False}

        profiles_res = await run_query(
            db.table("user_profiles").select("user_id,name,subscription_tier")
        )
        all_profile_data = [r for r in (profiles_res.data or []) if r["user_id"] not in disabled]
        opted_ids = [r["user_id"] for r in all_profile_data]
        if not opted_ids:
            return

        name_map = {r["user_id"]: r.get("name") or "Inversor" for r in all_profile_data}
        tier_map = {r["user_id"]: (r.get("subscription_tier") or "free") for r in all_profile_data}

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
        # Fetch each ticker concurrently; _finnhub_quote returns {curr, prev, pct}
        async def _fq(t: str):
            q = await asyncio.to_thread(_finnhub_quote, t)
            return t, q

        price_results = await asyncio.gather(*[_fq(t) for t in all_tickers]) if all_tickers else []
        day_prices = {t: {"curr": q["curr"], "prev": q["prev"]} for t, q in price_results if q}

        # ── 6. Collect all unique tickers + watchlist for market wrap context ─
        watch_res   = await run_query(db.table("watchlist").select("user_id,ticker"))
        watch_by_uid: dict[str, set] = {}
        all_watch_tickers: set[str] = set()
        for r in (watch_res.data or []):
            watch_by_uid.setdefault(r["user_id"], set()).add(r["ticker"])
            all_watch_tickers.add(r["ticker"])

        # ── 7. Compute global top movers (all portfolio tickers combined) ─────
        global_movers: list[dict] = []
        for ticker, px in day_prices.items():
            if px.get("prev") and px["prev"] > 0:
                pct = round((px["curr"] - px["prev"]) / px["prev"] * 100, 2)
                global_movers.append({"ticker": ticker, "pct": pct})
        global_movers.sort(key=lambda x: abs(x["pct"]), reverse=True)

        # ── 8. Market Wrap — generated ONCE for all users ─────────────────────
        market_wrap = await _generate_market_wrap(sp_pct, nq_pct, global_movers)

        # ── 9. Today's earnings from Finnhub — fetched ONCE ──────────────────
        # At 6 PM both BMO (pre-market) and AMC (after-hours early) have likely reported
        all_today_earnings = await asyncio.to_thread(_finnhub_earnings_today, None)

        # Generate AI analysis per unique ticker that reported today (concurrent)
        earning_tickers = list(all_today_earnings.keys())
        if earning_tickers:
            analyses = await asyncio.gather(
                *[
                    _generate_earnings_ai_for_email(
                        ticker=t,
                        eps_actual=all_today_earnings[t].get("eps_actual"),
                        eps_estimate=all_today_earnings[t].get("eps_estimate"),
                        beat=all_today_earnings[t].get("beat_eps", False),
                        rev_actual_b=all_today_earnings[t].get("rev_actual_b"),
                        rev_estimate_b=all_today_earnings[t].get("rev_estimate_b"),
                    )
                    for t in earning_tickers
                ],
                return_exceptions=True,
            )
            earnings_ai_map: dict[str, str] = {
                t: (a if isinstance(a, str) else "")
                for t, a in zip(earning_tickers, analyses)
            }
        else:
            earnings_ai_map = {}

        # ── 10. Build and send per-user email ─────────────────────────────────
        from datetime import datetime as _dt
        week_label = _dt.now().strftime("semana del %d de %B")
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

            if is_premium and positions:
                # ── Premium: personalized portfolio summary ────────────────────
                enriched: list[dict] = []
                total_val  = 0.0
                total_prev = 0.0
                for p in positions:
                    ticker = p.get("ticker")
                    shares = float(p.get("shares") or 0)
                    if not ticker or not shares or ticker not in day_prices:
                        continue
                    px    = day_prices[ticker]
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
                        "ai_analysis":    earnings_ai_map.get(t, ""),
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
                    market_wrap=market_wrap,
                    earnings_items=earnings_items,
                )
                sign    = "+" if port_pct and port_pct >= 0 else ""
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

                market_body = _plain_to_html(market_wrap) if market_wrap else ""
                sp_color  = "#22c55e" if sp_pct is not None and sp_pct >= 0 else "#ef4444"
                nq_color  = "#22c55e" if nq_pct is not None and nq_pct >= 0 else "#ef4444"
                sp_border = "rgba(34,197,94,0.25)"  if sp_pct is not None and sp_pct >= 0 else "rgba(239,68,68,0.25)"
                nq_border = "rgba(34,197,94,0.25)"  if nq_pct is not None and nq_pct >= 0 else "rgba(239,68,68,0.25)"
                html = f"""<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nuvos AI</title></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
  <div style="border-radius:20px;overflow:hidden;border:1px solid #2a2d3a">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0d1f14,#0f2a1a);padding:28px 32px;text-align:center;border-bottom:1px solid #1e3a28">
      <img src="https://www.nuvosai.com/logo.png" alt="Nuvos AI" width="48" height="48" style="display:block;margin:0 auto 10px;border-radius:12px"/>
      <p style="margin:0;color:#00d47e;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase">Nuvos AI · Resumen Semanal</p>
    </div>

    <!-- Body -->
    <div style="background:#161b27;padding:28px 32px">
      <h1 style="color:#fff;font-size:20px;font-weight:900;margin:0 0 4px;letter-spacing:-0.3px">Hola {first}, ¿cómo estuvo la semana? 👋</h1>
      <p style="color:#6b7280;font-size:13px;margin:0 0 24px">El mercado cerró. Aquí está lo que pasó en la {week_label}.</p>

      <!-- Index cards -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px">
        <tr>
          <td style="width:49%;vertical-align:top;padding-right:6px">
            <div style="background:#111318;border:1px solid {sp_border};border-radius:14px;padding:18px;text-align:center">
              <p style="color:#9ca3af;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 8px">S&amp;P 500</p>
              <p style="color:{sp_color};font-size:26px;font-weight:900;margin:0;letter-spacing:-0.5px">{sp_str}</p>
              <p style="color:#4b5563;font-size:11px;margin:4px 0 0">esta semana</p>
            </div>
          </td>
          <td style="width:49%;vertical-align:top;padding-left:6px">
            <div style="background:#111318;border:1px solid {nq_border};border-radius:14px;padding:18px;text-align:center">
              <p style="color:#9ca3af;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 8px">NASDAQ</p>
              <p style="color:{nq_color};font-size:26px;font-weight:900;margin:0;letter-spacing:-0.5px">{nq_str}</p>
              <p style="color:#4b5563;font-size:11px;margin:4px 0 0">esta semana</p>
            </div>
          </td>
        </tr>
      </table>

      <!-- Market wrap narrative -->
      {'<div style="background:#111318;border:1px solid #2a2d3a;border-radius:14px;padding:22px;margin-bottom:20px"><p style="color:#00d47e;font-size:10px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 14px">ANÁLISIS DE LA SEMANA</p>' + market_body + '</div>' if market_body else ''}

      <!-- Premium upsell -->
      <div style="background:linear-gradient(135deg,rgba(0,168,94,0.08),rgba(0,212,126,0.04));border:1px solid rgba(0,212,126,0.2);border-radius:14px;padding:20px;margin-bottom:20px">
        <p style="color:#00d47e;font-size:13px;font-weight:800;margin:0 0 6px">🔒 ¿Cuánto rindió tu portafolio esta semana?</p>
        <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:0 0 16px">Con Premium ves el rendimiento exacto de tus inversiones vs S&P 500, recibes alertas de movimientos y hablas con tu mentor IA sin límites.</p>
        <div style="text-align:center">
          <a href="https://nuvosai.com/portfolio" style="display:inline-block;background:#00d47e;color:#000;font-weight:900;font-size:14px;padding:13px 28px;border-radius:12px;text-decoration:none">Activar Premium →</a>
        </div>
      </div>

      <!-- Footer -->
      <div style="border-top:1px solid #2a2d3a;padding-top:16px;text-align:center">
        <p style="color:#00a85e;font-size:12px;font-weight:700;margin:0 0 4px">Con Nuvos, construye tu futuro.</p>
        <p style="color:#374151;font-size:11px;margin:0">Nuvos AI · Solo educativo. No constituye asesoramiento financiero profesional.</p>
      </div>
    </div>
  </div>
</div>
</body></html>"""
                subject = f"📊 El mercado esta semana: S&P 500 {sp_str}, Nasdaq {nq_str} — Nuvos AI"

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

        # 4. Filter tickers that moved ≥3.5% vs yesterday's close
        movers: dict[str, float] = {}
        for ticker, px in prices.items():
            pct = round((px["curr"] - px["prev"]) / px["prev"] * 100, 2)
            if abs(pct) >= 3.5:
                movers[ticker] = pct

        logger.info("Portfolio alerts: %d movers ≥3.5%%: %s",
                    len(movers), {t: f"{p:+.1f}%" for t, p in movers.items()})
        if not movers:
            return

        # 5. Pre-generate WHY explanations — 1 Claude call per mover, reused across users.
        # Tickers with no specific catalyst are stored as NO_CATALYST and skipped for premium users;
        # free users still get a plain price-move notification without the WHY.
        from app.services.price_alert_service import NO_CATALYST
        ticker_why:   dict[str, str] = {}
        ticker_title: dict[str, str] = {}
        for ticker, pct in movers.items():
            price = prices[ticker]["curr"]
            news  = await asyncio.to_thread(_fetch_ticker_news, ticker)
            why   = await _generate_price_alert_why(ticker, pct, price, news)
            ticker_why[ticker]   = why
            emoji = "📉" if pct <= -5 else "🔻" if pct < 0 else "🚀" if pct >= 5 else "📈"
            ticker_title[ticker] = f"{emoji} {ticker} {pct:+.1f}% hoy"
            if why == NO_CATALYST:
                logger.info("Portfolio alerts: no catalyst for %s — premium users will not receive this", ticker)
            await asyncio.sleep(0.05)

        # 6. Batch-fetch user profiles (name + tier + trial) once
        all_uids  = list(user_tickers.keys())
        prof_res  = await run_query(
            db.table("user_profiles")
            .select("user_id,name,subscription_tier,trial_started_at")
            .in_("user_id", all_uids)
        )
        user_meta: dict[str, dict] = {
            r["user_id"]: {
                "first":      (r.get("name") or "Inversor").split()[0],
                "is_premium": _is_premium_user(r.get("subscription_tier", "free"), r.get("trial_started_at")),
            }
            for r in (prof_res.data or [])
        }

        # 7. Fan out — portfolio vs watchlist distinction + premium vs free
        sent = 0
        for uid, sets in user_tickers.items():
            meta      = user_meta.get(uid, {"first": "Inversor", "is_premium": False})
            first     = meta["first"]
            is_prem   = meta["is_premium"]
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

                why = ticker_why[ticker]
                direction = "bajó" if pct < 0 else "subió"
                if is_prem:
                    if why == NO_CATALYST:
                        no_news = "Sin noticias concretas — movimiento normal de mercado."
                        if is_portfolio:
                            shares         = port_map[ticker].get("shares", 0.0)
                            position_value = shares * price if shares else 0.0
                            dollar_delta   = position_value * pct / 100 if position_value else None
                            if position_value and dollar_delta is not None:
                                gl   = "perdiste" if pct < 0 else "ganaste"
                                body = f"{ticker} {direction} {abs(pct):.1f}% hoy a ${price:.2f}. {no_news} {first}, {gl} ~${abs(dollar_delta):,.0f}."
                            else:
                                body = f"{ticker} {direction} {abs(pct):.1f}% hoy a ${price:.2f}. {no_news}"
                        else:
                            body = f"{ticker} {direction} {abs(pct):.1f}% hoy a ${price:.2f}. {no_news}"
                    elif is_portfolio:
                        # WHY + financial impact + 3-question framework
                        shares         = port_map[ticker].get("shares", 0.0)
                        position_value = shares * price if shares else 0.0
                        dollar_delta   = position_value * pct / 100 if position_value else None
                        if position_value and dollar_delta is not None:
                            gl         = "perdiste" if pct < 0 else "ganaste"
                            shares_fmt = f"{shares:.4f}".rstrip("0").rstrip(".") if shares < 1 else f"{shares:.2f}".rstrip("0").rstrip(".")
                            impact = f" {first}, {gl} ~${abs(dollar_delta):,.0f} hoy. "
                        else:
                            impact = " "
                        cta = "¿Cambia tu tesis? Abre Nuvos."
                        max_b = 230 - len(impact) - len(cta)
                        body  = (why[:max_b] if len(why) > max_b else why) + impact + cta
                    else:
                        # WHY + watchlist suffix + action prompt
                        suffix = " La tienes en watchlist. ¿Vale la pena analizarla ahora?"
                        max_b  = 230 - len(suffix)
                        body   = (why[:max_b] if len(why) > max_b else why) + suffix
                else:
                    # Free tier — plain price alert
                    if is_portfolio:
                        body = (
                            f"{ticker} {direction} {abs(pct):.1f}% hoy a ${price:.2f}. "
                            f"Activa Premium para ver el análisis completo."
                        )
                    else:
                        body = (
                            f"{ticker} {direction} {abs(pct):.1f}% hoy a ${price:.2f}. "
                            f"Activa Premium para ver el análisis completo."
                        )

                await send_push(
                    uid,
                    f"price_mover_{ticker}",
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
            .select("user_id,name,risk_tolerance,quiz_answers,mentor,subscription_tier")
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
        HORIZON_MAP = {"A": "corto plazo", "B": "mediano plazo", "C": "largo plazo", "D": "muy largo plazo"}

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
            horizon = HORIZON_MAP.get(str(quiz.get("q2", "")), "largo plazo")
            risk_label = RISK_LABELS.get(risk, "moderado")
            owned   = portfolio_map.get(uid, set())

            all_picks = picks_by_risk.get(risk, [])
            # Exclude tickers the user already owns
            picks = [pk for pk in all_picks if pk.get("ticker") not in owned][:4]

            if len(picks) < 2:
                continue  # not enough picks after exclusions — skip silently

            lines = "\n".join(f"{idx+1}. {pk['ticker']} ({pk['name']})" for idx, pk in enumerate(picks))
            body = (
                f"¡Hola {name}! Basado en tu perfil {risk_label} y mentalidad de {horizon} "
                f"quiero sugerirte algunas posiciones que deberías echarles un ojo:\n\n"
                f"{lines}\n\n"
                f"¡Habla con tu mentor para analizarlas! 💬"
            )

            await send_push(
                uid, "weekly_screener",
                "📊 Tus 4 ideas para esta semana",
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
        <p style="color:#00a85e;font-size:12px;font-weight:700;margin:0 0 4px">Con Nuvos, construye tu futuro.</p>
        <p style="color:#374151;font-size:11px;margin:0">Nuvos AI · Solo educativo. No constituye asesoramiento financiero profesional.</p>
      </div>
    </div>
  </div>
</div>
</body></html>"""
                try:
                    await send_email(email_addr, "📊 Tus 4 ideas de inversión para esta semana — Nuvos AI", html)
                except Exception as e:
                    logger.warning("Weekly screener email failed for %s: %s", uid, e)

            sent += 1

        logger.info("Weekly screener push+email: %d sent across %d risk groups", sent, len(picks_by_risk))
    except Exception as e:
        logger.error("job_weekly_screener_push failed: %s", e)


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

    if has_position:
        shares_disp = f"{shares:.4f}".rstrip("0").rstrip(".") if shares < 1 else f"{shares:.2f}".rstrip("0").rstrip(".")
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
        body = resp.content[0].text.strip().strip('"').strip("'")
        if len(body) > 280:
            body = body[:277] + "..."
    except Exception as e:
        logger.warning("Claude earnings push failed for %s: %s — using fallback", ticker, e)
        # Fallback: static but still with dollar scenarios
        eps_part  = f" EPS est. {eps_str}." if eps_estimate else ""
        beat_part = f" Beat: ${beat_value:,.0f} (+{beat_avg}%)." if beat_value else ""
        miss_part = f" Miss: ${miss_value:,.0f} ({miss_avg}%)." if miss_value else ""
        body = f"{company} ({ticker}) reporta {when}.{eps_part}{beat_part}{miss_part}"
        if len(body) > 280:
            body = body[:277] + "..."

    title = f"📊 {ticker} reporta {when}"
    return title, body


def _fetch_ticker_news(ticker: str) -> list[str]:
    from app.services.price_alert_service import fetch_ticker_news
    return fetch_ticker_news(ticker)


async def _generate_price_alert_why(ticker: str, change_pct: float, price: float, news_headlines: list[str]) -> str:
    from app.services.price_alert_service import generate_price_alert_why
    return await generate_price_alert_why(ticker, change_pct, price, news_headlines)


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

        sent_total = 0
        for ipo in ipos:
            symbol      = ipo["symbol"]
            name        = ipo["name"] or symbol
            ipo_date    = ipo["date"]
            price_range = ipo["price_range"]
            exchange    = ipo["exchange"] or "bolsa"
            status      = ipo["status"]

            is_today    = ipo_date == today_str
            when        = "hoy" if is_today else "mañana"
            emoji       = "🚀" if is_today else "📅"

            title = f"{emoji} IPO {when}: {symbol}"

            body_parts = [f"{name} debuta {when} en {exchange}."]
            if price_range:
                body_parts.append(f"Precio esperado: {price_range}.")
            body_parts.append("Toca para ver el análisis.")
            body = " ".join(body_parts)

            category = f"ipo_alert:{symbol.upper()}"

            for i, uid in enumerate(all_uids):
                if i % 100 == 0 and i > 0:
                    await asyncio.sleep(8)
                await asyncio.sleep(random.uniform(0, 0.05))
                await send_push(
                    uid, category, title, body,
                    {"screen": "chat", "prefill": f"Analiza la IPO de {symbol} — {name}"},
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
            db.table("user_profiles").select("user_id,subscription_tier").in_("user_id", list(prefs_by_uid.keys()))
        )
        tier_map = {r["user_id"]: (r.get("subscription_tier") or "free") for r in (tier_res.data or [])}

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

            for ticker in all_tickers:
                events = await asyncio.to_thread(_fetch_events_for_symbol, ticker)
                for evt in events:
                    if evt.get("event_date") not in targets:
                        continue
                    is_today   = evt["event_date"] == str(today)
                    when       = "hoy" if is_today else "mañana"
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
                            )
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
                            title    = f"✂️ Ex-Dividendo: {ticker}"
                            category = "ex_dividend"
                            if is_premium and is_portfolio:
                                pos         = positions_map.get(ticker, {})
                                shares_held = float(pos.get("shares") or 0)
                                if amt and shares_held:
                                    pago = shares_held * amt
                                    body = (
                                        f"Fecha ex-dividendo de {ticker} es {when}. "
                                        f"Tienes {shares_held:.4f} acciones — "
                                        f"tu pago estimado: ${pago:.2f} USD (${amt:.4f}/acción)."
                                    )
                                elif amt:
                                    body = f"Fecha ex-dividendo de {ticker} es {when}. ${amt:.4f}/acción."
                                else:
                                    body = f"Fecha ex-dividendo de {ticker} es {when}."
                            else:
                                body = f"Fecha ex-dividendo de {ticker} es {when}." + (f" ${amt:.4f}/acción." if amt else "")
                        else:
                            title    = f"💰 Pago de Dividendo: {ticker}"
                            category = "dividend_payment"
                            if is_premium and is_portfolio:
                                pos         = positions_map.get(ticker, {})
                                shares_held = float(pos.get("shares") or 0)
                                if amt and shares_held:
                                    pago = shares_held * amt
                                    body = (
                                        f"{ticker} paga dividendo {when}. "
                                        f"Con tus {shares_held:.4f} acciones recibirás "
                                        f"${pago:.2f} USD (${amt:.4f}/acción)."
                                    )
                                elif amt:
                                    body = f"{ticker} paga dividendo {when}. ${amt:.4f}/acción."
                                else:
                                    body = f"{ticker} paga dividendo {when}."
                            else:
                                body = f"{ticker} paga dividendo {when}." + (f" ${amt:.4f}/acción." if amt else "")
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


async def job_monthly_report_push():
    """9:00 AM ET on 1st of month — Free: generic monthly summary. Premium: portfolio vs indices (beat/lag)."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push, get_market_summary_text
    now = datetime.now(timezone.utc)
    if now.day != 1:
        return
    db = get_supabase()
    try:
        market    = await get_market_summary_text()
        indices   = market.get("indices", {})
        sp500_pct = (indices.get("S&P 500") or {}).get("change_pct")
        nasdaq_pct = (indices.get("NASDAQ") or {}).get("change_pct")

        users_res = await run_query(
            db.table("user_profiles").select("user_id,subscription_tier,name")
        )
        uids = [u["user_id"] for u in (users_res.data or [])]
        tier_map = {u["user_id"]: u.get("subscription_tier") for u in (users_res.data or [])}

        premium_uids = [uid for uid in uids if tier_map.get(uid) == "premium"]
        all_tickers: set[str] = set()
        portfolio_map: dict[str, list] = {}
        for uid in premium_uids:
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if port_res.data:
                pos = _agg_positions(port_res.data or [])
                portfolio_map[uid] = pos
                all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        prices = await _finnhub_prices_batch(list(all_tickers)) if all_tickers else {}
        month_name = now.strftime("%B")

        sent = 0
        for i, uid in enumerate(uids):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))

            is_premium = tier_map.get(uid) == "premium"
            if is_premium and uid in portfolio_map and prices:
                user_pct = _calc_portfolio_pct(portfolio_map[uid], prices)
                sp_str   = f"{sp500_pct:+.1f}%" if sp500_pct is not None else "—"
                if user_pct is not None and sp500_pct is not None:
                    if user_pct > sp500_pct:
                        title = "🏆 Reporte mensual listo"
                        body  = f"¡Excelente mes! Tu portafolio {user_pct:+.1f}% superó al S&P 500 ({sp_str}). Ver análisis completo."
                    else:
                        title = "📋 Reporte mensual de {month_name}"
                        body  = f"Tu portafolio {user_pct:+.1f}% vs S&P 500 ({sp_str}). Entra a Nuvos AI para optimizar tu estrategia."
                else:
                    title = f"📋 Reporte mensual de {month_name}"
                    body  = f"Tu análisis de portafolio del mes está listo. Entra a Nuvos AI para revisarlo."
            else:
                title = f"📋 Resumen de {month_name}"
                body  = "Tu resumen mensual está disponible. Revisa cómo se comportaron los mercados."

            await send_push(uid, "monthly_report", title, body, {"screen": "portfolio"}, db)
            sent += 1
        logger.info("Monthly report push: %d sent", sent)
    except Exception as e:
        logger.error("job_monthly_report_push failed: %s", e)


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
            db.table("user_profiles").select("user_id").eq("subscription_tier", "premium").in_("user_id", inactive_uids)
        )
        premium_set = {r["user_id"] for r in (tier_res.data or [])}
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
            if top:
                names = ", ".join(t[0] for t in top)
                body  = f"3 de tus activos favoritos tuvieron movimientos interesantes: {names}. ¿Ya los revisaste?"
            else:
                body = "Te has perdido algunos movimientos en tus activos. Entra a revisar tu portafolio."
            await send_push(
                uid, "reengagement",
                "📱 Tu portafolio te está esperando",
                body,
                {"screen": "portfolio"},
                db,
            )
            sent += 1
        logger.info("Re-engagement push: %d sent to %d inactive users", sent, len(inactive_uids))
    except Exception as e:
        logger.error("job_reengagement_push failed: %s", e)


_EDUCATION_TIPS = [
    ("💡 Dato curioso del mercado", "¿Sabías que los lunes son los días con más volatilidad histórica? Esta semana obsérvalo en tus activos desde Nuvos AI."),
    ("💡 El poder del interés compuesto", "Einstein lo llamó la 8va maravilla del mundo. $100/mes al 10% anual = $1M en 45 años. Explora en la Academia Nuvos cómo aplicarlo."),
    ("💡 ¿Qué es el P/E ratio?", "Es la métrica más usada para valorar empresas. Aprende a interpretar el P/E de tus acciones en la Academia Nuvos hoy."),
    ("💡 Dollar Cost Averaging", "Invertir montos fijos periódicamente elimina la angustia de 'cuándo entrar'. Descubre cómo DCA puede reducir tu costo promedio."),
    ("💡 Diversificación real vs. ilusoria", "¿Tienes 8 acciones de tecnología? Eso no es diversificación. Aprende qué sí lo es en Nuvos AI."),
    ("💡 Earnings Season: oportunidad única", "4 veces al año hay volatilidad extrema post-earnings. Aprende a anticiparla en Nuvos AI antes de que llegue."),
    ("💡 'Comprar el rumor, vender la noticia'", "Es uno de los fenómenos más contraintuitivos del mercado. ¿Sabes cuándo ocurre con tus acciones? Entra a la Academia."),
    ("💡 ¿Qué mueve las tasas de interés?", "La Fed tiene más poder del que crees sobre tu portafolio. Aprende el mecanismo en la Academia Nuvos."),
    ("💡 La regla del 72", "Divide 72 entre tu tasa de retorno anual y obtendrás los años que tardará en duplicarse tu dinero. ¿Cuánto tardaría el tuyo?"),
    ("💡 ¿Qué es el VIX?", "El 'índice del miedo' mide la volatilidad esperada del mercado. Aprende a usarlo como señal en Nuvos AI."),
]


async def job_education_push():
    """2:00 PM ET Mon/Wed/Fri — rotating educational/curiosity push."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    try:
        day_idx = datetime.now(timezone.utc).timetuple().tm_yday
        tip = _EDUCATION_TIPS[day_idx % len(_EDUCATION_TIPS)]
        title, body = tip

        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("push_market_open", True)
        )
        sent = 0
        for i, u in enumerate(prefs_res.data or []):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))
            await send_push(u["user_id"], "education_push", title, body, {"screen": "academy"}, db)
            sent += 1
        logger.info("Education push: %d sent (tip index %d)", sent, day_idx % len(_EDUCATION_TIPS))
    except Exception as e:
        logger.error("job_education_push failed: %s", e)


async def job_social_proof_push():
    """3:00 PM ET Saturday — Risk-Based Filter: suggest tickers that match each user's risk profile.
    Aggressive → high-beta/growth (NVDA, TSLA, PLTR...). Conservative → dividend/value (KO, JNJ, O...).
    Rule: never suggest defensive stocks to aggressive users or vice versa."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    try:
        # Global trending (for cross-referencing)
        watch_res = await run_query(db.table("watchlist").select("ticker"))
        ticker_counts: dict[str, int] = {}
        for row in (watch_res.data or []):
            t = row.get("ticker")
            if t:
                ticker_counts[t] = ticker_counts.get(t, 0) + 1
        trending_global = set(sorted(ticker_counts, key=lambda x: ticker_counts[x], reverse=True)[:20])

        users_res = await run_query(
            db.table("user_profiles").select("user_id,risk_tolerance")
        )
        sent = 0
        for i, u in enumerate(users_res.data or []):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))

            risk      = u.get("risk_tolerance") or "moderate"
            pool      = get_risk_filtered_suggestions(risk)
            # Prefer tickers that are also trending globally (social proof is stronger)
            trending_in_pool = [t for t in pool if t in trending_global]
            candidates = trending_in_pool if trending_in_pool else pool
            ticker = candidates[i % len(candidates)]

            # Personalized body per risk profile
            r = risk.lower()
            if "agres" in r or "aggres" in r:
                body = f"Inversores agresivos como tú están vigilando {ticker} esta semana. Alta volatilidad = alta oportunidad. ¿Está en tu watchlist?"
            elif "conserv" in r:
                body = f"Inversores enfocados en dividendos están siguiendo {ticker}. Valor estable y flujo de caja consistente. ¿Lo tienes en tu radar?"
            else:
                body = f"Inversores con perfil similar al tuyo están monitoreando {ticker} esta semana. ¿Ya lo tienes en tu watchlist?"

            await send_push(
                u["user_id"], "social_proof",
                f"👀 {ticker} está en tendencia",
                body,
                {"ticker": ticker, "screen": "watchlist"},
                db,
            )
            sent += 1
        logger.info("Social proof push: %d sent", sent)
    except Exception as e:
        logger.error("job_social_proof_push failed: %s", e)


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

        title = "⚠️ Volatilidad elevada"
        body  = f"El VIX está en {vix:.1f} — por encima del nivel de alerta. Revisa tus stop-loss y niveles de exposición en Nuvos AI."

        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("push_portfolio_alerts", True)
        )
        sent = 0
        for i, u in enumerate(prefs_res.data or []):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))
            await send_push(u["user_id"], "risk_management", title, body, {"screen": "portfolio"}, db)
            sent += 1
        logger.info("Risk mgmt push: VIX=%.1f, %d users notified", vix, sent)
    except Exception as e:
        logger.error("job_risk_mgmt_push failed: %s", e)


async def job_diversification_push():
    """11:00 AM ET Saturday — nudge users who are close to a diversification goal."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    from app.services.portfolio_manager_service import generate_diversification_insight
    # Sector ETF proxies: simple sector classification
    SECTOR_MAP = {
        "AAPL": "Tecnología", "MSFT": "Tecnología", "GOOGL": "Tecnología", "META": "Tecnología", "NVDA": "Tecnología",
        "JPM": "Finanzas", "BAC": "Finanzas", "GS": "Finanzas", "V": "Finanzas", "MA": "Finanzas",
        "JNJ": "Salud", "PFE": "Salud", "UNH": "Salud", "ABBV": "Salud",
        "XOM": "Energía", "CVX": "Energía", "COP": "Energía",
        "AMZN": "Consumo", "WMT": "Consumo", "COST": "Consumo", "HD": "Consumo",
        "NEE": "Utilities", "SO": "Utilities",
        "AMT": "Real Estate", "SPG": "Real Estate",
        "DIS": "Comunicaciones", "NFLX": "Comunicaciones", "T": "Comunicaciones",
        "CAT": "Industrial", "BA": "Industrial", "GE": "Industrial",
        "LIN": "Materiales", "NEM": "Materiales",
    }
    GOAL_SECTORS = 5  # target: 5 distinct sectors

    db = get_supabase()
    try:
        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id,push_portfolio_alerts")
        )
        explicit_prefs = {p["user_id"]: p.get("push_portfolio_alerts", True) for p in (prefs_res.data or [])}
        users_res = await run_query(
            db.table("user_profiles").select("user_id,name,subscription_tier,trial_started_at,investing_style")
        )
        sent = 0
        for i, u in enumerate(users_res.data or []):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            uid = u["user_id"]
            if not explicit_prefs.get(uid, True):
                continue
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if not port_res.data:
                continue
            pos = _agg_positions(port_res.data or [])
            sectors = {SECTOR_MAP[p["ticker"]] for p in pos if p.get("ticker") in SECTOR_MAP}
            missing = GOAL_SECTORS - len(sectors)
            if missing <= 0 or missing > 2:
                continue  # already diversified or too far away

            body = None
            if _is_premium_user(u.get("subscription_tier", "free"), u.get("trial_started_at")):
                first = (u.get("name") or "Inversor").split()[0]
                body = await generate_diversification_insight(
                    first, missing, sorted(sectors), u.get("investing_style"),
                )
            if not body:
                sector_label = "sector" if missing == 1 else "sectores"
                body = f"Estás a {missing} {sector_label} de completar tu meta de diversificación. ¿Qué activo te falta explorar?"

            await send_push(
                uid, "diversification_goal",
                "🎯 Meta de diversificación",
                body,
                {"screen": "portfolio"},
                db,
            )
            await asyncio.sleep(random.uniform(0, 0.12))
            sent += 1
        logger.info("Diversification push: %d users notified", sent)
    except Exception as e:
        logger.error("job_diversification_push failed: %s", e)


_CONCENTRATION_THRESHOLD = 0.55  # one sector at >55% of portfolio value = risk


async def job_concentration_risk_push():
    """1:00 PM ET Tuesday — AI Portfolio Manager: detect when a single sector
    dominates a user's portfolio (concentration risk), reusing the sector
    weights already computed daily by fmg_service.take_portfolio_snapshot
    instead of re-deriving them from a hardcoded ticker→sector map.
    Premium gets an AI-personalized message referencing their actual weight
    and declared investing style; free gets a plain template."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    from app.services.portfolio_manager_service import generate_concentration_insight

    db = get_supabase()
    try:
        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id,push_portfolio_alerts")
        )
        explicit_prefs = {p["user_id"]: p.get("push_portfolio_alerts", True) for p in (prefs_res.data or [])}

        # Latest snapshot per user (fmg_portfolio_snapshots has one row per user per day)
        snap_res = await run_query(
            db.table("fmg_portfolio_snapshots")
            .select("user_id,snapshot_date,total_value,top_sector,sector_weights")
            .order("snapshot_date", desc=True)
            .limit(5000)
        )
        latest_snap: dict[str, dict] = {}
        for row in (snap_res.data or []):
            uid = row["user_id"]
            if uid not in latest_snap:  # first hit per user = most recent, thanks to the order()
                latest_snap[uid] = row

        candidates = [
            (uid, row) for uid, row in latest_snap.items()
            if explicit_prefs.get(uid, True)
            and row.get("total_value") and row["total_value"] > 0
            and row.get("top_sector")
            and (row.get("sector_weights") or {}).get(row["top_sector"], 0) >= _CONCENTRATION_THRESHOLD
        ]
        if not candidates:
            logger.info("Concentration risk push: no users above %.0f%% threshold", _CONCENTRATION_THRESHOLD * 100)
            return

        uids = [uid for uid, _ in candidates]
        prof_res = await run_query(
            db.table("user_profiles")
            .select("user_id,name,subscription_tier,trial_started_at,investing_style")
            .in_("user_id", uids)
        )
        prof_map = {r["user_id"]: r for r in (prof_res.data or [])}

        sent = 0
        for uid, row in candidates:
            prof = prof_map.get(uid, {})
            first = (prof.get("name") or "Inversor").split()[0]
            top_sector = row["top_sector"]
            weight_pct = row["sector_weights"][top_sector] * 100
            total_value = row["total_value"]
            is_prem = _is_premium_user(prof.get("subscription_tier", "free"), prof.get("trial_started_at"))

            body = None
            if is_prem:
                body = await generate_concentration_insight(
                    first, top_sector, weight_pct, total_value, prof.get("investing_style"),
                )
            if not body:
                body = (
                    f"El {weight_pct:.0f}% de tu portafolio está concentrado en {top_sector}. "
                    f"Considera diversificar para reducir el riesgo."
                )

            await send_push(
                uid, "concentration_risk",
                "⚠️ Concentración de portafolio",
                body,
                {"screen": "portfolio", "sector": top_sector, "weight_pct": round(weight_pct, 1)},
                db,
            )
            sent += 1
            await asyncio.sleep(random.uniform(0.05, 0.2))

        logger.info("Concentration risk push: %d users notified", sent)
    except Exception as e:
        logger.error("job_concentration_risk_push failed: %s", e)


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
        }
    return out


def _earnings_push_content(
    ticker: str,
    res: dict,
    positions: list,       # user's portfolio positions (may be empty list)
    is_watchlist: bool,
    is_premium: bool,
) -> tuple[str, str]:
    """Return (title, body) for an earnings push notification."""
    eps_a = res.get("eps_actual")
    eps_e = res.get("eps_estimate")
    beat  = res.get("beat_eps", False)
    hour  = res.get("hour", "")

    result_emoji = "✅" if beat else "❌"
    result_word  = "Beat" if beat else "Miss"
    eps_str = f"EPS ${eps_a:.2f}" if eps_a is not None else ""
    est_str = f"vs ${eps_e:.2f} est." if eps_e is not None else ""

    timing_tag = ""
    if hour == "BMO":
        timing_tag = " · Pre-market"
    elif hour == "AMC":
        timing_tag = " · After-hours"

    title = f"{ticker} {result_emoji} {result_word}{timing_tag}"

    # Base body
    parts = []
    if eps_str:
        parts.append(f"{eps_str} {est_str}".strip())

    # Premium personalization: show position context if user holds the stock
    if is_premium and positions:
        pos_match = next((p for p in positions if p.get("ticker") == ticker), None)
        if pos_match:
            shares = float(pos_match.get("shares") or 0)
            avg_px = float(pos_match.get("avgPrice") or pos_match.get("avg_price") or 0)
            if shares and avg_px:
                cost_basis = shares * avg_px
                parts.append(f"Tienes {shares:.4f} acc. (${cost_basis:,.2f} invertido)")

    if is_watchlist and not any(p.get("ticker") == ticker for p in positions):
        parts.append("En tu watchlist")

    body = " · ".join(parts) if parts else f"{ticker} acaba de reportar resultados"
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
    users_res = await run_query(db.table("user_profiles").select("user_id,name,subscription_tier"))
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
        is_premium = (u.get("subscription_tier") or "free") == "premium"

        port_tickers  = {p["ticker"] for p in positions if p.get("ticker")}
        relevant      = (port_tickers | watchlist) & reported_tickers
        if not relevant:
            continue

        await asyncio.sleep(random.uniform(0, 0.05))
        for ticker in relevant:
            res  = results_map[ticker]
            is_wl = ticker in watchlist
            title, body = _earnings_push_content(ticker, res, positions, is_wl, is_premium)
            await send_push(
                uid, f"earnings_{ticker.lower()}",
                title, body,
                {"ticker": ticker, "screen": "stock_detail"},
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

async def send_enhanced_weekly_emails():
    """Enhanced weekly email with portfolio performance vs indices — every Saturday."""
    if not settings.resend_api_key:
        logger.info("RESEND_API_KEY not set — skipping enhanced weekly emails")
        return
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import get_market_summary_text
    db = get_supabase()
    try:
        market     = await get_market_summary_text()
        indices    = market.get("indices", {})
        sp500_pct  = (indices.get("S&P 500") or {}).get("change_pct")
        nasdaq_pct = (indices.get("NASDAQ")  or {}).get("change_pct")

        users_res = await run_query(
            db.table("user_profiles").select("user_id,name,subscription_tier,risk_tolerance,investment_goal")
        )
        auth_users = {u.id: u.email for u in await asyncio.to_thread(lambda: db.auth.admin.list_users())}

        all_tickers: set[str] = set()
        port_map: dict[str, list] = {}
        for u in (users_res.data or []):
            uid = u["user_id"]
            if u.get("subscription_tier") != "premium":
                continue
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if port_res.data:
                pos = _agg_positions(port_res.data or [])
                port_map[uid] = pos
                all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        prices = await _finnhub_prices_batch(list(all_tickers)) if all_tickers else {}

        # Pre-compute AI summaries per risk profile variant: 3 profiles × 2 scenarios (beat/lag) = 6 blurbs
        # Each blurb: market context + behavioral analysis (why the portfolio moved that way)
        ai_summaries: dict[str, str] = {}
        try:
            import anthropic
            from app.core.config import settings as _cfg
            _client = anthropic.Anthropic(api_key=_cfg.anthropic_api_key)
            sp_label = f"{sp500_pct:+.1f}%" if sp500_pct is not None else "plano"
            nq_label = f"{nasdaq_pct:+.1f}%" if nasdaq_pct is not None else "plano"

            for _risk in ("conservative", "moderate", "aggressive"):
                for _scenario in ("beat", "lag"):
                    _key = f"{_risk}_{_scenario}"
                    _scenario_desc = (
                        "superó al S&P 500" if _scenario == "beat"
                        else "quedó por debajo del S&P 500"
                    )
                    _risk_desc = {
                        "conservative": "conservador (dividendos, valor, baja volatilidad)",
                        "moderate": "moderado (crecimiento equilibrado)",
                        "aggressive": "agresivo (alta beta, tecnología, crecimiento)",
                    }[_risk]
                    _resp = await asyncio.to_thread(
                        lambda r=_risk_desc, sc=_scenario_desc: _client.messages.create(
                            model="claude-haiku-4-5-20251001",
                            max_tokens=280,
                            messages=[{"role": "user", "content": (
                                f"S&P 500 {sp_label}, NASDAQ {nq_label} esta semana. "
                                f"Un portafolio de perfil {r} {sc} al S&P 500. "
                                "Escribe 2 párrafos CORTOS en español (max 120 palabras total): "
                                "1) Por qué ocurrió esto (causas del mercado + comportamiento del perfil). "
                                "2) Qué debería considerar este tipo de inversor la próxima semana. "
                                "Tono de mentor financiero. Sin bullets. Solo prosa."
                            )}],
                        )
                    )
                    in_tok = getattr(_resp.usage, "input_tokens", 0)
                    out_tok = getattr(_resp.usage, "output_tokens", 0)
                    logger.info("LLM weekly_email(%s): in=%d out=%d cost=$%.5f", _key, in_tok, out_tok,
                                in_tok / 1e6 * 0.80 + out_tok / 1e6 * 4.0)
                    ai_summaries[_key] = _resp.content[0].text.strip() if _resp.content else ""
        except Exception as e:
            logger.warning("AI weekly summaries failed: %s", e)

        # Weekly prices for accurate weekly performance
        weekly_prices = await _batch_fetch_weekly_prices(list(all_tickers)) if all_tickers else {}

        sent = 0
        for u in (users_res.data or []):
            uid   = u["user_id"]
            email = auth_users.get(uid)
            if not email:
                continue
            is_premium = u.get("subscription_tier") == "premium"
            risk       = (u.get("risk_tolerance") or "moderate").lower()
            risk_key   = "conservative" if "conserv" in risk else ("aggressive" if "agres" in risk or "aggres" in risk else "moderate")
            user_pct   = None
            top_ticker = None
            top_perf   = None

            if is_premium and uid in port_map and weekly_prices:
                user_pct             = _calc_portfolio_pct(port_map[uid], weekly_prices)
                top_ticker, top_perf = _top_performer_by_impact(port_map[uid], weekly_prices)

            beats       = user_pct is not None and sp500_pct is not None and user_pct > sp500_pct
            scenario    = "beat" if beats else "lag"
            ai_key      = f"{risk_key}_{scenario}"
            ai_summary  = ai_summaries.get(ai_key) or (
                "Los mercados reflejaron las condiciones macro globales. "
                "Mantén tu estrategia de largo plazo."
            )

            html = build_enhanced_weekly_html(
                name=u.get("name") or "Inversor",
                is_premium=is_premium,
                user_perf=user_pct,
                sp500_perf=sp500_pct,
                nasdaq_perf=nasdaq_pct,
                top_ticker=top_ticker,
                top_perf=top_perf,
                sector=None,
                ai_summary=ai_summary,
                risk=risk_key,
            )
            ok = await send_email(email, "📊 Tu resumen semanal está listo — Nuvos AI", html)
            if ok:
                sent += 1
        logger.info("Enhanced weekly emails: %d sent", sent)
    except Exception as e:
        logger.error("send_enhanced_weekly_emails failed: %s", e)


async def send_birthday_emails():
    """Daily at 8:00 AM ET — send birthday email + 7-day Premium trial to users with birthday today."""
    if not settings.resend_api_key:
        return
    from app.core.database import get_supabase, run_query
    db = get_supabase()
    today = datetime.now(timezone.utc).date()
    try:
        users_res = await run_query(
            db.table("user_profiles").select("user_id,name,birth_date")
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
            html = build_birthday_html(u.get("name") or "Inversor")
            ok   = await send_email(email, "🎂 ¡Feliz cumpleaños! Tu regalo de Nuvos AI", html)
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


async def job_opportunity_push():
    """1:00 PM ET Wed/Fri — detect technical signals based on user's risk profile and push opportunity alerts."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()

    # Tickers to scan per risk profile (curated watchlist proxies)
    RISK_TICKERS = {
        "conservative":  ["JNJ", "KO", "PG", "MCD", "VZ", "NEE", "WMT", "BRK-B"],
        "moderate":      ["AAPL", "MSFT", "JPM", "V", "UNH", "AMZN", "HD", "GOOGL"],
        "aggressive":    ["NVDA", "TSLA", "META", "AMD", "PLTR", "SHOP", "COIN", "SOFI"],
    }
    RSI_OVERSOLD = 35.0  # signal: potential bounce

    def _compute_rsi(closes, period=14):
        if len(closes) < period + 1:
            return None
        deltas = [closes[i+1] - closes[i] for i in range(len(closes)-1)]
        gains  = [max(d, 0) for d in deltas]
        losses = [abs(min(d, 0)) for d in deltas]
        avg_g  = sum(gains[:period]) / period
        avg_l  = sum(losses[:period]) / period
        for i in range(period, len(deltas)):
            avg_g = (avg_g * (period-1) + gains[i]) / period
            avg_l = (avg_l * (period-1) + losses[i]) / period
        if avg_l == 0:
            return 100.0
        rs = avg_g / avg_l
        return round(100 - 100 / (1 + rs), 2)

    def _scan_signals(tickers):
        signals = []
        for ticker in tickers:
            try:
                closes = _finnhub_closes(ticker, days=35)
                if len(closes) < 16:
                    continue
                rsi = _compute_rsi(closes)
                if rsi is not None and rsi <= RSI_OVERSOLD:
                    curr_pct = (closes[-1] - closes[-2]) / closes[-2] * 100 if closes[-2] else 0
                    signals.append({"ticker": ticker, "rsi": rsi, "change_pct": round(curr_pct, 2)})
            except Exception:
                pass
        return signals

    try:
        users_res = await run_query(
            db.table("user_profiles").select("user_id,risk_tolerance,subscription_tier")
        )
        if not users_res.data:
            return

        # Pre-compute signals per risk level (3 concurrent Finnhub candle batches)
        signals_by_risk: dict[str, list] = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
            futures = {
                risk: ex.submit(_scan_signals, tickers)
                for risk, tickers in RISK_TICKERS.items()
            }
            for risk, fut in futures.items():
                try:
                    signals_by_risk[risk] = fut.result(timeout=30)
                except Exception:
                    signals_by_risk[risk] = []

        sent = 0
        for i, u in enumerate(users_res.data):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            risk    = (u.get("risk_tolerance") or "moderate").lower()
            profile = "conservative" if "conserv" in risk else ("aggressive" if "agres" in risk or "aggres" in risk else "moderate")
            signals = signals_by_risk.get(profile, [])
            if not signals:
                continue
            # Pick a different signal per user using their index for variety
            sig = signals[i % len(signals)]
            ticker = sig["ticker"]
            rsi    = sig["rsi"]
            pct    = sig["change_pct"]
            body   = f"{ticker} muestra señal técnica de posible rebote (RSI {rsi:.0f}, {pct:+.1f}% hoy). Coincide con tu perfil de riesgo. Analiza en Nuvos AI."
            await send_push(
                u["user_id"], "opportunity_detection",
                f"🔍 Señal técnica: {ticker}",
                body,
                {"ticker": ticker, "screen": "portfolio"},
                db,
            )
            await asyncio.sleep(random.uniform(0, 0.12))
            sent += 1
        logger.info("Opportunity push: %d sent, signals: %s", sent, {k: [s["ticker"] for s in v] for k, v in signals_by_risk.items()})
    except Exception as e:
        logger.error("job_opportunity_push failed: %s", e)


_VALUATION_TIER_MSG = {
    "avoid":   ("⚠️", "{name} está muy cara actualmente (${price} USD). Mejor esperar una bajada antes de comprar más."),
    "wait":    ("⚠️", "{name} está cara actualmente (${price} USD). Conviene esperar a que baje antes de comprar."),
    "neutral": ("📊", "{name} está en un precio justo actualmente ${price} USD."),
    "good":    ("💰", "{name} está en un buen rango para entrar actualmente (${price} USD)."),
    "strong":  ("💰", "{name} está barata actualmente, buena oportunidad para revisar fundamentos y considerar comprar ${price} USD."),
}

_COMPANY_SUFFIXES = (
    ", Inc.", " Inc.", ", Inc", " Incorporated", " Corporation", " Corp.",
    ", Ltd.", " Ltd.", " plc", " PLC", " Co.", " Company",
)


def _clean_company_name(raw: str | None, ticker: str) -> str:
    if not raw:
        return ticker
    name = raw
    for suf in _COMPANY_SUFFIXES:
        if name.endswith(suf):
            name = name[: -len(suf)]
            break
    return name.strip() or ticker


async def job_valuation_push():
    """Miércoles 12:00 PM ET — evalúa el nivel de valoración fundamental
    (fair value vs. precio actual: Muy cara / Cara / Precio justo / Buen rango /
    Barata) de cada ticker en watchlist + portafolio de cada usuario.
    Solo notifica cuando el nivel cambió desde la última vez (valuation_alert_state),
    para no repetir el mismo mensaje semana tras semana."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    from app.api.routes.market import _fetch_stock_detail, _compute_stock_score

    db = get_supabase()
    try:
        prefs_res = await run_query(
            db.table("notification_preferences")
            .select("user_id,push_portfolio_alerts,push_watchlist_alerts")
        )
        explicit_prefs: dict[str, dict] = {p["user_id"]: p for p in (prefs_res.data or [])}

        token_res = await run_query(
            db.table("user_profiles").select("user_id,push_token").neq("push_token", "").not_.is_("push_token", "null")
        )
        expo_uids: set[str] = {r["user_id"] for r in (token_res.data or [])}
        web_res = await run_query(db.table("web_push_subscriptions").select("user_id"))
        web_uids: set[str] = {r["user_id"] for r in (web_res.data or [])}
        token_uids: set[str] = expo_uids | web_uids

        watch_uid_res = await run_query(db.table("watchlist").select("user_id"))
        watch_uids: set[str] = {r["user_id"] for r in (watch_uid_res.data or [])}
        port_uid_res = await run_query(db.table("user_portfolio").select("user_id"))
        port_uids: set[str] = {r["user_id"] for r in (port_uid_res.data or [])}

        candidate_uids = token_uids & (watch_uids | port_uids)
        if not candidate_uids:
            return

        def _wants_portfolio(uid: str) -> bool:
            return explicit_prefs.get(uid, {}).get("push_portfolio_alerts", True)

        def _wants_watchlist(uid: str) -> bool:
            return explicit_prefs.get(uid, {}).get("push_watchlist_alerts", True)

        user_tickers: dict[str, set[str]] = {}
        all_tickers: set[str] = set()
        for uid in candidate_uids:
            tickers: set[str] = set()
            if _wants_portfolio(uid) and uid in port_uids:
                port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
                if port_res.data:
                    pos = _agg_positions(port_res.data or [])
                    tickers |= {p["ticker"] for p in pos if p.get("ticker")}
            if _wants_watchlist(uid) and uid in watch_uids:
                watch_res = await run_query(db.table("watchlist").select("ticker").eq("user_id", uid))
                tickers |= {r["ticker"] for r in (watch_res.data or [])}
            if tickers:
                user_tickers[uid] = tickers
                all_tickers |= tickers

        if not all_tickers:
            return

        # 1 valuation lookup per unique ticker (fair value via analyst target or
        # PEG-adjusted P/E), reused across every user tracking that ticker.
        def _score_one(ticker: str) -> dict | None:
            try:
                detail = _fetch_stock_detail(ticker)
                result = _compute_stock_score(detail)
                meta = result.get("entry_ranges_meta")
                if not meta:
                    return None
                current_tier = next((t for t in result.get("entry_ranges", []) if t.get("is_current")), None)
                if not current_tier:
                    return None
                return {
                    "signal": current_tier["signal"],
                    "price":  meta["current_price"],
                    "name":   _clean_company_name(detail.get("profile", {}).get("name"), ticker),
                }
            except Exception:
                return None

        ticker_info: dict[str, dict] = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
            futures = {ex.submit(_score_one, t): t for t in all_tickers}
            for fut, t in futures.items():
                try:
                    r = fut.result(timeout=20)
                    if r:
                        ticker_info[t] = r
                except Exception:
                    pass

        if not ticker_info:
            logger.info("Valuation push: no tickers could be scored")
            return

        state_res = await run_query(
            db.table("valuation_alert_state").select("user_id,ticker,last_tier")
            .in_("user_id", list(user_tickers.keys()))
        )
        last_tier: dict[tuple[str, str], str] = {
            (r["user_id"], r["ticker"]): r["last_tier"] for r in (state_res.data or [])
        }

        sent = 0
        for uid, tickers in user_tickers.items():
            for ticker in sorted(tickers & ticker_info.keys()):
                info = ticker_info[ticker]
                signal = info["signal"]
                if last_tier.get((uid, ticker)) == signal:
                    continue

                emoji, template = _VALUATION_TIER_MSG[signal]
                body = template.format(name=info["name"], price=f"{info['price']:,.2f}")

                await send_push(
                    uid, f"valuation_{ticker}",
                    f"{emoji} {ticker}", body,
                    {"ticker": ticker, "signal": signal, "price": info["price"], "screen": "watchlist"},
                    db,
                )
                await run_query(
                    db.table("valuation_alert_state").upsert(
                        {"user_id": uid, "ticker": ticker, "last_tier": signal,
                         "updated_at": datetime.utcnow().isoformat()},
                        on_conflict="user_id,ticker",
                    )
                )
                sent += 1
                await asyncio.sleep(random.uniform(0.05, 0.2))

        logger.info("Valuation push: %d tickers scored, %d pushes sent", len(ticker_info), sent)
    except Exception as e:
        logger.error("job_valuation_push failed: %s", e)


_DRIFT_STYLES = ("value", "growth", "dividend")


def _drift_reason(investing_style: str, categories: dict, dividend_yield: float) -> tuple[str, str] | None:
    """Returns (reason_key, reason_text) if the holding no longer matches the
    user's declared investing style, else None. Reuses the same category
    scores already computed for the AI Analyst / valuation push — a join,
    not new intelligence."""
    val_score  = categories.get("valuation")
    grow_score = categories.get("growth")
    if investing_style == "value" and val_score is not None and val_score < 35:
        return "expensive_for_value", "está cara respecto a sus fundamentos (múltiplos elevados), no encaja con una tesis de value investing"
    if investing_style == "growth" and grow_score is not None and grow_score < 35:
        return "weak_growth", "muestra crecimiento débil de ingresos/ganancias, no encaja con una tesis growth"
    if investing_style == "dividend" and (dividend_yield or 0) < 0.5:
        return "no_dividend", "prácticamente no paga dividendos, no encaja con una estrategia de renta pasiva"
    return None


async def job_thesis_drift_push():
    """Jueves 1:00 PM ET — AI Portfolio Manager, Premium only: detecta cuando
    una posición ya no encaja con el estilo de inversión declarado por el
    usuario (value/growth/dividend), reutilizando el scoring fundamental ya
    calculado para el X-ray de acciones y el push de valoración. Solo notifica
    cuando la razón de drift cambia (thesis_drift_state), no cada semana."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    from app.services.portfolio_manager_service import generate_thesis_drift_insight
    from app.api.routes.market import _fetch_stock_detail, _compute_stock_score

    db = get_supabase()
    try:
        prof_res = await run_query(
            db.table("user_profiles")
            .select("user_id,name,subscription_tier,trial_started_at,investing_style")
        )
        candidates = [
            r for r in (prof_res.data or [])
            if r.get("investing_style") in _DRIFT_STYLES
            and _is_premium_user(r.get("subscription_tier", "free"), r.get("trial_started_at"))
        ]
        if not candidates:
            return

        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id,push_portfolio_alerts")
        )
        explicit_prefs = {p["user_id"]: p.get("push_portfolio_alerts", True) for p in (prefs_res.data or [])}
        candidates = [r for r in candidates if explicit_prefs.get(r["user_id"], True)]
        if not candidates:
            return

        user_tickers: dict[str, set[str]] = {}
        all_tickers: set[str] = set()
        for r in candidates:
            uid = r["user_id"]
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if not port_res.data:
                continue
            pos = _agg_positions(port_res.data or [])
            tickers = {p["ticker"] for p in pos if p.get("ticker")}
            if tickers:
                user_tickers[uid] = tickers
                all_tickers |= tickers

        if not all_tickers:
            return

        def _score_one(ticker: str) -> dict | None:
            try:
                detail = _fetch_stock_detail(ticker)
                result = _compute_stock_score(detail)
                categories = {c["key"]: c["score"] for c in result.get("categories", [])}
                dividend_yield = float(detail.get("profile", {}).get("dividend_yield") or 0)
                return {
                    "categories": categories,
                    "dividend_yield": dividend_yield,
                    "name": _clean_company_name(detail.get("profile", {}).get("name"), ticker),
                }
            except Exception:
                return None

        ticker_info: dict[str, dict] = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
            futures = {ex.submit(_score_one, t): t for t in all_tickers}
            for fut, t in futures.items():
                try:
                    r = fut.result(timeout=20)
                    if r:
                        ticker_info[t] = r
                except Exception:
                    pass

        prof_map = {r["user_id"]: r for r in candidates}
        state_res = await run_query(
            db.table("thesis_drift_state").select("user_id,ticker,reason_key")
            .in_("user_id", list(user_tickers.keys()))
        )
        last_reason: dict[tuple[str, str], str] = {
            (r["user_id"], r["ticker"]): r["reason_key"] for r in (state_res.data or [])
        }

        sent = 0
        for uid, tickers in user_tickers.items():
            style = prof_map[uid]["investing_style"]
            first = (prof_map[uid].get("name") or "Inversor").split()[0]
            for ticker in sorted(tickers & ticker_info.keys()):
                info = ticker_info[ticker]
                drift = _drift_reason(style, info["categories"], info["dividend_yield"])
                if not drift:
                    continue
                reason_key, reason_text = drift
                if last_reason.get((uid, ticker)) == reason_key:
                    continue

                body = await generate_thesis_drift_insight(first, ticker, info["name"], style, reason_text)
                if not body:
                    body = f"{info['name']} ({ticker}) {reason_text}. Vale la pena revisar tu tesis."

                await send_push(
                    uid, f"thesis_drift_{ticker}",
                    f"🔍 {ticker}: ¿aún encaja?",
                    body,
                    {"ticker": ticker, "screen": "portfolio"},
                    db,
                )
                await run_query(
                    db.table("thesis_drift_state").upsert(
                        {"user_id": uid, "ticker": ticker, "reason_key": reason_key,
                         "updated_at": datetime.utcnow().isoformat()},
                        on_conflict="user_id,ticker",
                    )
                )
                sent += 1
                await asyncio.sleep(random.uniform(0.05, 0.2))

        logger.info("Thesis drift push: %d tickers scored, %d pushes sent", len(ticker_info), sent)
    except Exception as e:
        logger.error("job_thesis_drift_push failed: %s", e)


# ── Daily habit system — evening capsule ──────────────────────────────────────
_EVENING_CAPSULES = [
    ("🌙 Cápsula de 3 min: Free Cash Flow", "El FCF es el efectivo que le queda a una empresa después de operar e invertir en sí misma — más confiable que la utilidad neta, que se puede maquillar. 3 min en la Academia Nuvos."),
    ("🌙 Cápsula de 3 min: Foso competitivo", "Un 'moat' es lo que protege a una empresa de la competencia: marca, costos de cambio, efecto de red. Aprende a identificarlo en 3 minutos."),
    ("🌙 Cápsula de 3 min: Margen de seguridad", "Comprar por debajo del valor intrínseco te protege de tus propios errores de análisis. Es la idea central de Benjamin Graham — repásala hoy."),
    ("🌙 Cápsula de 3 min: Sesgo de confirmación", "Buscamos información que confirme lo que ya creemos sobre una acción, e ignoramos lo que la contradice. Aprende a detectarlo en ti mismo."),
    ("🌙 Cápsula de 3 min: Dilución de acciones", "Cuando una empresa emite más acciones, tu porcentaje de propiedad se reduce aunque el precio no cambie. Entiende por qué importa."),
    ("🌙 Cápsula de 3 min: Ciclo económico", "Identificar en qué fase del ciclo está la economía te ayuda a entender por qué ciertos sectores se comportan distinto. 3 minutos para ubicarte."),
    ("🌙 Cápsula de 3 min: Costo de oportunidad", "Cada dólar invertido en algo es un dólar que no está en otra cosa. Aprende a pensar así antes de tu próxima decisión."),
]


async def job_evening_capsule_push():
    """7:30 PM ET diario — cápsula educativa de 3 minutos, cierre del día.
    Rotación independiente de job_education_push (contenido y horario distintos),
    pensada como el ritual nocturno del hábito diario."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    try:
        day_idx = datetime.now(timezone.utc).timetuple().tm_yday
        title, body = _EVENING_CAPSULES[day_idx % len(_EVENING_CAPSULES)]

        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("push_news_general", True)
        )
        sent = 0
        for i, u in enumerate(prefs_res.data or []):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))
            await send_push(u["user_id"], "evening_capsule", title, body, {"screen": "academy"}, db)
            sent += 1
        logger.info("Evening capsule push: %d sent (capsule index %d)", sent, day_idx % len(_EVENING_CAPSULES))
    except Exception as e:
        logger.error("job_evening_capsule_push failed: %s", e)


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
            .select("user_id,name,subscription_tier,trial_started_at,investing_style")
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

            change_str = ""
            if prev and prev.get("total_value"):
                delta = total - prev["total_value"]
                pct   = delta / prev["total_value"] * 100 if prev["total_value"] else 0
                sign  = "+" if delta >= 0 else ""
                change_str = f" ({sign}${delta:,.0f}, {sign}{pct:.1f}% vs. hace 7 días)"

            body = None
            if is_prem:
                style = prof.get("investing_style")
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
                body = f"Tu portafolio cerró la semana en ${total:,.0f} USD{change_str}. Revisa el detalle en Nuvos."

            await send_push(
                uid, "sunday_portfolio_review",
                "📅 Tu semana en Nuvos",
                body,
                {"screen": "portfolio"},
                db,
            )
            sent += 1
            await asyncio.sleep(random.uniform(0.05, 0.2))

        logger.info("Sunday portfolio review: %d sent", sent)
    except Exception as e:
        logger.error("job_sunday_portfolio_review failed: %s", e)


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
            names = ", ".join(reporting[:5])
            extra = f" y {len(reporting) - 5} más" if len(reporting) > 5 else ""
            body = f"Esta temporada de earnings reportan: {names}{extra}. Prepárate revisando expectativas en Nuvos."
            await send_push(
                uid, "quarterly_earnings_digest",
                "📈 Temporada de resultados",
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


async def job_action_followup():
    """Every 4h — push reminder for committed actions that are overdue (basic/intermediate only)."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    try:
        now = datetime.now(timezone.utc)
        res = await run_query(
            db.table("pending_actions")
            .select("id,user_id,action_type,action_label,action_data")
            .eq("status", "committed")
            .is_("notified_at", "null")
            .lte("due_at", now.isoformat())
            .limit(200)
        )
        if not res.data:
            return

        user_ids = list({r["user_id"] for r in res.data})
        prof_res = await run_query(
            db.table("user_profiles")
            .select("user_id,knowledge_level,subscription_tier")
            .in_("user_id", user_ids)
        )
        allowed = {
            p["user_id"] for p in (prof_res.data or [])
            if p.get("subscription_tier") == "premium"
            and p.get("knowledge_level") in ("A", "B", "C", None)
        }

        sent = 0
        for action in res.data:
            uid = action["user_id"]
            if uid not in allowed:
                continue
            a_type  = action.get("action_type", "general")
            label   = action.get("action_label", "")
            a_data  = action.get("action_data") or {}
            ticker  = a_data.get("ticker", "")
            topic   = a_data.get("topic", "")

            if a_type == "watchlist" and ticker:
                title = "¿Agregaste la acción?"
                body  = f"Dijiste que ibas a agregar {ticker} a tu watchlist. ¿Ya lo hiciste?"
                data  = {"screen": "chat", "suggested_message": f"¿Debo agregar {ticker} a mi watchlist ahora?"}
            elif a_type == "decision" and ticker:
                title = "Tu decisión de inversión"
                body  = f"Tenías pendiente una decisión sobre {ticker}. Tu mentor puede ayudarte."
                data  = {"screen": "chat", "suggested_message": f"Necesito tomar una decisión sobre {ticker}. ¿Me ayudas?"}
            elif a_type == "learn" and topic:
                title = "Continúa aprendiendo"
                body  = f"Querías explorar '{topic}'. Tu mentor te espera."
                data  = {"screen": "learn", "topic": topic}
            else:
                title = "Acción pendiente con tu mentor"
                body  = f"Tenías pendiente: {label}. ¿Lo completaste?"
                data  = {"screen": "chat"}

            await send_push(uid, "action_followup", title, body, data, db)
            await run_query(
                db.table("pending_actions")
                .update({"notified_at": now.isoformat()})
                .eq("id", action["id"])
            )
            sent += 1
            await asyncio.sleep(random.uniform(0, 0.1))

        logger.info("Action followup: %d reminders sent", sent)
    except Exception as e:
        logger.error("job_action_followup failed: %s", e)


async def job_mentor_nudge():
    """3:00 PM ET daily — mentor nudge for basic/intermediate users inactive for 3+ days."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    try:
        prefs_res = await run_query(
            db.table("notification_preferences")
            .select("user_id,last_opened_app")
            .eq("push_ai_recommendations", True)
        )
        inactive_uids = [
            r["user_id"] for r in (prefs_res.data or [])
            if not r.get("last_opened_app") or r["last_opened_app"] < cutoff
        ]
        if not inactive_uids:
            return

        prof_res = await run_query(
            db.table("user_profiles")
            .select("user_id,knowledge_level,subscription_tier,name,mentor")
            .in_("user_id", inactive_uids)
        )
        basic_intermediate = {
            p["user_id"]: p for p in (prof_res.data or [])
            if p.get("subscription_tier") == "premium"
            and p.get("knowledge_level") in ("A", "B", "C", None)
        }
        if not basic_intermediate:
            return

        MENTOR_NAMES = {"warren_buffett": "Warren", "ray_dalio": "Ray", "bill_ackman": "Bill"}
        SUGGESTED_MESSAGES = [
            "¿Qué debería revisar en mi portafolio esta semana?",
            "¿Hay alguna oportunidad interesante en el mercado ahora?",
            "¿Estoy bien diversificado para el entorno actual?",
            "¿Qué lección debería aprender hoy para mejorar como inversor?",
        ]

        sent = 0
        for i, (uid, prof) in enumerate(basic_intermediate.items()):
            if i % 50 == 0 and i > 0:
                await asyncio.sleep(6)
            mentor_key  = prof.get("mentor") or "warren_buffett"
            mentor_name = MENTOR_NAMES.get(mentor_key, "tu mentor")
            suggested   = SUGGESTED_MESSAGES[i % len(SUGGESTED_MESSAGES)]
            await send_push(
                uid, "mentor_nudge",
                f"📬 {mentor_name} tiene algo para ti",
                f"Llevas unos días sin hablar con tu mentor. ¿Tienes alguna duda sobre tus inversiones?",
                {"screen": "chat", "suggested_message": suggested},
                db,
            )
            sent += 1
            await asyncio.sleep(random.uniform(0, 0.1))

        logger.info("Mentor nudge: %d sent to basic/intermediate inactive users", sent)
    except Exception as e:
        logger.error("job_mentor_nudge failed: %s", e)


async def job_annual_scoreboard():
    """5 Dec every year, 9:00 AM ET — push + email: Annual ScoreBoard is live."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    from app.services.email_service import send_email

    db = get_supabase()
    year = datetime.now(timezone.utc).year

    PUSH_TITLE = f"🏆 Tu Annual ScoreBoard {year} está listo"
    PUSH_BODY  = (
        f"Revisa tu resumen anual como inversor en Nuvos AI — "
        f"tus top acciones, lecciones completadas y más. ¡Entra a verlo!"
    )

    def _scoreboard_email_html(name: str, year: int) -> str:
        first = name.split()[0] if name else "Inversor"
        return f"""<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;padding:32px 0;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#090f1f;border-radius:20px;border:1px solid rgba(0,212,126,0.2);overflow:hidden;max-width:560px;width:100%;">
      <!-- Accent bar -->
      <tr><td style="height:4px;background:linear-gradient(90deg,rgba(0,212,126,0.6),#00d47e);"></td></tr>
      <tr><td style="padding:32px 36px 28px;">
        <!-- Logo -->
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="background:#00d47e;border-radius:10px;width:36px;height:36px;text-align:center;vertical-align:middle;">
            <span style="color:#0d1117;font-size:18px;font-weight:900;line-height:36px;">N</span>
          </td>
          <td style="padding-left:10px;color:#fff;font-size:16px;font-weight:900;">Nuvos AI</td>
        </tr></table>

        <!-- Hero -->
        <p style="margin:28px 0 6px;font-size:11px;font-weight:900;color:#00d47e;letter-spacing:1px;text-transform:uppercase;">Resumen Anual</p>
        <h1 style="margin:0 0 4px;font-size:36px;font-weight:900;color:#fff;line-height:1.1;letter-spacing:-1px;">Annual ScoreBoard<br>{year}</h1>
        <p style="margin:12px 0 0;font-size:15px;color:#8fa3c0;line-height:1.6;">Hola {first}, tu resumen anual como inversor ya está disponible en Nuvos AI.</p>

        <!-- Card -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
          <tr><td style="background:rgba(0,212,126,0.06);border:1px solid rgba(0,212,126,0.18);border-radius:16px;padding:24px;">
            <p style="margin:0 0 16px;font-size:22px;">🏆</p>
            <p style="margin:0 0 10px;font-size:16px;font-weight:900;color:#fff;">Lo que encontrarás en tu ScoreBoard</p>
            <table cellpadding="0" cellspacing="0">
              <tr><td style="padding:5px 0;color:#8fa3c0;font-size:14px;">🚀&nbsp; Top 3 acciones de tu portafolio con mejor rendimiento YTD</td></tr>
              <tr><td style="padding:5px 0;color:#8fa3c0;font-size:14px;">🧠&nbsp; Total de lecciones, simulaciones y debates completados</td></tr>
              <tr><td style="padding:5px 0;color:#8fa3c0;font-size:14px;">🏆&nbsp; El sector donde más exposición tuviste este año</td></tr>
              <tr><td style="padding:5px 0;color:#8fa3c0;font-size:14px;">📊&nbsp; Días activo en la plataforma durante {year}</td></tr>
            </table>
          </td></tr>
        </table>

        <!-- CTA -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
          <tr><td align="center">
            <a href="https://nuvosai.app/profile" style="display:inline-block;background:#00d47e;color:#fff;font-size:15px;font-weight:900;text-decoration:none;padding:14px 40px;border-radius:14px;">Ver mi Annual ScoreBoard →</a>
          </td></tr>
        </table>

        <p style="margin:28px 0 0;font-size:13px;color:#374151;text-align:center;">
          Este es tu resumen de {year} como inversor en Nuvos AI.<br>
          Gracias por confiar en nosotros para crecer como inversor informado.
        </p>
      </td></tr>

      <!-- Footer -->
      <tr><td style="border-top:1px solid rgba(255,255,255,0.06);padding:20px 36px;text-align:center;">
        <p style="margin:0;font-size:12px;color:#374151;">Nuvos AI · Tu mentor de inversiones educativo</p>
        <p style="margin:6px 0 0;font-size:11px;color:#1f2937;">NOTA: Esto no es asesoría financiera. Es educación inversora.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>"""

    try:
        # ── Push notifications ───────────────────────────────────────────────
        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("push_milestones", True)
        )
        uids = [u["user_id"] for u in (prefs_res.data or [])]
        push_sent = 0
        for i, uid in enumerate(uids):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))
            await send_push(
                uid, "annual_scoreboard",
                PUSH_TITLE, PUSH_BODY,
                {"screen": "profile", "section": "scoreboard"},
                db,
            )
            push_sent += 1
        logger.info("Annual ScoreBoard push: %d sent", push_sent)

        # ── Emails ───────────────────────────────────────────────────────────
        if not settings.resend_api_key:
            logger.info("RESEND_API_KEY not set — skipping Annual ScoreBoard emails")
            return

        users_res  = await run_query(db.table("user_profiles").select("user_id,name"))
        auth_users = {u.id: u.email for u in await asyncio.to_thread(lambda: db.auth.admin.list_users())}
        email_sent = 0
        for u in (users_res.data or []):
            email = auth_users.get(u["user_id"])
            if not email:
                continue
            html = _scoreboard_email_html(u.get("name") or "Inversor", year)
            ok   = await send_email(email, f"🏆 Tu Annual ScoreBoard {year} está listo — Nuvos AI", html)
            if ok:
                email_sent += 1
            await asyncio.sleep(random.uniform(0.05, 0.15))
        logger.info("Annual ScoreBoard email: %d sent", email_sent)

    except Exception as e:
        logger.error("job_annual_scoreboard failed: %s", e)


async def job_portfolio_snapshot(slot: str):
    """Personalized portfolio snapshot vs S&P 500 & NASDAQ — sent 4x per trading day.
    slot: 'opening' (9:35 AM) | 'midday' (11:35 AM) | 'afternoon' (1:35 PM) | 'preclose' (3:35 PM)
    Uses SPY/QQQ proxies (^GSPC/^IXIC blocked on Railway). Skips holidays.
    """
    if not _is_market_open_today():
        logger.info("job_portfolio_snapshot[%s]: market closed today — skipping", slot)
        return

    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    try:
        # ── 1. Fetch index prices via Finnhub (Railway-safe) ─────────────────────
        spy_q = await asyncio.to_thread(_finnhub_quote, "SPY")
        qqq_q = await asyncio.to_thread(_finnhub_quote, "QQQ")
        sp500_pct  = spy_q["pct"] if spy_q else None
        nasdaq_pct = qqq_q["pct"] if qqq_q else None

        # ── 2. Users with portfolio alerts enabled ────────────────────────────
        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("push_portfolio_alerts", True)
        )
        uids = [u["user_id"] for u in (prefs_res.data or [])]
        if not uids:
            return

        # ── 3. First names in one query ───────────────────────────────────────
        profiles_res = await run_query(
            db.table("user_profiles").select("user_id,name").in_("user_id", uids)
        )
        name_map = {
            r["user_id"]: (r.get("name") or "Inversor").split()[0]
            for r in (profiles_res.data or [])
        }

        # ── 4. Collect portfolio positions per user ───────────────────────────
        portfolio_map: dict[str, list] = {}
        all_tickers: set[str] = set()
        for uid in uids:
            port_res = await run_query(
                db.table("user_portfolio").select("positions").eq("user_id", uid)
            )
            if port_res.data:
                pos = _agg_positions(port_res.data or [])
                if pos:
                    portfolio_map[uid] = pos
                    all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        if not all_tickers:
            return

        # ── 5. Fetch portfolio prices concurrently via Finnhub ───────────────────
        prices = await _finnhub_prices_batch(list(all_tickers))

        # ── 6. Build per-slot message template ───────────────────────────────
        slot_intro = {
            "opening":  "hoy",
            "midday":   "a mitad del día",
            "afternoon":"esta tarde",
            "preclose": "antes del cierre",
        }.get(slot, "ahora")

        # ── 7. Fan out — one push per user ────────────────────────────────────
        sent = 0
        for i, uid in enumerate(uids):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.1))

            if uid not in portfolio_map:
                continue

            user_pct = _calc_portfolio_pct(portfolio_map[uid], prices)
            if user_pct is None:
                continue

            first = name_map.get(uid, "Inversor")

            # ── Compose body matching Diego's requested format ────────────────
            port_str = f"{user_pct:+.2f}%"
            sp_str   = f"{sp500_pct:+.2f}%" if sp500_pct is not None else "N/D"
            nq_str   = f"{nasdaq_pct:+.2f}%" if nasdaq_pct is not None else "N/D"

            port_verb = "cayendo" if user_pct < 0 else "subiendo"
            sp_verb   = "cayendo" if (sp500_pct or 0) < 0 else "subiendo"
            nq_verb   = "subiendo" if (nasdaq_pct or 0) >= 0 else "cayendo"

            # All three moving same direction → shorter "X, Y y Z respectivamente"
            if sp500_pct is not None and nasdaq_pct is not None:
                if (sp500_pct < 0) == (nasdaq_pct < 0):
                    idx_dir   = "cayendo" if sp500_pct < 0 else "subiendo"
                    idx_block = f"el S&P 500 y el Nasdaq están {idx_dir} {sp_str} y {nq_str} respectivamente"
                else:
                    idx_block = f"S&P 500 {sp_str} | Nasdaq {nq_str}"
            else:
                idx_block = f"S&P 500 {sp_str}"

            if slot == "opening":
                body = f"{first}, hoy tu portafolio está {port_verb} {port_str}, {idx_block}."
            elif slot == "preclose":
                body = f"{first}, media hora para el cierre. Tu portafolio lleva {port_str} hoy. {idx_block.capitalize()}."
            else:
                body = f"{first}, actualización {slot_intro}: tu portafolio va {port_str}. {idx_block.capitalize()}."

            # ── Title: reflect whether user is beating the market ─────────────
            beating = sp500_pct is not None and user_pct > sp500_pct
            if user_pct >= 0:
                emoji = "🚀" if user_pct >= 1.5 else "🟢"
                title = f"{emoji} Portafolio {port_str} hoy" + (" — superando al mercado" if beating else "")
            else:
                emoji = "🔴" if user_pct <= -1.5 else "🔻"
                title = f"{emoji} Portafolio {port_str} hoy"

            await send_push(
                uid, f"portfolio_snapshot_{slot}",
                title, body,
                {"screen": "portfolio"},
                db,
            )
            sent += 1

        logger.info(
            "Portfolio snapshot (%s): %d sent | Portfolio avg=N/A | S&P %s | NQ %s",
            slot, sent, sp500_pct, nasdaq_pct,
        )
    except Exception as e:
        logger.error("job_portfolio_snapshot(%s) failed: %s", slot, e)


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
            .select("user_id,name,subscription_tier,mentor")
            .in_("user_id", user_ids)
        )
        premium_ids = {p["user_id"] for p in (prof_res.data or []) if p.get("subscription_tier") == "premium"}

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
            if diff > 0:
                msg = f"Tu portafolio subió {sign}{port_pct:.1f}% hoy vs S&P {sp_sign}{sp_pct:.1f}%. ¿Quieres que analice qué lo impulsó?"
            else:
                msg = f"Tu portafolio bajó {port_pct:.1f}% vs S&P {sp_sign}{sp_pct:.1f}%. ¿Quieres que te explique la diferencia?"

            encoded_msg = msg.replace("&", "%26").replace("?", "%3F")
            ok = await _send_mobile_push(
                uid, "proactive_vs_market",
                "📊 Tu portafolio vs el mercado hoy",
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
            .select("user_id,subscription_tier")
            .in_("user_id", user_ids)
        )
        premium_ids = {p["user_id"] for p in (prof_res.data or []) if p.get("subscription_tier") == "premium"}

        sent = 0
        for uid in premium_ids:
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if not port_res.data:
                continue
            positions = _agg_positions(port_res.data)
            tickers = [p["ticker"] for p in positions if p.get("ticker")]
            if not tickers:
                continue

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
                when = "hoy" if hit["date"] == str(today) else "mañana"
                shares_str = f" · Tienes {hit['shares']:.0f} acciones" if hit["shares"] else ""
                eps_str = f" · EPS est. ${hit['eps_est']}" if hit.get("eps_est") else ""
                msg = f"{hit['ticker']} reporta earnings {when}{shares_str}{eps_str}. ¿Quieres que te explique qué vigilar?"
                encoded = msg.replace("&", "%26").replace("?", "%3F")
                ok = await _send_mobile_push(
                    uid, "earnings_preview",
                    f"📅 {hit['ticker']} reporta {when}",
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


async def job_proactive_rebalancing():
    """Every Sunday 10 AM ET — detect sector concentration drift and suggest rebalancing."""
    from app.core.database import get_supabase, run_query
    db = get_supabase()

    SECTOR_MAP: dict[str, str] = {
        "AAPL":"Tech","MSFT":"Tech","GOOGL":"Tech","META":"Tech","NVDA":"Tech",
        "AMZN":"Tech","TSLA":"Tech","AMD":"Tech","INTC":"Tech","ORCL":"Tech",
        "JPM":"Finanzas","BAC":"Finanzas","GS":"Finanzas","V":"Finanzas","MA":"Finanzas",
        "UNH":"Salud","JNJ":"Salud","PFE":"Salud","ABBV":"Salud","MRK":"Salud",
        "XOM":"Energía","CVX":"Energía","COP":"Energía",
        "WMT":"Consumo","COST":"Consumo","PG":"Consumo","KO":"Consumo",
    }

    try:
        users_res = await run_query(
            db.table("notification_preferences")
            .select("user_id")
            .eq("push_ai_recommendations", True)
        )
        user_ids = [r["user_id"] for r in (users_res.data or [])]

        prof_res = await run_query(
            db.table("user_profiles")
            .select("user_id,subscription_tier")
            .in_("user_id", user_ids)
        )
        premium_ids = {p["user_id"] for p in (prof_res.data or []) if p.get("subscription_tier") == "premium"}

        sent = 0
        for uid in premium_ids:
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if not port_res.data:
                continue
            positions = _agg_positions(port_res.data)
            if len(positions) < 3:
                continue

            tickers = [p["ticker"] for p in positions if p.get("ticker")]
            try:
                prices = await asyncio.to_thread(_batch_prices, tickers[:20])
            except Exception:
                continue

            sector_vals: dict[str, float] = {}
            total = 0.0
            for p in positions:
                t = p.get("ticker", "")
                q = prices.get(t) or {}
                val = (q.get("price") or 0) * (p.get("shares") or 0)
                sector = SECTOR_MAP.get(t, "Otro")
                sector_vals[sector] = sector_vals.get(sector, 0) + val
                total += val

            if total == 0:
                continue

            top_sector = max(sector_vals, key=lambda k: sector_vals[k])
            top_pct = sector_vals[top_sector] / total * 100

            if top_pct < 45:
                continue

            msg = (
                f"Tu portafolio tiene {top_pct:.0f}% concentrado en {top_sector}. "
                f"Históricamente, superar el 40% en un sector aumenta la volatilidad. "
                f"¿Quieres que revisemos opciones de diversificación?"
            )
            encoded = msg.replace("&", "%26").replace("?", "%3F")
            ok = await _send_mobile_push(
                uid, "rebalancing_alert",
                f"⚖️ {top_pct:.0f}% en {top_sector} — ¿diversificamos?",
                msg,
                {"screen": "chat", "msg": encoded},
                db,
            )
            if ok:
                sent += 1
            await asyncio.sleep(0.05)

        logger.info("job_proactive_rebalancing: %d notifications sent", sent)
    except Exception as e:
        logger.error("job_proactive_rebalancing failed: %s", e)


async def main():
    # misfire_grace_time: if Railway restarts the worker near a job's fire time,
    # APScheduler will still run the job if it missed by less than this window.
    scheduler = AsyncIOScheduler(job_defaults={"misfire_grace_time": 600})

    # ── Mon-Fri: core daily jobs ──────────────────────────────────────────────
    scheduler.add_job(job_ipo_alerts,            "cron",                        hour=7,       minute=45,    timezone="America/New_York")
    scheduler.add_job(job_events_alerts,        "cron", day_of_week="mon-fri", hour=8,       minute=0,     timezone="America/New_York")
    scheduler.add_job(job_earnings_bmo,         "cron", day_of_week="mon-fri", hour=9,       minute=15,    timezone="America/New_York")
    scheduler.add_job(job_market_open,          "cron", day_of_week="mon-fri", hour=9,       minute=30,    timezone="America/New_York")
    scheduler.add_job(job_holiday_midday,       "cron", day_of_week="mon-fri", hour=12,      minute=0,     timezone="America/New_York")
    scheduler.add_job(job_portfolio_alerts,     "cron", day_of_week="mon-fri", hour="9-15",  minute="*/5", timezone="America/New_York")
    scheduler.add_job(job_market_close,         "cron", day_of_week="mon-fri", hour=16,      minute=0,     timezone="America/New_York")
    scheduler.add_job(job_earnings_results,     "cron", day_of_week="mon-fri", hour=16,      minute=30,    timezone="America/New_York")
    scheduler.add_job(job_daily_email,          "cron", day_of_week="fri",     hour=18,      minute=0,     timezone="America/New_York")

    # ── Saturday: weekly screener (premium only) ──────────────────────────────
    scheduler.add_job(job_weekly_screener_push, "cron", day_of_week="sat",     hour=11,      minute=0,     timezone="America/New_York")

    # ── Wednesday: weekly valuation push (watchlist + portfolio, all users) ───
    scheduler.add_job(job_valuation_push,       "cron", day_of_week="wed",     hour=12,      minute=0,     timezone="America/New_York")

    # ── AI Portfolio Manager — proactive alerts (written earlier, now scheduled) ──
    scheduler.add_job(job_risk_mgmt_push,        "cron", day_of_week="fri",     hour=15, minute=0, timezone="America/New_York")
    scheduler.add_job(job_diversification_push,  "cron", day_of_week="sat",     hour=11, minute=0, timezone="America/New_York")
    scheduler.add_job(job_concentration_risk_push, "cron", day_of_week="tue",   hour=13, minute=0, timezone="America/New_York")
    scheduler.add_job(job_opportunity_push,      "cron", day_of_week="wed,fri", hour=13, minute=0, timezone="America/New_York")
    scheduler.add_job(job_social_proof_push,     "cron", day_of_week="sat",     hour=15, minute=0, timezone="America/New_York")
    scheduler.add_job(job_education_push,        "cron", day_of_week="mon,wed,fri", hour=14, minute=0, timezone="America/New_York")
    scheduler.add_job(job_reengagement_push,     "cron",                        hour=11, minute=0, timezone="America/New_York")
    scheduler.add_job(job_thesis_drift_push,     "cron", day_of_week="thu",     hour=13, minute=0, timezone="America/New_York")

    # ── Daily habit system ──────────────────────────────────────────────────────
    scheduler.add_job(job_evening_capsule_push,      "cron",                    hour=19, minute=30, timezone="America/New_York")
    scheduler.add_job(job_sunday_portfolio_review,   "cron", day_of_week="sun", hour=17, minute=0,  timezone="America/New_York")
    scheduler.add_job(job_quarterly_earnings_digest, "cron", month="1,4,7,10", day=5, hour=9, minute=0, timezone="America/New_York")

    # ── Monthly: day 1 (premium personalized, free general) ──────────────────
    scheduler.add_job(job_monthly_report_push,  "cron", day=1,                 hour=9,       minute=0,     timezone="America/New_York")
    scheduler.add_job(send_monthly_reports,     "cron", day=1,                 hour=9,       minute=0,     timezone="America/New_York")

    # ── Specials ──────────────────────────────────────────────────────────────
    scheduler.add_job(send_birthday_emails,     "cron",                     hour=8,       minute=0,     timezone="America/New_York")
    scheduler.add_job(job_annual_scoreboard,    "cron", month=12, day=5,   hour=9,       minute=0,     timezone="America/New_York")

    # ── Proactive Mentor IA ───────────────────────────────────────────────────
    scheduler.add_job(job_proactive_vs_market,        "cron", day_of_week="mon-fri", hour=16, minute=45, timezone="America/New_York")
    scheduler.add_job(job_proactive_earnings_preview, "cron", day_of_week="mon-fri", hour=8,  minute=30, timezone="America/New_York")
    scheduler.add_job(job_proactive_rebalancing,      "cron", day_of_week="sun",     hour=10, minute=0,  timezone="America/New_York")

    # ── Financial Memory Graph — daily portfolio snapshot ─────────────────────
    scheduler.add_job(job_fmg_snapshot,         "cron", day_of_week="mon-fri", hour=16, minute=5, timezone="America/New_York")

    # ── Cleanup ───────────────────────────────────────────────────────────────
    scheduler.add_job(job_cleanup_analytics,    "interval", hours=1)

    # Backfill notification_preferences for existing users who never opened settings.
    # Without this row the worker can't find them and push never fires.
    asyncio.create_task(_backfill_notification_prefs())

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
