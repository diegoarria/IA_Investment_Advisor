"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { auth, profile as profileApi, referral as referralApi } from "@/lib/api";
import { useAuthStore, useProfileStore, useChatStore } from "@/lib/store";
import { Eye, EyeOff, ArrowRight, TrendingUp, Shield, Brain, Bell } from "lucide-react";

const FEATURES = [
  { icon: Brain,      color: "#a78bfa", title: "IA que te conoce",       desc: "Se adapta a tu perfil de riesgo y comportamiento real" },
  { icon: TrendingUp, color: "#34d399", title: "Análisis personalizado",  desc: "Escenarios basados en tu portafolio y objetivos" },
  { icon: Shield,     color: "#60a5fa", title: "Sin conflictos de interés", desc: "Te enseñamos a pensar, no qué comprar" },
  { icon: Bell,       color: "#f59e0b", title: "Alertas inteligentes",    desc: "Noticias de tus posiciones interpretadas para ti" },
];


export default function Home() {
  const [mode, setMode]       = useState<"login" | "register" | "forgot">("login");
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  // Forgot password flow
  const [forgotStep, setForgotStep]       = useState<"email" | "code" | "newpass">("email");
  const [forgotEmail, setForgotEmail]     = useState("");
  const [forgotCode, setForgotCode]       = useState("");
  const [forgotNewPass, setForgotNewPass] = useState("");
  const [forgotDone, setForgotDone]       = useState(false);

  const [checking, setChecking] = useState(true);

  const router = useRouter();
  const { setAuth } = useAuthStore();
  const { setProfile } = useProfileStore();

  // On mount: check stored token directly — no Zustand rehydration timing issues
  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) { setChecking(false); return; }
    profileApi.get()
      .then((res) => { setProfile(res.data); router.push("/chat"); })
      .catch(() => {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        setChecking(false);
      });
  }, []);

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      if (forgotStep === "email") {
        await auth.forgotPassword(forgotEmail);
        setForgotStep("code");
      } else if (forgotStep === "code") {
        // just advance — actual verify happens on reset
        setForgotStep("newpass");
      } else {
        await auth.resetPassword(forgotEmail, forgotCode, forgotNewPass);
        setForgotDone(true);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Ocurrió un error. Inténtalo de nuevo.");
    } finally { setLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const fn = mode === "login" ? auth.login : auth.register;
      const res = await fn(email, password);
      setAuth(res.data.access_token, res.data.user_id);
      if (res.data.refresh_token) localStorage.setItem("refresh_token", res.data.refresh_token);
      if (mode === "register") {
        const refCode = sessionStorage.getItem("nuvos_ref");
        if (refCode) { referralApi.applyCode(refCode).catch(() => {}); sessionStorage.removeItem("nuvos_ref"); }
      }
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

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="w-8 h-8 border-2 border-white/10 border-t-green-400 rounded-full"
             style={{ animation: "spin 0.7s linear infinite" }} />
      </div>
    );
  }

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

            {mode === "forgot" ? (
              /* ── FORGOT PASSWORD FLOW ── */
              forgotDone ? (
                <div className="text-center py-4 space-y-4">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto"
                       style={{ background: "rgba(34,197,94,0.12)" }}>
                    <span className="text-2xl">✓</span>
                  </div>
                  <h2 className="text-xl font-black" style={{ color: "var(--text)" }}>¡Contraseña actualizada!</h2>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>Ya puedes iniciar sesión con tu nueva contraseña.</p>
                  <button onClick={() => { setMode("login"); setForgotStep("email"); setForgotDone(false); setError(""); }}
                          className="btn-primary w-full mt-2">
                    Iniciar sesión
                  </button>
                </div>
              ) : (
                <>
                  <button onClick={() => { setMode("login"); setForgotStep("email"); setError(""); }}
                          className="flex items-center gap-2 text-sm mb-6 transition-opacity hover:opacity-70"
                          style={{ color: "var(--muted)" }}>
                    ← Volver
                  </button>
                  <h2 className="text-2xl font-black tracking-tight mb-1"
                      style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                    {forgotStep === "email" ? "¿Olvidaste tu contraseña?" : forgotStep === "code" ? "Verifica tu email" : "Nueva contraseña"}
                  </h2>
                  <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
                    {forgotStep === "email"
                      ? "Ingresa tu email y te enviamos un código de verificación."
                      : forgotStep === "code"
                      ? `Ingresa el código de 6 dígitos que enviamos a ${forgotEmail}.`
                      : "Elige una nueva contraseña segura."}
                  </p>

                  <form onSubmit={handleForgotSubmit} className="space-y-4">
                    {forgotStep === "email" && (
                      <div>
                        <label className="block text-xs font-semibold mb-2 uppercase tracking-wider"
                               style={{ color: "var(--muted)" }}>Correo electrónico</label>
                        <input type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)}
                               className="input-premium" placeholder="tu@email.com" required autoFocus />
                      </div>
                    )}

                    {forgotStep === "code" && (
                      <div>
                        <label className="block text-xs font-semibold mb-2 uppercase tracking-wider"
                               style={{ color: "var(--muted)" }}>Código de verificación</label>
                        <input type="text" value={forgotCode} onChange={(e) => setForgotCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                               className="input-premium text-center text-2xl tracking-[0.5em] font-black"
                               placeholder="000000" required maxLength={6} autoFocus />
                      </div>
                    )}

                    {forgotStep === "newpass" && (
                      <div>
                        <label className="block text-xs font-semibold mb-2 uppercase tracking-wider"
                               style={{ color: "var(--muted)" }}>Nueva contraseña</label>
                        <input type="password" value={forgotNewPass} onChange={(e) => setForgotNewPass(e.target.value)}
                               className="input-premium" placeholder="Mínimo 6 caracteres" required minLength={6} autoFocus />
                      </div>
                    )}

                    {error && (
                      <div className="rounded-xl px-4 py-3 text-sm animate-fade-in"
                           style={{ background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.25)", color: "#f87171" }}>
                        {error}
                      </div>
                    )}

                    <button type="submit"
                            disabled={loading || (forgotStep === "email" && !forgotEmail) || (forgotStep === "code" && forgotCode.length < 6) || (forgotStep === "newpass" && forgotNewPass.length < 6)}
                            className="btn-primary w-full flex items-center justify-center gap-2">
                      {loading ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full" style={{ animation: "spin 0.7s linear infinite" }} />
                      ) : (
                        <>
                          {forgotStep === "email" ? "Enviar código" : forgotStep === "code" ? "Verificar" : "Actualizar contraseña"}
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </form>
                </>
              )
            ) : (
              /* ── LOGIN / REGISTER FLOW ── */
              <>
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
                  <div>
                    <label className="block text-xs font-semibold mb-2 uppercase tracking-wider"
                           style={{ color: "var(--muted)" }}>Correo electrónico</label>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                           className="input-premium" placeholder="tu@email.com" required />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-semibold uppercase tracking-wider"
                             style={{ color: "var(--muted)" }}>Contraseña</label>
                      {mode === "login" && (
                        <button type="button"
                                onClick={() => { setMode("forgot"); setForgotEmail(email); setForgotStep("email"); setError(""); }}
                                className="text-xs transition-opacity hover:opacity-70"
                                style={{ color: "var(--accent, #22c55e)" }}>
                          ¿Olvidaste tu contraseña?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <input type={showPass ? "text" : "password"}
                             value={password} onChange={(e) => setPassword(e.target.value)}
                             className="input-premium pr-11" placeholder="••••••••" required minLength={6} />
                      <button type="button" onClick={() => setShowPass(!showPass)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors"
                              style={{ color: "var(--muted)" }}>
                        {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div className="rounded-xl px-4 py-3 text-sm animate-fade-in"
                         style={{ background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.25)", color: "#f87171" }}>
                      {error}
                    </div>
                  )}

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

                <div className="flex items-center gap-3 my-5">
                  <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
                  <span className="text-xs" style={{ color: "var(--dim)" }}>o</span>
                  <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
                </div>

                <button onClick={() => { setEmail("demo@nuvosai.app"); setPassword("demo1234"); }}
                        className="btn-ghost w-full text-sm">
                  Probar con cuenta demo
                </button>
              </>
            )}
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
