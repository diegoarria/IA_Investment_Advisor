"""Nuvos's own editorial content (business model / moat / risks) for Radar
fichas — deliberately a SEPARATE table (company_qualitative_content,
migrations 123/124/125) and a separate read/write path from
company_valuations/diagnostic_snapshot. Never touches either: mixing
editorial text into a column that gets overwritten on every financial
recompute is exactly the class of bug this session already hit once with
diagnostic_snapshot (numeric-only recompute silently wiping a rich
snapshot) and fixed by carrying the prior value forward — editorial
content avoids that risk entirely by living somewhere a recompute never
writes to.

Three surfaces:
  - get_published_qualitative_content(ticker): public read, published+
    current only, never raises — a failure here must never block the
    financial ficha from serving (same resilience discipline as the
    CHTR Supabase-retry fix and the snapshot-first fix).
  - create_draft / mark_reviewed / publish_version: the internal write
    flow, gated by an explicit human actor at every status transition —
    an AI-tagged draft (updated_by starting with "ai_draft:") can never
    advance itself.
  - validate_qualitative_entries: structural/formal validation only
    (required fields, enum values, source-for-material-claims, no
    invented dates, no buy/sell language) — never a semantic fact-check,
    which stays a human responsibility per Diego's explicit instruction.
"""
import logging
import re
from datetime import date, datetime, timezone
from typing import Any

from app.core.cache import cache_delete, cache_get, cache_set
from app.core.database import get_fresh_supabase, get_supabase, run_query

logger = logging.getLogger(__name__)

_CACHE_PREFIX = "qualitative_content:v1"
# Editorial content changes rarely (human-reviewed, not recomputed on a
# schedule) and isn't safety-critical the way a financial number is —
# a short TTL plus explicit invalidation-on-publish (see publish_version)
# is enough; no need for the 2-year public-cache-plus-reconciliation
# machinery built for diagnostic_snapshot.
_CACHE_TTL_SECONDS = 15 * 60

_MOAT_TYPES = {"network_effect", "brand", "switching_costs", "scale", "patents", "regulatory"}
_RISK_CATEGORIES = {
    "competencia", "regulacion", "rentabilidad", "deuda_liquidez",
    "concentracion_clientes", "tecnologia_disrupcion", "ejecucion_operativa",
    "riesgo_sectorial",
}
_FACT_TYPES = {"hecho", "interpretacion", "escenario_hipotetico"}
_CONFIDENCE_LEVELS = {"alta", "media", "baja"}

# Obvious prescriptive phrasing — a formal denylist, not a truthfulness
# check. Catches the clearest violations of "Arthur nunca prescribe";
# does not replace human review of subtler phrasing.
_PRESCRIPTIVE_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r"deber[ií]as?\s+(comprar|vender)",
        r"es\s+momento\s+de\s+(comprar|vender)",
        r"\brecomendamos\s+(comprar|vender)",
        r"\b(compra|vende)\s+ahora\b",
        r"\bbuy\s+now\b",
        r"\byou\s+should\s+(buy|sell)\b",
    ]
]


class QualitativeContentError(Exception):
    """Validation/authorization failure in the editorial write flow."""


def _cache_key(ticker: str) -> str:
    return f"{_CACHE_PREFIX}:{ticker.upper()}"


def _is_ai_tag(actor: str | None) -> bool:
    return bool(actor) and actor.startswith("ai_draft:")


def _require_human_actor(actor: str | None, action: str) -> None:
    if not actor or not actor.strip():
        raise QualitativeContentError(f"{action}: se requiere un actor humano identificado")
    if _is_ai_tag(actor):
        raise QualitativeContentError(
            f"{action}: un borrador generado por IA no puede avanzar de estado sin un revisor/publicador humano"
        )


def _is_plausible_date(value: Any) -> bool:
    if value is None:
        return True
    if not isinstance(value, str):
        return False
    try:
        d = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return False
    return date(1990, 1, 1) <= d <= date.today()


def _contains_prescriptive_language(text: str | None) -> bool:
    if not text:
        return False
    return any(p.search(text) for p in _PRESCRIPTIVE_PATTERNS)


