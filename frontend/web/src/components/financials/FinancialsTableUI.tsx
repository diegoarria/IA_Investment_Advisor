"use client";

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

// ─── Card shell — real <table>, sticky metric column + sticky header ─────────
// Redesigned for density and signal-over-decoration (stockanalysis.com-style):
// thin borders instead of tinted row backgrounds, weight/rules over color to
// mark totals, a single understated accent line under the latest-year column
// instead of a full green wash, and inline (not pill) growth deltas.

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
    <div className="rounded-xl overflow-hidden border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "var(--border)" }}>
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--text)" }}>
          {title}
        </span>
        {growthNote && (
          <span className="text-[10px]" style={{ color: "var(--dim)" }}>{growthNote}</span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: 480 }}>
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 text-left px-4 py-2.5 font-normal border-b"
                  style={{ width: METRIC_COL_WIDTH, minWidth: 160, background: "var(--card)", borderColor: "var(--border)" }} />
              {rows.map((r, i) => {
                const isLast = i === rows.length - 1;
                return (
                  <th key={i}
                      className="sticky top-0 z-10 text-right px-4 py-2.5 font-normal whitespace-nowrap"
                      style={{
                        background: "var(--card)",
                        borderBottom: isLast ? "2px solid var(--accent)" : "1px solid var(--border)",
                      }}>
                    <span className="text-[13px] tabular-nums" style={{ fontWeight: isLast ? 800 : 700, color: isLast ? "var(--accent-l)" : "var(--sub)" }}>
                      {fmtYear(String(r.period ?? ""))}
                    </span>
                    {isLast && latestLabel && (
                      <div className="text-[8px] font-bold uppercase tracking-wider mt-0.5" style={{ color: "var(--accent-l)", opacity: 0.7 }}>
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
  );
}

export function Section({ label, color = "var(--dim)" }: { label: string; color?: string }) {
  const cols = 8; // wide enough colSpan for any statement — extra cells are simply empty
  return (
    <tr>
      <td className="sticky left-0 z-[1] px-4 pt-4 pb-1.5" style={{ background: "var(--card)" }}>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            {label}
          </span>
        </div>
      </td>
      <td className="pt-4 pb-1.5" colSpan={cols} />
    </tr>
  );
}

function GrowthDelta({ growth }: { growth: number }) {
  const up = growth >= 0;
  const color = up ? "#22c55e" : "#ef4444";
  return (
    <span className="text-[10px] font-semibold tabular-nums leading-none" style={{ color }}>
      {up ? "▲" : "▼"} {Math.abs(growth).toFixed(1)}%
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
  rows, field, label, isTotal, isNeg, zeroAsDash, showGrowth, indent, isEPS, highlight,
}: ValueRowProps) {
  const vals = rows.map((r) => {
    const v = safeNum(r[field]);
    return zeroAsDash && v === 0 ? null : v;
  });
  if (!vals.some((v) => v != null)) return null;

  // Totals/highlights get a rule above them (separating them from the
  // components they sum) instead of a tinted background — one clean signal
  // instead of a wash of color repeated on every subtotal row.
  const topRule = isTotal || highlight;

  return (
    <tr className="group hover:bg-white/[0.03] transition-colors">
      <td className="sticky left-0 z-[1] px-4 group-hover:bg-white/[0.03]"
          style={{
            width: METRIC_COL_WIDTH, minWidth: 160, background: "var(--card)",
            borderTop: topRule ? "1px solid var(--border)" : undefined,
            paddingTop: highlight ? 10 : 7, paddingBottom: highlight ? 10 : 7,
          }}>
        <div className="flex items-center">
          {indent && <div className="w-3 shrink-0" />}
          <span className="text-[12px] leading-tight truncate"
                style={{ fontWeight: highlight ? 800 : isTotal ? 700 : 400,
                         color: highlight ? "var(--accent-l)" : isTotal ? "var(--text)" : "var(--sub)" }}>
            {label}
          </span>
        </div>
      </td>
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
          <td key={i} className="text-right px-4"
              style={{
                borderTop: topRule ? "1px solid var(--border)" : undefined,
                paddingTop: highlight ? 10 : 7, paddingBottom: highlight ? 10 : 7,
              }}>
            <div className="flex flex-col items-end gap-0.5">
              <span className="tabular-nums leading-none whitespace-nowrap"
                    style={{ fontSize: highlight ? 14 : isTotal ? 13 : 12,
                             fontWeight: highlight ? 800 : isTotal ? 700 : isLast ? 600 : 400, color }}>
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
    <tr>
      <td className="sticky left-0 z-[1] px-4 py-1.5" style={{ width: METRIC_COL_WIDTH, minWidth: 160, background: "var(--card)" }}>
        <div className="flex items-center">
          <div className="w-3 shrink-0" />
          <span className="text-[11px] italic" style={{ color: "var(--muted)" }}>{label}</span>
        </div>
      </td>
      {pairs.map(({ pct, dollars }, i) => (
        <td key={i} className="text-right px-4 py-1.5">
          <div className="flex flex-col items-end gap-0">
            <span className="text-[11px] font-semibold tabular-nums leading-none" style={{ color: pct == null ? "var(--dim)" : marginColor(pct) }}>
              {pct != null ? `${pct.toFixed(1)}%` : "N/A"}
            </span>
            {dollars != null && (
              <span className="text-[9px] tabular-nums leading-none mt-0.5" style={{ color: "var(--dim)" }}>
                {fmtMoney(dollars)}
              </span>
            )}
          </div>
        </td>
      ))}
    </tr>
  );
}
