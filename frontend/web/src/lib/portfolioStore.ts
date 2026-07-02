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
  // When pendingSync was last set to true. Used to detect a flag stuck from a
  // long-dead session (e.g. a push that never resolved before the tab closed)
  // so loadFromServer() doesn't defer to it forever and never pull again.
  pendingSyncSetAt: number | null;

  // Active portfolio mutations (same API as before)
  setCurrency: (currency: string) => void;
  addPosition: (p: Omit<Position, "id">) => void;
  removePosition: (id: string) => void;
  updatePosition: (id: string, updates: { shares?: number; avgPrice?: number; purchaseDate?: string }) => Promise<void>;
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
      // Requests to /api/sync/portfolio must never race: each one sends the *full*
      // position list, so if two overlap, whichever the server finishes last wins —
      // even if it was sent first. Chaining them onto a single in-flight promise
      // guarantees the server always processes writes in the order they were made.
      let pushChain: Promise<void> = Promise.resolve();
      // Tracks a portfolio mid-deletion so loadFromServer()'s pendingSync fallback
      // (below) doesn't "helpfully" re-push it — which would recreate it right
      // after the delete lands, since the still-active portfolio during the
      // deletion window is the one being removed.
      let deletingPortfolioId: string | null = null;

      /** Push active portfolio to server — returns Promise so callers can await completion */
      const push = (positions: Position[], currency: string, portfolioId: string, portfolioName: string): Promise<void> => {
        set({ syncStatus: "syncing", pendingSync: true, pendingSyncSetAt: Date.now() });
        const doFetch = (): Promise<void> => {
          const BASE_URL =
            process.env.NEXT_PUBLIC_API_URL ||
            "https://iainvestmentadvisor-production.up.railway.app";
          const token = typeof localStorage !== "undefined" ? localStorage.getItem("access_token") : null;
          return fetch(`${BASE_URL}/api/sync/portfolio`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              positions,
              currency,
              portfolio_id: portfolioId,
              portfolio_name: portfolioName,
            }),
            keepalive: true,
          })
            .then(async (res) => {
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              // Prefer the server's own commit timestamp over the client clock, so
              // "lastSaved" is proof the write actually landed, not just that the
              // request didn't throw.
              const data = await res.json().catch(() => null);
              const confirmedAt = data?.updated_at ?? new Date().toISOString();
              set({ syncStatus: "saved", lastSaved: confirmedAt, pendingSync: false, pendingSyncSetAt: null });
              setTimeout(() => { if (get().syncStatus === "saved") set({ syncStatus: "idle" }); }, 4000);
            })
            .catch((err) => {
              set({ syncStatus: "error" });
              throw err;
            });
        };
        const result = pushChain.then(doFetch, doFetch);
        pushChain = result.catch(() => {}); // keep the chain alive after a failed push
        return result;
      };

      /** Get the active portfolio object */
      const getActive = () => {
        const { portfolios, activePortfolioId } = get();
        return portfolios.find(p => p.id === activePortfolioId) ?? portfolios[0] ?? DEFAULT_PORTFOLIO;
      };

      /** Update positions in the active portfolio and sync — returns Promise for awaitable saves */
      const updateActive = (newPositions: Position[], newCurrency?: string): Promise<void> => {
        const { portfolios, activePortfolioId } = get();
        const activeId = activePortfolioId || "default";
        const updated = portfolios.map(p =>
          p.id === activeId
            ? { ...p, positions: newPositions, currency: newCurrency ?? p.currency }
            : p
        );
        const active = updated.find(p => p.id === activeId) ?? updated[0] ?? DEFAULT_PORTFOLIO;
        set({ portfolios: updated, positions: active.positions, portfolioCurrency: active.currency });
        return push(active.positions, active.currency, active.id, active.name);
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
          const newPositions = [...active.positions, { ...p, id: `${p.ticker}-${Date.now()}` }];
          updateActive(newPositions);
        },

        removePosition: (id) => {
          const active = getActive();
          updateActive(active.positions.filter(p => p.id !== id));
        },

        updatePosition: (id, updates) => {
          const active = getActive();
          return updateActive(active.positions.map(p => p.id === id ? { ...p, ...updates } : p));
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
          // Flag pendingSync so a loadFromServer() that's already in flight (e.g. the
          // 30s background sync) can't land mid-delete and pull a stale portfolio
          // list that still includes this one, resurrecting it locally.
          set({ pendingSync: true, pendingSyncSetAt: Date.now() });
          deletingPortfolioId = portfolioId;
          // Chain onto pushChain too: if a position edit for this portfolio was
          // queued right before the delete, its upsert would otherwise land on the
          // server *after* the delete and recreate the row. Serializing guarantees
          // the delete is always the last write for this portfolio.
          const doDelete = (): Promise<void> => sync.deletePortfolio(portfolioId).then(() => {});
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
            const { pendingSync, pendingSyncSetAt } = get();
            // A pendingSync flag stuck for more than 2 minutes means the push that
            // set it never resolved (tab closed, crashed, or hung mid-request) — it
            // isn't "in flight" anymore. Trusting it forever would mean this browser
            // never pulls fresh data from the server again, only ever re-pushing its
            // own possibly-ancient local snapshot. No timestamp at all (persisted
            // from before this field existed) is treated as stale too — there's no
            // way to know how old it is, and every code path that sets pendingSync
            // now always sets this timestamp alongside it.
            const isStale = pendingSyncSetAt == null || Date.now() - pendingSyncSetAt > 2 * 60 * 1000;
            if (pendingSync && !isStale) {
              const active = getActive();
              if (active.id !== deletingPortfolioId) push(active.positions, active.currency, active.id, active.name);
              return;
            }
            if (pendingSync && isStale) set({ pendingSync: false, pendingSyncSetAt: null });
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
        pendingSyncSetAt: state.pendingSyncSetAt,
        lastSaved: state.lastSaved,
      }),
    }
  )
);
