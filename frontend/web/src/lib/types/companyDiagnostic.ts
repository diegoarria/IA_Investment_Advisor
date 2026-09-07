// ─── CompanyDiagnosticCard types ──────────────────────────────────────────────
// Presentational data shape for CompanyDiagnosticCard — NOT wired to a real
// backend endpoint yet. The Nuvos backend's `dcf`/`gqv_fair_value` responses
// don't produce this shape today (competitor comparison, moat bullet points,
// and noiseVsReality narrative aren't real computed fields anywhere) — this
// type + mockCopartData exist purely to build and verify the component
// against a known-good fixture before a future task maps real data onto it.

export interface CompetitorComparison {
  metricName: string;
  targetCompanyValue: string;
  competitorValue: string;
  competitorName: string;
  nuvosAdvantageNote: string;
}

// "Vs. tu sector" — Diego's request (2026-08-21): compare against the real
// MEDIAN of several same-industry peers (not one named competitor like
// CompetitorComparison above), so a raw number like "ROIC 39.7%" has real
// context instead of sitting alone. `delta`/`deltaLabel` are precomputed
// server-side (company_diagnostic_service._sector_delta) — never derived
// client-side from the formatted strings, which would be fragile.
export interface SectorComparisonRow {
  metricName: string;
  companyValue: string;
  sectorValue: string;
  delta: "up" | "down" | "flat" | null;
  deltaLabel: string;
}

export interface SectorComparison {
  sector: string;
  peerCount: number;
  peerTickers: string[];
  rows: SectorComparisonRow[];
  insight: string;
}

