"""
Sync endpoints — persist user data that was previously AsyncStorage-only.
Every endpoint is an upsert (last-write-wins). Called silently in background
from the mobile app so the user's data survives reinstalls and device changes.

Scalability notes:
  - GET endpoints are cached with short TTLs to reduce DB hits at scale.
  - POST endpoints invalidate the relevant cache key after a successful write.
  - Portfolio/paper writes are last-write-wins (no locking). Under normal usage
    this is safe because clients always send the full state. If two devices write
    simultaneously, the last write wins — acceptable for eventual-consistency sync.
  - updated_at is returned on all reads so clients can detect stale local state.
"""
import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query, run_query_verified_nonempty
from app.core.cache import cache_get, cache_set, cache_delete
from app.services import fmg_service


_MAX_REASONABLE_SHARES = 1_000_000_000  # 1B shares — generous ceiling, catches fat-finger/garbage input
_MAX_REASONABLE_PRICE = 10_000_000      # $10M/share — generous ceiling, catches fat-finger/garbage input


def _validate_position_numbers(items: list) -> None:
    """Diego, 2026-09-08 (pre-launch audit, P2): shares/price used to reach
    storage with zero server-side validation — only the frontend blocked a
    negative/zero/absurd value, trivially bypassed with a direct API call
    (a negative or huge shares/price silently corrupts this user's own
    displayed gain/loss and the auto-generated decision-journal diff below).
    Rejects the whole request on the first bad entry rather than silently
    dropping/clamping it, so the client finds out immediately."""
    for item in items:
        if not isinstance(item, dict):
            continue
        ticker = item.get("ticker", "?")
        shares = item.get("shares")
        if shares is not None:
            try:
                shares_f = float(shares)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"Cantidad de acciones inválida para {ticker}")
            if shares_f <= 0 or shares_f > _MAX_REASONABLE_SHARES:
                raise HTTPException(status_code=400, detail=f"Cantidad de acciones fuera de rango para {ticker}")
        for price_key in ("avgPrice", "avg_price", "close_price"):
            if item.get(price_key) is not None:
                try:
                    price_f = float(item[price_key])
                except (TypeError, ValueError):
                    raise HTTPException(status_code=400, detail=f"Precio inválido para {ticker}")
                if price_f < 0 or price_f > _MAX_REASONABLE_PRICE:
                    raise HTTPException(status_code=400, detail=f"Precio fuera de rango para {ticker}")


async def _log_auto_decision(user_id: str, event: dict) -> None:
    """Fire-and-forget wrapper around decisions.py's journal writer, used by
    the portfolio-sync diff below. Isolated in its own try/except so a
    failure here can never affect the sync response the user is waiting on."""
    try:
        from app.api.routes.decisions import _log_decision
        from app.core.cache import cache_set as _cache_set
        await _log_decision(user_id, event)
        _cache_set(f"biases:{user_id}", None, ttl=1)  # invalidate so next view re-analyzes
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("_log_auto_decision failed for %s: %s", user_id, e)

MAX_PORTFOLIOS = 3

router = APIRouter(prefix="/sync", tags=["sync"])

_NOW = lambda: datetime.now(timezone.utc).isoformat()

# Cache TTLs (seconds) — kept short because sync endpoints carry mutable state
_TTL_PORTFOLIO = 30    # portfolio changes on every trade
_TTL_PAPER     = 30    # paper trades change frequently
_TTL_MATURITY  = 120   # score updated on lesson completion
_TTL_ALL       = 20    # full restore — called on login, keep fresh
_TTL_MISC      = 60    # nav-order, theme, behavioral-risk


# ─── Portfolio ────────────────────────────────────────────────────────────────

def _diff_positions_for_auto_decisions(old_positions: list[dict], new_positions: list[dict]) -> list[dict]:
    """Compares the portfolio's previous and new position lists and returns
    inferred buy/sell events — this is what auto-populates the decision
    journal (investment_decisions) from real portfolio activity, since
    manually logging every trade in a separate diary was never realistically
    adopted (the feature existed but sat empty). Only the objective fact
    (ticker, direction, price, portfolio value) is recorded — this never
    guesses a psychological trigger (fomo/panic/etc) for these events, since
    that would be fabricating context we don't actually have. Trigger
    inference from behavior is left entirely to analyze_decision_biases,
    which reasons over the real timing/price data instead of a label."""
    def _agg(positions: list[dict]) -> dict[str, dict]:
        agg: dict[str, dict] = {}
        for p in positions:
            ticker = p.get("ticker")
            if not ticker:
                continue
            shares = float(p.get("shares") or 0)
            avg_price = float(p.get("avgPrice") or 0)
            row = agg.setdefault(ticker, {"shares": 0.0, "avg_price": avg_price})
            row["shares"] += shares
            if avg_price:
                row["avg_price"] = avg_price
        return agg

    old_agg = _agg(old_positions)
    new_agg = _agg(new_positions)
    new_total_value = sum(v["shares"] * v["avg_price"] for v in new_agg.values())

    events: list[dict] = []
    for ticker in set(old_agg) | set(new_agg):
        old_shares = old_agg.get(ticker, {}).get("shares", 0.0)
        new_shares = new_agg.get(ticker, {}).get("shares", 0.0)
        delta = round(new_shares - old_shares, 6)
        if abs(delta) < 1e-6:
            continue
        price_source = new_agg.get(ticker) or old_agg.get(ticker)
        events.append({
            "action": "buy" if delta > 0 else "sell",
            "ticker": ticker,
            "price_at_action": price_source["avg_price"],
            "portfolio_value_at_action": round(new_total_value, 2),
            "trigger": "auto_sync",
            "notes": f"Registrado automáticamente al sincronizar portafolio ({'+' if delta > 0 else ''}{delta:g} acciones).",
        })
    return events


