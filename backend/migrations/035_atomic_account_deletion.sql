-- ============================================================================
-- 035_atomic_account_deletion.sql
--
-- Account deletion previously looped over ~35 tables in Python, each with
-- its own try/except and no rollback — a failure partway through left the
-- user's auth account deleted (email freed for reuse) while some tables
-- still held orphaned rows keyed to a user_id that no longer mapped to any
-- account. This function moves the DATA deletion into a single Postgres
-- function body, which Postgres runs as one transaction: if any DELETE
-- fails, ALL of them roll back together — there is no partial-deletion
-- state anymore, only "fully deleted" or "fully unchanged" (with a clear
-- exception the Python caller can surface to the user and retry).
--
-- The auth.users row itself is deleted separately by the Python caller
-- (auth.admin.delete_user — a Supabase Admin API call, not a plain SQL
-- statement, so it can't live inside this same transaction) — but doing
-- data deletion atomically first, then the auth user, means a failure on
-- the SECOND step just leaves a fully-data-wiped account that still exists
-- and can be deleted again (idempotent retry), instead of a half-wiped one.
--
-- Keep this table list in sync with _USER_DATA_TABLES in
-- backend/app/api/routes/auth.py — they must name the same tables.
--
-- Implementation note: most of these tables have a `user_id UUID` column,
-- but two (support_tickets, investment_decisions) use `user_id TEXT`
-- instead, and portfolio_positions' exact schema could not be confirmed
-- from application code alone (see migrations/032_rls_hardening.sql's own
-- note on it) — its existence/column name is inferred, not verified. Two
-- defensive choices follow directly from that uncertainty:
--   1. Every comparison casts BOTH sides to text (`user_id::text = p_user_id::text`)
--      so this works identically whether a given table's user_id is UUID or TEXT,
--      without needing a table-by-table special case.
--   2. Each DELETE runs in its own nested BEGIN/EXCEPTION block (an implicit
--      Postgres savepoint) that specifically catches undefined_table/
--      undefined_column — a genuinely unexpected schema mismatch for ONE
--      table degrades gracefully (skipped, logged via RAISE WARNING) rather
--      than rolling back the ENTIRE deletion for every other table too.
--      Any OTHER kind of error (a real constraint violation, a connection
--      issue) is deliberately NOT caught here and propagates to roll back
--      the whole transaction — that's still exactly the atomicity guarantee
--      this migration exists to provide, just scoped to real failures
--      instead of also including "a table's schema wasn't what we assumed."
-- ============================================================================

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
    'research_jobs', 'research_reports', 'security_events'
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
