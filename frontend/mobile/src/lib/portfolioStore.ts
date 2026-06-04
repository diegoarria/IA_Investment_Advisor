import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface Position {
  id: string;
  ticker: string;
  name?: string;
  shares: number;
  avgPrice: number;
  purchaseDate?: string; // ISO "YYYY-MM-DD"
}

export type SyncStatus = "idle" | "syncing" | "saved" | "error";

interface PortfolioStore {
  positions: Position[];
  portfolioCurrency: string;
  syncStatus: SyncStatus;
  lastSaved: string | null;

  setCurrency: (currency: string) => void;
  addPosition: (p: Omit<Position, "id">) => void;
  removePosition: (id: string) => void;
  updatePosition: (id: string, updates: { shares?: number; avgPrice?: number; purchaseDate?: string }) => void;
  setPositions: (positions: Omit<Position, "id">[]) => void;
  mergePositions: (incoming: Omit<Position, "id">[]) => void;
  clearPortfolio: () => void;
  restoreFromServer: (positions: Omit<Position, "id">[]) => void;
  loadFromServer: () => Promise<void>;
}

export const usePortfolioStore = create<PortfolioStore>()(
  persist(
    (set, get) => {
      const push = (positions: Position[]) => {
        set({ syncStatus: "syncing" });
        import("./api").then(({ syncApi }) => {
          syncApi.pushPortfolio(
            positions.map((p) => ({
              ticker: p.ticker, name: p.name,
              shares: p.shares, avgPrice: p.avgPrice,
              purchaseDate: p.purchaseDate,
            }))
          )
            .then(() => {
              set({ syncStatus: "saved", lastSaved: new Date().toISOString() });
              setTimeout(() => {
                if (get().syncStatus === "saved") set({ syncStatus: "idle" });
              }, 4000);
            })
            .catch(() => set({ syncStatus: "error" }));
        });
      };

      return {
        positions: [],
        portfolioCurrency: "USD",
        syncStatus: "idle",
        lastSaved: null,

        setCurrency: (currency) => set({ portfolioCurrency: currency }),

        addPosition: (p) => {
          const newPositions = [...get().positions, { ...p, id: `${p.ticker}-${Date.now()}` }];
          set({ positions: newPositions });
          push(newPositions);
        },

        removePosition: (id) => {
          const newPositions = get().positions.filter((pos) => pos.id !== id);
          set({ positions: newPositions });
          push(newPositions);
        },

        updatePosition: (id, updates) => {
          const newPositions = get().positions.map((pos) =>
            pos.id === id ? { ...pos, ...updates } : pos
          );
          set({ positions: newPositions });
          push(newPositions);
        },

        setPositions: (list) => {
          const positions = list.map((p, i) => ({ ...p, id: `${p.ticker}-${i}-${Date.now()}` }));
          set({ positions });
          push(positions);
        },

        mergePositions: (incoming) => {
          const existing = new Set(get().positions.map((p) => p.ticker.toUpperCase()));
          const toAdd = incoming
            .filter((p) => !existing.has(p.ticker.toUpperCase()))
            .map((p, i) => ({ ...p, id: `${p.ticker}-merge-${i}-${Date.now()}` }));
          const newPositions = [...get().positions, ...toAdd];
          set({ positions: newPositions });
          push(newPositions);
        },

        clearPortfolio: () => {
          set({ positions: [] });
          push([]);
        },

        // Called from login restore — sets without triggering another push
        restoreFromServer: (list) => {
          set({
            positions: list.map((p, i) => ({ ...p, id: `${p.ticker}-restore-${i}` })),
          });
        },

        // Fetch latest portfolio from server (for multi-device sync)
        loadFromServer: async () => {
          try {
            const { syncApi } = await import("./api");
            const res = await syncApi.getAll();
            const serverPositions: (Omit<Position, "id"> & { id?: string })[] =
              res.data?.portfolio?.positions ?? [];
            if (serverPositions.length > 0) {
              const positions = serverPositions.map((p, i) => ({
                ...p,
                id: p.id ?? `${p.ticker}-${i}`,
              }));
              set({ positions });
            } else if (get().positions.length > 0) {
              // Servidor vacío pero hay datos locales → subirlos
              push(get().positions);
            }
          } catch {}
        },
      };
    },
    {
      name: "portfolio-positions",
      storage: createJSONStorage(() => AsyncStorage),
      // Excluir syncStatus y lastSaved de AsyncStorage (son efímeros)
      partialize: (state) => ({
        positions: state.positions,
        portfolioCurrency: state.portfolioCurrency,
      }),
    }
  )
);
