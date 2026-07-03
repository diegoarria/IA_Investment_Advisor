-- Migration 022: Extended onboarding profile fields
-- Adds country, initial_capital, has_broker, broker_name, has_investments
-- to user_profiles for richer personalization and AI context.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS country          TEXT,
  ADD COLUMN IF NOT EXISTS initial_capital  TEXT,
  ADD COLUMN IF NOT EXISTS has_broker       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS broker_name      TEXT,
  ADD COLUMN IF NOT EXISTS has_investments  BOOLEAN DEFAULT FALSE;
