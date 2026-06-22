"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Home, BarChart2, Bot, BookOpen, Bell, ArrowRight } from "lucide-react";

export const HOME_SCREEN_KEY = "nuvos_home_screen";

const OPTIONS = [
  { key: "home",          label: "Inicio",        sub: "Dashboard y resumen diario",          icon: Home,      color: "#00d47e", href: "/home" },
  { key: "portfolio",     label: "Patrimonio",     sub: "Tu portafolio y rendimiento",          icon: BarChart2, color: "#3b82f6", href: "/portfolio" },
  { key: "chat",          label: "Mentor IA",      sub: "Pregúntale lo que quieras",            icon: Bot,       color: "#8b5cf6", href: "/chat" },
  { key: "learn",         label: "Aprendizaje",    sub: "Lecciones y racha diaria",             icon: BookOpen,  color: "#f59e0b", href: "/learn" },
  { key: "notifications", label: "Notificaciones", sub: "Lo más importante de tus activos",     icon: Bell,      color: "#ef4444", href: "/notifications" },
] as const;

export type HomeScreenKey = (typeof OPTIONS)[number]["key"];

interface Props {
  onDone: (href: string) => void;
}

export default function HomeScreenPickerModal({ onDone }: Props) {
  const [selected, setSelected] = useState<HomeScreenKey | null>(null);

  const handleConfirm = () => {
    if (!selected) return;
    const opt = OPTIONS.find((o) => o.key === selected)!;
    localStorage.setItem(HOME_SCREEN_KEY, selected);
    onDone(opt.href);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)" }}
    >
      <div
        className="w-full max-w-sm rounded-3xl overflow-hidden flex flex-col"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        {/* Header */}
        <div className="px-6 pt-7 pb-4 text-center">
          <div className="text-4xl mb-3">🎉</div>
          <p className="text-lg font-black" style={{ color: "var(--text)" }}>
            ¡Configuración completa!
          </p>
          <p className="text-sm mt-1.5" style={{ color: "var(--muted)" }}>
            ¿Qué pantalla prefieres ver primero cada vez que entres?
          </p>
        </div>

        {/* Options */}
        <div className="px-4 pb-4 space-y-2">
          {OPTIONS.map(({ key, label, sub, icon: Icon, color }) => {
            const active = selected === key;
            return (
              <button
                key={key}
                onClick={() => setSelected(key)}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left transition-all active:scale-[0.98]"
                style={{
                  background: active ? `${color}14` : "var(--raised)",
                  border: `1.5px solid ${active ? color : "transparent"}`,
                }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: active ? `${color}22` : "var(--border)" }}
                >
                  <Icon className="w-5 h-5" style={{ color: active ? color : "var(--muted)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black" style={{ color: active ? color : "var(--text)" }}>
                    {label}
                  </p>
                  <p className="text-xs truncate" style={{ color: "var(--muted)" }}>{sub}</p>
                </div>
                {active && (
                  <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                       style={{ background: color }}>
                    <div className="w-2 h-2 rounded-full bg-white" />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* CTA */}
        <div className="px-4 pb-6">
          <button
            onClick={handleConfirm}
            disabled={!selected}
            className="w-full py-3.5 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-40 active:scale-95"
            style={{
              background: selected
                ? `linear-gradient(135deg, #00d47ecc, #00d47e)`
                : "var(--raised)",
              color: selected ? "#fff" : "var(--muted)",
              boxShadow: selected ? "0 4px 20px rgba(0,212,126,0.35)" : "none",
            }}
          >
            Empezar
            <ArrowRight className="w-4 h-4" />
          </button>
          <p className="text-center text-xs mt-3" style={{ color: "var(--dim)" }}>
            Puedes cambiarlo en cualquier momento desde tu perfil
          </p>
        </div>
      </div>
    </div>
  );
}
