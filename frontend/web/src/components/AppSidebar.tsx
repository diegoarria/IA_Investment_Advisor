"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import Image from "next/image";
import {
  BrainCircuit, Wallet, Bell, User, GraduationCap,
  MessageSquare, ChevronLeft, ChevronRight, Plus, X, HeadphonesIcon, GripVertical, ArrowRight, Lock, LogOut, Home, ShoppingBag, Menu,
} from "lucide-react";

const COACHING_URL = "https://calendly.com/diego-arria19/sesion-1-1-con-diego-nuvos-ai"; // ← actualiza con tu link real

const GOAL_MAP: Record<string, { key: string; emoji: string }> = {
  house:             { key: "house",             emoji: "🏠" },
  car:               { key: "car",               emoji: "🚗" },
  passive_income:    { key: "passiveIncome",      emoji: "💸" },
  retirement:        { key: "retirement",         emoji: "👴" },
  financial_freedom: { key: "financialFreedom",   emoji: "🦅" },
  long_term_wealth:  { key: "longTermWealth",     emoji: "🏛️" },
};
import {
  useProfileStore, useNotificationStore, useSubscriptionStore,
  useChatStore, useAuthStore, behavioralRiskColor, behavioralRiskLabel,
} from "@/lib/store";
import { getUserLevel, isAtLeast, LEVEL_LABEL, LEVEL_COLOR, type UserLevel } from "@/lib/userLevel";

function getAge(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age > 0 ? age : null;
}
import PaywallModal from "@/components/PaywallModal";
import api from "@/lib/api";

type NavItem = { href: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; labelKey: string; minLevel: UserLevel };

const MAIN_NAV: NavItem[] = [
  { href: "/home",       icon: Home,           labelKey: "common.nav.home",     minLevel: "basico" },
  { href: "/chat",       icon: BrainCircuit,   labelKey: "common.nav.mentor",   minLevel: "basico" },
  { href: "/patrimonio", icon: Wallet,         labelKey: "common.nav.patrimonio", minLevel: "basico" },
  { href: "/academy",    icon: GraduationCap,  labelKey: "common.nav.academy",  minLevel: "basico" },
];

const SECONDARY_NAV: NavItem[] = [
  { href: "/notifications", icon: Bell,           labelKey: "common.nav.notifications", minLevel: "basico" },
  { href: "/profile",       icon: User,           labelKey: "common.nav.profile",       minLevel: "basico" },
  { href: "/products",      icon: ShoppingBag,    labelKey: "common.nav.products",      minLevel: "basico" },
  { href: "/support",       icon: HeadphonesIcon, labelKey: "common.nav.support",       minLevel: "basico" },
];


interface Props {
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  /** Pages that already render their own mobile hamburger button (chat, feed)
      set this so they don't get a second, overlapping one. Every other page
      using AppSidebar had NO way at all to open it on mobile — this default
      floating trigger is what fixes that everywhere at once. */
  hideMobileTrigger?: boolean;
}

