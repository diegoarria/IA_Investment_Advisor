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


async def _get_stripe_fees_30d() -> dict:
    """Real Stripe processing fees over the last 30 days, straight from
    Stripe's balance transactions (the `fee` field is Stripe's own real
    cut, not an estimate) — one of the 3 cost inputs (LLM, Stripe fees,
    fixed platform costs) that make up the margin section below."""
    if not settings.stripe_secret_key:
        return {"available": False, "reason": "not_configured"}

    import stripe
    stripe.api_key = settings.stripe_secret_key
    since = int((datetime.now(timezone.utc) - timedelta(days=30)).timestamp())

    try:
        def _list_fees():
            txns = stripe.BalanceTransaction.list(created={"gte": since}, limit=100).auto_paging_iter()
            return sum((t.get("fee") or 0) for t in txns)
        fee_cents = await asyncio.to_thread(_list_fees)
    except Exception as e:
        logger.warning("_get_stripe_fees_30d failed: %s", e)
        return {"available": False, "reason": "stripe_error"}

    return {"available": True, "fees_usd_30d": round(fee_cents / 100, 2)}


async def _get_llm_cost_30d() -> dict:
    """Real LLM/token spend over the last 30 days, aggregated straight from
    llm_usage_log (the same table /admin/llm-usage reads) — the single
    biggest variable cost besides Stripe fees."""
    db = get_supabase()
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    total = 0.0
    offset = 0
    page_size = 1000
    while True:
        res = await run_query(
            db.table("llm_usage_log").select("cost_usd").gte("created_at", since)
            .range(offset, offset + page_size - 1)
        )
        page = res.data or []
        total += sum(float(r.get("cost_usd") or 0) for r in page)
        if len(page) < page_size:
            break
        offset += page_size
    return {"cost_usd_30d": round(total, 2)}


async def _get_fixed_costs() -> dict:
    """Platform/API costs with no per-call billing API to query (FMP,
    Finnhub, fiscal.ai, Railway, Vercel, Twilio, etc. — flat-rate or
    usage-tier plans) — Diego enters these once via /admin/overview and
    edits them whenever a plan changes (see operating_costs table,
    migration 097)."""
    db = get_supabase()
    res = await run_query(db.table("operating_costs").select("id,name,monthly_usd,notes").order("name"))
    rows = res.data or []
    return {
        "items": rows,
        "total_monthly_usd": round(sum(float(r.get("monthly_usd") or 0) for r in rows), 2),
    }


async def _posthog_hogql(client: httpx.AsyncClient, query: str, timeout: float | None = None) -> list[list] | None:
    try:
        res = await client.post(
            f"{settings.posthog_host}/api/projects/{settings.posthog_project_id}/query/",
            headers={"Authorization": f"Bearer {settings.posthog_personal_api_key}"},
            json={"query": {"kind": "HogQLQuery", "query": query}},
            **({"timeout": timeout} if timeout is not None else {}),
        )
        res.raise_for_status()
        return res.json().get("results") or []
    except Exception as e:
        logger.warning("_posthog_hogql query failed: %s", e)
        return None


