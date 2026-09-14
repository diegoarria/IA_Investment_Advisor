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
    (set, get) => ({
      items: [],
      pendingSync: false,
      pendingSyncSetAt: null,

      add: (ticker, name) => {
        const t = ticker.toUpperCase();
        if (get().items.find((i) => i.ticker === t)) return;
        set((s) => ({ items: [...s.items, { ticker: t, name, addedAt: Date.now() }] }));
        // Optimistic — sync to server in background
        watchlistServerApi.add(t, name).catch(() => {});
      },

      remove: (ticker) => {
        const t = ticker.toUpperCase();
        set((s) => ({
          items: s.items.filter((i) => i.ticker !== t),
          // Flag pendingSync so a loadFromServer() already in flight (e.g. an
          // app-foreground resync) can't land mid-delete and resurrect this
          // item from a response that was fetched before the delete landed.
          pendingSync: true,
          pendingSyncSetAt: Date.now(),
        }));
        watchlistServerApi
          .remove(t)
          .catch(() => {})
          .finally(() => set({ pendingSync: false, pendingSyncSetAt: null }));
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
          if (pendingSync && isStale) set({ pendingSync: false, pendingSyncSetAt: null });

          const res = await watchlistServerApi.getAll();
          const serverItems: WatchItem[] = (
            res.data as Array<{ ticker: string; name: string; added_at?: string }>
          ).map((item) => ({
            ticker: item.ticker,
            name: item.name || item.ticker,
            addedAt: item.added_at ? new Date(item.added_at).getTime() : Date.now(),
          }));
          // Server is the source of truth — including an empty list, which
          // may be exactly what another device just made true by deleting.
          set({ items: serverItems });
        } catch {}
      },
    }),
    {
      name: "watchlist",
      storage: userScopedStorage,
      // Only persist items — runtime flags stay in-memory
      partialize: (state) => ({ items: state.items }),
    }
  )
);
