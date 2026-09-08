-- ============================================================================
-- 093_investment_discipline_reminder.sql
--
-- Diego, 2026-09-09 — new push category: a habit/discipline nudge on the
-- 1st and 15th of each month for users who stated a monthly_contribution
-- intent at onboarding. Deliberately framed as a guide, never a scold (see
-- job_investment_discipline_reminder in worker.py): real detection only
-- (checks investment_decisions for an actual logged "buy" this period,
-- never guesses), reinforces the habit when the user already invested,
-- and invites — never accuses — when they haven't yet.
--
-- Same pattern as 067_smart_alerts.sql's per-category toggles.
-- ============================================================================

ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS push_investment_reminder BOOLEAN DEFAULT true;
