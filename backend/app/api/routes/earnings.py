import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor

_EARNINGS_POOL = ThreadPoolExecutor(max_workers=10, thread_name_prefix="earnings")
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
import yfinance as yf
from app.api.deps import get_current_user_id
from app.api.routes.market import _get_user_profile, _fetch_quote_light
from app.core.cache import cache_get, cache_set
from app.services import ai_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/earnings", tags=["earnings"])

_TTL_CALENDAR  = 3600   # 1 hour
_TTL_ANALYSIS  = 1800   # 30 minutes — only for the raw-data fetch, not the AI analysis (see _TTL_ANALYSIS_V2)
_TTL_ANALYSIS_V2 = 60 * 24 * 3600  # 60 days — a reported quarter's numbers never change, so this can be cached long
_WINDOW_DAYS   = 180    # look forward 6 months
_RECENT_REPORTERS_WINDOW_DAYS = 14  # how far back "reportó recientemente" looks


def _finnhub_dividend_events(symbol: str, window_start, window_end, today) -> list[dict]:
    """Fallback: fetch ex-dividend and payment dates from Finnhub when Yahoo returns nothing."""
    import os, httpx as _hx
    key = os.getenv("FINNHUB_API_KEY", "")
    if not key:
        return []
    events: list[dict] = []
    from_s = (today - timedelta(days=365)).strftime("%Y-%m-%d")
    to_s   = window_end.strftime("%Y-%m-%d")
    for endpoint in ("dividend2", "dividend"):
        try:
            r = _hx.get(
                f"https://finnhub.io/api/v1/stock/{endpoint}",
                params={"symbol": symbol, "from": from_s, "to": to_s, "token": key},
                timeout=8,
            )
            raw = r.json()
            divs = raw.get("data") or raw if isinstance(raw, list) else []
            if not divs:
                continue
            # most recent first
            divs.sort(key=lambda d: d.get("exDate") or d.get("date") or "", reverse=True)
            d = divs[0]
            ex_str  = d.get("exDate") or d.get("date") or ""
            pay_str = d.get("payDate") or ""
            amt     = d.get("amount")
            try:
                ex_dt = datetime.strptime(ex_str, "%Y-%m-%d").date() if ex_str else None
            except ValueError:
                ex_dt = None
            try:
                pay_dt = datetime.strptime(pay_str, "%Y-%m-%d").date() if pay_str else None
            except ValueError:
                pay_dt = None

            if ex_dt and window_start <= ex_dt <= window_end:
                events.append({
                    "ticker":          symbol,
                    "event_date":      str(ex_dt),
                    "event_type":      "ex_dividend",
                    "status":          "past" if ex_dt < today else "today" if ex_dt == today else "upcoming",
                    "dividend_amount": round(float(amt), 4) if amt else None,
                })
            if pay_dt and window_start <= pay_dt <= window_end:
                events.append({
                    "ticker":     symbol,
                    "event_date": str(pay_dt),
                    "event_type": "dividend",
                    "status":     "past" if pay_dt < today else "today" if pay_dt == today else "upcoming",
                })
            if events:
                return events
        except Exception:
            continue
    return events


def _finnhub_earnings_date(symbol: str, window_start, window_end) -> dict | None:
    """Fetch upcoming earnings date from Finnhub /calendar/earnings.
    Returns {event_date, eps_estimate} or None."""
    import os, httpx as _hx
    key = os.getenv("FINNHUB_API_KEY", "")
    if not key:
        return None
    try:
        r = _hx.get(
            "https://finnhub.io/api/v1/calendar/earnings",
            params={
                "symbol": symbol,
                "from": window_start.strftime("%Y-%m-%d"),
                "to":   window_end.strftime("%Y-%m-%d"),
                "token": key,
            },
            timeout=8,
        )
        items = (r.json() or {}).get("earningsCalendar") or []
        if not items:
            return None
        # Sort upcoming first
        items.sort(key=lambda x: x.get("date") or "")
        today = datetime.now().date()
        for item in items:
            dt_str = item.get("date") or ""
            try:
                dt = datetime.strptime(dt_str, "%Y-%m-%d").date()
            except ValueError:
                continue
            if dt >= (today - timedelta(days=7)):
                return {
                    "event_date":    str(dt),
                    "eps_estimate":  item.get("epsEstimate"),
                    "eps_actual":    item.get("epsActual"),
                    "revenue_est":   item.get("revenueEstimate"),
                    "revenue_actual": item.get("revenueActual"),
                    "hour":          item.get("hour"),  # "BMO" / "AMC"
                }
    except Exception as e:
        logger.debug("Finnhub earnings calendar failed for %s: %s", symbol, e)
    return None