def _parse_portfolio(raw) -> dict:
    """Parse portfolio data regardless of storage format (v1 array, v2, or v3 with
    the closed-positions ledger + frozen inception date)."""
    if isinstance(raw, list):
        return {"currency": "USD", "positions": raw, "closed_positions": [], "inception_date": None}
    if isinstance(raw, dict) and "_v" in raw:
        positions = raw.get("positions", [])
        closed_positions = raw.get("closed_positions", [])
        inception_date = raw.get("inception_date")
        if inception_date is None and positions:
            # v2 data (or v3 written before a position ever set it): best-effort
            # migration so existing users don't lose continuity — it just stops
            # moving from here on, instead of recomputing on every read.
            dates = [p.get("purchaseDate") for p in positions if p.get("purchaseDate")]
            inception_date = min(dates) if dates else None
        return {
            "currency": raw.get("currency", "USD"),
            "positions": positions,
            "closed_positions": closed_positions,
            "inception_date": inception_date,
        }
    return {"currency": "USD", "positions": [], "closed_positions": [], "inception_date": None}


_UNSET = object()  # sentinel: "inception_date not provided", distinct from an explicit None


def add_buy_lot(positions: list[dict], ticker: str, shares: float, price: float, date: str) -> list[dict]:
    """A BUY always appends a NEW lot rather than merging into an existing
    one — matches the existing design (each purchase preserves its own cost
    basis/date for later FIFO sells and realized P/L), not a new convention
    invented for this feature.

    Diego, 2026-09-19: gave each lot a stable `id` + `created_at` (when it
    was registered — distinct from `purchaseDate`, the date the user says
    the trade actually happened) so Arthur's update/delete-transaction
    tools have something durable to reference ("corrige la última compra",
    "borra esa venta"). Purely additive — every existing reader
    (aggregate_positions_by_ticker, apply_sell_fifo, the frontend) already
    ignores unknown keys on a lot, so old lots without these two fields
    keep working exactly as before."""
    new_positions = [dict(p) for p in positions]
    new_positions.append({
        "id": str(uuid.uuid4()),
        "ticker": ticker.upper(),
        "shares": shares,
        "avgPrice": price,
        "purchaseDate": date,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return new_positions


def find_open_lot(positions: list[dict], lot_id: str) -> dict | None:
    """Look up a single open BUY lot by its stable id — the identity
    update_portfolio_transaction/delete_portfolio_transaction key off of.
    Lots written before the `id` field existed (see add_buy_lot above)
    simply can't be targeted this way; callers must tell the user to use
    get_portfolio_transactions to see which of their lots have one."""
    for p in positions:
        if p.get("id") == lot_id:
            return p
    return None


def update_open_lot(
    positions: list[dict], lot_id: str,
    shares: float | None = None, price: float | None = None, date: str | None = None,
) -> list[dict]:
    """Corrects an existing OPEN buy lot in place (shares/price/date) —
    scoped to still-open lots only. A lot that's been partially or fully
    consumed by a sell is a closed_positions entry instead; correcting a
    past sale would mean re-deriving realized P/L and re-running FIFO,
    which this pass deliberately doesn't support (see delete_open_lot's
    docstring for the same scoping decision). Raises ValueError if the id
    isn't found among open lots."""
    if not find_open_lot(positions, lot_id):
        raise ValueError(f"lot_not_found: {lot_id}")
    new_positions = []
    for p in positions:
        if p.get("id") != lot_id:
            new_positions.append(p)
            continue
        updated = dict(p)
        if shares is not None:
            updated["shares"] = shares
        if price is not None:
            updated["avgPrice"] = price
        if date is not None:
            updated["purchaseDate"] = date
        new_positions.append(updated)
    return new_positions


def delete_open_lot(positions: list[dict], lot_id: str) -> list[dict]:
    """Removes one OPEN buy lot entirely. Deliberately scoped to open lots
    only — deleting a closed_positions entry would mean "undoing a sale"
    (giving the shares back as a new open lot, reversing its realized P/L
    contribution), which is real but separate scope Diego hasn't asked for
    yet; the tool description tells the model to say so rather than
    attempt it. Raises ValueError if the id isn't found among open lots."""
    if not find_open_lot(positions, lot_id):
        raise ValueError(f"lot_not_found: {lot_id}")
    return [p for p in positions if p.get("id") != lot_id]


def apply_sell_fifo(
    positions: list[dict], closed_positions: list[dict], ticker: str,
    shares_to_sell: float, price: float, date: str,
) -> tuple[list[dict], list[dict], float]:
    """Reduces the oldest lots of `ticker` first (FIFO) until `shares_to_sell`
    is covered, moving the sold portion of each lot into closed_positions
    (preserving its own original avgPrice/purchaseDate for realized P/L) and
    shrinking/removing the lot from positions. Raises ValueError if the
    ticker doesn't hold enough shares — callers must check this BEFORE
    ever telling the user the sale succeeded.

    Returns (new_positions, new_closed_positions, realized_pl)."""
    ticker_u = ticker.upper()
    lots = sorted(
        [p for p in positions if (p.get("ticker") or "").upper() == ticker_u],
        key=lambda p: p.get("purchaseDate") or "",
    )
    held = sum(float(l.get("shares") or 0) for l in lots)
    if shares_to_sell > held + 1e-6:
        raise ValueError(f"insufficient_shares: held={held}, requested={shares_to_sell}")

    remaining_to_sell = shares_to_sell
    realized_pl = 0.0
    new_closed = [dict(c) for c in closed_positions]
    consumed_lot_ids = []  # index into `lots`, fully consumed
    updated_lots: dict[int, float] = {}  # index into `lots` -> remaining shares

    for i, lot in enumerate(lots):
        if remaining_to_sell <= 1e-9:
            break
        lot_shares = float(lot.get("shares") or 0)
        take = min(lot_shares, remaining_to_sell)
        if take <= 0:
            continue
        # Some lots (e.g. from the screenshot-import feature, market.py) store
        # cost basis as snake_case "avg_price" instead of "avgPrice" — read
        # both, matching the canonical aggregate_positions_by_ticker
        # (decision_engine.py). Missing this reads a real lot's cost as $0,
        # which both fabricates a huge fake realized gain AND permanently
        # writes a corrupted $0-cost-basis row into closed_positions.
        lot_avg = float(lot.get("avgPrice") or lot.get("avg_price") or 0)
        new_closed.append({
            "id": str(uuid.uuid4()),
            "ticker": ticker_u,
            "shares": take,
            "avgPrice": lot_avg,
            "closePrice": price,
            "purchaseDate": lot.get("purchaseDate"),
            "closeDate": date,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "source_lot_id": lot.get("id"),  # traceability only, not a lookup key
        })
        realized_pl += take * (price - lot_avg)
        remaining_left = round(lot_shares - take, 8)
        if remaining_left <= 1e-6:
            consumed_lot_ids.append(id(lot))
        else:
            updated_lots[id(lot)] = remaining_left
        remaining_to_sell = round(remaining_to_sell - take, 8)

    new_positions = []
    for p in positions:
        if (p.get("ticker") or "").upper() != ticker_u:
            new_positions.append(p)
            continue
        if id(p) in consumed_lot_ids:
            continue
        if id(p) in updated_lots:
            updated = dict(p)
            updated["shares"] = updated_lots[id(p)]
            new_positions.append(updated)
            continue
        new_positions.append(p)

    return new_positions, new_closed, realized_pl


async def apply_portfolio_positions(
    user_id: str,
    portfolio_id: str,
    positions: list[dict],
    currency: str = "USD",
    portfolio_name: str = "Mi portafolio",
    closed_positions: list[dict] | None = None,
    inception_date=_UNSET,
    base_updated_at: str | None = None,
) -> dict:
    """Core of POST /sync/portfolio, extracted (2026-09) so other callers —
    specifically Arthur's natural-language transaction tool in ai_service.py
    — write through the EXACT same validation/limits/conflict-detection/
    auto-decision-diffing path instead of a second parallel implementation.
    Behavior is unchanged from the inline version this replaced; the route
    below is now a thin wrapper around this function.

    Raises HTTPException on validation/limit/conflict failures — callers
    (including a chat tool) must let that propagate as a real, honest
    failure rather than swallowing it into a false "listo" response.
    """
    _validate_position_numbers(positions)
    if closed_positions:
        _validate_position_numbers(closed_positions)
    if portfolio_id.startswith("belvo:"):
        raise HTTPException(status_code=403, detail="Este portafolio se sincroniza automáticamente y no se puede editar manualmente.")

    db = get_supabase()

    # ── Soft lock: free/expired-trial users can keep existing positions but
    #    cannot ADD new ones beyond the free limit of 10. ─────────────────────
    _FREE_PORTFOLIO_LIMIT = 10
    if len(positions) > _FREE_PORTFOLIO_LIMIT:
        profile_res = await run_query(
            db.table("user_profiles")
            .select("subscription_tier, trial_started_at, streak_bonus_premium_until")
            .eq("user_id", user_id)
        )
        pr = profile_res.data[0] if profile_res.data else {}
        from app.core.subscription import is_premium_active
        _is_prem = is_premium_active(pr.get("subscription_tier"), pr.get("trial_started_at"), pr.get("streak_bonus_premium_until"))
        if not _is_prem:
            existing_pos = await run_query(
                db.table("user_portfolio").select("positions")
                .eq("user_id", user_id).eq("portfolio_id", portfolio_id)
            )
            current_count = 0
            if existing_pos.data:
                _parsed = _parse_portfolio(existing_pos.data[0]["positions"])
                current_count = len(_parsed.get("positions", []))
            if len(positions) > max(current_count, _FREE_PORTFOLIO_LIMIT):
                raise HTTPException(
                    status_code=403,
                    detail={"code": "limit_reached", "limit": _FREE_PORTFOLIO_LIMIT,
                            "message": "Límite de 10 posiciones en portafolio. Activa Premium para agregar más."}
                )

    has_inception_key = inception_date is not _UNSET
    existing = await run_query(
        db.table("user_portfolio").select("positions, updated_at")
        .eq("user_id", user_id).eq("portfolio_id", portfolio_id)
    )
    prev_position_count = 0
    old_positions_list = None
    if existing.data:
        current_updated_at = existing.data[0]["updated_at"]
        prev_position_count = len(_parse_portfolio(existing.data[0]["positions"]).get("positions", []))
        if base_updated_at and current_updated_at and base_updated_at != current_updated_at:
            existing_parsed = _parse_portfolio(existing.data[0]["positions"])
            raise HTTPException(status_code=409, detail={
                "code": "sync_conflict",
                "message": "Este portafolio fue modificado desde otro dispositivo. Actualiza antes de guardar.",
                "server_state": existing_parsed,
                "server_updated_at": current_updated_at,
            })
        existing_parsed = _parse_portfolio(existing.data[0]["positions"])
        if closed_positions is None:
            closed_positions = existing_parsed["closed_positions"]
        if not has_inception_key:
            inception_date = existing_parsed["inception_date"]
        old_positions_list = existing_parsed["positions"]
    if inception_date is _UNSET:
        inception_date = None
    closed_positions = closed_positions or []

    portfolio_state = {
        "_v": 3, "currency": currency, "positions": positions,
        "closed_positions": closed_positions, "inception_date": inception_date,
    }
    now = _NOW()
    await run_query(db.table("user_portfolio").upsert({
        "user_id":        user_id,
        "portfolio_id":   portfolio_id,
        "portfolio_name": portfolio_name,
        "positions":      portfolio_state,
        "updated_at":     now,
    }, on_conflict="user_id,portfolio_id"))
    cache_delete(f"sync:portfolio:{user_id}:{portfolio_id}")
    cache_delete(f"sync:portfolios:{user_id}")
    cache_delete(f"sync:all:{user_id}")
    if prev_position_count == 0 and len(positions) > 0:
        asyncio.create_task(fmg_service.log_event(
            user_id, "milestone", "Primera inversión registrada",
            metadata={"portfolio_id": portfolio_id, "ticker": positions[0].get("ticker")},
            milestone_key="first_investment",
        ))
    if old_positions_list is not None:
        for auto_event in _diff_positions_for_auto_decisions(old_positions_list, positions):
            asyncio.create_task(_log_auto_decision(user_id, auto_event))
    return {"ok": True, "updated_at": now, "positions": positions, "closed_positions": closed_positions}


@router.post("/portfolio")
async def sync_portfolio(body: dict, user_id: str = Depends(get_current_user_id)):
    """Upsert portfolio positions + currency.
    body: { positions: [...], currency: 'USD', portfolio_id?: 'default', portfolio_name?: '...',
            closed_positions?: [...], inception_date?: '...' | null }

    closed_positions/inception_date are the since-inception performance ledger.
    An older client (e.g. mobile before it's rebuilt with this feature) won't
    send them at all — in that case we must read-modify-write to preserve
    whatever is already stored instead of silently erasing it.
    """
    positions     = body.get("positions", [])
    currency      = body.get("currency", "USD")
    portfolio_id  = body.get("portfolio_id", "default") or "default"
    portfolio_name = body.get("portfolio_name", "Mi portafolio") or "Mi portafolio"
    # base_updated_at: the server updated_at this client's edit was BASED on
    # (i.e. what it last successfully read or synced). Optional for backward
    # compatibility with older clients that don't send it yet — in that case
    # this falls back to pure last-write-wins, same as before. When present,
    # it's what turns "last write wins" into real optimistic concurrency: if
    # another device has written a NEWER state since this client last saw the
    # server, we reject instead of silently clobbering that other edit.
    result = await apply_portfolio_positions(
        user_id, portfolio_id, positions, currency, portfolio_name,
        closed_positions=body.get("closed_positions"),
        inception_date=(body.get("inception_date") if "inception_date" in body else _UNSET),
        base_updated_at=body.get("base_updated_at"),
    )
    # Echo back the exact timestamp the write was committed with, so clients can
    # show a server-confirmed "saved at" time instead of just trusting their own
    # local clock/state.
    return {"ok": True, "updated_at": result["updated_at"]}


@router.get("/portfolio")
async def get_portfolio(portfolio_id: str = "default", user_id: str = Depends(get_current_user_id)):
    ck = f"sync:portfolio:{user_id}:{portfolio_id}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    db = get_supabase()
    result = await run_query(
        db.table("user_portfolio")
        .select("positions, portfolio_name, updated_at")
        .eq("user_id", user_id)
        .eq("portfolio_id", portfolio_id)
    )
    if result.data:
        parsed = _parse_portfolio(result.data[0]["positions"])
        resp = {**parsed, "portfolio_name": result.data[0]["portfolio_name"], "updated_at": result.data[0]["updated_at"]}
        # Only a real row is safe to cache. A "no row found" result can also mean
        # this read raced a just-committed write and briefly missed it — caching
        # that would lock in the wrong (empty) answer for the full TTL.
        cache_set(ck, resp, ttl=_TTL_PORTFOLIO)
    else:
        resp = {"positions": [], "currency": "USD", "closed_positions": [], "inception_date": None, "portfolio_name": "Mi portafolio", "updated_at": None}
    return resp


# ─── Multi-portfolio management (Premium) ─────────────────────────────────────

@router.get("/portfolios")
async def list_portfolios(user_id: str = Depends(get_current_user_id)):
    """List all portfolios for this user (id, name, position count, updated_at)."""
    ck = f"sync:portfolios:{user_id}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    db = get_supabase()
    result = await run_query(
        db.table("user_portfolio")
        .select("portfolio_id, portfolio_name, positions, updated_at")
        .eq("user_id", user_id)
        .order("updated_at")
    )
    portfolios = []
    for row in (result.data or []):
        parsed = _parse_portfolio(row["positions"])
        portfolios.append({
            "portfolio_id":   row["portfolio_id"],
            "portfolio_name": row["portfolio_name"],
            "positions":      parsed["positions"],
            "closed_positions": parsed["closed_positions"],
            "inception_date": parsed["inception_date"],
            "currency":       parsed["currency"],
            "updated_at":     row["updated_at"],
        })
    resp = {"portfolios": portfolios}
    # Same reasoning as get_portfolio(): don't cement an empty read that might
    # just be racing a very recent write into a 30s-long wrong answer.
    if portfolios:
        cache_set(ck, resp, ttl=_TTL_PORTFOLIO)
    return resp


@router.post("/portfolios")
async def create_portfolio(body: dict, user_id: str = Depends(get_current_user_id)):
    """Create a new empty portfolio. Premium only, max 3 total."""
    db = get_supabase()
    profile_res = await run_query(
        db.table("user_profiles").select("subscription_tier, trial_started_at, streak_bonus_premium_until").eq("user_id", user_id)
    )
    profile = profile_res.data[0] if profile_res.data else {}
    from app.core.subscription import is_premium_active
    is_premium = is_premium_active(profile.get("subscription_tier"), profile.get("trial_started_at"), profile.get("streak_bonus_premium_until"))
    if not is_premium:
        raise HTTPException(status_code=403, detail="Los portafolios múltiples son exclusivos para usuarios Premium.")
    existing = await run_query(
        db.table("user_portfolio").select("portfolio_id").eq("user_id", user_id)
    )
    if len(existing.data or []) >= MAX_PORTFOLIOS:
        raise HTTPException(status_code=400, detail=f"Máximo {MAX_PORTFOLIOS} portafolios por cuenta.")
    portfolio_id   = f"p_{int(datetime.now(timezone.utc).timestamp() * 1000)}"
    portfolio_name = (body.get("name") or "Nuevo portafolio").strip()[:50]
    await run_query(db.table("user_portfolio").insert({
        "user_id":        user_id,
        "portfolio_id":   portfolio_id,
        "portfolio_name": portfolio_name,
        "positions":      {"_v": 2, "currency": "USD", "positions": []},
        "updated_at":     _NOW(),
    }))
    cache_delete(f"sync:portfolios:{user_id}")
    cache_delete(f"sync:all:{user_id}")
    return {"portfolio_id": portfolio_id, "portfolio_name": portfolio_name}


@router.put("/portfolios/{portfolio_id}")
async def rename_portfolio(portfolio_id: str, body: dict, user_id: str = Depends(get_current_user_id)):
    """Rename a portfolio."""
    name = (body.get("name") or "").strip()[:50]
    if not name:
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío.")
    db = get_supabase()
    await run_query(
        db.table("user_portfolio")
        .update({"portfolio_name": name, "updated_at": _NOW()})
        .eq("user_id", user_id)
        .eq("portfolio_id", portfolio_id)
    )
    cache_delete(f"sync:portfolios:{user_id}")
    return {"ok": True}


@router.delete("/portfolios/{portfolio_id}")
async def delete_portfolio(portfolio_id: str, user_id: str = Depends(get_current_user_id)):
    """Delete a portfolio. Cannot delete 'default'."""
    if portfolio_id == "default":
        raise HTTPException(status_code=400, detail="No puedes eliminar el portafolio principal.")
    db = get_supabase()
    await run_query(
        db.table("user_portfolio")
        .delete()
        .eq("user_id", user_id)
        .eq("portfolio_id", portfolio_id)
    )
    cache_delete(f"sync:portfolios:{user_id}")
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


# ─── Paper Trading ────────────────────────────────────────────────────────────

@router.post("/paper")
async def sync_paper(body: dict, user_id: str = Depends(get_current_user_id)):
    """Upsert full paper trading state.
    freeTradeMonth/Count are only updated when explicitly included in the body,
    so web-only pushes (which omit them) don't clear mobile-specific state.

    Paper trading itself is free for all tiers — only the AI analysis of the
    simulated portfolio is Premium-gated (see profile.py's /paper-analysis).
    """
    db = get_supabase()
    new_trades = body.get("trades", [])
    # Only `positions` is validated here, not `trades` — a "topup" trade
    # legitimately carries shares=0/price=0 (see paperStore.ts's topUp()),
    # which _validate_position_numbers would otherwise reject.
    if body.get("positions"):
        _validate_position_numbers(body["positions"])

    update_data: dict = {
        "user_id":   user_id,
        "cash":      body.get("cash", 10000),
        "positions": body.get("positions", []),
        "trades":    body.get("trades", []),
        "updated_at": _NOW(),
    }
    if "freeTradeMonth" in body:
        update_data["free_trade_month"] = body["freeTradeMonth"]
    if "freeTradeCount" in body:
        update_data["free_trade_count"] = body["freeTradeCount"]
    await run_query(db.table("user_paper_trading").upsert(update_data, on_conflict="user_id"))
    # Invalidate cached reads
    cache_delete(f"sync:paper:{user_id}")
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


@router.get("/paper")
async def get_paper(user_id: str = Depends(get_current_user_id)):
    ck = f"sync:paper:{user_id}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    # Verified against a fresh client on empty, not just get_supabase()'s singleton
    # directly — an empty result here is indistinguishable from the singleton's
    # stale-pinned-connection issue (see get_fresh_supabase's docstring), and this
    # endpoint's 30s cache (below) would otherwise let a false-empty read wipe a
    # user's paper portfolio for the full TTL window (confirmed live 2026-09-16,
    # same bug class as GET /watchlist's fix).
    result = await run_query_verified_nonempty(
        lambda db: db.table("user_paper_trading")
        .select("cash, positions, trades, free_trade_month, free_trade_count, updated_at")
        .eq("user_id", user_id)
    )
    if result.data:
        r = result.data[0]
        resp = {
            "cash":           r["cash"],
            "positions":      r["positions"],
            "trades":         r["trades"],
            "freeTradeMonth": r["free_trade_month"],
            "freeTradeCount": r["free_trade_count"],
            "updated_at":     r["updated_at"],
        }
    else:
        resp = {"cash": 10000, "positions": [], "trades": [],
                "freeTradeMonth": None, "freeTradeCount": 0, "updated_at": None}
    cache_set(ck, resp, ttl=_TTL_PAPER)
    return resp


# ─── Maturity Score ───────────────────────────────────────────────────────────

@router.post("/maturity")
async def sync_maturity(body: dict, user_id: str = Depends(get_current_user_id)):
    """Upsert maturity score + history."""
    db = get_supabase()
    await run_query(
        db.table("user_profiles").update({
            "maturity_score":   body.get("score", 0),
            "maturity_history": body.get("history", []),
        }).eq("user_id", user_id)
    )
    cache_delete(f"sync:maturity:{user_id}")
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


@router.get("/maturity")
async def get_maturity(user_id: str = Depends(get_current_user_id)):
    ck = f"sync:maturity:{user_id}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    db = get_supabase()
    result = await run_query(
        db.table("user_profiles")
        .select("maturity_score, maturity_history")
        .eq("user_id", user_id)
    )
    if result.data:
        resp = {
            "score":   result.data[0].get("maturity_score", 0),
            "history": result.data[0].get("maturity_history", []),
        }
    else:
        resp = {"score": 0, "history": []}
    cache_set(ck, resp, ttl=_TTL_MATURITY)
    return resp


# ─── Trial ────────────────────────────────────────────────────────────────────

@router.post("/trial/start")
async def start_trial(user_id: str = Depends(get_current_user_id)):
    """Record trial start date in the DB. Idempotent — only sets if not already set."""
    db = get_supabase()
    result = await run_query(
        db.table("user_profiles")
        .select("trial_started_at, subscription_tier")
        .eq("user_id", user_id)
    )
    if not result.data:
        return {"ok": False, "reason": "profile_not_found"}
    row = result.data[0]
    if row.get("subscription_tier") in ("premium", "pro"):
        return {"ok": False, "reason": "already_premium"}
    if row.get("trial_started_at"):
        return {"ok": True, "trial_started_at": row["trial_started_at"], "already_started": True}
    now = _NOW()
    await run_query(
        db.table("user_profiles")
        .update({"trial_started_at": now})
        .eq("user_id", user_id)
    )
    # Without this, GET /profile (120s cache) and GET /sync/all (20s cache)
    # can keep serving the pre-trial "free" snapshot for up to two minutes
    # right after the trial starts — exactly the kind of transient false
    # "not premium" this endpoint exists to prevent.
    cache_delete(f"profile:{user_id}")
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True, "trial_started_at": now, "already_started": False}


@router.get("/trial/status")
async def get_trial_status(user_id: str = Depends(get_current_user_id)):
    """Returns trial_started_at so the client can compute days remaining."""
    db = get_supabase()
    result = await run_query(
        db.table("user_profiles")
        .select("trial_started_at, subscription_tier, streak_bonus_premium_until")
        .eq("user_id", user_id)
    )
    if not result.data:
        return {"trial_started_at": None, "tier": "free"}
    row = result.data[0]
    trial_started_at = row.get("trial_started_at")
    from app.core.subscription import is_premium_active
    is_active = is_premium_active(row.get("subscription_tier"), trial_started_at, row.get("streak_bonus_premium_until"))
    return {
        "trial_started_at": trial_started_at,
        "trial_active":     is_active,
        "tier":             row.get("subscription_tier", "free"),
    }


# ─── Full restore (called on login) ──────────────────────────────────────────

@router.get("/all")
async def get_all(user_id: str = Depends(get_current_user_id)):
    """Single call that returns everything needed to restore user state after login."""
    ck = f"sync:all:{user_id}"
    cached = cache_get(ck)
    if cached is not None:
        # Same reasoning as GET /profile — subscription status must never
        # be served stale, so it's excluded from the cache-hit fast path
        # and always re-read fresh (see fetch_fresh_subscription_fields).
        from app.core.subscription import fetch_fresh_subscription_fields, is_premium_active
        fresh = await fetch_fresh_subscription_fields(user_id)
        if fresh:
            trial_started_at = fresh.get("trial_started_at")
            cached = {
                **cached,
                "trial": {
                    "trial_started_at": trial_started_at,
                    "trial_active": is_premium_active(
                        fresh.get("subscription_tier"), trial_started_at, fresh.get("streak_bonus_premium_until"),
                    ),
                    "tier": fresh.get("subscription_tier", "free"),
                },
            }
        return cached
    db = get_supabase()

    # Verified against a fresh client on empty — same false-empty exposure
    # as GET /watchlist and GET /sync/paper, but for the REAL portfolio.
    portfolio_res = await run_query_verified_nonempty(
        lambda db: db.table("user_portfolio")
        .select("portfolio_id, portfolio_name, positions, updated_at")
        .eq("user_id", user_id)
        .order("updated_at")
    )
    # Same false-empty exposure as GET /sync/paper — verify against a fresh
    # client before trusting an empty paper-trading read here too.
    paper_res = await run_query_verified_nonempty(
        lambda db: db.table("user_paper_trading")
        .select("cash, positions, trades, free_trade_month, free_trade_count")
        .eq("user_id", user_id)
    )
    try:
        profile_res = await run_query(
            db.table("user_profiles")
            .select("maturity_score, maturity_history, trial_started_at, subscription_tier, streak_bonus_premium_until, nav_order, watchlist_order, theme, avatar_url, behavioral_risk_score, streak_count, last_learn_date, investment_goal, investment_goal_amount, completed_topic_ids, portfolio_view_mode, checklist_done, watchlist_view_mode, has_broker, preferred_language, detail_level, required_return_pct, min_margin_of_safety_pct, preferred_discount_rate_method, favorite_metrics, dashboard_section_order")
            .eq("user_id", user_id)
        )
    except Exception:
        profile_res = await run_query(
            db.table("user_profiles")
            .select("maturity_score, maturity_history, trial_started_at, subscription_tier, streak_bonus_premium_until, nav_order, investment_goal, investment_goal_amount")
            .eq("user_id", user_id)
        )
    # Same false-empty exposure — this is a separate read of the same table
    # GET /watchlist already guards; guard it here too since /sync/all is an
    # independent code path some clients call instead of /watchlist directly.
    watchlist_res = await run_query_verified_nonempty(
        lambda db: db.table("watchlist")
        .select("ticker, name, added_at")
        .eq("user_id", user_id)
        .order("added_at")
    )

    # Build per-portfolio list and default portfolio for backward compat
    all_portfolios = []
    default_positions, default_currency = [], "USD"
    for row in (portfolio_res.data or []):
        parsed = _parse_portfolio(row["positions"])
        all_portfolios.append({
            "portfolio_id":   row["portfolio_id"],
            "portfolio_name": row["portfolio_name"],
            "positions":      parsed["positions"],
            "closed_positions": parsed["closed_positions"],
            "inception_date": parsed["inception_date"],
            "currency":       parsed["currency"],
            "updated_at":     row["updated_at"],
        })
        if row["portfolio_id"] == "default":
            default_positions = parsed["positions"]
            default_currency  = parsed["currency"]
    # Fallback: if no default row, use first available
    if not default_positions and all_portfolios:
        default_positions = all_portfolios[0]["positions"]
        default_currency  = all_portfolios[0]["currency"]
    portfolio_parsed = {"positions": default_positions, "currency": default_currency}
    paper = paper_res.data[0] if paper_res.data else {
        "cash": 10000, "positions": [], "trades": [],
        "free_trade_month": None, "free_trade_count": 0,
    }
    profile_row = profile_res.data[0] if profile_res.data else {}

    trial_started_at = profile_row.get("trial_started_at")
    from app.core.subscription import is_premium_active
    trial_active = is_premium_active(profile_row.get("subscription_tier"), trial_started_at, profile_row.get("streak_bonus_premium_until"))

    resp = {
        "portfolio": {
            "positions": portfolio_parsed["positions"],
            "currency":  portfolio_parsed["currency"],
        },
        "portfolios": all_portfolios,
        "paper": {
            "cash":           paper["cash"],
            "positions":      paper["positions"],
            "trades":         paper["trades"],
            "freeTradeMonth": paper["free_trade_month"],
            "freeTradeCount": paper["free_trade_count"],
        },
        "maturity": {
            "score":   profile_row.get("maturity_score", 0),
            "history": profile_row.get("maturity_history", []),
        },
        "trial": {
            "trial_started_at": trial_started_at,
            "trial_active":     trial_active,
            "tier":             profile_row.get("subscription_tier", "free"),
        },
        "watchlist":   watchlist_res.data if watchlist_res.data else [],
        "nav_order":            profile_row.get("nav_order"),
        "watchlist_order":      profile_row.get("watchlist_order"),
        "theme":                profile_row.get("theme", "dark"),
        "language":             profile_row.get("preferred_language") or "es",
        "avatar_url":           profile_row.get("avatar_url"),
        "behavioral_risk_score": profile_row.get("behavioral_risk_score"),
        "investment_goal":        profile_row.get("investment_goal"),
        "investment_goal_amount": profile_row.get("investment_goal_amount"),
        "streak": {
            "count":          profile_row.get("streak_count", 0) or 0,
            "last_learn_date": profile_row.get("last_learn_date"),
        },
        "completed_topic_ids": profile_row.get("completed_topic_ids") or [],
        "portfolio_view_mode":  profile_row.get("portfolio_view_mode", "advanced"),
        "watchlist_view_mode":  profile_row.get("watchlist_view_mode", "advanced"),
        "checklist_done":       bool(profile_row.get("checklist_done", False)),
        "has_broker":           bool(profile_row.get("has_broker", False)),
        "detail_level":         profile_row.get("detail_level", "intermedio"),
        # Fase 4, Incremento 12 (Personalización, Parte L)
        "required_return_pct":            profile_row.get("required_return_pct"),
        "min_margin_of_safety_pct":       profile_row.get("min_margin_of_safety_pct"),
        "preferred_discount_rate_method": profile_row.get("preferred_discount_rate_method", "wacc"),
        "favorite_metrics":               profile_row.get("favorite_metrics") or [],
        "dashboard_section_order":        profile_row.get("dashboard_section_order"),
    }
    # A brand-new account with zero portfolio rows is a normal, cacheable state.
    # But if this account has ever had a portfolio and this particular read just
    # came back empty, it's more likely racing a very recent write than a real
    # reset — don't cache that and risk locking in stale/empty data (including
    # for scheduled jobs that read this same cache) for the full TTL. There's no
    # cheap way to tell the two cases apart here, so we simply never cache an
    # empty portfolio_res — the extra DB hit on the rare miss is cheap.
    if portfolio_res.data:
        cache_set(ck, resp, ttl=_TTL_ALL)
    return resp


# ─── Nav order ───────────────────────────────────────────────────────────────

@router.post("/nav-order")
async def sync_nav_order(body: dict, user_id: str = Depends(get_current_user_id)):
    """Persist tab navigation order for cross-device sync."""
    order = body.get("order", [])
    db = get_supabase()
    await run_query(db.table("user_profiles").update({"nav_order": order}).eq("user_id", user_id))
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


@router.get("/nav-order")
async def get_nav_order(user_id: str = Depends(get_current_user_id)):
    ck = f"sync:nav_order:{user_id}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    db = get_supabase()
    result = await run_query(db.table("user_profiles").select("nav_order").eq("user_id", user_id))
    resp = {"nav_order": result.data[0].get("nav_order")} if result.data else {"nav_order": None}
    cache_set(ck, resp, ttl=_TTL_MISC)
    return resp


# ─── Watchlist order ─────────────────────────────────────────────────────────

@router.post("/watchlist-order")
async def sync_watchlist_order(body: dict, user_id: str = Depends(get_current_user_id)):
    """Persist watchlist ticker order for cross-device sync."""
    order = body.get("order", [])
    db = get_supabase()
    await run_query(db.table("user_profiles").update({"watchlist_order": order}).eq("user_id", user_id))
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


# ─── Theme ───────────────────────────────────────────────────────────────────

@router.post("/theme")
async def sync_theme(body: dict, user_id: str = Depends(get_current_user_id)):
    """Persist the user's dark/light theme preference for cross-device sync."""
    theme = body.get("theme", "dark")
    if theme not in ("dark", "light"):
        theme = "dark"
    db = get_supabase()
    await run_query(db.table("user_profiles").update({"theme": theme}).eq("user_id", user_id))
    cache_delete(f"sync:theme:{user_id}")
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


@router.get("/theme")
async def get_theme(user_id: str = Depends(get_current_user_id)):
    ck = f"sync:theme:{user_id}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    db = get_supabase()
    result = await run_query(db.table("user_profiles").select("theme").eq("user_id", user_id))
    resp = {"theme": result.data[0].get("theme", "dark")} if result.data else {"theme": "dark"}
    cache_set(ck, resp, ttl=_TTL_MISC)
    return resp


# ─── Language ────────────────────────────────────────────────────────────────

@router.post("/language")
async def sync_language(body: dict, user_id: str = Depends(get_current_user_id)):
    """Persist the user's app language preference for cross-device sync."""
    language = body.get("language", "es")
    if language not in ("es", "en"):
        language = "es"
    db = get_supabase()
    await run_query(db.table("user_profiles").update({"preferred_language": language}).eq("user_id", user_id))
    cache_delete(f"sync:language:{user_id}")
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


@router.get("/language")
async def get_language(user_id: str = Depends(get_current_user_id)):
    ck = f"sync:language:{user_id}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    db = get_supabase()
    result = await run_query(db.table("user_profiles").select("preferred_language").eq("user_id", user_id))
    resp = {"language": result.data[0].get("preferred_language") or "es"} if result.data else {"language": "es"}
    cache_set(ck, resp, ttl=_TTL_MISC)
    return resp


# ─── Portfolio view mode ─────────────────────────────────────────────────────

@router.post("/portfolio-view-mode")
async def sync_portfolio_view_mode(body: dict, user_id: str = Depends(get_current_user_id)):
    """Persist the user's portfolio view mode (basic/advanced) for cross-device sync."""
    mode = body.get("mode", "advanced")
    if mode not in ("basic", "advanced"):
        mode = "advanced"
    db = get_supabase()
    await run_query(db.table("user_profiles").update({"portfolio_view_mode": mode}).eq("user_id", user_id))
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


# ─── Watchlist view mode ─────────────────────────────────────────────────────

@router.post("/watchlist-view-mode")
async def sync_watchlist_view_mode(body: dict, user_id: str = Depends(get_current_user_id)):
    """Persist the user's watchlist view mode (basic/advanced) for cross-device sync."""
    mode = body.get("mode", "advanced")
    if mode not in ("basic", "advanced"):
        mode = "advanced"
    db = get_supabase()
    await run_query(db.table("user_profiles").update({"watchlist_view_mode": mode}).eq("user_id", user_id))
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


# ─── Detail level (Fase 4, Incremento 1) ─────────────────────────────────────

_VALID_DETAIL_LEVELS = ("principiante", "intermedio", "avanzado", "profesional")


@router.post("/detail-level")
async def sync_detail_level(body: dict, user_id: str = Depends(get_current_user_id)):
    """Persist the user's "Nivel de Detalle" (Principiante/Intermedio/
    Avanzado/Profesional) for cross-device sync — deliberately separate from
    portfolio/watchlist view mode above, see migration 064."""
    level = body.get("level", "intermedio")
    if level not in _VALID_DETAIL_LEVELS:
        level = "intermedio"
    db = get_supabase()
    await run_query(db.table("user_profiles").update({"detail_level": level}).eq("user_id", user_id))
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


# ─── Personalization (Fase 4, Incremento 12) ─────────────────────────────────

_VALID_DISCOUNT_RATE_METHODS = ("wacc", "required_return")
_MAX_FAVORITE_METRICS = 6
_VALID_DASHBOARD_SECTIONS = (
    "summary", "quality_headline", "fair_value_range", "key_risks", "conclusion",
    "roic_fcf_growth", "moat_score", "capital_allocation", "competitors", "timeline",
    "dcf_full", "reverse_dcf", "sensitivity", "scenarios",
    "raw_assumptions", "factors_detail",
)


def _build_personalization_update(body: dict) -> dict:
    """Pure validation/sanitization of a partial personalization body into
    a safe user_profiles update dict — separated from the route so it's
    testable without mocking Supabase. Only keys present in `body` are
    included in the result; an out-of-range/invalid value for a present
    key is stored as None (an explicit "cleared", never silently ignored
    or defaulted to something the user didn't ask for) except
    `preferred_discount_rate_method`, which has a real safe default."""
    update: dict = {}

    if "required_return_pct" in body:
        val = body["required_return_pct"]
        update["required_return_pct"] = float(val) if val is not None and 0 < float(val) < 100 else None

    if "min_margin_of_safety_pct" in body:
        val = body["min_margin_of_safety_pct"]
        update["min_margin_of_safety_pct"] = float(val) if val is not None and -100 < float(val) < 100 else None

    if "preferred_discount_rate_method" in body:
        method = body["preferred_discount_rate_method"]
        update["preferred_discount_rate_method"] = method if method in _VALID_DISCOUNT_RATE_METHODS else "wacc"

    if "favorite_metrics" in body:
        metrics = body["favorite_metrics"]
        update["favorite_metrics"] = list(metrics)[:_MAX_FAVORITE_METRICS] if isinstance(metrics, list) else []

    if "dashboard_section_order" in body:
        order = body["dashboard_section_order"]
        if isinstance(order, list) and all(s in _VALID_DASHBOARD_SECTIONS for s in order):
            update["dashboard_section_order"] = order
        else:
            update["dashboard_section_order"] = None

    return update


@router.post("/personalization")
async def sync_personalization(body: dict, user_id: str = Depends(get_current_user_id)):
    """Persist the Personalización settings (Parte L): required return,
    minimum margin of safety, preferred discount-rate method, favorite
    metrics, and dashboard section order. Deliberately per-request-surface
    only — see migration 069's docstring for why these never touch the
    shared nif_dashboard/quick_analysis caches. Every field is optional;
    only the ones present in the body are updated (same partial-update
    convention as the rest of this file)."""
    update = _build_personalization_update(body)
    if not update:
        return {"ok": True}

    db = get_supabase()
    await run_query(db.table("user_profiles").update(update).eq("user_id", user_id))
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


# ─── Checklist done ───────────────────────────────────────────────────────────

@router.post("/checklist-done")
async def sync_checklist_done(user_id: str = Depends(get_current_user_id)):
    """Mark the onboarding checklist as permanently completed."""
    db = get_supabase()
    await run_query(db.table("user_profiles").update({"checklist_done": True}).eq("user_id", user_id))
    cache_delete(f"sync:all:{user_id}")
    return {"ok": True}


# ─── Behavioral risk score ────────────────────────────────────────────────────

@router.post("/behavioral-risk")
async def sync_behavioral_risk(body: dict, user_id: str = Depends(get_current_user_id)):
    """Persist the user's computed behavioral risk score (0-100) for cross-device sync."""
    score = body.get("score")
    if score is None:
        return {"ok": False, "reason": "missing_score"}
    try:
        db = get_supabase()
        await run_query(
            db.table("user_profiles").update({"behavioral_risk_score": int(score)}).eq("user_id", user_id)
        )
        cache_delete(f"sync:all:{user_id}")
        return {"ok": True}
    except Exception:
        return {"ok": False, "reason": "column_missing"}


@router.get("/behavioral-risk")
async def get_behavioral_risk(user_id: str = Depends(get_current_user_id)):
    try:
        db = get_supabase()
        result = await run_query(
            db.table("user_profiles").select("behavioral_risk_score").eq("user_id", user_id)
        )
        if result.data:
            return {"score": result.data[0].get("behavioral_risk_score")}
    except Exception:
        pass
    return {"score": None}


# ─── Push token ───────────────────────────────────────────────────────────────

@router.post("/push-token")
async def save_push_token(body: dict, user_id: str = Depends(get_current_user_id)):
    """Save or update the Expo push token for this device."""
    token = (body.get("token") or "").strip()
    if not token:
        return {"ok": False}
    db = get_supabase()
    await run_query(db.table("user_profiles").update({"push_token": token}).eq("user_id", user_id))
    # Ensure a notification_preferences row exists so scheduled jobs pick up this user.
    # ignore_duplicates=True preserves existing user preferences on conflict.
    await run_query(
        db.table("notification_preferences").upsert(
            {
                "user_id": user_id,
                "push_market_open": True,
                "push_market_close": True,
                "push_news_general": True,
                "push_portfolio_alerts": True,
                "push_watchlist_alerts": True,
                "push_ai_recommendations": True,
                "push_milestones": True,
                "push_volatility": True,
                "email_daily_summary": True,
                "email_weekly_summary": True,
                "max_push_per_day": 5,
                "max_push_per_week": 20,
            },
            on_conflict="user_id",
            ignore_duplicates=True,
        )
    )
    return {"ok": True}