def _validate_moat_entry(entry: dict, idx: int) -> list[str]:
    errors = []
    prefix = f"moat[{idx}]"
    if entry.get("type") not in _MOAT_TYPES:
        errors.append(f"{prefix}.type inválido o ausente")
    explanation = (entry.get("explanation") or "").strip()
    if len(explanation) < 20:
        errors.append(f"{prefix}.explanation ausente o demasiado genérica")
    confidence = entry.get("confidence")
    if confidence not in _CONFIDENCE_LEVELS:
        errors.append(f"{prefix}.confidence inválido o ausente")
    if confidence == "alta" and not (entry.get("source_name") or "").strip():
        errors.append(f"{prefix}: confianza 'alta' exige source_name (afirmación material sin evidencia)")
    if not _is_plausible_date(entry.get("source_document_date")):
        errors.append(f"{prefix}.source_document_date inválida (futura, demasiado antigua, o mal formada)")
    if not _is_plausible_date(entry.get("source_accessed_at")):
        errors.append(f"{prefix}.source_accessed_at inválida")
    for field in ("explanation", "evidence", "weakening_factors"):
        if _contains_prescriptive_language(entry.get(field)):
            errors.append(f"{prefix}.{field} contiene lenguaje prescriptivo de compra/venta")
    return errors


def _validate_leadership(leadership: dict | None) -> list[str]:
    """Structural validation for the optional `leadership` column
    (migration 126) — mirrors previewContent/leadership/*.json's real
    shape (ceo/capital_allocation/decisions/incentive_alignment/watch).
    `None` is a valid, honest "no leadership content yet" — only
    validated when present. Never a semantic fact-check."""
    if leadership is None:
        return []
    errors: list[str] = []
    if not isinstance(leadership, dict):
        return ["leadership debe ser un objeto o null"]

    ceo = leadership.get("ceo")
    if not isinstance(ceo, dict) or not (ceo.get("name") or "").strip():
        errors.append("leadership.ceo.name ausente")
    elif not (ceo.get("source_name") or "").strip():
        errors.append("leadership.ceo: afirmación material (CEO) sin source_name")

    capital_allocation = leadership.get("capital_allocation")
    if capital_allocation is not None and not isinstance(capital_allocation, dict):
        errors.append("leadership.capital_allocation debe ser un objeto o null")
    elif isinstance(capital_allocation, dict) and not (capital_allocation.get("source_name") or "").strip():
        errors.append("leadership.capital_allocation: cifras materiales sin source_name")

    decisions = leadership.get("decisions")
    if decisions is not None:
        if not isinstance(decisions, list):
            errors.append("leadership.decisions debe ser una lista o null")
        else:
            for i, d in enumerate(decisions):
                if not isinstance(d, dict) or not (d.get("decision") or "").strip():
                    errors.append(f"leadership.decisions[{i}].decision ausente")
                elif not (d.get("source_name") or "").strip():
                    errors.append(f"leadership.decisions[{i}]: decisión sin source_name")

    for field in ("ceo", "capital_allocation"):
        sub = leadership.get(field)
        if isinstance(sub, dict):
            for k in ("role_explanation", "note", "acquisition_note"):
                if _contains_prescriptive_language(sub.get(k)):
                    errors.append(f"leadership.{field}.{k} contiene lenguaje prescriptivo de compra/venta")
    return errors


