"use client";
import { Check, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface OnboardingStep {
  emoji: string;
  title: string;
  description: string;
  completed: boolean;
}

interface Props {
  steps: OnboardingStep[];
  onStepClick: (index: number) => void;
}

export default function OnboardingChecklist({ steps, onStepClick }: Props) {
  const { t } = useTranslation();
  const completedCount = steps.filter((s) => s.completed).length;
  if (completedCount === steps.length) return null;

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: "var(--card)", borderColor: "rgba(0,212,126,0.3)" }}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🚀</span>
            <div>
              <p className="text-sm font-black" style={{ color: "var(--text)" }}>
                {t("onboardingChecklist.title")}
              </p>
              <p className="text-[11px]" style={{ color: "var(--muted)" }}>
                {t("onboardingChecklist.progress", { completed: completedCount, total: steps.length })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {steps.map((s, i) => (
              <div
                key={i}
                className="w-2 h-2 rounded-full transition-all"
                style={{ background: s.completed ? "#00d47e" : "var(--raised)" }}
              />
            ))}
          </div>
        </div>
        {/* Progress bar */}
        <div className="h-1.5 rounded-full" style={{ background: "var(--raised)" }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${(completedCount / steps.length) * 100}%`,
              background: "linear-gradient(90deg, #00d47e, #00b86a)",
            }}
          />
        </div>
      </div>

      {/* Steps */}
      <div className="divide-y" style={{ borderColor: "var(--border)" }}>
        {steps.map((step, i) => (
          <button
            key={i}
            onClick={() => !step.completed && onStepClick(i)}
            disabled={step.completed}
            className="w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors"
            style={{
              cursor: step.completed ? "default" : "pointer",
              background: "transparent",
            }}
            onMouseEnter={(e) => {
              if (!step.completed)
                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            {/* Icon / check */}
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 border-2 transition-all"
              style={{
                background: step.completed ? "#00d47e" : "var(--raised)",
                borderColor: step.completed ? "#00d47e" : "var(--border)",
              }}
            >
              {step.completed ? (
                <Check className="w-4 h-4" style={{ color: "#000" }} />
              ) : (
                <span className="text-sm leading-none">{step.emoji}</span>
              )}
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <p
                className="text-sm font-bold leading-tight"
                style={{ color: step.completed ? "var(--muted)" : "var(--text)" }}
              >
                {step.title}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--dim)" }}>
                {step.description}
              </p>
            </div>

            {!step.completed && (
              <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "var(--dim)" }} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
