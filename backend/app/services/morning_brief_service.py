"""
Morning Brief — Diego's request (Aug 16): a personalized, Premium-only,
Monday-Friday 9:15am ET pre-market push that opens its own flashcard
(same pattern as the Weekly Rituals cards).

Deliberately near-zero Claude cost, by Diego's explicit request to spend
the minimum possible in tokens. Every number is real math (portfolio
snapshots, Finnhub quotes), every news item is a real Finnhub headline
scored by keyword against the exact priority list Diego gave (earnings >
guidance/CEO/M&A > regulación/deuda), and every calendar event's impact
level is the one macro_calendar_service already computed (`_classify`'s
VERY_HIGH/HIGH/MEDIUM) — none of that is synthesized or written by a
model. The ONE real Claude usage (Aug 16 follow-up: Diego wants Spanish-
language users to see headlines in Spanish, not Finnhub's native
English) is a translation call, and only that — never a summary, never
an opinion, never invented content — cached PER HEADLINE (not per user,
not per day) via `_translate_headlines_to_spanish`, so the same real
headline seen by every user holding a popular ticker is translated once,
ever, not once per user per morning. English-language users trigger zero
Claude calls, same as before.

No new DB table, no persistence of the brief itself: the flashcard
recomputes the same real, free math/Finnhub calls live when opened —
same "cheap to redo, so don't bother persisting it" convention
weekly_rituals_service.get_sunday_prep already uses (only the headline
translations are cached, independently, forever). This also avoids a
real risk the first draft of this feature had: cramming the full
news/events payload into the push notification's `data` field risks
hitting APNs/FCM/web-push's ~4KB payload limit — the push itself only
ever carries `{"screen": "morning-brief"}`.
"""

from __future__ import annotations

import asyncio
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


_HEADLINE_CACHE_TTL = 90 * 24 * 3600  # a headline's translation never changes — long-lived, cheap to keep


def _headline_cache_key(headline: str) -> str:
    import hashlib
    return f"morning_brief:headline_es:{hashlib.md5(headline.encode('utf-8')).hexdigest()}"


async def _translate_headlines_to_spanish(headlines: list[str]) -> dict[str, str]:
    """Diego's request (Aug 16): Finnhub headlines are always in English;
    Spanish-language users should see them in Spanish. Real Claude call —
    but cached PER HEADLINE (not per user, not per day), so the same real
    headline seen by every user holding a popular ticker only ever gets
    translated once, ever, not once per user per morning. English-
    language users never call this at all (see build_morning_brief).
    Uncached headlines are batched into ONE call, never one call each."""
    from app.core.cache import cache_get, cache_set

    result: dict[str, str] = {}
    to_translate: list[str] = []
    for h in headlines:
        cached = cache_get(_headline_cache_key(h))
        if cached:
            result[h] = cached
        else:
            to_translate.append(h)

    if not to_translate:
        return result

    from app.services.ai_service import _claude, _parse_json_response

    numbered = "\n".join(f"{i + 1}. {h}" for i, h in enumerate(to_translate))
    prompt = (
        "Traduce cada uno de estos titulares financieros al español, de forma natural y precisa, "
        "sin agregar ni quitar información real. Responde ÚNICAMENTE con un JSON válido:\n"
        '{"translations": ["<titular 1 traducido>", "<titular 2 traducido>", ...]} '
        "— mismo orden, mismo número de elementos que la lista de abajo.\n\n" + numbered
    )
    try:
        resp = await _claude(model="claude-haiku-4-5-20251001", max_tokens=500, messages=[{"role": "user", "content": prompt}])
        parsed = _parse_json_response(resp.content[0].text.strip())
        translations = (parsed or {}).get("translations") or []
        if len(translations) != len(to_translate):
            raise ValueError(f"expected {len(to_translate)} translations, got {len(translations)}")
        for original, translated in zip(to_translate, translations):
            cache_set(_headline_cache_key(original), translated, _HEADLINE_CACHE_TTL)
            result[original] = translated
    except Exception as exc:
        logger.warning("morning_brief: headline translation failed, falling back to English: %s", exc)
        for h in to_translate:
            result[h] = h  # never block the brief over a translation hiccup

    return result


