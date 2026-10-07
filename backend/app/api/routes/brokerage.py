"""
Brokerage integrations — read-only position sync.

Supported brokers:
  - Plaid: Interactive Brokers, Charles Schwab, Robinhood (US)
  - IOL (Invertir Online): Argentine broker — direct OAuth
  - IBKR Flex: Interactive Brokers — direct, no Plaid (Flex Web Service,
    read-only, user-generated Query ID + token)

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
import xml.etree.ElementTree as ET
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

# IBKR Flex Web Service — a direct, read-only, no-Plaid path for Interactive
# Brokers. Diego, 2026-10-06: "cómo conecto IBKR API sin necesidad de
# Plaid?" — the Client Portal Web API needs IBKR to approve you as a
# third-party integrator first (not available to us yet) and the TWS API
# needs a live per-user gateway process, neither fits a backend that syncs
# many users' accounts unattended. Flex Web Service is the one IBKR surface
# built for exactly this: the USER generates a Flex Query (which sections
# to report — Open Positions, NAV) and a Flex Web Service token in their own
# IBKR account (Settings → Reporting), no app-level API key, no IBKR
# approval process. Those two values are the credential, same role IOL's
# username/password plays for that connector.
IBKR_FLEX_BASE = "https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService"


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

class IBKRFlexConnectRequest(BaseModel):
    query_id: str
    token: str

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


def _normalize_ibkr_flex_positions(statement_xml: str, institution_name: str = "Interactive Brokers") -> list[dict]:
    """Parses a Flex Statement's <OpenPosition> rows (real fields IBKR's own
    schema defines — symbol/position/markPrice/costBasisPrice/currency).
    Returns [] rather than raising on an unexpected/empty shape — a Flex
    Query that doesn't include the "Open Positions" section (the user's own
    configuration, not something we control) is a legitimate empty result,
    not an error."""
    positions = []
    try:
        root = ET.fromstring(statement_xml)
    except ET.ParseError as e:
        logger.warning("IBKR Flex: unparseable statement XML: %s", e)
        return positions
    for node in root.iter("OpenPosition"):
        symbol = node.get("symbol")
        if not symbol:
            continue
        qty = float(node.get("position") or 0)
        cost_price = node.get("costBasisPrice") or node.get("openPrice") or "0"
        mark_price = node.get("markPrice") or "0"
        positions.append({
            "ticker": symbol.upper(),
            "name": node.get("description") or symbol,
            "shares": qty,
            "avgPrice": round(float(cost_price), 4),
            "currentPrice": float(mark_price),
            "currency": node.get("currency") or "USD",
            "brokerSource": "ibkr_flex",
            "institutionName": institution_name,
        })
    return positions


async def _ibkr_flex_send_request(query_id: str, token: str) -> tuple[str, str]:
    """Step 1 only: asks IBKR to start generating the report. A real,
    validated query_id/token pair gets <Status>Success back immediately —
    this alone is proof the credentials are real, independent of whether
    the report itself ever finishes generating (see _ibkr_flex_fetch_
    statement's docstring: that can hang indefinitely for a genuinely
    empty/unfunded account, which is never a credentials problem). Raises
    HTTPException with IBKR's own real error message on a real failure
    (bad token, bad query id)."""
    async with httpx.AsyncClient(timeout=20) as client:
        send_resp = await client.get(
            f"{IBKR_FLEX_BASE}.SendRequest",
            params={"t": token, "q": query_id, "v": "3"},
        )
    try:
        send_root = ET.fromstring(send_resp.text)
    except ET.ParseError:
        raise HTTPException(status_code=502, detail="IBKR no devolvió una respuesta válida. Intenta de nuevo.")
    if send_root.findtext("Status") != "Success":
        msg = send_root.findtext("ErrorMessage") or "Query ID o token de IBKR inválidos."
        raise HTTPException(status_code=401, detail=f"IBKR: {msg}")
    reference_code = send_root.findtext("ReferenceCode") or ""
    statement_url = send_root.findtext("Url") or f"{IBKR_FLEX_BASE}.GetStatement"
    return reference_code, statement_url


async def _ibkr_flex_fetch_statement(query_id: str, token: str) -> str:
    """SendRequest (kicks off report generation) -> poll GetStatement until
    the real statement is ready. IBKR generates Flex reports asynchronously
    (a few seconds, typically) and signals "not ready yet" as a <Status>Fail
    with ErrorCode 1019 inside an HTTP 200 response, not a retryable HTTP
    status — so retrying on that specific real error code is required, not
    optional, for this to ever succeed. Confirmed live, 2026-10-06: for a
    genuinely empty/unfunded account (no positions, no activity ever),
    IBKR's report generator can get stuck signaling 1019 indefinitely
    instead of returning a real-but-empty report — not a bug on our side,
    see connect_ibkr_flex's own comment for why the connect step doesn't
    depend on this ever resolving. Raises HTTPException with IBKR's own
    real error message on any other failure (bad token, bad query id,
    query has no sections, etc.) — never invents a friendlier message that
    could hide what's actually wrong."""
    reference_code, statement_url = await _ibkr_flex_send_request(query_id, token)

    delays = [2, 3, 5, 8]  # IBKR's own guidance: report generation is a few seconds, poll with backoff
    last_error = "IBKR tardó demasiado en generar el reporte. Intenta de nuevo en un momento."
    for delay in delays:
        await asyncio.sleep(delay)
        async with httpx.AsyncClient(timeout=20) as client:
            stmt_resp = await client.get(statement_url, params={"q": reference_code, "t": token, "v": "3"})
        text = stmt_resp.text
        try:
            poll_root = ET.fromstring(text)
        except ET.ParseError:
            continue
        # A real statement is rooted at <FlexQueryResponse> — checked via the
        # PARSED root tag, not a raw string prefix: real IBKR responses are
        # preceded by an XML declaration (`<?xml version="1.0" ...?>`),
        # which made an earlier `text.startswith("<FlexQueryResponse")`
        # check always false and masked every real success as the generic
        # timeout error (caught by this module's own tests).
        if poll_root.tag == "FlexQueryResponse":
            return text  # the real statement — done
        error_code = poll_root.findtext("ErrorCode")
        last_error = poll_root.findtext("ErrorMessage") or last_error
        if error_code != "1019":  # anything other than "still generating" is a real, final failure
            raise HTTPException(status_code=401, detail=f"IBKR: {last_error}")
    raise HTTPException(status_code=504, detail=f"IBKR: {last_error}")


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
        kwargs = dict(
            products=[Products("investments")],
            client_name="Nuvos AI",
            country_codes=[CountryCode("US")],
            language="es",
            user=LinkTokenCreateRequestUser(client_user_id=user_id),
        )
        # Production OAuth institutions (Schwab, Robinhood…) send the user to
        # their own site and back to this page (web/src/app/plaid-oauth).
        redirect_uri = settings.plaid_redirect_uri or (
            "https://www.nuvosai.com/plaid-oauth" if settings.plaid_env == "production" else ""
        )
        if redirect_uri:
            kwargs["redirect_uri"] = redirect_uri
        request = LinkTokenCreateRequest(**kwargs)
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
    # Right after connecting, Arthur offers to register the real positions
    # (same one-tap flow as the daily sync) — no waiting for tomorrow's job.
    async def _offer_import():
        try:
            from app.services import inbound_import
            data = await get_plaid_holdings(user_id=user_id)
            await inbound_import.reconcile_broker_holdings(user_id, body.institution_name or "tu broker", data.get("positions") or [])
        except Exception as e:
            logger.warning("post-connect import offer failed for %s: %s", user_id, e)
    asyncio.create_task(_offer_import())
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