export interface ValuationScenarios {
  conservative: number;
  baseFairValue: number;
  optimistic: number;
  currentPrice: number;
  marginOfSafetyPercent: number;
  peCurrent: number;
  // Real historical P/E is legitimately missing for plenty of real tickers
  // (confirmed live for CPRT/JPM/AAPL) — never gated server-side, so this
  // must stay nullable here too.
  peHistoricalAvg: number | null;
  // Structurally inapplicable to banks/financials (no traditional
  // operating-company FCF) — confirmed live for GS/WFC. Not gated
  // server-side, so nullable here too.
  evFcf: number | null;
  // Methodology-audit transparency (see /Users/diegoarria/.claude/plans/
  // cosmic-munching-crown.md) — only present on the GQV valuation path
  // (null on the legacy DCF fallback, which has no equivalent).
  fcfAssumptions: {
    fcf_reported: number | null;
    fcf_normalized: number | null;
    maintenance_capex_estimate: number | null;
    growth_capex_estimate: number | null;
    methodology_note: string;
  } | null;
  // Diego, 2026-08-31 — expanded from {method, wacc_pct} to the full real
  // CAPM build-up (beta -> cost of equity, cost of debt, weighted) already
  // computed by _calc_wacc (fundamental_analysis_service.py) and already
  // flowing through unchanged — just wasn't in the type before. All the
  // CAPM-specific fields are null when method is the sector-fallback
  // (no real beta/risk-free rate was available).
  waccDetails: {
    method: string;
    wacc_pct: number | null;
    beta: number | null;
    risk_free_rate_pct: number | null;
    equity_risk_premium_pct: number | null;
    cost_of_equity_pct: number | null;
    cost_of_debt_pct: number | null;
    tax_rate_pct: number | null;
    equity_weight_pct: number | null;
    debt_weight_pct: number | null;
  } | null;
  // Diego, 2026-08-31 — real sell-side analyst consensus (fh_price_target)
  // — a different question than our own fair value (where analysts expect
  // the price to go vs. what the cash flows are worth today), shown as a
  // separate reference point. Null for tickers with no analyst coverage,
  // and currently always null in this environment (Finnhub's price-target
  // endpoint 403s on the free-tier API key) — degrade gracefully.
  analystTarget: {
    target_high: number | null;
    target_low: number | null;
    target_mean: number | null;
    target_median: number | null;
  } | null;
  // Diego, 2026-08-31 — "¿está cara vs. su propia historia?" + qué pasó
  // después de valoraciones como la de hoy. Real DAILY granularity (~1,000
  // real trading days, same kind of claim AlphaSpread makes) — see
  // price_history_context_service.py's own module docstring. Null when
  // the ticker doesn't have ~1 real trading year of daily price +
  // quarterly TTM EPS depth.
  priceHistoryContext: {
    percentileCheaperThan: number;
    daysUsed: number;
    todayBucket: "cheap" | "normal" | "expensive";
    buckets: Record<
      "cheap" | "normal" | "expensive",
      { daysCount: number; timesHigherLater: number; medianReturnPct: number } | null
    >;
  } | null;
  // Diego, 2026-09-03 — real "precio real vs. valor razonable" line chart
  // (~5 real years, same window as priceHistoryContext above). The
  // fairValue line uses a constant EFFECTIVE multiple (today's real
  // baseFairValue ÷ today's real TTM EPS) applied to each real historical
  // day's own real TTM EPS — see company_diagnostic_service.py /
  // price_history_context_service.compute_fair_value_chart_series's own
  // docstring. Null under the same real-data-depth conditions
  // priceHistoryContext already documents.
  fairValueChart: {
    points: { date: string; price: number; fairValue: number }[];
    effectiveMultiple: number;
    currentTtmEps: number;
  } | null;
  // Methodology audit round 2 — real forward P/E (Yahoo, when the live
  // fetch succeeds) and P/E on earnings-state-normalized EPS, shown
  // alongside peCurrent (raw GAAP), never replacing it. Both nullable —
  // forward P/E can genuinely be unavailable, and peNormalized only
  // differs from peCurrent when the latest year was flagged as distorted.
  peForward: number | null;
  peNormalized: number | null;
  // Diego, 2026-08-30 — "por qué este P/E y no otro": the real step-by-step
  // build-up (sector base multiple + each of the 6 named adjustments with
  // its real point value and reason, then the blend with historical-own/
  // peer P/E anchors). Null on the legacy DCF fallback path (no GQV Fair
  // P/E computed there).
  fairPeBreakdown: {
    fair_pe: number;
    band: [number, number];
    primary_anchor: string;
    base_multiple: number | null;
    adjustments: { factor: string; points: number; reason: string }[];
    factors: { name: string; value: number | null; weight: number | null; reason: string }[];
  } | null;
  // Diego, 2026-08-31 — real Peter Lynch classification (classification.py)
  // and the per-scenario EPS/fair-P/E build-up (not just the 3 final
  // Bear/Base/Bull prices above). Both null on the legacy DCF fallback path.
  classification: {
    category: string;
    confidence: number;
    secondary_category: string | null;
    reason: string;
    factors: string[];
    method: string;
  } | null;
  scenarioBreakdown: {
    bear: { eps: number | null; fair_pe: number; fair_value_per_share: number | null };
    base: { eps: number | null; fair_pe: number; fair_value_per_share: number | null };
    bull: { eps: number | null; fair_pe: number; fair_value_per_share: number | null };
  } | null;
  // Pure EPS x P/E multiplication of the real numbers above — see
  // company_diagnostic_service._build_sensitivity_grid's own docstring.
  sensitivityGrid: {
    rows: {
      epsLabel: string;
      eps: number;
      values: { peLabel: string; pe: number; fairValue: number }[];
    }[];
  } | null;
  // Diego, 2026-09-03 — a second, independent fair-value estimate
  // (earnings x fair P/E, blended with an FCF/DCF track) shown as an
  // ADDITIONAL perspective — see /Users/diegoarria/.claude/plans/
  // dapper-scribbling-honey.md. NEVER used for baseFairValue/
  // marginOfSafetyPercent/fairPeBreakdown above, which stay the real
  // production number. `applicable: false` means this second estimate
  // couldn't be computed for this ticker (e.g. a REIT, or missing data)
  // — `note` explains why in the UI's own language; render nothing more
  // than that note in that case, no numeric fields are present.
  shadowDualTrack: ShadowDualTrack | null;
}

