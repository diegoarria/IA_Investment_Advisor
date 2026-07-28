-- Migration 044: Phone number (E.164) collected at onboarding
-- Required going forward for outbound Vapi voice calls / SMS.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS phone_number TEXT;
