-- Migration 124: defense-in-depth hardening for publish_company_qualitative_content
-- (migration 123, already applied to production).
--
-- CONTEXT: an isolated-environment security audit (2026-11-12) confirmed the
-- live function is SECURITY INVOKER (prosecdef=false, the safe Postgres
-- default) and empirically verified that anon/authenticated CANNOT actually
-- create, modify, or corrupt any row through it today — every write attempt
-- is blocked by RLS (no INSERT/UPDATE policy exists for those roles), tested
-- both against a fresh ticker and against an existing published row. This is
-- NOT a live breach.
--
-- However, Postgres grants EXECUTE on every new function to PUBLIC by
-- default unless explicitly revoked, and the live grants confirm anon and
-- authenticated do have EXECUTE today. Relying solely on RLS to stop a role
-- that can already invoke the write path is fragile defense-in-depth: a
-- future RLS policy change, a FORCE ROW LEVEL SECURITY toggle, or a new
-- SECURITY DEFINER wrapper around this function could silently reopen the
-- door. The correct posture is "anon/authenticated should never have been
-- able to call this at all" — this migration closes that gap directly,
-- without touching the function's logic or any existing data.
--
-- NOT YET APPLIED — prepared for review. Do not run until explicitly
-- approved, same discipline as every other migration this session.

REVOKE EXECUTE ON FUNCTION publish_company_qualitative_content(
  TEXT, TEXT, JSONB, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;

-- service_role already bypasses RLS/grants as the backend's own role; no
-- explicit GRANT needed for it to keep working exactly as today.

-- Secondary hardening: lock the function's search_path explicitly. Not
-- exploitable today (SECURITY INVOKER means it already runs with the
-- CALLER's search_path/privileges, not an elevated one), but locking it
-- costs nothing and removes any ambiguity if this function is ever changed
-- to SECURITY DEFINER in the future without someone re-auditing this file.
ALTER FUNCTION publish_company_qualitative_content(
  TEXT, TEXT, JSONB, JSONB, TEXT
) SET search_path = public, pg_temp;

-- Rollback: GRANT EXECUTE ON FUNCTION publish_company_qualitative_content(
--   TEXT, TEXT, JSONB, JSONB, TEXT
-- ) TO PUBLIC; ALTER FUNCTION publish_company_qualitative_content(
--   TEXT, TEXT, JSONB, JSONB, TEXT
-- ) RESET search_path;
