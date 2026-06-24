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
import random
import concurrent.futures
from datetime import datetime, timezone, timedelta
from apscheduler.schedulers.asyncio import AsyncIOScheduler
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
    """Fetch last-2-close prices for a list of tickers via yfinance (one batch call)."""
    if not tickers:
        return {}

    def _fetch():
        try:
            import yfinance as yf
            data = yf.download(list(set(tickers)), period="2d", progress=False, group_by="ticker")
            result = {}
            if len(tickers) == 1:
                # Single ticker: data is a plain DataFrame
                t = tickers[0]
                closes = data["Close"].dropna()
                if len(closes) >= 2:
                    result[t] = {"prev": float(closes.iloc[-2]), "curr": float(closes.iloc[-1])}
            else:
                for t in tickers:
                    try:
                        closes = data[t]["Close"].dropna()
                        if len(closes) >= 2:
                            result[t] = {"prev": float(closes.iloc[-2]), "curr": float(closes.iloc[-1])}
                    except Exception:
                        pass
            return result
        except Exception as e:
            logger.warning("_batch_fetch_prices failed: %s", e)
            return {}

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
    """Fetch Mon→Fri performance for weekly % comparison (period='5d')."""
    if not tickers:
        return {}

    def _fetch():
        try:
            import yfinance as yf
            data = yf.download(list(set(tickers)), period="5d", progress=False, group_by="ticker")
            result = {}
            if len(tickers) == 1:
                t = tickers[0]
                closes = data["Close"].dropna()
                if len(closes) >= 2:
                    result[t] = {"prev": float(closes.iloc[0]), "curr": float(closes.iloc[-1])}
            else:
                for t in tickers:
                    try:
                        closes = data[t]["Close"].dropna()
                        if len(closes) >= 2:
                            result[t] = {"prev": float(closes.iloc[0]), "curr": float(closes.iloc[-1])}
                    except Exception:
                        pass
            return result
        except Exception as e:
            logger.warning("_batch_fetch_weekly_prices failed: %s", e)
            return {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
        return await asyncio.get_event_loop().run_in_executor(ex, _fetch)


async def send_weekly_emails():
    """Personalized weekly summary — every Friday after market close."""
    if not settings.resend_api_key:
        logger.info("RESEND_API_KEY not set — skipping weekly emails")
        return
    from app.core.database import get_supabase, run_query
    import yfinance as yf
    db = get_supabase()
    try:
        users_res = await run_query(
            db.table("user_profiles").select("user_id,name,risk_tolerance,subscription_tier")
        )
        users = users_res.data
        auth_users = {u.id: u.email for u in await asyncio.to_thread(lambda: db.auth.admin.list_users())}

        # Fetch all portfolios at once
        port_res = await run_query(db.table("user_portfolio").select("user_id,positions"))
        portfolio_map: dict[str, list] = {}
        for row in (port_res.data or []):
            raw = row.get("positions") or {}
            pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
            if pos:
                portfolio_map[row["user_id"]] = pos

        # Collect all tickers across all portfolios + market indices
        all_tickers = list({p["ticker"] for positions in portfolio_map.values() for p in positions if p.get("ticker")})
        all_tickers += ["^GSPC", "^IXIC"]
        weekly_prices = await _batch_fetch_weekly_prices(all_tickers)

        sp500_pct  = None
        nasdaq_pct = None
        if "^GSPC" in weekly_prices:
            px = weekly_prices["^GSPC"]
            sp500_pct = (px["curr"] - px["prev"]) / px["prev"] * 100 if px["prev"] else None
        if "^IXIC" in weekly_prices:
            px = weekly_prices["^IXIC"]
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
    """Generate and email monthly portfolio report to all premium users — 1st of each month."""
    if not settings.resend_api_key:
        logger.info("RESEND_API_KEY not set — skipping monthly reports")
        return
    from app.core.database import get_supabase, run_query
    db = get_supabase()
    try:
        users_res = await run_query(
            db.table("user_profiles").select("user_id,name,subscription_tier")
        )
        users = users_res.data
        auth_users = {u.id: u.email for u in await asyncio.to_thread(lambda: db.auth.admin.list_users())}
        sent = errors = skipped = 0
        for u in users:
            if u.get("subscription_tier") != "premium":
                skipped += 1
                continue
            email = auth_users.get(u["user_id"])
            if not email:
                skipped += 1
                continue
            try:
                ok = await generate_and_send_monthly_report(
                    user_id=u["user_id"],
                    email=email,
                    name=u.get("name") or "Inversor",
                )
                if ok:
                    sent += 1
                else:
                    skipped += 1  # no portfolio or empty
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

async def job_market_open():
    """9:30 AM ET weekdays — personalized open alert for ALL users.
    Shows portfolio pre-market change vs S&P 500 and Nasdaq when available."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    try:
        # Use _batch_fetch_prices (reliable) instead of get_market_summary_text
        index_raw  = await _batch_fetch_prices(["^GSPC", "^IXIC"])
        sp_px      = index_raw.get("^GSPC", {})
        nq_px      = index_raw.get("^IXIC", {})
        sp500_pct  = round((sp_px["curr"] - sp_px["prev"]) / sp_px["prev"] * 100, 2) if sp_px.get("prev") else None
        nasdaq_pct = round((nq_px["curr"] - nq_px["prev"]) / nq_px["prev"] * 100, 2) if nq_px.get("prev") else None

        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("push_market_open", True)
        )
        uids = [u["user_id"] for u in (prefs_res.data or [])]
        if not uids:
            return

        # First names
        profiles_res = await run_query(
            db.table("user_profiles").select("user_id,name").in_("user_id", uids)
        )
        name_map = {r["user_id"]: (r.get("name") or "Inversor").split()[0] for r in (profiles_res.data or [])}

        # ALL users' portfolios (no premium gate)
        portfolio_map: dict[str, list] = {}
        all_tickers: set[str] = set()
        for uid in uids:
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if port_res.data:
                raw = port_res.data[0].get("positions") or {}
                pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                if pos:
                    portfolio_map[uid] = pos
                    all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        prices = await _batch_fetch_prices(list(all_tickers)) if all_tickers else {}

        sent = 0
        for i, uid in enumerate(uids):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.1))

            first = name_map.get(uid, "Inversor")
            user_pct = _calc_portfolio_pct(portfolio_map.get(uid, []), prices) if uid in portfolio_map and prices else None

            if user_pct is not None and sp500_pct is not None:
                sp_str = f"{sp500_pct:+.1f}%"
                nq_str = f"{nasdaq_pct:+.1f}%" if nasdaq_pct is not None else "—"
                if user_pct > sp500_pct:
                    body  = f"{first}, el mercado acaba de abrir. Tu portafolio va {user_pct:+.1f}% vs S&P 500 ({sp_str}) y Nasdaq ({nq_str}). ¡Arriba!"
                else:
                    body  = f"{first}, el mercado acaba de abrir. Tu portafolio va {user_pct:+.1f}% frente al S&P 500 ({sp_str}) y Nasdaq ({nq_str})."
            elif sp500_pct is not None:
                nq_str = f"{nasdaq_pct:+.1f}%" if nasdaq_pct is not None else "—"
                body   = f"{first}, el mercado acaba de abrir. S&P 500 {sp500_pct:+.1f}%, Nasdaq {nq_str}."
            else:
                body   = f"{first}, ¡el mercado acaba de abrir! Entra a ver cómo se está comportando."

            await send_push(uid, "market_open", "🔔 Mercado Abierto", body, {"screen": "portfolio"}, db)
            sent += 1
        logger.info("Market open push: %d sent | S&P %s | NQ %s", sent, sp500_pct, nasdaq_pct)
    except Exception as e:
        logger.error("job_market_open failed: %s", e)


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
    """4:00 PM ET weekdays — personalized market close summary per user.

    Format (beating market):
        Diego, el mercado ha cerrado. Este es el resumen:
        - Tu Portafolio: +2.38%
        - S&P 500: +1.70%
        - Nasdaq: +2.21%

        ¡Enhorabuena! Superaste al mercado el día de hoy.

    Format (lagging market):
        Diego, el mercado ha cerrado. Este es el resumen:
        - Tu Portafolio: -0.54%
        - S&P 500: +1.70%
        - Nasdaq: +2.21%

        El mercado tuvo mejor desempeño hoy. Mañana es otra oportunidad.

    No premium gate — every user with push_market_close=True gets the personalized version.
    """
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    try:
        # ── 1. Fetch S&P 500 and Nasdaq (single batch call) ───────────────────
        index_prices = await _batch_fetch_prices(["^GSPC", "^IXIC"])
        sp_px  = index_prices.get("^GSPC", {})
        nq_px  = index_prices.get("^IXIC", {})
        sp500_pct  = round((sp_px["curr"] - sp_px["prev"]) / sp_px["prev"] * 100, 2) if sp_px.get("prev") else None
        nasdaq_pct = round((nq_px["curr"] - nq_px["prev"]) / nq_px["prev"] * 100, 2) if nq_px.get("prev") else None

        # ── 2. All users with market-close push enabled ───────────────────────
        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("push_market_close", True)
        )
        uids = [u["user_id"] for u in (prefs_res.data or [])]
        if not uids:
            logger.warning("job_market_close: no users with push_market_close=True")
            return

        # ── 3. First names in one query ───────────────────────────────────────
        profiles_res = await run_query(
            db.table("user_profiles").select("user_id,name").in_("user_id", uids)
        )
        name_map = {
            r["user_id"]: (r.get("name") or "Inversor").split()[0]
            for r in (profiles_res.data or [])
        }

        # ── 4. Collect all portfolio positions (no premium gate) ──────────────
        portfolio_map: dict[str, list] = {}
        all_tickers: set[str] = set()
        for uid in uids:
            port_res = await run_query(
                db.table("user_portfolio").select("positions").eq("user_id", uid)
            )
            if port_res.data:
                raw = port_res.data[0].get("positions") or {}
                pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                if pos:
                    portfolio_map[uid] = pos
                    all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        # ── 5. Batch-fetch prices (one call for all tickers) ──────────────────
        prices = await _batch_fetch_prices(list(all_tickers)) if all_tickers else {}

        # ── 6. Build index lines (used by all users) ──────────────────────────
        sp_line  = f"- S&P 500: {sp500_pct:+.2f}%"  if sp500_pct  is not None else "- S&P 500: N/D"
        nq_line  = f"- Nasdaq: {nasdaq_pct:+.2f}%"  if nasdaq_pct is not None else "- Nasdaq: N/D"

        # ── 7. Fan out — one push per user ────────────────────────────────────
        sent = 0
        for i, uid in enumerate(uids):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.1))

            first = name_map.get(uid, "Inversor")

            if uid in portfolio_map and prices:
                user_pct = _calc_portfolio_pct(portfolio_map[uid], prices)
            else:
                user_pct = None

            if user_pct is not None:
                port_line = f"- Tu Portafolio: {user_pct:+.2f}%"
                beating   = sp500_pct is not None and user_pct > sp500_pct

                body = (
                    f"{first}, el mercado ha cerrado. Este es el resumen:\n"
                    f"{port_line}\n"
                    f"{sp_line}\n"
                    f"{nq_line}\n\n"
                    + ("¡Enhorabuena! Superaste al mercado el día de hoy." if beating
                       else "El mercado tuvo mejor desempeño hoy. Mañana es otra oportunidad.")
                )
                title = "🏆 Cerraste por encima del mercado" if beating else "📊 El mercado ha cerrado"
            else:
                # No portfolio data — still send a useful summary
                body = (
                    f"{first}, el mercado ha cerrado. Resumen del día:\n"
                    f"{sp_line}\n"
                    f"{nq_line}"
                )
                title = "📊 El mercado ha cerrado"

            await send_push(uid, "market_close", title, body, {"screen": "portfolio"}, db)
            sent += 1

        logger.info("Market close push: %d sent | S&P %s | NQ %s", sent, sp500_pct, nasdaq_pct)
    except Exception as e:
        logger.error("job_market_close failed: %s", e)


async def _generate_daily_ai_summary(tickers_with_moves: list[dict], sp_pct: float | None, nq_pct: float | None) -> str:
    """Claude Haiku: 2-3 sentence summary of the day's key events for the user's positions."""
    if not tickers_with_moves:
        return ""
    try:
        import anthropic
        moves_str = "\n".join(
            f"- {x['ticker']}: {x['day_pct']:+.2f}% hoy"
            for x in sorted(tickers_with_moves, key=lambda x: abs(x["day_pct"]), reverse=True)[:6]
        )
        market_str = ""
        if sp_pct is not None and nq_pct is not None:
            market_str = f"S&P 500: {sp_pct:+.2f}%, Nasdaq: {nq_pct:+.2f}%"

        prompt = f"""Eres un analista financiero para inversores latinoamericanos.
Genera un resumen del cierre del mercado de HOY en máximo 3 oraciones cortas.

Movimientos del portafolio del usuario:
{moves_str}

Índices del mercado hoy: {market_str}

Instrucciones:
- Empieza mencionando la tendencia general del día
- Menciona el mayor movimiento positivo y/o negativo del portafolio con su causa si la conoces
- Termina con una perspectiva muy breve
- Español, tono profesional pero accesible
- Máximo 3 oraciones, sin viñetas"""

        client = anthropic.AsyncAnthropic()
        resp = await asyncio.wait_for(
            client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=200,
                messages=[{"role": "user", "content": prompt}],
            ),
            timeout=10,
        )
        return (resp.content[0].text or "").strip()
    except Exception:
        return ""


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
        # ── 1. Fetch index prices via _batch_fetch_prices (reliable) ──────────
        index_raw = await _batch_fetch_prices(["^GSPC", "^IXIC", "^DJI"])
        def _idx_pct(sym):
            px = index_raw.get(sym, {})
            if px.get("prev"):
                return round((px["curr"] - px["prev"]) / px["prev"] * 100, 2)
            return None
        sp_pct  = _idx_pct("^GSPC")
        nq_pct  = _idx_pct("^IXIC")
        dj_pct  = _idx_pct("^DJI")
        sp_px   = index_raw.get("^GSPC", {}).get("curr")
        nq_px   = index_raw.get("^IXIC", {}).get("curr")

        # ── 2. All users with email_daily_summary enabled ─────────────────────
        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("email_daily_summary", True)
        )
        opted_ids = [u["user_id"] for u in (prefs_res.data or [])]
        if not opted_ids:
            return

        # ── 3. First names in one query ───────────────────────────────────────
        profiles_res = await run_query(
            db.table("user_profiles").select("user_id,name").in_("user_id", opted_ids)
        )
        name_map = {r["user_id"]: r.get("name") or "Inversor" for r in (profiles_res.data or [])}

        # ── 4. All portfolios (no premium gate) ───────────────────────────────
        portfolio_map: dict[str, list] = {}
        all_tickers: set[str] = set()
        for uid in opted_ids:
            port_res = await run_query(
                db.table("user_portfolio").select("positions").eq("user_id", uid)
            )
            if port_res.data:
                raw = port_res.data[0].get("positions") or {}
                pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                if pos:
                    portfolio_map[uid] = pos
                    all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        # ── 5. Batch-fetch all portfolio prices (one call) ────────────────────
        day_prices = await _batch_fetch_prices(list(all_tickers)) if all_tickers else {}

        # ── 6. Build and send per-user email ──────────────────────────────────
        sent = 0
        for i, uid in enumerate(opted_ids):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.1))

            name  = name_map.get(uid, "Inversor")
            first = name.split()[0]
            positions = portfolio_map.get(uid, [])

            # Calculate enriched positions
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
                d_pct = (px["curr"] - px["prev"]) / px["prev"] * 100 if px["prev"] else 0.0
                d_usd = cv - pv
                total_val  += cv
                total_prev += pv
                enriched.append({
                    "ticker":      ticker,
                    "day_pct":     round(d_pct, 2),
                    "day_dollars": round(d_usd, 2),
                    "total_value": round(cv, 2),
                })

            port_pct = round((total_val - total_prev) / total_prev * 100, 2) if total_prev > 0 else None
            port_usd = round(total_val - total_prev, 2) if total_prev > 0 else None

            # Top 3 up / Top 3 down
            sorted_pos = sorted(enriched, key=lambda x: x["day_pct"], reverse=True)
            top_gainers = sorted_pos[:3]
            top_losers  = list(reversed(sorted_pos))[:3]

            # AI summary (generated once if user has positions)
            ai_summary = ""
            if enriched:
                ai_summary = await _generate_daily_ai_summary(enriched, sp_pct, nq_pct)

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
                ai_summary=ai_summary,
            )

            sign    = "+" if port_pct and port_pct >= 0 else ""
            subject = (
                f"Tu portafolio hoy: {sign}{port_pct:.2f}% — Nuvos AI"
                if port_pct is not None
                else "Tu resumen diario del mercado — Nuvos AI"
            )
            await send_email_notification(uid, "daily_summary", subject, html, db)
            sent += 1

        logger.info("Daily email v2: %d sent | S&P %s | NQ %s", sent, sp_pct, nq_pct)
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
        # 1. All users with at least one price-alert pref enabled (free + premium)
        prefs_res = await run_query(
            db.table("notification_preferences")
            .select("user_id,push_portfolio_alerts,push_watchlist_alerts")
            .or_("push_portfolio_alerts.eq.true,push_watchlist_alerts.eq.true")
        )
        if not prefs_res.data:
            return
        prefs_by_uid = {p["user_id"]: p for p in prefs_res.data}

        # 2. Collect tickers + position details per user (portfolio + watchlist)
        user_tickers: dict[str, dict] = {}  # uid → {"port": {ticker: {shares, avg_cost}}, "watch": set}
        all_tickers: set[str] = set()

        for uid in prefs_by_uid:
            prefs      = prefs_by_uid[uid]
            port_positions: dict[str, dict] = {}
            watch_set:  set[str] = set()

            if prefs.get("push_portfolio_alerts"):
                port_res = await run_query(
                    db.table("user_portfolio").select("positions").eq("user_id", uid)
                )
                if port_res.data:
                    raw  = port_res.data[0].get("positions") or {}
                    pos  = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                    port_positions = {
                        p["ticker"]: {"shares": float(p.get("shares") or 0), "avg_cost": float(p.get("avg_cost") or 0)}
                        for p in pos if p.get("ticker")
                    }

            if prefs.get("push_watchlist_alerts"):
                watch_res = await run_query(
                    db.table("watchlist").select("ticker").eq("user_id", uid)
                )
                watch_set = {r["ticker"] for r in (watch_res.data or [])} - set(port_positions.keys())

            if port_positions or watch_set:
                user_tickers[uid] = {"port": port_positions, "watch": watch_set}
                all_tickers |= set(port_positions.keys()) | watch_set

        if not all_tickers:
            return

        # 3. Batch-fetch prices for every unique ticker (one yfinance call)
        prices = await _batch_fetch_prices(list(all_tickers))
        if not prices:
            return

        # 4. Filter tickers that moved ≥3% vs yesterday's close
        movers: dict[str, float] = {}
        for ticker, px in prices.items():
            if px.get("prev") and px["prev"] > 0:
                pct = round((px["curr"] - px["prev"]) / px["prev"] * 100, 2)
                if abs(pct) >= 3.0:
                    movers[ticker] = pct

        if not movers:
            logger.info("Portfolio alerts: no movers ≥3%% this run")
            return

        def _alert_band(pct: float) -> int:
            a = abs(pct)
            if a >= 15: return 15
            if a >= 10: return 10
            if a >= 8:  return 8
            if a >= 5:  return 5
            return 3

        # 5. Pre-generate WHY explanations: exactly 1 Claude call + 1 news fetch per mover.
        #    Results are cached by ticker and reused for all users — never called per user.
        ticker_why:   dict[str, str] = {}   # ticker → WHY explanation body
        ticker_title: dict[str, str] = {}   # ticker → push title
        for ticker, pct in movers.items():
            price = prices[ticker]["curr"]
            news  = await asyncio.to_thread(_fetch_ticker_news, ticker)
            why   = await _generate_price_alert_why(ticker, pct, price, news)
            ticker_why[ticker]   = why
            emoji = "📉" if pct <= -5 else "🔻" if pct < 0 else "🚀" if pct >= 5 else "📈"
            ticker_title[ticker] = f"{emoji} {ticker} {pct:+.1f}% hoy"
            await asyncio.sleep(0.05)

        # 6. Fan out per user — personalize by appending their dollar impact (no extra Claude call)
        sent = 0
        for uid, sets in user_tickers.items():
            port_map = sets["port"]   # {ticker: {shares, avg_cost}}
            combined = (set(port_map.keys()) | sets["watch"]) & movers.keys()
            ranked   = sorted(combined, key=lambda t: abs(movers[t]), reverse=True)
            for ticker in ranked:
                pct   = movers[ticker]
                band  = _alert_band(pct)
                price = prices[ticker]["curr"]
                title = ticker_title[ticker]
                body  = ticker_why[ticker]
                is_portfolio = ticker in port_map

                if is_portfolio:
                    pos_data       = port_map[ticker]
                    shares         = pos_data.get("shares", 0.0)
                    position_value = shares * price if shares else 0.0
                    dollar_delta   = abs(position_value * pct / 100) if position_value else None
                    if position_value and dollar_delta:
                        gl      = "perdiste" if pct < 0 else "ganaste"
                        suffix  = f" {gl.capitalize()} ~${dollar_delta:,.0f} hoy."
                        # Trim base body if needed to fit suffix
                        max_base = 230 - len(suffix)
                        body = (body[:max_base] if len(body) > max_base else body) + suffix
                    screen = "portfolio"
                else:
                    screen = "watchlist"

                await send_push(
                    uid,
                    f"price_mover_{ticker}_band{band}",
                    title, body,
                    {"ticker": ticker, "change_pct": pct, "price": price, "screen": screen},
                    db,
                )
                sent += 1
                await asyncio.sleep(random.uniform(0.05, 0.2))

        logger.info("Portfolio alerts: %d movers ≥3%%, %d pushes sent", len(movers), sent)
    except Exception as e:
        logger.error("job_portfolio_alerts failed: %s", e)


async def job_weekly_summary_push():
    """9:30 AM ET Saturday — Market Wrap + AI storytelling (causas del rendimiento semanal).
    Uses weekly prices (5d). Pre-generates 2 AI blurbs (beat / lag) to avoid per-user API calls."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push, get_market_summary_text
    db = get_supabase()
    try:
        market     = await get_market_summary_text()
        indices    = market.get("indices", {})
        sp500_pct  = (indices.get("S&P 500") or {}).get("change_pct")
        nasdaq_pct = (indices.get("NASDAQ")  or {}).get("change_pct")

        prefs_res = await run_query(
            db.table("notification_preferences").select("user_id").eq("email_weekly_summary", True)
        )
        uids = [u["user_id"] for u in (prefs_res.data or [])]
        if not uids:
            return

        profiles_res = await run_query(
            db.table("user_profiles").select("user_id,subscription_tier,risk_tolerance").in_("user_id", uids)
        )
        profile_map = {r["user_id"]: r for r in (profiles_res.data or [])}

        premium_uids = [uid for uid in uids if profile_map.get(uid, {}).get("subscription_tier") == "premium"]
        all_tickers: set[str] = set()
        portfolio_map: dict[str, list] = {}
        for uid in premium_uids:
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if port_res.data:
                raw = port_res.data[0].get("positions") or {}
                pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                portfolio_map[uid] = pos
                all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        # Weekly prices (Mon→Fri) for accurate weekly % change
        weekly_prices = await _batch_fetch_weekly_prices(list(all_tickers)) if all_tickers else {}

        # Pre-generate 2 AI storytelling blurbs (beat vs. lag) — shared across users
        ai_beat = "Tu portafolio superó al mercado. Las posiciones de crecimiento lideraron en un contexto de apetito de riesgo."
        ai_lag  = "El mercado tuvo una semana positiva. Rotar hacia activos de calidad puede mejorar el alfa en las próximas semanas."
        try:
            import anthropic
            from app.core.config import settings as cfg
            client = anthropic.Anthropic(api_key=cfg.anthropic_api_key)
            sp_label = f"{sp500_pct:+.1f}%" if sp500_pct is not None else "plano"
            nq_label = f"{nasdaq_pct:+.1f}%" if nasdaq_pct is not None else "plano"
            resp = await asyncio.to_thread(
                lambda: client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=120,
                    messages=[{"role": "user", "content": (
                        f"S&P 500 {sp_label}, NASDAQ {nq_label} esta semana. "
                        "Escribe DOS frases ultra-cortas separadas por '|||': "
                        "1) causa de por qué un portafolio diversificado pudo SUPERAR al S&P esta semana (max 18 palabras), "
                        "2) causa de por qué pudo QUEDAR DEBAJO (max 18 palabras). "
                        "Solo las dos frases, sin más texto."
                    )}],
                )
            )
            raw_blurbs = resp.content[0].text.strip() if resp.content else ""
            parts = raw_blurbs.split("|||")
            if len(parts) == 2:
                ai_beat, ai_lag = parts[0].strip(), parts[1].strip()
        except Exception:
            pass

        sent = 0
        for i, uid in enumerate(uids):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            await asyncio.sleep(random.uniform(0, 0.12))

            p = profile_map.get(uid, {})
            is_premium = p.get("subscription_tier") == "premium"

            if is_premium and uid in portfolio_map and weekly_prices:
                user_pct   = _calc_portfolio_pct(portfolio_map[uid], weekly_prices)
                comparison = _market_comparison_push(sp500_pct, nasdaq_pct, user_pct)
                beats      = (user_pct is not None and sp500_pct is not None and user_pct > sp500_pct)
                if beats:
                    title = "🏆 Semana ganadora"
                    body  = f"{comparison}\n{ai_beat}"
                else:
                    title = "📊 Tu resumen semanal"
                    body  = f"{comparison}\n{ai_lag}"
            else:
                comparison = _market_comparison_push(sp500_pct, nasdaq_pct)
                title = "📊 Resumen Semanal"
                body  = comparison

            await send_push(uid, "weekly_summary", title, body, {"screen": "portfolio"}, db)
            sent += 1
        logger.info("Weekly summary push: %d sent", sent)
    except Exception as e:
        logger.error("job_weekly_summary_push failed: %s", e)


