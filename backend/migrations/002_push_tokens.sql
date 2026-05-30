-- Migration 002: Push notification tokens
-- Run in Supabase SQL Editor

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS push_token text;
