"""Shared rate limiter instance — imported by main.py and individual routers."""
from slowapi import Limiter
from slowapi.util import get_remote_address
from fastapi import Request


def _rate_key(request: Request) -> str:
    """Use authenticated user_id when available, fall back to IP."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            from jose import jwt
            from app.core.config import settings
            payload = jwt.decode(
                auth_header[7:], settings.secret_key,
                algorithms=["HS256"], options={"verify_exp": False}
            )
            uid = payload.get("sub") or payload.get("user_id")
            if uid:
                return f"uid:{uid}"
        except Exception:
            pass
    return get_remote_address(request)


def _storage_uri() -> str:
    try:
        from app.core.config import settings
        if settings.redis_url:
            return settings.redis_url
    except Exception:
        pass
    return "memory://"


limiter = Limiter(key_func=_rate_key, storage_uri=_storage_uri())
