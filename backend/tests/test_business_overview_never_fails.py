import pytest
from unittest.mock import AsyncMock, patch

from app.services import business_overview_service as svc


@pytest.mark.asyncio
async def test_returns_a_well_shaped_payload_even_if_everything_explodes():
    svc._LAST_GOOD = None
    with patch.object(svc, "_compute_business_overview", new_callable=AsyncMock, side_effect=RuntimeError("boom")):
        out = await svc.get_business_overview(force_refresh=True)
    assert out["degraded"] is True
    for key in ("users", "stripe", "posthog", "costs"):
        assert isinstance(out[key], dict)
    assert out["costs"]["fixed_costs"]["items"] == []


@pytest.mark.asyncio
async def test_serves_the_last_good_result_marked_stale():
    good = {"generated_at": "x", "users": {"total_users": 21}, "stripe": {}, "posthog": {}, "costs": {}}
    with patch.object(svc, "_compute_business_overview", new_callable=AsyncMock, return_value=good):
        await svc.get_business_overview(force_refresh=True)
    with patch.object(svc, "_compute_business_overview", new_callable=AsyncMock, side_effect=RuntimeError("boom")):
        out = await svc.get_business_overview(force_refresh=True)
    assert out["stale"] is True and out["users"]["total_users"] == 21


@pytest.mark.asyncio
async def test_wrong_shaped_sections_and_cache_failures_never_raise():
    async def none_section(): return None
    async def ok_users(): return {"total_users": 5}
    with patch.object(svc, "_get_user_metrics", ok_users), patch.object(svc, "_get_stripe_metrics", none_section), \
         patch.object(svc, "_get_posthog_metrics", none_section), patch.object(svc, "_get_stripe_fees_30d", none_section), \
         patch.object(svc, "_get_llm_cost_30d", none_section), patch.object(svc, "_get_fixed_costs", none_section), \
         patch.object(svc, "cache_get", side_effect=RuntimeError("redis down")), \
         patch.object(svc, "cache_set", side_effect=TypeError("not serializable")), \
         patch.object(svc, "cache_delete", side_effect=RuntimeError("redis down")):
        out = await svc.get_business_overview(force_refresh=False)
    assert out["users"]["total_users"] == 5
    assert out["costs"]["fixed_costs"]["total_monthly_usd"] == 0.0


@pytest.mark.asyncio
async def test_history_failure_returns_empty_list():
    with patch.object(svc, "get_supabase", side_effect=RuntimeError("no db")):
        assert await svc.get_business_overview_history() == []


@pytest.mark.asyncio
async def test_snapshot_skips_a_degraded_overview():
    with patch.object(svc, "get_business_overview", new_callable=AsyncMock, return_value=svc._degraded_overview("x")), \
         patch.object(svc, "get_supabase") as db:
        await svc.snapshot_business_overview()
    db.assert_not_called()


def test_a_failing_section_serves_the_last_good_one_marked_stale():
    svc._SECTION_LAST_GOOD.clear()
    ok = lambda v: isinstance(v, dict) and v.get("available")
    good = {"available": True, "mrr_usd": 100}
    with patch.object(svc, "cache_set"), patch.object(svc, "cache_get", return_value=None):
        assert svc._remember("stripe", good, ok, {"available": False}) == good
        out = svc._remember("stripe", RuntimeError("stripe down"), ok, {"available": False})
    assert out["mrr_usd"] == 100 and out["_stale"] is True and out["_stale_at"]
    svc._SECTION_LAST_GOOD.clear()
    with patch.object(svc, "cache_get", return_value=None):
        assert svc._remember("stripe", RuntimeError("x"), ok, {"available": False}) == {"available": False}


def test_activity_rows_merge_signups_signins_and_chats_for_today_only():
    from datetime import datetime, timedelta, timezone
    from types import SimpleNamespace
    start = datetime(2026, 9, 25, 6, 0, tzinfo=timezone.utc)
    early, late = start - timedelta(hours=5), start + timedelta(hours=3)
    users = [
        SimpleNamespace(id="a", email="new@x.com", created_at=late, last_sign_in_at=late),
        SimpleNamespace(id="b", email="back@x.com", created_at=early, last_sign_in_at=late + timedelta(hours=1)),
        SimpleNamespace(id="c", email="chat@x.com", created_at=early, last_sign_in_at=early),
        SimpleNamespace(id="d", email="idle@x.com", created_at=early, last_sign_in_at=early),
    ]
    rows = svc.build_activity_rows(users, {"c": 4}, {"c": late + timedelta(hours=2)}, {"a": "Ana"}, start)
    assert [r["email"] for r in rows] == ["chat@x.com", "back@x.com", "new@x.com"]   # newest activity first; idle excluded
    by = {r["email"]: r for r in rows}
    assert by["new@x.com"]["signed_up_today"] and by["new@x.com"]["name"] == "Ana"
    assert by["chat@x.com"]["chat_messages"] == 4 and not by["chat@x.com"]["signed_in_today"]


@pytest.mark.asyncio
async def test_activity_today_never_raises():
    svc._ACTIVITY_LAST_GOOD = None
    with patch.object(svc, "_compute_activity_today", new_callable=AsyncMock, side_effect=RuntimeError("db down")):
        out = await svc.get_activity_today()
    assert out["degraded"] is True and out["users"] == []
