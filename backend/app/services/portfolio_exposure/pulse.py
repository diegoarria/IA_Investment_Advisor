"""
Nuvos Pulse — Fase 6B: infraestructura de fotografías históricas
verificables. Captura EXCLUSIVAMENTE lo que el motor de exposición ya
calcula y ya verifica — nunca una segunda implementación de ninguna
fórmula, nunca una reconstrucción retroactiva de cantidades ni de
composición de ETFs.

Decisión fundamental (Diego, Fase 6B): "no quiero reconstruir
artificialmente el cierre mensual". `period_key` es solo la clave estable
del SLOT de captura (p. ej. "2026-12") — nunca una afirmación de que los
datos corresponden a un cierre histórico exacto. `observed_at` (puesto
por la base de datos, nunca por el cliente) es el único reloj real.

Sin endpoint HTTP público — esta función solo se invoca desde el job
mensual (no activado todavía) y desde pruebas/capturas manuales internas.
Sin escritura sobre `user_portfolio`: solo lee posiciones reales (vía
`_build_valued_positions`, el mismo fetch que ya usan
`get_portfolio_exposure`/`simulate_portfolio_addition`) y escribe
exclusivamente en `portfolio_pulse_snapshots`.
"""
import logging
import time
from datetime import datetime, timezone

from app.core.database import get_supabase, run_query
from app.services.portfolio_exposure import combiner
from app.services.portfolio_exposure.service import _EMPTY_EXPOSURE, _build_valued_positions

logger = logging.getLogger(__name__)

METHODOLOGY_VERSION = "combiner-v2"  # bump whenever compute_full_exposure's formulas change meaningfully
# v2 (2026-11-12, Fase 8-fix): compute_sector_exposure/compute_geographic_exposure
# now separate non-GICS ETF categories (gold/silver "Cash & Others", bond
# credit-type buckets) and physically-backed funds with zero underlying
# holdings into their own "non applicable" totals instead of folding them
# into coverage_pct/by_sector/by_country — coverage_pct's real numeric
# value changes for any portfolio holding one of these funds, even with
# zero change to the user's actual holdings. The comparability gate below
# (methodology_version mismatch -> not_comparable) is what stops that from
# ever surfacing as a fabricated Pulse delta.


class SnapshotCorrectionError(Exception):
    """Raised when a correction is attempted against a snapshot that
    isn't the caller's own, doesn't exist, or isn't currently vigente —
    never silently corrects the wrong row."""


def period_key_for(dt: datetime) -> str:
    """The stable slot identifier for a given capture moment — "YYYY-MM"
    of the capture window itself, NEVER a claim about which historical
    close the data represents (see this module's docstring)."""
    return dt.strftime("%Y-%m")


def _iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _position_for_snapshot(p: dict) -> dict:
    """The exact fields Pulse persists per position — full-precision
    weight (`weight_fraction`, never rounded) ALONGSIDE the display
    `weight_pct`, the real native-currency `price` and when it was
    fetched, and nothing this module invented: every field here already
    exists on the position dict `combiner.compute_full_exposure` built."""
    return {
        "ticker": p["ticker"],
        "name": p.get("name"),
        "asset_class": p["asset_class"],
        "shares": p["shares"],
        "avg_price": p["avg_price"],
        "cost_basis": p["cost_basis"],
        "verifiable": p["verifiable"],
        "unverifiable_reason": p.get("unverifiable_reason"),
        "quote_currency": p.get("quote_currency"),
        "fx_rate_applied": p.get("fx_rate_applied"),
        "price": p.get("price"),
        "price_observed_at": _iso(p.get("price_fetched_at")),
        "market_value": p.get("market_value"),
        "weight_pct": p.get("weight_pct"),
        "weight_fraction": p.get("_weight_fraction"),
        "sector": p.get("sector"),
        "country": p.get("country"),
        "etf_company": p.get("etf_company"),
        # Fase 6B: FMP's own stated date for when it last refreshed this
        # ETF's structural data (sector/country weightings included) —
        # None for equities (no such concept) and None for an ETF when
        # FMP doesn't provide it, never guessed. This is what makes
        # `sector_exposure_asof_source` honest below: we only ever know
        # the CURRENT weightings, and this is the closest real signal of
        # how stale "current" actually is.
        "sector_exposure_provider_updated_at": (p.get("_etf_overview") or {}).get("identification", {}).get("sector_exposure_provider_updated_at") if p["asset_class"] == "etf" else None,
    }


def _verification_state(valuation: dict) -> str:
    """full: every position verified (or the portfolio is genuinely
    empty — a valid, fully-verified "nothing to show" state, not a
    failure). partial: some but not all verified. failed: positions
    exist but NONE could be verified — a snapshot this poor must never
    be treated as a usable observation (Diego: "no considerar una
    captura fallida como exitosa")."""
    if valuation["position_count"] == 0:
        return "full"
    if valuation["total_value_verified"] is None or valuation["verified_position_count"] == 0:
        return "failed"
    if valuation["verified_position_count"] < valuation["position_count"]:
        return "partial"
    return "full"


