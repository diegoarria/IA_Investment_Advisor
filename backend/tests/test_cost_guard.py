"""Cost Guard (app/services/cost_guard.py) — thresholds derive from the price,
levels classify correctly, it fails open, and a blocked Premium user gets a
normal 200 reply (never a 429, which the web client maps to the paywall)."""
import pytest

from app.core.config import settings
from app.services import cost_guard as cg
from app.services.cost_guard import GuardLevel


def test_thresholds_are_fractions_of_price():
    t = cg.thresholds_usd()
    p = settings.premium_price_usd
    assert t["warning"] == pytest.approx(p * settings.guard_warning_pct, abs=1e-3)
    assert t["high_usage"] == pytest.approx(p * 0.40, abs=1e-3)   # == the 40%-of-revenue COGS ceiling
    assert t["warning"] < t["high_usage"] < t["cost_protection"] < t["hard_stop"] < p


@pytest.mark.parametrize("month,day,expected", [
    (0.0, 0.0, GuardLevel.NORMAL),
    (2.99, 0.5, GuardLevel.NORMAL),
    (3.01, 0.5, GuardLevel.WARNING),
    (6.01, 0.5, GuardLevel.HIGH_USAGE),
    (9.01, 0.5, GuardLevel.COST_PROTECTION),
    (13.6, 0.5, GuardLevel.HARD_STOP),
    (1.0, 3.01, GuardLevel.HARD_STOP),      # daily cap trips even with a tiny month total
])
def test_classify(month, day, expected):
    assert cg.classify(month, day) == expected


async def test_evaluate_fails_open(monkeypatch):
    async def boom(_uid):
        raise RuntimeError("db down")
    monkeypatch.setattr(cg, "spend_for", boom)
    d = await cg.evaluate("u1")
    assert d.level == GuardLevel.NORMAL and not d.block and not d.degrade_model


async def test_evaluate_levels_drive_flags(monkeypatch):
    async def spend(_uid):
        return 9.5, 0.5
    monkeypatch.setattr(cg, "spend_for", spend)
    d = await cg.evaluate("u1")
    assert d.level == GuardLevel.COST_PROTECTION and d.degrade_model and not d.block

    async def spend2(_uid):
        return 1.0, 3.5
    monkeypatch.setattr(cg, "spend_for", spend2)
    d = await cg.evaluate("u1")
    assert d.block and d.reason == "daily_cap"


async def test_disabled_guard_never_blocks(monkeypatch):
    monkeypatch.setattr(settings, "guard_enabled", False)
    d = await cg.evaluate("u1")
    assert d.level == GuardLevel.NORMAL and not d.block


def test_record_spend_only_bumps_seeded_counters():
    from app.core.cache import cache_get, cache_set
    month, day = cg._period_keys()
    uid = "guard-test-user"
    cache_set(cg.month_key(uid, month), 1.0, ttl=60)
    cache_set(cg.day_key(uid, day), 0.5, ttl=60)
    cg.record_spend(uid, 0.25)
    assert cache_get(cg.month_key(uid, month)) == pytest.approx(1.25)
    assert cache_get(cg.day_key(uid, day)) == pytest.approx(0.75)
    cg.record_spend("never-seeded", 9.0)
    assert cache_get(cg.month_key("never-seeded", month)) is None


async def test_chat_guard_returns_reply_not_429(monkeypatch):
    from app.api.routes import chat
    from app.services.cost_guard import GuardDecision

    async def blocked(_uid):
        return GuardDecision(GuardLevel.HARD_STOP, 14.0, 1.0, False, True, "hard_stop")
    monkeypatch.setattr(cg, "evaluate", blocked)
    reply, model = await chat._cost_guard_check("u1", None, True)
    assert reply and model is None
    # free users are never touched by the premium guard
    assert await chat._cost_guard_check("u1", None, False) == (None, None)

    async def protect(_uid):
        return GuardDecision(GuardLevel.COST_PROTECTION, 10.0, 1.0, True, False, "cost_protection")
    monkeypatch.setattr(cg, "evaluate", protect)
    reply, model = await chat._cost_guard_check("u1", None, True)
    assert reply is None and model == settings.cost_protection_model
