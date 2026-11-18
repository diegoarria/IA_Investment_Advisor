# Nuvos Radar 2.0 — Fase 7 "Mi tesis": persistencia privada real.
# Diego, 2026-11-17: guardar exactamente las respuestas del usuario, sin
# reinterpretarlas ni inventar convicciones. user_id siempre llega ya
# verificado (Depends(get_current_user_id) en la ruta) — esta capa nunca
# acepta ni confía en un user_id provisto por el cliente.
#
# get_fresh_supabase() (nunca el singleton get_supabase() compartido): toda
# ruta de este archivo corre después de Depends(get_current_user_id), que
# resuelve el token del request contra el cliente — el mismo patrón que ya
# causó el bug de "sesión contaminada" encontrado y corregido hoy en
# qualitative_content_service.py (create_draft/mark_reviewed/publish_version),
# donde consultas via el singleton compartido terminaban corriendo con la
# sesión del último usuario autenticado en vez de service_role, y RLS las
# filtraba como si fueran de otro usuario. watchlist_service.py usa el
# singleton y no se tocó aquí (fuera de alcance de esta tarea), pero esta
# tabla es la primera con datos privados por usuario desde el día 1, así
# que no vale la pena heredar el mismo riesgo ya confirmado en vivo.
# .eq("user_id", user_id) explícito en cada consulta sigue siendo la
# defensa principal; la RLS de la migración 127 es la segunda capa.

import re
from datetime import datetime, timezone

from fastapi import HTTPException

from app.core.database import get_fresh_supabase, run_query

_TICKER_RE = re.compile(r"^[A-Z0-9.\-]{1,15}$")

_Q1_VALUES = {"bueno", "dudas", "no_convence", "__no_se__"}
_Q4_VALUES = {"razonable", "elevado", "no_info"}
_Q6_VALUES = {"corto", "medio", "largo", "__no_se__"}

_CURRENT_SCHEMA_VERSION = 1


def _validate_ticker(ticker: str) -> str:
    t = (ticker or "").strip().upper()
    if not t or not _TICKER_RE.match(t):
        raise HTTPException(status_code=400, detail="Ticker inválido")
    return t


def validate_thesis_answers(answers: dict) -> dict:
    """Structural validation only — never rewrites/infers content, only
    rejects a shape that doesn't match ConstruirTesisPreview.tsx's real
    ThesisAnswers interface. Unknown extra keys are dropped (never stored
    silently), missing optional fields default to their empty form."""
    if not isinstance(answers, dict):
        raise HTTPException(status_code=400, detail="answers debe ser un objeto")

    q1 = answers.get("q1")
    if q1 is not None and q1 not in _Q1_VALUES:
        raise HTTPException(status_code=400, detail="q1 inválido")

    q2 = answers.get("q2", [])
    if not isinstance(q2, list) or not all(isinstance(x, str) for x in q2):
        raise HTTPException(status_code=400, detail="q2 debe ser una lista de strings")

    q3 = answers.get("q3", [])
    if not isinstance(q3, list) or not all(isinstance(x, str) for x in q3):
        raise HTTPException(status_code=400, detail="q3 debe ser una lista de strings")

    q4 = answers.get("q4")
    if q4 is not None and q4 not in _Q4_VALUES:
        raise HTTPException(status_code=400, detail="q4 inválido")

    q5 = answers.get("q5", [])
    if not isinstance(q5, list) or not all(isinstance(x, str) for x in q5):
        raise HTTPException(status_code=400, detail="q5 debe ser una lista de strings")

    q5_own = answers.get("q5Own", "")
    if not isinstance(q5_own, str):
        raise HTTPException(status_code=400, detail="q5Own debe ser texto")
    if len(q5_own) > 2000:
        raise HTTPException(status_code=400, detail="q5Own demasiado largo")

    q6 = answers.get("q6")
    if q6 is not None and q6 not in _Q6_VALUES:
        raise HTTPException(status_code=400, detail="q6 inválido")

    return {
        "q1": q1, "q2": q2, "q3": q3, "q4": q4,
        "q5": q5, "q5Own": q5_own[:2000], "q6": q6,
    }


async def get_thesis(user_id: str, ticker: str) -> dict | None:
    t = _validate_ticker(ticker)
    db = get_fresh_supabase()
    res = await run_query(
        db.table("user_radar_theses").select("*").eq("user_id", user_id).eq("ticker", t).limit(1)
    )
    rows = res.data or []
    return rows[0] if rows else None


async def save_thesis(user_id: str, ticker: str, answers: dict) -> dict:
    t = _validate_ticker(ticker)
    clean_answers = validate_thesis_answers(answers)
    db = get_fresh_supabase()
    now = datetime.now(timezone.utc).isoformat()

    existing = await get_thesis(user_id, t)
    if existing:
        res = await run_query(
            db.table("user_radar_theses")
            .update({"answers": clean_answers, "updated_at": now})
            .eq("user_id", user_id).eq("ticker", t)
        )
    else:
        res = await run_query(
            db.table("user_radar_theses").insert({
                "user_id": user_id,
                "ticker": t,
                "answers": clean_answers,
                "schema_version": _CURRENT_SCHEMA_VERSION,
                "created_at": now,
                "updated_at": now,
            })
        )
    rows = res.data or []
    if not rows:
        # Upsert race (two saves for the same user+ticker landed together) —
        # re-read instead of trusting an empty insert/update response.
        row = await get_thesis(user_id, t)
        if row:
            return row
        raise HTTPException(status_code=500, detail="No se pudo guardar la tesis")
    return rows[0]
