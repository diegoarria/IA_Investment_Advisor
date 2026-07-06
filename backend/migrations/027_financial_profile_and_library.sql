-- Migration 027: structured Financial Profile + Personal Financial Library
-- Promotes the fields every agent/habit job actually reads out of the
-- quiz_answers JSONB blob into typed, queryable columns, and adds the
-- permanent library (saved analyses, notes, theses, uploads).

-- ── 1. Structured profile fields (additive, non-breaking) ────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS net_worth_usd                NUMERIC,
  ADD COLUMN IF NOT EXISTS monthly_expenses_usd         NUMERIC,
  ADD COLUMN IF NOT EXISTS currency                     TEXT DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS preferred_language            TEXT DEFAULT 'es',
  ADD COLUMN IF NOT EXISTS investing_style               TEXT
    CHECK (investing_style IN ('value','growth','dividend','index','momentum','not_set'))
    DEFAULT 'not_set',
  ADD COLUMN IF NOT EXISTS time_horizon_years            INT,
  ADD COLUMN IF NOT EXISTS financial_freedom_target_usd  NUMERIC;

-- ── 2. Financial goals — 1:many, don't cram into a column ────────────────────
CREATE TABLE IF NOT EXISTS user_financial_goals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_type    TEXT NOT NULL CHECK (goal_type IN ('retirement','house','freedom_number','education','emergency_fund','custom')),
  label        TEXT,
  target_usd   NUMERIC,
  target_date  DATE,
  is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_financial_goals_user ON user_financial_goals (user_id);

-- ── 3. Sector preferences — declared + behavior-inferred weight ──────────────
CREATE TABLE IF NOT EXISTS user_sector_preferences (
  user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sector   TEXT NOT NULL,
  weight   REAL NOT NULL DEFAULT 1.0,
  source   TEXT NOT NULL DEFAULT 'declared' CHECK (source IN ('declared','inferred')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, sector)
);

-- ── 4. Personal Financial Library ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS library_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_type    TEXT NOT NULL CHECK (item_type IN
                 ('analysis','note','thesis','earnings_summary','upload','bookmark')),
  ticker       TEXT,
  title        TEXT NOT NULL,
  body         TEXT,
  source       TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','ai')),
  file_url     TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_library_user_ticker ON library_items (user_id, ticker);
CREATE INDEX IF NOT EXISTS idx_library_user_type   ON library_items (user_id, item_type);
CREATE INDEX IF NOT EXISTS idx_library_user_created ON library_items (user_id, created_at DESC);

-- ── 5. Habit engagement (streaks, ritual completion) ──────────────────────────
CREATE TABLE IF NOT EXISTS habit_engagement (
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ritual_key   TEXT NOT NULL,
  date         DATE NOT NULL,
  opened_at    TIMESTAMPTZ,
  PRIMARY KEY (user_id, ritual_key, date)
);

-- ── RLS ────────────────────────────────────────────────────────────────────────
ALTER TABLE user_financial_goals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sector_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE habit_engagement        ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_financial_goals_self    ON user_financial_goals    FOR ALL USING (user_id = auth.uid());
CREATE POLICY user_sector_preferences_self ON user_sector_preferences FOR ALL USING (user_id = auth.uid());
CREATE POLICY library_items_self           ON library_items           FOR ALL USING (user_id = auth.uid());
CREATE POLICY habit_engagement_self        ON habit_engagement        FOR ALL USING (user_id = auth.uid());
