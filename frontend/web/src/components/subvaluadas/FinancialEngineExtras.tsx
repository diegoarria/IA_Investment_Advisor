"use client";

import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import type { NuvosFairValueData } from "./shared";

// Financial-sector (banks/insurers/brokers) equivalents of the standard
// engine's Reverse DCF / Sensitivity cards — the FCF versions
// (`_ReverseDcfCard`/`_SensitivityStars` in shared.tsx) are hard-wired to
// `DriverBasedDcfInput`/`projectDriverBasedDcf` (a revenue->EBIT->FCF
// waterfall), which doesn't exist for a Residual Income valuation. Rendered
// INSTEAD of those two on /subvaluadas when `data.is_financial_sector` —
// same "Ver supuestos"-style visual language, same card shell, different
// (backend-precomputed, no client-side recompute) numbers underneath.

export function FinancialReverseValuationCard({ data }: { data: NuvosFairValueData }) {
  const { t } = useTranslation();
  const rv = data.financial_reverse_valuation;

  return (
    <Card>
      <SectionHeader title={t("subvaluadas.financialReverseValuation.title")} />
      <p className="text-[11.5px] leading-relaxed mt-1 mb-3" style={{ color: "var(--muted)" }}>
        {t("subvaluadas.financialReverseValuation.subtitle")}
      </p>
      {rv?.implied_roe_pct === null || rv?.implied_roe_pct === undefined ? (
        <p className="text-[11.5px]" style={{ color: "var(--muted)" }}>{t("subvaluadas.financialReverseValuation.unavailable")}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg p-2.5 text-center" style={{ background: "var(--raised)" }}>
            <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              {t("subvaluadas.financialReverseValuation.historical")}
            </p>
            <p className="text-[15px] font-black tabular-nums mt-0.5" style={{ color: "var(--text)" }}>
              {rv.historical_roe_pct !== null ? `${rv.historical_roe_pct.toFixed(1)}%` : "N/D"}
            </p>
          </div>
          <div className="rounded-lg p-2.5 text-center" style={{ background: `${data.exit_metric === "price_to_book" ? "#D4A24C" : "#D4A24C"}1f`, border: "1px solid #D4A24C" }}>
            <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "#D4A24C" }}>
              {t("subvaluadas.financialReverseValuation.marketImplies")}
            </p>
            <p className="text-[15px] font-black tabular-nums mt-0.5" style={{ color: "var(--text)" }}>
              {rv.implied_roe_pct.toFixed(1)}%
            </p>
          </div>
          <div className="rounded-lg p-2.5 text-center" style={{ background: "var(--raised)" }}>
            <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              {t("subvaluadas.financialReverseValuation.nuvosEstimates")}
            </p>
            <p className="text-[15px] font-black tabular-nums mt-0.5" style={{ color: "var(--text)" }}>
              {rv.nuvos_roe_pct !== null ? `${rv.nuvos_roe_pct.toFixed(1)}%` : "N/D"}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

export function FinancialSensitivityTable({ data }: { data: NuvosFairValueData }) {
  const { t } = useTranslation();
  const sm = data.sensitivity_matrix;
  if (!sm || sm.wacc_rows_pct.length === 0 || sm.multiple_cols.length === 0) return null;

  return (
    <Card>
      <SectionHeader title={t("subvaluadas.financialSensitivity.title")} />
      <p className="text-[11.5px] leading-relaxed mt-1 mb-3" style={{ color: "var(--muted)" }}>
        {t("subvaluadas.financialSensitivity.subtitle")}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] tabular-nums" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th className="text-left p-1.5 font-bold" style={{ color: "var(--muted)" }}>
                {t("subvaluadas.financialSensitivity.costOfEquityRow")}
              </th>
              {sm.multiple_cols.map((col, i) => (
                <th key={i} className="p-1.5 font-bold text-center" style={{ color: "var(--muted)" }}>{col.toFixed(2)}x</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sm.wacc_rows_pct.map((row, ri) => (
              <tr key={ri} style={{ borderTop: "1px solid var(--border)" }}>
                <td className="p-1.5 font-bold" style={{ color: "var(--text)" }}>{row.toFixed(1)}%</td>
                {sm.values[ri]?.map((v, ci) => (
                  <td key={ci} className="p-1.5 text-center font-semibold" style={{ color: "var(--text)" }}>
                    {v !== null ? `$${v.toFixed(0)}` : "N/D"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
