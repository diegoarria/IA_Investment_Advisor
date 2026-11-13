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
from app.core.database import get_supabase, run_query

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
    business_model_summary: str | None, moat: list[dict], risks: list[dict]
) -> list[str]:
    """Structural/formal validation only — required fields, enum values,
    evidence for material claims, no invented-looking dates, no
    buy/sell language. Never a semantic fact-check (that's a human
    reviewer's job, not this function's, and never an LLM call's)."""
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
    return errors


def _row_to_response(row: dict) -> dict:
    """Stable response contract for the frontend — see QualitativeContentResponse
    in routes/qualitative_content.py for the Pydantic mirror of this shape."""
    return {
        "ticker": row.get("ticker"),
        "business_model_summary": row.get("business_model_summary"),
        "moat": row.get("moat") or [],
        "risks": row.get("risks") or [],
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
            .select("ticker,business_model_summary,moat,risks,last_updated_at")
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
    ticker: str, business_model_summary: str, moat: list[dict], risks: list[dict], updated_by: str
) -> dict:
    """Insert a new draft row. is_current is left at its column default
    (FALSE, migration 125) — never set TRUE here, drafts are never live.
    Structural validation runs regardless of who the author is (AI draft
    or human) — only the STATUS TRANSITION (mark_reviewed/publish_version)
    distinguishes AI from human actors."""
    if not updated_by or not updated_by.strip():
        raise QualitativeContentError("create_draft: updated_by es obligatorio (humano o 'ai_draft:<modelo>')")
    errors = validate_qualitative_entries(business_model_summary, moat, risks)
    if errors:
        raise QualitativeContentError("Contenido rechazado por validación: " + "; ".join(errors))

    ticker = ticker.strip().upper()
    db = get_supabase()
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
    db = get_supabase()
    current = await run_query(
        db.table("company_qualitative_content").select("*").eq("ticker", ticker).eq("version", version).limit(1)
    )
    if not current.data:
        raise QualitativeContentError(f"mark_reviewed: no existe {ticker} v{version}")
    row = current.data[0]
    if row["review_status"] != "draft":
        raise QualitativeContentError(f"mark_reviewed: {ticker} v{version} no está en draft (está en {row['review_status']})")

    errors = validate_qualitative_entries(row.get("business_model_summary"), row.get("moat") or [], row.get("risks") or [])
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
    db = get_supabase()
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
        })
    )
    cache_delete(_cache_key(ticker))
    return result.data
