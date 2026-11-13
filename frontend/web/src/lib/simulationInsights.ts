// Nuvos Plus — Fase 4C: "Lo que debes entender de esta simulación".
//
// Pure, deterministic, side-effect-free — exactly like the backend's own
// insights.py discipline, just on the client because it only needs to
// DESCRIBE numbers the backend already computed (before/after/deltas),
// never recompute a percentage or points delta itself. Diego, 2026-11:
// "No recalcular porcentajes financieros mediante una implementación
// paralela en React" — every number used below is read verbatim from the
// simulate() response, never re-derived.
//
// Never interprets a concentration increase as good/bad, never
// recommends buy/sell/hold, never uses AI — same rules as every other
// insight engine in this app.
//
// Fase 4C audit, 2026-11 (points 2 + 3):
//   - Semantic deduplication: "X's weight grows" and "the largest
//     position, X, grows" are the SAME fact when X is both the
//     simulated ticker AND the new largest position — never both.
//   - Causal explanation: when a sector's PERCENTAGE drops without its
//     DOLLAR value dropping, that's dilution from new money landing
//     elsewhere, not a sale — said explicitly, and the dollar figures
//     are always shown separately from the percentage so the two are
//     never conflated in the text.

export type SectorRow = { sector: string; value: number; pct_of_verified_total: number | null };

export type SimulationPosition = {
  ticker: string;
  verifiable: boolean;
  weight_pct: number | null;
  sector: string | null;
  // Fase 5D: real company/fund name + ETF issuer, when the backend could
  // verify it — optional because older cached responses and some
  // unverifiable positions never populate them.
  name?: string | null;
  etf_company?: string | null;
};

export type SimulationExposureBlock = {
  valuation: { total_value_verified: number | null; valuation_coverage_pct: number | null };
  positions: SimulationPosition[];
  sector_exposure: { by_sector: SectorRow[]; coverage_pct: number | null };
  concentration: { top_positions: { ticker: string; name: string | null; weight_pct: number }[]; largest_single_position_pct: number | null };
};

export type SectorDelta = { sector: string; pct_before: number; pct_after: number; delta_pct_points: number };
export type CountryDelta = { country: string; methodology: "equity_domicile" | "etf_underlying"; pct_before: number; pct_after: number; delta_pct_points: number };

export type SimulationResult = {
  amount: number;
  hypothetical_ticker: string;
  hypothetical_asset_class: string;
  before_had_no_verified_positions: boolean;
  before: SimulationExposureBlock;
  after: SimulationExposureBlock;
  sector_deltas: SectorDelta[];
  country_deltas?: CountryDelta[];
};

export type SimulationInsight = {
  category: "position_weight" | "sector_shift" | "concentration_change" | "coverage_gap";
  text: string;
  supporting_data: Record<string, unknown>;
};

const SECTOR_DELTA_THRESHOLD = 0.5; // percentage points
const CONCENTRATION_DELTA_THRESHOLD = 0.5;
const DOLLAR_EPSILON = 0.5; // rounding noise floor for "did the dollar value actually move"

function fmt1(n: number): string {
  return n.toFixed(1);
}

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function _positionWeightInsight(sim: SimulationResult, ticker: string, lang: string): SimulationInsight | null {
  const afterTotal = sim.after.valuation.total_value_verified;
  if (afterTotal === null) return null;
  const afterPos = sim.after.positions.find((p) => p.ticker === ticker && p.verifiable);
  if (!afterPos || afterPos.weight_pct === null) return null;
  const beforePos = sim.before.positions.find((p) => p.ticker === ticker && p.verifiable);
  const beforePct = beforePos && beforePos.weight_pct !== null ? beforePos.weight_pct : 0;
  const afterPct = afterPos.weight_pct;
  const delta = Math.round((afterPct - beforePct) * 10) / 10;
  const sign = delta >= 0 ? "+" : "";

  const text = lang === "es"
    ? `${ticker} pasaría de representar el ${fmt1(beforePct)}% a el ${fmt1(afterPct)}% de tu portafolio (${sign}${fmt1(delta)} puntos porcentuales).`
    : `${ticker} would go from ${fmt1(beforePct)}% to ${fmt1(afterPct)}% of your portfolio (${sign}${fmt1(delta)} percentage points).`;

  return { category: "position_weight", text, supporting_data: { ticker, pct_before: beforePct, pct_after: afterPct, delta_pct_points: delta } };
}

