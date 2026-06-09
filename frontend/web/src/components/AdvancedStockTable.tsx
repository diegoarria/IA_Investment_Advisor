"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, Loader2 } from "lucide-react";
import { market as marketApi } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AdvancedRow {
  ticker: string;
  name: string;
  logoUrl?: string | null;
  price: number | null;
  changePct: number | null;
  currency?: string;
  marketState?: string;
  // enriched from /market/quote-details
  volume?: number | null;
  marketCap?: number | null;
  pe?: number | null;
  week52Pct?: number | null;
  earningsDate?: string | null;
  extPrice?: number | null;
  extPct?: number | null;
  extLabel?: string | null;
  // portfolio-only
  shares?: number | null;
  avgCost?: number | null;
  positionValue?: number | null;
  gainLossPct?: number | null;
}

type SortKey = keyof AdvancedRow;
type Mode = "watchlist" | "portfolio";

interface Props {
  rows: AdvancedRow[];
  mode: Mode;
  onRemove?: (ticker: string) => void;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtPrice(v: number | null | undefined, currency = "USD") {
  if (v == null) return "—";
  const sym = currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  return `${sym}${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(v: number | null | undefined, sign = true) {
  if (v == null) return "—";
  return `${sign && v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtVol(v: number | null | undefined) {
  if (v == null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

function fmtCap(v: number | null | undefined) {
  if (v == null) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v}`;
}

function fmtPE(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toFixed(2);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try {
    return new Date(d + "T12:00:00").toLocaleDateString("es", { month: "short", day: "numeric" });
  } catch {
    return d;
  }
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ ticker, logoUrl }: { ticker: string; logoUrl?: string | null }) {
  const clean = ticker.replace(".", "-");
  const sources = [
    ...(logoUrl ? [logoUrl] : []),
    `https://financialmodelingprep.com/image-stock/${clean}.png`,
  ];
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const active = sources.find((s) => !failed.has(s));

  if (active) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={active}
        alt={ticker}
        className="w-7 h-7 rounded-full object-contain p-0.5 shrink-0"
        style={{ background: "var(--raised)", border: "1px solid var(--border)" }}
        onError={() => setFailed((p) => new Set([...p, active]))}
      />
    );
  }
  return (
    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-black shrink-0"
         style={{ background: "rgba(0,168,94,0.14)", color: "var(--accent-l)" }}>
      {ticker.slice(0, 2)}
    </div>
  );
}

// ─── Sort header cell ─────────────────────────────────────────────────────────

function Th({
  label, sortKey, current, dir, onClick, align = "right",
}: {
  label: string; sortKey: SortKey;
  current: SortKey | null; dir: "asc" | "desc";
  onClick: (k: SortKey) => void; align?: "left" | "right";
}) {
  const active = current === sortKey;
  return (
    <th
      onClick={() => onClick(sortKey)}
      className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap"
      style={{
        color: active ? "var(--accent-l)" : "var(--muted)",
        textAlign: align,
        borderBottom: "1px solid var(--border)",
      }}
    >
      <span className="inline-flex items-center gap-1 justify-end">
        {label}
        {active ? (
          dir === "asc"
            ? <ChevronUp className="w-2.5 h-2.5" />
            : <ChevronDown className="w-2.5 h-2.5" />
        ) : (
          <ChevronsUpDown className="w-2.5 h-2.5 opacity-30" />
        )}
      </span>
    </th>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdvancedStockTable({ rows, mode, onRemove }: Props) {
  const [details, setDetails] = useState<Record<string, {
    volume?: number | null; marketCap?: number | null; pe?: number | null;
    week52Pct?: number | null; earningsDate?: string | null;
    extPrice?: number | null; extPct?: number | null; extLabel?: string | null;
  }>>({});
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const fetchedRef = useRef<string>("");

  const tickers = rows.map((r) => r.ticker);

  useEffect(() => {
    const key = tickers.join(",");
    if (!key || key === fetchedRef.current) return;
    fetchedRef.current = key;
    setLoadingDetails(true);
    marketApi
      .getQuoteDetails(tickers)
      .then((res) => setDetails(res.data || {}))
      .catch(() => {})
      .finally(() => setLoadingDetails(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join(",")]);

  // Merge enriched data
  const enriched: AdvancedRow[] = rows.map((r) => ({
    ...r,
    ...(details[r.ticker] ?? {}),
  }));

  // Sort
  const sorted = [...enriched].sort((a, b) => {
    if (!sortKey) return 0;
    const va = a[sortKey] as number | string | null | undefined;
    const vb = b[sortKey] as number | string | null | undefined;
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  const handleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  const colProps = { current: sortKey, dir: sortDir, onClick: handleSort };

  return (
    <div className="rounded-2xl border overflow-hidden"
         style={{ background: "var(--card)", borderColor: "var(--border)" }}>

      {/* Scroll wrapper */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr style={{ background: "var(--raised)" }}>
              <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide whitespace-nowrap"
                  style={{ color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                Símbolo
              </th>
              <Th label="Precio"    sortKey="price"        {...colProps} />
              <Th label="Var %"     sortKey="changePct"    {...colProps} />
              <Th label="Volumen"   sortKey="volume"       {...colProps} />
              <Th label="Ext."      sortKey="extPrice"     {...colProps} />
              <Th label="Ext. %"    sortKey="extPct"       {...colProps} />
              <Th label="Cap. Mkt"  sortKey="marketCap"    {...colProps} />
              <Th label="P/E"       sortKey="pe"           {...colProps} />
              <Th label="Earnings"  sortKey="earningsDate" {...colProps} />
              <Th label="Var 52s ↑" sortKey="week52Pct"    {...colProps} />
              {mode === "portfolio" && (
                <>
                  <Th label="Valor"   sortKey="positionValue" {...colProps} />
                  <Th label="G/P %"   sortKey="gainLossPct"   {...colProps} />
                </>
              )}
              {onRemove && (
                <th className="px-2 py-2.5 text-[10px]"
                    style={{ borderBottom: "1px solid var(--border)" }} />
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, idx) => {
              const isUp = (row.changePct ?? 0) >= 0;
              const priceColor = isUp ? "#22c55e" : "#ef4444";
              const extUp = (row.extPct ?? 0) >= 0;
              const glUp = (row.gainLossPct ?? 0) >= 0;

              return (
                <tr
                  key={row.ticker}
                  className="transition-colors hover:bg-white/[0.025]"
                  style={{
                    borderBottom: idx < sorted.length - 1 ? "1px solid var(--border)" : "none",
                    borderLeft: `3px solid ${isUp ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
                  }}
                >
                  {/* Symbol */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Avatar ticker={row.ticker} logoUrl={row.logoUrl} />
                      <div className="min-w-0">
                        <p className="text-xs font-black" style={{ color: "var(--text)" }}>{row.ticker}</p>
                        <p className="text-[10px] truncate max-w-[90px]" style={{ color: "var(--muted)" }}>
                          {row.name}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Price */}
                  <td className="px-3 py-2.5 text-right">
                    <span className="text-xs font-bold tabular-nums" style={{ color: "var(--text)" }}>
                      {fmtPrice(row.price, row.currency)}
                    </span>
                  </td>

                  {/* Chg% */}
                  <td className="px-3 py-2.5 text-right">
                    <span className="text-xs font-bold tabular-nums" style={{ color: priceColor }}>
                      {fmtPct(row.changePct)}
                    </span>
                  </td>

                  {/* Volume */}
                  <td className="px-3 py-2.5 text-right">
                    {loadingDetails && !row.volume ? (
                      <Loader2 className="w-3 h-3 animate-spin ml-auto" style={{ color: "var(--muted)" }} />
                    ) : (
                      <span className="text-xs tabular-nums" style={{ color: "var(--sub)" }}>
                        {fmtVol(row.volume)}
                      </span>
                    )}
                  </td>

                  {/* Ext. price */}
                  <td className="px-3 py-2.5 text-right">
                    {row.extPrice ? (
                      <div>
                        <span className="text-[10px] font-semibold tabular-nums"
                              style={{ color: row.extLabel === "Pre" ? "#f59e0b" : "#818cf8" }}>
                          {fmtPrice(row.extPrice, row.currency)}
                        </span>
                        {row.extLabel && (
                          <span className="block text-[8px]" style={{ color: "var(--muted)" }}>
                            {row.extLabel}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--dim)" }}>—</span>
                    )}
                  </td>

                  {/* Ext. % */}
                  <td className="px-3 py-2.5 text-right">
                    <span className="text-xs font-semibold tabular-nums"
                          style={{ color: row.extPct != null ? (extUp ? "#f59e0b" : "#818cf8") : "var(--dim)" }}>
                      {row.extPct != null ? fmtPct(row.extPct) : "—"}
                    </span>
                  </td>

                  {/* Market Cap */}
                  <td className="px-3 py-2.5 text-right">
                    <span className="text-xs tabular-nums" style={{ color: "var(--sub)" }}>
                      {fmtCap(row.marketCap)}
                    </span>
                  </td>

                  {/* P/E */}
                  <td className="px-3 py-2.5 text-right">
                    <span className="text-xs tabular-nums" style={{ color: "var(--sub)" }}>
                      {fmtPE(row.pe)}
                    </span>
                  </td>

                  {/* Earnings Date */}
                  <td className="px-3 py-2.5 text-right">
                    <span className="text-xs" style={{ color: "var(--sub)" }}>
                      {fmtDate(row.earningsDate)}
                    </span>
                  </td>

                  {/* 52w % */}
                  <td className="px-3 py-2.5 text-right">
                    {row.week52Pct != null ? (
                      <span className="text-xs font-semibold tabular-nums"
                            style={{ color: row.week52Pct >= 0 ? "#22c55e" : "#ef4444" }}>
                        +{row.week52Pct.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--dim)" }}>—</span>
                    )}
                  </td>

                  {/* Portfolio-only: Valor + G/P */}
                  {mode === "portfolio" && (
                    <>
                      <td className="px-3 py-2.5 text-right">
                        <span className="text-xs font-bold tabular-nums" style={{ color: "var(--text)" }}>
                          {fmtPrice(row.positionValue, row.currency)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="text-xs font-bold tabular-nums"
                              style={{ color: glUp ? "#22c55e" : "#ef4444" }}>
                          {fmtPct(row.gainLossPct)}
                        </span>
                      </td>
                    </>
                  )}

                  {/* Remove button */}
                  {onRemove && (
                    <td className="px-2 py-2.5 text-right">
                      <button
                        onClick={() => onRemove(row.ticker)}
                        className="w-5 h-5 rounded flex items-center justify-center opacity-30 hover:opacity-100 transition-opacity"
                        style={{ color: "var(--muted)" }}
                      >
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sorted.length === 0 && (
        <p className="text-xs text-center py-8" style={{ color: "var(--muted)" }}>
          Sin datos
        </p>
      )}
    </div>
  );
}
