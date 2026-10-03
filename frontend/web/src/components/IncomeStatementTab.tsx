"use client";

import { useTranslation } from "react-i18next";
import {
  FinancialsCard, Section, ValueRow, MarginRow, KpiStrip, TrendBars, StatementGlance, marginSeries, safeNum, type Row,
} from "@/components/financials/FinancialsTableUI";

interface IncomeStatementTabProps {
  income: Row[];
  quarterly?: boolean;
  grossMarginPct?: number;
  operatingMarginPct?: number;
  netMarginPct?: number;
}

export default function IncomeStatementTab({
  income, quarterly = false, grossMarginPct, operatingMarginPct, netMarginPct,
}: IncomeStatementTabProps) {
  const { t } = useTranslation();
  const rows = income.slice(-5);

  if (!rows.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <p className="text-sm" style={{ color: "var(--muted)" }}>{t("incomeStatementTab.noData")}</p>
      </div>
    );
  }

  const last = rows[rows.length - 1], prev = rows.length > 1 ? rows[rows.length - 2] : null;
  const net = marginSeries(rows, "Net Margin %", "Net Income", netMarginPct);
  const k = (field: string) => ({ value: safeNum(last[field]), prev: prev ? safeNum(prev[field]) : null });
  const eps = safeNum(last["Diluted EPS"]) != null ? "Diluted EPS" : "Basic EPS";

  return (
    <StatementGlance quarterly={quarterly}>
      <div className="space-y-3">
        <KpiStrip vsLabel={t("finGlance.vsPrev")} items={[
          { label: t("finGlance.income.revenue"), hint: t("finGlance.income.revenueHint"), ...k("Total Revenue") },
          { label: t("finGlance.income.netIncome"), hint: t("finGlance.income.netIncomeHint"), ...k("Net Income"), signColor: true },
          { label: t("finGlance.income.netMargin"), hint: t("finGlance.income.netMarginHint"), value: net[net.length - 1], prev: net.length > 1 ? net[net.length - 2] : null, kind: "pct" },
          { label: t("finGlance.income.eps"), hint: t("finGlance.income.epsHint"), ...k(eps), kind: "eps" },
        ]} />

        <TrendBars rows={rows} title={t("finGlance.income.trend")} series={[
          { label: t("incomeStatementTab.totalRevenue"), field: "Total Revenue", color: "#3b82f6" },
          { label: t("incomeStatementTab.netIncome"), field: "Net Income", color: "#22c55e" },
        ]} />

        <FinancialsCard
          title={t("incomeStatementTab.titleBar")}
          subtitle={t(quarterly ? "incomeStatementTab.subtitleQuarterly" : "incomeStatementTab.subtitleAnnual")}
          growthNote={t("incomeStatementTab.vsPriorYear")}
          latestLabel={t("incomeStatementTab.latest")}
          rows={rows}
          quarterly={quarterly}
        >
          {/* ── Ingresos ── */}
          <Section label={t("incomeStatementTab.revenue")} hint={t("incomeStatementTab.revenueHint")} color="#3b82f6" />
          <ValueRow rows={rows} field="Total Revenue"   label={t("incomeStatementTab.totalRevenue")} hint={t("incomeStatementTab.totalRevenueHint")} isTotal showGrowth />
          <ValueRow rows={rows} field="Cost Of Revenue" label={t("incomeStatementTab.costOfRevenue")} hint={t("incomeStatementTab.costOfRevenueHint")} indent />
          <ValueRow rows={rows} field="Gross Profit"    label={t("incomeStatementTab.grossProfit")} hint={t("incomeStatementTab.grossProfitHint")} isTotal showGrowth />
          <MarginRow rows={rows} field="Gross Margin %" label={t("incomeStatementTab.grossMargin")} hint={t("incomeStatementTab.grossMarginHint")} numeratorField="Gross Profit" fallbackPct={grossMarginPct} />

          {/* ── Gastos Operativos ── */}
          <Section label={t("incomeStatementTab.operatingExpensesSection")} hint={t("incomeStatementTab.operatingExpensesHint")} color="#f59e0b" />
          <ValueRow rows={rows} field="Research And Development"       label={t("incomeStatementTab.researchAndDevelopment")} indent zeroAsDash />
          <ValueRow rows={rows} field="Selling General Administrative" label={t("incomeStatementTab.sellingGeneralAdmin")} indent zeroAsDash />
          <ValueRow rows={rows} field="Operating Expenses"             label={t("incomeStatementTab.totalOperatingExpenses")} zeroAsDash />
          <ValueRow rows={rows} field="Operating Income"               label={t("incomeStatementTab.operatingIncome")} hint={t("incomeStatementTab.operatingIncomeHint")} isTotal showGrowth />
          <MarginRow rows={rows} field="Operating Margin %" label={t("incomeStatementTab.operatingMargin")} hint={t("incomeStatementTab.operatingMarginHint")} numeratorField="Operating Income" fallbackPct={operatingMarginPct} />

          {/* ── No Operativo ── */}
          <Section label={t("incomeStatementTab.nonOperating")} hint={t("incomeStatementTab.nonOperatingHint")} color="#8b5cf6" />
          <ValueRow rows={rows} field="Interest Income"  label={t("incomeStatementTab.interestIncome")} indent zeroAsDash />
          <ValueRow rows={rows} field="Interest Expense" label={t("incomeStatementTab.interestExpense")} indent zeroAsDash />
          <ValueRow rows={rows} field="Pretax Income"    label={t("incomeStatementTab.pretaxIncome")} isTotal zeroAsDash />
          <ValueRow rows={rows} field="Tax Provision"    label={t("incomeStatementTab.taxes")} indent zeroAsDash />

          {/* ── Resultado Final ── */}
          <Section label={t("incomeStatementTab.finalResult")} color="var(--accent-l)" />
          <ValueRow rows={rows} field="Net Income" label={t("incomeStatementTab.netIncome")} hint={t("incomeStatementTab.netIncomeHint")} highlight showGrowth signColor />
          <MarginRow rows={rows} field="Net Margin %" label={t("incomeStatementTab.netMargin")} hint={t("incomeStatementTab.netMarginHint")} numeratorField="Net Income" fallbackPct={netMarginPct} />
          <ValueRow rows={rows} field="Diluted EPS"                   label={t("incomeStatementTab.dilutedEps")} hint={t("incomeStatementTab.dilutedEpsHint")} isEPS showGrowth zeroAsDash />
          <ValueRow rows={rows} field="Basic EPS"                     label={t("incomeStatementTab.basicEps")} isEPS indent zeroAsDash />
          <ValueRow rows={rows} field="EBITDA"                        label={t("incomeStatementTab.ebitda")} hint={t("incomeStatementTab.ebitdaHint")} showGrowth zeroAsDash />
          <ValueRow rows={rows} field="Depreciation And Amortization" label={t("incomeStatementTab.depreciationAmortization")} hint={t("incomeStatementTab.depreciationAmortizationHint")} indent zeroAsDash />
        </FinancialsCard>
      </div>
    </StatementGlance>
  );
}
