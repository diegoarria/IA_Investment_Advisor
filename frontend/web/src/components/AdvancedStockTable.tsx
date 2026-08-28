"use client";

import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronUp, ChevronDown, ChevronsUpDown, Loader2, Wifi, WifiOff, Trash2, Pencil } from "lucide-react";
import { market as marketApi } from "@/lib/api";
import { finnhubWS } from "@/lib/services/websocketService";
import {
  fmtPrice, fmtPct, fmtVolume, fmtMarketCap, fmtEarningsDate, changeColor,
} from "@/lib/types/stock";
import FinancialTip from "@/components/FinancialTip";

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
  // Fase 4, Incremento 9 (Watchlist Inteligente, Parte I) — sourced from
  // watchlistApi.getBatchScores (cache-only, never recomputed). Present
  // only in "watchlist" mode when the caller passes showScores; null on
  // any ticker whose analysis isn't cached yet, never fabricated.
  qualityScore?: number | null;
  convictionScore?: number | null;
  marginOfSafetyPct?: number | null;
  opportunityScore?: number | null;
  thesisStatus?: "no_thesis" | "draft_only" | "user_thesis" | null;
  /** improving_count - deteriorating_count from the Deterioration Engine — positive means more improving factors than deteriorating ones. */
  netChangeScore?: number | null;
  topRisk?: string | null;
  topCatalyst?: string | null;
}

import type { UserLevel } from "@/lib/userLevel";

type SortKey = keyof AdvancedRow;
type Mode = "watchlist" | "portfolio";

interface Props {
  rows: AdvancedRow[];
  mode: Mode;
  userLevel?: UserLevel;
  // Applied to prices sourced from live quotes/details, which always arrive in USD
  fxRate?: number;
  onRemove?: (ticker: string) => void;
  onEdit?: (ticker: string) => void;
  onRowClick?: (ticker: string) => void;
  /** Fase 4, Incremento 12 (Personalización, Parte L) — highlights rows
   * whose real marginOfSafetyPct meets this threshold. Purely visual —
   * never changes sort order or which rows render. */
  minMarginOfSafetyPct?: number | null;
}

