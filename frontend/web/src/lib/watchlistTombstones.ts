// Durable record of tickers the user deleted from their watchlist. A delete
// must be permanent: if the server DELETE fails, the tab closes mid-retry, or
// a stale/other-device read still returns the ticker, it must never come back.
// Tombstones live in localStorage (per user) until a server read confirms the
// ticker is really gone; while it isn't, every read filters it out and the
// DELETE is re-issued in the background. Re-adding a ticker clears its
// tombstone.

const key = (uid: string | null) => `nuvos_watchlist_tombstones__${uid ?? "guest"}`;

function read(uid: string | null): string[] {
  try {
    const raw = localStorage.getItem(key(uid));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function write(uid: string | null, list: string[]) {
  try { localStorage.setItem(key(uid), JSON.stringify(list)); } catch {}
}

export function addTombstone(uid: string | null, ticker: string) {
  const t = ticker.toUpperCase();
  const list = read(uid);
  if (!list.includes(t)) write(uid, [...list, t]);
}

export function clearTombstone(uid: string | null, ticker: string) {
  const t = ticker.toUpperCase();
  const list = read(uid);
  if (list.includes(t)) write(uid, list.filter((x) => x !== t));
}

/** Filters tombstoned tickers out of a server list, re-issues their DELETE,
 *  and drops tombstones the server no longer returns. */
export function applyTombstones<T extends { ticker: string }>(uid: string | null, serverItems: T[]): T[] {
  const list = read(uid);
  if (list.length === 0) return serverItems;
  const present = new Set(serverItems.map((i) => i.ticker.toUpperCase()));
  const stillThere = list.filter((t) => present.has(t));
  if (stillThere.length !== list.length) write(uid, stillThere);
  if (stillThere.length > 0) {
    import("./api").then(({ watchlist }) => {
      stillThere.forEach((t) => { watchlist.remove(t).catch(() => {}); });
    });
  }
  return serverItems.filter((i) => !stillThere.includes(i.ticker.toUpperCase()));
}
