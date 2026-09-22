"""Dividend income the user has actually received — see
migrations/054_dividend_income.sql. Recorded by worker.py's dividend-payment
notification job the day each dividend is paid; forward-tracking only, never
backfilled/guessed for dates before this feature shipped.
"""
from fastapi import APIRouter, Depends
from app.api.deps import get_current_user_id
from app.core.database import run_query_verified_nonempty

router = APIRouter(prefix="/dividends", tags=["dividends"])


@router.get("/income")
async def get_dividend_income(user_id: str = Depends(get_current_user_id)):
    # 2026-09-23, Diego: "dividendos SIEMPRE VISIBLE, NO PUEDE DESAPARECER" —
    # same false-empty exposure already fixed on watchlist/portfolio/paper
    # trading (see database.py's run_query_verified_nonempty docstring), never
    # applied here. A real dividend history could silently read back as []
    # on some page loads and not others.
    result = await run_query_verified_nonempty(
        lambda db: db.table("dividend_income").select("*").eq("user_id", user_id).order("pay_date", desc=True)
    )
    rows = result.data or []
    total = sum(float(r["amount"]) for r in rows)
    return {"total": total, "payments": rows}
