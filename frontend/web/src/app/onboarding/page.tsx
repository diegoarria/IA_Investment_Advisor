"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import { profile as profileApi } from "@/lib/api";
import { useProfileStore, useAuthStore, useChatStore, useLanguageStore } from "@/lib/store";
import { ChevronRight, ChevronLeft } from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────
type QuizAnswer  = "A" | "B" | "C" | "D";
type RiskTolerance = "conservative" | "moderate" | "aggressive";

// ─── Static data (language-neutral metadata; labels resolved via t() at render) ─
const GOALS = [
  { value: "house",             labelKey: "onboarding.goals.house",            emoji: "🏠" },
  { value: "car",               labelKey: "onboarding.goals.car",              emoji: "🚗" },
  { value: "passive_income",    labelKey: "onboarding.goals.passiveIncome",    emoji: "💸" },
  { value: "retirement",        labelKey: "onboarding.goals.retirement",       emoji: "👴" },
  { value: "financial_freedom", labelKey: "onboarding.goals.financialFreedom",emoji: "🦅" },
  { value: "long_term_wealth",  labelKey: "onboarding.goals.longTermWealth",  emoji: "🏛️" },
];

const KNOWLEDGE_LEVELS = [
  { value: "B" as QuizAnswer, labelKey: "onboarding.knowledge.basic.label",        descKey: "onboarding.knowledge.basic.desc",        emoji: "🌱", color: "#22c55e" },
  { value: "C" as QuizAnswer, labelKey: "onboarding.knowledge.intermediate.label", descKey: "onboarding.knowledge.intermediate.desc", emoji: "📈", color: "#3b82f6" },
  { value: "D" as QuizAnswer, labelKey: "onboarding.knowledge.advanced.label",     descKey: "onboarding.knowledge.advanced.desc",     emoji: "🎯", color: "#a855f7" },
];

const RISK_CONFIG: Record<RiskTolerance, { labelKey: string; descKey: string; emoji: string; color: string; pct: number }> = {
  conservative: { labelKey: "onboarding.risk.conservative.label", descKey: "onboarding.risk.conservative.desc", emoji: "🛡️", color: "#3b82f6", pct: 33 },
  moderate:     { labelKey: "onboarding.risk.moderate.label",     descKey: "onboarding.risk.moderate.desc",     emoji: "⚖️", color: "#f59e0b", pct: 66 },
  aggressive:   { labelKey: "onboarding.risk.aggressive.label",   descKey: "onboarding.risk.aggressive.desc",   emoji: "🚀", color: "#ef4444", pct: 100 },
};

const QUIZ_Q1 = {
  categoryKey: "onboarding.quiz.q1.category",
  questionKey: "onboarding.quiz.q1.question",
  optionKeys: { A: "onboarding.quiz.q1.options.A", B: "onboarding.quiz.q1.options.B", C: "onboarding.quiz.q1.options.C", D: "onboarding.quiz.q1.options.D" } as Record<QuizAnswer, string>,
};

const QUIZ_Q4 = {
  categoryKey: "onboarding.quiz.q4.category",
  questionKey: "onboarding.quiz.q4.question",
  optionKeys: { A: "onboarding.quiz.q4.options.A", B: "onboarding.quiz.q4.options.B", C: "onboarding.quiz.q4.options.C", D: "onboarding.quiz.q4.options.D" } as Record<QuizAnswer, string>,
};

const QUIZ_LABEL_KEYS = {
  q1: { A: "onboarding.quiz.q1.labels.A", B: "onboarding.quiz.q1.labels.B", C: "onboarding.quiz.q1.labels.C", D: "onboarding.quiz.q1.labels.D" } as Record<QuizAnswer, string>,
  q4: { A: "onboarding.quiz.q4.labels.A", B: "onboarding.quiz.q4.labels.B", C: "onboarding.quiz.q4.labels.C", D: "onboarding.quiz.q4.labels.D" } as Record<QuizAnswer, string>,
};

