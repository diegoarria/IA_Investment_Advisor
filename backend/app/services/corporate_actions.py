"""Corporate actions applied automatically (Diego, 2026-09-29: "que el
usuario nunca tenga que capturar nada").

Dividends were already recorded automatically (worker.py
job_dividend_income). This adds STOCK SPLITS: when a company the user
holds splits (e.g. 10-for-1), every lot registered BEFORE the split gets
shares × ratio and avgPrice ÷ ratio — cost basis and value stay identical,
only the share count and per-share price change. Then Arthur tells the user
(push category corporate_action_split → Arthur starts the conversation).

Safety rules (never double-adjust):
  * only splits from the last SPLIT_LOOKBACK_DAYS;
  * only lots whose registration time (`created_at`) is before the split —
    a lot typed in after the split already has post-split shares; legacy
    lots without created_at are adjusted only if the portfolio itself
    hasn't been written since the split;
  * each lot records the splits applied to it (`splits_applied`), so a
    re-run is a no-op.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

import httpx

from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)

SPLIT_LOOKBACK_DAYS = 21
_FMP_BASE = "https://financialmodelingprep.com/stable"


def _fmp_key() -> str:
    from app.core.finnhub import _fmp_key as k  # same key resolution as quotes
    return k()


async def recent_splits(ticker: str) -> list[dict]:
    """[{date:'YYYY-MM-DD', ratio: float}] within the lookback window."""
    key = _fmp_key()
    if not key:
        return []
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{_FMP_BASE}/splits", params={"symbol": ticker, "apikey": key})
            rows = r.json() if r.status_code == 200 else []
    except Exception as e:
        logger.debug("recent_splits(%s) failed: %s", ticker, e)
        return []
    cutoff = (datetime.now(timezone.utc) - timedelta(days=SPLIT_LOOKBACK_DAYS)).date().isoformat()
    today = datetime.now(timezone.utc).date().isoformat()
    out = []
    for row in rows if isinstance(rows, list) else []:
        date = str(row.get("date") or "")[:10]
        try:
            num, den = float(row.get("numerator") or 0), float(row.get("denominator") or 0)
        except (TypeError, ValueError):
            continue
        if not date or date < cutoff or date > today or num <= 0 or den <= 0 or abs(num - den) < 1e-9:
            continue
        out.append({"date": date, "ratio": num / den})
    return out


def _lot_registered_before(lot: dict, split_date: str, portfolio_updated_at: str | None) -> bool:
    created = str(lot.get("created_at") or "")[:10]
    if created:
        return created < split_date
    # Legacy lot (no created_at): only trust it if the portfolio hasn't been
    # written since the split, and the purchase itself predates it.
    purchase = str(lot.get("purchaseDate") or "")[:10]
    return bool(purchase and purchase < split_date and portfolio_updated_at and str(portfolio_updated_at)[:10] < split_date)


def apply_split_to_positions(positions: list[dict], ticker: str, split: dict, portfolio_updated_at: str | None) -> tuple[list[dict], int]:
    """Returns (new_positions, lots_adjusted)."""
    tag = f"{split['date']}:{split['ratio']:g}"
    out, n = [], 0
    for lot in positions:
        if str(lot.get("ticker") or "").upper() != ticker.upper():
            out.append(lot)
            continue
        applied = list(lot.get("splits_applied") or [])
        if tag in applied or not _lot_registered_before(lot, split["date"], portfolio_updated_at):
            out.append(lot)
            continue
        new = dict(lot)
        new["shares"] = round(float(lot.get("shares") or 0) * split["ratio"], 6)
        if lot.get("avgPrice"):
            new["avgPrice"] = round(float(lot["avgPrice"]) / split["ratio"], 6)
        new["splits_applied"] = applied + [tag]
        out.append(new)
        n += 1
    return out, n


async def run_split_adjustments() -> dict:
    """Daily job: adjust every user's lots for recent splits of tickers they
    hold, then let Arthur tell them. Returns counts."""
    from app.api.routes.sync import _parse_portfolio, apply_portfolio_positions
    from app.services.notification_engine import send_push

    db = get_supabase()
    res = await run_query(db.table("user_portfolio").select("user_id, portfolio_id, portfolio_name, positions, updated_at"))
    rows = res.data or []
    held: set[str] = set()
    parsed_rows = []
    for row in rows:
        try:
            parsed = _parse_portfolio(row["positions"])
        except Exception:
            continue
        parsed_rows.append((row, parsed))
        for lot in parsed["positions"]:
            if lot.get("ticker"):
                held.add(str(lot["ticker"]).upper())

    splits: dict[str, list[dict]] = {}
    for ticker in sorted(held):
        s = await recent_splits(ticker)
        if s:
            splits[ticker] = s
        await asyncio.sleep(0.05)
    if not splits:
        return {"tickers_with_splits": 0, "portfolios_adjusted": 0}

    adjusted = 0
    for row, parsed in parsed_rows:
        positions = parsed["positions"]
        changes = []
        for ticker, events in splits.items():
            for sp in events:
                positions, n = apply_split_to_positions(positions, ticker, sp, row.get("updated_at"))
                if n:
                    changes.append((ticker, sp))
        if not changes:
            continue
        try:
            await apply_portfolio_positions(
                row["user_id"], row["portfolio_id"], positions, currency=parsed["currency"],
                portfolio_name=row.get("portfolio_name") or "Mi portafolio",
                closed_positions=parsed["closed_positions"], inception_date=parsed["inception_date"],
                base_updated_at=row.get("updated_at"),
            )
            adjusted += 1
        except Exception as e:
            logger.error("split adjustment write failed for %s/%s: %s", row["user_id"], row["portfolio_id"], e)
            continue
        for ticker, sp in changes:
            ratio = sp["ratio"]
            ratio_txt = f"{ratio:g} por 1" if ratio >= 1 else f"1 por {1 / ratio:g}"
            try:
                await send_push(
                    row["user_id"], f"corporate_action_split_{ticker.lower()}",
                    f"{ticker} hizo un split {ratio_txt}",
                    f"Ajusté tus acciones y tu costo promedio automáticamente ({sp['date']}). Tu inversión vale lo mismo.",
                    {"screen": "portfolio", "ticker": ticker}, db,
                )
            except Exception as e:
                logger.warning("split push failed for %s: %s", row["user_id"], e)
    logger.info("run_split_adjustments: %d tickers with splits, %d portfolios adjusted", len(splits), adjusted)
    return {"tickers_with_splits": len(splits), "portfolios_adjusted": adjusted}
