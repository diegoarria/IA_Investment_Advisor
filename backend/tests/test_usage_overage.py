"""Uso extra (Diego, 2026-09-29): $9 of LLM cost included in Premium, then
$4.99/$89 MXN blocks per $2.50 of extra cost (cap 4) for opted-in users, or
the cheaper model until the month resets. Arthur never gets blocked."""
import asyncio

import pytest

from app.services import usage_overage as uo


def run(c):
    return asyncio.run(c)


def test_included_is_nine_dollars():
    assert uo.included_usd() == pytest.approx(8.99, abs=0.01)


@pytest.mark.parametrize("cost,cap,expected", [
    (0, 4, 0), (8.0, 4, 0), (8.995, 4, 1), (11.49, 4, 1), (11.50, 4, 2), (30, 4, 4), (30, 10, 9),
])
def test_blocks_for(cost, cap, expected):
    assert uo.blocks_for(cost, cap) == expected


def _patch(monkeypatch, cost, row, fields=None):
    async def spend_for(uid):
        return cost, 0.0
    async def get_row(uid, period=None):
        return row
    async def billing_fields(uid):
        return fields or {"subscription_tier": "premium", "subscription_source": "stripe", "stripe_customer_id": "cus_1"}
    from app.services import cost_guard
    monkeypatch.setattr(cost_guard, "spend_for", spend_for)
    monkeypatch.setattr(uo, "get_row", get_row)
    monkeypatch.setattr(uo, "billing_fields", billing_fields)


def test_under_included_is_included_mode(monkeypatch):
    _patch(monkeypatch, 3.0, None)
    s = run(uo.summary("u"))
    assert s.mode == "included" and s.pct_used == 33 and s.blocks_used == 0


def test_past_included_without_choice_is_economy(monkeypatch):
    _patch(monkeypatch, 10.0, None)
    s = run(uo.summary("u"))
    assert s.mode == "economy" and s.reached_included and not s.decided and s.can_opt_in


def test_opted_in_is_overage_with_blocks(monkeypatch):
    _patch(monkeypatch, 12.0, {"opted_in": True, "cap_blocks": 4})
    s = run(uo.summary("u"))
    assert s.mode == "overage" and s.blocks_used == 2 and s.extra_charge == 2 * 499


def test_opted_in_past_cap_falls_back_to_economy(monkeypatch):
    _patch(monkeypatch, 40.0, {"opted_in": True, "cap_blocks": 4})
    s = run(uo.summary("u"))
    assert s.mode == "economy" and s.blocks_used == 4


def test_mxn_price(monkeypatch):
    _patch(monkeypatch, 12.0, {"opted_in": True, "cap_blocks": 4},
           {"subscription_tier": "premium", "subscription_source": "stripe", "stripe_customer_id": "c", "currency": "MXN"})
    s = run(uo.summary("u"))
    assert s.currency == "mxn" and s.extra_charge == 2 * 8900


def test_comp_or_trial_cannot_opt_in(monkeypatch):
    fields = {"subscription_tier": "premium", "subscription_source": "manual_comp", "stripe_customer_id": "c"}
    _patch(monkeypatch, 10.0, None, fields)
    assert run(uo.summary("u")).can_opt_in is False
    with pytest.raises(ValueError):
        run(uo.set_choice("u", None, True))


def test_cost_guard_check_never_blocks(monkeypatch):
    from app.api.routes import chat
    from app.services import cost_guard

    async def evaluate(uid):
        return cost_guard.GuardDecision(cost_guard.GuardLevel.HARD_STOP, 50, 5, False, True, "hard_stop")

    async def economy(uid, profile):
        return True

    monkeypatch.setattr(cost_guard, "evaluate", evaluate)
    monkeypatch.setattr(uo, "use_economy_model", economy)
    blocked, model = run(chat._cost_guard_check("u", None, True))
    assert blocked is None and model  # answers, on the cheaper model
