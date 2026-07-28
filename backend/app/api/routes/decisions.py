from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import get_current_user_id
from app.api.routes.market import _get_user_profile
from app.core.database import get_supabase, run_query
from app.core.cache import cache_get, cache_set
from app.services import ai_service

router = APIRouter(prefix="/decisions", tags=["decisions"])

_TTL_BIAS = 3600  # 1 hour


async def _get_decisions(user_id: str, limit: int = 100) -> list[dict]:
    db = get_supabase()
    try:
        result = await run_query(
            db.table("investment_decisions")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
        )
        return result.data or []
    except Exception:
        return []


async def _log_decision(user_id: str, decision: dict) -> dict:
    db = get_supabase()
    row = {
        "user_id":        user_id,
        "action":         decision.get("action", ""),          # buy|sell|hold|ignored_alert|acted_on_alert
        "ticker":         decision.get("ticker", ""),
        "price_at_action": decision.get("price_at_action"),
        "portfolio_value_at_action": decision.get("portfolio_value_at_action"),
        "trigger":        decision.get("trigger", ""),         # manual|alert|mentor|fomo|panic
        "notes":          decision.get("notes", ""),
        "created_at":     datetime.utcnow().isoformat(),
    }
    result = await run_query(db.table("investment_decisions").insert(row))
    return result.data[0] if result.data else row


@router.post("/log")
async def log_decision(
    request: dict,
    user_id: str = Depends(get_current_user_id),
):
    """Log an investment decision to the diary."""
    required = ("action", "ticker")
    if not all(request.get(f) for f in required):
        raise HTTPException(status_code=400, detail="action y ticker son requeridos")

    try:
        row = await _log_decision(user_id, request)
        # Invalidate bias cache so next call re-analyzes
        cache_key = f"biases:{user_id}"
        cache_set(cache_key, None, ttl=1)
        return {"ok": True, "decision": row}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al guardar decisión: {str(e)}")


@router.get("")
async def get_decisions(
    limit: int = 50,
    user_id: str = Depends(get_current_user_id),
):
    """Return the user's decision diary."""
    decisions = await _get_decisions(user_id, limit=limit)
    return {"decisions": decisions, "total": len(decisions)}


@router.get("/biases")
async def get_bias_analysis(
    user_id: str = Depends(get_current_user_id),
):
    """AI analysis of behavioral biases from decision history."""
    cache_key = f"biases:{user_id}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    decisions = await _get_decisions(user_id, limit=100)
    if len(decisions) < 3:
        return {
            "total_decisions": len(decisions),
            "message": "Necesitas al menos 3 decisiones registradas para detectar patrones.",
            "biases_detected": [],
            "strengths": [],
        }

    profile  = _get_user_profile(user_id)
    analysis = await ai_service.analyze_decision_biases(decisions, profile)
    analysis["generated_at"] = datetime.utcnow().isoformat()
    cache_set(cache_key, analysis, ttl=_TTL_BIAS)
    return analysis


@router.delete("/{decision_id}")
async def delete_decision(decision_id: str, user_id: str = Depends(get_current_user_id)):
    """Privacy control for 'Tu Memoria' — a user must be able to see and
    delete anything Nuvos remembers about their investing behavior, not just
    have it explained to them in a legal disclaimer. Scoped to user_id so a
    user can only ever delete their own entries."""
    db = get_supabase()
    await run_query(
        db.table("investment_decisions").delete()
        .eq("id", decision_id).eq("user_id", user_id)
    )
    cache_set(f"biases:{user_id}", None, ttl=1)
    return {"ok": True}


@router.delete("")
async def delete_all_decisions(user_id: str = Depends(get_current_user_id)):
    """Clears the entire decision journal for this user — the 'forget me'
    control for this specific memory, distinct from full account deletion."""
    db = get_supabase()
    await run_query(db.table("investment_decisions").delete().eq("user_id", user_id))
    cache_set(f"biases:{user_id}", None, ttl=1)
    return {"ok": True}


async def get_bias_context_for_mentor(user_id: str) -> str | None:
    """Compact bias/strength summary for injection into Mentor IA's dynamic
    system prompt addendum. Reuses the exact same cache key/TTL as
    GET /decisions/biases (`biases:{user_id}`, 1h) so a chat message never
    triggers a second, redundant Claude call within the same hour — whichever
    of the two (this or the profile screen) is hit first pays the real cost,
    the other just reads the cache.
    Returns None when there's not enough history yet, so a brand-new user's
    prompt stays exactly as small as it was before this feature existed."""
    cache_key = f"biases:{user_id}"
    cached = cache_get(cache_key)
    if cached is None:
        decisions = await _get_decisions(user_id, limit=100)
        if len(decisions) < 3:
            return None
        try:
            profile = _get_user_profile(user_id)
            cached = await ai_service.analyze_decision_biases(decisions, profile)
            cached["generated_at"] = datetime.utcnow().isoformat()
            cache_set(cache_key, cached, ttl=_TTL_BIAS)
        except Exception:
            return None

    if not cached:
        return None
    biases = cached.get("biases_detected") or []
    strengths = cached.get("strengths") or []
    if not biases and not strengths:
        return None

    lines = ["## 🧠 SESGOS Y FORTALEZAS DETECTADAS (evidencia real de su historial, no genérico)"]
    for b in biases[:2]:
        lines.append(f"- Sesgo real detectado: {b.get('name')} ({b.get('severity')}) — {b.get('description')}")
    for s in strengths[:2]:
        lines.append(f"- Fortaleza real detectada: {s.get('name')} — {s.get('description')}")
    return "\n".join(lines)