def _fetch_historical_earnings_reactions(ticker: str) -> dict:
    """Compute avg stock reaction (%) the day after each of the last 4 earnings reports.
    Returns {beat_avg, miss_avg, n_beats, n_misses} or empty dict on failure."""
    try:
        import yfinance as yf
        import pandas as pd

        t    = yf.Ticker(ticker)
        eddf = t.earnings_dates  # index = datetime, cols include 'Surprise(%)'
        hist = t.history(period="2y", interval="1d")
        if eddf is None or hist.empty or len(eddf) < 2:
            return {}

        beats, misses = [], []
        for dt_idx, row in eddf.head(6).iterrows():
            try:
                surprise = row.get("Surprise(%)")
                if surprise is None or pd.isna(surprise):
                    continue
                # Find the trading day before and after this earnings date
                ts = pd.Timestamp(dt_idx).tz_localize(None) if dt_idx.tzinfo else pd.Timestamp(dt_idx)
                hist_naive = hist.copy()
                hist_naive.index = hist_naive.index.tz_localize(None) if hist_naive.index.tzinfo else hist_naive.index
                pos = hist_naive.index.searchsorted(ts)
                if pos < 1 or pos >= len(hist_naive):
                    continue
                prev_close = float(hist_naive["Close"].iloc[pos - 1])
                next_close = float(hist_naive["Close"].iloc[min(pos + 1, len(hist_naive) - 1)])
                reaction   = round((next_close - prev_close) / prev_close * 100, 1)
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

    prompt = f"""Eres el asistente de Nuvos AI. Escribe el body de una notificación push en español para un usuario con {shares:.0f} acciones de {company} ({ticker}).

DATOS:
- Posición actual: ${position_value:,.2f} | {pnl_str}
- Reporta {when} | EPS estimado: {eps_str}
- {scenarios_str}

FORMATO REQUERIDO (sigue este estilo exactamente):
"{company} ({ticker}) reporta {when}. EPS: {eps_str}. {"Si supera: tu posición sube a $" + f"{beat_value:,.0f}" + f" (+{beat_avg}%)" if beat_value else ""}{"." if beat_value else ""} {"Si decepciona: baja a $" + f"{miss_value:,.0f}" + f" ({miss_avg}%)" if miss_value else ""}."

REGLAS:
- Menciona el nombre completo de la empresa y el ticker
- Incluye EPS estimado
- Incluye ambos escenarios en dólares exactos si están disponibles
- Español claro, como explicarle a un amigo sin experiencia financiera
- Máximo 250 caracteres
- Sin emojis, sin mencionar Nuvos AI
- Solo el texto, nada más"""

    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        resp   = await asyncio.wait_for(
            client.messages.create(
                model=settings.claude_model,
                max_tokens=200,
                messages=[{"role": "user", "content": prompt}],
            ),
            timeout=8.0,
        )
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
    """Fetch up to 3 recent news headlines for a ticker to explain price moves."""
    try:
        import yfinance as yf
        news = yf.Ticker(ticker).news or []
        headlines = []
        for item in news[:6]:
            title = (item.get("title") or item.get("headline") or "").strip()
            if title and len(title) > 10:
                headlines.append(title)
            if len(headlines) >= 3:
                break
        return headlines
    except Exception:
        return []


