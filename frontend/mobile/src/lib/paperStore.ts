import { create } from "zustand";
import { persist } from "zustand/middleware";
import { userScopedStorage } from "./userScopedStorage";

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

export interface TopUpPlan {
  id: string;
  amount: number;       // virtual USD added
  price: string;        // display price (e.g. "$3.99")
  label: string;
  tag?: string;         // "Más popular", "Mejor valor", etc.
  color: string;
}

export const TOP_UP_PLANS: TopUpPlan[] = [
  { id: "topup_1k",   amount: 1_000,   price: "$1.99",  label: "+$1,000",   color: "#6b7280" },
  { id: "topup_5k",   amount: 5_000,   price: "$3.99",  label: "+$5,000",   color: "#3b82f6" },
  { id: "topup_10k",  amount: 10_000,  price: "$7.99",  label: "+$10,000",  color: "#22c55e", tag: "Más popular" },
  { id: "topup_100k", amount: 100_000, price: "$19.99", label: "+$100,000", color: "#f59e0b", tag: "Mejor valor" },
];

export const PAPER_INITIAL_CASH = 10_000;
export const FREE_PAPER_INITIAL_CASH = 5_000;
export const FREE_PAPER_MONTHLY_TRADES = 3;

function currentMonth() { return new Date().toISOString().slice(0, 7); } // "YYYY-MM"

interface PaperStore {
  cash: number;
  positions: PaperPosition[];
  trades: PaperTrade[];
  freeTradeMonth: string | null;
  freeTradeCount: number;
  /** Returns null on success, error string on failure */
  buy: (ticker: string, name: string, shares: number, price: number) => string | null;
  sell: (ticker: string, shares: number, price: number) => string | null;
  topUp: (amount: number) => void;
  reset: () => void;
  incrementFreeTrade: () => void;
  freeTradesThisMonth: () => number;
  restoreFromServer: (state: { cash: number; positions: PaperPosition[]; trades: PaperTrade[]; freeTradeMonth: string | null; freeTradeCount: number }) => void;
  pendingSync: boolean;
  pendingSyncSetAt: number | null;
}

// Chained onto the previous push instead of fired independently — a bare
// fire-and-forget push with no ordering guarantee let a rapid buy-then-sell
// (or a slow request finishing after a faster later one) race on the
// server, and whichever request landed last silently clobbered the other
// trade. Combined with restoreFromServer() being called unconditionally on
// every app-foreground resume (app/(tabs)/_layout.tsx), a trade whose push
// hadn't landed (or failed) yet was wiped by the next resync — confirmed
// 2026-09-15, a real user's trade vanished this way. Same fix pattern as
// portfolioStore.ts/watchlistStore.ts: retry with backoff + a pendingSync
// guard that restoreFromServer respects.
let pushChain: Promise<void> = Promise.resolve();
// A plain boolean here (2026-09-15's first version of this fix) had its own
// race: two overlapping pushes (a rapid buy-then-sell, one mid-retry) each
// ran their own `.finally` on their own link of the chain — the first to
// settle cleared the shared flag even while the second was still in
// flight, so restoreFromServer() landing in that window could still wipe
// the second trade. A depth counter fixes it: only clear pendingSync once
// every in-flight push has settled. Confirmed via adversarial code review,
// 2026-09-16.
let pendingCount = 0;

function _push(s: { cash: number; positions: PaperPosition[]; trades: PaperTrade[]; freeTradeMonth: string | null; freeTradeCount: number }, set: (partial: Partial<PaperStore>) => void) {
  pendingCount++;
  set({ pendingSync: true, pendingSyncSetAt: Date.now() });
  const doPush = async () => {
    const { syncApi } = await import("./api");
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await syncApi.pushPaper({
          cash: s.cash,
          positions: s.positions,
          trades: s.trades.slice(0, 50),
          freeTradeMonth: s.freeTradeMonth,
          freeTradeCount: s.freeTradeCount,
        });
        return;
      } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  };
  const result = pushChain.then(doPush, doPush);
  pushChain = result.catch(() => {});
  result.finally(() => {
    pendingCount = Math.max(0, pendingCount - 1);
    if (pendingCount === 0) set({ pendingSync: false, pendingSyncSetAt: null });
  });
}

