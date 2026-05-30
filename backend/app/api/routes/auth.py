from fastapi import APIRouter, HTTPException, Depends
from app.core.database import get_supabase
from app.models.user import AuthRequest, TokenResponse
from app.api.deps import get_current_user_id

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
async def register(request: AuthRequest):
    try:
        db = get_supabase()
        result = db.auth.sign_up({
            "email": request.email,
            "password": request.password,
        })
        if result.user is None:
            raise HTTPException(status_code=400, detail="No se pudo crear la cuenta")
        if result.session is None:
            raise HTTPException(status_code=400, detail="Cuenta creada. Revisa tu correo para confirmar.")

        return TokenResponse(
            access_token=result.session.access_token,
            refresh_token=result.session.refresh_token,
            user_id=result.user.id,
        )
    except HTTPException:
        raise
    except Exception as e:
        msg = str(e)
        if "already registered" in msg or "already been registered" in msg or "User already registered" in msg:
            raise HTTPException(status_code=400, detail="Este email ya tiene una cuenta. Inicia sesión.")
        raise HTTPException(status_code=400, detail=f"Error al crear cuenta: {msg}")


@router.post("/login", response_model=TokenResponse)
async def login(request: AuthRequest):
    try:
        db = get_supabase()
        result = db.auth.sign_in_with_password({
            "email": request.email,
            "password": request.password,
        })
        if result.user is None:
            raise HTTPException(status_code=401, detail="Credenciales inválidas")
        return TokenResponse(
            access_token=result.session.access_token,
            refresh_token=result.session.refresh_token,
            user_id=result.user.id,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Login error: {str(e)}")


@router.post("/refresh")
async def refresh_token(request: dict):
    try:
        token = request.get("refresh_token", "")
        if not token:
            raise HTTPException(status_code=401, detail="refresh_token requerido")
        db = get_supabase()
        result = db.auth.refresh_session(token)
        if result.session is None:
            raise HTTPException(status_code=401, detail="Sesión inválida o expirada")
        return {
            "access_token": result.session.access_token,
            "refresh_token": result.session.refresh_token,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Refresh error: {str(e)}")


@router.post("/logout")
async def logout():
    try:
        db = get_supabase()
        db.auth.sign_out()
    except Exception:
        pass
    return {"message": "Logged out"}


@router.delete("/account")
async def delete_account(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    try:
        # Delete all user data from app tables
        for table in ["user_profiles", "user_portfolio", "user_paper_trading",
                       "user_daily_usage", "push_tokens", "chat_history",
                       "user_notifications"]:
            try:
                db.table(table).delete().eq("user_id", user_id).execute()
            except Exception:
                pass

        # Delete the auth user (requires service key)
        db.auth.admin.delete_user(user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail="No se pudo eliminar la cuenta.")

    return {"message": "Cuenta eliminada"}
