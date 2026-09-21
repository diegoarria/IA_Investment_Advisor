"""Mexican users are offered MXN Stripe prices (many Mexican cards reject USD
— "Your card doesn't support this currency"). Anything not configured must
silently fall back to USD, and MXN must never be summed as dollars in MRR."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.routes import billing
from app.core import pricing_region as pr
from app.services.business_overview_service import _monthly_amount_cents, _to_usd_cents


def cfg(**kw):
    base = dict(
        stripe_secret_key="sk_test", stripe_price_id_monthly="usd_m", stripe_price_id_yearly="usd_y",
        stripe_price_id_monthly_mxn="mxn_m", stripe_price_id_yearly_mxn="mxn_y",
        stripe_price_family_monthly="usd_dm", stripe_price_family_yearly="usd_dy",
        stripe_price_family_monthly_mxn="mxn_dm", stripe_price_family_yearly_mxn="mxn_dy",
        stripe_price_session_free="usd_sf", stripe_price_session_premium="usd_sp", stripe_price_session_bundle="usd_sb",
        stripe_price_session_free_mxn="mxn_sf", stripe_price_session_premium_mxn="mxn_sp", stripe_price_session_bundle_mxn="mxn_sb",
        stripe_price_broker_call="p", frontend_url="https://nuvosai.com",
    )
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.mark.parametrize("country,phone,expected", [
    ("MX", None, True), ("mx", "", True), ("México", None, True), ("mexico", None, True),
    (None, "+52 81 1234 5678", True), (None, "+528112345678", True),
    (None, "+58 414 1234567", False), ("US", "+1 555", False), (None, None, False), ("", "", False),
])
def test_is_mexico(country, phone, expected):
    assert pr.is_mexico(country, phone) is expected


@pytest.mark.parametrize("plan,mexico,expected", [
    ("monthly", True, "mxn_m"), ("yearly", True, "mxn_y"),
    ("monthly", False, "usd_m"), ("yearly", False, "usd_y"),
])
def test_subscription_price_selection(plan, mexico, expected):
    assert pr.subscription_price_id(plan, mexico, cfg()) == expected


def test_missing_mxn_price_falls_back_to_usd():
    c = cfg(stripe_price_id_monthly_mxn="")
    assert pr.subscription_price_id("monthly", True, c) == "usd_m"
    assert pr.subscription_price_id("yearly", True, c) == "mxn_y"   # only the blank one falls back


@pytest.mark.parametrize("offer,key,usd,expected", [
    ("family_plan", "monthly", "usd_dm", "mxn_dm"), ("family_plan", "yearly", "usd_dy", "mxn_dy"),
    ("session", "free", "usd_sf", "mxn_sf"), ("session", "premium", "usd_sp", "mxn_sp"),
    ("session", "bundle", "usd_sb", "mxn_sb"),
    ("deep_research", "free", "usd_dr", "usd_dr"),       # no MXN price exists for it -> stays USD
])
def test_upsell_price_selection(offer, key, usd, expected):
    assert pr.upsell_price_id(offer, key, usd, True, cfg()) == expected
    assert pr.upsell_price_id(offer, key, usd, False, cfg()) == usd


def test_billing_price_id_still_503s_when_nothing_is_configured():
    with patch("app.api.routes.billing.settings", cfg(stripe_price_id_monthly="", stripe_price_id_monthly_mxn="")):
        with pytest.raises(HTTPException) as e:
            billing._price_id("monthly", True)
    assert e.value.status_code == 503


def test_mrr_does_not_count_pesos_as_dollars():
    assert _to_usd_cents(1000, "usd") == 1000
    assert _to_usd_cents(1000, None) == 1000
    mxn_month = _monthly_amount_cents({"unit_amount": 25900, "currency": "mxn", "recurring": {"interval": "month"}}, 1)
    assert 1400 < mxn_month < 1600          # ~ $14-16 USD, not $259
    mxn_year = _monthly_amount_cents({"unit_amount": 249900, "currency": "mxn", "recurring": {"interval": "year"}}, 1)
    assert 1100 < mxn_year < 1300
    usd_month = _monthly_amount_cents({"unit_amount": 1499, "currency": "usd", "recurring": {"interval": "month"}}, 1)
    assert usd_month == 1499


@pytest.mark.asyncio
async def test_embedded_subscription_uses_the_mxn_price_for_a_mexican_profile():
    fake_sub = SimpleNamespace(id="sub_1", latest_invoice=SimpleNamespace(payment_intent=SimpleNamespace(client_secret="cs")))
    with patch("app.api.routes.billing.get_supabase", return_value=MagicMock()), \
         patch("app.api.routes.billing.run_query", new_callable=AsyncMock) as rq, \
         patch("app.api.routes.billing.settings", cfg()), \
         patch("app.api.routes.billing._stripe_call", new_callable=AsyncMock) as sc, \
         patch("app.api.routes.billing.stripe") as st:
        rq.return_value = SimpleNamespace(data={"stripe_customer_id": "cus_1", "country": "MX", "phone_number": None})
        sc.return_value = fake_sub
        st.Subscription.create = "sub_create"
        await billing.create_embedded_subscription(billing.CheckoutRequest(plan="monthly"), user={"id": "u1", "email": "a@b.c"})
        assert sc.call_args.kwargs["items"] == [{"price": "mxn_m"}]

        rq.return_value = SimpleNamespace(data={"stripe_customer_id": "cus_1", "country": "US", "phone_number": None})
        await billing.create_embedded_subscription(billing.CheckoutRequest(plan="monthly"), user={"id": "u1", "email": "a@b.c"})
        assert sc.call_args.kwargs["items"] == [{"price": "usd_m"}]


@pytest.mark.asyncio
async def test_pricing_endpoint_reports_mxn_amounts_only_for_mexico_and_falls_back_to_usd():
    prices = {"mxn_m": 25900, "mxn_y": 249900, "mxn_dm": 41900, "mxn_dy": 389900}

    async def fake_stripe_call(fn, price_id):
        return {"unit_amount": prices[price_id]}

    with patch("app.api.routes.billing.get_supabase", return_value=MagicMock()), \
         patch("app.api.routes.billing.run_query", new_callable=AsyncMock) as rq, \
         patch("app.api.routes.billing.settings", cfg()), \
         patch("app.api.routes.billing._stripe", return_value=MagicMock()), \
         patch("app.api.routes.billing._stripe_call", side_effect=fake_stripe_call), \
         patch("app.core.cache.cache_get", return_value=None), patch("app.core.cache.cache_set"):
        rq.return_value = SimpleNamespace(data={"country": "MX", "phone_number": None})
        out = await billing.get_pricing(user_id="u1")
        assert out == {"currency": "mxn", "monthly": 259.0, "yearly": 2499.0, "duo_monthly": 419.0, "duo_yearly": 3899.0}
        rq.return_value = SimpleNamespace(data={"country": "US", "phone_number": None})
        assert await billing.get_pricing(user_id="u1") == {"currency": "usd"}
        rq.side_effect = Exception("db down")
        assert await billing.get_pricing(user_id="u1") == {"currency": "usd"}