export const usePaperStore = create<PaperStore>()(
  persist(
    (set, get) => ({
      cash: PAPER_INITIAL_CASH,
      positions: [],
      trades: [],
      freeTradeMonth: null,
      freeTradeCount: 0,
      pendingSync: false,
      pendingSyncSetAt: null,

      freeTradesThisMonth: () => {
        const { freeTradeMonth, freeTradeCount } = get();
        return freeTradeMonth === currentMonth() ? freeTradeCount : 0;
      },

      incrementFreeTrade: () => {
        const month = currentMonth();
        const { freeTradeMonth, freeTradeCount } = get();
        set({
          freeTradeMonth: month,
          freeTradeCount: freeTradeMonth === month ? freeTradeCount + 1 : 1,
        });
        _push(get(), set);
      },

      buy: (ticker, name, shares, price) => {
        if (shares <= 0 || price <= 0) return "Cantidad o precio inválido";
        const total = shares * price;
        const state = get();
        if (total > state.cash) return "Saldo insuficiente";

        const t = ticker.toUpperCase();
        const trade: PaperTrade = {
          id: `${Date.now()}-buy-${t}`,
          type: "buy", ticker: t, shares, price, total, timestamp: Date.now(),
        };

        const existing = state.positions.find((p) => p.ticker === t);
        if (existing) {
          const newShares = existing.shares + shares;
          const newAvg = (existing.avgPrice * existing.shares + price * shares) / newShares;
          set((s) => ({
            cash: s.cash - total,
            positions: s.positions.map((p) =>
              p.ticker === t ? { ...p, shares: newShares, avgPrice: newAvg } : p
            ),
            trades: [trade, ...s.trades.slice(0, 49)],
          }));
        } else {
          set((s) => ({
            cash: s.cash - total,
            positions: [
              ...s.positions,
              { id: `${t}-${Date.now()}`, ticker: t, name, shares, avgPrice: price, buyDate: Date.now() },
            ],
            trades: [trade, ...s.trades.slice(0, 49)],
          }));
        }
        _push(get(), set);
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
        const trade: PaperTrade = {
          id: `${Date.now()}-sell-${t}`,
          type: "sell", ticker: t, shares, price, total, timestamp: Date.now(),
        };
        const remaining = pos.shares - shares;
        set((s) => ({
          cash: s.cash + total,
          positions: remaining <= 0
            ? s.positions.filter((p) => p.ticker !== t)
            : s.positions.map((p) => p.ticker === t ? { ...p, shares: remaining } : p),
          trades: [trade, ...s.trades.slice(0, 49)],
        }));
        _push(get(), set);
        return null;
      },

      topUp: (amount) => {
        const trade: PaperTrade = {
          id: `${Date.now()}-topup`,
          type: "topup", ticker: "CASH", shares: 0, price: 0, total: amount, timestamp: Date.now(),
        };
        set((s) => ({ cash: s.cash + amount, trades: [trade, ...s.trades.slice(0, 49)] }));
        _push(get(), set);
      },

      reset: () => {
        const next = { cash: PAPER_INITIAL_CASH, positions: [] as PaperPosition[], trades: [] as PaperTrade[], freeTradeMonth: null as string | null, freeTradeCount: 0 };
        set(next);
        _push(next, set);
      },

      restoreFromServer: (state) => {
        // Called unconditionally on every app-foreground resume
        // (app/(tabs)/_layout.tsx) — must never stomp a trade whose push is
        // still in flight or mid-retry above.
        const { pendingSync, pendingSyncSetAt } = get();
        const isStale = pendingSyncSetAt == null || Date.now() - pendingSyncSetAt > 2 * 60 * 1000;
        if (pendingSync && !isStale) return;
        if (pendingSync && isStale) set({ pendingSync: false, pendingSyncSetAt: null });
        set(state);
      },
    }),
    {
      name: "paper-trading",
      storage: userScopedStorage,
    }
  )
);
