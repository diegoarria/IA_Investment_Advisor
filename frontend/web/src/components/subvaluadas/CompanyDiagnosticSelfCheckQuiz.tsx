"use client";

// Self-Check mini-quiz — hasta abajo de CompanyDiagnosticCard, antes del
// disclaimer legal (Diego). 5 preguntas de comprensión libres, todas
// opcionales; lo que el usuario responda se guarda como Q&A estructurado
// en su Diario de Decisiones existente (investment_decisions.quiz_answers,
// migración 075) — nunca bloquea nada, nunca se pierde si no se guarda.
// Mismo estilo de Card + SectionHeader que las secciones vecinas (Tesis
// Final, Guía de metodología) en vez de inventar una caja nueva.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GlowCard, IconSquare } from "@/components/subvaluadas/radarUi";
import { ClipboardList, Loader2, Check } from "lucide-react";
import { decisionsApi } from "@/lib/api";

export function CompanyDiagnosticSelfCheckQuiz({ ticker }: { ticker: string }) {
  const { t } = useTranslation();
  const questions = t("companyDiagnostic.selfCheckQuiz.questions", { returnObjects: true }) as string[];
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  const hasAnyAnswer = answers.some((a) => a.trim() !== "");

  const handleChange = (i: number, value: string) => {
    setSaved(false);
    setAnswers((prev) => prev.map((a, idx) => (idx === i ? value : a)));
  };

  const handleSave = async () => {
    if (!hasAnyAnswer || saving) return;
    setSaving(true);
    setError(false);
    try {
      const quiz_answers = questions
        .map((q, i) => ({ question: q, answer: answers[i].trim() }))
        .filter((qa) => qa.answer !== "");
      await decisionsApi.log({
        action: "hold",
        ticker,
        trigger: "research",
        notes: t("companyDiagnostic.selfCheckQuiz.title") + ` — ${ticker}`,
        quiz_answers,
      });
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <GlowCard className="mt-4">
      <div className="flex items-center gap-3">
        <IconSquare><ClipboardList className="w-[18px] h-[18px]" style={{ color: "var(--sub)" }} /></IconSquare>
        <div className="flex-1 min-w-0">
          <p className="text-base font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{t("companyDiagnostic.selfCheckQuiz.title")}</p>
          <p className="text-xs leading-4 mt-0.5" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.selfCheckQuiz.subtitle")}</p>
        </div>
      </div>
      <div className="mt-[18px] space-y-4">
        {questions.map((q, i) => (
          <div key={i}>
            <label className="flex gap-2 text-[13.5px] leading-[19px] font-semibold" style={{ color: "var(--text)" }}>
              <span className="font-black tabular-nums" style={{ color: "var(--muted)" }}>{i + 1}.</span>{q}
            </label>
            <textarea
              value={answers[i]}
              onChange={(e) => handleChange(i, e.target.value)}
              placeholder={t("companyDiagnostic.selfCheckQuiz.placeholder")}
              rows={2}
              className="w-full mt-2 text-[13.5px] rounded-xl px-3 py-2.5 border resize-none outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--raised)", minHeight: 52 }}
            />
          </div>
        ))}
      </div>

      <div className="mt-[18px] space-y-2.5">
        <button
          onClick={handleSave}
          disabled={!hasAnyAnswer || saving}
          className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-[14px] text-sm font-extrabold text-white disabled:opacity-40"
          style={{ background: "var(--brand-green)" }}
        >
          {saving ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("companyDiagnostic.selfCheckQuiz.saving")}</>
          ) : saved ? (
            <><Check className="w-3.5 h-3.5" /> {t("companyDiagnostic.selfCheckQuiz.saved")}</>
          ) : (
            t("companyDiagnostic.selfCheckQuiz.saveButton")
          )}
        </button>
        {error && (
          <p className="text-[12px] text-center" style={{ color: "#ef4444" }}>{t("companyDiagnostic.selfCheckQuiz.saveError")}</p>
        )}
      </div>
    </GlowCard>
  );
}
