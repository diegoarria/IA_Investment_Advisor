-- Migration 047: Drop the panic-sell streak ("Racha del Inversor")
-- Diego shipped this to Home, saw it live, and decided it didn't add real
-- value as a bare counter — cutting it entirely, same pattern as migration
-- 041's removal of the Investment Journal.
ALTER TABLE user_profiles
  DROP COLUMN IF EXISTS claimed_panic_streak_milestones;
