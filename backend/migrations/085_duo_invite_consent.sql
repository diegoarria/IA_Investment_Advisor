-- Migration 085: Duo Plan invite consent
--
-- Security audit, Sep 2026: duo-setup used to immediately grant the
-- secondary account premium AND link them into a pairing that exposes
-- their investing-progress data to the primary (GET /duo-partner) — with
-- no consent step from the secondary at all. This adds a pending/accepted
-- state so the secondary must explicitly accept before anything is
-- granted or shared.
--
-- duo_invite_status lives on the PRIMARY's row (same place
-- duo_secondary_email/duo_secondary_user_id already live):
--   NULL      — no active invite
--   'pending' — primary invited, secondary hasn't responded yet
--   'accepted'— secondary accepted; premium granted, pairing visible both ways
--
-- No 'declined' state is stored — a decline just resets duo_secondary_email/
-- duo_secondary_user_id/duo_invite_status back to NULL so the primary can
-- invite someone else, same as when Stripe cancels/reassigns a pairing.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS duo_invite_status TEXT DEFAULT NULL
    CHECK (duo_invite_status IS NULL OR duo_invite_status IN ('pending', 'accepted'));
