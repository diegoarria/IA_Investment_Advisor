"""
PEG Diagnostic — Nuvos Fair Value Engine, Block 2.

PEG/PEGY as INTERNAL diagnostics only — never the Fair P/E formula
itself (`fair_pe.py` never divides P/E by growth), and never surfaced in
user-facing copy under any named-investor formula. This computes a
signal that feeds `confidence_engine.py` (is the market's current pricing
reasonable relative to growth?), nothing more.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class PegResult:
    peg: Optional[float]
    band: Optional[str]  # "very_attractive" | "attractive" | "reasonable" | "demanding" | "expensive" | None
    reason: str


@dataclass
class PegyResult:
    pegy: Optional[float]
    reason: str


def compute_peg(forward_pe: Optional[float], expected_eps_growth_pct: Optional[float]) -> PegResult:
    if forward_pe is None or expected_eps_growth_pct is None or expected_eps_growth_pct <= 0:
        return PegResult(peg=None, band=None, reason="P/E forward o crecimiento esperado no disponibles/no positivos — sin diagnóstico PEG.")
    peg = round(forward_pe / expected_eps_growth_pct, 2)
    if peg < 0.75:
        band = "very_attractive"
    elif peg < 1.00:
        band = "attractive"
    elif peg < 1.25:
        band = "reasonable"
    elif peg < 1.50:
        band = "demanding"
    else:
        band = "expensive"
    return PegResult(peg=peg, band=band, reason=f"P/E forward {forward_pe:.1f}x / crecimiento esperado {expected_eps_growth_pct:.1f}% = {peg:.2f}.")


def compute_pegy(pe: Optional[float], expected_eps_growth_pct: Optional[float], dividend_yield_pct: Optional[float]) -> PegyResult:
    """Only computed when there's a real dividend yield — "only where it
    provides genuine analytical value" (spec)."""
    if pe is None or not dividend_yield_pct or dividend_yield_pct <= 0:
        return PegyResult(pegy=None, reason="Sin dividendo real — PEGY no aporta valor analítico aquí.")
    denom = (expected_eps_growth_pct or 0) + dividend_yield_pct
    if denom <= 0:
        return PegyResult(pegy=None, reason="Crecimiento + dividend yield no positivos — sin diagnóstico PEGY.")
    pegy = round(pe / denom, 2)
    return PegyResult(pegy=pegy, reason=f"P/E {pe:.1f}x / (crecimiento {expected_eps_growth_pct or 0:.1f}% + yield {dividend_yield_pct:.1f}%) = {pegy:.2f}.")
