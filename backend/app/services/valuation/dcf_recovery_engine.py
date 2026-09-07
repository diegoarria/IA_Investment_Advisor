"""
DCF Recovery Engine — the FCF/DCF track for the (shadow-mode) dual-track
fair value blend. See `earnings_normalization_engine.py`'s module
docstring for the full context this was built from.

Replaces a naive single-period Gordon-growth perpetuity (capitalize
TODAY's FCF forever) with a real, if still simplified, multi-year
recovery model — validated by hand against real META data this session,
then generalized: a company detected to be in a real capex supercycle
(`earnings_normalization_engine.capex_supercycle_state`) doesn't get
punished as if today's depressed FCF were permanent, but also isn't given
full, immediate credit for a recovery that hasn't happened yet.

Model: `depressed_years` years at today's real FCF/share, then
`recovery_years` years of LINEAR interpolation (in dollar terms) toward a
normalized FCF/share target — revenue grown at the given real growth
rate, times the company's own normalized FCF margin (from non-elevated-
capex years) — then a standard Gordon-growth terminal value on the
recovered FCF, discounted back to present at the real WACC.

Known, documented limitation (do not treat as more precise than it is):
this is still a real simplification — capex-recovery timing
(`depressed_years`/`recovery_years`) is a fixed real-world-informed
default, not fit per company, and the terminal value (typically the
majority of the total) is highly sensitive to the normalized-margin and
growth assumptions. Treat the output as one input to a blend, never as a
standalone "true" value — see `dual_track_blend_engine.py`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

# Real bug found running the Fase 2 shadow-mode validation batch (2026-09-01):
# a naive `wacc_pct > terminal_growth_pct` check lets WACC sit arbitrarily
# close to terminal growth, and `1 / (wacc - g)` blows up near that
# singularity — confirmed live for ABBV (WACC ~6%, terminal 5% -> 100x
# leverage on FCF, fair value $1,565.83/share vs. a real ~$180 price).
# Require a real minimum spread instead of just a positive one. Raised
# from an initial 2.0pp to 4.0pp after TMUS (real WACC 5.3%, a genuinely
# low-beta telecom) still blew up at 2.0pp (spread 2.3pp -> ~44x FCF
# leverage, $712/share) — low-WACC blue chips (telecoms, utilities,
# staples) are common enough in the real universe that 2.0pp wasn't a
# real safety margin, just a slightly-less-thin one.
#
# Diego, 2026-09-04 — raised again, 4.0pp -> 7.0pp, after full-replacement
# shipped and a real batch review (ROKU, TKO, CIEN, BWA, FIS, TOST, TNL,
# CART, all confirmed live) showed 4.0pp still let `compute_single_period_
# fcf_value` apply a ~15-25x multiple to a SINGLE year's real FCF/share
# for any company with a real WACC under ~10% (TKO: WACC 7.44%, spread
# only 4.44pp -> ~23x multiple on one year of FCF, no haircut for how
# representative that one year's number is) — a genuinely aggressive,
# perpetuity-style multiple applied to trailing (not normalized) cash
# flow, well beyond what any real earnings-based P/E in this app would
# ever assign. 7.0pp caps the single-period multiple at roughly
# (1+terminal_g)/0.07 ≈ 14.7x at the floor, still real headroom for
# genuinely low-risk compounders without the extreme low-WACC blowups.
_MIN_WACC_TERMINAL_SPREAD_PP = 7.0


@dataclass
class RecoveryDcfResult:
    fcf_per_share_projection: list[float] = field(default_factory=list)
    terminal_value: Optional[float] = None
    pv_explicit_years: Optional[float] = None
    pv_terminal_value: Optional[float] = None
    fair_value_per_share: Optional[float] = None


def compute_recovery_dcf(
    *,
    fcf_per_share_today: float,
    normalized_fcf_margin_pct: float,
    revenue_per_share_today: float,
    growth_pct: float,
    wacc_pct: float,
    terminal_growth_pct: float = 3.0,
    depressed_years: int = 2,
    recovery_years: int = 3,
) -> Optional[RecoveryDcfResult]:
    """Real math validated by hand for META this session (base case:
    $17.95 FCF/share today, 31.5% normalized margin, 14% growth, 10.1%
    WACC, 5% terminal → $710.85/share, reproduced in tests with an
    explicit terminal_growth_pct=5.0). Default terminal growth lowered to
    3.0% (real long-run nominal-GDP-style assumption) after the Fase 2
    batch showed 5.0% was too aggressive for low-beta/low-WACC real
    companies. Requires a real minimum WACC-terminal_growth spread (not
    just wacc > terminal_g) — see `_MIN_WACC_TERMINAL_SPREAD_PP` — since a
    thin spread makes the Gordon terminal value blow up (confirmed live
    for ABBV). Returns None rather than a divide-by-zero/absurd fair
    value. Also returns None when `fcf_per_share_today` is not positive —
    a perpetuity-growth model on a zero/negative cash flow base is not
    meaningful (confirmed live for AEE, a utility with structurally
    negative real FCF from continuous heavy capex — that's not a
    "supercycle" to recover from, it's the business's permanent shape).
    Also returns None when `normalized_fcf_margin_pct` is not positive —
    "recovering" toward a target that is itself a loss produced an
    exploding negative fair value live for HIMS/PR in the Fase 2 batch;
    a real recovery story requires a real positive normalized margin to
    recover TO."""
    if fcf_per_share_today is None or fcf_per_share_today <= 0:
        return None
    if normalized_fcf_margin_pct is None or normalized_fcf_margin_pct <= 0:
        return None
    wacc = wacc_pct / 100.0
    terminal_g = terminal_growth_pct / 100.0
    growth = growth_pct / 100.0
    if wacc - terminal_g < _MIN_WACC_TERMINAL_SPREAD_PP / 100.0:
        return None

    horizon = depressed_years + recovery_years
    revenues = [revenue_per_share_today * (1 + growth) ** t for t in range(1, horizon + 1)]
    normalized_target = revenues[horizon - 1] * (normalized_fcf_margin_pct / 100.0)

    fcfs: list[float] = []
    for t in range(1, horizon + 1):
        if t <= depressed_years:
            fcfs.append(fcf_per_share_today)
        else:
            frac = (t - depressed_years) / recovery_years
            fcfs.append(fcf_per_share_today + (normalized_target - fcf_per_share_today) * frac)

    terminal_value = fcfs[-1] * (1 + terminal_g) / (wacc - terminal_g)
    pv_explicit = sum(fcf / (1 + wacc) ** (i + 1) for i, fcf in enumerate(fcfs))
    pv_terminal = terminal_value / (1 + wacc) ** horizon
    fair_value = pv_explicit + pv_terminal

    return RecoveryDcfResult(
        fcf_per_share_projection=[round(f, 2) for f in fcfs],
        terminal_value=round(terminal_value, 2),
        pv_explicit_years=round(pv_explicit, 2),
        pv_terminal_value=round(pv_terminal, 2),
        fair_value_per_share=round(fair_value, 2),
    )


def compute_single_period_fcf_value(
    *, fcf_per_share_today: float, wacc_pct: float, terminal_growth_pct: float = 3.0,
) -> Optional[float]:
    """Fallback for companies NOT in a real capex supercycle
    (`capex_supercycle_state(...).current_year_elevated_capex is False`)
    — no reason to run the 5-year recovery machinery when there's nothing
    to recover from; a standard single-period Gordon perpetuity of
    NEXT year's FCF (FCF₁ = FCF₀ × (1 + g), not FCF₀ itself — a real
    formula bug caught and fixed this session) is the right, simpler
    tool. Same real minimum-spread and positive-FCF guards as
    `compute_recovery_dcf` above, for the same reasons (see its
    docstring) — confirmed live for ABBV (thin spread) and AEE (negative
    FCF) in the Fase 2 validation batch."""
    if fcf_per_share_today is None or fcf_per_share_today <= 0:
        return None
    wacc = wacc_pct / 100.0
    terminal_g = terminal_growth_pct / 100.0
    if wacc - terminal_g < _MIN_WACC_TERMINAL_SPREAD_PP / 100.0:
        return None
    fcf_next = fcf_per_share_today * (1 + terminal_g)
    return round(fcf_next / (wacc - terminal_g), 2)
