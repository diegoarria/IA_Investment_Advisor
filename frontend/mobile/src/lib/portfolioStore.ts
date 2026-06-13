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
  pendingSync: boolean; // true = local changes not yet confirmed by server

  setCurrency: (currency: string) => void;
  addPosition: (p: Omit<Position, "id">) => void;
  removePosition: (id: string) => void;
  updatePosition: (id: string, updates: { shares?: number; avgPrice?: number; purchaseDate?: string }) => void;
  setPositions: (positions: Omit<Position, "id">[]) => void;
  mergePositions: (incoming: Omit<Position, "id">[]) => void;
  clearPortfolio: () => void;
  restoreFromServer: (positions: Omit<Position, "id">[], currency?: string) => void;
  loadFromServer: () => Promise<void>;
  retrySync: () => void;
}

export const usePortfolioStore = create<PortfolioStore>()(
  persist(
    (set, get) => {
      const push = (positions: Position[], currency: string) => {
        // Mark pending BEFORE the request so if the process exits mid-flight
        // the flag is already persisted in AsyncStorage.
        set({ syncStatus: "syncing", pendingSync: true });
        import("./api").then(({ syncApi }) => {
          syncApi.pushPortfolio(
            positions.map((p) => ({
              ticker: p.ticker, name: p.name,
              shares: p.shares, avgPrice: p.avgPrice,
              purchaseDate: p.purchaseDate,
            })),
            currency
          )
            .then(() => {
              set({ syncStatus: "saved", lastSaved: new Date().toISOString(), pendingSync: false });
              setTimeout(() => {
                if (get().syncStatus === "saved") set({ syncStatus: "idle" });
              }, 4000);
            })
            .catch(() => {
              // pendingSync stays true — will be retried on next loadFromServer
              set({ syncStatus: "error" });
            });
        });
      };

      return {
        positions: [],
        portfolioCurrency: "USD",
        syncStatus: "idle",
        lastSaved: null,
        pendingSync: false,

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
          const { portfolioCurrency } = get();
          const positions = list.map((p, i) => ({ ...p, id: `${p.ticker}-${i}-${Date.now()}` }));
          set({ positions });
          push(positions, portfolioCurrency);
        },

        mergePositions: (incoming) => {
          const { positions, portfolioCurrency } = get();
          const existing = new Set(positions.map((p) => p.ticker.toUpperCase()));
          const toAdd = incoming
            .filter((p) => !existing.has(p.ticker.toUpperCase()))
            .map((p, i) => ({ ...p, id: `${p.ticker}-merge-${i}-${Date.now()}` }));
          const newPositions = [...positions, ...toAdd];
          set({ positions: newPositions });
          push(newPositions, portfolioCurrency);
        },

        clearPortfolio: () => {
          const { portfolioCurrency } = get();
          set({ positions: [] });
          push([], portfolioCurrency);
        },

        // Called from login restore — sets without triggering another push
        restoreFromServer: (list, currency) => {
          set({
            positions: list.map((p, i) => ({ ...p, id: `${p.ticker}-restore-${i}` })),
            ...(currency ? { portfolioCurrency: currency } : {}),
          });
        },

        retrySync: () => {
          const { positions, portfolioCurrency } = get();
          push(positions, portfolioCurrency);
        },

        // Fetch latest portfolio from server (for multi-device sync)
        loadFromServer: async () => {
          try {
            const { syncApi } = await import("./api");
            const { pendingSync, positions: localPositions, portfolioCurrency } = get();

            // Local has unconfirmed changes → push them first; never overwrite with stale server state.
            if (pendingSync) {
              push(localPositions, portfolioCurrency);
              return;
            }

            const res = await syncApi.getAll();
            const serverPositions: (Omit<Position, "id"> & { id?: string })[] =
              res.data?.portfolio?.positions ?? [];
            const serverCurrency: string = res.data?.portfolio?.currency ?? "USD";

            if (serverPositions.length > 0) {
              const positions = serverPositions.map((p, i) => ({
                ...p,
                id: p.id ?? `${p.ticker}-${i}`,
              }));
              set({ positions, portfolioCurrency: serverCurrency });
            } else if (localPositions.length > 0) {
              // Server is empty but we have local data → upload
              push(localPositions, portfolioCurrency);
            }
          } catch {}
        },
      };
    },
    {
      name: "portfolio-positions",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        positions: state.positions,
        portfolioCurrency: state.portfolioCurrency,
        pendingSync: state.pendingSync,
        lastSaved: state.lastSaved,
      }),
    }
  )
);
