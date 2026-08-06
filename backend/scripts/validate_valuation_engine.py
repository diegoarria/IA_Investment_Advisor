#!/usr/bin/env python
"""
Harness de validación del motor de valuación — Fase 1.5, Incremento 6;
extendido a 3 bandas (legacy / driver-based-Gordon / Nuvos exit-multiple)
en el rediseño Nuvos AI Fair Value Engine, Incremento 7 (ver
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Corre TRES modelos — legacy `_run_dcf`, driver-based `project_driver_based_
dcf` con Gordon growth, y el nuevo motor `nuvos_fair_value` (Bear/Base/Bull,
terminal value por múltiplo de salida) — sobre una muestra multi-sector
real, y produce un reporte comparativo. Esto es un GATE, no una feature: su
output es lo que decide si se procede al Incremento 11 (el flip) — el
criterio de éxito NO es "el modelo nuevo replica al viejo", es mayor
coherencia financiera, menos valoraciones extremas, una distribución de
márgenes de seguridad más razonable, Y (nuevo en este incremento) que la
mayoría de los anchors del múltiplo de salida sean reales (no el fallback
de tabla sectorial) — decisión #4 del plan original, extendida por la
sección "Mayor riesgo de secuenciación" de este plan.

Uso:
    venv/bin/python scripts/validate_valuation_engine.py
    venv/bin/python scripts/validate_valuation_engine.py --tickers AAPL,MSFT,KO
    venv/bin/python scripts/validate_valuation_engine.py --limit 20
    venv/bin/python scripts/validate_valuation_engine.py --per-sector-limit 4
    venv/bin/python scripts/validate_valuation_engine.py --output report.json

Requiere acceso real a los proveedores de datos financieros (FMP/Finnhub) —
no puede correr en un entorno sin red/API keys.

COSTO REAL, Incremento 7 — esta corrida ahora pasa `_compute_peer_dependent_
data=True` (antes `False`): nuvos_fair_value necesita relative_valuation/
historical_valuation/industry_benchmarks reales para derivar un ancla real
del múltiplo de salida (si no, cada ticker cae al fallback de tabla
sectorial, y el harness estaría validando la tabla estática, no el motor
real). Un smoke test con red real (Incremento 6) midió ~70-95s POR TICKER
con esos datos activados — sobre las ~163 entradas no-ETF del universo
completo, una corrida completa tomaría 3-4+ HORAS, impráctico para este
gate. `--per-sector-limit N` (nuevo) toma como máximo N tickers por sector
del universo real (UNIVERSE está agrupado por sector, así que `--limit N`
por sí solo NO da diversidad multi-sector para N chico) — usar esto para
una corrida representativa y práctica antes de comprometerse a la corrida
completa (ver "Mayor riesgo de secuenciación" del plan: correr sobre 6-10
tickers primero y verificar que exit_multiple_anchor_source sea real en la
mayoría, antes de gastar una corrida larga).

Universo de validación: screener.UNIVERSE (173 entradas) EXCLUYENDO las 10
entradas de sector "ETF" (no son empresas — un DCF no aplica). Los REITs
(sector "Real Estate" cuyo `finnhubIndustry` matchea "reit") ya devuelven
`dcf=None` de los tres modelos (dcf_engine.is_reit_sector los excluye por
diseño — ver ese módulo) — se reportan aparte como "N/A (REIT/sin DCF)",
nunca como fallo. Financieras (Justified P-B) también quedan fuera de
nuvos_fair_value por construcción (decisión #5) aunque sí tienen legacy_mos.

Limitación honesta: este harness compara los modelos en UN solo punto en el
tiempo. "Estabilidad trimestre a trimestre" (uno de los 5 criterios de la
decisión #4) no es medible en una sola corrida — requeriría correr este
mismo script repetidamente a lo largo de varios trimestres reales y
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

# Real root cause of this harness's first two "broken" runs, found the hard
# way (Fase 1.5, Incremento 7): FMP_API_KEY/FINNHUB_API_KEY are read via raw
# os.getenv() throughout financial_data_service.py/finnhub.py/market_data_
# service.py — pydantic-settings' own .env parsing (app.core.config.Settings)
# does NOT mutate os.environ as a side effect, so those calls silently saw
# empty keys and every ticker failed with "insufficient real data," which
# LOOKED LIKE a Finnhub rate-limit/burst problem but wasn't. main.py has this
# exact same gap — worth fixing there too, flagged separately, not bundled
# into this one-off validation script.
from dotenv import load_dotenv  # noqa: E402
load_dotenv()

from app.api.routes.screener import UNIVERSE  # noqa: E402
from app.services.fundamental_analysis_service import get_fundamental_analysis  # noqa: E402
from app.services.valuation.dcf_engine import is_reit_sector  # noqa: E402

# A margin of safety beyond this magnitude is treated as "extreme" — the
# same order of magnitude the audit flagged as the real problem with the
# legacy model's moat adjustment (55-67% MoS on TSM/Adobe/Intuit before it
# was removed). Not a hard cutoff anywhere in the app, purely a reporting
# threshold for this harness.
_EXTREME_MOS_THRESHOLD_PCT = 50.0

# Fase 1.5, Incremento 7 — real run found this too low: get_fundamental_
# analysis makes ~5 real Finnhub calls per ticker (quote, profile, metrics,
# recommendation, price target, via check_liquidity_gate + the analyst-
# target block), and app/core/finnhub.py has no retry/backoff on 429 — a
# 1s delay blew through a free-tier ~60 req/min budget almost immediately,
# producing a run where nearly every ticker after the first few silently
# came back None (all Finnhub calls 429ing). 7s keeps sustained throughput
# safely under that ceiling (~5 calls / 7s ≈ 43/min).
#
# Nuvos AI Fair Value Engine redesign, Incremento 7 — lowered back down.
# With `_compute_peer_dependent_data=True` (needed now, see module
# docstring), each ticker's OWN peer-fetching (~10 sequential peer
# analyses) already takes ~70-95s on its own real-network smoke test —
# that per-ticker cost now dwarfs the original Finnhub-pacing concern this
# constant existed for, so a large fixed inter-ticker delay on top of it
# would only stretch an already-long run further for no real benefit.
_REQUEST_DELAY_SECONDS = 2.0


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
    # Nuvos AI Fair Value Engine redesign, Incremento 7 — the third band.
    nuvos_bear_mos_pct: Optional[float] = None
    nuvos_base_mos_pct: Optional[float] = None
    nuvos_bull_mos_pct: Optional[float] = None
    exit_metric: Optional[str] = None
    exit_multiple_anchor_source: Optional[str] = None
    gordon_sanity_check_ratio: Optional[float] = None
    error: Optional[str] = None


def _driver_based_mos_pct(driver_based_valuation: Optional[dict], price: Optional[float]) -> Optional[float]:
    if not driver_based_valuation or not price:
        return None
    vps = driver_based_valuation.get("value_per_share")
    if vps is None or vps <= 0:
        return None
    return round((vps - price) / vps * 100, 1)


def _scenario_mos_pct(scenario: Optional[dict], price: Optional[float]) -> Optional[float]:
    if not scenario or not price:
        return None
    vps = scenario.get("fair_value_per_share")
    if vps is None or vps <= 0:
        return None
    return round((vps - price) / vps * 100, 1)


def evaluate_ticker(ticker: str, sector: Optional[str]) -> TickerResult:
    try:
        # _compute_peer_dependent_data=True (Nuvos AI Fair Value Engine
        # redesign, Incremento 7 — was `_compute_consensus=False` under the
        # old name, and stayed False through Fase 1.5's own Incremento 6/7
        # since Consensus's peer fetches weren't needed for THAT
        # comparison). Now REQUIRED: nuvos_fair_value's exit multiple needs
        # real relative_valuation/historical_valuation/industry_benchmarks
        # to avoid falling back to the sector-table anchor for every
        # ticker, which would validate the fallback table instead of the
        # real engine. See this module's docstring for the real cost this
        # adds and `--per-sector-limit` as the practical mitigation.
        data = get_fundamental_analysis(ticker, _compute_peer_dependent_data=True)
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

    nuvos = dcf.get("nuvos_fair_value") or {}
    nuvos_scenarios = nuvos.get("scenarios") or {}
    base_assumptions = (nuvos_scenarios.get("base") or {}).get("assumptions") or {}

    return TickerResult(
        ticker=ticker, sector=sector, is_reit=reit,
        legacy_mos_pct=legacy_mos, driver_based_mos_pct=driver_mos,
        legacy_value_per_share=legacy_vps, driver_based_value_per_share=driver_vps,
        price=price,
        nuvos_bear_mos_pct=_scenario_mos_pct(nuvos_scenarios.get("bear"), price),
        nuvos_base_mos_pct=_scenario_mos_pct(nuvos_scenarios.get("base"), price),
        nuvos_bull_mos_pct=_scenario_mos_pct(nuvos_scenarios.get("bull"), price),
        exit_metric=nuvos.get("exit_metric"),
        exit_multiple_anchor_source=nuvos.get("exit_multiple_anchor_source"),
        gordon_sanity_check_ratio=base_assumptions.get("gordon_sanity_check_ratio"),
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
    nuvos_computed = [r for r in non_reit if r.nuvos_base_mos_pct is not None]

    legacy_values = [r.legacy_mos_pct for r in both_computed]
    driver_values = [r.driver_based_mos_pct for r in both_computed]
    nuvos_base_values = [r.nuvos_base_mos_pct for r in nuvos_computed]
    nuvos_bear_values = [r.nuvos_bear_mos_pct for r in nuvos_computed if r.nuvos_bear_mos_pct is not None]
    nuvos_bull_values = [r.nuvos_bull_mos_pct for r in nuvos_computed if r.nuvos_bull_mos_pct is not None]

    legacy_extreme = [r.ticker for r in both_computed if abs(r.legacy_mos_pct) > _EXTREME_MOS_THRESHOLD_PCT]
    driver_extreme = [r.ticker for r in both_computed if abs(r.driver_based_mos_pct) > _EXTREME_MOS_THRESHOLD_PCT]
    nuvos_extreme = [r.ticker for r in nuvos_computed if abs(r.nuvos_base_mos_pct) > _EXTREME_MOS_THRESHOLD_PCT]

    deltas = [round(r.driver_based_mos_pct - r.legacy_mos_pct, 1) for r in both_computed]
    largest_deltas = sorted(both_computed, key=lambda r: abs(r.driver_based_mos_pct - r.legacy_mos_pct), reverse=True)[:10]

    # Bear<->Bull spread — how wide a range the new engine actually shows,
    # a real (if imperfect) proxy for "coherence" per decision #4: a
    # perpetually-tiny spread would mean the 3 scenarios aren't saying
    # anything different; a huge one would mean the deltas/caps need
    # recalibrating (Incremento 5).
    bear_bull_spreads = [
        round(r.nuvos_bull_mos_pct - r.nuvos_bear_mos_pct, 1)
        for r in nuvos_computed
        if r.nuvos_bear_mos_pct is not None and r.nuvos_bull_mos_pct is not None
    ]

    anchor_sources = [r.exit_multiple_anchor_source for r in nuvos_computed if r.exit_multiple_anchor_source]
    anchor_source_counts = {
        source: anchor_sources.count(source)
        for source in ("own_historical", "peer_median", "sector_table_fallback")
    }
    real_anchor_pct = (
        round((anchor_source_counts["own_historical"] + anchor_source_counts["peer_median"]) / len(anchor_sources) * 100, 1)
        if anchor_sources else None
    )

    gordon_ratios = [r.gordon_sanity_check_ratio for r in nuvos_computed if r.gordon_sanity_check_ratio is not None]
    # Same "in a healthy band" judgment call as _EXTREME_MOS_THRESHOLD_PCT
    # below — a ratio far from 1.0 means the exit-multiple and Gordon-
    # growth terminal values are telling genuinely different stories for
    # that ticker, worth a second look rather than a hard failure.
    gordon_out_of_band = [
        r.ticker for r in nuvos_computed
        if r.gordon_sanity_check_ratio is not None and not (0.4 <= r.gordon_sanity_check_ratio <= 2.5)
    ]

    return {
        "universe_size": len(results),
        "reit_excluded": len(reit),
        "errored_or_no_dcf": len(errored),
        "both_models_computed": len(both_computed),
        "nuvos_computed": len(nuvos_computed),
        "legacy_mos_distribution": _distribution_stats(legacy_values),
        "driver_based_mos_distribution": _distribution_stats(driver_values),
        "nuvos_base_mos_distribution": _distribution_stats(nuvos_base_values),
        "nuvos_bear_mos_distribution": _distribution_stats(nuvos_bear_values),
        "nuvos_bull_mos_distribution": _distribution_stats(nuvos_bull_values),
        "legacy_extreme_count": len(legacy_extreme),
        "legacy_extreme_tickers": legacy_extreme,
        "driver_based_extreme_count": len(driver_extreme),
        "driver_based_extreme_tickers": driver_extreme,
        "nuvos_extreme_count": len(nuvos_extreme),
        "nuvos_extreme_tickers": nuvos_extreme,
        "mos_delta_distribution": _distribution_stats(deltas) if deltas else _distribution_stats([]),
        "bear_bull_spread_distribution": _distribution_stats(bear_bull_spreads),
        "exit_multiple_anchor_source_counts": anchor_source_counts,
        "exit_multiple_real_anchor_pct": real_anchor_pct,
        "gordon_sanity_check_ratio_distribution": _distribution_stats(gordon_ratios),
        "gordon_out_of_band_count": len(gordon_out_of_band),
        "gordon_out_of_band_tickers": gordon_out_of_band,
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
    print("REPORTE DE VALIDACIÓN — Nuvos AI Fair Value Engine, Incremento 7")
    print("Legacy (_run_dcf) vs. Driver-based (Gordon) vs. Nuvos (exit multiple)")
    print("=" * 78)
    print(f"Universo evaluado: {report['universe_size']} tickers")
    print(f"  REITs excluidos (sin DCF por diseño): {report['reit_excluded']}")
    print(f"  Errores / sin DCF computable: {report['errored_or_no_dcf']}")
    print(f"  Legacy + driver-based computados: {report['both_models_computed']}")
    print(f"  Nuvos fair value computado: {report['nuvos_computed']}")
    print()
    print("Distribución de Margen de Seguridad — LEGACY:")
    print(f"  {report['legacy_mos_distribution']}")
    print("Distribución de Margen de Seguridad — DRIVER-BASED (Gordon):")
    print(f"  {report['driver_based_mos_distribution']}")
    print("Distribución de Margen de Seguridad — NUVOS (base, exit multiple):")
    print(f"  {report['nuvos_base_mos_distribution']}")
    print("Distribución de Margen de Seguridad — NUVOS bear:")
    print(f"  {report['nuvos_bear_mos_distribution']}")
    print("Distribución de Margen de Seguridad — NUVOS bull:")
    print(f"  {report['nuvos_bull_mos_distribution']}")
    print()
    print(f"Valoraciones extremas (|MoS| > {_EXTREME_MOS_THRESHOLD_PCT}%):")
    print(f"  Legacy: {report['legacy_extreme_count']} — {report['legacy_extreme_tickers']}")
    print(f"  Driver-based: {report['driver_based_extreme_count']} — {report['driver_based_extreme_tickers']}")
    print(f"  Nuvos (base): {report['nuvos_extreme_count']} — {report['nuvos_extreme_tickers']}")
    print()
    print("Distribución del delta (driver_based - legacy) en puntos de MoS:")
    print(f"  {report['mos_delta_distribution']}")
    print()
    print("Distribución del spread Bear<->Bull (puntos de MoS) — Nuvos:")
    print(f"  {report['bear_bull_spread_distribution']}")
    print()
    print("Ancla del exit multiple (real vs. fallback de tabla sectorial):")
    print(f"  {report['exit_multiple_anchor_source_counts']}")
    print(f"  % con ancla real (own_historical o peer_median): {report['exit_multiple_real_anchor_pct']}%")
    print()
    print("Sanity check Gordon vs. exit multiple (ratio terminal_value / gordon_terminal_value):")
    print(f"  {report['gordon_sanity_check_ratio_distribution']}")
    print(f"  Fuera de banda [0.4, 2.5]: {report['gordon_out_of_band_count']} — {report['gordon_out_of_band_tickers']}")
    print()
    print("Top 10 mayores diferencias (driver_based vs. legacy):")
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
    parser.add_argument(
        "--per-sector-limit", type=int, default=None,
        help="Take at most N tickers per real sector (UNIVERSE is sector-grouped, so plain --limit isn't "
             "multi-sector for small N) — a practical, still-representative sample given the real per-ticker "
             "cost of _compute_peer_dependent_data=True (see module docstring).",
    )
    parser.add_argument("--output", type=str, default=None, help="Write the full JSON report to this path")
    args = parser.parse_args()

    if args.tickers:
        entries = [{"ticker": t.strip().upper(), "sector": None} for t in args.tickers.split(",") if t.strip()]
    else:
        entries = [e for e in UNIVERSE if e["sector"] != "ETF"]

    if args.per_sector_limit:
        seen_per_sector: dict[Optional[str], int] = {}
        sampled = []
        for e in entries:
            s = e.get("sector")
            if seen_per_sector.get(s, 0) < args.per_sector_limit:
                sampled.append(e)
                seen_per_sector[s] = seen_per_sector.get(s, 0) + 1
        entries = sampled

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
