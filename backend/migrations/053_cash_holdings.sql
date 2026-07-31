-- Migration 053: cash holdings
--
-- Lets a user record cash they hold outside of stock positions (CETES,
-- parked in a bank account, bonds, or something else) so it counts toward
-- their real total portfolio value — previously the portfolio total only
-- ever summed stock/crypto positions.

CREATE TABLE IF NOT EXISTS cash_holdings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount      NUMERIC NOT NULL CHECK (amount >= 0),
  currency    TEXT NOT NULL DEFAULT 'USD',
  instrument  TEXT NOT NULL DEFAULT 'other' CHECK (instrument IN ('cetes', 'bank', 'bonds', 'other')),
  label       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_holdings_user ON cash_holdings (user_id);

ALTER TABLE cash_holdings ENABLE ROW LEVEL SECURITY;

CREATE POLICY cash_holdings_self ON cash_holdings
  FOR ALL USING (user_id = auth.uid());
