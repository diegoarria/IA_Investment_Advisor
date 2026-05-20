import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface WatchItem {
  ticker: string;
  name: string;
  addedAt: number;
}

interface WatchlistStore {
  items: WatchItem[];
  add: (ticker: string, name: string) => void;
  remove: (ticker: string) => void;
  has: (ticker: string) => boolean;
}

export const useWatchlistStore = create<WatchlistStore>()(
  persist(
    (set, get) => ({
      items: [],
      add: (ticker, name) => {
        const t = ticker.toUpperCase();
        if (get().items.find((i) => i.ticker === t)) return;
        set((s) => ({ items: [...s.items, { ticker: t, name, addedAt: Date.now() }] }));
      },
      remove: (ticker) => {
        const t = ticker.toUpperCase();
        set((s) => ({ items: s.items.filter((i) => i.ticker !== t) }));
      },
      has: (ticker) => !!get().items.find((i) => i.ticker === ticker.toUpperCase()),
    }),
    {
      name: "watchlist",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
