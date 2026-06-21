"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { profile as profileApi } from "@/lib/api";
import { useProfileStore, useAuthStore, useChatStore } from "@/lib/store";
import { ChevronRight, ChevronLeft } from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────
type QuizAnswer  = "A" | "B" | "C" | "D";
type RiskTolerance = "conservative" | "moderate" | "aggressive";

// ─── Static data ───────────────────────────────────────────────────────────────
const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const GOALS = [
  { value: "house",             label: "Comprar una casa",          emoji: "🏠" },
  { value: "car",               label: "Comprar un carro",          emoji: "🚗" },
  { value: "passive_income",    label: "Vivir de mis inversiones",  emoji: "💸" },
  { value: "retirement",        label: "Retiro / pensión",          emoji: "👴" },
  { value: "financial_freedom", label: "Libertad financiera",       emoji: "🦅" },
  { value: "long_term_wealth",  label: "Patrimonio de largo plazo", emoji: "🏛️" },
];

const KNOWLEDGE_LEVELS = [
  { value: "B" as QuizAnswer, label: "Básico",     emoji: "🌱", color: "#22c55e",
    desc: "Sin experiencia o apenas inicio. Conozco ahorro, CETES o fondos básicos." },
  { value: "C" as QuizAnswer, label: "Intermedio", emoji: "📈", color: "#3b82f6",
    desc: "Tengo experiencia con ETFs y acciones. Entiendo diversificación y rendimiento." },
  { value: "D" as QuizAnswer, label: "Avanzado",   emoji: "🎯", color: "#a855f7",
    desc: "Manejo análisis fundamental, derivados, ciclos de mercado y estrategias complejas." },
];

const RISK_CONFIG: Record<RiskTolerance, { label: string; emoji: string; color: string; pct: number; desc: string }> = {
  conservative: { label: "Conservador", emoji: "🛡️", color: "#3b82f6", pct: 33,
    desc: "Priorizas la seguridad y la preservación de tu capital. Prefieres rendimientos estables." },
  moderate:     { label: "Moderado",    emoji: "⚖️", color: "#f59e0b", pct: 66,
    desc: "Buscas equilibrio entre crecimiento y protección. Aceptas cierta volatilidad." },
  aggressive:   { label: "Agresivo",   emoji: "🚀", color: "#ef4444", pct: 100,
    desc: "Buscas máximo crecimiento. Toleras alta volatilidad a cambio de retornos superiores." },
};

const QUIZ_Q1 = {
  category: "01 · MENTALIDAD",
  question: "Si inviertes $100,000 y el mercado se desploma 40%, ¿qué harías?",
  options: {
    A: "Vendo todo inmediatamente para evitar más pérdidas",
    B: "Espero sin hacer nada hasta que el mercado se recupere",
    C: "Mantengo mi posición — los fundamentos no cambiaron",
    D: "Compro más — es la oportunidad que estaba esperando",
  } as Record<QuizAnswer, string>,
};

const QUIZ_Q4 = {
  category: "02 · RIESGO",
  question: "Tienes $100,000 para invertir. ¿Qué escenario prefieres?",
  options: {
    A: "Ganar $5K seguro, sin posibilidad de perder nada",
    B: "Ganar $15K probable, con riesgo de perder $5K",
    C: "Ganar $40K posible, con riesgo de perder $20K",
    D: "Ganar $120K posible, con riesgo de perder todo",
  } as Record<QuizAnswer, string>,
};

const QUIZ_LABELS = {
  q1: { A: "Vende todo",    B: "Espera pasivo",     C: "Mantiene posición", D: "Compra más"         } as Record<QuizAnswer, string>,
  q4: { A: "$5K seguro",    B: "$15K / riesgo $5K", C: "$40K / riesgo $20K",D: "$120K / riesgo total"} as Record<QuizAnswer, string>,
};

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
  knowledge_level: QuizAnswer | "";
  monthly_contribution: string;
  investment_goal_amount: string;
  investment_horizon: string;
  investment_goal: string;
  q1: QuizAnswer | "";
  q4: QuizAnswer | "";
};

