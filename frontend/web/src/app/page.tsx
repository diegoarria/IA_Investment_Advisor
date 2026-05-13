"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth, profile as profileApi } from "@/lib/api";
import { useAuthStore, useProfileStore } from "@/lib/store";
import { TrendingUp, BookOpen, Shield, Bell } from "lucide-react";

export default function Home() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const { setAuth, isAuthenticated } = useAuthStore();
  const { setProfile } = useProfileStore();

  useEffect(() => {
    if (isAuthenticated) {
      profileApi.get()
        .then((res) => {
          setProfile(res.data);
          router.push("/chat");
        })
        .catch(() => router.push("/onboarding"));
    }
  }, [isAuthenticated]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const fn = mode === "login" ? auth.login : auth.register;
      const res = await fn(email, password);
      setAuth(res.data.access_token, res.data.user_id);

      try {
        const p = await profileApi.get();
        setProfile(p.data);
        router.push("/chat");
      } catch {
        router.push("/onboarding");
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Error al iniciar sesión. Verifica tus credenciales.");
    } finally {
      setLoading(false);
    }
  };

  const features = [
    { icon: BookOpen, title: "Educación Real", desc: "Aprende a analizar negocios, no solo precios" },
    { icon: TrendingUp, title: "Escenarios Personalizados", desc: "Análisis adaptado a tu perfil de riesgo" },
    { icon: Shield, title: "Sin Recomendaciones Directas", desc: "Aprende a pensar, no a seguir consejos" },
    { icon: Bell, title: "Notificaciones Inteligentes", desc: "Contexto del mercado interpretado para ti" },
  ];

  return (
    <div className="min-h-screen bg-[#0f1117] flex">
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center px-16 bg-gradient-to-br from-[#0f1117] via-[#1a1d27] to-[#0f1117]">
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-white">IA Investment Advisor</span>
          </div>
          <h1 className="text-4xl font-bold text-white leading-tight mb-4">
            Aprende a tomar<br />
            <span className="text-brand-500">decisiones financieras</span><br />
            como un profesional
          </h1>
          <p className="text-gray-400 text-lg leading-relaxed">
            No te decimos qué comprar. Te enseñamos cómo pensar.
            Un mentor de inversiones que se adapta a ti.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {features.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-4">
              <Icon className="w-5 h-5 text-brand-500 mb-2" />
              <div className="font-semibold text-white text-sm mb-1">{title}</div>
              <div className="text-gray-400 text-xs">{desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-white">IA Investment Advisor</span>
          </div>

          <h2 className="text-2xl font-bold text-white mb-2">
            {mode === "login" ? "Bienvenido de vuelta" : "Comienza tu journey"}
          </h2>
          <p className="text-gray-400 mb-8">
            {mode === "login" ? "Accede a tu perfil financiero" : "Crea tu perfil de inversor"}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#1a1d27] border border-[#2a2d3a] rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 transition-colors"
                placeholder="tu@email.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#1a1d27] border border-[#2a2d3a] rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 transition-colors"
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
            >
              {loading ? "Cargando..." : mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
            </button>
          </form>

          <p className="mt-6 text-center text-gray-400 text-sm">
            {mode === "login" ? "¿No tienes cuenta?" : "¿Ya tienes cuenta?"}{" "}
            <button
              onClick={() => setMode(mode === "login" ? "register" : "login")}
              className="text-brand-500 hover:text-brand-400 font-medium"
            >
              {mode === "login" ? "Crear una" : "Inicia sesión"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
