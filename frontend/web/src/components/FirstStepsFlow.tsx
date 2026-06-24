"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus, TrendingUp, MessageSquare, X, ChevronRight, ExternalLink, Clock } from "lucide-react";

const STORAGE_KEY        = "nuvos_first_steps_active";
const UPSELL_SEEN_KEY    = "nuvos_broker_upsell_seen_at";
const UPSELL_DURATION_MS = 24 * 60 * 60 * 1000; // 24 h

// Country → broker list
const BROKERS: Record<string, { label: string; items: string[] }> = {
  MX: { label: "México",          items: ["GBM+", "Actinver", "Interactive Brokers México"] },
  AR: { label: "Argentina",       items: ["Invertir Online (IOL)", "Balanz"] },
  US: { label: "Estados Unidos",  items: ["Interactive Brokers", "Robinhood", "Charles Schwab"] },
  CO: { label: "Colombia",        items: ["Acciones & Valores", "Davivienda Corredores", "Interactive Brokers"] },
  VE: { label: "Venezuela",       items: ["Interactive Brokers", "Charles Schwab"] },
  CL: { label: "Chile",           items: ["Fintual", "Banchile Inversiones", "Interactive Brokers"] },
  PE: { label: "Perú",            items: ["Credicorp Capital", "Renta 4", "Interactive Brokers"] },
  BR: { label: "Brasil",          items: ["XP Investimentos", "BTG Pactual", "Interactive Brokers"] },
};
const DEFAULT_BROKERS = { label: "Internacional", items: ["Interactive Brokers"] };

// Calendly / WhatsApp link for the upsell CTA
const CALL_LINK = "https://calendly.com/nuvosai/onboarding";

const BASE_STEPS = [
  {
    num: 1, icon: Plus, color: "#00a85e",
    title: "Agrega tu primera posición",
    desc: "Busca una empresa que conozcas — Apple, Tesla, Amazon — y agrégala a tu portafolio simulado. No hay dinero real involucrado.",
    cta: "Agregar posición ahora", ctaAction: "add",
  },
  {
    num: 2, icon: TrendingUp, color: "#3b82f6",
    title: "Así se ve tu portafolio",
    desc: "Cuando agregas una posición, la app rastrea su precio en tiempo real y te muestra cuánto valdría tu inversión hoy. Todo simulado, sin riesgo.",
    cta: "Entendido, siguiente", ctaAction: "next",
  },
  {
    num: 3, icon: MessageSquare, color: "#8b5cf6",
    title: "Hazle tu primera pregunta al mentor",
    desc: "El mentor de IA conoce tu perfil. Pregúntale algo concreto: ¿Es buen momento para comprar? ¿Qué riesgo tiene esta empresa?",
    cta: "Ir al chat con el mentor", ctaAction: "chat",
  },
] as const;

const TOTAL_STEPS = BASE_STEPS.length + 1; // +1 for broker step

interface Props {
  onOpenAddPosition: () => void;
}

