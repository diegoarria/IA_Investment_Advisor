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
  add: (ticker: string, name: string) => void;
  remove: (ticker: string) => void;
  reorder: (from: number, to: number) => void;
  has: (ticker: string) => boolean;
  loadFromServer: () => Promise<void>;
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

      add: (ticker, name) => {
        const t = ticker.toUpperCase();
        if (get().items.find((i) => i.ticker === t)) return;
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
        set((s) => ({ items: s.items.filter((i) => i.ticker !== t) }));
        beginPending();
        watchlistServerApi
          .remove(t)
          .catch(() => {})
          .finally(endPending);
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
          let serverItems = toItems(await watchlistServerApi.getAll());
          // A 200 with an empty body is ambiguous: it may be a real empty
          // watchlist (e.g. another device just deleted the last item), or a
          // transient blip returning a false empty despite the backend's own
          // double-check (see GET /watchlist's fresh-client re-verify,
          // 2026-09-16 — that guards the DB read, not this HTTP round-trip).
          // Never let a single empty response wipe a non-empty local cache
          // outright — re-confirm once before trusting it. Mirrors web's
          // watchlist store fix, same date.
          if (serverItems.length === 0 && get().items.length > 0) {
            serverItems = toItems(await watchlistServerApi.getAll());
          }
          set({ items: serverItems });
        } catch {}
      },
      };
    },
    {
      name: "watchlist",
      storage: userScopedStorage,
      // Only persist items — runtime flags stay in-memory
      partialize: (state) => ({ items: state.items }),
    }
  )
);
