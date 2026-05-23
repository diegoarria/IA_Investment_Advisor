import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

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
  setPositions: (positions: Omit<Position, "id">[]) => void;
  clearPortfolio: () => void;
}

export const usePortfolioStore = create<PortfolioStore>()(
  persist(
    (set) => ({
      positions: [],
      addPosition: (p) =>
        set((s) => ({
          positions: [...s.positions, { ...p, id: `${p.ticker}-${Date.now()}` }],
        })),
      removePosition: (id) =>
        set((s) => ({ positions: s.positions.filter((p) => p.id !== id) })),
      setPositions: (list) =>
        set({
          positions: list.map((p, i) => ({ ...p, id: `${p.ticker}-${i}-${Date.now()}` })),
        }),
      clearPortfolio: () => set({ positions: [] }),
    }),
    {
      name: "portfolio-positions-web",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
