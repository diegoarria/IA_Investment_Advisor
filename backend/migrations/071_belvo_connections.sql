-- Migration 071: Belvo support on brokerage_connections
--
-- Belvo (LatAm open banking — bank accounts + brokerage aggregation,
-- starting with Mexico) becomes provider #3 on the existing
-- brokerage_connections table (Plaid, IOL, now Belvo), see
-- backend/app/api/routes/brokerage.py and backend/app/api/routes/belvo.py.
--
-- Unlike Plaid/IOL, Belvo doesn't hand the backend a per-link bearer
-- token — the backend authenticates to Belvo server-to-server via
-- secret_id/secret_password (config.py) for every call, and the link
-- itself is identified by Belvo's own belvo_link_id. access_token's
-- NOT NULL is dropped so Belvo rows can leave it null rather than
-- storing a fake placeholder value.

ALTER TABLE brokerage_connections
  ADD COLUMN IF NOT EXISTS belvo_link_id TEXT,
  ADD COLUMN IF NOT EXISTS belvo_category TEXT,          -- 'banking' | 'investment' — Belvo's own distinction
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'valid',  -- 'valid' | 'token_required' | 'login_error' | 'unlinked'
  ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;

ALTER TABLE brokerage_connections
  ALTER COLUMN access_token DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_brokerage_connections_belvo_link_id
  ON brokerage_connections (belvo_link_id)
  WHERE belvo_link_id IS NOT NULL;
