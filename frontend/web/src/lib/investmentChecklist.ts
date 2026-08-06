// Fase 4, Incremento 8 (Investment Checklist, Parte H) — pure client-side
// logic for the checklist gate. Mirrors the server-side rule in
// backend/app/api/routes/checklist.py's set_investable_route (every current
// item must be checked before marking a ticker "Invertible") so the
// frontend can disable the button without a round-trip, but the backend is
// still the real source of truth — this never substitutes for that check.

export type ChecklistItem = {
  item_key: string;
  label: string | null;
  is_custom: boolean;
  checked: boolean;
};

export const DEFAULT_CHECKLIST_ITEM_KEYS = [
  "understand_business",
  "know_risks",
  "read_thesis",
  "margin_of_safety",
  "moat_still_valid",
  "loss_scenario",
] as const;

export function pendingChecklistItems(items: ChecklistItem[]): ChecklistItem[] {
  return items.filter((item) => !item.checked);
}

export function isChecklistComplete(items: ChecklistItem[]): boolean {
  return items.length > 0 && pendingChecklistItems(items).length === 0;
}

export function checklistProgress(items: ChecklistItem[]): { checked: number; total: number } {
  return { checked: items.length - pendingChecklistItems(items).length, total: items.length };
}
