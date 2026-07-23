"""Canonical premium/trial-status check — the single source of truth for
"is this user premium right now."

Before this module existed, the same trial-window math was reimplemented
ad hoc in ~8 different files (chat.py, voice_call.py, worker.py, learn.py,
upsells.py, sync.py...) and drifted out of sync with each other — one path
used a 90-day window, another 7 days, another skipped the trial check
entirely. That drift is exactly what let a user genuinely still inside
their real trial get treated as "free" the moment they hit whichever
endpoint had the wrong/missing check. Every gate in the app must call
`is_premium_active()` below instead of reimplementing this.
"""
from datetime import datetime, timezone

TRIAL_DAYS = 30


def is_premium_active(tier: str | None, trial_started_at: str | None) -> bool:
    """True for paid premium/pro subscribers, and for users within their
    TRIAL_DAYS-day trial. A user's trial status must never flicker to False
    due to caching, timezone handling, or a differing trial-length constant
    — this function is the only place that math is allowed to live."""
    if (tier or "") in ("premium", "pro"):
        return True
    if not trial_started_at:
        return False
    try:
        started = datetime.fromisoformat(trial_started_at.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - started).days < TRIAL_DAYS
    except Exception:
        return False
