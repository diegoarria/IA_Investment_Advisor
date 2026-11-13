"""
Nuvos Plus — Fase 4A/4C: orchestrator. Two entry points the routes call:

  - get_portfolio_exposure(user_id, portfolio_id) — today's real exposure.
  - simulate_portfolio_addition(user_id, portfolio_id, ticker, amount) —
    Fase 4C-1's "Antes de invertir": before/after exposure for a
    hypothetical new-money contribution.

Both read the EXISTING `user_portfolio` table (same query shape as
app.api.routes.sync.get_portfolio — no second storage system), fan out
valuation across positions with bounded concurrency (same discipline as
app.api.routes.etf's card-fetch semaphore), and share the exact same
`_build_valued_positions` fetch + `combiner.compute_full_exposure` math —
there is no second implementation of valuation/weighting/sector/country
formulas for the simulator.

A third entry point, simulate_portfolio_addition_with_history (Fase 5B/
5B.1), adds the retrospective historical comparison — it calls
_build_valued_positions exactly ONCE, same as the other two, so the
"before" and "after" historical curves are built from the SAME price/FX/
classification snapshot, never a second live fetch for either half.

Strictly read-only: this module contains no INSERT/UPDATE/DELETE against
user_portfolio anywhere, and never will — the simulator in particular must
never accidentally touch real positions (see combiner.py's docstring)."""
import asyncio
import logging
import time

from app.api.routes.sync import _parse_portfolio
from app.core.cache import cache_get, cache_set
from app.core.database import get_supabase, run_query
from app.services.portfolio_exposure import combiner
from app.services.portfolio_exposure.insights import build_insights

logger = logging.getLogger(__name__)

_VALUATION_CONCURRENCY = 4
_TTL_RESPONSE_S = 60  # matches get_fmp_quote_price's own 60s quote cache — no point caching longer

_EMPTY_EXPOSURE = {
    "valuation": {"total_value_verified": None, "total_cost_basis_all_positions": 0.0, "position_count": 0, "verified_position_count": 0, "unverifiable_position_count": 0, "valuation_coverage_pct": None},
    "positions": [],
    "composition": {"equity_value": 0.0, "equity_pct": None, "etf_value": 0.0, "etf_pct": None, "unknown_asset_value_cost_basis": 0.0},
    "sector_exposure": {"by_sector": [], "coverage_pct": None, "unclassified_value": 0.0},
    "geographic_exposure": {"by_country": [], "equity_domicile_coverage_pct": None, "etf_underlying_coverage_pct": None, "note_es": ""},
    "concentration": {"top_positions": [], "largest_single_position_pct": None},
}


class PortfolioNotFoundError(Exception):
    """Raised when `portfolio_id` doesn't belong to `user_id` (or doesn't
    exist at all) — the route turns this into 404, never a 500, and never
    leaks whether the portfolio_id exists for a DIFFERENT user."""


async def _read_portfolio(user_id: str, portfolio_id: str) -> dict:
    db = get_supabase()
    result = await run_query(
        db.table("user_portfolio")
        .select("positions, portfolio_name, updated_at")
        .eq("user_id", user_id)
        .eq("portfolio_id", portfolio_id)
    )
    if not result.data:
        raise PortfolioNotFoundError(portfolio_id)
    parsed = _parse_portfolio(result.data[0]["positions"])
    return {**parsed, "portfolio_name": result.data[0]["portfolio_name"]}


def _strip_internal_fields(position: dict) -> dict:
    return {k: v for k, v in position.items() if not k.startswith("_")}