def build_snapshot_payload(valued: list[dict], exposure: dict, portfolio_currency: str) -> dict:
    """Pure transformation from an already-computed `compute_full_exposure`
    result into the exact JSONB shape `portfolio_pulse_snapshots` stores.
    Never recomputes a single number — only re-presents what the
    verified exposure engine already produced, at full internal
    precision (never rounding before persisting, per Diego's explicit
    "no almacenar únicamente valores redondeados de UI")."""
    positions_payload = [_position_for_snapshot(p) for p in valued]
    sector_exposure = exposure["sector_exposure"]
    sector_exposure_with_asof = {
        **sector_exposure,
        # Honest by construction: we only ever have TODAY's sector/
        # country weightings (Fase 5A.1/5B confirmed no historical ETF
        # composition exists anywhere) — this is captured as the real
        # query time, never backdated to a claimed period end.
        "asof_observed_at": _iso(time.time()),
        "asof_source": "query_time",
    }
    sources = sorted({
        "FMP /profile", "FMP /quote",
        *(["FMP /etf/info", "FMP /etf/sector-weightings", "FMP /etf/country-weightings"] if any(p["asset_class"] == "etf" for p in valued) else []),
    })
    return {
        "base_currency": portfolio_currency,
        "methodology_version": METHODOLOGY_VERSION,
        "total_value_verified": exposure["valuation"]["total_value_verified"],
        "valuation_coverage_pct": exposure["valuation"]["valuation_coverage_pct"],
        "positions": positions_payload,
        "sector_exposure": sector_exposure_with_asof,
        "geographic_exposure": exposure["geographic_exposure"],
        "composition": exposure["composition"],
        "sources": sources,
        "verification_state": _verification_state(exposure["valuation"]),
    }


async def capture_snapshot(user_id: str, portfolio_id: str, snapshot_type: str, period_key: str | None = None, use_cache: bool = True) -> dict:
    """The one entry point. Ownership is enforced by construction —
    `_build_valued_positions` queries `user_portfolio` filtered by BOTH
    `user_id` and `portfolio_id`, raising PortfolioNotFoundError (never a
    different/distinguishable error) if that pair doesn't exist — same
    discipline as every other portfolio_exposure entry point.

    Idempotent: delegates the actual INSERT to the
    `capture_pulse_snapshot_if_absent` Postgres function, which either
    inserts a new row or returns the already-vigente one for this exact
    slot — this function can be called any number of times (job retries,
    manual re-runs) for the same (user, portfolio, snapshot_type,
    period_key) without ever duplicating or overwriting a prior
    observation."""
    if period_key is None:
        period_key = period_key_for(datetime.now(timezone.utc))

    valued, portfolio_currency, _portfolio = await _build_valued_positions(user_id, portfolio_id, use_cache)
    exposure = combiner.compute_full_exposure(valued) if valued else _EMPTY_EXPOSURE
    payload = build_snapshot_payload(valued, exposure, portfolio_currency)

    db = get_supabase()
    result = await run_query(db.rpc("capture_pulse_snapshot_if_absent", {
        "p_user_id": user_id,
        "p_portfolio_id": portfolio_id,
        "p_snapshot_type": snapshot_type,
        "p_period_key": period_key,
        "p_payload": payload,
    }))
    rows = result.data if isinstance(result.data, list) else ([result.data] if result.data else [])
    if not rows:
        raise RuntimeError(f"capture_pulse_snapshot_if_absent returned no row for {user_id}/{portfolio_id}/{snapshot_type}/{period_key}")
    return rows[0]


async def correct_snapshot(user_id: str, portfolio_id: str, snapshot_id: str, reason: str, use_cache: bool = True) -> dict:
    """Recomputes a fresh exposure right now and records it as a
    correction of `snapshot_id` — never silently re-running
    capture_snapshot, which would be a no-op against an already-vigente
    slot. Verifies `snapshot_id` actually belongs to (user_id,
    portfolio_id) and is still the vigente version before touching it —
    a user can never correct someone else's snapshot, and a stale
    correction attempt (against a row some other correction already
    superseded) is refused rather than silently rewritten."""
    db = get_supabase()
    existing = await run_query(
        db.table("portfolio_pulse_snapshots")
        .select("id")
        .eq("id", snapshot_id).eq("user_id", user_id).eq("portfolio_id", portfolio_id).eq("is_current", True)
    )
    if not existing.data:
        raise SnapshotCorrectionError(f"no vigente snapshot {snapshot_id} for this user/portfolio to correct")

    valued, portfolio_currency, _portfolio = await _build_valued_positions(user_id, portfolio_id, use_cache)
    exposure = combiner.compute_full_exposure(valued) if valued else _EMPTY_EXPOSURE
    payload = build_snapshot_payload(valued, exposure, portfolio_currency)

    result = await run_query(db.rpc("correct_pulse_snapshot", {
        "p_old_id": snapshot_id, "p_payload": payload, "p_reason": reason,
    }))
    rows = result.data if isinstance(result.data, list) else ([result.data] if result.data else [])
    if not rows:
        raise RuntimeError(f"correct_pulse_snapshot returned no row for {snapshot_id}")
    return rows[0]
