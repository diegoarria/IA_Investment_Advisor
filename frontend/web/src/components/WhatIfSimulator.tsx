"use client";

import { useState } from "react";
import { Zap, TrendingUp, TrendingDown, Minus, Loader2, ChevronDown } from "lucide-react";
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

const SCENARIO_TYPES = [
  { id: "swap",        label: "Cambiar posición",     icon: "🔄", desc: "Vender X y comprar Y con ese dinero" },
  { id: "add_monthly", label: "Aporte mensual",        icon: "💰", desc: "Invertir $X/mes durante N años" },
  { id: "macro",       label: "Evento macroeconómico", icon: "🌍", desc: "Simular un evento global sobre tu portafolio" },
  { id: "custom",      label: "Escenario libre",       icon: "✏️",  desc: "Describe cualquier hipótesis" },
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

export default function WhatIfSimulator({ positions, isPremium, onUpgrade }: WhatIfSimulatorProps) {
  const [scenarioType, setScenarioType] = useState("swap");
  const [params, setParams]             = useState<Record<string, unknown>>({});
  const [loading, setLoading]           = useState(false);
  const [result, setResult]             = useState<SimResult | null>(null);

  const tickers = positions.map((p) => p.ticker);

  const handleRun = async () => {
    if (!isPremium) { onUpgrade(); return; }
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
    d === "aumenta" ? <TrendingUp className="w-3 h-3" style={{ color: "#22c55e" }} />
    : d === "disminuye" ? <TrendingDown className="w-3 h-3" style={{ color: "#ef4444" }} />
    : <Minus className="w-3 h-3" style={{ color: "var(--muted)" }} />;

  const recColor = (r?: string) => {
    if (r === "proceder") return "#22c55e";
    if (r === "proceder_con_cautela") return "#f59e0b";
    if (r === "no_recomendado") return "#ef4444";
    return "var(--muted)";
  };
  const recLabel = (r?: string) => ({
    proceder:             "✅ Proceder",
    proceder_con_cautela: "⚠️ Proceder con cautela",
    no_recomendado:       "❌ No recomendado",
    mantener_actual:      "🔵 Mantener portafolio actual",
  }[r ?? ""] ?? r ?? "");

  if (!isPremium) {
    return (
      <PremiumToolLocked
        title="Simulador ¿Qué pasa si?"
        tagline="Prueba decisiones antes de tomarlas"
        description="Simula cualquier cambio en tu portafolio antes de ejecutarlo. Cambia posiciones, proyecta aportes mensuales o simula eventos macroeconómicos y ve el impacto real."
        icon={Zap}
        color="#f59e0b"
        benefits={[
          { icon: "🔄", text: "¿Qué pasa si vendo X y compro Y?" },
          { icon: "💰", text: "Proyección de aportes mensuales a N años" },
          { icon: "🌍", text: "Impacto de eventos macro en tu portafolio" },
          { icon: "🧠", text: "Veredicto de tu mentor en cada escenario" },
        ]}
        onUnlock={onUpgrade}
      />
    );
  }

  return (
    <div className="rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="flex items-center gap-2 p-4 border-b" style={{ borderColor: "var(--border)" }}>
        <Zap className="w-4 h-4" style={{ color: "var(--accent-l)" }} />
        <span className="font-semibold text-sm" style={{ color: "var(--text)" }}>Simulador ¿Qué pasa si?</span>
      </div>

      <div className="p-4 space-y-4">
        {/* Scenario type selector */}
        <div className="grid grid-cols-2 gap-2">
          {SCENARIO_TYPES.map((s) => (
            <button key={s.id} onClick={() => { setScenarioType(s.id); setParams({}); setResult(null); }}
                    className="p-2.5 rounded-lg border text-left transition-all"
                    style={{
                      borderColor: scenarioType === s.id ? "var(--accent)" : "var(--border)",
                      background:  scenarioType === s.id ? "rgba(0,168,94,0.08)" : "var(--raised)",
                    }}>
              <span className="text-base">{s.icon}</span>
              <p className="text-[11px] font-semibold mt-0.5" style={{ color: "var(--text)" }}>{s.label}</p>
              <p className="text-[10px]" style={{ color: "var(--muted)" }}>{s.desc}</p>
            </button>
          ))}
        </div>

        {/* Scenario params */}
        {scenarioType === "swap" && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--muted)" }}>Vender</label>
              <div className="relative">
                <select className="w-full rounded-lg border px-2 py-1.5 text-xs appearance-none pr-6"
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
                     className="w-full rounded-lg border px-2 py-1.5 text-xs"
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
                     className="w-full rounded-lg border px-2 py-1.5 text-xs"
                     style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                     value={(params.amount as number) || ""}
                     onChange={(e) => setParams((p) => ({ ...p, amount: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--muted)" }}>Durante (años)</label>
              <input type="number" placeholder="Ej: 5" min={1} max={30}
                     className="w-full rounded-lg border px-2 py-1.5 text-xs"
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
                <button key={evt}
                        onClick={() => setParams({ event: evt })}
                        className="text-[10px] px-2 py-1.5 rounded-lg border text-left transition-all"
                        style={{
                          borderColor: params.event === evt ? "var(--accent)" : "var(--border)",
                          background:  params.event === evt ? "rgba(0,168,94,0.08)" : "var(--raised)",
                          color:       params.event === evt ? "var(--accent-l)" : "var(--sub)",
                        }}>
                  {evt}
                </button>
              ))}
            </div>
            <input type="text" placeholder="O escribe tu propio evento..."
                   className="w-full rounded-lg border px-2 py-1.5 text-xs"
                   style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                   value={(params.event as string) || ""}
                   onChange={(e) => setParams({ event: e.target.value })} />
          </div>
        )}

        {scenarioType === "custom" && (
          <div>
            <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--muted)" }}>Describe el escenario</label>
            <textarea rows={3} placeholder="Ej: ¿Qué pasa si vendo todo y compro solo SPY?"
                      className="w-full rounded-lg border px-2 py-1.5 text-xs resize-none"
                      style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                      value={(params.description as string) || ""}
                      onChange={(e) => setParams({ description: e.target.value })} />
          </div>
        )}

        <button onClick={handleRun} disabled={loading}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60 transition-opacity"
                style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Simulando...
            </span>
          ) : "⚡ Simular escenario"}
        </button>

        {/* Result */}
        {result && (
          <div className="space-y-3 pt-1">
            {result.scenario_title && (
              <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{result.scenario_title}</p>
            )}
            {result.summary && (
              <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{result.summary}</p>
            )}

            {/* Impact grid */}
            {result.impacts && result.impacts.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5">
                {result.impacts.map((imp) => (
                  <div key={imp.aspect} className="p-2 rounded-lg border"
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

            {/* Pros / Cons */}
            {(result.pros || result.cons) && (
              <div className="grid grid-cols-2 gap-2">
                {result.pros && (
                  <div className="p-2 rounded-lg" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)" }}>
                    <p className="text-[10px] font-bold mb-1" style={{ color: "#22c55e" }}>Pros</p>
                    {result.pros.map((p) => (
                      <p key={p} className="text-[10px] leading-snug mb-0.5" style={{ color: "var(--sub)" }}>· {p}</p>
                    ))}
                  </div>
                )}
                {result.cons && (
                  <div className="p-2 rounded-lg" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <p className="text-[10px] font-bold mb-1" style={{ color: "#ef4444" }}>Contras</p>
                    {result.cons.map((c) => (
                      <p key={c} className="text-[10px] leading-snug mb-0.5" style={{ color: "var(--sub)" }}>· {c}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Mentor verdict */}
            {result.mentor_verdict && (
              <div className="p-3 rounded-lg" style={{ background: "rgba(0,168,94,0.06)", border: "1px solid rgba(0,168,94,0.2)" }}>
                <p className="text-[10px] font-bold mb-1" style={{ color: "var(--accent-l)" }}>🧠 Veredicto del mentor</p>
                <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{result.mentor_verdict}</p>
              </div>
            )}

            {/* Recommendation badge */}
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
  );
}
