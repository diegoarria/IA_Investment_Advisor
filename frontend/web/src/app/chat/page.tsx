"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chat as chatApi, notifications as notifApi, market as marketApi } from "@/lib/api";
import {
  useAuthStore, useProfileStore, useChatStore, useNotificationStore,
  useThemeStore, useSubscriptionStore, msgsRemaining, FREE_MSG_LIMIT,
} from "@/lib/store";
import { getMentorInfo } from "@/lib/mentorData";
import { usePortfolioStore } from "@/lib/portfolioStore";
import PaywallModal from "@/components/PaywallModal";
import TutorialModal from "@/components/TutorialModal";
import { useTutorialStore } from "@/lib/store";
import type { IndexData } from "@/lib/types";
import {
  Send, TrendingUp, Bell, LogOut, Menu, X,
  ChevronRight, BookOpen, PieChart, BarChart2, User, GraduationCap, Trophy,
  Sun, Moon, MessageSquare, Plus, Square, Pencil,
} from "lucide-react";

const SUGGESTIONS_DEFAULT = [
  "¿Cómo analizo si una empresa es buena inversión?",
  "Explícame qué es un ETF",
  "¿Qué hace NVIDIA para ganar dinero?",
  "¿Cómo construyo un portafolio diversificado?",
];

const SUGGESTIONS_BY_OBJECTIVE: Record<string, string[]> = {
  protect: [
    "¿Cuáles son las inversiones más seguras para preservar capital?",
    "¿Cómo protejo mis ahorros de la inflación?",
    "Explícame qué son los bonos y cómo funcionan",
    "¿Qué es un fondo indexado y por qué es bajo riesgo?",
  ],
  grow: [
    "¿Cómo construyo un portafolio diversificado a largo plazo?",
    "¿Qué diferencia hay entre acciones de crecimiento y valor?",
    "¿Cada cuánto debería revisar mis inversiones?",
    "¿Qué es el interés compuesto y por qué importa tanto?",
  ],
  maximize: [
    "¿Cómo identifico acciones con alto potencial de retorno?",
    "¿Qué sectores están creciendo más este año?",
    "¿Cómo evalúo el riesgo antes de hacer una inversión agresiva?",
    "Analiza NVDA — ¿sigue siendo buena oportunidad?",
  ],
};

const OBJECTIVE_GREETING: Record<string, string> = {
  protect:  "Veo que priorizas proteger tu capital. Buena base para empezar. ¿Por dónde quieres comenzar?",
  grow:     "Tu objetivo es hacer crecer tu dinero a largo plazo. Es el enfoque más sólido. ¿Qué tienes en mente?",
  maximize: "Buscas maximizar retorno. El riesgo es parte del juego — te enseño a manejarlo bien. ¿Empezamos?",
};

const RISK_LABEL: Record<string, string> = {
  conservative:            "Conservador",
  conservative_moderate:   "Conservador-Moderado",
  moderate:                "Moderado",
  moderate_growth:         "Moderado-Growth",
  growth:                  "Growth",
  aggressive:              "Agresivo",
  aggressive_speculative:  "Agresivo-Especulativo",
  speculative:             "Especulativo",
};

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

type BScoreData = { s: number; p: string; sig: string[]; conf: string };

