import asyncio
import logging
import secrets

from fastapi import APIRouter, HTTPException, Depends
from app.core.database import get_supabase, run_query
from app.models.user import AuthRequest, TokenResponse
from app.api.deps import get_current_user_id
from app.core.cache import cache_get, cache_set, cache_delete

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# Holds strong references to fire-and-forget tasks so the GC can't collect them
# before they finish. Tasks remove themselves when done.
_bg_tasks: set[asyncio.Task] = set()


def _fire(coro) -> None:
    """Schedule a coroutine as a background task with GC protection."""
    task = asyncio.create_task(coro)
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)

_RESET_TTL = 900  # 15 minutes

def _set_reset_code(key: str, value: dict) -> None:
    cache_set(key, value, ttl=_RESET_TTL)

def _get_reset_code(key: str) -> dict | None:
    return cache_get(key)

def _del_reset_code(key: str) -> None:
    cache_delete(key)


async def _send_welcome_email(email: str, attempt: int = 1) -> None:
    """
    Send the welcome email. Retries up to 3 times with exponential backoff.
    Logs success and every failure — never swallows errors silently.
    """
    from app.services.email_service import send_email, NUVOS_LOGO_SRC
    subject = "Ya eres parte de Nuvos AI 🎉"
    html = f"""<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:40px 16px">

    <div style="text-align:center;margin-bottom:32px">
      <img src="{NUVOS_LOGO_SRC}" alt="Nuvos AI" width="120" style="display:inline-block">
    </div>

    <div style="background:#1a1d27;border-radius:20px;padding:36px 32px;border:1px solid #2a2d3a">

      <h1 style="margin:0 0 8px;color:#ffffff;font-size:24px;font-weight:900;letter-spacing:-0.5px">
        Ya eres parte de Nuvos AI 🎉
      </h1>
      <p style="margin:0 0 28px;color:#9ca3af;font-size:15px;line-height:1.6">
        Tu cuenta está lista. Ya puedes hablar con tu mentor financiero personal,
        entender tu portafolio y tomar mejores decisiones con tu dinero — en español, sin jerga.
      </p>

      <div style="margin-bottom:28px">

        <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:18px">
          <div style="width:36px;height:36px;border-radius:10px;background:rgba(0,168,94,0.12);border:1px solid rgba(0,168,94,0.25);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;line-height:36px;text-align:center">💬</div>
          <div>
            <p style="margin:0 0 2px;color:#fff;font-size:14px;font-weight:700">Pregúntale al mentor</p>
            <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5">Cualquier duda sobre inversiones, sin importar qué tan básica sea. Sin juicios.</p>
          </div>
        </div>

        <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:18px">
          <div style="width:36px;height:36px;border-radius:10px;background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.25);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;line-height:36px;text-align:center">📊</div>
          <div>
            <p style="margin:0 0 2px;color:#fff;font-size:14px;font-weight:700">Analiza tu portafolio</p>
            <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5">Descubre qué tan arriesgado está tu dinero y qué pasaría en una crisis como 2008.</p>
          </div>
        </div>

        <div style="display:flex;align-items:flex-start;gap:14px">
          <div style="width:36px;height:36px;border-radius:10px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.25);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;line-height:36px;text-align:center">🎯</div>
          <div>
            <p style="margin:0 0 2px;color:#fff;font-size:14px;font-weight:700">Practica sin arriesgar</p>
            <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5">Usa el paper trading para aprender a invertir con dinero virtual antes de usar el real.</p>
          </div>
        </div>

      </div>

      <a href="https://nuvosai.com/home"
         style="display:block;text-align:center;background:linear-gradient(90deg,#00a85e,#00d47e);color:#000;font-size:15px;font-weight:800;text-decoration:none;padding:14px 24px;border-radius:12px;margin-bottom:24px">
        Empezar ahora →
      </a>

      <div style="border-top:1px solid #2a2d3a;margin-bottom:20px"></div>

      <p style="margin:0;color:#9ca3af;font-size:13px;line-height:1.6;text-align:center">
        Tienes <strong style="color:#00d47e">90 días de Premium gratis</strong> incluidos en tu cuenta nueva.
        Úsalos para explorar todo sin límites.
      </p>

    </div>

    <p style="text-align:center;color:#4b5563;font-size:12px;margin-top:24px;line-height:1.6">
      Nuvos AI · Tu mentor financiero personal<br>
      <a href="https://nuvosai.com" style="color:#4b5563;text-decoration:none">nuvosai.com</a>
    </p>

  </div>
</body>
</html>"""

    try:
        ok = await send_email(email, subject, html)
        if ok:
            logger.info("Welcome email sent → %s", email)
            return
        # send_email returned False (API error / missing key)
        raise RuntimeError("send_email returned False")
    except Exception as exc:
        if attempt < 3:
            delay = 10 * attempt  # 10s, 20s
            logger.warning(
                "Welcome email attempt %d/3 failed for %s (%s) — retrying in %ds",
                attempt, email, exc, delay,
            )
            await asyncio.sleep(delay)
            await _send_welcome_email(email, attempt + 1)
        else:
            logger.error(
                "Welcome email FAILED after 3 attempts for %s: %s", email, exc
            )


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

        _fire(_send_welcome_email(request.email))

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
            _set_reset_code(f"reset_code:email:{email}", {"code": code})
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
            _set_reset_code(f"reset_code:phone:{phone}", {"code": code, "email": email})
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
        entry = _get_reset_code(f"reset_code:phone:{phone}")
        if not entry:
            raise HTTPException(status_code=400, detail="Código inválido o expirado")
        if entry["code"] != code:
            raise HTTPException(status_code=400, detail="Código incorrecto")
        email = entry["email"]
        _del_reset_code(f"reset_code:phone:{phone}")
    else:
        # Email flow
        if not email:
            raise HTTPException(status_code=400, detail="Email requerido")
        entry = _get_reset_code(f"reset_code:email:{email}")
        if not entry:
            raise HTTPException(status_code=400, detail="Código inválido o expirado")
        if entry["code"] != code:
            raise HTTPException(status_code=400, detail="Código incorrecto")
        _del_reset_code(f"reset_code:email:{email}")

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
                       "user_notifications", "watchlist", "notification_preferences",
                       "notification_log", "notification_analytics"]:
            try:
                await run_query(db.table(table).delete().eq("user_id", user_id))
            except Exception:
                pass

        # Delete the auth user (requires service key)
        await asyncio.to_thread(lambda: db.auth.admin.delete_user(user_id))
    except Exception as e:
        raise HTTPException(status_code=500, detail="No se pudo eliminar la cuenta.")

    return {"message": "Cuenta eliminada"}
