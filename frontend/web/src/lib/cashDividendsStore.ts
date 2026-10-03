import { useEffect } from "react";
import { create } from "zustand";
import { cashHoldings as cashHoldingsApi } from "./api";
import { useAuthStore } from "./store";

// Diego, 2026-10-02: "efectivo y dividendos recibidos SIEMPRE se queden fijos
// ... y no haya inconsistencias". Inicio, Patrimonio and Portafolio each used
// to fetch these on their own, start at 0 on every visit, give up for the
// whole session on a 401 fired before the session was restored, and convert
// currencies with their own hardcoded table — so the numbers blinked out and
// differed between screens. This is now the ONE place they come from:
//
// - The last good value is kept per user in localStorage and shown instantly.
// - Only a successful response replaces it; a failed request never does.
// - An empty response that would wipe out non-empty data is only accepted
//   once a second read a few seconds later confirms it (or right after the
//   user themselves changed their cash).
// - Conversion uses the backend's amount_usd (one live FX source), and an
//   amount already in the display currency is never converted at all.

export interface CashHolding {
  id: string;
  amount: number;
  currency: string;
  instrument: "cetes" | "bank" | "bonds" | "other";
  label: string | null;
  accrued_amount?: number;
  amount_usd?: number | null;
  rate_pct?: number | null;
}

interface Snapshot {
  holdings: CashHolding[];
  dividendTotalUSD: number;
}

interface CashDividendsState {
  userId: string | null;
  snap: Snapshot | null;
  lastFetchAt: number;
  hydrate: (userId: string) => void;
  refresh: (opts?: { force?: boolean; trustEmpty?: boolean }) => Promise<void>;
  setHoldings: (updater: (prev: CashHolding[]) => CashHolding[]) => void;
}

const STORAGE_PREFIX = "nuvos_cashdiv_v1__";
const MIN_REFRESH_MS = 30_000;
let inFlight: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const read = (userId: string): Snapshot | null => {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + userId);
    return raw ? (JSON.parse(raw) as Snapshot) : null;
  } catch {
    return null;
  }
};
const write = (userId: string, snap: Snapshot) => {
  try { localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(snap)); } catch {}
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchSummary(): Promise<Snapshot | null> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await cashHoldingsApi.summary();
      return {
        holdings: res.data?.holdings ?? [],
        dividendTotalUSD: Number(res.data?.dividend_total_usd ?? 0),
      };
    } catch {
      if (attempt < 4) await sleep(600 * attempt);
    }
  }
  return null;
}

const losesData = (prev: Snapshot | null, next: Snapshot) =>
  !!prev && ((prev.holdings.length > 0 && next.holdings.length === 0) || (prev.dividendTotalUSD > 0 && next.dividendTotalUSD === 0));

export const useCashDividendsStore = create<CashDividendsState>()((set, get) => ({
  userId: null,
  snap: null,
  lastFetchAt: 0,

  hydrate: (userId) => {
    if (get().userId === userId) return;
    set({ userId, snap: read(userId), lastFetchAt: 0 });
  },

  refresh: async (opts = {}) => {
    const { userId, lastFetchAt } = get();
    if (!userId) return;
    if (!opts.force && Date.now() - lastFetchAt < MIN_REFRESH_MS) return;
    if (inFlight && !opts.force) return inFlight;
    const run = (async () => {
      let next = await fetchSummary();
      if (get().userId !== userId) return;
      if (!next) {
        // Keep showing the last good value; try again shortly.
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => { get().refresh({ force: true }); }, 15_000);
        return;
      }
      if (!opts.trustEmpty && losesData(get().snap, next)) {
        await sleep(3000);
        const confirm = await fetchSummary();
        if (get().userId !== userId || !confirm) return;
        next = confirm;
      }
      set({ snap: next, lastFetchAt: Date.now() });
      write(userId, next);
    })();
    inFlight = run;
    try { await run; } finally { if (inFlight === run) inFlight = null; }
  },

  setHoldings: (updater) => {
    const { userId, snap } = get();
    if (!userId) return;
    const next = { holdings: updater(snap?.holdings ?? []), dividendTotalUSD: snap?.dividendTotalUSD ?? 0 };
    set({ snap: next });
    write(userId, next);
  },
}));

/** Amount of one holding in the display currency. Same rule on every screen. */
export function holdingInCurrency(h: CashHolding, currency: string, fxRate: number): number {
  const native = Number(h.accrued_amount ?? h.amount) || 0;
  if ((h.currency || "USD").toUpperCase() === currency.toUpperCase()) return native;
  const usd = h.amount_usd ?? ((h.currency || "USD").toUpperCase() === "USD" ? native : null);
  if (usd == null) return 0;
  return currency === "USD" ? usd : usd * fxRate;
}

/**
 * Cash + dividends for any screen, in `currency` (fxRate = USD→currency).
 * Loads once the session is restored, refreshes when the tab regains focus.
 */
export function useCashDividends(currency: string, fxRate: number) {
  const { userId, isAuthenticated, authRestoring } = useAuthStore();
  const snap = useCashDividendsStore((s) => s.snap);
  const hydrate = useCashDividendsStore((s) => s.hydrate);
  const refresh = useCashDividendsStore((s) => s.refresh);
  const setHoldings = useCashDividendsStore((s) => s.setHoldings);

  useEffect(() => { if (userId) hydrate(userId); }, [userId, hydrate]);
  useEffect(() => {
    if (!userId || !isAuthenticated || authRestoring) return;
    refresh();
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [userId, isAuthenticated, authRestoring, refresh]);

  const holdings = snap?.holdings ?? [];
  const dividendTotalUSD = snap?.dividendTotalUSD ?? 0;
  const cashTotal = holdings.reduce((sum, h) => sum + holdingInCurrency(h, currency, fxRate), 0);
  const cashTotalUSD = holdings.reduce((sum, h) => sum + holdingInCurrency(h, "USD", 1), 0);
  const dividendTotal = currency === "USD" ? dividendTotalUSD : dividendTotalUSD * fxRate;
  return {
    holdings,
    cashTotal,
    dividendTotal,
    cashTotalUSD,
    dividendTotalUSD,
    loaded: snap !== null,
    toCurrency: (h: CashHolding) => holdingInCurrency(h, currency, fxRate),
    setHoldings,
    refreshAfterChange: () => refresh({ force: true, trustEmpty: true }),
  };
}
