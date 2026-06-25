-- Track when a user first saw the broker call upsell offer.
-- Used to sync the 24-hour countdown across web and mobile.
-- Once set, never overwritten (first-seen wins).

ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS broker_offer_seen_at TIMESTAMPTZ DEFAULT NULL;
