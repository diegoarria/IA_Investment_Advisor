-- ============================================================================
-- 094_weekly_opportunities_history.sql
--
-- Diego, 2026-09-09 — the new Sunday 12:10pm ET "5 Nuevas Oportunidades de
-- Inversión" push (Premium only, worker.py's job_weekly_opportunities_push)
-- must NEVER repeat a ticker to the same user, ever — not just within a
-- rolling few-week window like the existing Screener Semanal history
-- (_weekly_history_key, a Redis cache entry with a TTL). A cache-based
-- "never repeat" isn't real — an eviction or TTL expiry silently forgets
-- history and the guarantee breaks. This is a real, permanent, durable
-- record instead: every ticker ever sent to a user via this specific push,
-- checked and appended to on every run, never expired.
-- ============================================================================

-- Dedicated opt-out toggle for the new push, same per-category-toggle
-- convention as every other notification_preferences column (067/093).
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS push_weekly_opportunities BOOLEAN DEFAULT true;

CREATE TABLE IF NOT EXISTS weekly_opportunities_history (
  user_id  UUID NOT NULL,
  ticker   TEXT NOT NULL,
  sent_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_weekly_opportunities_history_user
  ON weekly_opportunities_history (user_id);

-- Same RLS shape as every other service-role-only table (see 090/091).
ALTER TABLE weekly_opportunities_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: weekly opportunities history" ON weekly_opportunities_history;
CREATE POLICY "Service: weekly opportunities history" ON weekly_opportunities_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Add to the atomic account-deletion function (keep in sync with
-- _USER_DATA_TABLES in backend/app/api/routes/auth.py) — same pattern as
-- migration 082.
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
    'smart_alert_state', 'weekly_range_snapshots', 'weekly_opportunities_history'
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
