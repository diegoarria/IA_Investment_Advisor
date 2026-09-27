"""Anonymous visitor tracking endpoint — see guest_tracking_service.py."""
from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.core.limiter import limiter
from app.services import guest_tracking_service

router = APIRouter(prefix="/guest", tags=["guest"])


class GuestTrackRequest(BaseModel):
    guest_id: str
    path: str | None = None
    referrer: str | None = None
    utm_source: str | None = None
    utm_medium: str | None = None
    utm_campaign: str | None = None


@router.post("/track")
@limiter.limit("60/minute")
async def track(request: Request, body: GuestTrackRequest):
    """Never fails the caller — tracking is best-effort."""
    await guest_tracking_service.track_visit(
        body.guest_id, body.path, body.referrer,
        {"utm_source": body.utm_source, "utm_medium": body.utm_medium, "utm_campaign": body.utm_campaign},
        request.headers.get("x-nuvos-ua") or request.headers.get("user-agent"),
        guest_tracking_service.geo_from_headers(request.headers),
    )
    return {"ok": True}
