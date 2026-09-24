from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import trial_reset


@pytest.mark.asyncio
async def test_resets_only_non_paying_users_not_already_reset():
    profiles = [
        {"user_id": "free1", "subscription_tier": "free"},
        {"user_id": "none1", "subscription_tier": None},
        {"user_id": "paid1", "subscription_tier": "premium"},
        {"user_id": "pro1", "subscription_tier": "pro"},
        {"user_id": "done1", "subscription_tier": "free"},
    ]
    fetch = AsyncMock(side_effect=[profiles, [{"id": "x", "user_id": "done1"}]])
    db = MagicMock()
    with patch.object(trial_reset, "_fetch_all", fetch), \
         patch("app.core.database.get_supabase", return_value=db), \
         patch("app.core.database.run_query", new_callable=AsyncMock) as rq, \
         patch("app.core.cache.cache_delete"):
        await trial_reset.reset_trials_for_launch()
    # claim insert + trial update, both for exactly the two eligible users
    inserted = db.table.return_value.insert.call_args.args[0]
    assert sorted(r["user_id"] for r in inserted) == ["free1", "none1"]
    assert db.table.return_value.update.call_args.args[0].keys() == {"trial_started_at"}
    assert sorted(db.table.return_value.update.return_value.in_.call_args.args[1]) == ["free1", "none1"]
    assert rq.await_count == 2