def _validate_industry(industry: dict | None) -> list[str]:
    """Structural validation for the optional `industry` column
    (migration 126) — mirrors previewContent/industry/*.json's real shape
    (competitors/market_growth/competitive_strength/industry_shifts/watch).
    `None` is a valid, honest "no industry content yet"."""
    if industry is None:
        return []
    errors: list[str] = []
    if not isinstance(industry, dict):
        return ["industry debe ser un objeto o null"]

    competitors = industry.get("competitors")
    if competitors is not None:
        if not isinstance(competitors, list):
            errors.append("industry.competitors debe ser una lista o null")
        else:
            for i, c in enumerate(competitors):
                if not isinstance(c, dict) or not (c.get("segment") or "").strip():
                    errors.append(f"industry.competitors[{i}].segment ausente")
                if isinstance(c, dict) and not isinstance(c.get("rivals"), list):
                    errors.append(f"industry.competitors[{i}].rivals debe ser una lista")

    industry_shifts = industry.get("industry_shifts")
    if industry_shifts is not None:
        if not isinstance(industry_shifts, list):
            errors.append("industry.industry_shifts debe ser una lista o null")
        else:
            for i, s in enumerate(industry_shifts):
                if not isinstance(s, dict) or not (s.get("change") or "").strip():
                    errors.append(f"industry.industry_shifts[{i}].change ausente")
                elif "is_prediction" not in s:
                    errors.append(f"industry.industry_shifts[{i}]: falta is_prediction (hecho vs. predicción debe ser explícito)")

    for field in ("competitors", "industry_shifts", "competitive_strength"):
        items = industry.get(field)
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    for k in ("note", "evidence", "caveat", "what_it_means", "effect_on_company"):
                        if _contains_prescriptive_language(item.get(k)):
                            errors.append(f"industry.{field}.{k} contiene lenguaje prescriptivo de compra/venta")
    return errors


def _validate_risk_entry(entry: dict, idx: int) -> list[str]:
    errors = []
    prefix = f"risks[{idx}]"
    if entry.get("category") not in _RISK_CATEGORIES:
        errors.append(f"{prefix}.category inválida o ausente")
    fact_type = entry.get("fact_type")
    if fact_type not in _FACT_TYPES:
        errors.append(f"{prefix}.fact_type inválido o ausente")
    explanation = (entry.get("explanation") or "").strip()
    if len(explanation) < 20:
        errors.append(f"{prefix}.explanation ausente o demasiado genérica")
    confidence = entry.get("confidence")
    if confidence not in _CONFIDENCE_LEVELS:
        errors.append(f"{prefix}.confidence inválido o ausente")
    # Material claims — "hecho" entries, or any "alta"-confidence entry —
    # require a verifiable source. Interpretations/hypotheticals don't
    # carry the same evidentiary bar but must still be clearly labeled
    # as such (checked above via fact_type).
    if (fact_type == "hecho" or confidence == "alta") and not (entry.get("source_name") or "").strip():
        errors.append(f"{prefix}: hecho/confianza alta exige source_name (afirmación material sin evidencia)")
    if not _is_plausible_date(entry.get("source_document_date")):
        errors.append(f"{prefix}.source_document_date inválida")
    if not _is_plausible_date(entry.get("source_accessed_at")):
        errors.append(f"{prefix}.source_accessed_at inválida")
    for field in ("explanation", "evidence", "watch_indicator", "uncertainty"):
        if _contains_prescriptive_language(entry.get(field)):
            errors.append(f"{prefix}.{field} contiene lenguaje prescriptivo de compra/venta")
    return errors


def validate_qualitative_entries(
    business_model_summary: str | None,
    moat: list[dict],
    risks: list[dict],
    leadership: dict | None = None,
    industry: dict | None = None,
) -> list[str]:
    """Structural/formal validation only — required fields, enum values,
    evidence for material claims, no invented-looking dates, no
    buy/sell language. Never a semantic fact-check (that's a human
    reviewer's job, not this function's, and never an LLM call's).

    `leadership`/`industry` (migration 126, both nullable) are validated
    only when present — unlike moat/risks, they're genuinely optional:
    a ticker can have real moat/risk content with no leadership/industry
    research yet, same "null means honestly absent" discipline the
    columns themselves use."""
    errors: list[str] = []
    if not isinstance(moat, list) or not moat:
        errors.append("moat debe ser una lista no vacía")
        moat = []
    if not isinstance(risks, list) or len(risks) < 3 or len(risks) > 5:
        errors.append("risks debe tener entre 3 y 5 elementos")
        risks = risks if isinstance(risks, list) else []
    if _contains_prescriptive_language(business_model_summary):
        errors.append("business_model_summary contiene lenguaje prescriptivo de compra/venta")
    for i, entry in enumerate(moat):
        errors.extend(_validate_moat_entry(entry, i))
    for i, entry in enumerate(risks):
        errors.extend(_validate_risk_entry(entry, i))
    errors.extend(_validate_leadership(leadership))
    errors.extend(_validate_industry(industry))
    return errors


