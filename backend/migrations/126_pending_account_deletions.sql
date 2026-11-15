-- Migration 126 — PROPOSED ONLY, not applied anywhere by this session, not
-- authorized for production in this pass. Run manually against local dev
-- first, then production, same as every other migration in this repo.
--
-- Audit 2026-11-14 (App Review prep), point 6: Supabase Auth (GoTrue) and
-- Postgres are two separate systems, not one ACID transaction — proven for
-- real against local Supabase in tests/test_delete_account_integration.py.
-- If DELETE /api/auth/account dies between the atomic delete_user_data RPC
-- and the final admin.delete_user() call (process crash, deploy restart,
-- network drop), the user's data is gone but their Auth identity — and
-- their ability to retry, since logging in now needs a profile row that no
-- longer exists for a fresh onboarding, but their email is still "taken" —
-- is stuck in limbo until they themselves hit "Eliminar cuenta" again.
--
-- This table is a plain crash marker: written right before the destructive
-- work starts, so a periodic reconciliation job (worker.py's
-- job_reconcile_pending_account_deletions, every 15 min) can find any
-- marker older than a grace window and finish the deletion itself — the
-- user never has to notice or retry. ON DELETE CASCADE means a normal,
-- fully-successful deletion removes this row for free (it dies along with
-- the auth.users row in the very last step), so this table only ever
-- holds rows for deletions that are either in-flight or stuck.
CREATE TABLE IF NOT EXISTS pending_account_deletions (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: service-role only. No end user ever reads or writes this table
-- directly — it's an internal bookkeeping detail of the deletion endpoint
-- and the reconciliation job, not state they can observe.
ALTER TABLE pending_account_deletions ENABLE ROW LEVEL SECURITY;

GRANT ALL ON pending_account_deletions TO service_role;

-- Rollback: DROP TABLE IF EXISTS pending_account_deletions;
