-- ============================================================================
-- 119_consulting_schema.sql
--
-- MY NUVOS (Nuvos Consulting, learn.nuvosai.com) — core schema, approved
-- 2026-10-26 after the architecture review in this session (auditoría +
-- plan). 14 tables, every one prefixed consulting_, zero ALTER on any
-- existing Nuvos AI table. Deliberately isolated: nothing here joins
-- against user_profiles, subscription_tier, or any investing-app table —
-- a MY NUVOS participant's role/profile lives entirely in these tables,
-- keyed only off auth.users(id) (the one piece of infra both products
-- share).
--
-- RLS: every table gets ENABLE ROW LEVEL SECURITY with NO policy — same
-- deny-all pattern as subscription_audit_log/system_event_log (migrations
-- 117/118). This is a defense-in-depth backstop, not the primary control:
-- the backend always calls Supabase with the service-role key (bypasses
-- RLS), so real enforcement is the ownership filter in each FastAPI route
-- (app/api/routes/consulting.py) — see that file's _require_consulting_role
-- and the explicit enrollment_id/user_id filters on every query.
--
-- Idempotent: every statement is CREATE ... IF NOT EXISTS.
-- ============================================================================

BEGIN;

-- ── Identidad y rol ──────────────────────────────────────────────────────
-- Deliberately NOT user_profiles.is_admin (unused dead column) or
-- settings.admin_emails (that's Nuvos AI's platform-ops allowlist) — a
-- program_admin here has zero access to investing-app data by construction.
CREATE TABLE IF NOT EXISTS consulting_user_roles (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('student','instructor','program_admin')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consulting_programs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  description      TEXT,
  duration_months  INT NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consulting_cohorts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES consulting_programs(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,            -- "Cohorte Enero 2026"
  starts_at  DATE NOT NULL,
  ends_at    DATE
);

CREATE TABLE IF NOT EXISTS consulting_modules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id  UUID NOT NULL REFERENCES consulting_programs(id) ON DELETE CASCADE,
  order_index INT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT
);

-- = inscripción + "perfil" del alumno en este programa (fusionado con lo
-- que la propuesta original llamaba student_learning_profiles — mismo
-- registro, no amerita join).
CREATE TABLE IF NOT EXISTS consulting_enrollments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cohort_id         UUID NOT NULL REFERENCES consulting_cohorts(id) ON DELETE CASCADE,
  instructor_id     UUID REFERENCES auth.users(id),
  status            TEXT DEFAULT 'active' CHECK (status IN ('active','graduated','withdrawn')),
  current_module_id UUID REFERENCES consulting_modules(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, cohort_id)
);

-- Includes what the original proposal called session_reports — a
-- session's post-session notes are 1:1 with the session, not a join.
CREATE TABLE IF NOT EXISTS consulting_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES consulting_enrollments(id) ON DELETE CASCADE,
  scheduled_at  TIMESTAMPTZ NOT NULL,
  mode          TEXT DEFAULT 'video',
  status        TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','canceled')),
  agenda        TEXT,
  notes         TEXT
);

CREATE TABLE IF NOT EXISTS consulting_attendance (
  session_id    UUID NOT NULL REFERENCES consulting_sessions(id) ON DELETE CASCADE,
  enrollment_id UUID NOT NULL REFERENCES consulting_enrollments(id) ON DELETE CASCADE,
  attended      BOOLEAN,
  PRIMARY KEY (session_id, enrollment_id)
);

CREATE TABLE IF NOT EXISTS consulting_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id       UUID NOT NULL REFERENCES consulting_modules(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  due_offset_days INT  -- días desde que el alumno entra al módulo
);