async def _get_posthog_metrics() -> dict:
    """DAU/WAU/MAU + product usage in the last 7 days, via PostHog's HogQL
    query API — generic SQL-like queries instead of depending on any
    specific Insight having been pre-built in the PostHog UI.

    Diego, 2026-09-14: "qué es $autocapture y cada cosa" — the original
    top-10 query mixed PostHog's automatic `$`-prefixed events (autocapture
    clicks, $pageview, $pageleave, etc. — captured for free, not something
    anyone named) with real named product actions (e.g.
    "premium_upgrade_completed"), which drowned out the actually
    interesting signal. Now split into `top_custom_events_last_7d` (named
    events only — what people actually DO) and `automatic_events_last_7d`
    (one collapsed count for all `$`-prefixed noise, so it's still visible
    that it exists without cluttering the list)."""
    if not settings.posthog_personal_api_key or not settings.posthog_project_id:
        return {"available": False, "reason": "not_configured"}

    async with httpx.AsyncClient(timeout=15) as client:
        dau_q = "SELECT count(DISTINCT person_id) FROM events WHERE timestamp > now() - INTERVAL 1 DAY"
        wau_q = "SELECT count(DISTINCT person_id) FROM events WHERE timestamp > now() - INTERVAL 7 DAY"
        mau_q = "SELECT count(DISTINCT person_id) FROM events WHERE timestamp > now() - INTERVAL 30 DAY"
        top_custom_events_q = (
            "SELECT event, count() AS c FROM events "
            "WHERE timestamp > now() - INTERVAL 7 DAY AND event NOT LIKE '$%' "
            "GROUP BY event ORDER BY c DESC LIMIT 10"
        )
        automatic_events_q = (
            "SELECT count() FROM events "
            "WHERE timestamp > now() - INTERVAL 7 DAY AND event LIKE '$%'"
        )
        top_pages_q = (
            "SELECT properties.$pathname AS path, count() AS c FROM events "
            "WHERE event = '$pageview' AND timestamp > now() - INTERVAL 7 DAY "
            "AND properties.$pathname IS NOT NULL "
            "GROUP BY path ORDER BY c DESC LIMIT 8"
        )
        dau_res, wau_res, mau_res, top_custom_res, automatic_res, top_pages_res = await asyncio.gather(
            _posthog_hogql(client, dau_q),
            _posthog_hogql(client, wau_q),
            # A 30-day full scan is heavier than the 1d/7d queries — Diego,
            # 2026-09-14: this used to time out under the shared 15s budget
            # and silently render as "—", indistinguishable from a real
            # zero. Give it its own longer per-request timeout instead.
            _posthog_hogql(client, mau_q, timeout=45),
            _posthog_hogql(client, top_custom_events_q),
            _posthog_hogql(client, automatic_events_q),
            _posthog_hogql(client, top_pages_q),
        )

    if all(r is None for r in (dau_res, wau_res, mau_res, top_custom_res, automatic_res, top_pages_res)):
        return {"available": False, "reason": "posthog_error"}

    def _first_count(rows: list[list] | None) -> int | None:
        return rows[0][0] if rows else None

    dau = _first_count(dau_res)
    mau = _first_count(mau_res)
    # Stickiness (DAU/MAU) — the standard "how often do active users come
    # back" ratio; a higher % means people who try the product keep using
    # it, not just sign up once and vanish.
    stickiness_pct = round(dau / mau * 100, 1) if dau is not None and mau else None

    return {
        "available": True,
        "dau": dau,
        "wau": _first_count(wau_res),
        "mau": mau,
        "stickiness_pct": stickiness_pct,
        "top_custom_events_last_7d": [{"event": r[0], "count": r[1]} for r in (top_custom_res or [])],
        "automatic_events_last_7d": _first_count(automatic_res),
        "top_pages_last_7d": [{"path": r[0], "count": r[1]} for r in (top_pages_res or [])],
    }


async def get_business_overview(force_refresh: bool = False) -> dict:
    if not force_refresh:
        cached = cache_get(_CACHE_KEY)
        if cached is not None:
            return cached

    users, stripe_metrics, posthog_metrics, stripe_fees, llm_cost, fixed_costs = await asyncio.gather(
        _get_user_metrics(), _get_stripe_metrics(), _get_posthog_metrics(),
        _get_stripe_fees_30d(), _get_llm_cost_30d(), _get_fixed_costs(),
        return_exceptions=True,
    )
    if isinstance(users, Exception):
        users = {"error": str(users)}
    if isinstance(stripe_metrics, Exception):
        stripe_metrics = {"available": False, "reason": "error"}
    if isinstance(posthog_metrics, Exception):
        posthog_metrics = {"available": False, "reason": "error"}
    if isinstance(stripe_fees, Exception):
        stripe_fees = {"available": False, "reason": "error"}
    if isinstance(llm_cost, Exception):
        llm_cost = {"cost_usd_30d": None}
    if isinstance(fixed_costs, Exception):
        fixed_costs = {"items": [], "total_monthly_usd": 0.0}

    # Margin: MRR minus every real cost we can account for over the same
    # ~30-day window (LLM/token spend, Stripe's own processing fees, and
    # the flat-rate platform bills Diego entered manually) — only computed
    # when MRR is actually available, never guessed.
    costs = {
        "llm_usd_30d":          llm_cost.get("cost_usd_30d"),
        "stripe_fees_usd_30d":  stripe_fees.get("fees_usd_30d") if stripe_fees.get("available") else None,
        "fixed_costs":          fixed_costs,
    }
    mrr = stripe_metrics.get("mrr_usd") if stripe_metrics.get("available") else None
    known_costs = [c for c in (costs["llm_usd_30d"], costs["stripe_fees_usd_30d"], fixed_costs["total_monthly_usd"]) if c is not None]
    total_cost_30d = round(sum(known_costs), 2) if known_costs else None
    margin_usd = round(mrr - total_cost_30d, 2) if mrr is not None and total_cost_30d is not None else None
    margin_pct = round(margin_usd / mrr * 100, 1) if margin_usd is not None and mrr else None
    costs["total_cost_usd_30d"] = total_cost_30d
    costs["margin_usd"] = margin_usd
    costs["margin_pct"] = margin_pct

    # Diego, 2026-09-14: "30%+ de usuarios activos semanalmente" is the real
    # Fase 0 target — a bare WAU count doesn't say whether that goal is
    # being hit, only WAU as a % of total_users does. Computed here (not
    # inside _get_posthog_metrics) since it needs both sections combined.
    wau = posthog_metrics.get("wau") if posthog_metrics.get("available") else None
    total = users.get("total_users") if isinstance(users, dict) else None
    if wau is not None and total:
        posthog_metrics["wau_pct_of_total"] = round(wau / total * 100, 1)

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "users":   users,
        "stripe":  stripe_metrics,
        "posthog": posthog_metrics,
        "costs":   costs,
    }
    cache_set(_CACHE_KEY, result, _CACHE_TTL)
    return result


