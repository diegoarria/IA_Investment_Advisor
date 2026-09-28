"""
Diego, 2026-09-27: "Avísame cuando abra" on the Monthly Report's closed
screen — opted-in users get a push AND an email on the 1st, once per
month, and the automatic recap email doesn't send them a second copy.
"""
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import worker
from app.api.routes.monthly_report import next_monthly_report_open_date


def test_next_open_date():
    assert next_monthly_report_open_date(date(2026, 9, 27)) == date(2026, 10, 1)
    assert next_monthly_report_open_date(date(2026, 12, 4)) == date(2027, 1, 1)
    assert next_monthly_report_open_date(date(2026, 10, 2)) == date(2026, 10, 2)


class _Db:
    def __init__(self, optins, profiles):
        self.optins, self.profiles, self.updates = optins, profiles, []

    def table(self, name):
        q = MagicMock()
        for m in ("select", "eq", "in_"):
            getattr(q, m).return_value = q
        q._result = SimpleNamespace(data=self.optins if name == "feature_notify_optins" else self.profiles)
        def update(row):
            self.updates.append(row)
            u = MagicMock(); u.eq.return_value = u; u._result = SimpleNamespace(data=[]); return u
        q.update.side_effect = update
        return q


async def _rq(q):
    return q._result


@pytest.mark.asyncio
async def test_notifies_pending_optins_by_push_and_email_once_per_month():
    now = datetime.now(timezone.utc)
    optins = [
        {"user_id": "u_new", "notified_at": None},
        {"user_id": "u_done", "notified_at": now.isoformat()},  # already told this month
    ]
    profiles = [{"user_id": "u_new", "name": "Ana Pérez", "subscription_tier": "free", "preferred_language": "es"}]
    db = _Db(optins, profiles)
    push, email = AsyncMock(), AsyncMock()
    with patch("app.core.database.get_supabase", return_value=db), \
         patch("app.core.database.run_query", new=_rq), \
         patch("app.services.notification_engine.send_push", new=push), \
         patch("app.services.notification_engine.send_email_notification", new=email), \
         patch.object(worker.asyncio, "sleep", new=AsyncMock()):
        await worker.job_monthly_report_notify_available()

    assert [c.args[0] for c in push.await_args_list] == ["u_new"]
    assert push.await_args.args[4] == {"screen": "monthly-report"}
    assert [c.args[0] for c in email.await_args_list] == ["u_new"]
    assert "Ana" in email.await_args.args[3]
    assert len(db.updates) == 1 and db.updates[0]["notified_at"]
