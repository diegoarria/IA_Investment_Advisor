/**
 * Client-side port of `project_driver_based_dcf`
 * (backend/app/services/valuation/dcf_engine.py) — Modelo Completo,
 * see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
 *
 * This exists so the interactive slider builder in FullModelPanel can
 * recompute instantly on every slider move, with zero network round-trip.
 * It must stay numerically identical to the Python engine — any formula
 * change there needs the same change here. The real Bear/Base/Bull
 * scenarios and the default pre-fill always come from the backend's
 * `nuvos_fair_value.scenarios`; this function only powers the user's own
 * custom what-if scenario, never replaces or is sent back to the backend.
 */

export type ExitMetric = "ev_sales" | "ev_ebit" | "ev_fcf";

export interface YearlyDriverRow {
  year: number;
  revenue: number;
  revenueGrowthPct: number;
  operatingMarginPct: number;
  ebit: number;
  taxRatePct: number;
  nopat: number;
  reinvestmentRatePct: number;
  reinvestment: number;
  fcf: number;
  discountedFcf: number;
}

export interface DriverBasedDcfInput {
  revenue0: number;
  revenueGrowth1: number;
  terminalGrowth: number;
  operatingMarginAnchorPct: number;
  terminalOperatingMarginPct: number;
  taxRate: number;
  reinvestmentRateAnchorPct: number;
  terminalRoicPct: number;
  discountRate: number;
  netCash?: number | null;
  sharesOut?: number | null;
  years?: number;
  highGrowthYears?: number;
  exitMultiple?: number | null;
  exitMetric?: ExitMetric | null;
}

export interface DriverBasedDcfResult {
  yearly: YearlyDriverRow[];
  pvOfFcfSum: number;
  terminalValue: number;
  pvOfTerminalValue: number;
  enterpriseValue: number;
  equityValue: number | null;
  valuePerShare: number | null;
  assumptions: {
    revenueGrowth1Pct: number;
    highGrowthYears: number;
    terminalGrowthPct: number;
    operatingMarginAnchorPct: number;
    terminalOperatingMarginPct: number;
    taxRatePct: number;
    reinvestmentRateAnchorPct: number;
    terminalReinvestmentRatePct: number;
    discountRatePct: number;
    terminalValueMethod: "gordon" | "exit_multiple";
    exitMultiple: number | null;
    exitMetric: ExitMetric | null;
    gordonTerminalValue: number | null;
    gordonSanityCheckRatio: number | null;
    impliedFcfMarginPctYearN: number | null;
  };
}

const PROJECTION_YEARS = 10;
const EXIT_METRICS: ExitMetric[] = ["ev_sales", "ev_ebit", "ev_fcf"];

// Must match dcf_engine.py's _GORDON_SANITY_BAND exactly.
const GORDON_SANITY_BAND: [number, number] = [0.5, 2.5];

export class UnstableGordonGrowthError extends Error {
  constructor(discountRate: number, terminalGrowth: number) {
    super(
      `Tasa de descuento (${(discountRate * 100).toFixed(2)}%) debe ser mayor que el crecimiento terminal ` +
        `(${(terminalGrowth * 100).toFixed(2)}%) para que el modelo de Gordon tenga una solución estable.`
    );
    this.name = "UnstableGordonGrowthError";
  }
}

function validateDiscountBeatsTerminalGrowth(
  discountRate: number,
  terminalGrowth: number,
  minSpread = 0.005
): void {
  if (discountRate - terminalGrowth < minSpread) {
    throw new UnstableGordonGrowthError(discountRate, terminalGrowth);
  }
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(Math.min(value, hi), lo);
}

function safeDivide(numerator: number, denominator: number, epsilon = 1e-9): number | null {
  if (Math.abs(denominator) < epsilon) return null;
  return numerator / denominator;
}

function validatePositiveShares(sharesOut?: number | null): boolean {
  return sharesOut !== null && sharesOut !== undefined && sharesOut > 0;
}

function fade(year1Value: number, terminalValue: number, yr: number, years: number): number {
  return year1Value + (terminalValue - year1Value) * (yr / years);
}

