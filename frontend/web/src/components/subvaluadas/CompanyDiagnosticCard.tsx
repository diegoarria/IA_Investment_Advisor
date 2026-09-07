"use client";

// CompanyDiagnosticCard — Nuvos AI "Ficha de Diagnóstico." Self-contained
// through Capa 2 (hero + 4 collapsible pillars) plus Tesis Final, la guía
// de metodología y el disclaimer legal. No trailing action bar/footer —
// the caller (app/subvaluadas/page.tsx) renders the standard "Actualizado
// hoy / Seguir / Analizar con Arthur" row right after this card, reusing
// the exact same GeneratedAtNote/FollowButton/AnalyzeButton it already
// uses for the legacy DCF/GQV panel, instead of this component duplicating
// that with its own bespoke sticky bar. Pure presentation: accepts
// `CompanyDiagnosticData` as a prop.

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Target } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { CompanyDiagnosticHero } from "@/components/subvaluadas/CompanyDiagnosticHero";
import { CompanyDiagnosticValuationTabs } from "@/components/subvaluadas/CompanyDiagnosticValuationTabs";
import { CompanyDiagnosticSelfCheckQuiz } from "@/components/subvaluadas/CompanyDiagnosticSelfCheckQuiz";
import { ValuationBacktestPanel } from "@/components/subvaluadas/ValuationBacktestPanel";
import type { CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

// Bolds every dollar-amount ("$2.8 mil millones", "$3,400M") and percentage
// ("9.7%") found in a narrative string — used only for the Tesis Final
// summary, where Diego explicitly asked those 2 kinds of figures to always
// stand out in bold from the surrounding prose.
const _NUMBER_PATTERN_SOURCE = String.raw`\$\d[\d.,]*(?:\s?(?:mil millones|millones|mil|MM|bn|B|M|K))?|\d[\d.,]*%`;

function renderWithBoldNumbers(text: string): ReactNode[] {
  const splitRe = new RegExp(`(${_NUMBER_PATTERN_SOURCE})`, "gi");
  const matchRe = new RegExp(`^(?:${_NUMBER_PATTERN_SOURCE})$`, "i");
  return text.split(splitRe).map((part, i) =>
    matchRe.test(part) ? <strong key={i} style={{ color: "var(--text)" }}>{part}</strong> : <span key={i}>{part}</span>
  );
}

export function CompanyDiagnosticCard({ data }: { data: CompanyDiagnosticData }) {
  const { t } = useTranslation();

  const methodologyParagraphs = t("companyDiagnostic.methodology.paragraphs", { returnObjects: true }) as string[];

  return (
    <div>
      {/* Capa 1 — Hero (simplificado, ver CompanyDiagnosticHero.tsx) */}
      <Card
        padding="p-6 sm:p-7"
        style={{
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 10px 32px rgba(0,0,0,0.4)",
          borderColor: "var(--border-s, var(--border))",
          backgroundImage: "radial-gradient(120% 60% at 50% 0%, rgba(212,162,76,0.08) 0%, transparent 55%)",
        }}
      >
        <CompanyDiagnosticHero data={data} />

        {data.sectorModelNote && (
          <div className="rounded-xl px-3 py-2.5 mt-5" style={{ background: "rgba(212,162,76,0.08)", border: "1px solid rgba(212,162,76,0.2)" }}>
            <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--accent-l)" }}>
              {t("companyDiagnostic.sectorModelNoteTitle")}
            </p>
            <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--sub)" }}>{data.sectorModelNote.detalle}</p>
          </div>
        )}

        <CompanyDiagnosticValuationTabs data={data} />
      </Card>

      {/* Los 4 pilares (Calidad/Confianza/Valor/Simplicidad) ahora viven
          como pestañas DENTRO de CompanyDiagnosticValuationTabs — mismo
          card único que "¿Por qué este número?", igual que el Artifact —
          no como tarjetas separadas acá. */}

      {/* Tesis Final — resumen de inversión, números clave en negrita.
          Omitida cuando la generación de IA on-demand falló para este
          ticker (nunca se muestra un placeholder inventado). */}
      {data.investmentThesis && (
        <Card padding="p-5 sm:p-6" className="mt-4" style={{ borderColor: "var(--accent)" }}>
          <SectionHeader
            title={t("companyDiagnostic.thesis.title")}
            subtitle={t("companyDiagnostic.thesis.subtitle")}
            action={<Target className="w-5 h-5 shrink-0" style={{ color: "var(--accent-l)" }} />}
          />
          <p className="text-[15px] leading-relaxed mt-4" style={{ color: "var(--text)" }}>
            {renderWithBoldNumbers(data.investmentThesis)}
          </p>
        </Card>
      )}

      {/* Guía de metodología — hasta abajo del todo, antes del disclaimer legal */}
      <Card padding="p-5 sm:p-6" className="mt-4">
        <SectionHeader
          title={t("companyDiagnostic.methodology.title")}
          subtitle={t("companyDiagnostic.methodology.subtitle")}
          action={<BookOpen className="w-5 h-5 shrink-0" style={{ color: "var(--muted)" }} />}
        />
        <div className="mt-4 space-y-3">
          {methodologyParagraphs.map((p, i) => (
            <p key={i} className="text-[14px] leading-relaxed" style={{ color: "var(--sub)" }}>{p}</p>
          ))}
        </div>
      </Card>

      {/* "What $10,000 became" — ticker-independent, cached globally (see
          ValuationBacktestPanel.tsx). Moved here from the bottom of
          app/subvaluadas/page.tsx (Diego, 2026-08-19): sits right above the
          Self-Check quiz as motivation/context before the user tests their
          own instinct, instead of after everything at the very end of the
          screen where it was easy to miss. */}
      <ValuationBacktestPanel />

      {/* Self-Check — después de la guía de metodología y el backtest,
          antes del disclaimer legal (Diego). */}
      <CompanyDiagnosticSelfCheckQuiz ticker={data.ticker} />

      {/* Disclaimer — donde termina esta tarjeta. El pie (Actualizado hoy /
          Seguir / Analizar con Arthur) lo agrega el caller, no este
          componente — ver la nota al inicio del archivo. */}
      <p className="text-[12px] leading-relaxed mt-5 text-center" style={{ color: "var(--dim)" }}>
        {t("companyDiagnostic.disclaimer")}
      </p>
    </div>
  );
}
