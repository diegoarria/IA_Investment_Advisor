"""
Nuvos — independent BRK.B valuation prototype (audit chain, 2026-11-13/14).

Isolated and local-only. Imports nothing from `app/` and is never imported
BY `app/` — no dependency on, and zero effect on, the production Residual
Income engine (app/services/valuation/financial_engine.py) or
company_valuation_service.py. Running this module never touches Supabase
and never recomputes a production snapshot.

Why this exists: the production engine's target ROE for BRK.B blends
historical GAAP ROE (distorted by unrealized gains/losses on Berkshire's
equity portfolio, mandatory disclosure under ASU 2016-01) with a
quality-factor view, landing at ~$757/share, `validation_status=
under_review` as of 2026-11-14. Four prior audit rounds this session
(normalized-ROE Residual Income, a reconciled sum-of-parts, a
reconstruction of AlphaSpread's ~$558 multiples-based figure, and a
normalized-earnings x multiples build) converged well below that — this
module formalizes the most defensible of those builds (normalized
operating-earnings x segment multiples, cross-checked against sum-of-parts)
as reproducible, testable code instead of a one-off agent report.

All inputs below are dated, sourced facts from Berkshire's Q3 2026 10-Q
(SEC EDGAR, CIK 1067983, accession 0001193125-26-452412), as of
2026-09-30, carried forward unchanged from this audit chain's prior
rounds. Where a figure could not be cleanly verified from the 10-Q alone
(retroactive reinsurance, mixed insurance/MSR accounts-payable-and-notes),
it is modeled as an explicit uncertainty BAND, not a point estimate —
see `UNRESOLVED_LIABILITY_LOW`/`_HIGH` and the acceptance-criteria note at
the bottom of this file.
"""
from __future__ import annotations

from dataclasses import dataclass


# ─────────────────────────────────────────────────────────────────────────
# 1. Dated, sourced inputs (USD millions unless noted). Immutable — any
#    change to a real reported figure must be a new, explicitly dated
#    input set, never an in-place edit of these numbers.
# ─────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class BrkInputs:
    as_of: str = "2026-09-30"
    source: str = "SEC EDGAR 10-Q, CIK 1067983, accession 0001193125-26-452412"

    # Segment after-tax operating earnings, 9 months actual (2026-09-30).
    # Underwriting gain is DIRECTLY reported by Berkshire (confirmed in this
    # audit chain, not derived by subtraction). Insurance investment income
    # ($8,472M, 9mo) is deliberately NOT an input here — see note (A) below.
    underwriting_gain_9mo: float = 4_800.0
    bnsf_earnings_9mo: float = 4_664.0
    bhe_earnings_9mo: float = 3_617.0
    bhe_ownership_pct: float = 0.92  # non-controlling interest holds the remainder
    msr_earnings_9mo: float = 11_711.0

    # Financial assets, balance sheet, 2026-09-30.
    equity_portfolio_fair_value: float = 335_515.0
    fixed_income_investments: float = 17_082.0
    equity_method_investments: float = 20_650.0
    # Insurance-and-other cash + T-Bills, NET of Railroad/Utilities/Energy's
    # own cash ($4,666M) — that cash is already embedded in BNSF/BHE's
    # segment earnings and must not be counted a second time here.
    cash_and_tbills_insurance_and_other: float = 372_800.0

    # Liabilities confirmed NOT already embedded in a segment's own
    # after-tax earnings multiple (reconciliation audit, 2026-11-13: ruled
    # OUT double-counted items were Railroad/Utilities AP+regulatory
    # liabilities and NetJets/MSR aircraft lease liabilities — excluded
    # from this list on purpose).
    float_liability: float = 178_500.0
    tbills_payable: float = 20_489.0
    deferred_tax_liability_book: float = 92_322.0

    # Confirmed real but NOT cleanly separable from the consolidated 10-Q
    # alone: retroactive-reinsurance liability (has an offsetting deferred
    # charge asset not extracted this session) + insurance/other
    # accounts-payable-and-notes-payable that mixes parent-level and
    # MSR-embedded amounts. Modeled as a band, weighted by scenario below —
    # never collapsed to a single "best guess" number.
    unresolved_liability_full: float = 118_454.0  # if treated as 100% real & non-embedded

    # Loans/finance receivables ($30,880M, e.g. Clayton Homes within MSR):
    # treated as embedded in MSR's own after-tax earnings (its interest
    # income already runs through MSR's P&L) — deliberately NOT a separate
    # asset line, to avoid re-introducing the double-count this chain's
    # prior SOTP round had to correct for Railroad/Utilities AP and NetJets.

    # Shares outstanding, BRK.B-equivalent, cover page as of 2026-10-28:
    # 480,476 Class A x 1500 + 1,403,805,594 Class B.
    shares_b_equivalent_millions: float = 2_124.52


