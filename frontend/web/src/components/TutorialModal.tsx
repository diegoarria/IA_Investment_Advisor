"use client";

import { useState } from "react";
import { useTutorialStore } from "@/lib/store";
import { X, ArrowRight, ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

const STEP_META = [
  { num: 1, emoji: "👋", color: "#00b96d" },
  { num: 2, emoji: "🏠", color: "#00b96d" },
  { num: 3, emoji: "💬", color: "#10b981" },
  { num: 4, emoji: "📊", color: "#3b82f6" },
  { num: 5, emoji: "📅", color: "#f59e0b" },
  { num: 6, emoji: "👁️", color: "#0ea5e9" },
  { num: 7, emoji: "📚", color: "#06b6d4" },
  { num: 8, emoji: "🧠", color: "#a855f7" },
] as const;

function getSteps(t: TFunction) {
  return STEP_META.map((s) => ({
    ...s,
    title: t(`tutorialModal.steps.${s.num}.title`),
    subtitle: t(`tutorialModal.steps.${s.num}.subtitle`),
    desc: t(`tutorialModal.steps.${s.num}.desc`),
    tip: t(`tutorialModal.steps.${s.num}.tip`),
  }));
}

export default function TutorialModal() {
  const { t } = useTranslation();
  const STEPS = getSteps(t);
  const { tutorialOpen, markSeen } = useTutorialStore();
  const [step, setStep] = useState(0);

  if (!tutorialOpen) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const progress = ((step + 1) / STEPS.length) * 100;

  const handleNext = () => {
    if (isLast) { markSeen(); setStep(0); }
    else setStep(step + 1);
  };

  const handleClose = () => { markSeen(); setStep(0); };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
         style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}>
      <div className="w-full max-w-md animate-fade-in-up relative"
           style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "28px", overflow: "hidden", boxShadow: "var(--shadow-lg)" }}>

        {/* Progress bar */}
        <div className="h-0.5 w-full" style={{ background: "var(--border)" }}>
          <div className="h-full transition-all duration-500"
               style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${current.color}, ${current.color}cc)` }} />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--dim)" }}>
            {t("tutorialModal.stepCounter", { step: step + 1, total: STEPS.length })}
          </span>
          <button onClick={handleClose}
                  className="p-1.5 rounded-xl hover:bg-white/5 transition-colors"
                  style={{ color: "var(--muted)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 pb-6">
          {/* Emoji */}
          <div className="flex justify-center mb-5">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl"
                 style={{ background: current.color + "15", border: `2px solid ${current.color}30` }}>
              {current.emoji}
            </div>
          </div>

          <h2 className="text-xl font-black text-center mb-1 tracking-tight"
              style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {current.title}
          </h2>
          <p className="text-xs text-center font-semibold mb-4 uppercase tracking-wider"
             style={{ color: current.color }}>
            {current.subtitle}
          </p>
          <p className="text-sm leading-relaxed text-center mb-5"
             style={{ color: "var(--sub)" }}>
            {current.desc}
          </p>

          {/* Tip */}
          <div className="rounded-2xl px-4 py-3 mb-6 text-xs leading-relaxed"
               style={{ background: current.color + "0e", border: `1px solid ${current.color}25`, color: "var(--muted)" }}>
            {current.tip}
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-3">
            {step > 0 ? (
              <button onClick={() => setStep(step - 1)}
                      className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl text-sm font-semibold transition-all"
                      style={{ background: "var(--raised)", border: "1px solid var(--border)", color: "var(--muted)" }}>
                <ArrowLeft className="w-3.5 h-3.5" />
                {t("tutorialModal.back")}
              </button>
            ) : (
              <button onClick={handleClose}
                      className="px-4 py-2.5 rounded-2xl text-sm font-semibold transition-all"
                      style={{ background: "var(--raised)", border: "1px solid var(--border)", color: "var(--muted)" }}>
                {t("tutorialModal.skip")}
              </button>
            )}

            <button onClick={handleNext}
                    className="btn-primary flex-1 flex items-center justify-center gap-2 py-2.5 text-sm"
                    style={{ background: `linear-gradient(135deg, ${current.color}, ${current.color}cc)`, boxShadow: `0 4px 16px ${current.color}40` }}>
              {isLast ? t("tutorialModal.start") : t("tutorialModal.next")}
              {!isLast && <ArrowRight className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Dots */}
          <div className="flex justify-center gap-1.5 mt-4">
            {STEPS.map((_, i) => (
              <button key={i} onClick={() => setStep(i)}
                      className="rounded-full transition-all"
                      style={{
                        width: i === step ? 20 : 6,
                        height: 6,
                        background: i === step ? current.color : "var(--border)",
                      }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