async def _build_valued_positions(user_id: str, portfolio_id: str, use_cache: bool) -> tuple[list[dict], str, dict]:
    """The ONE fetch of a user's real positions — reused identically by
    get_portfolio_exposure (today's exposure) and
    simulate_portfolio_addition (the "before" half of a simulation), so
    the two can never drift onto different snapshots of the same
    portfolio. Returns (valued_positions, portfolio_currency, portfolio).
    `valued_positions` is empty (never None) for a portfolio with no
    positions — callers branch on that, not on an exception."""
    portfolio = await _read_portfolio(user_id, portfolio_id)
    raw_positions = portfolio["positions"]
    portfolio_currency = portfolio.get("currency") or "USD"

    if not raw_positions:
        return [], portfolio_currency, portfolio

    agg = combiner.aggregate_and_classify(raw_positions)
    semaphore = asyncio.Semaphore(_VALUATION_CONCURRENCY)

    async def _value_one(position: dict) -> dict:
        async with semaphore:
            return await asyncio.to_thread(combiner.value_position, position, portfolio_currency)

    valued = list(await asyncio.gather(*(_value_one(p) for p in agg)))
    return valued, portfolio_currency, portfolio


async def get_portfolio_exposure(user_id: str, portfolio_id: str = "default", use_cache: bool = True) -> dict:
    """Ownership is enforced by construction — `user_id` comes from
    `get_current_user_id` (JWT-derived) at the route layer, never from a
    client-supplied field, and the Supabase query itself filters by it.
    A portfolio_id that exists but belongs to someone else is
    indistinguishable here from one that doesn't exist at all (both raise
    PortfolioNotFoundError) — no information about other users' portfolios
    is ever observable through this function."""
    cache_key = f"portfolio_exposure:{user_id}:{portfolio_id}"
    if use_cache:
        cached = cache_get(cache_key)
        if cached is not None:
            return cached

    valued, portfolio_currency, portfolio = await _build_valued_positions(user_id, portfolio_id, use_cache)

    if not valued:
        result = {
            "portfolio_id": portfolio_id,
            "portfolio_name": portfolio.get("portfolio_name"),
            "currency": portfolio_currency,
            "generated_at": time.time(),
            "insights": [],
            "unverifiable_positions": [],
            **_EMPTY_EXPOSURE,
        }
        return result

    exposure = combiner.compute_full_exposure(valued)
    insights = build_insights(valued, exposure["sector_exposure"], exposure["concentration"], exposure["valuation"])
    unverifiable_positions = [{"ticker": p["ticker"], "reason": p["unverifiable_reason"]} for p in valued if not p["verifiable"]]

    result = {
        "portfolio_id": portfolio_id,
        "portfolio_name": portfolio.get("portfolio_name"),
        "currency": portfolio_currency,
        "generated_at": time.time(),
        "valuation": exposure["valuation"],
        "positions": [_strip_internal_fields(p) for p in exposure["positions"]],
        "composition": exposure["composition"],
        "sector_exposure": exposure["sector_exposure"],
        "geographic_exposure": exposure["geographic_exposure"],
        "concentration": exposure["concentration"],
        "insights": insights,
        "unverifiable_positions": unverifiable_positions,
    }

    if exposure["valuation"]["verified_position_count"] > 0:
        cache_set(cache_key, result, ttl=_TTL_RESPONSE_S)
    return result


def _serialize_exposure_block(block: dict) -> dict:
    """Same `_strip_internal_fields` treatment compute_full_exposure's
    "positions" list needs before crossing the API boundary — shared by
    both the "before" and "after" blocks of a simulation response."""
    return {**block, "positions": [_strip_internal_fields(p) for p in block["positions"]]}