async def _generate_price_alert_why(
    ticker: str,
    change_pct: float,
    price: float,
    news_headlines: list[str],
) -> str:
    """Generate the WHY explanation for a price move — called ONCE per ticker,
    shared across all users. Returns a body string without position-specific data."""
    import anthropic

    direction = "está cayendo" if change_pct < 0 else "está subiendo"
    news_str  = "\n".join(f"- {h}" for h in news_headlines) if news_headlines else ""

    prompt = f"""Eres el asistente de Nuvos AI. Escribe el body de una notificación push en español.

DATOS:
- Ticker: {ticker}
- Movimiento: {change_pct:+.2f}% hoy, precio actual ${price:.2f}
- Noticias recientes:
{news_str or "Sin noticias recientes disponibles."}

INSTRUCCIONES:
- Si conoces el nombre completo de la empresa para "{ticker}", úsalo. Si no, usa solo "{ticker}".
- Empieza con: "Hoy [nombre] ({ticker}) {direction} {abs(change_pct):.1f}%"
- Explica el PORQUÉ en 1 oración simple usando las noticias. Si no hay noticias, deduce el contexto del sector o la empresa.
- Tono: como un amigo explicándote qué pasó, sin jerga financiera
- Máximo 180 caracteres
- Sin emojis, sin mencionar Nuvos AI
- Solo el texto, nada más"""

    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        resp   = await asyncio.wait_for(
            client.messages.create(
                model=settings.claude_model,
                max_tokens=160,
                messages=[{"role": "user", "content": prompt}],
            ),
            timeout=8.0,
        )
        why = resp.content[0].text.strip().strip('"').strip("'")
        if len(why) > 200:
            why = why[:197] + "..."
        return why
    except Exception as e:
        logger.warning("Claude price alert why failed for %s: %s", ticker, e)
        verb = "cayó" if change_pct < 0 else "subió"
        return f"{ticker} {verb} {abs(change_pct):.1f}% a ${price:.2f} hoy."


