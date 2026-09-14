"""Business overview for the admin panel — consolidates 3 separate places
Diego used to check one at a time (Supabase, Stripe, PostHog) into one
read-only view. Diego, 2026-09-14: "tener todo en un solo lugar" — user
counts/premium/churn/product usage in a single admin tab instead of
tab-hopping between dashboards.

Each section is independent and never lets one failing source 500 the
whole endpoint: Supabase user counts are always available (no external
dependency); Stripe and PostHog each report {"available": False, "reason":
...} if unconfigured or if the call fails, instead of raising.

Cached briefly — this is a business dashboard checked a few times a day
by one person, not a per-second metric, and Stripe's subscription-list +
event-list calls (plus PostHog's HogQL queries) are too slow/wasteful to
re-run on every page load."""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

import httpx

from app.core.cache import cache_get, cache_set
from app.core.config import settings
from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)

_CACHE_KEY = "admin:business_overview:v1"
_CACHE_TTL = 300  # 5 min


async def _get_user_metrics() -> dict:
    """Total users / premium / trialing / free, and recent signups — always
    available, straight from user_profiles, no external dependency."""
    from app.core.subscription import is_premium_active

    db = get_supabase()
    res = await run_query(
        db.table("user_profiles").select(
            "user_id,subscription_tier,subscription_source,trial_started_at,"
            "streak_bonus_premium_until,created_at"
        )
    )
    rows = res.data or []
    total = len(rows)

    paid_premium = 0
    manual_comp = 0
    trialing = 0
    for r in rows:
        tier = r.get("subscription_tier") or "free"
        if tier in ("premium", "pro"):
            paid_premium += 1
            if (r.get("subscription_source") or "") == "manual_comp":
                manual_comp += 1
        elif is_premium_active(tier, r.get("trial_started_at"), r.get("streak_bonus_premium_until")):
            trialing += 1

    now = datetime.now(timezone.utc)
    signups_7d = signups_30d = 0
    for r in rows:
        created = r.get("created_at")
        if not created:
            continue
        try:
            dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
        except Exception:
            continue
        age_days = (now - dt).days
        if age_days <= 7:
            signups_7d += 1
        if age_days <= 30:
            signups_30d += 1

    return {
        "total_users": total,
        "premium_count": paid_premium,
        "manual_comp_count": manual_comp,
        "trialing_count": trialing,
        "free_count": max(total - paid_premium - trialing, 0),
        "signups_last_7d": signups_7d,
        "signups_last_30d": signups_30d,
    }


def _monthly_amount_cents(price: dict, quantity: int) -> float:
    """Normalizes any recurring price (monthly, yearly, every-N-months) to
    a monthly amount so mixed monthly/yearly subscribers can be summed into
    one real MRR figure."""
    amount = (price.get("unit_amount") or 0) * quantity
    recurring = price.get("recurring") or {}
    interval = recurring.get("interval")
    interval_count = recurring.get("interval_count") or 1
    if interval == "year":
        return amount / (12 * interval_count)
    if interval == "week":
        return amount * (52 / 12) / interval_count
    if interval == "month":
        return amount / interval_count
    return amount  # one-time or unrecognized — count once, don't guess


