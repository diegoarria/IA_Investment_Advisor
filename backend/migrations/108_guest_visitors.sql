-- Migration 108: anonymous visitor ("invitado") tracking — Diego, 2026-09-27:
-- "No se puede identificar si hay personas que entran a la web app sin
-- cuenta?? A chatear con Arthur?" — scoped to ONLY what can legitimately be
-- known about someone without an account: an anonymous per-browser id,
-- approximate location (country/region/city from Vercel's edge, the IP
-- itself is never stored), device/browser/OS, where they came from
-- (referrer + UTM), what they viewed and what they asked Arthur.
-- No name/email/phone, no fingerprinting. Service-role only (RLS on, no policies).

CREATE TABLE IF NOT EXISTS guest_visitors (
  guest_id        TEXT PRIMARY KEY,
  first_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
  country         TEXT,
  region          TEXT,
  city            TEXT,
  device          TEXT,
  browser         TEXT,
  os              TEXT,
  referrer        TEXT,
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  landing_path    TEXT,
  last_path       TEXT,
  pageviews       INTEGER NOT NULL DEFAULT 0,
  chat_messages   INTEGER NOT NULL DEFAULT 0,
  hit_chat_limit  BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS guest_visitors_last_seen_idx ON guest_visitors (last_seen DESC);
ALTER TABLE guest_visitors ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS guest_chat_messages (
  id          BIGSERIAL PRIMARY KEY,
  guest_id    TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guest_chat_messages_guest_idx ON guest_chat_messages (guest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS guest_chat_messages_created_idx ON guest_chat_messages (created_at DESC);
ALTER TABLE guest_chat_messages ENABLE ROW LEVEL SECURITY;

-- Atomic upsert + counter increment (PostgREST can't do "+1" on conflict).
-- First-touch fields (location, device, source, landing) are kept from the
-- first visit; only last_seen/last_path/pageviews move afterwards.
CREATE OR REPLACE FUNCTION track_guest_visit(
  p_guest_id TEXT, p_path TEXT, p_country TEXT, p_region TEXT, p_city TEXT,
  p_device TEXT, p_browser TEXT, p_os TEXT, p_referrer TEXT,
  p_utm_source TEXT, p_utm_medium TEXT, p_utm_campaign TEXT
) RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO guest_visitors (guest_id, country, region, city, device, browser, os, referrer,
                              utm_source, utm_medium, utm_campaign, landing_path, last_path, pageviews)
  VALUES (p_guest_id, p_country, p_region, p_city, p_device, p_browser, p_os, p_referrer,
          p_utm_source, p_utm_medium, p_utm_campaign, p_path, p_path, 1)
  ON CONFLICT (guest_id) DO UPDATE SET
    last_seen    = now(),
    last_path    = COALESCE(EXCLUDED.last_path, guest_visitors.last_path),
    pageviews    = guest_visitors.pageviews + 1,
    country      = COALESCE(guest_visitors.country, EXCLUDED.country),
    region       = COALESCE(guest_visitors.region, EXCLUDED.region),
    city         = COALESCE(guest_visitors.city, EXCLUDED.city),
    device       = COALESCE(guest_visitors.device, EXCLUDED.device),
    browser      = COALESCE(guest_visitors.browser, EXCLUDED.browser),
    os           = COALESCE(guest_visitors.os, EXCLUDED.os),
    referrer     = COALESCE(guest_visitors.referrer, EXCLUDED.referrer),
    utm_source   = COALESCE(guest_visitors.utm_source, EXCLUDED.utm_source),
    utm_medium   = COALESCE(guest_visitors.utm_medium, EXCLUDED.utm_medium),
    utm_campaign = COALESCE(guest_visitors.utm_campaign, EXCLUDED.utm_campaign);
$$;

CREATE OR REPLACE FUNCTION record_guest_chat(p_guest_id TEXT, p_message TEXT, p_hit_limit BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO guest_visitors (guest_id) VALUES (p_guest_id) ON CONFLICT (guest_id) DO NOTHING;
  IF p_hit_limit THEN
    UPDATE guest_visitors SET hit_chat_limit = TRUE, last_seen = now() WHERE guest_id = p_guest_id;
  ELSE
    INSERT INTO guest_chat_messages (guest_id, message) VALUES (p_guest_id, left(p_message, 2000));
    UPDATE guest_visitors SET chat_messages = chat_messages + 1, last_seen = now() WHERE guest_id = p_guest_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION track_guest_visit(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_guest_chat(TEXT,TEXT,BOOLEAN) FROM PUBLIC, anon, authenticated;
