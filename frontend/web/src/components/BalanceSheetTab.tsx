"use client";

import { TrendingUp, TrendingDown } from "lucide-react";
import { useTranslation } from "react-i18next";

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
    <div className="flex items-center sticky top-0 z-10 border-b"
         style={{ background: "var(--card)", borderColor: "var(--border)" }}>
      <div className="shrink-0 px-4 py-3" style={{ width: 200, minWidth: 160 }}>
        <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--dim)" }}>
          {t("balanceSheetTab.metric")}
        </span>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="flex-1 text-right px-4 py-3"
             style={{ background: i === rows.length - 1 ? "rgba(0,168,94,0.05)" : undefined, borderLeft: "1px solid var(--border)" }}>
          <span className="text-[14.5px] font-black tabular-nums"
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
      <span className="text-[11px] font-black uppercase tracking-widest" style={{ color }}>
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
}

function ValueRow({ rows, field, label, isTotal, isNeg, zeroAsDash, showGrowth, indent }: ValueRowProps) {
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
        <span className="text-[13.5px] leading-tight"
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
          : v >= 0 ? "var(--text)" : "#ef4444";
        return (
          <div key={i} className="flex-1 flex flex-col items-end justify-center gap-0.5 px-4 py-2.5"
               style={{ background: isLast ? "rgba(0,168,94,0.04)" : undefined, borderLeft: "1px solid var(--border)" }}>
            <span className="tabular-nums leading-none"
                  style={{ fontSize: isTotal ? 15 : 13.5, fontWeight: isTotal ? 700 : isLast ? 600 : 400, color }}>
              {v != null ? fmtMoney(v) : "—"}
            </span>
            {growth != null && (
              <span className="text-[11px] font-bold tabular-nums leading-none flex items-center gap-0.5"
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

export default function BalanceSheetTab({ balance }: { balance: Row[] }) {
  const { t } = useTranslation();
  const rows = balance.slice(-5);
  if (!rows.length) return (
    <div className="flex items-center justify-center py-16">
      <p className="text-sm" style={{ color: "var(--muted)" }}>{t("balanceSheetTab.noData")}</p>
    </div>
  );

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <div style={{ minWidth: 480 }}>
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b"
             style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
          <span className="text-[11px] font-black uppercase tracking-widest"
                style={{ color: "var(--accent-l)", opacity: 0.85 }}>
            {t("balanceSheetTab.titleBar")}
          </span>
        </div>

        <Header rows={rows} />

        {/* ── Activos ── */}
        <Section label={t("balanceSheetTab.currentAssets")} color="#3b82f6" />
        <ValueRow rows={rows} field="Cash And Cash Equivalents"       label={t("balanceSheetTab.cash")} indent />
        <ValueRow rows={rows} field="Short Term Investments"          label={t("balanceSheetTab.shortTermInvestments")} indent zeroAsDash />
        <ValueRow rows={rows} field="Cash And Short Term Investments" label={t("balanceSheetTab.cashAndShortTermInvestments")} indent zeroAsDash />
        <ValueRow rows={rows} field="Net Receivables"                 label={t("balanceSheetTab.receivables")} indent zeroAsDash />
        <ValueRow rows={rows} field="Inventory"                       label={t("balanceSheetTab.inventory")} indent zeroAsDash />
        <ValueRow rows={rows} field="Current Assets"                  label={t("balanceSheetTab.totalCurrentAssets")} isTotal showGrowth />

        <Section label={t("balanceSheetTab.nonCurrentAssets")} color="#3b82f6" />
        <ValueRow rows={rows} field="Net PPE"               label={t("balanceSheetTab.ppe")} indent />
        <ValueRow rows={rows} field="Goodwill"              label={t("balanceSheetTab.goodwill")} indent zeroAsDash />
        <ValueRow rows={rows} field="Intangible Assets"     label={t("balanceSheetTab.intangibles")} indent zeroAsDash />
        <ValueRow rows={rows} field="Long Term Investments" label={t("balanceSheetTab.longTermInvestments")} indent zeroAsDash />
        <ValueRow rows={rows} field="Total Assets"          label={t("balanceSheetTab.totalAssets")} isTotal showGrowth />

        {/* ── Pasivos ── */}
        <Section label={t("balanceSheetTab.currentLiabilities")} color="#f59e0b" />
        <ValueRow rows={rows} field="Accounts Payable"    label={t("balanceSheetTab.accountsPayable")} isNeg indent />
        <ValueRow rows={rows} field="Short Term Debt"     label={t("balanceSheetTab.shortTermDebt")} isNeg indent zeroAsDash />
        <ValueRow rows={rows} field="Current Liabilities" label={t("balanceSheetTab.totalCurrentLiabilities")} isTotal isNeg showGrowth />

        <Section label={t("balanceSheetTab.nonCurrentLiabilities")} color="#f59e0b" />
        <ValueRow rows={rows} field="Long Term Debt"                          label={t("balanceSheetTab.longTermDebt")} isNeg indent />
        <ValueRow rows={rows} field="Total Liabilities Net Minority Interest" label={t("balanceSheetTab.totalLiabilities")} isTotal isNeg showGrowth />

        {/* ── Patrimonio ── */}
        <Section label={t("balanceSheetTab.equity")} color="#22c55e" />
        <ValueRow rows={rows} field="Retained Earnings"  label={t("balanceSheetTab.retainedEarnings")} indent />
        <ValueRow rows={rows} field="Stockholders Equity" label={t("balanceSheetTab.totalEquity")} isTotal showGrowth />

        {/* ── Indicadores ── */}
        <Section label={t("balanceSheetTab.keyIndicators")} color="var(--accent-l)" />
        <ValueRow rows={rows} field="Total Debt"      label={t("balanceSheetTab.totalDebt")} isNeg />
        <ValueRow rows={rows} field="Net Debt"        label={t("balanceSheetTab.netDebt")} isNeg />
        <ValueRow rows={rows} field="Working Capital" label={t("balanceSheetTab.workingCapital")} showGrowth />
      </div>
    </div>
  );
}
