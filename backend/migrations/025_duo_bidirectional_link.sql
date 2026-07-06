-- Migration 025: Duo Plan bidirectional link
-- Today only the primary account knows the secondary's email
-- (duo_secondary_email). The secondary has no way to know who invited them.
-- Adds a two-way link so either side can look up its partner directly.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS duo_primary_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS duo_secondary_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