CREATE TABLE IF NOT EXISTS consulting_submissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES consulting_assignments(id) ON DELETE CASCADE,
  enrollment_id UUID NOT NULL REFERENCES consulting_enrollments(id) ON DELETE CASCADE,
  storage_path  TEXT,   -- object key in the private consulting-documents bucket
  submitted_at  TIMESTAMPTZ DEFAULT NOW(),
  feedback      TEXT,
  reviewed_by   UUID REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS consulting_competencies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES consulting_programs(id) ON DELETE CASCADE,
  name       TEXT NOT NULL   -- "Delegación estratégica"
);

CREATE TABLE IF NOT EXISTS consulting_assessments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id  UUID NOT NULL REFERENCES consulting_enrollments(id) ON DELETE CASCADE,
  competency_id  UUID NOT NULL REFERENCES consulting_competencies(id) ON DELETE CASCADE,
  level          TEXT CHECK (level IN ('inicial','en_desarrollo','solido','dominado')),
  observation    TEXT,
  assessed_by    UUID REFERENCES auth.users(id),
  assessed_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consulting_resources (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id    UUID REFERENCES consulting_modules(id) ON DELETE CASCADE,
  type         TEXT CHECK (type IN ('lectura','video','plantilla','caso_estudio')),
  title        TEXT NOT NULL,
  storage_path TEXT   -- NULL si es un link externo
);

CREATE TABLE IF NOT EXISTS consulting_final_projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID UNIQUE NOT NULL REFERENCES consulting_enrollments(id) ON DELETE CASCADE,
  title         TEXT,
  summary       TEXT,
  status        TEXT DEFAULT 'proposed',
  due_at        TIMESTAMPTZ,
  storage_path  TEXT
);

CREATE TABLE IF NOT EXISTS consulting_graduations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id            UUID UNIQUE NOT NULL REFERENCES consulting_enrollments(id) ON DELETE CASCADE,
  completed_at             TIMESTAMPTZ,
  certificate_storage_path TEXT
);

-- Same fire-and-forget audit pattern as subscription_audit_log/
-- system_event_log (migrations 117/118) — see app/services/consulting_audit.py.
CREATE TABLE IF NOT EXISTS consulting_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor         TEXT NOT NULL,
  action        TEXT NOT NULL,
  enrollment_id UUID,
  detail        TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_consulting_cohorts_program        ON consulting_cohorts(program_id);
CREATE INDEX IF NOT EXISTS idx_consulting_modules_program        ON consulting_modules(program_id, order_index);
CREATE INDEX IF NOT EXISTS idx_consulting_enrollments_user       ON consulting_enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_consulting_enrollments_cohort     ON consulting_enrollments(cohort_id);
CREATE INDEX IF NOT EXISTS idx_consulting_enrollments_instructor ON consulting_enrollments(instructor_id);
CREATE INDEX IF NOT EXISTS idx_consulting_sessions_enrollment    ON consulting_sessions(enrollment_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_consulting_assignments_module     ON consulting_assignments(module_id);
CREATE INDEX IF NOT EXISTS idx_consulting_submissions_enrollment ON consulting_submissions(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_consulting_submissions_assignment ON consulting_submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_consulting_assessments_enrollment ON consulting_assessments(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_consulting_resources_module       ON consulting_resources(module_id);
CREATE INDEX IF NOT EXISTS idx_consulting_audit_enrollment       ON consulting_audit_log(enrollment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consulting_audit_created          ON consulting_audit_log(created_at DESC);

-- ── RLS: enabled, deny-all for anon/authenticated — service-role only ────
ALTER TABLE consulting_user_roles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE consulting_programs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE consulting_cohorts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE consulting_modules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE consulting_enrollments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE consulting_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE consulting_attendance     ENABLE ROW LEVEL SECURITY;
ALTER TABLE consulting_assignments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE consulting_submissions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE consulting_competencies   ENABLE ROW LEVEL SECURITY;
ALTER TABLE consulting_assessments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE consulting_resources      ENABLE ROW LEVEL SECURITY;
ALTER TABLE consulting_final_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE consulting_graduations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE consulting_audit_log      ENABLE ROW LEVEL SECURITY;

COMMIT;
