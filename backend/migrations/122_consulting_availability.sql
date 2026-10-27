-- ============================================================================
-- 122_consulting_availability.sql
--
-- MY NUVOS self-service scheduling — "los estudiantes puedan agendar
-- sesiones en el calendario, y yo ver qué sesiones tengo próximamente."
--
-- consulting_availability is an instructor's RECURRING weekly pattern
-- (e.g. "martes 9am-1pm, slots de 50 min"), not individual slot rows —
-- open slots for the next 21 days are computed on read (backend/app/
-- api/routes/consulting.py GET /availability) by expanding this pattern
-- and subtracting already-booked consulting_sessions, so there is
-- nothing to keep in sync when an instructor changes their hours.
--
-- Times are stored as wall-clock TIME with no date/timezone component;
-- the whole platform assumes America/Mexico_City (same assumption
-- already baked into the approved MY NUVOS design mockups, which showed
-- session times in CST) — documented here once rather than per-column.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS consulting_availability (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  weekday       INT NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0=Monday .. 6=Sunday
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  slot_minutes  INT NOT NULL DEFAULT 50,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_consulting_availability_instructor ON consulting_availability(instructor_id);

ALTER TABLE consulting_availability ENABLE ROW LEVEL SECURITY;
-- Same deny-all stance as every other consulting_* table — service-role
-- only, real enforcement is the ownership check in the API routes
-- (an instructor only ever reads/writes their OWN availability rows).

COMMIT;
