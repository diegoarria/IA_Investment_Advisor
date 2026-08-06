"use client";

// Fase 4, Incremento 3 — Explainability Engine (Parte C). Wraps any
// number/score with an (i) trigger that reveals: source, how it was
// calculated, what confidence it carries, and what changed since last
// quarter — built ENTIRELY from data Fase 2/3 engines already compute
// (factors[]/EvidenceTaggedClaim), never a new explanation invented here.
// "Nunca mostrar únicamente un número."

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Info, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "./Card";

export interface ExplanationFactor {
  name: string;
  value: number | string | null;
  score: number | null;
  reason: string;
}

export interface ExplanationContent {
  /** One-line "why" — the top answer to "¿por qué este número?" */
  summary?: string | null;
  /** "¿Cómo se calculó? ¿Qué información se utilizó?" — the real
   * factors[] a Fase 2/3 engine already returns, never re-derived here. */
  factors?: ExplanationFactor[];
  confidence?: "low" | "medium" | "high" | null;
  source?: string | null;
  /** "¿Qué cambió respecto al trimestre anterior?" */
  changeNote?: string | null;
}

export function ExplainableValue({
  label, content, children,
}: {
  label: string;
  content: ExplanationContent;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  // Close on Escape — keyboard-navigable, per Fase 4 Parte N (accesibilidad).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <span ref={containerRef} className="relative inline-flex items-center gap-1">
      {children}
      <button
        type="button"
        aria-label={t("common.explainability.trigger", { label })}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full shrink-0"
        style={{ color: "var(--muted)" }}
      >
        <Info className="w-3 h-3" />
      </button>
      {open && (
        <>
          {/* Click-outside-to-close overlay — transparent, no visual weight */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <Card
            className="absolute z-50 top-full mt-1.5 left-1/2 -translate-x-1/2 w-64 text-left shadow-lg"
            padding="p-3"
            style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}
          >
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide truncate" style={{ color: "var(--muted)" }}>{label}</span>
              <button onClick={() => setOpen(false)} aria-label={t("common.close")} className="shrink-0">
                <X className="w-3 h-3" style={{ color: "var(--muted)" }} />
              </button>
            </div>

            {content.summary && (
              <p className="text-[11px] leading-relaxed mb-2" style={{ color: "var(--sub)" }}>{content.summary}</p>
            )}

            {content.factors && content.factors.length > 0 && (
              <div className="space-y-1 mb-2">
                <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                  {t("common.explainability.howCalculated")}
                </p>
                {content.factors.map((f, i) => (
                  <div key={i} className="text-[10.5px] leading-snug" style={{ color: "var(--dim)" }}>
                    <span className="font-bold" style={{ color: "var(--text)" }}>{f.name}</span>
                    {f.score !== null && <span style={{ color: "var(--muted)" }}> ({f.score})</span>}
                    {": "}{f.reason}
                  </div>
                ))}
              </div>
            )}

            {content.changeNote && (
              <p className="text-[10.5px] leading-relaxed mb-2" style={{ color: "var(--dim)" }}>
                <span className="font-bold" style={{ color: "var(--text)" }}>{t("common.explainability.sinceLastQuarter")}: </span>
                {content.changeNote}
              </p>
            )}

            {(content.confidence || content.source) && (
              <div className="flex items-center justify-between gap-2 text-[9.5px] pt-1.5 border-t" style={{ borderColor: "var(--border)" }}>
                {content.confidence && (
                  <span style={{ color: "var(--muted)" }}>{t(`common.explainability.confidence.${content.confidence}`)}</span>
                )}
                {content.source && (
                  <span className="truncate max-w-[140px]" style={{ color: "var(--muted)" }} title={content.source}>{content.source}</span>
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </span>
  );
}
