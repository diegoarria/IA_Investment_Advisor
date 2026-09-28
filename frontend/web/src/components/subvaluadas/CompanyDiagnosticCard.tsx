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
import { GlowCard, IconSquare } from "@/components/subvaluadas/radarUi";
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

// Section header — icon in a tinted square, title + subtitle (mobile parity).
function DiagHeader({ title, subtitle, icon, tint }: { title: string; subtitle?: string; icon: ReactNode; tint?: string }) {
  return (
    <div className="flex items-center gap-3 mb-3.5">
      <IconSquare color={tint}>{icon}</IconSquare>
      <div className="flex-1 min-w-0">
        <p className="text-base font-extrabold tracking-tight truncate" style={{ color: "var(--text)" }}>{title}</p>
        {subtitle && <p className="text-xs leading-4 mt-0.5" style={{ color: "var(--muted)" }}>{subtitle}</p>}
      </div>
    </div>
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
  // Redesign v2 (2026-09-27, mobile parity): the hero is three cards of its
  // own (verdict / score / why), so it's no longer wrapped in one big card.
  const hero = (
    <div>
      <CompanyDiagnosticHero data={data} locked={locked} onUnlock={onUnlock} />

      {(data.stale || data.sectorModelNote) && (
        <GlowCard className="mt-4 space-y-3.5">
          {/* Diego, 2026-09-23: "esta pantalla NUNCA debe fallar" — shown
              only when every real data provider was unavailable and the
              backend served the last real, previously-computed diagnostic. */}
          {data.stale && (
            <div className="rounded-[14px] px-3.5 py-3" style={{ background: "rgba(245,158,11,0.08)", borderLeft: "3px solid #f59e0b" }}>
              <p className="text-[12px] leading-relaxed" style={{ color: "#f59e0b" }}>
                {t("companyDiagnostic.staleNotice", { period: data.staleAsOf || t("companyDiagnostic.staleNoticeUnknownPeriod") })}
              </p>
            </div>
          )}
          {data.sectorModelNote && (
            <div className="rounded-[14px] px-3.5 py-3" style={{ background: "rgba(212,162,76,0.08)", borderLeft: "3px solid #D4A24C" }}>
              <p className="text-[10px] font-extrabold uppercase mb-1" style={{ color: "var(--accent-l)" }}>
                {t("companyDiagnostic.sectorModelNoteTitle")}
              </p>
              <p className="text-[12px] leading-relaxed" style={{ color: "var(--sub)" }}>{data.sectorModelNote.detalle}</p>
            </div>
          )}
        </GlowCard>
      )}
    </div>
  );

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
        <GlowCard tint="#00b96d" strong className="mt-4">
          <DiagHeader
            title={t("companyDiagnostic.thesis.title")}
            subtitle={t("companyDiagnostic.thesis.subtitle")}
            icon={<Target className="w-[18px] h-[18px]" style={{ color: "var(--accent-l)" }} />}
            tint="#00b96d"
          />
          <p className="text-[14.5px] leading-[22px]" style={{ color: "var(--sub)" }}>
            {renderWithBoldNumbers(data.investmentThesis)}
          </p>
        </GlowCard>
      )}

      {/* Guía de metodología — hasta abajo del todo, antes del disclaimer legal */}
      <GlowCard className="mt-4">
        <DiagHeader
          title={t("companyDiagnostic.methodology.title")}
          subtitle={t("companyDiagnostic.methodology.subtitle")}
          icon={<BookOpen className="w-[18px] h-[18px]" style={{ color: "var(--sub)" }} />}
        />
        <div className="space-y-3">
          {methodologyParagraphs.map((p, i) => (
            <div key={i} className="flex gap-2.5">
              <div className="w-1 rounded-sm shrink-0" style={{ background: "var(--raised)" }} />
              <p className="flex-1 text-[13.5px] leading-5" style={{ color: "var(--sub)" }}>{p}</p>
            </div>
          ))}
        </div>
      </GlowCard>

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
      <p className="text-[11px] leading-4 mt-5 px-2 text-center" style={{ color: "var(--dim)" }}>
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
