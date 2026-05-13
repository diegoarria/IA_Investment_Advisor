"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chat as chatApi, notifications as notifApi, market as marketApi } from "@/lib/api";
import { useAuthStore, useProfileStore, useChatStore, useNotificationStore } from "@/lib/store";
import type { MarketSummary } from "@/lib/types";
import {
  Send, TrendingUp, BarChart2, Bell, LogOut, Menu, X,
  ChevronRight, BookOpen, PieChart, Zap
} from "lucide-react";

const SUGGESTIONS = [
  "¿Qué diferencia hay entre NVDA y AVGO como inversión?",
  "Explícame qué es un ETF y por qué usarlo",
  "¿Cómo construyo un portafolio diversificado?",
  "¿Qué hace Amazon para ganar dinero realmente?",
  "Tengo $5,000. ¿Cómo pienso en esto como inversor?",
  "¿Por qué el mercado cayó hoy y cómo lo interpreto?",
];

function MarketBar({ market }: { market: MarketSummary }) {
  const items = Object.entries(market);
  if (!items.length) return null;
  return (
    <div className="flex gap-6 overflow-x-auto scrollbar-thin">
      {items.map(([name, data]) => (
        <div key={name} className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-gray-400 text-xs">{name}</span>
          <span className="text-white text-xs font-medium">{data.value.toLocaleString()}</span>
          <span className={`text-xs font-medium ${data.direction === "up" ? "text-green-400" : "text-red-400"}`}>
            {data.direction === "up" ? "▲" : "▼"} {Math.abs(data.change_pct)}%
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const { isAuthenticated, clearAuth } = useAuthStore();
  const { profile } = useProfileStore();
  const { messages, isStreaming, addMessage, appendToLastAssistant, setStreaming, startAssistantMessage, setMessages } = useChatStore();
  const { notifications, unreadCount, setNotifications, markRead } = useNotificationStore();

  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [market, setMarket] = useState<MarketSummary>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isAuthenticated) { router.push("/"); return; }

    chatApi.getHistory().then((res) => {
      setMessages(res.data.messages.map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: m.content })));
    }).catch(() => {});

    notifApi.getAll().then((res) => {
      setNotifications(res.data.notifications, res.data.unread_count);
    }).catch(() => {});

    marketApi.getSummary().then((res) => setMarket(res.data)).catch(() => {});
  }, [isAuthenticated]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || isStreaming) return;
    setInput("");

    const userMsg = { role: "user" as const, content: msg };
    addMessage(userMsg);
    chatApi.saveMessage("user", msg).catch(() => {});

    const historyForApi = messages.slice(-20).map((m) => ({ role: m.role, content: m.content }));

    startAssistantMessage();
    setStreaming(true);

    let fullResponse = "";
    await chatApi.stream(
      msg,
      historyForApi,
      (chunk) => {
        appendToLastAssistant(chunk);
        fullResponse += chunk;
      },
      () => {
        setStreaming(false);
        chatApi.saveMessage("assistant", fullResponse).catch(() => {});
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleLogout = () => {
    clearAuth();
    router.push("/");
  };

  const riskLabel = { conservative: "Conservador", moderate: "Moderado", aggressive: "Agresivo" };
  const expLabel = { beginner: "Principiante", intermediate: "Intermedio", advanced: "Avanzado" };

  return (
    <div className="h-screen bg-[#0f1117] flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="border-b border-[#2a2d3a] px-4 py-2 flex items-center justify-between bg-[#1a1d27]">
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden text-gray-400 hover:text-white">
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-white text-sm">IA Investment Advisor</span>
          </div>
        </div>

        <div className="hidden md:block flex-1 mx-8">
          <MarketBar market={market} />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setNotifOpen(!notifOpen)}
            className="relative p-2 text-gray-400 hover:text-white transition-colors"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-brand-500 rounded-full text-white text-xs flex items-center justify-center">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
          <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-red-400 transition-colors">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <aside className={`${sidebarOpen ? "flex" : "hidden"} lg:flex w-64 border-r border-[#2a2d3a] bg-[#1a1d27] flex-col p-4 absolute lg:relative z-10 h-full`}>
          {profile && (
            <div className="mb-6">
              <div className="bg-[#0f1117] rounded-xl p-3 border border-[#2a2d3a]">
                <div className="text-xs text-gray-400 mb-1">Tu perfil</div>
                <div className="text-white text-sm font-semibold">
                  {riskLabel[profile.risk_tolerance]}
                </div>
                <div className="text-gray-400 text-xs">{expLabel[profile.investment_experience]}</div>
                <div className="text-gray-400 text-xs">{profile.time_horizon_years} años horizonte</div>
                <div className="mt-2 text-xs text-brand-400">{profile.interaction_count} interacciones</div>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <button
              onClick={() => { router.push("/chat"); setSidebarOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-500/10 text-brand-400 text-sm"
            >
              <BookOpen className="w-4 h-4" /> Chat con tu mentor
            </button>
            <button
              onClick={() => { router.push("/portfolio"); setSidebarOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#2a2d3a] text-sm transition-colors"
            >
              <PieChart className="w-4 h-4" /> Simular portafolios
            </button>
            <button
              onClick={() => { router.push("/notifications"); setSidebarOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#2a2d3a] text-sm transition-colors"
            >
              <Bell className="w-4 h-4" /> Notificaciones
              {unreadCount > 0 && (
                <span className="ml-auto bg-brand-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>
            <button
              onClick={() => sendMessage("Analiza el mercado hoy y dime qué debo entender según mi perfil")}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#2a2d3a] text-sm transition-colors"
            >
              <BarChart2 className="w-4 h-4" /> Análisis del día
            </button>
          </div>

          <div className="mt-auto">
            <button
              onClick={() => router.push("/onboarding")}
              className="w-full text-xs text-gray-500 hover:text-gray-300 text-center py-2 transition-colors"
            >
              Actualizar perfil
            </button>
          </div>
        </aside>

        {/* Notification panel */}
        {notifOpen && (
          <div className="absolute right-0 top-0 w-80 h-full bg-[#1a1d27] border-l border-[#2a2d3a] z-20 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-[#2a2d3a]">
              <span className="font-semibold text-white">Notificaciones</span>
              <button onClick={() => setNotifOpen(false)} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2">
              {notifications.length === 0 && (
                <p className="text-gray-500 text-sm text-center py-8">Sin notificaciones aún</p>
              )}
              {notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => markRead(n.id)}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    n.read ? "border-[#2a2d3a] bg-[#0f1117]" : "border-brand-500/40 bg-brand-500/5"
                  }`}
                >
                  <div className="text-sm font-medium text-white">{n.title}</div>
                  <div className="text-xs text-gray-400 mt-1 line-clamp-2">{n.message}</div>
                  <button
                    onClick={(e) => { e.stopPropagation(); sendMessage(n.message.slice(0, 200)); setNotifOpen(false); }}
                    className="text-xs text-brand-400 hover:text-brand-300 mt-1 flex items-center gap-1"
                  >
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
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 bg-brand-500/10 rounded-2xl flex items-center justify-center mb-4">
                  <Zap className="w-8 h-8 text-brand-400" />
                </div>
                <h2 className="text-xl font-bold text-white mb-2">
                  {profile ? `Hola, inversionista en formación` : "Tu mentor de inversiones está listo"}
                </h2>
                <p className="text-gray-400 text-sm max-w-sm mb-8">
                  {profile
                    ? `Perfil ${riskLabel[profile.risk_tolerance].toLowerCase()} configurado. Pregunta sobre cualquier empresa, ETF, o concepto financiero.`
                    : "Pregunta sobre acciones, ETFs, estrategias de inversión o cualquier concepto financiero."
                  }
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => sendMessage(s)}
                      className="text-left p-3 bg-[#1a1d27] border border-[#2a2d3a] hover:border-brand-500/50 rounded-xl text-gray-300 text-xs transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className="w-7 h-7 bg-brand-600 rounded-full flex items-center justify-center mr-2 mt-0.5 flex-shrink-0">
                    <TrendingUp className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] px-4 py-3 rounded-2xl ${
                    msg.role === "user"
                      ? "bg-brand-600 text-white rounded-br-sm"
                      : "bg-[#1a1d27] border border-[#2a2d3a] rounded-bl-sm"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose-dark text-sm">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                      {isStreaming && i === messages.length - 1 && msg.content === "" && (
                        <span className="inline-block w-2 h-4 bg-brand-400 animate-pulse rounded-sm" />
                      )}
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
          <div className="border-t border-[#2a2d3a] p-4 bg-[#1a1d27]">
            <div className="flex gap-3 items-end max-w-4xl mx-auto">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Pregunta sobre cualquier empresa, concepto o estrategia..."
                rows={1}
                className="flex-1 bg-[#0f1117] border border-[#2a2d3a] focus:border-brand-500 rounded-xl px-4 py-3 text-white placeholder-gray-500 outline-none resize-none text-sm transition-colors"
                style={{ maxHeight: "120px", overflowY: "auto" }}
                disabled={isStreaming}
              />
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || isStreaming}
                className="w-10 h-10 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl flex items-center justify-center transition-colors flex-shrink-0"
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>
            <p className="text-center text-gray-600 text-xs mt-2">
              Solo educativo. No reemplaza asesoramiento financiero profesional.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