def _fetch_events_for_symbol(symbol: str) -> list[dict]:
    """Return all calendar events (earnings + dividends) for one symbol.

    Uses Finnhub earnings calendar (primary) + Yahoo Finance quoteSummary (fallback).
    """
    key = f"events:cal4:{symbol}"  # bump version to bust stale cache
    cached = cache_get(key)
    if cached is not None:
        return cached

    today        = datetime.now().date()
    window_start = today - timedelta(days=14)
    window_end   = today + timedelta(days=_WINDOW_DAYS)
    events: list[dict] = []

    def _r(obj, k):
        v = (obj or {}).get(k)
        return v.get("raw") if isinstance(v, dict) else v

    # ── 1. Finnhub earnings calendar (primary — more reliable dates) ──────────
    fh_earn = _finnhub_earnings_date(symbol, window_start, window_end)
    if fh_earn:
        dt_str = fh_earn["event_date"]
        try:
            dt = datetime.strptime(dt_str, "%Y-%m-%d").date()
            eps_est = fh_earn.get("eps_estimate")
            eps_act = fh_earn.get("eps_actual")
            rev_est = fh_earn.get("revenue_est")
            rev_act = fh_earn.get("revenue_actual")
            hour    = fh_earn.get("hour") or ""
            timing  = "Antes de apertura" if hour == "BMO" else "Después del cierre" if hour == "AMC" else ""
            events.append({
                "ticker":            symbol,
                "event_date":        str(dt),
                "event_type":        "earnings",
                "status":            "past" if dt < today else "today" if dt == today else "upcoming",
                "eps_estimate":      round(float(eps_est), 2) if eps_est is not None else None,
                "eps_actual":        round(float(eps_act), 2) if eps_act is not None else None,
                "revenue_estimate":  f"{round(float(rev_est)/1e9, 1)}B" if rev_est else None,
                "revenue_actual":    f"{round(float(rev_act)/1e9, 1)}B" if rev_act else None,
                "timing":            timing,
            })
        except Exception:
            pass

    # ── 2. Yahoo Finance quoteSummary (fallback for earnings + dividends) ──────
    try:
        qs = _fetch_quote_light(symbol)
        if qs:
            cal_m     = qs.get("calendarEvents") or {}
            summary_m = qs.get("summaryDetail") or {}

            # Earnings dates — only add if Finnhub didn't already find one
            if not events:
                earnings_block = cal_m.get("earnings") or {}
                earn_list      = earnings_block.get("earningsDate") or []
                eps_est_y = _r(earnings_block, "earningsAverage")
                eps_hi    = _r(earnings_block, "earningsHigh")
                eps_lo    = _r(earnings_block, "earningsLow")
                rev_est_y = _r(earnings_block, "revenueAverage")

                for ed in earn_list:
                    try:
                        if isinstance(ed, dict):
                            dt_str = ed.get("fmt")
                            dt = datetime.strptime(dt_str, "%Y-%m-%d").date() if dt_str else None
                        elif isinstance(ed, (int, float)):
                            dt = datetime.utcfromtimestamp(float(ed)).date()
                        else:
                            dt = None
                        if dt is None or not (window_start <= dt <= window_end):
                            continue
                        events.append({
                            "ticker":           symbol,
                            "event_date":       str(dt),
                            "event_type":       "earnings",
                            "status":           "past" if dt < today else "today" if dt == today else "upcoming",
                            "eps_estimate":     round(float(eps_est_y), 2) if eps_est_y else None,
                            "eps_range":        f"${float(eps_lo):.2f}–${float(eps_hi):.2f}" if eps_lo and eps_hi else None,
                            "revenue_estimate": f"{round(float(rev_est_y)/1e9, 1)}B" if rev_est_y else None,
                        })
                    except Exception:
                        continue

            # Ex-dividend date
            ex_ts = _r(cal_m, "exDividendDate")
            ex_dt = None
            if ex_ts:
                try:
                    ex_dt = datetime.utcfromtimestamp(float(ex_ts)).date()
                except Exception:
                    pass
            if ex_dt and window_start <= ex_dt <= window_end:
                div_rate  = _r(summary_m, "dividendRate")
                div_yield = _r(summary_m, "dividendYield")
                events.append({
                    "ticker":          symbol,
                    "event_date":      str(ex_dt),
                    "event_type":      "ex_dividend",
                    "status":          "past" if ex_dt < today else "today" if ex_dt == today else "upcoming",
                    "dividend_amount": round(float(div_rate) / 4, 4) if div_rate else None,
                    "dividend_yield":  round(float(div_yield) * 100, 2) if div_yield else None,
                })

            # Dividend payment date
            pay_ts = _r(cal_m, "dividendDate")
            pay_dt = None
            if pay_ts:
                try:
                    pay_dt = datetime.utcfromtimestamp(float(pay_ts)).date()
                except Exception:
                    pass
            if pay_dt and window_start <= pay_dt <= window_end:
                events.append({
                    "ticker":     symbol,
                    "event_date": str(pay_dt),
                    "event_type": "dividend",
                    "status":     "past" if pay_dt < today else "today" if pay_dt == today else "upcoming",
                })

    except Exception as e:
        logger.warning("Yahoo events fetch failed for %s: %s", symbol, e)

    # ── 3. Finnhub fallback for dividends ─────────────────────────────────────
    has_div = any(e["event_type"] in ("ex_dividend", "dividend") for e in events)
    if not has_div:
        try:
            fh_events = _finnhub_dividend_events(symbol, window_start, window_end, today)
            events.extend(fh_events)
        except Exception as e:
            logger.warning("Finnhub dividend fallback failed for %s: %s", symbol, e)

    # ── 4. Always return something — "unknown" if no date found ───────────────
    has_earnings = any(e["event_type"] == "earnings" for e in events)
    if not has_earnings:
        events.append({"ticker": symbol, "event_date": None, "event_type": "earnings", "status": "unknown"})

    cache_set(key, events, ttl=_TTL_CALENDAR)
    return events


