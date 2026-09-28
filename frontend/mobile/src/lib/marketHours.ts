import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

// NYSE trading-hours logic + a last-known-prices cache — shared by every
// screen that shows the portfolio value (Portafolio, Home). Diego,
// 2026-09-27: "el valor del portafolio solo se actualice en horario de
// mercado, fuera de ese horario deja el número fijo SIEMPRE, no quiero que
// esté cargando y cargando". Outside market hours the value comes from the
// last saved prices, instantly, and is never polled; the only network call
// is one silent fetch right after the close to capture the final prices.
// Same rules as web's lib/marketHours.ts.

function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(year, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
}

function nthWeekday(y: number, month: number, n: number, weekday: number): Date {
  const first = new Date(y, month, 1);
  return new Date(y, month, 1 + ((weekday - first.getDay() + 7) % 7) + (n - 1) * 7);
}

function lastWeekday(y: number, month: number, weekday: number): Date {
  const last = new Date(y, month + 1, 0);
  return new Date(y, month, last.getDate() - ((last.getDay() - weekday + 7) % 7));
}

function observed(d: Date): Date {
  const w = d.getDay();
  if (w === 6) return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  if (w === 0) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return d;
}

const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function holidays(year: number): Set<string> {
  const h = new Set<string>();
  h.add(key(observed(new Date(year, 0, 1))));
  h.add(key(nthWeekday(year, 0, 3, 1)));
  h.add(key(nthWeekday(year, 1, 3, 1)));
  const gf = easterSunday(year); gf.setDate(gf.getDate() - 2); h.add(key(gf));
  h.add(key(lastWeekday(year, 4, 1)));
  if (year >= 2022) h.add(key(observed(new Date(year, 5, 19))));
  h.add(key(observed(new Date(year, 6, 4))));
  h.add(key(nthWeekday(year, 8, 1, 1)));
  h.add(key(nthWeekday(year, 10, 4, 4)));
  h.add(key(observed(new Date(year, 11, 25))));
  return h;
}

// Early 1:00pm ET close — day after Thanksgiving and Christmas Eve (same two
// days the backend's early-close awareness covers).
function isEarlyClose(y: number, m: number, d: number): boolean {
  const thanksgiving = nthWeekday(y, 10, 4, 4);
  const dayAfter = new Date(y, 10, thanksgiving.getDate() + 1);
  return key(new Date(y, m, d)) === key(dayAfter) || (m === 11 && d === 24);
}

interface EtParts { y: number; m: number; d: number; weekday: string; mins: number }

function etParts(date: Date): EtParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric",
    year: "numeric", month: "numeric", day: "numeric", hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = parseInt(get("hour")) % 24;
  return { y: parseInt(get("year")), m: parseInt(get("month")) - 1, d: parseInt(get("day")), weekday: get("weekday"), mins: hour * 60 + parseInt(get("minute")) };
}

function isTradingDay(y: number, m: number, d: number): boolean {
  const w = new Date(y, m, d).getDay();
  return w !== 0 && w !== 6 && !holidays(y).has(key(new Date(y, m, d)));
}

const closeMins = (y: number, m: number, d: number) => (isEarlyClose(y, m, d) ? 13 * 60 : 16 * 60);

export function isNYSEOpen(now: Date = new Date()): boolean {
  try {
    const p = etParts(now);
    if (!isTradingDay(p.y, p.m, p.d)) return false;
    return p.mins >= 9 * 60 + 30 && p.mins < closeMins(p.y, p.m, p.d);
  } catch {
    return true; // can't tell → behave like before (keep refreshing)
  }
}

// UTC instant of an ET wall-clock time (handles DST).
function etWallToUtc(y: number, m: number, d: number, mins: number): number {
  const guess = Date.UTC(y, m, d, Math.floor(mins / 60), mins % 60);
  const p = etParts(new Date(guess));
  const guessEtMins = Date.UTC(p.y, p.m, p.d, Math.floor(p.mins / 60), p.mins % 60);
  return guess + (guess - guessEtMins);
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

// ── Last-known prices, per user ───────────────────────────────────────────
export interface PriceCache { prices: Record<string, any>; fetchedAt: number }

const CACHE_KEY = "nuvos_price_cache_v1";
// Final prints can land a minute or two after the bell.
const CLOSE_SETTLE_MS = 3 * 60 * 1000;

async function cacheKey(): Promise<string> {
  const uid = (await SecureStore.getItemAsync("user_id").catch(() => null)) ?? "guest";
  return `${CACHE_KEY}__${uid}`;
}

export async function readPriceCache(): Promise<PriceCache | null> {
  try {
    const raw = await AsyncStorage.getItem(await cacheKey());
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.prices && parsed?.fetchedAt ? parsed : null;
  } catch { return null; }
}

export async function writePriceCache(prices: Record<string, any>): Promise<void> {
  try {
    const prev = await readPriceCache();
    const next: PriceCache = { prices: { ...(prev?.prices ?? {}), ...prices }, fetchedAt: Date.now() };
    await AsyncStorage.setItem(await cacheKey(), JSON.stringify(next));
  } catch { /* best-effort */ }
}

// True when the value should be refreshed: market open, or the cache is
// missing a ticker, or it predates the latest close (+ settle time).
export function needsPriceRefresh(cache: PriceCache | null, tickers: string[]): boolean {
  if (isNYSEOpen()) return true;
  if (!cache) return true;
  if (tickers.some((t) => !(t in cache.prices))) return true;
  const close = lastMarketCloseMs();
  return cache.fetchedAt < close + CLOSE_SETTLE_MS && Date.now() >= close + CLOSE_SETTLE_MS;
}