function fmt(ms: number) {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function FirstStepsFlow({ onOpenAddPosition }: Props) {
  const router = useRouter();
  const [active, setActive]           = useState(false);
  const [step, setStep]               = useState(0);
  const [showUpsell, setShowUpsell]   = useState(false);
  const [brokers, setBrokers]         = useState(DEFAULT_BROKERS);
  const [countdown, setCountdown]     = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1") {
      setActive(true);
    }
  }, []);

  // Detect country via IP (only when broker step becomes visible)
  useEffect(() => {
    if (!active || step !== 3) return;
    fetch("https://ipapi.co/json/")
      .then(r => r.json())
      .then(d => {
        const code = d.country_code as string;
        setBrokers(BROKERS[code] ?? DEFAULT_BROKERS);
      })
      .catch(() => {});
  }, [active, step]);

  // Start / resume countdown when upsell is first seen
  useEffect(() => {
    if (!showUpsell) return;

    let seenAt = localStorage.getItem(UPSELL_SEEN_KEY);
    if (!seenAt) {
      seenAt = String(Date.now());
      localStorage.setItem(UPSELL_SEEN_KEY, seenAt);
    }

    const tick = () => {
      const elapsed = Date.now() - Number(seenAt);
      const remaining = UPSELL_DURATION_MS - elapsed;
      setCountdown(remaining > 0 ? remaining : 0);
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [showUpsell]);

  const dismiss = () => {
    localStorage.removeItem(STORAGE_KEY);
    setActive(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const handleCta = (action: string) => {
    if (action === "add")    { onOpenAddPosition(); setStep(1); }
    else if (action === "next")   { setStep(2); }
    else if (action === "chat")   { dismiss(); router.push("/chat"); }
    else if (action === "broker") { setStep(3); }
  };

  if (!active) return null;

  const color = step < 3 ? BASE_STEPS[step].color : "#f59e0b";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
         style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-sm rounded-2xl overflow-hidden"
           style={{ background: "var(--card)", border: "1px solid var(--border)" }}>

        {/* Progress bar */}
        <div className="flex gap-1 p-4 pb-0">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div key={i} className="h-1 flex-1 rounded-full transition-all duration-300"
                 style={{ background: step >= i ? color : "var(--border)" }} />
          ))}
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>
            Paso {step + 1} de {TOTAL_STEPS}
          </span>
          <button onClick={dismiss} className="p-1 rounded-lg hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" style={{ color: "var(--dim)" }} />
          </button>
        </div>

        {/* ── Steps 1–3 ── */}
        {step < 3 && (() => {
          const current = BASE_STEPS[step];
          const Icon = current.icon;
          return (
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
              <button onClick={dismiss} className="w-full text-center py-2 mt-2 text-xs"
                      style={{ color: "var(--dim)" }}>
                Saltar guía
              </button>
            </div>
          );
        })()}

        {/* ── Step 4: Broker ── */}
        {step === 3 && !showUpsell && (
          <div className="px-4 pb-5">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                 style={{ background: "rgba(245,158,11,0.12)" }}>
              <span className="text-2xl">🏦</span>
            </div>
            <h2 className="text-lg font-bold mb-1 leading-snug" style={{ color: "var(--text)" }}>
              Abre tu cuenta en un broker
            </h2>
            <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>
              Detectamos que estás en <span className="font-bold" style={{ color: "#f59e0b" }}>{brokers.label}</span>. Estas son tus mejores opciones:
            </p>

            <div className="flex flex-col gap-2 mb-4">
              {brokers.items.map((b) => (
                <div key={b} className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                     style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.2)" }}>
                  <span className="text-sm" style={{ color: "#f59e0b" }}>✦</span>
                  <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>{b}</span>
                </div>
              ))}
            </div>

            <button onClick={dismiss}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm text-white transition-opacity hover:opacity-90"
                    style={{ background: "#f59e0b" }}>
              Ya tengo una cuenta, ¡listo!
              <ChevronRight className="w-4 h-4" />
            </button>
            <button onClick={() => setShowUpsell(true)}
                    className="w-full text-center py-2.5 mt-2 text-xs font-medium rounded-xl transition-colors hover:bg-white/5"
                    style={{ color: "var(--muted)" }}>
              No sé cómo abrirla / quiero ayuda
            </button>
          </div>
        )}

        {/* ── Step 4: Upsell (call booking) ── */}
        {step === 3 && showUpsell && (
          <div className="px-4 pb-5">
            {/* Countdown */}
            {countdown !== null && countdown > 0 && (
              <div className="flex items-center justify-center gap-2 mb-4 py-2 rounded-xl"
                   style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)" }}>
                <Clock className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />
                <span className="text-xs font-bold" style={{ color: "#ef4444" }}>
                  Oferta expira en {fmt(countdown)}
                </span>
              </div>
            )}
            {countdown === 0 && (
              <div className="flex items-center justify-center mb-4 py-2 rounded-xl"
                   style={{ background: "rgba(107,114,128,0.1)", border: "1px solid var(--border)" }}>
                <span className="text-xs font-bold" style={{ color: "var(--muted)" }}>
                  La oferta especial ha expirado
                </span>
              </div>
            )}

            <div className="rounded-2xl overflow-hidden mb-4"
                 style={{ background: "rgba(0,212,126,0.05)", border: "1px solid rgba(0,212,126,0.2)" }}>
              <div className="px-4 pt-4 pb-3">
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2"
                   style={{ color: "#00d47e" }}>Sesión 1:1 con Nuvos AI</p>
                <h3 className="text-base font-black mb-1 leading-snug" style={{ color: "var(--text)" }}>
                  Te acompañamos a abrir tu cuenta en el broker ideal para ti
                </h3>
                <p className="text-xs leading-relaxed mb-3" style={{ color: "var(--muted)" }}>
                  Un experto de Nuvos te guía paso a paso: qué broker elegir según tu país, cómo depositar tu primer dinero y cómo conectarlo a la app.
                </p>

                {/* Price */}
                <div className="flex items-baseline gap-2 mb-3">
                  <span className="text-2xl font-black" style={{ color: "var(--text)" }}>$49 USD</span>
                  <span className="text-base font-bold line-through" style={{ color: "var(--dim)" }}>$89 USD</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}>
                    -45%
                  </span>
                </div>

                <a href={CALL_LINK} target="_blank" rel="noopener noreferrer"
                   className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl font-bold text-sm text-white transition-opacity hover:opacity-90"
                   style={{ background: "var(--grad-green)", textDecoration: "none" }}>
                  Agendar mi llamada ahora
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>

            <button onClick={dismiss}
                    className="w-full text-center py-2 text-xs"
                    style={{ color: "var(--dim)" }}>
              Lo haré yo solo, gracias
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