def _fetch_earnings_calendar(symbols: list[str]) -> list[dict]:
    """Return all calendar events for a list of symbols (earnings + dividends), fetched concurrently."""
    if not symbols:
        return []
    results = list(_EARNINGS_POOL.map(_fetch_events_for_symbol, symbols))
    all_events: list[dict] = []
    for evts in results:
        all_events.extend(evts)
    return all_events


def _fetch_latest_reported_quarter(symbol: str) -> dict | None:
    """Real most-recently REPORTED fiscal quarter's EPS actual/estimate plus
    its fiscal quarter/year label, straight from Finnhub /stock/earnings —
    the same endpoint worker.py's _fetch_historical_earnings_reactions
    already uses. This endpoint already labels each entry with the correct
    FISCAL quarter/year (e.g. quarter=2, year=2026 for a period ending
    2026-06-30), unlike deriving a quarter number from the later report/
    announcement date, which would be wrong (a Q2 report is announced in
    Q3). Returns None (never a guess) if Finnhub has nothing real."""
    import os
    import requests as _req

    key = os.getenv("FINNHUB_API_KEY", "")
    if not key:
        return None
    try:
        r = _req.get(
            "https://finnhub.io/api/v1/stock/earnings",
            params={"symbol": symbol, "token": key},
            timeout=8,
        )
        if r.status_code != 200:
            return None
        items = [it for it in (r.json() or []) if it.get("period") and it.get("actual") is not None]
        if not items:
            return None
        items.sort(key=lambda it: it["period"], reverse=True)
        latest = items[0]
        return {
            "period":       latest["period"],
            "fiscal_quarter": latest.get("quarter"),
            "fiscal_year":  latest.get("year"),
            "eps_actual":   latest.get("actual"),
            "eps_estimate": latest.get("estimate"),
            "surprise_pct": latest.get("surprisePercent"),
        }
    except Exception as e:
        logger.debug("_fetch_latest_reported_quarter(%s) failed: %s", symbol, e)
        return None


