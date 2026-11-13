"""
Nuvos Plus — Fase 5B: motor de comparación histórica entre dos
composiciones hipotéticas del portafolio.

Composición A = los pesos REALES que ya produce combiner.simulate_addition
("before"). Composición B = los pesos hipotéticos después de la aportación
("after"). Este módulo NUNCA recalcula un peso, una moneda de cotización
ni una clasificación de activo — solo consume los campos `ticker`,
`weight_pct`, `quote_currency`, `verifiable` que esas posiciones ya traen
(Diego, Fase 5B: "La comparación histórica debe usar los pesos exactos
producidos por esos servicios. No reconstruir la composición con una
segunda implementación de cálculo de pesos.").

Fuente de precios: FMP `GET /stable/historical-price-eod/dividend-adjusted`
(`adjClose`) — confirmado en la auditoría Fase 5A.1 (consultas reales
contra VOO, QQQ, GOOGL, ASML y T) como disponible en nuestra suscripción,
ajustado por splits Y dividendos. El retorno calculado a partir de esta
serie es una APROXIMACIÓN de retorno ajustado por dividendos según la
metodología del proveedor — bruta, sin comisiones ni impuestos, nunca
presentada como retorno neto real.

MVP explícito (Diego, Fase 5B §4): solo escenarios donde la moneda de
COTIZACIÓN de cada instrumento Y la moneda base del portafolio son USD.
No existe tipo de cambio histórico en el repo — cualquier instrumento o
portafolio no-USD devuelve un estado controlado "unavailable", nunca una
conversión con la tasa de HOY aplicada al pasado. La moneda de cotización
se lee del campo `quote_currency` que combiner.value_position ya
determinó (FMP `/profile`/ETF NAV currency) — nunca por domicilio/país.

Límite de 5,000 registros por solicitud (confirmado en Fase 5A.1: una
consulta amplia se corta silenciosamente en ~5,000 filas, sin error) —
manejado aquí con tramos de ~4 años, concatenados, deduplicados por
fecha y cacheados; para los períodos del MVP (1/3/5 años) un solo tramo
ya es suficiente, cumpliendo "preferir el camino sencillo cuando un solo
tramo sea suficiente."
"""
from __future__ import annotations

import logging
import math
import statistics
from datetime import date, datetime, timedelta

import requests

from app.core.cache import cache_get, cache_set
from app.core.fmp_budget import fmp_call_allowed
from app.services.financial_data_service import FMP_BASE, FMP_KEY, _REQ_HEADERS

logger = logging.getLogger(__name__)

_CHUNK_YEARS = 4  # ~1,000 trading days/tramo — bien debajo del tope de 5,000 filas confirmado en Fase 5A.1
_MAX_FORWARD_FILL_DAYS = 3  # solo huecos aislados de UN ticker — nunca un feriado de mercado completo
_MIN_VOLATILITY_OBSERVATIONS = 30
_PERIOD_YEARS = {"1y": 1, "3y": 3, "5y": 5}
# Las cotizaciones históricas no cambian, pero "hoy" sigue moviendo el
# extremo final de la ventana en cada simulación nueva — TTL deliberadamente
# más corto que el de 30 días que usa get_historical_prices_near_dates para
# puntos fiscales fijos.
_TTL_PRICE_SERIES_S = 24 * 3600

DISCLAIMER_ES = "Simulación retrospectiva. No representa operaciones reales ni predice resultados futuros."
DISCLAIMER_EN = "Retrospective simulation. It does not represent real trades and does not predict future results."

METHODOLOGY_ES = (
    "Ambas composiciones se reindexan a un valor inicial de 100 en la misma fecha de inicio, con los pesos "
    "reales/hipotéticos fijos a partir de ese momento (compra y retención, sin rebalanceo ni aportaciones "
    "posteriores). Los precios usados están ajustados por splits y dividendos según la metodología del "
    "proveedor (FMP) — un retorno aproximado antes de comisiones e impuestos, no un retorno neto real. Esta "
    "es una comparación contrafactual con los pesos de hoy aplicados retrospectivamente: no representa el "
    "historial real de operaciones del usuario ni una estrategia necesariamente disponible con la información "
    "de la fecha de inicio."
)


class HistoricalDataUnavailableError(Exception):
    """Entrada inválida (periodo desconocido) — a diferencia de los estados
    'unavailable' (datos reales insuficientes), esto es un error de uso del
    propio llamador."""
    def __init__(self, reason: str, detail: dict | None = None):
        self.reason = reason
        self.detail = detail or {}
        super().__init__(reason)


