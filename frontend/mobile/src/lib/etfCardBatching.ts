// Fase 9D §2: lógica pura del Explorador de ETFs para decidir qué pedir
// a /api/etf/cards — extraída de app/etf/index.tsx para poder probarla
// sin reconstruir un componente completo. Nunca pide más de lo visible
// (PAGE_SIZE por lote) y nunca repite un ticker que ya está en caché,
// para no gastar presupuesto de FMP en peticiones redundantes.
export function ticketsToFetch(
  activeTickers: string[],
  visibleCount: number,
  cached: Record<string, unknown>
): string[] {
  return activeTickers.slice(0, visibleCount).filter((tk) => !cached[tk]);
}

export function hasMoreToLoad(activeTickers: string[] | null, visibleCount: number): boolean {
  return !!activeTickers && visibleCount < activeTickers.length;
}

export function visibleSlice(activeTickers: string[] | null, visibleCount: number): string[] {
  return activeTickers?.slice(0, visibleCount) ?? [];
}
