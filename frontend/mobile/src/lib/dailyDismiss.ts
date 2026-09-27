import AsyncStorage from "@react-native-async-storage/async-storage";

// Small helper for "dismiss until tomorrow" UI (e.g. the Morning Brief
// card) — distinct from every other dismiss pattern in this codebase,
// which are all permanent. Anchored to America/New_York so "today" lines
// up with the backend's ET-anchored per-day cache key for the same data.

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export async function isDismissedToday(key: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key)) === todayET();
  } catch {
    return false;
  }
}

export function dismissToday(key: string): void {
  AsyncStorage.setItem(key, todayET()).catch(() => {});
}

// Morning Brief only runs Monday-Friday (Diego, 2026-09-27) — same ET
// calendar as the 9:15am push and the backend's per-day cache.
export function isWeekdayET(): boolean {
  try {
    const wd = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" });
    return wd !== "Sat" && wd !== "Sun";
  } catch {
    const d = new Date().getDay();
    return d !== 0 && d !== 6;
  }
}
