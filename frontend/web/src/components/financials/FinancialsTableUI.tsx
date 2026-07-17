"use client";

import { TrendingUp, TrendingDown } from "lucide-react";

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

export type Row = Record<string, unknown>;

// ─── Card shell — sticky metric column + horizontal-scroll fade ──────────────

const METRIC_COL_WIDTH = 200;

interface FinancialsCardProps {
  title: string;
  growthNote?: string;
  rows: Row[];
  latestLabel?: string;
  children: React.ReactNode;
}

export function FinancialsCard({ title, growthNote, rows, latestLabel, children }: FinancialsCardProps) {
  return (
    <div className="rounded-2xl overflow-hidden border relative"
         style={{ borderColor: "var(--border)", background: "var(--card)", boxShadow: "0 4px 20px rgba(0,0,0,0.14)" }}>
      <div className="overflow-x-auto scrollbar-thin">
        <div style={{ minWidth: 480 }}>
          {/* Title bar */}
          <div className="flex items-center justify-between px-4 py-3 border-b"
               style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
            <span className="text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--accent-l)" }}>
              {title}
            </span>
            {growthNote && (
              <span className="text-[9px] font-medium" style={{ color: "var(--dim)" }}>{growthNote}</span>
            )}
          </div>

          <Header rows={rows} latestLabel={latestLabel} />
          {children}
        </div>
      </div>
      {/* Right-edge fade hinting there's more to scroll horizontally on narrow viewports */}
      <div className="absolute top-0 right-0 bottom-0 w-8 pointer-events-none sm:hidden"
           style={{ background: "linear-gradient(90deg, transparent, var(--card))" }} />
    </div>
  );
}

