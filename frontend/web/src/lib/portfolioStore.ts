import { useMemo } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useAuthStore } from "./store";
import api from "./api";

export interface Position {
  id: string;
  ticker: string;
  name?: string;
  shares: number;
  avgPrice: number;
  purchaseDate?: string;
}

// A fully or partially sold position, archived forever so "since inception"
// performance can include realized gains from things no longer held.
export interface ClosedPosition {
  id: string;
  ticker: string;
  name?: string;
  shares: number;
  avgPrice: number;
  purchaseDate?: string;
  closePrice: number;
  closeDate: string;
}

export interface Portfolio {
  id: string;
  name: string;
  positions: Position[];
  closedPositions: ClosedPosition[];
  // Set once, the first time a position is ever added to this portfolio, and
  // never overwritten again — even if that first position is later edited or
  // removed. This is what "since inception" performance is anchored to.
  inceptionDate: string | null;
  currency: string;
}

export type SyncStatus = "idle" | "syncing" | "saved" | "error" | "conflict";

interface PortfolioStore {
  // Multi-portfolio state
  portfolios: Portfolio[];
  activePortfolioId: string;

  // Active portfolio convenience accessors (backward compat)
  positions: Position[];
  closedPositions: ClosedPosition[];
  inceptionDate: string | null;
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
  // closePrice is required — every removal must be recorded in the ledger so
  // "since inception" performance stays accurate after the position is gone.
  removePosition: (id: string, closePrice: number) => Promise<void>;
  // saleInfo, when present, archives the sold portion into closedPositions
  // before applying the remaining-shares update. Omit it for a plain
  // correction (typo fix) that shouldn't touch the ledger.
  updatePosition: (
    id: string,
    updates: { shares?: number; avgPrice?: number; purchaseDate?: string },
    saleInfo?: { soldShares: number; closePrice: number }
  ) => Promise<void>;
  // Collapses every purchase lot for `ticker` into a single one with the given
  // total shares and blended average price — used by the "ajustar promedio"
  // flow so adding money never fragments a position into separate-priced lots.
  mergeTickerPosition: (ticker: string, totalShares: number, avgPrice: number, purchaseDate?: string) => Promise<void>;
  setPositions: (positions: Omit<Position, "id">[]) => void;
  clearPortfolio: () => void;
  // Full wipe back to the pristine default shape — unlike clearPortfolio()
  // (which only empties the ACTIVE portfolio's positions, leaving any other
  // named portfolios in the list untouched), this drops every portfolio
  // back to a single empty "Mi portafolio". Used only when entering guest
  // mode, so a real account's data can never surface there even briefly —
  // see the storage layer's own `${key}__${uid}` comment for why that was
  // otherwise possible.
  resetForGuest: () => void;
  retrySync: () => void;
  loadFromServer: () => Promise<void>;
  // Resolves once every push() currently queued/in-flight has landed (or
  // failed) — logout must await this before switching accounts, otherwise a
  // save still in flight when the session is torn down can be lost.
  flushPendingSync: () => Promise<void>;

  // Multi-portfolio management
  switchPortfolio: (portfolioId: string) => void;
  createPortfolio: (name: string) => Promise<string>;
  deletePortfolio: (portfolioId: string) => Promise<void>;
  renamePortfolio: (portfolioId: string, name: string) => Promise<void>;
  _setPortfolios: (portfolios: Portfolio[], activeId?: string) => void;
}

const todayStr = () => new Date().toISOString().split("T")[0];

// How many closed positions per portfolio are kept in the local
// (localStorage) instant-load cache — see the persist config's
// `partialize` below for why this exists.
const _LOCAL_CLOSED_POSITIONS_CAP = 200;

const DEFAULT_PORTFOLIO: Portfolio = {
  id: "default", name: "Mi portafolio", positions: [], closedPositions: [], inceptionDate: null, currency: "USD",
};

