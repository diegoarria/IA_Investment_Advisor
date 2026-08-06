"use client";

// Fase 4, Incremento 6 — Historial de valuaciones (Parte E, alcance
// ajustado — ver src/lib/thesisHistory.ts). Muestra la evolución real de
// la tesis PERSONAL del usuario (Fase 3's user_investment_theses) — no
// existe todavía un historial automático de valuaciones de años pasados
// (eso requeriría un cron/snapshot nuevo, fuera de alcance de esta fase de
// UX); esto crece con el tiempo a medida que el usuario revisa su tesis.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Plus, Minus } from "lucide-react";
import { Card, SectionHeader, Badge } from "@/components/ui";
import { diffClaimTexts, type ThesisVersion } from "@/lib/thesisHistory";

function ClaimDiffList({ title, added, removed }: { title: string; added: string[]; removed: string[] }) {
  const { t } = useTranslation();
  if (added.length === 0 && removed.length === 0) {
    return (
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>{title}</p>
        <p className="text-[11px] italic" style={{ color: "var(--muted)" }}>{t("subvaluadas.thesisHistory.noChange")}</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>{title}</p>
      <ul className="space-y-1">
        {added.map((text, i) => (
          <li key={`a${i}`} className="flex items-start gap-1.5 text-[11.5px] leading-relaxed" style={{ color: "var(--sub)" }}>
            <Plus className="w-3 h-3 mt-0.5 shrink-0" style={{ color: "#22c55e" }} />{text}
          </li>
        ))}
        {removed.map((text, i) => (
          <li key={`r${i}`} className="flex items-start gap-1.5 text-[11.5px] leading-relaxed line-through" style={{ color: "var(--muted)" }}>
            <Minus className="w-3 h-3 mt-0.5 shrink-0" style={{ color: "#ef4444" }} />{text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ThesisHistoryPanel({ versions, loading }: { versions: ThesisVersion[]; loading: boolean }) {
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState(0); // compares versions[selectedIndex] (newer) vs versions[selectedIndex+1] (older)

  if (loading) {
    return (
      <Card className="mb-6">
        <SectionHeader title={t("subvaluadas.thesisHistory.title")} />
        <p className="text-xs text-center py-6" style={{ color: "var(--muted)" }}>{t("subvaluadas.thesisHistory.loading")}</p>
      </Card>
    );
  }

  if (versions.length === 0) {
    return (
      <Card className="mb-6">
        <SectionHeader title={t("subvaluadas.thesisHistory.title")} />
        <p className="text-xs text-center py-6" style={{ color: "var(--muted)" }}>{t("subvaluadas.thesisHistory.noThesisYet")}</p>
      </Card>
    );
  }

  if (versions.length === 1) {
    return (
      <Card className="mb-6">
        <SectionHeader title={t("subvaluadas.thesisHistory.title")} />
        <p className="text-[11px] mb-2" style={{ color: "var(--muted)" }}>{t("subvaluadas.thesisHistory.onlyOneVersion")}</p>
        <p className="text-[12px] leading-relaxed" style={{ color: "var(--sub)" }}>{versions[0].thesis_summary}</p>
      </Card>
    );
  }

  const newer = versions[selectedIndex];
  const older = versions[selectedIndex + 1];
  const variablesDiff = diffClaimTexts(older.critical_variables, newer.critical_variables);
  const risksDiff = diffClaimTexts(older.key_risks, newer.key_risks);

  return (
    <Card className="mb-6">
      <SectionHeader title={t("subvaluadas.thesisHistory.title")} subtitle={t("subvaluadas.thesisHistory.subtitle", { count: versions.length })} />

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {versions.map((v, i) => (
          <button
            key={v.id}
            onClick={() => setSelectedIndex(Math.min(i, versions.length - 2))}
            className="px-2.5 py-1 rounded-lg text-[11px] font-bold"
            style={{
              background: i === selectedIndex || i === selectedIndex + 1 ? "var(--accent)" : "var(--raised)",
              color: i === selectedIndex || i === selectedIndex + 1 ? "#0A0F1A" : "var(--muted)",
            }}
          >
            v{v.version}{v.is_current ? ` (${t("subvaluadas.thesisHistory.current")})` : ""}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-3 text-[11px] font-bold" style={{ color: "var(--muted)" }}>
        <span>v{older.version}</span>
        <ArrowRight className="w-3 h-3" />
        <span style={{ color: "var(--accent-l)" }}>v{newer.version}</span>
        {newer.is_current && <Badge tone="accent">{t("subvaluadas.thesisHistory.current")}</Badge>}
      </div>

      <p className="text-[12px] leading-relaxed mb-4" style={{ color: "var(--sub)" }}>{newer.thesis_summary}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ClaimDiffList title={t("subvaluadas.thesisHistory.variablesChanged")} added={variablesDiff.added} removed={variablesDiff.removed} />
        <ClaimDiffList title={t("subvaluadas.thesisHistory.risksChanged")} added={risksDiff.added} removed={risksDiff.removed} />
      </div>
    </Card>
  );
}