function BScoreCard({ data }: { data: BScoreData }) {
  return (
    <div className="flex justify-start mt-1 ml-9">
      <div className="px-3 py-2 rounded-xl border max-w-xs"
           style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
        <div className="text-[10px] mb-1.5 font-semibold uppercase tracking-wide"
             style={{ color: "var(--muted)" }}>
          Evaluación de riesgo
        </div>
        <RiskBar level={data.p} />
        {data.sig.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {data.sig.map((s) => (
              <span key={s} className="text-[10px] px-1.5 py-0.5 rounded-full border"
                    style={{ borderColor: "var(--border)", color: "var(--dim)" }}>
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RiskBar({ level }: { level: string }) {
  const idx = RISK_SEGMENTS.findIndex((s) => s.key === level);
  if (idx < 0) return null;
  return (
    <div>
      <div className="flex gap-0.5 mb-1">
        {RISK_SEGMENTS.map((seg, i) => (
          <div key={seg.key}
               className="h-1.5 flex-1 rounded-full transition-all"
               style={{
                 background: i <= idx ? seg.color : "var(--border)",
                 opacity: i === idx ? 1 : i < idx ? 0.65 : 0.25,
               }} />
        ))}
      </div>
      <div className="text-[10px] font-semibold"
           style={{ color: RISK_SEGMENTS[idx]?.color ?? "var(--accent-l)" }}>
        {RISK_LABEL[level] ?? level}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1.5 py-1 px-1">
      <span className="w-2 h-2 rounded-full bg-[#5b7a96] dot-bounce" />
      <span className="w-2 h-2 rounded-full bg-[#5b7a96] dot-bounce-2" />
      <span className="w-2 h-2 rounded-full bg-[#5b7a96] dot-bounce-3" />
    </div>
  );
}

function IndexChip({ d }: { d: IndexData }) {
  const isVix = d.symbol === "^VIX";
  const up = d.change_pct >= 0;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border shrink-0"
         style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <span className="text-[11px] font-bold" style={{ color: "var(--muted)" }}>{d.name}</span>
      {d.price !== null ? (
        <>
          <span className="text-[12px] font-bold" style={{ color: "var(--text)" }}>
            {d.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-[10px] font-semibold"
                style={{ color: isVix ? "var(--sub)" : up ? "var(--up)" : "var(--down)" }}>
            {!isVix && (up ? "▲" : "▼")}{Math.abs(d.change_pct).toFixed(2)}%
          </span>
        </>
      ) : (
        <span className="text-[12px]" style={{ color: "var(--dim)" }}>—</span>
      )}
    </div>
  );
}

const NAV = [
  { href: "/chat",          icon: BookOpen,      label: "Chat" },
  { href: "/portfolio",     icon: PieChart,      label: "Portafolio" },
  { href: "/paper",         icon: BarChart2,     label: "Paper Trading" },
  { href: "/learn",         icon: GraduationCap, label: "Aprendizaje" },
  { href: "/arena",         icon: Trophy,        label: "Arena" },
  { href: "/notifications", icon: Bell,          label: "Notificaciones" },
  { href: "/profile",       icon: User,          label: "Perfil" },
];

export default function ChatPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { hasSeenTutorial, openTutorial } = useTutorialStore();
  const { isAuthenticated, clearAuth } = useAuthStore();
  const { profile, updateMaturity } = useProfileStore();
  const { messages, isStreaming, addMessage, appendToLastAssistant, setStreaming, startAssistantMessage, removeLastMessage, setMessages, sessions, currentId, createSession, loadSession, deleteSession } = useChatStore();
  const { notifications, setNotifications, markRead } = useNotificationStore();
  const { theme, toggleTheme } = useThemeStore();
  const subStore = useSubscriptionStore();
  const { positions, loadFromServer: loadPortfolio } = usePortfolioStore();
  const mentor = getMentorInfo(profile?.mentor);
  const cancelRef = useRef({ cancelled: false });

  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [indices, setIndices] = useState<IndexData[]>([]);
  const [lastAssessment, setLastAssessment] = useState<BScoreData | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isPremium = subStore.tier === "premium";
  const remaining = msgsRemaining(subStore);

  const handleStop = () => {
    cancelRef.current.cancelled = true;
    setStreaming(false);
  };

  const handleEditMessage = (index: number, content: string) => {
    if (isStreaming) { cancelRef.current.cancelled = true; setStreaming(false); }
    setMessages(messages.slice(0, index));
    setInput(content);
    inputRef.current?.focus();
  };

  const buildProfileContext = () => {
    if (!profile) return null;
    const qa = profile.quiz_answers;
    const q1Labels: Record<string, string> = { A: "vende ante caídas (reactivo conservador)", B: "espera sin actuar (pasivo)", C: "analiza fundamentos y mantiene (racional)", D: "compra más en caídas (inversor de valor)" };
    const q2Labels: Record<string, string> = { A: "necesita el dinero en menos de 2 años", B: "horizonte de 3–5 años", C: "10+ años, busca independencia financiera", D: "largo plazo sin prisa" };
    const q3Labels: Record<string, string> = { A: "principiante — apenas empieza", B: "básico — conoce fondos indexados", C: "intermedio — entiende P/E, diversificación", D: "avanzado — maneja análisis fundamental" };
    const q4Labels: Record<string, string> = { A: "conservador — prefiere $5K garantizado", B: "moderado-bajo — acepta riesgo de $5K", C: "moderado-alto — acepta riesgo de $20K", D: "especulador — arriesga todo" };
    const q5Labels: Record<string, string> = { A: "pasivo — inversión automática", B: "semipasivo — revisión mensual", C: "activo — revisiones semanales", D: "muy activo — gestión diaria" };

    let portfolioBlock = "\n\n[PORTAFOLIO REAL DEL USUARIO]";
    if (positions.length === 0) {
      portfolioBlock += "\nEl usuario aún no tiene posiciones registradas.";
    } else {
      portfolioBlock += `\nPosiciones (${positions.length}):`;
      for (const p of positions) {
        portfolioBlock += `\n- ${p.ticker}${p.name ? ` (${p.name})` : ""}: ${p.shares} acc × $${p.avgPrice.toFixed(2)} costo promedio`;
      }
    }

    const a = (key: string) => qa ? String(qa[key] ?? "") : "";
    return `[PERFIL DEL USUARIO]\nNombre: ${profile.name}\nPerfil de riesgo: ${profile.risk_tolerance}\n\nRespuestas del cuestionario:\n- Comportamiento ante caídas: ${q1Labels[a("q1")] ?? "no disponible"}\n- Horizonte: ${q2Labels[a("q2")] ?? "no disponible"}\n- Conocimiento: ${q3Labels[a("q3")] ?? "no disponible"}\n- Tolerancia al riesgo: ${q4Labels[a("q4")] ?? "no disponible"}\n- Estilo de gestión: ${q5Labels[a("q5")] ?? "no disponible"}${portfolioBlock}\n\nInstrucciones: Llama siempre a este usuario por su nombre (${profile.name.split(" ")[0]}). Adapta el nivel al conocimiento declarado. Responde en español.`;
  };

  const handleNewChat = () => {
    createSession();
    setSidebarOpen(false);
  };

  const handleLoadSession = (id: string) => {
    loadSession(id);
    setSidebarOpen(false);
  };

  useEffect(() => {
    if (!isAuthenticated) { router.push("/"); return; }

    if (!hasSeenTutorial) setTimeout(() => openTutorial(), 800);

    if (sessions.length === 0) {
      createSession();
      chatApi.getHistory()
        .then((res) => setMessages(res.data.messages.map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: m.content }))))
        .catch(() => {});
    }

    notifApi.getAll()
      .then((res) => setNotifications(res.data.notifications, res.data.unread_count))
      .catch(() => {});

    marketApi.getIndices()
      .then((res) => setIndices(res.data))
      .catch(() => {});

    subStore.fetchStatus().catch(() => {});
    loadPortfolio();
  }, [isAuthenticated]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || isStreaming) return;

    if (remaining === 0) { setPaywallOpen(true); return; }

    setInput("");
    setLastAssessment(null);
    cancelRef.current.cancelled = false;
    subStore.incrementMsgCount();
    addMessage({ role: "user", content: msg });
    chatApi.saveMessage("user", msg).catch(() => {});

    const profileCtx = buildProfileContext();
    const recentHistory = messages.slice(-18).map((m) => ({ role: m.role, content: m.content }));
    const historyForApi = profileCtx
      ? [
          { role: "user", content: profileCtx },
          { role: "assistant", content: `Entendido. Tengo en cuenta el perfil de ${profile?.name?.split(" ")[0] || "usuario"}.` },
          ...recentHistory,
        ]
      : messages.slice(-20).map((m) => ({ role: m.role, content: m.content }));

    startAssistantMessage();
    setStreaming(true);

    let fullResponse = "";
    try {
      await chatApi.stream(
        msg,
        historyForApi,
        (chunk) => {
          if (cancelRef.current.cancelled) return;
          appendToLastAssistant(chunk);
          fullResponse += chunk;
        },
        () => {
          setStreaming(false);
          chatApi.saveMessage("assistant", fullResponse).catch(() => {});
        },
        (a) => {
          setLastAssessment(a);
          updateMaturity(a.sig);
        },
        undefined,
        profile?.mentor ?? null,
        cancelRef.current,
      );
    } catch (err: unknown) {
      setStreaming(false);
      removeLastMessage();
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 429) { await subStore.fetchStatus(); setPaywallOpen(true); }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const unreadNotifCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2.5 shrink-0"
           style={{ borderBottom: "1px solid var(--border)", background: "rgba(9,15,31,0.9)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="lg:hidden p-1.5 rounded-lg transition-colors hover:bg-white/5"
                  style={{ color: "var(--muted)" }}>
            {sidebarOpen ? <X className="w-4.5 h-4.5" /> : <Menu className="w-4.5 h-4.5" />}
          </button>
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Image src="/logo.png" alt="Nuvos AI" width={30} height={30}
                     className="rounded-xl object-cover" />
              <div className="absolute -inset-0.5 rounded-xl blur-sm opacity-40"
                   style={{ background: "var(--grad-green)" }} />
            </div>
            <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvos AI</span>
          </div>
        </div>

        {/* Market ticker */}
        <div className="hidden md:flex flex-1 mx-6 gap-2 overflow-x-auto scrollbar-thin">
          {indices.map((d) => <IndexChip key={d.symbol} d={d} />)}
        </div>

        <div className="flex items-center gap-1">
          {/* Tutorial */}
          <button onClick={openTutorial}
                  className="p-2 rounded-lg hover:bg-white/5 transition-colors text-xs font-bold w-7 h-7 flex items-center justify-center border"
                  style={{ color: "var(--muted)", borderColor: "var(--border)" }}
                  title="Ver tutorial">
            ?
          </button>

          {/* Theme toggle */}
          <button onClick={toggleTheme}
                  className="p-2 rounded-lg hover:bg-white/5 transition-colors"
                  style={{ color: "var(--muted)" }}
                  title={theme === "dark" ? "Modo claro" : "Modo oscuro"}>
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button onClick={() => setNotifOpen(!notifOpen)}
                  className="relative p-2 rounded-lg hover:bg-white/5 transition-colors"
                  style={{ color: "var(--muted)" }}>
            <Bell className="w-5 h-5" />
            {unreadNotifCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 rounded-full text-white text-[10px] flex items-center justify-center font-bold"
                    style={{ background: "var(--accent)" }}>
                {unreadNotifCount > 9 ? "9+" : unreadNotifCount}
              </span>
            )}
          </button>
          <button onClick={() => { clearAuth(); router.push("/"); }}
                  className="p-2 rounded-lg hover:bg-white/5 transition-colors"
                  style={{ color: "var(--muted)" }}>
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <aside className={`${sidebarOpen ? "flex" : "hidden"} lg:flex w-64 flex-col absolute lg:relative z-20 h-full sidebar-gradient`}>
          {/* Profile widget */}
          {profile && (
            <div className="px-3 pt-4 pb-2">
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
            <div className="px-3 pb-2 space-y-2">
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
              <button onClick={() => setPaywallOpen(true)}
                      className="btn-primary w-full text-xs py-2">
                ⭐ Activar Premium
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto scrollbar-thin">
          <nav className="px-2 py-1 space-y-0.5">
            {NAV.map(({ href, icon: Icon, label }) => {
              const active = pathname === href;
              const notifBadge = href === "/notifications" && unreadNotifCount > 0;
              return (
                <button key={href}
                        onClick={() => { router.push(href); setSidebarOpen(false); }}
                        className={`nav-item ${active ? "active" : ""}`}>
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{label}</span>
                  {notifBadge && (
                    <span className="ml-auto badge-green" style={{ fontSize: "10px" }}>
                      {unreadNotifCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Chat history */}
          <div className="px-2 mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between px-1 mb-1">
              <button
                onClick={() => setHistoryOpen((v) => !v)}
                className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide hover:opacity-80 transition-opacity"
                style={{ color: "var(--muted)" }}
              >
                <MessageSquare className="w-3 h-3" />
                Chats recientes
                <ChevronRight className={`w-3 h-3 transition-transform ${historyOpen ? "rotate-90" : ""}`} />
              </button>
              <button
                onClick={handleNewChat}
                className="w-5 h-5 rounded flex items-center justify-center border transition-colors hover:border-[var(--accent)]"
                style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                title="Nuevo chat"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>

            {historyOpen && (
              <div className="space-y-0.5">
                {sessions.length === 0 ? (
                  <p className="text-xs px-2 py-2" style={{ color: "var(--dim)" }}>Sin chats guardados</p>
                ) : (
                  sessions.slice(0, 30).map((s) => (
                    <div
                      key={s.id}
                      onClick={() => handleLoadSession(s.id)}
                      className="flex items-center gap-2 group px-2 py-2 rounded-lg cursor-pointer transition-colors"
                      style={{ background: s.id === currentId ? "rgba(0,168,94,0.1)" : "transparent" }}
                    >
                      <MessageSquare className="w-3 h-3 shrink-0" style={{ color: s.id === currentId ? "var(--accent-l)" : "var(--dim)" }} />
                      <span className="text-xs flex-1 truncate" style={{ color: s.id === currentId ? "var(--accent-l)" : "var(--sub)" }}>
                        {s.title}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        style={{ color: "var(--dim)" }}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          </div>{/* end scrollable */}

          <div className="px-3 py-2 shrink-0">
            <button onClick={() => router.push("/onboarding")}
                    className="w-full text-xs text-center py-2 rounded-lg transition-colors hover:bg-white/5"
                    style={{ color: "var(--dim)" }}>
              Actualizar perfil
            </button>
          </div>
        </aside>

        {/* Notification panel */}
        {notifOpen && (
          <div className="absolute right-0 top-0 w-80 h-full border-l z-30 flex flex-col"
               style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "var(--border)" }}>
              <span className="font-semibold text-sm" style={{ color: "var(--text)" }}>Notificaciones</span>
              <button onClick={() => setNotifOpen(false)} style={{ color: "var(--muted)" }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2">
              {notifications.length === 0 && (
                <p className="text-center py-8 text-sm" style={{ color: "var(--dim)" }}>Sin notificaciones aún</p>
              )}
              {notifications.map((n) => (
                <div key={n.id} onClick={() => markRead(n.id)}
                     className="p-3 rounded-xl border cursor-pointer transition-all"
                     style={{ borderColor: n.read ? "var(--border)" : "rgba(0,168,94,0.4)", background: n.read ? "var(--raised)" : "rgba(0,168,94,0.05)" }}>
                  <div className="text-sm font-medium" style={{ color: "var(--text)" }}>{n.title}</div>
                  <div className="text-xs mt-1 line-clamp-2" style={{ color: "var(--muted)" }}>{n.message}</div>
                  <button onClick={(e) => { e.stopPropagation(); sendMessage(n.message.slice(0, 200)); setNotifOpen(false); }}
                          className="text-xs mt-1 flex items-center gap-1 hover:opacity-80"
                          style={{ color: "var(--accent-l)" }}>
                    Discutir esto <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chat area */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center px-6 animate-fade-in">
                {mentor ? (
                  <div className="relative mb-5 animate-float">
                    <div className="w-24 h-24 rounded-3xl flex items-center justify-center text-5xl"
                         style={{ background: mentor.color + "18", border: `2px solid ${mentor.color}30` }}>
                      {mentor.emoji}
                    </div>
                    <div className="absolute -inset-2 rounded-3xl blur-xl opacity-25"
                         style={{ background: mentor.color }} />
                  </div>
                ) : (
                  <div className="relative mb-5 animate-float">
                    <div className="w-20 h-20 rounded-3xl flex items-center justify-center"
                         style={{ background: "var(--accent-glow)", border: "2px solid rgba(0,185,109,0.2)" }}>
                      <TrendingUp className="w-9 h-9" style={{ color: "var(--accent-l)" }} />
                    </div>
                    <div className="absolute -inset-2 rounded-3xl blur-xl opacity-20"
                         style={{ background: "var(--accent)" }} />
                  </div>
                )}
                <h2 className="text-2xl font-black mb-1.5 tracking-tight"
                    style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  {mentor ? mentor.name : profile?.name ? `Hola, ${profile.name.split(" ")[0]}` : "Nuvos AI"}
                </h2>
                {(() => {
                  const obj = profile?.quiz_answers?.objective as string | undefined;
                  const greeting = obj ? OBJECTIVE_GREETING[obj] : null;
                  const suggestions = obj && SUGGESTIONS_BY_OBJECTIVE[obj]
                    ? SUGGESTIONS_BY_OBJECTIVE[obj]
                    : SUGGESTIONS_DEFAULT;
                  return (
                    <>
                      {greeting && !mentor ? (
                        <p className="text-sm mb-7 max-w-sm leading-relaxed" style={{ color: "var(--muted)" }}>
                          {greeting}
                        </p>
                      ) : (
                        <>
                          <p className="text-sm mb-1" style={{ color: "var(--muted)" }}>
                            {mentor ? mentor.title : "Tu mentor de inversiones con IA"}
                          </p>
                          {mentor && <span className="badge-green mb-5">{mentor.badge}</span>}
                          {mentor && (
                            <div className="flex flex-wrap justify-center gap-2 mb-7 max-w-sm">
                              {mentor.principles.map((p) => (
                                <span key={p} className="text-xs px-3 py-1.5 rounded-full border font-medium"
                                      style={{ borderColor: mentor.color + "40", background: mentor.color + "0e", color: mentor.color }}>
                                  {p}
                                </span>
                              ))}
                            </div>
                          )}
                          {!mentor && <div className="mb-7" />}
                        </>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                        {suggestions.map((s, i) => (
                          <button key={s} onClick={() => sendMessage(s)}
                                  className={`text-left p-3.5 rounded-2xl text-xs transition-all border hover:border-[var(--accent-l)] hover:-translate-y-0.5 animate-fade-in-up stagger-${i+1} group`}
                                  style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--sub)" }}>
                            <span className="block text-[10px] font-bold mb-1 group-hover:text-[var(--accent-l)] transition-colors" style={{ color: "var(--accent)" }}>✦</span>
                            {s}
                          </button>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className="animate-fade-in">
                <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "assistant" && (
                    <div className="w-8 h-8 rounded-2xl flex items-center justify-center mr-2.5 mt-0.5 shrink-0 overflow-hidden text-sm"
                         style={{
                           background: mentor ? mentor.color + "22" : "var(--accent-glow)",
                           border: `1px solid ${mentor ? mentor.color + "30" : "rgba(0,185,109,0.2)"}`,
                         }}>
                      {mentor ? mentor.emoji : <TrendingUp className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />}
                    </div>
                  )}
                  <div className={msg.role === "user" ? "max-w-[78%]" : "flex-1"}>
                    {msg.role === "user" ? (
                      <div className="bubble-user">{msg.content}</div>
                    ) : (
                      <div className="bubble-ai">
                        <div className="prose-dark">
                          {msg.content === "" && isStreaming && i === messages.length - 1
                            ? <TypingDots />
                            : <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                          }
                        </div>
                      </div>
                    )}
                    {msg.role === "user" && (
                      <div className="flex justify-end mt-1">
                        <button onClick={() => handleEditMessage(i, msg.content)}
                                className="p-1.5 rounded-lg hover:bg-white/5 transition-all opacity-0 hover:opacity-100 group-hover:opacity-100"
                                style={{ color: "var(--dim)" }}>
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {msg.role === "assistant" && i === messages.length - 1 && lastAssessment && !isStreaming && (
                  <BScoreCard data={lastAssessment} />
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="shrink-0 px-4 pb-4 pt-3"
               style={{ borderTop: "1px solid var(--border)", background: "rgba(9,15,31,0.95)", backdropFilter: "blur(12px)" }}>
            {remaining === 0 && !isPremium && (
              <div className="max-w-3xl mx-auto mb-3 px-4 py-2.5 rounded-xl flex items-center justify-between"
                   style={{ background: "rgba(244,63,94,0.06)", border: "1px solid rgba(244,63,94,0.2)" }}>
                <span className="text-xs" style={{ color: "var(--down)" }}>Alcanzaste el límite de {FREE_MSG_LIMIT} mensajes diarios.</span>
                <button onClick={() => setPaywallOpen(true)} className="text-xs font-bold ml-3 shrink-0" style={{ color: "var(--accent-l)" }}>
                  Activar Premium →
                </button>
              </div>
            )}
            <div className="flex gap-2.5 items-end max-w-3xl mx-auto">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={remaining === 0 && !isPremium ? "Límite alcanzado — activa Premium" : "Pregunta sobre cualquier empresa, concepto o estrategia..."}
                  rows={1}
                  disabled={isStreaming || (remaining === 0 && !isPremium)}
                  className="input-premium resize-none"
                  style={{ maxHeight: "120px", overflowY: "auto", paddingRight: "16px", lineHeight: "1.6" }}
                />
              </div>
              <button
                onClick={isStreaming ? handleStop : () => sendMessage()}
                disabled={!isStreaming && (!input.trim() || (remaining === 0 && !isPremium))}
                className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 transition-all disabled:opacity-30"
                style={{
                  background: isStreaming ? "rgba(244,63,94,0.15)" : "var(--grad-green)",
                  border: isStreaming ? "1px solid rgba(244,63,94,0.3)" : "none",
                  boxShadow: isStreaming ? "none" : "var(--shadow-accent-sm)",
                }}>
                {isStreaming
                  ? <Square className="w-4 h-4" style={{ color: "#f87171" }} />
                  : <Send className="w-4 h-4 text-white" />}
              </button>
            </div>
            <p className="text-center text-[10px] mt-2" style={{ color: "var(--dim)" }}>
              Solo educativo · No reemplaza asesoramiento financiero profesional
            </p>
          </div>
        </main>
      </div>

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} />
      <TutorialModal />
    </div>
  );
}
