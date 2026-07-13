"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { profile as profileApi } from "@/lib/api";
import { useProfileStore, useAuthStore } from "@/lib/store";
import { Check, ChevronLeft } from "lucide-react";

type QuizAnswer = "A" | "B" | "C" | "D";
type RiskTolerance = "conservative" | "moderate" | "aggressive";

function getGoals(t: TFunction) {
  return [
    { value: "house",             label: t("profileEdit.goals.house"),             emoji: "🏠" },
    { value: "car",               label: t("profileEdit.goals.car"),               emoji: "🚗" },
    { value: "passive_income",    label: t("profileEdit.goals.passive_income"),    emoji: "💸" },
    { value: "retirement",        label: t("profileEdit.goals.retirement"),        emoji: "👴" },
    { value: "financial_freedom", label: t("profileEdit.goals.financial_freedom"), emoji: "🦅" },
    { value: "long_term_wealth",  label: t("profileEdit.goals.long_term_wealth"),  emoji: "🏛️" },
  ];
}

function getKnowledgeLevels(t: TFunction) {
  return [
    { value: "B" as QuizAnswer, label: t("profileEdit.knowledgeLevels.basic.label"), emoji: "🌱", color: "#22c55e",
      desc: t("profileEdit.knowledgeLevels.basic.desc") },
    { value: "C" as QuizAnswer, label: t("profileEdit.knowledgeLevels.intermediate.label"), emoji: "📈", color: "#3b82f6",
      desc: t("profileEdit.knowledgeLevels.intermediate.desc") },
    { value: "D" as QuizAnswer, label: t("profileEdit.knowledgeLevels.advanced.label"), emoji: "🎯", color: "#a855f7",
      desc: t("profileEdit.knowledgeLevels.advanced.desc") },
  ];
}

function getQuiz(t: TFunction): { key: string; num: string; category: string; question: string; options: Record<QuizAnswer, string> }[] {
  return [
    {
      key: "q1", num: "01", category: t("profileEdit.quiz.q1.category"),
      question: t("profileEdit.quiz.q1.question"),
      options: {
        A: t("profileEdit.quiz.q1.options.A"), B: t("profileEdit.quiz.q1.options.B"),
        C: t("profileEdit.quiz.q1.options.C"), D: t("profileEdit.quiz.q1.options.D"),
      },
    },
    {
      key: "q2", num: "02", category: t("profileEdit.quiz.q2.category"),
      question: t("profileEdit.quiz.q2.question"),
      options: {
        A: t("profileEdit.quiz.q2.options.A"), B: t("profileEdit.quiz.q2.options.B"),
        C: t("profileEdit.quiz.q2.options.C"), D: t("profileEdit.quiz.q2.options.D"),
      },
    },
    {
      key: "q3", num: "03", category: t("profileEdit.quiz.q3.category"),
      question: t("profileEdit.quiz.q3.question"),
      options: {
        A: t("profileEdit.quiz.q3.options.A"), B: t("profileEdit.quiz.q3.options.B"),
        C: t("profileEdit.quiz.q3.options.C"), D: t("profileEdit.quiz.q3.options.D"),
      },
    },
    {
      key: "q4", num: "04", category: t("profileEdit.quiz.q4.category"),
      question: t("profileEdit.quiz.q4.question"),
      options: {
        A: t("profileEdit.quiz.q4.options.A"), B: t("profileEdit.quiz.q4.options.B"),
        C: t("profileEdit.quiz.q4.options.C"), D: t("profileEdit.quiz.q4.options.D"),
      },
    },
    {
      key: "q5", num: "05", category: t("profileEdit.quiz.q5.category"),
      question: t("profileEdit.quiz.q5.question"),
      options: {
        A: t("profileEdit.quiz.q5.options.A"), B: t("profileEdit.quiz.q5.options.B"),
        C: t("profileEdit.quiz.q5.options.C"), D: t("profileEdit.quiz.q5.options.D"),
      },
    },
  ];
}