# ─── Obtención y validación de series ──────────────────────────────────────

def _fetch_raw_chunk_once(symbol: str, start: str, end: str) -> tuple[list[dict], bool, bool]:
    """One real, budget-checked historical-price attempt for the EXACT
    `symbol` string given. Returns (rows, cacheable, retry_with_canonical_
    worthwhile):
      - cacheable: True only for a genuine 200 response (even an empty
        `rows` is a legitimate "no trading data in this date range"
        answer, worth caching) — never True for a transient/rejected
        request, so that never gets persisted as "no historical data"
        for 24h.
      - retry_with_canonical_worthwhile: True only when the failure looks
        like FMP rejecting THIS symbol string specifically (any non-200
        other than 429/5xx) — never for a rate limit or server error,
        where a different symbol string wouldn't change the outcome and
        would just waste another call for nothing."""
    if not fmp_call_allowed():
        return [], False, False
    try:
        r = requests.get(
            f"{FMP_BASE}/historical-price-eod/dividend-adjusted",
            params={"apikey": FMP_KEY, "symbol": symbol, "from": start, "to": end},
            headers=_REQ_HEADERS,
            timeout=20,
        )
    except Exception as exc:
        logger.debug("historical.py: dividend-adjusted request failed for %s [%s,%s]: %s", symbol, start, end, exc)
        return [], False, False

    if r.status_code == 200:
        try:
            rows = r.json()
        except Exception:
            return [], False, False
        if not isinstance(rows, list):
            return [], False, False
        return rows, True, False

    if r.status_code == 429 or r.status_code >= 500:
        return [], False, False  # transient — a different symbol string wouldn't fix this

    # Any other non-200 (401/402/403/404...) looks like a real rejection
    # of THIS symbol specifically — confirmed live for BRK.B: a dot-
    # suffixed dual-class ticker returns 402 "special endpoint" on this
    # endpoint, where the hyphen form ("BRK-B") works.
    return [], False, True


def _fetch_raw_chunk(ticker: str, start: str, end: str) -> list[dict]:
    if not FMP_KEY:
        return []
    ck = f"fmp:adj_hist:{ticker}:{start}:{end}"
    cached = cache_get(ck)
    if cached is not None:
        return cached

    rows, cacheable, retry_worthwhile = _fetch_raw_chunk_once(ticker, start, end)
    if retry_worthwhile:
        # Fase 8-hotfix (BRK.B): retried ONLY after a confirmed rejection
        # of the ORIGINAL symbol (never pre-emptively, so a ticker that
        # already works is never touched a second time), and ONLY when
        # canonicalize_ticker_suffix actually changes something (most
        # tickers have no dot suffix at all). The cache key above still
        # keys on the original `ticker` — the user's own ticker is never
        # rewritten, only the outgoing FMP query is.
        from app.services.company_valuation_service import canonicalize_ticker_suffix
        canonical = canonicalize_ticker_suffix(ticker)
        if canonical != ticker:
            rows, cacheable, _ = _fetch_raw_chunk_once(canonical, start, end)

    if cacheable:
        cache_set(ck, rows, ttl=_TTL_PRICE_SERIES_S)
    return rows


def _date_chunks(start: date, end: date, years: int = _CHUNK_YEARS) -> list[tuple[date, date]]:
    chunks = []
    cur = start
    span = timedelta(days=365 * years)
    while cur <= end:
        nxt = min(cur + span, end)
        chunks.append((cur, nxt))
        cur = nxt + timedelta(days=1)
    return chunks


