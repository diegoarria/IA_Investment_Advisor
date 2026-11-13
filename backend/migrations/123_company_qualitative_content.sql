-- Migration 123: company_qualitative_content — Nuvos's own editorial
-- content explaining HOW a business works, its competitive advantages,
-- and its specific risks, with sources/dates/confidence attached.
--
-- Deliberately independent of company_valuations/diagnostic_snapshot:
-- those two are overwritten on every financial recompute (the same
-- is_current-flip-via-INSERT pattern this table reuses below) — nesting
-- editorial content inside either would mean a routine backfill run
-- could silently wipe curated text, exactly the class of bug this
-- session already hit once with diagnostic_snapshot and fixed by
-- carrying the prior snapshot forward on a numeric-only recompute.
-- Editorial content has its own lifecycle (draft -> reviewed ->
-- published, edited by a human/AI-assisted process, not a financial
-- model) and must survive recomputes untouched regardless.
--
-- Stable identifier: this codebase has no company UUID anywhere — every
-- financial table (company_valuations, company_valuation_reviews) keys
-- on TEXT ticker alone. This table does the same, honestly, rather than
-- inventing a new ID system company_valuations doesn't have. If Nuvos
-- ever needs to survive a ticker rename, that's a future problem shared
-- with company_valuations, not something to solve only here.
--
-- Never stores a buy/sell recommendation — no field is framed as
-- "accion_sugerida" or similar; moat/risk entries are analytical
-- (what the advantage/risk IS and what evidence supports it), not
-- prescriptive (what a reader should DO about it). This mirrors the
-- platform-wide "Arthur nunca prescribe" rule.
--
-- NOT YET APPLIED — prepared for review per Diego's 2026-11-11
-- directive. Do not run against production until explicitly approved.
-- Rollback: DROP TABLE company_qualitative_content; DROP FUNCTION
-- publish_company_qualitative_content(...); — nothing else references
-- this table yet.

