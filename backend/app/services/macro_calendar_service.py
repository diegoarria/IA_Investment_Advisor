"""
Macro Economic Events Calendar
================================
Feeds the Watchlist calendar's macro-events layer (FOMC, CPI, NFP, GDP,
PMIs, jobless claims, etc.) — display only, no notifications of any kind.

Data source: Financial Modeling Prep's economic-calendar API
(https://financialmodelingprep.com/stable/economic-calendar), reusing the
already-configured FMP_API_KEY (see financial_data_service.py) — no new
vendor. Confirmed live that FMP's `date` field is UTC (CPI/NFP, released
8:30am ET, appear as 12:30:00 during EDT and 13:30:00 after the Nov 1
fall-back to EST; FOMC, released 2pm ET, appears as 18:00:00 during EDT).

FMP returns dozens of raw sub-metrics per release (e.g. CPI alone spawns
"CPI", "CPI s.a", "Inflation Rate YoY/MoM", "Core Inflation Rate YoY/MoM").
_EVENT_TYPE_RULES maps ONE canonical raw label per Nuvos event type (the
headline number a person would actually recognize, e.g. "Inflation Rate
YoY" for CPI) so the calendar shows one row per real-world release instead
of 6 near-duplicates. Anything not matched by a rule (Michigan sentiment,
bill auctions, GDPNow, etc.) is dropped — never shown, never invented.

Known coverage gaps (documented here rather than papered over — FMP simply
doesn't expose these distinctions today):
  - GDP: FMP gives one "GDP Growth Rate QoQ" entry per quarter, with no
    Advance/Second/Third-estimate distinction in the event name. We show
    FMP's real label verbatim; if FMP ever adds the distinction, it will
    surface automatically without a code change.
  - PPI: FMP has no bare "PPI" or "Core PPI" row — the only PPI-family
    entry is "PPI Ex Food, Energy and Trade YoY", used as the `ppi` type's
    representative.
  - Fed Speakers: real but sparse (regional Fed presidents, Powell when
    scheduled) — this category is legitimately empty on most days.

Populated by a daily cron (worker.py's job_refresh_macro_calendar) into the
macro_economic_events table (migration 074) + a short-lived Redis cache —
the read path (GET /api/watchlist/macro-calendar) never calls FMP directly.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import zoneinfo
from datetime import datetime, timedelta
from typing import Optional

import httpx

from app.core.cache import cache_get, cache_set
from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)

_FMP_BASE = "https://financialmodelingprep.com/stable/economic-calendar"
_ET = zoneinfo.ZoneInfo("America/New_York")

CACHE_KEY = "macro_calendar:v1"
CACHE_TTL = 6 * 3600          # refreshed daily by cron; this just avoids a DB hit on every calendar open
_DAYS_AHEAD = 120             # forward-looking only (no historical archive) — see plan §12
_DAYS_BEHIND = 3              # small trailing window so "released today/yesterday" still shows


def _strip_period_suffix(name: str) -> str:
    """'Non Farm Payrolls (Oct)' -> 'non farm payrolls' — normalizes FMP's
    raw label to a stable key for matching, independent of the month shown."""
    return re.sub(r"\s*\([^)]*\)\s*$", "", name).strip().lower()


# (event_type, canonical impact level, set of normalized base labels that
# represent this release's headline number). Ordered by nothing in
# particular — matching is by exact base-label membership, not priority.
_EVENT_TYPE_RULES: list[tuple[str, str, set[str]]] = [
    ("fomc_rate_decision",     "VERY_HIGH", {"fed interest rate decision"}),
    ("cpi",                    "VERY_HIGH", {"inflation rate yoy"}),
    ("core_cpi",                "VERY_HIGH", {"core inflation rate yoy"}),
    ("pce",                    "VERY_HIGH", {"pce price index yoy"}),
    ("core_pce",               "VERY_HIGH", {"core pce price index yoy"}),
    ("nfp",                    "VERY_HIGH", {"non farm payrolls", "nonfarm payrolls"}),
    ("unemployment_rate",      "VERY_HIGH", {"unemployment rate"}),
    ("gdp",                    "VERY_HIGH", {"gdp growth rate qoq"}),
    ("ism_manufacturing_pmi",  "HIGH",      {"ism manufacturing pmi"}),
    ("ism_services_pmi",       "HIGH",      {"ism services pmi", "ism non-manufacturing pmi"}),
    ("retail_sales",           "HIGH",      {"retail sales mom"}),
    ("initial_jobless_claims", "HIGH",      {"initial jobless claims"}),
    ("ppi",                    "HIGH",      {"ppi ex food, energy and trade yoy"}),
    ("jolts",                  "HIGH",      {"jolts job openings"}),
    ("housing_starts",         "MEDIUM",    {"housing starts", "building permits"}),
]

_FED_SPEAKER_RE = re.compile(r"^fed\s+(.+?)\s+speech$", re.IGNORECASE)


def _classify(raw_name: str) -> Optional[tuple[str, str, Optional[str]]]:
    """Maps one raw FMP event name to (event_type, impact_level, speaker_name)
    or None if it's not one of the 15 types this feature tracks."""
    base = _strip_period_suffix(raw_name)

    m = _FED_SPEAKER_RE.match(base)
    if m or "powell" in base:
        speaker = m.group(1).strip().title() if m else "Powell"
        return "fed_speaker", "HIGH", speaker

    for event_type, impact_level, labels in _EVENT_TYPE_RULES:
        if base in labels:
            return event_type, impact_level, None

    return None


