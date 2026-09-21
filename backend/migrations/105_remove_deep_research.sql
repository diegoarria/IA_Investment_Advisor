-- ============================================================================
-- 105_remove_deep_research.sql
--
-- Diego, 2026-09-21 — Nuvos Deep Research was removed entirely (backend, web,
-- mobile). This drops everything it left in the database. DESTRUCTIVE and NOT
-- reversible: run it only after the code that no longer references these
-- objects is deployed (the backend removal commit).
--
-- Data being dropped, as counted 2026-09-21: research_jobs 2 rows (both
-- 'failed', the admin's own July tests), research_reports 0 rows,
-- free_deep_research_credits > 0 on 0 profiles, 1 upsell_events row.
-- ============================================================================

BEGIN;

-- The job-queue functions (migration 034) and the tables (031 / 034).
DROP FUNCTION IF EXISTS claim_research_job(TEXT);
DROP FUNCTION IF EXISTS reap_stale_research_jobs(INT);
DROP TABLE IF EXISTS research_reports;
DROP TABLE IF EXISTS research_jobs;

-- Referral reward (migration 052) that granted a free Deep Research report.
ALTER TABLE user_profiles DROP COLUMN IF EXISTS free_deep_research_credits;

-- Upsell analytics rows for the removed offer.
DELETE FROM upsell_events     WHERE offer_type = 'deep_research';
DELETE FROM upsell_dismissals WHERE offer_type = 'deep_research';

-- Atomic account deletion (last defined in 095): same list, minus the removed
-- tables. Keep in sync with _USER_DATA_TABLES in backend/app/api/routes/auth.py.
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
    'security_events',
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

COMMIT;
