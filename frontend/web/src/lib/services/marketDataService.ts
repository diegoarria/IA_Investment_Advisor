// REST market data service — calls our authenticated backend.
//
// Endpoints used:
//   GET /api/market/quote-details?symbols=AAPL,GOOGL
//     → price, changePct, change ($), volume, marketCap, pe,
//       week52High, week52Low, earningsDate, extPrice/Pct/Label/Change, marketState
//
//   GET /api/market/search?q=apple
//     → ticker search results
//
// The backend uses Yahoo Finance quoteSummary v10 (crumb-auth, works from Railway)
// for quote details. TTL cache: 120s for quote-details.

import type { StockData } from "@/lib/types/stock";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Raw shape returned by /api/market/quote-details
interface QuoteDetailsRaw {
  price?: number | null;
  change?: number | null;
  changePct?: number | null;
  volume?: number | null;
  marketCap?: number | null;
  pe?: number | null;
  week52High?: number | null;
  week52Low?: number | null;
  week52Pct?: number | null;
  earningsDate?: string | null;
  extPrice?: number | null;
  extPct?: number | null;
  extChange?: number | null;
  extLabel?: string | null;
  marketState?: string | null;
  companyName?: string | null;
  currency?: string | null;
}

// In-memory cache (TTL = 120s, matches backend cache)
const _cache = new Map<string, { data: Record<string, QuoteDetailsRaw>; ts: number }>();
const CACHE_TTL = 120_000;

export async function getQuoteDetails(
  symbols: string[],
): Promise<Record<string, QuoteDetailsRaw>> {
  if (!symbols.length) return {};
  const key = [...symbols].sort().join(",");
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;

  try {
    const res = await fetch(
      `${BASE}/api/market/quote-details?symbols=${symbols.join(",")}`,
      { headers: authHeaders() },
    );
    if (!res.ok) return {};
    const data = (await res.json()) as Record<string, QuoteDetailsRaw>;
    _cache.set(key, { data, ts: Date.now() });
    return data;
  } catch {
    return {};
  }
}

// Convert raw backend response to StockData for a single symbol.
// `basePrice` / `baseChangePct` come from the watchlist API (fresh).
export function toStockData(
  symbol: string,
  raw: QuoteDetailsRaw,
  overrides?: { price?: number; change?: number; changePct?: number; companyName?: string; currency?: string; marketState?: string },
): StockData {
  const price = overrides?.price ?? raw.price ?? 0;
  const change = overrides?.change ?? raw.change ?? (price && raw.changePct ? price * raw.changePct / 100 : 0);
  const changePct = overrides?.changePct ?? raw.changePct ?? 0;

  const extPrice = raw.extPrice ?? null;
  const extChange = raw.extChange ?? (extPrice && price ? extPrice - price : null);
  const extPct = raw.extPct ?? null;

  return {
    symbol,
    companyName: overrides?.companyName ?? raw.companyName ?? symbol,
    price,
    change,
    changePercent: changePct,
    volume: raw.volume ?? 0,
    afterHoursPrice: extPrice,
    afterHoursChange: extChange,
    afterHoursChangePercent: extPct,
    marketCap: raw.marketCap ?? null,
    peRatio: raw.pe ?? null,
    earningsDate: raw.earningsDate ?? null,
    week52High: raw.week52High ?? null,
    week52Low: raw.week52Low ?? null,
    currency: overrides?.currency ?? raw.currency ?? "USD",
    marketState: overrides?.marketState ?? raw.marketState ?? "REGULAR",
    extLabel: (raw.extLabel as StockData["extLabel"]) ?? null,
    updatedAt: new Date().toISOString(),
  };
}

// Dedicated functions (getQuote / getMetrics / etc.)

export async function getQuote(symbol: string): Promise<StockData | null> {
  const raw = await getQuoteDetails([symbol]);
  const r = raw[symbol];
  return r ? toStockData(symbol, r) : null;
}

export async function get52WeekData(symbol: string): Promise<{ high: number | null; low: number | null }> {
  const raw = await getQuoteDetails([symbol]);
  const r = raw[symbol];
  return { high: r?.week52High ?? null, low: r?.week52Low ?? null };
}

export async function getEarningsDate(symbol: string): Promise<string | null> {
  const raw = await getQuoteDetails([symbol]);
  return raw[symbol]?.earningsDate ?? null;
}

export async function getMetrics(symbol: string): Promise<{ pe: number | null; marketCap: number | null }> {
  const raw = await getQuoteDetails([symbol]);
  const r = raw[symbol];
  return { pe: r?.pe ?? null, marketCap: r?.marketCap ?? null };
}

// Invalidate cache for given symbols so next fetch is fresh
export function invalidateCache(symbols: string[]) {
  _cache.forEach((_, key) => {
    if (symbols.some((s) => key.includes(s))) _cache.delete(key);
  });
}