async def _top_news_for_positions(tickers: list[str], lang: str = "es") -> list[dict]:
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

    if lang == "es" and top:
        translated = await _translate_headlines_to_spanish([item["headline"] for item in top])
        for item in top:
            item["headline"] = translated.get(item["headline"], item["headline"])

    return top



# Real Dow Jones Industrial Average constituents — an objective, real "30
# most systemically important US companies" set (not an arbitrary pick),
# scanned for today's earnings/dividend events instead of hitting Finnhub
# for the full 928-ticker S&P 500 UNIVERSE every morning. Diego, 2026-08-30.
_MORNING_BRIEF_MEGACAPS = [
    "AAPL", "AMGN", "AMZN", "AXP", "BA", "CAT", "CRM", "CSCO", "CVX", "DIS",
    "GS", "HD", "HON", "IBM", "JNJ", "JPM", "KO", "MCD", "MMM", "MRK",
    "MSFT", "NKE", "NVDA", "PG", "SHW", "TRV", "UNH", "V", "VZ", "WMT",
]

# Sectors whose valuations/earnings historically move more on rate
# decisions (higher-duration cash flows, more debt-financed growth) — used
# only to explain REAL portfolio composition sensitivity, never to predict
# a specific price move. Diego, 2026-08-30: "con datos reales y confiables"
# — a numeric price forecast for a rate decision that hasn't happened yet
# would be fabrication, so this stays qualitative and grounded in the
# user's real sector exposure (see sector_lookup.py) instead.
_RATE_SENSITIVE_SECTOR_KEYWORDS = (
    "tecnología", "technology", "software", "semiconductor",
    "bienes raíces", "real estate", "reit",
    "consumo discrecional", "consumer discretionary",
)


def _earnings_yoy_real(ticker: str) -> Optional[dict]:
    """Real quarter-vs-same-quarter-last-year revenue and EPS growth for
    the most recently REPORTED quarter — built from data sources already
    integrated elsewhere in this codebase (FMP quarterly income statement
    via get_financials, Finnhub /stock/earnings quarterly EPS history),
    just indexed back to the real matching year-ago quarter, which no
    existing function does. Returns None fields (never a guess) when a
    real matching prior-year quarter isn't found."""
    import os
    import requests as req_lib

    result: dict = {"eps_actual": None, "eps_yoy_pct": None, "revenue_actual": None, "revenue_yoy_pct": None}

    try:
        key = os.getenv("FINNHUB_API_KEY", "")
        if key:
            r = req_lib.get("https://finnhub.io/api/v1/stock/earnings", params={"symbol": ticker, "token": key}, timeout=8)
            items = [it for it in (r.json() or []) if it.get("period") and it.get("actual") is not None]
            items.sort(key=lambda it: it["period"], reverse=True)
            if items:
                latest = items[0]
                result["eps_actual"] = latest.get("actual")
                prior = next(
                    (it for it in items[1:]
                     if it.get("quarter") == latest.get("quarter") and it.get("year") == (latest.get("year") or 0) - 1),
                    None,
                )
                if prior and prior.get("actual"):
                    result["eps_yoy_pct"] = round((latest["actual"] - prior["actual"]) / abs(prior["actual"]) * 100, 1)
    except Exception as exc:
        logger.debug("_earnings_yoy_real(%s): EPS fetch failed: %s", ticker, exc)

    try:
        from app.services.financial_data_service import get_financials
        fin = get_financials(ticker, limit=8)
        income_q = [row for row in (fin.get("incomeStatement", {}).get("quarterly") or []) if row.get("period") and row.get("Total Revenue") is not None]
        income_q.sort(key=lambda row: row["period"], reverse=True)
        if income_q:
            latest_rev = income_q[0]
            result["revenue_actual"] = latest_rev.get("Total Revenue")
            latest_date = datetime.strptime(latest_rev["period"], "%Y-%m-%d").date()
            prior_rev = min(
                income_q[1:],
                key=lambda row: abs((datetime.strptime(row["period"], "%Y-%m-%d").date() - latest_date).days - 365),
                default=None,
            )
            if prior_rev:
                prior_date = datetime.strptime(prior_rev["period"], "%Y-%m-%d").date()
                # Only a real YoY match if it's genuinely ~1 year back — never
                # compares mismatched quarters.
                if 330 <= abs((latest_date - prior_date).days) <= 400 and prior_rev.get("Total Revenue"):
                    result["revenue_yoy_pct"] = round(
                        (latest_rev["Total Revenue"] - prior_rev["Total Revenue"]) / abs(prior_rev["Total Revenue"]) * 100, 1
                    )
    except Exception as exc:
        logger.debug("_earnings_yoy_real(%s): revenue fetch failed: %s", ticker, exc)

    if result["eps_actual"] is None and result["revenue_actual"] is None:
        return None
    return result


