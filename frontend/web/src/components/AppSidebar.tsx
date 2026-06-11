"use client";

import { useState, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  BookOpen, PieChart, BarChart2, Bell, User, GraduationCap, Trophy,
  MessageSquare, ChevronLeft, ChevronRight, Plus, X, HeadphonesIcon, GripVertical, Eye, Play, ArrowRight, Lock,
} from "lucide-react";

const COACHING_URL = "https://calendly.com/diego-arria19/sesion-1-1-con-diego-nuvos-ai"; // ← actualiza con tu link real
import {
  useProfileStore, useNotificationStore, useSubscriptionStore,
  useChatStore, msgsRemaining, FREE_MSG_LIMIT,
  behavioralRiskColor, behavioralRiskLabel,
} from "@/lib/store";
import { getUserLevel, isAtLeast, LEVEL_LABEL, LEVEL_COLOR, LEVEL_EMOJI, type UserLevel } from "@/lib/userLevel";
import PaywallModal from "@/components/PaywallModal";

const NAV: Array<{ href: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; label: string; minLevel: UserLevel }> = [
  { href: "/chat",          icon: BookOpen,       label: "Chat",           minLevel: "principiante" },
  { href: "/portfolio",     icon: PieChart,       label: "Portafolio",     minLevel: "principiante" },
  { href: "/watchlist",     icon: Eye,            label: "Watchlist",      minLevel: "basico" },
  { href: "/feed",          icon: Play,           label: "Videos",         minLevel: "principiante" },
  { href: "/paper",         icon: BarChart2,      label: "Simulador",      minLevel: "basico" },
  { href: "/learn",         icon: GraduationCap,  label: "Aprendizaje",    minLevel: "principiante" },
  { href: "/arena",         icon: Trophy,         label: "Play",           minLevel: "intermedio" },
  { href: "/notifications", icon: Bell,           label: "Notificaciones", minLevel: "principiante" },
  { href: "/support",       icon: HeadphonesIcon, label: "Soporte",        minLevel: "principiante" },
  { href: "/profile",       icon: User,           label: "Perfil",         minLevel: "principiante" },
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

function RiskBar({ level, behavioralScore }: { level: string; behavioralScore: number | null }) {
  const seg = RISK_SEGMENTS.find((s) => s.key === level);
  const hasBehavioral = behavioralScore !== null;
  const displayPct   = hasBehavioral ? behavioralScore : (seg?.pct ?? 50);
  const color        = hasBehavioral ? behavioralRiskColor(behavioralScore!) : (seg?.color ?? "var(--accent)");
  const label        = hasBehavioral ? behavioralRiskLabel(behavioralScore!) : (RISK_LABEL[level] ?? level);
  const staticPct    = seg?.pct ?? 50;

  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <div className="text-[8px] font-semibold" style={{ color }}>{label}</div>
        <div className="flex items-center gap-1">
          {hasBehavioral && (
            <span className="text-[7px]" style={{ color: "var(--dim)" }} title="Perfil declarado">
              {RISK_LABEL[level] ?? level}
            </span>
          )}
          <div className="text-[13px] font-black" style={{ color }}>{displayPct}</div>
        </div>
      </div>
      <div className="relative h-1 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
        <div className="absolute inset-y-0 left-0 rounded-full opacity-25 transition-all duration-700"
             style={{ width: `${staticPct}%`, background: seg?.color ?? "var(--accent)" }} />
        <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
             style={{ width: `${displayPct}%`, background: color }} />
      </div>
      {hasBehavioral && (
        <div className="text-[6px] mt-0.5" style={{ color: "var(--dim)" }}>
          Riesgo conductual en tiempo real
        </div>
      )}
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
  const { profile, behavioralRiskScore } = useProfileStore();
  const { notifications } = useNotificationStore();
  const subStore = useSubscriptionStore();
  const { sessions, currentId, createSession, loadSession, deleteSession } = useChatStore();
  const [historyOpen, setHistoryOpen] = useState(true);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("nuvos_sidebar_collapsed") === "1";
  });

  const toggleDesktop = () => {
    const next = !desktopCollapsed;
    setDesktopCollapsed(next);
    localStorage.setItem("nuvos_sidebar_collapsed", next ? "1" : "0");
  };

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
  const userLevel  = getUserLevel(profile);
  const isPremium      = subStore.tier === "premium";
  const isTrialPremium = subStore.isTrialPremium;
  const trialDaysLeft  = subStore.trialDaysLeft;
  const remaining      = msgsRemaining(subStore);
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
      {/* Desktop floating tab — shown only when sidebar is collapsed on lg+ */}
      {desktopCollapsed && (
        <button
          onClick={toggleDesktop}
          className="hidden lg:flex fixed left-0 top-1/2 -translate-y-1/2 z-30 flex-col items-center justify-center w-5 h-16 rounded-r-xl transition-all hover:w-6"
          style={{ background: "var(--card)", border: "1px solid var(--border)", borderLeft: "none", boxShadow: "2px 0 8px rgba(0,0,0,0.15)" }}
          title="Abrir sidebar"
        >
          <ChevronRight className="w-3 h-3" style={{ color: "var(--muted)" }} />
        </button>
      )}

      <aside className={`${open ? "flex" : "hidden"} ${desktopCollapsed ? "lg:hidden" : "lg:flex"} w-64 flex-col absolute lg:relative z-20 h-full sidebar-gradient`} style={{ zoom: 1.15 }}>

        {/* Desktop collapse button — top right of sidebar */}
        <div className="hidden lg:flex justify-end px-2 pt-1.5 shrink-0">
          <button
            onClick={toggleDesktop}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/5 transition-colors"
            style={{ color: "var(--dim)" }}
            title="Cerrar sidebar"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        {/* Profile widget */}
        {profile && (
          <div className="px-2 pb-1.5 pt-1.5 shrink-0">
            <div className="rounded-xl p-2 card-accent">
              {/* Avatar + name */}
              <div className="flex items-center gap-1.5 mb-1.5">
                <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 flex items-center justify-center text-base font-black text-white"
                     style={{ background: "var(--grad-green)" }}>
                  {profile.avatar_url
                    ? <img src={profile.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                    : profile.name.charAt(0).toUpperCase()
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold truncate mb-0.5" style={{ color: "var(--text)" }}>{profile.name}</div>
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[8px] font-bold px-1.5 py-px rounded-full"
                          style={{ background: `${LEVEL_COLOR[userLevel]}18`, color: LEVEL_COLOR[userLevel], border: `1px solid ${LEVEL_COLOR[userLevel]}35` }}>
                      {LEVEL_EMOJI[userLevel]} {LEVEL_LABEL[userLevel]}
                    </span>
                    {isPremium ? (
                      <span className="text-[8px] font-black px-1 py-px rounded-full"
                            style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
                        ✦ Premium
                      </span>
                    ) : (
                      <span className="text-[8px] font-semibold px-1 py-px rounded-full"
                            style={{ background: "var(--raised)", color: "var(--dim)" }}>
                        Free
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Stats: edad, ingresos, aportación */}
              <div className="grid grid-cols-3 gap-0.5 mb-1">
                {[
                  { label: "Edad", value: (() => { if (!profile.birth_date) return "—"; const sep = profile.birth_date.includes("/") ? "/" : "-"; const p = profile.birth_date.split(sep).map(Number); const [y, m, d] = sep === "-" ? p : [p[2], p[1], p[0]]; const t = new Date(); let a = t.getFullYear() - y; if (t.getMonth() + 1 < m || (t.getMonth() + 1 === m && t.getDate() < d)) a--; return String(Math.max(0, a)); })(), sub: "años" },
                  { label: "Ingresos", value: `$${Number(profile.monthly_income).toLocaleString()}`, sub: "/mes" },
                  { label: "Inversión", value: `$${Number(profile.monthly_contribution).toLocaleString()}`, sub: "/mes" },
                ].map(({ label, value, sub }) => (
                  <div key={label} className="rounded px-1 py-0.5 text-center"
                       style={{ background: "var(--bg)" }}>
                    <div className="text-[6px] font-semibold uppercase tracking-wide"
                         style={{ color: "var(--dim)" }}>{label}</div>
                    <div className="text-[13px] font-black leading-tight"
                         style={{ color: "var(--text)" }}>{value}</div>
                    <div className="text-[6px]" style={{ color: "var(--muted)" }}>{sub}</div>
                  </div>
                ))}
              </div>

              <RiskBar level={profile.risk_tolerance} behavioralScore={behavioralRiskScore} />
            </div>
          </div>
        )}

        {/* Trial banner — shown when user is on 90-day promo */}
        {isPremium && isTrialPremium && (
          <div className="px-3 pb-2 shrink-0">
            <div className="rounded-xl p-3" style={{ background: "rgba(0,168,94,0.08)", border: "1px solid rgba(0,212,126,0.2)" }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--accent-l)" }}>
                  ✦ Premium Gratis
                </span>
                <span className="text-[10px] font-semibold" style={{ color: "var(--muted)" }}>
                  {trialDaysLeft}d restantes
                </span>
              </div>
              <div className="h-1 rounded-full overflow-hidden mb-2" style={{ background: "var(--border)" }}>
                <div className="h-full rounded-full transition-all"
                     style={{ width: `${Math.round((trialDaysLeft / 90) * 100)}%`, background: "var(--grad-green)" }} />
              </div>
              <button onClick={() => setPaywallOpen(true)}
                      className="w-full text-[10px] font-semibold py-1 rounded-lg transition-colors hover:opacity-80"
                      style={{ color: "var(--accent-l)" }}>
                Suscribirse para no perder acceso →
              </button>
            </div>
          </div>
        )}

        {/* Premium CTA — shown only for truly free users (no trial) */}
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
            {orderedNav.map(({ href, icon: Icon, label, minLevel }) => {
              const active  = pathname === href;
              const badge   = href === "/notifications" && unreadCount > 0;
              const locked  = !isAtLeast(userLevel, minLevel);
              return (
                <button
                  key={href}
                  draggable={!locked}
                  onDragStart={() => !locked && handleDragStart(href)}
                  onDragOver={(e) => !locked && handleDragOver(e, href)}
                  onDrop={(e) => !locked && handleDrop(e, href)}
                  onDragEnd={handleDragEnd}
                  onClick={() => locked ? navigate("/profile") : navigate(href)}
                  className={`nav-item ${active ? "active" : ""} group transition-opacity`}
                  style={{
                    opacity: locked ? 0.4 : dragging === href ? 0.35 : 1,
                    borderTop: dragOver === href ? "2px solid var(--accent)" : undefined,
                  }}
                >
                  <GripVertical
                    className="w-2.5 h-2.5 shrink-0 opacity-0 group-hover:opacity-40 cursor-grab active:cursor-grabbing transition-opacity"
                    style={{ color: "var(--muted)" }}
                  />
                  <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: locked ? "var(--dim)" : undefined }} />
                  <span style={{ color: locked ? "var(--dim)" : undefined }}>{label}</span>
                  {locked ? (
                    <span className="ml-auto flex items-center gap-0.5 text-[8px] font-bold"
                          style={{ color: "var(--dim)" }}>
                      <Lock className="w-2.5 h-2.5" />
                      {LEVEL_LABEL[minLevel]}
                    </span>
                  ) : badge ? (
                    <span className="ml-auto badge-green" style={{ fontSize: "10px" }}>{unreadCount}</span>
                  ) : null}
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

        {/* Bottom: 1:1 coaching CTA */}
        <div className="px-3 py-3 shrink-0 space-y-1.5">
          <a href={COACHING_URL} target="_blank" rel="noopener noreferrer"
             className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all hover:opacity-90 cursor-pointer"
             style={{ background: "rgba(0,168,94,0.1)", border: "1px solid rgba(0,168,94,0.25)" }}>
            <span className="text-base shrink-0">📅</span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold leading-tight" style={{ color: "var(--accent-l)" }}>Sesión 1:1 con Diego</p>
              <p className="text-[10px] leading-tight" style={{ color: "var(--dim)" }}>Guía personalizada · 60 min</p>
            </div>
            <ArrowRight className="w-3 h-3 shrink-0" style={{ color: "var(--accent-l)" }} />
          </a>
          <button onClick={() => navigate("/onboarding")}
                  className="w-full text-[10px] text-center py-1.5 rounded-lg hover:bg-white/5 transition-colors"
                  style={{ color: "var(--dim)" }}>
            Actualizar perfil
          </button>

        </div>
      </aside>

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} />
    </>
  );
}