def fetch_adjusted_price_series(ticker: str, start_date: str, end_date: str) -> dict:
    """Serie real diaria ajustada por splits y dividendos para `ticker` en
    [start_date, end_date] ("YYYY-MM-DD"), obtenida en tantos tramos de
    `_CHUNK_YEARS` como haga falta (nunca uno solo si el rango excede el
    tope real de 5,000 filas por solicitud).

    Valida: precios positivos y finitos (descartados silenciosamente si no
    — nunca propagados), fechas sin duplicados conflictivos (misma fecha,
    precio distinto entre tramos solapados → se conserva el primer valor
    real visto y se reporta como advertencia, nunca se promedia ni se
    inventa), orden cronológico garantizado por construcción.

    Returns {"series": [{"date", "adj_close"}, ...] ascendente,
    "warnings": [...]}. Nunca levanta excepción — una serie vacía es un
    resultado válido (el llamador decide si eso hace la comparación
    'unavailable')."""
    start = datetime.strptime(start_date, "%Y-%m-%d").date()
    end = datetime.strptime(end_date, "%Y-%m-%d").date()
    if start > end:
        return {"series": [], "warnings": ["invalid_range"]}

    by_date: dict[str, float] = {}
    conflicts: list[str] = []
    for c_start, c_end in _date_chunks(start, end):
        rows = _fetch_raw_chunk(ticker, c_start.isoformat(), c_end.isoformat())
        for row in rows:
            d = row.get("date")
            px = row.get("adjClose")
            if not d or isinstance(px, bool) or not isinstance(px, (int, float)):
                continue
            px = float(px)
            if not math.isfinite(px) or px <= 0:
                continue
            if d in by_date and abs(by_date[d] - px) > 1e-6:
                conflicts.append(d)
                continue
            by_date[d] = px

    series = [{"date": d, "adj_close": by_date[d]} for d in sorted(by_date)]
    warnings = [f"conflicting_duplicate_dates:{len(conflicts)}"] if conflicts else []
    return {"series": series, "warnings": warnings}


# ─── Alineación de calendarios ──────────────────────────────────────────────

def align_series(series_map: dict[str, list[dict]], max_forward_fill_days: int = _MAX_FORWARD_FILL_DAYS) -> dict:
    """Construye UN solo calendario compartido (la unión de todas las fechas
    reales vistas en cualquier serie) y, para cada ticker, rellena hacia
    adelante un hueco AISLADO de como máximo `max_forward_fill_days` días de
    negociación reales usando el último cierre real de ESE mismo ticker —
    nunca un promedio entre tickers, nunca una interpolación. Un hueco más
    largo en cualquier punto hace que ese ticker (y por lo tanto toda la
    comparación) quede 'unavailable', con las fechas exactas que no pudo
    cubrir — nunca se descarta en silencio. El primer y el último día de la
    ventana NUNCA se rellenan para ningún ticker: los dos anclas exigen un
    cierre real.

    Ambas curvas (antes/después) comparten SIEMPRE este mismo calendario —
    se construye una sola vez, antes de separar las composiciones."""
    if not series_map:
        return {"ok": False, "reason": "no_series"}

    all_dates = sorted({row["date"] for s in series_map.values() for row in s})
    if not all_dates:
        return {"ok": False, "reason": "no_dates"}

    lookups = {t: {row["date"]: row["adj_close"] for row in s} for t, s in series_map.items()}

    aligned: dict[str, list[float]] = {}
    unavailable: dict[str, list[str]] = {}
    last_idx = len(all_dates) - 1
    for t, lk in lookups.items():
        last_real = None
        gap = 0
        values: list[float | None] = []
        bad_dates: list[str] = []
        for i, d in enumerate(all_dates):
            is_anchor = i == 0 or i == last_idx
            if d in lk:
                values.append(lk[d])
                last_real = lk[d]
                gap = 0
            elif last_real is not None and not is_anchor and gap < max_forward_fill_days:
                values.append(last_real)
                gap += 1
            else:
                values.append(None)
                bad_dates.append(d)
        if bad_dates:
            unavailable[t] = bad_dates
        else:
            aligned[t] = values  # type: ignore[assignment]

    if unavailable:
        return {"ok": False, "reason": "insufficient_coverage", "unavailable": unavailable}

    return {"ok": True, "dates": all_dates, "aligned": aligned}


# ─── Reconstrucción de composiciones normalizadas ───────────────────────────

def build_normalized_index(weights: dict[str, float], dates: list[str], aligned: dict[str, list[float]]) -> list[dict]:
    """Index(t) = 100 × SUM(w_i × P_i(t)/P_i(t0)) — compra y retención, sin
    rebalanceo, pesos fijos en t0 = dates[0]. `weights` debe sumar ~1 (el
    llamador lo garantiza; ver `_weights_sum_to_one`)."""
    t0_prices = {t: aligned[t][0] for t in weights}
    out = []
    for i, d in enumerate(dates):
        value = 100.0 * sum(w * (aligned[t][i] / t0_prices[t]) for t, w in weights.items())
        out.append({"date": d, "value": round(value, 6)})
    return out


