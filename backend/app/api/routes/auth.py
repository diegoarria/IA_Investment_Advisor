from fastapi import APIRouter, HTTPException
from app.core.database import get_supabase
from app.models.user import AuthRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
async def register(request: AuthRequest):
    db = get_supabase()
    try:
        result = db.auth.sign_up({"email": request.email, "password": request.password})
        if result.user is None:
            raise HTTPException(status_code=400, detail="Registration failed")
        return TokenResponse(
            access_token=result.session.access_token,
            user_id=result.user.id
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/login", response_model=TokenResponse)
async def login(request: AuthRequest):
    db = get_supabase()
    try:
        result = db.auth.sign_in_with_password({"email": request.email, "password": request.password})
        if result.user is None:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        return TokenResponse(
            access_token=result.session.access_token,
            user_id=result.user.id
        )
    except Exception as e:
        raise HTTPException(status_code=401, detail="Invalid credentials")


@router.post("/logout")
async def logout():
    db = get_supabase()
    db.auth.sign_out()
    return {"message": "Logged out"}
