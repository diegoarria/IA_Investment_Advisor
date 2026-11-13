"""Admin-gated editorial flow for company_qualitative_content (same
`admin_emails` mechanism etf.py/portfolio_exposure.py/admin.py already
use — reused here rather than inventing a new auth scheme). No public
write path exists anywhere: creating a draft, marking it reviewed, and
publishing it all require an authenticated session whose email is on
the admin allowlist. Knowing these routes exist is not authorization —
every one of them re-checks the allowlist itself."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.core.config import settings
from app.services import qualitative_content_service as qcs

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/qualitative-content", tags=["qualitative-content"])


def _admin_emails() -> set[str]:
    return {e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()}


def _require_admin(user: dict) -> str:
    email = (user.get("email") or "").lower()
    if email not in _admin_emails():
        raise HTTPException(status_code=403, detail="No autorizado")
    return email


class QualitativeContentResponse(BaseModel):
    """Stable, public response contract — published+current content only.
    Deliberately omits review_status/is_current: by construction, any
    instance of this model already represents published+current content
    (or the endpoint returned null), so those fields would only ever
    carry one constant value and add nothing a reader needs."""
    ticker: str
    business_model_summary: str | None
    moat: list[dict]
    risks: list[dict]
    last_updated_at: str | None


class DraftRequest(BaseModel):
    ticker: str
    business_model_summary: str
    moat: list[dict]
    risks: list[dict]
    updated_by: str  # human email, or "ai_draft:<model-id>" for an AI-generated draft


class VersionActionRequest(BaseModel):
    ticker: str
    version: int


@router.get("/{ticker}", response_model=QualitativeContentResponse | None)
async def get_qualitative_content(ticker: str):
    """Public read — published+current only. Never 500s: a missing or
    malformed row returns null, same as "no editorial content yet"."""
    content = await qcs.get_published_qualitative_content(ticker)
    return content


@router.post("/draft")
async def create_draft(payload: DraftRequest, user: dict = Depends(get_current_user)):
    _require_admin(user)
    try:
        row = await qcs.create_draft(
            payload.ticker, payload.business_model_summary, payload.moat, payload.risks, payload.updated_by
        )
    except qcs.QualitativeContentError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ticker": row["ticker"], "version": row["version"], "review_status": row["review_status"]}


@router.post("/review")
async def mark_reviewed(payload: VersionActionRequest, user: dict = Depends(get_current_user)):
    admin_email = _require_admin(user)
    try:
        row = await qcs.mark_reviewed(payload.ticker, payload.version, admin_email)
    except qcs.QualitativeContentError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ticker": row["ticker"], "version": row["version"], "review_status": row["review_status"]}


@router.post("/publish")
async def publish(payload: VersionActionRequest, user: dict = Depends(get_current_user)):
    admin_email = _require_admin(user)
    try:
        row = await qcs.publish_version(payload.ticker, payload.version, admin_email)
    except qcs.QualitativeContentError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ticker": row["ticker"], "version": row["version"], "review_status": row["review_status"]}
