"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { profile as profileApi } from "@/lib/api";
import { useProfileStore, useAuthStore } from "@/lib/store";
import { ChevronRight, ChevronLeft } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type QuizAnswer = "A" | "B" | "C" | "D";
type RiskTolerance = "conservative" | "moderate" | "aggressive";

// ─── Quiz data (identical to mobile) ─────────────────────────────────────────

const QUIZ: { key: string; num: string; category: string; question: string; options: Record<QuizAnswer, string> }[] = [
  {
    key: "q1", num: "01", category: "MENTALIDAD",
    question: "Tu portafolio cae 35% en 3 meses por una crisis del mercado. ¿Qué haces?",
    options: {
      A: "Vendo todo antes de perder más",
      B: "Espero a que se recupere, pero no compro más",
      C: "Reviso si los fundamentos siguen sólidos y mantengo",
      D: "Aprovecho para comprar más a precios bajos",
    },
  },
  {
    key: "q2", num: "02", category: "HORIZONTE",
    question: "¿Para qué necesitas este dinero invertido y en cuánto tiempo?",
    options: {
      A: "Podría necesitarlo en menos de 2 años",
      B: "En 3–5 años, para algo específico",
      C: "En 10+ años, para independencia financiera o retiro",
      D: "No tengo prisa — es para construir patrimonio a largo plazo",
    },
  },
  {
    key: "q3", num: "03", category: "CONOCIMIENTO",
    question: "¿Cuál de estos conceptos entiendes y podrías explicar a alguien más?",
    options: {
      A: "Ninguno con confianza — apenas empiezo",
      B: "Interés compuesto, CETES, fondos indexados",
      C: "P/E ratio, diversificación, rendimiento ajustado al riesgo",
      D: "Análisis fundamental, cobertura con derivados, ciclos de mercado",
    },
  },
  {
    key: "q4", num: "04", category: "RIESGO",
    question: "Tienes $100,000 para invertir. ¿Qué escenario prefieres?",
    options: {
      A: "Ganar $5K seguro, sin posibilidad de perder nada",
      B: "Ganar $15K probable, con riesgo de perder $5K",
      C: "Ganar $40K posible, con riesgo de perder $20K",
      D: "Ganar $120K posible, con riesgo de perder todo",
    },
  },
  {
    key: "q5", num: "05", category: "COMPORTAMIENTO",
    question: "¿Cuánto tiempo dedicarías a monitorear y gestionar tus inversiones?",
    options: {
      A: "Prefiero algo automático que no requiera atención",
      B: "Una revisión mensual o trimestral me parece suficiente",
      C: "Me gusta revisar semanalmente y hacer ajustes cuando vale",
      D: "Estoy dispuesto a dedicarle tiempo diario — es una actividad activa",
    },
  },
];

const QUIZ_LABELS: Record<string, Record<QuizAnswer, string>> = {
  q1: { A: "Vende ante caídas", B: "Espera pasivamente", C: "Analiza y mantiene", D: "Compra las caídas" },
  q4: { A: "$5K seguro", B: "$15K / riesgo $5K", C: "$40K / riesgo $20K", D: "$120K / riesgo total" },
};

const RISK_CONFIG: Record<RiskTolerance, { label: string; emoji: string; color: string; pct: number; desc: string }> = {
  conservative: {
    label: "Inversionista Conservador", emoji: "🛡️", color: "#3b82f6", pct: 33,
    desc: "Priorizas la seguridad y la preservación de tu capital. Prefieres rendimientos estables aunque menores.",
  },
  moderate: {
    label: "Inversionista Moderado", emoji: "⚖️", color: "#f59e0b", pct: 66,
    desc: "Buscas equilibrio entre crecimiento y protección. Aceptas cierta volatilidad por mejores retornos.",
  },
  aggressive: {
    label: "Inversionista Agresivo", emoji: "🚀", color: "#ef4444", pct: 100,
    desc: "Tu objetivo es el máximo crecimiento. Tienes tolerancia a la alta volatilidad en el largo plazo.",
  },
};


// ─── Helpers ──────────────────────────────────────────────────────────────────

