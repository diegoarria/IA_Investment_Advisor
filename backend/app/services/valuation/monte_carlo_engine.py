"""
Monte Carlo Engine — probabilistic valuation via simulation.

Context: Fase 1, Incremento 3 of the Nuvos AI valuation redesign (see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md — Parte B).
Every other engine in this package computes ONE number (or a small fixed
set: pessimistic/base/optimistic). This one asks a different question:
given real uncertainty in each input, what's the actual DISTRIBUTION of
plausible intrinsic values, and how much of that distribution sits above
today's price?

Reuses `valuation.dcf_engine.project_driver_based_dcf` as the underlying
valuation function for every single simulated draw — this module owns NO
DCF math of its own, only the sampling and aggregation around it. That
means every simulated draw benefits from the same Gordon-growth stability
guard, terminal-ROIC consistency, etc. the driver-based engine already
enforces; an economically-impossible draw (e.g. a sampled discount rate
that lands below the sampled terminal growth) is simply discarded rather
than silently producing a nonsensical value.

Design notes:

1. Distributions are NORMAL (Gaussian), each defined by (mean, stdev, lo,
   hi) — mean is the company's own real anchor estimate (the same one the
   deterministic DCF uses), stdev should come from the company's own real
   historical volatility (see `build_distribution_from_trend`), and (lo,
   hi) clamp every draw to an economically sane range (e.g. discount rate
   can never be sampled negative). A normal distribution was chosen over
   something more exotic (lognormal, triangular) because every clamped
   input here is itself a bounded RATE (a growth rate, a margin, a
   discount rate) — a normal distribution truncated to sane bounds is the
   standard, defensible choice for this class of input, not an arbitrary
   pick.

2. Inputs are sampled INDEPENDENTLY. Real inputs are correlated in
   practice (a company posting unusually high growth often needs more
   reinvestment, not less) — modeling that correlation properly would
   require a real covariance matrix estimated from a cross-company panel,
   which is out of scope for Fase 1 (see the plan's "fuera de alcance").
   This is a genuine, disclosed simplification, not a hidden one: every
   result this module returns should be labeled as assuming independence.

3. A draw that fails `project_driver_based_dcf`'s own guards
   (UnstableGordonGrowthError when the sampled r/gt combination is
   unstable, or ValueError for a non-positive sampled terminal ROIC) is
   discarded, not retried or clamped further — this is real information
   ("this combination of assumptions has no valid DCF solution"), and
   forcing a number out of it would be exactly the "generar resultados
   incorrectos" the brief prohibits. `MonteCarloResult.n_discarded` makes
   this visible rather than silently shrinking the sample.
"""

from __future__ import annotations

import random
import statistics
from dataclasses import dataclass
from typing import Optional

from app.services.valuation.dcf_engine import project_driver_based_dcf
from app.services.valuation.robustness import UnstableGordonGrowthError, clamp

_DEFAULT_SIMULATIONS = 2000

# Floors on sampled stdev so a company with an unusually FLAT historical
# trend (e.g. only 3 years of nearly-identical margins) still gets a
# non-degenerate simulation — a zero-variance "distribution" would just
# reproduce the deterministic DCF n times, which defeats the purpose of
# running a simulation at all. These are minimum REALISM floors, not the
# primary signal — the primary signal is always the company's own real
# historical stdev when there's enough data to measure it meaningfully.
_MIN_STDEV_FLOORS = {
    "revenue_growth_1": 0.02,
    "operating_margin": 0.02,
    "discount_rate": 0.01,
    "terminal_growth": 0.003,
    "reinvestment_rate": 0.05,
    "shares_out_pct": 0.01,
}


@dataclass
class DistributionInput:
    """One sampled input's Normal(mean, stdev) distribution, truncated to
    [lo, hi]. `mean` should be the same real anchor value the deterministic
    DCF uses for this input — the simulation is a distribution AROUND the
    real estimate, not a replacement for it."""
    mean: float
    stdev: float
    lo: float
    hi: float

    def sample(self, rng: random.Random) -> float:
        return clamp(rng.gauss(self.mean, self.stdev), self.lo, self.hi)


@dataclass
class MonteCarloAssumptions:
    """The 6 inputs the brief calls out (Revenue Growth, Operating Margin,
    Discount Rate, Terminal Growth, Reinvestment Rate, Share Count) as
    distributions, plus the inputs held fixed for every draw (tax rate,
    terminal ROIC, net cash, base revenue) — these last four aren't listed
    as variables in the brief, and treating them as fixed keeps the
    simulation's degrees of freedom matched exactly to what was asked."""
    revenue_growth_1: DistributionInput
    operating_margin: DistributionInput
    discount_rate: DistributionInput
    terminal_growth: DistributionInput
    reinvestment_rate: DistributionInput
    shares_out: DistributionInput
    tax_rate: float
    terminal_roic_pct: float
    net_cash: float
    revenue_0: float
    years: int = 10
    # Fase 1.5, Incremento 2 — the three-stage growth plateau
    # (dcf_engine.project_driver_based_dcf's high_growth_years) is held
    # FIXED across every draw, never sampled: it's a structural modeling
    # choice (how many years growth stays flat before decelerating), not a
    # measured quantity with a real historical distribution the way
    # revenue growth or margin are — sampling it would add a dimension of
    # "noise" with no real variance to anchor it to.
    high_growth_years: int = 0


