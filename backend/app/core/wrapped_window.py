"""Canonical access-window check for the annual Investor Wrapped — the single
place this date math is allowed to live (same convention as
app.core.subscription's is_premium_active, which this file sits next to).

Diego: "quiero que dure del 15 de diciembre al 15 de enero de cada año que
pase en la historia de la vida, antes de esa fecha no hay acceso" — a fixed
calendar window, recurring forever, never a one-time date. Every gate (the
route itself, and any UI that decides whether to show an entry point) must
call is_wrapped_window_open() instead of reimplementing this comparison.
"""
from datetime import datetime

WRAPPED_OPEN_MONTH_DAY = (12, 15)   # window opens Dec 15
WRAPPED_CLOSE_MONTH_DAY = (1, 15)   # window closes Jan 15 (inclusive)


def is_wrapped_window_open(now: datetime) -> bool:
    """True from Dec 15 00:00 through Jan 15 23:59:59 (inclusive), in
    whatever timezone `now` is already in — callers pass a UTC `now`. Plain
    (month, day) comparison, ignoring year, so this is correct forever
    without ever needing a per-year update (same idiom already used by
    worker.py's birthday-email job for its own annually-recurring check)."""
    if now.month == 12:
        return now.day >= WRAPPED_OPEN_MONTH_DAY[1]
    if now.month == 1:
        return now.day <= WRAPPED_CLOSE_MONTH_DAY[1]
    return False


def wrapped_year_for(now: datetime) -> int:
    """Which calendar year this Wrapped celebrates. Dec 15-31 celebrates the
    year that's ending; Jan 1-15 still celebrates the year that JUST ended,
    not the barely-started new one — opening Wrapped on Jan 10 must show the
    2026 recap, not an almost-empty 2027 one."""
    return now.year if now.month == 12 else now.year - 1
