-- ============================================================================
-- 077_wrapped_longest_streak.sql
--
-- Nuvos Wrapped's "racha más larga" screen needs a historical maximum, but
-- user_profiles.streak_count is overwritten every day (current streak
-- only) — there's no daily-activity log to reconstruct past streaks from,
-- so history before this migration is genuinely unrecoverable. New column
-- starts at today's current streak as a floor, then app/api/routes/learn.py
-- keeps it as a running max going forward.
-- ============================================================================

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS longest_streak_count integer NOT NULL DEFAULT 0;

UPDATE user_profiles
  SET longest_streak_count = COALESCE(streak_count, 0)
  WHERE longest_streak_count < COALESCE(streak_count, 0);
