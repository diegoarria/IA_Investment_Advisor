-- Migration 082: weekly_range_snapshots — live-priced Monday-open and
-- Friday-close portfolio values, so the weekly summary (Sunday push +
-- Perfil review card) can measure real market movement across the week
-- instead of `fmg_portfolio_snapshots`, which is cost-basis
-- (shares * avgPrice) and barely moves unless the user trades.
--
-- One row per (user, week, open|close). week_start is always the Monday
-- of the ISO week, even on a holiday week where the actual first/last
-- trading day is Tue or Thu — the app-side jobs figure out which
-- calendar day is the real first/last trading day of the week and tag
-- the row with the Monday anchor so both halves of a week always line up
-- under the same key.

CREATE TABLE IF NOT EXISTS weekly_range_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start    DATE NOT NULL,
  snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('open', 'close')),
  total_value   REAL NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, week_start, snapshot_type)
);

CREATE INDEX IF NOT EXISTS idx_weekly_range_snapshots_user_week
  ON weekly_range_snapshots (user_id, week_start DESC);

ALTER TABLE weekly_range_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY weekly_range_snapshots_self ON weekly_range_snapshots
  FOR ALL USING (user_id = auth.uid());

-- Add to the atomic account-deletion function (keep in sync with
-- _USER_DATA_TABLES in backend/app/api/routes/auth.py).
CREATE OR REPLACE FUNCTION delete_user_data(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'user_profiles', 'user_portfolio', 'portfolio_positions', 'user_paper_trading',
    'user_daily_usage', 'web_push_subscriptions', 'chat_history',
    'notifications', 'watchlist', 'notification_preferences',
    'notification_log', 'notification_analytics', 'investment_decisions',
    'support_tickets', 'user_feedback', 'price_alerts', 'pending_actions',
    'upsell_dismissals', 'upsell_events', 'brokerage_connections',
    'voice_call_transcripts', 'user_financial_goals', 'user_sector_preferences',
    'library_items', 'habit_engagement',
    'fmg_memories', 'fmg_behavioral_patterns', 'fmg_events',
    'fmg_portfolio_snapshots', 'fmg_annual_reports',
    'valuation_alert_state', 'thesis_drift_state',
    'clip_likes', 'clip_saves', 'clip_views', 'clip_comments',
    'research_jobs', 'research_reports', 'security_events',
    'investment_graph_events', 'user_investment_theses',
    'user_checklist_items', 'checklist_completions', 'investable_marks',
    'smart_alert_state', 'weekly_range_snapshots'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    BEGIN
      EXECUTE format('DELETE FROM %I WHERE user_id::text = $1', tbl) USING p_user_id::text;
    EXCEPTION
      WHEN undefined_table OR undefined_column THEN
        RAISE WARNING 'delete_user_data: skipped % for % — table/column schema unexpected (%)', tbl, p_user_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_user_data(UUID) TO service_role;
