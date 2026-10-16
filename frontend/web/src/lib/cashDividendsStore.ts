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

// Diego, 2026-10-16: "SIEMPRE SIEMPRE debe funcionar, con o sin internet, y
// debe guardarse" — add/update/remove used to live in portfolio/page.tsx,
// synchronous (add) or optimistic-with-zero-retry (remove): a single failed
// request (one dropped packet, a brief connectivity blip) either never
// applied the change at all, or applied it locally and then silently
// reverted it a moment later with just a toast — the exact bug reported
// live (delete "failing" while connected to wifi, a transient request
// failure with no retry). Moved here and rebuilt on the same offline-first
// pattern already proven in watchlistStore.ts: optimistic local update +
// persisted immediately (survives a reload even before any server
// round-trip) + retry with backoff + a persisted pending-ops queue that
// `refresh()` reconciles against (re-applies on top of a fresh server read,
// and re-attempts anything still unsynced) instead of trusting a single
// request's outcome.
interface PendingAdd {
  tempId: string;
  amount: number;
  instrument: CashHolding["instrument"];
  currency: string;
  label?: string;
  rate_pct?: number | null;
}
interface PendingUpdate {
  amount?: number;
  instrument?: CashHolding["instrument"];
  label?: string;
  rate_pct?: number | null;
}
interface PendingOps {
  removals: string[];
  adds: PendingAdd[];
  updates: Record<string, PendingUpdate>;
}
const emptyPending = (): PendingOps => ({ removals: [], adds: [], updates: {} });
const TEMP_ID_PREFIX = "local-";

interface CashDividendsState {
  userId: string | null;
  snap: Snapshot | null;
  lastFetchAt: number;
  pending: PendingOps;
  hydrate: (userId: string) => void;
  refresh: (opts?: { force?: boolean; trustEmpty?: boolean }) => Promise<void>;
  setHoldings: (updater: (prev: CashHolding[]) => CashHolding[]) => void;
  addHolding: (amount: number, instrument: CashHolding["instrument"], currency: string, label?: string, ratePct?: number | null) => Promise<void>;
  updateHolding: (id: string, updates: PendingUpdate) => Promise<void>;
  removeHolding: (id: string) => Promise<void>;
}

const STORAGE_PREFIX = "nuvos_cashdiv_v1__";
const PENDING_PREFIX = "nuvos_cashdiv_pending_v1__";
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
const readPending = (userId: string): PendingOps => {
  try {
    const raw = localStorage.getItem(PENDING_PREFIX + userId);
    return raw ? (JSON.parse(raw) as PendingOps) : emptyPending();
  } catch {
    return emptyPending();
  }
};
const writePending = (userId: string, pending: PendingOps) => {
  try { localStorage.setItem(PENDING_PREFIX + userId, JSON.stringify(pending)); } catch {}
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True if every attempt failed — caller decides what "give up" means. */
async function retry3<T>(fn: () => Promise<T>): Promise<T | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fn();
    } catch {
      if (attempt < 3) await sleep(500 * attempt);
    }
  }
  return null;
}

/** DELETE now 404s if nothing matched (2026-10-16 backend fix) — treat
 * that as "already gone, goal achieved" rather than a failure to retry,
 * or a tombstone could never clear once the row was actually deleted
 * (e.g. an earlier attempt succeeded but its response was lost). */
async function removeOnServer(id: string): Promise<true> {
  try {
    await cashHoldingsApi.remove(id);
  } catch (err: unknown) {
    if ((err as { response?: { status?: number } })?.response?.status !== 404) throw err;
  }
  return true;
}

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

/** Reconciles a freshly fetched server snapshot against whatever hasn't
 * synced yet: a pending removal still hides that holding (the server just
 * hasn't gotten the DELETE yet), a pending update's local edit wins over
 * the server's stale copy, and a pending add (never yet reached the
 * server) stays appended as its temp-id row. Without this, `refresh()`
 * firing mid-retry (tab refocus, periodic refresh) would overwrite the
 * optimistic state with server truth and visually "undo" a change that's
 * simply still in flight. */
