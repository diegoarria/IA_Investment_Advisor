"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, Loader2, Wifi, WifiOff, Trash2 } from "lucide-react";
import { market as marketApi } from "@/lib/api";
import { finnhubWS } from "@/lib/services/websocketService";
import {
  fmtPrice, fmtPct, fmtVolume, fmtMarketCap, fmtEarningsDate, changeColor,
} from "@/lib/types/stock";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AdvancedRow {
  ticker: string;
  name: string;
  logoUrl?: string | null;
  price: number | null;
  change?: number | null;
  changePct: number | null;
  currency?: string;
  marketState?: string | null;
  volume?: number | null;
  marketCap?: number | null;
  pe?: number | null;
  week52Pct?: number | null;
  week52Low?: number | null;
  week52High?: number | null;
  earningsDate?: string | null;
  extPrice?: number | null;
  extChange?: number | null;
  extPct?: number | null;
  extLabel?: string | null;
  companyName?: string | null;
  shares?: number | null;
  avgCost?: number | null;
  positionValue?: number | null;
  gainLossPct?: number | null;
}

import { isAtLeast, type UserLevel } from "@/lib/userLevel";

type SortKey = keyof AdvancedRow;
type Mode = "watchlist" | "portfolio";

interface Props {
  rows: AdvancedRow[];
  mode: Mode;
  userLevel?: UserLevel;
  onRemove?: (ticker: string) => void;
  onRowClick?: (ticker: string) => void;
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
        src={active} alt={ticker}
        className="w-7 h-7 rounded-full object-contain p-0.5 shrink-0"
        style={{ background: "var(--raised)", border: "1px solid var(--border)" }}
        onError={() => setFailed((p) => new Set([...p, active]))}
      />
    );
  }
  return (
    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black shrink-0"
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
      className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap"
      style={{
        color: active ? "var(--accent-l)" : "var(--muted)",
        textAlign: align,
        borderBottom: "1px solid var(--border)",
      }}
    >
      <span className="inline-flex items-center gap-0.5 justify-end">
        {label}
        {active
          ? dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
          : <ChevronsUpDown className="w-3 h-3 opacity-30" />}
      </span>
    </th>
  );
}

// ─── Live dot ─────────────────────────────────────────────────────────────────

function LiveDot({ live }: { live: boolean }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full ml-0.5 shrink-0"
      style={{ background: live ? "#22c55e" : "var(--dim)" }}
      title={live ? "WebSocket" : "Polling"}
    />
  );
}

// ─── Delete button with 2-tap confirm ─────────────────────────────────────────

