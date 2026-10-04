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
macro_economic_events table (migrations 074 + 075). The read path (GET
/api/watchlist/macro-calendar) never calls FMP directly — it reads
Supabase, which is the sole source of truth; no Redis cache sits in front
of it (see get_macro_events's own docstring for why).

STABLE EVENT IDENTITY (2026-10-04, migration 111)
==================================================
Root cause of events flickering/duplicating on the calendar: `event_id`
used to be sha1(event_type|event_name|event_date_utc) — derived from TWO
fields FMP regularly changes for the SAME real-world release: the exact
timestamp (a reschedule) and the raw label text (a wording tweak). Every
change produced a brand-new row via upsert(on_conflict="event_id") instead
of updating the existing one. Nothing ever DELETED the old row (there is
no DELETE anywhere on this table — confirmed by grepping the whole
backend), so Supabase just accumulated duplicates for the same release,
and the read path (_collapse_moved_releases/_dedupe_rescheduled) had to
guess, after the fact, which rows were really the same thing.

Fix: `event_id` is now built from `event_type` + `event_period` — the one
thing about a release that genuinely never changes ("CPI for September
2026" is always that, no matter what day FMP currently thinks it posts
on). See `event_period()` below for exactly how each of the 15 tracked
types' period is derived from FMP's own data (never invented). Once
`event_id` is correct, a reschedule/wording-change becomes an ordinary
UPDATE of the same row (via `upsert_macro_events_batch`, migration 111's
RPC — a COALESCE-based upsert that can never erase an already-confirmed
actual/estimate/previous value with a later `null`, see that function's
own comment) — `_collapse_moved_releases`/`_dedupe_rescheduled` stay as a
defensive read-time safety net, not the primary mechanism, for whatever
the stable identity doesn't perfectly cover (pre-backfill legacy rows, a
future `_EVENT_TYPE_RULES` wording change creating a short-lived second
identity until the next sync, etc.).

