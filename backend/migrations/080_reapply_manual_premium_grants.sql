-- ============================================================================
-- 080_reapply_manual_premium_grants.sql
--
-- Re-applies migration 079's permanent-premium grant for the same 3 users.
-- Root cause of why it didn't stick (Diego, 2026-08-20): the Stripe
-- webhook handler downgraded ANY profile matching a stray
-- stripe_customer_id back to subscription_tier='free', with no awareness
-- that subscription_source='manual_comp' rows aren't real Stripe
-- subscribers — fixed separately in app/api/routes/billing.py
-- (_downgrade_by_customer_id now excludes manual_comp rows). This
-- migration just restores the 3 accounts to premium now that the webhook
-- can no longer undo it.
-- ============================================================================

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
