import asyncio
import secrets
import time

from fastapi import APIRouter, HTTPException, Depends
from app.core.database import get_supabase, run_query
from app.models.user import AuthRequest, TokenResponse
from app.api.deps import get_current_user_id

router = APIRouter(prefix="/auth", tags=["auth"])

# email -> {code, expires_at}
_reset_codes: dict[str, dict] = {}
# phone -> {code, expires_at, email}
_reset_codes_phone: dict[str, dict] = {}


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


@router.post("/forgot-password")
async def forgot_password(request: dict):
    email = request.get("email", "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email requerido")
    db = get_supabase()
    try:
        users = await asyncio.to_thread(lambda: db.auth.admin.list_users())
        user = next((u for u in users if u.email and u.email.lower() == email), None)
        if user:
            code = f"{secrets.randbelow(1000000):06d}"
            _reset_codes[email] = {"code": code, "expires_at": time.time() + 900}
            from app.services.email_service import send_email
            html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:480px;margin:0 auto;padding:40px 20px">
    <div style="background:#1a1d27;border-radius:20px;padding:32px;border:1px solid #2a2d3a">
      <div style="color:#fff;font-size:20px;font-weight:800;margin-bottom:8px">Código de verificación</div>
      <p style="color:#9ca3af;font-size:14px;margin:0 0 28px">Usa este código para restablecer tu contraseña en Nuvos AI. Expira en 15 minutos.</p>
      <div style="background:#0f1117;border-radius:14px;padding:28px;text-align:center;border:1px solid #2a2d3a;letter-spacing:10px;font-size:36px;font-weight:900;color:#22c55e;margin-bottom:24px">{code}</div>
      <p style="color:#6b7280;font-size:12px;margin:0;text-align:center">Si no solicitaste esto, ignora este correo.</p>
    </div>
  </div>
</body></html>"""
            await send_email(email, "Tu código de verificación — Nuvos AI", html)
    except Exception:
        pass
    return {"message": "Si el email existe recibirás un código en tu correo"}


@router.post("/forgot-password-sms")
async def forgot_password_sms(request: dict):
    email = request.get("email", "").strip().lower()
    phone = request.get("phone", "").strip()
    if not email or not phone:
        raise HTTPException(status_code=400, detail="Email y teléfono requeridos")
    db = get_supabase()
    try:
        users = await asyncio.to_thread(lambda: db.auth.admin.list_users())
        user = next((u for u in users if u.email and u.email.lower() == email), None)
        if user:
            code = f"{secrets.randbelow(1000000):06d}"
            _reset_codes_phone[phone] = {"code": code, "expires_at": time.time() + 900, "email": email}
            from app.services.sms_service import send_sms
            await send_sms(phone, f"Tu código Nuvos AI: {code}. Expira en 15 min. No lo compartas.")
    except Exception:
        pass
    return {"message": "Si los datos son correctos, recibirás un SMS con el código"}


@router.post("/reset-password")
async def reset_password(request: dict):
    phone = request.get("phone", "").strip()
    email = request.get("email", "").strip().lower()
    code  = request.get("code", "").strip()
    new_password = request.get("new_password", "")

    if not code or not new_password:
        raise HTTPException(status_code=400, detail="Todos los campos son requeridos")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 6 caracteres")

    if phone:
        # SMS flow: look up code by phone
        entry = _reset_codes_phone.get(phone)
        if not entry:
            raise HTTPException(status_code=400, detail="Código inválido o expirado")
        if time.time() > entry["expires_at"]:
            _reset_codes_phone.pop(phone, None)
            raise HTTPException(status_code=400, detail="El código expiró. Solicita uno nuevo")
        if entry["code"] != code:
            raise HTTPException(status_code=400, detail="Código incorrecto")
        email = entry["email"]
        _reset_codes_phone.pop(phone, None)
    else:
        # Email flow
        if not email:
            raise HTTPException(status_code=400, detail="Email requerido")
        entry = _reset_codes.get(email)
        if not entry:
            raise HTTPException(status_code=400, detail="Código inválido o expirado")
        if time.time() > entry["expires_at"]:
            _reset_codes.pop(email, None)
            raise HTTPException(status_code=400, detail="El código expiró. Solicita uno nuevo")
        if entry["code"] != code:
            raise HTTPException(status_code=400, detail="Código incorrecto")
        _reset_codes.pop(email, None)

    db = get_supabase()
    users = await asyncio.to_thread(lambda: db.auth.admin.list_users())
    user = next((u for u in users if u.email and u.email.lower() == email), None)
    if not user:
        raise HTTPException(status_code=400, detail="Usuario no encontrado")
    await asyncio.to_thread(lambda: db.auth.admin.update_user_by_id(user.id, {"password": new_password}))
    return {"message": "Contraseña actualizada correctamente"}


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
                await run_query(db.table(table).delete().eq("user_id", user_id))
            except Exception:
                pass

        # Delete the auth user (requires service key)
        await asyncio.to_thread(lambda: db.auth.admin.delete_user(user_id))
    except Exception as e:
        raise HTTPException(status_code=500, detail="No se pudo eliminar la cuenta.")

    return {"message": "Cuenta eliminada"}
