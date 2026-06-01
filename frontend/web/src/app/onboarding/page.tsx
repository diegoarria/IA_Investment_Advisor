"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { profile as profileApi } from "@/lib/api";
import { useProfileStore, useAuthStore, useSubscriptionStore } from "@/lib/store";
import PaywallModal from "@/components/PaywallModal";
import { TrendingUp, ChevronRight, ChevronLeft, Lock } from "lucide-react";

// Paso 2 — objetivos de inversión
const OBJECTIVES = [
  { value: "protect",  emoji: "🛡️", label: "Proteger mis ahorros",     desc: "Priorizo no perder dinero",           risk: "conservative"  },
  { value: "grow",     emoji: "📈", label: "Hacer crecer mi dinero",    desc: "Acepto algo de riesgo por más retorno", risk: "moderate"      },
  { value: "maximize", emoji: "🚀", label: "Maximizar mi retorno",      desc: "Busco el máximo aunque haya riesgo",   risk: "aggressive"    },
];

const MENTORS = [
  { id: "Warren Buffett", photo: "/mentors/warren_buffett.jpg", desc: "Value investing, largo plazo",  premium: true  },
  { id: "Ray Dalio",      photo: "/mentors/ray_dalio.jpg",      desc: "Macro, diversificación",        premium: true  },
  { id: "Bill Ackman",    photo: "/mentors/bill_ackman.jpg",    desc: "Activismo, concentrado",        premium: true  },
  { id: "none",           photo: null,                          desc: "Sin mentor específico",         premium: false },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { setProfile } = useProfileStore();
  const { isAuthenticated, clearAuth } = useAuthStore();
  const { tier } = useSubscriptionStore();
  const isPremium = tier === "premium";

  const [step, setStep]       = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [paywallOpen, setPaywallOpen] = useState(false);

  const [name, setName]           = useState("");
  const [objective, setObjective] = useState("");
  const [mentor, setMentor]       = useState("none");

  if (!isAuthenticated) { router.push("/"); return null; }

  const selectedObj = OBJECTIVES.find((o) => o.value === objective);

  const STEPS = [
    {
      title: "¿Cómo te llamas?",
      subtitle: "Tu nombre para personalizar la experiencia",
      valid: () => name.trim().length >= 2,
      content: (
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: "var(--sub)" }}>Nombre</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border px-4 py-3 text-sm outline-none"
            placeholder="Tu nombre"
            autoFocus
            style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
          />
        </div>
      ),
    },
    {
      title: "¿Cuál es tu objetivo?",
      subtitle: "Esto define cómo tu mentor te aconsejará",
      valid: () => !!objective,
      content: (
        <div className="space-y-2">
          {OBJECTIVES.map((o) => {
            const active = objective === o.value;
            return (
              <button
                key={o.value}
                onClick={() => setObjective(o.value)}
                className="w-full text-left p-4 rounded-xl border-2 transition-all"
                style={{
                  borderColor: active ? "var(--accent)" : "var(--border)",
                  background:  active ? "rgba(0,168,94,0.1)" : "var(--raised)",
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{o.emoji}</span>
                  <div>
                    <div className="font-semibold text-sm" style={{ color: active ? "var(--text)" : "var(--sub)" }}>
                      {o.label}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{o.desc}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ),
    },
    {
      title: "Elige tu mentor",
      subtitle: "Cada mentor tiene su propia filosofía de inversión",
      valid: () => true,
      content: (
        <div className="space-y-2">
          {MENTORS.map(({ id, photo, desc, premium: needsPremium }) => {
            const active  = mentor === id;
            const locked  = needsPremium && !isPremium;
            return (
              <button
                key={id}
                onClick={() => { if (locked) { setPaywallOpen(true); return; } setMentor(id); }}
                className="w-full text-left p-4 rounded-xl border transition-all"
                style={{
                  borderColor: active ? "var(--accent)" : "var(--border)",
                  background:  active ? "rgba(0,168,94,0.1)" : "var(--raised)",
                  opacity: locked ? 0.65 : 1,
                }}
              >
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
                      <Lock className="w-2.5 h-2.5" />Premium
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
      const risk = selectedObj?.risk ?? "moderate";
      const payload = {
        name:                  name.trim(),
        birth_date:            "",
        monthly_income:        "0",
        monthly_contribution:  "0",
        risk_tolerance:        risk,
        quiz_answers:          { objective },
        mentor:                mentor === "none" ? null : mentor,
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

        {/* Progress bar */}
        <div className="flex gap-1.5 mb-6">
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
            <button
              onClick={() => { if (step === 0) { clearAuth(); router.push("/"); } else setStep(step - 1); }}
              className="flex items-center gap-2 px-4 py-3 border rounded-xl text-sm font-medium transition-colors"
              style={{ borderColor: "var(--border)", color: "var(--sub)" }}>
              <ChevronLeft className="w-4 h-4" /> Atrás
            </button>
            <button
              onClick={handleNext}
              disabled={!current.valid() || loading}
              className="flex-1 flex items-center justify-center gap-2 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-40"
              style={{ background: "var(--accent)" }}>
              {loading ? "Guardando..." : step === STEPS.length - 1 ? "Comenzar" : "Siguiente"}
              {!loading && <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <p className="text-center text-xs mt-3" style={{ color: "var(--dim)" }}>
          Paso {step + 1} de {STEPS.length}
        </p>
      </div>

      <PaywallModal
        visible={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        reason="Los mentores de inversión son exclusivos de Premium"
      />
    </div>
  );
}
