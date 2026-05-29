-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 001: User data sync tables
-- Run this in your Supabase SQL editor (Dashboard → SQL Editor → New query)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Portfolio positions (replaces AsyncStorage-only storage)
CREATE TABLE IF NOT EXISTS user_portfolio (
  user_id     text        PRIMARY KEY,
  positions   jsonb       NOT NULL DEFAULT '[]',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. Paper trading state
CREATE TABLE IF NOT EXISTS user_paper_trading (
  user_id           text        PRIMARY KEY,
  cash              float8      NOT NULL DEFAULT 10000,
  positions         jsonb       NOT NULL DEFAULT '[]',
  trades            jsonb       NOT NULL DEFAULT '[]',
  free_trade_month  text,
  free_trade_count  int         NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- 3. Daily usage counters (replaces in-memory dicts that reset on server restart)
CREATE TABLE IF NOT EXISTS user_daily_usage (
  user_id       text NOT NULL,
  date          date NOT NULL,
  sim_count     int  NOT NULL DEFAULT 0,
  debate_count  int  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

-- 4. Add trial + maturity columns to existing user_profiles
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS trial_started_at  timestamptz,
  ADD COLUMN IF NOT EXISTS maturity_score    int         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS maturity_history  jsonb       NOT NULL DEFAULT '[]';

-- 5. Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_daily_usage_user_date
  ON user_daily_usage (user_id, date DESC);