export type ShadowDualTrack =
  | { applicable: false; note: string | null }
  | {
      applicable: true;
      earningsTrackValue: number;
      earningsTrackMultiple: number;
      multipleNote: string | null;
      epsUsed: number;
      epsNote: string | null;
      epsFlaggedQuarters: string[];
      fcfTrackValue: number | null;
      fcfTrackNote: string | null;
      capexSupercycleDetected: boolean;
      normalizedFcfMarginPct: number | null;
      blendedFairValue: number;
      earningsTrackWeightPct: number | null;
      fcfTrackWeightPct: number | null;
    };

export interface CompanyDiagnosticData {
  ticker: string;
  companyName: string;
  sector: string;
  exchange: string;
  score: number; // 0-100
  scoreLabel: string;
  pillarScores: {
    quality: number; // 0-100
    trust: number; // 0-100
    value: number; // 0-100
    simplicity: number; // 0-100
  };
  badges: string[];
  oneLinerPitch: string;
  // Real, on-demand AI narrative — null when the underlying model call
  // failed (never a fabricated placeholder; see ai_service.generate_
  // company_diagnostic_narrative's own docstring).
  investmentThesis: string | null;
  revenueBreakdown: { category: string; percentage: number }[];
  moatPoints: string[];
  // Optional: omitted when no real peer could be found for this ticker
  // (a pre-existing sector/industry-taxonomy gap upstream, not fabricated
  // as "no competitor exists") — see company_diagnostic_service.py.
  competitorComparison: {
    competitorName: string;
    rows: CompetitorComparison[];
    conclusion: string;
  } | null;
  // Optional: omitted below _MIN_SECTOR_PEERS (5) real peers with usable
  // data — same discipline as competitorComparison above, never a
  // fabricated "sector average."
  sectorComparison: SectorComparison | null;
  financialHealth: {
    longTermDebt: string;
    netCash: string;
    roic: string;
    operatingMargin: string;
    netMargin: string;
    operatingCashFlow: string;
  };
  // Methodology audit round 3 (see /Users/diegoarria/.claude/plans/cosmic-
  // munching-crown.md) — true when buybacks compressed Stockholders Equity
  // enough that ROIC's denominator switched to operating invested capital
  // (Total Assets - Current Liabilities) instead of the standard one.
  roicAdjustedForBuybacks: boolean;
  valuation: ValuationScenarios;
  // Real, computed caution about the valuation method itself — e.g. a
  // financial-sector implied P/B too far from real/peer multiples. Shown
  // right below the verdict, alongside the real number, never in place of it.
  sectorModelNote: { sector_type: string; detalle: string } | null;
  noiseVsReality: {
    marketSaw: string;
    nuvosReality: string;
  } | null;
  actionPlan: {
    profile: string;
    strategy: string;
  } | null;
}

