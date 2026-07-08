"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import PremiumBadge from "@/components/PremiumBadge";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import { useThemeStore } from "@/lib/store";
import { support as supportApi } from "@/lib/api";
import { Menu, X, Sun, Moon, Send, Loader2, ChevronDown, ChevronUp, TicketCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

interface Msg { role: "user" | "assistant"; content: string; }

function getFaq(t: TFunction): { q: string; a: string }[] {
  const faq = t("support.faq", { returnObjects: true }) as { q: string; a: string }[];
  return faq;
}

export default function SupportPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const FAQ = getFaq(t);
  const { theme, toggleTheme } = useThemeStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", content: t("support.chatGreeting") },
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  // Ticket form
  const [ticketMode, setTicketMode] = useState(false);
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketSending, setTicketSending] = useState(false);
  const [ticketSent, setTicketSent] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    const history = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((p) => [...p, { role: "user", content: text }]);
    setInput("");
    setStreaming(true);
    setMsgs((p) => [...p, { role: "assistant", content: "" }]);
    try {
      const res = await supportApi.chat(text, history);
      if (!res.ok || !res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMsgs((p) => { const next = [...p]; next[next.length - 1] = { role: "assistant", content: acc }; return next; });
      }
    } catch {
      setMsgs((p) => { const next = [...p]; next[next.length - 1] = { role: "assistant", content: t("support.chatError") }; return next; });
    } finally {
      setStreaming(false);
    }
  };

  const sendTicket = async () => {
    if (!ticketSubject.trim() || !ticketMessage.trim()) return;
    setTicketSending(true);
    try {
      await supportApi.createTicket(ticketSubject.trim(), ticketMessage.trim());
      setTicketSent(true);
      setTicketSubject(""); setTicketMessage("");
    } catch {}
    setTicketSending(false);
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

        {/* Sticky Header */}
        <div className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between border-b shrink-0"
             style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("support.eyebrow")}</p>
            <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>{t("support.title")}</h1>
          </div>
          <div className="flex items-center gap-2">
            <PremiumBadge />
            <button onClick={toggleTheme}
                    className="w-9 h-9 flex items-center justify-center rounded-xl border transition-colors hover:border-[var(--accent)]"
                    style={{ borderColor: "var(--border)", background: "var(--raised)", color: "var(--sub)" }}>
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>

      <div className="flex flex-1 overflow-hidden relative">

        <main className="flex-1 overflow-y-auto scrollbar-thin p-4">
          <div className="max-w-2xl mx-auto space-y-4 pb-8">

            {/* FAQ */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>{t("support.faqTitle")}</p>
              <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                {FAQ.map((item, i) => (
                  <div key={i} className={i > 0 ? "border-t" : ""} style={{ borderColor: "var(--border)" }}>
                    <button
                      className="w-full flex items-center justify-between px-4 py-3 text-left gap-3"
                      onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    >
                      <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>{item.q}</span>
                      {openFaq === i ? <ChevronUp className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />
                                     : <ChevronDown className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />}
                    </button>
                    {openFaq === i && (
                      <p className="px-4 pb-3 text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{item.a}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Chat */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>{t("support.chatTitle")}</p>
              <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                {/* Messages */}
                <div className="p-4 space-y-3 max-h-72 overflow-y-auto scrollbar-thin">
                  {msgs.map((m, i) => (
                    <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`rounded-2xl px-3 py-2 text-xs max-w-[80%] leading-relaxed ${m.role === "user" ? "rounded-br-sm" : "rounded-bl-sm"}`}
                           style={{
                             background: m.role === "user" ? "var(--accent)" : "var(--raised)",
                             color: m.role === "user" ? "white" : "var(--text)",
                           }}>
                        {m.content || (streaming && i === msgs.length - 1 ? <Loader2 className="w-3 h-3 animate-spin" /> : "")}
                      </div>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
                {/* Input */}
                <div className="border-t flex gap-2 p-3" style={{ borderColor: "var(--border)" }}>
                  <input
                    className="flex-1 text-xs rounded-xl px-3 py-2 outline-none border"
                    style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                    placeholder={t("support.chatPlaceholder")}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
                    disabled={streaming}
                  />
                  <button onClick={send} disabled={streaming || !input.trim()}
                          className="p-2 rounded-xl disabled:opacity-40"
                          style={{ background: "var(--accent)", color: "white" }}>
                    {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Ticket */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>{t("support.needMoreHelp")}</p>
              <div className="rounded-2xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                {ticketSent ? (
                  <div className="flex flex-col items-center py-4 gap-2">
                    <TicketCheck className="w-8 h-8" style={{ color: "var(--accent-l)" }} />
                    <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{t("support.ticketSentTitle")}</p>
                    <p className="text-xs text-center" style={{ color: "var(--muted)" }}>{t("support.ticketSentDesc")}</p>
                    <button onClick={() => setTicketSent(false)} className="mt-2 text-xs underline" style={{ color: "var(--muted)" }}>{t("support.sendAnother")}</button>
                  </div>
                ) : !ticketMode ? (
                  <div className="flex flex-col items-center gap-3 py-2">
                    <p className="text-xs text-center" style={{ color: "var(--sub)" }}>
                      {t("support.ticketIntro")}
                    </p>
                    <button onClick={() => setTicketMode(true)}
                            className="px-4 py-2 rounded-xl text-xs font-bold text-white"
                            style={{ background: "var(--accent)" }}>
                      {t("support.createTicket")}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <input
                      className="w-full text-xs rounded-xl px-3 py-2 outline-none border"
                      style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                      placeholder={t("support.subjectPlaceholder")}
                      value={ticketSubject}
                      onChange={(e) => setTicketSubject(e.target.value)}
                      maxLength={200}
                    />
                    <textarea
                      className="w-full text-xs rounded-xl px-3 py-2 outline-none border resize-none"
                      style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                      placeholder={t("support.messagePlaceholder")}
                      rows={4}
                      value={ticketMessage}
                      onChange={(e) => setTicketMessage(e.target.value)}
                      maxLength={2000}
                    />
                    <div className="flex gap-2">
                      <button onClick={() => setTicketMode(false)} className="flex-1 py-2 rounded-xl text-xs font-semibold border"
                              style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                        {t("support.cancel")}
                      </button>
                      <button onClick={sendTicket} disabled={ticketSending || !ticketSubject.trim() || !ticketMessage.trim()}
                              className="flex-1 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-40"
                              style={{ background: "var(--accent)" }}>
                        {ticketSending ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : t("support.sendTicket")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>
        </main>
      </div>
      </div>
    </div>
  );
}