def weights_sum_to_one(weights: dict[str, float], tolerance: float = 1e-6) -> bool:
    return bool(weights) and abs(sum(weights.values()) - 1.0) <= tolerance


# ─── Métricas financieras ────────────────────────────────────────────────────

def compute_annualized_volatility(index_values: list[float], trading_days_per_year: int = 252) -> dict:
    """Desviación estándar MUESTRAL (ddof=1) de retornos diarios simples
    sobre la curva normalizada, anualizada × sqrt(252). Nunca una
    probabilidad de pérdida futura — solo una medida de dispersión
    histórica observada."""
    if len(index_values) < _MIN_VOLATILITY_OBSERVATIONS:
        return {"value": None, "reason": "insufficient_observations", "observations": max(0, len(index_values) - 1)}
    returns = [index_values[i] / index_values[i - 1] - 1 for i in range(1, len(index_values))]
    daily_std = statistics.stdev(returns)
    annualized = daily_std * math.sqrt(trading_days_per_year)
    return {
        "value": round(annualized * 100, 4),
        "observations": len(returns),
        "frequency": "daily",
        "annualization_factor": round(math.sqrt(trading_days_per_year), 4),
    }


def compute_max_drawdown(index_values: list[float], dates: list[str]) -> dict:
    """running_peak(t) = max(Index[0..t]); drawdown(t) = Index(t)/running_peak(t) - 1;
    maximum_drawdown = min(drawdown(t)). Es la máxima caída OBSERVADA en el
    periodo analizado, nunca una pérdida máxima posible."""
    if not index_values:
        return {"value": None, "reason": "no_data"}
    peak = index_values[0]
    running_peak_date = dates[0]
    max_dd = 0.0
    peak_date_at_max_dd = dates[0]
    trough_date_at_max_dd = dates[0]
    for v, d in zip(index_values, dates):
        if v > peak:
            peak = v
            running_peak_date = d
        dd = v / peak - 1
        if dd < max_dd:
            max_dd = dd
            peak_date_at_max_dd = running_peak_date
            trough_date_at_max_dd = d
    return {"value": round(max_dd * 100, 4), "peak_date": peak_date_at_max_dd, "trough_date": trough_date_at_max_dd}


# ─── Orquestación con el portafolio real y el escenario hipotético ─────────

def _weights_from_positions(positions: list[dict]) -> dict[str, float]:
    """Pesos exactos ya calculados por combiner.compute_weights (dentro de
    simulate_addition) — solo posiciones verificables con un peso real.
    Usa `_weight_fraction` (precisión completa, Fase 5B.1) en vez de
    `weight_pct` (redondeado a 2 decimales para la UI) — redondear antes
    de construir el índice histórico hacía que Index(t0) saliera en
    99.99/100.01 en vez de exactamente 100. Nunca una segunda
    implementación de este cálculo: `_weight_fraction` y `weight_pct`
    salen de la MISMA división dentro de compute_weights, una se redondea
    para mostrarse, la otra no."""
    return {
        p["ticker"]: p["_weight_fraction"]
        for p in positions
        if p.get("verifiable") and p.get("_weight_fraction") is not None
    }


def _unavailable(reason: str, detail: dict | None = None) -> dict:
    return {"available": False, "reason": reason, "detail": detail or {}}


