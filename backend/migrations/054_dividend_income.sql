-- Migration 054: dividend income ledger
--
-- Records dividend payments the user actually received on positions they
-- held on the payment date — worker.py's existing dividend-notification job
-- (which already fetches per-share amounts and knows who holds what) writes
-- one row here the day a dividend is paid, computed as shares_held *
-- per_share_amount. This is forward-tracking only: dividends paid before
-- this feature shipped are never backfilled/guessed, since we have no
-- reliable record of exactly how many shares the user held on past payment
-- dates.

CREATE TABLE IF NOT EXISTS dividend_income (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker            TEXT NOT NULL,
  pay_date          DATE NOT NULL,
  shares_at_payment NUMERIC NOT NULL,
  per_share_amount  NUMERIC NOT NULL,
  amount            NUMERIC NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'USD',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, ticker, pay_date)
);

CREATE INDEX IF NOT EXISTS idx_dividend_income_user ON dividend_income (user_id);

ALTER TABLE dividend_income ENABLE ROW LEVEL SECURITY;

CREATE POLICY dividend_income_self ON dividend_income
  FOR ALL USING (user_id = auth.uid());
