"use client";

import { useTranslation } from "react-i18next";
import { FinancialsCard, Section, ValueRow, MarginRow, type Row } from "@/components/financials/FinancialsTableUI";

interface IncomeStatementTabProps {
  income: Row[];
  grossMarginPct?: number;
  operatingMarginPct?: number;
  netMarginPct?: number;
}

export default function IncomeStatementTab({
  income, grossMarginPct, operatingMarginPct, netMarginPct,
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

  return (
    <FinancialsCard
      title={t("incomeStatementTab.titleBar")}
      growthNote={t("incomeStatementTab.vsPriorYear")}
      latestLabel={t("incomeStatementTab.latest")}
      rows={rows}
    >
      {/* ── Ingresos ── */}
      <Section label={t("incomeStatementTab.revenue")} color="#3b82f6" />
      <ValueRow rows={rows} field="Total Revenue"   label={t("incomeStatementTab.totalRevenue")}  isTotal showGrowth />
      <ValueRow rows={rows} field="Cost Of Revenue" label={t("incomeStatementTab.costOfRevenue")}   isNeg indent />
      <ValueRow rows={rows} field="Gross Profit"    label={t("incomeStatementTab.grossProfit")}    isTotal showGrowth />
      <MarginRow rows={rows} field="Gross Margin %" label={t("incomeStatementTab.grossMargin")}      numeratorField="Gross Profit" fallbackPct={grossMarginPct} />

      {/* ── Gastos Operativos ── */}
      <Section label={t("incomeStatementTab.operatingExpensesSection")} color="#f59e0b" />
      <ValueRow rows={rows} field="Research And Development"       label={t("incomeStatementTab.researchAndDevelopment")} isNeg indent zeroAsDash />
      <ValueRow rows={rows} field="Selling General Administrative" label={t("incomeStatementTab.sellingGeneralAdmin")}      isNeg indent zeroAsDash />
      <ValueRow rows={rows} field="Operating Expenses"             label={t("incomeStatementTab.totalOperatingExpenses")}    isNeg zeroAsDash />
      <ValueRow rows={rows} field="Operating Income"               label={t("incomeStatementTab.operatingIncome")}  isTotal showGrowth />
      <MarginRow rows={rows} field="Operating Margin %" label={t("incomeStatementTab.operatingMargin")} numeratorField="Operating Income" fallbackPct={operatingMarginPct} />

      {/* ── No Operativo ── */}
      <Section label={t("incomeStatementTab.nonOperating")} color="#8b5cf6" />
      <ValueRow rows={rows} field="Interest Income"  label={t("incomeStatementTab.interestIncome")}   indent zeroAsDash />
      <ValueRow rows={rows} field="Interest Expense" label={t("incomeStatementTab.interestExpense")}     isNeg indent zeroAsDash />
      <ValueRow rows={rows} field="Pretax Income"    label={t("incomeStatementTab.pretaxIncome")} isTotal zeroAsDash />
      <ValueRow rows={rows} field="Tax Provision"    label={t("incomeStatementTab.taxes")}              isNeg indent zeroAsDash />

      {/* ── Resultado Final ── */}
      <Section label={t("incomeStatementTab.finalResult")} color="var(--accent-l)" />
      <ValueRow rows={rows} field="Net Income" label={t("incomeStatementTab.netIncome")} highlight showGrowth />
      <MarginRow rows={rows} field="Net Margin %" label={t("incomeStatementTab.netMargin")} numeratorField="Net Income" fallbackPct={netMarginPct} />
      <ValueRow rows={rows} field="EBITDA"                        label={t("incomeStatementTab.ebitda")}         showGrowth zeroAsDash />
      <ValueRow rows={rows} field="Depreciation And Amortization" label={t("incomeStatementTab.depreciationAmortization")}            indent zeroAsDash />
      <ValueRow rows={rows} field="Diluted EPS"                   label={t("incomeStatementTab.dilutedEps")}    isEPS indent zeroAsDash />
      <ValueRow rows={rows} field="Basic EPS"                     label={t("incomeStatementTab.basicEps")}     isEPS indent zeroAsDash />
    </FinancialsCard>
  );
}
