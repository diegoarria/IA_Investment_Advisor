from fastapi import Header, HTTPException


async def get_current_user_id(authorization: str = Header(default="Bearer dev")) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid token format")
    return "dev-user"
