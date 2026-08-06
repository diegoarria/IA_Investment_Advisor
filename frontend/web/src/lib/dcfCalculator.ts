/**
 * Pure two-stage DCF (discounted cash flow) calculator for the "Calculadora
 * de Valor Intrínseco" tool on the Subvaluadas screen. Deliberately runs
 * entirely client-side — the growth/discount/terminal-growth sliders need
 * to recompute live on every drag, and a backend round-trip per slider tick
 * would feel laggy. Every other valuation number in this app lives
 * server-side; this is the one intentional exception.
 *
 * All monetary inputs (fcf0, netCash) are in millions of the ticker's
 * reporting currency (usually USD) — the API returns raw dollar amounts,
 * so callers must divide by 1e6 before passing them in here.
 */

export interface DcfInputs {
  /** Current (TTM) free cash flow, in millions. */
  fcf0: number;
  /** Annual growth rate during the explicit projection window, e.g. 0.07 for 7%. */
  g: number;
  /** Discount rate (WACC/required return), e.g. 0.09 for 9%. */
  r: number;
  /** Terminal/perpetual growth rate beyond the projection window, e.g. 0.03 for 3%. */
  gt: number;
  /** Years of explicit projection. Defaults to 10. */
  n?: number;
  /** Net cash (positive) or net debt (negative), in millions. */
  netCash: number;
  /** Diluted shares outstanding, in millions. */
  shares: number;
}

export interface DcfResult {
  /** Sum of the discounted explicit-period cash flows. */
  stage1: number;
  /** Discounted terminal value. */
  terminal: number;
  /** Total equity value (stage1 + terminal + netCash). */
  equity: number;
  /** Equity value per share — the headline "valor intrínseco". */
  valorPorAccion: number;
}

/**
 * Returns null (never throws) when the formula has no solution — r === g or
 * r === gt both divide by zero — so the UI can show "sin solución" instead
 * of crashing. Also guards shares <= 0, which would otherwise produce
 * Infinity/NaN per-share values.
 */
export function calcularValorIntrinseco(inputs: DcfInputs): DcfResult | null {
  const { fcf0, g, r, gt, netCash, shares } = inputs;
  const n = inputs.n ?? 10;

  if (r === g || r === gt) return null;
  if (!shares || shares <= 0) return null;

  const stage1 =
    (fcf0 * (1 + g)) / (r - g) * (1 - Math.pow((1 + g) / (1 + r), n));
  const terminal =
    (fcf0 * Math.pow(1 + g, n) * (1 + gt)) / (r - gt) / Math.pow(1 + r, n);
  const equity = stage1 + terminal + netCash;
  const valorPorAccion = equity / shares;

  if (!isFinite(valorPorAccion)) return null;

  return { stage1, terminal, equity, valorPorAccion };
}

/** Margin of safety: (valor intrínseco - precio) / valor intrínseco, as a
 * fraction (not %). Denominator is the INTRINSIC value, not price — Fase
 * 1.5, Incremento 14 dedup: matches the single backend convention
 * (numeric_helpers.py::calc_margin_of_safety) after finding this function
 * was the lone holdout using /price. Currently dead code (only this
 * file's own test calls it) — fixed for consistency rather than deleted,
 * in case a future caller reaches for "the" margin-of-safety helper here. */
export function margenDeSeguridad(valorPorAccion: number, precioActual: number): number | null {
  if (!valorPorAccion || valorPorAccion <= 0) return null;
  return (valorPorAccion - precioActual) / valorPorAccion;
}