function Header({ rows, latestLabel }: { rows: Row[]; latestLabel?: string }) {
  return (
    <div className="flex items-stretch sticky top-0 z-10 border-b-2"
         style={{ background: "var(--card)", borderColor: "var(--accent)" }}>
      <div className="shrink-0 sticky left-0 z-[1] px-4 py-3 flex items-end"
           style={{ width: METRIC_COL_WIDTH, minWidth: 160, background: "var(--card)" }}>
        {/* Metric column header intentionally blank — title bar above already labels the table */}
      </div>
      {rows.map((r, i) => {
        const isLast = i === rows.length - 1;
        return (
          <div key={i} className="flex-1 text-right px-4 py-3"
               style={{ background: isLast ? "rgba(0,168,94,0.08)" : undefined, borderLeft: "1px solid var(--border)" }}>
            <span className="text-[13px] font-black tabular-nums" style={{ color: isLast ? "var(--accent-l)" : "var(--muted)" }}>
              {fmtYear(String(r.period ?? ""))}
            </span>
            {isLast && latestLabel && (
              <div className="text-[8px] font-bold uppercase tracking-wider mt-0.5" style={{ color: "var(--accent-l)", opacity: 0.75 }}>
                {latestLabel}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Section({ label, color = "var(--dim)" }: { label: string; color?: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b"
         style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
      <div className="w-[3px] h-3 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-[10px] font-black uppercase tracking-widest" style={{ color }}>
        {label}
      </span>
    </div>
  );
}

function GrowthChip({ growth }: { growth: number }) {
  const up = growth >= 0;
  const color = up ? "#22c55e" : "#ef4444";
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded-full text-[10px] font-bold tabular-nums leading-none"
          style={{ color, background: color + "18" }}>
      {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
      {Math.abs(growth).toFixed(1)}%
    </span>
  );
}

// ─── Value row ────────────────────────────────────────────────────────────────

interface ValueRowProps {
  rows: Row[];
  field: string;
  label: string;
  isTotal?: boolean;
  isNeg?: boolean;
  zeroAsDash?: boolean;
  showGrowth?: boolean;
  indent?: boolean;
  isEPS?: boolean;
  highlight?: boolean;
  striped?: boolean;
}

export function ValueRow({
  rows, field, label, isTotal, isNeg, zeroAsDash, showGrowth, indent, isEPS, highlight, striped,
}: ValueRowProps) {
  const vals = rows.map((r) => {
    const v = safeNum(r[field]);
    return zeroAsDash && v === 0 ? null : v;
  });
  if (!vals.some((v) => v != null)) return null;

  const rowBg = highlight
    ? "rgba(0,168,94,0.06)"
    : isTotal
    ? "rgba(0,168,94,0.02)"
    : striped
    ? "rgba(255,255,255,0.015)"
    : undefined;

  return (
    <div className="flex items-stretch border-b transition-colors hover:bg-white/[0.035] group"
         style={{ borderColor: "var(--border)", background: rowBg }}>
      <div className="shrink-0 sticky left-0 z-[1] flex items-center px-4 py-2.5 group-hover:bg-white/[0.035]"
           style={{ width: METRIC_COL_WIDTH, minWidth: 160, background: rowBg ?? "var(--card)",
                    borderRight: "1px solid var(--border)" }}>
        {isTotal && (
          <div className="w-[3px] h-4 rounded-full shrink-0 mr-2.5" style={{ background: "var(--accent)" }} />
        )}
        {indent && (
          <div className="w-[2px] h-3.5 rounded-full shrink-0 mr-2 ml-1" style={{ background: "var(--border)" }} />
        )}
        <span className="text-[12px] leading-tight"
              style={{ fontWeight: highlight ? 800 : isTotal ? 700 : indent ? 400 : 600,
                       color: highlight ? "var(--accent-l)" : isTotal ? "var(--text)" : indent ? "var(--muted)" : "var(--sub)" }}>
          {label}
        </span>
      </div>
      {vals.map((v, i) => {
        const isLast = i === vals.length - 1;
        const prev = i > 0 ? vals[i - 1] : null;
        const growth = showGrowth && v != null && prev != null ? pctChange(v, prev) : null;
        const color = v == null ? "var(--dim)"
          : highlight ? (v >= 0 ? "var(--accent-l)" : "#ef4444")
          : isNeg ? (v <= 0 ? "#ef4444" : "#22c55e")
          : isTotal || !isNeg ? "var(--text)"
          : v >= 0 ? "var(--text)" : "#ef4444";
        return (
          <div key={i} className="flex-1 flex flex-col items-end justify-center gap-1 px-4 py-2.5"
               style={{ background: isLast ? (highlight ? "rgba(0,168,94,0.10)" : "rgba(0,168,94,0.045)") : undefined,
                        borderLeft: "1px solid var(--border)" }}>
            <span className="tabular-nums leading-none"
                  style={{ fontSize: highlight ? 14 : isTotal ? 13 : 12,
                           fontWeight: highlight ? 800 : isTotal ? 700 : isLast ? 600 : 400, color }}>
              {v != null ? (isEPS ? fmtEPS(v) : fmtMoney(v)) : "—"}
            </span>
            {growth != null && <GrowthChip growth={growth} />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Margin row (% + $ underneath) ────────────────────────────────────────────

interface MarginRowProps {
  rows: Row[];
  field: string;
  label: string;
  numeratorField?: string;
  fallbackPct?: number;
}

function _isBadMargin(pct: number | null, fallback: number | undefined): boolean {
  if (pct == null) return true;
  if (fallback == null) return false;
  return pct >= 99 || pct === 0;
}

export function MarginRow({ rows, field, label, numeratorField, fallbackPct }: MarginRowProps) {
  const pairs = rows.map((r) => {
    let pct = safeNum(r[field]);
    if (pct == null && numeratorField) {
      const rev = safeNum(r["Total Revenue"]);
      const num = safeNum(r[numeratorField]);
      if (rev && rev !== 0 && num != null) pct = (num / rev) * 100;
    }
    if (_isBadMargin(pct, fallbackPct) && fallbackPct != null) pct = fallbackPct;
    const rev = safeNum(r["Total Revenue"]);
    const dollars = pct != null && rev != null ? (rev * pct) / 100 : null;
    return { pct, dollars };
  });
  if (!pairs.some((p) => p.pct != null)) return null;

  const marginColor = (v: number) => v >= 0 ? "#22c55e" : "#ef4444";

  return (
    <div className="flex items-stretch border-b" style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.025)" }}>
      <div className="shrink-0 sticky left-0 z-[1] flex items-center px-4 py-2"
           style={{ width: METRIC_COL_WIDTH, minWidth: 160, background: "var(--raised)", borderRight: "1px solid var(--border)" }}>
        <div className="w-[2px] h-3.5 rounded-full shrink-0 mr-2 ml-1" style={{ background: "var(--border)" }} />
        <span className="text-[11px] font-semibold" style={{ color: "var(--muted)" }}>{label}</span>
      </div>
      {pairs.map(({ pct, dollars }, i) => (
        <div key={i} className="flex-1 flex flex-col items-end justify-center gap-0.5 px-4 py-2"
             style={{ background: i === pairs.length - 1 ? "rgba(0,168,94,0.045)" : undefined, borderLeft: "1px solid var(--border)" }}>
          <span className="text-[12px] font-bold tabular-nums leading-none" style={{ color: pct == null ? "var(--dim)" : marginColor(pct) }}>
            {pct != null ? `${pct.toFixed(1)}%` : "N/A"}
          </span>
          {dollars != null && (
            <span className="text-[10px] tabular-nums leading-none" style={{ color: "var(--dim)" }}>
              {fmtMoney(dollars)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
