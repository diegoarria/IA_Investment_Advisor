"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { profile as profileApi } from "@/lib/api";
import { useProfileStore, useAuthStore } from "@/lib/store";
import { Check, ChevronLeft, Wallet, Target, GraduationCap, ClipboardList, ShieldCheck, AlertCircle } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import { Card, SectionHeader } from "@/components/ui";

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
  const [sidebarOpen, setSidebarOpen] = useState(false);
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

  const inputWrapCls = "flex items-center rounded-xl border transition-colors focus-within:ring-2";
  const inputWrapStyle = { background: "var(--raised)", borderColor: "var(--border)" } as React.CSSProperties;
  const inputCls = "flex-1 min-w-0 py-3 text-sm outline-none bg-transparent";
  const labelCls = "block text-[12.5px] font-semibold mb-1.5";

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

        {/* Sticky header — matches /profile's eyebrow + title pattern */}
        <div className="sticky top-0 z-10 px-4 lg:px-6 py-4 flex items-center gap-3 border-b shrink-0"
             style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
          <button onClick={() => router.back()}
                  aria-label={t("profileEdit.back", { defaultValue: "Volver" })}
                  className="shrink-0 w-9 h-9 ml-9 lg:ml-0 flex items-center justify-center rounded-full border transition-colors hover:border-[var(--accent)]"
                  style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--sub)" }}>
            <ChevronLeft className="w-[18px] h-[18px]" />
          </button>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[1.1px]" style={{ color: "var(--muted)" }}>
              {t("profile.myAccount")}
            </p>
            <h1 className="text-xl lg:text-2xl font-extrabold tracking-tight truncate" style={{ color: "var(--text)" }}>
              {t("profileEdit.header")}
            </h1>
          </div>
        </div>

        {/* Scroll region — this is what the old page never had */}
        <main className="flex-1 overflow-y-auto scrollbar-thin px-4 lg:px-6 py-6">
          <div className="max-w-2xl mx-auto space-y-5 pb-28">

            {/* ── Situación financiera ── */}
            <Card padding="p-5">
              <SectionHeader
                title={t("profileEdit.financialSituation")}
                action={<Wallet className="w-[18px] h-[18px]" style={{ color: "var(--accent-l)" }} />}
              />
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className={labelCls} style={{ color: "var(--sub)" }}>
                    {t("profileEdit.monthlyIncome")}
                  </label>
                  <div className={inputWrapCls} style={inputWrapStyle}>
                    <span className="pl-3.5 pr-1 text-sm" style={{ color: "var(--muted)" }}>$</span>
                    <input type="number" inputMode="decimal" className={`${inputCls} pr-3`}
                           style={{ color: "var(--text)" }}
                           value={form.monthly_income}
                           onChange={(e) => setForm(f => ({ ...f, monthly_income: e.target.value }))}
                           placeholder="3000" />
                  </div>
                </div>
                <div>
                  <label className={labelCls} style={{ color: "var(--sub)" }}>
                    {t("profileEdit.monthlyContribution")}
                  </label>
                  <div className={inputWrapCls} style={inputWrapStyle}>
                    <span className="pl-3.5 pr-1 text-sm" style={{ color: "var(--muted)" }}>$</span>
                    <input type="number" inputMode="decimal" className={inputCls}
                           style={{ color: "var(--text)" }}
                           value={form.monthly_contribution}
                           onChange={(e) => setForm(f => ({ ...f, monthly_contribution: e.target.value }))}
                           placeholder="500" />
                    <span className="pr-3.5 pl-1 text-[11px] whitespace-nowrap" style={{ color: "var(--muted)" }}>
                      {t("profileEdit.perMonth")}
                    </span>
                  </div>
                </div>
              </div>
            </Card>

            {/* ── Plan de inversión ── */}
            <Card padding="p-5">
              <SectionHeader
                title={t("profileEdit.investmentPlan")}
                action={<Target className="w-[18px] h-[18px]" style={{ color: "var(--accent-l)" }} />}
              />
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className={labelCls} style={{ color: "var(--sub)" }}>
                    {t("profileEdit.targetWealth")}
                  </label>
                  <div className={inputWrapCls} style={inputWrapStyle}>
                    <span className="pl-3.5 pr-1 text-sm" style={{ color: "var(--muted)" }}>$</span>
                    <input type="number" inputMode="decimal" className={`${inputCls} pr-3`}
                           style={{ color: "var(--text)" }}
                           value={form.investment_goal_amount}
                           onChange={(e) => setForm(f => ({ ...f, investment_goal_amount: e.target.value }))}
                           placeholder="1000000" />
                  </div>
                </div>
                <div>
                  <label className={labelCls} style={{ color: "var(--sub)" }}>
                    {t("profileEdit.investmentHorizon")}
                  </label>
                  <div className={inputWrapCls} style={inputWrapStyle}>
                    <input type="number" inputMode="decimal" className={`${inputCls} pl-3.5`}
                           style={{ color: "var(--text)" }}
                           value={form.investment_horizon}
                           onChange={(e) => setForm(f => ({ ...f, investment_horizon: e.target.value }))}
                           placeholder="10" />
                    <span className="pr-3.5 pl-1 text-[11px] whitespace-nowrap" style={{ color: "var(--muted)" }}>
                      {t("profileEdit.years")}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-5">
                <label className={labelCls} style={{ color: "var(--sub)" }}>{t("profileEdit.investingGoal")}</label>
                <div className="grid grid-cols-3 gap-2">
                  {GOALS.map((g) => {
                    const active = form.investment_goal === g.value;
                    return (
                      <button key={g.value} onClick={() => setForm(f => ({ ...f, investment_goal: g.value }))}
                              className="p-3 rounded-xl border text-left transition-all hover:border-[var(--accent-l)]"
                              style={{
                                borderColor: active ? "var(--accent-l)" : "var(--border)",
                                background:  active ? "rgba(0,185,109,0.10)" : "var(--raised)",
                              }}>
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-lg">{g.emoji}</span>
                          {active && (
                            <span className="w-4 h-4 rounded-full flex items-center justify-center"
                                  style={{ background: "var(--accent-l)" }}>
                              <Check className="w-2.5 h-2.5 text-white" />
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] font-semibold leading-tight"
                           style={{ color: active ? "var(--accent-l)" : "var(--sub)" }}>{g.label}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </Card>

            {/* ── Nivel de conocimiento ── */}
            <Card padding="p-5">
              <SectionHeader
                title={t("profileEdit.knowledgeLevel")}
                action={<GraduationCap className="w-[18px] h-[18px]" style={{ color: "var(--accent-l)" }} />}
              />
              <div className="space-y-2 mt-3">
                {KNOWLEDGE_LEVELS.map((lvl) => {
                  const active = form.knowledge_level === lvl.value;
                  return (
                    <button key={lvl.value} onClick={() => setForm(f => ({ ...f, knowledge_level: lvl.value }))}
                            className="w-full p-3.5 rounded-xl border text-left transition-all flex items-center gap-3.5 hover:border-[var(--accent-l)]"
                            style={{
                              borderColor: active ? lvl.color : "var(--border)",
                              background:  active ? lvl.color + "12" : "var(--raised)",
                            }}>
                      <span className="text-xl shrink-0">{lvl.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold" style={{ color: active ? lvl.color : "var(--text)" }}>{lvl.label}</p>
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
            </Card>

            {/* ── Diagnóstico de inversor ── */}
            <Card padding="p-5">
              <SectionHeader
                title={t("profileEdit.diagnostic")}
                action={<ClipboardList className="w-[18px] h-[18px]" style={{ color: "var(--accent-l)" }} />}
              />
              <div className="mt-3 divide-y" style={{ borderColor: "var(--border)" }}>
                {QUIZ.map((q, i) => (
                  <div key={q.key} className={i === 0 ? "pb-6" : "py-6"} style={{ borderColor: "var(--border)" }}>
                    <p className="text-[11px] font-bold tracking-wide mb-1" style={{ color: "var(--accent-l)" }}>
                      {q.num} · {q.category}
                    </p>
                    <p className="text-sm font-semibold mb-3 leading-snug" style={{ color: "var(--text)" }}>{q.question}</p>
                    <div className="space-y-2">
                      {(["A", "B", "C", "D"] as QuizAnswer[]).map((letter) => {
                        const selected = form[q.key as keyof typeof form] === letter;
                        return (
                          <button key={letter}
                                  onClick={() => setForm(f => ({ ...f, [q.key]: letter }))}
                                  className="w-full text-left p-3 rounded-xl border transition-all flex items-start gap-3 hover:border-[var(--accent)]"
                                  style={{
                                    borderColor: selected ? "var(--accent)" : "var(--border)",
                                    background:  selected ? "rgba(0,168,94,0.10)" : "var(--raised)",
                                  }}>
                            <span className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-black"
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
            </Card>

            {/* ── Perfil resultante ── */}
            <Card padding="p-5" style={{ borderColor: riskCfg.color + "55" }}>
              <SectionHeader
                title={t("profileEdit.resultingProfile")}
                action={<ShieldCheck className="w-[18px] h-[18px]" style={{ color: riskCfg.color }} />}
              />
              <div className="flex items-center gap-4 mt-3 mb-4">
                <span className="text-3xl shrink-0">{riskCfg.emoji}</span>
                <div className="min-w-0">
                  <p className="text-base font-extrabold" style={{ color: "var(--text)" }}>
                    {t("profileEdit.investorLabel", { profile: riskCfg.label })}
                  </p>
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
            </Card>

          </div>
        </main>

        {/* Sticky save bar — always reachable, never buried at the bottom of a long scroll */}
        <div className="shrink-0 border-t px-4 lg:px-6 py-3.5"
             style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
          <div className="max-w-2xl mx-auto">
            {error && (
              <div className="mb-3 p-3 rounded-xl border text-sm flex items-center gap-2"
                   style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#ef4444" }}>
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}
            <button
              onClick={handleSave}
              disabled={!canSave || saving || saved}
              className="w-full py-3.5 rounded-xl font-bold text-[15px] transition-all"
              style={{
                background: saved ? "#16a34a" : canSave ? "var(--accent)" : "var(--raised)",
                color: canSave || saved ? "white" : "var(--muted)",
                opacity: saving ? 0.7 : 1,
                cursor: !canSave || saving || saved ? "default" : "pointer",
              }}
            >
              {saved ? t("profileEdit.saved") : saving ? t("profileEdit.saving") : t("profileEdit.saveChanges")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
