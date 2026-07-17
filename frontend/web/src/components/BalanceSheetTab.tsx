"use client";

import { useTranslation } from "react-i18next";
import { FinancialsCard, Section, ValueRow, type Row } from "@/components/financials/FinancialsTableUI";

export default function BalanceSheetTab({ balance }: { balance: Row[] }) {
  const { t } = useTranslation();
  const rows = balance.slice(-5);
  if (!rows.length) return (
    <div className="flex items-center justify-center py-16">
      <p className="text-sm" style={{ color: "var(--muted)" }}>{t("balanceSheetTab.noData")}</p>
    </div>
  );

  return (
    <FinancialsCard title={t("balanceSheetTab.titleBar")} latestLabel={t("balanceSheetTab.latest")} rows={rows}>
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
      <ValueRow rows={rows} field="Total Assets"          label={t("balanceSheetTab.totalAssets")} highlight showGrowth />

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
      <ValueRow rows={rows} field="Retained Earnings"   label={t("balanceSheetTab.retainedEarnings")} indent />
      <ValueRow rows={rows} field="Stockholders Equity" label={t("balanceSheetTab.totalEquity")} isTotal showGrowth />

      {/* ── Indicadores ── */}
      <Section label={t("balanceSheetTab.keyIndicators")} color="var(--accent-l)" />
      <ValueRow rows={rows} field="Total Debt"      label={t("balanceSheetTab.totalDebt")} isNeg />
      <ValueRow rows={rows} field="Net Debt"        label={t("balanceSheetTab.netDebt")} isNeg />
      <ValueRow rows={rows} field="Working Capital" label={t("balanceSheetTab.workingCapital")} showGrowth />
    </FinancialsCard>
  );
}