@dataclass
class MonteCarloResult:
    n_simulations: int
    n_valid: int
    n_discarded: int
    min: Optional[float]
    p10: Optional[float]
    p25: Optional[float]
    median: Optional[float]
    p75: Optional[float]
    p90: Optional[float]
    max: Optional[float]
    probability_undervalued_pct: Optional[float]
    current_price: Optional[float]


def _percentile(sorted_values: list[float], pct: float) -> float:
    """Linear-interpolation percentile (the standard "inclusive" method) —
    equivalent to numpy's default `np.percentile`, implemented directly
    over the stdlib to avoid adding a numpy dependency for one function."""
    if len(sorted_values) == 1:
        return sorted_values[0]
    k = (len(sorted_values) - 1) * pct
    f = int(k)
    c = min(f + 1, len(sorted_values) - 1)
    if f == c:
        return sorted_values[f]
    return sorted_values[f] + (sorted_values[c] - sorted_values[f]) * (k - f)


def run_monte_carlo_dcf(
    assumptions: MonteCarloAssumptions,
    current_price: Optional[float] = None,
    n_simulations: int = _DEFAULT_SIMULATIONS,
    seed: Optional[int] = None,
) -> MonteCarloResult:
    """Runs `n_simulations` independent draws through
    `project_driver_based_dcf`, collecting `value_per_share` from every
    draw that produces a valid, finite result. `seed` makes the run
    reproducible (required for testing; production calls can omit it for
    a genuinely fresh random draw each time)."""
    rng = random.Random(seed)
    values: list[float] = []
    n_discarded = 0

    for _ in range(n_simulations):
        revenue_growth_1 = assumptions.revenue_growth_1.sample(rng)
        operating_margin = assumptions.operating_margin.sample(rng)
        discount_rate = assumptions.discount_rate.sample(rng)
        terminal_growth = assumptions.terminal_growth.sample(rng)
        reinvestment_rate = assumptions.reinvestment_rate.sample(rng)
        shares_out = assumptions.shares_out.sample(rng)

        try:
            result = project_driver_based_dcf(
                revenue_0=assumptions.revenue_0,
                revenue_growth_1=revenue_growth_1,
                terminal_growth=terminal_growth,
                operating_margin_anchor_pct=operating_margin,
                terminal_operating_margin_pct=operating_margin,
                tax_rate=assumptions.tax_rate,
                reinvestment_rate_anchor_pct=reinvestment_rate,
                terminal_roic_pct=assumptions.terminal_roic_pct,
                discount_rate=discount_rate,
                net_cash=assumptions.net_cash,
                shares_out=shares_out,
                years=assumptions.years,
                high_growth_years=assumptions.high_growth_years,
            )
        except (UnstableGordonGrowthError, ValueError):
            n_discarded += 1
            continue

        if result.value_per_share is not None:
            values.append(result.value_per_share)
        else:
            n_discarded += 1

    if not values:
        return MonteCarloResult(
            n_simulations=n_simulations, n_valid=0, n_discarded=n_discarded,
            min=None, p10=None, p25=None, median=None, p75=None, p90=None, max=None,
            probability_undervalued_pct=None, current_price=current_price,
        )

    values.sort()
    probability_undervalued_pct = None
    if current_price is not None and current_price > 0:
        n_undervalued = sum(1 for v in values if v > current_price)
        probability_undervalued_pct = round(n_undervalued / len(values) * 100, 1)

    return MonteCarloResult(
        n_simulations=n_simulations,
        n_valid=len(values),
        n_discarded=n_discarded,
        min=round(values[0], 2),
        p10=round(_percentile(values, 0.10), 2),
        p25=round(_percentile(values, 0.25), 2),
        median=round(_percentile(values, 0.50), 2),
        p75=round(_percentile(values, 0.75), 2),
        p90=round(_percentile(values, 0.90), 2),
        max=round(values[-1], 2),
        probability_undervalued_pct=probability_undervalued_pct,
        current_price=current_price,
    )


def build_distribution_from_trend(
    trend: list[Optional[float]], anchor: float, lo: float, hi: float, variable_key: str,
) -> DistributionInput:
    """Derives a DistributionInput's stdev from the company's OWN real
    historical trend (population stdev of the valid values, same technique
    already used elsewhere in this codebase for confidence scoring) —
    never an arbitrary fixed percentage. `variable_key` looks up the
    realism floor from `_MIN_STDEV_FLOORS` (see module docstring for why a
    floor exists at all). `anchor` is the real point estimate (e.g. the
    same recency-weighted value the deterministic DCF uses) — kept
    separate from the trend so the distribution is always centered on the
    actual anchor, not the trend's own (possibly stale) mean."""
    valid = [v for v in trend if v is not None]
    floor = _MIN_STDEV_FLOORS.get(variable_key, 0.01)
    stdev = max(statistics.pstdev(valid), floor) if len(valid) >= 3 else floor
    return DistributionInput(mean=anchor, stdev=stdev, lo=lo, hi=hi)