function fadeGrowthWithPlateau(
  year1Value: number,
  terminalValue: number,
  yr: number,
  years: number,
  highGrowthYears: number
): number {
  if (yr <= highGrowthYears) return year1Value;
  const remainingYears = years - highGrowthYears;
  return year1Value + (terminalValue - year1Value) * ((yr - highGrowthYears) / remainingYears);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function projectDriverBasedDcf(input: DriverBasedDcfInput): DriverBasedDcfResult {
  const {
    revenue0,
    revenueGrowth1,
    terminalGrowth,
    operatingMarginAnchorPct,
    terminalOperatingMarginPct,
    taxRate,
    reinvestmentRateAnchorPct,
    terminalRoicPct,
    discountRate,
    netCash = null,
    sharesOut = null,
    years = PROJECTION_YEARS,
    highGrowthYears = 0,
    exitMultiple = null,
    exitMetric = null,
  } = input;

  if (exitMultiple === null) {
    validateDiscountBeatsTerminalGrowth(discountRate, terminalGrowth);
  } else if (!exitMetric || !EXIT_METRICS.includes(exitMetric)) {
    throw new Error(
      `exit_metric debe ser uno de ${EXIT_METRICS.join(", ")} cuando se pasa exit_multiple, no ${exitMetric}.`
    );
  }

  if (revenue0 <= 0) {
    throw new Error("revenue_0 debe ser positivo — no hay una base real desde la cual proyectar.");
  }
  if (highGrowthYears < 0 || highGrowthYears >= years) {
    throw new Error(
      `high_growth_years debe estar en [0, ${years}) — un valor de ${highGrowthYears} no deja años reales ` +
        "para desacelerar hacia el crecimiento terminal."
    );
  }
  if (terminalRoicPct <= 0) {
    throw new Error(
      "terminal_roic_pct debe ser positivo: el reinvestment rate terminal (terminal_growth / terminal_ROIC) " +
        "no tiene una solución económica válida para un ROIC terminal no positivo."
    );
  }
  const terminalReinvestmentRate = terminalGrowth / terminalRoicPct;

  const yearly: YearlyDriverRow[] = [];
  let revenuePrev = revenue0;
  let pvSum = 0;

  for (let yr = 1; yr <= years; yr++) {
    const growth = fadeGrowthWithPlateau(revenueGrowth1, terminalGrowth, yr, years, highGrowthYears);
    const revenue = revenuePrev * (1 + growth);

    const operatingMargin = fade(operatingMarginAnchorPct, terminalOperatingMarginPct, yr, years);
    const ebit = revenue * operatingMargin;
    const nopat = ebit * (1 - taxRate);

    const reinvestmentRate = fade(reinvestmentRateAnchorPct, terminalReinvestmentRate, yr, years);
    const reinvestment = nopat * reinvestmentRate;
    const fcf = nopat - reinvestment;

    const discountedFcf = fcf / (1 + discountRate) ** yr;
    pvSum += discountedFcf;

    yearly.push({
      year: yr,
      revenue: round(revenue, 0),
      revenueGrowthPct: round(growth * 100, 2),
      operatingMarginPct: round(operatingMargin * 100, 2),
      ebit: round(ebit, 0),
      taxRatePct: round(taxRate * 100, 2),
      nopat: round(nopat, 0),
      reinvestmentRatePct: round(reinvestmentRate * 100, 2),
      reinvestment: round(reinvestment, 0),
      fcf: round(fcf, 0),
      discountedFcf: round(discountedFcf, 0),
    });

    revenuePrev = revenue;
  }

  const finalRow = yearly[yearly.length - 1];
  const finalFcf = finalRow.fcf;

  let gordonTerminalValue: number | null = null;
  let gordonSanityCheckRatio: number | null = null;
  let terminalValueMethod: "gordon" | "exit_multiple";
  let terminalValue: number;

  if (exitMultiple === null) {
    terminalValueMethod = "gordon";
    terminalValue = (finalFcf * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
  } else {
    terminalValueMethod = "exit_multiple";
    const metricValue = { ev_sales: finalRow.revenue, ev_ebit: finalRow.ebit, ev_fcf: finalFcf }[exitMetric as ExitMetric];
    const rawTerminalValue = exitMultiple * metricValue;

    try {
      validateDiscountBeatsTerminalGrowth(discountRate, terminalGrowth);
      gordonTerminalValue = (finalFcf * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
    } catch (e) {
      if (!(e instanceof UnstableGordonGrowthError)) throw e;
    }

    if (gordonTerminalValue && gordonTerminalValue > 0) {
      const lo = gordonTerminalValue * GORDON_SANITY_BAND[0];
      const hi = gordonTerminalValue * GORDON_SANITY_BAND[1];
      terminalValue = clamp(rawTerminalValue, lo, hi);
      gordonSanityCheckRatio = round(terminalValue / gordonTerminalValue, 2);
    } else {
      terminalValue = rawTerminalValue;
    }
  }

  const pvTerminal = terminalValue / (1 + discountRate) ** years;
  const enterpriseValue = pvSum + pvTerminal;
  const impliedFcfMarginPctYearN = finalRow.revenue ? round((finalFcf / finalRow.revenue) * 100, 2) : null;

  const result: DriverBasedDcfResult = {
    yearly,
    pvOfFcfSum: round(pvSum, 0),
    terminalValue: round(terminalValue, 0),
    pvOfTerminalValue: round(pvTerminal, 0),
    enterpriseValue: round(enterpriseValue, 0),
    equityValue: null,
    valuePerShare: null,
    assumptions: {
      revenueGrowth1Pct: round(revenueGrowth1 * 100, 2),
      highGrowthYears,
      terminalGrowthPct: round(terminalGrowth * 100, 2),
      operatingMarginAnchorPct: round(operatingMarginAnchorPct * 100, 2),
      terminalOperatingMarginPct: round(terminalOperatingMarginPct * 100, 2),
      taxRatePct: round(taxRate * 100, 2),
      reinvestmentRateAnchorPct: round(reinvestmentRateAnchorPct * 100, 2),
      terminalReinvestmentRatePct: round(terminalReinvestmentRate * 100, 2),
      discountRatePct: round(discountRate * 100, 2),
      terminalValueMethod,
      exitMultiple: exitMultiple !== null ? round(exitMultiple, 2) : null,
      exitMetric: exitMetric ?? null,
      gordonTerminalValue: gordonTerminalValue !== null ? round(gordonTerminalValue, 0) : null,
      gordonSanityCheckRatio,
      impliedFcfMarginPctYearN,
    },
  };

  if (netCash !== null && netCash !== undefined && validatePositiveShares(sharesOut)) {
    const equityValue = enterpriseValue + netCash;
    result.equityValue = round(equityValue, 0);
    const valuePerShare = safeDivide(equityValue, sharesOut as number);
    result.valuePerShare = valuePerShare !== null ? round(valuePerShare, 2) : null;
  }

  return result;
}