function applyPending(next: Snapshot, pending: PendingOps): Snapshot {
  if (pending.removals.length === 0 && pending.adds.length === 0 && Object.keys(pending.updates).length === 0) return next;
  const removalSet = new Set(pending.removals);
  let holdings = next.holdings.filter((h) => !removalSet.has(h.id));
  holdings = holdings.map((h) => (pending.updates[h.id] ? { ...h, ...pending.updates[h.id] } : h));
  for (const a of pending.adds) {
    holdings.push({
      id: a.tempId, amount: a.amount, currency: a.currency, instrument: a.instrument,
      label: a.label ?? null, accrued_amount: a.amount,
      amount_usd: a.currency.toUpperCase() === "USD" ? a.amount : null,
      rate_pct: a.rate_pct ?? null,
    });
  }
  return { ...next, holdings };
}

export const useCashDividendsStore = create<CashDividendsState>()((set, get) => ({
  userId: null,
  snap: null,
  lastFetchAt: 0,
  pending: emptyPending(),

  hydrate: (userId) => {
    if (get().userId === userId) return;
    set({ userId, snap: read(userId), lastFetchAt: 0, pending: readPending(userId) });
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
      const { pending } = get();
      const reconciled = applyPending(next, pending);
      set({ snap: reconciled, lastFetchAt: Date.now() });
      write(userId, reconciled);

      // Opportunistic flush — anything still pending gets one more try
      // (the action that created it already retried 3x on its own; this
      // is the background safety net for whatever outlived that, e.g. the
      // tab was closed mid-retry). Re-issuing a now-stale removal/update
      // for an id the server already applied is harmless (404/no-op).
      for (const id of pending.removals) {
        removeOnServer(id).then(() => {
          const s = get();
          if (s.userId !== userId) return;
          const nextPending = { ...s.pending, removals: s.pending.removals.filter((x) => x !== id) };
          set({ pending: nextPending });
          writePending(userId, nextPending);
        }).catch(() => {});
      }
      for (const a of pending.adds) {
        cashHoldingsApi.add(a.amount, a.instrument, a.currency, a.label, a.rate_pct ?? null).then((res) => {
          const s = get();
          if (s.userId !== userId) return;
          const nextPending = { ...s.pending, adds: s.pending.adds.filter((x) => x.tempId !== a.tempId) };
          const nextSnap = s.snap ? { ...s.snap, holdings: s.snap.holdings.map((h) => (h.id === a.tempId ? res.data.holding : h)) } : s.snap;
          set({ pending: nextPending, ...(nextSnap ? { snap: nextSnap } : {}) });
          writePending(userId, nextPending);
          if (nextSnap) write(userId, nextSnap);
        }).catch(() => {});
      }
      for (const [id, updates] of Object.entries(pending.updates)) {
        cashHoldingsApi.update(id, updates).then((res) => {
          const s = get();
          if (s.userId !== userId) return;
          const { [id]: _drop, ...restUpdates } = s.pending.updates;
          const nextPending = { ...s.pending, updates: restUpdates };
          const nextSnap = s.snap ? { ...s.snap, holdings: s.snap.holdings.map((h) => (h.id === id ? res.data.holding : h)) } : s.snap;
          set({ pending: nextPending, ...(nextSnap ? { snap: nextSnap } : {}) });
          writePending(userId, nextPending);
          if (nextSnap) write(userId, nextSnap);
        }).catch(() => {});
      }
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

  addHolding: async (amount, instrument, currency, label, ratePct) => {
    const { userId, snap, pending } = get();
    if (!userId) return;
    const tempId = `${TEMP_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: CashHolding = {
      id: tempId, amount, currency, instrument, label: label ?? null, accrued_amount: amount,
      amount_usd: currency.toUpperCase() === "USD" ? amount : null, rate_pct: ratePct ?? null,
    };
    const nextSnap = { holdings: [...(snap?.holdings ?? []), optimistic], dividendTotalUSD: snap?.dividendTotalUSD ?? 0 };
    const nextPending = { ...pending, adds: [...pending.adds, { tempId, amount, instrument, currency, label, rate_pct: ratePct }] };
    set({ snap: nextSnap, pending: nextPending });
    write(userId, nextSnap);
    writePending(userId, nextPending);

    const res = await retry3(() => cashHoldingsApi.add(amount, instrument, currency, label, ratePct ?? null));
    if (get().userId !== userId) return;
    if (res) {
      const s = get();
      const finalSnap = s.snap ? { ...s.snap, holdings: s.snap.holdings.map((h) => (h.id === tempId ? res.data.holding : h)) } : s.snap;
      const finalPending = { ...s.pending, adds: s.pending.adds.filter((a) => a.tempId !== tempId) };
      set({ ...(finalSnap ? { snap: finalSnap } : {}), pending: finalPending });
      if (finalSnap) write(userId, finalSnap);
      writePending(userId, finalPending);
    }
    // else: 3 retries exhausted — the optimistic temp row and its pending
    // entry both stay as-is, already saved to storage above, and will be
    // retried again by the next refresh()'s flush (including after
    // reopening the app with no network now and real network later).
  },

  updateHolding: async (id, updates) => {
    const { userId, snap, pending } = get();
    if (!userId || !snap) return;
    if (id.startsWith(TEMP_ID_PREFIX)) {
      // Never synced yet — just patch the still-pending add in place; the
      // next add retry (own or via refresh()'s flush) sends the merged,
      // latest fields. No DELETE/PUT round-trip for something the server
      // doesn't know exists.
      const nextPending = { ...pending, adds: pending.adds.map((a) => (a.tempId === id ? { ...a, ...updates } : a)) };
      const nextSnap = { ...snap, holdings: snap.holdings.map((h) => (h.id === id ? { ...h, ...updates } : h)) };
      set({ snap: nextSnap, pending: nextPending });
      write(userId, nextSnap);
      writePending(userId, nextPending);
      return;
    }
    const nextSnap = { ...snap, holdings: snap.holdings.map((h) => (h.id === id ? { ...h, ...updates } : h)) };
    const nextPending = { ...pending, updates: { ...pending.updates, [id]: { ...pending.updates[id], ...updates } } };
    set({ snap: nextSnap, pending: nextPending });
    write(userId, nextSnap);
    writePending(userId, nextPending);

    const res = await retry3(() => cashHoldingsApi.update(id, updates));
    if (get().userId !== userId) return;
    if (res) {
      const s = get();
      const finalSnap = s.snap ? { ...s.snap, holdings: s.snap.holdings.map((h) => (h.id === id ? res.data.holding : h)) } : s.snap;
      const { [id]: _drop, ...restUpdates } = s.pending.updates;
      const finalPending = { ...s.pending, updates: restUpdates };
      set({ ...(finalSnap ? { snap: finalSnap } : {}), pending: finalPending });
      if (finalSnap) write(userId, finalSnap);
      writePending(userId, finalPending);
    }
    // else: stays pending, retried by refresh()'s flush — the user's edit
    // is already saved locally either way, never silently reverted.
  },

  removeHolding: async (id) => {
    const { userId, snap, pending } = get();
    if (!userId || !snap) return;
    const nextSnap = { ...snap, holdings: snap.holdings.filter((h) => h.id !== id) };

    if (id.startsWith(TEMP_ID_PREFIX)) {
      // Never synced yet — drop the pending add entirely, nothing to
      // delete server-side.
      const nextPending = { ...pending, adds: pending.adds.filter((a) => a.tempId !== id) };
      set({ snap: nextSnap, pending: nextPending });
      write(userId, nextSnap);
      writePending(userId, nextPending);
      return;
    }

    const nextPending = { ...pending, removals: pending.removals.includes(id) ? pending.removals : [...pending.removals, id], updates: Object.fromEntries(Object.entries(pending.updates).filter(([k]) => k !== id)) };
    set({ snap: nextSnap, pending: nextPending });
    write(userId, nextSnap);
    writePending(userId, nextPending);

    const res = await retry3(() => removeOnServer(id));
    if (get().userId !== userId) return;
    if (res) {
      const s = get();
      const finalPending = { ...s.pending, removals: s.pending.removals.filter((x) => x !== id) };
      set({ pending: finalPending });
      writePending(userId, finalPending);
    }
    // else: stays a tombstone in pending.removals — already hidden from the
    // UI, retried again by refresh()'s flush until it actually succeeds.
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
  const addHolding = useCashDividendsStore((s) => s.addHolding);
  const updateHolding = useCashDividendsStore((s) => s.updateHolding);
  const removeHolding = useCashDividendsStore((s) => s.removeHolding);

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
    addHolding,
    updateHolding,
    removeHolding,
    refreshAfterChange: () => refresh({ force: true, trustEmpty: true }),
  };
}
