-- Migration 072: Belvo-sourced cash holdings
--
-- cash_holdings is one row per holding (not an overwrite-the-whole-array
-- blob like user_portfolio), so a Belvo sync job can safely upsert on
-- (user_id, belvo_account_id) and only ever touch its own rows — manual
-- rows (belvo_account_id IS NULL) are never affected. See
-- backend/app/api/routes/belvo.py and the plan at
-- /Users/diegoarria/.claude/plans/cosmic-munching-crown.md, section 1.
--
-- cash_holdings.user_id already has ON DELETE CASCADE to auth.users
-- (migration 053), so Belvo-sourced rows are cleaned up on account
-- deletion with no further changes needed.

ALTER TABLE cash_holdings
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'belvo')),
  ADD COLUMN IF NOT EXISTS belvo_connection_id UUID REFERENCES brokerage_connections(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS belvo_account_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS cash_holdings_belvo_account_uidx
  ON cash_holdings (user_id, belvo_account_id)
  WHERE belvo_account_id IS NOT NULL;
