-- ============================================================================
-- 032_rls_hardening.sql
--
-- Full RLS audit remediation. Every table the backend reads/writes is
-- accounted for here. This migration is idempotent (safe to re-run) and is
-- the single source of truth for row-level security in this project — no
-- table's protection should depend on a dashboard-only setting from now on.
--
-- Established pattern in this codebase (see 019_fix_portfolio_rls.sql and
-- 024_investor_progress_engine.sql): RLS on user-owned tables gets BOTH
--   (a) an owner policy (auth.uid() = user_id), for direct anon/authenticated
--       access via the public anon key (Supabase JS/REST clients embed it),
--   (b) an explicit `TO service_role` policy, so the backend's own writes
--       never depend on the assumption that service_role bypasses RLS by
--       default — 019's own postmortem is exactly what happens when that
--       assumption turns out to be wrong for a given project/role setup.
-- Every table below follows this pattern from here on.
-- ============================================================================

-- ─── PART A: tables that exist (CREATE TABLE already ran) but ship with no
-- RLS/policy statement anywhere in version control. If RLS was never enabled
-- on these in the live database, any client holding the public anon key can
-- read/write EVERY user's rows directly via Supabase's REST API, bypassing
-- the backend entirely. If RLS *was* enabled ad-hoc via the dashboard with no
-- policy, the table is fully locked (including for the backend itself,
-- unless service_role bypass is configured) — either way this fixes it.
-- ─────────────────────────────────────────────────────────────────────────

-- NOTE: support_tickets.user_id and investment_decisions.user_id are TEXT
-- columns (not UUID — see 006_support_tickets.sql / 007_investment_decisions.sql),
-- unlike almost every other user-owned table in this codebase. auth.uid()
-- returns uuid, and Postgres does NOT implicitly cast uuid<->text in a
-- comparison, so these two policies explicitly cast auth.uid() to text
-- rather than reusing the `auth.uid() = user_id` pattern used everywhere
-- else in this migration (which would fail at query time with "operator
-- does not exist: uuid = text" against these two specific tables).
ALTER TABLE IF EXISTS support_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own support tickets" ON support_tickets;
CREATE POLICY "Users own support tickets" ON support_tickets
  FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
DROP POLICY IF EXISTS "Service: support tickets" ON support_tickets;
CREATE POLICY "Service: support tickets" ON support_tickets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE IF EXISTS investment_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own investment decisions" ON investment_decisions;
CREATE POLICY "Users own investment decisions" ON investment_decisions
  FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
DROP POLICY IF EXISTS "Service: investment decisions" ON investment_decisions;
CREATE POLICY "Service: investment decisions" ON investment_decisions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE IF EXISTS user_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own feedback" ON user_feedback;
CREATE POLICY "Users own feedback" ON user_feedback
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Service: user feedback" ON user_feedback;
CREATE POLICY "Service: user feedback" ON user_feedback
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE IF EXISTS web_push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own push subscriptions" ON web_push_subscriptions;
CREATE POLICY "Users own push subscriptions" ON web_push_subscriptions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Service: push subscriptions" ON web_push_subscriptions;
CREATE POLICY "Service: push subscriptions" ON web_push_subscriptions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- portfolio_positions: referenced in annual_report.py and in the
-- account-deletion table list, but confirmed NOT to actually exist in the
-- live database (this migration's first run errored on it with
-- "relation portfolio_positions does not exist" — `ALTER TABLE IF EXISTS`
-- safely no-ops on a missing table, but `CREATE POLICY ... ON <table>` has
-- no IF-EXISTS form and fails outright, which aborted this entire script
-- partway through on first run since Supabase's SQL editor runs a pasted
-- script as one transaction). It's genuinely vestigial — annual_report.py's
-- read of it was already dead code against a table that doesn't exist.
-- Guarded in a DO block so this is a true no-op if still absent, but still
-- applies real protection if the table is ever (re)created later.
DO $$
BEGIN
  IF to_regclass('public.portfolio_positions') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE portfolio_positions ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Users own portfolio positions" ON portfolio_positions';
    EXECUTE 'CREATE POLICY "Users own portfolio positions" ON portfolio_positions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)';
    EXECUTE 'DROP POLICY IF EXISTS "Service: portfolio positions" ON portfolio_positions';
    EXECUTE 'CREATE POLICY "Service: portfolio positions" ON portfolio_positions FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- ─── PART B: tables that were NEVER created in a tracked migration — only
-- ever run by hand in the Supabase SQL editor (or, for brokerage_connections
-- and watchlist, documented as an intended-but-unverified comment in the
-- route file). CREATE TABLE IF NOT EXISTS makes this migration authoritative
-- and reproducible from a clean database going forward, without touching
-- existing data if the table is already there.
-- ─────────────────────────────────────────────────────────────────────────

-- brokerage_connections: highest-priority table in this whole migration —
-- stores plaintext OAuth access/refresh tokens for linked brokerage accounts.
CREATE TABLE IF NOT EXISTS brokerage_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  institution_name  TEXT,
  institution_id    TEXT,
  access_token      TEXT NOT NULL,
  refresh_token     TEXT,
  item_id           TEXT,
  token_expires_at  TIMESTAMPTZ,
  last_sync_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider, institution_id)
);
ALTER TABLE brokerage_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own brokerage connections" ON brokerage_connections;
CREATE POLICY "Users own brokerage connections" ON brokerage_connections
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Service: brokerage connections" ON brokerage_connections;
CREATE POLICY "Service: brokerage connections" ON brokerage_connections
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS watchlist (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker     TEXT NOT NULL,
  name       TEXT,
  logo_url   TEXT,
  added_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, ticker)
);
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own watchlist" ON watchlist;
CREATE POLICY "Users own watchlist" ON watchlist
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Service: watchlist" ON watchlist;
CREATE POLICY "Service: watchlist" ON watchlist
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS price_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker        TEXT NOT NULL,
  name          TEXT,
  target_price  NUMERIC NOT NULL,
  condition     TEXT NOT NULL CHECK (condition IN ('above', 'below')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  triggered_at  TIMESTAMPTZ,
  UNIQUE(user_id, ticker)
);
ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own price alerts" ON price_alerts;
CREATE POLICY "Users own price alerts" ON price_alerts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Service: price alerts" ON price_alerts;
CREATE POLICY "Service: price alerts" ON price_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS pending_actions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type   TEXT NOT NULL,
  action_label  TEXT,
  action_data   JSONB DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'committed',
  due_at        TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  notified_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE pending_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own pending actions" ON pending_actions;
