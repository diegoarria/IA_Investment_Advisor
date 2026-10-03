"use client";

import { useTranslation } from "react-i18next";
import {
  FinancialsCard, Section, ValueRow, KpiStrip, TrendBars, StatementGlance, safeNum, type Row,
} from "@/components/financials/FinancialsTableUI";

export default function BalanceSheetTab({ balance, quarterly = false }: { balance: Row[]; quarterly?: boolean }) {
  const { t } = useTranslation();
  const rows = balance.slice(-5);
  if (!rows.length) return (
    <div className="flex items-center justify-center py-16">
      <p className="text-sm" style={{ color: "var(--muted)" }}>{t("balanceSheetTab.noData")}</p>
    </div>
  );

  const last = rows[rows.length - 1], prev = rows.length > 1 ? rows[rows.length - 2] : null;
  const k = (field: string) => ({ value: safeNum(last[field]), prev: prev ? safeNum(prev[field]) : null });

  return (
    <StatementGlance quarterly={quarterly}>
      <div className="space-y-3">
        <KpiStrip vsLabel={t("finGlance.vsPrev")} items={[
          { label: t("finGlance.balance.assets"), hint: t("finGlance.balance.assetsHint"), ...k("Total Assets") },
          { label: t("finGlance.balance.liabilities"), hint: t("finGlance.balance.liabilitiesHint"), ...k("Total Liabilities Net Minority Interest") },
          { label: t("finGlance.balance.equity"), hint: t("finGlance.balance.equityHint"), ...k("Stockholders Equity") },
          { label: t("finGlance.balance.cash"), hint: t("finGlance.balance.cashHint"), ...k("Cash And Cash Equivalents") },
        ]} />

        <TrendBars rows={rows} title={t("finGlance.balance.trend")} series={[
          { label: t("finGlance.balance.assets"), field: "Total Assets", color: "#3b82f6" },
          { label: t("finGlance.balance.liabilities"), field: "Total Liabilities Net Minority Interest", color: "#f59e0b" },
        ]} />

        <FinancialsCard
          title={t("balanceSheetTab.titleBar")}
          subtitle={t(quarterly ? "balanceSheetTab.subtitleQuarterly" : "balanceSheetTab.subtitleAnnual")}
          growthNote={t("incomeStatementTab.vsPriorYear")}
          latestLabel={t("balanceSheetTab.latest")}
          rows={rows}
          quarterly={quarterly}
        >
          {/* ── Activos ── */}
          <Section label={t("balanceSheetTab.currentAssets")} hint={t("balanceSheetTab.currentAssetsHint")} color="#3b82f6" />
          <ValueRow rows={rows} field="Cash And Cash Equivalents"       label={t("balanceSheetTab.cash")} indent />
          <ValueRow rows={rows} field="Short Term Investments"          label={t("balanceSheetTab.shortTermInvestments")} indent zeroAsDash />
          <ValueRow rows={rows} field="Cash And Short Term Investments" label={t("balanceSheetTab.cashAndShortTermInvestments")} indent zeroAsDash />
          <ValueRow rows={rows} field="Net Receivables"                 label={t("balanceSheetTab.receivables")} indent zeroAsDash />
          <ValueRow rows={rows} field="Inventory"                       label={t("balanceSheetTab.inventory")} indent zeroAsDash />
          <ValueRow rows={rows} field="Current Assets"                  label={t("balanceSheetTab.totalCurrentAssets")} isTotal showGrowth />

          <Section label={t("balanceSheetTab.nonCurrentAssets")} hint={t("balanceSheetTab.nonCurrentAssetsHint")} color="#3b82f6" />
          <ValueRow rows={rows} field="Net PPE"               label={t("balanceSheetTab.ppe")} indent />
          <ValueRow rows={rows} field="Goodwill"              label={t("balanceSheetTab.goodwill")} hint={t("balanceSheetTab.goodwillHint")} indent zeroAsDash />
          <ValueRow rows={rows} field="Intangible Assets"     label={t("balanceSheetTab.intangibles")} indent zeroAsDash />
          <ValueRow rows={rows} field="Long Term Investments" label={t("balanceSheetTab.longTermInvestments")} indent zeroAsDash />
          <ValueRow rows={rows} field="Total Assets"          label={t("balanceSheetTab.totalAssets")} hint={t("balanceSheetTab.totalAssetsHint")} highlight showGrowth />

          {/* ── Pasivos ── */}
          <Section label={t("balanceSheetTab.currentLiabilities")} hint={t("balanceSheetTab.currentLiabilitiesHint")} color="#f59e0b" />
          <ValueRow rows={rows} field="Accounts Payable"    label={t("balanceSheetTab.accountsPayable")} indent />
          <ValueRow rows={rows} field="Short Term Debt"     label={t("balanceSheetTab.shortTermDebt")} indent zeroAsDash />
          <ValueRow rows={rows} field="Current Liabilities" label={t("balanceSheetTab.totalCurrentLiabilities")} isTotal showGrowth />

          <Section label={t("balanceSheetTab.nonCurrentLiabilities")} hint={t("balanceSheetTab.nonCurrentLiabilitiesHint")} color="#f59e0b" />
          <ValueRow rows={rows} field="Long Term Debt"                          label={t("balanceSheetTab.longTermDebt")} indent />
          <ValueRow rows={rows} field="Total Liabilities Net Minority Interest" label={t("balanceSheetTab.totalLiabilities")} hint={t("balanceSheetTab.totalLiabilitiesHint")} highlight showGrowth />

          {/* ── Patrimonio ── */}
          <Section label={t("balanceSheetTab.equity")} hint={t("balanceSheetTab.equityHint")} color="#22c55e" />
          <ValueRow rows={rows} field="Retained Earnings"   label={t("balanceSheetTab.retainedEarnings")} indent />
          <ValueRow rows={rows} field="Stockholders Equity" label={t("balanceSheetTab.totalEquity")} isTotal showGrowth />

          {/* ── Indicadores ── */}
          <Section label={t("balanceSheetTab.keyIndicators")} color="var(--accent-l)" />
          <ValueRow rows={rows} field="Total Debt"      label={t("balanceSheetTab.totalDebt")} />
          <ValueRow rows={rows} field="Net Debt"        label={t("balanceSheetTab.netDebt")} hint={t("balanceSheetTab.netDebtHint")} />
          <ValueRow rows={rows} field="Working Capital" label={t("balanceSheetTab.workingCapital")} hint={t("balanceSheetTab.workingCapitalHint")} showGrowth />
        </FinancialsCard>
      </div>
    </StatementGlance>
  );
}