PERSISTENCE GUARANTEE: Supabase is the only source of truth. A refresh
can only INSERT a never-seen release or UPDATE an existing one — it can
never remove a row, and an update can never overwrite a real confirmed
value with FMP's temporary `null`. Rows are retained forever (no TTL,
no delete-by-age) — `_MAX_DAYS_BEHIND`/`_MAX_DAYS_AHEAD` below are a
DISPLAY window only (what `get_macro_events` returns to a client), never
a storage retention policy. An in-memory `_LAST_GOOD_ROWS` snapshot exists
purely as an optional, non-essential optimization for the narrow window
between "this process's Supabase read failed" and the next successful
one — it is never required for correctness, since Supabase itself never
loses data; multiple gunicorn workers each having their own (or no) such
snapshot has no effect on what's actually persisted.
"""

from __future__ import annotations

import logging
import os
import re
import zoneinfo
from datetime import datetime, timedelta
from typing import Optional

import httpx

from app.core.database import get_supabase, run_query, run_query_verified_nonempty
from app.services.market_holidays import upcoming_holidays, upcoming_early_closes

logger = logging.getLogger(__name__)

_FMP_BASE = "https://financialmodelingprep.com/stable/economic-calendar"
_ET = zoneinfo.ZoneInfo("America/New_York")

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


_MONTH_ABBR = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

_SUFFIX_RE = re.compile(r"\(([^)]*)\)\s*$")
_QUARTER_SUFFIX_RE = re.compile(r"^Q([1-4])$", re.IGNORECASE)
_WEEKLY_SUFFIX_RE = re.compile(r"^([A-Za-z]{3})/(\d{1,2})$")  # "Oct/03"


def _extract_period_suffix(raw_name: str) -> Optional[str]:
    """FMP's raw parenthetical suffix, verbatim — "Sep", "Oct/03", "Q3" —
    or None when the label has none (FOMC, Fed speakers, and anything
    unexpected)."""
    m = _SUFFIX_RE.search(raw_name)
    return m.group(1).strip() if m else None


def _infer_period_year(period_month: int, event_date_et) -> int:
    """FMP's period suffix never carries a year ("Sep", "Oct/03", "Q3" are
    all year-less) — the release date's own year is used, UNLESS the
    period's month is more than 2 months "ahead" of the release month,
    which only happens when the period is actually from the END of the
    PRIOR year (e.g. a release in January reporting a December figure).
    A 2-month margin comfortably covers every real reporting lag in the 15
    tracked types (CPI/NFP/PCE/etc. report ~1 month after their period;
    nothing here reports with more than a ~6-week lag) without misfiring
    on an ordinary same-year release."""
    year = event_date_et.year
    if period_month - event_date_et.month > 2:
        year -= 1
    return year


def event_period(event_type: str, raw_name: str, event_date_et) -> str:
    """The stable, human-readable period key this release will always map
    to, independent of whatever date/time FMP currently reports it at —
    the backbone of `build_event_id`. `event_date_et` is the release's own
    date (America/New_York) purely as a YEAR anchor for a year-less suffix
    — never as the period itself, since that's exactly the field a
    reschedule changes.

    Per real FMP label shapes (inspected live, 2026-10-04):
      - fomc_rate_decision / fed_speaker: no period suffix at all — each
        meeting/speech is already uniquely dated, so the release's own ET
        date IS the period ("2026-10-28"). A caller distinguishes same-day
        speakers by also folding `speaker_name` into build_event_id.
      - Quarterly ("...QoQ (Q3)"): "YYYY-Qn".
      - Weekly ("Initial Jobless Claims (Oct/03)"): month/day suffix
        already pins the exact week on its own — "YYYY-MM-DD".
      - Monthly (everything else, "(Sep)"): "YYYY-MM".

    Returns a slugified fallback (never raises, never drops the event)
    for a label shape none of the above recognizes — logged by the caller
    so a real FMP format change is diagnosable instead of silently
    producing unstable IDs again."""
    if event_type in ("fomc_rate_decision", "fed_speaker"):
        return event_date_et.isoformat()

    suffix = _extract_period_suffix(raw_name)
    if not suffix:
        return event_date_et.isoformat()

    qm = _QUARTER_SUFFIX_RE.match(suffix)
    if qm:
        quarter = int(qm.group(1))
        year = _infer_period_year(quarter * 3, event_date_et)  # approx quarter-end month
        return f"{year}-Q{quarter}"

    wm = _WEEKLY_SUFFIX_RE.match(suffix)
    if wm:
        month = _MONTH_ABBR.get(wm.group(1).lower())
        if month:
            year = _infer_period_year(month, event_date_et)
            return f"{year}-{month:02d}-{int(wm.group(2)):02d}"

    month = _MONTH_ABBR.get(suffix[:3].lower())
    if month:
        year = _infer_period_year(month, event_date_et)
        return f"{year}-{month:02d}"

    return re.sub(r"[^a-z0-9]+", "-", suffix.lower()).strip("-") or event_date_et.isoformat()


def build_event_id(event_type: str, period: str, speaker_name: Optional[str] = None) -> str:
    """Stable, human-readable identity — "cpi|2026-09", "fomc_rate_decision
    |2026-10-28", "fed_speaker|2026-10-06|bowman". Deliberately NOT a hash:
    a plain string is just as good a dedup key (still DB-UNIQUE-enforced)
    and is actually debuggable in logs/Supabase without decoding anything.
    `speaker_name` disambiguates two different Fed officials speaking on
    the same day — without it they'd collide onto the same period (the ET
    date) and only one would survive the upsert."""
    if event_type == "fed_speaker" and speaker_name:
        return f"fed_speaker|{period}|{speaker_name.strip().lower()}"
    return f"{event_type}|{period}"


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
        period = event_period(event_type, raw_name, dt_utc.astimezone(_ET).date())
        event_id = build_event_id(event_type, period, speaker_name)
        existing = rows_by_id.get(event_id)
        if existing is not None:
            # Two raw FMP items collapsed onto the same stable identity in
            # THIS SAME fetch (e.g. a preliminary + revised entry for the
            # same period) — keep the one with a confirmed actual value,
            # then the later-dated one, same preference `_rank` uses
            # elsewhere. Logged so a real identity COLLISION (two distinct
            # releases wrongly mapped to one period) is diagnosable instead
            # of silently dropping one.
            logger.info(
                "fetch_and_normalize_macro_events: %s already mapped this fetch (existing=%r, new=%r) — "
                "keeping the one with a confirmed value / later date",
                event_id, existing["event_name"], raw_name,
            )
            if (existing.get("actual_value") is not None, existing["event_date_utc"]) >= (
                item.get("actual") is not None, date_utc_iso,
            ):
                continue
        rows_by_id[event_id] = {
            "event_id":       event_id,
            "event_type":     event_type,
            "event_period":   period,
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

    out_rows = list(rows_by_id.values())
    if raw_items and not out_rows:
        # Diego, 2026-10-03: distinguishes "FMP returned nothing" (logged
        # above with its own warning) from "FMP returned data but every
        # single item got classified away" — the latter means _EVENT_TYPE_
        # RULES no longer matches FMP's current labels (e.g. a wording
        # change) and would otherwise fail exactly as silently as an empty
        # response, just further downstream.
        sample = sorted({(item.get("event") or "").strip() for item in raw_items if item.get("country") == "US"})[:10]
        logger.warning(
            "fetch_and_normalize_macro_events: %d raw US items fetched but 0 classified — "
            "_EVENT_TYPE_RULES may be stale. Sample raw labels: %r",
            sum(1 for i in raw_items if i.get("country") == "US"), sample,
        )
    return out_rows


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


_UPSERT_RPC_CHUNK = 200  # keep each RPC payload small/fast, not a correctness boundary


async def _upsert_rows_lossless(rows: list[dict]) -> int:
    """The ONLY write path to macro_economic_events (besides the one-time
    backfill). Calls `upsert_macro_events_batch` (migration 111) — a real
    Postgres ON CONFLICT DO UPDATE that COALESCEs actual/estimate/previous/
    unit/speaker_name against the existing row instead of blindly
    replacing them, so FMP temporarily reporting `null` for a field this
    row already has a real confirmed value for can never erase it (see the
    migration's own comment). Every row here always carries a real
    `event_id` (stable, period-based — see build_event_id) and
    `event_date_utc`/`impact_level`/etc., which DO get overwritten
    unconditionally — those are meant to track FMP's current answer.

    Falls back to a plain `.upsert()` (migration 074's original behavior —
    still correct, just not lossless on actual/estimate/previous) ONLY if
    the RPC itself doesn't exist yet (migration 111 not yet applied in
    this environment) — logged loudly since that's a deploy-ordering gap
    to fix, not a normal/expected path."""
    db = get_supabase()
    inserted = updated = 0
    for i in range(0, len(rows), _UPSERT_RPC_CHUNK):
        chunk = rows[i : i + _UPSERT_RPC_CHUNK]
        try:
            res = await run_query(db.rpc("upsert_macro_events_batch", {"p_rows": chunk}))
            for r in res.data or []:
                if r.get("was_insert"):
                    inserted += 1
                else:
                    updated += 1
        except Exception as e:
            logger.error(
                "_upsert_rows_lossless: upsert_macro_events_batch RPC failed (migration 111 applied?) — "
                "falling back to plain upsert, actual/estimate/previous are NOT loss-protected this round: %s", e,
            )
            await run_query(db.table("macro_economic_events").upsert(chunk, on_conflict="event_id"))
    logger.info("_upsert_rows_lossless: %d new release(s) discovered, %d existing updated", inserted, updated)
    return len(rows)


async def refresh_macro_calendar() -> int:
    """Fetch → normalize → lossless upsert into Supabase (dedup via the
    stable, period-based event_id — see build_event_id). Called by the
    daily cron and the admin manual-refresh endpoint. Returns the number
    of rows processed (inserted + updated). No cache to refresh here —
    get_macro_events reads Supabase directly on every call (see its
    docstring for why). Monotonic by construction: this function only ever
    INSERTs a never-seen release or UPDATEs an existing one — there is no
    code path anywhere that deletes a row from this table, so a thin/
    partial/empty FMP response can only ever add less, never remove what's
    already persisted."""
    import asyncio
    # Chunked into several sequential FMP calls now (see _fetch_fmp_window) —
    # off the event loop so a slow/retried chunk can't stall it.
    rows = await asyncio.to_thread(fetch_and_normalize_macro_events)
    if not rows:
        logger.warning("refresh_macro_calendar: no rows to upsert (FMP unavailable or empty response) — existing rows untouched")
        return 0
    return await _upsert_rows_lossless(rows)


async def refresh_todays_macro_events() -> int:
    """Targeted, cheap refresh — re-fetches ONLY today's window from FMP
    (a single _fetch_fmp_window call, not the full 123-day sync) and
    upserts losslessly. Root-cause fix, 2026-09-13: job_refresh_macro_
    calendar only runs once at 6am ET, before same-day releases like
    8:30am CPI have posted — actual_value stayed null in Supabase all day,
    and by the next day's 6am refresh the event was no longer "today" for
    job_macro_event_watch's query, so the push silently never fired
    (confirmed: Friday's CPI release produced zero notifications). Called
    by job_macro_event_watch on every 15-min tick during market hours so
    actual_value picks up a same-day release within minutes instead of
    never."""
    import asyncio
    rows = await asyncio.to_thread(fetch_and_normalize_macro_events, 0, 0)
    if not rows:
        return 0
    return await _upsert_rows_lossless(rows)


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


async def backfill_stable_event_identity() -> dict:
    """ONE-TIME migration helper (2026-10-04, migration 111) — run once,
    manually (there is no automatic trigger for this; see admin.py's
    `/admin/backfill-macro-event-identity`), AFTER migration 111 has been
    applied. Idempotent: safe to re-run (a second run finds every row
    already under its correct new identity and merges nothing further).

    Recomputes every existing row's stable event_id/event_period via the
    exact same `event_period`/`build_event_id` the live sync now uses, and
    merges any rows that collapse onto the same new identity — these are
    rows created BEFORE this fix, duplicated under the old sha1(type|name|
    exact_timestamp) scheme every time FMP rescheduled or re-worded a
    release. Merge rule per group (never loses a previously-confirmed
    value, same lossless discipline as the ongoing upsert RPC):
      - actual/estimate/previous/unit/speaker_name: first non-null value
        found, preferring the most-recently-updated row on ties.
      - event_date_utc/event_name/impact_*: taken from the single row
        with the latest updated_at (FMP's most recently confirmed answer).
      - first_seen_at: the EARLIEST first_seen_at/created_at across the
        group — this release really was first discovered then, even
        though it was under a different, now-retired, event_id.
      - last_seen_at: the LATEST last_seen_at/updated_at across the group.

    The only deliberate exception to this module's "never delete" rule
    lives here: once a group's merged data is safely written under its new
    event_id (lossless upsert, done FIRST), the old, now-redundant row(s)
    — PROVEN to represent the same real release by deterministically
    mapping to the same new identity — are removed. This is a one-time,
    carefully-reasoned consolidation, never part of the ongoing FMP sync
    path (_upsert_rows_lossless/refresh_macro_calendar never delete)."""
    db = get_supabase()
    res = await run_query(db.table("macro_economic_events").select("*"))
    rows = res.data or []
    if not rows:
        return {"old_rows": 0, "stable_releases": 0, "redundant_rows_removed": 0}

    groups: dict[str, list[dict]] = {}
    skipped = 0
    for row in rows:
        try:
            dt_et = datetime.fromisoformat(row["event_date_utc"]).astimezone(_ET).date()
        except (KeyError, ValueError, TypeError):
            logger.warning("backfill_stable_event_identity: skipping row with unparseable event_date_utc, id=%r", row.get("event_id"))
            skipped += 1
            continue
        period = event_period(row["event_type"], row.get("event_name") or "", dt_et)
        new_id = build_event_id(row["event_type"], period, row.get("speaker_name"))
        groups.setdefault(new_id, []).append({**row, "_new_period": period})

    merged_rows: list[dict] = []
    old_ids_to_remove: list[str] = []
    for new_id, group in groups.items():
        if len(group) > 1:
            span_days = (
                max(g["event_date_utc"] for g in group)[:10] != min(g["event_date_utc"] for g in group)[:10]
            )
            if span_days:
                logger.info(
                    "backfill_stable_event_identity: merging %d rows into %s (dates: %s)",
                    len(group), new_id, sorted(g["event_date_utc"] for g in group),
                )
        group.sort(key=lambda r: r.get("updated_at") or r.get("created_at") or "")
        latest = group[-1]

        def _first_non_null(field: str, _group=group):
            for r in reversed(_group):
                if r.get(field) is not None:
                    return r[field]
            return None

        merged_rows.append({
            "event_id":       new_id,
            "event_type":     latest["event_type"],
            "event_period":   latest["_new_period"],
            "event_name":     latest["event_name"],
            "event_date_utc": latest["event_date_utc"],
            "country":        latest.get("country") or "US",
            "impact_source":  _first_non_null("impact_source"),
            "impact_level":   latest["impact_level"],
            "actual_value":   _first_non_null("actual_value"),
            "estimate_value": _first_non_null("estimate_value"),
            "previous_value": _first_non_null("previous_value"),
            "unit":           _first_non_null("unit"),
            "speaker_name":   _first_non_null("speaker_name"),
            "source":         latest.get("source") or "fmp",
        })
        for r in group:
            if r["event_id"] != new_id:
                old_ids_to_remove.append(r["event_id"])

    await _upsert_rows_lossless(merged_rows)

    removed = 0
    if old_ids_to_remove:
        for i in range(0, len(old_ids_to_remove), 200):
            chunk = old_ids_to_remove[i : i + 200]
            await run_query(db.table("macro_economic_events").delete().in_("event_id", chunk))
            removed += len(chunk)

    result = {"old_rows": len(rows), "stable_releases": len(groups), "redundant_rows_removed": removed, "skipped_unparseable": skipped}
    logger.info("backfill_stable_event_identity: %s", result)
    return result


_SERVED_IMPACT_LEVELS = {"VERY_HIGH", "HIGH"}  # Diego, 2026-08-19: MEDIUM events (housing starts, etc.) add noise without moving markets — drop them before they ever reach a client


_LAST_GOOD_ROWS: list[dict] = []  # optional best-effort fallback only — see module docstring's "PERSISTENCE GUARANTEE"
# DISPLAY window only — never a storage/retention policy. A row's presence in
# Supabase is permanent regardless of these bounds (nothing anywhere ever
# deletes from macro_economic_events); this only controls how far back/
# forward get_macro_events is willing to SERVE to a client.
_MAX_DAYS_BEHIND = 400
_MAX_DAYS_AHEAD = 180


_RESCHEDULE_WINDOW_DAYS = 20  # same release name this close together = one release that FMP moved


def _rank(row: dict) -> tuple:
    """Which of two rows for the same release to keep: one with a released
    actual value first, then the one FMP confirmed most recently."""
    return (row.get("actual_value") is not None, row.get("updated_at") or "", row.get("event_date_utc") or "")


def _collapse_moved_releases(rows: list[dict]) -> list[dict]:
    """Diego, 2026-10-02/04: macro events must stay fixed, never two copies
    of the same release on two different days. Since 2026-10-04 this is a
    DEFENSIVE safety net, not the primary mechanism — `event_id` is now
    stable/period-based (build_event_id), so a reschedule normally UPDATEs
    the one existing row and never creates a second one to begin with (see
    `_upsert_rows_lossless`). This still catches the cases the stable
    identity itself can't: rows from before the one-time backfill
    (backfill_stable_event_identity), or the brief window after an
    `_EVENT_TYPE_RULES`/period-parsing change before the next sync
    reconciles under the new scheme. Rows sharing the exact event name
    with its period suffix ("Non Farm Payrolls (Oct)") and the same type,
    within _RESCHEDULE_WINDOW_DAYS of each other, are treated as the same
    release — keep one. Names without a period suffix (Fed speakers) are
    never collapsed, and the window keeps next year's "(Oct)" release
    separate."""
    groups: dict[tuple, list[dict]] = {}
    passthrough: list[dict] = []
    for row in rows:
        name = row.get("event_name") or ""
        if row.get("event_type") == "fed_speaker" or not re.search(r"\([^)]*\)\s*$", name):
            passthrough.append(row)
            continue
        groups.setdefault((row.get("event_type"), name.strip().lower()), []).append(row)
    out = passthrough
    for group in groups.values():
        group.sort(key=lambda r: r.get("event_date_utc") or "")
        cluster: list[dict] = []
        for row in group:
            if cluster:
                try:
                    gap = abs((datetime.fromisoformat(row["event_date_utc"]) - datetime.fromisoformat(cluster[0]["event_date_utc"])).days)
                except (KeyError, ValueError):
                    gap = 0
                if gap > _RESCHEDULE_WINDOW_DAYS:
                    out.append(max(cluster, key=_rank))
                    cluster = []
            cluster.append(row)
        if cluster:
            out.append(max(cluster, key=_rank))
    return out


def _dedupe_rescheduled(rows: list[dict]) -> list[dict]:
    """Defensive read-time safety net (see _collapse_moved_releases'
    docstring — stable, period-based event_id is the primary mechanism
    now). Keeps one row per (event_type, ET date, base name), preferring
    the one that has an actual value, then the most recently confirmed by
    FMP. Releases moved to a different DAY are collapsed first
    (_collapse_moved_releases)."""
    rows = _collapse_moved_releases(rows)
    best: dict[tuple, dict] = {}
    for row in rows:
        try:
            d = datetime.fromisoformat(row["event_date_utc"]).astimezone(_ET).date()
        except (KeyError, ValueError):
            continue
        base = _strip_period_suffix(row.get("event_name") or "")
        key = (row.get("event_type"), d, base if row.get("event_type") == "fed_speaker" else "")
        cur = best.get(key)
        if cur is None or _rank(row) > _rank(cur):
            best[key] = row
    return sorted(best.values(), key=lambda r: r["event_date_utc"])


async def get_macro_events(days_ahead: int = 30, lang: str = "es", days_behind: int = _DAYS_BEHIND) -> list[dict]:
    """Always reads Supabase fresh — never a live FMP call from a request
    path (that boundary is still only crossed by fetch_and_normalize_macro_
    events, called by the cron/admin refresh). Returns events from today
    (ET) through `days_ahead` days out, each with a derived `status` and
    the event time normalized to America/New_York for display. Only
    VERY_HIGH/HIGH impact events are served — MEDIUM is still stored in
    Supabase (in case that filter is ever loosened) but filtered out here,
    the single place both the web and mobile calendars ultimately read
    from.

    Deliberately NOT cached (a CACHE_KEY-based read-through cache used to
    live here). The app runs multiple gunicorn worker processes, each with
    its own in-memory cache fallback when Redis isn't configured — a
    refresh from the cron or the admin endpoint only ever updates the ONE
    process that ran it, so every other process kept serving up to 6h of
    stale/incomplete data after every refresh (confirmed live, 2026-08-20:
    a manual admin refresh didn't fix what the user saw, because 3 of 4
    web processes were still serving the pre-fix cache). Same bug class,
    same fix, as app/core/subscription.py's fetch_fresh_subscription_
    fields — this table is small and indexed by date, cheap enough to
    always read fresh rather than risk that flicker again."""
    # Diego, 2026-09-29: macro events must NEVER blink in/out. Hardened read:
    #  - bounded by date AND impact level in the query itself, so PostgREST's
    #    1000-row default cap can never silently truncate the far end;
    #  - verified against a fresh client when empty (stale-singleton false-
    #    empty, see run_query_verified_nonempty);
    #  - on any DB failure/empty result, serves the last good snapshot kept
    #    in this process rather than an empty calendar.
    #  - Diego, 2026-10-02: always reads the SAME wide window (a year+ of
    #    history, the full forward horizon) and filters afterwards, so the
    #    last-good snapshot always covers every caller's window and a past
    #    release stays on the calendar instead of vanishing 3 days later.
    global _LAST_GOOD_ROWS
    cutoff = (datetime.now(_ET).date() - timedelta(days=_MAX_DAYS_BEHIND + 1)).isoformat()
    upper = (datetime.now(_ET).date() + timedelta(days=_MAX_DAYS_AHEAD + 2)).isoformat()
    try:
        res = await run_query_verified_nonempty(
            lambda c: c.table("macro_economic_events")
            .select("*")
            .gte("event_date_utc", cutoff)
            .lte("event_date_utc", upper)
            .in_("impact_level", sorted(_SERVED_IMPACT_LEVELS))
            .order("event_date_utc")
            .limit(5000)
        )
        rows = res.data or []
    except Exception as e:
        logger.warning("get_macro_events: DB read failed, serving last good snapshot: %s", e)
        rows = []

    if not rows and not _LAST_GOOD_ROWS:
        # Diego, 2026-10-03: the table coming back truly empty (fresh deploy,
        # or job_refresh_macro_calendar silently failing/not running — it only
        # ever logs a warning, never raises) must never surface as a blank
        # calendar to a real user. Self-heal inline: do the one FMP round-trip
        # ourselves right here instead of waiting for the next 6am ET cron.
        # Safe to call from a request path despite refresh_macro_calendar's
        # docstring reserving that FMP boundary for the cron/admin endpoint —
        # this branch only ever runs when there is nothing in Supabase to
        # read, so there is no "always fresh from DB" guarantee to violate.
        logger.warning("get_macro_events: macro_economic_events empty with no fallback snapshot — self-healing via inline FMP refresh")
        try:
            await refresh_macro_calendar()
            res = await run_query_verified_nonempty(
                lambda c: c.table("macro_economic_events")
                .select("*")
                .gte("event_date_utc", cutoff)
                .lte("event_date_utc", upper)
                .in_("impact_level", sorted(_SERVED_IMPACT_LEVELS))
                .order("event_date_utc")
                .limit(5000)
            )
            rows = res.data or []
        except Exception as e:
            logger.warning("get_macro_events: inline self-heal refresh failed: %s", e)

    if rows:
        _LAST_GOOD_ROWS = rows
    elif _LAST_GOOD_ROWS:
        rows = _LAST_GOOD_ROWS
    rows = _dedupe_rescheduled(rows)

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
        if date_et < today_et - timedelta(days=days_behind) or date_et > horizon_et:
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

    # US market holidays — merged in from the same single source of truth
    # (app/services/market_holidays.py) that gates worker.py's market-open/
    # close jobs, so a day shown here as "market closed" is guaranteed to
    # be a day those jobs actually skip, never a separate, driftable list.
    # Shaped to match a real macro-event row exactly (same fields the
    # frontend already destructures) so the web/mobile calendar components
    # can render it via a new `event_type == "market_holiday"` branch
    # without needing a second endpoint or a second fetch call.
    #
    # Deliberately NOT limited to `days_ahead` (the frontend's default is
    # 45 days, tuned for how far out a CPI/NFP release is worth showing) —
    # Diego, 2026-09: people should be able to see every US market holiday
    # for the whole year up front, not just whichever one happens to fall
    # within the next month and a half. Holidays are a tiny, static, in-
    # memory list (no extra query cost) so returning a full year+ of them
    # on every call is free; the frontend already renders whatever's in
    # this response keyed by date regardless of which month is on screen
    # (see WatchlistEarningsCalendar.tsx's `eventMap`), so this alone makes
    # every month's holiday(s) show up as the user navigates, no frontend
    # change needed.
    _HOLIDAYS_DAYS_AHEAD = 400  # a bit over a year — covers "the rest of this year" from any month
    for h in upcoming_holidays(days_ahead=max(days_ahead, _HOLIDAYS_DAYS_AHEAD)):
        d = h["date"]
        name = h["name_es"] if lang != "en" else h["name_en"]
        status = "past" if d < today_et else "today" if d == today_et else "upcoming"
        out.append({
            "event_id":       f"market_holiday:{d.isoformat()}",
            "event_type":     "market_holiday",
            "event_name":     name,
            "event_date_utc": datetime(d.year, d.month, d.day, tzinfo=_ET).isoformat(),
            "country":        "US",
            "impact_source":  "market_holiday",
            "impact_level":   "MARKET_CLOSED",
            "actual_value":   None, "estimate_value": None, "previous_value": None, "unit": None,
            "speaker_name":   None,
            "source":         "NYSE",
            "date_et":        d.isoformat(),
            "time_et":        None,
            "status":         status,
            "why_it_matters": (
                "El mercado de acciones de Estados Unidos (NYSE/Nasdaq) no abre este día."
                if lang != "en" else
                "US stock markets (NYSE/Nasdaq) are closed this day."
            ),
        })

    # US market early-close ("half day") dates — same single source of
    # truth as the holidays above, merged in the same shape so the web/
    # mobile calendar renders them via the existing `event_type ==
    # "market_early_close"` branch, no second endpoint/fetch needed.
    # Diego, 2026-09-07: market IS open these days (is_trading_day stays
    # true — see market_holidays.py), it just closes at 1:00pm ET instead
    # of 4:00pm, so this is deliberately a distinct impact_level
    # ("EARLY_CLOSE") from "MARKET_CLOSED" — the calendar and any future
    # UI must never conflate "closes early" with "doesn't open."
    for ec in upcoming_early_closes(days_ahead=max(days_ahead, _HOLIDAYS_DAYS_AHEAD)):
        d = ec["date"]
        name = ec["name_es"] if lang != "en" else ec["name_en"]
        close_et = ec["close_et"]
        status = "past" if d < today_et else "today" if d == today_et else "upcoming"
        out.append({
            "event_id":       f"market_early_close:{d.isoformat()}",
            "event_type":     "market_early_close",
            "event_name":     name,
            "event_date_utc": datetime(d.year, d.month, d.day, tzinfo=_ET).isoformat(),
            "country":        "US",
            "impact_source":  "market_early_close",
            "impact_level":   "EARLY_CLOSE",
            "actual_value":   None, "estimate_value": None, "previous_value": None, "unit": None,
            "speaker_name":   None,
            "source":         "NYSE",
            "date_et":        d.isoformat(),
            "time_et":        None,
            "status":         status,
            "why_it_matters": (
                f"El mercado de acciones de Estados Unidos (NYSE/Nasdaq) cierra hoy a la 1:00 p.m. ET ({name})."
                if lang != "en" else
                f"US stock markets (NYSE/Nasdaq) close early today, at 1:00pm ET ({name})."
            ),
        })

    out.sort(key=lambda e: e["event_date_utc"])
    return out
