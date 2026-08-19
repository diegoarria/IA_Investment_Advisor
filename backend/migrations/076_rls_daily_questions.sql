-- ============================================================================
-- 076_rls_daily_questions.sql
--
-- Security audit finding: daily_questions and daily_question_of_the_day
-- (070_weekly_rituals.sql) were the only two remaining user-facing tables
-- with RLS never enabled at all — not "enabled with zero policies" like
-- benchmark_cohort_stats (032_rls_hardening.sql), but genuinely off. Both
-- are global curated/scheduling content (no user_id column, not per-user
-- data) that's always read through the backend's own API (service_role,
-- bypasses RLS) — no legitimate client-side Supabase call ever needs to
-- touch either table directly. Without RLS, the public anon key (which is
-- intentionally exposed client-side — see frontend/web/src/lib/supabase.ts)
-- could otherwise INSERT/UPDATE/DELETE the curated question bank or which
-- question is "live" today directly against Supabase's REST API.
--
-- Same defense-in-depth reasoning as 032_rls_hardening.sql's own governing
-- principle: never rely on an unverified role attribute (assuming
-- service_role has BYPASSRLS) — make the intended access explicit.
-- ============================================================================

ALTER TABLE daily_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: daily questions" ON daily_questions;
CREATE POLICY "Service: daily questions" ON daily_questions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE daily_question_of_the_day ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: daily question of the day" ON daily_question_of_the_day;
CREATE POLICY "Service: daily question of the day" ON daily_question_of_the_day
  FOR ALL TO service_role USING (true) WITH CHECK (true);