def _row_to_response(row: dict) -> dict:
    """Stable response contract for the frontend — see QualitativeContentResponse
    in routes/qualitative_content.py for the Pydantic mirror of this shape.

    `leadership`/`industry` (migration 126) are passed through as-is —
    `None` for any row that predates these columns or simply has no such
    research yet, never defaulted to `{}` (which would look like "empty
    but researched" rather than "not researched")."""
    return {
        "ticker": row.get("ticker"),
        "business_model_summary": row.get("business_model_summary"),
        "moat": row.get("moat") or [],
        "risks": row.get("risks") or [],
        "leadership": row.get("leadership"),
        "industry": row.get("industry"),
        "last_updated_at": row.get("last_updated_at"),
    }


async def get_published_qualitative_content(ticker: str) -> dict | None:
    """Public read path: published + current only, for one ticker.
    Never raises — any failure (malformed row, transient Supabase error,
    unexpected shape) degrades to None so the caller can serve the
    financial ficha with zero editorial content rather than fail the
    whole request. Uses the existing service_role client (same one every
    other read in this codebase uses) and filters explicitly in the
    query rather than relying on RLS, since service_role bypasses RLS —
    the RLS policy on this table is a second, independent layer of
    defense for any future caller using a non-service-role key, not the
    only thing keeping drafts private from THIS code path."""
    if not ticker or not ticker.strip():
        return None
    ticker = ticker.strip().upper()

    cached = cache_get(_cache_key(ticker))
    if cached is not None:
        return cached or None  # cached "no content" sentinel is {} below

    try:
        db = get_supabase()
        result = await run_query(
            db.table("company_qualitative_content")
            .select("ticker,business_model_summary,moat,risks,leadership,industry,last_updated_at")
            .eq("ticker", ticker)
            .eq("review_status", "published")
            .eq("is_current", True)
            .limit(1)
        )
        rows = result.data or []
        if not rows:
            cache_set(_cache_key(ticker), {}, _CACHE_TTL_SECONDS)
            return None
        row = rows[0]
        moat, risks = row.get("moat"), row.get("risks")
        if not isinstance(moat, list) or not isinstance(risks, list):
            logger.warning("qualitative_content(%s): malformed moat/risks shape, treating as unavailable", ticker)
            return None
        response = _row_to_response(row)
        cache_set(_cache_key(ticker), response, _CACHE_TTL_SECONDS)
        return response
    except Exception as exc:
        logger.warning("get_published_qualitative_content(%s) failed, degrading to no content: %s", ticker, exc)
        return None


async def create_draft(
    ticker: str,
    business_model_summary: str,
    moat: list[dict],
    risks: list[dict],
    updated_by: str,
    leadership: dict | None = None,
    industry: dict | None = None,
) -> dict:
    """Insert a new draft row. is_current is left at its column default
    (FALSE, migration 125) — never set TRUE here, drafts are never live.
    Structural validation runs regardless of who the author is (AI draft
    or human) — only the STATUS TRANSITION (mark_reviewed/publish_version)
    distinguishes AI from human actors.

    `leadership`/`industry` (migration 126) are optional and default to
    None — a draft can have real moat/risk content with no leadership/
    industry research yet; this mirrors the honest-absence discipline
    those two columns already use everywhere else."""
    if not updated_by or not updated_by.strip():
        raise QualitativeContentError("create_draft: updated_by es obligatorio (humano o 'ai_draft:<modelo>')")
    errors = validate_qualitative_entries(business_model_summary, moat, risks, leadership, industry)
    if errors:
        raise QualitativeContentError("Contenido rechazado por validación: " + "; ".join(errors))

    ticker = ticker.strip().upper()
    # get_fresh_supabase(), not the shared get_supabase() singleton: this is
    # always called right after Depends(get_current_user), whose
    # _resolve_user_token() calls db.auth.get_user(token) on that SAME
    # singleton — which silently leaves its internal gotrue session pointed
    # at the end user's own session (not service_role), even though
    # get_supabase()'s own self-check only inspects the postgrest-level
    # Authorization header and reports clean. Confirmed live 2026-10-20 for
    # delete_account (auth.py) via the identical root cause; confirmed again
    # 2026-11-17 for this module — mark_reviewed() under the singleton
    # returned zero rows for a real, existing draft, because RLS silently
    # filtered the query down to the admin's own (non-service-role) view,
    # which never includes drafts.
    db = get_fresh_supabase()
    existing = await run_query(
        db.table("company_qualitative_content").select("version").eq("ticker", ticker).order("version", desc=True).limit(1)
    )
    next_version = (existing.data[0]["version"] + 1) if existing.data else 1
    now = datetime.now(timezone.utc).isoformat()
    result = await run_query(
        db.table("company_qualitative_content").insert({
            "ticker": ticker,
            "version": next_version,
            "review_status": "draft",
            "is_current": False,
            "business_model_summary": business_model_summary,
            "moat": moat,
            "risks": risks,
            "leadership": leadership,
            "industry": industry,
            "created_at": now,
            "last_updated_at": now,
            "updated_by": updated_by,
        })
    )
    return result.data[0]


