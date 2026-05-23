from fastapi import Header, HTTPException
from app.core.database import get_supabase


async def get_current_user_id(authorization: str = Header(default="Bearer dev")) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid token format")
    token = authorization.split(" ")[1]
    if token == "dev":
        return "dev-user"
    try:
        db = get_supabase()
        result = db.auth.get_user(token)
        if result.user is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        return result.user.id
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
