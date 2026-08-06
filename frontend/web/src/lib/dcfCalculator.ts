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

/** Same linear fade `dcf_engine.py::_fade` uses (the `high_growth_years=0`
 * special case — this calculator has no plateau slider) — year `yr`'s
 * growth rate moves linearly from `g` (year 1) to `gt` (year `years`),
 * reaching exactly `gt` by the final explicit year. */
function _fadeGrowth(g: number, gt: number, yr: number, years: number): number {
  return g + (gt - g) * (yr / years);
}

/**
 * Fase 1.5, Incremento 15 — year-by-year projection with FCF growth fading
 * linearly from `g` to `gt` across the explicit window, replacing the
 * previous CONSTANT-growth closed-form annuity (flat `g` for all `n` years,
 * then a discrete jump to `gt` for the terminal value). This is the same
 * mathematical behavior `project_driver_based_dcf` (the backend engine this
 * page's real valuation now uses) applies to revenue growth — the manual
 * calculator must show the same shape, not a simpler model that quietly
 * disagrees with what the rest of the screen displays.
 *
 * A per-year loop (not a closed form) is required once growth varies by
 * year — same technique `dcf_engine.py`'s own projection loop uses.
 *
 * Returns null (never throws) when the formula has no solution — r === gt
 * divides by zero in the terminal value — so the UI can show "sin solución"
 * instead of crashing. Also guards shares <= 0, which would otherwise
 * produce Infinity/NaN per-share values.
 */
export function calcularValorIntrinseco(inputs: DcfInputs): DcfResult | null {
  const { fcf0, g, r, gt, netCash, shares } = inputs;
  const n = inputs.n ?? 10;

  if (r === gt) return null;
  if (!shares || shares <= 0) return null;

  let stage1 = 0;
  let fcfPrev = fcf0;
  for (let yr = 1; yr <= n; yr++) {
    const growthYr = _fadeGrowth(g, gt, yr, n);
    const fcfYr = fcfPrev * (1 + growthYr);
    stage1 += fcfYr / Math.pow(1 + r, yr);
    fcfPrev = fcfYr;
  }
  const fcfYearN = fcfPrev;

  const terminal = (fcfYearN * (1 + gt)) / (r - gt) / Math.pow(1 + r, n);
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
