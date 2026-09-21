"""Adaptive Pricing for Duo and 1:1 sessions (upsells.py) — Checkout Sessions
(ui_mode="elements") anchored on the MXN prices, carrying the metadata and
client_reference_id the existing fulfilment (webhook / verify-1on1-payment)
already keys on."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.routes import upsells
from app.services import adaptive_pricing as ap


def cfg(**kw):
    base = dict(
        stripe_secret_key="sk_test", frontend_url="https://nuvosai.com", checkout_adaptive_pricing=True,
        stripe_checkout_api_version="2026-08-26.dahlia",
        stripe_price_id_monthly_mxn="mxn_m", stripe_price_id_yearly_mxn="mxn_y",
        stripe_price_family_monthly_mxn="mxn_dm", stripe_price_family_yearly_mxn="mxn_dy",
        stripe_price_session_free_mxn="mxn_sf", stripe_price_session_premium_mxn="mxn_sp", stripe_price_session_bundle_mxn="mxn_sb",
    )
    base.update(kw)
    return SimpleNamespace(**base)


def test_availability_needs_the_flag_and_the_specific_mxn_price():
    assert ap.available("family_plan", "monthly", cfg())
    assert not ap.available("family_plan", "monthly", cfg(checkout_adaptive_pricing=False))
    assert not ap.available("family_plan", "monthly", cfg(stripe_price_family_monthly_mxn=""))
    assert not ap.available("deep_research", "free", cfg())         # no MXN price exists for it


async def _call(body, settings_obj=None, tier="free", stripe_side_effect=None):
    settings_obj = settings_obj or cfg()
    with patch("app.api.routes.upsells.get_supabase", return_value=MagicMock()), \
         patch("app.api.routes.upsells.run_query", new_callable=AsyncMock) as rq, \
         patch("app.api.routes.upsells.settings", settings_obj), \
         patch("app.api.routes.upsells._stripe_call", new_callable=AsyncMock) as sc, \
         patch("app.api.routes.upsells._track", new_callable=AsyncMock):
        rq.return_value = SimpleNamespace(data={"stripe_customer_id": "cus_1", "subscription_tier": tier,
                                                "trial_started_at": None, "streak_bonus_premium_until": None})
        if stripe_side_effect:
            sc.side_effect = stripe_side_effect
        else:
            sc.return_value = SimpleNamespace(client_secret="cs_secret", id="cs_1")
        try:
            out = await upsells.upsell_checkout_adaptive(body, user_id="u1")
        finally:
            call = sc.call_args
        return out, call


@pytest.mark.asyncio
async def test_duo_is_a_subscription_session_with_metadata_on_both_objects():
    out, call = await _call({"offer": "family_plan", "variant": "yearly", "trigger_source": "x"})
    kw = call.kwargs
    assert out == {"client_secret": "cs_secret", "session_id": "cs_1"}
    assert kw["mode"] == "subscription" and kw["ui_mode"] == "elements"
    assert kw["line_items"] == [{"price": "mxn_dy", "quantity": 1}]
    assert kw["adaptive_pricing"] == {"enabled": True}
    assert kw["client_reference_id"] == "u1"
    assert kw["metadata"]["offer"] == "family_plan" and kw["metadata"]["variant"] == "yearly"
    assert kw["subscription_data"] == {"metadata": kw["metadata"]}
    assert kw["return_url"] == "https://nuvosai.com/upsell-success?offer=family_plan&session_id={CHECKOUT_SESSION_ID}"


@pytest.mark.asyncio
@pytest.mark.parametrize("tier,variant,price", [
    ("free", "default", "mxn_sf"), ("premium", "default", "mxn_sp"), ("premium", "bundle", "mxn_sb"),
])
async def test_sessions_are_one_time_payment_sessions_with_the_right_mxn_price(tier, variant, price):
    _, call = await _call({"offer": "session", "variant": variant}, tier=tier)
    kw = call.kwargs
    assert kw["mode"] == "payment"
    assert kw["line_items"][0]["price"] == price
    assert kw["payment_intent_data"] == {"metadata": kw["metadata"]}     # verify-1on1-payment's PI path
    assert kw["metadata"]["offer"] == "session" and kw["metadata"]["user_id"] == "u1"
    assert kw["client_reference_id"] == "u1"                              # verify-1on1-payment's session path
    assert "subscription_data" not in kw


@pytest.mark.asyncio
@pytest.mark.parametrize("body,settings_obj", [
    ({"offer": "deep_research", "variant": "free"}, None),                      # unsupported offer
    ({"offer": "family_plan", "variant": "monthly"}, cfg(checkout_adaptive_pricing=False)),
    ({"offer": "family_plan", "variant": "monthly"}, cfg(stripe_price_family_monthly_mxn="")),
    ({"offer": "session", "variant": "bundle"}, cfg(stripe_price_session_bundle_mxn="")),
])
async def test_unavailable_products_404_so_the_client_falls_back(body, settings_obj):
    with pytest.raises(HTTPException) as e:
        await _call(body, settings_obj)
    assert e.value.status_code == 404


@pytest.mark.asyncio
async def test_stripe_failure_is_a_503():
    with pytest.raises(HTTPException) as e:
        await _call({"offer": "family_plan", "variant": "monthly"}, stripe_side_effect=Exception("boom"))
    assert e.value.status_code == 503


@pytest.mark.asyncio
async def test_check_returns_mxn_amounts_only_when_every_variant_has_an_mxn_price():
    amounts = {"mxn_dm": 41900, "mxn_dy": 389900, "mxn_sf": 239900, "mxn_sp": 169900, "mxn_sb": 424900}

    async def fake_call(fn, price_id):
        return {"unit_amount": amounts[price_id]}

    with patch("app.api.routes.upsells.settings", cfg()), \
         patch("app.api.routes.upsells._stripe_call", side_effect=fake_call), \
         patch("app.core.cache.cache_get", return_value=None), patch("app.core.cache.cache_set"):
        assert await upsells._adaptive_prices_for("family_plan") == {"monthly": 419.0, "yearly": 3899.0}
        assert await upsells._adaptive_prices_for("session") == {"free": 2399.0, "premium": 1699.0, "bundle": 4249.0}
        assert await upsells._adaptive_prices_for("deep_research") is None
    with patch("app.api.routes.upsells.settings", cfg(stripe_price_session_bundle_mxn="")):
        assert await upsells._adaptive_prices_for("session") is None       # partial config -> stay on USD
    with patch("app.api.routes.upsells.settings", cfg(checkout_adaptive_pricing=False)):
        assert await upsells._adaptive_prices_for("family_plan") is None
