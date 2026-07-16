import asyncio
import logging
import secrets

from fastapi import APIRouter, HTTPException, Depends, Request, Response, Header, Cookie
from app.core.config import settings
from app.core.database import get_supabase, run_query, run_auth
from app.models.user import AuthRequest, TokenResponse
from app.api.deps import get_current_user_id
from app.core.cache import cache_get, cache_set, cache_delete
from app.core.limiter import limiter
from app.core.security import (
    check_login_lockout, record_login_failure, record_login_success,
    check_reset_code_lockout, record_reset_code_failure, record_reset_code_success,
    log_security_event, client_ip,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# Web reads auth from these httpOnly cookies instead of localStorage (never
# JS-readable, so an XSS bug can't exfiltrate the token). Mobile is untouched —
# it keeps sending `Authorization: Bearer <token>` from SecureStore, and the
# response body below still carries both tokens for it. `secure`/`samesite`
# differ locally (plain http://localhost) vs production (cross-site https
# between the web app's domain and this API's domain needs SameSite=None).
_IS_PROD = settings.environment == "production"
_COOKIE_KW = {
    "httponly": True,
    "secure": _IS_PROD,
    "samesite": "none" if _IS_PROD else "lax",
    "path": "/",
}


_REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 90  # 90 days


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str | None) -> None:
    # This is a SLIDING window, not a fixed one: every successful call to
    # /api/auth/refresh re-sets this cookie with a fresh 90-day clock (see the
    # `refresh_token` route below, which calls this on every refresh). So a
    # user who opens the app at least once every ~90 days never sees a login
    # screen — only real inactivity beyond that, or an explicit logout /
    # password change, actually ends the session. Not made infinite on
    # purpose: an unlimited refresh_token is effectively a permanent
    # credential, and if one were ever leaked it would grant indefinite
    # account access with no natural expiry to cut it off.
    response.set_cookie("access_token", access_token, max_age=60 * 60, **_COOKIE_KW)
    if refresh_token:
        response.set_cookie("refresh_token", refresh_token, max_age=_REFRESH_COOKIE_MAX_AGE, **_COOKIE_KW)


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")

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


_WELCOME_COPY = {
    "es": {
        "subject": "Ya eres parte de Nuvos AI 🎉",
        "header_tagline": "Tu cuenta ya está lista",
        "heading": "Ya eres parte de Nuvos AI",
        "intro": "Tu cuenta está lista. Ya puedes hablar con tu mentor financiero personal, "
                 "entender tu portafolio y tomar mejores decisiones con tu dinero — en español, sin jerga.",
        "features": [
            ("💬", "Pregúntale al mentor", "Cualquier duda sobre inversiones, sin importar qué tan básica sea. Sin juicios."),
            ("📊", "Analiza tu portafolio", "Descubre qué tan arriesgado está tu dinero y qué pasaría en una crisis como 2008."),
            ("🎯", "Practica sin arriesgar", "Usa el paper trading para aprender a invertir con dinero virtual antes de usar el real."),
        ],
        "trial_html": 'Tienes <strong style="color:#00d47e">90 días de Premium gratis</strong> incluidos en tu cuenta nueva. Úsalos para explorar todo sin límites.',
        "cta": "Empezar ahora →",
        "footer": "Nuvos AI · Tu mentor financiero personal · nuvosai.com",
        "html_lang": "es",
    },
    "en": {
        "subject": "You're in — welcome to Nuvos AI 🎉",
        "header_tagline": "Your account is ready",
        "heading": "You're part of Nuvos AI now",
        "intro": "Your account is ready. You can now talk to your personal financial mentor, "
                 "understand your portfolio, and make better decisions with your money — no jargon, ever.",
        "features": [
            ("💬", "Ask your mentor anything", "Any question about investing, no matter how basic. No judgment."),
            ("📊", "Analyze your portfolio", "See how risky your money really is and what a crash like 2008 would do to it."),
            ("🎯", "Practice risk-free", "Use paper trading to learn before you invest a single real dollar."),
        ],
        "trial_html": 'You have <strong style="color:#00d47e">90 days of Premium free</strong> included in your new account. Use them to explore everything with no limits.',
        "cta": "Get started →",
        "footer": "Nuvos AI · Your personal financial mentor · nuvosai.com",
        "html_lang": "en",
    },
}


