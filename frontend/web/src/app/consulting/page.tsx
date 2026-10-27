"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { auth, consultingApi } from "@/lib/api";
import { useAuthStore } from "@/lib/store";

export default function ConsultingLoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await auth.login(email, password);
      setAuth(res.data.access_token, res.data.user_id);
      // Unlike the investing app's login (which checks for a user_profiles
      // row to decide onboarding vs. home), a MY NUVOS account has none —
      // GET /consulting/me is the authoritative "does this account have a
      // consulting role at all" check, so route off that instead.
      try {
        await consultingApi.me();
        router.push("/consulting/dashboard");
      } catch (err: any) {
        if (err?.response?.status === 403) {
          setError("Esta cuenta no tiene acceso a MY NUVOS todavía. Escríbenos a admisiones@nuvosai.com.");
        } else {
          router.push("/consulting/dashboard");
        }
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Correo o contraseña incorrectos.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ height: "100vh", overflowY: "auto" }}>
    <div style={{ width: "100%", minHeight: "100vh", display: "flex", flexWrap: "wrap" }}>

      {/* Left — brand panel */}
      <div style={{
        flex: "1 1 480px", minWidth: 320, minHeight: "100vh", background: "var(--c-navy)",
        color: "var(--c-ivory)", boxSizing: "border-box", padding: 64, display: "flex",
        flexDirection: "column", justifyContent: "space-between", position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 15% 85%, rgba(199,168,107,0.14), transparent 55%)" }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 3, background: "var(--c-champagne)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--font-serif)", fontWeight: 600, color: "var(--c-navy)", fontSize: 18,
          }}>N</div>
          <div>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: 17, lineHeight: 1.1 }}>My Nuvos</div>
            <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "rgba(250,247,241,.6)", fontWeight: 600 }}>Nuvos Consulting</div>
          </div>
        </div>
        <div style={{ position: "relative", maxWidth: 460 }}>
          <p style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 30, lineHeight: 1.45, fontWeight: 400, color: "var(--c-ivory)", margin: 0 }}>
            "Invertir también es para ti."
          </p>
          <p style={{ margin: "16px 0 0", fontSize: 14, color: "rgba(250,247,241,.7)", lineHeight: 1.5 }}>
            No necesitas ser un experto para empezar a aprender. Descubre cómo funcionan las empresas, comprende sus números y desarrolla tu propio criterio.
          </p>
          <p style={{ margin: "24px 0 0", fontSize: 13, color: "rgba(250,247,241,.55)" }}>Programa de Educación en Inversión</p>
        </div>
        <div style={{ position: "relative", fontSize: 12, color: "rgba(250,247,241,.4)" }}>© 2026 Nuvos Consulting. Acceso exclusivo para participantes activos.</div>
      </div>

      {/* Right — form */}
      <div style={{ flex: "1 1 480px", minWidth: 320, minHeight: "100vh", boxSizing: "border-box", padding: 64, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 32 }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, margin: 0, color: "var(--c-navy)", fontSize: 28 }}>Bienvenida de vuelta</h1>
            <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--c-ink-soft)", lineHeight: 1.5 }}>Ingresa con las credenciales de tu programa para continuar tu recorrido.</p>
          </div>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div>
              <label htmlFor="email" style={{ fontSize: 13, fontWeight: 600, color: "var(--c-navy)", marginBottom: 6, display: "block" }}>Correo</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                style={{ fontFamily: "var(--font-sans)", fontSize: 15, height: 48, borderRadius: 4, border: "1px solid var(--c-line-strong)", padding: "0 16px", boxSizing: "border-box", width: "100%", background: "var(--c-paper)", color: "var(--c-ink)" }} />
            </div>
            <div>
              <label htmlFor="pw" style={{ fontSize: 13, fontWeight: 600, color: "var(--c-navy)", marginBottom: 6, display: "block" }}>Contraseña</label>
              <input id="pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                style={{ fontFamily: "var(--font-sans)", fontSize: 15, height: 48, borderRadius: 4, border: "1px solid var(--c-line-strong)", padding: "0 16px", boxSizing: "border-box", width: "100%", background: "var(--c-paper)", color: "var(--c-ink)" }} />
            </div>
            {error && <p style={{ margin: 0, fontSize: 13, color: "#B94A37", lineHeight: 1.5 }}>{error}</p>}
            <button type="submit" disabled={loading} style={{
              marginTop: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
              height: 48, borderRadius: 4, fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 600,
              border: "1px solid transparent", cursor: loading ? "default" : "pointer", width: "100%",
              background: "var(--c-navy)", color: "var(--c-ivory)", opacity: loading ? 0.7 : 1,
            }}>
              {loading ? "Entrando…" : "Acceder a mi programa"}
            </button>
          </form>
          <div style={{ borderTop: "1px solid var(--c-line)", paddingTop: 20, fontSize: 13, color: "var(--c-ink-soft)", lineHeight: 1.6 }}>
            ¿Primera vez aquí? Tu coach activa tu acceso al iniciar el programa.<br />
            Dudas de acceso: <span style={{ color: "var(--c-navy)", fontWeight: 600 }}>admisiones@nuvosai.com</span>
          </div>
        </div>
      </div>

    </div>
    </div>
  );
}
