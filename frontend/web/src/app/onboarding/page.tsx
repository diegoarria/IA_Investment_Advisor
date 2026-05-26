"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { profile as profileApi } from "@/lib/api";
import { useProfileStore, useAuthStore, useSubscriptionStore } from "@/lib/store";
import PaywallModal from "@/components/PaywallModal";
import { TrendingUp, ChevronRight, ChevronLeft, Lock } from "lucide-react";

const QUIZ = [
  {
    key: "q1", label: "Si el mercado cae 20%, ¿qué harías?",
    options: [
      { value: "A", label: "Vender para evitar más pérdidas" },
      { value: "B", label: "Esperar sin hacer nada" },
      { value: "C", label: "Analizar y mantener" },
      { value: "D", label: "Comprar más aprovechando la caída" },
    ],
  },
  {
    key: "q2", label: "¿Cuál es tu horizonte de inversión?",
    options: [
      { value: "A", label: "Menos de 2 años" },
      { value: "B", label: "3–5 años" },
      { value: "C", label: "10+ años" },
      { value: "D", label: "Largo plazo indefinido" },
    ],
  },
  {
    key: "q3", label: "¿Cómo describes tu conocimiento de inversiones?",
    options: [
      { value: "A", label: "Principiante total" },
      { value: "B", label: "Conozco lo básico" },
      { value: "C", label: "Nivel intermedio" },
      { value: "D", label: "Avanzado" },
    ],
  },
  {
    key: "q4", label: "¿Qué perfil de riesgo/retorno prefieres?",
    options: [
      { value: "A", label: "$5K con certeza" },
      { value: "B", label: "$15K con posibilidad de perder $5K" },
      { value: "C", label: "$40K con posibilidad de perder $20K" },
      { value: "D", label: "$120K con posibilidad de perder todo" },
    ],
  },
  {
    key: "q5", label: "¿Con qué frecuencia gestionas tus inversiones?",
    options: [
      { value: "A", label: "Automático / pasivo" },
      { value: "B", label: "Revisión mensual" },
      { value: "C", label: "Revisión semanal" },
      { value: "D", label: "Gestión diaria activa" },
    ],
  },
];

const RISK_MAP: Record<string, string> = {
  AAAAA: "conservative", AAAAB: "conservative", AAABA: "conservative",
  AAABB: "conservative_moderate", AABAA: "conservative_moderate",
  AABBA: "moderate", AABBB: "moderate", ABAAA: "moderate",
  ABABA: "moderate_growth", ABBAA: "moderate_growth", ABBBA: "growth",
  BAAAA: "moderate", BABAA: "moderate_growth", BABBA: "growth",
  BBAAA: "growth", BBABA: "aggressive", BBBAA: "aggressive",
  BBBBA: "aggressive_speculative", BBBBB: "speculative",
  CAAAA: "moderate_growth", CABAA: "growth", CBABA: "aggressive",
  DAAAA: "aggressive", DABBA: "aggressive_speculative", DBBBB: "speculative",
};

function calcRisk(q: Record<string, string>): string {
  const key = ["q1","q2","q3","q4","q5"].map((k) => q[k] || "A").join("");
  return RISK_MAP[key] ?? (
    key.split("").filter((c) => c === "D").length >= 3 ? "speculative" :
    key.split("").filter((c) => c >= "C").length >= 3 ? "aggressive" :
    key.split("").filter((c) => c >= "B").length >= 3 ? "moderate" : "conservative"
  );
}

