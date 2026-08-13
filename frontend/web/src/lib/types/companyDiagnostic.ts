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
  peHistoricalAvg: number;
  evFcf: number;
}

export interface CompanyDiagnosticData {
  ticker: string;
  companyName: string;
  sector: string;
  exchange: string;
  score: number; // 0-100
  scoreLabel: string;
  badges: string[];
  oneLinerPitch: string;
  revenueBreakdown: { category: string; percentage: number }[];
  moatPoints: string[];
  competitorComparison: {
    competitorName: string;
    rows: CompetitorComparison[];
    conclusion: string;
  };
  financialHealth: {
    longTermDebt: string;
    netCash: string;
    roic: string;
    operatingMargin: string;
    netMargin: string;
    operatingCashFlow: string;
  };
  valuation: ValuationScenarios;
  noiseVsReality: {
    marketSaw: string;
    nuvosReality: string;
  };
  actionPlan: {
    profile: string;
    strategy: string;
  };
}

export const mockCopartData: CompanyDiagnosticData = {
  ticker: "CPRT",
  companyName: "Copart, Inc.",
  sector: "Technology / Industrial",
  exchange: "NASDAQ",
  score: 88,
  scoreLabel: "Calidad Máxima + Descuento",
  badges: ["Moat Impenetrable", "Cero Deuda", "Líder Indiscutible"],
  oneLinerPitch: "El gigante de las subastas de vehículos en EE. UU., con $3,400M en caja y sin deuda, cotizando a su múltiplo más bajo en una década por un ajuste temporal del sector.",
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
  valuation: {
    currentPrice: 29.00,
    conservative: 34.50,
    baseFairValue: 42.50,
    optimistic: 50.50,
    marginOfSafetyPercent: 31.7,
    peCurrent: 17.5,
    peHistoricalAvg: 32.5,
    evFcf: 16.0,
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
