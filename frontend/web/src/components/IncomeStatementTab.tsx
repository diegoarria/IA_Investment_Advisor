"use client";

import { TrendingUp, TrendingDown } from "lucide-react";

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "N/A";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3)  return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function fmtEPS(v: number | null | undefined): string {
  if (v == null) return "N/A";
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
}

function safeNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function pctChange(curr: number, prev: number): number | null {
  if (!prev || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function fmtYear(period: string): string {
  return period?.slice(0, 4) ?? "—";
}

type Row = Record<string, unknown>;

// ─── Sub-components ──────────────────────────────────────────────────────────

function Header({ rows }: { rows: Row[] }) {
  return (
    <div className="flex items-center sticky top-0 z-10 border-b"
         style={{ background: "var(--card)", borderColor: "var(--border)" }}>
      <div className="shrink-0 px-4 py-3" style={{ width: 200, minWidth: 160 }}>
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--dim)" }}>
          Métrica
        </span>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="flex-1 text-right px-4 py-3"
             style={{ background: i === rows.length - 1 ? "rgba(0,168,94,0.05)" : undefined, borderLeft: "1px solid var(--border)" }}>
          <span className="text-[13px] font-black tabular-nums"
                style={{ color: i === rows.length - 1 ? "var(--text)" : "var(--muted)" }}>
            {fmtYear(String(r.period ?? ""))}
          </span>
        </div>
      ))}
    </div>
  );
}

function Section({ label, color = "var(--dim)" }: { label: string; color?: string }) {
  return (
    <div className="flex items-center px-4 py-1.5 border-b"
         style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
      <span className="text-[9px] font-black uppercase tracking-widest" style={{ color }}>
        {label}
      </span>
    </div>
  );
}

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
}