def _event_id(event_type: str, event_name: str, date_utc_iso: str) -> str:
    raw = f"{event_type}|{event_name}|{date_utc_iso}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _fmp_key() -> str:
    return os.getenv("FMP_API_KEY", "")


_CHUNK_DAYS = 30  # see _fetch_fmp_window's docstring for why this exists


def _fetch_fmp_window(date_from, date_to, key: str) -> list[dict]:
    """One FMP call for a single date window, retrying once on a transient
    failure (timeout/connection blip/momentary 5xx) — same pattern as
    Finnhub's earnings-calendar retry (earnings.py's
    _finnhub_earnings_date), applied here because the failure mode this
    guards against turned out to be worse than a dropped request: FMP's
    /stable/economic-calendar silently returns an incomplete, differently-
    ordered result set once the requested span gets wide (confirmed live,
    2026-08-20 — a 123-day window returned FEWER total rows than a 90-day
    one and dropped every near-term event, including that week's Jobless
    Claims, CPI, NFP and the next FOMC meeting, while three separate
    <=90-day windows each returned the same near-term events correctly).
    That's why fetch_and_normalize_macro_events below fans this out over
    _CHUNK_DAYS-wide windows instead of one big range — this function
    itself only owns the per-window HTTP retry, not the chunking."""
    import time
    last_exc: Exception | None = None
    for attempt in range(2):
        try:
            resp = httpx.get(
                _FMP_BASE,
                params={"from": date_from.isoformat(), "to": date_to.isoformat(), "apikey": key},
                timeout=20,
            )
            resp.raise_for_status()
            items = resp.json()
            if not isinstance(items, list):
                logger.warning("FMP economic-calendar returned unexpected shape for %s..%s: %r", date_from, date_to, type(items))
                return []
            return items
        except Exception as e:
            last_exc = e
            if attempt == 0:
                time.sleep(0.6)
    logger.warning("FMP economic-calendar fetch failed for %s..%s after retry: %s", date_from, date_to, last_exc)
    return []


