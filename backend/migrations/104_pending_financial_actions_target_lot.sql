-- Migration 104: pending_financial_actions.target_lot_id
--
-- Extends the existing propose/confirm portfolio-transaction flow (migration
-- 103) to also cover corrections and deletions of an already-registered buy
-- lot ("me equivoqué, fueron 15 NVDA no 10" / "borra esa compra"). Lots now
-- carry a stable `id` (see add_buy_lot, sync.py) — this column is how a
-- pending UPDATE_TRANSACTION/DELETE_TRANSACTION action references which
-- lot it targets. NULL for the existing BUY_ASSET/SELL_ASSET action types,
-- which don't target an existing lot.
ALTER TABLE pending_financial_actions
  ADD COLUMN IF NOT EXISTS target_lot_id TEXT;
