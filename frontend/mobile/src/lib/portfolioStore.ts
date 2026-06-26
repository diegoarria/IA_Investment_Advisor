import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface Position {
  id: string;
  ticker: string;
  name?: string;
  shares: number;
  avgPrice: number;
  purchaseDate?: string;
}

export interface Portfolio {
  id: string;
  name: string;
  positions: Position[];
  currency: string;
}

export type SyncStatus = "idle" | "syncing" | "saved" | "error";

interface PortfolioStore {
  portfolios: Portfolio[];
  activePortfolioId: string;

  // Convenience accessors — active portfolio's data (backward compat)
  positions: Position[];
  portfolioCurrency: string;

  syncStatus: SyncStatus;
  lastSaved: string | null;
  pendingSync: boolean;

  // Active portfolio mutations
  setCurrency: (currency: string) => void;
  addPosition: (p: Omit<Position, "id">) => void;
  removePosition: (id: string) => void;
  updatePosition: (id: string, updates: { shares?: number; avgPrice?: number; purchaseDate?: string }) => void;
  setPositions: (positions: Omit<Position, "id">[]) => void;
  mergePositions: (incoming: Omit<Position, "id">[]) => void;
  clearPortfolio: () => void;
  retrySync: () => void;
  loadFromServer: () => Promise<void>;
  restoreFromServer: (positions: Omit<Position, "id">[], currency?: string) => void;

  // Multi-portfolio management
  switchPortfolio: (portfolioId: string) => void;
  createPortfolio: (name: string) => Promise<string>;
  deletePortfolio: (portfolioId: string) => Promise<void>;
  renamePortfolio: (portfolioId: string, name: string) => Promise<void>;
  _setPortfolios: (portfolios: Portfolio[], activeId?: string) => void;
}

const DEFAULT_PORTFOLIO: Portfolio = { id: "default", name: "Mi portafolio", positions: [], currency: "USD" };

