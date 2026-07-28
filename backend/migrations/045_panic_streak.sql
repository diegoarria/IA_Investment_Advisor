-- Migration 045: Panic-sell streak milestones
-- Tracks which milestones the user has claimed for the "days without
-- selling on a red market day" streak. The streak itself is computed at
-- read time from investment_decisions + SPY history — nothing to store
-- for the count. Reuses the existing streak_bonus_premium_until column
-- (already used by the Academy learning streak and referrals) as the
-- shared "you currently have bonus premium" pool.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS claimed_panic_streak_milestones JSONB DEFAULT '[]'::jsonb;
