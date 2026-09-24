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
