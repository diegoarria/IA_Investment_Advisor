-- Migration 113: idempotency key for cash_holdings inserts
--
-- "Agregar efectivo" had no protection against a double-submit (double
-- click, or the frontend's own 3x retry racing a request that actually
-- already succeeded) creating two rows for the same add. The client now
-- sends a stable client-generated UUID per add attempt; a unique
-- constraint on (user_id, client_id) makes a repeated POST with the same
-- key a no-op instead of a duplicate holding. NULL client_id (older
-- clients) is unconstrained, same as before.

ALTER TABLE cash_holdings ADD COLUMN IF NOT EXISTS client_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_holdings_user_client
  ON cash_holdings (user_id, client_id)
  WHERE client_id IS NOT NULL;
