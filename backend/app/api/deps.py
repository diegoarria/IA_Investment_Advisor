import hashlib
from fastapi import Header, HTTPException
from app.core.database import get_supabase, run_auth
from app.core.cache import cache_get, cache_set

_TOKEN_CACHE_TTL = 60  # seconds — token revocation propagates within this window


async def get_current_user_id(authorization: str = Header(default="")) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid token format")
    token = authorization.split(" ")[1]

    # Hash the token so the raw JWT is never stored in cache
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    ck = f"auth:uid:{token_hash}"

    cached_uid = cache_get(ck)
    if cached_uid:
        return cached_uid

    try:
        db = get_supabase()
        result = await run_auth(db.auth.get_user, token)
        if result.user is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        uid = result.user.id
        cache_set(ck, uid, ttl=_TOKEN_CACHE_TTL)
        return uid
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
