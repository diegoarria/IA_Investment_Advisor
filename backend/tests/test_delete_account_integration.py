"""
Real integration test for account deletion — against Supabase LOCAL only
(guarded by conftest.py's pytest_configure, which refuses to even collect
tests if SUPABASE_URL resolves to the production project). Every user
created here is created and destroyed within the test itself; nothing is
left behind in the local instance.

Why this exists on top of test_delete_account.py's mocked tests: a mock
proves the Python CODE calls things in the right order. It cannot prove
anything about the real two-system consistency gap between Supabase Auth
(GoTrue, its own service with its own storage) and the `user_profiles` /
etc. rows in Postgres — those are not one ACID transaction. This file
exercises the REAL RPC and the REAL GoTrue admin API against local
Postgres/GoTrue to make that gap concrete and prove the one thing that
actually matters: a partial failure leaves a recoverable, non-corrupting
state, never silent data loss or a permanently stuck account.

Note on GoTrue's admin API (discovered writing this file): `get_user_by_id`
does NOT return a `UserResponse(user=None)` for a missing user the way
`maybe_single()` does on a Postgres table — it raises
`gotrue.errors.AuthApiError: User not found` (HTTP 404). Every assertion
below that needs "this user no longer exists" uses `pytest.raises` for
that reason, not a truthy/falsy check on `.user`.
"""
import uuid

import pytest
from gotrue.errors import AuthApiError

from app.api.routes.auth import reconcile_pending_account_deletions
from app.core.database import get_supabase, run_query


def _unique_email() -> str:
    return f"audit-delete-{uuid.uuid4().hex[:12]}@nuvos-test.invalid"


@pytest.mark.asyncio
class TestDeleteAccountRealLocalSupabase:
    async def test_delete_user_data_rpc_really_removes_rows_from_postgres(self):
        db = get_supabase()
        email = _unique_email()
        created = db.auth.admin.create_user({
            "email": email, "password": "audit-test-pw-123!", "email_confirm": True,
        })
        user_id = created.user.id
        try:
            await run_query(db.table("user_profiles").insert({"user_id": user_id, "name": "Audit Test"}))
            before = await run_query(db.table("user_profiles").select("user_id").eq("user_id", user_id))
            assert len(before.data) == 1, "setup failed: row wasn't actually inserted"

            await run_query(db.rpc("delete_user_data", {"p_user_id": user_id}))

            after = await run_query(db.table("user_profiles").select("user_id").eq("user_id", user_id))
            assert after.data == [], "delete_user_data did not really remove the row from Postgres"

            # THE GAP: at this exact point in real production code (between
            # the RPC call and the admin.delete_user call), this user's data
            # is gone but their Auth identity is NOT — this is not a bug,
            # it's the inherent two-system boundary (Postgres vs GoTrue are
            # not one ACID transaction). Prove it's real and observable,
            # not just a comment in auth.py.
            still_logged_in_identity = db.auth.admin.get_user_by_id(user_id)
            assert still_logged_in_identity.user.id == user_id, (
                "expected the orphan window to be real: auth user must still "
                "exist here, proving data-deletion and identity-deletion are "
                "two separate, non-atomic operations against two different "
                "systems"
            )
        finally:
            # Cleanup also doubles as the retry-safety assertion: calling
            # delete_user_data again on a user with ZERO remaining rows
            # must be a harmless no-op (this is exactly what a retried
            # DELETE /auth/account does after the first attempt died
            # between the RPC and the auth-delete step).
            await run_query(db.rpc("delete_user_data", {"p_user_id": user_id}))
            db.auth.admin.delete_user(user_id)
            with pytest.raises(AuthApiError):
                db.auth.admin.get_user_by_id(user_id)

    async def test_retrying_after_simulated_partial_failure_fully_recovers(self):
        """Simulates exactly the failure window above by stopping there on
        purpose, then proves a second, independent call finishes the job —
        this is the real-world behavior a user hitting 'Eliminar cuenta'
        twice (e.g. after a network drop on the first attempt) depends on.
        """
        db = get_supabase()
        email = _unique_email()
        created = db.auth.admin.create_user({
            "email": email, "password": "audit-test-pw-123!", "email_confirm": True,
        })
        user_id = created.user.id

        # Attempt 1: only the data-wipe half completes (simulates the
        # process crashing / the request timing out right after this line
        # in the real endpoint, before reaching admin.delete_user).
        await run_query(db.table("user_profiles").insert({"user_id": user_id, "name": "Audit Test 2"}))
        await run_query(db.rpc("delete_user_data", {"p_user_id": user_id}))

        # The auth identity must still be reachable after attempt 1 — this
        # is exactly the state a crashed/timed-out first request leaves
        # behind, and the user must be able to retry from the app.
        still_there = db.auth.admin.get_user_by_id(user_id)
        assert still_there.user.id == user_id

        # Attempt 2 (the "retry"): re-running the full two-step sequence
        # must succeed cleanly even though the data is already gone.
        await run_query(db.rpc("delete_user_data", {"p_user_id": user_id}))  # no-op, must not raise
        db.auth.admin.delete_user(user_id)

        with pytest.raises(AuthApiError):
            db.auth.admin.get_user_by_id(user_id)

    async def test_reconciliation_job_automatically_finishes_a_stuck_deletion(self):
        """The capstone of audit point 6: the user never has to retry at
        all. Writes the real crash marker (migration 126), simulates the
        exact crash window (data wiped, auth delete never reached — the
        marker is left behind on purpose), then calls the REAL
        reconcile_pending_account_deletions (not mocked) with grace_minutes=0
        so it doesn't have to wait — and proves it finds the stuck user and
        finishes the deletion with zero user action."""
        db = get_supabase()
        email = _unique_email()
        created = db.auth.admin.create_user({
            "email": email, "password": "audit-test-pw-123!", "email_confirm": True,
        })
        user_id = created.user.id

        # Exactly delete_account's own sequence, stopping right where a
        # crash/deploy-restart/network-drop would: marker written, data
        # wiped, auth identity never touched.
        await run_query(db.table("pending_account_deletions").upsert({"user_id": user_id}))
        await run_query(db.table("user_profiles").insert({"user_id": user_id, "name": "Audit Reconcile"}))
        await run_query(db.rpc("delete_user_data", {"p_user_id": user_id}))

        still_there = db.auth.admin.get_user_by_id(user_id)
        assert still_there.user.id == user_id, "setup failed: the stuck state must be real before reconciling it"

        result = await reconcile_pending_account_deletions(grace_minutes=0)
        assert result["reconciled"] >= 1
        assert result["failed"] == 0

        # The user is now fully gone — no retry, no support ticket, no
        # manual intervention. If this assertion ever fails, delete_user's
        # own ON DELETE CASCADE already removed the marker row too, so
        # there's nothing left to clean up here either.
        with pytest.raises(AuthApiError):
            db.auth.admin.get_user_by_id(user_id)
