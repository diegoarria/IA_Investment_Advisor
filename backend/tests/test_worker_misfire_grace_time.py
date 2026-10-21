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
proven risk of a duplicate.

First fix attempt used misfire_grace_time=0, which crash-looped the real
worker in production: APScheduler's Job._modify() rejects 0 outright
("misfire_grace_time must be either None or a positive integer"), so
every scheduler.add_job() call raised at startup. The source-regex check
below missed this because it never executed add_job — only grepped for
the string. Fixed to misfire_grace_time=1 (smallest valid value, same effect), and
added test_add_job_accepts_the_real_kwargs_for_every_job below, which
feeds each job's REAL scheduler.add_job(...) kwargs (parsed straight out
of worker.py's source) into a real AsyncIOScheduler and lets APScheduler
validate them for real — the class of bug a regex check can't catch.
(A fuller test that actually ran worker.main() was tried first, but it
hangs on an unrelated first-import network call in one of main()'s local
imports — out of scope for this bug, so this narrower real-execution
check is used instead.)
"""
import re
from pathlib import Path

import pytest
from apscheduler.schedulers.asyncio import AsyncIOScheduler

import worker

WORKER_SRC = Path(__file__).parent.parent / "worker.py"


def _add_job_calls(func_name: str) -> list[str]:
    src = WORKER_SRC.read_text()
    calls = re.findall(rf"scheduler\.add_job\({func_name},.*?\)\n", src, re.DOTALL)
    assert calls, f"scheduler.add_job({func_name}, ...) not found in worker.py"
    return calls


def test_job_earnings_watch_disables_misfire_catchup():
    for call in _add_job_calls("job_earnings_watch"):
        assert "misfire_grace_time=1" in call


def test_job_portfolio_alerts_disables_misfire_catchup():
    # Registered twice (9:30-9:55 ramp-up, then 10:00-15:55) — both must
    # have the override, not just one.
    for call in _add_job_calls("job_portfolio_alerts"):
        assert "misfire_grace_time=1" in call


def test_job_macro_event_watch_disables_misfire_catchup():
    assert "misfire_grace_time=1" in _add_job_calls("job_macro_event_watch")[0]


def test_job_market_crash_alert_disables_misfire_catchup():
    assert "misfire_grace_time=1" in _add_job_calls("job_market_crash_alert")[0]


_JOBS_THAT_MUST_VALIDATE = {
    "job_earnings_watch",
    "job_portfolio_alerts",
    "job_macro_event_watch",
    "job_market_crash_alert",
}


def test_add_job_accepts_the_real_kwargs_for_every_job():
    """Parses every single-line scheduler.add_job(<job>, "cron"/"interval",
    ...) call out of worker.py's real source and replays it against a
    real AsyncIOScheduler (job functions swapped for a no-op). APScheduler
    validates misfire_grace_time (and every other kwarg) for real here —
    this is the check that would have caught misfire_grace_time=0 before
    it ever reached production, where a regex-only check could not.
    A few calls use loop/runtime variables (e.g. _window_start_hour) that
    don't exist in this standalone context — those are skipped, but the
    4 jobs this bug actually touched must always validate successfully."""
    from datetime import datetime as datetime_cls

    src = WORKER_SRC.read_text()
    calls = re.findall(r"scheduler\.add_job\(([a-zA-Z_]+),\s*(.*?)\)\n", src)
    assert len(calls) > 15, "sanity check: expected many add_job registrations"

    scheduler = AsyncIOScheduler()

    def _noop():
        pass

    validated = set()
    for job_name, raw_args in calls:
        try:
            args, kwargs = eval(
                f"_call({raw_args})",
                {"_call": lambda *a, **k: (a, k), "datetime": datetime_cls},
            )
        except NameError:
            continue  # uses a loop/runtime variable not available standalone
        kwargs.setdefault("id", f"{job_name}:{len(scheduler.get_jobs())}")
        scheduler.add_job(_noop, *args, **kwargs)
        validated.add(job_name)

    missing = _JOBS_THAT_MUST_VALIDATE - validated
    assert not missing, f"these jobs' add_job kwargs were never actually validated: {missing}"
