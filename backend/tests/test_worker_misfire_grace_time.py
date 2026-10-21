"""
2026-10-21: confirmed live via notification_log — a Railway worker restart's
APScheduler misfire catch-up run of job_earnings_watch produced a real
duplicate earnings push for the same user/ticker/day (~35min after the
first), despite the per-day dedup lock correctly blocking every normal
15-min grid tick around it. The global job_defaults misfire_grace_time=600
(worker.py's `main()`) is what causes a missed cron tick to fire
immediately on restart instead of just waiting for the next one — for
these frequently-polled jobs there's no benefit to catching up (the next
tick re-checks the same "did X happen today" condition anyway), only the
proven risk of a duplicate. Asserts the override is actually present on
each job's own scheduler.add_job() call, not just in a comment, by reading
worker.py's real source — a cheap, deterministic regression guard.
"""
import re
from pathlib import Path

WORKER_SRC = Path(__file__).parent.parent / "worker.py"


def _add_job_calls(func_name: str) -> list[str]:
    src = WORKER_SRC.read_text()
    calls = re.findall(rf"scheduler\.add_job\({func_name},.*?\)\n", src, re.DOTALL)
    assert calls, f"scheduler.add_job({func_name}, ...) not found in worker.py"
    return calls


def test_job_earnings_watch_disables_misfire_catchup():
    for call in _add_job_calls("job_earnings_watch"):
        assert "misfire_grace_time=0" in call


def test_job_portfolio_alerts_disables_misfire_catchup():
    # Registered twice (9:30-9:55 ramp-up, then 10:00-15:55) — both must
    # have the override, not just one.
    for call in _add_job_calls("job_portfolio_alerts"):
        assert "misfire_grace_time=0" in call


def test_job_macro_event_watch_disables_misfire_catchup():
    assert "misfire_grace_time=0" in _add_job_calls("job_macro_event_watch")[0]


def test_job_market_crash_alert_disables_misfire_catchup():
    assert "misfire_grace_time=0" in _add_job_calls("job_market_crash_alert")[0]
