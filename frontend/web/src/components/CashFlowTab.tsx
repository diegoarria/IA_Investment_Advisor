"use client";

import { useTranslation } from "react-i18next";
import {
  FinancialsCard, Section, ValueRow, KpiStrip, TrendBars, StatementGlance, safeNum, type Row,
} from "@/components/financials/FinancialsTableUI";

export default function CashFlowTab({ cashflow, quarterly = false }: { cashflow: Row[]; quarterly?: boolean }) {
  const { t } = useTranslation();
  const rows = cashflow.slice(-5);
  if (!rows.length) return (
    <div className="flex items-center justify-center py-16">
      <p className="text-sm" style={{ color: "var(--muted)" }}>{t("cashFlowTab.noData")}</p>
    </div>
  );

  const last = rows[rows.length - 1], prev = rows.length > 1 ? rows[rows.length - 2] : null;
  const k = (field: string) => ({ value: safeNum(last[field]), prev: prev ? safeNum(prev[field]) : null });
  // Money handed back to shareholders = buybacks + dividends (both reported as negatives).
  const returned = (r: Row | null) => {
    if (!r) return null;
    const b = safeNum(r["Repurchase Of Capital Stock"]), d = safeNum(r["Dividends Paid"]);
    if (b == null && d == null) return null;
    return Math.abs(b ?? 0) + Math.abs(d ?? 0);
  };
  const capex = (r: Row | null) => {
    const v = r ? safeNum(r["Capital Expenditure"]) : null;
    return v == null ? null : Math.abs(v);
  };

  return (
    <StatementGlance quarterly={quarterly}>
      <div className="space-y-3">
        <KpiStrip vsLabel={t("finGlance.vsPrev")} items={[
          { label: t("finGlance.cash.fcf"), hint: t("finGlance.cash.fcfHint"), ...k("Free Cash Flow"), signColor: true },
          { label: t("finGlance.cash.operating"), hint: t("finGlance.cash.operatingHint"), ...k("Operating Cash Flow"), signColor: true },
          { label: t("finGlance.cash.returned"), hint: t("finGlance.cash.returnedHint"), value: returned(last), prev: returned(prev) },
          { label: t("finGlance.cash.capex"), hint: t("finGlance.cash.capexHint"), value: capex(last), prev: capex(prev) },
        ]} />

        <TrendBars rows={rows} title={t("finGlance.cash.trend")} series={[
          { label: t("finGlance.cash.operating"), field: "Operating Cash Flow", color: "#3b82f6" },
          { label: t("finGlance.cash.fcf"), field: "Free Cash Flow", color: "#22c55e" },
        ]} />

        <FinancialsCard
          title={t("cashFlowTab.titleBar")}
          subtitle={t(quarterly ? "cashFlowTab.subtitleQuarterly" : "cashFlowTab.subtitleAnnual")}
          growthNote={t("incomeStatementTab.vsPriorYear")}
          latestLabel={t("cashFlowTab.latest")}
          rows={rows}
          quarterly={quarterly}
        >
          {/* ── Lo más importante arriba ── */}
          <ValueRow rows={rows} field="Free Cash Flow"      label={t("cashFlowTab.fcf")} hint={t("cashFlowTab.fcfHint")} highlight showGrowth signColor />
          <ValueRow rows={rows} field="Operating Cash Flow" label={t("cashFlowTab.operatingCashFlow")} hint={t("cashFlowTab.operatingCashFlowHint")} isTotal showGrowth />

          {/* ── Operativo ── */}
          <Section label={t("cashFlowTab.operatingBreakdown")} hint={t("cashFlowTab.operatingBreakdownHint")} color="#3b82f6" />
          <ValueRow rows={rows} field="Net Income"                    label={t("cashFlowTab.netIncome")} indent />
          <ValueRow rows={rows} field="Depreciation And Amortization" label={t("cashFlowTab.depreciation")} indent zeroAsDash />
          <ValueRow rows={rows} field="Stock Based Compensation"      label={t("cashFlowTab.stockCompensation")} indent zeroAsDash />
          <ValueRow rows={rows} field="Change In Working Capital"     label={t("cashFlowTab.workingCapitalChange")} indent zeroAsDash />

          {/* ── Inversión ── */}
          <Section label={t("cashFlowTab.investingActivities")} hint={t("cashFlowTab.investingActivitiesHint")} color="#f59e0b" />
          <ValueRow rows={rows} field="Capital Expenditure"             label={t("cashFlowTab.capex")} hint={t("cashFlowTab.capexHint")} indent />
          <ValueRow rows={rows} field="Acquisitions Net"                label={t("cashFlowTab.acquisitions")} indent zeroAsDash />
          <ValueRow rows={rows} field="Purchases Of Investments"        label={t("cashFlowTab.purchasesOfInvestments")} indent zeroAsDash />
          <ValueRow rows={rows} field="Sales Maturities Of Investments" label={t("cashFlowTab.salesOfInvestments")} indent zeroAsDash />
          <ValueRow rows={rows} field="Investing Cash Flow"             label={t("cashFlowTab.totalInvestingCashFlow")} isTotal signColor />

          {/* ── Financiamiento ── */}
          <Section label={t("cashFlowTab.financingActivities")} hint={t("cashFlowTab.financingActivitiesHint")} color="#8b5cf6" />
          <ValueRow rows={rows} field="Repurchase Of Capital Stock" label={t("cashFlowTab.stockRepurchase")} hint={t("cashFlowTab.stockRepurchaseHint")} indent zeroAsDash />
          <ValueRow rows={rows} field="Issuance Of Common Stock"    label={t("cashFlowTab.stockIssuance")} indent zeroAsDash />
          <ValueRow rows={rows} field="Dividends Paid"              label={t("cashFlowTab.dividendsPaid")} indent zeroAsDash />
          <ValueRow rows={rows} field="Repayment Of Debt"           label={t("cashFlowTab.debtRepayment")} indent zeroAsDash />
          <ValueRow rows={rows} field="Financing Cash Flow"         label={t("cashFlowTab.totalFinancingCashFlow")} isTotal signColor />

          {/* ── Resumen ── */}
          <Section label={t("cashFlowTab.cashSummary")} color="var(--accent-l)" />
          <ValueRow rows={rows} field="Net Change In Cash"          label={t("cashFlowTab.netCashChange")} showGrowth signColor />
          <ValueRow rows={rows} field="Cash At Beginning Of Period" label={t("cashFlowTab.cashBeginning")} indent zeroAsDash />
          <ValueRow rows={rows} field="Cash At End Of Period"       label={t("cashFlowTab.cashEnding")} indent zeroAsDash />
        </FinancialsCard>
      </div>
    </StatementGlance>
  );
}
