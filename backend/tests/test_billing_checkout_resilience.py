"""
2026-09-17: "el paywall SIEMPRE tiene que abrirse" — a live screenshot
showed Nuvos AI Premium's embedded checkout failing with the generic "No
se pudo abrir el pago." Root cause: every checkout-adjacent endpoint in
billing.py read the user's stripe_customer_id with an UNGUARDED
`.single()` Supabase call — a real Postgrest error (or `.single()` itself
raising on a missing/duplicate profile row, the exact class of stale-
connection bug fixed elsewhere in this codebase) escaped as a raw,
uncaught 500. Same bug class Diego already found and fixed in upsells.py's
checkout endpoints on 2026-09-16 — missed here, on the endpoint behind the
MAIN Premium paywall.

These tests assert the fix: a failed profile lookup must never block the
checkout flow that actually charges money — it degrades to "no linked
Stripe customer yet" and proceeds, same as a genuinely new customer.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.routes.billing import (
    create_checkout,
    create_embedded_subscription,
    create_embedded_broker_call,
    create_portal_session,
    _get_customer_id_or_404,
    CheckoutRequest,
)


def _mock_settings(**overrides):
    base = dict(
        stripe_secret_key="sk_test_fake",
        stripe_price_id_monthly="price_monthly",
        stripe_price_id_yearly="price_yearly",
        stripe_price_broker_call="price_broker",
        frontend_url="https://nuvosai.com",
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class TestCreateEmbeddedSubscriptionSurvivesProfileLookupFailure:
    """The endpoint behind the screenshot in the bug report."""

    @pytest.mark.asyncio
    async def test_broken_profile_lookup_still_returns_a_client_secret(self):
        mock_db = MagicMock()
        fake_customer = SimpleNamespace(id="cus_new123")
        fake_payment_intent = SimpleNamespace(client_secret="pi_secret_abc")
        fake_invoice = SimpleNamespace(payment_intent=fake_payment_intent)
        fake_subscription = SimpleNamespace(id="sub_123", latest_invoice=fake_invoice)

        async def fake_stripe_call(fn, *args, **kwargs):
            if fn is fake_stripe_call.customer_create:
                return fake_customer
            return fake_subscription

        with patch("app.api.routes.billing.get_supabase", return_value=mock_db), \
             patch("app.api.routes.billing.run_query", new_callable=AsyncMock) as mock_run_query, \
             patch("app.api.routes.billing.settings", _mock_settings()), \
             patch("app.api.routes.billing._stripe_call", new_callable=AsyncMock) as mock_stripe_call, \
             patch("app.api.routes.billing.stripe") as mock_stripe_module:
            # First call (the profile lookup) raises — as a real Postgrest
            # error or `.single()` on a missing row would. The subsequent
            # write (persisting the new customer_id) should still be
            # attempted and succeed.
            mock_run_query.side_effect = [Exception("stale connection / 0 rows"), SimpleNamespace(data=None)]
            mock_stripe_module.Customer.create = "customer_create_sentinel"
            mock_stripe_module.Subscription.create = "subscription_create_sentinel"
            mock_stripe_call.side_effect = [fake_customer, fake_subscription]

            result = await create_embedded_subscription(
                CheckoutRequest(plan="monthly"),
                user={"id": "user1", "email": "user1@example.com"},
            )

        assert result == {"client_secret": "pi_secret_abc", "subscription_id": "sub_123"}
        # proceeded to create a fresh Stripe customer, exactly like a
        # genuinely new customer would — never blocked the payment.
        assert mock_stripe_call.call_count == 2

    @pytest.mark.asyncio
    async def test_broken_customer_id_persistence_write_does_not_block_checkout(self):
        """The write-back of the newly created stripe_customer_id is
        best-effort — a failure there must not prevent the payment form
        from opening, since a real Stripe customer already exists at that
        point."""
        mock_db = MagicMock()
        fake_customer = SimpleNamespace(id="cus_new123")
        fake_payment_intent = SimpleNamespace(client_secret="pi_secret_xyz")
        fake_invoice = SimpleNamespace(payment_intent=fake_payment_intent)
        fake_subscription = SimpleNamespace(id="sub_456", latest_invoice=fake_invoice)

        with patch("app.api.routes.billing.get_supabase", return_value=mock_db), \
             patch("app.api.routes.billing.run_query", new_callable=AsyncMock) as mock_run_query, \
             patch("app.api.routes.billing.settings", _mock_settings()), \
             patch("app.api.routes.billing._stripe_call", new_callable=AsyncMock) as mock_stripe_call:
            # Profile lookup succeeds with no customer_id (genuinely new
            # user); the FOLLOW-UP write to persist the new customer_id fails.
            mock_run_query.side_effect = [SimpleNamespace(data={"stripe_customer_id": None}), Exception("write failed")]
            mock_stripe_call.side_effect = [fake_customer, fake_subscription]

            result = await create_embedded_subscription(
                CheckoutRequest(plan="monthly"),
                user={"id": "user1", "email": "user1@example.com"},
            )

        assert result == {"client_secret": "pi_secret_xyz", "subscription_id": "sub_456"}


class TestCreateCheckoutSurvivesProfileLookupFailure:
    @pytest.mark.asyncio
    async def test_broken_profile_lookup_still_returns_a_checkout_url(self):
        mock_db = MagicMock()
        fake_session = SimpleNamespace(url="https://checkout.stripe.com/session123")

        with patch("app.api.routes.billing.get_supabase", return_value=mock_db), \
             patch("app.api.routes.billing.run_query", new_callable=AsyncMock) as mock_run_query, \
             patch("app.api.routes.billing.settings", _mock_settings()), \
             patch("app.api.routes.billing._stripe_call", new_callable=AsyncMock, return_value=fake_session):
            mock_run_query.side_effect = Exception("stale connection / 0 rows")

            result = await create_checkout(CheckoutRequest(plan="yearly"), user_id="user1")

        assert result == {"url": "https://checkout.stripe.com/session123"}


class TestCreateEmbeddedBrokerCallSurvivesProfileLookupFailure:
    @pytest.mark.asyncio
    async def test_broken_profile_lookup_still_returns_a_client_secret(self):
        mock_db = MagicMock()
        fake_customer = SimpleNamespace(id="cus_new999")
        fake_price = SimpleNamespace(unit_amount=2000, currency="usd")
        fake_intent = SimpleNamespace(client_secret="pi_broker_secret")

        with patch("app.api.routes.billing.get_supabase", return_value=mock_db), \
             patch("app.api.routes.billing.run_query", new_callable=AsyncMock) as mock_run_query, \
             patch("app.api.routes.billing.settings", _mock_settings()), \
             patch("app.api.routes.billing._stripe_call", new_callable=AsyncMock) as mock_stripe_call:
            mock_run_query.side_effect = [Exception("stale connection / 0 rows"), SimpleNamespace(data=None)]
            mock_stripe_call.side_effect = [fake_customer, fake_price, fake_intent]

            result = await create_embedded_broker_call(user_id="user1")

        assert result == {"client_secret": "pi_broker_secret"}


class TestPortalAndSubscriptionLookupFailClean:
    """These aren't the purchase flow itself, but must still fail with a
    clear, logged 503 instead of an uncaught crash."""

    @pytest.mark.asyncio
    async def test_create_portal_session_raises_clean_503_on_broken_lookup(self):
        from fastapi import HTTPException
        mock_db = MagicMock()
        with patch("app.api.routes.billing.get_supabase", return_value=mock_db), \
             patch("app.api.routes.billing.run_query", new_callable=AsyncMock, side_effect=Exception("stale connection")), \
             patch("app.api.routes.billing.settings", _mock_settings()):
            with pytest.raises(HTTPException) as exc_info:
                await create_portal_session(user_id="user1")
        assert exc_info.value.status_code == 503

    @pytest.mark.asyncio
    async def test_get_customer_id_or_404_raises_clean_503_on_broken_lookup(self):
        from fastapi import HTTPException
        mock_db = MagicMock()
        with patch("app.api.routes.billing.run_query", new_callable=AsyncMock, side_effect=Exception("stale connection")):
            with pytest.raises(HTTPException) as exc_info:
                await _get_customer_id_or_404("user1", mock_db)
        assert exc_info.value.status_code == 503


class TestGetStatusUsesFreshClientForMsgCount:
    """2026-09-17: Diego reported that after hitting the Free 15/24h chat
    limit, a page refresh (or opening a new chat, which re-reads the same
    subscription-status endpoint) showed "1 message left" instead of 0 —
    letting the client-side send gate re-open even though the server's
    atomic RPC (chat.py's increment_msg_count_if_allowed) had already
    correctly recorded msg_count=15. Root cause: GET /billing/status read
    through the process-wide Supabase singleton, which can stay pinned to
    a lagging connection for a few minutes after a write (see
    get_supabase's own docstring) — msg_count changes on every single chat
    message, far more often than any other field this endpoint reads, so
    it's the field most likely to be read moments after a write. Fixed by
    reading through get_fresh_supabase() instead, bypassing that risk
    entirely for this per-page-load endpoint."""

    @pytest.mark.asyncio
    async def test_get_status_reads_through_a_fresh_client_not_the_singleton(self):
        from app.api.routes.billing import get_status

        mock_db = MagicMock()
        profile_row = {
            "subscription_tier": "free", "msg_count": 15, "msg_window_start": "2026-09-17T12:00:00+00:00",
            "trial_started_at": "2026-08-01T00:00:00+00:00", "stripe_customer_id": None,
            "broker_offer_seen_at": None, "duo_plan_purchased_at": None, "duo_secondary_email": None,
            "duo_invite_status": None, "streak_bonus_premium_until": None, "claimed_streak_milestones": [],
            "has_seen_welcome_card": True, "premium_until": None, "subscription_source": None,
        }

        with patch("app.api.routes.billing.get_fresh_supabase", return_value=mock_db) as mock_fresh, \
             patch("app.api.routes.billing.get_supabase") as mock_singleton, \
             patch("app.api.routes.billing.run_query", new_callable=AsyncMock, return_value=SimpleNamespace(data=profile_row)):
            result = await get_status(user_id="user1")

        mock_fresh.assert_called_once()
        mock_singleton.assert_not_called()
        assert result["msg_count"] == 15


class TestStripeWebhookSecretHandling:
    """A webhook secret pasted into Railway with stray whitespace or quotes must
    still verify, and a bad signature must leave a diagnosable log line."""

    @staticmethod
    def _signed(secret, body):
        import hashlib, hmac, time
        ts = int(time.time())
        return f"t={ts},v1=" + hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()

    @staticmethod
    async def _post(secret_setting, header_secret, caplog=None):
        import json
        from unittest.mock import MagicMock, patch
        from fastapi.testclient import TestClient
        import main
        from app.core.config import settings
        body = json.dumps({"id": "evt_1", "object": "event", "type": "customer.created", "data": {"object": {"id": "cus_1"}}}).encode()
        with patch.object(settings, "stripe_webhook_secret", secret_setting), \
             patch("app.api.routes.billing.get_supabase", return_value=MagicMock()):
            return TestClient(main.app).post(
                "/api/billing/webhook", content=body,
                headers={"stripe-signature": TestStripeWebhookSecretHandling._signed(header_secret, body)},
            )

    @pytest.mark.asyncio
    @pytest.mark.parametrize("stored", ["whsec_abc", "whsec_abc ", " whsec_abc\n", '"whsec_abc"', "'whsec_abc'"])
    async def test_stray_whitespace_or_quotes_still_verify(self, stored):
        assert (await self._post(stored, "whsec_abc")).status_code == 200

    @pytest.mark.asyncio
    async def test_wrong_secret_is_rejected_and_logged_without_leaking_it(self, caplog):
        import logging
        with caplog.at_level(logging.ERROR):
            r = await self._post("whsec_stored", "whsec_other")
        assert r.status_code == 400
        line = next(m.getMessage() for m in caplog.records if "signature FAILED" in m.getMessage())
        assert "secret_len=12" in line and "starts_with_whsec=True" in line
        assert "whsec_stored" not in line and "whsec_other" not in line


class TestBrokerCallCurrency:
    async def _run(self, body, **settings_kw):
        mock_db = MagicMock()
        fake_price = SimpleNamespace(unit_amount=34900, currency="mxn")
        fake_intent = SimpleNamespace(client_secret="pi_secret")
        with patch("app.api.routes.billing.get_supabase", return_value=mock_db), \
             patch("app.api.routes.billing.run_query", new_callable=AsyncMock,
                   return_value=SimpleNamespace(data={"stripe_customer_id": "cus_1", "country": "US", "phone_number": None})), \
             patch("app.api.routes.billing.settings", _mock_settings(**settings_kw)), \
             patch("app.api.routes.billing._stripe_call", new_callable=AsyncMock) as sc:
            sc.side_effect = [fake_price, fake_intent]
            out = await create_embedded_broker_call(body=body, user_id="user1")
        assert out == {"client_secret": "pi_secret"}
        return sc.call_args_list[0].args[1]  # the price id that was retrieved

    @pytest.mark.asyncio
    async def test_uses_mxn_price_when_client_shows_mxn_and_it_is_configured(self):
        assert await self._run({"currency": "mxn"}, stripe_price_broker_call_mxn="price_broker_mxn") == "price_broker_mxn"

    @pytest.mark.asyncio
    async def test_falls_back_to_usd_when_mxn_price_not_configured(self):
        assert await self._run({"currency": "mxn"}) == "price_broker"

    @pytest.mark.asyncio
    async def test_usd_when_client_did_not_ask_for_mxn(self):
        assert await self._run(None, stripe_price_broker_call_mxn="price_broker_mxn") == "price_broker"
