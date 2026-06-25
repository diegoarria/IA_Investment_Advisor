-- Duo plan secondary account setup
ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS duo_secondary_email   TEXT     DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS duo_plan_purchased_at TIMESTAMPTZ DEFAULT NULL;
