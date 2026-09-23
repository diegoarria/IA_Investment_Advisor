"""Stripe Adaptive Pricing checkout (Checkout Sessions, ui_mode="elements").

Adaptive Pricing isn't supported on the PaymentIntents API the legacy embedded
flow uses, so it needs its own endpoint. It must be OFF unless explicitly
enabled, anchored on the MXN price (the account settles only in MXN), and hand
the existing webhook everything it already keys on (client_reference_id)."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.routes import billing


def cfg(**kw):
    base = dict(
        stripe_secret_key="sk_test", frontend_url="https://nuvosai.com",
        stripe_price_id_monthly="usd_m", stripe_price_id_yearly="usd_y",
        stripe_price_id_monthly_mxn="mxn_m", stripe_price_id_yearly_mxn="mxn_y",
        checkout_adaptive_pricing=True, stripe_checkout_api_version="2026-08-26.dahlia",
    )
    base.update(kw)
    return SimpleNamespace(**base)


USER = {"id": "u1", "email": "a@b.c"}


async def _call(settings_obj, plan="monthly", run_query_result=None, stripe_side_effect=None):
    with patch("app.api.routes.billing.get_supabase", return_value=MagicMock()), \
         patch("app.api.routes.billing.run_query", new_callable=AsyncMock) as rq, \
         patch("app.api.routes.billing.settings", settings_obj), \
         patch("app.api.routes.billing._stripe", return_value=MagicMock()), \
         patch("app.api.routes.billing._stripe_call", new_callable=AsyncMock) as sc:
        rq.return_value = run_query_result or SimpleNamespace(data={"stripe_customer_id": "cus_1"})
        if stripe_side_effect:
            sc.side_effect = stripe_side_effect
        else:
            sc.return_value = SimpleNamespace(client_secret="cs_secret", id="cs_1")
        try:
            out = await billing.create_adaptive_checkout(billing.CheckoutRequest(plan=plan), user=USER)
        finally:
            call = sc.call_args
        return out, call


@pytest.mark.asyncio
async def test_off_by_default_returns_404_so_the_client_falls_back():
    with pytest.raises(HTTPException) as e:
        await _call(cfg(checkout_adaptive_pricing=False))
    assert e.value.status_code == 404


@pytest.mark.asyncio
async def test_404_when_mxn_prices_are_not_configured():
    with pytest.raises(HTTPException) as e:
        await _call(cfg(stripe_price_id_yearly_mxn=""))
    assert e.value.status_code == 404


@pytest.mark.asyncio
async def test_session_is_created_with_adaptive_pricing_on_the_mxn_price():
    out, call = await _call(cfg())
    assert out == {"client_secret": "cs_secret", "session_id": "cs_1"}
    kw = call.kwargs
    assert kw["ui_mode"] == "elements" and kw["mode"] == "subscription"
    assert kw["adaptive_pricing"] == {"enabled": True}
    assert kw["line_items"] == [{"price": "mxn_m", "quantity": 1}]      # MXN base, never the USD price
    assert kw["client_reference_id"] == "u1" and kw["customer"] == "cus_1"   # what the webhook grants Premium by
    assert kw["stripe_version"] == "2026-08-26.dahlia"
    assert kw["return_url"] == "https://nuvosai.com/premium-success?session_id={CHECKOUT_SESSION_ID}"


@pytest.mark.asyncio
async def test_yearly_plan_uses_the_yearly_mxn_price():
    _, call = await _call(cfg(), plan="yearly")
    assert call.kwargs["line_items"][0]["price"] == "mxn_y"


@pytest.mark.asyncio
async def test_stripe_failure_is_a_503_not_a_crash():
    with pytest.raises(HTTPException) as e:
        await _call(cfg(), stripe_side_effect=Exception("boom"))
    assert e.value.status_code == 503


@pytest.mark.asyncio
async def test_creates_and_persists_a_customer_when_the_profile_has_none():
    with patch("app.api.routes.billing.get_supabase", return_value=MagicMock()), \
         patch("app.api.routes.billing.run_query", new_callable=AsyncMock) as rq, \
         patch("app.api.routes.billing.settings", cfg()), \
         patch("app.api.routes.billing._stripe", return_value=MagicMock()), \
         patch("app.api.routes.billing._stripe_call", new_callable=AsyncMock) as sc:
        rq.side_effect = [SimpleNamespace(data={"stripe_customer_id": None}), SimpleNamespace(data=None)]
        sc.side_effect = [SimpleNamespace(id="cus_new"), SimpleNamespace(client_secret="cs", id="cs_9")]
        out = await billing.create_adaptive_checkout(billing.CheckoutRequest(plan="monthly"), user=USER)
    assert out["client_secret"] == "cs"
    assert sc.call_args.kwargs["customer"] == "cus_new"


@pytest.mark.asyncio
async def test_pricing_endpoint_reports_adaptive_for_everyone_when_enabled():
    prices = {"mxn_m": 25900, "mxn_y": 249900}

    async def fake_stripe_call(fn, price_id):
        return {"unit_amount": prices[price_id]}

    with patch("app.api.routes.billing.get_supabase", return_value=MagicMock()), \
         patch("app.api.routes.billing.run_query", new_callable=AsyncMock) as rq, \
         patch("app.api.routes.billing.settings", cfg(stripe_price_family_monthly_mxn="", stripe_price_family_yearly_mxn="")), \
         patch("app.api.routes.billing._stripe", return_value=MagicMock()), \
         patch("app.api.routes.billing._stripe_call", side_effect=fake_stripe_call), \
         patch("app.core.cache.cache_get", return_value=None), patch("app.core.cache.cache_set"):
        # a US profile: in adaptive mode the MXN base price is shown to everyone
        rq.return_value = SimpleNamespace(data={"country": "US", "phone_number": None})
        out = await billing.get_pricing(user_id="u1")
    assert out == {"currency": "mxn", "adaptive": True, "monthly": 259.0, "yearly": 2499.0}


@pytest.mark.asyncio
async def test_pricing_endpoint_falls_back_to_usd_when_mxn_prices_not_configured():
    with patch("app.api.routes.billing.get_supabase", return_value=MagicMock()), \
         patch("app.api.routes.billing.settings", cfg(checkout_adaptive_pricing=False, stripe_price_id_monthly_mxn="", stripe_price_id_yearly_mxn="")):
        assert await billing.get_pricing(user_id="u1") == {"currency": "usd"}
