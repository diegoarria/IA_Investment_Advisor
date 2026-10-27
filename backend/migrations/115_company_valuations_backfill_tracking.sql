-- Migration 115: resumable-backfill tracking columns for company_valuations.
--
-- Purely additive (nullable columns, no data migration, no RLS change) —
-- the existing live read path (get_persisted_valuation, the
-- /company-diagnostic route) never reads these, so this cannot change
-- any existing behavior. Exists only so the new backfill job
-- (job_backfill_company_valuations_batch, worker.py) can tell "never
-- attempted" apart from "attempted recently and failed, back off before
-- retrying" apart from "attempted long enough ago, eligible for retry"
-- without re-deriving that from the `failed` history rows on every tick
-- (which would mean an unbounded, ever-growing table scan as history
-- accumulates).
--
-- Rollback: DROP COLUMN each of these three — no CHECK/index/function
-- depends on them, so this is safe to revert at any time without
-- touching the migration-114 schema it builds on.

ALTER TABLE company_valuations
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

-- Only ever read against the current row per ticker — same partial-index
-- shape as migration 114's own idx_company_valuations_current.
CREATE INDEX IF NOT EXISTS idx_company_valuations_current_retry
  ON company_valuations (next_retry_at) WHERE is_current;
