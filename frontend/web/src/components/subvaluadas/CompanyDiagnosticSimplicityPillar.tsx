"use client";

// Pilar 4 (Simplicidad) — red/green noise-vs-reality contrast blocks plus
// the suggested action plan, wrapped in the shared ExpandableSection.

import { useTranslation } from "react-i18next";
import { Lightbulb, Megaphone, CheckCheck, UserCircle, Navigation } from "lucide-react";
import { PillarSection, RaisedTile, Eyebrow, IconDot } from "@/components/subvaluadas/radarUi";
import { CompanyDiagnosticSectionScore } from "@/components/subvaluadas/CompanyDiagnosticSectionScore";
import type { CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

export function CompanyDiagnosticSimplicityPillar({
  score, noiseVsReality, actionPlan,
}: {
  score: number;
  noiseVsReality: CompanyDiagnosticData["noiseVsReality"];
  actionPlan: CompanyDiagnosticData["actionPlan"];
}) {
  const { t } = useTranslation();

  return (
    <PillarSection
      title={t("companyDiagnostic.pillars.simplicity.title")}
      icon={<Lightbulb className="w-[18px] h-[18px]" style={{ color: "#f59e0b" }} />}
      iconColor="#f59e0b"
      headline={
        <CompanyDiagnosticSectionScore
          score={score}
          label={t("companyDiagnostic.explanations.scoreSimplicity.title")}
          explanation={t("companyDiagnostic.explanations.scoreSimplicity.body")}
        />
      }
    >
      {noiseVsReality && (
        <div className="space-y-2.5">
          {([
            { key: "marketSaw", color: "#ef4444", Icon: Megaphone, text: noiseVsReality.marketSaw },
            { key: "nuvosReality", color: "#22c55e", Icon: CheckCheck, text: noiseVsReality.nuvosReality },
          ] as const).map((b) => (
            <div key={b.key} className="rounded-[18px] p-4" style={{ background: `linear-gradient(135deg, ${b.color}26, ${b.color}08)`, border: `1px solid ${b.color}55` }}>
              <div className="flex items-center gap-2.5 mb-2.5">
                <IconDot color={b.color}><b.Icon className="w-[15px] h-[15px]" /></IconDot>
                <p className="flex-1 text-xs font-black uppercase tracking-[0.6px]" style={{ color: b.color }}>
                  {t(`companyDiagnostic.pillars.simplicity.${b.key}`)}
                </p>
              </div>
              <p className="text-[14.5px] leading-[21.5px]" style={{ color: "var(--text)" }}>{b.text}</p>
            </div>
          ))}
        </div>
      )}

      {actionPlan && (
        <div>
          <Eyebrow>{t("companyDiagnostic.pillars.simplicity.actionPlanTitle")}</Eyebrow>
          <RaisedTile tint="#f59e0b">
            {([
              { Icon: UserCircle, label: t("companyDiagnostic.pillars.simplicity.profile"), value: actionPlan.profile },
              { Icon: Navigation, label: t("companyDiagnostic.pillars.simplicity.strategy"), value: actionPlan.strategy },
            ]).map((row, i) => (
              <div key={i} className="flex gap-3 items-start" style={i ? { paddingTop: 14, marginTop: 14, borderTop: "1px solid var(--border)" } : undefined}>
                <IconDot color="#f59e0b" size={34}><row.Icon className="w-[17px] h-[17px]" /></IconDot>
                <div className="flex-1 min-w-0">
                  <p className="text-[11.5px] font-bold" style={{ color: "var(--muted)" }}>{row.label}</p>
                  <p className="text-[15.5px] leading-[21px] font-extrabold mt-0.5" style={{ color: "var(--text)" }}>{row.value}</p>
                </div>
              </div>
            ))}
          </RaisedTile>
        </div>
      )}
    </PillarSection>
  );
}
