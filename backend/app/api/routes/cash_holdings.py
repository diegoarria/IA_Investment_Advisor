"""Cash the user holds outside of stock/crypto positions (CETES, parked in a
bank account, US Treasury bonds, or something else) — see
migrations/053_cash_holdings.sql. Counted toward the portfolio's real total
value alongside stock positions.

CETES and bonds (US Treasury) holdings accrue interest: the rate is captured
once, at creation, from a live public rate — Banxico's 364-day CETES rate for
"cetes", the 1-year Treasury constant-maturity rate for "bonds" (see
migrations/055_cash_holdings_cetes_rate.sql) — matching how both instruments
lock in their yield at purchase rather than floating day to day. A user can
also type their own annual rate manually (e.g. a bank account's real APY,
which has no public feed); a manual rate always wins over auto-fetching.
"bank"/"other" with no manual rate stay a flat, non-accruing amount, since we
have no reliable public rate feed for those and would otherwise be guessing.
"""
import os
import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query
from app.core.cache import cache_get, cache_set

router = APIRouter(prefix="/cash-holdings", tags=["cash-holdings"])
logger = logging.getLogger(__name__)

_INSTRUMENTS = {"cetes", "bank", "bonds", "other"}

# Banxico SIE series SF43945 = "Valores gubernamentales — Resultados de la
# subasta semanal — Tasa de rendimiento Cetes a 364 días" (confirmed live
# against the real API — see migrations/055_cash_holdings_cetes_rate.sql).
_CETES_364_SERIES = "SF43945"
_CETES_RATE_CACHE_KEY = "banxico:cetes364_rate"
_CETES_RATE_CACHE_TTL = 6 * 3600  # 6h — Banxico only updates this on Tuesday auctions

# FRED series DGS1 = "1-Year Treasury Constant Maturity Rate" — the standard
# public benchmark for a 1-year US Treasury yield, matching CETES 364 days
# as the closest "1 year" analogue for the other instrument.
_TREASURY_1Y_SERIES = "DGS1"
_TREASURY_RATE_CACHE_KEY = "fred:treasury1y_rate"
_TREASURY_RATE_CACHE_TTL = 12 * 3600  # 12h — updates once per business day


async def _fetch_cetes_364_rate() -> float | None:
    """Live annualized yield (%) from Banxico, or None if BANXICO_TOKEN isn't
    configured or the request fails — callers must degrade to a flat,
    non-accruing amount rather than guessing a rate."""
    cached = cache_get(_CETES_RATE_CACHE_KEY)
    if cached is not None:
        return cached

    token = os.getenv("BANXICO_TOKEN", "")
    if not token:
        return None

    url = f"https://www.banxico.org.mx/SieAPIRest/service/v1/series/{_CETES_364_SERIES}/datos/oportuno"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, params={"token": token})
            resp.raise_for_status()
            payload = resp.json()
            dato = payload["bmx"]["series"][0]["datos"][0]["dato"]
            rate = float(dato)
    except Exception as e:
        logger.warning("cash_holdings: failed to fetch CETES 364 rate from Banxico: %s", e)
        return None

    cache_set(_CETES_RATE_CACHE_KEY, rate, ttl=_CETES_RATE_CACHE_TTL)
    return rate


