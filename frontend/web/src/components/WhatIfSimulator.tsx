"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Zap, TrendingUp, TrendingDown, Minus, Loader2, ChevronDown,
  RefreshCw, DollarSign, Globe, Brain, Edit2, X, Sparkles,
} from "lucide-react";
import PremiumToolLocked from "@/components/PremiumToolLocked";
import { simulateApi } from "@/lib/api";

interface Position {
  ticker: string;
  name?: string;
  shares?: number;
  avg_cost?: number;
  current_price?: number;
  value?: number;
}

interface WhatIfSimulatorProps {
  positions: Position[];
  isPremium: boolean;
  onUpgrade: () => void;
}

const SCENARIO_TYPES: Array<{ id: string; label: string; icon: LucideIcon; desc: string }> = [
  { id: "swap",        label: "Cambiar posición",     icon: RefreshCw,  desc: "Vender X y comprar Y con ese dinero" },
  { id: "add_monthly", label: "Aporte mensual",        icon: DollarSign, desc: "Invertir $X/mes durante N años" },
  { id: "macro",       label: "Evento macroeconómico", icon: Globe,      desc: "Simular un evento global sobre tu portafolio" },
  { id: "custom",      label: "Escenario libre",       icon: Edit2,      desc: "Describe cualquier hipótesis" },
];

const MACRO_EVENTS = [
  "La Fed sube tasas al 7%",
  "Recesión en EE.UU. (-10% PIB)",
  "Crash del mercado tech -40%",
  "Boom de IA — tech +50%",
  "Inflación persistente al 8%",
  "Dólar se fortalece 20%",
];

type ImpactDir = "aumenta" | "disminuye" | "neutro";

interface SimResult {
  scenario_title?: string;
  summary?: string;
  before?: { risk_level?: string; diversification_score?: number };
  after?: { risk_level?: string; diversification_score?: number; projected_1y?: string; projected_5y?: string };
  impacts?: { aspect: string; direction: ImpactDir; detail: string }[];
  pros?: string[];
  cons?: string[];
  mentor_verdict?: string;
  recommendation?: string;
}

const TOOL_COLOR = "#f59e0b";

