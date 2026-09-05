"""Auth for the standalone Nuvos Sentinel monitor (separate infra from
Railway, no Supabase session available) — a shared secret sent as a header,
deliberately independent from _require_admin (admin.py), which needs a real
logged-in Supabase user and can't be satisfied by a headless external poller.
"""
from fastapi import Header, HTTPException
from app.core.config import settings


async def require_sentinel_secret(x_sentinel_key: str = Header(default="")) -> None:
    if not settings.sentinel_shared_secret or x_sentinel_key != settings.sentinel_shared_secret:
        raise HTTPException(status_code=403, detail="Forbidden")
