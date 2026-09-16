-- Migration 099: Backfill has_seen_welcome_card for existing users.
--
-- Migration 098 added has_seen_welcome_card with DEFAULT false, which
-- applies to EVERY row, including accounts that existed long before the
-- welcome card feature shipped — so every existing user (Diego included)
-- started seeing it as if they were brand new, with a stale/irrelevant
-- trial_started_at from long ago driving the shown expiration date.
--
-- Confirmed live 2026-09-16: Diego saw his own account's old trial date
-- ("16 de septiembre") on a manual_comp permanent-premium account that
-- should never have a trial-expiration message at all.
--
-- This marks every account that already exists right now as "already
-- seen" — the card is meant for people signing up from today forward
-- only. Any row created AFTER this runs keeps has_seen_welcome_card's
-- column default (false) and sees the card exactly once, as intended.
UPDATE user_profiles
SET has_seen_welcome_card = true
WHERE has_seen_welcome_card = false;