# ── IBKR Flex endpoints ──────────────────────────────────────────────────────

@router.post("/ibkr-flex/connect")
async def connect_ibkr_flex(
    body: IBKRFlexConnectRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Stores the user's own Flex Query ID + Flex Web Service token
    (generated in their IBKR account, Settings -> Reporting) — and proves
    they're real first, same spirit as IOL's connect call actually hitting
    /token. No refresh_token/expiry: a Flex token is a long-lived (up to 1
    year), user-managed credential, not a short OAuth token this backend
    rotates.

    Validates with ONLY the SendRequest step (_ibkr_flex_send_request),
    not the full fetch-and-poll-for-the-report (_ibkr_flex_fetch_
    statement) — confirmed live, 2026-10-06: a real account with zero
    positions/activity ever can leave IBKR's report generator stuck
    signaling "still generating" indefinitely, which used to make
    connecting a genuinely real, freshly-opened IBKR account impossible
    even though the credentials were perfectly valid. SendRequest alone
    already proves query_id/token are real (IBKR validates them to even
    accept the request); whether a report can actually be generated yet
    is the holdings endpoint's problem to retry later, once there's
    something real to report."""
    await _ibkr_flex_send_request(body.query_id, body.token)  # raises on invalid query_id/token

    db = get_supabase()
    await run_query(
        db.table("brokerage_connections").upsert(
            {
                "user_id": user_id,
                "provider": "ibkr_flex",
                "institution_name": "Interactive Brokers",
                "institution_id": body.query_id,
                "access_token": body.token,
                "last_sync_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="user_id,provider,institution_id",
        )
    )
    return {"ok": True, "institution": "Interactive Brokers"}


@router.get("/ibkr-flex/holdings")
async def get_ibkr_flex_holdings(user_id: str = Depends(get_current_user_id)):
    """Fetch real open positions via a fresh Flex Statement."""
    db = get_supabase()
    result = await run_query(
        db.table("brokerage_connections")
        .select("id,institution_id,access_token")
        .eq("user_id", user_id)
        .eq("provider", "ibkr_flex")
        .maybe_single()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="No tienes Interactive Brokers conectado.")

    conn = result.data
    statement_xml = await _ibkr_flex_fetch_statement(conn["institution_id"], conn["access_token"])
    positions = _normalize_ibkr_flex_positions(statement_xml)

    await run_query(
        db.table("brokerage_connections")
        .update({"last_sync_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", conn["id"])
    )
    return {"positions": positions}


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
    """Disconnect a broker. For Plaid, the Item is removed at Plaid first
    (/item/remove) — revokes the access token for real and stops Plaid's
    per-connected-account monthly billing — then the token is deleted here
    (docs/SECURITY_POLICY.md §10)."""
    db = get_supabase()
    res = await run_query(
        db.table("brokerage_connections").select("provider, access_token")
        .eq("id", connection_id).eq("user_id", user_id).limit(1)
    )
    row = (res.data or [None])[0]
    if row and row.get("provider") == "plaid" and row.get("access_token"):
        try:
            from plaid.model.item_remove_request import ItemRemoveRequest
            client = _get_plaid_client()
            await asyncio.to_thread(lambda: client.item_remove(ItemRemoveRequest(access_token=row["access_token"])))
        except Exception as e:
            # Still delete locally — the user asked to disconnect; log so an
            # orphaned Item can be cleaned up from the Plaid dashboard.
            logger.warning("Plaid item_remove failed for connection %s: %s", connection_id, e)
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

    # IBKR Flex
    try:
        ibkr_result = await get_ibkr_flex_holdings(user_id=user_id)
        all_positions.extend(ibkr_result["positions"])
    except HTTPException as e:
        if e.status_code != 404:  # 404 = not connected, not an error
            errors.append(f"IBKR: {e.detail}")
    except Exception as e:
        errors.append(f"IBKR: {str(e)}")

    return {"positions": all_positions, "errors": errors}