def fetch_and_normalize_macro_events(days_ahead: int = _DAYS_AHEAD, days_behind: int = _DAYS_BEHIND) -> list[dict]:
    """Fetches FMP's US economic calendar and maps it to Nuvos's canonical
    15-type taxonomy. Returns normalized rows ready to upsert — never
    invents a date, event, or impact level not present in the source.

    Fetched in _CHUNK_DAYS-wide windows rather than one [days_behind,
    days_ahead] range — see _fetch_fmp_window's docstring for the incident
    that made a single wide window unsafe."""
    key = _fmp_key()
    if not key:
        logger.warning("FMP_API_KEY not configured — macro calendar sync skipped")
        return []

    today = datetime.now(_ET).date()
    range_start = today - timedelta(days=days_behind)
    range_end   = today + timedelta(days=days_ahead)

    raw_items: list[dict] = []
    chunk_start = range_start
    while chunk_start <= range_end:
        chunk_end = min(chunk_start + timedelta(days=_CHUNK_DAYS - 1), range_end)
        raw_items.extend(_fetch_fmp_window(chunk_start, chunk_end, key))
        chunk_start = chunk_end + timedelta(days=1)

    rows_by_id: dict[str, dict] = {}
    for item in raw_items:
        if item.get("country") != "US":
            continue
        raw_name = (item.get("event") or "").strip()
        raw_date = (item.get("date") or "").strip()
        if not raw_name or not raw_date:
            continue

        classified = _classify(raw_name)
        if classified is None:
            continue
        event_type, impact_level, speaker_name = classified

        try:
            dt_utc = datetime.strptime(raw_date, "%Y-%m-%d %H:%M:%S").replace(tzinfo=zoneinfo.ZoneInfo("UTC"))
        except ValueError:
            logger.debug("Skipping macro event with unparseable date: %r", raw_date)
            continue

        date_utc_iso = dt_utc.isoformat()
        event_id = _event_id(event_type, raw_name, date_utc_iso)
        rows_by_id[event_id] = {
            "event_id":       event_id,
            "event_type":     event_type,
            "event_name":     raw_name,
            "event_date_utc": date_utc_iso,
            "country":        "US",
            "impact_source":  item.get("impact"),
            "impact_level":   impact_level,
            "actual_value":   _stringify(item.get("actual")),
            "estimate_value": _stringify(item.get("estimate")),
            "previous_value": _stringify(item.get("previous")),
            "unit":           item.get("unit"),
            "speaker_name":   speaker_name,
            "source":         "fmp",
        }

    return list(rows_by_id.values())


def _stringify(v) -> Optional[str]:
    return None if v is None else str(v)


# Short, static "why does this matter" blurbs — never AI-generated (avoids
# both an extra LLM cost per calendar view and any risk of a hallucinated
# explanation). One line per type, not a lecture, per the product spec.
_WHY_IT_MATTERS: dict[str, dict[str, str]] = {
    "fomc_rate_decision":     {"es": "Define el costo del dinero en EE.UU.; mueve acciones, bonos y el dólar globalmente.", "en": "Sets the cost of money in the US; moves stocks, bonds, and the dollar globally."},
    "cpi":                    {"es": "Mide la inflación al consumidor; una sorpresa alta suele presionar a la baja las acciones.", "en": "Measures consumer inflation; a hot surprise typically pressures stocks lower."},
    "core_cpi":               {"es": "CPI sin alimentos ni energía; la Fed lo mira más de cerca para decidir tasas.", "en": "CPI excluding food and energy; the Fed weighs this more heavily for rate decisions."},
    "pce":                    {"es": "El indicador de inflación preferido de la Fed.", "en": "The Fed's preferred inflation gauge."},
    "core_pce":               {"es": "PCE sin alimentos ni energía; el número que más influye en decisiones de tasas.", "en": "Core PCE, the single number that most influences rate decisions."},
    "nfp":                    {"es": "Empleos creados en el mes; termómetro clave de la salud de la economía.", "en": "Jobs added in the month; a key thermometer for economic health."},
    "unemployment_rate":      {"es": "Porcentaje de la fuerza laboral sin empleo; sube cuando la economía se enfría.", "en": "Share of the labor force without a job; rises as the economy cools."},
    "gdp":                    {"es": "Crecimiento económico total de EE.UU. en el trimestre.", "en": "Total US economic growth for the quarter."},
    "ism_manufacturing_pmi":  {"es": "Salud del sector manufacturero; por debajo de 50 indica contracción.", "en": "Health of the manufacturing sector; below 50 signals contraction."},
    "ism_services_pmi":       {"es": "Salud del sector servicios, la mayor parte de la economía de EE.UU.", "en": "Health of the services sector, the largest share of the US economy."},
    "retail_sales":           {"es": "Gasto del consumidor; motor central de la economía estadounidense.", "en": "Consumer spending; the central engine of the US economy."},
    "initial_jobless_claims": {"es": "Nuevas solicitudes de desempleo semanales; señal temprana del mercado laboral.", "en": "New weekly unemployment claims; an early signal on the labor market."},
    "ppi":                    {"es": "Inflación a nivel de productor; suele anticipar movimientos futuros del CPI.", "en": "Producer-level inflation; often a leading signal for future CPI moves."},
    "jolts":                  {"es": "Vacantes laborales disponibles; mide la demanda de trabajadores.", "en": "Open job vacancies; measures employer demand for workers."},
    "fed_speaker":            {"es": "Comentarios de funcionarios de la Fed pueden anticipar cambios de política.", "en": "Fed official remarks can hint at upcoming policy shifts."},
    "housing_starts":         {"es": "Nuevas construcciones residenciales; termómetro del sector inmobiliario.", "en": "New residential construction; a thermometer for the housing sector."},
}


