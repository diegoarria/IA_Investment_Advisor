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
  loadFromServer: () => Promise<void>;
}

function pushToServer(positions: Position[]) {
  import("./api").then(({ sync }) => {
    sync.pushPortfolio(positions).catch(() => {});
  });
}

export const usePortfolioStore = create<PortfolioStore>()(
  persist(
    (set, get) => ({
      positions: [],

      addPosition: (p) => {
        set((s) => {
          const positions = [...s.positions, { ...p, id: `${p.ticker}-${Date.now()}` }];
          pushToServer(positions);
          return { positions };
        });
      },

      removePosition: (id) => {
        set((s) => {
          const positions = s.positions.filter((pos) => pos.id !== id);
          pushToServer(positions);
          return { positions };
        });
      },

      setPositions: (list) => {
        const positions = list.map((p, i) => ({ ...p, id: `${p.ticker}-${i}-${Date.now()}` }));
        set({ positions });
        pushToServer(positions);
      },

      clearPortfolio: () => {
        set({ positions: [] });
        pushToServer([]);
      },

      loadFromServer: async () => {
        try {
          const { sync } = await import("./api");
          const res = await sync.getPortfolio();
          const serverPositions: (Omit<Position, "id"> & { id?: string })[] = res.data.positions ?? [];
          if (serverPositions.length > 0) {
            const positions = serverPositions.map((p, i) => ({
              ...p,
              id: p.id ?? `${p.ticker}-${i}`,
            }));
            set({ positions });
          } else if (get().positions.length > 0) {
            // El servidor no tiene nada — sube lo que hay en localStorage
            pushToServer(get().positions);
          }
        } catch {}
      },
    }),
    {
      name: "portfolio-positions-web",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
