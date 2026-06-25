-- User feedback prompts (7 days after signup, then once every 30 days)
ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS feedback_last_shown_at TIMESTAMPTZ DEFAULT NULL;

CREATE TABLE IF NOT EXISTS user_feedback (
    id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id    UUID        NOT NULL,
    rating     INTEGER     NOT NULL CHECK (rating BETWEEN 1 AND 5),
    message    TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