def compare_composition_history(before_positions: list[dict], after_positions: list[dict], portfolio_currency: str, period: str) -> dict:
    """El punto de entrada. `before_positions`/`after_positions` deben ser
    EXACTAMENTE las listas `positions` de los bloques "before"/"after" que
    combiner.simulate_addition() ya produjo para este mismo escenario — este
    módulo nunca vuelve a calcular pesos, monedas de cotización ni
    clasificaciones de activo.

    MVP: solo acepta escenarios donde la moneda base del portafolio Y la
    moneda de cotización de CADA instrumento involucrado son USD —
    cualquier otro caso devuelve {"available": False, ...} con el motivo
    exacto, nunca una conversión con la tasa de cambio de hoy aplicada al
    pasado. Nunca escribe en Supabase ni modifica `before_positions`/
    `after_positions`."""
    if period not in _PERIOD_YEARS:
        raise HistoricalDataUnavailableError("invalid_period", {"period": period, "valid_periods": sorted(_PERIOD_YEARS)})

    if (portfolio_currency or "").upper() != "USD":
        return _unavailable("non_usd_portfolio_currency", {"portfolio_currency": portfolio_currency})

    weights_before = _weights_from_positions(before_positions)
    weights_after = _weights_from_positions(after_positions)
    if not weights_before or not weights_after:
        return _unavailable("no_verifiable_positions", {})
    if not weights_sum_to_one(weights_before) or not weights_sum_to_one(weights_after):
        # No debería ocurrir con datos reales de combiner — pero una
        # comparación histórica nunca se construye sobre pesos que no
        # describen el 100% de lo verificado.
        return _unavailable("weights_do_not_sum_to_one", {"before_sum": sum(weights_before.values()), "after_sum": sum(weights_after.values())})

    all_tickers = sorted(set(weights_before) | set(weights_after))

    by_ticker: dict[str, dict] = {}
    for p in before_positions + after_positions:
        by_ticker.setdefault(p["ticker"], p)

    non_usd = {t: by_ticker[t].get("quote_currency") for t in all_tickers if (by_ticker[t].get("quote_currency") or "").upper() != "USD"}
    if non_usd:
        return _unavailable("non_usd_instrument", {"tickers": non_usd})

    # "Hoy" se evita como extremo final: a mitad de sesión, adjClose de la
    # API podría reflejar una cotización intradía mezclada con cierres
    # reales. Se pide hasta AYER y el extremo final real queda definido más
    # abajo por la última fecha que la propia serie devuelta realmente
    # tiene — nunca una fecha asumida.
    request_end = date.today() - timedelta(days=1)
    requested_start = request_end - timedelta(days=365 * _PERIOD_YEARS[period])

    series_map: dict[str, list[dict]] = {}
    fetch_warnings: dict[str, list[str]] = {}
    for t in all_tickers:
        fetched = fetch_adjusted_price_series(t, requested_start.isoformat(), request_end.isoformat())
        if not fetched["series"]:
            return _unavailable("no_price_history", {"ticker": t})
        series_map[t] = fetched["series"]
        if fetched["warnings"]:
            fetch_warnings[t] = fetched["warnings"]

    # Si algún instrumento no tiene historial hasta la fecha solicitada, se
    # recorta la ventana entera (ambas curvas, el mismo recorte) a lo que SÍ
    # está disponible para TODOS — nunca un periodo distinto por escenario,
    # nunca se presenta como si fuera el periodo solicitado. Este recorte
    # ocurre ANTES de construir el calendario compartido: si no, la unión de
    # fechas incluiría tramos donde un ticker simplemente no existía aún
    # (p. ej. antes de su IPO), que align_series marcaría como cobertura
    # insuficiente en vez de como "fuera de la ventana común".
    earliest_available = max(series_map[t][0]["date"] for t in all_tickers)
    window_status = "full" if earliest_available <= requested_start.isoformat() else "partial"
    if window_status == "partial":
        series_map = {t: [row for row in s if row["date"] >= earliest_available] for t, s in series_map.items()}

    aligned = align_series(series_map)
    if not aligned["ok"]:
        return _unavailable(aligned["reason"], aligned.get("unavailable", {}))

    dates = aligned["dates"]
    aligned_values = aligned["aligned"]

    if len(dates) < 2:
        return _unavailable("window_too_short", {"observations": len(dates)})

    index_before = build_normalized_index(weights_before, dates, aligned_values)
    index_after = build_normalized_index(weights_after, dates, aligned_values)

    values_before = [row["value"] for row in index_before]
    values_after = [row["value"] for row in index_after]

    return {
        "available": True,
        "period_requested": period,
        "window_status": window_status,
        "start_date": dates[0],
        "end_date": dates[-1],
        "observations": len(dates),
        "weights_before": weights_before,
        "weights_after": weights_after,
        "index_before": index_before,
        "index_after": index_after,
        "volatility_before": compute_annualized_volatility(values_before),
        "volatility_after": compute_annualized_volatility(values_after),
        "max_drawdown_before": compute_max_drawdown(values_before, dates),
        "max_drawdown_after": compute_max_drawdown(values_after, dates),
        "fetch_warnings": fetch_warnings,
        "sources": ["FMP /historical-price-eod/dividend-adjusted (adjClose)"],
        "methodology_es": METHODOLOGY_ES,
        "disclaimer_es": DISCLAIMER_ES,
        "disclaimer_en": DISCLAIMER_EN,
    }
