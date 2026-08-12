"""
Belvo integration — LatAm open banking (bank accounts first; brokerage/
investment-portfolio sync is Phase 2, see /Users/diegoarria/.claude/plans/
cosmic-munching-crown.md).

Belvo is provider #3 on the existing `brokerage_connections` table
(Plaid, IOL, now Belvo — see brokerage.py's docstring for the original
schema; migration 071 adds the Belvo-specific columns and makes
access_token nullable, since Belvo doesn't hand out a per-link bearer
token the way Plaid/IOL do).

Security boundary: raw bank credentials are NEVER seen by this backend
or the frontend. The user types them directly into Belvo's hosted
Connect Widget (an iframe Belvo serves); this backend only ever handles
(a) a short-lived widget access token used to boot that widget, and
(b) the resulting `link_id` once the widget succeeds. Every actual data
call (accounts, balances) authenticates to Belvo server-to-server via
`secret_id`/`secret_password` (HTTP Basic Auth) — never exposed to the
frontend.

NOTE — several exact Belvo API details (webhook signature header name,
whether accounts is GET or POST, precise `category`/`webhook_code`
string values) are implemented against Belvo's documented conventions
as of this writing but should be re-confirmed against Belvo's current
API reference before flipping `belvo_env` to "production" — flagged
inline at each such spot rather than silently assumed correct.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.api.deps import get_current_user_id
from app.core.cache import cache_get, cache_set, cache_delete
from app.core.config import settings
from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/belvo", tags=["belvo"])

# Banking account categories Belvo returns that count as "cash" for
# cash_holdings — investment/brokerage categories are deliberately
# excluded here (Phase 2 handles those into user_portfolio instead).
_CASH_ACCOUNT_CATEGORIES = {"CHECKING_ACCOUNT", "SAVINGS_ACCOUNT"}

_INSTITUTIONS_CACHE_TTL = 24 * 3600  # institutions list changes rarely — same caching philosophy as cash_holdings.py's Banxico/FRED rate caching


def _belvo_base() -> str:
    return "https://api.belvo.com" if settings.belvo_env == "production" else "https://sandbox.belvo.com"


def _belvo_auth() -> tuple[str, str]:
    if not settings.belvo_secret_id or not settings.belvo_secret_password:
        raise HTTPException(status_code=503, detail="Belvo no está configurado en este servidor.")
    return (settings.belvo_secret_id, settings.belvo_secret_password)


async def _belvo_request(method: str, path: str, **kwargs) -> httpx.Response:
    auth = _belvo_auth()
    async with httpx.AsyncClient(timeout=30, auth=auth) as client:
        return await client.request(method, f"{_belvo_base()}{path}", **kwargs)


# ── Widget token ────────────────────────────────────────────────────────────

class WidgetTokenRequest(BaseModel):
    link_id: Optional[str] = None  # present = "update mode" (re-auth a broken link) instead of a fresh link


@router.post("/widget-token")
async def create_widget_token(body: WidgetTokenRequest, user_id: str = Depends(get_current_user_id)):
    """Short-lived token that boots Belvo's hosted Connect Widget in the
    frontend. `scopes` follows Belvo's documented widget-token scope set —
    never request a broader scope than the widget actually needs."""
    payload = {
        "id": settings.belvo_secret_id,
        "password": settings.belvo_secret_password,
        "scopes": "read_institutions,write_links,read_consents,read_consent_requests",
    }
    if body.link_id:
        payload["link_id"] = body.link_id
    try:
        resp = await _belvo_request("POST", "/api/token/", json=payload)
    except Exception as e:
        logger.error("Belvo widget-token request failed: %s", e)
        raise HTTPException(status_code=503, detail="No se pudo iniciar la conexión con Belvo. Intenta de nuevo.")
    if resp.status_code >= 400:
        logger.error("Belvo widget-token error %s: %s", resp.status_code, resp.text[:300])
        raise HTTPException(status_code=503, detail="No se pudo iniciar la conexión con Belvo. Intenta de nuevo.")
    data = resp.json()
    return {"access": data.get("access")}


# ── Institutions (for the picker — banking only in Phase 1) ────────────────

@router.get("/institutions")
async def list_institutions(category: str = "banking", debug: bool = False):
    """Real, live-fetched institution list (never a hardcoded/invented
    one) so the widget/picker can only ever offer institutions Belvo
    actually supports — same reasoning as the plan's coverage caveat.
    Cached: this list changes rarely.

    `debug=1` bypasses the cache and returns Belvo's raw response
    verbatim instead of the mapped/filtered shape — useful for
    re-confirming Belvo's institution catalog and query-param values
    directly (e.g. at the sandbox→production cutover, when the real MX
    bank/investment institution codes need verifying). Institution
    names/logos are public catalog data, not user data, so no auth/PII
    exposure here."""
    # v2: bumped after fixing the type="bank" / country filter bug below —
    # v1 keys cached the (wrong) empty result for up to 24h.
    ck = f"belvo:institutions:v2:{category}"
    if not debug:
        cached = cache_get(ck)
        if cached is not None:
            return {"institutions": cached}
    # Belvo's institution "type" enum uses "bank", not our "banking" category
    # name — confirmed against a live sandbox response (2026-08-11).
    _type_map = {"banking": "bank", "investment": "investment"}
    if category == "all":
        params: dict = {}
    else:
        params = {"type": _type_map.get(category, category)}
        # Sandbox's fixture institutions are fake/international (Brazil,
        # Chile, ...) with no Mexican "bank"-type entries at all, so a
        # country_code=MX filter always returns zero results there —
        # confirmed via debug=1 (2026-08-11). Only enforce MX in
        # production, where Belvo's real institution catalog applies.
        if settings.belvo_env == "production":
            params["country_code"] = "MX"
    try:
        resp = await _belvo_request("GET", "/api/institutions/", params=params)
    except Exception as e:
        logger.warning("Belvo institutions fetch failed: %s", e)
        return {"institutions": []}
    if debug:
        try:
            body = resp.json()
        except Exception:
            body = resp.text[:2000]
        return {"status_code": resp.status_code, "body": body}
    if resp.status_code >= 400:
        return {"institutions": []}
    try:
        payload = resp.json()
        # Belvo paginates list endpoints (DRF-style {"results": [...]})
        # rather than returning a bare array — handle both shapes rather
        # than assuming one.
        raw = payload.get("results", payload) if isinstance(payload, dict) else payload
        items = [
            {"name": i.get("name"), "display_name": i.get("display_name"), "logo": i.get("icon_logo") or i.get("logo")}
            for i in raw
            if isinstance(i, dict) and i.get("status") == "healthy"
        ]
    except Exception as e:
        logger.warning("Belvo institutions response parse failed: %s", e)
        return {"institutions": []}
    cache_set(ck, items, ttl=_INSTITUTIONS_CACHE_TTL)
    return {"institutions": items}


# ── Register a link once the widget succeeds ────────────────────────────────

class RegisterLinkRequest(BaseModel):
    link_id: str
    institution_name: str


@router.post("/register-link")
async def register_link(body: RegisterLinkRequest, user_id: str = Depends(get_current_user_id)):
    """Called right after the widget's onSuccess(link_id, institution)
    callback. Confirms the institution's real category via Belvo rather
    than trusting whatever the client claims, upserts the connection, and
    kicks off the first sync in the background so this endpoint returns
    fast (the widget UI shouldn't block on a full historical pull)."""
    try:
        inst_resp = await _belvo_request("GET", f"/api/institutions/{body.institution_name}/")
    except Exception as e:
        logger.error("Belvo institution lookup failed for %s: %s", body.institution_name, e)
        raise HTTPException(status_code=503, detail="No se pudo verificar la institución conectada.")
    if inst_resp.status_code >= 400:
        raise HTTPException(status_code=400, detail="Institución desconocida.")
    category = (inst_resp.json().get("type") or "banking").lower()

    db = get_supabase()
    now = datetime.now(timezone.utc).isoformat()
    result = await run_query(
        db.table("brokerage_connections").upsert(
            {
                "user_id": user_id,
                "provider": "belvo",
                "institution_name": body.institution_name,
                "institution_id": body.institution_name,
                "belvo_link_id": body.link_id,
                "belvo_category": category,
                "status": "valid",
                "status_updated_at": now,
                "last_sync_at": now,
            },
            on_conflict="user_id,provider,institution_id",
        )
    )
    if not result.data:
        # Same class of bug hardened elsewhere in this codebase (see
        # profile.py's create_profile): an upsert that commits but
        # returns no rows must never crash on result.data[0] below.
        raise HTTPException(status_code=503, detail="No se pudo guardar la conexión. Intenta de nuevo en unos segundos.")
    connection = result.data[0]

    if category == "banking":
        asyncio.create_task(_sync_belvo_banking(connection))
    # else: category == "investment" — Phase 2, not implemented yet.
    # The connection is still saved so it shows up (read-only, "próximamente")
    # once Phase 2 ships, rather than silently rejecting the link.

    return {"ok": True, "institution": body.institution_name, "category": category}


# ── Sync: banking accounts -> cash_holdings ─────────────────────────────────

async def _sync_belvo_banking(connection: dict) -> None:
    """Fetches accounts for one Belvo link and upserts checking/savings
    balances into cash_holdings. Own try/except at the call site (worker
    job, webhook handler, register-link) — a failure here must never
    crash the caller."""
    link_id = connection["belvo_link_id"]
    connection_id = connection["id"]
    user_id = connection["user_id"]
    db = get_supabase()
    try:
        resp = await _belvo_request("POST", "/api/accounts/", json={"link": link_id, "save_data": True})
    except Exception as e:
        logger.warning("Belvo accounts fetch failed for connection %s: %s", connection_id, e)
        return
    if resp.status_code >= 400:
        logger.warning("Belvo accounts error %s for connection %s: %s", resp.status_code, connection_id, resp.text[:300])
        return

    try:
        payload = resp.json()
        # Same DRF-style pagination possibility as /api/institutions/ — see
        # list_institutions above. Handle both a bare list and {"results": [...]}.
        accounts = payload.get("results", payload) if isinstance(payload, dict) else payload
        if not isinstance(accounts, list):
            raise ValueError(f"unexpected accounts payload shape: {type(accounts)}")
    except Exception as e:
        logger.warning("Belvo accounts response parse failed for connection %s: %s", connection_id, e)
        return

    now = datetime.now(timezone.utc).isoformat()
    for acc in accounts:
        if not isinstance(acc, dict) or (acc.get("category") or "").upper() not in _CASH_ACCOUNT_CATEGORIES:
            continue
        balance = acc.get("balance") or {}
        amount = balance.get("available")
        if amount is None:
            amount = balance.get("current")
        if amount is None:
            continue
        await run_query(
            db.table("cash_holdings").upsert(
                {
                    "user_id": user_id,
                    "amount": amount,
                    "currency": acc.get("currency") or "MXN",
                    "instrument": "bank",
                    "label": f"{connection.get('institution_name')} — {acc.get('name') or acc.get('category')}",
                    "source": "belvo",
                    "belvo_connection_id": connection_id,
                    "belvo_account_id": acc.get("id"),
                    "updated_at": now,
                },
                on_conflict="user_id,belvo_account_id",
            )
        )

    await run_query(
        db.table("brokerage_connections").update({"last_sync_at": now}).eq("id", connection_id)
    )
    cache_delete(f"cash_holdings:{user_id}")


# ── Management endpoints ────────────────────────────────────────────────────

@router.get("/connections")
async def list_connections(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    result = await run_query(
        db.table("brokerage_connections")
        .select("id,institution_name,belvo_category,status,status_updated_at,last_sync_at,created_at")
        .eq("user_id", user_id)
        .eq("provider", "belvo")
        .order("created_at")
    )
    return {"connections": result.data or []}


@router.delete("/connections/{connection_id}")
async def delete_connection(connection_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    existing = await run_query(
        db.table("brokerage_connections")
        .select("belvo_link_id")
        .eq("id", connection_id).eq("user_id", user_id).eq("provider", "belvo")
        .maybe_single()
    )
    link_id = (existing.data or {}).get("belvo_link_id") if existing else None
    if link_id:
        try:
            await _belvo_request("DELETE", f"/api/links/{link_id}/")
        except Exception as e:
            # Revoking on Belvo's side is best-effort — the connection
            # row is deleted below regardless, so Nuvos stops reading
            # from it either way; a failed revoke just means Belvo keeps
            # the (now-unused) link on their side.
            logger.warning("Belvo link revoke failed for %s: %s", link_id, e)
    await run_query(
        db.table("brokerage_connections").delete().eq("id", connection_id).eq("user_id", user_id)
    )
    cache_delete(f"cash_holdings:{user_id}")
    return {"ok": True}


# ── Webhook ──────────────────────────────────────────────────────────────────

def _verify_belvo_signature(payload: bytes, signature: str, secret: str) -> bool:
    if not signature:
        return False
    expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


@router.post("/webhook")
async def belvo_webhook(request: Request):
    """Server-to-server — no user JWT on this request, signature
    verification is the sole auth (same convention as billing.py's
    stripe_webhook). NOTE: confirm the exact signature header name
    against Belvo's current docs before production use — implemented
    here as `belvo-signature` per Belvo's documented HMAC-SHA256 scheme."""
    payload = await request.body()
    signature = request.headers.get("belvo-signature", "")

    if not settings.belvo_webhook_secret:
        raise HTTPException(status_code=503, detail="Webhook no configurado")
    if not _verify_belvo_signature(payload, signature, settings.belvo_webhook_secret):
        raise HTTPException(status_code=400, detail="Firma inválida")

    import json
    try:
        event = json.loads(payload)
    except Exception:
        raise HTTPException(status_code=400, detail="Payload inválido")

    link_id = event.get("link_id") or event.get("link")
    webhook_code = event.get("webhook_code")
    if not link_id:
        return {"ok": True}  # nothing to act on

    db = get_supabase()
    result = await run_query(
        db.table("brokerage_connections")
        .select("*")
        .eq("belvo_link_id", link_id).eq("provider", "belvo")
        .maybe_single()
    )
    connection = result.data if result else None
    if not connection:
        return {"ok": True}  # unknown link (deleted on our side, or a sandbox test event) — ack anyway

    now = datetime.now(timezone.utc).isoformat()
    if webhook_code == "historical_update":
        if connection.get("belvo_category") == "banking":
            asyncio.create_task(_sync_belvo_banking(connection))
        # investment category: Phase 2.
    elif webhook_code in ("token_required", "login_error"):
        await run_query(
            db.table("brokerage_connections")
            .update({"status": webhook_code, "status_updated_at": now})
            .eq("id", connection["id"])
        )
        cache_delete(f"profile:{connection['user_id']}")
    elif webhook_code == "unlinked":
        await run_query(
            db.table("brokerage_connections")
            .update({"status": "unlinked", "status_updated_at": now})
            .eq("id", connection["id"])
        )

    return {"ok": True}
