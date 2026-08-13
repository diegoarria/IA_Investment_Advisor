"use client";

// Pilar 1's "Duelo de Titanes" — a real <table> at sm: and above, stacked
// duel-cards below 640px. Both layouts render from the same `rows` array
// (no duplicate data mapping) — only visibility switches via Tailwind
// responsive classes, matching this codebase's mobile-first convention.

import { useTranslation } from "react-i18next";
import { RaisedBlock } from "@/components/ui/Card";
import { _SCENARIO_COLOR } from "@/components/subvaluadas/shared";
import type { CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

const _NUVOS_ADVANTAGE_COLOR = _SCENARIO_COLOR.bull;

export function CompanyDiagnosticCompetitorTable({
  competitorComparison,
}: {
  competitorComparison: CompanyDiagnosticData["competitorComparison"];
}) {
  const { t } = useTranslation();
  const { competitorName, rows, conclusion } = competitorComparison;

  return (
    <div>
      <p className="text-[11px] font-bold mb-2" style={{ color: "var(--text)" }}>
        {t("companyDiagnostic.pillars.quality.competitorTitle")} {t("companyDiagnostic.pillars.quality.vs")} {competitorName}
      </p>

      {/* >=640px: real table */}
      <div className="hidden sm:block overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr style={{ background: "var(--raised)" }}>
              <th className="px-3 py-2 text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}></th>
              <th className="px-3 py-2 text-[9px] font-bold uppercase tracking-wide" style={{ color: _NUVOS_ADVANTAGE_COLOR }}>Nuvos</th>
              <th className="px-3 py-2 text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{competitorName}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.metricName} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="px-3 py-2.5 text-[11px] font-bold" style={{ color: "var(--text)" }}>{row.metricName}</td>
                <td className="px-3 py-2.5 text-[11.5px] font-black tabular-nums" style={{ color: _NUVOS_ADVANTAGE_COLOR }}>{row.targetCompanyValue}</td>
                <td className="px-3 py-2.5 text-[11.5px] tabular-nums" style={{ color: "var(--sub)" }}>{row.competitorValue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* <640px: stacked duel cards */}
      <div className="sm:hidden space-y-2">
        {rows.map((row) => (
          <RaisedBlock key={row.metricName}>
            <p className="text-[10px] font-bold mb-1.5" style={{ color: "var(--muted)" }}>{row.metricName}</p>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: _NUVOS_ADVANTAGE_COLOR }}>Nuvos</p>
                <p className="text-[12px] font-black tabular-nums" style={{ color: "var(--text)" }}>{row.targetCompanyValue}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{competitorName}</p>
                <p className="text-[12px] font-bold tabular-nums" style={{ color: "var(--sub)" }}>{row.competitorValue}</p>
              </div>
            </div>
            <p className="text-[10px] mt-1.5 leading-relaxed" style={{ color: "var(--dim)" }}>{row.nuvosAdvantageNote}</p>
          </RaisedBlock>
        ))}
      </div>

      <div className="mt-3 rounded-xl p-3" style={{ background: `${_NUVOS_ADVANTAGE_COLOR}1a`, border: `1px solid ${_NUVOS_ADVANTAGE_COLOR}` }}>
        <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: _NUVOS_ADVANTAGE_COLOR }}>
          {t("companyDiagnostic.pillars.quality.conclusionLabel")}
        </p>
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--text)" }}>{conclusion}</p>
      </div>
    </div>
  );
}
