"""
Nuvos Plus — Fase 4A: the HTTP surface for the portfolio exposure engine
(app/services/portfolio_exposure/). Strictly read-only — no endpoint here
writes to user_portfolio.

Fase 8C (2026-11-12, Diego): "no Nuvos Plus subscription for now — ship
what's built as free for every authenticated user, decide monetization
later." The Fase 8B premium/admin gate (`require_premium_or_admin`) is
removed; every route below only requires a verified session
(`get_current_user`). Portfolio ownership, RLS, rate limits and the FMP
budget guard are untouched — only the commercial gate is gone."""
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.deps import get_current_user
from app.core.cache import cache_get, cache_set
from app.core.limiter import limiter
from app.services.portfolio_exposure.combiner import InvalidSimulationInputError
from app.services.portfolio_exposure.pulse_compare import compare_latest_for_portfolio
from app.services.portfolio_exposure.service import (
    PortfolioNotFoundError,
    get_portfolio_exposure,
    simulate_portfolio_addition,
    simulate_portfolio_addition_with_history,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/portfolio-exposure", tags=["portfolio-exposure"])

_TICKER_RE = re.compile(r"^[A-Z]{1,6}(\.[A-Z]{1,3})?$")
_VALID_HISTORY_PERIODS = {"1y", "3y", "5y"}

_SIMULATION_ERROR_MESSAGES_ES = {
    "ticker_required": "Escribe un ticker para simular.",
    "ticker_invalid_format": "'{ticker}' no parece un símbolo de ticker válido.",
    "ticker_not_recognized": "No pudimos confirmar que '{ticker}' sea una acción o ETF real — no mostramos una simulación con un activo que no pudimos verificar.",
    "invalid_amount": "El monto no es un número válido.",
    "amount_must_be_positive": "El monto debe ser mayor a cero.",
    "amount_too_large": "El monto es demasiado grande para simular.",
    "portfolio_currency_unknown": "No pudimos confirmar la moneda base de tu portafolio.",
}


@router.get("/{portfolio_id}")
@limiter.limit("20/minute")
async def get_portfolio_exposure_route(request: Request, portfolio_id: str = "default", user: dict = Depends(get_current_user)):
    """Returns get_portfolio_exposure()'s result for the CALLING user's own
    `portfolio_id` — ownership is enforced server-side via `user["id"]`
    from the verified session, never from a client-supplied user id. 404
    if that portfolio doesn't exist (or belongs to someone else — those
    two cases are indistinguishable on purpose, see service.py), 503 if
    the computation fails unexpectedly."""
    try:
        return await get_portfolio_exposure(user["id"], portfolio_id)
    except PortfolioNotFoundError:
        raise HTTPException(status_code=404, detail=f"No encontramos el portafolio '{portfolio_id}'.")
    except Exception:
        logger.exception("portfolio_exposure route: get_portfolio_exposure(%s) raised unexpectedly", portfolio_id)
        raise HTTPException(status_code=503, detail="No pudimos calcular la exposición de tu portafolio en este momento. Intenta de nuevo en unos segundos.")


@router.post("/{portfolio_id}/simulate")
@limiter.limit("20/minute")
async def simulate_portfolio_addition_route(request: Request, portfolio_id: str, body: dict, user: dict = Depends(get_current_user)):
    """Fase 4C-1 — 'Antes de invertir'. Body: {"ticker": str, "amount": number}.
    Strictly read-only: never writes to user_portfolio, never modifies
    quantities/prices/transactions. 404 if the portfolio doesn't exist (or
    belongs to someone else), 422 for an invalid ticker/amount (never a
    degraded 'simulation' for either), 503 for an unexpected failure."""
    ticker = (body.get("ticker") or "").strip().upper()
    amount = body.get("amount")

    if not ticker:
        raise HTTPException(status_code=422, detail=_SIMULATION_ERROR_MESSAGES_ES["ticker_required"])
    if not _TICKER_RE.match(ticker):
        raise HTTPException(status_code=422, detail=_SIMULATION_ERROR_MESSAGES_ES["ticker_invalid_format"].format(ticker=ticker))

    try:
        return await simulate_portfolio_addition(user["id"], portfolio_id, ticker, amount)
    except PortfolioNotFoundError:
        raise HTTPException(status_code=404, detail=f"No encontramos el portafolio '{portfolio_id}'.")
    except InvalidSimulationInputError as exc:
        message = _SIMULATION_ERROR_MESSAGES_ES.get(exc.reason, "No pudimos simular esta inversión.").format(ticker=ticker)
        raise HTTPException(status_code=422, detail=message)
    except Exception:
        logger.exception("portfolio_exposure route: simulate_portfolio_addition(%s, %s) raised unexpectedly", portfolio_id, ticker)
        raise HTTPException(status_code=503, detail="No pudimos generar la simulación en este momento. Intenta de nuevo en unos segundos.")


@router.post("/{portfolio_id}/simulate-history")
@limiter.limit("10/minute")
async def simulate_portfolio_addition_history_route(request: Request, portfolio_id: str, body: dict, user: dict = Depends(get_current_user)):
    """Fase 5B/5B.1 — comparación histórica retrospectiva entre la
    composición real (A) y la hipotética (B). POST, no GET: mismo motivo
    que /simulate ya usa — el ticker y, sobre todo, el MONTO de la
    aportación son datos del usuario que no deben quedar en una URL
    (logs de acceso, historial del navegador, proxies intermedios); un
    body JSON es la alternativa ya establecida en esta misma API para
    exactamente este caso. Body: {"ticker": str, "amount": number,
    "period": "1y"|"3y"|"5y"}.

    Estrictamente de solo lectura — nunca escribe en user_portfolio, nunca
    persiste el escenario hipotético ni el resultado histórico. Un hueco
    de datos históricos (moneda no-USD, historial insuficiente, proveedor
    sin respuesta, etc.) nunca es un error HTTP: es un 200 con
    `history.available = false` y el motivo exacto — la comparación
    siempre es honesta sobre lo que no pudo construir, nunca lo oculta
    detrás de un 503."""
    ticker = (body.get("ticker") or "").strip().upper()
    amount = body.get("amount")
    period = body.get("period")

    if not ticker:
        raise HTTPException(status_code=422, detail=_SIMULATION_ERROR_MESSAGES_ES["ticker_required"])
    if not _TICKER_RE.match(ticker):
        raise HTTPException(status_code=422, detail=_SIMULATION_ERROR_MESSAGES_ES["ticker_invalid_format"].format(ticker=ticker))
    if period not in _VALID_HISTORY_PERIODS:
        raise HTTPException(status_code=422, detail=f"'period' debe ser uno de: {', '.join(sorted(_VALID_HISTORY_PERIODS))}.")

    try:
        return await simulate_portfolio_addition_with_history(user["id"], portfolio_id, ticker, amount, period)
    except PortfolioNotFoundError:
        raise HTTPException(status_code=404, detail=f"No encontramos el portafolio '{portfolio_id}'.")
    except InvalidSimulationInputError as exc:
        message = _SIMULATION_ERROR_MESSAGES_ES.get(exc.reason, "No pudimos simular esta inversión.").format(ticker=ticker)
        raise HTTPException(status_code=422, detail=message)
    except Exception:
        logger.exception("portfolio_exposure route: simulate_portfolio_addition_with_history(%s, %s) raised unexpectedly", portfolio_id, ticker)
        raise HTTPException(status_code=503, detail="No pudimos generar la comparación histórica en este momento. Intenta de nuevo en unos segundos.")


_PULSE_CACHE_TTL_S = 60  # corto a propósito -- nunca sirve una respuesta vieja por mucho tiempo tras una corrección de snapshots
_VALID_PULSE_SNAPSHOT_TYPES = {"month_end", "on_demand"}


@router.get("/{portfolio_id}/pulse")
@limiter.limit("20/minute")
async def get_portfolio_pulse_route(request: Request, portfolio_id: str, snapshot_type: str = "month_end", user: dict = Depends(get_current_user)):
    """Fase 6D — Nuvos Pulse: '¿qué cambió entre dos fotografías
    verificables de este portafolio?'. Estrictamente de solo lectura:
    reutiliza `compare_latest_for_portfolio`, que solo consulta
    `portfolio_pulse_snapshots` ya persistidos — nunca genera un snapshot
    nuevo, nunca llama a FMP, nunca modifica `user_portfolio`.

    La propiedad del portafolio se cumple por construcción: la consulta
    interna siempre filtra por `user["id"]` (de la sesión verificada) Y
    `portfolio_id` — nunca acepta un ID de fotografía de otro usuario, y
    un portafolio ajeno o inexistente es indistinguible de uno sin
    historial suficiente (ambos devuelven `insufficient_history`, nunca
    un 404 que confirme si existe).

    Siempre 200 con el contrato propio del motor (`available`,
    `insufficient_history`, `not_comparable`, etc.) — nunca un error HTTP
    para un estado que el propio comparador ya sabe explicar."""
    if snapshot_type not in _VALID_PULSE_SNAPSHOT_TYPES:
        raise HTTPException(status_code=422, detail=f"'snapshot_type' debe ser uno de: {', '.join(sorted(_VALID_PULSE_SNAPSHOT_TYPES))}.")

    cache_key = f"pulse_compare:{user['id']}:{portfolio_id}:{snapshot_type}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        result = await compare_latest_for_portfolio(user["id"], portfolio_id, snapshot_type)
    except Exception:
        logger.exception("portfolio_exposure route: compare_latest_for_portfolio(%s, %s) raised unexpectedly", portfolio_id, snapshot_type)
        raise HTTPException(status_code=503, detail="No pudimos calcular la comparación de Nuvos Pulse en este momento. Intenta de nuevo en unos segundos.")

    cache_set(cache_key, result, ttl=_PULSE_CACHE_TTL_S)
    return result