def _fetch_revenue_for_period(symbol: str, period: str) -> dict:
    """Real revenue actual (FMP's own quarterly income statement, matched to
    the same fiscal period-end date Finnhub reported) and revenue estimate
    (Finnhub's earnings calendar, matched to the announcement shortly AFTER
    that period-end — that endpoint only carries estimates tied to the
    announcement date, not the fiscal period-end). Returns None fields
    (never a guess) when no real match is found for either."""
    revenue_actual = None
    revenue_estimate = None

    try:
        from app.services.financial_data_service import get_financials
        fin = get_financials(symbol, limit=8)
        income_q = fin.get("incomeStatement", {}).get("quarterly", [])
        # Exact period match first; fall back to the closest period within
        # 10 days (provider period-end dates occasionally differ by a day
        # or two) — never further than that, to avoid mismatching quarters.
        exact = next((row for row in income_q if row.get("period") == period), None)
        if exact:
            revenue_actual = exact.get("Total Revenue")
        else:
            try:
                target = datetime.strptime(period, "%Y-%m-%d").date()
                close = min(
                    (row for row in income_q if row.get("period")),
                    key=lambda row: abs((datetime.strptime(row["period"], "%Y-%m-%d").date() - target).days),
                    default=None,
                )
                if close and abs((datetime.strptime(close["period"], "%Y-%m-%d").date() - target).days) <= 10:
                    revenue_actual = close.get("Total Revenue")
            except Exception:
                pass
    except Exception as e:
        logger.debug("_fetch_revenue_for_period(%s) actual failed: %s", symbol, e)

    try:
        import os
        import requests as _req

        key = os.getenv("FINNHUB_API_KEY", "")
        if key:
            period_dt = datetime.strptime(period, "%Y-%m-%d").date()
            r = _req.get(
                "https://finnhub.io/api/v1/calendar/earnings",
                params={
                    "symbol": symbol,
                    "from": period_dt.isoformat(),
                    "to": (period_dt + timedelta(days=75)).isoformat(),
                    "token": key,
                },
                timeout=8,
            )
            items = (r.json() or {}).get("earningsCalendar") or []
            if items:
                items.sort(key=lambda it: it.get("date") or "")
                revenue_estimate = items[0].get("revenueEstimate")
    except Exception as e:
        logger.debug("_fetch_revenue_for_period(%s) estimate failed: %s", symbol, e)

    return {"revenue_actual": revenue_actual, "revenue_estimate": revenue_estimate}


def _fetch_earnings_data(symbol: str) -> dict:
    """Real latest-reported-quarter earnings figures — Finnhub for EPS
    actual/estimate + fiscal quarter/year label, FMP/Finnhub for revenue
    actual/estimate (see _fetch_revenue_for_period), and a thin Finnhub
    quote/profile fallback for current price/name only (yfinance was
    dropped for the core actual-vs-estimate numbers — it's not the
    Finnhub/FMP real-data source the rest of this codebase relies on)."""
    key = f"earnings:data:v2:{symbol}"
    cached = cache_get(key)
    if cached:
        return cached
    try:
        from app.core.finnhub import fh_profile, fh_quote

        latest = _fetch_latest_reported_quarter(symbol)
        if not latest:
            return {"symbol": symbol, "error": "No real earnings data available from Finnhub for this ticker."}

        revenue = _fetch_revenue_for_period(symbol, latest["period"])
        quote = fh_quote(symbol) or {}
        profile = fh_profile(symbol) or {}
        fiscal_label = f"Q{latest['fiscal_quarter']} {latest['fiscal_year']}" if latest.get("fiscal_quarter") and latest.get("fiscal_year") else symbol

        data = {
            "symbol":           symbol,
            "name":             profile.get("name", symbol),
            "current_price":    quote.get("price"),
            "eps_actual":       latest["eps_actual"],
            "eps_estimate":     latest["eps_estimate"],
            "revenue_actual":   revenue["revenue_actual"],
            "revenue_estimate": revenue["revenue_estimate"],
            "fiscal_quarter":   latest.get("fiscal_quarter"),
            "fiscal_year":      latest.get("fiscal_year"),
            "fiscal_label":     fiscal_label,
            "period":           latest["period"],
        }
        cache_set(key, data, ttl=_TTL_ANALYSIS)
        return data
    except Exception as e:
        return {"symbol": symbol, "error": str(e)}


