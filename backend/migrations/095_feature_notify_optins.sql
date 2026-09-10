-- ============================================================================
-- 095_feature_notify_optins.sql
--
-- Diego, 2026-09-09 — clicking the Annual ScoreBoard (Nuvos Wrapped) card
-- outside its Dec 15–Jan 15 window (app/core/wrapped_window.py) now shows a
-- flashcard instead of navigating through to a locked page, with a "recibir
-- notificación" button. This is a generic, reusable one-time opt-in table
-- (not a notification_preferences column) since it's a single-fire signal
-- tied to a feature becoming available, not a recurring weekly/monthly
-- ritual toggle — `feature_key` lets other "coming soon" gates reuse this
-- same table later instead of each needing its own migration.
-- ============================================================================

CREATE TABLE IF NOT EXISTS feature_notify_optins (
  user_id      UUID NOT NULL,
  feature_key  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set once the feature-availability push has actually been sent for this
  -- opt-in's current cycle (e.g. this year's Dec 15 open) — lets a recurring
  -- gate like Wrapped notify the same opted-in user again next year without
  -- a new row, by comparing this against the current cycle instead of
  -- deleting/recreating rows.
  notified_at  TIMESTAMPTZ,
  PRIMARY KEY (user_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_feature_notify_optins_feature
  ON feature_notify_optins (feature_key);

-- Same RLS shape as every other service-role-only table (see 090/091/094).
ALTER TABLE feature_notify_optins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: feature notify optins" ON feature_notify_optins;
CREATE POLICY "Service: feature notify optins" ON feature_notify_optins
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Add to the atomic account-deletion function (keep in sync with
-- _USER_DATA_TABLES in backend/app/api/routes/auth.py) — same pattern as
-- migration 094.
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
    'smart_alert_state', 'weekly_range_snapshots', 'weekly_opportunities_history',
    'feature_notify_optins'
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
