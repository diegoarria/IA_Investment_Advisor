"""
Brokerage integrations — read-only position sync.

Supported brokers:
  - Plaid: Interactive Brokers, Charles Schwab, Robinhood (US)
  - IOL (Invertir Online): Argentine broker — direct OAuth

Supabase table required:
  CREATE TABLE brokerage_connections (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    institution_name TEXT,
    institution_id TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    item_id TEXT,
    token_expires_at TIMESTAMPTZ,
    last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, provider, institution_id)
  );
  ALTER TABLE brokerage_connections ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Users manage own connections"
    ON brokerage_connections FOR ALL USING (auth.uid() = user_id);
  CREATE INDEX IF NOT EXISTS idx_brokerage_connections_user_id
    ON brokerage_connections (user_id);
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import get_current_user_id
from app.core.config import settings
from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/brokerage", tags=["brokerage"])

IOL_BASE = "https://api.invertironline.com"


# ── Plaid client (lazy) ───────────────────────────────────────────────────────

def _get_plaid_client():
    if not settings.plaid_client_id or not settings.plaid_secret:
        raise HTTPException(status_code=503, detail="Plaid no está configurado en este servidor.")
    try:
        import plaid
        from plaid.api import plaid_api
        from plaid.configuration import Configuration
        from plaid.api_client import ApiClient

        env_map = {
            "sandbox": plaid.Environment.Sandbox,
            "production": plaid.Environment.Production,
        }
        configuration = Configuration(
            host=env_map.get(settings.plaid_env, plaid.Environment.Sandbox),
            api_key={"clientId": settings.plaid_client_id, "secret": settings.plaid_secret},
        )
        return plaid_api.PlaidApi(ApiClient(configuration))
    except ImportError:
        raise HTTPException(status_code=503, detail="plaid-python no instalado.")


# ── Request / response models ─────────────────────────────────────────────────

class PlaidExchangeRequest(BaseModel):
    public_token: str
    institution_id: str
    institution_name: str

class IOLConnectRequest(BaseModel):
    username: str
    password: str

class BrokerPosition(BaseModel):
    ticker: str
    name: str
    shares: float
    avg_price: float
    current_price: Optional[float] = None
    currency: str = "USD"
    broker_source: str
    institution_name: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _normalize_plaid_holdings(response) -> list[dict]:
    securities = {s["security_id"]: s for s in (response.get("securities") or [])}
    positions = []
    for h in (response.get("holdings") or []):
        sec = securities.get(h.get("security_id"), {})
        ticker = sec.get("ticker_symbol")
        if not ticker:
            continue
        qty = float(h.get("quantity") or 0)
        cost_basis = h.get("cost_basis")
        avg_price = (cost_basis / qty) if cost_basis and qty > 0 else 0.0
        positions.append({
            "ticker": ticker.upper(),
            "name": sec.get("name") or ticker,
            "shares": qty,
            "avgPrice": round(avg_price, 4),
            "currentPrice": float(h.get("institution_price") or 0),
            "currency": h.get("iso_currency_code") or "USD",
            "brokerSource": "plaid",
            "institutionName": "",
        })
    return positions


def _normalize_iol_holdings(activos: list[dict], institution_name: str = "Invertir Online") -> list[dict]:
    positions = []
    for a in activos:
        titulo = a.get("titulo") or {}
        ticker = titulo.get("simbolo") or a.get("simbolo")
        if not ticker:
            continue
        moneda = titulo.get("moneda", "")
        currency = "USD" if "dolar" in moneda.lower() else "ARS"
        positions.append({
            "ticker": ticker.upper(),
            "name": titulo.get("descripcion") or ticker,
            "shares": float(a.get("cantidad") or 0),
            "avgPrice": float(a.get("ppc") or 0),
            "currentPrice": float(a.get("ultimoPrecio") or 0),
            "currency": currency,
            "brokerSource": "iol",
            "institutionName": institution_name,
        })
    return positions


async def _iol_refresh_token(connection_id: str, refresh_token: str) -> Optional[str]:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{IOL_BASE}/token",
                data={"grant_type": "refresh_token", "refresh_token": refresh_token},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if resp.status_code != 200:
            return None
        data = resp.json()
        new_token = data.get("access_token")
        new_refresh = data.get("refresh_token", refresh_token)
        expires_in = int(data.get("expires_in", 1799))
        expires_at = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()

        db = get_supabase()
        await run_query(
            db.table("brokerage_connections")
            .update({"access_token": new_token, "refresh_token": new_refresh, "token_expires_at": expires_at})
            .eq("id", connection_id)
        )
        return new_token
    except Exception as e:
        logger.warning("IOL token refresh failed: %s", e)
        return None


# ── Plaid endpoints ───────────────────────────────────────────────────────────

@router.post("/plaid/link-token")
async def create_link_token(user_id: str = Depends(get_current_user_id)):
    """Create a Plaid Link token to initiate the OAuth flow in the frontend."""
    from plaid.model.link_token_create_request import LinkTokenCreateRequest
    from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
    from plaid.model.products import Products
    from plaid.model.country_code import CountryCode

    client = _get_plaid_client()
    try:
        request = LinkTokenCreateRequest(
            products=[Products("investments")],
            client_name="Nuvos AI",
            country_codes=[CountryCode("US")],
            language="es",
            user=LinkTokenCreateRequestUser(client_user_id=user_id),
        )
        response = await asyncio.to_thread(lambda: client.link_token_create(request))
        return {"link_token": response["link_token"]}
    except Exception as e:
        logger.error("Plaid link token error: %s", e)
        raise HTTPException(status_code=500, detail="No se pudo crear el token de conexión.")


@router.post("/plaid/exchange")
async def exchange_plaid_token(
    body: PlaidExchangeRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Exchange a Plaid public_token for a permanent access_token and store it."""
    from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest

    client = _get_plaid_client()
    try:
        req = ItemPublicTokenExchangeRequest(public_token=body.public_token)
        response = await asyncio.to_thread(lambda: client.item_public_token_exchange(req))
        access_token = response["access_token"]
        item_id = response["item_id"]
    except Exception as e:
        logger.error("Plaid exchange error: %s", e)
        raise HTTPException(status_code=500, detail="No se pudo completar la conexión con el broker.")

    db = get_supabase()
    await run_query(
        db.table("brokerage_connections").upsert(
            {
                "user_id": user_id,
                "provider": "plaid",
                "institution_name": body.institution_name,
                "institution_id": body.institution_id,
                "access_token": access_token,
                "item_id": item_id,
                "last_sync_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="user_id,provider,institution_id",
        )
    )
    return {"ok": True, "institution": body.institution_name}


@router.get("/plaid/holdings")
async def get_plaid_holdings(user_id: str = Depends(get_current_user_id)):
    """Fetch all investment holdings from all connected Plaid institutions."""
    from plaid.model.investments_holdings_get_request import InvestmentsHoldingsGetRequest

    client = _get_plaid_client()
    db = get_supabase()
    result = await run_query(
        db.table("brokerage_connections")
        .select("id,access_token,institution_name")
        .eq("user_id", user_id)
        .eq("provider", "plaid")
    )
    connections = result.data or []
    all_positions: list[dict] = []

    for conn in connections:
        try:
            req = InvestmentsHoldingsGetRequest(access_token=conn["access_token"])
            response = await asyncio.to_thread(lambda: client.investments_holdings_get(req))
            positions = _normalize_plaid_holdings(response.to_dict())
            for p in positions:
                p["institutionName"] = conn["institution_name"]
            all_positions.extend(positions)
            await run_query(
                db.table("brokerage_connections")
                .update({"last_sync_at": datetime.now(timezone.utc).isoformat()})
                .eq("id", conn["id"])
            )
        except Exception as e:
            logger.warning("Plaid holdings fetch failed for connection %s: %s", conn["id"], e)

    return {"positions": all_positions}


# ── IOL endpoints ─────────────────────────────────────────────────────────────

@router.post("/iol/connect")
async def connect_iol(
    body: IOLConnectRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Authenticate with IOL using the user's own IOL credentials."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{IOL_BASE}/token",
            data={
                "grant_type": "password",
                "username": body.username,
                "password": body.password,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Credenciales de IOL incorrectas.")

    data = resp.json()
    access_token = data.get("access_token")
    refresh_token = data.get("refresh_token", "")
    expires_in = int(data.get("expires_in", 1799))
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()

    db = get_supabase()
    await run_query(
        db.table("brokerage_connections").upsert(
            {
                "user_id": user_id,
                "provider": "iol",
                "institution_name": "Invertir Online",
                "institution_id": "iol",
                "access_token": access_token,
                "refresh_token": refresh_token,
                "token_expires_at": expires_at,
                "last_sync_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="user_id,provider,institution_id",
        )
    )
    return {"ok": True, "institution": "Invertir Online"}


@router.get("/iol/holdings")
async def get_iol_holdings(user_id: str = Depends(get_current_user_id)):
    """Fetch all IOL portfolio positions (bCBA + NYSE markets)."""
    db = get_supabase()
    result = await run_query(
        db.table("brokerage_connections")
        .select("id,access_token,refresh_token,token_expires_at")
        .eq("user_id", user_id)
        .eq("provider", "iol")
        .maybe_single()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="No tienes IOL conectado.")

    conn = result.data
    access_token = conn["access_token"]

    # Refresh if expired (with 60s buffer)
    expires_at = conn.get("token_expires_at")
    if expires_at:
        try:
            exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if exp - timedelta(seconds=60) < datetime.now(timezone.utc):
                new_token = await _iol_refresh_token(conn["id"], conn.get("refresh_token", ""))
                if new_token:
                    access_token = new_token
        except Exception:
            pass

    all_positions: list[dict] = []
    headers = {"Authorization": f"Bearer {access_token}"}

    async with httpx.AsyncClient(timeout=20) as client:
        for mercado in ("bCBA", "NYSE"):
            try:
                resp = await client.get(
                    f"{IOL_BASE}/api/v2/portafolio/{mercado}",
                    headers=headers,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    activos = data.get("activos") or []
                    all_positions.extend(_normalize_iol_holdings(activos))
            except Exception as e:
                logger.warning("IOL holdings fetch failed for %s: %s", mercado, e)

    await run_query(
        db.table("brokerage_connections")
        .update({"last_sync_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", conn["id"])
    )
    return {"positions": all_positions}


# ── Management endpoints ──────────────────────────────────────────────────────

@router.get("/connections")
async def list_connections(user_id: str = Depends(get_current_user_id)):
    """List all connected brokers for the current user."""
    db = get_supabase()
    result = await run_query(
        db.table("brokerage_connections")
        .select("id,provider,institution_name,last_sync_at,created_at")
        .eq("user_id", user_id)
        .order("created_at")
    )
    return {"connections": result.data or []}


@router.delete("/connections/{connection_id}")
async def delete_connection(
    connection_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Disconnect a broker."""
    db = get_supabase()
    await run_query(
        db.table("brokerage_connections")
        .delete()
        .eq("id", connection_id)
        .eq("user_id", user_id)
    )
    return {"ok": True}


@router.post("/sync")
async def sync_all(user_id: str = Depends(get_current_user_id)):
    """Re-sync positions from all connected brokers and return merged list."""
    all_positions: list[dict] = []
    errors: list[str] = []

    # Plaid
    try:
        plaid_result = await get_plaid_holdings(user_id=user_id)
        all_positions.extend(plaid_result["positions"])
    except HTTPException as e:
        if e.status_code != 503:  # 503 = plaid not configured, not an error
            errors.append(f"Plaid: {e.detail}")
    except Exception as e:
        errors.append(f"Plaid: {str(e)}")

    # IOL
    try:
        iol_result = await get_iol_holdings(user_id=user_id)
        all_positions.extend(iol_result["positions"])
    except HTTPException as e:
        if e.status_code != 404:  # 404 = not connected, not an error
            errors.append(f"IOL: {e.detail}")
    except Exception as e:
        errors.append(f"IOL: {str(e)}")

    return {"positions": all_positions, "errors": errors}