# Note (A) — insurance investment income exclusion, and float's treatment:
# Insurance investment income ($8,472M, 9mo) is the recurring interest/
# dividend yield on the SAME assets already counted at fair value above
# (equity portfolio, fixed income, cash/T-bills funded partly by float).
# Capitalizing it AGAIN as an earnings-multiple stream would double-count
# those assets. Chosen treatment (the cleaner of the two non-double-
# -counting options identified in this audit chain): subtract float once,
# as a real liability, and do NOT separately capitalize a "float benefit"
# perpetuity on top of it — the assets float funds are already valued at
# their own fair value above, which already reflects the benefit of cheap
# financing (an asset earning a market return, funded by a sub-market-cost
# liability, is worth its market value either way; the float's economic
# benefit shows up as a LOWER liability cost already implicit in "float is
# cheap," not as an additional asset to add).


# ─────────────────────────────────────────────────────────────────────────
# 2. Multiples and treatment knobs, per scenario. Justified by business
#    quality/growth/ROIC/reinvestment needs/real comps (see docstring
#    citations in the prior audit round this reuses) — NOT fitted to any
#    external reference price.
# ─────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ScenarioAssumptions:
    name: str
    underwriting_multiple: float
    bnsf_multiple: float
    bhe_multiple: float
    msr_multiple: float
    # Fraction of deferred_tax_liability_book treated as a real economic
    # claim today (book value overstates it when realization is deferred
    # indefinitely, as is largely true for unrealized equity-portfolio
    # gains Berkshire has no intention of selling).
    deferred_tax_retention_pct: float
    # Fraction of unresolved_liability_full treated as real/non-embedded.
    unresolved_liability_weight: float


CONSERVADOR = ScenarioAssumptions(
    name="conservador",
    underwriting_multiple=7.0, bnsf_multiple=14.0, bhe_multiple=15.0, msr_multiple=11.0,
    deferred_tax_retention_pct=1.00, unresolved_liability_weight=1.00,
)
BASE = ScenarioAssumptions(
    name="base",
    underwriting_multiple=9.0, bnsf_multiple=16.0, bhe_multiple=17.0, msr_multiple=13.0,
    deferred_tax_retention_pct=0.90, unresolved_liability_weight=0.50,
)
OPTIMISTA = ScenarioAssumptions(
    name="optimista",
    underwriting_multiple=12.0, bnsf_multiple=19.0, bhe_multiple=20.0, msr_multiple=16.0,
    deferred_tax_retention_pct=0.75, unresolved_liability_weight=0.00,
)

ALL_SCENARIOS = (CONSERVADOR, BASE, OPTIMISTA)

_ANNUALIZE = 4.0 / 3.0  # 9mo actual -> annualized run-rate


