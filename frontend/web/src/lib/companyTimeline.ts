// Fase 4, Incremento 5 — Timeline interactiva (Parte F). Pure logic for the
// company timeline, split out of the presentational component per Parte O
// (and this repo's lack of a JSX-aware vitest harness, same reasoning as
// src/lib/peerComparison.ts).
//
// This is the COMPANY's own objective event history (Fase 3's Change
// Detection Engine, via GET /api/research-engine/company/{ticker}/timeline)
// — not to be confused with `investment_graph_service`'s per-user activity
// log (InvestmentGraphTimeline.tsx). Different event vocabulary
// (ceo_change/ma/spinoff/... vs question/thesis/watchlist_add/...), so a
// new, parallel presentational component (CompanyTimeline.tsx) was built
// instead of forcing this data into InvestmentGraphTimeline's per-user
// switch statement — see that component's own file for why reusing it
// literally would mean fabricating a payload shape it wasn't built for.

export interface CompanyTimelineEvent {
  id?: string;
  ticker: string;
  event_date: string | null;
  event_type: string;
  headline: string;
  detail?: Record<string, unknown> | null;
  created_at?: string;
}

export const TIMELINE_EVENT_TYPES = [
  "ceo_change", "ma", "spinoff", "product_launch", "new_segment", "regulatory",
  "guidance_change", "margin_shift", "revenue_shift", "strategy_change", "other",
] as const;

/** Real chronological order (most recent first) — `event_date` is
 * preferred (the real date of the event itself); falls back to
 * `created_at` (when the event was detected) only if `event_date` is
 * unknown, never fabricating a date. */
export function sortTimelineEventsDesc(events: CompanyTimelineEvent[]): CompanyTimelineEvent[] {
  return [...events].sort((a, b) => {
    const aKey = a.event_date ?? a.created_at ?? "";
    const bKey = b.event_date ?? b.created_at ?? "";
    return bKey.localeCompare(aKey);
  });
}
