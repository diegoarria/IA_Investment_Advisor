"use client";

import { Sparkles, Loader2, TrendingUp, TrendingDown } from "lucide-react";

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "N/A";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3)  return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function safeNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function pctGrowth(curr: number, prev: number): number | null {
  if (!isFinite(prev) || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function fmtYear(period: string): string {
  if (!period) return "—";
  return period.slice(0, 4);
}

// ─── Types ───────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

// ─── Sub-components ──────────────────────────────────────────────────────────

function TableHeader({ rows }: { rows: Row[] }) {
  return (
    <div
      className="flex items-center sticky top-0 z-10 border-b"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      <div className="shrink-0 px-4 py-3" style={{ width: 182, minWidth: 150 }}>
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--dim)" }}>
          Métrica
        </span>
      </div>
      {rows.map((r, i) => (
        <div
          key={i}
          className="flex-1 text-right px-4 py-3"
          style={{
            background: i === rows.length - 1 ? "rgba(0,168,94,0.05)" : undefined,
            borderLeft: "1px solid var(--border)",
          }}
        >
          <span
            className="text-[13px] font-black tabular-nums"
            style={{ color: i === rows.length - 1 ? "var(--accent-l)" : "var(--muted)" }}
          >
            {fmtYear(String(r.period ?? ""))}
          </span>
        </div>
      ))}
    </div>
  );
}


interface MetricRowProps {
  rows: Row[];
  field: string;
  label: string;
  isNeg?: boolean;
  zeroAsDash?: boolean;
  showGrowth?: boolean;
  dimLabel?: boolean;
}

function MetricRow({
  rows, field, label, isNeg = false, zeroAsDash = false, showGrowth = false, dimLabel = false,
}: MetricRowProps) {
  const vals = rows.map((r) => {
    const v = safeNum(r[field]);
    if (v == null) return null;
    return zeroAsDash && v === 0 ? null : v;
  });

  if (!vals.some((v) => v != null)) return null;

  return (
    <div
      className="flex items-stretch border-b hover:bg-white/[0.015] transition-colors"
      style={{ borderColor: "var(--border)" }}
    >
      {/* Label */}
      <div
        className="shrink-0 flex items-center px-4 py-3"
        style={{ width: 182, minWidth: 150 }}
      >
        <span
          className="text-[12px] leading-tight"
          style={{ fontWeight: dimLabel ? 400 : 600, color: dimLabel ? "var(--muted)" : "var(--sub)" }}
        >
          {label}
        </span>
      </div>

      {/* Values */}
      {vals.map((v, i) => {
        const isLast = i === vals.length - 1;
        const prev = i > 0 ? vals[i - 1] : null;
        const growth =
          showGrowth && v != null && prev != null ? pctGrowth(v, prev) : null;

        const valueColor =
          v == null
            ? "var(--dim)"
            : isNeg
            ? v <= 0
              ? "#ef4444"
              : "#22c55e"
            : v >= 0
            ? "var(--text)"
            : "#ef4444";

        return (
          <div
            key={i}
            className="flex-1 flex flex-col items-end justify-center px-4 py-3 gap-0.5"
            style={{
              background: isLast ? "rgba(0,168,94,0.04)" : undefined,
              borderLeft: "1px solid var(--border)",
            }}
          >
            <span
              className="text-[13px] tabular-nums leading-none"
              style={{ fontWeight: isLast ? 700 : 500, color: valueColor }}
            >
              {v != null
                ? Math.abs(v) < 1 && v !== 0
                  ? `$${v.toFixed(2)}`
                  : fmtMoney(v)
                : "N/A"}
            </span>

            {growth != null && (
              <span
                className="text-[10px] font-bold tabular-nums leading-none flex items-center gap-0.5"
                style={{ color: growth >= 0 ? "#22c55e" : "#ef4444" }}
              >
                {growth >= 0 ? (
                  <TrendingUp className="w-2.5 h-2.5" />
                ) : (
                  <TrendingDown className="w-2.5 h-2.5" />
                )}
                {Math.abs(growth).toFixed(1)}%
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface MarginRowProps {
  rows: Row[];
  field: string;
  label: string;
  numeratorField?: string;
}

function MarginRow({ rows, field, label, numeratorField }: MarginRowProps) {
  const vals = rows.map((r) => {
    const direct = safeNum(r[field]);
    if (direct != null) return direct;

    // Compute from numerator / revenue if direct field is missing
    if (numeratorField) {
      const rev = safeNum(r["Total Revenue"]);
      const num = safeNum(r[numeratorField]);
      if (rev && rev !== 0 && num != null) return (num / rev) * 100;
    }
    return null;
  });

  if (!vals.some((v) => v != null)) return null;

  const marginColor = (v: number) => {
    if (v >= 40) return "#22c55e";
    if (v >= 15) return "#f59e0b";
    if (v >= 0)  return "var(--muted)";
    return "#ef4444";
  };

  return (
    <div
      className="flex items-stretch border-b"
      style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.018)" }}
    >
      {/* Indented label */}
      <div
        className="shrink-0 flex items-center px-4 py-2"
        style={{ width: 182, minWidth: 150 }}
      >
        <div className="flex items-center gap-2 pl-3">
          <div
            className="w-[2px] h-3.5 rounded-full shrink-0"
            style={{ background: "var(--border)" }}
          />
          <span className="text-[11px] font-semibold" style={{ color: "var(--muted)" }}>
            {label}
          </span>
        </div>
      </div>

      {vals.map((v, i) => (
        <div
          key={i}
          className="flex-1 flex items-center justify-end px-4 py-2"
          style={{
            background: i === vals.length - 1 ? "rgba(0,168,94,0.04)" : undefined,
            borderLeft: "1px solid var(--border)",
          }}
        >
          <span
            className="text-[12px] font-bold tabular-nums"
            style={{ color: v == null ? "var(--dim)" : marginColor(v) }}
          >
            {v != null ? `${v.toFixed(1)}%` : "N/A"}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface IncomeStatementTabProps {
  income: Row[];
  ticker: string;
  incomeAnalysis: string;
  loadingAnalysis: boolean;
}

export default function IncomeStatementTab({
  income,
  ticker,
  incomeAnalysis,
  loadingAnalysis,
}: IncomeStatementTabProps) {
  // Take last 5 annual periods (income is already reversed: oldest → newest)
  const rows = income.slice(-5);

  if (!rows.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Sin datos disponibles para el Estado de Resultados
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* ── Table ── */}
      <div className="overflow-x-auto scrollbar-thin">
        <div style={{ minWidth: 460 }}>

          {/* Table title bar */}
          <div
            className="flex items-center justify-between px-4 py-2.5 border-b"
            style={{ background: "var(--raised)", borderColor: "var(--border)" }}
          >
            <span
              className="text-[10px] font-black uppercase tracking-widest"
              style={{ color: "var(--accent-l)", opacity: 0.85 }}
            >
              Estado de Resultados · Anual · USD
            </span>
            <span className="text-[9px]" style={{ color: "var(--dim)" }}>
              ↑↓ = variación vs año anterior
            </span>
          </div>

          <TableHeader rows={rows} />

          <MetricRow rows={rows} field="Total Revenue"      label="Ingresos"           showGrowth />
          <MetricRow rows={rows} field="Cost Of Revenue"    label="Costo de Ventas"    isNeg />
          <MarginRow rows={rows} field="Gross Margin %"     label="Margen Bruto"       numeratorField="Gross Profit" />
          <MetricRow rows={rows} field="Operating Expenses" label="Gastos Operativos"  isNeg zeroAsDash />
          <MarginRow rows={rows} field="Operating Margin %" label="Margen Operativo"   numeratorField="Operating Income" />
          <MetricRow rows={rows} field="EBITDA"             label="EBITDA"             showGrowth />
          <MarginRow rows={rows} field="Net Margin %"       label="Margen Neto"        numeratorField="Net Income" />
        </div>
      </div>

      {/* ── AI Analysis ── */}
      <div className="p-4 border-t" style={{ borderColor: "var(--border)" }}>
        <div
          className="rounded-2xl p-4"
          style={{ background: "var(--raised)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />
            <span
              className="text-[11px] font-black uppercase tracking-widest"
              style={{ color: "var(--accent-l)" }}
            >
              Análisis IA
            </span>
            <span className="text-[10px] ml-auto font-semibold" style={{ color: "var(--dim)" }}>
              {ticker}
            </span>
          </div>

          {loadingAnalysis ? (
            <div className="flex items-center gap-2.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: "var(--accent-l)" }} />
              <span className="text-[12px]" style={{ color: "var(--muted)" }}>
                Analizando resultados financieros…
              </span>
            </div>
          ) : incomeAnalysis ? (
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--sub)" }}>
              {incomeAnalysis}
            </p>
          ) : (
            <p className="text-[12px]" style={{ color: "var(--muted)" }}>
              Sin análisis disponible
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