// Causal, not just descriptive: distinguishes "this sector's real dollar
// value changed" from "this sector's SHARE of a now-larger portfolio
// changed" — the exact distinction Diego's audit required. Never says a
// sector's dollar value fell when only its percentage did.
function _sectorShiftInsight(sim: SimulationResult, ticker: string, amount: number, lang: string): SimulationInsight | null {
  if (!sim.sector_deltas.length) return null;
  // sector_deltas already comes sorted by |delta| descending from the backend.
  const top = sim.sector_deltas[0];
  if (Math.abs(top.delta_pct_points) < SECTOR_DELTA_THRESHOLD) return null;

  const beforeRow = sim.before.sector_exposure.by_sector.find((r) => r.sector === top.sector);
  const afterRow = sim.after.sector_exposure.by_sector.find((r) => r.sector === top.sector);
  const beforeValue = beforeRow ? beforeRow.value : 0;
  const afterValue = afterRow ? afterRow.value : 0;
  const dollarValueGrew = afterValue > beforeValue + DOLLAR_EPSILON;
  const sign = top.delta_pct_points >= 0 ? "+" : "";

  let text: string;
  if (top.delta_pct_points < 0 && !dollarValueGrew) {
    // The defining dilution case: percentage dropped, dollar value did
    // NOT grow (stayed flat — nothing was sold) — the drop is purely
    // because the new money landed in a different sector and grew the
    // portfolio's total, so every untouched sector's SHARE shrinks.
    text = lang === "es"
      ? `El sector ${top.sector} pasa de ${fmt1(top.pct_before)}% a ${fmt1(top.pct_after)}% de tu portafolio (${fmt1(top.delta_pct_points)} puntos) — no porque hayas vendido nada de ese sector (su valor se mantiene en ${fmtMoney(beforeValue)}), sino porque tu aportación de ${fmtMoney(amount)} a ${ticker} aumentó el valor total del portafolio, diluyendo la participación porcentual de los sectores que no recibieron esa inversión.`
      : `The ${top.sector} sector goes from ${fmt1(top.pct_before)}% to ${fmt1(top.pct_after)}% of your portfolio (${fmt1(top.delta_pct_points)} points) — not because you sold anything in that sector (its value stays at ${fmtMoney(beforeValue)}), but because your ${fmtMoney(amount)} contribution to ${ticker} grew the portfolio's total value, diluting the percentage share of sectors that didn't receive that investment.`;
  } else if (top.delta_pct_points > 0 && dollarValueGrew) {
    text = lang === "es"
      ? `El sector ${top.sector} sube de ${fmt1(top.pct_before)}% a ${fmt1(top.pct_after)}% de tu portafolio (${sign}${fmt1(top.delta_pct_points)} puntos), impulsado principalmente por tu aportación de ${fmtMoney(amount)} a ${ticker}.`
      : `The ${top.sector} sector rises from ${fmt1(top.pct_before)}% to ${fmt1(top.pct_after)}% of your portfolio (${sign}${fmt1(top.delta_pct_points)} points), driven mainly by your ${fmtMoney(amount)} contribution to ${ticker}.`;
  } else {
    // Fallback for the less common combinations (e.g. value grew slightly
    // but slower than the portfolio total, so the % still fell) — still
    // states both figures plainly, still never conflates them.
    text = lang === "es"
      ? `El sector ${top.sector} pasa de ${fmt1(top.pct_before)}% a ${fmt1(top.pct_after)}% de tu portafolio (${sign}${fmt1(top.delta_pct_points)} puntos). Su valor en dólares pasa de ${fmtMoney(beforeValue)} a ${fmtMoney(afterValue)}.`
      : `The ${top.sector} sector goes from ${fmt1(top.pct_before)}% to ${fmt1(top.pct_after)}% of your portfolio (${sign}${fmt1(top.delta_pct_points)} points). Its dollar value goes from ${fmtMoney(beforeValue)} to ${fmtMoney(afterValue)}.`;
  }

  return {
    category: "sector_shift",
    text,
    supporting_data: {
      sector: top.sector, pct_before: top.pct_before, pct_after: top.pct_after, delta_pct_points: top.delta_pct_points,
      value_before: beforeValue, value_after: afterValue, dollar_value_changed: dollarValueGrew,
    },
  };
}

