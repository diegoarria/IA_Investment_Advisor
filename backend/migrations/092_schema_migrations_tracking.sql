-- ============================================================================
-- 092_schema_migrations_tracking.sql
--
-- Diego, 2026-09-08 (pre-launch audit, P2): 91 migration files existed with
-- no automated runner and no tracking table — no auditable way to know
-- which of them had actually been applied to production (migrations are
-- run by hand, pasted into the Supabase SQL editor). This doesn't add a
-- runner (a bigger, riskier change than this audit pass should make
-- unilaterally) — it just gives every FUTURE migration a real, queryable
-- record of when it ran, and backfills the 91 that already ran before this
-- one (their exact original apply timestamp isn't known — backfilled with
-- NOW() and a note, not a fabricated historical date).
--
-- Two filenames collide at 019 (019_fix_portfolio_rls.sql and
-- 019_topic_completions.sql — both real, both already applied) and 046 is
-- skipped entirely (a migration that was written then dropped before ever
-- being numbered into the repo, going by the 045/047 gap) — this table
-- keys by the full filename, not the number, so neither is a problem here.
--
-- How to use going forward: after applying a new NNN_name.sql by hand,
-- also run:
--   INSERT INTO schema_migrations (filename) VALUES ('NNN_name.sql');
-- scripts/check_migrations.py compares backend/migrations/*.sql on disk
-- against this table and reports any file not yet recorded as applied.
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note        TEXT
);

INSERT INTO schema_migrations (filename, note) VALUES
  ('001_sync_tables.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('002_push_tokens.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('003_avatar_url.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('004_paper_alias.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('005_referral.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('006_support_tickets.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('007_investment_decisions.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('008_nav_order.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('009_theme.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('010_chat_sessions.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('011_notification_system.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('012_clips_download_url.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('013_web_push_subscriptions.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('014_broker_offer_seen_at.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('015_duo_secondary_email.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('016_user_feedback.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('017_streak_milestones.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('018_multi_portfolio.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('019_fix_portfolio_rls.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('019_topic_completions.sql', 'backfilled 2026-09-08 — exact original apply date unknown; number collides with 019_fix_portfolio_rls.sql, both real'),
  ('020_portfolio_view_mode.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('021_checklist_watchlist_view.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('022_onboarding_extended_profile.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('023_financial_memory_graph.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('024_investor_progress_engine.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('025_duo_bidirectional_link.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('026_valuation_alert_state.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('027_financial_profile_and_library.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('028_thesis_drift_state.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('029_voice_call_transcripts.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('030_benchmark_cohort_stats.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('031_deep_research.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('032_rls_hardening.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('033_security_events.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('034_research_job_queue.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('035_atomic_account_deletion.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('036_major_news_events.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('037_llm_usage_log.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('038_reset_trial_window_for_existing_users.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('039_investment_journal.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('040_investment_theses_account_deletion.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('041_drop_investment_theses.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('042_investment_graph_events.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('043_investment_graph_events_account_deletion.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('044_phone_number.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('045_panic_streak.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('047_drop_panic_streak.sql', 'backfilled 2026-09-08 — exact original apply date unknown; 046 was never numbered into the repo'),
  ('048_saved_valuations.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('049_terms_acceptance.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('050_vi_search_limit.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('051_notification_queue.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('052_referral_reward_tiers.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('053_cash_holdings.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('054_dividend_income.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('055_cash_holdings_cetes_rate.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('056_atomic_msg_count.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('057_view_mode_default_advanced.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('058_market_perception.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('059_chat_deleted_sessions.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('060_research_knowledge_base.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('061_research_thesis.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('062_user_investment_theses_account_deletion.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('063_research_hypothesis_outcomes.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('064_detail_level.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('065_investment_checklist.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('066_checklist_account_deletion.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('067_smart_alerts.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('068_smart_alert_state_account_deletion.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('069_personalization_settings.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('070_weekly_rituals.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('071_belvo_connections.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('072_belvo_cash_source.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('073_backfill_trial_started_at.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('074_macro_economic_events.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('075_decision_quiz_answers.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('076_rls_daily_questions.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('077_wrapped_longest_streak.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('078_margin_of_safety_alerts.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('079_manual_premium_grants.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('080_reapply_manual_premium_grants.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('081_paid_1on1_sessions.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('082_weekly_range_snapshots.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('083_drop_saved_valuations.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('084_real_patrimonio_ath.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('085_duo_invite_consent.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('086_worker_heartbeat.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('087_client_errors.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('088_ip_intel.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('089_backup_heartbeat.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('090_system_settings.sql', 'backfilled 2026-09-08 — exact original apply date unknown'),
  ('091_monthly_report.sql', 'backfilled 2026-09-08 — exact original apply date unknown')
ON CONFLICT (filename) DO NOTHING;

INSERT INTO schema_migrations (filename, note) VALUES
  ('092_schema_migrations_tracking.sql', 'this migration')
ON CONFLICT (filename) DO NOTHING;

-- Internal/admin-only, same pattern as system_settings (090).
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: schema migrations" ON schema_migrations;
CREATE POLICY "Service: schema migrations" ON schema_migrations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
