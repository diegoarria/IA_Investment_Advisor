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
import { ClipboardList, Loader2, Check } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
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
    <Card padding="p-5 sm:p-6" className="mt-4">
      <SectionHeader
        title={t("companyDiagnostic.selfCheckQuiz.title")}
        subtitle={t("companyDiagnostic.selfCheckQuiz.subtitle")}
        action={<ClipboardList className="w-5 h-5 shrink-0" style={{ color: "var(--muted)" }} />}
      />
      <div className="mt-4 space-y-3.5">
        {questions.map((q, i) => (
          <div key={i}>
            <label className="text-[13px] font-semibold" style={{ color: "var(--text)" }}>{q}</label>
            <textarea
              value={answers[i]}
              onChange={(e) => handleChange(i, e.target.value)}
              placeholder={t("companyDiagnostic.selfCheckQuiz.placeholder")}
              rows={2}
              className="w-full mt-1.5 text-[13px] rounded-lg px-2.5 py-2 border bg-transparent resize-none outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            />
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <button
          onClick={handleSave}
          disabled={!hasAnyAnswer || saving}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold text-white disabled:opacity-40"
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
          <span className="text-[12px]" style={{ color: "#ef4444" }}>{t("companyDiagnostic.selfCheckQuiz.saveError")}</span>
        )}
      </div>
    </Card>
  );
}
