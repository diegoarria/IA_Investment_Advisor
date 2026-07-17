"use client";

import { useTranslation } from "react-i18next";
import { FinancialsCard, Section, ValueRow, type Row } from "@/components/financials/FinancialsTableUI";

export default function CashFlowTab({ cashflow }: { cashflow: Row[] }) {
  const { t } = useTranslation();
  const rows = cashflow.slice(-5);
  if (!rows.length) return (
    <div className="flex items-center justify-center py-16">
      <p className="text-sm" style={{ color: "var(--muted)" }}>{t("cashFlowTab.noData")}</p>
    </div>
  );

  return (
    <FinancialsCard title={t("cashFlowTab.titleBar")} latestLabel={t("cashFlowTab.latest")} rows={rows}>
      {/* ── FCF Hero — lo más importante arriba ── */}
      <ValueRow rows={rows} field="Free Cash Flow"      label={t("cashFlowTab.fcf")} highlight showGrowth />
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
    </FinancialsCard>
  );
}
