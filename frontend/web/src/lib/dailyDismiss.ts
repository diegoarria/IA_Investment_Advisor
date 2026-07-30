// Small helper for "dismiss until tomorrow" UI (e.g. the Morning Brief
// card) — distinct from every other dismiss pattern in this codebase,
// which are all permanent (dismiss once, never show again). Anchored to
// America/New_York so "today" lines up with the backend's ET-anchored
// per-day cache key for the same data.

function todayET(): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the ISO date string we want.
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export function isDismissedToday(key: string): boolean {
  try {
    return localStorage.getItem(key) === todayET();
  } catch {
    return false;
  }
}

export function dismissToday(key: string): void {
  try {
    localStorage.setItem(key, todayET());
  } catch {
    // Safari Private Browsing etc. — worst case the card reappears, not a big deal.
  }
}
