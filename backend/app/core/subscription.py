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
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

TRIAL_DAYS = 30


def is_premium_active(
    tier: str | None,
    trial_started_at: str | None,
    streak_bonus_premium_until: str | None = None,
) -> bool:
    """True for paid premium/pro subscribers, users within their
    TRIAL_DAYS-day trial, AND users currently covered by a streak/referral
    premium bonus (streak_bonus_premium_until in the future). A user's
    premium status must never flicker to False due to caching, timezone
    handling, a differing trial-length constant, or a gate that forgot
    about the bonus column — this function is the only place any of that
    math is allowed to live.

    `streak_bonus_premium_until` is optional (defaults None) purely so
    every existing 2-arg call site keeps compiling — but any caller that
    has the profile row in hand should pass it. Skipping it is exactly how
    a user whose only premium entitlement is a streak/referral bonus ends
    up seeing "Premium" in the UI (billing/status knows about the bonus)
    while every other gate — chat, watchlist, price alerts, learn, voice
    calls — silently rejects them."""
    if (tier or "") in ("premium", "pro"):
        return True
    if trial_started_at:
        try:
            started = datetime.fromisoformat(trial_started_at.replace("Z", "+00:00"))
            if (datetime.now(timezone.utc) - started).days < TRIAL_DAYS:
                return True
        except Exception:
            logger.warning("is_premium_active: unparseable trial_started_at=%r — treating as no active trial", trial_started_at)
    if streak_bonus_premium_until:
        try:
            bonus_end = datetime.fromisoformat(streak_bonus_premium_until.replace("Z", "+00:00"))
            if bonus_end > datetime.now(timezone.utc):
                return True
        except Exception:
            logger.warning("is_premium_active: unparseable streak_bonus_premium_until=%r — ignoring bonus", streak_bonus_premium_until)
    return False
