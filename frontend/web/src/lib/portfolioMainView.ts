// Nuvos — Fase 7.1: la lógica pura de navegación del selector principal
// de Portafolio (Posiciones | Distribución | Antes de invertir),
// extraída de portfolio/page.tsx para poder probarla de forma aislada
// sin un harness gigante para las ~4,300 líneas de esa página. Nunca
// toca estado de React, nunca llama a un proveedor — solo decide qué
// mostrar/ocultar a partir del valor actual de `mainView`.
export type PortfolioMainView = "posiciones" | "distribucion" | "antes_de_invertir";

export type TabVisibility = {
  showPosiciones: boolean;
  showDistribucion: boolean;
  // "Antes de invertir" (BeforeAfterSimulator) se mantiene SIEMPRE
  // montado — solo se oculta con CSS, nunca se desmonta — para conservar
  // la garantía ya probada en Fase 4D: un escenario hipotético en curso
  // nunca se pierde al cambiar de vista y volver. Por eso esta función
  // devuelve un valor de `display` CSS, no un booleano de montaje.
  simulatorDisplay: "block" | "none";
  // Fase 7.1 §2: una sola entrada "Explícame esto" visible a la vez.
  // Distribución ya muestra su propio botón contextual
  // (screen="portfolio_distribution") — el flotante original de
  // Portafolio se oculta únicamente ahí.
  showFloatingExplainButton: boolean;
};

export function computeTabVisibility(mainView: PortfolioMainView): TabVisibility {
  return {
    showPosiciones: mainView === "posiciones",
    showDistribucion: mainView === "distribucion",
    simulatorDisplay: mainView === "antes_de_invertir" ? "block" : "none",
    showFloatingExplainButton: mainView !== "distribucion",
  };
}