async def _top_market_events_today(lang: str = "es") -> list[dict]:
    """Real, market-wide top-3 events for today — NOT scoped to any one
    user's holdings. Cached once per ET trading day and reused across
    every Premium user's push/flashcard (single computation, not per
    user). Diego, 2026-08-30.

    Combines: macro events today (FOMC/CPI/NFP/GDP — already
    impact-classified by macro_calendar_service), plus earnings/dividend
    events today for the real Dow 30 (_MORNING_BRIEF_MEGACAPS). Ranked
    macro VERY_HIGH/HIGH > earnings > dividend > macro MEDIUM/LOW,
    deduped, capped at 3 — never padded when fewer real events exist."""
    from app.core.cache import cache_get, cache_set
    import zoneinfo
    today_et = datetime.now(zoneinfo.ZoneInfo("America/New_York")).strftime("%Y-%m-%d")

    cache_key = f"morning_brief_top_events:{lang}:{today_et}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    candidates: list[tuple[int, dict]] = []

    try:
        from app.services.macro_calendar_service import get_macro_events
        macro = await get_macro_events(days_ahead=0, lang=lang)
        for e in macro:
            if e.get("status") != "today":
                continue
            impact = (e.get("impact_level") or "LOW").upper()
            rank = 0 if impact in ("VERY_HIGH", "HIGH") else (3 if impact == "MEDIUM" else 4)
            label = e.get("event_name") or e.get("event_type")
            if label:
                candidates.append((rank, {"type": "macro", "ticker": None, "label": label}))
    except Exception as exc:
        logger.warning("_top_market_events_today: get_macro_events failed: %s", exc)

    try:
        from app.api.routes.earnings import _fetch_earnings_calendar
        today_str = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d")
        calendar = await asyncio.to_thread(_fetch_earnings_calendar, _MORNING_BRIEF_MEGACAPS)
        for ev in calendar:
            if ev.get("event_date") != today_str:
                continue
            ticker = ev.get("ticker")
            if not ticker:
                continue
            if ev.get("event_type") == "earnings":
                reported = ev.get("eps_actual") is not None
                yoy = _earnings_yoy_real(ticker) if reported else None
                event = {"type": "earnings", "ticker": ticker, "reported": reported, **(yoy or {})}
                candidates.append((1, event))
            elif ev.get("event_type") == "dividend":
                candidates.append((2, {"type": "dividend", "ticker": ticker}))
    except Exception as exc:
        logger.warning("_top_market_events_today: earnings/dividend calendar failed: %s", exc)

    candidates.sort(key=lambda c: c[0])
    seen: set[str] = set()
    top3: list[dict] = []
    for _, event in candidates:
        dedup_key = f"{event['type']}:{event.get('ticker') or event.get('label')}"
        if dedup_key in seen:
            continue
        seen.add(dedup_key)
        top3.append(event)
        if len(top3) == 3:
            break

    cache_set(cache_key, top3, ttl=12 * 3600)
    return top3


