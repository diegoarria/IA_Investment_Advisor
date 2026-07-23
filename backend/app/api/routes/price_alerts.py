# SQL para crear en Supabase (ejecutar una vez en el SQL Editor):
# CREATE TABLE IF NOT EXISTS price_alerts (
#   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
#   user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
#   ticker TEXT NOT NULL,
#   name TEXT,
#   target_price NUMERIC NOT NULL,
#   condition TEXT NOT NULL CHECK (condition IN ('above', 'below')),
#   created_at TIMESTAMPTZ DEFAULT NOW(),
#   triggered_at TIMESTAMPTZ,
#   UNIQUE(user_id, ticker)
# );
# CREATE INDEX IF NOT EXISTS price_alerts_user_id_idx ON price_alerts(user_id);
# ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;
# CREATE POLICY "Users manage own price alerts" ON price_alerts FOR ALL USING (auth.uid() = user_id);

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query
from app.core.cache import cache_delete

router = APIRouter(prefix="/price-alerts", tags=["price-alerts"])

FREE_LIMIT = 5


class PriceAlertCreate(BaseModel):
    ticker: str
    name: Optional[str] = None
    target_price: float
    condition: str  # "above" | "below"


@router.get("")
async def list_alerts(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    result = await run_query(
        db.table("price_alerts")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
    )
    return result.data or []


@router.post("")
async def create_alert(
    data: PriceAlertCreate,
    user_id: str = Depends(get_current_user_id),
):
    if data.condition not in ("above", "below"):
        raise HTTPException(status_code=400, detail="condition must be 'above' or 'below'")
    if data.target_price <= 0:
        raise HTTPException(status_code=400, detail="target_price must be positive")

    db = get_supabase()

    existing = await run_query(
        db.table("price_alerts").select("id").eq("user_id", user_id).eq("ticker", data.ticker.upper())
    )

    profile_res = await run_query(
        db.table("user_profiles").select("subscription_tier, trial_started_at").eq("user_id", user_id)
    )
    profile_row = profile_res.data[0] if profile_res.data else {}
    from app.core.subscription import is_premium_active
    is_premium = is_premium_active(profile_row.get("subscription_tier"), profile_row.get("trial_started_at"))

    if not is_premium:
        all_alerts = await run_query(
            db.table("price_alerts").select("id").eq("user_id", user_id).is_("triggered_at", "null")
        )
        if not existing.data and len(all_alerts.data or []) >= FREE_LIMIT:
            raise HTTPException(status_code=403, detail=f"Límite de {FREE_LIMIT} alertas alcanzado. Activa Premium para alertas ilimitadas.")

    now = datetime.now(timezone.utc).isoformat()
    record = {
        "user_id": user_id,
        "ticker": data.ticker.upper(),
        "name": data.name or data.ticker.upper(),
        "target_price": data.target_price,
        "condition": data.condition,
        "created_at": now,
        "triggered_at": None,
    }

    if existing.data:
        result = await run_query(
            db.table("price_alerts")
            .update({k: v for k, v in record.items() if k != "created_at"})
            .eq("user_id", user_id)
            .eq("ticker", data.ticker.upper())
        )
    else:
        result = await run_query(db.table("price_alerts").insert(record))

    cache_delete(f"price_alerts:{user_id}")
    return result.data[0] if result.data else record


@router.delete("/{ticker}")
async def delete_alert(
    ticker: str,
    user_id: str = Depends(get_current_user_id),
):
    db = get_supabase()
    await run_query(
        db.table("price_alerts").delete().eq("user_id", user_id).eq("ticker", ticker.upper())
    )
    cache_delete(f"price_alerts:{user_id}")
    return {"deleted": True}
