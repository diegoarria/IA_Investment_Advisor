// Fase 9C §2: hasta ~1,254 puntos reales por serie (5 años diarios) no
// aportan nada visualmente en una pantalla de teléfono y sí cuestan CPU
// de más al dibujar un polyline innecesariamente largo. En vez de un
// límite fijo, se deriva de los píxeles REALES del gráfico medidos por
// onLayout (≈2.5dp por punto es suficientemente denso para que ninguna
// forma real de la curva se pierda, sin dibujar puntos que ningún ojo
// puede distinguir). Pura y sin React Native — HistoryComparisonChart
// solo le pasa el ancho medido; nunca inventa ni interpola un punto,
// solo decide cuántos de los reales conservar vía
// historyChartDownsample.buildDisplaySeries.
export function maxPointsForWidth(widthPx: number): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return 120; // fallback antes de la primera medición real
  return Math.min(220, Math.max(60, Math.round(widthPx / 2.5)));
}
