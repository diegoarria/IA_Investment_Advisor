"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore, useProfileStore, useNotificationStore } from "@/lib/store";
import { TrendingUp, BookOpen, PieChart, BarChart2, Bell, User, LogOut, Menu, X, GraduationCap } from "lucide-react";
import { useState } from "react";

const RISK_LABEL: Record<string, string> = {
  conservative:           "Conservador",
  conservative_moderate:  "Conservador-Moderado",
  moderate:               "Moderado",
  moderate_growth:        "Moderado-Growth",
  growth:                 "Growth",
  aggressive:             "Agresivo",
  aggressive_speculative: "Agresivo-Especulativo",
  speculative:            "Especulativo",
};

const RISK_COLOR: Record<string, string> = {
  conservative:           "#4d9fff",
  conservative_moderate:  "#00d47e",
  moderate:               "#00a85e",
  moderate_growth:        "#f59e0b",
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

const NAV = [
  { href: "/chat",          icon: BookOpen,      label: "Chat" },
  { href: "/portfolio",     icon: PieChart,      label: "Portafolio" },
  { href: "/paper",         icon: BarChart2,     label: "Paper Trading" },
  { href: "/learn",         icon: GraduationCap, label: "Aprendizaje" },
  { href: "/notifications", icon: Bell,          label: "Notificaciones" },
  { href: "/profile",       icon: User,          label: "Perfil" },
];

function getAge(birthDate: string): number {
  if (!birthDate) return 0;
  const [y, m, d] = birthDate.split("-").map(Number);
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return age;
}

export default function ProfilePage() {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, clearAuth } = useAuthStore();
  const { profile } = useProfileStore();
  const { notifications } = useNotificationStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => { if (!isAuthenticated) router.push("/"); }, [isAuthenticated]);

  const riskColor = profile ? (RISK_COLOR[profile.risk_tolerance] ?? "var(--accent)") : "var(--accent)";
  const initial = profile?.name?.charAt(0).toUpperCase() ?? "?";
  const age = profile?.birth_date ? getAge(profile.birth_date) : null;

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      {/* Top bar */}
      <div className="border-b flex items-center justify-between px-4 py-2 shrink-0"
           style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-1" style={{ color: "var(--muted)" }}>
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "var(--accent)" }}>
              <TrendingUp className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvo</span>
          </div>
        </div>
        <span className="font-semibold text-sm" style={{ color: "var(--sub)" }}>Mi Perfil</span>
        <button onClick={() => { clearAuth(); router.push("/"); }}
                className="p-2 rounded-lg hover:bg-[#1a0a0a] transition-colors" style={{ color: "#ff4757" }}>
          <LogOut className="w-4 h-4" />
        </button>
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
        </aside>

        <main className="flex-1 overflow-y-auto scrollbar-thin p-4 max-w-2xl mx-auto w-full space-y-4">
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
              {/* Header card */}
              <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: riskColor + "44" }}>
                <div className="h-1" style={{ background: riskColor }} />
                <div className="flex items-center gap-4 p-5">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl font-black text-white shrink-0"
                       style={{ background: riskColor }}>
                    {initial}
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-lg font-extrabold" style={{ color: "var(--text)" }}>{profile.name}</div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold"
                          style={{ background: riskColor + "1a", borderColor: riskColor + "55", color: riskColor }}>
                      {RISK_LABEL[profile.risk_tolerance] ?? profile.risk_tolerance}
                    </span>
                    {profile.mentor && (
                      <div className="text-xs" style={{ color: "var(--muted)" }}>Mentor: {profile.mentor}</div>
                    )}
                  </div>
                </div>
                <div className="border-t" style={{ borderColor: "var(--border)" }}>
                  <button onClick={() => router.push("/onboarding")}
                          className="w-full py-3 text-xs font-semibold text-center transition-colors hover:bg-[#0e1628]"
                          style={{ color: "var(--accent-l)" }}>
                    Editar perfil
                  </button>
                </div>
              </div>

              {/* Financial data */}
              <div>
                <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--sub)" }}>Datos Financieros</div>
                <div className="rounded-xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  {([
                    age !== null ? { label: "Edad", value: `${age} años` } : null,
                    { label: "Ingresos mensuales", value: `$${Number(profile.monthly_income).toLocaleString()} USD` },
                    { label: "Aportación mensual", value: `$${Number(profile.monthly_contribution).toLocaleString()} USD` },
                  ].filter((r): r is { label: string; value: string } => r !== null)).map((row, i) => (
                    <div key={row.label} className={`flex items-center justify-between px-4 py-3 ${i > 0 ? "border-t" : ""}`}
                         style={{ borderColor: "var(--border)" }}>
                      <span className="text-sm" style={{ color: "var(--muted)" }}>{row.label}</span>
                      <span className="text-sm font-bold" style={{ color: "var(--text)" }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quiz answers */}
              {profile.quiz_answers && Object.keys(profile.quiz_answers).length > 0 && (
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--sub)" }}>Respuestas del Cuestionario</div>
                  <div className="rounded-xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                    {(["q1","q2","q3","q4","q5"] as const).map((key, i) => {
                      const answer = profile.quiz_answers?.[key] as string;
                      const label = QUIZ_LABELS[key]?.[answer] ?? "—";
                      return (
                        <div key={key} className={`flex items-center justify-between px-4 py-3 ${i > 0 ? "border-t" : ""}`}
                             style={{ borderColor: "var(--border)" }}>
                          <span className="text-xs" style={{ color: "var(--muted)" }}>{QUIZ_CATEGORIES[i]}</span>
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full text-white text-[10px] font-black flex items-center justify-center"
                                  style={{ background: "var(--accent)" }}>{answer}</span>
                            <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>{label}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Logout */}
              <button onClick={() => { if (confirm("¿Cerrar sesión?")) { clearAuth(); router.push("/"); } }}
                      className="w-full py-3 rounded-xl border text-sm font-semibold flex items-center justify-center gap-2 transition-colors hover:bg-[#1a0a0a]"
                      style={{ borderColor: "rgba(255,71,87,0.3)", color: "#ff4757" }}>
                <LogOut className="w-4 h-4" />
                Cerrar sesión
              </button>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
