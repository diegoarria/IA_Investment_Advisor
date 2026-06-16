import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { watchlistServerApi } from "./api";

export interface WatchItem {
  ticker: string;
  name: string;
  addedAt: number;
}

interface WatchlistStore {
  items: WatchItem[];
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

      add: (ticker, name) => {
        const t = ticker.toUpperCase();
        if (get().items.find((i) => i.ticker === t)) return;
        set((s) => ({ items: [...s.items, { ticker: t, name, addedAt: Date.now() }] }));
        // Optimistic — sync to server in background
        watchlistServerApi.add(t, name).catch(() => {});
      },

      remove: (ticker) => {
        const t = ticker.toUpperCase();
        set((s) => ({ items: s.items.filter((i) => i.ticker !== t) }));
        watchlistServerApi.remove(t).catch(() => {});
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
          const res = await watchlistServerApi.getAll();
          const serverItems: WatchItem[] = (
            res.data as Array<{ ticker: string; name: string; added_at?: string }>
          ).map((item) => ({
            ticker: item.ticker,
            name: item.name || item.ticker,
            addedAt: item.added_at ? new Date(item.added_at).getTime() : Date.now(),
          }));
          set({ items: serverItems });
        } catch {}
      },
    }),
    {
      name: "watchlist",
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist items — runtime flags stay in-memory
      partialize: (state) => ({ items: state.items }),
    }
  )
);
