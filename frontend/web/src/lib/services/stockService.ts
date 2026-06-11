// stockService — unified interface for all stock data needs.
//
// Price layer (fastest → slowest):
//   1. Finnhub WebSocket trades (true real-time, requires FINNHUB_API_KEY on backend)
//   2. Backend polling via /api/market/quote-details (120s TTL, we poll every 15s)
//
// Static layer (refreshed every 5 min):
//   /api/market/quote-details → marketCap, P/E, 52W, earnings, ext-hours

import { finnhubWS, type PriceCallback } from "./websocketService";
import {
  getQuoteDetails,
  toStockData,
  invalidateCache,
  getQuote,
  get52WeekData,
  getEarningsDate,
  getMetrics,
} from "./marketDataService";
import type { StockData } from "@/lib/types/stock";

export type StockUpdateCallback = (data: StockData) => void;

// Active subscribers: symbol → set of callbacks
const _subscribers = new Map<string, Set<StockUpdateCallback>>();
// Latest known data per symbol
const _latest = new Map<string, StockData>();
// Polling interval reference
let _pollInterval: ReturnType<typeof setInterval> | null = null;
const POLL_MS = 15_000; // 15s polling fallback

// ─── WebSocket price bridge ────────────────────────────────────────────────────

const _wsCallback: PriceCallback = (symbol, price, timestamp) => {
  const existing = _latest.get(symbol);
  if (!existing) return;
  const updated: StockData = {
    ...existing,
    price,
    updatedAt: new Date(timestamp).toISOString(),
  };
  _latest.set(symbol, updated);
  _subscribers.get(symbol)?.forEach((cb) => cb(updated));
};

// ─── Polling refresh ───────────────────────────────────────────────────────────

async function pollAll() {
  const syms = [..._subscribers.keys()];
  if (!syms.length) return;
  invalidateCache(syms);
  const raw = await getQuoteDetails(syms);
  for (const sym of syms) {
    const r = raw[sym];
    if (!r) continue;
    const existing = _latest.get(sym);
    const updated = toStockData(sym, r, {
      companyName: existing?.companyName,
      currency: existing?.currency,
    });
    _latest.set(sym, updated);
    _subscribers.get(sym)?.forEach((cb) => cb(updated));
  }
}

function ensurePolling() {
  if (_pollInterval) return;
  _pollInterval = setInterval(pollAll, POLL_MS);
}

function maybeStopPolling() {
  if (_subscribers.size === 0 && _pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function subscribeRealtime(
  symbols: string[],
  callback: StockUpdateCallback,
): Promise<() => void> {
  // Initial fetch
  const raw = await getQuoteDetails(symbols);
  for (const sym of symbols) {
    if (!_subscribers.has(sym)) _subscribers.set(sym, new Set());
    _subscribers.get(sym)!.add(callback);

    const r = raw[sym];
    if (r) {
      const data = toStockData(sym, r, { companyName: _latest.get(sym)?.companyName });
      _latest.set(sym, data);
      callback(data);
    }
  }

  // Start WebSocket (fires instantly if already connected)
  finnhubWS.subscribe(symbols, _wsCallback);

  // Polling fallback keeps enriched data fresh
  ensurePolling();

  return () => unsubscribeRealtime(symbols, callback);
}

export function unsubscribeRealtime(symbols: string[], callback: StockUpdateCallback) {
  for (const sym of symbols) {
    _subscribers.get(sym)?.delete(callback);
    if (_subscribers.get(sym)?.size === 0) {
      _subscribers.delete(sym);
      finnhubWS.unsubscribe([sym], _wsCallback);
    }
  }
  maybeStopPolling();
}

export function getLatest(symbol: string): StockData | undefined {
  return _latest.get(symbol);
}

// One-shot fetches (no subscription)
export { getQuote, get52WeekData, getEarningsDate, getMetrics };
