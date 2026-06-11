"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronUp, ChevronDown, Loader2, Wifi, WifiOff, Trash2 } from "lucide-react";
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

type SortKey = keyof AdvancedRow;
type Mode = "watchlist" | "portfolio";

interface Props {
  rows: AdvancedRow[];
  mode: Mode;
  onRemove?: (ticker: string) => void;
  onRowClick?: (ticker: string) => void;
}

// ─── Sort options ─────────────────────────────────────────────────────────────

const SORT_WATCHLIST: { key: SortKey; label: string }[] = [
  { key: "ticker",       label: "Ticker"   },
  { key: "price",        label: "Precio"   },
  { key: "changePct",    label: "Var %"    },
  { key: "marketCap",    label: "Cap"      },
  { key: "pe",           label: "P/E"      },
  { key: "earningsDate", label: "Earnings" },
];

const SORT_PORTFOLIO: { key: SortKey; label: string }[] = [
  { key: "ticker",       label: "Ticker"  },
  { key: "gainLossPct",  label: "G/P %"   },
  { key: "positionValue",label: "Valor"   },
  { key: "price",        label: "Precio"  },
  { key: "changePct",    label: "Var %"   },
];

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
        className="w-8 h-8 rounded-xl object-contain p-1 shrink-0"
        style={{ background: "var(--raised)", border: "1px solid var(--border)" }}
        onError={() => setFailed((p) => new Set([...p, active]))}
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-black shrink-0"
         style={{ background: "rgba(0,168,94,0.14)", color: "var(--accent-l)" }}>
      {ticker.slice(0, 2)}
    </div>
  );
}

// ─── Market state badge ───────────────────────────────────────────────────────

function MarketBadge({ state }: { state: string | null | undefined }) {
  if (!state || state === "REGULAR") return null;
  const label = state === "PRE" ? "Pre-market" : state === "POST" ? "Post-market" : "Cerrado";
  return (
    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-md"
          style={{ background: "rgba(251,191,36,0.1)", color: "#fbbf24" }}>
      {label}
    </span>
  );
}

// ─── Stat cell ────────────────────────────────────────────────────────────────

function StatCell({
  label, value, loading, color,
}: {
  label: string; value: string; loading?: boolean; color?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[8px] font-bold uppercase tracking-wider leading-none"
         style={{ color: "var(--dim)" }}>
        {label}
      </p>
      {loading ? (
        <Loader2 className="w-2.5 h-2.5 animate-spin" style={{ color: "var(--dim)" }} />
      ) : (
        <p className="text-[11px] font-semibold tabular-nums leading-none"
           style={{ color: color ?? "var(--sub)" }}>
          {value}
        </p>
      )}
    </div>
  );
}

// ─── Single stock card ────────────────────────────────────────────────────────

