-- Migration 004: paper_alias for leaderboard
-- Run in Supabase SQL Editor

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS paper_alias TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_paper_alias
  ON user_profiles (paper_alias)
  WHERE paper_alias IS NOT NULL;
