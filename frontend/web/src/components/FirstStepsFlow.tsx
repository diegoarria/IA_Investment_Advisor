"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, TrendingUp, MessageSquare, X, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

const STORAGE_KEY = "nuvos_first_steps_active";

const STEP_META = [
  {
    num: 1,
    icon: Plus,
    color: "#00a85e",
    ctaAction: "add",
  },
  {
    num: 2,
    icon: TrendingUp,
    color: "#3b82f6",
    ctaAction: "next",
  },
  {
    num: 3,
    icon: MessageSquare,
    color: "#8b5cf6",
    ctaAction: "chat",
  },
] as const;

function getSteps(t: TFunction) {
  return STEP_META.map((s) => ({
    ...s,
    title: t(`firstStepsFlow.steps.${s.num}.title`),
    desc: t(`firstStepsFlow.steps.${s.num}.desc`),
    cta: t(`firstStepsFlow.steps.${s.num}.cta`),
  }));
}

interface Props {
  onOpenAddPosition: () => void;
}

export default function FirstStepsFlow({ onOpenAddPosition }: Props) {
  const { t } = useTranslation();
  const STEPS = getSteps(t);
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1") {
      setActive(true);
    }
  }, []);

  const dismiss = () => {
    localStorage.removeItem(STORAGE_KEY);
    setActive(false);
  };

  const handleCta = (action: string) => {
    if (action === "add") {
      onOpenAddPosition();
      setStep(1);
    } else if (action === "next") {
      setStep(2);
    } else if (action === "chat") {
      dismiss();
      router.push("/chat");
    }
  };

  if (!active) return null;

  const current = STEPS[step];
  const Icon = current.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
         style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-sm rounded-2xl overflow-hidden"
           style={{ background: "var(--card)", border: "1px solid var(--border)" }}>

        {/* Progress bar */}
        <div className="flex gap-1 p-4 pb-0">
          {STEPS.map((s) => (
            <div key={s.num} className="h-1 flex-1 rounded-full transition-all duration-300"
                 style={{ background: step >= s.num - 1 ? current.color : "var(--border)" }} />
          ))}
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <span className="text-[10px] font-bold uppercase tracking-widest"
                style={{ color: current.color }}>
            {t("firstStepsFlow.stepOf", { num: current.num, total: STEPS.length })}
          </span>
          <button onClick={dismiss} className="p-1 rounded-lg hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" style={{ color: "var(--dim)" }} />
          </button>
        </div>

        {/* Content */}
        <div className="px-4 pb-5">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
               style={{ background: current.color + "15" }}>
            <Icon className="w-7 h-7" style={{ color: current.color }} />
          </div>

          <h2 className="text-lg font-bold mb-2 leading-snug" style={{ color: "var(--text)" }}>
            {current.title}
          </h2>
          <p className="text-sm leading-relaxed mb-5" style={{ color: "var(--muted)" }}>
            {current.desc}
          </p>

          <button onClick={() => handleCta(current.ctaAction)}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm text-white transition-opacity hover:opacity-90"
                  style={{ background: current.color }}>
            {current.cta}
            <ChevronRight className="w-4 h-4" />
          </button>

          <button onClick={dismiss}
                  className="w-full text-center py-2 mt-2 text-xs"
                  style={{ color: "var(--dim)" }}>
            {t("firstStepsFlow.skipGuide")}
          </button>
        </div>
      </div>
    </div>
  );
}
