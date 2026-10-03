"use client";

import { createContext, useContext } from "react";
import { useTranslation } from "react-i18next";

// ─── Formatters ───────────────────────────────────────────────────────────────

export function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "N/A";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3)  return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function fmtEPS(v: number | null | undefined): string {
  if (v == null) return "N/A";
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
}

export function safeNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

export function pctChange(curr: number, prev: number): number | null {
  if (!prev || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

export function fmtYear(period: string): string {
  return period?.slice(0, 4) ?? "—";
}

/** Column label for a period: "2025" for annual, "T3 2025" / "Q3 2025" for
 *  quarterly (calendar quarter of the period's end date). Annual-only labels
 *  made every quarterly column read "2025 2025 2025 2025". */
export function fmtPeriod(period: string, quarterly: boolean, lang: string): string {
  if (!period) return "—";
  if (!quarterly) return fmtYear(period);
  const m = Number(period.slice(5, 7));
  if (!m) return fmtYear(period);
  const q = Math.ceil(m / 3);
  return `${lang === "en" ? "Q" : "T"}${q} ${period.slice(0, 4)}`;
}

export type Row = Record<string, unknown>;

export const FIN_UP = "#22c55e";
export const FIN_DOWN = "#ef4444";

// Shared with every row so a statement only says "annual vs quarterly" once.
const PeriodCtx = createContext<{ quarterly: boolean }>({ quarterly: false });

// ─── Table shell ──────────────────────────────────────────────────────────────
// Built to be read by someone who has never seen a financial statement:
// one plain-language name per line, a short "what this means" under the
// lines that matter, the most recent period highlighted, and the change vs
// the previous period right under each total.

const METRIC_COL_WIDTH = 260;

interface FinancialsCardProps {
  title: string;
  subtitle?: string;
  growthNote?: string;
  rows: Row[];
  latestLabel?: string;
  quarterly?: boolean;
  children: React.ReactNode;
}

export function FinancialsCard({ title, subtitle, growthNote, rows, latestLabel, quarterly = false, children }: FinancialsCardProps) {
  const { i18n } = useTranslation();
  return (
    <PeriodCtx.Provider value={{ quarterly }}>
      <div className="rounded-2xl overflow-hidden border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="flex flex-wrap items-end justify-between gap-2 px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
          <div>
            <p className="text-[15px] font-black tracking-tight" style={{ color: "var(--text)" }}>{title}</p>
            {subtitle && <p className="text-[12px] mt-0.5" style={{ color: "var(--muted)" }}>{subtitle}</p>}
          </div>
          {growthNote && (
            <span className="text-[11px] font-semibold" style={{ color: "var(--muted)" }}>{growthNote}</span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 text-left px-5 py-3 font-normal border-b"
                    style={{ width: METRIC_COL_WIDTH, minWidth: 210, background: "var(--raised)", borderColor: "var(--border)" }} />
                {rows.map((r, i) => {
                  const isLast = i === rows.length - 1;
                  return (
                    <th key={i}
                        className="sticky top-0 z-10 text-right px-4 py-3 font-normal whitespace-nowrap border-b"
                        style={{
                          background: isLast ? "rgba(0,168,94,0.10)" : "var(--raised)",
                          borderColor: "var(--border)",
                        }}>
                      <span className="text-[13px] tabular-nums" style={{ fontWeight: 800, color: isLast ? "var(--accent-l)" : "var(--sub)" }}>
                        {fmtPeriod(String(r.period ?? ""), quarterly, i18n.language)}
                      </span>
                      {isLast && latestLabel && (
                        <div className="text-[9px] font-black uppercase tracking-wider mt-0.5" style={{ color: "var(--accent-l)" }}>
                          {latestLabel}
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      </div>
    </PeriodCtx.Provider>
  );
}

export function Section({ label, color = "var(--dim)", hint }: { label: string; color?: string; hint?: string }) {
  const cols = 9; // wide enough colSpan for any statement — extra cells are simply empty
  return (
    <tr>
      <td className="sticky left-0 z-[1] px-5 pt-6 pb-2" style={{ background: "var(--card)" }}>
        <div className="flex items-center gap-2">
          <div className="w-1 h-3.5 rounded-full shrink-0" style={{ background: color }} />
          <span className="text-[11px] font-black uppercase tracking-[1px]" style={{ color: "var(--text)" }}>
            {label}
          </span>
        </div>
        {hint && <p className="text-[11px] leading-4 mt-1 pl-3" style={{ color: "var(--muted)" }}>{hint}</p>}
      </td>
      <td className="pt-6 pb-2" colSpan={cols} />
    </tr>
  );
}

function GrowthDelta({ growth }: { growth: number }) {
  const up = growth >= 0;
  return (
    <span className="text-[10.5px] font-bold tabular-nums leading-none" style={{ color: up ? FIN_UP : FIN_DOWN }}>
      {up ? "▲" : "▼"} {Math.abs(growth).toFixed(1)}%
    </span>
  );
}

// ─── Value row ────────────────────────────────────────────────────────────────

interface ValueRowProps {
  rows: Row[];
  field: string;
  label: string;
  /** One short plain-language line under the label: what this number means. */
  hint?: string;
  isTotal?: boolean;
  zeroAsDash?: boolean;
  showGrowth?: boolean;
  indent?: boolean;
  isEPS?: boolean;
  highlight?: boolean;
  striped?: boolean;
  /** Color the value green/red by sign. Reserved for the handful of rows
   * where that actually carries meaning (Free Cash Flow, total Investing/
   * Financing cash flow, Net Income) — everything else renders in plain
   * text so green/red isn't diluted into decoration. */
  signColor?: boolean;
}

export function ValueRow({
  rows, field, label, hint, isTotal, zeroAsDash, showGrowth, indent, isEPS, highlight, signColor,
}: ValueRowProps) {
  const vals = rows.map((r) => {
    const v = safeNum(r[field]);
    return zeroAsDash && v === 0 ? null : v;
  });
  if (!vals.some((v) => v != null)) return null;

  const topRule = isTotal || highlight;
  const py = highlight ? 12 : isTotal ? 10 : 8;
  const rowBg = highlight ? "rgba(0,168,94,0.06)" : "transparent";

  return (
    <tr className="group transition-colors hover:bg-white/[0.025]" style={{ background: rowBg }}>
      <td className="sticky left-0 z-[1] px-5"
          style={{
            width: METRIC_COL_WIDTH, minWidth: 210,
            background: highlight ? "color-mix(in srgb, var(--card) 94%, #00a85e)" : "var(--card)",
            borderTop: topRule ? "1px solid var(--border)" : undefined,
            paddingTop: py, paddingBottom: py,
          }}>
        <div className="flex items-start">
          {indent && <div className="w-4 shrink-0" />}
          <div className="min-w-0">
            <p className="leading-tight"
               style={{ fontSize: highlight ? 14 : 13, fontWeight: highlight ? 900 : isTotal ? 800 : 500,
                        color: isTotal || highlight ? "var(--text)" : "var(--sub)" }}>
              {label}
            </p>
            {hint && <p className="text-[11px] leading-[15px] mt-0.5" style={{ color: "var(--muted)" }}>{hint}</p>}
          </div>
        </div>
      </td>
      {vals.map((v, i) => {
        const isLast = i === vals.length - 1;
        const prev = i > 0 ? vals[i - 1] : null;
        const growth = showGrowth && v != null && prev != null ? pctChange(v, prev) : null;
        const color = v == null ? "var(--dim)"
          : signColor ? (v >= 0 ? FIN_UP : FIN_DOWN)
          : isTotal || highlight || isLast ? "var(--text)" : "var(--sub)";
        return (
          <td key={i} className="text-right px-4 align-top"
              style={{
                borderTop: topRule ? "1px solid var(--border)" : undefined,
                paddingTop: py, paddingBottom: py,
                background: isLast ? "rgba(0,168,94,0.05)" : undefined,
              }}>
            <div className="flex flex-col items-end gap-1">
              <span className="tabular-nums leading-none whitespace-nowrap"
                    style={{ fontSize: highlight ? 15 : isTotal ? 14 : 13,
                             fontWeight: highlight ? 900 : isTotal ? 800 : isLast ? 700 : 500, color }}>
                {v != null ? (isEPS ? fmtEPS(v) : fmtMoney(v)) : "—"}
              </span>
              {growth != null && <GrowthDelta growth={growth} />}
            </div>
          </td>
        );
      })}
    </tr>
  );
}

// ─── Margin row (% of sales) ──────────────────────────────────────────────────

interface MarginRowProps {
  rows: Row[];
  field: string;
  label: string;
  hint?: string;
  numeratorField?: string;
  fallbackPct?: number;
}

function _isBadMargin(pct: number | null, fallback: number | undefined): boolean {
  if (pct == null) return true;
  if (fallback == null) return false;
  return pct >= 99 || pct === 0;
}

export function marginSeries(rows: Row[], field: string, numeratorField?: string, fallbackPct?: number): (number | null)[] {
  return rows.map((r) => {
    let pct = safeNum(r[field]);
    if (pct == null && numeratorField) {
      const rev = safeNum(r["Total Revenue"]);
      const num = safeNum(r[numeratorField]);
      if (rev && rev !== 0 && num != null) pct = (num / rev) * 100;
    }
    if (_isBadMargin(pct, fallbackPct) && fallbackPct != null) pct = fallbackPct;
    return pct;
  });
}

export function MarginRow({ rows, field, label, hint, numeratorField, fallbackPct }: MarginRowProps) {
  const pcts = marginSeries(rows, field, numeratorField, fallbackPct);
  if (!pcts.some((p) => p != null)) return null;

  return (
    <tr>
      <td className="sticky left-0 z-[1] px-5 py-2" style={{ width: METRIC_COL_WIDTH, minWidth: 210, background: "var(--card)" }}>
        <div className="flex items-start">
          <div className="w-4 shrink-0" />
          <div>
            <p className="text-[12px] font-semibold" style={{ color: "var(--muted)" }}>{label}</p>
            {hint && <p className="text-[11px] leading-[15px] mt-0.5" style={{ color: "var(--muted)" }}>{hint}</p>}
          </div>
        </div>
      </td>
      {pcts.map((pct, i) => {
        const prev = i > 0 ? pcts[i - 1] : null;
        const diff = pct != null && prev != null ? pct - prev : null;
        return (
          <td key={i} className="text-right px-4 py-2 align-top" style={{ background: i === pcts.length - 1 ? "rgba(0,168,94,0.05)" : undefined }}>
            <div className="flex flex-col items-end gap-1">
              <span className="text-[12.5px] font-bold tabular-nums leading-none" style={{ color: pct == null ? "var(--dim)" : pct >= 0 ? "var(--text)" : FIN_DOWN }}>
                {pct != null ? `${pct.toFixed(1)}%` : "N/A"}
              </span>
              {diff != null && Math.abs(diff) >= 0.05 && (
                <span className="text-[10px] font-bold tabular-nums leading-none" style={{ color: diff >= 0 ? FIN_UP : FIN_DOWN }}>
                  {diff >= 0 ? "+" : ""}{diff.toFixed(1)} pts
                </span>
              )}
            </div>
          </td>
        );
      })}
    </tr>
  );
}

// ─── At-a-glance: KPI tiles + trend chart ────────────────────────────────────

export interface Kpi {
  label: string;
  hint: string;
  value: number | null;
  prev: number | null;
  kind?: "money" | "pct" | "eps";
  /** green when positive (cash flows, profit), neutral otherwise */
  signColor?: boolean;
}

function fmtKpi(v: number | null, kind: Kpi["kind"]) {
  if (v == null) return "—";
  if (kind === "pct") return `${v.toFixed(1)}%`;
  if (kind === "eps") return fmtEPS(v);
  return fmtMoney(v);
}

export function KpiStrip({ items, vsLabel }: { items: Kpi[]; vsLabel: string }) {
  const shown = items.filter((k) => k.value != null);
  if (!shown.length) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
      {shown.map((k) => {
        const change = k.value != null && k.prev != null
          ? (k.kind === "pct" ? k.value - k.prev : pctChange(k.value, k.prev))
          : null;
        const valueColor = k.signColor && k.value != null ? (k.value >= 0 ? FIN_UP : FIN_DOWN) : "var(--text)";
        return (
          <div key={k.label} className="rounded-2xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <p className="text-[10px] font-black uppercase tracking-[1px]" style={{ color: "var(--muted)" }}>{k.label}</p>
            <p className="text-[24px] font-black tabular-nums tracking-tight mt-1.5 leading-none" style={{ color: valueColor }}>{fmtKpi(k.value, k.kind)}</p>
            {change != null && (
              <p className="text-[11.5px] font-bold tabular-nums mt-2" style={{ color: change >= 0 ? FIN_UP : FIN_DOWN }}>
                {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}{k.kind === "pct" ? " pts" : "%"}
                <span className="font-semibold ml-1" style={{ color: "var(--muted)" }}>{vsLabel}</span>
              </p>
            )}
            <p className="text-[11px] leading-[15px] mt-2" style={{ color: "var(--muted)" }}>{k.hint}</p>
          </div>
        );
      })}
    </div>
  );
}

export interface TrendSeries { label: string; field: string; color: string }

/** Side-by-side bars per period for 1–2 lines of a statement — the "is it
 *  growing?" picture, before anyone has to read a single number. */
export function TrendBars({ rows, series, title }: { rows: Row[]; series: TrendSeries[]; title: string }) {
  const { quarterly } = useContext(PeriodCtx);
  const { i18n } = useTranslation();
  const data = rows.map((r) => series.map((s) => safeNum(r[s.field])));
  const all = data.flat().filter((v): v is number => v != null);
  if (!all.length) return null;
  const max = Math.max(...all.map(Math.abs), 1);
  const hasNeg = all.some((v) => v < 0);
  const H = 150;
  const zeroY = hasNeg ? H / 2 : H;
  const scale = (hasNeg ? H / 2 : H) - 8;

  return (
    <div className="rounded-2xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <p className="text-[11px] font-black uppercase tracking-[1px]" style={{ color: "var(--muted)" }}>{title}</p>
        <div className="flex gap-3">
          {series.map((s) => (
            <span key={s.field} className="flex items-center gap-1.5 text-[11.5px] font-semibold" style={{ color: "var(--sub)" }}>
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />{s.label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-end gap-3" style={{ height: H + 34 }}>
        {rows.map((r, i) => (
          <div key={i} className="flex-1 flex flex-col items-center min-w-0">
            <div className="relative w-full flex items-start justify-center gap-1" style={{ height: H }}>
              {hasNeg && <div className="absolute left-0 right-0 border-t border-dashed" style={{ top: zeroY, borderColor: "var(--border)" }} />}
              {data[i].map((v, j) => {
                const h = v == null ? 0 : Math.max(2, (Math.abs(v) / max) * scale);
                const top = v == null ? zeroY : v >= 0 ? zeroY - h : zeroY;
                return (
                  <div key={j} className="relative" style={{ width: `${Math.min(28, 70 / series.length)}%`, height: H }}>
                    <div className="absolute left-0 right-0 rounded-[4px]"
                         title={`${series[j].label}: ${v == null ? "—" : fmtMoney(v)}`}
                         style={{ top, height: h, background: v != null && v < 0 ? FIN_DOWN : series[j].color, opacity: i === rows.length - 1 ? 1 : 0.7 }} />
                  </div>
                );
              })}
            </div>
            <span className="text-[11px] font-bold tabular-nums mt-2 whitespace-nowrap" style={{ color: i === rows.length - 1 ? "var(--accent-l)" : "var(--muted)" }}>
              {fmtPeriod(String(r.period ?? ""), quarterly, i18n.language)}
            </span>
            <span className="text-[10.5px] font-semibold tabular-nums whitespace-nowrap" style={{ color: "var(--sub)" }}>
              {data[i][0] != null ? fmtMoney(data[i][0]) : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Wraps a statement's at-a-glance blocks so they share the period context. */
export function StatementGlance({ quarterly, children }: { quarterly: boolean; children: React.ReactNode }) {
  return <PeriodCtx.Provider value={{ quarterly }}>{children}</PeriodCtx.Provider>;
}
