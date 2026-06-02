"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { auth, profile as profileApi } from "@/lib/api";
import { useAuthStore, useProfileStore, useChatStore } from "@/lib/store";
import { Eye, EyeOff, ArrowRight, TrendingUp, Shield, Brain, Bell } from "lucide-react";

const FEATURES = [
  { icon: Brain,      color: "#a78bfa", title: "IA que te conoce",       desc: "Se adapta a tu perfil de riesgo y comportamiento real" },
  { icon: TrendingUp, color: "#34d399", title: "Análisis personalizado",  desc: "Escenarios basados en tu portafolio y objetivos" },
  { icon: Shield,     color: "#60a5fa", title: "Sin conflictos de interés", desc: "Te enseñamos a pensar, no qué comprar" },
  { icon: Bell,       color: "#f59e0b", title: "Alertas inteligentes",    desc: "Noticias de tus posiciones interpretadas para ti" },
];

const STATS = [
  { value: "12K+",   label: "Inversores activos" },
  { value: "4.9★",   label: "App Store" },
  { value: "< 30s",  label: "Análisis de portafolio" },
];

export default function Home() {
  const [mode, setMode]       = useState<"login" | "register">("login");
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const router = useRouter();
  const { setAuth, isAuthenticated } = useAuthStore();
  const { setProfile } = useProfileStore();

  useEffect(() => {
    if (isAuthenticated) {
      profileApi.get()
        .then((res) => { setProfile(res.data); router.push("/chat"); })
        .catch(() => router.push("/onboarding"));
    }
  }, [isAuthenticated]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const fn = mode === "login" ? auth.login : auth.register;
      const res = await fn(email, password);
      setAuth(res.data.access_token, res.data.user_id);
      if (res.data.refresh_token) localStorage.setItem("refresh_token", res.data.refresh_token);
      // Load this user's own chat sessions (scoped by userId in storage key)
      await useChatStore.persist.rehydrate();
      try {
        const p = await profileApi.get();
        setProfile(p.data);
        router.push("/chat");
      } catch { router.push("/onboarding"); }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Verifica tus credenciales e inténtalo de nuevo.");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex relative" style={{ background: "var(--bg)" }}>

      {/* Ambient background orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="animate-orb absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full opacity-[0.07]"
             style={{ background: "radial-gradient(circle, #00e887 0%, transparent 70%)" }} />
        <div className="animate-orb absolute -bottom-60 right-10 w-[700px] h-[700px] rounded-full opacity-[0.05]"
             style={{ background: "radial-gradient(circle, #3b82f6 0%, transparent 70%)", animationDelay: "3s" }} />
        <div className="animate-orb absolute top-1/2 left-1/3 w-[400px] h-[400px] rounded-full opacity-[0.04]"
             style={{ background: "radial-gradient(circle, #a78bfa 0%, transparent 70%)", animationDelay: "5s" }} />
        <div className="line-grid absolute inset-0 opacity-40" />
      </div>

      {/* ── LEFT PANEL ────────────────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[55%] flex-col justify-center overflow-y-auto scrollbar-thin px-16 xl:px-24 py-12 relative z-10 min-h-screen">

        {/* Logo */}
        <div className="flex items-center gap-3 mb-14 animate-fade-in">
          <div className="relative">
            <Image src="/logo.png" alt="Nuvos AI" width={46} height={46}
                   className="rounded-2xl object-cover" style={{ boxShadow: "var(--shadow-accent)" }} />
            <div className="absolute -inset-1 rounded-2xl blur-md opacity-30"
                 style={{ background: "var(--grad-green)" }} />
          </div>
          <div>
            <span className="text-lg font-bold" style={{ color: "var(--text)" }}>Nuvos AI</span>
            <div className="badge-green mt-0.5">Mentor IA</div>
          </div>
        </div>

        {/* Headline */}
        <div className="mb-10 animate-fade-in-up">
          <h1 className="text-5xl xl:text-6xl font-black leading-[1.08] tracking-tight mb-5"
              style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Invierte con la<br />
            <span className="gradient-text">claridad mental</span><br />
            de un experto.
          </h1>
          <p className="text-lg leading-relaxed max-w-md" style={{ color: "var(--muted)" }}>
            Tu mentor financiero con IA que aprende tu perfil,
            detecta tus sesgos y te enseña a pensar como un inversor profesional.
          </p>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-2 gap-3 mb-12">
          {FEATURES.map(({ icon: Icon, color, title, desc }, i) => (
            <div key={title}
                 className={`card-premium p-4 animate-fade-in-up stagger-${i + 1}`}
                 style={{ background: "var(--card)" }}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-3"
                   style={{ background: color + "18" }}>
                <Icon className="w-4 h-4" style={{ color }} />
              </div>
              <div className="text-sm font-700 mb-1" style={{ color: "var(--text)", fontWeight: 700 }}>{title}</div>
              <div className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>{desc}</div>
            </div>
          ))}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-8 animate-fade-in">
          {STATS.map(({ value, label }, i) => (
            <div key={label}>
              {i > 0 && <div className="hidden" />}
              <div className="text-2xl font-black" style={{ color: "var(--accent-l)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{value}</div>
              <div className="text-xs" style={{ color: "var(--muted)" }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── RIGHT PANEL ───────────────────────────────────────────────── */}
      <div className="w-full lg:w-[45%] flex items-start justify-center overflow-y-auto scrollbar-thin p-6 lg:p-12 min-h-screen relative z-10">
        <div className="w-full max-w-[420px] my-auto py-8">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-10 animate-fade-in">
            <Image src="/logo.png" alt="Nuvos AI" width={40} height={40} className="rounded-xl object-cover" />
            <span className="font-bold text-base" style={{ color: "var(--text)" }}>Nuvos AI</span>
          </div>

          {/* Form card */}
          <div className="glass rounded-3xl p-8 animate-fade-in-up"
               style={{ border: "1px solid rgba(255,255,255,0.07)" }}>

            {/* Mode toggle */}
            <div className="flex gap-1 p-1 rounded-xl mb-8"
                 style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
              {(["login","register"] as const).map((m) => (
                <button key={m} onClick={() => { setMode(m); setError(""); }}
                        className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all duration-200"
                        style={{
                          background: mode === m ? "var(--card)" : "transparent",
                          color: mode === m ? "var(--text)" : "var(--muted)",
                          boxShadow: mode === m ? "var(--shadow-sm)" : "none",
                        }}>
                  {m === "login" ? "Iniciar sesión" : "Crear cuenta"}
                </button>
              ))}
            </div>

            {/* Greeting */}
            <div className="mb-6">
              <h2 className="text-2xl font-black tracking-tight mb-1"
                  style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                {mode === "login" ? "Bienvenido de vuelta" : "Empieza hoy"}
              </h2>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                {mode === "login"
                  ? "Accede a tu perfil y continúa aprendiendo"
                  : "Crea tu perfil de inversor en minutos"}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email */}
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase tracking-wider"
                       style={{ color: "var(--muted)" }}>
                  Correo electrónico
                </label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                       className="input-premium" placeholder="tu@email.com" required />
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase tracking-wider"
                       style={{ color: "var(--muted)" }}>
                  Contraseña
                </label>
                <div className="relative">
                  <input type={showPass ? "text" : "password"}
                         value={password}
                         onChange={(e) => setPassword(e.target.value)}
                         className="input-premium pr-11"
                         placeholder="••••••••" required minLength={6} />
                  <button type="button"
                          onClick={() => setShowPass(!showPass)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors"
                          style={{ color: "var(--muted)" }}>
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="rounded-xl px-4 py-3 text-sm animate-fade-in"
                     style={{ background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.25)", color: "#f87171" }}>
                  {error}
                </div>
              )}

              {/* Submit */}
              <button type="submit" disabled={loading || !email || !password}
                      className="btn-primary w-full flex items-center justify-center gap-2 mt-2">
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full" style={{ animation: "spin 0.7s linear infinite" }} />
                ) : (
                  <>
                    {mode === "login" ? "Entrar a Nuvos AI" : "Crear mi cuenta"}
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
              <span className="text-xs" style={{ color: "var(--dim)" }}>o</span>
              <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
            </div>

            {/* Demo */}
            <button onClick={() => { setEmail("demo@nuvosai.app"); setPassword("demo1234"); }}
                    className="btn-ghost w-full text-sm">
              Probar con cuenta demo
            </button>
          </div>

          {/* Footer links */}
          <p className="text-center text-xs mt-5 animate-fade-in" style={{ color: "var(--dim)" }}>
            Al continuar aceptas nuestros{" "}
            <a href="/terms" className="hover:opacity-80 transition-opacity" style={{ color: "var(--muted)" }}>Términos de uso</a>
            {" "}y{" "}
            <a href="/privacy" className="hover:opacity-80 transition-opacity" style={{ color: "var(--muted)" }}>Privacidad</a>
          </p>
        </div>
      </div>
    </div>
  );
}
