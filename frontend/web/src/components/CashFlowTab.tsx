"use client";

import { TrendingUp, TrendingDown } from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function fmtYear(period: string): string {
  return period?.slice(0, 4) ?? "—";
}

function pctChange(curr: number, prev: number): number | null {
  if (!prev || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

type Row = Record<string, unknown>;

// ─── Sub-components ───────────────────────────────────────────────────────────

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
                style={{ color: i === rows.length - 1 ? "var(--accent-l)" : "var(--muted)" }}>
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
  highlight?: boolean;
}

function ValueRow({ rows, field, label, isTotal, isNeg, zeroAsDash, showGrowth, indent, highlight }: ValueRowProps) {
  const vals = rows.map((r) => {
    const v = safeNum(r[field]);
    return zeroAsDash && v === 0 ? null : v;
  });
  if (!vals.some((v) => v != null)) return null;

  return (
    <div className="flex items-stretch border-b transition-colors hover:bg-white/[0.015]"
         style={{
           borderColor: "var(--border)",
           background: highlight ? "rgba(0,168,94,0.04)" : isTotal ? "rgba(0,0,0,0.02)" : undefined,
         }}>
      <div className="shrink-0 flex items-center px-4 py-2.5" style={{ width: 200, minWidth: 160 }}>
        {indent && (
          <div className="w-[2px] h-3.5 rounded-full shrink-0 mr-2" style={{ background: "var(--border)" }} />
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
          : v >= 0 ? "var(--text)" : "#ef4444";
        return (
          <div key={i} className="flex-1 flex flex-col items-end justify-center gap-0.5 px-4 py-2.5"
               style={{ background: isLast ? (highlight ? "rgba(0,168,94,0.08)" : "rgba(0,168,94,0.04)") : undefined, borderLeft: "1px solid var(--border)" }}>
            <span className="tabular-nums leading-none"
                  style={{ fontSize: highlight ? 14 : isTotal ? 13 : 12,
                           fontWeight: highlight ? 800 : isTotal ? 700 : isLast ? 600 : 400, color }}>
              {v != null ? fmtMoney(v) : "—"}
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function CashFlowTab({ cashflow }: { cashflow: Row[] }) {
  const rows = cashflow.slice(-5);
  if (!rows.length) return (
    <div className="flex items-center justify-center py-16">
      <p className="text-sm" style={{ color: "var(--muted)" }}>Sin datos de Flujo de Caja</p>
    </div>
  );

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <div style={{ minWidth: 480 }}>
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b"
             style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
          <span className="text-[10px] font-black uppercase tracking-widest"
                style={{ color: "var(--accent-l)", opacity: 0.85 }}>
            Flujo de Caja · Anual · USD
          </span>
        </div>

        <Header rows={rows} />

        {/* ── FCF Hero — lo más importante arriba ── */}
        <ValueRow rows={rows} field="Free Cash Flow"    label="Flujo Libre (FCF)" highlight showGrowth />
        <ValueRow rows={rows} field="Operating Cash Flow" label="Flujo Operativo" isTotal showGrowth />

        {/* ── Operativo ── */}
        <Section label="Desglose Operativo" color="#3b82f6" />
        <ValueRow rows={rows} field="Net Income"                    label="Utilidad Neta" indent />
        <ValueRow rows={rows} field="Depreciation And Amortization" label="Depreciación y Amortización" indent zeroAsDash />
        <ValueRow rows={rows} field="Stock Based Compensation"      label="Compensación en Acciones" indent zeroAsDash />
        <ValueRow rows={rows} field="Change In Working Capital"     label="Cambio Capital de Trabajo" indent zeroAsDash />

        {/* ── Inversión ── */}
        <Section label="Actividades de Inversión" color="#f59e0b" />
        <ValueRow rows={rows} field="Capital Expenditure"             label="CapEx" isNeg indent />
        <ValueRow rows={rows} field="Acquisitions Net"                label="Adquisiciones" isNeg indent zeroAsDash />
        <ValueRow rows={rows} field="Purchases Of Investments"        label="Compra Inversiones" isNeg indent zeroAsDash />
        <ValueRow rows={rows} field="Sales Maturities Of Investments" label="Venta Inversiones" indent zeroAsDash />
        <ValueRow rows={rows} field="Investing Cash Flow"             label="Total Flujo Inversión" isTotal isNeg />

        {/* ── Financiamiento ── */}
        <Section label="Actividades de Financiamiento" color="#8b5cf6" />
        <ValueRow rows={rows} field="Repurchase Of Capital Stock" label="Recompra de Acciones" isNeg indent zeroAsDash />
        <ValueRow rows={rows} field="Issuance Of Common Stock"    label="Emisión de Acciones" indent zeroAsDash />
        <ValueRow rows={rows} field="Dividends Paid"              label="Dividendos Pagados" isNeg indent zeroAsDash />
        <ValueRow rows={rows} field="Repayment Of Debt"           label="Pago de Deuda" isNeg indent zeroAsDash />
        <ValueRow rows={rows} field="Financing Cash Flow"         label="Total Flujo Financiamiento" isTotal isNeg />

        {/* ── Resumen ── */}
        <Section label="Resumen de Caja" color="var(--accent-l)" />
        <ValueRow rows={rows} field="Net Change In Cash"          label="Cambio Neto en Efectivo" showGrowth />
        <ValueRow rows={rows} field="Cash At Beginning Of Period" label="Efectivo al Inicio" indent zeroAsDash />
        <ValueRow rows={rows} field="Cash At End Of Period"       label="Efectivo al Final" indent zeroAsDash />
      </div>
    </div>
  );
}