function calculateRisk(answers: Record<string, string>): RiskTolerance {
  const scoreMap: Record<QuizAnswer, number> = { A: 1, B: 2, C: 3, D: 4 };
  const scores = (Object.values(answers) as string[])
    .filter((v): v is QuizAnswer => ["A", "B", "C", "D"].includes(v))
    .map((a) => scoreMap[a]);
  if (scores.length === 0) return "moderate";
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avg <= 2.0) return "conservative";
  if (avg <= 3.0) return "moderate";
  return "aggressive";
}

function getAge(birthDate: string): number {
  const parts = birthDate.split("/");
  if (parts.length !== 3) return 0;
  const [day, month, year] = parts.map(Number);
  if (!day || !month || !year || year < 1900) return 0;
  const today = new Date();
  let age = today.getFullYear() - year;
  const m = today.getMonth() + 1 - month;
  if (m < 0 || (m === 0 && today.getDate() < day)) age--;
  return Math.max(0, age);
}

function formatBirthDate(text: string): string {
  const digits = text.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function isValidDate(d: string): boolean {
  const age = getAge(d);
  return d.length === 10 && age >= 10 && age <= 100;
}

// ─── Component ────────────────────────────────────────────────────────────────

type FormState = {
  name: string;
  birth_date: string;
  monthly_income: string;
  monthly_contribution: string;
  investment_amount: string;   // exact $ available now
  investment_goal_amount: string; // exact $ target goal
  investment_goal: string;        // goal type key
  knowledge_level: QuizAnswer | "";
  q1: QuizAnswer | "";
  q4: QuizAnswer | "";
};

export default function OnboardingPage() {
  const router = useRouter();
  const { setProfile } = useProfileStore();
  const { isAuthenticated, clearAuth } = useAuthStore();

  const [step, setStep]     = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");
  const [success, setSuccess] = useState(false);
  const [acceptedTerms, setAcceptedTerms]           = useState(false);
  const [acceptedDisclaimer, setAcceptedDisclaimer] = useState(false);

  const [form, setForm] = useState<FormState>({
    name: "", birth_date: "", monthly_income: "", monthly_contribution: "",
    investment_amount: "", investment_goal_amount: "", investment_goal: "",
    knowledge_level: "", q1: "", q4: "",
  });

  useEffect(() => { if (!isAuthenticated) router.push("/"); }, [isAuthenticated]);
  if (!isAuthenticated) return null;

  const quizAnswers = { q1: form.q1, q4: form.q4 };
  const calculated  = calculateRisk(quizAnswers);
  const riskCfg     = RISK_CONFIG[calculated];
  const currentAge  = getAge(form.birth_date);
  const firstName   = form.name.trim().split(" ")[0];

  const quizSteps = QUIZ.filter((q) => q.key === "q1" || q.key === "q4").map((q) => ({
    title: q.question,
    subtitle: q.category,
    valid: () => !!form[q.key as "q1" | "q4"],
    content: (
      <div className="space-y-2">
        {(["A", "B", "C", "D"] as QuizAnswer[]).map((letter) => {
          const active = form[q.key as "q1" | "q4"] === letter;
          return (
            <button key={letter} onClick={() => setForm((f) => ({ ...f, [q.key]: letter }))}
                    className="w-full text-left p-4 rounded-xl border-2 transition-all flex items-start gap-3"
                    style={{
                      borderColor: active ? "var(--accent)" : "var(--border)",
                      background:  active ? "rgba(0,168,94,0.10)" : "var(--raised)",
                    }}>
              <span className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black"
                    style={{ background: active ? "var(--accent)" : "var(--border)", color: active ? "#fff" : "var(--muted)" }}>
                {letter}
              </span>
              <span className="text-sm leading-snug" style={{ color: active ? "var(--text)" : "var(--sub)" }}>
                {q.options[letter]}
              </span>
            </button>
          );
        })}
      </div>
    ),
  }));

  const STEPS = [
    // 0 — Nombre
    {
      title: "¡Bienvenido! ¿Cómo te llamas?",
      subtitle: "Tu nombre para personalizar la experiencia",
      valid: () => form.name.trim().length >= 2,
      content: (
        <div className="space-y-3">
          <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Tu nombre completo
          </label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full rounded-xl border px-4 py-3 text-sm outline-none"
            placeholder="Ej. Diego Arria"
            autoFocus
            style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
          />
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Así te llamaremos en la app y la IA sabrá cómo dirigirse a ti.
          </p>
        </div>
      ),
    },
    // 1 — Situación financiera
    {
      title: `Hola, ${firstName || "!"}  Tu situación financiera`,
      subtitle: "Esta info ayuda a la IA a darte recomendaciones precisas",
      valid: () => isValidDate(form.birth_date) && !!form.monthly_income && !!form.monthly_contribution,
      content: (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              Fecha de nacimiento
            </label>
            <input
              value={form.birth_date}
              onChange={(e) => setForm((f) => ({ ...f, birth_date: formatBirthDate(e.target.value) }))}
              className="w-full rounded-xl border px-4 py-3 text-sm outline-none"
              placeholder="DD/MM/AAAA"
              maxLength={10}
              style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
            />
            {form.birth_date.length === 10 && (
              <p className="text-xs mt-1.5" style={{ color: isValidDate(form.birth_date) ? "var(--accent-l)" : "var(--down)" }}>
                {isValidDate(form.birth_date) ? `Tienes ${currentAge} años` : "Fecha inválida"}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              Ingresos mensuales (USD)
            </label>
            <input
              type="number"
              value={form.monthly_income}
              onChange={(e) => setForm((f) => ({ ...f, monthly_income: e.target.value }))}
              className="w-full rounded-xl border px-4 py-3 text-sm outline-none"
              placeholder="3000"
              style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              Aportación mensual planificada (USD)
            </label>
            <input
              type="number"
              value={form.monthly_contribution}
              onChange={(e) => setForm((f) => ({ ...f, monthly_contribution: e.target.value }))}
              className="w-full rounded-xl border px-4 py-3 text-sm outline-none"
              placeholder="300"
              style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
            />
          </div>
        </div>
      ),
    },
    // 2 — Meta financiera con montos exactos
    {
      title: "Tu meta financiera",
      subtitle: "OBJETIVOS",
      valid: () => {
        const amt = parseFloat(form.investment_amount);
        const goal = parseFloat(form.investment_goal_amount);
        return amt > 0 && goal > 0 && !!form.investment_goal && !!form.knowledge_level;
      },
      content: (
        <div className="space-y-5">
          {/* Capital disponible */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              ¿Cuánto tienes disponible para invertir hoy?
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold" style={{ color: "var(--muted)" }}>$</span>
              <input
                type="number"
                min={0}
                value={form.investment_amount}
                onChange={(e) => setForm((f) => ({ ...f, investment_amount: e.target.value }))}
                className="w-full rounded-xl border px-4 py-3 pl-7 text-sm outline-none"
                placeholder="5,000"
                style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
              />
            </div>
          </div>

          {/* Meta en dinero */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              ¿A cuánto quieres llegar?
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold" style={{ color: "var(--muted)" }}>$</span>
              <input
                type="number"
                min={0}
                value={form.investment_goal_amount}
                onChange={(e) => setForm((f) => ({ ...f, investment_goal_amount: e.target.value }))}
                className="w-full rounded-xl border px-4 py-3 pl-7 text-sm outline-none"
                placeholder="50,000"
                style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
              />
            </div>
            <p className="text-[10px] mt-1.5" style={{ color: "var(--dim)" }}>
              La app mostrará tu progreso hacia esta meta en tiempo real.
            </p>
          </div>

          {/* Tipo de meta */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              ¿Para qué es esta meta?
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "emergency_fund", label: "Fondo de emergencia" },
                { value: "big_purchase",   label: "Compra importante" },
                { value: "retirement",     label: "Retiro / pensión" },
                { value: "independence",   label: "Independencia financiera" },
              ].map((opt) => {
                const active = form.investment_goal === opt.value;
                return (
                  <button key={opt.value} onClick={() => setForm((f) => ({ ...f, investment_goal: opt.value }))}
                          className="p-2.5 rounded-xl border-2 text-xs font-semibold text-left transition-all"
                          style={{
                            borderColor: active ? "var(--accent)" : "var(--border)",
                            background:  active ? "rgba(0,168,94,0.10)" : "var(--raised)",
                            color: active ? "var(--accent-l)" : "var(--sub)",
                          }}>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Nivel de conocimiento */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              ¿Cómo describes tu experiencia con inversiones?
            </label>
            <div className="space-y-1.5">
              {[
                { value: "A", label: "Sin experiencia — empiezo de cero" },
                { value: "B", label: "Conozco lo básico (CETES, fondos indexados)" },
                { value: "C", label: "Tengo experiencia (ETFs, acciones)" },
                { value: "D", label: "Avanzado — análisis, derivados, ciclos" },
              ].map((opt) => {
                const active = form.knowledge_level === opt.value;
                return (
                  <button key={opt.value} onClick={() => setForm((f) => ({ ...f, knowledge_level: opt.value as QuizAnswer }))}
                          className="w-full text-left px-3 py-2.5 rounded-xl border-2 transition-all flex items-center gap-2.5"
                          style={{
                            borderColor: active ? "var(--accent)" : "var(--border)",
                            background:  active ? "rgba(0,168,94,0.10)" : "var(--raised)",
                          }}>
                    <span className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-black shrink-0"
                          style={{ background: active ? "var(--accent)" : "var(--border)", color: active ? "#fff" : "var(--muted)" }}>
                      {opt.value}
                    </span>
                    <span className="text-xs leading-snug" style={{ color: active ? "var(--text)" : "var(--sub)" }}>
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ),
    },
    // 3-7 — Quiz (5 preguntas)
    ...quizSteps,
    // 7 — Reveal
    {
      title: `Tu perfil, ${firstName || "!"}`,
      subtitle: "Analizamos tus respuestas para determinar tu perfil de inversionista real",
      valid: () => true,
      content: (
        <div className="space-y-4">
          {/* Risk card */}
          <div className="rounded-2xl border p-5 text-center" style={{ background: "var(--raised)", borderColor: riskCfg.color + "55" }}>
            <div className="text-4xl mb-2">{riskCfg.emoji}</div>
            <div className="text-lg font-black mb-1" style={{ color: "var(--text)" }}>{riskCfg.label}</div>
            <div className="text-xs mb-4" style={{ color: "var(--muted)" }}>{riskCfg.desc}</div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${riskCfg.pct}%`, background: riskCfg.color }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px]" style={{ color: "var(--dim)" }}>Bajo riesgo</span>
              <span className="text-[10px]" style={{ color: "var(--dim)" }}>Alto riesgo</span>
            </div>
          </div>

          {/* Quiz summary */}
          <div className="rounded-xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Resumen de tus respuestas</p>
            </div>
            {QUIZ.filter((q) => q.key === "q1" || q.key === "q4").map((q) => {
              const answer = form[q.key as "q1" | "q4"] as QuizAnswer;
              return (
                <div key={q.key} className="flex items-center justify-between px-4 py-2.5 border-b last:border-0"
                     style={{ borderColor: "var(--border)" }}>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{q.category}</span>
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-black text-white"
                          style={{ background: "var(--accent)" }}>{answer}</span>
                    <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                      {answer ? QUIZ_LABELS[q.key][answer] : "—"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Financial summary */}
          <div className="rounded-xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Datos financieros</p>
            </div>
            {[
              { label: "Nombre",     value: form.name },
              { label: "Edad",       value: `${currentAge} años` },
              { label: "Ingresos",   value: `$${Number(form.monthly_income).toLocaleString()} / mes` },
              { label: "Aportación", value: `$${Number(form.monthly_contribution).toLocaleString()} / mes` },
            ].map((f) => (
              <div key={f.label} className="flex items-center justify-between px-4 py-2.5 border-b last:border-0"
                   style={{ borderColor: "var(--border)" }}>
                <span className="text-xs" style={{ color: "var(--muted)" }}>{f.label}</span>
                <span className="text-xs font-medium" style={{ color: "var(--text)" }}>{f.value}</span>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    // 8 — ROI demo
    {
      subtitle: "TU PROYECCIÓN",
      title: `Así crece $${(Number(form.monthly_contribution) || 300).toLocaleString()} / mes`,
      valid: () => true,
      content: (() => {
        const pmt = Math.max(Number(form.monthly_contribution) || 300, 1);
        const annualRate = calculated === "conservative" ? 0.07 : calculated === "moderate" ? 0.10 : 0.12;
        const rateLabel  = calculated === "conservative" ? "7%" : calculated === "moderate" ? "10%" : "12%";
        const r = annualRate / 12;
        const proj = [12, 60, 120].map((months) => {
          const fv = Math.round(pmt * ((Math.pow(1 + r, months) - 1) / r) * (1 + r));
          return { years: months / 12, fv, invested: Math.round(pmt * months) };
        });
        const maxFV = proj[2].fv;
        return (
          <div className="space-y-5">
            {/* Projection bars */}
            <div className="rounded-xl border p-4 space-y-4" style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Proyección ilustrativa</p>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                      style={{ background: riskCfg.color + "20", color: riskCfg.color }}>~{rateLabel}/año</span>
              </div>
              {proj.map(({ years, fv, invested }) => (
                <div key={years}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span style={{ color: "var(--sub)" }}>{years} año{years !== 1 ? "s" : ""}</span>
                    <span className="font-extrabold" style={{ color: "var(--text)" }}>${fv.toLocaleString()}</span>
                  </div>
                  <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                    <div className="absolute inset-y-0 left-0 rounded-full opacity-35"
                         style={{ width: `${(invested / maxFV) * 100}%`, background: riskCfg.color }} />
                    <div className="absolute inset-y-0 left-0 rounded-full"
                         style={{ width: `${(fv / maxFV) * 100}%`, background: riskCfg.color }} />
                  </div>
                  <div className="flex gap-3 mt-1">
                    <span className="text-[10px]" style={{ color: "var(--dim)" }}>Aportado: ${invested.toLocaleString()}</span>
                    <span className="text-[10px] font-semibold" style={{ color: riskCfg.color }}>
                      +${(fv - invested).toLocaleString()} rendimiento
                    </span>
                  </div>
                </div>
              ))}
              <p className="text-[10px] italic" style={{ color: "var(--dim)" }}>
                * Ilustrativo. Basado en promedios históricos del mercado. No garantiza rendimientos futuros.
              </p>
            </div>

            {/* Features */}
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "var(--muted)" }}>
                Nuvos AI trabaja contigo
              </p>
              {[
                { icon: "🤖", title: "IA que conoce tu perfil", sub: "Análisis personalizado según tu tolerancia al riesgo" },
                { icon: "📰", title: "Noticias de tus acciones", sub: "Solo lo relevante para empresas que posees o sigues" },
                { icon: "🔔", title: "Guardian del domingo", sub: "Revisión semanal automática con alertas accionables" },
                { icon: "📄", title: "Paper trading sin riesgo", sub: "Practica estrategias reales sin dinero en juego" },
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

            {/* Value pill */}
            <div className="rounded-xl border p-4 text-center"
                 style={{ background: "rgba(0,168,94,0.06)", borderColor: "rgba(0,168,94,0.25)" }}>
              <p className="text-3xl font-black" style={{ color: "var(--accent-l)" }}>$0.43 / día</p>
              <p className="text-xs mt-1.5" style={{ color: "var(--sub)" }}>
                Nuvos AI Premium · menos que un café ☕
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--dim)" }}>
                $12.99/mes · cancela cuando quieras
              </p>
            </div>
          </div>
        );
      })(),
    },
    {
      subtitle: "AVISO LEGAL",
      title: "Antes de empezar",
      valid: () => acceptedTerms && acceptedDisclaimer,
      content: (
        <div className="space-y-4">
          {/* Financial disclaimer box */}
          <div className="rounded-xl border p-4 space-y-2"
               style={{ background: "rgba(245,158,11,0.07)", borderColor: "rgba(245,158,11,0.3)" }}>
            <p className="text-xs font-black uppercase tracking-widest" style={{ color: "#f59e0b" }}>
              ⚠️ Herramienta educativa — no asesoría financiera
            </p>
            <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>
              Nuvos AI es una plataforma de <strong style={{ color: "var(--text)" }}>educación e información financiera</strong>.
              El análisis generado por la IA, los portafolios simulados, las noticias y el paper trading
              son <strong style={{ color: "var(--text)" }}>únicamente educativos</strong> y no constituyen
              asesoramiento financiero, de inversión, legal ni fiscal regulado.
            </p>
            <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>
              Los datos de mercado pueden ser inexactos o retrasados. El rendimiento pasado no
              garantiza resultados futuros. <strong style={{ color: "var(--text)" }}>Nunca tomes decisiones
              de inversión basándote únicamente en esta app.</strong> Consulta siempre a un asesor
              financiero certificado antes de invertir.
            </p>
          </div>

          {/* Checkboxes */}
          <label className="flex items-start gap-3 cursor-pointer group">
            <div className="mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all"
                 style={{
                   borderColor: acceptedTerms ? "var(--accent)" : "var(--border)",
                   background: acceptedTerms ? "var(--accent)" : "transparent",
                 }}
                 onClick={() => setAcceptedTerms((v) => !v)}>
              {acceptedTerms && <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </div>
            <span className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>
              He leído y acepto los{" "}
              <a href="/terms" target="_blank" style={{ color: "var(--accent-l)", textDecoration: "underline" }}>
                Términos de Uso
              </a>
              {" "}y la{" "}
              <a href="/privacy" target="_blank" style={{ color: "var(--accent-l)", textDecoration: "underline" }}>
                Política de Privacidad
              </a>
              .
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <div className="mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all"
                 style={{
                   borderColor: acceptedDisclaimer ? "var(--accent)" : "var(--border)",
                   background: acceptedDisclaimer ? "var(--accent)" : "transparent",
                 }}
                 onClick={() => setAcceptedDisclaimer((v) => !v)}>
              {acceptedDisclaimer && <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </div>
            <span className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>
              Entiendo que Nuvos AI es una herramienta educativa y{" "}
              <strong style={{ color: "var(--text)" }}>NO constituye asesoría financiera regulada</strong>.
              Soy responsable de mis propias decisiones de inversión.
            </span>
          </label>
        </div>
      ),
    },
  ];

  const current    = STEPS[step];
  const isLastStep = step === STEPS.length - 1;

  const handleNext = async () => {
    if (!isLastStep) { setStep(step + 1); return; }
    setLoading(true); setError("");
    try {
      const payload = {
        name:                    form.name.trim(),
        birth_date:              form.birth_date,
        monthly_income:          form.monthly_income,
        monthly_contribution:    form.monthly_contribution,
        investment_amount:       form.investment_amount,
        investment_goal:         form.investment_goal,
        investment_goal_amount:  form.investment_goal_amount,
        knowledge_level:         form.knowledge_level,
        risk_tolerance:          calculated,
        quiz_answers:            quizAnswers,
      };
      const res = await profileApi.create(payload);
      setProfile(res.data);
      // Trigger first-steps flow for principiante on next page visit
      if (form.knowledge_level === "A") {
        localStorage.setItem("nuvos_first_steps_active", "1");
      }
      setSuccess(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Error al guardar el perfil.");
    } finally {
      setLoading(false);
    }
  };

  // ── Success screen ──────────────────────────────────────────────────────────
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
          <div className="rounded-2xl border p-4 mb-6 text-left space-y-3" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="flex items-center gap-3">
              <span className="text-xl">{riskCfg.emoji}</span>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Perfil de riesgo</div>
                <div className="text-sm font-semibold" style={{ color: riskCfg.color }}>{riskCfg.label}</div>
              </div>
            </div>
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
            <button
              onClick={() => { if (step === 0) { clearAuth(); router.push("/"); } else setStep(step - 1); }}
              className="flex items-center gap-1.5 px-4 py-3 border rounded-xl text-sm font-medium transition-colors"
              style={{ borderColor: "var(--border)", color: "var(--sub)" }}>
              <ChevronLeft className="w-4 h-4" /> Atrás
            </button>
            <button
              onClick={handleNext}
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
