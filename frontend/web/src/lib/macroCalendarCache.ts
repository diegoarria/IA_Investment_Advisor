// Diego, 2026-10-02: "los eventos macro se queden fijos en el calendario
// para siempre". The calendar used to REPLACE its macro list with each
// response, and each response only covered today-3 → +45 days, so a release
// vanished from the calendar 3 days after it happened, months past +45 were
// empty, and a response carrying only the market holidays (no macro rows)
// wiped every macro event. Now:
//
// - Every event ever shown is kept in localStorage, per language.
// - A response only replaces events inside the date window it says it
//   covers (`window`); everything outside it stays.
// - A response with no macro events (macro_count 0) never touches them.
// - "past / today / upcoming" is recomputed from today's date on every
//   render, so a cached event never shows a stale status.
// Mirror of the mobile app's macroCalendarCache.ts — keep both in sync.

export const MACRO_DAYS_BEHIND = 400;
export const MACRO_DAYS_AHEAD = 180;
const HISTORY_KEEP_DAYS = 800;

export interface CachedMacroEvent {
  event_id: string;
  event_type: string;
  event_date_utc: string;
  date_et: string;
  status: "upcoming" | "today" | "past";
}

interface MacroResponse<E> {
  events?: E[];
  macro_count?: number;
  window?: { from: string; to: string };
}

const isMarketDay = (e: { event_type: string }) => e.event_type.startsWith("market_");

/** Today's date in New York (the calendar's reference timezone), YYYY-MM-DD. */
export function todayET(): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function withFreshStatus<E extends CachedMacroEvent>(events: E[], today = todayET()): E[] {
  return events.map((e) => {
    const status = e.date_et < today ? "past" : e.date_et === today ? "today" : "upcoming";
    return e.status === status ? e : { ...e, status };
  });
}

/** Merges a fresh response into the cached list. Returns null when the
 *  response carries nothing usable (keep what is on screen). */
export function mergeMacroEvents<E extends CachedMacroEvent>(cached: E[], res: MacroResponse<E>, today = todayET()): E[] | null {
  const incoming = res.events ?? [];
  if (incoming.length === 0) return null;
  const incomingMacro = incoming.filter((e) => !isMarketDay(e));
  const incomingMarket = incoming.filter(isMarketDay);
  const from = res.window?.from ?? shiftDays(today, -3);
  const to = res.window?.to ?? (incomingMacro.length ? incomingMacro.reduce((m, e) => (e.date_et > m ? e.date_et : m), today) : today);

  const cachedMacro = cached.filter((e) => !isMarketDay(e));
  const macroUsable = (res.macro_count ?? incomingMacro.length) > 0;
  const macro = macroUsable
    ? [...cachedMacro.filter((e) => e.date_et < from || e.date_et > to), ...incomingMacro]
    : cachedMacro;
  const market = incomingMarket.length ? incomingMarket : cached.filter(isMarketDay);

  const oldest = shiftDays(today, -HISTORY_KEEP_DAYS);
  const byId = new Map<string, E>();
  for (const e of [...macro, ...market]) if (e.date_et >= oldest) byId.set(e.event_id, e);
  return withFreshStatus([...byId.values()].sort((a, b) => a.event_date_utc.localeCompare(b.event_date_utc)), today);
}

const storageKey = (lang: string) => `nuvos_macro_calendar_v2__${lang}`;

export function readMacroCache<E extends CachedMacroEvent>(lang: string): E[] {
  try {
    const raw = localStorage.getItem(storageKey(lang)) ?? localStorage.getItem("nuvos_macro_calendar_v1");
    return raw ? withFreshStatus(JSON.parse(raw) as E[]) : [];
  } catch {
    return [];
  }
}

export function writeMacroCache<E extends CachedMacroEvent>(lang: string, events: E[]): void {
  try { localStorage.setItem(storageKey(lang), JSON.stringify(events)); } catch { /* storage unavailable */ }
}
