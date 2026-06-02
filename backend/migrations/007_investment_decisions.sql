-- Migration 007: investment decisions diary
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS investment_decisions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   TEXT NOT NULL,
  action                    TEXT NOT NULL,   -- buy | sell | hold | ignored_alert | acted_on_alert
  ticker                    TEXT NOT NULL,
  trigger                   TEXT,            -- manual | alert | mentor | fomo | panic | research
  notes                     TEXT,
  price_at_action           NUMERIC(12, 4),
  portfolio_value_at_action NUMERIC(14, 2),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decisions_user_id   ON investment_decisions (user_id);
CREATE INDEX IF NOT EXISTS idx_decisions_ticker     ON investment_decisions (ticker);
CREATE INDEX IF NOT EXISTS idx_decisions_created_at ON investment_decisions (created_at DESC);