CREATE POLICY "Users own pending actions" ON pending_actions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Service: pending actions" ON pending_actions;
CREATE POLICY "Service: pending actions" ON pending_actions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS upsell_dismissals (
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  offer_type    TEXT NOT NULL,
  dismissed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, offer_type)
);
ALTER TABLE upsell_dismissals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own upsell dismissals" ON upsell_dismissals;
CREATE POLICY "Users own upsell dismissals" ON upsell_dismissals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Service: upsell dismissals" ON upsell_dismissals;
CREATE POLICY "Service: upsell dismissals" ON upsell_dismissals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS upsell_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  offer_type      TEXT,
  user_tier       TEXT,
  trigger_source  TEXT,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE upsell_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own upsell events" ON upsell_events;
CREATE POLICY "Users own upsell events" ON upsell_events
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Service: upsell events" ON upsell_events;
CREATE POLICY "Service: upsell events" ON upsell_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_watchlist_user       ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_user     ON price_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_actions_user  ON pending_actions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_upsell_events_user    ON upsell_events(user_id, created_at DESC);

-- ─── PART C: RLS is enabled with a policy, but only an owner policy — no
-- explicit service_role policy. These currently work only because Supabase
-- projects grant service_role a BYPASSRLS attribute by default; this project
-- has already had that assumption bite it once (see 019's postmortem, which
-- is why 019 and 024 both explicitly re-add `TO service_role` policies).
-- Applying that same defensive pattern uniformly here, so no table's
-- backend-write-path silently depends on an unverified role attribute.
-- ─────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Service: notification prefs" ON notification_preferences;
CREATE POLICY "Service: notification prefs" ON notification_preferences
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service: fmg memories" ON fmg_memories;
CREATE POLICY "Service: fmg memories" ON fmg_memories
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service: fmg patterns" ON fmg_behavioral_patterns;
CREATE POLICY "Service: fmg patterns" ON fmg_behavioral_patterns
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service: fmg events" ON fmg_events;
CREATE POLICY "Service: fmg events" ON fmg_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service: fmg snapshots" ON fmg_portfolio_snapshots;
CREATE POLICY "Service: fmg snapshots" ON fmg_portfolio_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service: financial goals" ON user_financial_goals;
CREATE POLICY "Service: financial goals" ON user_financial_goals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service: sector preferences" ON user_sector_preferences;
CREATE POLICY "Service: sector preferences" ON user_sector_preferences
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service: library items" ON library_items;
CREATE POLICY "Service: library items" ON library_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service: habit engagement" ON habit_engagement;
CREATE POLICY "Service: habit engagement" ON habit_engagement
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service: thesis drift state" ON thesis_drift_state;
CREATE POLICY "Service: thesis drift state" ON thesis_drift_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service: valuation alert state" ON valuation_alert_state;
CREATE POLICY "Service: valuation alert state" ON valuation_alert_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service: research jobs" ON research_jobs;
CREATE POLICY "Service: research jobs" ON research_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service: research reports" ON research_reports;
CREATE POLICY "Service: research reports" ON research_reports
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service: clips" ON clips;
CREATE POLICY "Service: clips" ON clips
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── PART D: fix overly-broad / incomplete policies ──────────────────────

