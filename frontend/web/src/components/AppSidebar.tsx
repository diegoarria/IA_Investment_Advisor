"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Image from "next/image";
import {
  BookOpen, PieChart, BarChart2, Bell, User, GraduationCap, Trophy,
  MessageSquare, ChevronRight, Plus, X,
} from "lucide-react";
import {
  useProfileStore, useNotificationStore, useSubscriptionStore,
  useChatStore, msgsRemaining, FREE_MSG_LIMIT,
} from "@/lib/store";
import PaywallModal from "@/components/PaywallModal";

const NAV = [
  { href: "/chat",          icon: BookOpen,      label: "Chat" },
  { href: "/portfolio",     icon: PieChart,      label: "Portafolio" },
  { href: "/paper",         icon: BarChart2,     label: "Paper Trading" },
  { href: "/learn",         icon: GraduationCap, label: "Aprendizaje" },
  { href: "/arena",         icon: Trophy,        label: "Arena" },
  { href: "/notifications", icon: Bell,          label: "Notificaciones" },
  { href: "/profile",       icon: User,          label: "Perfil" },
];

const RISK_SEGMENTS = [
  { key: "conservative",           color: "#00d47e" },
  { key: "conservative_moderate",  color: "#3ecf8e" },
  { key: "moderate",               color: "#8bd44e" },
  { key: "moderate_growth",        color: "#c5d43c" },
  { key: "growth",                 color: "#f5c842" },
  { key: "aggressive",             color: "#f5973a" },
  { key: "aggressive_speculative", color: "#f5613a" },
  { key: "speculative",            color: "#ff2d3b" },
];

const RISK_LABEL: Record<string, string> = {
  conservative: "Conservador", conservative_moderate: "Cons-Moderado",
  moderate: "Moderado", moderate_growth: "Mod-Growth", growth: "Growth",
  aggressive: "Agresivo", aggressive_speculative: "Agr-Especulativo", speculative: "Especulativo",
};

