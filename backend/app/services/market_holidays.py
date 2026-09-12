"""
US stock market (NYSE/NASDAQ) holiday calendar — single source of truth.

Previously this data lived only as a private, unnamed `set[date]` inside
worker.py (`_NYSE_HOLIDAYS`), used exclusively to gate whether the market-
open/close jobs should fire. That worked for job-gating but had no holiday
NAMES attached, so there was no way to tell a user *which* holiday it is —
and moving it here means the calendar UI (macro_calendar_service.py) and
worker.py's cron jobs both read from the exact same list. Two independent
copies would have been a real risk: a holiday added to one but not the
other means the calendar UI and the actual job-skipping logic silently
disagree about whether the market is open that day.

Dates are hand-verified against NYSE's published holiday schedule — never
computed from a generic "nth weekday of month" rule, since NYSE has real
exceptions (Good Friday isn't a federal holiday but IS an NYSE closure;
a holiday landing on a Saturday is observed the preceding Friday, one
landing on a Sunday is observed the following Monday — both per NYSE's
actual practice, not a fixed formula). Extending past 2027 requires
manually adding verified dates here — deliberately not extrapolated, to
avoid ever showing a user a fabricated holiday date.
"""
from __future__ import annotations

import zoneinfo
from datetime import date, datetime, timedelta
from typing import Optional

_ET = zoneinfo.ZoneInfo("America/New_York")

# date -> {"es": ..., "en": ...} display name.
US_MARKET_HOLIDAYS: dict[date, dict[str, str]] = {
    # 2025
    date(2025, 1, 1):  {"es": "Año Nuevo", "en": "New Year's Day"},
    date(2025, 1, 20): {"es": "Día de Martin Luther King Jr.", "en": "Martin Luther King Jr. Day"},
    date(2025, 2, 17): {"es": "Día de los Presidentes", "en": "Presidents' Day"},
    date(2025, 4, 18): {"es": "Viernes Santo", "en": "Good Friday"},
    date(2025, 5, 26): {"es": "Día de los Caídos", "en": "Memorial Day"},
    date(2025, 6, 19): {"es": "Juneteenth", "en": "Juneteenth"},
    date(2025, 7, 4):  {"es": "Día de la Independencia", "en": "Independence Day"},
    date(2025, 9, 1):  {"es": "Día del Trabajo", "en": "Labor Day"},
    date(2025, 11, 27): {"es": "Día de Acción de Gracias", "en": "Thanksgiving Day"},
    date(2025, 12, 25): {"es": "Navidad", "en": "Christmas Day"},
    # 2026
    date(2026, 1, 1):  {"es": "Año Nuevo", "en": "New Year's Day"},
    date(2026, 1, 19): {"es": "Día de Martin Luther King Jr.", "en": "Martin Luther King Jr. Day"},
    date(2026, 2, 16): {"es": "Día de los Presidentes", "en": "Presidents' Day"},
    date(2026, 4, 3):  {"es": "Viernes Santo", "en": "Good Friday"},
    date(2026, 5, 25): {"es": "Día de los Caídos", "en": "Memorial Day"},
    date(2026, 6, 19): {"es": "Juneteenth", "en": "Juneteenth"},
    date(2026, 7, 3):  {"es": "Día de la Independencia (observado)", "en": "Independence Day (observed)"},
    date(2026, 9, 7):  {"es": "Día del Trabajo", "en": "Labor Day"},
    date(2026, 11, 26): {"es": "Día de Acción de Gracias", "en": "Thanksgiving Day"},
    date(2026, 12, 25): {"es": "Navidad", "en": "Christmas Day"},
    # 2027
    date(2027, 1, 1):  {"es": "Año Nuevo", "en": "New Year's Day"},
    date(2027, 1, 18): {"es": "Día de Martin Luther King Jr.", "en": "Martin Luther King Jr. Day"},
    date(2027, 2, 15): {"es": "Día de los Presidentes", "en": "Presidents' Day"},
    date(2027, 3, 26): {"es": "Viernes Santo", "en": "Good Friday"},
    date(2027, 5, 31): {"es": "Día de los Caídos", "en": "Memorial Day"},
    date(2027, 6, 18): {"es": "Juneteenth (observado)", "en": "Juneteenth (observed)"},
    date(2027, 7, 5):  {"es": "Día de la Independencia (observado)", "en": "Independence Day (observed)"},
    date(2027, 9, 6):  {"es": "Día del Trabajo", "en": "Labor Day"},
    date(2027, 11, 25): {"es": "Día de Acción de Gracias", "en": "Thanksgiving Day"},
    date(2027, 12, 24): {"es": "Navidad (observada)", "en": "Christmas Day (observed)"},
}


# NYSE early-close ("half day") calendar — the market IS open on these
# dates, it just closes at 1:00pm ET instead of 4:00pm. Kept as a separate
# dict from US_MARKET_HOLIDAYS above (never merged in) — is_trading_day/
# is_market_open_today must stay TRUE for these days, since the market
# really does open and trade normally that morning; only the close time
# is different. Same hand-verified-only discipline as the holiday dict:
# extending past what's listed here requires adding a real, checked date,
# never a generic "day after Thanksgiving is always early close" rule.
US_MARKET_EARLY_CLOSES: dict[date, dict] = {
    date(2026, 11, 27): {"es": "Día después de Acción de Gracias", "en": "Day after Thanksgiving", "close_et": "13:00"},
    date(2026, 12, 24): {"es": "Víspera de Navidad", "en": "Christmas Eve", "close_et": "13:00"},
}


