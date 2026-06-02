import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface Position {
  id: string;
  ticker: string;
  name?: string;
  shares: number;
  avgPrice: number;
}

interface PortfolioStore {
  positions: Position[];
  addPosition: (p: Omit<Position, "id">) => void;
  removePosition: (id: string) => void;
  updatePosition: (id: string, updates: { shares?: number; avgPrice?: number }) => void;
  setPositions: (positions: Omit<Position, "id">[]) => void;
  mergePositions: (incoming: Omit<Position, "id">[]) => void;
  clearPortfolio: () => void;
  restoreFromServer: (positions: Omit<Position, "id">[]) => void;
}

function _push(positions: Position[]) {
  import("./api").then(({ syncApi }) => {
    syncApi.pushPortfolio(
      positions.map((p) => ({
        ticker: p.ticker, name: p.name,
        shares: p.shares, avgPrice: p.avgPrice,
      }))
    ).catch(() => {});
  });
}

export const usePortfolioStore = create<PortfolioStore>()(
  persist(
    (set, get) => ({
      positions: [],

      addPosition: (p) => {
        set((s) => ({
          positions: [...s.positions, { ...p, id: `${p.ticker}-${Date.now()}` }],
        }));
        _push(get().positions);
      },

      removePosition: (id) => {
        set((s) => ({ positions: s.positions.filter((p) => p.id !== id) }));
        _push(get().positions);
      },

      updatePosition: (id, updates) => {
        set((s) => ({
          positions: s.positions.map((p) => p.id === id ? { ...p, ...updates } : p),
        }));
        _push(get().positions);
      },

      setPositions: (list) => {
        const positions = list.map((p, i) => ({ ...p, id: `${p.ticker}-${i}-${Date.now()}` }));
        set({ positions });
        _push(positions);
      },

      mergePositions: (incoming) => {
        set((s) => {
          const existing = new Set(s.positions.map((p) => p.ticker.toUpperCase()));
          const toAdd = incoming
            .filter((p) => !existing.has(p.ticker.toUpperCase()))
            .map((p, i) => ({ ...p, id: `${p.ticker}-merge-${i}-${Date.now()}` }));
          return { positions: [...s.positions, ...toAdd] };
        });
        _push(get().positions);
      },

      clearPortfolio: () => {
        set({ positions: [] });
        _push([]);
      },

      // Called on login restore — sets without triggering another push
      restoreFromServer: (list) => {
        set({ positions: list.map((p, i) => ({ ...p, id: `${p.ticker}-restore-${i}` })) });
      },
    }),
    {
      name: "portfolio-positions",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