const COUNTRIES = [
  { value: "MX",    flag: "🇲🇽", labelKey: "onboarding.countries.mx" },
  { value: "US",    flag: "🇺🇸", labelKey: "onboarding.countries.us" },
  { value: "CO",    flag: "🇨🇴", labelKey: "onboarding.countries.co" },
  { value: "AR",    flag: "🇦🇷", labelKey: "onboarding.countries.ar" },
  { value: "VE",    flag: "🇻🇪", labelKey: "onboarding.countries.ve" },
  { value: "PE",    flag: "🇵🇪", labelKey: "onboarding.countries.pe" },
  { value: "CL",    flag: "🇨🇱", labelKey: "onboarding.countries.cl" },
  { value: "ES",    flag: "🇪🇸", labelKey: "onboarding.countries.es" },
  { value: "OTHER", flag: "🌎", labelKey: "onboarding.countries.other" },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────
function calculateRisk(q1: string, q4: string): RiskTolerance {
  const m: Record<QuizAnswer, number> = { A: 1, B: 2, C: 3, D: 4 };
  const vals = [q1, q4].filter((v): v is QuizAnswer => "ABCD".includes(v));
  if (!vals.length) return "moderate";
  const avg = vals.reduce((s, v) => s + m[v], 0) / vals.length;
  return avg <= 2 ? "conservative" : avg <= 3 ? "moderate" : "aggressive";
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

// Adds thousand separators as the user types, while keeping the underlying
// state a plain parseable numeric string (no commas).
function formatWithCommas(raw: string): string {
  if (!raw) return "";
  const [intPart, decPart] = raw.split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decPart !== undefined ? `${withCommas}.${decPart}` : withCommas;
}

function yearsToGoal(pmt: number, goal: number, annualRate: number): number | null {
  if (pmt <= 0 || goal <= 0) return null;
  const r = annualRate / 12;
  const n = Math.log(1 + (goal * r) / pmt) / Math.log(1 + r);
  if (!isFinite(n) || n <= 0) return null;
  return Math.ceil(n / 12);
}

// ─── Form State ────────────────────────────────────────────────────────────────
type FormState = {
  name: string;
  birth_day: string;
  birth_month: string;
  birth_year: string;
  country: string;
  knowledge_level: QuizAnswer | "";
  monthly_income: string;
  monthly_contribution: string;
  initial_capital: string;
  investment_goal_amount: string;
  investment_horizon: string;
  investment_goal: string;
  q1: QuizAnswer | "";
  q4: QuizAnswer | "";
  has_broker: "yes" | "no" | "";
  broker_name: string;
  has_investments: "yes" | "no" | "";
  investing_knowledge: string;
};

// ─── Component ─────────────────────────────────────────────────────────────────
export default function OnboardingPage() {
  const { t } = useTranslation();
  const router  = useRouter();
  const { setProfile }  = useProfileStore();
  const { isAuthenticated, authRestoring, clearAuth } = useAuthStore();
  const { language } = useLanguageStore();

  const MONTHS = t("onboarding.months", { returnObjects: true }) as string[];

  const [step, setStep]     = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");
  const [acceptedTerms, setAcceptedTerms]           = useState(false);
  const [acceptedDisclaimer, setAcceptedDisclaimer] = useState(false);

  const [form, setForm] = useState<FormState>({
    name: "", birth_day: "", birth_month: "", birth_year: "", country: "",
    knowledge_level: "", monthly_income: "", monthly_contribution: "", initial_capital: "",
    investment_goal_amount: "", investment_horizon: "", investment_goal: "",
    q1: "", q4: "", has_broker: "", broker_name: "", has_investments: "", investing_knowledge: "",
  });

  useEffect(() => { if (!authRestoring && !isAuthenticated) router.push("/"); }, [isAuthenticated, authRestoring]);

  // Guard: if this account already has a profile, never show onboarding again.
  // (This used to also short-circuit on a global "nuvos_ob" localStorage flag,
  // which stayed set from whichever account last onboarded on this device —
  // silently bouncing a genuinely new second account away from onboarding.
  // The profileApi.get() check below is the real, per-account source of truth.)
  useEffect(() => {
    profileApi.get().then(() => { window.location.href = "/home"; }).catch(() => {});
  }, []);
  if (!authRestoring && !isAuthenticated) return null;

  // ── Derived values ───────────────────────────────────────────────────────────
  const firstName  = form.name.trim().split(" ")[0];
  const calculated = calculateRisk(form.q1, form.q4);
  const riskCfg    = RISK_CONFIG[calculated];
  const levelInfo  = KNOWLEDGE_LEVELS.find(l => l.value === form.knowledge_level);
  const goalInfo   = GOALS.find(g => g.value === form.investment_goal);

  const birthDateValid = (() => {
    const d = parseInt(form.birth_day), m = parseInt(form.birth_month), y = parseInt(form.birth_year);
    if (!d || !m || !y) return false;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return false;
    const ageMs = Date.now() - dt.getTime();
    return ageMs >= 18 * 365.25 * 86_400_000 && ageMs <= 90 * 365.25 * 86_400_000;
  })();

  const birthDateStr = birthDateValid
    ? `${form.birth_year}-${form.birth_month.padStart(2,"0")}-${form.birth_day.padStart(2,"0")}`
    : "";

  const userAge = birthDateStr
    ? Math.floor((Date.now() - new Date(birthDateStr).getTime()) / (365.25 * 86_400_000))
    : 0;

  // ── Quiz option renderer ─────────────────────────────────────────────────────
  const renderQuiz = (q: typeof QUIZ_Q1, field: "q1" | "q4") => (
    <div className="space-y-2.5">
      {(["A","B","C","D"] as QuizAnswer[]).map((letter) => {
        const active = form[field] === letter;
        return (
          <button key={letter} onClick={() => setForm(f => ({ ...f, [field]: letter }))}
                  className="w-full text-left p-4 rounded-2xl border-2 transition-all flex items-start gap-3"
                  style={{
                    borderColor: active ? "var(--accent)" : "var(--border)",
                    background:  active ? "rgba(0,168,94,0.10)" : "var(--raised)",
                  }}>
            <span className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black"
                  style={{ background: active ? "var(--accent)" : "var(--border)", color: active ? "#fff" : "var(--muted)" }}>
              {letter}
            </span>
            <span className="text-sm leading-snug pt-0.5" style={{ color: active ? "var(--text)" : "var(--sub)" }}>
              {t(q.optionKeys[letter])}
            </span>
          </button>
        );
      })}
    </div>
  );

  // ── Steps ────────────────────────────────────────────────────────────────────
  const pmt        = Math.max(parseFloat(form.monthly_contribution) || 0, 0);
  const goalAmt    = Math.max(parseFloat(form.investment_goal_amount) || 0, 1);
  const horizonYrs = Math.max(parseInt(form.investment_horizon) || 10, 1);
  const annualRate = calculated === "conservative" ? 0.07 : calculated === "moderate" ? 0.10 : 0.12;
  const rateLabel  = calculated === "conservative" ? "7%" : calculated === "moderate" ? "10%" : "12%";
  const r          = annualRate / 12;
  const fvAt       = (months: number) => pmt > 0 ? Math.round(pmt * ((Math.pow(1 + r, months) - 1) / r)) : 0;
  const fvHorizon  = fvAt(horizonYrs * 12);
  const fvPlus10   = fvAt((horizonYrs + 10) * 12);
  const extraGain  = fvPlus10 - fvHorizon;
  const extraPct   = fvHorizon > 0 ? Math.round((extraGain / fvHorizon) * 100) : 0;
  const maxFV      = Math.max(fvPlus10, goalAmt);
  const goalLinePct = Math.min((goalAmt / maxFV) * 100, 100);
  const yrsNeeded  = yearsToGoal(pmt, goalAmt, annualRate);

  const goalStatusLine = fvHorizon >= goalAmt
    ? t("onboarding.step8.goalReached", { years: horizonYrs })
    : yrsNeeded
    ? t("onboarding.step8.goalNeedsYears", { years: yrsNeeded, amount: fmtMoney(goalAmt) })
    : t("onboarding.step8.goalIncreaseContribution", { years: horizonYrs, amount: fmtMoney(fvHorizon) });

  const STEPS = [
    // 0 — Nombre + fecha de nacimiento + país
    {
      subtitle: t("onboarding.step0.subtitle"),
      title: t("onboarding.step0.title"),
      valid: () => form.name.trim().length >= 2 && birthDateValid && !!form.country,
      content: (
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              {t("onboarding.step0.nameLabel")}
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full rounded-xl border px-4 py-3 text-sm outline-none"
              placeholder={t("onboarding.step0.namePlaceholder")}
              autoFocus
              style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
            />
            <p className="text-xs mt-1.5" style={{ color: "var(--dim)" }}>
              {t("onboarding.step0.nameHint")}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              {t("onboarding.step0.birthDateLabel")}
            </label>
            <div className="grid grid-cols-3 gap-2">
              <select value={form.birth_day}
                      onChange={(e) => setForm(f => ({ ...f, birth_day: e.target.value }))}
                      className="rounded-xl border px-3 py-3 text-sm outline-none appearance-none"
                      style={{ background: "var(--raised)", borderColor: "var(--border)", color: form.birth_day ? "var(--text)" : "var(--muted)" }}>
                <option value="">{t("onboarding.step0.day")}</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                  <option key={d} value={String(d)}>{d}</option>
                ))}
              </select>
              <select value={form.birth_month}
                      onChange={(e) => setForm(f => ({ ...f, birth_month: e.target.value }))}
                      className="rounded-xl border px-3 py-3 text-sm outline-none appearance-none"
                      style={{ background: "var(--raised)", borderColor: "var(--border)", color: form.birth_month ? "var(--text)" : "var(--muted)" }}>
                <option value="">{t("onboarding.step0.month")}</option>
                {MONTHS.map((m, i) => (
                  <option key={i + 1} value={String(i + 1)}>{m}</option>
                ))}
              </select>
              <select value={form.birth_year}
                      onChange={(e) => setForm(f => ({ ...f, birth_year: e.target.value }))}
                      className="rounded-xl border px-3 py-3 text-sm outline-none appearance-none"
                      style={{ background: "var(--raised)", borderColor: "var(--border)", color: form.birth_year ? "var(--text)" : "var(--muted)" }}>
                <option value="">{t("onboarding.step0.year")}</option>
                {Array.from({ length: 73 }, (_, i) => 2006 - i).map(y => (
                  <option key={y} value={String(y)}>{y}</option>
                ))}
              </select>
            </div>
            <p className="text-xs mt-1.5" style={{ color: "var(--dim)" }}>
              {t("onboarding.step0.birthDateHint")}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              {t("onboarding.step0.countryLabel")}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {COUNTRIES.map((c) => {
                const active = form.country === c.value;
                return (
                  <button key={c.value}
                          onClick={() => setForm(f => ({ ...f, country: c.value }))}
                          className="px-3 py-2.5 rounded-xl border-2 text-xs font-semibold text-left transition-all"
                          style={{
                            borderColor: active ? "var(--accent)" : "var(--border)",
                            background: active ? "rgba(0,168,94,0.10)" : "var(--raised)",
                            color: active ? "var(--accent-l)" : "var(--sub)",
                          }}>
                    {c.flag} {t(c.labelKey)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ),
    },

    // 1 — Nivel de conocimiento
    {
      subtitle: t("onboarding.step1.subtitle"),
      title: firstName ? t("onboarding.step1.titleNamed", { name: firstName }) : t("onboarding.step1.title"),
      valid: () => !!form.knowledge_level,
      content: (
        <div className="space-y-3">
          {KNOWLEDGE_LEVELS.map((lvl) => {
            const active = form.knowledge_level === lvl.value;
            return (
              <button key={lvl.value}
                      onClick={() => setForm(f => ({ ...f, knowledge_level: lvl.value }))}
                      className="w-full text-left p-4 rounded-2xl border-2 transition-all"
                      style={{
                        borderColor: active ? lvl.color : "var(--border)",
                        background:  active ? lvl.color + "12" : "var(--raised)",
                      }}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{lvl.emoji}</span>
                  <div className="flex-1">
                    <p className="text-sm font-black" style={{ color: active ? lvl.color : "var(--text)" }}>
                      {t(lvl.labelKey)}
                    </p>
                    <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "var(--sub)" }}>
                      {t(lvl.descKey)}
                    </p>
                  </div>
                  {active && (
                    <span className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center"
                          style={{ background: lvl.color }}>
                      <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                        <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ),
    },

    // 2 — Metas financieras (números)
    {
      subtitle: t("onboarding.step2.subtitle"),
      title: t("onboarding.step2.title"),
      valid: () => pmt > 0 && parseFloat(form.investment_goal_amount) > 0 && horizonYrs >= 1,
      content: (
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              {t("onboarding.step2.incomeLabel")}
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold" style={{ color: "var(--muted)" }}>$</span>
              <input type="text" inputMode="decimal"
                     value={formatWithCommas(form.monthly_income)}
                     onChange={(e) => { const raw = e.target.value.replace(/,/g, ""); if (raw === "" || /^\d*\.?\d*$/.test(raw)) setForm(f => ({ ...f, monthly_income: raw })); }}
                     className="w-full rounded-xl border pl-8 pr-16 py-3 text-sm outline-none"
                     placeholder="2,000"
                     style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold" style={{ color: "var(--muted)" }}>{t("onboarding.step2.perMonth")}</span>
            </div>
            <p className="text-xs mt-1.5" style={{ color: "var(--dim)" }}>
              {t("onboarding.step2.incomeHint")}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              {t("onboarding.step2.capitalLabel")}
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold" style={{ color: "var(--muted)" }}>$</span>
              <input type="text" inputMode="decimal"
                     value={formatWithCommas(form.initial_capital)}
                     onChange={(e) => { const raw = e.target.value.replace(/,/g, ""); if (raw === "" || /^\d*\.?\d*$/.test(raw)) setForm(f => ({ ...f, initial_capital: raw })); }}
                     className="w-full rounded-xl border pl-8 pr-4 py-3 text-sm outline-none"
                     placeholder={t("onboarding.step2.capitalPlaceholder")}
                     style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
              />
            </div>
            <p className="text-xs mt-1.5" style={{ color: "var(--dim)" }}>
              {t("onboarding.step2.capitalHint")}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              {t("onboarding.step2.contributionLabel")}
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold" style={{ color: "var(--muted)" }}>$</span>
              <input type="text" inputMode="decimal"
                     value={formatWithCommas(form.monthly_contribution)}
                     onChange={(e) => { const raw = e.target.value.replace(/,/g, ""); if (raw === "" || /^\d*\.?\d*$/.test(raw)) setForm(f => ({ ...f, monthly_contribution: raw })); }}
                     className="w-full rounded-xl border pl-8 pr-16 py-3 text-sm outline-none"
                     placeholder="500"
                     style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold" style={{ color: "var(--muted)" }}>{t("onboarding.step2.perMonth")}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              {t("onboarding.step2.goalAmountLabel")}
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold" style={{ color: "var(--muted)" }}>$</span>
              <input type="text" inputMode="decimal"
                     value={formatWithCommas(form.investment_goal_amount)}
                     onChange={(e) => { const raw = e.target.value.replace(/,/g, ""); if (raw === "" || /^\d*\.?\d*$/.test(raw)) setForm(f => ({ ...f, investment_goal_amount: raw })); }}
                     className="w-full rounded-xl border pl-8 pr-4 py-3 text-sm outline-none"
                     placeholder="1,000,000"
                     style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
              />
            </div>
            <p className="text-xs mt-1.5" style={{ color: "var(--dim)" }}>
              {t("onboarding.step2.goalAmountHint")}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              {t("onboarding.step2.horizonLabel")}
            </label>
            <div className="relative">
              <input type="number" min={1} max={50}
                     value={form.investment_horizon}
                     onChange={(e) => setForm(f => ({ ...f, investment_horizon: e.target.value }))}
                     className="w-full rounded-xl border px-4 pr-16 py-3 text-sm outline-none"
                     placeholder="10"
                     style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold" style={{ color: "var(--muted)" }}>{t("onboarding.step2.years")}</span>
            </div>
          </div>
        </div>
      ),
    },

    // 3 — Meta al invertir (tipo)
    {
      subtitle: t("onboarding.step3.subtitle"),
      title: t("onboarding.step3.title"),
      valid: () => !!form.investment_goal,
      content: (
        <div className="grid grid-cols-2 gap-2.5">
          {GOALS.map((g) => {
            const active = form.investment_goal === g.value;
            return (
              <button key={g.value}
                      onClick={() => setForm(f => ({ ...f, investment_goal: g.value }))}
                      className="p-4 rounded-2xl border-2 text-left transition-all"
                      style={{
                        borderColor: active ? "var(--accent)" : "var(--border)",
                        background:  active ? "rgba(0,168,94,0.10)" : "var(--raised)",
                      }}>
                <div className="flex items-start justify-between mb-2">
                  <span className="text-2xl">{g.emoji}</span>
                  {active && (
                    <span className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center"
                          style={{ background: "var(--accent)" }}>
                      <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                        <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                  )}
                </div>
                <p className="text-xs font-bold leading-snug"
                   style={{ color: active ? "var(--accent-l)" : "var(--sub)" }}>
                  {t(g.labelKey)}
                </p>
              </button>
            );
          })}
        </div>
      ),
    },

    // 4 — Quiz q1
    {
      subtitle: t(QUIZ_Q1.categoryKey),
      title: t(QUIZ_Q1.questionKey),
      valid: () => !!form.q1,
      content: renderQuiz(QUIZ_Q1, "q1"),
    },

    // 5 — Quiz q4
    {
      subtitle: t(QUIZ_Q4.categoryKey),
      title: t(QUIZ_Q4.questionKey),
      valid: () => !!form.q4,
      content: renderQuiz(QUIZ_Q4, "q4"),
    },

    // 6 — Experiencia previa: broker + inversiones
    {
      subtitle: t("onboarding.step6.subtitle"),
      title: firstName ? t("onboarding.step6.titleNamed", { name: firstName }) : t("onboarding.step6.title"),
      valid: () => !!form.has_broker && !!form.has_investments,
      content: (
        <div className="space-y-6">
          {/* Broker */}
          <div>
            <p className="text-sm font-bold mb-3" style={{ color: "var(--text)" }}>
              {t("onboarding.step6.brokerQuestion")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {([
                { val: "yes" as const, label: t("onboarding.step6.brokerYes"), emoji: "✅" },
                { val: "no"  as const, label: t("onboarding.step6.brokerNo"),  emoji: "🚀" },
              ]).map(({ val, label, emoji }) => {
                const active = form.has_broker === val;
                return (
                  <button key={val}
                          onClick={() => setForm(f => ({ ...f, has_broker: val, broker_name: val === "no" ? "" : f.broker_name }))}
                          className="p-4 rounded-2xl border-2 text-center transition-all"
                          style={{
                            borderColor: active ? "var(--accent)" : "var(--border)",
                            background: active ? "rgba(0,168,94,0.10)" : "var(--raised)",
                          }}>
                    <div className="text-2xl mb-1">{emoji}</div>
                    <p className="text-sm font-bold" style={{ color: active ? "var(--accent-l)" : "var(--sub)" }}>{label}</p>
                  </button>
                );
              })}
            </div>
            {form.has_broker === "yes" && (
              <div className="mt-3">
                <input
                  value={form.broker_name}
                  onChange={(e) => setForm(f => ({ ...f, broker_name: e.target.value }))}
                  className="w-full rounded-xl border px-4 py-3 text-sm outline-none"
                  placeholder={t("onboarding.step6.brokerNamePlaceholder")}
                  style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                />
                <p className="text-xs mt-1.5" style={{ color: "var(--dim)" }}>
                  {t("onboarding.step6.brokerNameHint")}
                </p>
              </div>
            )}
          </div>

          {/* Inversiones previas */}
          <div>
            <p className="text-sm font-bold mb-3" style={{ color: "var(--text)" }}>
              {t("onboarding.step6.investmentsQuestion")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {([
                { val: "yes" as const, label: t("onboarding.step6.investmentsYes"), emoji: "📈" },
                { val: "no"  as const, label: t("onboarding.step6.investmentsNo"),  emoji: "🌱" },
              ]).map(({ val, label, emoji }) => {
                const active = form.has_investments === val;
                return (
                  <button key={val}
                          onClick={() => setForm(f => ({ ...f, has_investments: val }))}
                          className="p-4 rounded-2xl border-2 text-center transition-all"
                          style={{
                            borderColor: active ? "var(--accent)" : "var(--border)",
                            background: active ? "rgba(0,168,94,0.10)" : "var(--raised)",
                          }}>
                    <div className="text-2xl mb-1">{emoji}</div>
                    <p className="text-sm font-bold" style={{ color: active ? "var(--accent-l)" : "var(--sub)" }}>{label}</p>
                  </button>
                );
              })}
            </div>
            {form.has_investments === "no" && (
              <div className="mt-3 rounded-xl px-4 py-3 flex items-start gap-3"
                   style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)" }}>
                <span className="text-xl shrink-0">🎯</span>
                <p className="text-xs leading-relaxed" style={{ color: "#22c55e" }}>
                  <strong>{t("onboarding.step6.firstTimeTitle")}</strong> {t("onboarding.step6.firstTimeDesc")}
                </p>
              </div>
            )}
          </div>
        </div>
      ),
    },

    // 6.5 — Qué ha escuchado sobre invertir (abierta, opcional)
    {
      subtitle: t("onboarding.step65.subtitle"),
      title: firstName ? t("onboarding.step65.titleNamed", { name: firstName }) : t("onboarding.step65.title"),
      valid: () => true,
      content: (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: "var(--sub)" }}>
            {t("onboarding.step65.prompt")}
          </p>
          <textarea
            value={form.investing_knowledge}
            onChange={(e) => setForm(f => ({ ...f, investing_knowledge: e.target.value }))}
            rows={5}
            className="w-full rounded-xl border px-4 py-3 text-sm outline-none resize-none"
            placeholder={t("onboarding.step65.placeholder")}
            style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
          />
          <p className="text-xs" style={{ color: "var(--dim)" }}>
            {t("onboarding.step65.hint")}
          </p>
        </div>
      ),
    },

    // 7 — Perfil del inversor (reveal)
    {
      subtitle: t("onboarding.step7.subtitle"),
      title: t("onboarding.step7.title", { name: firstName || t("onboarding.step7.defaultName") }),
      valid: () => true,
      content: (
        <div className="space-y-4">
          {/* Risk card */}
          <div className="rounded-2xl border p-5 text-center"
               style={{ background: "var(--raised)", borderColor: riskCfg.color + "55" }}>
            <div className="text-4xl mb-2">{riskCfg.emoji}</div>
            <div className="text-base font-black mb-1" style={{ color: "var(--text)" }}>
              {t("onboarding.step7.investorOfType", { type: t(riskCfg.labelKey) })}
            </div>
            <div className="text-xs mb-4" style={{ color: "var(--muted)" }}>{t(riskCfg.descKey)}</div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
              <div className="h-full rounded-full transition-all"
                   style={{ width: `${riskCfg.pct}%`, background: riskCfg.color }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px]" style={{ color: "var(--dim)" }}>{t("onboarding.step7.lowRisk")}</span>
              <span className="text-[10px]" style={{ color: "var(--dim)" }}>{t("onboarding.step7.highRisk")}</span>
            </div>
          </div>

          {/* Personal summary */}
          <div className="rounded-xl border overflow-hidden"
               style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                {t("onboarding.step7.summaryTitle")}
              </p>
            </div>
            {[
              { label: t("onboarding.step7.rows.name"),   value: form.name },
              { label: t("onboarding.step7.rows.age"),    value: userAge ? t("onboarding.step7.ageValue", { age: userAge }) : "—" },
              { label: t("onboarding.step7.rows.country"),value: form.country ? `${COUNTRIES.find(c => c.value === form.country)?.flag ?? ""} ${t(COUNTRIES.find(c => c.value === form.country)?.labelKey ?? "")}`.trim() : "—" },
              { label: t("onboarding.step7.rows.level"),  value: levelInfo ? `${levelInfo.emoji} ${t(levelInfo.labelKey)}` : "—" },
              { label: t("onboarding.step7.rows.goal"),   value: goalInfo  ? `${goalInfo.emoji} ${t(goalInfo.labelKey)}` : "—" },
              { label: t("onboarding.step7.rows.initialCapital"), value: form.initial_capital ? `$${Number(form.initial_capital).toLocaleString()}` : "$0" },
              { label: t("onboarding.step7.rows.monthlyContribution"), value: `$${Number(form.monthly_contribution).toLocaleString()}${t("onboarding.step2.perMonth")}` },
              { label: t("onboarding.step7.rows.targetWealth"), value: `$${Number(form.investment_goal_amount).toLocaleString()}` },
              { label: t("onboarding.step7.rows.horizon"), value: `${form.investment_horizon} ${t("onboarding.step2.years")}` },
              { label: t("onboarding.step7.rows.broker"), value: form.has_broker === "yes" ? (form.broker_name || t("onboarding.step7.yes")) : t("onboarding.step7.noBrokerYet") },
              { label: t("onboarding.step7.rows.priorInvestments"), value: form.has_investments === "yes" ? t("onboarding.step7.investedBefore") : t("onboarding.step7.firstTime") },
            ].map((row) => (
              <div key={row.label}
                   className="flex items-center justify-between px-4 py-2.5 border-b last:border-0"
                   style={{ borderColor: "var(--border)" }}>
                <span className="text-xs" style={{ color: "var(--muted)" }}>{row.label}</span>
                <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>{row.value}</span>
              </div>
            ))}
          </div>

          {/* Quiz answers */}
          <div className="rounded-xl border overflow-hidden"
               style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>{t("onboarding.step7.answersTitle")}</p>
            </div>
            {([
              { key: "q1" as const, label: t("onboarding.step7.q1Label") },
              { key: "q4" as const, label: t("onboarding.step7.q4Label") },
            ]).map(({ key, label }) => {
              const ans = form[key] as QuizAnswer;
              return (
                <div key={key} className="flex items-center justify-between px-4 py-2.5 border-b last:border-0"
                     style={{ borderColor: "var(--border)" }}>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{label}</span>
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-black text-white"
                          style={{ background: "var(--accent)" }}>{ans}</span>
                    <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                      {ans ? t(QUIZ_LABEL_KEYS[key][ans]) : "—"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ),
    },

    // 7 — Proyección + Nuvos AI
    {
      subtitle: t("onboarding.step8.subtitle"),
      title: t("onboarding.step8.title", { amount: fmtMoney(goalAmt) }),
      valid: () => true,
      content: (
        <div className="space-y-5">
          {/* Projection bars */}
          <div className="rounded-xl border p-4 space-y-4"
               style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold" style={{ color: "var(--muted)" }}>
                {t("onboarding.step8.contributing", { amount: pmt.toLocaleString() })}
              </p>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                    style={{ background: riskCfg.color + "20", color: riskCfg.color }}>
                ~{rateLabel}{t("onboarding.step8.perYear")}
              </span>
            </div>

            {[
              { years: horizonYrs,      fv: fvHorizon, label: t("onboarding.step8.atYears", { years: horizonYrs }) },
              { years: horizonYrs + 10, fv: fvPlus10,  label: t("onboarding.step8.tenMoreYears", { total: horizonYrs + 10 }) },
            ].map(({ years, fv, label }) => {
              const barPct = Math.min((fv / maxFV) * 100, 100);
              return (
                <div key={years}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span style={{ color: "var(--sub)" }}>{label}</span>
                    <span className="font-extrabold"
                          style={{ color: fv >= goalAmt ? "#22c55e" : "var(--text)" }}>
                      {fmtMoney(fv)}
                    </span>
                  </div>
                  <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                    <div className="absolute inset-y-0 w-0.5 z-10"
                         style={{ left: `${goalLinePct}%`, background: "#22c55e", opacity: 0.8 }} />
                    <div className="absolute inset-y-0 left-0 rounded-full"
                         style={{ width: `${barPct}%`, background: fv >= goalAmt ? "#22c55e" : riskCfg.color }} />
                  </div>
                </div>
              );
            })}

            {/* Years to goal */}
            <div className="rounded-xl px-3 py-2.5 flex items-center gap-2"
                 style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)" }}>
              <span className="text-lg">🎯</span>
              <p className="text-xs font-semibold" style={{ color: "#22c55e" }}>{goalStatusLine}</p>
            </div>

            {/* Power of time */}
            <div className="rounded-xl px-3 py-2.5"
                 style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.25)" }}>
              <div className="flex items-center gap-2">
                <span className="text-base">⏳</span>
                <p className="text-xs font-bold" style={{ color: "#818cf8" }}>
                  {t("onboarding.step8.tenMoreYearsExtra", { extra: fmtMoney(extraGain), pct: extraPct })}
                </p>
              </div>
              <p className="text-[10px] ml-6 mt-1" style={{ color: "var(--dim)" }}>
                {t("onboarding.step8.compoundNote")}
              </p>
            </div>

            <p className="text-[10px] italic" style={{ color: "var(--dim)" }}>
              {t("onboarding.step8.illustrativeNote")}
            </p>
          </div>

          {/* Nuvos AI features */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "var(--muted)" }}>
              {t("onboarding.step8.featuresTitle")}
            </p>
            <div className="space-y-2">
              {[
                { icon: "🤖", title: t("onboarding.step8.features.ai.title"),        sub: t("onboarding.step8.features.ai.sub") },
                { icon: "📊", title: t("onboarding.step8.features.portfolio.title"), sub: t("onboarding.step8.features.portfolio.sub") },
                { icon: "📅", title: t("onboarding.step8.features.calendar.title"),  sub: t("onboarding.step8.features.calendar.sub") },
                { icon: "🎮", title: t("onboarding.step8.features.paper.title"),     sub: t("onboarding.step8.features.paper.sub") },
              ].map((f) => (
                <div key={f.title} className="flex items-center gap-3 p-3 rounded-xl border"
                     style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  <span className="text-xl shrink-0">{f.icon}</span>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{f.title}</p>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>{f.sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ),
    },

    // 8 — Disclaimer legal
    {
      subtitle: t("onboarding.legal.subtitle"),
      title: t("onboarding.legal.title"),
      valid: () => acceptedTerms && acceptedDisclaimer,
      content: (
        <div className="space-y-4">
          {/* Scrollable legal document */}
          <div className="rounded-xl border overflow-hidden"
               style={{ borderColor: "rgba(245,158,11,0.3)" }}>
            <div className="px-3 py-2 flex items-center gap-2"
                 style={{ background: "rgba(245,158,11,0.1)", borderBottom: "1px solid rgba(245,158,11,0.2)" }}>
              <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "#f59e0b" }}>
                ⚠️ {t("onboarding.legal.bannerTitle")}
              </span>
            </div>
            <div className="overflow-y-auto px-4 py-4 space-y-4 text-xs leading-relaxed"
                 style={{ maxHeight: 260, color: "var(--sub)" }}>

              <div>
                <p className="font-bold mb-1" style={{ color: "var(--text)" }}>{t("onboarding.legal.section1.title")}</p>
                <p>
                  {t("onboarding.legal.section1.body1")} <strong style={{ color: "var(--text)" }}>{t("onboarding.legal.section1.notEmphasis")}</strong>{" "}
                  {t("onboarding.legal.section1.body2")}
                </p>
              </div>

              <div>
                <p className="font-bold mb-1" style={{ color: "var(--text)" }}>{t("onboarding.legal.section2.title")}</p>
                <p>{t("onboarding.legal.section2.body")}</p>
              </div>

              <div>
                <p className="font-bold mb-1" style={{ color: "var(--text)" }}>{t("onboarding.legal.section3.title")}</p>
                <p>
                  {t("onboarding.legal.section3.body1")}{" "}
                  <strong style={{ color: "var(--text)" }}>{t("onboarding.legal.section3.responsibilityEmphasis")}</strong>.
                </p>
              </div>

              <div>
                <p className="font-bold mb-1" style={{ color: "var(--text)" }}>{t("onboarding.legal.section4.title")}</p>
                <p>{t("onboarding.legal.section4.body")}</p>
              </div>

              <div>
                <p className="font-bold mb-1" style={{ color: "var(--text)" }}>{t("onboarding.legal.section5.title")}</p>
                <p>{t("onboarding.legal.section5.body")}</p>
              </div>

              <div>
                <p className="font-bold mb-1" style={{ color: "var(--text)" }}>{t("onboarding.legal.section6.title")}</p>
                <p>
                  {t("onboarding.legal.section6.body")}{" "}
                  <a href="/privacy" target="_blank" style={{ color: "var(--accent-l)", textDecoration: "underline" }}>
                    {t("onboarding.legal.privacyNoticeLink")}
                  </a>.
                </p>
              </div>
            </div>
          </div>

          {/* Acceptance checkboxes */}
          <label className="flex items-start gap-3 cursor-pointer">
            <div className="mt-0.5 w-5 h-5 rounded-md border-2 shrink-0 flex items-center justify-center transition-all"
                 style={{
                   borderColor: acceptedTerms ? "var(--accent)" : "var(--border)",
                   background:  acceptedTerms ? "var(--accent)" : "transparent",
                 }}
                 onClick={() => setAcceptedTerms(v => !v)}>
              {acceptedTerms && (
                <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                  <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <span className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>
              {t("onboarding.legal.acceptTermsPrefix")}{" "}
              <a href="/terms" target="_blank" style={{ color: "var(--accent-l)", textDecoration: "underline" }}>
                {t("onboarding.legal.termsLink")}
              </a>
              {" "}{t("onboarding.legal.and")}{" "}
              <a href="/privacy" target="_blank" style={{ color: "var(--accent-l)", textDecoration: "underline" }}>
                {t("onboarding.legal.privacyLink")}
              </a>.
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <div className="mt-0.5 w-5 h-5 rounded-md border-2 shrink-0 flex items-center justify-center transition-all"
                 style={{
                   borderColor: acceptedDisclaimer ? "var(--accent)" : "var(--border)",
                   background:  acceptedDisclaimer ? "var(--accent)" : "transparent",
                 }}
                 onClick={() => setAcceptedDisclaimer(v => !v)}>
              {acceptedDisclaimer && (
                <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                  <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <span className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>
              {t("onboarding.legal.understandPrefix")}{" "}
              <strong style={{ color: "var(--text)" }}>{t("onboarding.legal.understandEmphasis")}</strong>
              {t("onboarding.legal.understandSuffix")}
            </span>
          </label>
        </div>
      ),
    },
  ];

  const current    = STEPS[step];
  const isLastStep = step === STEPS.length - 1;

  // ── Submit ───────────────────────────────────────────────────────────────────
  const handleNext = async () => {
    if (!isLastStep) { setStep(step + 1); return; }
    setLoading(true); setError("");
    try {
      const payload = {
        name:                   form.name.trim(),
        birth_date:             birthDateStr || undefined,
        country:                form.country || undefined,
        monthly_income:         form.monthly_income || undefined,
        monthly_contribution:   form.monthly_contribution,
        initial_capital:        form.initial_capital || undefined,
        investment_goal:        form.investment_goal,
        investment_goal_amount: form.investment_goal_amount,
        investment_horizon:     form.investment_horizon,
        knowledge_level:        form.knowledge_level,
        risk_tolerance:         calculated,
        quiz_answers:           { q1: form.q1, q4: form.q4, investing_knowledge: form.investing_knowledge.trim() || undefined },
        has_broker:             form.has_broker === "yes",
        broker_name:            form.has_broker === "yes" ? (form.broker_name || undefined) : undefined,
        has_investments:        form.has_investments === "yes",
        terms_accepted_at:      new Date().toISOString(),
        terms_version:          "2026-06",
        language,
      };
      const res = await profileApi.create(payload);
      setProfile(res.data);

      // ── Inyectar mensaje de bienvenida del mentor en el chat ──────────────
      const _goalLabelKeys: Record<string, string> = {
        house:             "onboarding.welcome.goals.house",
        car:               "onboarding.welcome.goals.car",
        passive_income:    "onboarding.welcome.goals.passiveIncome",
        retirement:        "onboarding.welcome.goals.retirement",
        financial_freedom: "onboarding.welcome.goals.financialFreedom",
        long_term_wealth:  "onboarding.welcome.goals.longTermWealth",
      };
      const _goalLabel = t(_goalLabelKeys[form.investment_goal] ?? "") || form.investment_goal;
      const _rateLabel  = { conservative: "7%", moderate: "10%", aggressive: "12%" }[calculated] ?? "10%";
      const _levelIntro = form.knowledge_level === "B"
        ? t("onboarding.welcome.levelIntro.basic")
        : form.knowledge_level === "C"
        ? t("onboarding.welcome.levelIntro.intermediate")
        : t("onboarding.welcome.levelIntro.advanced");
      const _yrsPart = yrsNeeded && goalAmt > 0 && pmt > 0
        ? t("onboarding.welcome.yearsProjection", { amount: pmt.toLocaleString(), rate: _rateLabel, goal: fmtMoney(goalAmt), years: yrsNeeded })
        : "";
      const _brokerContext = form.has_broker === "yes" && form.broker_name
        ? t("onboarding.welcome.brokerContext.namedBroker", { broker: form.broker_name })
        : form.has_broker === "yes"
        ? t("onboarding.welcome.brokerContext.hasBroker")
        : t("onboarding.welcome.brokerContext.noBroker");
      const _invContext = form.has_investments === "yes"
        ? t("onboarding.welcome.investContext.hasInvested")
        : t("onboarding.welcome.investContext.firstTime");
      const _welcomeMsg = t("onboarding.welcome.message", {
        name: firstName,
        riskType: t(riskCfg.labelKey),
        goal: _goalLabel,
        yearsProjection: _yrsPart,
        brokerContext: _brokerContext,
        investContext: _invContext,
        levelIntro: _levelIntro,
      });

      const _chat = useChatStore.getState();
      _chat.createSession();
      _chat.addMessage({ role: "assistant", content: _welcomeMsg });

      // Marcar onboarding como completado — bloquea re-entrada para siempre
      localStorage.setItem("nuvos_ob", "1");
      // Marcar tour guiado activo
      localStorage.setItem("nuvos_guided_tour", "1");
      localStorage.setItem("nuvos_guided_step", "1");
      if (form.knowledge_level === "B") localStorage.setItem("nuvos_first_steps_active", "1");
      router.push("/home");
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      const msg = typeof raw === "string" ? raw : Array.isArray(raw) ? String(raw[0]?.msg ?? "") : "";
      setError(msg || t("onboarding.errors.saveFailed"));
    } finally {
      setLoading(false);
    }
  };

  // ── Main layout ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-6">
          <Image src="/logo.png" alt="Nuvos AI" width={28} height={28} className="rounded-lg object-cover" />
          <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvos AI</span>
        </div>

        {/* Progress */}
        <div className="flex gap-1 mb-6">
          {STEPS.map((_, i) => (
            <div key={i} className="h-1 flex-1 rounded-full transition-all"
                 style={{ background: i <= step ? "var(--accent)" : "var(--border)" }} />
          ))}
        </div>

        <div className="rounded-2xl border p-5 overflow-y-auto max-h-[72vh]"
             style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          {/* Step label */}
          <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--accent-l)" }}>
            {current.subtitle}
          </p>
          <h2 className="text-lg font-bold mb-4 leading-snug" style={{ color: "var(--text)" }}>
            {current.title}
          </h2>

          {current.content}

          {error && (
            <div className="mt-4 rounded-xl px-4 py-3 text-sm"
                 style={{ background: "rgba(255,71,87,0.1)", border: "1px solid rgba(255,71,87,0.3)", color: "var(--down)" }}>
              {error}
            </div>
          )}

          <div className="flex gap-3 mt-5">
            <button onClick={async () => { if (step === 0) { await clearAuth(); router.push("/"); } else setStep(step - 1); }}
                    className="flex items-center gap-1.5 px-4 py-3 border rounded-xl text-sm font-medium transition-colors"
                    style={{ borderColor: "var(--border)", color: "var(--sub)" }}>
              <ChevronLeft className="w-4 h-4" />
              {step === 0 ? t("onboarding.buttons.exit") : t("onboarding.buttons.back")}
            </button>
            <button onClick={handleNext}
                    disabled={!current.valid() || loading}
                    className="flex-1 flex items-center justify-center gap-2 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-40"
                    style={{ background: "var(--accent)" }}>
              {loading ? t("onboarding.buttons.saving") : isLastStep ? t("onboarding.buttons.start") : t("onboarding.buttons.next")}
              {!loading && <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <p className="text-center text-xs mt-2" style={{ color: "var(--dim)" }}>
          {t("onboarding.stepCounter", { current: step + 1, total: STEPS.length })}
        </p>
      </div>
    </div>
  );
}