export const usePortfolioStore = create<PortfolioStore>()(
  persist(
    (set, get) => {
      const push = (positions: Position[], currency: string, portfolioId: string, portfolioName: string) => {
        set({ syncStatus: "syncing", pendingSync: true });
        import("./api").then(({ syncApi }) => {
          syncApi.pushPortfolio(
            positions.map((p) => ({ ticker: p.ticker, name: p.name, shares: p.shares, avgPrice: p.avgPrice, purchaseDate: p.purchaseDate })),
            currency,
            portfolioId,
            portfolioName,
          )
            .then(() => {
              set({ syncStatus: "saved", lastSaved: new Date().toISOString(), pendingSync: false });
              setTimeout(() => { if (get().syncStatus === "saved") set({ syncStatus: "idle" }); }, 4000);
            })
            .catch(() => { set({ syncStatus: "error" }); });
        });
      };

      const getActive = (): Portfolio => {
        const { portfolios, activePortfolioId } = get();
        return portfolios.find(p => p.id === activePortfolioId) ?? portfolios[0] ?? DEFAULT_PORTFOLIO;
      };

      const updateActive = (newPositions: Position[], newCurrency?: string) => {
        const { portfolios, activePortfolioId } = get();
        const activeId = activePortfolioId || "default";
        const updated = portfolios.map(p =>
          p.id === activeId ? { ...p, positions: newPositions, currency: newCurrency ?? p.currency } : p
        );
        const active = updated.find(p => p.id === activeId) ?? updated[0] ?? DEFAULT_PORTFOLIO;
        set({ portfolios: updated, positions: active.positions, portfolioCurrency: active.currency });
        push(active.positions, active.currency, active.id, active.name);
      };

      return {
        portfolios: [DEFAULT_PORTFOLIO],
        activePortfolioId: "default",
        positions: [],
        portfolioCurrency: "USD",
        syncStatus: "idle",
        lastSaved: null,
        pendingSync: false,

        setCurrency: (currency) => {
          const active = getActive();
          const updated = get().portfolios.map(p => p.id === active.id ? { ...p, currency } : p);
          set({ portfolios: updated, portfolioCurrency: currency });
          push(active.positions, currency, active.id, active.name);
        },

        addPosition: (p) => {
          const active = getActive();
          updateActive([...active.positions, { ...p, id: `${p.ticker}-${Date.now()}` }]);
        },

        removePosition: (id) => {
          updateActive(getActive().positions.filter(p => p.id !== id));
        },

        updatePosition: (id, updates) => {
          updateActive(getActive().positions.map(p => p.id === id ? { ...p, ...updates } : p));
        },

        setPositions: (list) => {
          updateActive(list.map((p, i) => ({ ...p, id: `${p.ticker}-${i}-${Date.now()}` })));
        },

        mergePositions: (incoming) => {
          const active = getActive();
          const existing = new Set(active.positions.map(p => p.ticker.toUpperCase()));
          const toAdd = incoming
            .filter(p => !existing.has(p.ticker.toUpperCase()))
            .map((p, i) => ({ ...p, id: `${p.ticker}-merge-${i}-${Date.now()}` }));
          updateActive([...active.positions, ...toAdd]);
        },

        clearPortfolio: () => updateActive([]),

        retrySync: () => {
          const active = getActive();
          push(active.positions, active.currency, active.id, active.name);
        },

        restoreFromServer: (list, currency) => {
          const active = getActive();
          if (!list.length && active.positions.length > 0) {
            push(active.positions, currency ?? active.currency, active.id, active.name);
            return;
          }
          if (!list.length) return;
          const positions = list.map((p, i) => ({ ...p, id: `${p.ticker}-restore-${i}` }));
          updateActive(positions, currency);
        },

        switchPortfolio: (portfolioId) => {
          const target = get().portfolios.find(p => p.id === portfolioId);
          if (!target) return;
          set({ activePortfolioId: portfolioId, positions: target.positions, portfolioCurrency: target.currency });
        },

        createPortfolio: async (name) => {
          const { syncApi } = await import("./api");
          const res = await syncApi.createPortfolio(name);
          const newPortfolio: Portfolio = { id: res.data.portfolio_id, name: res.data.portfolio_name, positions: [], currency: "USD" };
          const { portfolios } = get();
          set({ portfolios: [...portfolios, newPortfolio], activePortfolioId: newPortfolio.id, positions: [], portfolioCurrency: "USD" });
          return newPortfolio.id;
        },

        deletePortfolio: async (portfolioId) => {
          const { syncApi } = await import("./api");
          await syncApi.deletePortfolio(portfolioId);
          const { portfolios, activePortfolioId } = get();
          const remaining = portfolios.filter(p => p.id !== portfolioId);
          const list = remaining.length ? remaining : [DEFAULT_PORTFOLIO];
          const newActive = activePortfolioId === portfolioId ? list[0] : (list.find(p => p.id === activePortfolioId) ?? list[0]);
          set({ portfolios: list, activePortfolioId: newActive.id, positions: newActive.positions, portfolioCurrency: newActive.currency });
        },

        renamePortfolio: async (portfolioId, name) => {
          const { syncApi } = await import("./api");
          await syncApi.renamePortfolio(portfolioId, name);
          set({ portfolios: get().portfolios.map(p => p.id === portfolioId ? { ...p, name } : p) });
        },

        _setPortfolios: (portfolios, activeId) => {
          const list = portfolios.length ? portfolios : [DEFAULT_PORTFOLIO];
          const id = activeId ?? get().activePortfolioId;
          const active = list.find(p => p.id === id) ?? list[0];
          set({ portfolios: list, activePortfolioId: active.id, positions: active.positions, portfolioCurrency: active.currency });
        },

        loadFromServer: async () => {
          try {
            const { syncApi } = await import("./api");
            const { pendingSync } = get();
            if (pendingSync) { const a = getActive(); push(a.positions, a.currency, a.id, a.name); return; }
            try {
              // Try new multi-portfolio endpoint first (requires migration 018)
              const res = await syncApi.getAllPortfolios();
              const serverPortfolios: Portfolio[] = (res.data.portfolios ?? []).map((p: any, _i: number) => ({
                id: p.portfolio_id,
                name: p.portfolio_name,
                positions: (p.positions ?? []).map((pos: any, i: number) => ({ ...pos, id: pos.id ?? `${pos.ticker}-${i}` })),
                currency: p.currency ?? "USD",
              }));
              if (serverPortfolios.length > 0) get()._setPortfolios(serverPortfolios, get().activePortfolioId);
            } catch {
              // Fallback: old single-portfolio endpoint (pre-migration)
              const res = await syncApi.getPortfolio();
              const positions: Position[] = (res.data.positions ?? []).map((pos: any, i: number) => ({ ...pos, id: pos.id ?? `${pos.ticker}-${i}` }));
              const currency: string = res.data.currency ?? "USD";
              if (positions.length > 0) {
                const current = get();
                const updated = current.portfolios.map(p => p.id === "default" ? { ...p, positions, currency } : p);
                set({ portfolios: updated, positions, portfolioCurrency: currency });
              }
            }
          } catch {}
        },
      };
    },
    {
      name: "portfolio-positions",
      version: 2,
      migrate: (persisted: any, version: number) => {
        if (version < 2) {
          // v1 had flat positions[] + portfolioCurrency — wrap in portfolios array
          const positions = (persisted?.positions ?? []).map((p: any, i: number) => ({ ...p, id: p.id ?? `${p.ticker}-${i}` }));
          const currency = persisted?.portfolioCurrency ?? "USD";
          return {
            ...persisted,
            portfolios: [{ id: "default", name: "Mi portafolio", positions, currency }],
            activePortfolioId: "default",
            positions,
            portfolioCurrency: currency,
          };
        }
        return persisted;
      },
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        portfolios: state.portfolios,
        activePortfolioId: state.activePortfolioId,
        positions: state.positions,
        portfolioCurrency: state.portfolioCurrency,
        pendingSync: state.pendingSync,
        lastSaved: state.lastSaved,
      }),
    }
  )
);