export const mockCopartData: CompanyDiagnosticData = {
  ticker: "CPRT",
  companyName: "Copart, Inc.",
  sector: "Technology / Industrial",
  exchange: "NASDAQ",
  score: 88,
  scoreLabel: "Calidad Máxima + Descuento",
  pillarScores: { quality: 95, trust: 98, value: 80, simplicity: 85 },
  badges: ["Moat Impenetrable", "Cero Deuda", "Líder Indiscutible"],
  oneLinerPitch: "El gigante de las subastas de vehículos en EE. UU., con $3,400M en caja y sin deuda, cotizando a su múltiplo más bajo en una década por un ajuste temporal del sector.",
  investmentThesis: "Copart mantiene un monopolio virtual (duopolio) con un profundo foso competitivo basado en el efecto de red de su plataforma global y la propiedad masiva de terrenos estratégicos, beneficiándose de tendencias estructurales como la creciente complejidad vehicular y tasas más altas de pérdida total; con un crecimiento de ingresos del 9.7%, márgenes netos superiores al 33%, cero deuda a largo plazo y cerca de $2.8 mil millones en caja líquida, la empresa representa una máquina compounding de alta calidad, resistente a recesiones y con un balance impenetrable capaz de financiar su expansión futura sin dilución.",
  revenueBreakdown: [
    { category: "Servicios de Subasta (VB3)", percentage: 85 },
    { category: "Venta Directa de Vehículos", percentage: 15 },
  ],
  moatPoints: [
    "Monopolio Físico: Red de +280 patios globales. Leyes NIMBY impiden réplicas de competidores.",
    "Efecto de Red Global: Compradores de +170 países elevan precios de remate para aseguradoras.",
    "Viento a Favor Estructural: Autos más tecnológicos = Reparaciones más caras = Más pérdidas totales.",
  ],
  competitorComparison: {
    competitorName: "RB Global / IAA (RBA)",
    conclusion: "Mientras RB Global depende de terrenos alquilados y carga con alta deuda, Copart es dueña de su tierra, no tiene deuda y genera el doble de margen. Es la única con fortaleza absoluta.",
    rows: [
      {
        metricName: "Modelo de Terrenos",
        targetCompanyValue: "Propietario (~80%)",
        competitorValue: "Arrendatario (Alquiler)",
        competitorName: "RB Global",
        nuvosAdvantageNote: "Copart: Mayor margen y blindaje de costos a largo plazo.",
      },
      {
        metricName: "Deuda Financiera",
        targetCompanyValue: "$0 USD (Caja +$3.4B)",
        competitorValue: "~$2,800M - $3,200M",
        competitorName: "RB Global",
        nuvosAdvantageNote: "Copart: Balance impenetrable vs. riesgo financiero.",
      },
      {
        metricName: "Margen Operativo",
        targetCompanyValue: "~36.5%",
        competitorValue: "~14% - 18%",
        competitorName: "RB Global",
        nuvosAdvantageNote: "Copart: Más del doble de rentabilidad sobre ingresos.",
      },
      {
        metricName: "Fondo de Comercio (Goodwill)",
        targetCompanyValue: "Bajo (~4%)",
        competitorValue: "Muy Alto (~35-40%)",
        competitorName: "RB Global",
        nuvosAdvantageNote: "Copart: Asignación de capital orgánica sin sobreprecios.",
      },
      {
        metricName: "ROIC",
        targetCompanyValue: ">20%",
        competitorValue: "~6% - 8%",
        competitorName: "RB Global",
        nuvosAdvantageNote: "Copart: Máquina de generar valor compuesto.",
      },
    ],
  },
  sectorComparison: {
    sector: "Industrials",
    peerCount: 7,
    peerTickers: ["RBA", "URI", "GWW", "FAST", "PWR", "WM", "RSG"],
    rows: [
      { metricName: "ROIC", companyValue: "22.4%", sectorValue: "9.1%", delta: "up", deltaLabel: "▲ 2.5x" },
      { metricName: "Margen Operativo", companyValue: "36.5%", sectorValue: "16.8%", delta: "up", deltaLabel: "▲ 2.2x" },
      { metricName: "Crecimiento de Ingresos", companyValue: "12.3%", sectorValue: "6.7%", delta: "up", deltaLabel: "▲ 1.8x" },
      { metricName: "P/E", companyValue: "33.1x", sectorValue: "24.6x", delta: "flat", deltaLabel: "≈" },
    ],
    insight: "El ROIC de COPART (22.4%) es 2.5 veces el de un competidor típico del sector (9.1%) — genera muchas más ganancias por cada dólar invertido en el negocio, señal de una ventaja competitiva real, no solo tamaño.",
  },
  financialHealth: {
    longTermDebt: "$0 USD",
    netCash: "~$3,400 M USD (>12% mkt cap)",
    roic: ">20% sostenido",
    operatingMargin: "36.5%",
    netMargin: "33.4%",
    operatingCashFlow: "~$1,800 M USD",
  },
  roicAdjustedForBuybacks: false,
  sectorModelNote: null,
  valuation: {
    currentPrice: 29.00,
    conservative: 34.50,
    baseFairValue: 42.50,
    optimistic: 50.50,
    marginOfSafetyPercent: 31.7,
    peCurrent: 17.5,
    peHistoricalAvg: 32.5,
    evFcf: 16.0,
    fcfAssumptions: {
      fcf_reported: 1_800_000_000,
      fcf_normalized: 1_950_000_000,
      maintenance_capex_estimate: 220_000_000,
      growth_capex_estimate: 40_000_000,
      methodology_note: "CapEx de mantenimiento estimado como el menor entre el CapEx total y la Depreciación y Amortización — una heurística estándar, no un dato reportado directamente por la empresa.",
    },
    waccDetails: {
      method: "capm",
      wacc_pct: 9.2,
      beta: 1.1,
      risk_free_rate_pct: 4.4,
      equity_risk_premium_pct: 4.6,
      cost_of_equity_pct: 9.5,
      cost_of_debt_pct: 5.8,
      tax_rate_pct: 21.0,
      equity_weight_pct: 92.0,
      debt_weight_pct: 8.0,
    },
    analystTarget: { target_high: 48.0, target_low: 36.0, target_mean: 41.5, target_median: 42.0 },
    priceHistoryContext: {
      percentileCheaperThan: 22,
      daysUsed: 6,
      todayBucket: "expensive",
      buckets: {
        cheap: { daysCount: 2, timesHigherLater: 2, medianReturnPct: 24.5 },
        normal: { daysCount: 2, timesHigherLater: 1, medianReturnPct: 6.0 },
        expensive: { daysCount: 2, timesHigherLater: 1, medianReturnPct: -3.5 },
      },
    },
    fairValueChart: {
      points: [
        { date: "2021-07-01", price: 20.1, fairValue: 24.8 },
        { date: "2022-01-03", price: 16.4, fairValue: 22.1 },
        { date: "2022-07-01", price: 14.2, fairValue: 21.0 },
        { date: "2023-01-03", price: 15.8, fairValue: 23.5 },
        { date: "2023-07-03", price: 21.6, fairValue: 27.2 },
        { date: "2024-01-02", price: 25.9, fairValue: 31.0 },
        { date: "2024-07-01", price: 27.4, fairValue: 35.6 },
        { date: "2025-01-02", price: 31.2, fairValue: 38.9 },
        { date: "2025-07-01", price: 33.5, fairValue: 41.4 },
        { date: "2026-01-02", price: 30.1, fairValue: 42.0 },
        { date: "2026-09-03", price: 29.0, fairValue: 42.5 },
      ],
      effectiveMultiple: 24.3,
      currentTtmEps: 1.75,
    },
    peForward: 16.8,
    peNormalized: 17.5,
    fairPeBreakdown: {
      fair_pe: 19.5,
      band: [16.6, 22.3],
      primary_anchor: "growth_based",
      base_multiple: 17.0,
      adjustments: [
        { factor: "growth", points: -0.4, reason: "Crecimiento esperado 3.8% vs. 5% base → -0.4x" },
        { factor: "quality", points: 2.1, reason: "ROIC 17.0% vs. costo de capital 8.5% (spread +8.5pp) → +2.1x" },
        { factor: "fcf_margin", points: 0.8, reason: "Margen de FCF 15.3% vs. 10% base → +0.8x" },
        { factor: "leverage", points: 0.0, reason: "Apalancamiento saludable o datos no disponibles — sin penalización." },
        { factor: "dividend", points: 0.6, reason: "Dividend yield real 2.8% → +0.6x" },
        { factor: "moat_management", points: 0.3, reason: "Moat/calidad 55/100 → +0.3x" },
      ],
      factors: [
        { name: "growth_based_multiple", value: 20.4, weight: 0.4, reason: "Múltiplo justificado por crecimiento/calidad (base sectorial 17.0x + ajustes)." },
        { name: "historical_own_pe", value: 18.2, weight: 0.35, reason: "P/E mediano histórico real de la propia empresa." },
        { name: "peer_pe", value: 18.8, weight: 0.25, reason: "P/E mediano real de comparables/pares." },
      ],
    },
    classification: {
      category: "stalwart",
      confidence: 68,
      secondary_category: null,
      reason: "Crecimiento moderado con ROIC muy por encima del costo de capital, comparado contra pares reales del sector — clasificado como Stalwart.",
      factors: [
        "CAGR de ingresos 3 años = 3.8% (crecimiento moderado, típico de Stalwart).",
        "ROIC 17.0% vs. mediana de pares reales 9.8% → mejor que pares.",
        "Volatilidad de EPS baja (coeficiente de variación 0.15) → ganancias estables.",
      ],
      method: "peer_relative",
    },
    scenarioBreakdown: {
      bear: { eps: 2.02, fair_pe: 16.6, fair_value_per_share: 34.50 },
      base: { eps: 2.18, fair_pe: 19.5, fair_value_per_share: 42.50 },
      bull: { eps: 2.35, fair_pe: 22.3, fair_value_per_share: 50.50 },
    },
    sensitivityGrid: {
      rows: [
        { epsLabel: "eps_low", eps: 2.02, values: [
          { peLabel: "bear_pe", pe: 16.6, fairValue: 33.53 },
          { peLabel: "fair_pe", pe: 19.5, fairValue: 39.39 },
          { peLabel: "bull_pe", pe: 22.3, fairValue: 45.05 },
        ] },
        { epsLabel: "eps_base", eps: 2.18, values: [
          { peLabel: "bear_pe", pe: 16.6, fairValue: 36.19 },
          { peLabel: "fair_pe", pe: 19.5, fairValue: 42.51 },
          { peLabel: "bull_pe", pe: 22.3, fairValue: 48.61 },
        ] },
        { epsLabel: "eps_high", eps: 2.35, values: [
          { peLabel: "bear_pe", pe: 16.6, fairValue: 39.01 },
          { peLabel: "fair_pe", pe: 19.5, fairValue: 45.83 },
          { peLabel: "bull_pe", pe: 22.3, fairValue: 52.41 },
        ] },
      ],
    },
    shadowDualTrack: {
      applicable: true,
      earningsTrackValue: 41.20,
      earningsTrackMultiple: 18.9,
      multipleNote: null,
      epsUsed: 2.18,
      epsNote: null,
      epsFlaggedQuarters: [],
      fcfTrackValue: 45.80,
      fcfTrackNote: "Gordon de un solo período (sin súper-ciclo de capex detectado)",
      capexSupercycleDetected: false,
      normalizedFcfMarginPct: 12.4,
      blendedFairValue: 43.10,
      earningsTrackWeightPct: 55.0,
      fcfTrackWeightPct: 45.0,
    },
  },
  noiseVsReality: {
    marketSaw: "Caída temporal en los volúmenes asignados por aseguradoras debido a primas de seguro récord y ajustes en precios de autos usados.",
    nuvosReality: "Es un bache cíclico, no estructural. El foso competitivo, la caja neta y la tendencia de pérdida total permanecen intactos.",
  },
  actionPlan: {
    profile: "Core Compounding / Value (Horizonte 3 - 5 años)",
    strategy: "Compra escalonada en 2 tramos (DCA) para mitigar volatilidad de corto plazo.",
  },
};
