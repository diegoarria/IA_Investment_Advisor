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
  // When pendingSync was last set to true. Used to detect a flag stuck from a
  // long-dead session so loadFromServer() doesn't defer to it forever.
  pendingSyncSetAt: number | null;

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
      // Requests to the portfolio sync endpoint must never race: each one sends the
      // *full* position list, so if two overlap, whichever the server finishes last
      // wins — even if it was sent first. Chaining them onto a single in-flight
      // promise guarantees the server always processes writes in the order made.
      let pushChain: Promise<void> = Promise.resolve();
      // Tracks a portfolio mid-deletion so loadFromServer()'s pendingSync fallback
      // (below) doesn't "helpfully" re-push it — which would recreate it right
      // after the delete lands, since the still-active portfolio during the
      // deletion window is the one being removed.
      let deletingPortfolioId: string | null = null;

      const push = (positions: Position[], currency: string, portfolioId: string, portfolioName: string): Promise<void> => {
        set({ syncStatus: "syncing", pendingSync: true, pendingSyncSetAt: Date.now() });
        const doFetch = (): Promise<void> =>
          import("./api").then(({ syncApi }) =>
            syncApi.pushPortfolio(
              positions.map((p) => ({ ticker: p.ticker, name: p.name, shares: p.shares, avgPrice: p.avgPrice, purchaseDate: p.purchaseDate })),
              currency,
              portfolioId,
              portfolioName,
            )
              .then((res) => {
                // Prefer the server's own commit timestamp over the client clock, so
                // "lastSaved" is proof the write actually landed, not just that the
                // request didn't throw.
                const confirmedAt = res?.data?.updated_at ?? new Date().toISOString();
                set({ syncStatus: "saved", lastSaved: confirmedAt, pendingSync: false, pendingSyncSetAt: null });
                setTimeout(() => { if (get().syncStatus === "saved") set({ syncStatus: "idle" }); }, 4000);
              })
              .catch((err) => {
                set({ syncStatus: "error" });
                throw err;
              })
          );
        const result = pushChain.then(doFetch, doFetch);
        pushChain = result.catch(() => {}); // keep the chain alive after a failed push
        return result;
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
        pendingSyncSetAt: null,

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
          // Flag pendingSync so a loadFromServer() already in flight can't land
          // mid-delete and pull a stale portfolio list that resurrects this one.
          set({ pendingSync: true, pendingSyncSetAt: Date.now() });
          deletingPortfolioId = portfolioId;
          // Chain onto pushChain: a queued position-edit upsert for this portfolio
          // must never land on the server after the delete and recreate the row.
          const doDelete = (): Promise<void> => syncApi.deletePortfolio(portfolioId).then(() => {});
          const result = pushChain.then(doDelete, doDelete);
          pushChain = result.catch(() => {});
          try {
            await result;
          } finally {
            set({ pendingSync: false, pendingSyncSetAt: null });
            deletingPortfolioId = null;
          }
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
            const { pendingSync, pendingSyncSetAt } = get();
            // Stuck flag (or none at all, persisted from before this field existed)
            // means whatever push set it never resolved — don't defer to it forever.
            const isStale = pendingSyncSetAt == null || Date.now() - pendingSyncSetAt > 2 * 60 * 1000;
            if (pendingSync && !isStale) {
              const a = getActive();
              if (a.id !== deletingPortfolioId) push(a.positions, a.currency, a.id, a.name);
              return;
            }
            if (pendingSync && isStale) set({ pendingSync: false, pendingSyncSetAt: null });
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
              const res = await syncApi.getAllPortfolios();
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
        pendingSyncSetAt: state.pendingSyncSetAt,
        lastSaved: state.lastSaved,
      }),
    }
  )
);
