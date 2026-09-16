-- Migration 098: Premium welcome card — shown exactly once, right after
-- onboarding, announcing the 30-day free trial. Persisted server-side
-- (not localStorage) so it can genuinely never show again on any other
-- device, browser, or reinstall — Diego, 2026-09-16: "esto solo sale 1
-- vez en la vida y punto".
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS has_seen_welcome_card BOOLEAN NOT NULL DEFAULT false;
