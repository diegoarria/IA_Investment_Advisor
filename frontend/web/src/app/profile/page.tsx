"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  useAuthStore, useProfileStore, useNotificationStore, useSubscriptionStore,
  useThemeStore, msgsRemaining, FREE_MSG_LIMIT, maturityLabel,
} from "@/lib/store";
import { auth as authApi, insights as insightsApi, mentorLetter as mentorLetterApi, notifications as notifApi, profile as profileApi } from "@/lib/api";
import { getMentorInfo } from "@/lib/mentorData";
import PaywallModal from "@/components/PaywallModal";
import {
  TrendingUp, BookOpen, PieChart, BarChart2, Bell, User, LogOut, Menu, X,
  GraduationCap, Trophy, Sun, Moon, ChevronDown, ChevronUp, Star, BarChart,
  Loader2, Compass,
} from "lucide-react";

const NAV = [
  { href: "/chat",          icon: BookOpen,      label: "Chat" },
  { href: "/portfolio",     icon: PieChart,      label: "Portafolio" },
  { href: "/paper",         icon: BarChart2,     label: "Paper Trading" },
  { href: "/learn",         icon: GraduationCap, label: "Aprendizaje" },
  { href: "/arena",         icon: Trophy,        label: "Arena" },
  { href: "/explore",       icon: Compass,     label: "Explorar" },
  { href: "/notifications", icon: Bell,          label: "Notificaciones" },
  { href: "/profile",       icon: User,          label: "Perfil" },
];

const RISK_LABEL: Record<string, string> = {
  conservative:           "Inversionista Conservador",
  conservative_moderate:  "Conservador-Moderado",
  moderate:               "Inversionista Moderado",
  moderate_growth:        "Moderado-Growth",
  growth:                 "Growth",
  aggressive:             "Inversionista Agresivo",
  aggressive_speculative: "Agresivo-Especulativo",
  speculative:            "Especulativo",
};

const RISK_COLOR: Record<string, string> = {
  conservative:           "#3b82f6",
  conservative_moderate:  "#22c55e",
  moderate:               "#f59e0b",
  moderate_growth:        "#f97316",
  growth:                 "#f97316",
  aggressive:             "#ef4444",
  aggressive_speculative: "#dc2626",
  speculative:            "#7c3aed",
};

const QUIZ_CATEGORIES = ["Mentalidad", "Horizonte", "Conocimiento", "Riesgo", "Comportamiento"];
const QUIZ_LABELS: Record<string, Record<string, string>> = {
  q1: { A: "Vende ante caídas", B: "Espera sin actuar", C: "Analiza y mantiene", D: "Compra las caídas" },
  q2: { A: "< 2 años", B: "3–5 años", C: "10+ años", D: "Largo plazo, sin prisa" },
  q3: { A: "Principiante", B: "Básico", C: "Intermedio", D: "Avanzado" },
  q4: { A: "$5K seguro", B: "$15K / riesgo $5K", C: "$40K / riesgo $20K", D: "$120K / riesgo total" },
  q5: { A: "Automático / pasivo", B: "Revisión mensual", C: "Revisión semanal", D: "Gestión diaria" },
};
const ANSWER_COLORS: Record<string, string> = { A: "#3b82f6", B: "#22c55e", C: "#f59e0b", D: "#ef4444" };

function riskCategory(rt: string): "conservative" | "moderate" | "aggressive" {
  if (rt.startsWith("conservative")) return "conservative";
  if (rt === "aggressive" || rt.startsWith("aggressive") || rt === "speculative") return "aggressive";
  return "moderate";
}

function getAge(birthDate: string): number {
  if (!birthDate) return 0;
  const sep = birthDate.includes("/") ? "/" : "-";
  const parts = birthDate.split(sep).map(Number);
  const [y, m, d] = sep === "-" ? parts : [parts[2], parts[1], parts[0]];
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return Math.max(0, age);
}

