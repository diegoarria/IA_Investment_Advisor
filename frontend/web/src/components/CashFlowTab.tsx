"use client";

import { useTranslation } from "react-i18next";
import FinancialHeroChart from "./FinancialHeroChart";

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
  const { t } = useTranslation();
  return (
    <div className="flex items-center sticky top-0 z-10"
         style={{ background: "var(--card)", boxShadow: "0 1px 0 var(--border)" }}>
      <div className="shrink-0 px-5 py-3.5" style={{ width: 220, minWidth: 180 }}>
        <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--dim)" }}>
          {t("cashFlowTab.metric")}
        </span>
      </div>
      {rows.map((r, i) => {
        const isLast = i === rows.length - 1;
        return (
          <div key={i} className="flex-1 text-right px-5 py-3.5">
            <span className="text-[15px] font-black tabular-nums"
                  style={{ color: isLast ? "var(--accent-l)" : "var(--muted)" }}>
              {fmtYear(String(r.period ?? ""))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Section({ label, color = "var(--dim)" }: { label: string; color?: string }) {
  return (
    <div className="flex items-center px-5 pt-6 pb-1.5">
      <span className="text-[10.5px] font-black uppercase tracking-widest" style={{ color, opacity: 0.85 }}>
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
    <div className="flex items-stretch rounded-lg transition-colors hover:bg-white/[0.025]"
         style={{ background: highlight ? "rgba(0,168,94,0.05)" : undefined }}>
      <div className="shrink-0 flex items-center gap-2 px-5 py-3" style={{ width: 220, minWidth: 180 }}>
        {indent && (
          <div className="w-[3px] h-3.5 rounded-full shrink-0" style={{ background: "var(--border)" }} />
        )}
        <span className="text-[13.5px] leading-tight"
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
          <div key={i} className="flex-1 flex items-center justify-end gap-2 px-5 py-3">
            <span className="tabular-nums leading-none"
                  style={{ fontSize: highlight ? 16 : isTotal ? 15 : 13.5,
                           fontWeight: highlight ? 800 : isTotal ? 700 : isLast ? 600 : 400, color }}>
              {v != null ? fmtMoney(v) : "—"}
            </span>
            {growth != null && (
              <span className="text-[10.5px] font-bold tabular-nums leading-none px-1.5 py-0.5 rounded-md whitespace-nowrap"
                    style={{ color: growth >= 0 ? "#22c55e" : "#ef4444",
                             background: growth >= 0 ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)" }}>
                {growth >= 0 ? "▲" : "▼"} {Math.abs(growth).toFixed(1)}%
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
  const { t } = useTranslation();
  const rows = cashflow.slice(-5);
  if (!rows.length) return (
    <div className="flex items-center justify-center py-16">
      <p className="text-sm" style={{ color: "var(--muted)" }}>{t("cashFlowTab.noData")}</p>
    </div>
  );

  const heroData = rows.map((r) => ({ label: fmtYear(String(r.period ?? "")), value: safeNum(r["Free Cash Flow"]) }));

  return (
    <div>
      <FinancialHeroChart title={t("cashFlowTab.fcf")} data={heroData} color="#f59e0b" />

      <div className="overflow-x-auto scrollbar-thin mt-2">
        <div style={{ minWidth: 520 }}>

          <Header rows={rows} />

          {/* ── FCF Hero — lo más importante arriba ── */}
          <ValueRow rows={rows} field="Free Cash Flow"    label={t("cashFlowTab.fcf")} highlight showGrowth />
          <ValueRow rows={rows} field="Operating Cash Flow" label={t("cashFlowTab.operatingCashFlow")} isTotal showGrowth />

          {/* ── Operativo ── */}
          <Section label={t("cashFlowTab.operatingBreakdown")} color="#3b82f6" />
          <ValueRow rows={rows} field="Net Income"                    label={t("cashFlowTab.netIncome")} indent />
          <ValueRow rows={rows} field="Depreciation And Amortization" label={t("cashFlowTab.depreciation")} indent zeroAsDash />
          <ValueRow rows={rows} field="Stock Based Compensation"      label={t("cashFlowTab.stockCompensation")} indent zeroAsDash />
          <ValueRow rows={rows} field="Change In Working Capital"     label={t("cashFlowTab.workingCapitalChange")} indent zeroAsDash />

          {/* ── Inversión ── */}
          <Section label={t("cashFlowTab.investingActivities")} color="#f59e0b" />
          <ValueRow rows={rows} field="Capital Expenditure"             label={t("cashFlowTab.capex")} isNeg indent />
          <ValueRow rows={rows} field="Acquisitions Net"                label={t("cashFlowTab.acquisitions")} isNeg indent zeroAsDash />
          <ValueRow rows={rows} field="Purchases Of Investments"        label={t("cashFlowTab.purchasesOfInvestments")} isNeg indent zeroAsDash />
          <ValueRow rows={rows} field="Sales Maturities Of Investments" label={t("cashFlowTab.salesOfInvestments")} indent zeroAsDash />
          <ValueRow rows={rows} field="Investing Cash Flow"             label={t("cashFlowTab.totalInvestingCashFlow")} isTotal isNeg />

          {/* ── Financiamiento ── */}
          <Section label={t("cashFlowTab.financingActivities")} color="#8b5cf6" />
          <ValueRow rows={rows} field="Repurchase Of Capital Stock" label={t("cashFlowTab.stockRepurchase")} isNeg indent zeroAsDash />
          <ValueRow rows={rows} field="Issuance Of Common Stock"    label={t("cashFlowTab.stockIssuance")} indent zeroAsDash />
          <ValueRow rows={rows} field="Dividends Paid"              label={t("cashFlowTab.dividendsPaid")} isNeg indent zeroAsDash />
          <ValueRow rows={rows} field="Repayment Of Debt"           label={t("cashFlowTab.debtRepayment")} isNeg indent zeroAsDash />
          <ValueRow rows={rows} field="Financing Cash Flow"         label={t("cashFlowTab.totalFinancingCashFlow")} isTotal isNeg />

          {/* ── Resumen ── */}
          <Section label={t("cashFlowTab.cashSummary")} color="var(--accent-l)" />
          <ValueRow rows={rows} field="Net Change In Cash"          label={t("cashFlowTab.netCashChange")} showGrowth />
          <ValueRow rows={rows} field="Cash At Beginning Of Period" label={t("cashFlowTab.cashBeginning")} indent zeroAsDash />
          <ValueRow rows={rows} field="Cash At End Of Period"       label={t("cashFlowTab.cashEnding")} indent zeroAsDash />

          <div className="h-4" />
        </div>
      </div>
    </div>
  );
}