export default function WhatIfSimulator({ positions, isPremium, onUpgrade }: WhatIfSimulatorProps) {
  const [open, setOpen]              = useState(false);
  const [scenarioType, setScenarioType] = useState("swap");
  const [params, setParams]          = useState<Record<string, unknown>>({});
  const [loading, setLoading]        = useState(false);
  const [result, setResult]          = useState<SimResult | null>(null);

  const tickers = positions.map((p) => p.ticker);

  const handleOpen = () => {
    if (!isPremium) { onUpgrade(); return; }
    setOpen(true);
  };

  const handleRun = async () => {
    setLoading(true);
    setResult(null);
    try {
      const portfolio = positions.map((p) => ({
        ticker:        p.ticker,
        name:          p.name || p.ticker,
        shares:        p.shares || 0,
        avg_cost:      p.avg_cost || 0,
        current_price: p.current_price || 0,
        value:         p.value || 0,
      }));
      const res = await simulateApi.whatIf(scenarioType, params, portfolio);
      setResult(res.data);
    } catch {
      setResult({ summary: "No se pudo completar la simulación. Intenta de nuevo." });
    } finally {
      setLoading(false);
    }
  };

  const dirIcon = (d: ImpactDir) =>
    d === "aumenta"   ? <TrendingUp  className="w-3 h-3" style={{ color: "#22c55e" }} />
    : d === "disminuye" ? <TrendingDown className="w-3 h-3" style={{ color: "#ef4444" }} />
    : <Minus className="w-3 h-3" style={{ color: "var(--muted)" }} />;

  const recColor = (r?: string) =>
    r === "proceder" ? "#22c55e" : r === "proceder_con_cautela" ? "#f59e0b" : r === "no_recomendado" ? "#ef4444" : "var(--muted)";

  const recLabel = (r?: string) => ({
    proceder:             "Proceder",
    proceder_con_cautela: "Proceder con cautela",
    no_recomendado:       "No recomendado",
    mantener_actual:      "🔵 Mantener portafolio actual",
  }[r ?? ""] ?? r ?? "");

  if (!isPremium) {
    return (
      <PremiumToolLocked
        title="Simulador ¿Qué pasa si?"
        tagline="Prueba decisiones antes de tomarlas"
        description="Simula cualquier cambio en tu portafolio antes de ejecutarlo. Cambia posiciones, proyecta aportes mensuales o simula eventos macroeconómicos."
        icon={Zap}
        color={TOOL_COLOR}
        benefits={[
          { icon: RefreshCw,  text: "¿Qué pasa si vendo X y compro Y?" },
          { icon: DollarSign, text: "Proyección de aportes mensuales a N años" },
          { icon: Globe,      text: "Impacto de eventos macro en tu portafolio" },
          { icon: Brain,      text: "Resumen de tu mentor en cada escenario" },
        ]}
        onUnlock={onUpgrade}
      />
    );
  }

  return (
    <>
      {/* ── Tool Card ── */}
      <div
        onClick={handleOpen}
        className="rounded-3xl overflow-hidden cursor-pointer transition-transform hover:scale-[1.01] active:scale-[0.99]"
        style={{ background: "var(--card)", boxShadow: "0 4px 24px rgba(0,0,0,0.12)" }}
      >
        {/* Hero */}
        <div className="relative flex flex-col items-center pt-9 pb-7 overflow-hidden"
             style={{ background: TOOL_COLOR + "18" }}>
          <div className="absolute -top-14 -right-10 w-44 h-44 rounded-full pointer-events-none"
               style={{ background: TOOL_COLOR + "15" }} />
          <div className="absolute -bottom-8 -left-5 w-28 h-28 rounded-full pointer-events-none"
               style={{ background: TOOL_COLOR + "0A" }} />
          <div className="relative z-10 w-[88px] h-[88px] rounded-[28px] border-2 flex items-center justify-center"
               style={{ background: TOOL_COLOR + "25", borderColor: TOOL_COLOR + "40" }}>
            <div className="w-[72px] h-[72px] rounded-[22px] flex items-center justify-center"
                 style={{ background: TOOL_COLOR }}>
              <Zap className="w-8 h-8 text-white" />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 pt-5">
          <h3 className="text-[22px] font-black tracking-tight text-center mb-1"
              style={{ color: "var(--text)" }}>
            Simulador ¿Qué pasa si?
          </h3>
          <p className="text-[13px] font-bold text-center mb-5 tracking-wide" style={{ color: TOOL_COLOR }}>
            Prueba decisiones antes de tomarlas
          </p>

          <div className="rounded-2xl border overflow-hidden mb-5" style={{ borderColor: "var(--border)" }}>
            {[
              { emoji: "🔄", text: "¿Qué pasa si vendo X y compro Y?" },
              { emoji: "💰", text: "Proyección de aportes mensuales a N años" },
              { emoji: "💡", text: "Resumen de tu mentor en cada escenario" },
            ].map((f, i, arr) => (
              <div key={f.text}
                   className="flex items-center gap-3 px-3.5 py-3"
                   style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center shrink-0 text-[17px]"
                     style={{ background: TOOL_COLOR + "12" }}>
                  {f.emoji}
                </div>
                <span className="text-[13px] leading-snug font-medium" style={{ color: "var(--sub)" }}>
                  {f.text}
                </span>
              </div>
            ))}
          </div>

          <button
            onClick={(e) => { e.stopPropagation(); handleOpen(); }}
            className="relative w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-extrabold text-[15px] text-white overflow-hidden tracking-wide transition-opacity hover:opacity-90"
            style={{ background: TOOL_COLOR }}
          >
            <div className="absolute inset-0 top-0 h-1/2 pointer-events-none"
                 style={{ background: "rgba(255,255,255,0.12)" }} />
            <Sparkles className="w-4 h-4" />
            Simular Escenario
          </button>
        </div>
      </div>

      {/* ── Modal ── */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
             style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
             onClick={() => setOpen(false)}>
          <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden max-h-[90vh] flex flex-col"
               style={{ background: "var(--card)" }}
               onClick={(e) => e.stopPropagation()}>

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0"
                 style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4" style={{ color: TOOL_COLOR }} />
                <span className="font-bold text-sm" style={{ color: "var(--text)" }}>⚡ ¿Qué pasa si?</span>
              </div>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-xl hover:bg-white/5 transition-colors"
                      style={{ color: "var(--muted)" }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-4 space-y-4">
              {/* Scenario type selector */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
                  Tipo de escenario
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {SCENARIO_TYPES.map((s) => {
                    const SIcon = s.icon;
                    return (
                      <button key={s.id} onClick={() => { setScenarioType(s.id); setParams({}); setResult(null); }}
                              className="p-2.5 rounded-xl border text-left transition-all"
                              style={{
                                borderColor: scenarioType === s.id ? TOOL_COLOR : "var(--border)",
                                background:  scenarioType === s.id ? TOOL_COLOR + "15" : "var(--raised)",
                              }}>
                        <SIcon className="w-4 h-4 mb-0.5" style={{ color: scenarioType === s.id ? TOOL_COLOR : "var(--muted)" }} />
                        <p className="text-[11px] font-semibold mt-0.5" style={{ color: "var(--text)" }}>{s.label}</p>
                        <p className="text-[10px]" style={{ color: "var(--muted)" }}>{s.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Params */}
              {scenarioType === "swap" && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--muted)" }}>Vender</label>
                    <div className="relative">
                      <select className="w-full rounded-xl border px-2 py-1.5 text-xs appearance-none pr-6"
                              style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                              value={(params.sell_ticker as string) || ""}
                              onChange={(e) => setParams((p) => ({ ...p, sell_ticker: e.target.value }))}>
                        <option value="">Seleccionar</option>
                        {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" style={{ color: "var(--muted)" }} />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--muted)" }}>Comprar</label>
                    <input type="text" placeholder="Ej: VOO"
                           className="w-full rounded-xl border px-2 py-1.5 text-xs"
                           style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                           value={(params.buy_ticker as string) || ""}
                           onChange={(e) => setParams((p) => ({ ...p, buy_ticker: e.target.value.toUpperCase() }))} />
                  </div>
                </div>
              )}

              {scenarioType === "add_monthly" && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--muted)" }}>Monto mensual ($)</label>
                    <input type="number" placeholder="Ej: 300"
                           className="w-full rounded-xl border px-2 py-1.5 text-xs"
                           style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                           value={(params.amount as number) || ""}
                           onChange={(e) => setParams((p) => ({ ...p, amount: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--muted)" }}>Durante (años)</label>
                    <input type="number" placeholder="Ej: 5" min={1} max={30}
                           className="w-full rounded-xl border px-2 py-1.5 text-xs"
                           style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                           value={(params.years as number) || ""}
                           onChange={(e) => setParams((p) => ({ ...p, years: Number(e.target.value) }))} />
                  </div>
                </div>
              )}

              {scenarioType === "macro" && (
                <div>
                  <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--muted)" }}>Evento macroeconómico</label>
                  <div className="grid grid-cols-2 gap-1.5 mb-2">
                    {MACRO_EVENTS.map((evt) => (
                      <button key={evt} onClick={() => setParams({ event: evt })}
                              className="text-[10px] px-2 py-1.5 rounded-xl border text-left transition-all"
                              style={{
                                borderColor: params.event === evt ? TOOL_COLOR : "var(--border)",
                                background:  params.event === evt ? TOOL_COLOR + "15" : "var(--raised)",
                                color:       params.event === evt ? TOOL_COLOR : "var(--sub)",
                              }}>
                        {evt}
                      </button>
                    ))}
                  </div>
                  <input type="text" placeholder="O escribe tu propio evento..."
                         className="w-full rounded-xl border px-2 py-1.5 text-xs"
                         style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                         value={(params.event as string) || ""}
                         onChange={(e) => setParams({ event: e.target.value })} />
                </div>
              )}

              {scenarioType === "custom" && (
                <div>
                  <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--muted)" }}>Describe el escenario</label>
                  <textarea rows={3} placeholder="Ej: ¿Qué pasa si vendo todo y compro solo SPY?"
                            className="w-full rounded-xl border px-2 py-1.5 text-xs resize-none"
                            style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                            value={(params.description as string) || ""}
                            onChange={(e) => setParams({ description: e.target.value })} />
                </div>
              )}

              <button onClick={handleRun} disabled={loading}
                      className="w-full py-3 rounded-2xl text-sm font-bold text-white disabled:opacity-60 transition-opacity"
                      style={{ background: TOOL_COLOR }}>
                {loading
                  ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Simulando...</span>
                  : "Simular escenario"}
              </button>

              {/* Result */}
              {result && (
                <div className="space-y-3 pb-4">
                  {result.scenario_title && (
                    <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{result.scenario_title}</p>
                  )}
                  {result.summary && (
                    <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{result.summary}</p>
                  )}
                  {result.impacts && result.impacts.length > 0 && (
                    <div className="grid grid-cols-2 gap-1.5">
                      {result.impacts.map((imp) => (
                        <div key={imp.aspect} className="p-2 rounded-xl border"
                             style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                          <div className="flex items-center gap-1 mb-0.5">
                            {dirIcon(imp.direction as ImpactDir)}
                            <span className="text-[10px] font-semibold" style={{ color: "var(--text)" }}>{imp.aspect}</span>
                          </div>
                          <p className="text-[10px]" style={{ color: "var(--muted)" }}>{imp.detail}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {(result.pros || result.cons) && (
                    <div className="grid grid-cols-2 gap-2">
                      {result.pros && (
                        <div className="p-2 rounded-xl" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)" }}>
                          <p className="text-[10px] font-bold mb-1" style={{ color: "#22c55e" }}>Pros</p>
                          {result.pros.map((p) => (
                            <p key={p} className="text-[10px] leading-snug mb-0.5" style={{ color: "var(--sub)" }}>· {p}</p>
                          ))}
                        </div>
                      )}
                      {result.cons && (
                        <div className="p-2 rounded-xl" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
                          <p className="text-[10px] font-bold mb-1" style={{ color: "#ef4444" }}>Contras</p>
                          {result.cons.map((c) => (
                            <p key={c} className="text-[10px] leading-snug mb-0.5" style={{ color: "var(--sub)" }}>· {c}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {result.mentor_verdict && (
                    <div className="p-3 rounded-xl" style={{ background: "rgba(0,168,94,0.06)", border: "1px solid rgba(0,168,94,0.2)" }}>
                      <p className="text-[10px] font-bold mb-1" style={{ color: "var(--accent-l)" }}>Resumen del mentor</p>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{result.mentor_verdict}</p>
                    </div>
                  )}
                  {result.recommendation && (
                    <div className="text-center">
                      <span className="text-xs font-bold px-3 py-1.5 rounded-full"
                            style={{ background: `${recColor(result.recommendation)}20`, color: recColor(result.recommendation) }}>
                        {recLabel(result.recommendation)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