// A converted price in a currency with a large USD→X rate (MXN, JPY, ARS…)
// can render far wider than the USD original the column was sized for —
// shrink the font instead of letting the fixed-width cell's overflow-hidden
// silently clip digits. Same length-tiered approach as home/page.tsx's
// hero value, tuned to this table's smaller base sizes.
function tabularFontSize(str: string, base: number): number | undefined {
  if (str.length > 12) return Math.max(base - 3, 9);
  if (str.length > 9) return Math.max(base - 2, 9);
  if (str.length > 7) return Math.max(base - 1, 9);
  return undefined;
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ ticker, logoUrl }: { ticker: string; logoUrl?: string | null }) {
  const clean = ticker.replace(".", "-");
  const sources = [
    ...(logoUrl ? [logoUrl] : []),
    `https://assets.parqet.com/logos/symbol/${clean}?format=svg`,
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
  label, sortKey, current, dir, onClick, align = "right", tip, favorite = false,
}: {
  label: string; sortKey: SortKey;
  current: SortKey | null; dir: "asc" | "desc";
  onClick: (k: SortKey) => void; align?: "left" | "right";
  tip?: ReactNode;
  /** Fase 4, Incremento 12 — this column is one of the user's favorite metrics. */
  favorite?: boolean;
}) {
  const active = current === sortKey;
  return (
    <th
      onClick={() => onClick(sortKey)}
      className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap"
      style={{
        color: active ? "var(--accent-l)" : favorite ? "var(--text)" : "var(--muted)",
        textAlign: align,
        borderBottom: active || favorite ? "2px solid var(--accent-l)" : "1px solid var(--border)",
      }}
    >
      <span className="inline-flex items-center gap-0.5 justify-end">
        {favorite && <span style={{ color: "var(--accent-l)" }}>★</span>}
        {tip ?? label}
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

// ─── Delete button ─────────────────────────────────────────────────────────

function DeleteBtn({ ticker, onRemove }: { ticker: string; onRemove: (t: string) => void }) {
  const { t } = useTranslation();

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onRemove(ticker); }}
      className="flex items-center justify-center rounded-lg transition-all mx-auto"
      style={{ width: "28px", height: "28px", color: "var(--dim)" }}
      title={t("advancedStockTable.delete")}
    >
      <Trash2 className="w-4 h-4 opacity-50 hover:opacity-100 transition-opacity" />
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdvancedStockTable({
  rows, mode, userLevel = "avanzado", fxRate = 1, onRemove, onEdit, onRowClick,
  minMarginOfSafetyPct = null,
}: Props) {
  const { t } = useTranslation();
  // All columns visible — the Avanzado toggle already gates access to this table
  const showVol      = true;
  const showCap      = true;
  const showPE       = true;
  const showEarnings = true;
  const showAH       = true;
  const show52W      = true;
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
    // live/details prices always arrive in USD — convert to the row's display currency.
    // r.price is already converted by the caller, so it's used as-is when there's no fresher quote.
    const liveOrDetailPriceUSD = live?.price ?? (d.price as number | null);
    const price = liveOrDetailPriceUSD != null ? liveOrDetailPriceUSD * fxRate : r.price;
    return {
      ...r, ...d, price,
      week52Low:  d.week52Low  != null ? d.week52Low  * fxRate : r.week52Low,
      week52High: d.week52High != null ? d.week52High * fxRate : r.week52High,
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
            ? <><Wifi className="w-3.5 h-3.5" style={{ color: "#22c55e" }} /> {t("advancedStockTable.realTime")}</>
            : <><WifiOff className="w-3.5 h-3.5" /> {t("advancedStockTable.polling15s")}</>}
        </span>
        <span className="text-xs" style={{ color: "var(--dim)" }}>
          {sorted.length} {sorted.length === 1 ? t("advancedStockTable.stockCountOne") : t("advancedStockTable.stockCountOther")}
        </span>
      </div>

      {/* Table */}
      <div className="w-full overflow-x-auto">
        <table className="border-collapse" style={{ tableLayout: "fixed", width: "100%", minWidth: "100%" }}>
          <colgroup>
            <col style={{ width: "22%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "9%"  }} />
            {showVol      && <col style={{ width: "9%"  }} />}
            {showAH       && <col style={{ width: "11%" }} />}
            {showCap      && <col style={{ width: "9%"  }} />}
            {showPE       && <col style={{ width: "7%"  }} />}
            {showEarnings && <col style={{ width: "9%"  }} />}
            {show52W      && <col style={{ width: "14%" }} />}
            {mode === "portfolio" && <col style={{ width: "10%" }} />}
            {mode === "portfolio" && <col style={{ width: "9%"  }} />}
            {onEdit       && <col style={{ width: "5%"  }} />}
            {onRemove     && <col style={{ width: "5%"  }} />}
          </colgroup>

          <thead>
            <tr style={{ background: "var(--raised)" }}>
              <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide whitespace-nowrap"
                  style={{ color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                {t("advancedStockTable.symbol")}
              </th>
              <Th label={t("advancedStockTable.price")}      sortKey="price"        {...colProps} />
              <Th label={t("advancedStockTable.changePct")}  sortKey="changePct"    {...colProps} />
              {showVol      && <Th label={t("advancedStockTable.volume")} sortKey="volume"       {...colProps} tip={<FinancialTip term="Volume" userLevel={userLevel}>{t("advancedStockTable.volume")}</FinancialTip>} />}
              {showAH       && <Th label="AH"       sortKey="extPct"       {...colProps} tip={<FinancialTip term="AH" userLevel={userLevel}>AH</FinancialTip>} />}
              {showCap      && <Th label="Cap"      sortKey="marketCap"    {...colProps} tip={<FinancialTip term="Market Cap" userLevel={userLevel}>Cap</FinancialTip>} />}
              {showPE       && <Th label="P/E"      sortKey="pe"           {...colProps} tip={<FinancialTip term="P/E" userLevel={userLevel}>P/E</FinancialTip>} />}
              {showEarnings && <Th label="Earnings" sortKey="earningsDate" {...colProps} tip={<FinancialTip term="Earnings" userLevel={userLevel}>Earnings</FinancialTip>} />}
              {show52W      && <Th label="52W"      sortKey="week52High"   {...colProps} tip={<FinancialTip term="52W High" userLevel={userLevel}>52W</FinancialTip>} />}
              {mode === "portfolio" && (
                <>
                  <Th label={t("advancedStockTable.value")}       sortKey="positionValue" {...colProps} tip={<FinancialTip term="Value" userLevel={userLevel}>{t("advancedStockTable.value")}</FinancialTip>} />
                  <Th label={t("advancedStockTable.gainLossPct")} sortKey="gainLossPct"   {...colProps} tip={<FinancialTip term="Gain/Loss %" userLevel={userLevel}>{t("advancedStockTable.gainLossPct")}</FinancialTip>} />
                </>
              )}
              {onEdit && (
                <th className="px-3 py-2.5"
                    style={{ borderBottom: "1px solid var(--border)" }} />
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
              // Fase 4, Incremento 12 — meets the user's own minimum margin
              // of safety (purely visual, never changes sort/filtering).
              const meetsMinMoS = minMarginOfSafetyPct !== null && row.marginOfSafetyPct != null
                && row.marginOfSafetyPct >= minMarginOfSafetyPct;

              return (
                <tr
                  key={row.ticker}
                  className="transition-colors hover:bg-white/[0.025]"
                  onClick={() => onRowClick?.(row.ticker)}
                  style={{
                    cursor: onRowClick ? "pointer" : "default",
                    borderBottom: idx < sorted.length - 1 ? "1px solid var(--border)" : "none",
                    borderLeft: `3px solid ${isUp ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
                    background: meetsMinMoS ? "rgba(0,168,94,0.06)" : undefined,
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
                    ) : (() => {
                      const priceStr = fmtPrice(row.price, currency);
                      return (
                        <span className="font-bold tabular-nums whitespace-nowrap" style={{ color: "var(--text)", fontSize: tabularFontSize(priceStr, 14) ?? 14 }}>
                          {priceStr}
                        </span>
                      );
                    })()}
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
                          <p className="font-bold tabular-nums leading-none whitespace-nowrap" style={{ color: "#ef4444", fontSize: tabularFontSize(fmtPrice(row.week52Low, currency), 12) ?? 12 }}>
                            ↓{fmtPrice(row.week52Low, currency)}
                          </p>
                          <p className="font-bold tabular-nums leading-none mt-1 whitespace-nowrap" style={{ color: "#22c55e", fontSize: tabularFontSize(fmtPrice(row.week52High, currency), 12) ?? 12 }}>
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
                        {(() => {
                          const valueStr = fmtPrice(row.positionValue, currency);
                          return (
                            <span className="font-bold tabular-nums whitespace-nowrap" style={{ color: "var(--text)", fontSize: tabularFontSize(valueStr, 14) ?? 14 }}>
                              {valueStr}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2.5 text-right overflow-hidden">
                        <span className="text-sm font-bold tabular-nums"
                              style={{ color: glUp ? "#22c55e" : "#ef4444" }}>
                          {fmtPct(row.gainLossPct)}
                        </span>
                      </td>
                    </>
                  )}

                  {/* Edit */}
                  {onEdit && (
                    <td className="px-2 py-2.5 text-center overflow-hidden">
                      <button
                        onClick={(e) => { e.stopPropagation(); onEdit(row.ticker); }}
                        className="flex items-center justify-center rounded-lg transition-all mx-auto"
                        style={{ width: "28px", height: "28px", color: "var(--dim)", border: "1px solid transparent" }}
                        title={t("advancedStockTable.editPosition")}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--accent-l)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,168,94,0.3)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--dim)"; (e.currentTarget as HTMLElement).style.borderColor = "transparent"; }}
                      >
                        <Pencil className="w-3.5 h-3.5 opacity-50 hover:opacity-100 transition-opacity" />
                      </button>
                    </td>
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
          {t("advancedStockTable.noData")}
        </p>
      )}
    </div>
  );
}