-- notification_log's insert policy currently has WITH CHECK (true) and no
-- role restriction, meaning ANY authenticated or anon caller can insert an
-- arbitrary log row claiming to be for any user_id. Replace with a
-- service_role-only insert policy — only the backend ever writes this table.
DROP POLICY IF EXISTS "Service inserts logs" ON notification_log;
DROP POLICY IF EXISTS "Service: notification log" ON notification_log;
CREATE POLICY "Service: notification log" ON notification_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- notification_analytics has RLS enabled with only an unrestricted insert
-- policy (WITH CHECK (true), no role scoping) and no SELECT/UPDATE/DELETE
-- policy at all — meaning end users can never read their own rows, AND any
-- anon/authenticated caller can currently insert arbitrary analytics rows.
DROP POLICY IF EXISTS "Service inserts analytics" ON notification_analytics;
DROP POLICY IF EXISTS "Service: notification analytics" ON notification_analytics;
CREATE POLICY "Service: notification analytics" ON notification_analytics
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Users see own analytics" ON notification_analytics;
CREATE POLICY "Users see own analytics" ON notification_analytics
  FOR SELECT USING (auth.uid() = user_id);

-- benchmark_cohort_stats has no user_id column by design (aggregate, anonymous
-- cohort statistics) and was deliberately left with RLS-enabled-zero-policies,
-- which under Postgres RLS means only service_role (assuming BYPASSRLS) can
-- touch it. Make that explicit instead of implicit, per this migration's
-- governing principle of never relying on an unverified role attribute.
DROP POLICY IF EXISTS "Service: benchmark cohort stats" ON benchmark_cohort_stats;
CREATE POLICY "Service: benchmark cohort stats" ON benchmark_cohort_stats
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- Storage: the "avatars" bucket has no storage.objects policies anywhere in
-- the repo, unlike "clip-audio" (see feed_audio_migration.sql). Users should
-- only be able to manage their own avatar (path convention: "<user_id>/...",
-- matching how profile.py uploads it), and anyone should be able to view an
-- avatar (they're rendered publicly across the app — profile pics, feed,
-- leaderboards). Bucket itself is assumed already created via the dashboard;
-- this only adds the missing object-level policies.
-- ============================================================================

DROP POLICY IF EXISTS "Avatar public read" ON storage.objects;
CREATE POLICY "Avatar public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Avatar owner write" ON storage.objects;
CREATE POLICY "Avatar owner write" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Avatar owner update" ON storage.objects;
CREATE POLICY "Avatar owner update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Avatar owner delete" ON storage.objects;
CREATE POLICY "Avatar owner delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Avatar service role" ON storage.objects;
CREATE POLICY "Avatar service role" ON storage.objects
  FOR ALL TO service_role USING (bucket_id = 'avatars') WITH CHECK (bucket_id = 'avatars');

-- ============================================================================
-- Cleanup note: "user_sync" appears in profile.py's _TABLES_WITH_USER_ID list
-- but no db.table("user_sync") call and no CREATE TABLE exists anywhere in
-- this codebase — almost certainly a stale reference from before a rename to
-- user_portfolio/user_paper_trading. Deliberately NOT creating it here; if a
-- future audit confirms it's genuinely unused, remove it from that list in
-- profile.py instead of letting a migration accidentally bring it into being.
-- ============================================================================
