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

interface Msg { role: "user" | "assistant"; content: string; }

const FAQ = [
  { q: "¿Cuántos mensajes puedo enviar gratis?", a: "El plan Free incluye 20 mensajes cada 24 horas. Con Premium tienes mensajes ilimitados y acceso a todas las funciones avanzadas." },
  { q: "¿Cómo funciona el Premium gratis de 90 días?", a: "Todos los usuarios nuevos reciben 90 días de Premium gratis automáticamente, sin necesidad de tarjeta de crédito. Puedes explorar todas las funciones sin restricciones durante ese período." },
  { q: "¿Cómo importo mi portafolio?", a: "En la sección Portafolio puedes pegar una captura de pantalla de tu broker (Ctrl+V / ⌘+V) o agregar posiciones manualmente. La IA lee la imagen y extrae tus posiciones, precios y cantidades automáticamente." },
  { q: "¿Cómo veo el análisis completo de una acción?", a: "Toca o haz clic en cualquier acción desde Portafolio, Watchlist o el Chat para abrir su perfil completo. Ahí encuentras el gráfico histórico, estado de resultados, balance general y flujo de caja con datos en tiempo real." },
  { q: "¿Cómo funciona el calendario de ganancias?", a: "En la sección Portafolio encontrarás un calendario que muestra las fechas de reporte de ganancias (earnings) de tus posiciones y acciones del Watchlist. Te ayuda a anticipar movimientos importantes de precio." },
  { q: "¿El paper trading usa dinero real?", a: "No. El simulador inicia con $10,000 virtuales para que practiques estrategias con precios reales sin arriesgar dinero. Puedes recargar el saldo virtual en cualquier momento desde la sección Simulador." },
  { q: "¿Puedo cambiar el orden de mis acciones en el Watchlist?", a: "Sí. En la vista básica del Watchlist puedes arrastrar las tarjetas de acciones para ordenarlas como prefieras. El orden se guarda automáticamente y persiste entre sesiones." },
  { q: "¿Qué es la Madurez Inversora?", a: "Es una puntuación (0-100) que la IA calcula analizando tu comportamiento real en la app: si entras en pánico en caídas, si diversificas bien, si tomas decisiones a largo plazo. Evoluciona conforme usas la app y aparece como una barra en tu perfil." },
  { q: "¿La app sincroniza entre web y móvil?", a: "Sí. El portafolio, watchlist, preferencia de tema oscuro/claro y configuración de perfil se sincronizan automáticamente entre la versión web y la app móvil en tiempo real." },
  { q: "¿Cómo cancelo mi suscripción Premium?", a: "Ve a Perfil → Suscripción → Cancelar. El acceso Premium se mantiene hasta el fin del período ya pagado." },
  { q: "¿Cómo funciona el programa de referidos?", a: "Ve a Perfil → Programa de referidos para obtener tu enlace único. Por cada amigo que se registre y use la app, acumulas semanas o meses de Premium gratis." },
];

export default function SupportPage() {
  const router = useRouter();
  const { theme, toggleTheme } = useThemeStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", content: "Hola, soy el asistente de soporte de Nuvos AI. ¿En qué puedo ayudarte hoy?" },
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
      setMsgs((p) => { const next = [...p]; next[next.length - 1] = { role: "assistant", content: "Lo siento, hubo un error. Por favor intenta de nuevo o crea un ticket de soporte." }; return next; });
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
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

        {/* Sticky Header */}
        <div className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between border-b shrink-0"
             style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Ayuda</p>
            <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>Soporte</h1>
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
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>Preguntas frecuentes</p>
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
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>Chat de soporte</p>
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
                    placeholder="Escribe tu pregunta..."
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
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>¿Necesitas más ayuda?</p>
              <div className="rounded-2xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                {ticketSent ? (
                  <div className="flex flex-col items-center py-4 gap-2">
                    <TicketCheck className="w-8 h-8" style={{ color: "var(--accent-l)" }} />
                    <p className="text-sm font-bold" style={{ color: "var(--text)" }}>Ticket enviado</p>
                    <p className="text-xs text-center" style={{ color: "var(--muted)" }}>El equipo de Nuvos AI revisará tu caso y te contactará pronto.</p>
                    <button onClick={() => setTicketSent(false)} className="mt-2 text-xs underline" style={{ color: "var(--muted)" }}>Enviar otro</button>
                  </div>
                ) : !ticketMode ? (
                  <div className="flex flex-col items-center gap-3 py-2">
                    <p className="text-xs text-center" style={{ color: "var(--sub)" }}>
                      Si el chatbot no pudo resolver tu problema, crea un ticket y el equipo te responderá en menos de 24 h.
                    </p>
                    <button onClick={() => setTicketMode(true)}
                            className="px-4 py-2 rounded-xl text-xs font-bold text-white"
                            style={{ background: "var(--accent)" }}>
                      Crear ticket de soporte
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <input
                      className="w-full text-xs rounded-xl px-3 py-2 outline-none border"
                      style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                      placeholder="Asunto (ej: Error al cargar portafolio)"
                      value={ticketSubject}
                      onChange={(e) => setTicketSubject(e.target.value)}
                      maxLength={200}
                    />
                    <textarea
                      className="w-full text-xs rounded-xl px-3 py-2 outline-none border resize-none"
                      style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                      placeholder="Describe el problema con detalle..."
                      rows={4}
                      value={ticketMessage}
                      onChange={(e) => setTicketMessage(e.target.value)}
                      maxLength={2000}
                    />
                    <div className="flex gap-2">
                      <button onClick={() => setTicketMode(false)} className="flex-1 py-2 rounded-xl text-xs font-semibold border"
                              style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                        Cancelar
                      </button>
                      <button onClick={sendTicket} disabled={ticketSending || !ticketSubject.trim() || !ticketMessage.trim()}
                              className="flex-1 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-40"
                              style={{ background: "var(--accent)" }}>
                        {ticketSending ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : "Enviar ticket"}
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