function getRiskConfig(t: TFunction): Record<RiskTolerance, { label: string; emoji: string; color: string; pct: number; desc: string }> {
  return {
    conservative: { label: t("profileEdit.riskConfig.conservative.label"), emoji: "🛡️", color: "#3b82f6", pct: 33,
      desc: t("profileEdit.riskConfig.conservative.desc") },
    moderate:     { label: t("profileEdit.riskConfig.moderate.label"),    emoji: "⚖️", color: "#f59e0b", pct: 66,
      desc: t("profileEdit.riskConfig.moderate.desc") },
    aggressive:   { label: t("profileEdit.riskConfig.aggressive.label"),   emoji: "🚀", color: "#ef4444", pct: 100,
      desc: t("profileEdit.riskConfig.aggressive.desc") },
  };
}

function calculateRisk(answers: Record<string, string>): RiskTolerance {
  const m: Record<QuizAnswer, number> = { A: 1, B: 2, C: 3, D: 4 };
  const vals = Object.values(answers).filter((v): v is QuizAnswer => "ABCD".includes(v));
  if (!vals.length) return "moderate";
  const avg = vals.reduce((s, v) => s + m[v], 0) / vals.length;
  return avg <= 2 ? "conservative" : avg <= 3 ? "moderate" : "aggressive";
}