function DeleteBtn({ ticker, onRemove }: { ticker: string; onRemove: (t: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirming) {
      if (timer.current) clearTimeout(timer.current);
      onRemove(ticker);
    } else {
      setConfirming(true);
      timer.current = setTimeout(() => setConfirming(false), 3000);
    }
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <button
      onClick={handleClick}
      className="flex items-center justify-center rounded-lg transition-all mx-auto"
      style={{
        width: confirming ? "auto" : "28px",
        height: "28px",
        padding: confirming ? "0 8px" : "0",
        background: confirming ? "rgba(239,68,68,0.12)" : "transparent",
        color: confirming ? "#ef4444" : "var(--dim)",
        border: confirming ? "1px solid rgba(239,68,68,0.3)" : "1px solid transparent",
      }}
      title={confirming ? "Toca para confirmar" : "Eliminar"}
    >
      {confirming
        ? <span className="text-xs font-black whitespace-nowrap">¿OK?</span>
        : <Trash2 className="w-4 h-4 opacity-50 hover:opacity-100 transition-opacity" />}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdvancedStockTable({ rows, mode, userLevel = "avanzado", onRemove, onRowClick }: Props) {
  // Column visibility based on user level
  const showVol      = isAtLeast(userLevel, "intermedio");
  const showCap      = isAtLeast(userLevel, "intermedio");
  const showPE       = isAtLeast(userLevel, "intermedio");
  const showEarnings = isAtLeast(userLevel, "intermedio");
  const showAH       = isAtLeast(userLevel, "basico");
  const show52W      = isAtLeast(userLevel, "basico");
  const [details, setDetails]               = useState<Record<string, Partial<AdvancedRow>>>({});
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [livePrices, setLivePrices]         = useState<Record<string, { price: number; ts: number }>>({});
  const [wsConnected, setWsConnected]       = useState(false);
  const [sortKey, setSortKey]               = useState<SortKey | null>(null);
  const [sortDir, setSortDir]               = useState<"asc" | "desc">("desc");

  const tickers   = rows.map((r) => r.ticker);
  const tickerKey = tickers.join(",");
  const fetchedRef = useRef<string>("");

  const fetchDetails = useCallback((isInitial = false) => {
    if (!tickerKey) return;
    if (isInitial) setLoadingDetails(true);
    marketApi
      .getQuoteDetails(tickers)
      .then((res) => setDetails(res.data as Record<string, Partial<AdvancedRow>> || {}))
      .catch(() => {})
      .finally(() => { if (isInitial) setLoadingDetails(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerKey]);

  useEffect(() => {
    fetchedRef.current = tickerKey;
    fetchDetails(true);
  }, [fetchDetails]);

  useEffect(() => {
    if (!tickerKey) return;
    const interval = setInterval(() => fetchDetails(false), 15_000);
    return () => clearInterval(interval);
  }, [fetchDetails, tickerKey]);

  useEffect(() => {
    if (!tickers.length) return;
    const unsub = finnhubWS.subscribe(tickers, (symbol, price, ts) => {
      setLivePrices((prev) => ({ ...prev, [symbol]: { price, ts } }));
      setWsConnected(true);
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerKey]);

  const enriched: AdvancedRow[] = rows.map((r) => {
    const d    = details[r.ticker] ?? {};
    const live = livePrices[r.ticker];
    const price = live?.price ?? (d.price as number | null) ?? r.price;
    return {
      ...r, ...d, price,
      change:    (d.change    as number | null) ?? r.change    ?? null,
      changePct: (d.changePct as number | null) ?? r.changePct,
    };
  });

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
    <div className="rounded-xl border overflow-hidden"
         style={{ background: "var(--card)", borderColor: "var(--border)" }}>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b"
           style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
        <span className="text-xs font-semibold flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
          {wsConnected
            ? <><Wifi className="w-3.5 h-3.5" style={{ color: "#22c55e" }} /> Tiempo real</>
            : <><WifiOff className="w-3.5 h-3.5" /> Polling 15s</>}
        </span>
        <span className="text-xs" style={{ color: "var(--dim)" }}>
          {sorted.length} {sorted.length === 1 ? "acción" : "acciones"}
        </span>
      </div>

      {/* Table */}
      <div className="w-full overflow-hidden">
        <table className="w-full border-collapse" style={{ tableLayout: isAtLeast(userLevel, "intermedio") ? "fixed" : "auto" }}>
          <colgroup>
            <col style={{ width: isAtLeast(userLevel, "intermedio") ? "22%" : showAH ? "30%" : "50%" }} />
            <col style={{ width: isAtLeast(userLevel, "intermedio") ? "10%" : showAH ? "14%" : "24%" }} />
            <col style={{ width: isAtLeast(userLevel, "intermedio") ? "9%"  : showAH ? "11%" : "26%" }} />
            {showVol      && <col style={{ width: "9%"  }} />}
            {showAH       && <col style={{ width: isAtLeast(userLevel, "intermedio") ? "11%" : "21%" }} />}
            {showCap      && <col style={{ width: "9%"  }} />}
            {showPE       && <col style={{ width: "7%"  }} />}
            {showEarnings && <col style={{ width: "9%"  }} />}
            {show52W      && <col style={{ width: isAtLeast(userLevel, "intermedio") ? "14%" : "24%" }} />}
            {mode === "portfolio" && <col style={{ width: "10%" }} />}
            {mode === "portfolio" && <col style={{ width: "9%"  }} />}
            {onRemove     && <col style={{ width: "5%"  }} />}
          </colgroup>

          <thead>
            <tr style={{ background: "var(--raised)" }}>
              <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide whitespace-nowrap"
                  style={{ color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                Símbolo
              </th>
              <Th label="Precio"   sortKey="price"        {...colProps} />
              <Th label="Var %"    sortKey="changePct"    {...colProps} />
              {showVol      && <Th label="Vol"      sortKey="volume"       {...colProps} />}
              {showAH       && <Th label="AH"       sortKey="extPct"       {...colProps} />}
              {showCap      && <Th label="Cap"      sortKey="marketCap"    {...colProps} />}
              {showPE       && <Th label="P/E"      sortKey="pe"           {...colProps} />}
              {showEarnings && <Th label="Earnings" sortKey="earningsDate" {...colProps} />}
              {show52W      && <Th label="52W"      sortKey="week52High"   {...colProps} />}
              {mode === "portfolio" && (
                <>
                  <Th label="Valor" sortKey="positionValue" {...colProps} />
                  <Th label="G/P %" sortKey="gainLossPct"   {...colProps} />
                </>
              )}
              {onRemove && (
                <th className="px-3 py-2.5"
                    style={{ borderBottom: "1px solid var(--border)" }} />
              )}
            </tr>
          </thead>

          <tbody>
            {sorted.map((row, idx) => {
              const currency   = row.currency ?? "USD";
              const isUp       = (row.changePct ?? 0) >= 0;
              const priceColor = changeColor(row.changePct);
              const glUp       = (row.gainLossPct ?? 0) >= 0;
              const isLive     = !!livePrices[row.ticker];
              const hasAH      = row.extPrice != null;

              return (
                <tr
                  key={row.ticker}
                  className="transition-colors hover:bg-white/[0.025]"
                  onClick={() => onRowClick?.(row.ticker)}
                  style={{
                    cursor: onRowClick ? "pointer" : "default",
                    borderBottom: idx < sorted.length - 1 ? "1px solid var(--border)" : "none",
                    borderLeft: `3px solid ${isUp ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
                  }}
                >
                  {/* Symbol + Name */}
                  <td className="px-3 py-2.5 overflow-hidden">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar ticker={row.ticker} logoUrl={row.logoUrl} />
                      <div className="min-w-0 overflow-hidden">
                        <div className="flex items-center gap-1">
                          <p className="text-[15px] font-bold leading-none truncate" style={{ color: "var(--text)" }}>
                            {row.ticker}
                          </p>
                          <LiveDot live={isLive} />
                        </div>
                        <p className="text-[13px] truncate mt-0.5" style={{ color: "var(--muted)" }}>
                          {row.companyName ?? row.name}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Price */}
                  <td className="px-3 py-2.5 text-right overflow-hidden">
                    {loadingDetails && row.price == null ? (
                      <Loader2 className="w-4 h-4 animate-spin ml-auto" style={{ color: "var(--muted)" }} />
                    ) : (
                      <span className="text-sm font-bold tabular-nums" style={{ color: "var(--text)" }}>
                        {fmtPrice(row.price, currency)}
                      </span>
                    )}
                  </td>

                  {/* Change % */}
                  <td className="px-3 py-2.5 text-right overflow-hidden">
                    <span className="text-sm font-bold tabular-nums" style={{ color: priceColor }}>
                      {fmtPct(row.changePct)}
                    </span>
                  </td>

                  {/* Volume */}
                  {showVol && (
                    <td className="px-3 py-2.5 text-right overflow-hidden">
                      {loadingDetails && row.volume == null ? (
                        <Loader2 className="w-4 h-4 animate-spin ml-auto" style={{ color: "var(--muted)" }} />
                      ) : (
                        <span className="text-sm font-bold tabular-nums" style={{ color: "var(--sub)" }}>
                          {fmtVolume(row.volume)}
                        </span>
                      )}
                    </td>
                  )}

                  {/* AH — price + % stacked */}
                  {showAH && (
                    <td className="px-3 py-2.5 text-right overflow-hidden">
                      {hasAH ? (
                        <div>
                          {row.extPct != null && (
                            <p className="text-[13px] font-bold tabular-nums leading-none"
                               style={{ color: row.extPct >= 0 ? "#22c55e" : "#ef4444" }}>
                              {fmtPct(row.extPct)}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm" style={{ color: "var(--dim)" }}>—</span>
                      )}
                    </td>
                  )}

                  {/* Market Cap */}
                  {showCap && (
                    <td className="px-3 py-2.5 text-right overflow-hidden">
                      <span className="text-sm font-bold tabular-nums" style={{ color: "var(--sub)" }}>
                        {fmtMarketCap(row.marketCap)}
                      </span>
                    </td>
                  )}

                  {/* P/E */}
                  {showPE && (
                    <td className="px-3 py-2.5 text-right overflow-hidden">
                      <span className="text-sm font-bold tabular-nums" style={{ color: "var(--sub)" }}>
                        {row.pe != null ? row.pe.toFixed(1) : "—"}
                      </span>
                    </td>
                  )}

                  {/* Earnings Date */}
                  {showEarnings && (
                    <td className="px-3 py-2.5 text-right overflow-hidden">
                      <span className="text-[13px] font-bold" style={{ color: "var(--sub)" }}>
                        {fmtEarningsDate(row.earningsDate)}
                      </span>
                    </td>
                  )}

                  {/* 52W range — stacked low / high */}
                  {show52W && (
                    <td className="px-3 py-2.5 text-right overflow-hidden">
                      {row.week52Low != null && row.week52High != null ? (
                        <div>
                          <p className="text-xs font-bold tabular-nums leading-none" style={{ color: "#ef4444" }}>
                            ↓{fmtPrice(row.week52Low, currency)}
                          </p>
                          <p className="text-xs font-bold tabular-nums leading-none mt-1" style={{ color: "#22c55e" }}>
                            ↑{fmtPrice(row.week52High, currency)}
                          </p>
                        </div>
                      ) : (
                        <span className="text-sm" style={{ color: "var(--dim)" }}>—</span>
                      )}
                    </td>
                  )}

                  {/* Portfolio: Valor + G/P */}
                  {mode === "portfolio" && (
                    <>
                      <td className="px-3 py-2.5 text-right overflow-hidden">
                        <span className="text-sm font-bold tabular-nums" style={{ color: "var(--text)" }}>
                          {fmtPrice(row.positionValue, currency)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right overflow-hidden">
                        <span className="text-sm font-bold tabular-nums"
                              style={{ color: glUp ? "#22c55e" : "#ef4444" }}>
                          {fmtPct(row.gainLossPct)}
                        </span>
                      </td>
                    </>
                  )}

                  {/* Remove */}
                  {onRemove && (
                    <td className="px-2 py-2.5 text-center overflow-hidden">
                      <DeleteBtn ticker={row.ticker} onRemove={onRemove} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sorted.length === 0 && (
        <p className="text-sm text-center py-8" style={{ color: "var(--muted)" }}>
          Sin datos
        </p>
      )}
    </div>
  );
}