async def mark_reviewed(ticker: str, version: int, reviewer_email: str) -> dict:
    """A draft -> reviewed transition. Requires a human-identified
    reviewer — never an AI actor, never blank."""
    _require_human_actor(reviewer_email, "mark_reviewed")
    ticker = ticker.strip().upper()
    # get_fresh_supabase(): see create_draft()'s comment above — this runs
    # right after Depends(get_current_user) contaminates the shared
    # singleton with the admin's own user session, which would otherwise
    # make this SELECT run under RLS as that user (drafts invisible) instead
    # of as service_role.
    db = get_fresh_supabase()
    current = await run_query(
        db.table("company_qualitative_content").select("*").eq("ticker", ticker).eq("version", version).limit(1)
    )
    if not current.data:
        raise QualitativeContentError(f"mark_reviewed: no existe {ticker} v{version}")
    row = current.data[0]
    if row["review_status"] != "draft":
        raise QualitativeContentError(f"mark_reviewed: {ticker} v{version} no está en draft (está en {row['review_status']})")

    errors = validate_qualitative_entries(
        row.get("business_model_summary"), row.get("moat") or [], row.get("risks") or [],
        row.get("leadership"), row.get("industry"),
    )
    if errors:
        raise QualitativeContentError("No se puede marcar reviewed, contenido inválido: " + "; ".join(errors))

    result = await run_query(
        db.table("company_qualitative_content")
        .update({"review_status": "reviewed", "last_updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": reviewer_email})
        .eq("ticker", ticker).eq("version", version)
    )
    return result.data[0]


async def publish_version(ticker: str, version: int, publisher_email: str) -> dict:
    """reviewed -> published, via the existing atomic RPC
    (publish_company_qualitative_content) — never a plain UPDATE, so the
    old-current-row-flip and the new-row-insert always happen together
    (Postgres rolls back the whole function on any error inside it).
    Requires a human-identified publisher. Invalidates this ticker's
    short-TTL cache entry on success so a subsequent read never serves
    the pre-publish state for the remaining TTL window."""
    _require_human_actor(publisher_email, "publish_version")
    ticker = ticker.strip().upper()
    # get_fresh_supabase(): see create_draft()'s comment above — same
    # singleton-contamination risk, since this also runs right after
    # Depends(get_current_user).
    db = get_fresh_supabase()
    current = await run_query(
        db.table("company_qualitative_content").select("*").eq("ticker", ticker).eq("version", version).limit(1)
    )
    if not current.data:
        raise QualitativeContentError(f"publish_version: no existe {ticker} v{version}")
    row = current.data[0]
    if row["review_status"] != "reviewed":
        raise QualitativeContentError(
            f"publish_version: {ticker} v{version} debe estar en 'reviewed' antes de publicarse (está en {row['review_status']})"
        )

    result = await run_query(
        db.rpc("publish_company_qualitative_content", {
            "p_ticker": ticker,
            "p_business_model_summary": row.get("business_model_summary"),
            "p_moat": row.get("moat") or [],
            "p_risks": row.get("risks") or [],
            "p_updated_by": publisher_email,
            "p_leadership": row.get("leadership"),
            "p_industry": row.get("industry"),
        })
    )
    cache_delete(_cache_key(ticker))
    return result.data