// ─── Component ─────────────────────────────────────────────────────────────────
export default function OnboardingPage() {
  const router  = useRouter();
  const { setProfile }  = useProfileStore();
  const { isAuthenticated, clearAuth } = useAuthStore();

  const [step, setStep]     = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");
  const [success, setSuccess] = useState(false);
  const [acceptedTerms, setAcceptedTerms]           = useState(false);
  const [acceptedDisclaimer, setAcceptedDisclaimer] = useState(false);

  const [form, setForm] = useState<FormState>({
    name: "", birth_day: "", birth_month: "", birth_year: "",
    knowledge_level: "", monthly_contribution: "", investment_goal_amount: "",
    investment_horizon: "", investment_goal: "", q1: "", q4: "",
  });

  useEffect(() => { if (!isAuthenticated && !localStorage.getItem("access_token")) router.push("/"); }, [isAuthenticated]);
  if (!isAuthenticated && !localStorage.getItem("access_token")) return null;

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
              {q.options[letter]}
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
    ? `¡Alcanzas tu meta dentro de los ${horizonYrs} años!`
    : yrsNeeded
    ? `Necesitas ~${yrsNeeded} años para alcanzar ${fmtMoney(goalAmt)}`
    : `En ${horizonYrs} años tendrías ${fmtMoney(fvHorizon)} — aumenta tu aportación mensual`;

  const STEPS = [
    // 0 — Nombre + fecha de nacimiento
    {
      subtitle: "BIENVENIDO",
      title: "¡Hola! Cuéntanos sobre ti",
      valid: () => form.name.trim().length >= 2 && birthDateValid,
      content: (
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              Tu nombre completo
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full rounded-xl border px-4 py-3 text-sm outline-none"
              placeholder="Ej. Diego Arria"
              autoFocus
              style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
            />
            <p className="text-xs mt-1.5" style={{ color: "var(--dim)" }}>
              Así te llamaremos y la IA sabrá cómo dirigirse a ti.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              Fecha de nacimiento
            </label>
            <div className="grid grid-cols-3 gap-2">
              <select value={form.birth_day}
                      onChange={(e) => setForm(f => ({ ...f, birth_day: e.target.value }))}
                      className="rounded-xl border px-3 py-3 text-sm outline-none appearance-none"
                      style={{ background: "var(--raised)", borderColor: "var(--border)", color: form.birth_day ? "var(--text)" : "var(--muted)" }}>
                <option value="">Día</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                  <option key={d} value={String(d)}>{d}</option>
                ))}
              </select>
              <select value={form.birth_month}
                      onChange={(e) => setForm(f => ({ ...f, birth_month: e.target.value }))}
                      className="rounded-xl border px-3 py-3 text-sm outline-none appearance-none"
                      style={{ background: "var(--raised)", borderColor: "var(--border)", color: form.birth_month ? "var(--text)" : "var(--muted)" }}>
                <option value="">Mes</option>
                {MONTHS.map((m, i) => (
                  <option key={i + 1} value={String(i + 1)}>{m}</option>
                ))}
              </select>
              <select value={form.birth_year}
                      onChange={(e) => setForm(f => ({ ...f, birth_year: e.target.value }))}
                      className="rounded-xl border px-3 py-3 text-sm outline-none appearance-none"
                      style={{ background: "var(--raised)", borderColor: "var(--border)", color: form.birth_year ? "var(--text)" : "var(--muted)" }}>
                <option value="">Año</option>
                {Array.from({ length: 73 }, (_, i) => 2006 - i).map(y => (
                  <option key={y} value={String(y)}>{y}</option>
                ))}
              </select>
            </div>
            <p className="text-xs mt-1.5" style={{ color: "var(--dim)" }}>
              Debes tener al menos 18 años para usar Nuvos AI.
            </p>
          </div>
        </div>
      ),
    },

    // 1 — Nivel de conocimiento
    {
      subtitle: "TU PERFIL",
      title: `${firstName ? `${firstName}, ¿cuál` : "¿Cuál"} es tu nivel de conocimiento en inversiones?`,
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
                      {lvl.label}
                    </p>
                    <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "var(--sub)" }}>
                      {lvl.desc}
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
      subtitle: "METAS FINANCIERAS",
      title: "Cuéntanos sobre tu plan",
      valid: () => pmt > 0 && parseFloat(form.investment_goal_amount) > 0 && horizonYrs >= 1,
      content: (
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              ¿Cuánto quieres invertir mensualmente?
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold" style={{ color: "var(--muted)" }}>$</span>
              <input type="number" min={0}
                     value={form.monthly_contribution}
                     onChange={(e) => setForm(f => ({ ...f, monthly_contribution: e.target.value }))}
                     className="w-full rounded-xl border pl-8 pr-16 py-3 text-sm outline-none"
                     placeholder="500"
                     style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold" style={{ color: "var(--muted)" }}>/mes</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              ¿Cuánto patrimonio quieres tener?
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold" style={{ color: "var(--muted)" }}>$</span>
              <input type="number" min={0}
                     value={form.investment_goal_amount}
                     onChange={(e) => setForm(f => ({ ...f, investment_goal_amount: e.target.value }))}
                     className="w-full rounded-xl border pl-8 pr-4 py-3 text-sm outline-none"
                     placeholder="1,000,000"
                     style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
              />
            </div>
            <p className="text-xs mt-1.5" style={{ color: "var(--dim)" }}>
              La app calculará cuándo llegarás a esta meta con tus aportaciones.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              ¿Por cuántos años quieres invertir?
            </label>
            <div className="relative">
              <input type="number" min={1} max={50}
                     value={form.investment_horizon}
                     onChange={(e) => setForm(f => ({ ...f, investment_horizon: e.target.value }))}
                     className="w-full rounded-xl border px-4 pr-16 py-3 text-sm outline-none"
                     placeholder="10"
                     style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold" style={{ color: "var(--muted)" }}>años</span>
            </div>
          </div>
        </div>
      ),
    },

    // 3 — Meta al invertir (tipo)
    {
      subtitle: "OBJETIVO",
      title: "¿Cuál es tu meta al invertir?",
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
                  {g.label}
                </p>
              </button>
            );
          })}
        </div>
      ),
    },

    // 4 — Quiz q1
    {
      subtitle: QUIZ_Q1.category,
      title: QUIZ_Q1.question,
      valid: () => !!form.q1,
      content: renderQuiz(QUIZ_Q1, "q1"),
    },

    // 5 — Quiz q4
    {
      subtitle: QUIZ_Q4.category,
      title: QUIZ_Q4.question,
      valid: () => !!form.q4,
      content: renderQuiz(QUIZ_Q4, "q4"),
    },

    // 6 — Perfil del inversor (reveal)
    {
      subtitle: "TU PERFIL DE INVERSIÓN",
      title: `Tu perfil, ${firstName || "inversionista"}`,
      valid: () => true,
      content: (
        <div className="space-y-4">
          {/* Risk card */}
          <div className="rounded-2xl border p-5 text-center"
               style={{ background: "var(--raised)", borderColor: riskCfg.color + "55" }}>
            <div className="text-4xl mb-2">{riskCfg.emoji}</div>
            <div className="text-base font-black mb-1" style={{ color: "var(--text)" }}>
              Inversionista {riskCfg.label}
            </div>
            <div className="text-xs mb-4" style={{ color: "var(--muted)" }}>{riskCfg.desc}</div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
              <div className="h-full rounded-full transition-all"
                   style={{ width: `${riskCfg.pct}%`, background: riskCfg.color }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px]" style={{ color: "var(--dim)" }}>Bajo riesgo</span>
              <span className="text-[10px]" style={{ color: "var(--dim)" }}>Alto riesgo</span>
            </div>
          </div>

          {/* Personal summary */}
          <div className="rounded-xl border overflow-hidden"
               style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Resumen de tu perfil
              </p>
            </div>
            {[
              { label: "Nombre",            value: form.name },
              { label: "Edad",              value: userAge ? `${userAge} años` : "—" },
              { label: "Nivel",             value: levelInfo ? `${levelInfo.emoji} ${levelInfo.label}` : "—" },
              { label: "Meta",              value: goalInfo  ? `${goalInfo.emoji} ${goalInfo.label}` : "—" },
              { label: "Patrimonio objetivo", value: `$${Number(form.investment_goal_amount).toLocaleString()}` },
              { label: "Horizonte",         value: `${form.investment_horizon} años` },
              { label: "Aportación mensual",value: `$${Number(form.monthly_contribution).toLocaleString()}/mes` },
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
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Tus respuestas</p>
            </div>
            {([
              { key: "q1" as const, label: "Ante una caída del mercado" },
              { key: "q4" as const, label: "Escenario de riesgo preferido" },
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
                      {ans ? QUIZ_LABELS[key][ans] : "—"}
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
      subtitle: "TU PROYECCIÓN",
      title: `Tu camino hacia ${fmtMoney(goalAmt)}`,
      valid: () => true,
      content: (
        <div className="space-y-5">
          {/* Projection bars */}
          <div className="rounded-xl border p-4 space-y-4"
               style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold" style={{ color: "var(--muted)" }}>
                Aportando ${pmt.toLocaleString()}/mes
              </p>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                    style={{ background: riskCfg.color + "20", color: riskCfg.color }}>
                ~{rateLabel}/año
              </span>
            </div>

            {[
              { years: horizonYrs,      fv: fvHorizon, label: `A los ${horizonYrs} años (tu horizonte)` },
              { years: horizonYrs + 10, fv: fvPlus10,  label: `Si lo dejas 10 años más (${horizonYrs + 10} total)` },
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
                  10 años más: +{fmtMoney(extraGain)} extra (+{extraPct}%)
                </p>
              </div>
              <p className="text-[10px] ml-6 mt-1" style={{ color: "var(--dim)" }}>
                El interés compuesto se acelera — los últimos años generan más que los primeros.
              </p>
            </div>

            <p className="text-[10px] italic" style={{ color: "var(--dim)" }}>
              * Ilustrativo. Basado en promedios históricos del mercado. No garantiza rendimientos futuros.
            </p>
          </div>

          {/* Nuvos AI features */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "var(--muted)" }}>
              Nuvos AI trabaja contigo
            </p>
            <div className="space-y-2">
              {[
                { icon: "🤖", title: "IA que conoce tu perfil", sub: "Análisis personalizado según tu nivel y tolerancia al riesgo" },
                { icon: "📊", title: "Portafolio en tiempo real", sub: "Precios cada 30s con rendimientos Hoy / YTD / Total" },
                { icon: "📅", title: "Calendario de eventos", sub: "Earnings, dividendos y ex-dividendos de tus posiciones" },
                { icon: "🎮", title: "Paper trading sin riesgo", sub: "Practica con $10,000 virtuales a precios reales del mercado" },
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
      subtitle: "AVISO LEGAL",
      title: "Antes de empezar",
      valid: () => acceptedTerms && acceptedDisclaimer,
      content: (
        <div className="space-y-4">
          {/* Scrollable legal document */}
          <div className="rounded-xl border overflow-hidden"
               style={{ borderColor: "rgba(245,158,11,0.3)" }}>
            <div className="px-3 py-2 flex items-center gap-2"
                 style={{ background: "rgba(245,158,11,0.1)", borderBottom: "1px solid rgba(245,158,11,0.2)" }}>
              <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "#f59e0b" }}>
                ⚠️ Aviso de Carácter Educativo — léelo completo antes de continuar
              </span>
            </div>
            <div className="overflow-y-auto px-4 py-4 space-y-4 text-xs leading-relaxed"
                 style={{ maxHeight: 260, color: "var(--sub)" }}>

              <div>
                <p className="font-bold mb-1" style={{ color: "var(--text)" }}>1. Naturaleza del servicio</p>
                <p>
                  Nuvos AI es una herramienta tecnológica de carácter educativo e informativo orientada a la
                  educación financiera y al análisis de mercados. Nuvos AI <strong style={{ color: "var(--text)" }}>no es</strong>{" "}
                  una institución bancaria, casa de bolsa, asesor en inversiones, ni ninguna otra entidad regulada
                  por la CNBV, CONDUSEF, SEC ni cualquier otro regulador financiero en México, Estados Unidos o
                  cualquier otro país.
                </p>
              </div>

              <div>
                <p className="font-bold mb-1" style={{ color: "var(--text)" }}>2. Ausencia de asesoría financiera personalizada</p>
                <p>
                  Ningún contenido generado dentro de la aplicación —incluyendo perfiles de riesgo, análisis de
                  portafolios, comparativos con inversionistas, simulaciones, alertas o calendarios de resultados—
                  constituye una recomendación personalizada de inversión, una oferta, ni una invitación para
                  comprar, vender o mantener algún instrumento financiero. Todo el contenido es de naturaleza
                  general y educativa, generado o asistido por inteligencia artificial.
                </p>
              </div>

              <div>
                <p className="font-bold mb-1" style={{ color: "var(--text)" }}>3. Riesgos de invertir en los mercados financieros</p>
                <p>
                  Toda inversión conlleva riesgo, incluyendo la posible pérdida total o parcial del capital
                  invertido. El desempeño histórico no garantiza resultados futuros. Cualquier decisión de
                  inversión que tomes, dentro o fuera de la aplicación,{" "}
                  <strong style={{ color: "var(--text)" }}>es responsabilidad exclusiva del usuario</strong>.
                </p>
              </div>

              <div>
                <p className="font-bold mb-1" style={{ color: "var(--text)" }}>4. Limitaciones de la inteligencia artificial</p>
                <p>
                  El contenido generado por IA dentro de Nuvos AI puede contener errores, imprecisiones u
                  omisiones derivados de limitaciones técnicas de los modelos utilizados o de la información
                  de mercado disponible. No debe interpretarse como una afirmación de exactitud absoluta ni
                  como sustituto de la consulta con un profesional financiero certificado.
                </p>
              </div>

              <div>
                <p className="font-bold mb-1" style={{ color: "var(--text)" }}>5. Responsabilidad del usuario</p>
                <p>
                  El uso de la información y herramientas de Nuvos AI es completamente voluntario. Nuvos AI,
                  sus fundadores y colaboradores no asumen responsabilidad alguna por pérdidas, daños o
                  perjuicios relacionados con decisiones de inversión tomadas con base, total o parcial,
                  en el contenido de la aplicación.
                </p>
              </div>

              <div>
                <p className="font-bold mb-1" style={{ color: "var(--text)" }}>6. Tratamiento de datos personales</p>
                <p>
                  Los datos personales y financieros proporcionados serán tratados conforme a la Ley Federal
                  de Protección de Datos Personales en Posesión de Particulares y demás disposiciones
                  aplicables, según se describe en el{" "}
                  <a href="/privacy" target="_blank" style={{ color: "var(--accent-l)", textDecoration: "underline" }}>
                    Aviso de Privacidad de Nuvos AI
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
              He leído y acepto los{" "}
              <a href="/terms" target="_blank" style={{ color: "var(--accent-l)", textDecoration: "underline" }}>
                Términos de Uso
              </a>
              {" "}y la{" "}
              <a href="/privacy" target="_blank" style={{ color: "var(--accent-l)", textDecoration: "underline" }}>
                Política de Privacidad
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
              Entiendo que Nuvos AI ofrece contenido educativo generado con IA,{" "}
              <strong style={{ color: "var(--text)" }}>que no constituye asesoría financiera
              personalizada ni recomendación de inversión</strong>, y que cualquier decisión
              financiera que tome es de mi exclusiva responsabilidad.
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
        monthly_contribution:   form.monthly_contribution,
        investment_goal:        form.investment_goal,
        investment_goal_amount: form.investment_goal_amount,
        investment_horizon:     form.investment_horizon,
        knowledge_level:        form.knowledge_level,
        risk_tolerance:         calculated,
        quiz_answers:           { q1: form.q1, q4: form.q4 },
        terms_accepted_at:      new Date().toISOString(),
        terms_version:          "2026-06",
      };
      const res = await profileApi.create(payload);
      setProfile(res.data);

      // ── Inyectar mensaje de bienvenida del mentor en el chat ──────────────
      const _goalLabel: Record<string, string> = {
        house:             "comprar una casa",
        car:               "comprar un carro",
        passive_income:    "vivir de tus inversiones",
        retirement:        "retiro y pensión",
        financial_freedom: "libertad financiera",
        long_term_wealth:  "construir patrimonio a largo plazo",
      };
      const _rateLabel  = { conservative: "7%", moderate: "10%", aggressive: "12%" }[calculated] ?? "10%";
      const _levelIntro = form.knowledge_level === "B"
        ? "Sin importar desde dónde empiezes, voy paso a paso contigo."
        : form.knowledge_level === "C"
        ? "Con tu experiencia en ETFs y acciones, podemos ir directo a lo que importa."
        : "Con tu nivel avanzado, iremos a los análisis más sofisticados desde el inicio.";
      const _yrsPart = yrsNeeded && goalAmt > 0 && pmt > 0
        ? `\n\n📊 Con **$${pmt.toLocaleString()}/mes** y un retorno histórico promedio del **${_rateLabel}** anual, podrías alcanzar **${fmtMoney(goalAmt)}** en aproximadamente **${yrsNeeded} años**.`
        : "";
      const _welcomeMsg =
        `Hola **${firstName}** 👋 Ya revisé tu perfil.\n\n` +
        `Eres un inversionista **${riskCfg.label}** con meta de **${_goalLabel[form.investment_goal] ?? form.investment_goal}**.` +
        `${_yrsPart}\n\n${_levelIntro}\n\n` +
        `Para empezar bien, necesito saber una cosa: **¿ya tienes alguna posición o inversión en el mercado, o estás comenzando desde cero?**`;

      const _chat = useChatStore.getState();
      _chat.createSession();
      _chat.addMessage({ role: "assistant", content: _welcomeMsg });

      // Marcar tour guiado activo
      localStorage.setItem("nuvos_guided_tour", "1");
      localStorage.setItem("nuvos_guided_step", "1");
      if (form.knowledge_level === "B") localStorage.setItem("nuvos_first_steps_active", "1");
      setSuccess(true);
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      const msg = typeof raw === "string" ? raw : Array.isArray(raw) ? String(raw[0]?.msg ?? "") : "";
      setError(msg || "Error al guardar el perfil. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  // ── Success screen ───────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--bg)" }}>
        <div className="w-full max-w-sm text-center">
          <div className="text-6xl mb-4">{riskCfg.emoji}</div>
          <h1 className="text-3xl font-black mb-2" style={{ color: "var(--text)" }}>
            ¡Listo, {firstName}!
          </h1>
          <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
            Tu perfil de inversionista está configurado.
          </p>
          <div className="rounded-2xl border p-4 mb-6 text-left space-y-2"
               style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="flex items-center gap-3">
              <span className="text-xl">{riskCfg.emoji}</span>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Perfil de riesgo</div>
                <div className="text-sm font-semibold" style={{ color: riskCfg.color }}>Inversionista {riskCfg.label}</div>
              </div>
            </div>
            {levelInfo && (
              <div className="flex items-center gap-3">
                <span className="text-xl">{levelInfo.emoji}</span>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Nivel</div>
                  <div className="text-sm font-semibold" style={{ color: levelInfo.color }}>{levelInfo.label}</div>
                </div>
              </div>
            )}
          </div>
          <button onClick={() => router.push("/chat")}
                  className="w-full py-4 rounded-2xl text-white font-bold text-base"
                  style={{ background: "var(--accent)" }}>
            Empezar →
          </button>
        </div>
      </div>
    );
  }

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
            <button onClick={() => { if (step === 0) { clearAuth(); router.push("/"); } else setStep(step - 1); }}
                    className="flex items-center gap-1.5 px-4 py-3 border rounded-xl text-sm font-medium transition-colors"
                    style={{ borderColor: "var(--border)", color: "var(--sub)" }}>
              <ChevronLeft className="w-4 h-4" />
              {step === 0 ? "Salir" : "Atrás"}
            </button>
            <button onClick={handleNext}
                    disabled={!current.valid() || loading}
                    className="flex-1 flex items-center justify-center gap-2 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-40"
                    style={{ background: "var(--accent)" }}>
              {loading ? "Guardando..." : isLastStep ? "¡Comenzar!" : "Siguiente"}
              {!loading && <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <p className="text-center text-xs mt-2" style={{ color: "var(--dim)" }}>
          Paso {step + 1} de {STEPS.length}
        </p>
      </div>
    </div>
  );
}
