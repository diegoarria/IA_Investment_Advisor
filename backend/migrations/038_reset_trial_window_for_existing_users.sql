-- ============================================================================
-- 038_reset_trial_window_for_existing_users.sql
--
-- One-time data backfill (NOT a schema change): resets the 30-day free-
-- premium trial window to start today for every existing non-premium user,
-- per product decision on 2026-07-16 — "starting today, all existing users
-- and all new signups get 30 days of free premium."
--
-- Existing users already had trial_started_at set from signup (previously a
-- 90-day window); under the current 30-day rule that window has already
-- expired for most of them. This resets it to NOW() so everyone gets a
-- fresh 30 days from today, matching what new signups already get
-- automatically (trial_started_at is set lazily on first /status or
-- /start-trial call — see billing.py get_status and sync.py start_trial).
--
-- Paying users (subscription_tier = 'premium') are left untouched — they
-- don't need a trial window at all.
--
-- IMPORTANT: this is a one-time operation, not idempotent schema. Run it
-- ONCE manually in the Supabase SQL editor. Do NOT wire it into any
-- automated migration runner — running it again would reset everyone's
-- trial clock a second time.
-- ============================================================================

UPDATE user_profiles
SET trial_started_at = NOW()
WHERE subscription_tier IS DISTINCT FROM 'premium';
