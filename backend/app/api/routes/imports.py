"""Importación automática — see app/services/inbound_import.py.

POST /api/imports/inbound-email is the webhook the inbound-mail provider
calls for every email sent to <alias>@INBOUND_EMAIL_DOMAIN. It's protected
by a shared secret (?secret=INBOUND_EMAIL_SECRET) and accepts either a
Postmark inbound payload or a simple generic JSON (what the Cloudflare
Email Worker in scripts/inbound_email_worker.js posts):

  {"from": "...", "to": ["..."], "subject": "...", "text": "...", "html": "...",
   "message_id": "...", "attachments": [{"filename","content_type","content"(base64)}]}
"""
import hmac
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from app.api.deps import get_current_user_id
from app.core.config import settings
from app.services import inbound_import

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/imports", tags=["imports"])


@router.get("/email-alias")
async def email_alias(user_id: str = Depends(get_current_user_id)):
    try:
        address = await inbound_import.get_or_create_alias(user_id)
    except Exception as e:
        logger.error("email_alias failed for %s: %s", user_id, e)
        raise HTTPException(status_code=503, detail="No pudimos generar tu dirección. Intenta de nuevo en unos minutos.")
    return {"address": address}


def _normalize_payload(p: dict) -> dict:
    if "FromFull" in p or "TextBody" in p or "HtmlBody" in p:  # Postmark
        recipients = [x.get("Email", "") for x in (p.get("ToFull") or []) + (p.get("CcFull") or [])]
        if p.get("OriginalRecipient"):
            recipients.append(p["OriginalRecipient"])
        return {
            "from": (p.get("FromFull") or {}).get("Email") or p.get("From") or "",
            "to": recipients or [p.get("To") or ""],
            "subject": p.get("Subject") or "",
            "text": p.get("TextBody") or "",
            "html": p.get("HtmlBody") or "",
            "message_id": p.get("MessageID"),
            "attachments": [{"filename": a.get("Name"), "content_type": a.get("ContentType"), "content": a.get("Content")}
                            for a in (p.get("Attachments") or [])],
        }
    to = p.get("to") or []
    if isinstance(to, str):
        to = [x.strip() for x in to.split(",")]
    return {"from": p.get("from") or "", "to": to, "subject": p.get("subject") or "", "text": p.get("text") or "",
            "html": p.get("html") or "", "message_id": p.get("message_id"), "attachments": p.get("attachments") or []}


@router.post("/inbound-email")
async def inbound_email(request: Request, secret: str = Query(default="")):
    expected = getattr(settings, "inbound_email_secret", "") or ""
    if not expected or not hmac.compare_digest(secret, expected):
        raise HTTPException(status_code=401, detail="invalid secret")
    payload = _normalize_payload(await request.json())
    try:
        result = await inbound_import.handle_inbound(
            payload["from"], payload["to"], payload["subject"], payload["text"], payload["html"],
            payload["attachments"], payload.get("message_id"),
        )
    except Exception as e:
        logger.error("inbound_email handling failed: %s", e)
        result = {"ok": False, "reason": "error"}
    # Always 200 so the provider doesn't retry-storm; failures are logged/stored.
    return result


class ApplyBody(BaseModel):
    portfolio_id: str | None = None


@router.post("/{import_id}/apply")
async def apply_import(import_id: str, body: ApplyBody, user_id: str = Depends(get_current_user_id)):
    try:
        return await inbound_import.apply_import(user_id, import_id, body.portfolio_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("apply_import failed for %s/%s: %s", user_id, import_id, e)
        raise HTTPException(status_code=503, detail="No pude registrar las operaciones. Tu portafolio no fue modificado.")


@router.post("/{import_id}/dismiss")
async def dismiss_import(import_id: str, user_id: str = Depends(get_current_user_id)):
    await inbound_import.dismiss_import(user_id, import_id)
    return {"ok": True}


class SharedBody(BaseModel):
    files: list[dict]  # [{filename, content_type, content(base64)}]


@router.post("/shared")
async def shared_import(body: SharedBody, user_id: str = Depends(get_current_user_id)):
    """Mobile share-sheet import — see inbound_import.handle_shared."""
    files = [f for f in body.files if f.get("content")][:5]
    if not files:
        raise HTTPException(status_code=400, detail="No llegó ningún archivo.")
    try:
        return await inbound_import.handle_shared(user_id, files)
    except Exception as e:
        logger.error("shared_import failed for %s: %s", user_id, e)
        raise HTTPException(status_code=503, detail="No pude leer el archivo. Intenta de nuevo.")
