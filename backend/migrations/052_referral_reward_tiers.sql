-- Migration 052: tiered referral rewards
--
-- The referral program used to pay a flat 14 days to the referrer on every
-- successful referral, uncapped. Replaced with 3 one-time milestone tiers:
--   1 friend  -> +14 days premium
--   2 friends -> +14 days premium, +1 free 1:1 session
--   3 friends -> +30 days premium, +1 free 1:1 session, +1 free deep research
-- referral_reward_tier tracks the highest tier already paid out, so a
-- referrer's count passing a threshold only pays that tier once.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS referral_reward_tier INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_1on1_sessions INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_deep_research_credits INTEGER NOT NULL DEFAULT 0;
