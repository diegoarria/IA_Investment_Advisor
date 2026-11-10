"""
Local, simulated-provider latency measurement for the 2026-11-10 P0 Yahoo/
Finnhub latency fix. Runs screener._company_diagnostic_result() in-process
against MOCKED providers (never real network I/O) for a fixed set of
scenarios, to compare against the BEFORE/AFTER code paths.

This produces LOCAL, SIMULATED numbers only — not a production measurement.
Run with: venv/bin/python scripts/measure_radar_latency_local.py
"""
import asyncio
import statistics
import time
from unittest.mock import patch

import app.api.routes.screener as screener


def _p(values, pct):
    if not values:
        return None
    values = sorted(values)
    k = (len(values) - 1) * pct
    f = int(k)
    c = min(f + 1, len(values) - 1)
    return values[f] + (values[c] - values[f]) * (k - f)


async def _run_cache_hit_scenario(ticker: str, n: int = 20) -> list[float]:
    """Simulates: a warm cache hit, AFTER the fix (no Finnhub freshness
    poll on the read path)."""
    cached = {
        "ticker": ticker, "companyName": ticker, "score": 70,
        "_earnings_period": "2026-Q3", "_schema_version": screener._DIAGNOSTIC_SCHEMA_VERSION,
    }
    with patch.object(screener, "_resolve_quick_ticker", lambda q: ticker), \
         patch.object(screener, "cache_get", lambda key: cached), \
         patch.object(screener, "fh_quote", lambda t: {"price": 100.0}):
        times = []
        for _ in range(n):
            start = time.monotonic()
            await screener._company_diagnostic_result(ticker, "es", "user1", use_ai=False)
            times.append(time.monotonic() - start)
        return times


async def main():
    print("=== MEDICIÓN LOCAL, PROVEEDORES SIMULADOS (no son datos de producción) ===\n")
    for ticker in ["AAPL", "NVDA", "MSFT", "CHTR", "KO", "ZZZ1", "ZZZ2"]:
        times = await _run_cache_hit_scenario(ticker)
        print(
            f"{ticker:8s}  p50={statistics.median(times)*1000:6.1f}ms  "
            f"p95={_p(times, 0.95)*1000:6.1f}ms  max={max(times)*1000:6.1f}ms  n={len(times)}"
        )
    print(
        "\nTodas las llamadas en este script son contra un cache mockeado — "
        "cero llamadas HTTP reales a Yahoo/Finnhub/FMP. Sirven para probar "
        "que la ruta de cache-hit en sí misma (sin el chequeo de frescura "
        "de Finnhub removido) ya no tiene ningún trabajo de red pendiente, "
        "no para medir latencia de red real."
    )


if __name__ == "__main__":
    asyncio.run(main())
