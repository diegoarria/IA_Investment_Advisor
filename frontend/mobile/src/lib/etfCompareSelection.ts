// Fase 9C §5: lógica pura de selección para el Comparador de ETFs —
// mismos límites que el backend (backend/app/services/etf/comparison.py:
// MIN_COMPARE=2, MAX_COMPARE=3). Nunca permite duplicados ni exceder el
// máximo; el componente solo le pasa el estado actual y el ticker que
// el usuario intentó agregar.
export const MIN_COMPARE = 2;
export const MAX_COMPARE = 3;

export type AddToCompareResult = {
  selected: string[];
  error: "max_reached" | "already_added" | null;
};

export function addToCompareSelection(selected: string[], ticker: string, max: number = MAX_COMPARE): AddToCompareResult {
  const t = ticker.trim().toUpperCase();
  if (selected.includes(t)) return { selected, error: "already_added" };
  if (selected.length >= max) return { selected, error: "max_reached" };
  return { selected: [...selected, t], error: null };
}

export function removeFromCompareSelection(selected: string[], ticker: string): string[] {
  const t = ticker.trim().toUpperCase();
  return selected.filter((s) => s !== t);
}

export function canCompare(selected: string[], min: number = MIN_COMPARE): boolean {
  return selected.length >= min;
}