// Merges every portfolio's positions into one list — for screens that should
// reflect ALL of a user's portfolios combined, not just whichever one
// happens to be active. Audit 2026-08-21 (Diego): every screen except
// /portfolio itself was silently only showing `positions`, the active
// portfolio's mirror — a user's 2nd/3rd broker portfolio was invisible to
// Home, the AI mentor, Patrimonio, Notifications, Earnings and Watchlist.
// Raw concatenation, matching the backend's _agg_positions convention — a
// ticker held in two portfolios yields two separate lot entries, same as
// two lots within a single portfolio already do.
export function mergeAllPositions(portfolios: Portfolio[]): Position[] {
  return portfolios.flatMap((p) => p.positions);
}

// True only when every portfolio holding at least one position shares the
// exact same currency — the one case where a single FX rate can correctly
// convert a combined total. Mixed currencies have no single correct rate
// (same problem the backend's job_market_close fix addressed 2026-08-21) —
// callers should fall back to USD (rate 1, no silent misconversion) instead
// of guessing which portfolio's currency "wins."
export function combinedCurrency(portfolios: Portfolio[]): string {
  const currencies = new Set(portfolios.filter((p) => p.positions.length > 0).map((p) => p.currency));
  return currencies.size === 1 ? [...currencies][0] : "USD";
}

/** All positions across every one of the user's portfolios, combined. */
export function useCombinedPositions(): Position[] {
  const portfolios = usePortfolioStore((s) => s.portfolios);
  return useMemo(() => mergeAllPositions(portfolios), [portfolios]);
}