function ValueRow({ rows, field, label, isTotal, isNeg, zeroAsDash, showGrowth, indent, isEPS }: ValueRowProps) {
  const vals = rows.map((r) => {
    const v = safeNum(r[field]);
    return zeroAsDash && v === 0 ? null : v;
  });
  if (!vals.some((v) => v != null)) return null;

  return (
    <div className="flex items-stretch border-b transition-colors hover:bg-white/[0.015]"
         style={{ borderColor: "var(--border)", background: isTotal ? "rgba(0,0,0,0.02)" : undefined }}>
      <div className="shrink-0 flex items-center px-4 py-2.5" style={{ width: 200, minWidth: 160 }}>
        {indent && (
          <div className="w-[2px] h-3.5 rounded-full shrink-0 mr-2" style={{ background: "var(--border)" }} />
        )}
        <span className="text-[12px] leading-tight"
              style={{ fontWeight: isTotal ? 700 : indent ? 400 : 600,
                       color: isTotal ? "var(--text)" : indent ? "var(--muted)" : "var(--sub)" }}>
          {label}
        </span>
      </div>
      {vals.map((v, i) => {
        const isLast = i === vals.length - 1;
        const prev = i > 0 ? vals[i - 1] : null;
        const growth = showGrowth && v != null && prev != null ? pctChange(v, prev) : null;
        const color = v == null ? "var(--dim)"
          : isNeg ? (v <= 0 ? "#ef4444" : "#22c55e")
          : "var(--text)";
        return (
          <div key={i} className="flex-1 flex flex-col items-end justify-center gap-0.5 px-4 py-2.5"
               style={{ background: isLast ? "rgba(0,168,94,0.04)" : undefined, borderLeft: "1px solid var(--border)" }}>
            <span className="tabular-nums leading-none"
                  style={{ fontSize: isTotal ? 13 : 12, fontWeight: isTotal ? 700 : isLast ? 600 : 400, color }}>
              {v != null ? (isEPS ? fmtEPS(v) : fmtMoney(v)) : "—"}
            </span>
            {growth != null && (
              <span className="text-[10px] font-bold tabular-nums leading-none flex items-center gap-0.5"
                    style={{ color: growth >= 0 ? "#22c55e" : "#ef4444" }}>
                {growth >= 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                {Math.abs(growth).toFixed(1)}%
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Margin % row with indented style + dollar amount below
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

function MarginRow({ rows, field, label, numeratorField, fallbackPct }: MarginRowProps) {
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

  const marginColor = (v: number) => {
    if (v >= 40) return "#22c55e";
    if (v >= 15) return "#f59e0b";
    if (v >= 0)  return "var(--muted)";
    return "#ef4444";
  };

  return (
    <div className="flex items-stretch border-b"
         style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.018)" }}>
      <div className="shrink-0 flex items-center px-4 py-2" style={{ width: 200, minWidth: 160 }}>
        <div className="w-[2px] h-3.5 rounded-full shrink-0 mr-2" style={{ background: "var(--border)" }} />
        <span className="text-[11px] font-semibold" style={{ color: "var(--muted)" }}>{label}</span>
      </div>
      {pairs.map(({ pct, dollars }, i) => (
        <div key={i} className="flex-1 flex flex-col items-end justify-center gap-0.5 px-4 py-2"
             style={{ background: i === pairs.length - 1 ? "rgba(0,168,94,0.04)" : undefined, borderLeft: "1px solid var(--border)" }}>
          <span className="text-[12px] font-bold tabular-nums leading-none"
                style={{ color: pct == null ? "var(--dim)" : marginColor(pct) }}>
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

// ─── Main component ───────────────────────────────────────────────────────────

interface IncomeStatementTabProps {
  income: Row[];
  grossMarginPct?: number;
  operatingMarginPct?: number;
  netMarginPct?: number;
}

export default function IncomeStatementTab({
  income, grossMarginPct, operatingMarginPct, netMarginPct,
}: IncomeStatementTabProps) {
  const rows = income.slice(-5);

  if (!rows.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <p className="text-sm" style={{ color: "var(--muted)" }}>Sin datos disponibles para el Estado de Resultados</p>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto scrollbar-thin">
        <div style={{ minWidth: 480 }}>

          {/* Title bar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b"
               style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
            <span className="text-[10px] font-black uppercase tracking-widest"
                  style={{ color: "var(--accent-l)", opacity: 0.85 }}>
              Estado de Resultados · Anual · USD
            </span>
            <span className="text-[9px]" style={{ color: "var(--dim)" }}>↑↓ = variación vs año anterior</span>
          </div>

          <Header rows={rows} />

          {/* ── Ingresos ── */}
          <Section label="Ingresos" />
          <ValueRow rows={rows} field="Total Revenue"   label="Ingresos Totales"  isTotal showGrowth />
          <ValueRow rows={rows} field="Cost Of Revenue" label="Costo de Ventas"   isNeg indent />
          <ValueRow rows={rows} field="Gross Profit"    label="Utilidad Bruta"    isTotal showGrowth />
          <MarginRow rows={rows} field="Gross Margin %" label="Margen Bruto"      numeratorField="Gross Profit" fallbackPct={grossMarginPct} />

          {/* ── Gastos Operativos ── */}
          <Section label="Gastos Operativos" />
          <ValueRow rows={rows} field="Research And Development"       label="Investigación y Desarrollo" isNeg indent zeroAsDash />
          <ValueRow rows={rows} field="Selling General Administrative" label="Ventas, Gral y Admin."      isNeg indent zeroAsDash />
          <ValueRow rows={rows} field="Operating Expenses"             label="Total Gastos Operativos"    isNeg zeroAsDash />
          <ValueRow rows={rows} field="Operating Income"               label="Utilidad Operativa (EBIT)"  isTotal showGrowth />
          <MarginRow rows={rows} field="Operating Margin %" label="Margen Operativo" numeratorField="Operating Income" fallbackPct={operatingMarginPct} />

          {/* ── No Operativo ── */}
          <Section label="No Operativo" />
          <ValueRow rows={rows} field="Interest Income"  label="Ingresos Financieros"   indent zeroAsDash />
          <ValueRow rows={rows} field="Interest Expense" label="Gastos Financieros"     isNeg indent zeroAsDash />
          <ValueRow rows={rows} field="Pretax Income"    label="Utilidad Pre-Impuestos" isTotal zeroAsDash />
          <ValueRow rows={rows} field="Tax Provision"    label="Impuestos"              isNeg indent zeroAsDash />

          {/* ── Resultado Final ── */}
          <Section label="Resultado Final" />
          <ValueRow rows={rows} field="Net Income"                    label="Utilidad Neta"  isTotal showGrowth />
          <MarginRow rows={rows} field="Net Margin %" label="Margen Neto" numeratorField="Net Income" fallbackPct={netMarginPct} />
          <ValueRow rows={rows} field="EBITDA"                        label="EBITDA"         showGrowth zeroAsDash />
          <ValueRow rows={rows} field="Depreciation And Amortization" label="D&A"            indent zeroAsDash />
          <ValueRow rows={rows} field="Diluted EPS"                   label="EPS Diluido"    isEPS indent zeroAsDash />
          <ValueRow rows={rows} field="Basic EPS"                     label="EPS Básico"     isEPS indent zeroAsDash />

        </div>
      </div>

    </div>
  );
}
