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

export function isNYSEOpen(): boolean {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";

  const day = get("weekday");
  if (day === "Sat" || day === "Sun") return false;

  const year  = parseInt(get("year"));
  const month = parseInt(get("month")) - 1; // 0-indexed
  const date  = parseInt(get("day"));
  if (usMarketHolidays(year).has(`${year}-${month}-${date}`)) return false;

  const mins = parseInt(get("hour")) * 60 + parseInt(get("minute"));
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}