async def simulate_portfolio_addition(user_id: str, portfolio_id: str, ticker: str, amount, use_cache: bool = True) -> dict:
    """Fase 4C-1: 'Antes de invertir'. Fetches the user's REAL positions
    exactly once (same `_build_valued_positions` as get_portfolio_exposure
    — same snapshot, same prices, same FX rates, same classifications),
    builds the one hypothetical position, and hands both to
    combiner.simulate_addition — which is where every before/after number
    actually gets computed, using the exact same formulas as today's real
    exposure. This function does no math of its own.

    Raises PortfolioNotFoundError (404) or
    combiner.InvalidSimulationInputError (422, bad ticker/amount) — never
    silently degrades either into a misleading result."""
    valued, portfolio_currency, portfolio = await _build_valued_positions(user_id, portfolio_id, use_cache)

    hypothetical = await asyncio.to_thread(combiner.build_hypothetical_position, ticker, amount, portfolio_currency)
    sim = combiner.simulate_addition(valued, hypothetical)

    return {
        "portfolio_id": portfolio_id,
        "portfolio_name": portfolio.get("portfolio_name"),
        "currency": portfolio_currency,
        "generated_at": time.time(),
        "amount": sim["amount"],
        "hypothetical_ticker": sim["hypothetical_ticker"],
        "hypothetical_asset_class": sim["hypothetical_asset_class"],
        "before_had_no_verified_positions": sim["before_had_no_verified_positions"],
        "before": _serialize_exposure_block(sim["before"]),
        "after": _serialize_exposure_block(sim["after"]),
        "sector_deltas": sim["sector_deltas"],
        "country_deltas": sim["country_deltas"],
        "note_es": (
            "Esta es una simulación por importe — no representa una orden de compra, no ejecuta ninguna transacción "
            "y no modifica tu portafolio real. No incluye comisiones, impuestos ni la disponibilidad de compra de "
            "fracciones de título."
        ),
        "note_en": (
            "This is an amount-based simulation — it is not a purchase order, executes no transaction, and does not "
            "modify your real portfolio. It does not account for fees, taxes, or fractional-share availability."
        ),
    }


async def simulate_portfolio_addition_with_history(user_id: str, portfolio_id: str, ticker: str, amount, period: str, use_cache: bool = True) -> dict:
    """Fase 5B/5B.1 — the retrospective historical comparison on top of
    'Antes de invertir'. Fetches the user's REAL positions exactly ONCE
    (same `_build_valued_positions` as the other two entry points — one
    snapshot, never a second live fetch for the 'after' half), builds the
    one hypothetical position, and hands both to combiner.simulate_addition
    for the SAME before/after weights the plain simulator already uses.
    historical.compare_composition_history then reads those weights'
    full-precision `_weight_fraction` (never the rounded, display-only
    `weight_pct`) to build both retrospective curves.

    Raises PortfolioNotFoundError (404) or
    combiner.InvalidSimulationInputError (422) exactly like
    simulate_portfolio_addition. Never raises for a historical-data gap —
    that always comes back as history={"available": False, "reason": ...}
    inside a normal 200 response, per historical.py's own contract."""
    from app.services.portfolio_exposure import historical

    valued, portfolio_currency, portfolio = await _build_valued_positions(user_id, portfolio_id, use_cache)

    hypothetical = await asyncio.to_thread(combiner.build_hypothetical_position, ticker, amount, portfolio_currency)
    sim = combiner.simulate_addition(valued, hypothetical)

    history = await asyncio.to_thread(
        historical.compare_composition_history,
        sim["before"]["positions"],
        sim["after"]["positions"],
        portfolio_currency,
        period,
    )

    return {
        "portfolio_id": portfolio_id,
        "portfolio_name": portfolio.get("portfolio_name"),
        "currency": portfolio_currency,
        "generated_at": time.time(),
        "amount": sim["amount"],
        "hypothetical_ticker": sim["hypothetical_ticker"],
        "hypothetical_asset_class": sim["hypothetical_asset_class"],
        "before_had_no_verified_positions": sim["before_had_no_verified_positions"],
        "history": history,
        "note_es": (
            "Esta es una simulación retrospectiva por importe — no representa una orden de compra, no ejecuta "
            "ninguna transacción, no modifica tu portafolio real y no predice resultados futuros. Los pesos "
            "aplicados al pasado son los de hoy; no representan el historial real de operaciones del usuario."
        ),
        "note_en": (
            "This is a retrospective amount-based simulation — it is not a purchase order, executes no transaction, "
            "does not modify your real portfolio, and does not predict future results. The weights applied to the "
            "past are today's; they do not represent the user's real trading history."
        ),
    }