function StockCard({
  row, mode, onRemove, onRowClick, isLive, loadingDetails,
}: {
  row: AdvancedRow;
  mode: Mode;
  onRemove?: (t: string) => void;
  onRowClick?: (t: string) => void;
  isLive: boolean;
  loadingDetails: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currency   = row.currency ?? "USD";
  const priceColor = changeColor(row.changePct);
  const glUp       = (row.gainLossPct ?? 0) >= 0;
  const glColor    = glUp ? "#22c55e" : "#ef4444";
  const loading    = loadingDetails && row.price == null;

  const w52Pct =
    row.week52High != null &&
    row.week52Low  != null &&
    row.price      != null &&
    row.week52High > row.week52Low
      ? Math.max(0, Math.min(100,
          ((row.price - row.week52Low) / (row.week52High - row.week52Low)) * 100,
        ))
      : null;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirming) {
      if (timerRef.current) clearTimeout(timerRef.current);
      onRemove?.(row.ticker);
    } else {
      setConfirming(true);
      timerRef.current = setTimeout(() => setConfirming(false), 3000);
    }
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <div
      className="transition-colors hover:bg-white/[0.02]"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      {/* ── Row 1: Identity + Price + Delete ── */}
      <div
        className="flex items-start justify-between gap-3 px-3 pt-3 pb-2"
        style={{ cursor: onRowClick ? "pointer" : "default" }}
        onClick={() => onRowClick?.(row.ticker)}
      >
        {/* Left: logo + ticker + name */}
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar ticker={row.ticker} logoUrl={row.logoUrl} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[14px] font-black leading-none" style={{ color: "var(--text)" }}>
                {row.ticker}
              </span>
              {isLive && (
                <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: "#22c55e" }} title="Tiempo real" />
              )}
              <MarketBadge state={row.marketState} />
            </div>
            <p className="text-[10px] mt-0.5 truncate max-w-[180px]" style={{ color: "var(--muted)" }}>
              {row.companyName ?? row.name}
            </p>
          </div>
        </div>

        {/* Right: price + delete */}
        <div className="flex items-start gap-2 shrink-0">
          <div className="text-right">
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin ml-auto" style={{ color: "var(--muted)" }} />
            ) : (
              <>
                <p className="text-[14px] font-black tabular-nums leading-none" style={{ color: "var(--text)" }}>
                  {fmtPrice(row.price, currency)}
                </p>
                <p className="text-[11px] font-bold tabular-nums mt-0.5" style={{ color: priceColor }}>
                  {fmtPct(row.changePct)}
                </p>
              </>
            )}
          </div>

          {onRemove && (
            <button
              onClick={handleDelete}
              className="rounded-lg flex items-center justify-center transition-all mt-0.5"
              style={{
                minWidth: confirming ? "auto" : "26px",
                height: "26px",
                padding: confirming ? "0 8px" : "0",
                background: confirming ? "rgba(239,68,68,0.12)" : "rgba(0,0,0,0.0)",
                color: confirming ? "#ef4444" : "var(--dim)",
                border: confirming ? "1px solid rgba(239,68,68,0.35)" : "1px solid transparent",
              }}
              title={confirming ? "Toca para confirmar" : "Eliminar"}
            >
              {confirming
                ? <span className="text-[9px] font-black whitespace-nowrap">¿Eliminar?</span>
                : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* ── Row 2: Stats grid (4 cols) ── */}
      <div className="grid grid-cols-4 gap-x-3 gap-y-2 px-3 pb-2.5">
        <StatCell
          label="Volumen"
          value={fmtVolume(row.volume)}
          loading={loadingDetails && row.volume == null}
        />
        <StatCell
          label="Mkt Cap"
          value={fmtMarketCap(row.marketCap)}
          loading={loadingDetails && row.marketCap == null}
        />
        <StatCell
          label="P/E"
          value={row.pe != null ? row.pe.toFixed(1) : "—"}
          loading={loadingDetails && row.pe == null}
        />
        <StatCell
          label="Earnings"
          value={fmtEarningsDate(row.earningsDate)}
          loading={loadingDetails && row.earningsDate == null}
        />
      </div>

      {/* ── Row 3: 52-week bar ── */}
      {(row.week52Low != null || row.week52High != null) && (
        <div className="px-3 pb-2.5 flex items-center gap-2">
          <span className="text-[9px] tabular-nums font-semibold shrink-0" style={{ color: "#ef4444" }}>
            {row.week52Low != null ? fmtPrice(row.week52Low, currency) : "—"}
          </span>
          <div className="flex-1 h-[5px] rounded-full relative overflow-visible"
               style={{ background: "var(--border)" }}>
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: w52Pct != null ? `${w52Pct}%` : "0%",
                background: "linear-gradient(90deg, rgba(239,68,68,0.5), var(--accent-l))",
              }}
            />
            {w52Pct != null && (
              <div
                className="absolute w-2.5 h-2.5 rounded-full -translate-x-1/2 -translate-y-[2.5px]"
                style={{ left: `${w52Pct}%`, background: "var(--accent-l)", border: "2px solid var(--card)" }}
              />
            )}
          </div>
          <span className="text-[9px] tabular-nums font-semibold shrink-0" style={{ color: "#22c55e" }}>
            {row.week52High != null ? fmtPrice(row.week52High, currency) : "—"}
          </span>
          <span className="text-[8px] font-bold shrink-0" style={{ color: "var(--dim)" }}>52W</span>
        </div>
      )}

      {/* ── Row 4: After-hours (only if present) ── */}
      {row.extPrice != null && (
        <div className="px-3 pb-2.5 flex items-center gap-2">
          <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-md"
                style={{ background: "rgba(251,191,36,0.1)", color: "#fbbf24" }}>
            {row.extLabel ?? "AH"}
          </span>
          <span className="text-[12px] tabular-nums font-semibold" style={{ color: "var(--text)" }}>
            {fmtPrice(row.extPrice, currency)}
          </span>
          {row.extPct != null && (
            <span className="text-[11px] font-bold tabular-nums"
                  style={{ color: row.extPct >= 0 ? "#22c55e" : "#ef4444" }}>
              {fmtPct(row.extPct)}
            </span>
          )}
        </div>
      )}

      {/* ── Row 5: Portfolio position (only in portfolio mode) ── */}
      {mode === "portfolio" && (
        <div className="grid grid-cols-4 gap-x-3 px-3 py-2.5"
             style={{ borderTop: "1px solid var(--border)", background: "rgba(0,0,0,0.02)" }}>
          <StatCell
            label="Acciones"
            value={row.shares != null ? row.shares.toLocaleString("en-US") : "—"}
          />
          <StatCell
            label="P. Compra"
            value={fmtPrice(row.avgCost, currency)}
          />
          <StatCell
            label="Valor hoy"
            value={fmtPrice(row.positionValue, currency)}
            color="var(--text)"
          />
          <StatCell
            label="G/P"
            value={row.gainLossPct != null ? fmtPct(row.gainLossPct) : "—"}
            color={glColor}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdvancedStockTable({ rows, mode, onRemove, onRowClick }: Props) {
  const [details, setDetails]             = useState<Record<string, Partial<AdvancedRow>>>({});
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [livePrices, setLivePrices]       = useState<Record<string, { price: number; ts: number }>>({});
  const [wsConnected, setWsConnected]     = useState(false);
  const [sortKey, setSortKey]             = useState<SortKey | null>(null);
  const [sortDir, setSortDir]             = useState<"asc" | "desc">("desc");

  const tickers  = rows.map((r) => r.ticker);
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
    return { ...r, ...d, price, change: (d.change as number | null) ?? r.change ?? null,
             changePct: (d.changePct as number | null) ?? r.changePct };
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

  const sortOptions = mode === "portfolio" ? SORT_PORTFOLIO : SORT_WATCHLIST;

  return (
    <div className="rounded-2xl border overflow-hidden"
         style={{ background: "var(--card)", borderColor: "var(--border)" }}>

      {/* ── Header bar ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b"
           style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-bold flex items-center gap-1" style={{ color: "var(--muted)" }}>
            {wsConnected
              ? <><Wifi className="w-2.5 h-2.5" style={{ color: "#22c55e" }} /> Tiempo real</>
              : <><WifiOff className="w-2.5 h-2.5" /> Polling 15s</>}
          </span>
        </div>
        <span className="text-[9px]" style={{ color: "var(--dim)" }}>
          {sorted.length} {sorted.length === 1 ? "acción" : "acciones"}
        </span>
      </div>

      {/* ── Sort chips ── */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b flex-wrap"
           style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
        <span className="text-[8px] font-bold uppercase tracking-wider shrink-0"
              style={{ color: "var(--dim)" }}>
          Ordenar
        </span>
        {sortOptions.map(({ key, label }) => {
          const active = sortKey === key;
          return (
            <button
              key={key}
              onClick={() => handleSort(key)}
              className="flex items-center gap-0.5 px-2 py-0.5 rounded-lg text-[9px] font-bold transition-all"
              style={{
                background: active ? "var(--accent-l)" : "var(--border)",
                color: active ? "white" : "var(--muted)",
              }}
            >
              {label}
              {active && (
                sortDir === "asc"
                  ? <ChevronUp className="w-2 h-2" />
                  : <ChevronDown className="w-2 h-2" />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Stock cards ── */}
      {sorted.length > 0 ? (
        sorted.map((row) => (
          <StockCard
            key={row.ticker}
            row={row}
            mode={mode}
            onRemove={onRemove}
            onRowClick={onRowClick}
            isLive={!!livePrices[row.ticker]}
            loadingDetails={loadingDetails}
          />
        ))
      ) : (
        <p className="text-[11px] text-center py-8" style={{ color: "var(--muted)" }}>
          Sin datos
        </p>
      )}
    </div>
  );
}
