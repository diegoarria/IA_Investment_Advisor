-- ============================================================================
-- 091_monthly_report.sql
--
-- Nuvos Monthly Report — the monthly, Spotify-Wrapped-style personal report
-- (see app/services/monthly_report_service.py). Deliberately does NOT add a
-- monthly-snapshot/aggregate table: the report is computed live from data
-- that already exists (positions, investment_graph_events, fmg_portfolio_
-- snapshots, investor_progress_service) and cached in Redis (see cache.py),
-- same "compute live + cache" pattern Wrapped (the annual equivalent)
-- already uses — a second persisted-snapshot system would just duplicate
-- that.
--
-- The one thing that DOES need real persistence is which achievements a user
-- has already unlocked — unlike the report's numbers (recomputable from
-- source data any time), "you unlocked ANALISTA on 2026-09-03" is itself a
-- fact that must survive a cache eviction/TTL and be checked for
-- idempotency (an achievement unlocks exactly once, ever, never re-fires
-- next month).
-- ============================================================================

CREATE TABLE IF NOT EXISTS monthly_report_achievements (
  user_id        UUID NOT NULL,
  achievement_id TEXT NOT NULL,
  unlocked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Which report month first surfaced it — display-only ("desbloqueaste
  -- esto en septiembre"), never re-derived to decide idempotency (the PK does).
  report_year    INT NOT NULL,
  report_month   INT NOT NULL CHECK (report_month BETWEEN 1 AND 12),
  PRIMARY KEY (user_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_monthly_report_achievements_user
  ON monthly_report_achievements (user_id);

-- Same RLS shape as every other service-role-only table (see 090).
ALTER TABLE monthly_report_achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: monthly report achievements" ON monthly_report_achievements;
CREATE POLICY "Service: monthly report achievements" ON monthly_report_achievements
  FOR ALL TO service_role USING (true) WITH CHECK (true);