export default function AppSidebar({ open, onClose, onOpen, hideMobileTrigger }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, clearAuth } = useAuthStore();

  const handleLogout = () => {
    sessionStorage.removeItem("nuvos_chat_active");
    clearAuth();
    // Full page reload so Zustand stores reinitialize empty for the next user.
    window.location.href = "/";
  };
  const { profile, behavioralRiskScore } = useProfileStore();
  const { notifications } = useNotificationStore();
  const subStore = useSubscriptionStore();
  const { sessions, currentId, createSession, loadSession, deleteSession, loadFromServer } = useChatStore();

  // Always sync subscription tier on mount so premium granted via promo/webhook is picked up immediately
  useEffect(() => { subStore.fetchStatus().catch(() => {}); }, []);

  // Load chat history from server when authenticated but no local sessions (Safari / new browser)
  useEffect(() => {
    if (isAuthenticated && sessions.length === 0) {
      loadFromServer().catch(() => {});
    }
  }, [isAuthenticated]);

  const [historyOpen, setHistoryOpen] = useState(true);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);

  const handleSessionClick = async () => {
    setSessionLoading(true);
    try {
      const res = await api.post("/api/upsells/checkout", {
        offer: "session",
        variant: "default",
        trigger_source: "sidebar",
      });
      if (res.data?.url) {
        localStorage.setItem("nuvos_pending_session", "1");
        window.location.href = res.data.url;
      }
    } catch {}
    setSessionLoading(false);
  };
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
    if (typeof window === "undefined") return MAIN_NAV.map((n) => n.href);
    try {
      const saved = localStorage.getItem("nuvos_nav_order");
      if (saved) {
        const parsed: string[] = JSON.parse(saved);
        const current = MAIN_NAV.map((n) => n.href);
        const valid = parsed.filter((h) => current.includes(h));
        const missing = current.filter((h) => !valid.includes(h));
        return [...valid, ...missing];
      }
    } catch {}
    return MAIN_NAV.map((n) => n.href);
  });

  // On first mount, restore nav order from server so a new device picks up
  // the user's preferred arrangement without having to drag-and-drop again.
  const navSyncedRef = useRef(false);
  useEffect(() => {
    if (navSyncedRef.current) return;
    navSyncedRef.current = true;
    import("@/lib/api").then(({ sync: syncApi }) => {
      syncApi.getNavOrder().then((res) => {
        const serverOrder: string[] | null = res.data?.nav_order;
        if (!serverOrder || serverOrder.length === 0) return;
        const current = MAIN_NAV.map((n) => n.href);
        const valid = serverOrder.filter((h) => current.includes(h));
        const missing = current.filter((h) => !valid.includes(h));
        const merged = [...valid, ...missing];
        setNavOrder(merged);
        localStorage.setItem("nuvos_nav_order", JSON.stringify(merged));
      }).catch(() => {});
    });
  }, []);

  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const dragItem = useRef<string | null>(null);
  const draggingFromGrip = useRef(false);

  const orderedNav = navOrder.map((href) => MAIN_NAV.find((n) => n.href === href)!).filter(Boolean);
  const userLevel  = getUserLevel(profile);
  const isPremium      = subStore.tier === "premium";
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
    import("@/lib/api").then(({ sync: syncApi }) => {
      syncApi.pushNavOrder(next).catch(() => {});
    });
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
          title={t("common.openSidebar")}
        >
          <ChevronRight className="w-3 h-3" style={{ color: "var(--muted)" }} />
        </button>
      )}

      {/* Mobile floating trigger — most pages had literally no way to open
          the sidebar below lg (only chat/feed built their own). This one
          default fixes every page at once instead of relying on each page
          to remember to add its own button. */}
      {!open && !hideMobileTrigger && (
        <button
          onClick={onOpen}
          className="lg:hidden fixed top-1.5 left-1.5 z-40 w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 2px 8px rgba(0,0,0,0.25)" }}
          aria-label={t("common.openMenu")}
        >
          <Menu className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />
        </button>
      )}

      {/* zoom only kicks in at lg+ (desktop) — on mobile it was scaling the
          whole drawer to ~115% of a fixed 256px width, eating most of a
          phone's screen with unreliable WebKit touch-target sizing. */}
      <aside className={`${open ? "flex" : "hidden"} ${desktopCollapsed ? "lg:hidden" : "lg:flex"} w-64 flex-col absolute lg:relative z-20 h-full sidebar-gradient lg:[zoom:1.15]`}>

        {/* Brand header: logo + name + collapse button */}
        <div className="flex items-center gap-2.5 px-3 pb-2.5 pt-1 shrink-0"
             style={{ borderBottom: "1px solid var(--border)", marginBottom: "6px" }}>
          <Image src="/logo.png" alt="Nuvos AI" width={32} height={32}
                 className="rounded-xl object-cover shrink-0"
                 style={{ boxShadow: "0 0 8px rgba(0,212,126,0.2)" }} />
          <div className="flex-1 min-w-0">
            <span className="text-[13px] font-black leading-none" style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              Nuvos AI
            </span>
          </div>
          <button
            onClick={toggleDesktop}
            className="hidden lg:flex w-7 h-7 items-center justify-center rounded-lg hover:bg-white/5 transition-colors shrink-0"
            style={{ color: "var(--dim)" }}
            title={t("common.closeSidebar")}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>


        {/* Guest CTA — shown when not logged in */}
        {!isAuthenticated && (
          <div className="px-2 pb-1.5 shrink-0">
            <div className="rounded-xl p-2.5 space-y-1.5" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Nuvos AI</p>
              <button onClick={() => navigate("/")}
                      className="w-full py-1.5 rounded-lg text-[11px] font-bold text-white"
                      style={{ background: "var(--accent)" }}>
                {t("common.login")}
              </button>
              <button onClick={() => navigate("/?mode=register")}
                      className="w-full py-1.5 rounded-lg text-[11px] font-semibold border"
                      style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                {t("common.createAccount")}
              </button>
            </div>
          </div>
        )}

        {/* Profile widget */}
        {profile && (() => {
          const age = getAge(profile.birth_date);
          const riskScore = behavioralRiskScore ?? {
            conservative: 15, conservative_moderate: 25, moderate: 45,
            moderate_growth: 57, growth: 65, aggressive: 73,
            aggressive_speculative: 85, speculative: 95,
          }[profile.risk_tolerance ?? ""] ?? 50;
          const riskColor = behavioralRiskColor(riskScore);
          const riskLabel = behavioralRiskLabel(riskScore);
          return (
            <div className="px-2 pb-1.5 shrink-0">
              <div className="rounded-xl p-2 card-accent">
                <div className="flex items-center gap-1.5">
                  <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 flex items-center justify-center text-base font-black text-white"
                       style={{ background: "var(--grad-green)" }}>
                    {profile.avatar_url
                      ? <img src={profile.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                      : profile.name.charAt(0).toUpperCase()
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-bold truncate mb-0.5" style={{ color: "var(--text)" }}>
                      {profile.name}{age ? `, ${age}` : ""}
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[8px] font-semibold px-1.5 py-px rounded"
                            style={{ background: "var(--raised)", color: LEVEL_COLOR[userLevel], border: `1px solid var(--border)` }}>
                        {LEVEL_LABEL[userLevel]}
                      </span>
                      {isPremium ? (
                        <span className="text-[8px] font-semibold px-1.5 py-px rounded"
                              style={{ background: "var(--raised)", color: "var(--accent-l)", border: "1px solid var(--border)" }}>
                          {t("common.premium")}
                        </span>
                      ) : (
                        <span className="text-[8px] font-semibold px-1.5 py-px rounded"
                              style={{ background: "var(--raised)", color: "var(--dim)", border: "1px solid var(--border)" }}>
                          {t("common.free")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Risk bar */}
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[8px] font-semibold uppercase tracking-wide" style={{ color: "var(--dim)" }}>
                      {t("common.risk")}
                    </span>
                    <span className="text-[8px] font-bold" style={{ color: riskColor }}>
                      {riskLabel}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                    <div className="h-full rounded-full transition-all duration-700"
                         style={{ width: `${riskScore}%`, background: riskColor }} />
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Goal banner ── always visible for logged-in users with a goal */}
        {profile?.investment_goal && (() => {
          const goal = GOAL_MAP[profile.investment_goal];
          const goalLabel = goal ? t(`common.goalMap.${goal.key}`) : profile.investment_goal;
          const goalEmoji = goal?.emoji ?? "🎯";
          const amount = profile.investment_goal_amount ? Number(profile.investment_goal_amount) : null;
          return (
            <div className="px-2 pb-1.5 shrink-0">
              <div className="rounded-xl px-2.5 py-2 flex items-center gap-2"
                   style={{ background: "linear-gradient(135deg, rgba(0,168,94,0.09), rgba(0,184,94,0.04))", border: "1px solid rgba(0,168,94,0.22)" }}>
                <span style={{ fontSize: 18, lineHeight: 1 }}>{goalEmoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[8px] font-bold uppercase tracking-widest leading-none mb-0.5" style={{ color: "var(--dim)" }}>
                    {t("common.myGoal")}
                  </p>
                  <p className="text-[11px] font-bold leading-tight truncate" style={{ color: "var(--accent-l)" }}>
                    {goalLabel}
                  </p>
                  {amount ? (
                    <p className="text-[10px] font-semibold mt-0.5" style={{ color: "var(--text)" }}>
                      ${amount.toLocaleString("en-US")} USD
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Scrollable area: nav + chat history */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <nav className="px-2 py-1 space-y-0.5">
            {/* Main draggable nav */}
            {orderedNav.map(({ href, icon: Icon, labelKey, minLevel }) => {
              const active  = pathname === href;
              const locked  = !isAtLeast(userLevel, minLevel);
              return (
                <button
                  key={href}
                  draggable={!locked}
                  onDragStart={(e) => {
                    // Safari fix: draggable={true} on a button blocks click events in Safari
                    // because Safari captures mousedown to track potential drag motion.
                    // Only allow drag when the user explicitly grabbed the grip handle.
                    if (!draggingFromGrip.current) { e.preventDefault(); return; }
                    if (!locked) handleDragStart(href);
                  }}
                  onDragOver={(e) => !locked && handleDragOver(e, href)}
                  onDrop={(e) => !locked && handleDrop(e, href)}
                  onDragEnd={() => { draggingFromGrip.current = false; handleDragEnd(); }}
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
                    onPointerDown={(e) => { if (!locked) { e.stopPropagation(); draggingFromGrip.current = true; } }}
                  />
                  <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: locked ? "var(--dim)" : undefined }} />
                  <span style={{ color: locked ? "var(--dim)" : undefined }}>{t(labelKey)}</span>
                  {locked && (
                    <span className="ml-auto flex items-center gap-0.5 text-[8px] font-bold"
                          style={{ color: "var(--dim)" }}>
                      <Lock className="w-2.5 h-2.5" />
                      {LEVEL_LABEL[minLevel]}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Divider */}
            <div className="my-1.5 border-t" style={{ borderColor: "var(--border)" }} />

            {/* Secondary static nav */}
            {SECONDARY_NAV.map(({ href, icon: Icon, labelKey, minLevel }) => {
              const active  = pathname === href;
              const badge   = href === "/notifications" && unreadCount > 0;
              const locked  = !isAtLeast(userLevel, minLevel);
              return (
                <button
                  key={href}
                  onClick={() => locked ? navigate("/profile") : navigate(href)}
                  className={`nav-item ${active ? "active" : ""} transition-opacity`}
                  style={{ opacity: locked ? 0.4 : 1 }}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: locked ? "var(--dim)" : undefined }} />
                  <span style={{ color: locked ? "var(--dim)" : undefined }}>{t(labelKey)}</span>
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
                {t("common.recentChats")}
                <ChevronRight className={`w-3 h-3 transition-transform ${historyOpen ? "rotate-90" : ""}`} />
              </button>
              <button onClick={handleNewChat}
                      className="w-5 h-5 rounded flex items-center justify-center border transition-colors hover:border-[var(--accent)]"
                      style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                      title={t("common.newChat")}>
                <Plus className="w-3 h-3" />
              </button>
            </div>

            {historyOpen && (
              <div className="space-y-0.5">
                {sessions.length === 0 ? (
                  <p className="text-xs px-2 py-2" style={{ color: "var(--dim)" }}>{t("common.noSavedChats")}</p>
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
          <button
            onClick={handleSessionClick}
            disabled={sessionLoading}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all hover:opacity-90 cursor-pointer disabled:opacity-60"
            style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
            <div className="w-6 h-6 rounded flex items-center justify-center shrink-0"
                 style={{ background: "rgba(0,168,94,0.12)" }}>
              <ChevronRight className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold leading-tight" style={{ color: "var(--text)" }}>
                {sessionLoading ? t("common.loading") : t("common.session1on1")}
              </p>
              <p className="text-[10px] leading-tight" style={{ color: "var(--dim)" }}>{t("common.personalizedGuide")}</p>
            </div>
            <ArrowRight className="w-3 h-3 shrink-0" style={{ color: "var(--muted)" }} />
          </button>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl mt-2 transition-colors hover:bg-red-500/10 group"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0 text-red-400 group-hover:text-red-500" />
            <span className="text-[12px] font-semibold text-red-400 group-hover:text-red-500">{t("common.logout")}</span>
          </button>

        </div>
      </aside>

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} />
    </>
  );
}
