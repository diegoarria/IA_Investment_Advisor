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
import PaywallModal from "@/components/PaywallModal";
import type { IndexData } from "@/lib/types";
import {
  Send, TrendingUp, Bell, LogOut, Menu, X,
  ChevronRight, BookOpen, PieChart, BarChart2, User, GraduationCap,
  Sun, Moon,
} from "lucide-react";

const SUGGESTIONS = [
  "¿Cómo analizo si una empresa es buena inversión?",
  "Explícame qué es un ETF",
  "¿Qué hace NVIDIA para ganar dinero?",
  "¿Cómo construyo un portafolio diversificado?",
];

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
  { href: "/notifications", icon: Bell,          label: "Notificaciones" },
  { href: "/profile",       icon: User,          label: "Perfil" },
];

export default function ChatPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, clearAuth } = useAuthStore();
  const { profile } = useProfileStore();
  const { messages, isStreaming, addMessage, appendToLastAssistant, setStreaming, startAssistantMessage, setMessages } = useChatStore();
  const { notifications, setNotifications, markRead } = useNotificationStore();
  const { theme, toggleTheme } = useThemeStore();
  const subStore = useSubscriptionStore();

  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [indices, setIndices] = useState<IndexData[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isPremium = subStore.tier === "premium";
  const remaining = msgsRemaining(subStore);

  useEffect(() => {
    if (!isAuthenticated) { router.push("/"); return; }

    chatApi.getHistory()
      .then((res) => setMessages(res.data.messages.map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: m.content }))))
      .catch(() => {});

    notifApi.getAll()
      .then((res) => setNotifications(res.data.notifications, res.data.unread_count))
      .catch(() => {});

    marketApi.getIndices()
      .then((res) => setIndices(res.data))
      .catch(() => {});

    subStore.fetchStatus().catch(() => {});
  }, [isAuthenticated]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || isStreaming) return;

    if (remaining === 0) {
      setPaywallOpen(true);
      return;
    }

    setInput("");
    subStore.incrementMsgCount();
    addMessage({ role: "user", content: msg });
    chatApi.saveMessage("user", msg).catch(() => {});

    const historyForApi = messages.slice(-20).map((m) => ({ role: m.role, content: m.content }));
    startAssistantMessage();
    setStreaming(true);

    let fullResponse = "";
    await chatApi.stream(
      msg,
      historyForApi,
      (chunk) => { appendToLastAssistant(chunk); fullResponse += chunk; },
      () => {
        setStreaming(false);
        chatApi.saveMessage("assistant", fullResponse).catch(() => {});
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const unreadNotifCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      {/* Top bar */}
      <div className="border-b flex items-center justify-between px-4 py-2 shrink-0"
           style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="lg:hidden p-1 rounded-lg"
                  style={{ color: "var(--muted)" }}>
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2">
            <Image src="/logo.png" alt="Nuvos AI" width={28} height={28}
                   className="rounded-lg object-cover" />
            <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvos AI</span>
          </div>
        </div>

        {/* Market ticker */}
        <div className="hidden md:flex flex-1 mx-6 gap-2 overflow-x-auto scrollbar-thin">
          {indices.map((d) => <IndexChip key={d.symbol} d={d} />)}
        </div>

        <div className="flex items-center gap-1">
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
        <aside className={`${sidebarOpen ? "flex" : "hidden"} lg:flex w-60 border-r flex-col py-4 absolute lg:relative z-20 h-full`}
               style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          {profile && (
            <div className="px-3 mb-4">
              <div className="rounded-xl p-3 border" style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
                <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>Perfil de riesgo</div>
                <RiskBar level={profile.risk_tolerance} />
                {profile.name && (
                  <div className="text-xs mt-2" style={{ color: "var(--sub)" }}>{profile.name}</div>
                )}
              </div>
            </div>
          )}

          {/* Msg counter for free users */}
          {!isPremium && (
            <div className="px-3 mb-3">
              <button onClick={() => setPaywallOpen(true)}
                      className="w-full rounded-xl p-2.5 border text-left transition-colors hover:border-[var(--accent)]"
                      style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
                <div className="text-[10px] mb-1" style={{ color: "var(--muted)" }}>
                  Mensajes hoy
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1 rounded-full" style={{ background: "var(--border)" }}>
                    <div className="h-1 rounded-full transition-all"
                         style={{
                           width: `${Math.round(((FREE_MSG_LIMIT - remaining) / FREE_MSG_LIMIT) * 100)}%`,
                           background: remaining < 5 ? "var(--down)" : "var(--accent)",
                         }} />
                  </div>
                  <span className="text-[10px] font-bold shrink-0"
                        style={{ color: remaining < 5 ? "var(--down)" : "var(--accent-l)" }}>
                    {remaining}/{FREE_MSG_LIMIT}
                  </span>
                </div>
              </button>
            </div>
          )}

          {!isPremium && (
            <div className="px-3 mb-2">
              <button onClick={() => setPaywallOpen(true)}
                      className="w-full py-2 rounded-xl text-xs font-semibold text-white transition-opacity hover:opacity-90"
                      style={{ background: "linear-gradient(90deg, #00a85e, #00d47e)" }}>
                ⭐ Activar Premium
              </button>
            </div>
          )}

          <nav className="flex-1 px-2 space-y-0.5">
            {NAV.map(({ href, icon: Icon, label }) => {
              const active = pathname === href;
              const notifBadge = href === "/notifications" && unreadNotifCount > 0;
              return (
                <button key={href}
                        onClick={() => { router.push(href); setSidebarOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors"
                        style={{
                          background: active ? "rgba(0,168,94,0.12)" : "transparent",
                          color: active ? "var(--accent-l)" : "var(--muted)",
                        }}>
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{label}</span>
                  {notifBadge && (
                    <span className="ml-auto w-4 h-4 rounded-full text-white text-[10px] flex items-center justify-center font-bold"
                          style={{ background: "var(--accent)" }}>
                      {unreadNotifCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="px-3 mt-2">
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
              <div className="h-full flex flex-col items-center justify-center text-center px-4">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                     style={{ background: "rgba(0,168,94,0.1)" }}>
                  <TrendingUp className="w-8 h-8" style={{ color: "var(--accent)" }} />
                </div>
                <h2 className="text-xl font-bold mb-2" style={{ color: "var(--text)" }}>
                  {profile?.name ? `Hola, ${profile.name}` : "Tu mentor de inversiones"}
                </h2>
                <p className="text-sm max-w-sm mb-8" style={{ color: "var(--muted)" }}>
                  Pregunta sobre cualquier empresa, ETF, o concepto financiero.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => sendMessage(s)}
                            className="text-left p-3 rounded-xl text-xs transition-colors hover:border-[var(--accent)] border"
                            style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--sub)" }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className="w-7 h-7 rounded-full flex items-center justify-center mr-2 mt-0.5 shrink-0"
                       style={{ background: "var(--accent)" }}>
                    <TrendingUp className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
                <div className="max-w-[85%] px-4 py-3 rounded-2xl"
                     style={{
                       background: msg.role === "user" ? "var(--accent)" : "var(--card)",
                       borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                       border: msg.role === "user" ? "none" : "1px solid var(--border)",
                       color: msg.role === "user" ? "white" : "var(--sub)",
                     }}>
                  {msg.role === "assistant" ? (
                    <div className="prose-dark">
                      {msg.content === "" && isStreaming && i === messages.length - 1
                        ? <TypingDots />
                        : <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                      }
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t p-4 shrink-0" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            {remaining === 0 && !isPremium && (
              <div className="max-w-4xl mx-auto mb-3 px-4 py-2.5 rounded-xl border flex items-center justify-between"
                   style={{ background: "rgba(255,71,87,0.06)", borderColor: "rgba(255,71,87,0.25)" }}>
                <span className="text-xs" style={{ color: "var(--down)" }}>
                  Alcanzaste el límite de {FREE_MSG_LIMIT} mensajes diarios.
                </span>
                <button onClick={() => setPaywallOpen(true)}
                        className="text-xs font-bold ml-3 shrink-0"
                        style={{ color: "var(--accent-l)" }}>
                  Activar Premium →
                </button>
              </div>
            )}
            <div className="flex gap-3 items-end max-w-4xl mx-auto">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={remaining === 0 && !isPremium ? "Límite diario alcanzado — activa Premium para continuar" : "Pregunta sobre cualquier empresa, concepto o estrategia..."}
                rows={1}
                disabled={isStreaming || (remaining === 0 && !isPremium)}
                className="flex-1 rounded-xl px-4 py-3 text-sm outline-none resize-none transition-colors border"
                style={{
                  background: "var(--raised)",
                  borderColor: "var(--border)",
                  color: "var(--text)",
                  maxHeight: "120px",
                  overflowY: "auto",
                }}
              />
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || isStreaming || (remaining === 0 && !isPremium)}
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors shrink-0 disabled:opacity-40"
                style={{ background: "var(--accent)" }}>
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>
            <p className="text-center text-xs mt-2" style={{ color: "var(--dim)" }}>
              Solo educativo. No reemplaza asesoramiento financiero profesional.
            </p>
          </div>
        </main>
      </div>

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} />
    </div>
  );
}