function RiskBar({ level }: { level: string }) {
  const idx = RISK_SEGMENTS.findIndex((s) => s.key === level);
  if (idx < 0) return null;
  return (
    <div>
      <div className="flex gap-0.5 mb-1">
        {RISK_SEGMENTS.map((seg, i) => (
          <div key={seg.key} className="h-1.5 flex-1 rounded-full"
               style={{ background: i <= idx ? seg.color : "var(--border)", opacity: i === idx ? 1 : i < idx ? 0.65 : 0.25 }} />
        ))}
      </div>
      <div className="text-[10px] font-semibold" style={{ color: RISK_SEGMENTS[idx]?.color }}>
        {RISK_LABEL[level] ?? level}
      </div>
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function AppSidebar({ open, onClose }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { profile } = useProfileStore();
  const { notifications } = useNotificationStore();
  const subStore = useSubscriptionStore();
  const { sessions, currentId, createSession, loadSession, deleteSession } = useChatStore();
  const [historyOpen, setHistoryOpen] = useState(true);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const isPremium = subStore.tier === "premium";
  const remaining = msgsRemaining(subStore);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const navigate = (href: string) => { router.push(href); onClose(); };

  const handleNewChat = () => {
    createSession();
    navigate("/chat");
  };

  const handleLoadSession = (id: string) => {
    loadSession(id);
    navigate("/chat");
  };

  return (
    <>
      <aside className={`${open ? "flex" : "hidden"} lg:flex w-64 flex-col absolute lg:relative z-20 h-full sidebar-gradient`}>

        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-3 shrink-0">
          <div className="relative shrink-0">
            <Image src="/logo.png" alt="Nuvos AI" width={30} height={30} className="rounded-xl object-cover" />
            <div className="absolute -inset-0.5 rounded-xl blur-sm opacity-30" style={{ background: "var(--grad-green)" }} />
          </div>
          <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvos AI</span>
        </div>

        {/* Profile widget */}
        {profile && (
          <div className="px-3 pb-2 shrink-0">
            <div className="rounded-2xl p-3 card-accent">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-black text-white shrink-0"
                     style={{ background: "var(--grad-green)" }}>
                  {profile.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold truncate" style={{ color: "var(--text)" }}>{profile.name}</div>
                  <div className="text-[10px]" style={{ color: "var(--muted)" }}>Perfil activo</div>
                </div>
              </div>
              <RiskBar level={profile.risk_tolerance} />
            </div>
          </div>
        )}

        {/* Premium CTA */}
        {!isPremium && (
          <div className="px-3 pb-2 space-y-2 shrink-0">
            <button onClick={() => setPaywallOpen(true)}
                    className="w-full rounded-xl p-2.5 text-left transition-all hover:border-[var(--accent-l)]"
                    style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Mensajes hoy</span>
                <span className="text-[10px] font-bold" style={{ color: remaining < 5 ? "var(--down)" : "var(--accent-l)" }}>
                  {remaining}/{FREE_MSG_LIMIT}
                </span>
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                <div className="h-full rounded-full transition-all"
                     style={{ width: `${Math.round(((FREE_MSG_LIMIT - remaining) / FREE_MSG_LIMIT) * 100)}%`, background: remaining < 5 ? "var(--down)" : "var(--grad-green)" }} />
              </div>
            </button>
            <button onClick={() => setPaywallOpen(true)} className="btn-primary w-full text-xs py-2">
              ⭐ Activar Premium
            </button>
          </div>
        )}

        {/* Scrollable area: nav + chat history */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <nav className="px-2 py-1 space-y-0.5">
            {NAV.map(({ href, icon: Icon, label }) => {
              const active = pathname === href;
              const badge = href === "/notifications" && unreadCount > 0;
              return (
                <button key={href} onClick={() => navigate(href)}
                        className={`nav-item ${active ? "active" : ""}`}>
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{label}</span>
                  {badge && (
                    <span className="ml-auto badge-green" style={{ fontSize: "10px" }}>{unreadCount}</span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Chat history */}
          <div className="px-2 mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between px-1 mb-1">
              <button onClick={() => setHistoryOpen((v) => !v)}
                      className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide hover:opacity-80 transition-opacity"
                      style={{ color: "var(--muted)" }}>
                <MessageSquare className="w-3 h-3" />
                Chats recientes
                <ChevronRight className={`w-3 h-3 transition-transform ${historyOpen ? "rotate-90" : ""}`} />
              </button>
              <button onClick={handleNewChat}
                      className="w-5 h-5 rounded flex items-center justify-center border transition-colors hover:border-[var(--accent)]"
                      style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                      title="Nuevo chat">
                <Plus className="w-3 h-3" />
              </button>
            </div>

            {historyOpen && (
              <div className="space-y-0.5">
                {sessions.length === 0 ? (
                  <p className="text-xs px-2 py-2" style={{ color: "var(--dim)" }}>Sin chats guardados</p>
                ) : (
                  sessions.slice(0, 30).map((s) => (
                    <div key={s.id}
                         onClick={() => handleLoadSession(s.id)}
                         className="flex items-center gap-2 group px-2 py-2 rounded-lg cursor-pointer transition-colors"
                         style={{ background: s.id === currentId ? "rgba(0,168,94,0.1)" : "transparent" }}>
                      <MessageSquare className="w-3 h-3 shrink-0"
                                     style={{ color: s.id === currentId ? "var(--accent-l)" : "var(--dim)" }} />
                      <span className="text-xs flex-1 truncate"
                            style={{ color: s.id === currentId ? "var(--accent-l)" : "var(--sub)" }}>
                        {s.title}
                      </span>
                      <button onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                              style={{ color: "var(--dim)" }}>
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Bottom: update profile */}
        <div className="px-3 py-2 shrink-0">
          <button onClick={() => navigate("/onboarding")}
                  className="w-full text-xs text-center py-2 rounded-lg hover:bg-white/5 transition-colors"
                  style={{ color: "var(--dim)" }}>
            Actualizar perfil
          </button>
        </div>
      </aside>

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} />
    </>
  );
}
