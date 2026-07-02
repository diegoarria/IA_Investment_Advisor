-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 019: Fix RLS on sync tables
--
-- user_portfolio and user_paper_trading were created in 001_sync_tables.sql
-- without RLS enabled and without any policies. At some point RLS was enabled
-- on these tables directly in the Supabase dashboard (most likely via the
-- Security Advisor's one-click "Enable RLS" prompt) with no policies added —
-- which makes Postgres deny ALL access by default, including from the
-- backend's own service-role connection. This broke every portfolio and
-- paper-trading save in production.
--
-- This migration brings them in line with the pattern already used for
-- user_profiles / chat_history / notifications in supabase_schema.sql:
-- explicit RLS + an owner policy + an explicit service_role bypass policy.
--
-- Run this in your Supabase SQL editor (Dashboard → SQL Editor → New query).
-- ─────────────────────────────────────────────────────────────────────────────

-- user_id on these tables is `text`, not `uuid` (unlike user_profiles), so
-- auth.uid() needs an explicit cast to compare correctly.

ALTER TABLE user_portfolio ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own portfolio" ON user_portfolio;
DROP POLICY IF EXISTS "Service: portfolio"  ON user_portfolio;
CREATE POLICY "Users own portfolio" ON user_portfolio FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY "Service: portfolio"  ON user_portfolio FOR ALL TO service_role USING (true);

ALTER TABLE user_paper_trading ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own paper trading" ON user_paper_trading;
DROP POLICY IF EXISTS "Service: paper trading"  ON user_paper_trading;
CREATE POLICY "Users own paper trading" ON user_paper_trading FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY "Service: paper trading"  ON user_paper_trading FOR ALL TO service_role USING (true);

-- Same migration, same missing-RLS pattern — fixed proactively so a future
-- accidental "Enable RLS" click on this table doesn't cause the same outage.
ALTER TABLE user_daily_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own daily usage" ON user_daily_usage;
DROP POLICY IF EXISTS "Service: daily usage"  ON user_daily_usage;
CREATE POLICY "Users own daily usage" ON user_daily_usage FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY "Service: daily usage"  ON user_daily_usage FOR ALL TO service_role USING (true);