const riskDistributions: Record<string, { label: string; pct: number; color: string }[]> = {
  conservative: [
    { label: "Renta fija / Bonos", pct: 60, color: "#3b82f6" },
    { label: "Acciones defensivas", pct: 30, color: "#22c55e" },
    { label: "Liquidez / Oro", pct: 10, color: "#f59e0b" },
  ],
  moderate: [
    { label: "Acciones diversificadas", pct: 60, color: "#22c55e" },
    { label: "Renta fija", pct: 30, color: "#3b82f6" },
    { label: "Alternativos / REITs", pct: 10, color: "#a855f7" },
  ],
  aggressive: [
    { label: "Acciones de crecimiento", pct: 75, color: "#22c55e" },
    { label: "Mercados emergentes", pct: 15, color: "#f59e0b" },
    { label: "Renta fija mínima", pct: 10, color: "#3b82f6" },
  ],
};

const riskMetrics: Record<string, { label: string; val: string }[]> = {
  conservative: [{ label: "Volatilidad", val: "Baja" }, { label: "Retorno esperado", val: "4–7% anual" }, { label: "Horizonte ideal", val: "1–5 años" }],
  moderate:     [{ label: "Volatilidad", val: "Media" }, { label: "Retorno esperado", val: "7–10% anual" }, { label: "Horizonte ideal", val: "5–10 años" }],
  aggressive:   [{ label: "Volatilidad", val: "Alta" }, { label: "Retorno esperado", val: "10–15%+" }, { label: "Horizonte ideal", val: "10+ años" }],
};

const riskETFs: Record<string, string> = {
  conservative: "BND, AGG, SCHD, VTIP, SGOV, GLD",
  moderate:     "VTI, VEA, BND, QQQ, VNQ, SCHD",
  aggressive:   "QQQ, VTI, VGT, SOXX, VWO, ARKK",
};

