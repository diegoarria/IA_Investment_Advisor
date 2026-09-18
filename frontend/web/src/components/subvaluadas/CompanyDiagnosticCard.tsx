"use client";

// CompanyDiagnosticCard — Nuvos AI "Ficha de Diagnóstico." Self-contained
// through Capa 2 (hero + 4 collapsible pillars) plus Tesis Final, la guía
// de metodología y el disclaimer legal. El hero nunca se bloquea (ver el
// prop `locked` más abajo); solo el contenido debajo de él lo hace. No
// trailing action bar/footer —
// the caller (app/subvaluadas/page.tsx) renders the standard "Actualizado
// hoy / Seguir / Analizar con Arthur" row right after this card, reusing
// the exact same GeneratedAtNote/FollowButton/AnalyzeButton it already
// uses for the legacy DCF/GQV panel, instead of this component duplicating
// that with its own bespoke sticky bar. Pure presentation: accepts
// `CompanyDiagnosticData` as a prop.

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Lock, Target } from "lucide-react";
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

export function CompanyDiagnosticCard({
  data, locked, onUnlock,
}: {
  data: CompanyDiagnosticData;
  // Diego, 2026-09-09 (revisado 2026-09-14): past the free weekly search
  // limit, the caller still passes real (never fabricated) data — the hero
  // (ticker, veredicto, banda de rango, frase "por qué") stays visible as a
  // taste of real value, and everything below it (tabs de valuación con el
  // detalle real, tesis, metodología, backtest, quiz) blurs behind an
  // upgrade CTA instead of the search dead-ending on an empty/blocked page.
  locked?: boolean;
  onUnlock?: () => void;
}) {
  const { t } = useTranslation();

  const methodologyParagraphs = t("companyDiagnostic.methodology.paragraphs", { returnObjects: true }) as string[];

  // Capa 1 — Hero. Blurreaba solo el detalle profundo debajo de "Ver el
  // razonamiento completo" cuando `locked` (Diego, 2026-09-14: "dales a los
  // free/guests un poquito del dulce, pero no todo" — dejaba visibles
  // ticker/veredicto/banda/frase "por qué" como muestra). Diego, 2026-09-18:
  // revierte esa excepción — después de las 3 vistas gratis semanales, todo
  // el diagnóstico se blurrea, hero incluido; ya no hay "taste" del hero.
  // El header de identificación (nombre/logo/precio) sobre esta tarjeta
  // vive en app/subvaluadas/page.tsx, fuera de este componente, y sigue
  // visible — es lo mínimo para saber qué empresa buscaste.
  const hero = (
    <Card
      padding="p-6 sm:p-7"
      style={{
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 10px 32px rgba(0,0,0,0.4)",
        borderColor: "var(--border-s, var(--border))",
        backgroundImage: "radial-gradient(120% 60% at 50% 0%, rgba(212,162,76,0.08) 0%, transparent 55%)",
      }}
    >
      <CompanyDiagnosticHero data={data} locked={locked} onUnlock={onUnlock} />

      {data.sectorModelNote && (
        <div className="rounded-xl px-3 py-2.5 mt-5" style={{ background: "rgba(212,162,76,0.08)", border: "1px solid rgba(212,162,76,0.2)" }}>
          <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--accent-l)" }}>
            {t("companyDiagnostic.sectorModelNoteTitle")}
          </p>
          <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--sub)" }}>{data.sectorModelNote.detalle}</p>
        </div>
      )}
    </Card>
  );

  // Capa 2+ — todo lo demás (tabs de valuación con el detalle real, tesis,
  // metodología, backtest, self-check quiz) sigue detrás del blur + CTA de
  // Premium cuando `locked`, exactamente como antes.
  const content = (
    <div>
      <CompanyDiagnosticValuationTabs data={data} />

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

  if (!locked) return <div>{hero}{content}</div>;

  return (
    <div>
      <div className="relative">
        <div
          className="pointer-events-none select-none"
          style={{ filter: "blur(7px)", opacity: 0.55 }}
          aria-hidden="true"
        >
          {hero}
          {content}
        </div>
        <div className="absolute inset-0 flex items-start justify-center pt-10 px-5">
          <div
            className="w-full max-w-[340px] rounded-2xl p-5 text-center"
            style={{ background: "var(--card)", border: "1px solid rgba(212,162,76,0.4)", boxShadow: "0 20px 50px -15px rgba(0,0,0,0.6)" }}
          >
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: "rgba(212,162,76,0.14)" }}>
              <Lock className="w-5 h-5" style={{ color: "#D4A24C" }} />
            </div>
            <p className="text-[14px] font-bold mb-1.5" style={{ color: "var(--text)" }}>
              {t("companyDiagnostic.locked.title")}
            </p>
            <p className="text-[12.5px] leading-relaxed mb-4" style={{ color: "var(--sub)" }}>
              {t("companyDiagnostic.locked.body")}
            </p>
            <button
              onClick={onUnlock}
              className="w-full rounded-xl py-2.5 px-4 text-[13.5px] font-bold"
              style={{ background: "#D4A24C", color: "#0A0F1A" }}
            >
              {t("companyDiagnostic.locked.cta")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
