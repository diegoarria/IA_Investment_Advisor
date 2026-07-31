"""Cash the user holds outside of stock/crypto positions (CETES, parked in a
bank account, bonds, or something else) — see migrations/053_cash_holdings.sql.
Counted toward the portfolio's real total value alongside stock positions.
"""
from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query

router = APIRouter(prefix="/cash-holdings", tags=["cash-holdings"])

_INSTRUMENTS = {"cetes", "bank", "bonds", "other"}


@router.get("")
async def list_cash_holdings(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    result = await run_query(
        db.table("cash_holdings").select("*").eq("user_id", user_id).order("created_at")
    )
    return {"holdings": result.data or []}


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

    db = get_supabase()
    result = await run_query(
        db.table("cash_holdings").insert({
            "user_id": user_id,
            "amount": amount,
            "currency": currency,
            "instrument": instrument,
            "label": label,
        })
    )
    return {"holding": result.data[0]}


@router.put("/{holding_id}")
async def update_cash_holding(holding_id: str, body: dict, user_id: str = Depends(get_current_user_id)):
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
    if not update:
        raise HTTPException(status_code=422, detail="Nada para actualizar")

    from datetime import datetime, timezone
    update["updated_at"] = datetime.now(timezone.utc).isoformat()

    db = get_supabase()
    result = await run_query(
        db.table("cash_holdings").update(update).eq("id", holding_id).eq("user_id", user_id)
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="No encontrado")
    return {"holding": result.data[0]}


@router.delete("/{holding_id}")
async def delete_cash_holding(holding_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    await run_query(
        db.table("cash_holdings").delete().eq("id", holding_id).eq("user_id", user_id)
    )
    return {"ok": True}
