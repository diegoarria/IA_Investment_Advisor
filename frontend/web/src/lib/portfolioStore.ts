import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useAuthStore } from "./store";

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
  // Multi-portfolio state
  portfolios: Portfolio[];
  activePortfolioId: string;

  // Active portfolio convenience accessors (backward compat)
  positions: Position[];
  portfolioCurrency: string;

  syncStatus: SyncStatus;
  lastSaved: string | null;
  pendingSync: boolean;

  // Active portfolio mutations (same API as before)
  setCurrency: (currency: string) => void;
  addPosition: (p: Omit<Position, "id">) => void;
  removePosition: (id: string) => void;
  updatePosition: (id: string, updates: { shares?: number; avgPrice?: number; purchaseDate?: string }) => void;
  setPositions: (positions: Omit<Position, "id">[]) => void;
  clearPortfolio: () => void;
  retrySync: () => void;
  loadFromServer: () => Promise<void>;

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
      /** Push active portfolio to server */
      const push = (positions: Position[], currency: string, portfolioId: string, portfolioName: string) => {
        set({ syncStatus: "syncing", pendingSync: true });
        import("./api").then(({ sync }) => {
          sync.pushPortfolio(positions, currency, portfolioId, portfolioName)
            .then(() => {
              set({ syncStatus: "saved", lastSaved: new Date().toISOString(), pendingSync: false });
              setTimeout(() => { if (get().syncStatus === "saved") set({ syncStatus: "idle" }); }, 4000);
            })
            .catch(() => { set({ syncStatus: "error" }); });
        });
      };

      /** Get the active portfolio object */
      const getActive = () => {
        const { portfolios, activePortfolioId } = get();
        return portfolios.find(p => p.id === activePortfolioId) ?? portfolios[0] ?? DEFAULT_PORTFOLIO;
      };

      /** Update positions in the active portfolio and sync */
      const updateActive = (newPositions: Position[], newCurrency?: string) => {
        const { portfolios, activePortfolioId } = get();
        const activeId = activePortfolioId || "default";
        const updated = portfolios.map(p =>
          p.id === activeId
            ? { ...p, positions: newPositions, currency: newCurrency ?? p.currency }
            : p
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
          const newPositions = [...active.positions, { ...p, id: `${p.ticker}-${Date.now()}` }];
          updateActive(newPositions);
        },

        removePosition: (id) => {
          const active = getActive();
          updateActive(active.positions.filter(p => p.id !== id));
        },

        updatePosition: (id, updates) => {
          const active = getActive();
          updateActive(active.positions.map(p => p.id === id ? { ...p, ...updates } : p));
        },

        setPositions: (list) => {
          const positions = list.map((p, i) => ({ ...p, id: `${p.ticker}-${i}-${Date.now()}` }));
          updateActive(positions);
        },

        clearPortfolio: () => updateActive([]),

        retrySync: () => {
          const active = getActive();
          push(active.positions, active.currency, active.id, active.name);
        },

        switchPortfolio: (portfolioId) => {
          const { portfolios } = get();
          const target = portfolios.find(p => p.id === portfolioId);
          if (!target) return;
          set({ activePortfolioId: portfolioId, positions: target.positions, portfolioCurrency: target.currency });
        },

        createPortfolio: async (name) => {
          const { sync } = await import("./api");
          const res = await sync.createPortfolio(name);
          const newPortfolio: Portfolio = { id: res.data.portfolio_id, name: res.data.portfolio_name, positions: [], currency: "USD" };
          const { portfolios } = get();
          set({
            portfolios: [...portfolios, newPortfolio],
            activePortfolioId: newPortfolio.id,
            positions: [],
            portfolioCurrency: "USD",
          });
          return newPortfolio.id;
        },

        deletePortfolio: async (portfolioId) => {
          const { sync } = await import("./api");
          await sync.deletePortfolio(portfolioId);
          const { portfolios, activePortfolioId } = get();
          const remaining = portfolios.filter(p => p.id !== portfolioId);
          const newActive = activePortfolioId === portfolioId ? (remaining[0] ?? DEFAULT_PORTFOLIO) : remaining.find(p => p.id === activePortfolioId) ?? remaining[0] ?? DEFAULT_PORTFOLIO;
          set({ portfolios: remaining.length ? remaining : [DEFAULT_PORTFOLIO], activePortfolioId: newActive.id, positions: newActive.positions, portfolioCurrency: newActive.currency });
        },

        renamePortfolio: async (portfolioId, name) => {
          const { sync } = await import("./api");
          await sync.renamePortfolio(portfolioId, name);
          const updated = get().portfolios.map(p => p.id === portfolioId ? { ...p, name } : p);
          set({ portfolios: updated });
        },

        _setPortfolios: (portfolios, activeId) => {
          const list = portfolios.length ? portfolios : [DEFAULT_PORTFOLIO];
          const id = activeId ?? get().activePortfolioId;
          const active = list.find(p => p.id === id) ?? list[0];
          set({ portfolios: list, activePortfolioId: active.id, positions: active.positions, portfolioCurrency: active.currency });
        },

        loadFromServer: async () => {
          try {
            const { sync } = await import("./api");
            const { pendingSync } = get();
            if (pendingSync) {
              const active = getActive();
              push(active.positions, active.currency, active.id, active.name);
              return;
            }
            try {
              // Try new multi-portfolio endpoint first (requires migration 018)
              const res = await sync.getAllPortfolios();
              const serverPortfolios: Portfolio[] = (res.data.portfolios ?? []).map((p: any) => ({
                id: p.portfolio_id,
                name: p.portfolio_name,
                positions: (p.positions ?? []).map((pos: any, i: number) => ({ ...pos, id: pos.id ?? `${pos.ticker}-${i}` })),
                currency: p.currency ?? "USD",
              }));
              if (serverPortfolios.length > 0) get()._setPortfolios(serverPortfolios, get().activePortfolioId);
            } catch {
              // Fallback: old single-portfolio endpoint (pre-migration)
              const res = await sync.getPortfolio();
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
      name: "portfolio-positions-web",
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
      storage: createJSONStorage(() => ({
        getItem: (key) => {
          const uid = useAuthStore.getState().userId ?? "guest";
          return localStorage.getItem(`${key}__${uid}`);
        },
        setItem: (key, value) => {
          const uid = useAuthStore.getState().userId ?? "guest";
          localStorage.setItem(`${key}__${uid}`, value);
        },
        removeItem: (key) => {
          const uid = useAuthStore.getState().userId ?? "guest";
          localStorage.removeItem(`${key}__${uid}`);
        },
      })),
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