async def _search_earnings_context(symbol: str, company_name: str, fiscal_label: str) -> str:
    """Real-time web search (Perplexity) for the actual earnings-release
    detail no structured data source in this codebase provides — segment
    revenue/orders growth, backlog, guidance changes, analyst/market
    reaction. Same defensive pattern as price_alert_service.
    search_price_catalyst: returns "" (never a guess) on timeout, missing
    key, or a genuinely empty search — callers must treat that as "no
    detail found" and say so explicitly, never fabricate a segment number
    or backlog figure to fill the gap."""
    from app.services.perplexity_service import search_web

    query = (
        f"Resultados del reporte trimestral de {company_name} ({symbol}) para {fiscal_label}: "
        f"busca el desglose de ingresos y crecimiento de órdenes por SEGMENTO de negocio, "
        f"backlog u órdenes acumuladas, cualquier cambio en el guidance (rango anterior vs nuevo) "
        f"para el año fiscal completo, y la reacción del mercado/analistas al reporte. Da cifras "
        f"exactas y de qué segmento/línea de negocio provienen cuando estén disponibles."
    )
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(search_web, query, False),
            timeout=35.0,
        )
        if not result:
            logger.warning("Perplexity returned no earnings context for %s (%s)", symbol, fiscal_label)
        return result
    except asyncio.TimeoutError:
        logger.warning("Perplexity earnings context search TIMED OUT for %s (>35s)", symbol)
        return ""
    except Exception as e:
        logger.warning("Perplexity earnings context search failed for %s: %s", symbol, e)
        return ""


@router.get("/calendar")
async def get_earnings_calendar(
    symbols: str = "",
    user_id: str = Depends(get_current_user_id),
):
    """Return upcoming/recent earnings for user's portfolio symbols."""
    ticker_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not ticker_list:
        return {"earnings": []}

    results = await asyncio.to_thread(_fetch_earnings_calendar, ticker_list[:50])
    # Sort: upcoming/today first, then past, then unknown; secondary by date
    order = {"upcoming": 0, "today": 0, "past": 1, "unknown": 2}
    results.sort(key=lambda x: (order.get(x["status"], 2), x.get("event_date") or ""))
    return {"earnings": results}


def _render_analysis_text(analysis: dict, lang: str) -> str:
    """Plain-text rendering of the structured analysis dict, for the OLD
    consumers (EarningsPanel.tsx and the mobile earnings panels embedded in
    the Academy tab) that still expect `analysis` to be a single string —
    real content, just reformatted, never a separate/weaker analysis."""
    parts = [analysis.get("headline", "")]
    if analysis.get("positives"):
        label = "What's working" if lang == "en" else "Lo positivo"
        parts.append(f"\n✅ {label}:\n" + "\n".join(f"• {p}" for p in analysis["positives"]))
    if analysis.get("negatives"):
        label = "What's not" if lang == "en" else "Lo negativo"
        parts.append(f"\n❌ {label}:\n" + "\n".join(f"• {n}" for n in analysis["negatives"]))
    if analysis.get("why_stock_moved"):
        label = "Why the stock moved" if lang == "en" else "Por qué se movió la acción"
        parts.append(f"\n📊 {label}: {analysis['why_stock_moved']}")
    if analysis.get("thesis_impact"):
        label = "Thesis impact" if lang == "en" else "Impacto en la tesis"
        parts.append(f"\n🧠 {label}: {analysis['thesis_impact']}")
    if analysis.get("rating_out_of_10") is not None:
        label = "Rating" if lang == "en" else "Calificación"
        parts.append(f"\n⭐ {label}: {analysis['rating_out_of_10']}/10 — {analysis.get('rating_reasoning', '')}")
    return "\n".join(p for p in parts if p).strip()


