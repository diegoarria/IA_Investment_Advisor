"""
Account deletion (DELETE /api/auth/account) — the exact flow Apple rejected
Nuvos for twice (Guideline 5.1.1(v), build 36 and build 46) for being
impossible to find in the UI. The UI fix is in frontend/mobile (Sidebar +
Profile -> DeleteAccountModal), but nothing in this repo had ever tested
the server side of this before this audit (2026-11-14) — for a flow this
destructive and legally sensitive, that's a real gap on its own.

These tests never touch a real Supabase project (local or production) —
every Supabase client is a MagicMock, same pattern as
test_billing_checkout_resilience.py. What they verify is the ordering and
atomicity contract delete_account's own comments promise:
  1. Plaid revocation is attempted first, but its failure never blocks the
     rest of deletion (users must not be stuck undeletable because Plaid's
     API is down).
  2. The atomic RPC (delete_user_data) runs before the auth user is ever
     deleted — if it fails, the auth user must still exist (never "email
     freed up, but some tables still had orphaned rows").
  3. If the RPC succeeds but deleting the auth user fails, the caller gets
     a real error (never a silent/false "success") — the documented
     safe-to-retry state.
  4. On full success, both steps ran and the response is the real message.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.routes.auth import delete_account, reconcile_pending_account_deletions


def _mock_db_no_brokerage_connections():
    """A MagicMock Supabase client whose brokerage_connections lookup (the
    Plaid-revocation step) returns zero rows, so that step is a clean no-op
    and the test can focus on the RPC/auth-delete ordering."""
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
    return db


class TestDeleteAccountOrdering:
    @pytest.mark.asyncio
    async def test_full_success_deletes_data_then_auth_user(self):
        db = _mock_db_no_brokerage_connections()
        fresh_db = MagicMock()
        fresh_db.auth.admin.delete_user = MagicMock()

        with patch("app.api.routes.auth.get_supabase", return_value=db), \
             patch("app.core.database.get_fresh_supabase", return_value=fresh_db):
            result = await delete_account(user_id="user-123")

        assert result == {"message": "Cuenta eliminada"}
        # The atomic RPC must have been called with the real user id.
        rpc_call = db.rpc.call_args
        assert rpc_call.args[0] == "delete_user_data"
        assert rpc_call.args[1] == {"p_user_id": "user-123"}
        fresh_db.auth.admin.delete_user.assert_called_once_with("user-123")

    @pytest.mark.asyncio
    async def test_rpc_failure_never_deletes_the_auth_user(self):
        """The core atomicity guarantee: if delete_user_data (the Postgres
        function that clears ~50 tables in one transaction) fails for any
        reason, the user's auth row — and therefore their email/account —
        must be left completely untouched. Deleting it anyway would free
        the email for reuse while the user believes deletion failed, or
        worse, let a NEW signup with that email silently inherit nothing
        (fine) while the original owner is locked out with no recovery.
        """
        db = _mock_db_no_brokerage_connections()
        db.rpc.return_value.execute.side_effect = RuntimeError("postgres connection reset")
        fresh_db = MagicMock()

        with patch("app.api.routes.auth.get_supabase", return_value=db), \
             patch("app.core.database.get_fresh_supabase", return_value=fresh_db):
            with pytest.raises(HTTPException) as exc_info:
                await delete_account(user_id="user-456")

        assert exc_info.value.status_code == 500
        fresh_db.auth.admin.delete_user.assert_not_called()

    @pytest.mark.asyncio
    async def test_auth_delete_failure_after_successful_data_wipe_is_a_real_error(self):
        """Documented safe-retry state: data is already gone, but the
        endpoint must still report failure — never claim success when the
        auth user (and therefore the ability to log in/retry) wasn't
        actually removed."""
        db = _mock_db_no_brokerage_connections()
        fresh_db = MagicMock()
        fresh_db.auth.admin.delete_user.side_effect = RuntimeError("gotrue: service unavailable")

        with patch("app.api.routes.auth.get_supabase", return_value=db), \
             patch("app.core.database.get_fresh_supabase", return_value=fresh_db):
            with pytest.raises(HTTPException) as exc_info:
                await delete_account(user_id="user-789")

        assert exc_info.value.status_code == 500
        # The RPC DID run (data really is gone) — this is what makes a
        # retry of the same endpoint safe rather than destructive.
        assert db.rpc.called

    @pytest.mark.asyncio
    async def test_plaid_revocation_failure_never_blocks_deletion(self):
        """A user with a Plaid-linked broker must still be deletable even
        if Plaid's API is down/erroring — never let a third-party outage
        make account deletion impossible."""
        db = MagicMock()
        # One real brokerage connection, provider=plaid, to force the
        # revocation branch to actually run (and fail).
        db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "conn-1", "access_token": "access-abc"}]
        )
        fresh_db = MagicMock()

        with patch("app.api.routes.auth.get_supabase", return_value=db), \
             patch("app.core.database.get_fresh_supabase", return_value=fresh_db), \
             patch("app.api.routes.brokerage._get_plaid_client", side_effect=RuntimeError("plaid api down")):
            result = await delete_account(user_id="user-plaid")

        assert result == {"message": "Cuenta eliminada"}
        fresh_db.auth.admin.delete_user.assert_called_once_with("user-plaid")


class TestReconcilePendingAccountDeletions:
    """job_reconcile_pending_account_deletions (worker.py, every 15 min) —
    finishes a deletion that died between delete_account's RPC and its
    final auth-delete call. See migration 126 and the real (non-mocked)
    integration test in test_delete_account_integration.py for proof this
    actually recovers against a real Supabase instance; these mocked tests
    only verify the loop's own control flow."""

    @pytest.mark.asyncio
    async def test_no_stale_markers_is_a_clean_no_op(self):
        db = MagicMock()
        db.table.return_value.select.return_value.lt.return_value.execute.return_value = MagicMock(data=[])
        with patch("app.api.routes.auth.get_supabase", return_value=db):
            result = await reconcile_pending_account_deletions()
        assert result == {"reconciled": 0, "failed": 0}
        db.rpc.assert_not_called()

    @pytest.mark.asyncio
    async def test_completes_every_stale_marker_found(self):
        db = MagicMock()
        db.table.return_value.select.return_value.lt.return_value.execute.return_value = MagicMock(
            data=[{"user_id": "stuck-1", "requested_at": "2026-11-14T00:00:00Z"},
                  {"user_id": "stuck-2", "requested_at": "2026-11-14T00:05:00Z"}]
        )
        fresh_db = MagicMock()
        with patch("app.api.routes.auth.get_supabase", return_value=db), \
             patch("app.core.database.get_fresh_supabase", return_value=fresh_db):
            result = await reconcile_pending_account_deletions()

        assert result == {"reconciled": 2, "failed": 0}
        assert fresh_db.auth.admin.delete_user.call_count == 2
        fresh_db.auth.admin.delete_user.assert_any_call("stuck-1")
        fresh_db.auth.admin.delete_user.assert_any_call("stuck-2")

    @pytest.mark.asyncio
    async def test_one_failure_never_stops_the_rest_of_the_batch(self):
        """A row that's still genuinely stuck (Auth API down again) must
        never prevent every OTHER stale row from being reconciled."""
        db = MagicMock()
        db.table.return_value.select.return_value.lt.return_value.execute.return_value = MagicMock(
            data=[{"user_id": "still-stuck", "requested_at": "t"}, {"user_id": "now-fixed", "requested_at": "t"}]
        )
        fresh_db = MagicMock()
        fresh_db.auth.admin.delete_user.side_effect = [RuntimeError("still down"), None]
        with patch("app.api.routes.auth.get_supabase", return_value=db), \
             patch("app.core.database.get_fresh_supabase", return_value=fresh_db):
            result = await reconcile_pending_account_deletions()

        assert result == {"reconciled": 1, "failed": 1}