CREATE TABLE IF NOT EXISTS company_qualitative_content (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker                  TEXT NOT NULL,

  -- Append-only version counter per ticker. A publish never mutates an
  -- existing row in place (Diego's explicit "proteccion contra
  -- modificacion accidental del contenido publicado") — it always
  -- inserts the next version and flips is_current, same atomic pattern
  -- as set_current_company_valuation. Rollback = re-publishing an old
  -- version's content as a new version, or (admin-only, rare) manually
  -- flipping is_current back to a prior row.
  version                 INTEGER NOT NULL,

  -- 'draft' -> 'reviewed' -> 'published'. Only 'published' rows are
  -- readable by anon/authenticated roles (see RLS below) — this is the
  -- backend-enforced half of "no dependas de que el frontend oculte los
  -- borradores".
  review_status           TEXT NOT NULL DEFAULT 'draft'
                             CHECK (review_status IN ('draft', 'reviewed', 'published')),

  -- Plain-language "how does this company make money" — separate from
  -- moat/risk, new field not present in the two earlier proposal drafts.
  business_model_summary  TEXT,

  -- Array of competitive-advantage entries. Each element's expected
  -- shape (enforced at the application layer, not by Postgres — see
  -- note below):
  --   { "type": "network_effect|brand|switching_costs|scale|patents|regulatory",
  --     "explanation": "...",
  --     "evidence": "...",
  --     "weakening_factors": "...",
  --     "source_name": "...",                 -- e.g. "10-K de Alphabet"
  --     "source_document_date": "YYYY-MM-DD or null",
  --     "source_accessed_at": "YYYY-MM-DD or null",
  --     "confidence": "alta|media|baja" }
  moat                    JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Array of business-risk entries (never portfolio/user risk). Shape:
  --   { "category": "competencia|regulacion|rentabilidad|deuda_liquidez|
  --                   concentracion_clientes|tecnologia_disrupcion|
  --                   ejecucion_operativa|riesgo_sectorial",
  --     "fact_type": "hecho|interpretacion|escenario_hipotetico",
  --     "explanation": "...",
  --     "evidence": "...",
  --     "watch_indicator": "...",
  --     "uncertainty": "...",
  --     "source_name": "...",
  --     "source_document_date": "YYYY-MM-DD or null",
  --     "source_accessed_at": "YYYY-MM-DD or null",
  --     "confidence": "alta|media|baja" }
  risks                   JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Human email, or "ai_draft:<model-id>" when a draft is AI-generated
  -- and not yet touched by a human — never silently blank.
  updated_by              TEXT NOT NULL,
  published_at            TIMESTAMPTZ,
  published_by            TEXT,

  -- TRUE marks the latest version for this ticker regardless of
  -- review_status (mirrors company_valuations' is_current semantics
  -- exactly: "what's live", with visibility separately gated by
  -- review_status via RLS, not by is_current itself).
  is_current              BOOLEAN NOT NULL DEFAULT TRUE,

  -- Cheap, real Postgres-level sanity checks. Full JSON-schema
  -- validation (every required key present, enum values correct per
  -- entry) is NOT something Postgres enforces natively without an
  -- extension (e.g. pg_jsonschema, not installed in this project) — that
  -- validation happens at the application layer (the editorial
  -- tool/endpoint that writes rows), same division of labor this
  -- codebase already uses for diagnostic_snapshot's shape. This CHECK
  -- only guarantees the two fields are genuinely JSON arrays, not
  -- objects/strings/null, which is the cheapest check that actually
  -- prevents a malformed write from corrupting the column's basic type.
  CHECK (jsonb_typeof(moat) = 'array'),
  CHECK (jsonb_typeof(risks) = 'array'),

  UNIQUE (ticker, version)
);

-- Exactly one current version per ticker at a time; every prior version
-- stays in the table as history (append-only, never deleted) — same
-- proven precedent as idx_company_valuations_current.
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_qualitative_content_current
  ON company_qualitative_content (ticker) WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_company_qualitative_content_ticker_version
  ON company_qualitative_content (ticker, version DESC);

ALTER TABLE company_qualitative_content ENABLE ROW LEVEL SECURITY;

-- Public/guest/free/premium reads: ONLY published, current rows. A
-- draft or a superseded version is never visible through this policy
-- regardless of any frontend filtering bug — the backend (Postgres
-- itself) is the actual enforcement point, per Diego's explicit
-- instruction.
CREATE POLICY company_qualitative_content_read_published
  ON company_qualitative_content
  FOR SELECT
  USING (review_status = 'published' AND is_current = TRUE);

-- No INSERT/UPDATE/DELETE policy for anon/authenticated roles at all:
-- every write (draft creation, review, publish) goes exclusively
-- through the backend's service_role key, which bypasses RLS entirely —
-- identical posture to company_valuations and company_valuation_reviews.
-- This is Nuvos's own editorial content, never user-generated, so there
-- is no authenticated-user write path to design at all, by design.

-- Atomic "publish a new version as current" — same crash-safety
-- reasoning as set_current_company_valuation: a plain UPDATE-then-INSERT
-- from application code has a window where a crash mid-way leaves the
-- ticker with zero current rows. This function commits both steps
-- together or neither. Intended caller: the backend's editorial
-- publish endpoint, after a human has moved review_status to
-- 'published' — NOT called directly from an AI-drafting job (drafts are
-- inserted as plain non-current or first-ever rows via ordinary INSERT
-- with is_current=false until a human publishes them; see PASO 4).
CREATE OR REPLACE FUNCTION publish_company_qualitative_content(
  p_ticker TEXT,
  p_business_model_summary TEXT,
  p_moat JSONB,
  p_risks JSONB,
  p_updated_by TEXT
) RETURNS company_qualitative_content
LANGUAGE plpgsql
AS $$
DECLARE
  v_row company_qualitative_content;
  v_next_version INTEGER;
BEGIN
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version
    FROM company_qualitative_content WHERE ticker = p_ticker;

  UPDATE company_qualitative_content SET is_current = FALSE
    WHERE ticker = p_ticker AND is_current = TRUE;

  INSERT INTO company_qualitative_content (
    ticker, version, review_status, business_model_summary, moat, risks,
    updated_by, published_at, published_by, is_current
  ) VALUES (
    p_ticker, v_next_version, 'published', p_business_model_summary, p_moat, p_risks,
    p_updated_by, now(), p_updated_by, TRUE
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
