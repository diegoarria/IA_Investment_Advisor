"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { profile as profileApi } from "@/lib/api";
import { useProfileStore, useAuthStore } from "@/lib/store";
import type { RiskTolerance, InvestmentExperience, InvestmentGoal } from "@/lib/types";
import { TrendingUp, ChevronRight, ChevronLeft } from "lucide-react";

const GOALS: { value: InvestmentGoal; label: string; desc: string }[] = [
  { value: "capital_preservation", label: "Preservar capital", desc: "Proteger lo que tengo" },
  { value: "income", label: "Generar ingresos", desc: "Dividendos y flujo de caja" },
  { value: "growth", label: "Crecimiento", desc: "Aumentar mi patrimonio" },
  { value: "aggressive_growth", label: "Crecimiento agresivo", desc: "Máximo retorno, acepto riesgo" },
  { value: "retirement", label: "Retiro / Jubilación", desc: "Largo plazo, seguridad futura" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { setProfile } = useProfileStore();
  const { isAuthenticated } = useAuthStore();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    age: "",
    monthly_income: "",
    risk_tolerance: "" as RiskTolerance | "",
    investment_experience: "" as InvestmentExperience | "",
    time_horizon_years: "",
    investment_goals: [] as InvestmentGoal[],
    initial_capital: "",
    monthly_savings: "",
    financial_concerns: "",
  });

  if (!isAuthenticated) {
    router.push("/");
    return null;
  }

  const toggleGoal = (goal: InvestmentGoal) => {
    setForm((f) => ({
      ...f,
      investment_goals: f.investment_goals.includes(goal)
        ? f.investment_goals.filter((g) => g !== goal)
        : [...f.investment_goals, goal],
    }));
  };

  const steps = [
    {
      title: "Sobre ti",
      subtitle: "Cuéntanos un poco sobre tu situación",
      content: (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Tu edad</label>
            <input
              type="number"
              value={form.age}
              onChange={(e) => setForm({ ...form, age: e.target.value })}
              className="input-field"
              placeholder="35"
              min={18}
              max={100}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Ingresos mensuales (USD)</label>
            <input
              type="number"
              value={form.monthly_income}
              onChange={(e) => setForm({ ...form, monthly_income: e.target.value })}
              className="input-field"
              placeholder="3000"
              min={0}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Capital inicial disponible (opcional)</label>
            <input
              type="number"
              value={form.initial_capital}
              onChange={(e) => setForm({ ...form, initial_capital: e.target.value })}
              className="input-field"
              placeholder="10000"
              min={0}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Ahorro mensual disponible (opcional)</label>
            <input
              type="number"
              value={form.monthly_savings}
              onChange={(e) => setForm({ ...form, monthly_savings: e.target.value })}
              className="input-field"
              placeholder="500"
              min={0}
            />
          </div>
        </div>
      ),
      isValid: () => !!form.age && !!form.monthly_income,
    },
    {
      title: "Tu experiencia",
      subtitle: "¿Cuánto sabes de inversiones?",
      content: (
        <div className="space-y-3">
          {([
            { value: "beginner", label: "Principiante", desc: "Nunca he invertido o llevo menos de 1 año" },
            { value: "intermediate", label: "Intermedio", desc: "Tengo experiencia básica, conozco acciones y ETFs" },
            { value: "advanced", label: "Avanzado", desc: "Manejo conceptos como ratios financieros, análisis técnico" },
          ] as const).map(({ value, label, desc }) => (
            <button
              key={value}
              onClick={() => setForm({ ...form, investment_experience: value })}
              className={`w-full text-left p-4 rounded-xl border transition-all ${
                form.investment_experience === value
                  ? "border-brand-500 bg-brand-500/10 text-white"
                  : "border-[#2a2d3a] bg-[#1a1d27] text-gray-300 hover:border-gray-500"
              }`}
            >
              <div className="font-semibold">{label}</div>
              <div className="text-sm text-gray-400 mt-0.5">{desc}</div>
            </button>
          ))}
        </div>
      ),
      isValid: () => !!form.investment_experience,
    },
    {
      title: "Tolerancia al riesgo",
      subtitle: "¿Cómo te sentirías si tu inversión cae 30%?",
      content: (
        <div className="space-y-3">
          {([
            { value: "conservative", label: "Conservador", desc: "Me preocuparía mucho. Prefiero menor retorno con más seguridad.", emoji: "🛡️" },
            { value: "moderate", label: "Moderado", desc: "Me incomodaría, pero entendería que es parte del proceso.", emoji: "⚖️" },
            { value: "aggressive", label: "Agresivo", desc: "Lo vería como oportunidad. Acepto alta volatilidad por mayor retorno.", emoji: "🚀" },
          ] as const).map(({ value, label, desc, emoji }) => (
            <button
              key={value}
              onClick={() => setForm({ ...form, risk_tolerance: value })}
              className={`w-full text-left p-4 rounded-xl border transition-all ${
                form.risk_tolerance === value
                  ? "border-brand-500 bg-brand-500/10 text-white"
                  : "border-[#2a2d3a] bg-[#1a1d27] text-gray-300 hover:border-gray-500"
              }`}
            >
              <div className="font-semibold">{emoji} {label}</div>
              <div className="text-sm text-gray-400 mt-0.5">{desc}</div>
            </button>
          ))}
        </div>
      ),
      isValid: () => !!form.risk_tolerance,
    },
    {
      title: "Objetivos y horizonte",
      subtitle: "¿Qué buscas y a cuánto plazo?",
      content: (
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Horizonte de inversión</label>
            <select
              value={form.time_horizon_years}
              onChange={(e) => setForm({ ...form, time_horizon_years: e.target.value })}
              className="input-field"
            >
              <option value="">Selecciona...</option>
              <option value="1">Menos de 1 año</option>
              <option value="3">1–3 años</option>
              <option value="5">3–5 años</option>
              <option value="10">5–10 años</option>
              <option value="20">Más de 10 años</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Tus objetivos (selecciona todos los que aplican)</label>
            <div className="space-y-2">
              {GOALS.map(({ value, label, desc }) => (
                <button
                  key={value}
                  onClick={() => toggleGoal(value)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    form.investment_goals.includes(value)
                      ? "border-brand-500 bg-brand-500/10 text-white"
                      : "border-[#2a2d3a] bg-[#1a1d27] text-gray-300 hover:border-gray-500"
                  }`}
                >
                  <span className="font-medium">{label}</span>
                  <span className="text-gray-400 text-sm ml-2">— {desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ),
      isValid: () => !!form.time_horizon_years && form.investment_goals.length > 0,
    },
    {
      title: "Último paso",
      subtitle: "¿Hay algo más que debamos saber?",
      content: (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              ¿Qué te preocupa más de invertir? (opcional)
            </label>
            <textarea
              value={form.financial_concerns}
              onChange={(e) => setForm({ ...form, financial_concerns: e.target.value })}
              className="input-field resize-none h-28"
              placeholder="Ej: Tengo miedo de perder dinero, no sé por dónde empezar, me confunden los términos técnicos..."
            />
          </div>
          <div className="bg-brand-500/10 border border-brand-500/30 rounded-xl p-4">
            <p className="text-brand-400 text-sm font-medium mb-1">¿Qué pasa ahora?</p>
            <p className="text-gray-300 text-sm">
              Con tu perfil, nuestro asesor IA personaliza cada análisis, explicación y escenario específicamente para ti.
              Cuanto más interactúas, más evoluciona tu mentor.
            </p>
          </div>
        </div>
      ),
      isValid: () => true,
    },
  ];

  const current = steps[step];

  const handleNext = async () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      await handleSubmit();
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = {
        age: parseInt(form.age),
        monthly_income: parseFloat(form.monthly_income),
        risk_tolerance: form.risk_tolerance,
        investment_experience: form.investment_experience,
        time_horizon_years: parseInt(form.time_horizon_years),
        investment_goals: form.investment_goals,
        ...(form.initial_capital && { initial_capital: parseFloat(form.initial_capital) }),
        ...(form.monthly_savings && { monthly_savings: parseFloat(form.monthly_savings) }),
        ...(form.financial_concerns && { financial_concerns: form.financial_concerns }),
      };
      const res = await profileApi.create(payload);
      setProfile(res.data);
      router.push("/chat");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Error al guardar tu perfil. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <style>{`.input-field { width: 100%; background: #1a1d27; border: 1px solid #2a2d3a; border-radius: 12px; padding: 12px 16px; color: white; outline: none; transition: border-color 0.2s; } .input-field:focus { border-color: #22c55e; } .input-field option { background: #1a1d27; }`}</style>

      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white">Configurando tu perfil</span>
        </div>

        <div className="flex gap-1 mb-8">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-all ${i <= step ? "bg-brand-500" : "bg-[#2a2d3a]"}`}
            />
          ))}
        </div>

        <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-2xl p-6">
          <h2 className="text-xl font-bold text-white mb-1">{current.title}</h2>
          <p className="text-gray-400 text-sm mb-6">{current.subtitle}</p>

          {current.content}

          {error && (
            <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 mt-6">
            {step > 0 && (
              <button
                onClick={() => setStep(step - 1)}
                className="flex items-center gap-2 px-4 py-3 border border-[#2a2d3a] rounded-xl text-gray-300 hover:border-gray-500 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Atrás
              </button>
            )}
            <button
              onClick={handleNext}
              disabled={!current.isValid() || loading}
              className="flex-1 flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
            >
              {loading ? "Guardando..." : step === steps.length - 1 ? "Comenzar" : "Siguiente"}
              {!loading && <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <p className="text-center text-gray-500 text-xs mt-4">
          Paso {step + 1} de {steps.length}
        </p>
      </div>
    </div>
  );
}
