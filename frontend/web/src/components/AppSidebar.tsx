"use client";

import { useState, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  BookOpen, PieChart, BarChart2, Bell, User, GraduationCap, Trophy,
  MessageSquare, ChevronRight, Plus, X, HeadphonesIcon, GripVertical, Eye,
} from "lucide-react";
import {
  useProfileStore, useNotificationStore, useSubscriptionStore,
  useChatStore, msgsRemaining, FREE_MSG_LIMIT,
} from "@/lib/store";
import PaywallModal from "@/components/PaywallModal";

const NAV = [
  { href: "/chat",          icon: BookOpen,       label: "Chat" },
  { href: "/portfolio",     icon: PieChart,       label: "Portafolio" },
  { href: "/watchlist",     icon: Eye,            label: "Watchlist" },
  { href: "/paper",         icon: BarChart2,      label: "Paper Trading" },
  { href: "/learn",         icon: GraduationCap,  label: "Aprendizaje" },
  { href: "/arena",         icon: Trophy,         label: "Arena" },
  { href: "/notifications", icon: Bell,           label: "Notificaciones" },
  { href: "/support",       icon: HeadphonesIcon, label: "Soporte" },
  { href: "/profile",       icon: User,           label: "Perfil" },
];

const RISK_SEGMENTS = [
  { key: "conservative",           color: "#00d47e", pct: 8  },
  { key: "conservative_moderate",  color: "#3ecf8e", pct: 18 },
  { key: "moderate",               color: "#8bd44e", pct: 30 },
  { key: "moderate_growth",        color: "#c5d43c", pct: 42 },
  { key: "growth",                 color: "#f5c842", pct: 55 },
  { key: "aggressive",             color: "#f5973a", pct: 68 },
  { key: "aggressive_speculative", color: "#f5613a", pct: 82 },
  { key: "speculative",            color: "#ff2d3b", pct: 100 },
];

const RISK_LABEL: Record<string, string> = {
  conservative: "Conservador", conservative_moderate: "Cons-Moderado",
  moderate: "Moderado", moderate_growth: "Mod-Growth", growth: "Growth",
  aggressive: "Agresivo", aggressive_speculative: "Agr-Especulativo", speculative: "Especulativo",
};

function RiskBar({ level }: { level: string }) {
  const seg = RISK_SEGMENTS.find((s) => s.key === level);
  if (!seg) return null;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] font-semibold" style={{ color: seg.color }}>
          {RISK_LABEL[level] ?? level}
        </div>
        <div className="text-[11px] font-black" style={{ color: seg.color }}>{seg.pct}%</div>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${seg.pct}%`, background: seg.color }}
        />
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

  const [navOrder, setNavOrder] = useState<string[]>(() => {
    if (typeof window === "undefined") return NAV.map((n) => n.href);
    try {
      const saved = localStorage.getItem("nuvos_nav_order");
      if (saved) {
        const parsed: string[] = JSON.parse(saved);
        const current = NAV.map((n) => n.href);
        const valid = parsed.filter((h) => current.includes(h));
        const missing = current.filter((h) => !valid.includes(h));
        return [...valid, ...missing];
      }
    } catch {}
    return NAV.map((n) => n.href);
  });
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const dragItem = useRef<string | null>(null);

  const orderedNav = navOrder.map((href) => NAV.find((n) => n.href === href)!).filter(Boolean);
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

  const handleDragStart = (href: string) => {
    dragItem.current = href;
    setDragging(href);
  };

  const handleDragOver = (e: React.DragEvent, href: string) => {
    e.preventDefault();
    if (dragItem.current !== href) setDragOver(href);
  };

  const handleDrop = (e: React.DragEvent, targetHref: string) => {
    e.preventDefault();
    const from = dragItem.current;
    if (!from || from === targetHref) { setDragOver(null); return; }
    const next = [...navOrder];
    const fi = next.indexOf(from);
    const ti = next.indexOf(targetHref);
    next.splice(fi, 1);
    next.splice(ti, 0, from);
    setNavOrder(next);
    localStorage.setItem("nuvos_nav_order", JSON.stringify(next));
    dragItem.current = null;
    setDragging(null);
    setDragOver(null);
  };

  const handleDragEnd = () => {
    dragItem.current = null;
    setDragging(null);
    setDragOver(null);
  };

  return (
    <>
      <aside className={`${open ? "flex" : "hidden"} lg:flex w-64 flex-col absolute lg:relative z-20 h-full sidebar-gradient`}>

        {/* Profile widget */}
        {profile && (
          <div className="px-3 pb-3 pt-2 shrink-0">
            <div className="rounded-2xl p-3 card-accent">
              {/* Avatar + name */}
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 flex items-center justify-center text-sm font-black text-white"
                     style={{ background: "var(--grad-green)" }}>
                  {profile.avatar_url
                    ? <img src={profile.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                    : profile.name.charAt(0).toUpperCase()
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold truncate" style={{ color: "var(--text)" }}>{profile.name}</div>
                  <div className="text-[10px]" style={{ color: "var(--muted)" }}>Perfil activo</div>
                </div>
              </div>

              {/* Stats: edad, ingresos, aportación */}
              <div className="grid grid-cols-3 gap-1.5 mb-3">
                {[
                  { label: "Edad", value: (() => { if (!profile.birth_date) return "—"; const sep = profile.birth_date.includes("/") ? "/" : "-"; const p = profile.birth_date.split(sep).map(Number); const [y, m, d] = sep === "-" ? p : [p[2], p[1], p[0]]; const t = new Date(); let a = t.getFullYear() - y; if (t.getMonth() + 1 < m || (t.getMonth() + 1 === m && t.getDate() < d)) a--; return String(Math.max(0, a)); })(), sub: "años" },
                  { label: "Ingresos", value: `$${Number(profile.monthly_income).toLocaleString()}`, sub: "/mes" },
                  { label: "Inversión", value: `$${Number(profile.monthly_contribution).toLocaleString()}`, sub: "/mes" },
                ].map(({ label, value, sub }) => (
                  <div key={label} className="rounded-xl p-2 text-center"
                       style={{ background: "var(--bg)" }}>
                    <div className="text-[9px] font-semibold uppercase tracking-wide mb-0.5"
                         style={{ color: "var(--dim)" }}>{label}</div>
                    <div className="text-[11px] font-black leading-none"
                         style={{ color: "var(--text)" }}>{value}</div>
                    <div className="text-[9px] mt-0.5" style={{ color: "var(--muted)" }}>{sub}</div>
                  </div>
                ))}
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
            {orderedNav.map(({ href, icon: Icon, label }) => {
              const active = pathname === href;
              const badge = href === "/notifications" && unreadCount > 0;
              return (
                <button
                  key={href}
                  draggable
                  onDragStart={() => handleDragStart(href)}
                  onDragOver={(e) => handleDragOver(e, href)}
                  onDrop={(e) => handleDrop(e, href)}
                  onDragEnd={handleDragEnd}
                  onClick={() => navigate(href)}
                  className={`nav-item ${active ? "active" : ""} group transition-opacity`}
                  style={{
                    opacity: dragging === href ? 0.35 : 1,
                    borderTop: dragOver === href ? "2px solid var(--accent)" : undefined,
                  }}
                >
                  <GripVertical
                    className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-40 cursor-grab active:cursor-grabbing transition-opacity"
                    style={{ color: "var(--muted)" }}
                  />
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