export default function EditProfilePage() {
  const router = useRouter();
  const { t } = useTranslation();
  const GOALS = getGoals(t);
  const KNOWLEDGE_LEVELS = getKnowledgeLevels(t);
  const QUIZ = getQuiz(t);
  const RISK_CONFIG = getRiskConfig(t);
  const { profile, setProfile } = useProfileStore();
  const { isAuthenticated, authRestoring } = useAuthStore();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const qa = (profile?.quiz_answers ?? {}) as Record<string, string>;

  const [form, setForm] = useState({
    monthly_income:         profile?.monthly_income ?? "",
    monthly_contribution:   profile?.monthly_contribution ?? "",
    investment_goal:        profile?.investment_goal ?? "",
    investment_goal_amount: profile?.investment_goal_amount ?? "",
    investment_horizon:     profile?.investment_horizon ?? "",
    knowledge_level:        (profile?.knowledge_level ?? qa.q3 ?? "") as QuizAnswer | "",
    q1: (qa.q1 ?? "") as QuizAnswer | "",
    q2: (qa.q2 ?? "") as QuizAnswer | "",
    q3: (qa.q3 ?? "") as QuizAnswer | "",
    q4: (qa.q4 ?? "") as QuizAnswer | "",
    q5: (qa.q5 ?? "") as QuizAnswer | "",
  });

  useEffect(() => { if (!authRestoring && !isAuthenticated) router.push("/"); }, [isAuthenticated, authRestoring]);
  if (!authRestoring && !isAuthenticated) return null;

  const quizAnswers = { q1: form.q1, q2: form.q2, q3: form.q3, q4: form.q4, q5: form.q5 };
  const calculated  = calculateRisk(quizAnswers);
  const riskCfg     = RISK_CONFIG[calculated];

  const canSave = !!form.monthly_income && !!form.monthly_contribution;

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true); setError("");
    try {
      const updates = {
        monthly_income:         form.monthly_income,
        monthly_contribution:   form.monthly_contribution,
        investment_goal:        form.investment_goal || null,
        investment_goal_amount: form.investment_goal_amount || null,
        investment_horizon:     form.investment_horizon || null,
        knowledge_level:        form.knowledge_level || null,
        risk_tolerance:         calculated,
        quiz_answers:           quizAnswers,
      };
      await profileApi.update(updates);
      setProfile({ ...profile!, ...updates });
      setSaved(true);
      setTimeout(() => router.back(), 1200);
    } catch {
      setError(t("profileEdit.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full px-4 py-3 rounded-xl text-sm outline-none transition-colors";
  const inputStyle = { background: "var(--raised)", border: "1px solid var(--border)", color: "var(--text)" } as React.CSSProperties;
  const labelCls = "block text-xs font-semibold mb-1.5 uppercase tracking-wide";

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b"
           style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
        <button onClick={() => router.back()}
                className="p-1.5 rounded-lg hover:bg-white/5 transition-colors">
          <ChevronLeft className="w-5 h-5" style={{ color: "var(--text)" }} />
        </button>
        <h1 className="text-base font-bold" style={{ color: "var(--text)" }}>{t("profileEdit.header")}</h1>
      </div>

      <div className="max-w-xl mx-auto px-4 py-6 space-y-10">

        {/* ── Situación financiera ── */}
        <section>
          <p className={labelCls} style={{ color: "var(--accent-l)" }}>{t("profileEdit.financialSituation")}</p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm mb-1.5" style={{ color: "var(--sub)" }}>
                {t("profileEdit.monthlyIncome")}
              </label>
              <div className="flex items-center rounded-xl border overflow-hidden"
                   style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
                <span className="px-3 text-sm" style={{ color: "var(--muted)" }}>$</span>
                <input type="number" className="flex-1 py-3 pr-4 text-sm outline-none bg-transparent"
                       style={{ color: "var(--text)" }}
                       value={form.monthly_income}
                       onChange={(e) => setForm(f => ({ ...f, monthly_income: e.target.value }))}
                       placeholder="3000" />
              </div>
            </div>
            <div>
              <label className="block text-sm mb-1.5" style={{ color: "var(--sub)" }}>
                {t("profileEdit.monthlyContribution")}
              </label>
              <div className="flex items-center rounded-xl border overflow-hidden"
                   style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
                <span className="px-3 text-sm" style={{ color: "var(--muted)" }}>$</span>
                <input type="number" className="flex-1 py-3 text-sm outline-none bg-transparent"
                       style={{ color: "var(--text)" }}
                       value={form.monthly_contribution}
                       onChange={(e) => setForm(f => ({ ...f, monthly_contribution: e.target.value }))}
                       placeholder="500" />
                <span className="px-3 text-xs" style={{ color: "var(--muted)" }}>{t("profileEdit.perMonth")}</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Plan de inversión ── */}
        <section>
          <p className={labelCls} style={{ color: "var(--accent-l)" }}>{t("profileEdit.investmentPlan")}</p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm mb-1.5" style={{ color: "var(--sub)" }}>
                {t("profileEdit.targetWealth")}
              </label>
              <div className="flex items-center rounded-xl border overflow-hidden"
                   style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
                <span className="px-3 text-sm" style={{ color: "var(--muted)" }}>$</span>
                <input type="number" className="flex-1 py-3 pr-4 text-sm outline-none bg-transparent"
                       style={{ color: "var(--text)" }}
                       value={form.investment_goal_amount}
                       onChange={(e) => setForm(f => ({ ...f, investment_goal_amount: e.target.value }))}
                       placeholder="1000000" />
              </div>
            </div>
            <div>
              <label className="block text-sm mb-1.5" style={{ color: "var(--sub)" }}>
                {t("profileEdit.investmentHorizon")}
              </label>
              <div className="flex items-center rounded-xl border overflow-hidden"
                   style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
                <input type="number" className="flex-1 px-4 py-3 text-sm outline-none bg-transparent"
                       style={{ color: "var(--text)" }}
                       value={form.investment_horizon}
                       onChange={(e) => setForm(f => ({ ...f, investment_horizon: e.target.value }))}
                       placeholder="10" />
                <span className="px-3 text-xs" style={{ color: "var(--muted)" }}>{t("profileEdit.years")}</span>
              </div>
            </div>

            <div>
              <label className="block text-sm mb-2" style={{ color: "var(--sub)" }}>{t("profileEdit.investingGoal")}</label>
              <div className="grid grid-cols-3 gap-2">
                {GOALS.map((g) => {
                  const active = form.investment_goal === g.value;
                  return (
                    <button key={g.value} onClick={() => setForm(f => ({ ...f, investment_goal: g.value }))}
                            className="p-3 rounded-2xl border-2 text-left transition-all"
                            style={{
                              borderColor: active ? "var(--accent-l)" : "var(--border)",
                              background:  active ? "rgba(0,185,109,0.10)" : "var(--raised)",
                            }}>
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-xl">{g.emoji}</span>
                        {active && (
                          <span className="w-4 h-4 rounded-full flex items-center justify-center"
                                style={{ background: "var(--accent-l)" }}>
                            <Check className="w-2.5 h-2.5 text-white" />
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-700 leading-tight"
                         style={{ color: active ? "var(--accent-l)" : "var(--sub)" }}>{g.label}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ── Nivel de conocimiento ── */}
        <section>
          <p className={labelCls} style={{ color: "var(--accent-l)" }}>{t("profileEdit.knowledgeLevel")}</p>
          <div className="space-y-2">
            {KNOWLEDGE_LEVELS.map((lvl) => {
              const active = form.knowledge_level === lvl.value;
              return (
                <button key={lvl.value} onClick={() => setForm(f => ({ ...f, knowledge_level: lvl.value }))}
                        className="w-full p-4 rounded-2xl border-2 text-left transition-all flex items-center gap-4"
                        style={{
                          borderColor: active ? lvl.color : "var(--border)",
                          background:  active ? lvl.color + "12" : "var(--raised)",
                        }}>
                  <span className="text-2xl">{lvl.emoji}</span>
                  <div className="flex-1">
                    <p className="text-sm font-800" style={{ color: active ? lvl.color : "var(--text)" }}>{lvl.label}</p>
                    <p className="text-xs mt-0.5 leading-snug" style={{ color: "var(--sub)" }}>{lvl.desc}</p>
                  </div>
                  {active && (
                    <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                          style={{ background: lvl.color }}>
                      <Check className="w-3 h-3 text-white" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Diagnóstico de inversor ── */}
        <section>
          <p className={labelCls} style={{ color: "var(--accent-l)" }}>{t("profileEdit.diagnostic")}</p>
          <div className="space-y-8">
            {QUIZ.map((q) => (
              <div key={q.key}>
                <p className="text-[11px] font-700 tracking-wide mb-1" style={{ color: "var(--accent-l)" }}>
                  {q.num} · {q.category}
                </p>
                <p className="text-sm font-600 mb-3 leading-snug" style={{ color: "var(--text)" }}>{q.question}</p>
                <div className="space-y-2">
                  {(["A", "B", "C", "D"] as QuizAnswer[]).map((letter) => {
                    const selected = form[q.key as keyof typeof form] === letter;
                    return (
                      <button key={letter}
                              onClick={() => setForm(f => ({ ...f, [q.key]: letter }))}
                              className="w-full text-left p-3.5 rounded-2xl border-2 transition-all flex items-start gap-3"
                              style={{
                                borderColor: selected ? "var(--accent)" : "var(--border)",
                                background:  selected ? "rgba(0,168,94,0.10)" : "var(--raised)",
                              }}>
                        <span className="shrink-0 w-7 h-7 rounded-xl flex items-center justify-center text-xs font-black"
                              style={{
                                background: selected ? "var(--accent)" : "var(--border)",
                                color: selected ? "#fff" : "var(--muted)",
                              }}>
                          {letter}
                        </span>
                        <span className="text-sm leading-snug pt-0.5"
                              style={{ color: selected ? "var(--text)" : "var(--sub)" }}>
                          {q.options[letter]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Perfil resultante ── */}
        <section>
          <p className={labelCls} style={{ color: "var(--accent-l)" }}>{t("profileEdit.resultingProfile")}</p>
          <div className="p-5 rounded-2xl border-2"
               style={{ borderColor: riskCfg.color + "55", background: "var(--raised)" }}>
            <div className="flex items-center gap-4 mb-4">
              <span className="text-4xl">{riskCfg.emoji}</span>
              <div>
                <p className="text-lg font-800" style={{ color: "var(--text)" }}>{t("profileEdit.investorLabel", { profile: riskCfg.label })}</p>
                <p className="text-xs leading-snug mt-0.5" style={{ color: "var(--muted)" }}>{riskCfg.desc}</p>
              </div>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
              <div className="h-full rounded-full transition-all duration-500"
                   style={{ width: `${riskCfg.pct}%`, background: riskCfg.color }} />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px]" style={{ color: "var(--dim)" }}>{t("profileEdit.lowRisk")}</span>
              <span className="text-[10px]" style={{ color: "var(--dim)" }}>{t("profileEdit.highRisk")}</span>
            </div>
          </div>
        </section>

        {/* ── Error ── */}
        {error && (
          <div className="p-4 rounded-2xl border text-sm"
               style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#ef4444" }}>
            {error}
          </div>
        )}

        {/* ── Save button ── */}
        <button
          onClick={handleSave}
          disabled={!canSave || saving || saved}
          className="w-full py-4 rounded-2xl font-700 text-base transition-all"
          style={{
            background: saved ? "#16a34a" : canSave ? "var(--accent)" : "var(--raised)",
            color: canSave || saved ? "white" : "var(--muted)",
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saved ? t("profileEdit.saved") : saving ? t("profileEdit.saving") : t("profileEdit.saveChanges")}
        </button>

        <div className="h-8" />
      </div>
    </div>
  );
}
