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
  restoreFromServer: () => Promise<void>;
}

export const usePaperStore = create<PaperStore>()(
  persist(
    (set, get) => {
      const _push = (cash: number, positions: PaperPosition[], trades: PaperTrade[]) => {
        import("./api").then(({ paperApi }) => {
          paperApi.syncState(cash, positions, trades.slice(0, 50)).catch(() => {});
        });
      };

      return {
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
          set({ cash: newCash, positions: newPositions, trades: newTrades });
          _push(newCash, newPositions, newTrades);
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
          _push(newCash, newPositions, newTrades);
          return null;
        },

        topUp: (amount) => {
          const trade: PaperTrade = { id: `${Date.now()}-topup`, type: "topup", ticker: "CASH", shares: 0, price: 0, total: amount, timestamp: Date.now() };
          const newCash = get().cash + amount;
          const newTrades = [trade, ...get().trades.slice(0, 49)];
          set({ cash: newCash, trades: newTrades });
          _push(newCash, get().positions, newTrades);
        },

        reset: () => {
          set({ cash: PAPER_INITIAL_CASH, positions: [], trades: [] });
          _push(PAPER_INITIAL_CASH, [], []);
        },

        restoreFromServer: async () => {
          try {
            const { sync } = await import("./api");
            const res = await sync.getAll();
            const d = res.data?.paper;
            if (!d) return;
            set({
              cash:      d.cash      ?? PAPER_INITIAL_CASH,
              positions: d.positions ?? [],
              trades:    d.trades    ?? [],
            });
          } catch {}
        },
      };
    },
    { name: "paper-trading-web" }
  )
);
