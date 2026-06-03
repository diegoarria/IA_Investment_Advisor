import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

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
  lastSaved: string | null; // ISO timestamp

  setCurrency: (currency: string) => void;
  addPosition: (p: Omit<Position, "id">) => void;
  removePosition: (id: string) => void;
  updatePosition: (id: string, updates: { shares?: number; avgPrice?: number; purchaseDate?: string }) => void;
  setPositions: (positions: Omit<Position, "id">[]) => void;
  clearPortfolio: () => void;
  loadFromServer: () => Promise<void>;
}

export const usePortfolioStore = create<PortfolioStore>()(
  persist(
    (set, get) => {
      // Push al servidor y actualiza syncStatus visible en la UI
      const push = (positions: Position[], currency: string) => {
        set({ syncStatus: "syncing" });
        import("./api").then(({ sync }) => {
          sync.pushPortfolio(positions, currency)
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

        setCurrency: (currency) => {
          set({ portfolioCurrency: currency });
          push(get().positions, currency);
        },

        addPosition: (p) => {
          const { positions, portfolioCurrency } = get();
          const newPositions = [...positions, { ...p, id: `${p.ticker}-${Date.now()}` }];
          set({ positions: newPositions });
          push(newPositions, portfolioCurrency);
        },

        removePosition: (id) => {
          const { positions, portfolioCurrency } = get();
          const newPositions = positions.filter((pos) => pos.id !== id);
          set({ positions: newPositions });
          push(newPositions, portfolioCurrency);
        },

        updatePosition: (id, updates) => {
          const { positions, portfolioCurrency } = get();
          const newPositions = positions.map((pos) =>
            pos.id === id ? { ...pos, ...updates } : pos
          );
          set({ positions: newPositions });
          push(newPositions, portfolioCurrency);
        },

        setPositions: (list) => {
          const positions = list.map((p, i) => ({
            ...p,
            id: `${p.ticker}-${i}-${Date.now()}`,
          }));
          set({ positions });
          push(positions, get().portfolioCurrency);
        },

        clearPortfolio: () => {
          set({ positions: [] });
          push([], get().portfolioCurrency);
        },

        loadFromServer: async () => {
          try {
            const { sync } = await import("./api");
            const res = await sync.getPortfolio();
            const serverPositions: (Omit<Position, "id"> & { id?: string })[] =
              res.data.positions ?? [];
            const serverCurrency: string = res.data.currency ?? "USD";
            if (serverPositions.length > 0) {
              const positions = serverPositions.map((p, i) => ({
                ...p,
                id: p.id ?? `${p.ticker}-${i}`,
              }));
              set({ positions, portfolioCurrency: serverCurrency });
            } else if (get().positions.length > 0) {
              // Servidor vacío pero hay datos locales → subirlos
              push(get().positions, get().portfolioCurrency);
            }
          } catch {}
        },
      };
    },
    {
      name: "portfolio-positions-web",
      storage: createJSONStorage(() => localStorage),
      // Solo persistir posiciones y moneda — syncStatus y lastSaved son efímeros
      partialize: (state) => ({
        positions: state.positions,
        portfolioCurrency: state.portfolioCurrency,
      }),
    }
  )
);