@router.get("/analysis/{symbol}")
async def get_earnings_analysis(
    symbol: str,
    shares: float = 0,
    avg_cost: float = 0,
    lang: str | None = None,
    user_id: str = Depends(get_current_user_id),
):
    """Structured, real-data-grounded AI analysis of a company's most
    recently reported quarter — real Finnhub/FMP actual-vs-estimate numbers
    plus a live Perplexity search for segment/orders/backlog/guidance detail
    (see _search_earnings_context). Premium-gated, same as /quick-analysis.

    Cached per (symbol, fiscal quarter, lang) for 60 days — a released
    quarter's report is immutable, so only the first viewer of each new
    quarter pays for the Perplexity search + Claude call; every other view
    of that same quarter is a cache hit. This is a deliberate change from
    the old blanket 30-minute TTL keyed only by symbol, which re-paid that
    cost every half hour regardless of whether a new quarter had reported."""
    from app.api.routes.chat import _is_premium

    symbol = symbol.upper()
    profile = _get_user_profile(user_id)
    if not _is_premium(profile):
        raise HTTPException(status_code=403, detail="El análisis de earnings requiere Premium")

    if lang not in ("es", "en"):
        lang = getattr(profile, "preferred_language", None) or "es"

    earnings_data = await asyncio.to_thread(_fetch_earnings_data, symbol)
    if "error" in earnings_data:
        raise HTTPException(status_code=404, detail=f"No hay datos reales de earnings disponibles para {symbol}")

    fiscal_key = f"{earnings_data.get('fiscal_year')}Q{earnings_data.get('fiscal_quarter')}"
    cache_key = f"earnings:v2:{symbol}:{fiscal_key}:{lang}"
    cached = cache_get(cache_key)
    if cached:
        # Re-sanitize even a cached hit — a response cached before the
        # type-coercion fix in ai_service._sanitize_earnings_analysis (e.g.
        # a string "8.8" instead of a float for rating_out_of_10, which
        # crashed the whole earnings screen client-side) would otherwise
        # keep serving the broken shape for the rest of its 60-day TTL.
        # Sanitizing well-formed data is a harmless no-op.
        if cached.get("structured_analysis"):
            cached["structured_analysis"] = ai_service._sanitize_earnings_analysis(cached["structured_analysis"])
        return cached

    web_context = await _search_earnings_context(symbol, earnings_data.get("name", symbol), earnings_data.get("fiscal_label", symbol))
    position = {"shares": shares, "avg_cost": avg_cost} if shares else None
    try:
        analysis = await ai_service.analyze_earnings(symbol, earnings_data, position, profile, lang=lang, web_context=web_context)
    except Exception as e:
        logger.error("get_earnings_analysis(%s): AI analysis failed: %s", symbol, e, exc_info=True)
        analysis = {
            "headline": (
                "We couldn't generate the AI analysis right now. The real numbers above are still accurate."
                if lang == "en" else
                "No pudimos generar el análisis con IA en este momento. Las cifras reales de arriba siguen siendo correctas."
            ),
            "positives": [], "negatives": [], "segments": [], "guidance_change": None,
            "why_stock_moved": "", "thesis_impact": "", "rating_out_of_10": None,
            "rating_reasoning": "", "portfolio_note": None,
        }

    result = {
        "symbol": symbol,
        # Backward-compat plain-text rendering — EarningsPanel.tsx and the
        # mobile earnings panels (embedded in the Academy tab) still expect
        # `analysis` to be a string; `structured_analysis` below is the new
        # object the dedicated /earnings screen renders. Once those panels
        # are migrated, this rendered string can be dropped.
        "analysis": _render_analysis_text(analysis, lang),
        "structured_analysis": analysis,
        "earnings_data": earnings_data,
    }
    # Only cache a successful, complete result — never a transient failure,
    # so a provider hiccup doesn't get "stuck" wrong for 60 days.
    cache_set(cache_key, result, ttl=_TTL_ANALYSIS_V2)
    return result


_TTL_RECENT_REPORTERS = 900  # 15 min — short enough that "today" always feels live, without hammering Finnhub on every screen open