async def snapshot_business_overview() -> None:
    """Called once daily (job_snapshot_business_overview, worker.py) —
    writes today's business-overview numbers as one row so /admin/overview
    can show trend charts instead of just today's snapshot. Diego,
    2026-09-14: a single number never says whether things are getting
    better or worse; upserts on snapshot_date so a manual re-run same-day
    (or the job firing twice) can't create duplicate rows for one date."""
    import pytz
    overview = await get_business_overview(force_refresh=True)
    users = overview["users"]
    stripe_metrics = overview["stripe"]
    posthog_metrics = overview["posthog"]
    costs = overview["costs"]

    today_et = datetime.now(pytz.timezone("America/New_York")).date().isoformat()
    row = {
        "snapshot_date":          today_et,
        "total_users":            users.get("total_users", 0),
        "premium_count":          users.get("premium_count", 0),
        "manual_comp_count":      users.get("manual_comp_count", 0),
        "trialing_count":         users.get("trialing_count", 0),
        "free_count":             users.get("free_count", 0),
        "signups_last_7d":        users.get("signups_last_7d", 0),
        "signups_last_30d":       users.get("signups_last_30d", 0),
        "mrr_usd":                stripe_metrics.get("mrr_usd") if stripe_metrics.get("available") else None,
        "active_subscriptions":   stripe_metrics.get("active_subscriptions") if stripe_metrics.get("available") else None,
        "trialing_subscriptions": stripe_metrics.get("trialing_subscriptions") if stripe_metrics.get("available") else None,
        "cancellations_last_30d": stripe_metrics.get("cancellations_last_30d") if stripe_metrics.get("available") else None,
        "churn_rate_pct_30d":     stripe_metrics.get("churn_rate_pct_30d") if stripe_metrics.get("available") else None,
        "dau":                    posthog_metrics.get("dau") if posthog_metrics.get("available") else None,
        "wau":                    posthog_metrics.get("wau") if posthog_metrics.get("available") else None,
        "mau":                    posthog_metrics.get("mau") if posthog_metrics.get("available") else None,
        "llm_cost_usd_30d":       costs.get("llm_usd_30d"),
        "stripe_fees_usd_30d":    costs.get("stripe_fees_usd_30d"),
        "fixed_costs_usd":        costs.get("fixed_costs", {}).get("total_monthly_usd"),
        "margin_usd":             costs.get("margin_usd"),
        "margin_pct":             costs.get("margin_pct"),
    }
    db = get_supabase()
    await run_query(db.table("business_overview_snapshots").upsert(row, on_conflict="snapshot_date"))
    logger.info("snapshot_business_overview: wrote snapshot for %s", today_et)


async def get_business_overview_history(days: int = 56) -> list[dict]:
    """Last `days` days of snapshots, oldest first — for /admin/overview's
    trend charts. Not cached: this is a small, indexed, once-a-day-written
    table, cheap enough to always read fresh."""
    from datetime import date
    db = get_supabase()
    since = (date.today() - timedelta(days=days)).isoformat()
    res = await run_query(
        db.table("business_overview_snapshots")
        .select("*")
        .gte("snapshot_date", since)
        .order("snapshot_date", desc=False)
    )
    return res.data or []
