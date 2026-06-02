-- Migration 005: referral program
-- Run in Supabase SQL Editor

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS referral_code  TEXT,
  ADD COLUMN IF NOT EXISTS referred_by    TEXT,
  ADD COLUMN IF NOT EXISTS referred_count INTEGER DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_referral_code
  ON user_profiles (referral_code)
  WHERE referral_code IS NOT NULL;
