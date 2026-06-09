-- Cross-device nav/tab order sync
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS nav_order JSONB DEFAULT NULL;
