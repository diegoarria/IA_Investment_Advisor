-- ============================================================================
-- 091_investor_recap.sql
--
-- Nuvos Investor Recap — the monthly, Spotify-Wrapped-style personal report
-- (see app/services/investor_recap_service.py). Deliberately does NOT add a
-- monthly-snapshot/aggregate table: the recap is computed live from data that
-- already exists (positions, investment_graph_events, fmg_portfolio_snapshots,
-- investor_progress_service) and cached in Redis (see cache.py), same "compute
-- live + cache" pattern Wrapped (the annual equivalent) already uses — a
-- second persisted-snapshot system would just duplicate that.
--
-- The one thing that DOES need real persistence is which achievements a user
-- has already unlocked — unlike the recap's numbers (recomputable from source
-- data any time), "you unlocked ANALISTA on 2026-09-03" is itself a fact that
-- must survive a cache eviction/TTL and be checked for idempotency (an
-- achievement unlocks exactly once, ever, never re-fires next month).
-- ============================================================================

CREATE TABLE IF NOT EXISTS investor_recap_achievements (
  user_id        UUID NOT NULL,
  achievement_id TEXT NOT NULL,
  unlocked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Which recap month first surfaced it — display-only ("desbloqueaste esto
  -- en septiembre"), never re-derived to decide idempotency (the PK does).
  recap_year     INT NOT NULL,
  recap_month    INT NOT NULL CHECK (recap_month BETWEEN 1 AND 12),
  PRIMARY KEY (user_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_investor_recap_achievements_user
  ON investor_recap_achievements (user_id);

-- Same RLS shape as every other service-role-only table (see 090).
ALTER TABLE investor_recap_achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: investor recap achievements" ON investor_recap_achievements;
CREATE POLICY "Service: investor recap achievements" ON investor_recap_achievements
  FOR ALL TO service_role USING (true) WITH CHECK (true);