# ─────────────────────────────────────────────────────────────────────────
# 3. Core computation — pure function, no I/O, no globals mutated.
# ─────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ValuationBreakdown:
    scenario_name: str
    # Operating businesses, valued once each via their own after-tax
    # earnings x a segment-specific, independently justified multiple.
    underwriting_value: float
    bnsf_value: float
    bhe_value: float
    msr_value: float
    operating_businesses_total: float
    # Financial assets, each counted exactly once, at balance-sheet fair
    # value (never re-derived from an earnings multiple).
    equity_portfolio_value: float
    fixed_income_value: float
    equity_method_value: float
    cash_and_tbills_value: float
    financial_assets_total: float
    # Liabilities, each counted exactly once, never embedded twice in a
    # segment multiple AND subtracted again here.
    float_deduction: float
    tbills_payable_deduction: float
    deferred_tax_deduction: float
    unresolved_liability_deduction: float
    liabilities_total: float
    # Reconciliation.
    equity_value: float
    value_per_share: float


def compute_scenario(inputs: BrkInputs, assumptions: ScenarioAssumptions) -> ValuationBreakdown:
    underwriting_annualized = inputs.underwriting_gain_9mo * _ANNUALIZE
    bnsf_annualized = inputs.bnsf_earnings_9mo * _ANNUALIZE
    bhe_annualized = inputs.bhe_earnings_9mo * _ANNUALIZE * inputs.bhe_ownership_pct
    msr_annualized = inputs.msr_earnings_9mo * _ANNUALIZE

    underwriting_value = underwriting_annualized * assumptions.underwriting_multiple
    bnsf_value = bnsf_annualized * assumptions.bnsf_multiple
    bhe_value = bhe_annualized * assumptions.bhe_multiple
    msr_value = msr_annualized * assumptions.msr_multiple
    operating_businesses_total = underwriting_value + bnsf_value + bhe_value + msr_value

    equity_portfolio_value = inputs.equity_portfolio_fair_value
    fixed_income_value = inputs.fixed_income_investments
    equity_method_value = inputs.equity_method_investments
    cash_and_tbills_value = inputs.cash_and_tbills_insurance_and_other
    financial_assets_total = (
        equity_portfolio_value + fixed_income_value + equity_method_value + cash_and_tbills_value
    )

    float_deduction = inputs.float_liability
    tbills_payable_deduction = inputs.tbills_payable
    deferred_tax_deduction = inputs.deferred_tax_liability_book * assumptions.deferred_tax_retention_pct
    unresolved_liability_deduction = inputs.unresolved_liability_full * assumptions.unresolved_liability_weight
    liabilities_total = (
        float_deduction + tbills_payable_deduction + deferred_tax_deduction + unresolved_liability_deduction
    )

    equity_value = operating_businesses_total + financial_assets_total - liabilities_total
    value_per_share = equity_value / inputs.shares_b_equivalent_millions

    return ValuationBreakdown(
        scenario_name=assumptions.name,
        underwriting_value=underwriting_value,
        bnsf_value=bnsf_value,
        bhe_value=bhe_value,
        msr_value=msr_value,
        operating_businesses_total=operating_businesses_total,
        equity_portfolio_value=equity_portfolio_value,
        fixed_income_value=fixed_income_value,
        equity_method_value=equity_method_value,
        cash_and_tbills_value=cash_and_tbills_value,
        financial_assets_total=financial_assets_total,
        float_deduction=float_deduction,
        tbills_payable_deduction=tbills_payable_deduction,
        deferred_tax_deduction=deferred_tax_deduction,
        unresolved_liability_deduction=unresolved_liability_deduction,
        liabilities_total=liabilities_total,
        equity_value=equity_value,
        value_per_share=value_per_share,
    )


def compute_all_scenarios(inputs: BrkInputs | None = None) -> dict[str, ValuationBreakdown]:
    inputs = inputs or BrkInputs()
    return {s.name: compute_scenario(inputs, s) for s in ALL_SCENARIOS}


# ─────────────────────────────────────────────────────────────────────────
# 4. Sensitivity — how much the base case moves when ONE assumption at a
#    time is nudged, holding everything else at BASE's values. Not a
#    second valuation; a diagnostic of which inputs matter.
# ─────────────────────────────────────────────────────────────────────────

