import { create } from "zustand";
import { persist } from "zustand/middleware";
import { userScopedStorage } from "./userScopedStorage";
import { watchlistServerApi } from "./api";

export interface WatchItem {
  ticker: string;
  name: string;
  addedAt: number;
}

interface WatchlistStore {
  items: WatchItem[];
  pendingSync: boolean;
  // When pendingSync was last set to true. Used to detect a flag stuck from
  // a remove() call that never resolved, so loadFromServer() doesn't defer
  // to it forever.
  pendingSyncSetAt: number | null;
  // Diego, 2026-10-03: "nunca nunca nunca debe desaparecer". Durable record
  // of tickers this user deleted — mirrors web's watchlistTombstones.ts.
  // Without this, a remove() whose DELETE genuinely failed after retrying
  // (real outage) left the ticker merely hidden in memory: closing and
  // reopening the app re-hydrated the persisted store, the next
  // loadFromServer() read the server's unchanged copy, and the "deleted"
  // ticker silently came back — reading to the user as the watchlist
  // randomly resurrecting an item, or (if they deleted it again, confused)
  // repeatedly "fighting" to keep it gone.
  tombstones: string[];
  add: (ticker: string, name: string) => void;
  remove: (ticker: string) => void;
  reorder: (from: number, to: number) => void;
  has: (ticker: string) => boolean;
  loadFromServer: () => Promise<void>;
}

// Per-ticker consecutive-miss counter — module scope (not persisted; a
// cold start has no history to protect yet, which is correct: the very
// first read of a session has nothing to defend against losing).
const missStreak = new Map<string, number>();
// Tickers with a remove() retry currently in flight — a loadFromServer()
// landing mid-retry must not resurrect them just because the server
// hasn't committed the delete yet.
const pendingRemoves = new Set<string>();

/** Call on account switch (same place persist.rehydrate() is already called
 *  for this store) — missStreak/pendingRemoves are module-level, not part
 *  of the per-user persisted state, so without this a ticker's miss count
 *  could carry over from the previous signed-in account on the same device. */
export function resetWatchlistSyncState(): void {
  missStreak.clear();
  pendingRemoves.clear();
}

