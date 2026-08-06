#!/usr/bin/env python
"""
Fase 1.5, Incremento 6 — Harness de validación del motor de valuación.

Corre AMBOS modelos (legacy _run_dcf vs. driver-based project_driver_based_dcf,
ambos ya calculados en cada request desde los Incrementos 1-5, ver
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md) sobre una
muestra multi-sector real, y produce un reporte comparativo. Esto es un
GATE, no una feature: su output es lo que decide si se procede al
Incremento 7 (flip a producción) — el criterio de éxito NO es "el modelo
nuevo replica al viejo", es mayor coherencia financiera, menos valoraciones
extremas, y una distribución de márgenes de seguridad más razonable
(decisión #4 del plan, confirmada por Diego).

Uso:
    venv/bin/python scripts/validate_valuation_engine.py
    venv/bin/python scripts/validate_valuation_engine.py --tickers AAPL,MSFT,KO
    venv/bin/python scripts/validate_valuation_engine.py --limit 20
    venv/bin/python scripts/validate_valuation_engine.py --output report.json

Requiere acceso real a los proveedores de datos financieros (FMP/Finnhub) —
no puede correr en un entorno sin red/API keys. Cada ticker es una llamada
de red real (varios segundos); una corrida completa sobre el universo
(~163 tickers no-ETF) puede tardar 15-30+ minutos.

Universo de validación: screener.UNIVERSE (173 entradas) EXCLUYENDO las 10
entradas de sector "ETF" (no son empresas — un DCF no aplica). Los REITs
(sector "Real Estate" cuyo `finnhubIndustry` matchea "reit") ya devuelven
`dcf=None` de ambos modelos (dcf_engine.is_reit_sector los excluye por
diseño — ver ese módulo) — se reportan aparte como "N/A (REIT/sin DCF)",
nunca como fallo.

Limitación honesta: este harness compara los dos modelos en UN solo punto
en el tiempo. "Estabilidad trimestre a trimestre" (uno de los 5 criterios
de la decisión #4) no es medible en una sola corrida — requeriría correr
este mismo script repetidamente a lo largo de varios trimestres reales y
comparar la varianza de cada modelo entre corridas. Documentado aquí en vez
de fingir una métrica que esta corrida no puede producir.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.api.routes.screener import UNIVERSE  # noqa: E402
from app.services.fundamental_analysis_service import get_fundamental_analysis  # noqa: E402
from app.services.valuation.dcf_engine import is_reit_sector  # noqa: E402

# A margin of safety beyond this magnitude is treated as "extreme" — the
# same order of magnitude the audit flagged as the real problem with the
# legacy model's moat adjustment (55-67% MoS on TSM/Adobe/Intuit before it
# was removed). Not a hard cutoff anywhere in the app, purely a reporting
# threshold for this harness.
_EXTREME_MOS_THRESHOLD_PCT = 50.0

_REQUEST_DELAY_SECONDS = 1.0  # be polite to the real data providers


@dataclass
class TickerResult:
    ticker: str
    sector: Optional[str]
    is_reit: bool
    legacy_mos_pct: Optional[float]
    driver_based_mos_pct: Optional[float]
    legacy_value_per_share: Optional[float]
    driver_based_value_per_share: Optional[float]
    price: Optional[float]
    error: Optional[str] = None


def _driver_based_mos_pct(driver_based_valuation: Optional[dict], price: Optional[float]) -> Optional[float]:
    if not driver_based_valuation or not price:
        return None
    vps = driver_based_valuation.get("value_per_share")
    if vps is None or vps <= 0:
        return None
    return round((vps - price) / vps * 100, 1)


def evaluate_ticker(ticker: str, sector: Optional[str]) -> TickerResult:
    try:
        data = get_fundamental_analysis(ticker)
    except Exception as e:
        return TickerResult(
            ticker=ticker, sector=sector, is_reit=False,
            legacy_mos_pct=None, driver_based_mos_pct=None,
            legacy_value_per_share=None, driver_based_value_per_share=None,
            price=None, error=f"get_fundamental_analysis raised: {e}",
        )

    if not data:
        return TickerResult(
            ticker=ticker, sector=sector, is_reit=False,
            legacy_mos_pct=None, driver_based_mos_pct=None,
            legacy_value_per_share=None, driver_based_value_per_share=None,
            price=None, error="get_fundamental_analysis returned None (insufficient real data)",
        )

    price = data.get("current_price")
    dcf = data.get("dcf")
    reit = is_reit_sector(sector)

    if dcf is None:
        return TickerResult(
            ticker=ticker, sector=sector, is_reit=reit,
            legacy_mos_pct=None, driver_based_mos_pct=None,
            legacy_value_per_share=None, driver_based_value_per_share=None,
            price=price,
            error=None if reit else "dcf is None (financial sector, or DCF-disqualifying data gap)",
        )

    legacy_mos = dcf.get("margin_of_safety_pct")
    legacy_vps = (dcf.get("scenarios") or {}).get("base", {}).get("intrinsic_value_per_share")
    dbv = dcf.get("driver_based_valuation")
    driver_vps = dbv.get("value_per_share") if dbv else None
    driver_mos = _driver_based_mos_pct(dbv, price)

    return TickerResult(
        ticker=ticker, sector=sector, is_reit=reit,
        legacy_mos_pct=legacy_mos, driver_based_mos_pct=driver_mos,
        legacy_value_per_share=legacy_vps, driver_based_value_per_share=driver_vps,
        price=price,
    )


def _distribution_stats(values: list[float]) -> dict:
    if not values:
        return {"n": 0, "mean": None, "median": None, "stdev": None, "min": None, "max": None}
    return {
        "n": len(values),
        "mean": round(statistics.mean(values), 1),
        "median": round(statistics.median(values), 1),
        "stdev": round(statistics.pstdev(values), 1) if len(values) > 1 else 0.0,
        "min": round(min(values), 1),
        "max": round(max(values), 1),
    }


def build_report(results: list[TickerResult]) -> dict:
    non_reit = [r for r in results if not r.is_reit]
    reit = [r for r in results if r.is_reit]
    errored = [r for r in non_reit if r.error]
    both_computed = [r for r in non_reit if r.legacy_mos_pct is not None and r.driver_based_mos_pct is not None]

    legacy_values = [r.legacy_mos_pct for r in both_computed]
    driver_values = [r.driver_based_mos_pct for r in both_computed]

    legacy_extreme = [r.ticker for r in both_computed if abs(r.legacy_mos_pct) > _EXTREME_MOS_THRESHOLD_PCT]
    driver_extreme = [r.ticker for r in both_computed if abs(r.driver_based_mos_pct) > _EXTREME_MOS_THRESHOLD_PCT]

    deltas = [round(r.driver_based_mos_pct - r.legacy_mos_pct, 1) for r in both_computed]
    largest_deltas = sorted(both_computed, key=lambda r: abs(r.driver_based_mos_pct - r.legacy_mos_pct), reverse=True)[:10]

    return {
        "universe_size": len(results),
        "reit_excluded": len(reit),
        "errored_or_no_dcf": len(errored),
        "both_models_computed": len(both_computed),
        "legacy_mos_distribution": _distribution_stats(legacy_values),
        "driver_based_mos_distribution": _distribution_stats(driver_values),
        "legacy_extreme_count": len(legacy_extreme),
        "legacy_extreme_tickers": legacy_extreme,
        "driver_based_extreme_count": len(driver_extreme),
        "driver_based_extreme_tickers": driver_extreme,
        "mos_delta_distribution": _distribution_stats(deltas) if deltas else _distribution_stats([]),
        "largest_delta_tickers": [
            {
                "ticker": r.ticker, "sector": r.sector,
                "legacy_mos_pct": r.legacy_mos_pct, "driver_based_mos_pct": r.driver_based_mos_pct,
                "delta_pct": round(r.driver_based_mos_pct - r.legacy_mos_pct, 1),
            }
            for r in largest_deltas
        ],
        "errors": [{"ticker": r.ticker, "error": r.error} for r in errored],
    }


def print_report(report: dict) -> None:
    print("\n" + "=" * 78)
    print("REPORTE DE VALIDACIÓN — Fase 1.5, Incremento 6")
    print("Legacy (_run_dcf) vs. Driver-based (project_driver_based_dcf)")
    print("=" * 78)
    print(f"Universo evaluado: {report['universe_size']} tickers")
    print(f"  REITs excluidos (sin DCF por diseño): {report['reit_excluded']}")
    print(f"  Errores / sin DCF computable: {report['errored_or_no_dcf']}")
    print(f"  Ambos modelos computados: {report['both_models_computed']}")
    print()
    print("Distribución de Margen de Seguridad — LEGACY:")
    print(f"  {report['legacy_mos_distribution']}")
    print("Distribución de Margen de Seguridad — DRIVER-BASED:")
    print(f"  {report['driver_based_mos_distribution']}")
    print()
    print(f"Valoraciones extremas (|MoS| > {_EXTREME_MOS_THRESHOLD_PCT}%):")
    print(f"  Legacy: {report['legacy_extreme_count']} — {report['legacy_extreme_tickers']}")
    print(f"  Driver-based: {report['driver_based_extreme_count']} — {report['driver_based_extreme_tickers']}")
    print()
    print("Distribución del delta (driver_based - legacy) en puntos de MoS:")
    print(f"  {report['mos_delta_distribution']}")
    print()
    print("Top 10 mayores diferencias:")
    for row in report["largest_delta_tickers"]:
        print(f"  {row['ticker']:6s} ({row['sector']}): legacy={row['legacy_mos_pct']}%  driver_based={row['driver_based_mos_pct']}%  delta={row['delta_pct']}pp")
    if report["errors"]:
        print(f"\n{len(report['errors'])} tickers con error o sin DCF computable:")
        for e in report["errors"][:20]:
            print(f"  {e['ticker']}: {e['error']}")
    print("\nNOTA: 'estabilidad trimestre a trimestre' (criterio de la decisión #4)")
    print("no es medible en una sola corrida — requiere repetir este harness a lo")
    print("largo de varios trimestres reales y comparar la varianza entre corridas.")
    print("=" * 78 + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tickers", type=str, default=None, help="Comma-separated tickers to override the universe")
    parser.add_argument("--limit", type=int, default=None, help="Cap the number of tickers evaluated")
    parser.add_argument("--output", type=str, default=None, help="Write the full JSON report to this path")
    args = parser.parse_args()

    if args.tickers:
        entries = [{"ticker": t.strip().upper(), "sector": None} for t in args.tickers.split(",") if t.strip()]
    else:
        entries = [e for e in UNIVERSE if e["sector"] != "ETF"]

    if args.limit:
        entries = entries[: args.limit]

    print(f"Evaluando {len(entries)} tickers (universo real, requiere red)...")
    results: list[TickerResult] = []
    for i, entry in enumerate(entries, start=1):
        ticker = entry["ticker"]
        print(f"[{i}/{len(entries)}] {ticker}...", end=" ", flush=True)
        result = evaluate_ticker(ticker, entry.get("sector"))
        results.append(result)
        status = "OK" if not result.error else f"SKIP ({result.error})"
        print(status)
        time.sleep(_REQUEST_DELAY_SECONDS)

    report = build_report(results)
    print_report(report)

    if args.output:
        full_output = {"report": report, "raw_results": [asdict(r) for r in results]}
        Path(args.output).write_text(json.dumps(full_output, indent=2))
        print(f"Reporte completo escrito en {args.output}")


if __name__ == "__main__":
    main()