def _finnhub_recent_earnings(symbol: str, days_back: int) -> dict | None:
    """Real most-recently ALREADY-REPORTED earnings event within the last
    `days_back` days, in America/New_York calendar terms (the US market's
    own timezone — using naive server-local "today" would misdate a report
    near midnight UTC on a Railway box). Deliberately NOT built on top of
    _finnhub_earnings_date/_fetch_events_for_symbol: those hardcode their
    own 7-day recency filter for the unrelated "upcoming earnings alert"
    use case and would silently drop a real report from, say, 10 days ago
    — exactly the kind of report this "reportó recientemente" feed needs to
    keep showing for the full 14-day window. Returns None (never invented)
    if Finnhub has nothing real for this ticker in that window."""
    import os
    import requests as _req
    from app.services.notification_engine import _today_et

    key = os.getenv("FINNHUB_API_KEY", "")
    if not key:
        return None

    cache_key = f"earnings:recent:{symbol}:{days_back}:{_today_et()}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached or None  # cache_set below stores {} for a GENUINE "checked, nothing found" — never for a failed check

    today = datetime.strptime(_today_et(), "%Y-%m-%d").date()
    window_start = today - timedelta(days=days_back)

    # Up to 2 tries — a transient timeout/rate-limit/connection error must
    # never be treated the same as "this ticker genuinely has no report in
    # the window": that conflation is exactly what let real portfolio/
    # watchlist tickers silently vanish from the feed for up to 15 minutes
    # whenever a single Finnhub request hiccuped. On a real failure (both
    # tries exhausted), return None WITHOUT caching anything, so the very
    # next request tries again instead of trusting a false "no report."
    items = None
    for attempt in range(2):
        try:
            r = _req.get(
                "https://finnhub.io/api/v1/calendar/earnings",
                params={"symbol": symbol, "from": window_start.isoformat(), "to": today.isoformat(), "token": key},
                timeout=8,
            )
            if r.status_code != 200:
                raise ValueError(f"Finnhub returned status {r.status_code}")
            items = (r.json() or {}).get("earningsCalendar") or []
            break
        except Exception as e:
            logger.debug("_finnhub_recent_earnings(%s) attempt %d failed: %s", symbol, attempt + 1, e)
            if attempt == 0:
                import time as _time
                _time.sleep(0.5)

    if items is None:
        logger.warning("_finnhub_recent_earnings(%s): both attempts failed — skipping this check, NOT caching a false negative", symbol)
        return None

    result = None
    reported = [it for it in items if it.get("date") and it.get("epsActual") is not None]
    if reported:
        reported.sort(key=lambda it: it["date"], reverse=True)
        latest = reported[0]
        result = {
            "ticker": symbol,
            "event_date": latest["date"],
            "eps_estimate": round(float(latest["epsEstimate"]), 2) if latest.get("epsEstimate") is not None else None,
            "eps_actual": round(float(latest["epsActual"]), 2) if latest.get("epsActual") is not None else None,
            # Raw numbers (not pre-formatted) — the frontend formats these the
            # same way it already formats the detail card's revenue figures,
            # and needs the raw values to compute beat/miss for the list row.
            "revenue_estimate": float(latest["revenueEstimate"]) if latest.get("revenueEstimate") is not None else None,
            "revenue_actual": float(latest["revenueActual"]) if latest.get("revenueActual") is not None else None,
        }

    # Only reached after a REAL, successful check (whether it found a
    # report or not) — this is the only path allowed to cache.
    cache_set(cache_key, result or {}, ttl=_TTL_RECENT_REPORTERS)
    return result


@router.get("/recent-reporters")
async def get_recent_reporters(
    symbols: str = "",
    user_id: str = Depends(get_current_user_id),
):
    """Cheap, no-AI read: which of the given tickers (the caller passes the
    user's portfolio+watchlist symbols, same as EarningsPanel.tsx already
    assembles) reported real earnings within the last
    _RECENT_REPORTERS_WINDOW_DAYS days (America/New_York "today", checked
    fresh at most every 15 minutes — see _finnhub_recent_earnings). Powers
    the new Earnings screen's "reportaron recientemente" feed without
    paying any AI/Perplexity cost until the user actually taps one to see
    the full analysis."""
    from app.api.routes.chat import _is_premium

    profile = _get_user_profile(user_id)
    if not _is_premium(profile):
        raise HTTPException(status_code=403, detail="El análisis de earnings requiere Premium")

    ticker_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not ticker_list:
        return {"reporters": []}

    results = await asyncio.to_thread(
        lambda: list(_EARNINGS_POOL.map(
            lambda t: _finnhub_recent_earnings(t, _RECENT_REPORTERS_WINDOW_DAYS), ticker_list[:50],
        ))
    )
    reporters = [r for r in results if r]
    reporters.sort(key=lambda x: x.get("event_date") or "", reverse=True)
    return {"reporters": reporters}