async def _send_welcome_email(email: str, language: str | None = None, attempt: int = 1) -> None:
    """
    Send the welcome email in the user's UI language at signup. Retries up to
    3 times with exponential backoff. Logs success and every failure — never
    swallows errors silently.
    """
    from app.services.email_service import send_email, _nuvos_email_header, _feature_rows
    copy = _WELCOME_COPY.get(language or "es", _WELCOME_COPY["es"])
    header = _nuvos_email_header(copy["header_tagline"])
    features_html = _feature_rows(copy["features"])
    html = f"""<!DOCTYPE html>
<html lang="{copy['html_lang']}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">
  <div style="border-radius:20px;overflow:hidden;border:1px solid #2a2d3a">
    {header}
    <div style="background:#1a1d27;padding:36px 32px">
      <div style="text-align:center;margin-bottom:22px">
        <div style="font-size:44px;line-height:1;margin-bottom:12px">🎉</div>
        <h1 style="margin:0;color:#f4f5f7;font-size:25px;font-weight:900;letter-spacing:-0.4px">
          {copy['heading']}
        </h1>
      </div>
      <p style="margin:0 0 26px;color:#9aa0ac;font-size:14.5px;line-height:1.7;text-align:center">
        {copy['intro']}
      </p>

      <div style="background:#111318;border:1px solid #2a2d3a;border-radius:16px;padding:20px 20px 6px;margin-bottom:22px">
        {features_html}
      </div>

      <div style="background:rgba(0,212,126,0.08);border:1px solid rgba(0,212,126,0.25);border-radius:14px;padding:16px 18px;margin-bottom:26px;text-align:center">
        <p style="margin:0;color:#e5e7eb;font-size:13.5px;line-height:1.6">
          {copy['trial_html']}
        </p>
      </div>

      <a href="https://nuvosai.com/home"
         style="display:block;text-align:center;background:linear-gradient(135deg,#00a85e,#00d47e);color:#04140b;font-size:15.5px;font-weight:900;text-decoration:none;padding:15px 24px;border-radius:14px;box-shadow:0 8px 24px rgba(0,168,94,0.25)">
        {copy['cta']}
      </a>

      <div style="border-top:1px solid #2a2d3a;margin-top:26px;padding-top:18px;text-align:center">
        <p style="margin:0;color:#5b6270;font-size:11px;line-height:1.6">{copy['footer']}</p>
      </div>
    </div>
  </div>
</div>
</body>
</html>"""

    try:
        ok = await send_email(email, copy["subject"], html)
        if ok:
            logger.info("Welcome email sent → %s (lang=%s)", email, language or "es")
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
            await _send_welcome_email(email, language, attempt + 1)
        else:
            logger.error(
                "Welcome email FAILED after 3 attempts for %s: %s", email, exc
            )


@router.post("/register", response_model=TokenResponse)
@limiter.limit("5/hour")
async def register(request: Request, response: Response, body: AuthRequest):
    try:
        db = get_supabase()
        result = db.auth.sign_up({
            "email": body.email,
            "password": body.password,
        })
        if result.user is None:
            raise HTTPException(status_code=400, detail="No se pudo crear la cuenta")
        if result.session is None:
            raise HTTPException(status_code=400, detail="Cuenta creada. Revisa tu correo para confirmar.")

        _fire(_send_welcome_email(body.email, body.language))

        _set_auth_cookies(response, result.session.access_token, result.session.refresh_token)
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
            log_security_event("register_duplicate_email", email=body.email, ip=client_ip(request))
            raise HTTPException(status_code=400, detail="Este email ya tiene una cuenta. Inicia sesión.")
        raise HTTPException(status_code=400, detail=f"Error al crear cuenta: {msg}")


@router.post("/login", response_model=TokenResponse)
@limiter.limit("15/minute")
async def login(request: Request, response: Response, body: AuthRequest):
    email = body.email.strip().lower()
    ip = client_ip(request)
    # Reject before ever touching Supabase if this email or IP is already
    # locked out from prior failures — this is what actually stops
    # brute-force/credential-stuffing, not just the per-minute rate limit
    # above (which alone would still allow ~15 guesses/min indefinitely).
    check_login_lockout(email, ip)
    try:
        db = get_supabase()
        result = db.auth.sign_in_with_password({
            "email": email,
            "password": body.password,
        })
        if result.user is None:
            record_login_failure(email, ip)
            raise HTTPException(status_code=401, detail="Credenciales inválidas")
        record_login_success(email, ip)
        _set_auth_cookies(response, result.session.access_token, result.session.refresh_token)
        return TokenResponse(
            access_token=result.session.access_token,
            refresh_token=result.session.refresh_token,
            user_id=result.user.id,
        )
    except HTTPException:
        raise
    except Exception as e:
        record_login_failure(email, ip)
        raise HTTPException(status_code=401, detail="Credenciales inválidas")