def _today_et() -> date:
    return datetime.now(_ET).date()


def is_trading_day(d: date) -> bool:
    return d.weekday() < 5 and d not in US_MARKET_HOLIDAYS


def is_market_open_today() -> bool:
    """True if NYSE is open right now's date (ET). Excludes weekends and
    observed holidays."""
    return is_trading_day(_today_et())


def is_market_holiday_today() -> bool:
    """True if today (ET) is a weekday NYSE holiday (closed due to a
    holiday specifically, not just because it's a weekend)."""
    today = _today_et()
    return today.weekday() < 5 and today in US_MARKET_HOLIDAYS


def is_first_trading_day_of_week(d: date) -> bool:
    """True if `d` is the first NYSE trading day of its (Mon-Sun) week —
    i.e. no earlier day this week, back to Monday, was itself a trading
    day. Used so a "Monday open" weekly job still fires exactly once per
    week even when Monday itself is a holiday (MLK Day, Presidents' Day,
    Memorial Day, Labor Day are all Mondays)."""
    if not is_trading_day(d):
        return False
    monday = d - timedelta(days=d.weekday())
    day = monday
    while day < d:
        if is_trading_day(day):
            return False
        day += timedelta(days=1)
    return True


def is_first_trading_day_of_month(d: date) -> bool:
    """True if `d` is the first NYSE trading day of its calendar month —
    i.e. no earlier day this month, back to the 1st, was itself a trading
    day. Same idiom as is_first_trading_day_of_week, for a "1st of the
    month" job (e.g. the monthly-report email) that must still fire exactly
    once even when the 1st falls on a weekend or holiday."""
    if not is_trading_day(d):
        return False
    day = d.replace(day=1)
    while day < d:
        if is_trading_day(day):
            return False
        day += timedelta(days=1)
    return True


def is_last_trading_day_of_week(d: date) -> bool:
    """True if `d` is the last NYSE trading day of its (Mon-Sun) week —
    i.e. no later day this week, through Friday, is itself a trading day.
    Used so a "Friday close" weekly job still fires exactly once per week
    even when Friday itself is a holiday."""
    if not is_trading_day(d):
        return False
    friday = d + timedelta(days=4 - d.weekday())
    day = d + timedelta(days=1)
    while day <= friday:
        if is_trading_day(day):
            return False
        day += timedelta(days=1)
    return True


def holiday_name(d: date, lang: str = "es") -> Optional[str]:
    """Real, verified holiday name for `d`, or None if `d` isn't a known
    market holiday (never guesses/fabricates a name)."""
    entry = US_MARKET_HOLIDAYS.get(d)
    if not entry:
        return None
    return entry.get(lang) or entry.get("es")


def holiday_name_today(lang: str = "es") -> Optional[str]:
    return holiday_name(_today_et(), lang)


def is_early_close_day(d: date) -> bool:
    return d in US_MARKET_EARLY_CLOSES


def is_early_close_today() -> bool:
    """True if today (ET) is a known NYSE early-close ("half day") — the
    market is open, it just closes at 1:00pm ET instead of 4:00pm."""
    return is_early_close_day(_today_et())


def early_close_info(d: date, lang: str = "es") -> Optional[dict]:
    """Real, verified early-close info for `d` ({"name": str, "close_et":
    "13:00"}), or None if `d` isn't a known early-close day (never guesses)."""
    entry = US_MARKET_EARLY_CLOSES.get(d)
    if not entry:
        return None
    return {"name": entry.get(lang) or entry.get("es"), "close_et": entry["close_et"]}


def early_close_info_today(lang: str = "es") -> Optional[dict]:
    return early_close_info(_today_et(), lang)


def upcoming_early_closes(days_ahead: int = 60, days_behind: int = 3) -> list[dict]:
    """Real NYSE early-close days within [today - days_behind, today +
    days_ahead] (ET), sorted ascending. Mirrors upcoming_holidays' shape:
    each entry {"date": date, "name_es": str, "name_en": str, "close_et": str}."""
    today = _today_et()
    start = today - timedelta(days=days_behind)
    end = today + timedelta(days=days_ahead)
    return [
        {"date": d, "name_es": info["es"], "name_en": info["en"], "close_et": info["close_et"]}
        for d, info in sorted(US_MARKET_EARLY_CLOSES.items())
        if start <= d <= end
    ]


def upcoming_holidays(days_ahead: int = 60, days_behind: int = 3) -> list[dict]:
    """Real market holidays within [today - days_behind, today + days_ahead]
    (ET), sorted ascending. Each entry: {"date": date, "name_es": str,
    "name_en": str}. The small trailing window matches
    macro_calendar_service.get_macro_events' own `_DAYS_BEHIND`, so a
    holiday from a couple of days ago doesn't just vanish from a calendar
    view that's still showing "this week."
    """
    today = _today_et()
    start = today - timedelta(days=days_behind)
    end = today + timedelta(days=days_ahead)
    return [
        {"date": d, "name_es": names["es"], "name_en": names["en"]}
        for d, names in sorted(US_MARKET_HOLIDAYS.items())
        if start <= d <= end
    ]
