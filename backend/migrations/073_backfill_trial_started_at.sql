-- ============================================================================
-- 073_backfill_trial_started_at.sql
--
-- Data backfill, not a schema change. Fixes existing users whose
-- trial_started_at was never set (a bug in earlier account-creation paths,
-- fixed in code separately — see profile.py's create_profile, which now
-- guarantees trial_started_at for every new/updated profile) — those users
-- currently show as "free" in is_premium_active() (backend/app/core/
-- subscription.py) even though they should be within (or should have
-- started) their 30-day trial.
--
-- Diego's explicit decision (2026-08-12): backfill using each user's REAL
-- signup date (created_at), not a fresh 30 days from today — matches his
-- own framing ("desde la fecha en que se crean su cuenta"). A user who
-- signed up more than 30 days ago and never had trial_started_at set will
-- correctly land as an expired trial (free) under this backfill — that is
-- the intended, chosen behavior, not a bug.
--
-- Never touches paid subscribers (subscription_tier premium/pro) or anyone
-- who already has a trial_started_at — this only fills in the genuinely
-- missing case.
-- ============================================================================

UPDATE user_profiles
SET trial_started_at = created_at
WHERE trial_started_at IS NULL
  AND subscription_tier NOT IN ('premium', 'pro')
  AND created_at IS NOT NULL;
