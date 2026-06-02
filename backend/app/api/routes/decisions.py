from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import get_current_user_id
from app.api.routes.market import _get_user_profile
from app.core.database import get_supabase
from app.core.cache import cache_get, cache_set
from app.services import ai_service

router = APIRouter(prefix="/decisions", tags=["decisions"])

_TTL_BIAS = 3600  # 1 hour


def _get_decisions(user_id: str, limit: int = 100) -> list[dict]:
    db = get_supabase()
    try:
        result = (
            db.table("investment_decisions")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []
    except Exception:
        return []


def _log_decision(user_id: str, decision: dict) -> dict:
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
    result = db.table("investment_decisions").insert(row).execute()
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
        row = _log_decision(user_id, request)
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
    decisions = _get_decisions(user_id, limit=limit)
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

    decisions = _get_decisions(user_id, limit=100)
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