/** The one currency to display a combined multi-portfolio total in — see combinedCurrency(). */
export function useCombinedCurrency(): string {
  const portfolios = usePortfolioStore((s) => s.portfolios);
  return useMemo(() => combinedCurrency(portfolios), [portfolios]);
}

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
      // Per-portfolio "what server state was this client's last edit based on"
      // — sent back as base_updated_at so the server can detect a concurrent
      // write from another device (see sync.py's 409 sync_conflict) instead of
      // blindly last-write-wins clobbering it. Updated on every successful
      // push AND every successful load, since both are "we've now seen this
      // server state."
      const lastServerUpdatedAt: Record<string, string> = {};

      /** Push active portfolio to server — returns Promise so callers can await completion */
      const push = (
        positions: Position[],
        currency: string,
        portfolioId: string,
        portfolioName: string,
        closedPositions: ClosedPosition[],
        inceptionDate: string | null
      ): Promise<void> => {
        set({ syncStatus: "syncing", pendingSync: true, pendingSyncSetAt: Date.now() });
        const doFetch = (): Promise<void> => {
          // Uses the shared axios instance (api.ts) — NOT raw fetch() — so a
          // 401 here goes through the same auto-refresh-and-retry interceptor
          // every other endpoint in the app already gets. Previously this
          // used fetch() directly, which bypassed that interceptor entirely:
          // if the access-token cookie expired while a user sat on the
          // Portfolio screen without triggering any other API call, every
          // save would 401 silently, get retried every 5s with the SAME
          // expired cookie, and never refresh — the change looked saved
          // locally but silently never reached the server. The only visible
          // symptom was a tiny, easy-to-miss red icon. Confirmed as the
          // likely root cause of "mis cambios no se guardan", 2026-08-12.
          return api.post("/api/sync/portfolio", {
            positions,
            currency,
            portfolio_id: portfolioId,
            portfolio_name: portfolioName,
            closed_positions: closedPositions,
            inception_date: inceptionDate,
            base_updated_at: lastServerUpdatedAt[portfolioId] ?? null,
          })
            .then((res) => {
              // Prefer the server's own commit timestamp over the client clock, so
              // "lastSaved" is proof the write actually landed, not just that the
              // request didn't throw.
              const data = res.data;
              const confirmedAt = data?.updated_at ?? new Date().toISOString();
              if (data?.updated_at) lastServerUpdatedAt[portfolioId] = data.updated_at;
              set({ syncStatus: "saved", lastSaved: confirmedAt, pendingSync: false, pendingSyncSetAt: null });
              setTimeout(() => { if (get().syncStatus === "saved") set({ syncStatus: "idle" }); }, 4000);
            })
            .catch((err) => {
              if (err?.response?.status === 409) {
                // Another device wrote a newer state after this client last
                // saw the server. Do NOT overwrite it with our stale-based
                // edit — surface the conflict and adopt the server's
                // updated_at as our new baseline, so the *next* save attempt
                // (the local edit is still held in this device's state, so
                // nothing is lost) is based on current reality and will
                // succeed instead of conflicting again.
                const serverUpdatedAt = err.response.data?.detail?.server_updated_at;
                if (serverUpdatedAt) lastServerUpdatedAt[portfolioId] = serverUpdatedAt;
                set({ syncStatus: "conflict", pendingSync: false, pendingSyncSetAt: null });
                throw err;
              }
              set((s) => (s.syncStatus === "conflict" ? s : { syncStatus: "error" }));
              throw err;
            });
        };
        const result = pushChain.then(doFetch, doFetch);
        pushChain = result.catch(() => {}); // keep the chain alive after a failed push
        return result;
      };

      // removePosition mutates local state immediately (optimistic) and only
      // *then* awaits the server push — a sell used to look "saved" the
      // instant the confirm dialog closed even if the push later failed
      // (409 conflict from another device, network drop), permanently
      // diverging the client's portfolio from the server's with nothing
      // telling the user. This snapshots the active portfolio's
      // money-relevant fields before the optimistic mutation and restores
      // them if the push rejects, so a failed sync always reverts back to
      // "still holding the position" instead of silently keeping a phantom
      // sale — and rethrows so the caller can show the user an actual error.
      const withRollback = (activeId: string, run: () => Promise<void>): Promise<void> => {
        const before = get().portfolios.find(p => p.id === activeId);
        const snapshot = before
          ? { positions: before.positions, closedPositions: before.closedPositions, inceptionDate: before.inceptionDate, currency: before.currency }
          : null;
        return run().catch((err) => {
          if (snapshot) {
            const reverted = get().portfolios.map(p => p.id === activeId ? { ...p, ...snapshot } : p);
            const active = reverted.find(p => p.id === activeId) ?? reverted[0] ?? DEFAULT_PORTFOLIO;
            set({
              portfolios: reverted,
              positions: active.positions,
              closedPositions: active.closedPositions,
              inceptionDate: active.inceptionDate,
              portfolioCurrency: active.currency,
            });
          }
          throw err;
        });
      };

      /** Get the active portfolio object */
      const getActive = () => {
        const { portfolios, activePortfolioId } = get();
        return portfolios.find(p => p.id === activePortfolioId) ?? portfolios[0] ?? DEFAULT_PORTFOLIO;
      };

      /** Update positions in the active portfolio and sync — returns Promise for awaitable saves */
      const updateActive = (
        newPositions: Position[],
        opts?: { currency?: string; closedPositions?: ClosedPosition[]; inceptionDate?: string | null }
      ): Promise<void> => {
        const { portfolios, activePortfolioId } = get();
        const activeId = activePortfolioId || "default";
        const updated = portfolios.map(p =>
          p.id === activeId
            ? {
                ...p,
                positions: newPositions,
                currency: opts?.currency ?? p.currency,
                closedPositions: opts?.closedPositions ?? p.closedPositions,
                inceptionDate: opts && "inceptionDate" in opts ? opts.inceptionDate ?? null : p.inceptionDate,
              }
            : p
        );
        const active = updated.find(p => p.id === activeId) ?? updated[0] ?? DEFAULT_PORTFOLIO;
        set({
          portfolios: updated,
          positions: active.positions,
          closedPositions: active.closedPositions,
          inceptionDate: active.inceptionDate,
          portfolioCurrency: active.currency,
        });
        return push(active.positions, active.currency, active.id, active.name, active.closedPositions, active.inceptionDate);
      };

      return {
        portfolios: [DEFAULT_PORTFOLIO],
        activePortfolioId: "default",
        positions: [],
        closedPositions: [],
        inceptionDate: null,
        portfolioCurrency: "USD",
        syncStatus: "idle",
        lastSaved: null,
        pendingSync: false,
        pendingSyncSetAt: null,

        setCurrency: (currency) => {
          const active = getActive();
          const updated = get().portfolios.map(p => p.id === active.id ? { ...p, currency } : p);
          set({ portfolios: updated, portfolioCurrency: currency });
          push(active.positions, currency, active.id, active.name, active.closedPositions, active.inceptionDate);
        },

        addPosition: (p) => {
          const active = getActive();
          const newPositions = [...active.positions, { ...p, id: `${p.ticker}-${Date.now()}` }];
          // Frozen forever once set — only the very first position (ever) sets it.
          const inceptionDate = active.inceptionDate ?? (p.purchaseDate || todayStr());
          updateActive(newPositions, { inceptionDate });
        },

        removePosition: (id, closePrice) => {
          const active = getActive();
          const pos = active.positions.find(p => p.id === id);
          if (!pos) return Promise.resolve();
          const closedEntry: ClosedPosition = {
            id: pos.id, ticker: pos.ticker, name: pos.name, shares: pos.shares,
            avgPrice: pos.avgPrice, purchaseDate: pos.purchaseDate,
            closePrice, closeDate: todayStr(),
          };
          const newPositions = active.positions.filter(p => p.id !== id);
          return withRollback(active.id, () =>
            updateActive(newPositions, { closedPositions: [...active.closedPositions, closedEntry] })
          );
        },

        updatePosition: (id, updates, saleInfo) => {
          const active = getActive();
          if (saleInfo) {
            const pos = active.positions.find(p => p.id === id);
            if (pos) {
              const closedEntry: ClosedPosition = {
                id: `${pos.id}-sale-${Date.now()}`, ticker: pos.ticker, name: pos.name,
                shares: saleInfo.soldShares, avgPrice: pos.avgPrice, purchaseDate: pos.purchaseDate,
                closePrice: saleInfo.closePrice, closeDate: todayStr(),
              };
              const newPositions = active.positions.map(p => p.id === id ? { ...p, ...updates } : p);
              return updateActive(newPositions, { closedPositions: [...active.closedPositions, closedEntry] });
            }
          }
          return updateActive(active.positions.map(p => p.id === id ? { ...p, ...updates } : p));
        },

        mergeTickerPosition: (ticker, totalShares, avgPrice, purchaseDate) => {
          const active = getActive();
          const existingLots = active.positions.filter(p => p.ticker === ticker);
          const others = active.positions.filter(p => p.ticker !== ticker);
          // No date is asked for this correction — keep the earliest purchase
          // date already on record instead of resetting it to today.
          const earliestDate = existingLots.reduce<string | null>((min, p) =>
            p.purchaseDate && (!min || p.purchaseDate < min) ? p.purchaseDate : min, null);
          const merged: Position = {
            id: existingLots[0]?.id ?? `${ticker}-${Date.now()}`,
            ticker,
            name: existingLots[0]?.name,
            shares: totalShares,
            avgPrice,
            purchaseDate: purchaseDate ?? earliestDate ?? todayStr(),
          };
          return updateActive([...others, merged]);
        },

        setPositions: (list) => {
          const active = getActive();
          const positions = list.map((p, i) => ({ ...p, id: `${p.ticker}-${i}-${Date.now()}` }));
          // Import flows (screenshot/PDF) are often a brand-new user's very first
          // positions — set inception the same as addPosition would, if unset.
          let inceptionDate = active.inceptionDate;
          if (inceptionDate === null && positions.length > 0) {
            const dates = positions.map(p => p.purchaseDate).filter((d): d is string => !!d);
            inceptionDate = dates.length ? dates.sort()[0] : todayStr();
          }
          updateActive(positions, { inceptionDate });
        },

        clearPortfolio: () => updateActive([]),

        resetForGuest: () => set({
          portfolios: [DEFAULT_PORTFOLIO],
          activePortfolioId: "default",
          positions: [],
          closedPositions: [],
          inceptionDate: null,
          portfolioCurrency: "USD",
          syncStatus: "idle",
          pendingSync: false,
          pendingSyncSetAt: null,
        }),

        retrySync: () => {
          const active = getActive();
          push(active.positions, active.currency, active.id, active.name, active.closedPositions, active.inceptionDate);
        },

        flushPendingSync: () => pushChain,

        switchPortfolio: (portfolioId) => {
          const { portfolios } = get();
          const target = portfolios.find(p => p.id === portfolioId);
          if (!target) return;
          set({
            activePortfolioId: portfolioId,
            positions: target.positions,
            closedPositions: target.closedPositions,
            inceptionDate: target.inceptionDate,
            portfolioCurrency: target.currency,
          });
        },

        createPortfolio: async (name) => {
          const { sync } = await import("./api");
          const res = await sync.createPortfolio(name);
          const newPortfolio: Portfolio = {
            id: res.data.portfolio_id, name: res.data.portfolio_name,
            positions: [], closedPositions: [], inceptionDate: null, currency: "USD",
          };
          const { portfolios } = get();
          set({
            portfolios: [...portfolios, newPortfolio],
            activePortfolioId: newPortfolio.id,
            positions: [],
            closedPositions: [],
            inceptionDate: null,
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
          set({
            portfolios: remaining.length ? remaining : [DEFAULT_PORTFOLIO],
            activePortfolioId: newActive.id,
            positions: newActive.positions,
            closedPositions: newActive.closedPositions,
            inceptionDate: newActive.inceptionDate,
            portfolioCurrency: newActive.currency,
          });
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
          set({
            portfolios: list,
            activePortfolioId: active.id,
            positions: active.positions,
            closedPositions: active.closedPositions,
            inceptionDate: active.inceptionDate,
            portfolioCurrency: active.currency,
          });
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
              if (active.id !== deletingPortfolioId) push(active.positions, active.currency, active.id, active.name, active.closedPositions, active.inceptionDate);
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
                closedPositions: (p.closed_positions ?? []).map((c: any, i: number) => ({ ...c, id: c.id ?? `${c.ticker}-closed-${i}` })),
                inceptionDate: p.inception_date ?? null,
                currency: p.currency ?? "USD",
              }));
              if (serverPortfolios.length > 0) get()._setPortfolios(serverPortfolios, get().activePortfolioId);
              for (const p of (res.data.portfolios ?? [])) {
                if (p.updated_at) lastServerUpdatedAt[p.portfolio_id] = p.updated_at;
              }
            } catch {
              // Fallback: old single-portfolio endpoint (pre-migration)
              const res = await sync.getPortfolio();
              const positions: Position[] = (res.data.positions ?? []).map((pos: any, i: number) => ({ ...pos, id: pos.id ?? `${pos.ticker}-${i}` }));
              const closedPositions: ClosedPosition[] = (res.data.closed_positions ?? []).map((c: any, i: number) => ({ ...c, id: c.id ?? `${c.ticker}-closed-${i}` }));
              const inceptionDate: string | null = res.data.inception_date ?? null;
              const currency: string = res.data.currency ?? "USD";
              if (res.data.updated_at) lastServerUpdatedAt["default"] = res.data.updated_at;
              if (positions.length > 0) {
                const current = get();
                const updated = current.portfolios.map(p => p.id === "default" ? { ...p, positions, closedPositions, inceptionDate, currency } : p);
                set({ portfolios: updated, positions, closedPositions, inceptionDate, portfolioCurrency: currency });
              }
            }
          } catch {}
        },
      };
    },
    {
      name: "portfolio-positions-web",
      version: 3,
      migrate: (persisted: any, version: number) => {
        if (version < 2) {
          // v1 had flat positions[] + portfolioCurrency — wrap in portfolios array
          const positions = (persisted?.positions ?? []).map((p: any, i: number) => ({ ...p, id: p.id ?? `${p.ticker}-${i}` }));
          const currency = persisted?.portfolioCurrency ?? "USD";
          persisted = {
            ...persisted,
            portfolios: [{ id: "default", name: "Mi portafolio", positions, currency }],
            activePortfolioId: "default",
            positions,
            portfolioCurrency: currency,
          };
        }
        if (version < 3) {
          // v2 portfolios had no closedPositions/inceptionDate — default them in.
          const portfolios = (persisted?.portfolios ?? []).map((p: any) => ({
            ...p,
            closedPositions: p.closedPositions ?? [],
            inceptionDate: p.inceptionDate ?? null,
          }));
          persisted = {
            ...persisted,
            portfolios,
            closedPositions: persisted?.closedPositions ?? [],
            inceptionDate: persisted?.inceptionDate ?? null,
          };
        }
        return persisted;
      },
      // Every method wrapped in try/catch — an unguarded setItem throwing
      // (Safari Private Browsing, or a real QuotaExceededError from a large
      // closedPositions history — confirmed live 2026-08-12: Diego's own
      // portfolio hit the localStorage quota) propagates straight out of
      // zustand's set() and aborts whatever store call triggered it
      // (addPosition, setPositions, ...) uncaught. That's what made
      // "Agregar posición" / the currency-import modal fail with no
      // recovery — the write to *memory* (React state) never even
      // happened, since persist's write-through happens inside the same
      // set() call. Same hardening store.ts already has for exactly this
      // reason (Safari's subscription-store bug) — see its own comment.
      storage: createJSONStorage(() => ({
        getItem: (key) => {
          try {
            const uid = useAuthStore.getState().userId ?? "guest";
            return localStorage.getItem(`${key}__${uid}`);
          } catch {
            return null;
          }
        },
        setItem: (key, value) => {
          try {
            const uid = useAuthStore.getState().userId ?? "guest";
            localStorage.setItem(`${key}__${uid}`, value);
          } catch {
            // Quota exceeded or storage unavailable — the store still works
            // in-memory for this session, it just won't persist across
            // reloads until the payload shrinks (see closedPositions cap
            // below) or storage frees up.
          }
        },
        removeItem: (key) => {
          try {
            const uid = useAuthStore.getState().userId ?? "guest";
            localStorage.removeItem(`${key}__${uid}`);
          } catch {}
        },
      })),
      // Only the most recent N closed positions are cached to localStorage —
      // the full sale history always lives on the server (get_portfolio/
      // loadFromServer), this is purely the local instant-load cache. An
      // unbounded closed-positions ledger is exactly what exceeded the
      // browser's storage quota in production (confirmed live 2026-08-12),
      // which then made EVERY local write throw uncaught (see the storage
      // adapter's comment above) — nothing here is lost server-side, only
      // trimmed from this local cache.
      partialize: (state) => ({
        portfolios: state.portfolios.map(p => ({ ...p, closedPositions: p.closedPositions.slice(-_LOCAL_CLOSED_POSITIONS_CAP) })),
        activePortfolioId: state.activePortfolioId,
        positions: state.positions,
        closedPositions: state.closedPositions.slice(-_LOCAL_CLOSED_POSITIONS_CAP),
        inceptionDate: state.inceptionDate,
        portfolioCurrency: state.portfolioCurrency,
        pendingSync: state.pendingSync,
        pendingSyncSetAt: state.pendingSyncSetAt,
        lastSaved: state.lastSaved,
      }),
    }
  )
);
