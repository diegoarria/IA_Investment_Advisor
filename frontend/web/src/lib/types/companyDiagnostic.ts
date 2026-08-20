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
  waccDetails: { method: string; wacc_pct: number | null } | null;
  // Methodology audit round 2 — real forward P/E (Yahoo, when the live
  // fetch succeeds) and P/E on earnings-state-normalized EPS, shown
  // alongside peCurrent (raw GAAP), never replacing it. Both nullable —
  // forward P/E can genuinely be unavailable, and peNormalized only
  // differs from peCurrent when the latest year was flagged as distorted.
  peForward: number | null;
  peNormalized: number | null;
}

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
  // right below the verdict, alongside the real number, never in place of
  // it (see CompanyDiagnosticMarginAlert's sibling render in the card).
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
    waccDetails: { method: "capm", wacc_pct: 9.2 },
    peForward: 16.8,
    peNormalized: 17.5,
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
