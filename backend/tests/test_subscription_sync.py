"""A user who PAID must become Premium even if the webhook missed or matched no
profile (2026-09-20: the payment came from a Stripe customer whose id was never
saved on the profile, so nothing was granted). sync_subscription asks Stripe."""
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.routes import billing
from app.services import subscription_sync as ss


def _stripe_fake(customers_by_search=(), customers_by_email=(), subs_by_customer=None):
    subs_by_customer = subs_by_customer or {}

    async def fake(fn, *args, **kwargs):
        name = fn.__qualname__
        if name.endswith("Customer.search"):
            return {"data": [dict(c) for c in customers_by_search]}
        if name.endswith("Customer.list"):
            return {"data": [dict(c) for c in customers_by_email]}
        if name.endswith("Subscription.list"):
            return {"data": subs_by_customer.get(kwargs["customer"], [])}
        raise AssertionError(name)
    return fake


def _sub(status="active", days=30, metadata=None):
    return {"status": status, "current_period_end": int(time.time()) + days * 86400, "metadata": metadata or {}}


async def _run(profile, stripe_fake, email="a@b.c", secret="sk_test"):
    updates = []

    async def rq(query):
        if hasattr(query, "_is_update"):
            updates.append(query._payload)
            return SimpleNamespace(data=[{}])
        return SimpleNamespace(data=profile)

    db = MagicMock()
    table = MagicMock()
    db.table.return_value = table
    # select chain -> marker query; update chain -> capture payload
    table.select.return_value.eq.return_value.maybe_single.return_value = SimpleNamespace(_is_update=False)

    def _update(payload):
        q = SimpleNamespace(_is_update=True, _payload=payload)
        q.eq = lambda *a, **k: q
        return q
    table.update.side_effect = _update

    async def fake_rq(q):
        if getattr(q, "_is_update", False):
            updates.append(q._payload)
            return SimpleNamespace(data=[{}])
        return SimpleNamespace(data=profile)

    with patch.object(ss, "run_query", side_effect=fake_rq), \
         patch.object(ss, "stripe_call", side_effect=stripe_fake), \
         patch.object(ss.settings, "stripe_secret_key", secret), \
         patch.object(ss, "cache_delete") as cd:
        out = await ss.sync_subscription(db, "u1", email)
    return out, updates, cd


@pytest.mark.asyncio
async def test_activates_premium_from_a_customer_that_is_not_the_one_on_the_profile():
    """The real incident: profile linked to cus_OLD, payment made by cus_NEW."""
    fake = _stripe_fake(
        customers_by_search=[{"id": "cus_NEW", "metadata": {"user_id": "u1"}}],
        subs_by_customer={"cus_OLD": [], "cus_NEW": [_sub()]},
    )
    out, updates, cd = await _run({"stripe_customer_id": "cus_OLD", "subscription_started_at": None}, fake)
    assert out["premium"] is True and out["customer_id"] == "cus_NEW"
    u = updates[0]
    assert u["subscription_tier"] == "premium" and u["subscription_source"] == "stripe"
    assert u["stripe_customer_id"] == "cus_NEW"           # link repaired
    assert u["premium_until"] and u["subscription_started_at"]
    cd.assert_any_call("profile:u1")


@pytest.mark.asyncio
async def test_no_active_subscription_changes_nothing():
    fake = _stripe_fake(customers_by_search=[{"id": "cus_1", "metadata": {"user_id": "u1"}}],
                        subs_by_customer={"cus_1": [_sub("canceled"), _sub("incomplete"), _sub("past_due"), _sub("unpaid")]})
    out, updates, _ = await _run({"stripe_customer_id": "cus_1"}, fake)
    assert out["premium"] is False and updates == []


@pytest.mark.asyncio
async def test_trialing_counts_as_paid_access():
    fake = _stripe_fake(subs_by_customer={"cus_1": [_sub("trialing")]})
    out, updates, _ = await _run({"stripe_customer_id": "cus_1"}, fake)
    assert out["premium"] is True and updates


@pytest.mark.asyncio
async def test_never_adopts_a_customer_that_belongs_to_another_user():
    """Email match is only a fallback for customers with no user_id of their own."""
    fake = _stripe_fake(
        customers_by_email=[
            {"id": "cus_other", "metadata": {"user_id": "someone-else"}},
            {"id": "cus_mine_no_meta", "metadata": {}},
        ],
        subs_by_customer={"cus_other": [_sub()], "cus_mine_no_meta": []},
    )
    out, updates, _ = await _run({"stripe_customer_id": None}, fake)
    assert out["premium"] is False and updates == []


@pytest.mark.asyncio
async def test_email_only_customer_with_active_subscription_is_adopted():
    fake = _stripe_fake(customers_by_email=[{"id": "cus_hosted", "metadata": {}}],
                        subs_by_customer={"cus_hosted": [_sub()]})
    out, updates, _ = await _run({"stripe_customer_id": None}, fake)
    assert out["premium"] and updates[0]["stripe_customer_id"] == "cus_hosted"


@pytest.mark.asyncio
async def test_picks_the_subscription_with_the_latest_period_end_and_flags_duo():
    fake = _stripe_fake(
        customers_by_search=[{"id": "cus_a", "metadata": {"user_id": "u1"}}, {"id": "cus_b", "metadata": {"user_id": "u1"}}],
        subs_by_customer={"cus_a": [_sub(days=5)], "cus_b": [_sub(days=60, metadata={"offer": "family_plan"})]},
    )
    out, updates, _ = await _run({"stripe_customer_id": None}, fake)
    assert out["customer_id"] == "cus_b" and "duo_plan_purchased_at" in updates[0]


@pytest.mark.asyncio
async def test_existing_started_at_is_not_overwritten():
    fake = _stripe_fake(subs_by_customer={"cus_1": [_sub()]})
    _, updates, _ = await _run({"stripe_customer_id": "cus_1", "subscription_started_at": "2026-01-01T00:00:00+00:00"}, fake)
    assert "subscription_started_at" not in updates[0]


@pytest.mark.asyncio
async def test_without_a_stripe_key_it_does_nothing():
    out, updates, _ = await _run({}, _stripe_fake(), secret="")
    assert out["premium"] is False and updates == []


@pytest.mark.asyncio
async def test_endpoint_turns_a_failure_into_a_retryable_503():
    with patch("app.api.routes.billing.get_fresh_supabase", return_value=MagicMock()), \
         patch("app.services.subscription_sync.sync_subscription", new_callable=AsyncMock, side_effect=RuntimeError("boom")):
        with pytest.raises(HTTPException) as e:
            await billing.sync_subscription_endpoint(user={"id": "u1", "email": "a@b.c"})
    assert e.value.status_code == 503
