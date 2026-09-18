-- Migration 103: pending_financial_actions
--
-- Backs Arthur's natural-language portfolio-transaction feature ("Compré
-- $200 de Google a $340"). Arthur's tool-calling loop is stateless between
-- user messages, so the "propose" step (parse the message into a
-- structured action, show a confirmation summary) needs somewhere durable
-- to hold that proposal until the user's NEXT message confirms or cancels
-- it — this table is that holding place, not a transaction ledger (the
-- real write still goes through user_portfolio via
-- apply_portfolio_positions in sync.py, reused as-is).
--
-- status transitions: pending -> applied | cancelled | expired.
-- A partial unique index enforces at most one 'pending' row per dedup_key,
-- so a duplicate/retried tool call from the same reported transaction
-- can't spawn two separate proposals (idempotency at the propose step;
-- applying twice is separately guarded by re-reading current shares at
-- confirm time).
CREATE TABLE IF NOT EXISTS pending_financial_actions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT NOT NULL,
  action_type      TEXT NOT NULL,              -- BUY_ASSET | SELL_ASSET
  portfolio_id     TEXT NOT NULL DEFAULT 'default',
  ticker           TEXT NOT NULL,
  quantity         NUMERIC(18, 6),
  amount           NUMERIC(14, 2),
  execution_price  NUMERIC(14, 4) NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'USD',
  transaction_date DATE NOT NULL,
  notes            TEXT,
  raw_message      TEXT,                       -- the user's own words, for audit
  preview          JSONB,                      -- computed shares/avg-cost preview shown to the user
  dedup_key        TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  source           TEXT NOT NULL DEFAULT 'USER_REPORTED_VIA_ARTHUR',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at       TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pfa_user_status ON pending_financial_actions (user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pfa_dedup_pending
  ON pending_financial_actions (dedup_key) WHERE status = 'pending';

-- user_id here is `text` (matches investment_decisions/user_portfolio), not
-- `uuid` — same cast convention as migration 019.
ALTER TABLE pending_financial_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own pending financial actions" ON pending_financial_actions
  FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY "Service: pending financial actions" ON pending_financial_actions
  FOR ALL TO service_role USING (true);
