// NYSE US market holiday calculation — no external dependencies.

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-indexed
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

function usMarketHolidays(year: number): Set<string> {
  // nth occurrence of weekday (0=Sun..6=Sat) in a given month (0-indexed)
  function nthWeekday(y: number, month: number, n: number, weekday: number): Date {
    const first = new Date(y, month, 1);
    const offset = (weekday - first.getDay() + 7) % 7;
    return new Date(y, month, 1 + offset + (n - 1) * 7);
  }

  // Last occurrence of weekday in month (0-indexed)
  function lastWeekday(y: number, month: number, weekday: number): Date {
    const last = new Date(y, month + 1, 0);
    const offset = (last.getDay() - weekday + 7) % 7;
    return new Date(y, month, last.getDate() - offset);
  }

  // Saturday → Friday, Sunday → Monday
  function observed(d: Date): Date {
    const w = d.getDay();
    if (w === 6) return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    if (w === 0) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    return d;
  }

  function key(d: Date): string {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  const h = new Set<string>();
  h.add(key(observed(new Date(year, 0, 1))));        // New Year's Day
  h.add(key(nthWeekday(year, 0, 3, 1)));             // MLK Day — 3rd Mon Jan
  h.add(key(nthWeekday(year, 1, 3, 1)));             // Presidents' Day — 3rd Mon Feb
  const goodFriday = new Date(easterSunday(year));
  goodFriday.setDate(goodFriday.getDate() - 2);
  h.add(key(goodFriday));                            // Good Friday
  h.add(key(lastWeekday(year, 4, 1)));               // Memorial Day — last Mon May
  if (year >= 2022) {
    h.add(key(observed(new Date(year, 5, 19))));     // Juneteenth — Jun 19
  }
  h.add(key(observed(new Date(year, 6, 4))));        // Independence Day — Jul 4
  h.add(key(nthWeekday(year, 8, 1, 1)));             // Labor Day — 1st Mon Sep
  h.add(key(nthWeekday(year, 10, 4, 4)));            // Thanksgiving — 4th Thu Nov
  h.add(key(observed(new Date(year, 11, 25))));      // Christmas — Dec 25
  return h;
}

// Early 1:00pm ET close — day after Thanksgiving and Christmas Eve (same two
// days the backend's early-close awareness covers).
function isEarlyClose(y: number, m: number, d: number): boolean {
  const first = new Date(y, 10, 1);
  const thanksgiving = 1 + ((4 - first.getDay() + 7) % 7) + 21;
  return (m === 10 && d === thanksgiving + 1) || (m === 11 && d === 24);
}

interface EtParts { y: number; m: number; d: number; weekday: string; mins: number }

function etParts(date: Date): EtParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short", hour: "numeric", minute: "numeric",
    year: "numeric", month: "numeric", day: "numeric", hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = parseInt(get("hour")) % 24;
  return { y: parseInt(get("year")), m: parseInt(get("month")) - 1, d: parseInt(get("day")), weekday: get("weekday"), mins: hour * 60 + parseInt(get("minute")) };
}

function isTradingDay(y: number, m: number, d: number): boolean {
  const w = new Date(y, m, d).getDay();
  return w !== 0 && w !== 6 && !usMarketHolidays(y).has(`${y}-${m}-${d}`);
}

const closeMins = (y: number, m: number, d: number) => (isEarlyClose(y, m, d) ? 13 * 60 : 16 * 60);

export function isNYSEOpen(now: Date = new Date()): boolean {
  const p = etParts(now);
  if (!isTradingDay(p.y, p.m, p.d)) return false;
  return p.mins >= 9 * 60 + 30 && p.mins < closeMins(p.y, p.m, p.d);
}

// UTC instant of an ET wall-clock time (handles DST).
function etWallToUtc(y: number, m: number, d: number, mins: number): number {
  const guess = Date.UTC(y, m, d, Math.floor(mins / 60), mins % 60);
  const p = etParts(new Date(guess));
  const guessEt = Date.UTC(p.y, p.m, p.d, Math.floor(p.mins / 60), p.mins % 60);
  return guess + (guess - guessEt);
}

// The most recent regular-session close at or before `now`.
export function lastMarketCloseMs(now: Date = new Date()): number {
  const p = etParts(now);
  for (let back = 0; back < 12; back++) {
    const day = new Date(p.y, p.m, p.d - back);
    const y = day.getFullYear(), m = day.getMonth(), d = day.getDate();
    if (!isTradingDay(y, m, d)) continue;
    const close = etWallToUtc(y, m, d, closeMins(y, m, d));
    if (close <= now.getTime()) return close;
  }
  return 0;
}

// ── Last-known prices, per user (Diego, 2026-09-27) ───────────────────────
// "el valor del portafolio solo se actualice en horario de mercado, fuera de
// ese horario deja el número fijo SIEMPRE, no quiero que esté cargando".
// Outside market hours the value comes from these saved prices, instantly,
// never polled; the only call is one silent fetch right after the close to
// lock in the final prices. Same rules as mobile's lib/marketHours.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface PriceCache { prices: Record<string, any>; fetchedAt: number }

const CLOSE_SETTLE_MS = 3 * 60 * 1000; // final prints land a minute or two after the bell
const cacheKey = (userId: string | null) => `nuvos_price_cache_v1__${userId ?? "guest"}`;

export function readPriceCache(userId: string | null): PriceCache | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.prices && parsed?.fetchedAt ? parsed : null;
  } catch { return null; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function writePriceCache(userId: string | null, prices: Record<string, any>): void {
  try {
    const prev = readPriceCache(userId);
    localStorage.setItem(cacheKey(userId), JSON.stringify({ prices: { ...(prev?.prices ?? {}), ...prices }, fetchedAt: Date.now() }));
  } catch { /* best-effort */ }
}

// True when the value should be refreshed: market open, or the cache is
// missing a ticker, or it predates the latest close (+ settle time).
export function needsPriceRefresh(cache: PriceCache | null, tickers: string[], now: Date = new Date()): boolean {
  if (isNYSEOpen(now)) return true;
  if (!cache) return true;
  if (tickers.some((t) => !(t in cache.prices))) return true;
  const close = lastMarketCloseMs(now);
  return cache.fetchedAt < close + CLOSE_SETTLE_MS && now.getTime() >= close + CLOSE_SETTLE_MS;
}