@router.post("/refresh")
@limiter.limit("30/minute")
async def refresh_token(request: Request, response: Response, body: dict):
    try:
        # Mobile sends refresh_token in the JSON body (from SecureStore). Web
        # can't do that anymore post-cookie-migration — it never has JS access
        # to the refresh token — so it relies on the httpOnly cookie instead.
        token = body.get("refresh_token") or request.cookies.get("refresh_token") or ""
        if not token:
            raise HTTPException(status_code=401, detail="refresh_token requerido")
        db = get_supabase()
        result = db.auth.refresh_session(token)
        if result.session is None:
            raise HTTPException(status_code=401, detail="Sesión inválida o expirada")
        _set_auth_cookies(response, result.session.access_token, result.session.refresh_token)
        return {
            "access_token": result.session.access_token,
            "refresh_token": result.session.refresh_token,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Refresh error: {str(e)}")


@router.post("/set-session")
@limiter.limit("30/minute")
async def set_session(request: Request, response: Response, body: dict):
    """Web-only edge case: another tab refreshed via the Supabase JS SDK
    directly (not through our /refresh), so our httpOnly cookie is stale but
    the Supabase client-side session is still valid. The frontend reads that
    session (access_token is transiently in JS memory for this one call, never
    persisted) and hands it here just to re-mint our cookie — validated first
    so a client can't set an arbitrary user's cookie."""
    access_token = body.get("access_token", "")
    refresh_token = body.get("refresh_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="access_token requerido")
    from app.api.deps import _resolve_user_token
    await _resolve_user_token(access_token)  # raises 401 if invalid — don't trust blindly
    _set_auth_cookies(response, access_token, refresh_token)
    return {"ok": True}


@router.post("/forgot-password")
@limiter.limit("3/hour")
async def forgot_password(request: Request, body: dict):
    email = body.get("email", "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email requerido")
    log_security_event("password_reset_requested", email=email, ip=client_ip(request))
    db = get_supabase()
    try:
        users = await asyncio.to_thread(lambda: db.auth.admin.list_users())
        user = next((u for u in users if u.email and u.email.lower() == email), None)
        if user:
            code = f"{secrets.randbelow(1000000):06d}"
            _set_reset_code(f"reset_code:email:{email}", {"code": code})
            from app.services.email_service import send_email
            from app.core.database import run_query
            lang_res = await run_query(
                db.table("user_profiles").select("preferred_language").eq("user_id", user.id).limit(1)
            )
            is_en = ((lang_res.data or [{}])[0].get("preferred_language") or "es") == "en"
            if is_en:
                html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:480px;margin:0 auto;padding:40px 20px">
    <div style="background:#1a1d27;border-radius:20px;padding:32px;border:1px solid #2a2d3a">
      <div style="color:#fff;font-size:20px;font-weight:800;margin-bottom:8px">Verification code</div>
      <p style="color:#9ca3af;font-size:14px;margin:0 0 28px">Use this code to reset your Nuvos AI password. It expires in 15 minutes.</p>
      <div style="background:#0f1117;border-radius:14px;padding:28px;text-align:center;border:1px solid #2a2d3a;letter-spacing:10px;font-size:36px;font-weight:900;color:#22c55e;margin-bottom:24px">{code}</div>
      <p style="color:#6b7280;font-size:12px;margin:0;text-align:center">If you didn't request this, ignore this email.</p>
    </div>
  </div>
</body></html>"""
                subject = "Your verification code — Nuvos AI"
            else:
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
                subject = "Tu código de verificación — Nuvos AI"
            await send_email(email, subject, html)
    except Exception:
        pass
    return {"message": "Si el email existe recibirás un código en tu correo"}


@router.post("/forgot-password-sms")
@limiter.limit("3/hour")
async def forgot_password_sms(request: Request, body: dict):
    email = body.get("email", "").strip().lower()
    phone = body.get("phone", "").strip()
    if not email or not phone:
        raise HTTPException(status_code=400, detail="Email y teléfono requeridos")
    log_security_event("password_reset_sms_requested", email=email, ip=client_ip(request), detail=phone)
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
@limiter.limit("10/hour")
async def reset_password(request: Request, body: dict):
    phone = body.get("phone", "").strip()
    email = body.get("email", "").strip().lower()
    code  = body.get("code", "").strip()
    new_password = body.get("new_password", "")

    if not code or not new_password:
        raise HTTPException(status_code=400, detail="Todos los campos son requeridos")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 6 caracteres")

    # The identity used for lockout tracking must match whichever key the
    # code itself is stored under (phone for the SMS flow, email otherwise)
    # — this is what actually closes the brute-force gap: the 6-digit code
    # has a 1-in-1,000,000 chance per guess, but with no attempt limit an
    # attacker had the entire 15-minute TTL window to try all of them.
    identity = phone if phone else email
    check_reset_code_lockout(identity)

    if phone:
        # SMS flow: look up code by phone
        entry = _get_reset_code(f"reset_code:phone:{phone}")
        if not entry:
            raise HTTPException(status_code=400, detail="Código inválido o expirado")
        if entry["code"] != code:
            record_reset_code_failure(identity)
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
            record_reset_code_failure(identity)
            raise HTTPException(status_code=400, detail="Código incorrecto")
        _del_reset_code(f"reset_code:email:{email}")

    record_reset_code_success(identity)
    log_security_event("password_reset_completed", email=email, ip=client_ip(request))

    db = get_supabase()
    users = await asyncio.to_thread(lambda: db.auth.admin.list_users())
    user = next((u for u in users if u.email and u.email.lower() == email), None)
    if not user:
        raise HTTPException(status_code=400, detail="Usuario no encontrado")
    await asyncio.to_thread(lambda: db.auth.admin.update_user_by_id(user.id, {"password": new_password}))
    return {"message": "Contraseña actualizada correctamente"}


@router.post("/logout")
async def logout(
    response: Response,
    authorization: str = Header(default=""),
    access_token: str | None = Cookie(default=None),
):
    # Explicitly pass the CALLER's own token to admin.sign_out — the
    # stateful db.auth.sign_out() reads whatever session gotrue last cached
    # on this shared client (potentially a different, unrelated user's), see
    # the note on get_supabase() in database.py. Using the admin API with an
    # explicit token never depends on that shared state.
    from app.api.deps import _extract_token
    token = _extract_token(authorization, access_token)
    if token:
        try:
            db = get_supabase()
            await run_auth(db.auth.admin.sign_out, token, "global")
        except Exception:
            pass
    _clear_auth_cookies(response)
    return {"message": "Logged out"}


# Every table that stores rows keyed by user_id. Kept for reference/visibility
# — the actual deletion now runs atomically inside the delete_user_data()
# Postgres function (migrations/035_atomic_account_deletion.sql), which MUST
# be kept in sync with this list. Previously this list drove a per-table
# Python loop with its own try/except per table and no rollback: a failure
# partway through left the auth user deleted (email freed for reuse) while
# some tables still held orphaned rows keyed to a user_id with no matching
# account — exactly what caused re-registering with a deleted account's
# email to skip onboarding once before. Running the deletes inside a single
# Postgres function body means Postgres itself guarantees all-or-nothing.
_USER_DATA_TABLES = [
    "user_profiles", "user_portfolio", "portfolio_positions", "user_paper_trading",
    "user_daily_usage", "web_push_subscriptions", "chat_history",
    "notifications", "watchlist", "notification_preferences",
    "notification_log", "notification_analytics", "investment_decisions",
    "support_tickets", "user_feedback", "price_alerts", "pending_actions",
    "upsell_dismissals", "upsell_events", "brokerage_connections",
    "voice_call_transcripts", "user_financial_goals", "user_sector_preferences",
    "library_items", "habit_engagement",
    "fmg_memories", "fmg_behavioral_patterns", "fmg_events",
    "fmg_portfolio_snapshots", "fmg_annual_reports",
    "valuation_alert_state", "thesis_drift_state",
    "clip_likes", "clip_saves", "clip_views", "clip_comments",
    "research_jobs", "research_reports", "security_events",
]


@router.delete("/account")
async def delete_account(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()

    # Atomic: either every table listed above is cleared, or (on any single
    # failure) NONE of them are — Postgres rolls the whole function body
    # back. No more "deleted from 20 of 35 tables" partial state.
    try:
        await run_query(db.rpc("delete_user_data", {"p_user_id": user_id}))
    except Exception as e:
        logger.error("delete_account: atomic data deletion failed for %s (fully rolled back): %s", user_id, e)
        raise HTTPException(status_code=500, detail="No se pudo eliminar los datos de la cuenta. Intenta de nuevo.")

    # Delete the auth user itself (requires service key) — this is the step
    # that actually frees up the email for reuse. If THIS fails, the account
    # still exists but now has zero associated data — the user (or a retry
    # of this same endpoint) can safely call delete again, since re-running
    # delete_user_data against already-empty tables is a harmless no-op.
    try:
        await asyncio.to_thread(lambda: db.auth.admin.delete_user(user_id))
    except Exception as e:
        logger.error("delete_account: failed to delete auth user %s (data already fully cleared): %s", user_id, e)
        raise HTTPException(status_code=500, detail="No se pudo eliminar la cuenta.")

    return {"message": "Cuenta eliminada"}