def why_it_matters(event_type: str, lang: str) -> str:
    entry = _WHY_IT_MATTERS.get(event_type)
    if not entry:
        return ""
    return entry.get(lang) or entry.get("es") or ""


async def refresh_macro_calendar() -> int:
    """Fetch → normalize → upsert into Supabase (dedup via event_id) →
    refresh the read-through cache. Called by the daily cron and the admin
    manual-refresh endpoint. Returns the number of rows upserted."""
    import asyncio
    # Chunked into several sequential FMP calls now (see _fetch_fmp_window) —
    # off the event loop so a slow/retried chunk can't stall it.
    rows = await asyncio.to_thread(fetch_and_normalize_macro_events)
    if not rows:
        logger.warning("refresh_macro_calendar: no rows to upsert (FMP unavailable or empty response)")
        return 0

    db = get_supabase()
    await run_query(db.table("macro_economic_events").upsert(rows, on_conflict="event_id"))

    cache_set(CACHE_KEY, rows, ttl=CACHE_TTL)
    logger.info("refresh_macro_calendar: upserted %d macro events", len(rows))
    return len(rows)


async def refresh_if_empty_on_startup() -> None:
    """Called once at worker startup — populates the macro calendar
    immediately if the table is empty (fresh deploy, first-ever run),
    instead of waiting for the next 6am ET cron. Mirrors
    undervalued_screener_service.refresh_if_empty_on_startup."""
    try:
        db = get_supabase()
        res = await run_query(db.table("macro_economic_events").select("id").limit(1))
        if not res.data:
            logger.info("macro_economic_events empty — running startup refresh")
            await refresh_macro_calendar()
    except Exception as e:
        logger.warning("refresh_if_empty_on_startup (macro calendar) failed: %s", e)


_SERVED_IMPACT_LEVELS = {"VERY_HIGH", "HIGH"}  # Diego, 2026-08-19: MEDIUM events (housing starts, etc.) add noise without moving markets — drop them before they ever reach a client


async def get_macro_events(days_ahead: int = 30, lang: str = "es") -> list[dict]:
    """Read-through: cache first, then Supabase (last known good), never a
    live FMP call from a request path. Returns events from today (ET)
    through `days_ahead` days out, each with a derived `status` and the
    event time normalized to America/New_York for display. Only VERY_HIGH/
    HIGH impact events are served — MEDIUM is still stored in Supabase (in
    case that filter is ever loosened) but filtered out here, the single
    place both the web and mobile calendars ultimately read from."""
    rows = cache_get(CACHE_KEY)
    if rows is None:
        db = get_supabase()
        cutoff = (datetime.now(_ET).date() - timedelta(days=_DAYS_BEHIND)).isoformat()
        res = await run_query(
            db.table("macro_economic_events")
            .select("*")
            .gte("event_date_utc", cutoff)
            .order("event_date_utc")
        )
        rows = res.data or []
        if rows:
            cache_set(CACHE_KEY, rows, ttl=CACHE_TTL)

    now_et = datetime.now(_ET)
    today_et = now_et.date()
    horizon_et = today_et + timedelta(days=days_ahead)

    out: list[dict] = []
    for row in rows:
        try:
            dt_utc = datetime.fromisoformat(row["event_date_utc"])
        except (KeyError, ValueError):
            continue
        dt_et = dt_utc.astimezone(_ET)
        date_et = dt_et.date()
        if date_et < today_et - timedelta(days=_DAYS_BEHIND) or date_et > horizon_et:
            continue
        if row.get("impact_level") not in _SERVED_IMPACT_LEVELS:
            continue

        status = "past" if date_et < today_et else "today" if date_et == today_et else "upcoming"
        out.append({
            **row,
            "date_et":        date_et.isoformat(),
            "time_et":        dt_et.strftime("%H:%M"),
            "status":         status,
            "why_it_matters": why_it_matters(row.get("event_type", ""), lang),
        })

    out.sort(key=lambda e: e["event_date_utc"])
    return out