async def job_events_alerts():
    """8:00 AM ET weekdays — push for today/tomorrow ex-div, dividend payment, and earnings dates."""
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
                    raw      = port_res.data[0].get("positions") or {}
                    pos_list = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
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
                        pos          = positions_map.get(ticker, {})
                        shares       = float(pos.get("shares", 0) or 0)
                        avg_cost     = float(pos.get("avg_cost", 0) or 0) or None

                        # Get current price for position value
                        try:
                            import yfinance as yf
                            curr_price = float(yf.Ticker(ticker).fast_info.get("lastPrice") or 0)
                        except Exception:
                            curr_price = 0.0
                        position_value = shares * curr_price if shares and curr_price else 0.0

                        # Fetch historical earnings reactions (cached implicitly via thread)
                        reactions = await asyncio.to_thread(
                            _fetch_historical_earnings_reactions, ticker
                        )

                        title, body = await _generate_earnings_push(
                            ticker       = ticker,
                            company      = _company_name(ticker),
                            when         = when,
                            eps_estimate = evt.get("eps_estimate"),
                            eps_range    = evt.get("eps_range"),
                            revenue_estimate = evt.get("revenue_estimate"),
                            reactions    = reactions,
                            shares       = shares if is_portfolio else 0,
                            position_value = position_value if is_portfolio else 0,
                            avg_cost     = avg_cost if is_portfolio else None,
                        )

                    elif event_type == "ex_dividend":
                        title    = f"✂️ Ex-Dividendo: {ticker}"
                        amt      = evt.get("dividend_amount")
                        body     = f"Fecha ex-dividendo de {ticker} es {when}." + (f" ${amt:.4f}/acción." if amt else "")
                        category = "ex_dividend"
                        is_portfolio = ticker in port_tickers
                    elif event_type == "dividend":
                        title    = f"💰 Dividendo: {ticker}"
                        body     = f"{ticker} paga dividendo {when}."
                        category = "dividend_payment"
                        is_portfolio = ticker in port_tickers
                    else:
                        continue

                    await send_push(
                        uid, category, title, body,
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
                raw = port_res.data[0].get("positions") or {}
                pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                portfolio_map[uid] = pos
                all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        prices = await _batch_fetch_prices(list(all_tickers)) if all_tickers else {}
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
                raw = port_res.data[0].get("positions") or {}
                pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                port_map[uid] = pos
                all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        prices = await _batch_fetch_prices(list(all_tickers)) if all_tickers else {}

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
    """3:00 PM ET Friday — push VIX spike warning + stop loss reminder when VIX > 20."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    try:
        def _fetch_vix():
            try:
                import yfinance as yf
                hist = yf.Ticker("^VIX").history(period="2d")
                if not hist.empty:
                    return float(hist["Close"].iloc[-1])
            except Exception:
                pass
            return None

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            vix = await asyncio.get_event_loop().run_in_executor(ex, _fetch_vix)

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
        users_res = await run_query(db.table("user_profiles").select("user_id"))
        sent = 0
        for i, u in enumerate(users_res.data or []):
            if i % 100 == 0 and i > 0:
                await asyncio.sleep(12)
            uid = u["user_id"]
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if not port_res.data:
                continue
            raw = port_res.data[0].get("positions") or {}
            pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
            sectors = {SECTOR_MAP[p["ticker"]] for p in pos if p.get("ticker") in SECTOR_MAP}
            missing = GOAL_SECTORS - len(sectors)
            if missing <= 0 or missing > 2:
                continue  # already diversified or too far away
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


async def job_earnings_results():
    """5:00 PM ET weekdays — detect tickers that reported earnings today and push/email results."""
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    today = datetime.now(timezone.utc).date()

    def _fetch_earnings_results(ticker: str):
        try:
            import yfinance as yf
            t = yf.Ticker(ticker)
            cal = t.get_earnings_dates(limit=4)
            if cal is None or cal.empty:
                return None
            # Find a row with today's date
            cal.index = cal.index.tz_convert("UTC")
            today_rows = cal[cal.index.date == today]
            if today_rows.empty:
                return None
            row = today_rows.iloc[0]
            eps_real  = row.get("Reported EPS")
            eps_est   = row.get("EPS Estimate")
            # Revenue from quarterly financials
            info = t.info
            hist = t.history(period="5d")
            change_pct = None
            if len(hist) >= 2:
                prev = float(hist["Close"].iloc[-2])
                curr = float(hist["Close"].iloc[-1])
                if prev > 0:
                    change_pct = (curr - prev) / prev * 100
            return {
                "eps_real": float(eps_real) if eps_real is not None else None,
                "eps_est":  float(eps_est)  if eps_est  is not None else None,
                "change_pct": change_pct,
                "company_name": info.get("shortName", ticker),
            }
        except Exception:
            return None

    try:
        users_res = await run_query(
            db.table("user_profiles").select("user_id,name,subscription_tier")
        )
        auth_users = {u.id: u.email for u in await asyncio.to_thread(lambda: db.auth.admin.list_users())}

        # Gather all unique portfolio tickers
        all_tickers: set[str] = set()
        port_by_uid: dict[str, list] = {}
        for u in (users_res.data or []):
            uid = u["user_id"]
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if port_res.data:
                raw = port_res.data[0].get("positions") or {}
                pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                port_by_uid[uid] = pos
                all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        if not all_tickers:
            return

        # Fetch earnings results for all tickers (only today's reporters)
        results_map: dict[str, dict] = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            futures = {ticker: ex.submit(_fetch_earnings_results, ticker) for ticker in all_tickers}
            for ticker, fut in futures.items():
                try:
                    result = fut.result(timeout=15)
                    if result:
                        results_map[ticker] = result
                except Exception:
                    pass

        if not results_map:
            logger.info("Earnings results job: no reports found for today (%s)", today)
            return

        notified = 0
        for u in (users_res.data or []):
            uid   = u["user_id"]
            email = auth_users.get(uid)
            pos   = port_by_uid.get(uid, [])
            held  = {p["ticker"] for p in pos if p.get("ticker")}
            for ticker, res in results_map.items():
                if ticker not in held:
                    continue
                eps_real    = res.get("eps_real")
                eps_est     = res.get("eps_est")
                change_pct  = res.get("change_pct")
                beat_eps    = (eps_real is not None and eps_est is not None and eps_real >= eps_est)
                emoji       = "✅" if beat_eps else "❌"
                eps_str     = f"${eps_real:.2f}" if eps_real is not None else "—"
                est_str     = f"${eps_est:.2f}"  if eps_est  is not None else "—"
                pct_str     = f"{change_pct:+.1f}%" if change_pct is not None else "—"
                push_body   = f"{emoji} EPS {eps_str} (est. {est_str}). Precio {pct_str} post-earnings. Entra a analizar."
                await send_push(
                    uid, "earnings_results",
                    f"📊 {ticker} reportó resultados",
                    push_body,
                    {"ticker": ticker, "screen": "portfolio"},
                    db,
                )
                if email and settings.resend_api_key:
                    html = build_earnings_results_html(
                        name=u.get("name") or "Inversor",
                        ticker=ticker,
                        eps_real=eps_real,
                        eps_est=eps_est,
                        rev_real_b=None,
                        rev_est_b=None,
                        change_pct=change_pct,
                    )
                    await send_email(email, f"📊 {ticker} acaba de reportar resultados", html)
                notified += 1
                await asyncio.sleep(random.uniform(0.05, 0.2))

        logger.info("Earnings results: %d notifications sent for tickers: %s", notified, list(results_map.keys()))
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
                raw = port_res.data[0].get("positions") or {}
                pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                port_map[uid] = pos
                all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        prices = await _batch_fetch_prices(list(all_tickers)) if all_tickers else {}

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
                raw = port_res.data[0].get("positions") or {}
                pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                port_map[uid] = pos
                all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        prices = await _batch_fetch_prices(list(all_tickers)) if all_tickers else {}

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
        import yfinance as yf
        signals = []
        for ticker in tickers:
            try:
                hist = yf.Ticker(ticker).history(period="30d")
                if len(hist) < 16:
                    continue
                closes = [float(c) for c in hist["Close"]]
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

        # Pre-compute signals per risk level (3 yfinance batch calls total)
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

    Format: "Diego, hoy tu portafolio está cayendo -2.69%, el S&P 500 y el Nasdaq
    están cayendo -1.12% y -1.91% respectivamente."

    Each slot uses a different category key so dedup lets all 4 through per day.
    """
    from app.core.database import get_supabase, run_query
    from app.services.notification_engine import send_push
    db = get_supabase()
    try:
        # ── 1. Fetch index prices (single batch call) ─────────────────────────
        index_prices = await _batch_fetch_prices(["^GSPC", "^IXIC"])
        sp_px  = index_prices.get("^GSPC", {})
        nq_px  = index_prices.get("^IXIC", {})
        sp500_pct  = round((sp_px["curr"] - sp_px["prev"]) / sp_px["prev"] * 100, 2) if sp_px.get("prev") else None
        nasdaq_pct = round((nq_px["curr"] - nq_px["prev"]) / nq_px["prev"] * 100, 2) if nq_px.get("prev") else None

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
                raw = port_res.data[0].get("positions") or {}
                pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                if pos:
                    portfolio_map[uid] = pos
                    all_tickers.update(p["ticker"] for p in pos if p.get("ticker"))

        if not all_tickers:
            return

        # ── 5. Batch-fetch portfolio prices (one call for all tickers) ────────
        prices = await _batch_fetch_prices(list(all_tickers))

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


async def main():
    scheduler = AsyncIOScheduler()

    # ── Core market jobs ──────────────────────────────────────────────────────
    scheduler.add_job(run_notifications,        "cron", day_of_week="mon-fri", hour="9,16",  minute=0,     timezone="America/New_York")
    scheduler.add_job(run_league_notifications, "interval", hours=2)
    scheduler.add_job(job_market_open,          "cron", day_of_week="mon-fri", hour=9,       minute=30,    timezone="America/New_York")
    scheduler.add_job(job_market_open_reminder, "cron", day_of_week="mon-fri", hour=11,      minute=30,    timezone="America/New_York")
    scheduler.add_job(job_market_close,         "cron", day_of_week="mon-fri", hour=16,      minute=0,     timezone="America/New_York")

    # ── Portfolio snapshots: 5 min after open, then every 2 h ────────────────
    scheduler.add_job(lambda: asyncio.create_task(job_portfolio_snapshot("opening")),   "cron", day_of_week="mon-fri", hour=9,  minute=35, timezone="America/New_York")
    scheduler.add_job(lambda: asyncio.create_task(job_portfolio_snapshot("midday")),    "cron", day_of_week="mon-fri", hour=11, minute=35, timezone="America/New_York")
    scheduler.add_job(lambda: asyncio.create_task(job_portfolio_snapshot("afternoon")), "cron", day_of_week="mon-fri", hour=13, minute=35, timezone="America/New_York")
    scheduler.add_job(lambda: asyncio.create_task(job_portfolio_snapshot("preclose")),  "cron", day_of_week="mon-fri", hour=15, minute=35, timezone="America/New_York")
    scheduler.add_job(job_daily_email,          "cron", day_of_week="mon-fri", hour=18,      minute=0,     timezone="America/New_York")
    scheduler.add_job(job_portfolio_alerts,     "cron", day_of_week="mon-fri", hour="9-16",  minute="*/5", timezone="America/New_York")
    scheduler.add_job(job_events_alerts,        "cron", day_of_week="mon-fri", hour=8,       minute=0,     timezone="America/New_York")
    scheduler.add_job(job_earnings_results,     "cron", day_of_week="mon-fri", hour=17,      minute=0,     timezone="America/New_York")

    # ── Weekly jobs ───────────────────────────────────────────────────────────
    scheduler.add_job(job_weekly_summary_push,  "cron", day_of_week="sat",     hour=9,       minute=30,    timezone="America/New_York")
    scheduler.add_job(job_social_proof_push,    "cron", day_of_week="sat",     hour=15,      minute=0,     timezone="America/New_York")
    scheduler.add_job(job_diversification_push, "cron", day_of_week="sat",     hour=11,      minute=0,     timezone="America/New_York")
    scheduler.add_job(job_risk_mgmt_push,       "cron", day_of_week="fri",     hour=15,      minute=0,     timezone="America/New_York")

    # ── M/W/F education push ──────────────────────────────────────────────────
    scheduler.add_job(job_education_push,       "cron", day_of_week="mon,wed,fri", hour=14,  minute=0,     timezone="America/New_York")

    # ── Daily re-engagement push ──────────────────────────────────────────────
    scheduler.add_job(job_reengagement_push,    "cron", hour=11,               minute=0,                   timezone="America/New_York")

    # ── Monthly jobs ──────────────────────────────────────────────────────────
    scheduler.add_job(job_monthly_report_push,  "cron", day=1,                 hour=9,       minute=0,     timezone="America/New_York")
    scheduler.add_job(send_monthly_reports,     "cron", day=1,                 hour=9,       minute=0,     timezone="America/New_York")

    # ── Opportunity Detection push ────────────────────────────────────────────
    scheduler.add_job(job_opportunity_push,        "cron", day_of_week="wed,fri", hour=13,   minute=0,     timezone="America/New_York")

    # ── Email jobs ────────────────────────────────────────────────────────────
    scheduler.add_job(send_enhanced_weekly_emails, "cron", day_of_week="sat",  hour=10,      minute=0,     timezone="America/New_York")
    scheduler.add_job(send_reengagement_emails,    "cron", day_of_week="sat",  hour=12,      minute=0,     timezone="America/New_York")
    scheduler.add_job(send_birthday_emails,        "cron",                     hour=8,       minute=0,     timezone="America/New_York")
    scheduler.add_job(send_educational_emails,     "cron",                     hour=9,       minute=0,     timezone="America/New_York")

    # ── Annual ScoreBoard — 5 Dec every year ─────────────────────────────────
    scheduler.add_job(job_annual_scoreboard,    "cron", month=12, day=5, hour=9, minute=0, timezone="America/New_York")

    # ── Action follow-up + mentor nudge (basic/intermediate only) ────────────
    scheduler.add_job(job_action_followup,      "interval", hours=4)
    scheduler.add_job(job_mentor_nudge,         "cron",     hour=15, minute=0, timezone="America/New_York")

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
