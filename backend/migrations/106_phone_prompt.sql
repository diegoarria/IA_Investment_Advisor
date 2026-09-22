-- Migration 106: one-time "add your phone number" prompt for EXISTING
-- users (new users already get asked during onboarding's phone step).
-- Diego, 2026-09-24: phone_number (along with `country`) is what
-- app/core/pricing_region.py's is_mexico() uses to decide whether to show
-- the MXN Stripe price instead of USD — Mexican debit cards frequently
-- decline USD charges, so a user this misses can genuinely fail to pay.
-- Persisted server-side (not localStorage), same "never twice, on any
-- device" pattern as has_seen_welcome_card (migration 098) — shown once
-- ever, whether the user fills it in or dismisses it.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS has_seen_phone_prompt BOOLEAN NOT NULL DEFAULT false;

-- Existing users who already have a phone number on file (from onboarding,
-- or manually added since) have nothing to gain from this prompt — mark
-- them as already-seen so it doesn't ask people who already answered.
UPDATE user_profiles
  SET has_seen_phone_prompt = true
  WHERE phone_number IS NOT NULL AND phone_number != '';
