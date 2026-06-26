-- Streak milestone rewards
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS claimed_streak_milestones int[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS streak_bonus_premium_until timestamptz;
