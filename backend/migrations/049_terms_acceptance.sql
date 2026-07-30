-- Migration 049: Record legal acceptance at onboarding
-- The onboarding form was already collecting terms_accepted_at/terms_version
-- and sending them to POST /profile, but the backend silently dropped both
-- fields (no columns existed yet) — so there was no server-side record that
-- any user had ever accepted the Terms of Use / investment-advice disclaimer.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_version TEXT;
