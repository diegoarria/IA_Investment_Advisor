import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useAuthStore } from "./store";

export interface PaperPosition {
  id: string;
  ticker: string;
  name: string;
  shares: number;
  avgPrice: number;
  buyDate: number;
}

export interface PaperTrade {
  id: string;
  type: "buy" | "sell" | "topup";
  ticker: string;
  shares: number;
  price: number;
  total: number;
  timestamp: number;
}

export const PAPER_INITIAL_CASH = 10_000;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

interface PaperStore {
  cash: number;
  positions: PaperPosition[];
  trades: PaperTrade[];
  freeTradeMonth: string | null;
  freeTradeCount: number;
  pendingSync: boolean;
  pendingSyncSetAt: number | null;
  buy: (ticker: string, name: string, shares: number, price: number) => string | null;
  sell: (ticker: string, shares: number, price: number) => string | null;
  topUp: (amount: number) => void;
  reset: () => void;
  restoreFromServer: () => Promise<void>;
}

export const usePaperStore = create<PaperStore>()(
  persist(
    (set, get) => {
      // Same pattern as portfolioStore.ts's pushChain: chain every push onto
      // the previous one instead of firing overlapping requests. A trade used
      // to POST the *entire* cash/positions/trades snapshot with a bare
      // `.catch(() => {})` and no ordering guarantee — a rapid buy-then-sell
      // (or a slow request completing after a faster later one) raced on the
      // server, and whichever request finished last silently clobbered the
      // other trade. Confirmed 2026-09-15: this, combined with
      // restoreFromServer() overwriting local state on every /paper remount,
      // is what made a real user's trade vanish today.
      let pushChain: Promise<void> = Promise.resolve();
      // A plain boolean here (2026-09-15's first version of this fix) had its
      // own race: two overlapping pushes (a rapid buy-then-sell, one of them
      // mid-retry) each ran their OWN `.finally` on their OWN link of the
      // chain — the first one to settle cleared the shared flag even while
      // the second was still in flight, so restoreFromServer() landing in
      // that window could still wipe the second trade. A depth counter fixes
      // it: only clear pendingSync once every in-flight push has settled,
      // not just the one that happened to finish first. Confirmed via
      // adversarial code review, 2026-09-16.
      let pendingCount = 0;

      const _push = (
        cash: number,
        positions: PaperPosition[],
        trades: PaperTrade[],
        freeTradeMonth: string | null,
        freeTradeCount: number,
      ) => {
        pendingCount++;
        set({ pendingSync: true, pendingSyncSetAt: Date.now() });
        const doPush = async () => {
          const { paperApi } = await import("./api");
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await paperApi.syncState(cash, positions, trades.slice(0, 50), freeTradeMonth, freeTradeCount);
              return;
            } catch {
              if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
            }
          }
        };
        const result = pushChain.then(doPush, doPush);
        pushChain = result.catch(() => {}); // keep the chain alive after a failed push
        result.finally(() => {
          pendingCount = Math.max(0, pendingCount - 1);
          if (pendingCount === 0) set({ pendingSync: false, pendingSyncSetAt: null });
        });
      };

      return {
        cash: PAPER_INITIAL_CASH,
        positions: [],
        trades: [],
        freeTradeMonth: null,
        freeTradeCount: 0,
        pendingSync: false,
        pendingSyncSetAt: null,

        buy: (ticker, name, shares, price) => {
          if (shares <= 0 || price <= 0) return "Cantidad o precio inválido";
          const total = shares * price;
          const state = get();
          if (total > state.cash) return "Saldo insuficiente";
          const t = ticker.toUpperCase();
          const trade: PaperTrade = { id: `${Date.now()}-buy-${t}`, type: "buy", ticker: t, shares, price, total, timestamp: Date.now() };
          const existing = state.positions.find((p) => p.ticker === t);
          let newPositions: PaperPosition[];
          let newCash: number;
          if (existing) {
            const newShares = existing.shares + shares;
            const newAvg = (existing.avgPrice * existing.shares + price * shares) / newShares;
            newPositions = state.positions.map((p) => p.ticker === t ? { ...p, shares: newShares, avgPrice: newAvg } : p);
            newCash = state.cash - total;
          } else {
            newPositions = [...state.positions, { id: `${t}-${Date.now()}`, ticker: t, name, shares, avgPrice: price, buyDate: Date.now() }];
            newCash = state.cash - total;
          }
          const newTrades = [trade, ...state.trades.slice(0, 49)];
          const month = currentMonth();
          const newFreeTradeMonth = month;
          const newFreeTradeCount = state.freeTradeMonth === month ? state.freeTradeCount + 1 : 1;
          set({ cash: newCash, positions: newPositions, trades: newTrades, freeTradeMonth: newFreeTradeMonth, freeTradeCount: newFreeTradeCount });
          _push(newCash, newPositions, newTrades, newFreeTradeMonth, newFreeTradeCount);
          return null;
        },

        sell: (ticker, shares, price) => {
          if (shares <= 0 || price <= 0) return "Cantidad o precio inválido";
          const t = ticker.toUpperCase();
          const state = get();
          const pos = state.positions.find((p) => p.ticker === t);
          if (!pos) return "No tienes esta acción";
          if (shares > pos.shares) return "Acciones insuficientes";
          const total = shares * price;
          const trade: PaperTrade = { id: `${Date.now()}-sell-${t}`, type: "sell", ticker: t, shares, price, total, timestamp: Date.now() };
          const remaining = pos.shares - shares;
          const newPositions = remaining <= 0 ? state.positions.filter((p) => p.ticker !== t) : state.positions.map((p) => p.ticker === t ? { ...p, shares: remaining } : p);
          const newCash = state.cash + total;
          const newTrades = [trade, ...state.trades.slice(0, 49)];
          set({ cash: newCash, positions: newPositions, trades: newTrades });
          _push(newCash, newPositions, newTrades, state.freeTradeMonth, state.freeTradeCount);
          return null;
        },

        topUp: (amount) => {
          const state = get();
          const trade: PaperTrade = { id: `${Date.now()}-topup`, type: "topup", ticker: "CASH", shares: 0, price: 0, total: amount, timestamp: Date.now() };
          const newCash = state.cash + amount;
          const newTrades = [trade, ...state.trades.slice(0, 49)];
          set({ cash: newCash, trades: newTrades });
          _push(newCash, state.positions, newTrades, state.freeTradeMonth, state.freeTradeCount);
        },

        reset: () => {
          set({ cash: PAPER_INITIAL_CASH, positions: [], trades: [], freeTradeMonth: null, freeTradeCount: 0 });
          _push(PAPER_INITIAL_CASH, [], [], null, 0);
        },

        restoreFromServer: async () => {
          try {
            // paper/page.tsx calls this on every mount (tab switch, back-nav),
            // not just first login — if a trade's push is still in flight (or
            // failed and is mid-retry above), this used to unconditionally
            // overwrite local state with the server's PRE-trade snapshot,
            // silently discarding the just-made trade the instant the user
            // navigated away and back. Same guard/staleness escape hatch as
            // portfolioStore.ts's loadFromServer().
            const { pendingSync, pendingSyncSetAt } = get();
            const isStale = pendingSyncSetAt == null || Date.now() - pendingSyncSetAt > 2 * 60 * 1000;
            if (pendingSync && !isStale) return;
            if (pendingSync && isStale) set({ pendingSync: false, pendingSyncSetAt: null });

            const { sync } = await import("./api");
            const res = await sync.getAll();
            const d = res.data?.paper;
            if (!d) return;
            set({
              cash:           d.cash           ?? PAPER_INITIAL_CASH,
              positions:      d.positions      ?? [],
              trades:         d.trades         ?? [],
              freeTradeMonth: d.freeTradeMonth ?? null,
              freeTradeCount: d.freeTradeCount ?? 0,
            });
          } catch {}
        },
      };
    },
    {
      name: "paper-trading-web",
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
    }
  )
);
