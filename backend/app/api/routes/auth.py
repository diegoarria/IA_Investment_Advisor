from fastapi import APIRouter, HTTPException
from app.core.database import get_supabase
from app.models.user import AuthRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
async def register(request: AuthRequest):
    db = get_supabase()
    try:
        # Use admin API to create user with email auto-confirmed (no verification email)
        admin_result = db.auth.admin.create_user({
            "email": request.email,
            "password": request.password,
            "email_confirm": True,
        })
        if admin_result.user is None:
            raise HTTPException(status_code=400, detail="No se pudo crear la cuenta")

        # Sign in immediately to get session token
        sign_in = db.auth.sign_in_with_password({
            "email": request.email,
            "password": request.password,
        })
        if sign_in.session is None:
            raise HTTPException(status_code=400, detail="Cuenta creada pero no se pudo iniciar sesión")

        return TokenResponse(
            access_token=sign_in.session.access_token,
            user_id=sign_in.user.id,
        )
    except HTTPException:
        raise
    except Exception as e:
        msg = str(e)
        if "already registered" in msg or "already been registered" in msg or "User already registered" in msg:
            raise HTTPException(status_code=400, detail="Este email ya tiene una cuenta. Inicia sesión.")
        raise HTTPException(status_code=400, detail=msg)


@router.post("/login", response_model=TokenResponse)
async def login(request: AuthRequest):
    db = get_supabase()
    try:
        result = db.auth.sign_in_with_password({
            "email": request.email,
            "password": request.password,
        })
        if result.user is None:
            raise HTTPException(status_code=401, detail="Credenciales inválidas")
        return TokenResponse(
            access_token=result.session.access_token,
            user_id=result.user.id,
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Credenciales inválidas")


@router.post("/logout")
async def logout():
    db = get_supabase()
    db.auth.sign_out()
    return {"message": "Logged out"}
