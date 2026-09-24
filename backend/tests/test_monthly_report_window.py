from datetime import datetime
from zoneinfo import ZoneInfo

from app.core.monthly_report_window import is_monthly_report_window_open

ET = ZoneInfo("America/New_York")


def test_open_only_on_days_1_to_3():
    for d in (1, 2, 3):
        assert is_monthly_report_window_open(datetime(2026, 10, d, 12, 0, tzinfo=ET))
    for d in (4, 15, 28, 31):
        assert not is_monthly_report_window_open(datetime(2026, 10, d, 12, 0, tzinfo=ET))


def test_boundaries_are_evaluated_in_eastern_time():
    assert is_monthly_report_window_open(datetime(2026, 10, 1, 0, 0, 0, tzinfo=ET))
    assert is_monthly_report_window_open(datetime(2026, 10, 3, 23, 59, 59, tzinfo=ET))
    assert not is_monthly_report_window_open(datetime(2026, 10, 4, 0, 0, 0, tzinfo=ET))
    # 03:30 UTC on Oct 4 is still the evening of Oct 3 in New York.
    assert is_monthly_report_window_open(datetime(2026, 10, 4, 3, 30, tzinfo=ZoneInfo("UTC")))
    # 04:30 UTC on Oct 1 is still Sept 30 evening in New York — closed.
    assert not is_monthly_report_window_open(datetime(2026, 10, 1, 3, 30, tzinfo=ZoneInfo("UTC")))