export const useWatchlistStore = create<WatchlistStore>()(
  persist(
    (set, get) => {
      // A plain boolean pendingSync flag has its own race when add()/
      // remove() overlap (two rapid watchlist edits, one mid-retry): each
      // op's own .finally() cleared the SHARED flag as soon as ITS OWN
      // retry loop settled, even while another op was still in flight — so
      // loadFromServer() landing in that window could still wipe the
      // still-unconfirmed one. A depth counter fixes it: only clear
      // pendingSync once every in-flight add/remove has settled. Confirmed
      // via adversarial code review, 2026-09-16 (same fix applied to
      // paperStore.ts and web's store.ts).
      let pendingCount = 0;
      const beginPending = () => {
        pendingCount++;
        set({ pendingSync: true, pendingSyncSetAt: Date.now() });
      };
      const endPending = () => {
        pendingCount = Math.max(0, pendingCount - 1);
        if (pendingCount === 0) set({ pendingSync: false, pendingSyncSetAt: null });
      };
      return {
      items: [],
      pendingSync: false,
      pendingSyncSetAt: null,
      tombstones: [],

      add: (ticker, name) => {
        const t = ticker.toUpperCase();
        if (get().items.find((i) => i.ticker === t)) return;
        set((s) => ({ tombstones: s.tombstones.filter((x) => x !== t) }));
        // remove() already guarded loadFromServer() with this flag; add()
        // didn't, and fired the POST with a bare .catch(() => {}) — a
        // single transient failure silently dropped the add server-side
        // while the optimistic item stayed shown until the next
        // loadFromServer() (app foreground resume) wiped it back out.
        // Same fix as web's store.ts (2026-09-15): retry with backoff,
        // and guard against a concurrent resync stomping the optimistic
        // item mid-retry.
        set((s) => ({ items: [...s.items, { ticker: t, name, addedAt: Date.now() }] }));
        beginPending();
        (async () => {
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await watchlistServerApi.add(t, name);
              return;
            } catch (err: any) {
              if (err?.response?.status === 409) return; // already in list server-side
              if (attempt === 2) {
                set((s) => ({ items: s.items.filter((i) => i.ticker !== t) }));
                return;
              }
              await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
            }
          }
        })().finally(endPending);
      },

      remove: (ticker) => {
        const t = ticker.toUpperCase();
        // Flag pendingSync so a loadFromServer() already in flight (e.g. an
        // app-foreground resync) can't land mid-delete and resurrect this
        // item from a response that was fetched before the delete landed.
        set((s) => ({ items: s.items.filter((i) => i.ticker !== t), tombstones: [...s.tombstones.filter((x) => x !== t), t] }));
        pendingRemoves.add(t);
        beginPending();
        (async () => {
          // Retried with backoff, matching add() — a bare fire-and-forget
          // DELETE used to leave an item removed locally forever even on a
          // purely transient failure, with nothing to retry it. The
          // tombstone above is the real backstop if every retry fails: it
          // keeps the ticker hidden and gets re-sent on the next
          // loadFromServer() (see applyTombstonesLocal below) instead of
          // silently letting the server's stale copy win.
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await watchlistServerApi.remove(t);
              return;
            } catch {
              if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
            }
          }
        })().finally(() => { pendingRemoves.delete(t); endPending(); });
      },

      reorder: (from, to) => {
        const arr = [...get().items];
        if (from < 0 || to < 0 || from >= arr.length || to >= arr.length || from === to) return;
        const [moved] = arr.splice(from, 1);
        arr.splice(to, 0, moved);
        set({ items: arr });
      },

      has: (ticker) => !!get().items.find((i) => i.ticker === ticker.toUpperCase()),

      loadFromServer: async () => {
        try {
          const { pendingSync, pendingSyncSetAt } = get();
          // Stuck flag (or none at all, persisted from before this field
          // existed) means whatever remove() set it never resolved — don't
          // defer to it forever.
          const isStale = pendingSyncSetAt == null || Date.now() - pendingSyncSetAt > 2 * 60 * 1000;
          if (pendingSync && !isStale) return;
          if (pendingSync && isStale) { pendingCount = 0; set({ pendingSync: false, pendingSyncSetAt: null }); }

          const toItems = (res: { data: Array<{ ticker: string; name: string; added_at?: string }> }): WatchItem[] =>
            res.data.map((item) => ({
              ticker: item.ticker,
              name: item.name || item.ticker,
              addedAt: item.added_at ? new Date(item.added_at).getTime() : Date.now(),
            }));
          const serverItems = toItems(await watchlistServerApi.getAll());

          // Diego, 2026-10-03: "nunca nunca nunca" — a single flaky read
          // (the whole response empty, or missing some tickers the app
          // already knows about) must never make the watchlist blink.
          // Merge instead of replace: any ticker this app already shows
          // that the server didn't return gets kept for up to 2 more
          // consecutive reads (self-heals within ~15-30s on a real app-
          // foreground cadence) before it's trusted as a genuine removal —
          // mirrors web watchlist/page.tsx's per-ticker miss-streak,
          // 2026-09-19/20. Tombstoned tickers (a pending local delete) are
          // the one case that's never kept, re-deleting them instead.
          const serverTickers = new Set(serverItems.map((i) => i.ticker));
          const { tombstones } = get();
          let merged = serverItems;
          let anyKept = false;
          const keptTombstones: string[] = [];
          for (const t of tombstones) {
            if (serverTickers.has(t)) {
              // Server still has it — re-issue the delete and keep hiding it.
              watchlistServerApi.remove(t).catch(() => {});
              keptTombstones.push(t);
              merged = merged.filter((i) => i.ticker !== t);
            }
            // else: server already agrees it's gone — tombstone served its purpose, drop it.
          }
          for (const local of get().items) {
            if (serverTickers.has(local.ticker) || pendingRemoves.has(local.ticker) || keptTombstones.includes(local.ticker)) continue;
            const n = (missStreak.get(local.ticker) ?? 0) + 1;
            if (n < 3) {
              missStreak.set(local.ticker, n);
              merged = [...merged, local];
              anyKept = true;
            } else {
              missStreak.delete(local.ticker);
            }
          }
          for (const t of serverTickers) missStreak.delete(t); // present again — reset its streak
          set({ items: merged, tombstones: keptTombstones });
          if (anyKept) setTimeout(() => useWatchlistStore.getState().loadFromServer(), 5000);
        } catch {}
      },
      };
    },
    {
      name: "watchlist",
      storage: userScopedStorage,
      // Only persist items + tombstones — runtime flags stay in-memory
      partialize: (state) => ({ items: state.items, tombstones: state.tombstones }),
    }
  )
);
