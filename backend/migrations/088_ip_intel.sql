-- ============================================================================
-- 088_ip_intel.sql
--
-- Two additions for attack attribution in the standalone Nuvos Sentinel
-- monitor's technical panel:
--
-- 1. security_events (033) gains user_agent/accept_language — cheap, no
--    external API, written on every event by log_security_event().
-- 2. ip_intel_cache — geolocation/ISP/VPN/fraud data from IPQualityScore,
--    fetched LAZILY (only for IPs already involved in a flagged incident,
--    see app/services/ip_intel_service.py) and cached here so the same IP
--    is never looked up twice within its TTL — keeps this off the hot path
--    and off the free-tier quota during an actual attack burst.
-- ============================================================================

ALTER TABLE security_events ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS accept_language TEXT;

CREATE TABLE IF NOT EXISTS ip_intel_cache (
  ip_address    TEXT PRIMARY KEY,
  country       TEXT,
  region        TEXT,        -- state/province ("estado"/"región")
  city          TEXT,
  postal_code   TEXT,
  isp           TEXT,        -- "empresa que genera la conexión"
  organization  TEXT,
  asn           TEXT,
  connection_type TEXT,      -- 'Data Center' | 'Residential' | 'Mobile' | ... (IPQualityScore field)
  is_vpn        BOOLEAN,
  is_tor        BOOLEAN,
  is_proxy      BOOLEAN,
  fraud_score   INTEGER,     -- 0-100, IPQualityScore's own risk score
  raw           JSONB,       -- full provider response, for anything not modeled above
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Internal/admin-only, same pattern as security_events (033).
ALTER TABLE ip_intel_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: ip intel cache" ON ip_intel_cache;
CREATE POLICY "Service: ip intel cache" ON ip_intel_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);