function _concentrationChangeInsight(sim: SimulationResult, ticker: string, lang: string): SimulationInsight | null {
  const beforeTop = sim.before.concentration.top_positions[0];
  const afterTop = sim.after.concentration.top_positions[0];
  if (!afterTop) return null;

  // Semantic dedup (Fase 4C audit, point 2): if the new largest position
  // IS the ticker just simulated, this is the exact same fact
  // `_positionWeightInsight` already states — never show both. This is a
  // real identity check (ticker equality), not a string comparison of
  // the rendered text.
  if (afterTop.ticker === ticker) return null;

  const beforePct = beforeTop ? beforeTop.weight_pct : 0;
  const afterPct = afterTop.weight_pct;
  if (Math.abs(afterPct - beforePct) < CONCENTRATION_DELTA_THRESHOLD && (!beforeTop || beforeTop.ticker === afterTop.ticker)) return null;

  const text = lang === "es"
    ? `Tu posición más grande pasaría de representar el ${fmt1(beforePct)}% (${beforeTop ? beforeTop.ticker : "—"}) a el ${fmt1(afterPct)}% (${afterTop.ticker}) de tu portafolio.`
    : `Your largest position would go from ${fmt1(beforePct)}% (${beforeTop ? beforeTop.ticker : "—"}) to ${fmt1(afterPct)}% (${afterTop.ticker}) of your portfolio.`;
  return {
    category: "concentration_change",
    text,
    supporting_data: { before_ticker: beforeTop ? beforeTop.ticker : null, before_pct: beforePct, after_ticker: afterTop.ticker, after_pct: afterPct },
  };
}

function _coverageGapInsight(sim: SimulationResult, ticker: string, lang: string): SimulationInsight | null {
  const beforeCov = sim.before.sector_exposure.coverage_pct;
  const afterCov = sim.after.sector_exposure.coverage_pct;
  const afterPos = sim.after.positions.find((p) => p.ticker === ticker && p.verifiable);
  const hypotheticalUnclassified = !!afterPos && afterPos.sector === null;
  if (!hypotheticalUnclassified) return null;

  const text = lang === "es"
    ? `No pudimos calcular la exposición sectorial de ${ticker} — su efecto en la distribución sectorial no está incluido en esta simulación.`
    : `We couldn't calculate ${ticker}'s sector exposure — its effect on the sector distribution isn't included in this simulation.`;
  return { category: "coverage_gap", text, supporting_data: { ticker, sector_coverage_pct_before: beforeCov, sector_coverage_pct_after: afterCov } };
}

// Fase 4E (2026-11): editorial-only re-presentation of a number the
// backend already computed (`afterPct`, read verbatim from
// `after.positions[].weight_pct`) — never a new calculation. Matches
// Diego's example: "Microsoft pasaría a representar aproximadamente $6
// de cada $100 del valor analizado de tu portafolio." Returns null when
// there's nothing verified to express a share of.
export function describeHypotheticalWeight(ticker: string, afterPct: number | null, lang: string = "es"): string | null {
  if (afterPct === null) return null;
  const n = Math.round(afterPct);
  return lang === "es"
    ? `${ticker} pasaría a representar aproximadamente $${n} de cada $100 del valor analizado de tu portafolio.`
    : `${ticker} would come to represent approximately $${n} of every $100 of your portfolio's analyzed value.`;
}

/** Up to 3 observations, priority order: position weight change, largest
 * sector shift (with its real cause — dilution vs. direct contribution),
 * concentration change (only when it names a DIFFERENT ticker than the
 * one already covered by the weight observation), missing-coverage
 * caveat. Never padded — skips any the real before/after/delta data
 * doesn't support. `ticker` is the hypothetical ticker that was
 * simulated, `amount` the hypothetical contribution in the portfolio's
 * own currency (used only for prose, never for a new calculation). */
export function buildSimulationInsights(sim: SimulationResult, ticker: string, lang: string = "es", amount: number = sim.amount): SimulationInsight[] {
  const candidates = [
    _positionWeightInsight(sim, ticker, lang),
    _sectorShiftInsight(sim, ticker, amount, lang),
    _concentrationChangeInsight(sim, ticker, lang),
    _coverageGapInsight(sim, ticker, lang),
  ];
  return candidates.filter((c): c is SimulationInsight => c !== null).slice(0, 3);
}
