import asyncio
import logging

import stripe

logger = logging.getLogger(__name__)


async def stripe_call(fn, *args, **kwargs):
    """Run a blocking Stripe SDK call in a thread, retrying transient
    network/server-side failures (a dropped connection, a momentary 5xx, a
    rate limit) up to 3x with backoff — the same class of "one blip and
    it's fine on retry" failure `run_query` already retries for Supabase.

    Diego, 2026-09-16: "a veces si abre correctamente, a veces salta ese
    error, pero luego si recargo ya aparece bien" — that pattern (works on
    manual retry, not misconfiguration) is exactly what this class of
    error looks like. Every checkout path in the app (Premium/Duo
    subscription in billing.py, and session/family_plan/deep_research in
    upsells.py) had zero retry logic on its Stripe calls before this,
    unlike every DB call in this codebase — shared here instead of
    duplicated per-file so a future checkout path gets this for free.

    Deliberately does NOT retry CardError/InvalidRequestError/
    AuthenticationError etc. — those are real failures (bad price id, bad
    card, bad key) that will never succeed no matter how many times
    they're retried, and retrying them only delays showing the user the
    real problem."""
    for attempt in range(3):
        try:
            return await asyncio.to_thread(fn, *args, **kwargs)
        except (stripe.APIConnectionError, stripe.APIError, stripe.RateLimitError) as e:
            if attempt == 2:
                raise
            logger.warning("Stripe transient error (attempt %d/3): %s", attempt + 1, e)
            await asyncio.sleep(0.4 * (attempt + 1))
