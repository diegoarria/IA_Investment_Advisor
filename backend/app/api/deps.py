import hashlib
from fastapi import Header, HTTPException
from app.core.database import get_supabase, run_auth
from app.core.cache import cache_get, cache_set

_TOKEN_CACHE_TTL = 60  # seconds — token revocation propagates within this window


async def _resolve_user(authorization: str) -> dict:
    """Resolve token → {id, email}. Cached by token hash."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid token format")
    token = authorization.split(" ")[1]
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    ck = f"auth:user:{token_hash}"
    cached = cache_get(ck)
    if cached:
        return cached
    try:
        db = get_supabase()
        result = await run_auth(db.auth.get_user, token)
        if result.user is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        user_data = {"id": result.user.id, "email": getattr(result.user, "email", None)}
        cache_set(ck, user_data, ttl=_TOKEN_CACHE_TTL)
        return user_data
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


async def get_current_user_id(authorization: str = Header(default="")) -> str:
    user = await _resolve_user(authorization)
    return user["id"]


async def get_current_user(authorization: str = Header(default="")) -> dict:
    """Returns {'id': str, 'email': str | None}."""
    return await _resolve_user(authorization)
