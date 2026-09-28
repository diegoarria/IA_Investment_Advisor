"use client";

// Pilar 1's "Duelo de Titanes" — a real <table> at sm: and above, stacked
// duel-cards below 640px. Both layouts render from the same `rows` array
// (no duplicate data mapping) — only visibility switches via Tailwind
// responsive classes, matching this codebase's mobile-first convention.
// Rendered inside CompanyDiagnosticQualityPillar's own icon+title SubCard,
// so this component only shows the "vs. Competitor" subtitle, not a
// duplicate section title.

import { useTranslation } from "react-i18next";
import { Award } from "lucide-react";
import { _SCENARIO_COLOR } from "@/components/subvaluadas/shared";
import type { CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

const _NUVOS_ADVANTAGE_COLOR = _SCENARIO_COLOR.bull;

export function CompanyDiagnosticCompetitorTable({
  competitorComparison,
}: {
  competitorComparison: NonNullable<CompanyDiagnosticData["competitorComparison"]>;
}) {
  const { t } = useTranslation();
  const { competitorName, rows, conclusion } = competitorComparison;

  return (
    <div>
      <p className="text-[12.5px] font-bold mb-2.5 truncate" style={{ color: "var(--muted)" }}>
        {t("companyDiagnostic.pillars.quality.vs")} {competitorName}
      </p>

      <div className="space-y-2.5">
        {rows.map((row) => (
          <div key={row.metricName} className="rounded-[14px] p-3.5" style={{ background: "var(--card)" }}>
            <p className="text-xs font-extrabold mb-2.5 truncate" style={{ color: "var(--sub)" }}>{row.metricName}</p>
            <div className="flex items-stretch gap-2">
              <div className="flex-1 min-w-0 rounded-xl p-2.5" style={{ background: `${_NUVOS_ADVANTAGE_COLOR}1f` }}>
                <p className="text-[9.5px] font-black uppercase tracking-[0.5px]" style={{ color: _NUVOS_ADVANTAGE_COLOR }}>Nuvos</p>
                <p className="text-base font-black tabular-nums mt-[3px] truncate" style={{ color: "var(--text)" }}>{row.targetCompanyValue}</p>
              </div>
              <div className="flex-1 min-w-0 rounded-xl p-2.5 text-right" style={{ background: "var(--raised)" }}>
                <p className="text-[9.5px] font-black uppercase tracking-[0.5px] truncate" style={{ color: "var(--muted)" }}>{competitorName}</p>
                <p className="text-base font-extrabold tabular-nums mt-[3px] truncate" style={{ color: "var(--sub)" }}>{row.competitorValue}</p>
              </div>
            </div>
            <p className="text-xs leading-[17px] mt-2.5" style={{ color: "var(--muted)" }}>{row.nuvosAdvantageNote}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-2xl p-3.5" style={{ background: `linear-gradient(135deg, ${_NUVOS_ADVANTAGE_COLOR}2e, ${_NUVOS_ADVANTAGE_COLOR}0a)`, border: `1px solid ${_NUVOS_ADVANTAGE_COLOR}66` }}>
        <div className="flex items-center gap-2 mb-1.5">
          <Award className="w-[15px] h-[15px]" style={{ color: _NUVOS_ADVANTAGE_COLOR }} />
          <p className="text-[11.5px] font-black uppercase tracking-[0.5px]" style={{ color: _NUVOS_ADVANTAGE_COLOR }}>
            {t("companyDiagnostic.pillars.quality.conclusionLabel")}
          </p>
        </div>
        <p className="text-sm leading-[20.5px]" style={{ color: "var(--text)" }}>{conclusion}</p>
      </div>
    </div>
  );
}
