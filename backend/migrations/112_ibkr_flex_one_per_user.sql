-- ============================================================================
-- 112_ibkr_flex_one_per_user.sql
--
-- Root cause (confirmed live 2026-10-09): connect_ibkr_flex's upsert used
-- brokerage_connections' general UNIQUE(user_id, provider, institution_id)
-- constraint (migration 071's original schema — shared with Plaid, where
-- institution_id is a real different broker per row, so multiple rows per
-- user ARE correct there). For IBKR Flex, institution_id is the user's own
-- Flex Query ID — which a user can and does recreate (Diego did, when the
-- first query got stuck) — so reconnecting with a NEW query id upserted a
-- SECOND row instead of replacing the first. get_ibkr_flex_holdings then
-- called .maybe_single() expecting 0-1 rows, got 2, and PostgREST raised —
-- surfaced as a raw 500 "Internal server error" (an unhandled exception,
-- not one of this module's own HTTPExceptions).
--
-- Fix: a user has at most ONE IBKR Flex connection (same "one broker of
-- this kind at a time" assumption IOL already has, where institution_id is
-- always the fixed literal "iol"). This partial unique index lets
-- connect_ibkr_flex's upsert target (user_id, provider) instead — any
-- reconnect with a different query_id now updates the existing row rather
-- than creating a new one. Scoped to provider='ibkr_flex' only, so Plaid's
-- real multi-row-per-user case is completely unaffected.
--
-- Run AFTER first manually deleting any existing duplicate ibkr_flex rows
-- per user (the index creation fails otherwise) — see this migration's own
-- companion cleanup, already applied directly 2026-10-09 for the one
-- affected user found live.
-- ============================================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_brokerage_connections_ibkr_flex_one_per_user
  ON brokerage_connections (user_id, provider)
  WHERE provider = 'ibkr_flex';

COMMIT;
