"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { TrendingUp, Shield, Brain, ArrowRight, Users } from "lucide-react";

const FEATURES = [
  { icon: Brain,      color: "#a78bfa", title: "IA que te conoce",         desc: "Se adapta a tu perfil de riesgo y comportamiento real" },
  { icon: TrendingUp, color: "#34d399", title: "Análisis personalizado",   desc: "Basado en tu portafolio y objetivos concretos" },
  { icon: Shield,     color: "#60a5fa", title: "Sin conflictos de interés", desc: "Te enseñamos a pensar, no qué comprar" },
];

function JoinContent() {
  const router = useRouter();
  const params = useSearchParams();
  const ref = params.get("ref") ?? "";
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (ref) {
      sessionStorage.setItem("nuvos_ref", ref.toUpperCase());
      setSaved(true);
    }
  }, [ref]);

  const handleJoin = () => router.push("/");

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
         style={{ background: "var(--bg, #0a0a0a)" }}>
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <Image src="/logo.png" alt="Nuvos AI" width={56} height={56} className="rounded-2xl object-cover" />
            <div className="absolute -inset-1 rounded-2xl blur-md opacity-40"
                 style={{ background: "linear-gradient(135deg, #00a85e, #00c87a)" }} />
          </div>
          <h1 className="text-2xl font-black" style={{ color: "var(--text, #fff)" }}>Nuvos AI</h1>
        </div>

        {/* Invite badge */}
        {saved && (
          <div className="flex items-center gap-2 rounded-2xl border px-4 py-3"
               style={{ background: "rgba(0,168,94,0.08)", borderColor: "rgba(0,168,94,0.3)" }}>
            <Users className="w-4 h-4 shrink-0" style={{ color: "#00a85e" }} />
            <div>
              <p className="text-xs font-bold" style={{ color: "#00a85e" }}>Invitación aplicada</p>
              <p className="text-[11px]" style={{ color: "rgba(0,168,94,0.7)" }}>
                Código: <span className="font-mono font-bold">{ref.toUpperCase()}</span>
              </p>
            </div>
          </div>
        )}

        <div className="text-center">
          <p className="text-base font-semibold" style={{ color: "var(--text, #fff)" }}>
            Tu amigo te invitó a Nuvos AI
          </p>
          <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.5)" }}>
            El mentor de inversiones con IA más personalizado
          </p>
        </div>

        {/* Features */}
        <div className="space-y-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex items-start gap-3 rounded-xl border px-4 py-3"
                 style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.07)" }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                   style={{ background: f.color + "18" }}>
                <f.icon className="w-4 h-4" style={{ color: f.color }} />
              </div>
              <div>
                <p className="text-xs font-bold" style={{ color: "var(--text, #fff)" }}>{f.title}</p>
                <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <button
          onClick={handleJoin}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-bold text-white text-sm"
          style={{ background: "linear-gradient(135deg, #00a85e, #00c87a)" }}
        >
          Crear cuenta gratis <ArrowRight className="w-4 h-4" />
        </button>

        <p className="text-center text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
          Al registrarte aceptas nuestros Términos de uso y Política de privacidad.
        </p>
      </div>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense>
      <JoinContent />
    </Suspense>
  );
}
