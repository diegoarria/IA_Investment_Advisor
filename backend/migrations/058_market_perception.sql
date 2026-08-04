-- Migration 058: Shortened onboarding — "¿qué has escuchado de la bolsa?"
-- The new short onboarding replaces the old required risk quiz / income /
-- broker questions with a single optional multi-select ("la bolsa es un
-- casino", "solo para gente de dinero", "hay que ser experto", "ya invierto
-- con broker", "otro" con texto libre). Stored as an array of option keys
-- plus free text for "otro" — everything else the old onboarding used to
-- collect up front now gets filled in later (profile edits, or Arthur saving
-- it mid-conversation via the update_profile tool).
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS market_perception TEXT[],
  ADD COLUMN IF NOT EXISTS market_perception_other TEXT;