async def _event_label_and_impact(event: dict, user_id: str, ticker_shares: dict[str, float], ticker_value: dict[str, float], sector_pct: dict[str, float], lang: str, db) -> dict:
    """Real label + (when grounded in real data) a personalized impact
    line for one event. Never fabricates a number — omits the impact
    field entirely when there's nothing real to say."""
    is_en = lang == "en"
    ticker = event.get("ticker")
    impact: Optional[str] = None

    if event["type"] == "macro":
        label = event["label"]
        rate_exposure_pct = sector_pct.get("_rate_sensitive_total", 0)
        if rate_exposure_pct >= 15:
            impact = (
                f"Tienes {rate_exposure_pct:.0f}% de tu portafolio en sectores sensibles a tasas (tecnología, "
                f"bienes raíces, consumo discrecional) — un recorte de tasas suele beneficiarlos, una postura "
                f"más restrictiva suele presionarlos."
                if not is_en else
                f"{rate_exposure_pct:.0f}% of your portfolio is in rate-sensitive sectors (tech, real estate, "
                f"discretionary) — a rate cut tends to help them, a hawkish stance tends to pressure them."
            )

    elif event["type"] == "dividend" and ticker:
        # Real amount actually recorded for THIS user by job_dividend_income
        # (runs 9:00am ET, before this 9:15am ET brief) — never recomputed/
        # guessed here.
        try:
            res = await run_query(
                db.table("dividend_income").select("amount,shares_at_payment")
                .eq("user_id", user_id).eq("ticker", ticker)
                .order("pay_date", desc=True).limit(1)
            )
            row = (res.data or [None])[0]
        except Exception:
            row = None
        label = f"Pago de dividendos de {_ticker_company_name(ticker)}" if not is_en else f"{ticker} dividend payment"
        if row and row.get("amount"):
            value_held = ticker_value.get(ticker)
            if value_held:
                impact = (
                    f"Tienes ${value_held:,.0f} invertidos en {ticker}, así que te corresponden ${row['amount']:.2f} de pago de dividendos."
                    if not is_en else
                    f"You have ${value_held:,.0f} invested in {ticker}, so you're getting ${row['amount']:.2f} in dividend payments."
                )
            else:
                impact = (
                    f"Te corresponden ${row['amount']:.2f} de pago de dividendos."
                    if not is_en else
                    f"You're getting ${row['amount']:.2f} in dividend payments."
                )

    elif event["type"] == "earnings" and ticker:
        name = _ticker_company_name(ticker)
        if event.get("reported"):
            rev = event.get("revenue_actual")
            rev_yoy = event.get("revenue_yoy_pct")
            eps = event.get("eps_actual")
            eps_yoy = event.get("eps_yoy_pct")
            label = f"Reporte trimestral de {name}" if not is_en else f"{name} quarterly earnings"
            if rev is not None or eps is not None:
                parts_es, parts_en = [], []
                if rev is not None:
                    rev_b = rev / 1e9
                    parts_es.append(f"reportó ingresos de ${rev_b:.1f}B" + (f", un crecimiento {rev_yoy:+.0f}% interanual" if rev_yoy is not None else ""))
                    parts_en.append(f"reported revenue of ${rev_b:.1f}B" + (f", {rev_yoy:+.0f}% year-over-year" if rev_yoy is not None else ""))
                if eps is not None:
                    parts_es.append(f"EPS de ${eps:.2f}" + (f", un crecimiento de {eps_yoy:+.0f}% interanual" if eps_yoy is not None else ""))
                    parts_en.append(f"EPS of ${eps:.2f}" + (f", {eps_yoy:+.0f}% year-over-year" if eps_yoy is not None else ""))
                growth_signals = [v for v in (rev_yoy, eps_yoy) if v is not None]
                verdict_es = "buenas señales para tu tesis de inversión" if growth_signals and all(v >= 0 for v in growth_signals) else (
                    "señales de deterioro — vale la pena revisar tu tesis" if growth_signals and all(v < 0 for v in growth_signals) else "resultados mixtos"
                )
                verdict_en = "good signals for your investment thesis" if growth_signals and all(v >= 0 for v in growth_signals) else (
                    "signs of deterioration — worth revisiting your thesis" if growth_signals and all(v < 0 for v in growth_signals) else "mixed results"
                )
                impact = (
                    f"{name} {', '.join(parts_es)}, {verdict_es}."
                    if not is_en else
                    f"{name} {', '.join(parts_en)}, {verdict_en}."
                )
        else:
            label = f"Reporte trimestral de {name}" if not is_en else f"{name} quarterly earnings"
            if ticker in ticker_shares:
                impact = (
                    "Dependiendo lo que reporte puede afectar tu posición positiva o negativamente — esperemos a que salgan los resultados."
                    if not is_en else
                    "Depending on what they report, this could affect your position positively or negatively — let's wait for the results."
                )
    else:
        label = event.get("label", "")

    return {"type": event["type"], "ticker": ticker, "label": label, "impact": impact}


