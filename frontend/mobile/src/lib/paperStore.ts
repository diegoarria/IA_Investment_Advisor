import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

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
}

function _push(s: { cash: number; positions: PaperPosition[]; trades: PaperTrade[]; freeTradeMonth: string | null; freeTradeCount: number }) {
  import("./api").then(({ syncApi }) => {
    syncApi.pushPaper({
      cash: s.cash,
      positions: s.positions,
      trades: s.trades.slice(0, 50),
      freeTradeMonth: s.freeTradeMonth,
      freeTradeCount: s.freeTradeCount,
    }).catch(() => {});
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
        _push(get());
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
        _push(get());
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
        _push(get());
        return null;
      },

      topUp: (amount) => {
        const trade: PaperTrade = {
          id: `${Date.now()}-topup`,
          type: "topup", ticker: "CASH", shares: 0, price: 0, total: amount, timestamp: Date.now(),
        };
        set((s) => ({ cash: s.cash + amount, trades: [trade, ...s.trades.slice(0, 49)] }));
        _push(get());
      },

      reset: () => {
        const next = { cash: PAPER_INITIAL_CASH, positions: [] as PaperPosition[], trades: [] as PaperTrade[], freeTradeMonth: null as string | null, freeTradeCount: 0 };
        set(next);
        _push(next);
      },

      restoreFromServer: (state) => set(state),
    }),
    {
      name: "paper-trading",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
