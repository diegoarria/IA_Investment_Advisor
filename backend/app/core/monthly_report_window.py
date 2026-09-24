"""Canonical access-window check for the Nuvos Monthly Report — the single
place this date math lives (same convention as wrapped_window.py).

Diego, 2026-09-23: the Monthly Report is only accessible from the 1st through
the 3rd of every month, on web and mobile, recurring forever. Day-of-month is
evaluated in America/New_York (the timezone every other scheduled job in this
app uses), so the window is the same instant for every user.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

MONTHLY_REPORT_OPEN_DAY = 1
MONTHLY_REPORT_CLOSE_DAY = 3  # inclusive

_ET = ZoneInfo("America/New_York")


def is_monthly_report_window_open(now: datetime | None = None) -> bool:
    """True on day 1, 2 and 3 of any month (00:00 through 23:59:59 ET)."""
    now = (now or datetime.now(_ET)).astimezone(_ET)
    return MONTHLY_REPORT_OPEN_DAY <= now.day <= MONTHLY_REPORT_CLOSE_DAY