export default function ProfilePage() {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, clearAuth } = useAuthStore();
  const { profile, maturityScore, maturityHistory } = useProfileStore();
  const { notifications } = useNotificationStore();
  const subStore = useSubscriptionStore();
  const { theme, toggleTheme } = useThemeStore();
  const unreadCount = notifications.filter((n) => !n.read).length;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [riskExpanded, setRiskExpanded] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [letterOpen, setLetterOpen] = useState(false);
  const [letter, setLetter] = useState<string | null>(null);
  const [letterLoading, setLetterLoading] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [insights, setInsights] = useState<{
    ready: boolean; topics?: string[]; risk_match?: boolean;
    risk_note?: string; suggestion?: string;
  } | null>(null);

  const isPremium = subStore.tier === "premium";
  const remaining = msgsRemaining(subStore);
  const mentor = getMentorInfo(profile?.mentor);
  const riskColor = profile ? (RISK_COLOR[profile.risk_tolerance] ?? "var(--accent)") : "var(--accent)";
  const riskCat = profile ? riskCategory(profile.risk_tolerance) : "moderate";
  const maturity = maturityLabel(maturityScore);

  useEffect(() => {
    if (!isAuthenticated) { router.push("/"); return; }
    insightsApi.get().then((r) => setInsights(r.data)).catch(() => {});
    notifApi.getAll().then(() => {}).catch(() => {});
    subStore.fetchStatus().catch(() => {});
  }, [isAuthenticated]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      const localUrl = `data:image/jpeg;base64,${base64}`;
      setAvatarUrl(localUrl);
      setAvatarUploading(true);
      try {
        const res = await profileApi.uploadAvatar(base64);
        setAvatarUrl(res.data.avatar_url);
      } catch {}
      setAvatarUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const openMentorLetter = async () => {
    if (letter) { setLetterOpen(true); return; }
    setLetterLoading(true);
    try {
      const r = await mentorLetterApi.get();
      setLetter(r.data.letter ?? null);
      setLetterOpen(true);
    } catch {}
    setLetterLoading(false);
  };

  const handleLogout = () => {
    if (confirm("¿Seguro que quieres cerrar sesión?")) {
      clearAuth();
      router.push("/");
    }
  };

  const handleDeleteAccount = async () => {
    if (!confirm("Esta acción es permanente. Se borrarán todos tus datos. ¿Continuar?")) return;
    if (!confirm("¿Estás absolutamente seguro? No se puede deshacer.")) return;
    try { await authApi.deleteAccount(); } catch {}
    clearAuth();
    router.push("/");
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      {/* Top bar */}
      <div className="border-b flex items-center justify-between px-4 py-2 shrink-0"
           style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-1 rounded-lg" style={{ color: "var(--muted)" }}>
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "var(--accent)" }}>
              <TrendingUp className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvos AI</span>
          </div>
        </div>
        <span className="font-semibold text-sm" style={{ color: "var(--sub)" }}>Mi Perfil</span>
        <div className="flex items-center gap-1">
          <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-white/5" style={{ color: "var(--muted)" }}>
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button onClick={handleLogout} className="p-2 rounded-lg hover:bg-white/5" style={{ color: "var(--muted)" }}>
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <aside className={`${sidebarOpen ? "flex" : "hidden"} lg:flex w-60 border-r flex-col py-4 absolute lg:relative z-20 h-full`}
               style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <nav className="flex-1 px-2 space-y-0.5">
            {NAV.map(({ href, icon: Icon, label }) => {
              const active = pathname === href;
              const badge = href === "/notifications" && unreadCount > 0;
              return (
                <button key={href} onClick={() => { router.push(href); setSidebarOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors"
                        style={{ background: active ? "rgba(0,168,94,0.12)" : "transparent", color: active ? "var(--accent-l)" : "var(--muted)" }}>
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{label}</span>
                  {badge && <span className="ml-auto w-4 h-4 rounded-full text-white text-[10px] flex items-center justify-center font-bold" style={{ background: "var(--accent)" }}>{unreadCount}</span>}
                </button>
              );
            })}
          </nav>
          <div className="px-3 mt-2">
            <button onClick={() => router.push("/onboarding")}
                    className="w-full text-xs text-center py-2 rounded-lg hover:bg-white/5"
                    style={{ color: "var(--dim)" }}>
              Actualizar perfil
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-y-auto scrollbar-thin p-4">
          <div className="max-w-2xl mx-auto space-y-4 pb-8">
            {!profile ? (
              <div className="flex flex-col items-center justify-center h-64 gap-4">
                <User className="w-16 h-16" style={{ color: "var(--dim)" }} />
                <p style={{ color: "var(--muted)" }}>No hay perfil configurado</p>
                <button onClick={() => router.push("/onboarding")}
                        className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
                        style={{ background: "var(--accent)" }}>
                  Completar onboarding
                </button>
              </div>
            ) : (
              <>
                {/* Hero card */}
                <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: riskColor + "44" }}>
                  <div className="h-16" style={{ background: riskColor }} />
                  <div className="flex flex-col items-center -mt-8 pb-4 px-5">
                    <label className="relative cursor-pointer group">
                      <div className="w-16 h-16 rounded-full border-4 flex items-center justify-center text-2xl font-black text-white overflow-hidden"
                           style={{ background: riskColor, borderColor: "var(--card)" }}>
                        {avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                        ) : avatarUploading ? (
                          <Loader2 className="w-6 h-6 animate-spin text-white" />
                        ) : (
                          profile.name.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="absolute bottom-0 right-0 w-5 h-5 rounded-full flex items-center justify-center border-2 opacity-0 group-hover:opacity-100 transition-opacity"
                           style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                        <span className="text-[9px]">📷</span>
                      </div>
                      <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} disabled={avatarUploading} />
                    </label>
                    <div className="mt-2 text-center space-y-2">
                      <div className="text-lg font-extrabold" style={{ color: "var(--text)" }}>{profile.name}</div>
                      <div className="flex flex-wrap justify-center gap-2">
                        <span className="text-xs font-bold px-2.5 py-1 rounded-full border"
                              style={{ background: riskColor + "1a", borderColor: riskColor + "55", color: riskColor }}>
                          {RISK_LABEL[profile.risk_tolerance] ?? profile.risk_tolerance}
                        </span>
                        {mentor && (
                          <span className="text-xs font-bold px-2.5 py-1 rounded-full border"
                                style={{ background: mentor.color + "1a", borderColor: mentor.color + "55", color: mentor.color }}>
                            {mentor.emoji} {mentor.name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="border-t flex" style={{ borderColor: "var(--border)" }}>
                    <button onClick={() => router.push("/onboarding")}
                            className="flex-1 py-3 text-xs font-semibold text-center hover:bg-white/5 transition-colors"
                            style={{ color: "var(--muted)" }}>
                      Editar perfil
                    </button>
                  </div>
                </div>

                {/* AI Insights */}
                {insights?.ready && (
                  <div className="rounded-2xl border p-4"
                       style={{ background: insights.risk_match === false ? "rgba(245,158,11,0.06)" : "var(--card)", borderColor: insights.risk_match === false ? "rgba(245,158,11,0.4)" : "rgba(34,197,94,0.4)" }}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-lg">🧠</span>
                      <span className="text-sm font-bold" style={{ color: "var(--text)" }}>La IA te ha analizado</span>
                    </div>
                    {insights.risk_match === false && insights.risk_note && (
                      <div className="rounded-xl p-3 mb-3 border" style={{ background: "rgba(245,158,11,0.1)", borderColor: "rgba(245,158,11,0.3)" }}>
                        <p className="text-xs font-bold mb-1" style={{ color: "#f59e0b" }}>⚠️ Tu comportamiento real difiere de tu perfil</p>
                        <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{insights.risk_note}</p>
                      </div>
                    )}
                    {insights.suggestion && (
                      <p className="text-sm leading-relaxed mb-3" style={{ color: "var(--sub)" }}>{insights.suggestion}</p>
                    )}
                    {insights.topics && insights.topics.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {insights.topics.map((t) => (
                          <span key={t} className="text-xs px-2.5 py-1 rounded-full border font-semibold"
                                style={{ background: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)", color: "#22c55e" }}>
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Datos personales */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>Datos personales</p>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Edad", value: String(getAge(profile.birth_date)), sub: "años", color: "#3b82f6" },
                      { label: "Ingresos", value: `$${Number(profile.monthly_income).toLocaleString()}`, sub: "/mes", color: "#22c55e" },
                      { label: "Aportación", value: `$${Number(profile.monthly_contribution).toLocaleString()}`, sub: "/mes", color: riskColor },
                    ].map((item) => (
                      <div key={item.label} className="rounded-2xl border p-3" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-2" style={{ background: item.color + "18" }}>
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: item.color }} />
                        </div>
                        <div className="text-xl font-extrabold leading-tight" style={{ color: "var(--text)" }}>{item.value}</div>
                        <div className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>{item.sub} · {item.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Perfil de riesgo */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>Perfil de riesgo</p>
                  <button onClick={() => setRiskExpanded((v) => !v)}
                          className="w-full text-left rounded-2xl border p-4 transition-colors hover:opacity-90"
                          style={{ background: "var(--card)", borderColor: riskColor + "55" }}>
                    <div className="flex items-start gap-3 mb-4">
                      <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: riskColor + "18" }}>
                        <BarChart className="w-6 h-6" style={{ color: riskColor }} />
                      </div>
                      <div className="flex-1">
                        <div className="font-bold text-base" style={{ color: "var(--text)" }}>{RISK_LABEL[profile.risk_tolerance] ?? profile.risk_tolerance}</div>
                        <div className="text-xs mt-1 leading-relaxed" style={{ color: "var(--muted)" }}>
                          {riskCat === "conservative" ? "Priorizas la seguridad y la preservación del capital."
                            : riskCat === "moderate" ? "Buscas equilibrio entre crecimiento y protección."
                            : "Tu objetivo es el máximo crecimiento a largo plazo."}
                        </div>
                      </div>
                      {riskExpanded
                        ? <ChevronUp className="w-4 h-4 shrink-0 mt-1" style={{ color: "var(--dim)" }} />
                        : <ChevronDown className="w-4 h-4 shrink-0 mt-1" style={{ color: "var(--dim)" }} />}
                    </div>
                    <div className="flex gap-1.5 mb-1">
                      {(["conservative", "moderate", "aggressive"] as const).map((key) => (
                        <div key={key} className="flex-1 rounded-full"
                             style={{ height: key === riskCat ? 8 : 5, background: key === riskCat ? riskColor : "var(--border)" }} />
                      ))}
                    </div>
                    <div className="flex justify-between text-[9px]" style={{ color: "var(--dim)" }}>
                      <span>Conservador</span><span>Moderado</span><span>Agresivo</span>
                    </div>
                    {riskExpanded && (
                      <div className="mt-4 pt-4 border-t space-y-3" style={{ borderColor: riskColor + "25" }}>
                        <div className="space-y-2">
                          {(riskDistributions[riskCat] ?? riskDistributions.moderate).map((item) => (
                            <div key={item.label}>
                              <div className="flex justify-between text-xs mb-1">
                                <span style={{ color: "var(--sub)" }}>{item.label}</span>
                                <span className="font-bold" style={{ color: item.color }}>{item.pct}%</span>
                              </div>
                              <div className="h-1 rounded-full" style={{ background: "var(--border)" }}>
                                <div className="h-1 rounded-full" style={{ width: `${item.pct}%`, background: item.color }} />
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          {(riskMetrics[riskCat] ?? riskMetrics.moderate).map((m) => (
                            <div key={m.label} className="flex-1 rounded-xl p-2 text-center" style={{ background: riskColor + "10" }}>
                              <div className="text-[9px] font-semibold mb-1" style={{ color: "var(--muted)" }}>{m.label}</div>
                              <div className="text-xs font-bold" style={{ color: riskColor }}>{m.val}</div>
                            </div>
                          ))}
                        </div>
                        <p className="text-xs" style={{ color: "var(--muted)" }}>
                          <span className="font-bold" style={{ color: "var(--sub)" }}>ETFs típicos: </span>
                          {riskETFs[riskCat]}
                        </p>
                      </div>
                    )}
                  </button>
                </div>

                {/* Madurez inversora */}
                <div>
                  <div className="flex items-baseline gap-2 mb-2 ml-0.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--dim)" }}>Madurez Inversora</p>
                    <p className="text-[9px] italic" style={{ color: "var(--dim)" }}>comportamiento en la app</p>
                  </div>
                  <div className="rounded-2xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="text-5xl font-black leading-none" style={{ color: maturity.color }}>
                          {maturityScore}<span className="text-xl font-normal ml-1" style={{ color: "var(--muted)" }}>/100</span>
                        </div>
                        <span className="inline-block mt-2 text-xs font-bold px-2.5 py-1 rounded-full border"
                              style={{ background: maturity.color + "18", borderColor: maturity.color + "40", color: maturity.color }}>
                          {maturity.label}
                        </span>
                      </div>
                      <div className="w-14 h-14 rounded-full border-2 flex items-center justify-center"
                           style={{ borderColor: maturity.color + "40", background: maturity.color + "0e" }}>
                        <BarChart className="w-7 h-7" style={{ color: maturity.color }} />
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full mb-1.5 overflow-hidden" style={{ background: "var(--border)" }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${maturityScore}%`, background: maturity.color }} />
                    </div>
                    <div className="flex justify-between text-[9px]" style={{ color: "var(--dim)" }}>
                      <span>Pasivo</span><span>Racional</span><span>Especulativo</span>
                    </div>
                    <p className="text-[10px] mt-2 leading-relaxed" style={{ color: "var(--dim)" }}>
                      Sube con cada buena decisión en la app (mantener calma, diversificar, largo plazo).
                    </p>
                    {maturityHistory.length > 0 && (
                      <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
                        <p className="text-[9px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>Últimas señales</p>
                        {maturityHistory.slice(-5).reverse().map((ev, i) => (
                          <div key={i} className={`flex items-center gap-2 py-1.5 ${i > 0 ? "border-t" : ""}`}
                               style={{ borderColor: "var(--border)" }}>
                            <span className="text-xs font-bold px-1.5 py-0.5 rounded"
                                  style={{ background: ev.delta >= 0 ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)", color: ev.delta >= 0 ? "#22c55e" : "#ef4444" }}>
                              {ev.delta >= 0 ? "+" : ""}{ev.delta}
                            </span>
                            <span className="text-xs flex-1 truncate" style={{ color: "var(--sub)" }}>
                              {ev.signals.map((s) => s.replace(/_/g, " ")).join(", ")}
                            </span>
                            <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>{ev.newScore}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Mentor card */}
                {mentor && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>Tu mentor</p>
                    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: mentor.color + "40" }}>
                      <div className="flex items-center gap-4 p-4" style={{ background: mentor.color + "0d" }}>
                        <div className="w-16 h-16 rounded-full flex items-center justify-center text-4xl shrink-0"
                             style={{ background: mentor.color + "22" }}>
                          {mentor.emoji}
                        </div>
                        <div className="flex-1">
                          <div className="font-bold text-base" style={{ color: "var(--text)" }}>{mentor.name}</div>
                          <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{mentor.title}</div>
                          <span className="inline-block mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded border"
                                style={{ background: mentor.color + "22", borderColor: mentor.color + "40", color: mentor.color }}>
                            {mentor.badge}
                          </span>
                        </div>
                      </div>
                      <div className="p-3 space-y-2" style={{ background: "var(--card)" }}>
                        {mentor.principles.map((p, i) => (
                          <div key={i} className="flex items-center gap-3 rounded-xl border px-3 py-2"
                               style={{ borderColor: mentor.color + "30", background: mentor.color + "08" }}>
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: mentor.color }} />
                            <span className="text-sm" style={{ color: "var(--sub)" }}>{p}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Mentor letter */}
                    <button onClick={openMentorLetter}
                            className="w-full mt-2 flex items-center gap-3 rounded-2xl border p-4 hover:opacity-80 transition-opacity"
                            style={{ background: mentor.color + "0a", borderColor: mentor.color + "35" }}>
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                           style={{ background: mentor.color + "20" }}>
                        {letterLoading
                          ? <Loader2 className="w-5 h-5 animate-spin" style={{ color: mentor.color }} />
                          : <span className="text-xl">✉️</span>}
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-sm font-bold" style={{ color: "var(--text)" }}>Carta de {mentor.name.split(" ")[0]}</div>
                        <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>Tu carta mensual personalizada</div>
                      </div>
                      <ChevronDown className="w-4 h-4 shrink-0" style={{ color: mentor.color }} />
                    </button>
                  </div>
                )}

                {/* Perfil psicológico */}
                {profile.quiz_answers && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>Perfil psicológico</p>
                    <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                      {(["q1","q2","q3","q4","q5"] as const).map((key, i) => {
                        const answer = profile.quiz_answers?.[key] as string;
                        const aColor = answer ? (ANSWER_COLORS[answer] ?? "var(--accent)") : "var(--dim)";
                        return (
                          <div key={key} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t" : ""}`}
                               style={{ borderColor: "var(--border)" }}>
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-sm"
                                 style={{ background: aColor + "15" }}>
                              {["📊","⏳","📚","🎲","⚙️"][i]}
                            </div>
                            <div className="flex-1">
                              <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "var(--dim)" }}>{QUIZ_CATEGORIES[i]}</div>
                              <div className="text-sm font-semibold mt-0.5" style={{ color: "var(--text)" }}>
                                {answer ? QUIZ_LABELS[key][answer] : "—"}
                              </div>
                            </div>
                            {answer && (
                              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0"
                                   style={{ background: aColor }}>
                                {answer}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Suscripción */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>Suscripción</p>
                  {isPremium ? (
                    <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "rgba(245,158,11,0.5)" }}>
                      <div className="h-0.5" style={{ background: "#f59e0b" }} />
                      <div className="flex items-center gap-3 p-4">
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "rgba(245,158,11,0.15)" }}>
                          <Star className="w-6 h-6 fill-current" style={{ color: "#f59e0b" }} />
                        </div>
                        <div className="flex-1">
                          <div className="font-bold" style={{ color: "var(--text)" }}>Nuvos AI Premium</div>
                          <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>Acceso completo · Mensajes ilimitados</div>
                        </div>
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold"
                             style={{ background: "rgba(34,197,94,0.15)", borderColor: "rgba(34,197,94,0.4)", color: "#22c55e" }}>
                          <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                          Activo
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                      <div className="flex items-center gap-3 p-4">
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "var(--raised)" }}>
                          <User className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
                        </div>
                        <div className="flex-1">
                          <div className="font-bold" style={{ color: "var(--text)" }}>Plan Gratis</div>
                          <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                            {remaining === Infinity ? FREE_MSG_LIMIT : remaining}/{FREE_MSG_LIMIT} mensajes hoy
                          </div>
                        </div>
                      </div>
                      <div className="h-1 mx-4 rounded-full mb-3 overflow-hidden" style={{ background: "var(--border)" }}>
                        <div className="h-full rounded-full" style={{
                          width: `${Math.round(((FREE_MSG_LIMIT - (remaining === Infinity ? 0 : remaining)) / FREE_MSG_LIMIT) * 100)}%`,
                          background: remaining < 5 ? "#ef4444" : "var(--accent)",
                        }} />
                      </div>
                      <button onClick={() => setPaywallOpen(true)}
                              className="mx-4 mb-4 w-[calc(100%-2rem)] py-3 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2"
                              style={{ background: "linear-gradient(90deg, #f59e0b, #f97316)" }}>
                        <Star className="w-4 h-4 fill-current" />
                        Activar Premium — $9.83/mes
                      </button>
                    </div>
                  )}
                </div>

                {/* Legal */}
                <div className="flex justify-center gap-5 py-1">
                  <a href="/privacy" className="text-xs hover:opacity-80 transition-opacity" style={{ color: "var(--dim)" }}>Política de privacidad</a>
                  <span style={{ color: "var(--dim)" }}>·</span>
                  <a href="/terms" className="text-xs hover:opacity-80 transition-opacity" style={{ color: "var(--dim)" }}>Términos de uso</a>
                </div>

                {/* Logout */}
                <button onClick={handleLogout}
                        className="w-full py-3 rounded-2xl border flex items-center justify-center gap-2 text-sm font-semibold hover:opacity-80 transition-opacity"
                        style={{ borderColor: "rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.06)", color: "#ef4444" }}>
                  <LogOut className="w-4 h-4" />
                  Cerrar sesión
                </button>

                {/* Delete account */}
                <button onClick={handleDeleteAccount}
                        className="w-full py-3 text-xs text-center hover:opacity-70 transition-opacity"
                        style={{ color: "var(--dim)" }}>
                  Eliminar mi cuenta
                </button>
              </>
            )}
          </div>
        </main>
      </div>

      {/* Mentor letter modal */}
      {letterOpen && mentor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6"
             style={{ background: "rgba(0,0,0,0.7)" }}
             onClick={() => setLetterOpen(false)}>
          <div className="rounded-3xl border p-6 max-w-md w-full max-h-[80vh] flex flex-col"
               style={{ background: mentor.color + "0f", borderColor: mentor.color + "40" }}
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold tracking-wider uppercase" style={{ color: mentor.color }}>{mentor.name}</span>
              <button onClick={() => setLetterOpen(false)} style={{ color: mentor.color }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              <p className="text-sm leading-relaxed italic" style={{ color: "var(--text)" }}>{letter}</p>
            </div>
          </div>
        </div>
      )}

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} />
    </div>
  );
}