def _ticker_company_name(ticker: str) -> str:
    """Thin local wrapper so this module doesn't import worker.py — a
    standalone script, not a module other services should depend on."""
    try:
        from app.api.routes.screener import UNIVERSE
        match = next((u["name"] for u in UNIVERSE if u["ticker"] == ticker), None)
        if match:
            return match
    except Exception:
        pass
    try:
        from app.core.finnhub import fh_profile
        profile = fh_profile(ticker)
        if profile and profile.get("name"):
            return profile["name"]
    except Exception:
        pass
    return ticker


async def _events_with_impact_for_user(user_id: str, positions: list[dict], lang: str, db) -> list[dict]:
    """The day's top 3 real market events, each with a personalized impact
    line grounded in this user's real portfolio (dividend $ actually paid
    to them, real earnings YoY numbers, real sector exposure) — or no
    impact field when there's nothing real to ground one in."""
    events = await _top_market_events_today(lang)
    if not events:
        return []

    ticker_shares: dict[str, float] = {}
    ticker_value: dict[str, float] = {}
    for p in positions:
        t = p.get("ticker")
        shares = float(p.get("shares", 0) or 0)
        if not t or not shares:
            continue
        ticker_shares[t] = ticker_shares.get(t, 0) + shares
        avg_price = float(p.get("avgPrice") or p.get("avg_price") or 0)
        ticker_value[t] = ticker_value.get(t, 0) + shares * avg_price

    sector_pct: dict[str, float] = {}
    total_value = sum(ticker_value.values())
    if total_value > 0:
        try:
            from app.services.sector_lookup import get_sector_es
            rate_sensitive_value = 0.0
            for t, v in ticker_value.items():
                sector = (get_sector_es(t) or "").lower()
                if any(kw in sector for kw in _RATE_SENSITIVE_SECTOR_KEYWORDS):
                    rate_sensitive_value += v
            sector_pct["_rate_sensitive_total"] = round(rate_sensitive_value / total_value * 100, 1)
        except Exception as exc:
            logger.warning("_events_with_impact_for_user(%s): sector exposure calc failed: %s", user_id, exc)

    return [
        await _event_label_and_impact(e, user_id, ticker_shares, ticker_value, sector_pct, lang, db)
        for e in events
    ]


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
    news = await _top_news_for_positions(tickers, lang)
    events = await _events_with_impact_for_user(user_id, positions, lang, db)

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
