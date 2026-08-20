-- ============================================================================
-- 079_manual_premium_grants.sql
--
-- Grants permanent premium to a small, explicit list of users (Diego,
-- 2026-08-20) — not a paid Stripe subscription, not a trial, not the
-- time-limited streak/referral bonus (streak_bonus_premium_until).
--
-- subscription_tier = 'premium' alone is already permanent: is_premium_active()
-- (backend/app/core/subscription.py) treats tier premium/pro as always-on,
-- with no linked expiry column, and Stripe's webhooks are the only thing
-- that ever sets it back to 'free' (backend/app/api/routes/billing.py).
-- These users have no stripe_customer_id, so no webhook will ever touch
-- their tier — this grant is durable by construction.
--
-- Adds subscription_source so a manually comp'd user can be told apart
-- from a real Stripe subscriber later (billing/reporting, admin views) —
-- no such column existed before this migration; every existing premium/pro
-- row predates it and is left NULL rather than guessed at, since we can't
-- retroactively know which of those were Stripe vs. some other manual
-- grant made before this column existed.
-- ============================================================================

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS subscription_source text,
  ADD COLUMN IF NOT EXISTS premium_granted_at timestamptz;

UPDATE user_profiles
SET subscription_tier     = 'premium',
    subscription_source   = 'manual_comp',
    premium_granted_at    = now()
WHERE user_id IN (
  SELECT id FROM auth.users
  WHERE email IN (
    'diego.arria19@gmail.com',
    'melissa.arria@911-pymes.com',
    'rarria13@gmail.com'
  )
);