def sensitivity_to_msr_multiple(inputs: BrkInputs | None = None, delta: float = 2.0) -> dict[str, float]:
    """MSR is the single largest operating-business component — this
    shows per-share sensitivity to a +/-`delta`x change in its multiple
    alone, all else held at BASE."""
    inputs = inputs or BrkInputs()
    base_value = compute_scenario(inputs, BASE).value_per_share
    lower = compute_scenario(
        inputs, ScenarioAssumptions(**{**BASE.__dict__, "name": "msr_sensitivity_low", "msr_multiple": BASE.msr_multiple - delta})
    ).value_per_share
    higher = compute_scenario(
        inputs, ScenarioAssumptions(**{**BASE.__dict__, "name": "msr_sensitivity_high", "msr_multiple": BASE.msr_multiple + delta})
    ).value_per_share
    return {"base": base_value, f"msr_multiple-{delta}x": lower, f"msr_multiple+{delta}x": higher}


def sensitivity_to_unresolved_liability(inputs: BrkInputs | None = None) -> dict[str, float]:
    """Full range of the retroactive-reinsurance / mixed AP-notes
    uncertainty band, all else held at BASE — shows the per-share swing
    from this single unresolved item alone."""
    inputs = inputs or BrkInputs()
    fully_excluded = compute_scenario(
        inputs, ScenarioAssumptions(**{**BASE.__dict__, "name": "unresolved_excluded", "unresolved_liability_weight": 0.0})
    ).value_per_share
    fully_included = compute_scenario(
        inputs, ScenarioAssumptions(**{**BASE.__dict__, "name": "unresolved_included", "unresolved_liability_weight": 1.0})
    ).value_per_share
    return {"fully_excluded": fully_excluded, "fully_included": fully_included}


def sensitivity_to_deferred_tax(inputs: BrkInputs | None = None) -> dict[str, float]:
    """Full 0%-100% retention range for the deferred-tax liability, all
    else held at BASE."""
    inputs = inputs or BrkInputs()
    zero = compute_scenario(
        inputs, ScenarioAssumptions(**{**BASE.__dict__, "name": "deferred_tax_0pct", "deferred_tax_retention_pct": 0.0})
    ).value_per_share
    full = compute_scenario(
        inputs, ScenarioAssumptions(**{**BASE.__dict__, "name": "deferred_tax_100pct", "deferred_tax_retention_pct": 1.0})
    ).value_per_share
    return {"retention_0pct": zero, "retention_100pct": full}


# ─────────────────────────────────────────────────────────────────────────
# 5. Explicitly unresolved items (acceptance criterion #7) — NOT modeled
#    as a number, named here so the gap is visible rather than silent.
# ─────────────────────────────────────────────────────────────────────────

UNRESOLVED_ITEMS = (
    "Reaseguro retroactivo ($28.1B bruto): tiene un activo compensatorio "
    "('deferred charge') no extraído de los filings en esta sesión — el "
    "pasivo neto real es menor que el bruto, pero no se pudo cuantificar "
    "con evidencia suficiente. Incluido solo dentro de la banda de "
    "'unresolved_liability_full', nunca como una cifra puntual separada.",

    "Cuentas por pagar/notas de 'Insurance and Other' ($90.35B): mezcla "
    "montos a nivel matriz (deducibles) y montos embebidos en la ganancia "
    "de MSR (ya reflejados, no deducibles de nuevo) sin desglose público "
    "suficiente para separarlos. Modelado como banda, no como punto.",

    "Préstamos/cuentas financieras ($30.88B, p.ej. Clayton Homes): se "
    "asume embebido en la ganancia después de impuestos de MSR. Esto es "
    "un supuesto razonado, no una confirmación línea-por-línea del 10-Q "
    "de que ningún remanente queda fuera de esa ganancia.",

    "Participación económica real en BHE (92%): cifra heredada de "
    "discusiones públicas sobre la estructura societaria de BHE, no "
    "re-verificada contra el propio 10-Q de BHE en esta sesión.",
)
