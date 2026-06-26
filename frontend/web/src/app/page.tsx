"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { auth, profile as profileApi, referral as referralApi } from "@/lib/api";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuthStore, useProfileStore } from "@/lib/store";
import { Eye, EyeOff, ArrowRight, User } from "lucide-react";

const PILLARS = [
  {
    emoji: "🧠",
    accent: "#a78bfa",
    title: "Mentor IA siempre disponible",
    desc: "Pregunta cualquier cosa sobre tus inversiones. Respuestas claras, personalizadas, sin jerga.",
  },
  {
    emoji: "🔔",
    accent: "#f59e0b",
    title: "Alertas que realmente importan",
    desc: "Cuando algo en el mercado afecte lo que tienes invertido, te avisamos y te explicamos qué significa.",
  },
  {
    emoji: "⚡",
    accent: "#34d399",
    title: "De la duda a la acción",
    desc: "Registra cada decisión, detecta tus patrones de comportamiento y actúa con más confianza.",
  },
];

export default function Home() {
  const [mode, setMode]             = useState<"login" | "register" | "forgot">("login");
  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [showPass, setShowPass]     = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");

  // Forgot password flow
  const [forgotStep, setForgotStep]         = useState<"email" | "code" | "newpass">("email");
  const [forgotMethod, setForgotMethod]     = useState<"email" | "sms">("email");
  const [forgotEmail, setForgotEmail]       = useState("");
  const [forgotPhone, setForgotPhone]       = useState("");
  const [forgotCode, setForgotCode]         = useState("");
  const [forgotNewPass, setForgotNewPass]   = useState("");
  const [forgotDone, setForgotDone]         = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const [checking, setChecking]                 = useState(true);
  const [existingUserName, setExistingUserName] = useState<string | null>(null);

  const extractErrorMsg = (err: unknown): string => {
    const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length > 0) return String(detail[0]?.msg ?? detail[0]);
    return "";
  };

  const router = useRouter();
  const { setAuth } = useAuthStore();
  const { setProfile } = useProfileStore();

  useEffect(() => {
    document.documentElement.style.overflow = "auto";
    document.body.style.overflow = "auto";
    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    // If the user was previously authenticated (Zustand persisted state), send them
    // straight to /home without any network round-trip — they should never see the
    // login page again once they've logged in.
    try {
      const stored = localStorage.getItem("auth-store");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.state?.isAuthenticated === true) {
          router.replace("/home");
          return;
        }
      }
    } catch {}

    const hadTokens = !!localStorage.getItem("access_token") || !!localStorage.getItem("refresh_token");
    if (!hadTokens) { setChecking(false); return; }

    const fallback = setTimeout(() => router.push("/home"), 4000);
    profileApi.get()
      .then((res) => {
        clearTimeout(fallback);
        const storedToken = localStorage.getItem("access_token") ?? "";
        setAuth(storedToken, res.data.user_id);
        setProfile(res.data);
        setExistingUserName(res.data.name || res.data.email || "tu cuenta");
        setChecking(false);
      })
      .catch(() => {
        clearTimeout(fallback);
        // Regardless of why the profile call failed, redirect to home.
        // Don't punish a network hiccup or transient refresh failure
        // by showing the login form to someone who has tokens.
        router.push("/home");
      });
  }, []);

  useEffect(() => {
    if (forgotStep !== "code") return;
    setResendCooldown(30);
    const id = setInterval(() => setResendCooldown((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [forgotStep]);

  const handleForgotSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      if (forgotStep === "email") {
        if (forgotMethod === "sms") {
          await auth.forgotPasswordSms(forgotEmail, forgotPhone);
        } else {
          await auth.forgotPassword(forgotEmail);
        }
        setForgotStep("code");
      } else if (forgotStep === "code") {
        setForgotStep("newpass");
      } else {
        await auth.resetPassword(
          forgotEmail, forgotCode, forgotNewPass,
          forgotMethod === "sms" ? forgotPhone : undefined,
        );
        setForgotDone(true);
      }
    } catch (err: unknown) {
      setError(extractErrorMsg(err) || "Ocurrió un error. Inténtalo de nuevo.");
    } finally { setLoading(false); }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setLoading(true); setError("");
    try {
      if (forgotMethod === "sms") {
        await auth.forgotPasswordSms(forgotEmail, forgotPhone);
      } else {
        await auth.forgotPassword(forgotEmail);
      }
      setResendCooldown(30);
    } catch (err: unknown) {
      setError(extractErrorMsg(err) || "No se pudo reenviar. Inténtalo de nuevo.");
    } finally { setLoading(false); }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true); setError("");
    try {
      const { error } = await getSupabaseClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) setError(`Google error: ${error.message}`);
    } catch (e: unknown) {
      setError(`Error: ${(e as { message?: string })?.message ?? "desconocido"}`);
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.SyntheticEvent) => {
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
      try {
        const p = await profileApi.get();
        setProfile(p.data);
        window.location.href = "/home";
      } catch (err: any) {
        // Only send to onboarding if profile truly doesn't exist (new user).
        // Any other error (network, 5xx, token timing) sends to home to avoid
        // showing onboarding to users who already completed it.
        window.location.href = err?.response?.status === 404 ? "/onboarding" : "/home";
      }
    } catch (err: unknown) {
      setError(extractErrorMsg(err) || "Verifica tus credenciales e inténtalo de nuevo.");
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

      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="animate-orb absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full opacity-[0.06]"
             style={{ background: "radial-gradient(circle, #00e887 0%, transparent 70%)" }} />
        <div className="animate-orb absolute -bottom-60 right-10 w-[700px] h-[700px] rounded-full opacity-[0.04]"
             style={{ background: "radial-gradient(circle, #3b82f6 0%, transparent 70%)", animationDelay: "3s" }} />
        <div className="animate-orb absolute top-1/2 left-1/3 w-[400px] h-[400px] rounded-full opacity-[0.03]"
             style={{ background: "radial-gradient(circle, #a78bfa 0%, transparent 70%)", animationDelay: "5s" }} />
        <div className="line-grid absolute inset-0 opacity-30" />
      </div>

      {/* ── LEFT PANEL — Value proposition ──────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[54%] flex-col justify-center px-16 xl:px-24 py-14 relative z-10 min-h-screen">

        {/* Logo + live badge */}
        <div className="flex items-center gap-3 mb-14 animate-fade-in">
          <div className="relative">
            <Image src="/logo.png" alt="Nuvos AI" width={44} height={44}
                   className="rounded-2xl object-cover" style={{ boxShadow: "var(--shadow-accent)" }} />
            <div className="absolute -inset-1 rounded-2xl blur-md opacity-25"
                 style={{ background: "var(--grad-green)" }} />
          </div>
          <div>
            <span className="text-base font-bold" style={{ color: "var(--text)" }}>Nuvos AI</span>
          </div>
        </div>

        {/* Headline */}
        <div className="mb-8 animate-fade-in-up">
          <h1 className="text-5xl xl:text-[3.6rem] font-black leading-[1.06] tracking-tight mb-3"
              style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Tu mentor de<br />
            inversiones<br />
            <span className="gradient-text">con IA.</span>
          </h1>
          <p className="text-base font-semibold mb-4 tracking-wide" style={{ color: "var(--accent-l)" }}>
            Con Nuvos, construye tu futuro.
          </p>
          <p className="text-lg leading-relaxed max-w-[420px]" style={{ color: "var(--muted)" }}>
            Entiende el mercado, recibe alertas personalizadas y toma decisiones con confianza —
            aunque seas principiante.
          </p>
        </div>

        {/* Social proof bar */}
        <div className="flex items-center gap-0 mb-10 animate-fade-in-up stagger-1">
          {[
            { value: "2,847", label: "inversores activos" },
            { value: "4.9 ★", label: "calificación" },
            { value: "< 2 min", label: "para empezar" },
          ].map((stat, i) => (
            <div key={stat.label} className="flex items-center">
              <div className="text-center px-5 first:pl-0">
                <div className="text-xl font-black tabular-nums"
                     style={{ color: "var(--text)" }}>{stat.value}</div>
                <div className="text-[11px] mt-0.5" style={{ color: "var(--muted)" }}>{stat.label}</div>
              </div>
              {i < 2 && <div className="w-px h-8 shrink-0" style={{ background: "var(--border)" }} />}
            </div>
          ))}
        </div>

        {/* Three pillars */}
        <div className="space-y-5 mb-10">
          {PILLARS.map((p, i) => (
            <div key={p.title} className={`flex items-start gap-4 animate-fade-in-up stagger-${i + 2}`}>
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl shrink-0"
                   style={{ background: p.accent + "1a", border: `1px solid ${p.accent}30` }}>
                {p.emoji}
              </div>
              <div className="pt-0.5">
                <div className="text-sm font-bold mb-0.5" style={{ color: "var(--text)" }}>{p.title}</div>
                <div className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>{p.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Testimonial */}
        <div className="rounded-2xl p-5 animate-fade-in-up stagger-4"
             style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex gap-1 mb-3">
            {"★★★★★".split("").map((s, i) => (
              <span key={i} className="text-sm" style={{ color: "#f59e0b" }}>{s}</span>
            ))}
          </div>
          <p className="text-sm italic leading-relaxed mb-3" style={{ color: "var(--muted)" }}>
            &quot;Por primera vez entiendo qué está pasando con mis acciones. Nuvos me explica todo
            sin hacerme sentir tonto.&quot;
          </p>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0"
                 style={{ background: "rgba(0,168,94,0.2)", color: "var(--accent-l)" }}>D</div>
            <span className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.35)" }}>
              Diego R. · Ciudad de México
            </span>
          </div>
        </div>

      </div>

      {/* ── RIGHT PANEL — Auth form ──────────────────────────────────────── */}
      <div className="w-full lg:w-[46%] flex items-start justify-center overflow-y-auto p-5 lg:p-12 min-h-screen relative z-10">
        <div className="w-full max-w-[400px] my-auto py-8">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8 animate-fade-in">
            <Image src="/logo.png" alt="Nuvos AI" width={38} height={38} className="rounded-xl object-cover" />
            <div>
              <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvos AI</span>
            </div>
          </div>

          {/* Mobile value prop */}
          <div className="lg:hidden mb-8 animate-fade-in-up">
            <h1 className="text-3xl font-black leading-tight tracking-tight mb-1"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              <span style={{ color: "var(--text)" }}>Tu mentor de<br />inversiones </span>
              <span className="gradient-text">con IA.</span>
            </h1>
            <p className="text-xs font-semibold mb-2 tracking-wide" style={{ color: "var(--accent-l)" }}>
              Con Nuvos, construye tu futuro.
            </p>
            <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
              Entiende el mercado y toma mejores decisiones — aunque seas principiante.
            </p>
          </div>

          {/* Existing session banner */}
          {existingUserName && (
            <div className="mb-4 rounded-2xl p-4 flex items-center justify-between gap-3 animate-fade-in-up"
                 style={{ background: "rgba(0,168,94,0.08)", border: "1px solid rgba(0,168,94,0.18)" }}>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                     style={{ background: "rgba(0,168,94,0.15)" }}>
                  <User className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-widest"
                     style={{ color: "var(--accent-l)", opacity: 0.7 }}>Sesión activa</p>
                  <p className="text-[13px] font-bold truncate" style={{ color: "var(--text)" }}>{existingUserName}</p>
                </div>
              </div>
              <button onClick={() => router.push("/home")}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-bold"
                      style={{ background: "rgba(0,168,94,0.15)", color: "var(--accent-l)" }}>
                Continuar <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* ── FORM CARD ────────────────────────────────────────────────── */}
          <div className="glass rounded-3xl p-7 animate-fade-in-up"
               style={{ border: "1px solid rgba(255,255,255,0.07)" }}>

            {mode === "forgot" ? (
              /* ── FORGOT PASSWORD ── */
              forgotDone ? (
                <div className="text-center py-4 space-y-4">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto"
                       style={{ background: "rgba(34,197,94,0.12)" }}>
                    <span className="text-2xl">✓</span>
                  </div>
                  <h2 className="text-xl font-black" style={{ color: "var(--text)" }}>¡Contraseña actualizada!</h2>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>Ya puedes iniciar sesión con tu nueva contraseña.</p>
                  <button onClick={() => { setMode("login"); setForgotStep("email"); setForgotDone(false); setError(""); }}
                          className="btn-primary w-full mt-2">Iniciar sesión</button>
                </div>
              ) : (
                <>
                  <button onClick={() => { setMode("login"); setForgotStep("email"); setError(""); }}
                          className="flex items-center gap-2 text-sm mb-6 transition-opacity hover:opacity-70"
                          style={{ color: "var(--muted)" }}>← Volver</button>
                  <h2 className="text-xl font-black tracking-tight mb-1"
                      style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                    {forgotStep === "email" ? "¿Olvidaste tu contraseña?" : forgotStep === "code" ? `Verifica tu ${forgotMethod === "sms" ? "teléfono" : "email"}` : "Nueva contraseña"}
                  </h2>
                  <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
                    {forgotStep === "email"
                      ? "Elige cómo recibir tu código de verificación."
                      : forgotStep === "code"
                      ? `Ingresa el código de 6 dígitos que enviamos a ${forgotMethod === "sms" ? forgotPhone : forgotEmail}.`
                      : "Elige una nueva contraseña segura."}
                  </p>
                  <form onSubmit={handleForgotSubmit} className="space-y-4">
                    {forgotStep === "email" && (
                      <>
                        <div className="flex gap-2 p-1 rounded-xl mb-1" style={{ background: "var(--raised)" }}>
                          {(["email", "sms"] as const).map((m) => (
                            <button key={m} type="button" onClick={() => setForgotMethod(m)}
                                    className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
                                    style={{
                                      background: forgotMethod === m ? "var(--card)" : "transparent",
                                      color: forgotMethod === m ? "var(--text)" : "var(--muted)",
                                    }}>
                              {m === "email" ? "📧 Email" : "💬 SMS"}
                            </button>
                          ))}
                        </div>
                        <div>
                          <label className="block text-xs font-semibold mb-2 uppercase tracking-wider"
                                 style={{ color: "var(--muted)" }}>Correo electrónico</label>
                          <input type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)}
                                 className="input-premium" placeholder="tu@email.com" required autoFocus />
                        </div>
                        {forgotMethod === "sms" && (
                          <div>
                            <label className="block text-xs font-semibold mb-2 uppercase tracking-wider"
                                   style={{ color: "var(--muted)" }}>Número de teléfono</label>
                            <input type="tel" value={forgotPhone} onChange={(e) => setForgotPhone(e.target.value)}
                                   className="input-premium" placeholder="+52 55 1234 5678" required />
                            <p className="text-[11px] mt-1.5" style={{ color: "var(--dim)" }}>Incluye el código de país, ej: +52 para México</p>
                          </div>
                        )}
                      </>
                    )}
                    {forgotStep === "code" && (
                      <div>
                        <label className="block text-xs font-semibold mb-2 uppercase tracking-wider"
                               style={{ color: "var(--muted)" }}>Código de verificación</label>
                        <input type="text"
                               value={forgotCode}
                               onChange={(e) => setForgotCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                               className="input-premium text-center text-2xl tracking-[0.5em] font-black"
                               placeholder="000000" required maxLength={6} autoFocus />
                        <div className="flex items-center justify-center mt-3 gap-2">
                          {resendCooldown > 0 ? (
                            <span className="text-xs" style={{ color: "var(--muted)" }}>
                              Reenviar en <span className="font-bold tabular-nums" style={{ color: "var(--accent-l)" }}>{resendCooldown}s</span>
                            </span>
                          ) : (
                            <button type="button" onClick={handleResend} disabled={loading}
                                    className="text-xs font-semibold transition-opacity hover:opacity-70 disabled:opacity-40"
                                    style={{ color: "var(--accent-l)" }}>
                              Reenviar código →
                            </button>
                          )}
                        </div>
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
                            disabled={loading
                              || (forgotStep === "email" && (!forgotEmail || (forgotMethod === "sms" && !forgotPhone)))
                              || (forgotStep === "code" && forgotCode.length < 6)
                              || (forgotStep === "newpass" && forgotNewPass.length < 6)}
                            className="btn-primary w-full flex items-center justify-center gap-2">
                      {loading ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
                             style={{ animation: "spin 0.7s linear infinite" }} />
                      ) : (
                        <>{forgotStep === "email" ? "Enviar código" : forgotStep === "code" ? "Verificar" : "Actualizar contraseña"} <ArrowRight className="w-4 h-4" /></>
                      )}
                    </button>
                  </form>
                </>
              )
            ) : (
              /* ── LOGIN / REGISTER ── */
              <>
                {/* Form heading */}
                <div className="mb-6">
                  <h2 className="text-xl font-black tracking-tight mb-1"
                      style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                    {mode === "login" ? "Bienvenido de vuelta" : "Empieza hoy. Es gratis."}
                  </h2>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    {mode === "login" ? "Accede a tu mentor IA" : "Sin tarjeta de crédito requerida"}
                  </p>
                </div>

                {/* GOOGLE — primary CTA */}
                <button type="button" onClick={handleGoogleSignIn} disabled={loading}
                        className="w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-2xl text-sm font-bold transition-all duration-200 disabled:opacity-50 mb-4"
                        style={{
                          background: "rgba(0,168,94,0.08)",
                          border: "1px solid rgba(0,168,94,0.28)",
                          color: "var(--text)",
                        }}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                    <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                    <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
                    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.96L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                  </svg>
                  {mode === "register" ? "Empezar gratis con Google" : "Continuar con Google"}
                </button>

                {/* Divider */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
                  <span className="text-xs" style={{ color: "var(--dim)" }}>o con email</span>
                  <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
                </div>

                {/* Email form */}
                <form onSubmit={handleSubmit} className="space-y-3">
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                         className="input-premium" placeholder="tu@email.com" required autoComplete="email" />

                  <div className="relative">
                    <input type={showPass ? "text" : "password"}
                           value={password} onChange={(e) => setPassword(e.target.value)}
                           className="input-premium pr-11"
                           placeholder={mode === "register" ? "Crea una contraseña (mín. 6)" : "Contraseña"}
                           required minLength={6} autoComplete={mode === "register" ? "new-password" : "current-password"} />
                    <button type="button" onClick={() => setShowPass(!showPass)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors"
                            style={{ color: "var(--muted)" }}>
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {mode === "login" && (
                    <div className="text-right -mt-1">
                      <button type="button"
                              onClick={() => { setMode("forgot"); setForgotEmail(email); setForgotStep("email"); setError(""); }}
                              className="text-xs transition-opacity hover:opacity-70"
                              style={{ color: "var(--accent-l)" }}>
                        ¿Olvidaste tu contraseña?
                      </button>
                    </div>
                  )}

                  {error && (
                    <div className="rounded-xl px-4 py-3 text-sm animate-fade-in"
                         style={{ background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.25)", color: "#f87171" }}>
                      {error}
                    </div>
                  )}

                  <button type="submit" disabled={loading || !email || !password}
                          className="btn-primary w-full flex items-center justify-center gap-2 !mt-4">
                    {loading ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
                           style={{ animation: "spin 0.7s linear infinite" }} />
                    ) : (
                      <>{mode === "login" ? "Iniciar sesión" : "Crear mi cuenta"} <ArrowRight className="w-4 h-4" /></>
                    )}
                  </button>
                </form>

                {/* Switch mode */}
                <p className="text-center text-sm mt-5" style={{ color: "var(--muted)" }}>
                  {mode === "login" ? (
                    <>¿Eres nuevo?{" "}
                      <button onClick={() => { setMode("register"); setError(""); }}
                              className="font-bold transition-opacity hover:opacity-80"
                              style={{ color: "var(--accent-l)" }}>
                        Crea tu cuenta gratis →
                      </button>
                    </>
                  ) : (
                    <>¿Ya tienes cuenta?{" "}
                      <button onClick={() => { setMode("login"); setError(""); }}
                              className="font-bold transition-opacity hover:opacity-80"
                              style={{ color: "var(--accent-l)" }}>
                        Inicia sesión →
                      </button>
                    </>
                  )}
                </p>
              </>
            )}
          </div>

          {/* Low-friction entry points */}
          {mode !== "forgot" && (
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button onClick={() => { setEmail("demo@nuvosai.app"); setPassword("demo1234"); setMode("login"); }}
                      className="text-xs py-2.5 rounded-xl text-center transition-all hover:opacity-80"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", color: "var(--muted)" }}>
                Ver cuenta demo
              </button>
              <button onClick={() => router.push("/chat")}
                      className="text-xs py-2.5 rounded-xl text-center transition-all hover:opacity-80"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", color: "var(--muted)" }}>
                Explorar sin cuenta →
              </button>
            </div>
          )}

          {/* Trust + Legal */}
          <p className="text-center text-[11px] mt-4 leading-relaxed animate-fade-in"
             style={{ color: "var(--dim)" }}>
            🔐 Tus datos nunca se venden · Al continuar aceptas los{" "}
            <a href="/terms" className="hover:opacity-80 transition-opacity underline" style={{ color: "var(--muted)" }}>Términos</a>
            {" "}y la{" "}
            <a href="/privacy" className="hover:opacity-80 transition-opacity underline" style={{ color: "var(--muted)" }}>Privacidad</a>
          </p>

        </div>
      </div>
    </div>
  );
}
