import { create } from "zustand";
import { persist } from "zustand/middleware";

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

interface PaperStore {
  cash: number;
  positions: PaperPosition[];
  trades: PaperTrade[];
  buy: (ticker: string, name: string, shares: number, price: number) => string | null;
  sell: (ticker: string, shares: number, price: number) => string | null;
  topUp: (amount: number) => void;
  reset: () => void;
}

export const usePaperStore = create<PaperStore>()(
  persist(
    (set, get) => ({
      cash: PAPER_INITIAL_CASH,
      positions: [],
      trades: [],

      buy: (ticker, name, shares, price) => {
        if (shares <= 0 || price <= 0) return "Cantidad o precio inválido";
        const total = shares * price;
        const state = get();
        if (total > state.cash) return "Saldo insuficiente";
        const t = ticker.toUpperCase();
        const trade: PaperTrade = { id: `${Date.now()}-buy-${t}`, type: "buy", ticker: t, shares, price, total, timestamp: Date.now() };
        const existing = state.positions.find((p) => p.ticker === t);
        if (existing) {
          const newShares = existing.shares + shares;
          const newAvg = (existing.avgPrice * existing.shares + price * shares) / newShares;
          set((s) => ({ cash: s.cash - total, positions: s.positions.map((p) => p.ticker === t ? { ...p, shares: newShares, avgPrice: newAvg } : p), trades: [trade, ...s.trades.slice(0, 49)] }));
        } else {
          set((s) => ({ cash: s.cash - total, positions: [...s.positions, { id: `${t}-${Date.now()}`, ticker: t, name, shares, avgPrice: price, buyDate: Date.now() }], trades: [trade, ...s.trades.slice(0, 49)] }));
        }
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
        set((s) => ({ cash: s.cash + total, positions: remaining <= 0 ? s.positions.filter((p) => p.ticker !== t) : s.positions.map((p) => p.ticker === t ? { ...p, shares: remaining } : p), trades: [trade, ...s.trades.slice(0, 49)] }));
        return null;
      },

      topUp: (amount) => {
        const trade: PaperTrade = { id: `${Date.now()}-topup`, type: "topup", ticker: "CASH", shares: 0, price: 0, total: amount, timestamp: Date.now() };
        set((s) => ({ cash: s.cash + amount, trades: [trade, ...s.trades.slice(0, 49)] }));
      },

      reset: () => set({ cash: PAPER_INITIAL_CASH, positions: [], trades: [] }),
    }),
    { name: "paper-trading-web" }
  )
);