async def _fetch_treasury_1y_rate() -> float | None:
    """Live 1-year US Treasury yield (%) from FRED, or None if FRED_API_KEY
    isn't configured or the request fails. Pulls the last several
    observations and takes the first non-missing one, since FRED marks
    holidays/weekends as "." rather than omitting the row."""
    cached = cache_get(_TREASURY_RATE_CACHE_KEY)
    if cached is not None:
        return cached

    api_key = os.getenv("FRED_API_KEY", "")
    if not api_key:
        return None

    url = "https://api.stlouisfed.org/fred/series/observations"
    params = {
        "series_id": _TREASURY_1Y_SERIES,
        "api_key": api_key,
        "file_type": "json",
        "sort_order": "desc",
        "limit": 10,
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            payload = resp.json()
            rate = None
            for obs in payload.get("observations", []):
                val = obs.get("value")
                if val and val != ".":
                    rate = float(val)
                    break
    except Exception as e:
        logger.warning("cash_holdings: failed to fetch 1Y Treasury rate from FRED: %s", e)
        return None

    if rate is not None:
        cache_set(_TREASURY_RATE_CACHE_KEY, rate, ttl=_TREASURY_RATE_CACHE_TTL)
    return rate


async def _auto_rate_for_instrument(instrument: str) -> float | None:
    if instrument == "cetes":
        return await _fetch_cetes_364_rate()
    if instrument == "bonds":
        return await _fetch_treasury_1y_rate()
    return None


def _accrue(amount: float, rate_pct: float | None, captured_at: str | None) -> float:
    """Simple annualized interest from the captured rate — the same
    convention CETES/Treasury yields are already quoted in (e.g. "7.02%
    anual"), whether that rate was auto-fetched or typed in manually."""
    if not rate_pct or not captured_at:
        return amount
    try:
        captured = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
    except Exception:
        return amount
    days_held = (datetime.now(timezone.utc) - captured).total_seconds() / 86400
    if days_held <= 0:
        return amount
    return amount * (1 + (rate_pct / 100) * (days_held / 365))


def _with_accrued(holding: dict) -> dict:
    holding["accrued_amount"] = _accrue(
        float(holding["amount"]), holding.get("rate_pct"), holding.get("rate_captured_at")
    )
    return holding


def _parse_manual_rate(body: dict) -> float | None:
    """The user's own typed-in annual rate — always takes priority over
    auto-fetching, since it's a real number they know for their own account
    (e.g. a bank's actual APY) that we could never look up publicly."""
    raw = body.get("rate_pct")
    if raw is None or raw == "":
        return None
    try:
        rate = float(raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="rate_pct debe ser un número")
    if rate < 0:
        raise HTTPException(status_code=422, detail="rate_pct no puede ser negativo")
    return rate


@router.get("")
async def list_cash_holdings(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    result = await run_query(
        db.table("cash_holdings").select("*").eq("user_id", user_id).order("created_at")
    )
    return {"holdings": [_with_accrued(h) for h in (result.data or [])]}


@router.post("")
async def add_cash_holding(body: dict, user_id: str = Depends(get_current_user_id)):
    try:
        amount = float(body.get("amount"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="amount debe ser un número")
    if amount < 0:
        raise HTTPException(status_code=422, detail="amount no puede ser negativo")

    instrument = (body.get("instrument") or "other").strip().lower()
    if instrument not in _INSTRUMENTS:
        raise HTTPException(status_code=422, detail=f"instrument debe ser uno de {sorted(_INSTRUMENTS)}")

    currency = (body.get("currency") or "USD").strip().upper()
    label = (body.get("label") or "").strip() or None

    row = {
        "user_id": user_id,
        "amount": amount,
        "currency": currency,
        "instrument": instrument,
        "label": label,
    }
    manual_rate = _parse_manual_rate(body)
    rate = manual_rate if manual_rate is not None else await _auto_rate_for_instrument(instrument)
    if rate is not None:
        row["rate_pct"] = rate
        row["rate_captured_at"] = datetime.now(timezone.utc).isoformat()

    db = get_supabase()
    result = await run_query(db.table("cash_holdings").insert(row))
    if not result.data:
        # Same class of bug found and fixed in profile.py's create_profile:
        # an insert() that actually commits but returns no rows on the
        # RETURNING clause (transient hiccup, replica lag) must never crash
        # with an unguarded IndexError on result.data[0] below — that's a
        # raw "Internal Server Error" on "add cash holding." No natural key
        # to re-fetch by reliably here, so fail clean instead of guessing.
        raise HTTPException(status_code=503, detail="No se pudo guardar. Intenta de nuevo en unos segundos.")
    return {"holding": _with_accrued(result.data[0])}


@router.put("/{holding_id}")
async def update_cash_holding(holding_id: str, body: dict, user_id: str = Depends(get_current_user_id)):
    db = get_supabase()

    update: dict = {}
    if "amount" in body:
        try:
            amount = float(body["amount"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="amount debe ser un número")
        if amount < 0:
            raise HTTPException(status_code=422, detail="amount no puede ser negativo")
        update["amount"] = amount
    if "instrument" in body:
        instrument = (body["instrument"] or "other").strip().lower()
        if instrument not in _INSTRUMENTS:
            raise HTTPException(status_code=422, detail=f"instrument debe ser uno de {sorted(_INSTRUMENTS)}")
        update["instrument"] = instrument
    if "currency" in body:
        update["currency"] = (body["currency"] or "USD").strip().upper()
    if "label" in body:
        update["label"] = (body["label"] or "").strip() or None
    manual_rate = _parse_manual_rate(body)
    if not update and manual_rate is None and "rate_pct" not in body:
        raise HTTPException(status_code=422, detail="Nada para actualizar")

    if manual_rate is not None:
        # The user explicitly typed a rate — always wins, regardless of
        # instrument, and always resets the accrual clock to now.
        update["rate_pct"] = manual_rate
        update["rate_captured_at"] = datetime.now(timezone.utc).isoformat()
    elif "rate_pct" in body and body.get("rate_pct") in (None, ""):
        # Explicitly cleared the manual rate — fall back to auto-fetch for
        # cetes/bonds, or flat (no rate) otherwise.
        target_instrument = update.get("instrument")
        if not target_instrument:
            existing = await run_query(
                db.table("cash_holdings").select("instrument").eq("id", holding_id).eq("user_id", user_id).maybe_single()
            )
            target_instrument = ((existing.data if existing else None) or {}).get("instrument")
        auto_rate = await _auto_rate_for_instrument(target_instrument or "other")
        update["rate_pct"] = auto_rate
        update["rate_captured_at"] = datetime.now(timezone.utc).isoformat() if auto_rate is not None else None
    elif "instrument" in update:
        # Instrument changed and no manual rate was given this call —
        # auto-fetch for cetes/bonds only if it doesn't already have a rate
        # (editing amount/label must never reset an existing locked-in
        # rate); clear it entirely when moving to bank/other.
        if update["instrument"] in ("cetes", "bonds"):
            existing = await run_query(
                db.table("cash_holdings").select("rate_pct").eq("id", holding_id).eq("user_id", user_id).maybe_single()
            )
            if not ((existing.data if existing else None) or {}).get("rate_pct"):
                auto_rate = await _auto_rate_for_instrument(update["instrument"])
                if auto_rate is not None:
                    update["rate_pct"] = auto_rate
                    update["rate_captured_at"] = datetime.now(timezone.utc).isoformat()
        else:
            update["rate_pct"] = None
            update["rate_captured_at"] = None

    update["updated_at"] = datetime.now(timezone.utc).isoformat()

    result = await run_query(
        db.table("cash_holdings").update(update).eq("id", holding_id).eq("user_id", user_id)
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="No encontrado")
    return {"holding": _with_accrued(result.data[0])}


@router.delete("/{holding_id}")
async def delete_cash_holding(holding_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    await run_query(
        db.table("cash_holdings").delete().eq("id", holding_id).eq("user_id", user_id)
    )
    return {"ok": True}
