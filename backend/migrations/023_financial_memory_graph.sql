-- Migration 023: Financial Memory Graph (FMG)
-- Permanent, intelligent financial memory for every user.
-- Never deletes historical data. Builds knowledge, not just records.

-- ── 1. Memories: beliefs, preferences, rules, lessons, biases ────────────────
CREATE TABLE IF NOT EXISTS fmg_memories (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type             TEXT NOT NULL
    CHECK (type IN ('belief','preference','rule','lesson','bias','goal','insight')),
  content          TEXT NOT NULL,
  source           TEXT NOT NULL DEFAULT 'conversation'
    CHECK (source IN ('conversation','behavior','manual','system')),
  confidence       REAL NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  times_reinforced INT  NOT NULL DEFAULT 1,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fmg_memories_user_active
  ON fmg_memories (user_id, is_active, type);

-- ── 2. Behavioral patterns with confidence evolution ─────────────────────────
CREATE TABLE IF NOT EXISTS fmg_behavioral_patterns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pattern_key       TEXT NOT NULL,      -- e.g. 'sells_during_drops', 'buys_after_rallies'
  description       TEXT NOT NULL,
  confidence        REAL NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  times_observed    INT  NOT NULL DEFAULT 1,
  is_positive       BOOLEAN NOT NULL DEFAULT FALSE,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, pattern_key)
);

CREATE INDEX IF NOT EXISTS idx_fmg_patterns_user
  ON fmg_behavioral_patterns (user_id, confidence DESC);

-- ── 3. Timeline events: milestones, emotional events, decisions ───────────────
CREATE TABLE IF NOT EXISTS fmg_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL
    CHECK (event_type IN (
      'milestone','emotional','decision','first_investment',
      'goal_achieved','goal_changed','pattern_detected','learning'
    )),
  title       TEXT NOT NULL,
  description TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fmg_events_user_time
  ON fmg_events (user_id, occurred_at DESC);

-- ── 4. Portfolio value snapshots (one per user per day) ──────────────────────
CREATE TABLE IF NOT EXISTS fmg_portfolio_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_date   DATE NOT NULL,
  total_value     REAL NOT NULL DEFAULT 0,
  positions_count INT  NOT NULL DEFAULT 0,
  top_sector      TEXT,
  sector_weights  JSONB NOT NULL DEFAULT '{}',   -- {"Tecnología": 0.42, ...}
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_fmg_snapshots_user_date
  ON fmg_portfolio_snapshots (user_id, snapshot_date DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE fmg_memories              ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmg_behavioral_patterns   ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmg_events                ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmg_portfolio_snapshots   ENABLE ROW LEVEL SECURITY;

CREATE POLICY fmg_memories_self ON fmg_memories
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY fmg_patterns_self ON fmg_behavioral_patterns
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY fmg_events_self ON fmg_events
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY fmg_snapshots_self ON fmg_portfolio_snapshots
  FOR ALL USING (user_id = auth.uid());