async def _get_stripe_metrics() -> dict:
    """MRR, active/trialing subscriber counts, and last-30-days
    cancellations (via customer.subscription.deleted events — an accurate
    "recent churn" signal, unlike listing every canceled subscription ever
    and filtering client-side)."""
    if not settings.stripe_secret_key:
        return {"available": False, "reason": "not_configured"}

    import stripe
    stripe.api_key = settings.stripe_secret_key

    try:
        def _list_subs():
            active = list(stripe.Subscription.list(status="active", limit=100).auto_paging_iter())
            trialing = list(stripe.Subscription.list(status="trialing", limit=100).auto_paging_iter())
            return active, trialing
        active_subs, trialing_subs = await asyncio.to_thread(_list_subs)
    except Exception as e:
        logger.warning("_get_stripe_metrics: subscription list failed: %s", e)
        return {"available": False, "reason": "stripe_error"}

    mrr_cents = 0.0
    for sub in active_subs + trialing_subs:
        for item in sub["items"]["data"]:
            mrr_cents += _monthly_amount_cents(item["price"], item.get("quantity", 1))

    since = int((datetime.now(timezone.utc) - timedelta(days=30)).timestamp())
    try:
        def _list_cancellations():
            events = stripe.Event.list(
                type="customer.subscription.deleted", created={"gte": since}, limit=100,
            )
            return list(events.auto_paging_iter())
        cancel_events = await asyncio.to_thread(_list_cancellations)
    except Exception as e:
        logger.warning("_get_stripe_metrics: cancellation events failed: %s", e)
        cancel_events = []

    recent = []
    for ev in cancel_events[:10]:
        sub = ev["data"]["object"]
        items = (sub.get("items") or {}).get("data") or []
        plan_amount = (items[0]["price"].get("unit_amount") or 0) / 100 if items else 0
        recent.append({
            "customer_id":  sub.get("customer"),
            "canceled_at":  sub.get("canceled_at") or ev.get("created"),
            "plan_amount":  plan_amount,
        })

    # Best-effort email lookup for the (at most 10) most recent cancellations
    # — worth the extra calls since this list is small and "who churned" is
    # meaningless without knowing who.
    if recent:
        async def _email_for(customer_id: str | None) -> str | None:
            if not customer_id:
                return None
            try:
                customer = await asyncio.to_thread(stripe.Customer.retrieve, customer_id)
                return customer.get("email")
            except Exception:
                return None
        emails = await asyncio.gather(*[_email_for(r["customer_id"]) for r in recent])
        for r, email in zip(recent, emails):
            r["email"] = email

    active_count = len(active_subs)
    churn_30d = len(cancel_events)
    churn_rate_pct = round(churn_30d / max(active_count + churn_30d, 1) * 100, 1)

    return {
        "available": True,
        "mrr_usd": round(mrr_cents / 100, 2),
        "active_subscriptions": active_count,
        "trialing_subscriptions": len(trialing_subs),
        "cancellations_last_30d": churn_30d,
        "churn_rate_pct_30d": churn_rate_pct,
        "recent_cancellations": recent,
    }


async def _posthog_hogql(client: httpx.AsyncClient, query: str) -> list[list] | None:
    try:
        res = await client.post(
            f"{settings.posthog_host}/api/projects/{settings.posthog_project_id}/query/",
            headers={"Authorization": f"Bearer {settings.posthog_personal_api_key}"},
            json={"query": {"kind": "HogQLQuery", "query": query}},
        )
        res.raise_for_status()
        return res.json().get("results") or []
    except Exception as e:
        logger.warning("_posthog_hogql query failed: %s", e)
        return None


async def _get_posthog_metrics() -> dict:
    """DAU/WAU/MAU + top 10 events in the last 7 days, via PostHog's HogQL
    query API — generic SQL-like queries instead of depending on any
    specific Insight having been pre-built in the PostHog UI."""
    if not settings.posthog_personal_api_key or not settings.posthog_project_id:
        return {"available": False, "reason": "not_configured"}

    async with httpx.AsyncClient(timeout=15) as client:
        dau_q = "SELECT count(DISTINCT person_id) FROM events WHERE timestamp > now() - INTERVAL 1 DAY"
        wau_q = "SELECT count(DISTINCT person_id) FROM events WHERE timestamp > now() - INTERVAL 7 DAY"
        mau_q = "SELECT count(DISTINCT person_id) FROM events WHERE timestamp > now() - INTERVAL 30 DAY"
        top_events_q = (
            "SELECT event, count() AS c FROM events "
            "WHERE timestamp > now() - INTERVAL 7 DAY "
            "GROUP BY event ORDER BY c DESC LIMIT 10"
        )
        dau_res, wau_res, mau_res, top_res = await asyncio.gather(
            _posthog_hogql(client, dau_q),
            _posthog_hogql(client, wau_q),
            _posthog_hogql(client, mau_q),
            _posthog_hogql(client, top_events_q),
        )

    if dau_res is None and wau_res is None and mau_res is None and top_res is None:
        return {"available": False, "reason": "posthog_error"}

    def _first_count(rows: list[list] | None) -> int | None:
        return rows[0][0] if rows else None

    return {
        "available": True,
        "dau": _first_count(dau_res),
        "wau": _first_count(wau_res),
        "mau": _first_count(mau_res),
        "top_events_last_7d": [{"event": r[0], "count": r[1]} for r in (top_res or [])],
    }


async def get_business_overview(force_refresh: bool = False) -> dict:
    if not force_refresh:
        cached = cache_get(_CACHE_KEY)
        if cached is not None:
            return cached

    users, stripe_metrics, posthog_metrics = await asyncio.gather(
        _get_user_metrics(), _get_stripe_metrics(), _get_posthog_metrics(),
        return_exceptions=True,
    )
    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "users":   users   if not isinstance(users, Exception)   else {"error": str(users)},
        "stripe":  stripe_metrics  if not isinstance(stripe_metrics, Exception)  else {"available": False, "reason": "error"},
        "posthog": posthog_metrics if not isinstance(posthog_metrics, Exception) else {"available": False, "reason": "error"},
    }
    cache_set(_CACHE_KEY, result, _CACHE_TTL)
    return result
