// ─── Core stock data type ─────────────────────────────────────────────────────
// All optional fields allow progressive hydration: base data loads first,
// enriched data (marketCap, P/E, 52W, earnings) fills in separately.

export interface StockData {
  symbol: string;
  companyName: string;

  // Real-time price (updated via WebSocket or fast polling)
  price: number;
  change: number;        // $ amount
  changePercent: number; // %

  volume: number;

  // Extended hours (pre- or post-market)
  afterHoursPrice: number | null;
  afterHoursChange: number | null;       // $ amount vs regular close
  afterHoursChangePercent: number | null; // %

  marketCap: number | null;
  peRatio: number | null;
  earningsDate: string | null; // ISO date "2025-07-24"

  week52High: number | null;
  week52Low: number | null;

  currency: string;
  marketState: "REGULAR" | "PRE" | "POST" | "CLOSED" | string;
  extLabel: "Pre" | "Post" | null;

  updatedAt: string; // ISO timestamp
}

// Partial view used while hydrating
export type StockDataPartial = Pick<StockData, "symbol" | "price" | "change" | "changePercent"> &
  Partial<Omit<StockData, "symbol" | "price" | "change" | "changePercent">>;

// WebSocket trade event from Finnhub
export interface FinnhubTrade {
  p: number;  // price
  s: string;  // symbol
  t: number;  // timestamp (ms)
  v: number;  // volume
}

export interface FinnhubMessage {
  type: "trade" | "ping";
  data?: FinnhubTrade[];
}

// ─── Formatters ───────────────────────────────────────────────────────────────

export function fmtPrice(v: number | null | undefined, currency = "USD"): string {
  if (v == null) return "—";
  const sym = currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  return `${sym}${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtChange(v: number | null | undefined, currency = "USD"): string {
  if (v == null) return "—";
  const sym = currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  return `${v >= 0 ? "+" : ""}${sym}${Math.abs(v).toFixed(2)}`;
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export function fmtVolume(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

export function fmtMarketCap(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v}`;
}

export function fmtEarningsDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d + "T12:00:00").toLocaleDateString("es", { month: "short", day: "numeric" });
  } catch {
    return d;
  }
}

// Returns CSS color token for a change value
export function changeColor(v: number | null | undefined): string {
  if (v == null || v === 0) return "var(--muted)";
  return v > 0 ? "#22c55e" : "#ef4444";
}