const MENTORS = [
  {
    id: "Warren Buffett",
    photo: "/mentors/warren_buffett.jpg",
    desc: "Value investing, largo plazo",
    premium: true,
  },
  {
    id: "Ray Dalio",
    photo: "/mentors/ray_dalio.jpg",
    desc: "Macro, diversificación",
    premium: true,
  },
  {
    id: "Bill Ackman",
    photo: "/mentors/bill_ackman.jpg",
    desc: "Activismo, concentrado",
    premium: true,
  },
  {
    id: "none",
    photo: null,
    desc: "Sin mentor específico",
    premium: false,
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { setProfile } = useProfileStore();
  const { isAuthenticated } = useAuthStore();
  const { tier } = useSubscriptionStore();
  const isPremium = tier === "premium";

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [paywallOpen, setPaywallOpen] = useState(false);

  const [form, setForm] = useState({
    name: "", birth_date: "", monthly_income: "", monthly_contribution: "",
    quiz: {} as Record<string, string>,
    mentor: "none",
  });

  if (!isAuthenticated) { router.push("/"); return null; }

  const STEPS = [
    {
      title: "¿Cómo te llamas?",
      subtitle: "Tu nombre y fecha de nacimiento",
      valid: () => !!form.name.trim() && !!form.birth_date,
      content: (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--sub)" }}>Nombre</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                   className="w-full rounded-xl border px-4 py-3 text-sm outline-none"
                   placeholder="Tu nombre" style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--sub)" }}>Fecha de nacimiento</label>
            <input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
                   className="w-full rounded-xl border px-4 py-3 text-sm outline-none"
                   style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }} />
          </div>
        </div>
      ),
    },
    {
      title: "Situación financiera",
      subtitle: "¿Cuánto ganas y cuánto puedes invertir al mes?",
      valid: () => !!form.monthly_income && !!form.monthly_contribution,
      content: (
        <div className="space-y-4">
          {[
            { key: "monthly_income", label: "Ingresos mensuales (USD)", placeholder: "3000" },
            { key: "monthly_contribution", label: "Aportación mensual (USD)", placeholder: "300" },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--sub)" }}>{label}</label>
              <input type="number" min="0"
                     value={form[key as "monthly_income" | "monthly_contribution"]}
                     onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                     className="w-full rounded-xl border px-4 py-3 text-sm outline-none"
                     placeholder={placeholder}
                     style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }} />
            </div>
          ))}
        </div>
      ),
    },
    ...QUIZ.map((q, qi) => ({
      title: `Pregunta ${qi + 1} de ${QUIZ.length}`,
      subtitle: q.label,
      valid: () => !!form.quiz[q.key],
      content: (
        <div className="space-y-2">
          {q.options.map(({ value, label }) => {
            const active = form.quiz[q.key] === value;
            return (
              <button key={value} onClick={() => setForm({ ...form, quiz: { ...form.quiz, [q.key]: value } })}
                      className="w-full text-left p-4 rounded-xl border transition-all text-sm"
                      style={{
                        borderColor: active ? "var(--accent)" : "var(--border)",
                        background: active ? "rgba(0,168,94,0.1)" : "var(--raised)",
                        color: active ? "var(--text)" : "var(--sub)",
                      }}>
                <span className="font-bold mr-2" style={{ color: "var(--accent)" }}>{value}</span>
                {label}
              </button>
            );
          })}
        </div>
      ),
    })),
    {
      title: "Elige tu mentor",
      subtitle: "Cada mentor tiene su propia filosofía de inversión",
      valid: () => true,
      content: (
        <div className="space-y-2">
          {MENTORS.map(({ id, photo, desc, premium: needsPremium }) => {
            const active = form.mentor === id;
            const locked = needsPremium && !isPremium;
            return (
              <button
                key={id}
                onClick={() => {
                  if (locked) { setPaywallOpen(true); return; }
                  setForm({ ...form, mentor: id });
                }}
                className="w-full text-left p-4 rounded-xl border transition-all"
                style={{
                  borderColor: active ? "var(--accent)" : "var(--border)",
                  background: active ? "rgba(0,168,94,0.1)" : "var(--raised)",
                  opacity: locked ? 0.65 : 1,
                }}>
                <div className="flex items-center gap-3">
                  {photo ? (
                    <div className="relative w-10 h-10 rounded-full overflow-hidden shrink-0 border"
                         style={{ borderColor: active ? "var(--accent)" : "var(--border)" }}>
                      <Image src={photo} alt={id} fill className="object-cover" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                         style={{ background: "var(--border)" }}>
                      <TrendingUp className="w-5 h-5" style={{ color: "var(--muted)" }} />
                    </div>
                  )}
                  <div className="flex-1">
                    <div className="text-sm font-semibold" style={{ color: active ? "var(--text)" : "var(--sub)" }}>
                      {id === "none" ? "Sin mentor" : id}
                    </div>
                    <div className="text-xs" style={{ color: "var(--muted)" }}>{desc}</div>
                  </div>
                  {locked && (
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0"
                         style={{ background: "rgba(245,183,58,0.15)", color: "#f5b73a" }}>
                      <Lock className="w-2.5 h-2.5" />
                      Premium
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ),
    },
  ];

  const current = STEPS[step];

  const handleNext = async () => {
    if (step < STEPS.length - 1) { setStep(step + 1); return; }
    setLoading(true); setError("");
    try {
      const risk = calcRisk(form.quiz);
      const payload = {
        name: form.name.trim(),
        birth_date: form.birth_date,
        monthly_income: form.monthly_income,
        monthly_contribution: form.monthly_contribution,
        risk_tolerance: risk,
        quiz_answers: form.quiz,
        mentor: form.mentor === "none" ? null : form.mentor,
      };
      const res = await profileApi.create(payload);
      setProfile(res.data);
      router.push("/chat");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Error al guardar el perfil.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2 mb-8">
          <Image src="/logo.jpg" alt="Nuvos AI" width={32} height={32} className="rounded-lg object-cover" />
          <span className="font-bold" style={{ color: "var(--text)" }}>Nuvos AI — Configurando tu perfil</span>
        </div>

        <div className="flex gap-1 mb-6">
          {STEPS.map((_, i) => (
            <div key={i} className="h-1 flex-1 rounded-full transition-all"
                 style={{ background: i <= step ? "var(--accent)" : "var(--border)" }} />
          ))}
        </div>

        <div className="rounded-2xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <h2 className="text-xl font-bold mb-1" style={{ color: "var(--text)" }}>{current.title}</h2>
          <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>{current.subtitle}</p>

          {current.content}

          {error && (
            <div className="mt-4 rounded-xl px-4 py-3 text-sm"
                 style={{ background: "rgba(255,71,87,0.1)", border: "1px solid rgba(255,71,87,0.3)", color: "var(--down)" }}>
              {error}
            </div>
          )}

          <div className="flex gap-3 mt-6">
            {step > 0 && (
              <button onClick={() => setStep(step - 1)}
                      className="flex items-center gap-2 px-4 py-3 border rounded-xl text-sm font-medium transition-colors"
                      style={{ borderColor: "var(--border)", color: "var(--sub)" }}>
                <ChevronLeft className="w-4 h-4" /> Atrás
              </button>
            )}
            <button onClick={handleNext} disabled={!current.valid() || loading}
                    className="flex-1 flex items-center justify-center gap-2 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-40"
                    style={{ background: "var(--accent)" }}>
              {loading ? "Guardando..." : step === STEPS.length - 1 ? "Comenzar" : "Siguiente"}
              {!loading && <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <p className="text-center text-xs mt-3" style={{ color: "var(--dim)" }}>Paso {step + 1} de {STEPS.length}</p>
      </div>

      <PaywallModal
        visible={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        reason="Los mentores de inversión son exclusivos de Premium"
      />
    </div>
  );
}
