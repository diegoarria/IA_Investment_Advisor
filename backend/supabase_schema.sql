-- Nuvo — Supabase Schema
-- Run the FULL script in the Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- ─── Drop old tables (safe if no real user data yet) ──────────────────────────
DROP TABLE IF EXISTS user_profiles CASCADE;

-- ─── User profiles ────────────────────────────────────────────────────────────
CREATE TABLE user_profiles (
    id                   UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id              UUID    REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
    name                 TEXT    NOT NULL DEFAULT '',
    birth_date           TEXT    NOT NULL DEFAULT '',
    monthly_income       TEXT    NOT NULL DEFAULT '0',
    monthly_contribution TEXT    NOT NULL DEFAULT '0',
    risk_tolerance       TEXT    NOT NULL DEFAULT 'moderate',
    quiz_answers         JSONB   NOT NULL DEFAULT '{}',
    mentor               TEXT,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Chat history ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_history (
    id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role       VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant')),
    content    TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Notifications ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id         UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id    UUID    REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    type       VARCHAR(30)  NOT NULL,
    title      VARCHAR(200) NOT NULL,
    message    TEXT         NOT NULL,
    data       JSONB        DEFAULT '{}',
    read       BOOLEAN      DEFAULT FALSE,
    created_at TIMESTAMPTZ  DEFAULT NOW()
);

-- ─── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE user_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications  ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data
CREATE POLICY "Users own profile"       ON user_profiles  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own chat"          ON chat_history   FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own notifications" ON notifications  FOR ALL USING (auth.uid() = user_id);

-- Backend service role bypasses RLS
CREATE POLICY "Service: profiles"       ON user_profiles  FOR ALL TO service_role USING (true);
CREATE POLICY "Service: chat"           ON chat_history   FOR ALL TO service_role USING (true);
CREATE POLICY "Service: notifications"  ON notifications  FOR ALL TO service_role USING (true);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_chat_user       ON chat_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_user      ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_unread    ON notifications(user_id, read) WHERE read = FALSE;

-- ─── Auto-update updated_at ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON user_profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
