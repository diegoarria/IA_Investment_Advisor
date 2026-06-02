"use client";

import { useEffect, useState } from "react";
import { BookOpen, Loader2, TrendingUp, TrendingDown, CheckCircle, RefreshCw, Plus, X, AlertTriangle, Brain } from "lucide-react";
import PremiumToolLocked from "@/components/PremiumToolLocked";
import { decisionsApi } from "@/lib/api";

interface Decision {
  id?: string;
  action: string;
  ticker: string;
  trigger?: string;
  notes?: string;
  price_at_action?: number;
  created_at?: string;
}

interface Bias {
  name: string;
  severity: "alto" | "medio" | "bajo";
  occurrences: number;
  description: string;
  cost_estimate: string;
  example: string;
  fix: string;
}

interface Strength {
  name: string;
  description: string;
}

interface BiasReport {
  total_decisions?: number;
  analysis_period?: string;
  overall_score?: number;
  overall_label?: string;
  biases_detected?: Bias[];
  strengths?: Strength[];
  patterns?: {
    avg_hold_days?: number;
    panic_sell_count?: number;
    fomo_buy_count?: number;
    best_decision?: string;
    worst_decision?: string;
  };
  mentor_assessment?: string;
  next_challenge?: string;
  message?: string;
  generated_at?: string;
}

const ACTION_OPTIONS = ["buy", "sell", "hold", "ignored_alert", "acted_on_alert"];
const TRIGGER_OPTIONS = ["manual", "alert", "mentor", "fomo", "panic", "research"];
const ACTION_LABELS: Record<string, string> = {
  buy: "Compré",
  sell: "Vendí",
  hold: "Mantuve (decidí no actuar)",
  ignored_alert: "Ignoré una alerta",
  acted_on_alert: "Actué en una alerta",
};
const TRIGGER_LABELS: Record<string, string> = {
  manual: "Decisión propia",
  alert: "Alerta del sistema",
  mentor: "Recomendación del mentor",
  fomo: "FOMO (miedo a perderme algo)",
  panic: "Pánico / estrés",
  research: "Investigación propia",
};
const SEVERITY_COLOR: Record<string, string> = {
  alto: "#ef4444",
  medio: "#f59e0b",
  bajo: "#22c55e",
};

interface Props {
  isPremium: boolean;
  onUpgrade: () => void;
}

export default function DiarioDecisionesCard({ isPremium, onUpgrade }: Props) {
  const [tab, setTab]             = useState<"diary" | "biases">("diary");
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [biases, setBiases]       = useState<BiasReport | null>(null);
  const [loadingD, setLoadingD]   = useState(false);
  const [loadingB, setLoadingB]   = useState(false);
  const [logOpen, setLogOpen]     = useState(false);
  const [form, setForm]           = useState({ action: "buy", ticker: "", trigger: "manual", notes: "" });
  const [saving, setSaving]       = useState(false);

  const fetchDecisions = async () => {
    setLoadingD(true);
    try {
      const res = await decisionsApi.getAll(50);
      setDecisions(res.data.decisions || []);
    } catch {} finally { setLoadingD(false); }
  };

  const fetchBiases = async () => {
    setLoadingB(true);
    try {
      const res = await decisionsApi.getBiases();
      setBiases(res.data);
    } catch {} finally { setLoadingB(false); }
  };

  useEffect(() => {
    if (isPremium) { fetchDecisions(); fetchBiases(); }
  }, [isPremium]);

  const handleLog = async () => {
    if (!form.ticker.trim() || !form.action) return;
    setSaving(true);
    try {
      await decisionsApi.log({ ...form, ticker: form.ticker.toUpperCase() });
      setForm({ action: "buy", ticker: "", trigger: "manual", notes: "" });
      setLogOpen(false);
      fetchDecisions();
      setBiases(null);
    } catch {} finally { setSaving(false); }
  };

  const actionIcon = (action: string) =>
    action === "buy"  ? <TrendingUp  className="w-3.5 h-3.5" style={{ color: "#22c55e" }} />
    : action === "sell" ? <TrendingDown className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />
    : <CheckCircle className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />;

  if (!isPremium) {
    return (
      <PremiumToolLocked
        title="Diario de Sesgos"
        tagline="Descubre qué sesgos te están costando dinero"
        description="Registra cada decisión de inversión y la IA detecta tus sesgos conductuales con el tiempo — el único feature que te hace mejor inversor."
        icon={Brain}
        color="#a78bfa"
        benefits={[
          { icon: "📔", text: "Diario de cada decisión de compra/venta" },
          { icon: "🧠", text: "Detección de FOMO, pánico y otros sesgos" },
          { icon: "📊", text: "Score de calidad como inversor sobre 100" },
          { icon: "🎯", text: "Reto semanal personalizado de tu mentor" },
        ]}
        onUnlock={onUpgrade}
      />
    );
  }

  return (
    <>
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "rgba(167,139,250,0.3)", background: "var(--card)" }}>
        <div className="h-1" style={{ background: "linear-gradient(90deg,#a78bfa,#7c3aed)" }} />
        <div className="p-5 space-y-4">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(167,139,250,0.15)" }}>
                <BookOpen className="w-4 h-4" style={{ color: "#a78bfa" }} />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: "var(--text)" }}>Diario de Sesgos</p>
                <p className="text-[10px]" style={{ color: "var(--muted)" }}>Registra tus movimientos y descubre tus sesgos</p>
              </div>
            </div>
            <button
              onClick={() => setLogOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white"
              style={{ background: "linear-gradient(90deg,#a78bfa,#7c3aed)" }}
            >
              <Plus className="w-3.5 h-3.5" /> Registrar
            </button>
          </div>

          {/* Tabs */}
          <div className="flex rounded-xl p-1" style={{ background: "var(--raised)" }}>
            {(["diary", "biases"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                      className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all"
                      style={{
                        background: tab === t ? "var(--card)" : "transparent",
                        color:      tab === t ? "var(--text)" : "var(--muted)",
                      }}>
                {t === "diary" ? "📔 Diario" : "🧠 Análisis de sesgos"}
              </button>
            ))}
          </div>

          {/* DIARY TAB */}
          {tab === "diary" && (
            <div className="space-y-2">
              {loadingD ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#a78bfa" }} />
                </div>
              ) : decisions.length === 0 ? (
                <div className="text-center py-8">
                  <BookOpen className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--muted)", opacity: 0.4 }} />
                  <p className="text-sm" style={{ color: "var(--muted)" }}>Sin decisiones registradas aún.</p>
                  <p className="text-xs mt-1" style={{ color: "var(--dim)" }}>Empieza registrando tu primera decisión.</p>
                </div>
              ) : (
                decisions.map((d, i) => (
                  <div key={d.id ?? i} className="flex items-start gap-3 p-3 rounded-xl border"
                       style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                    <div className="mt-0.5">{actionIcon(d.action)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-bold text-sm" style={{ color: "var(--text)" }}>{d.ticker}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                              style={{ background: "var(--card)", color: "var(--muted)" }}>
                          {ACTION_LABELS[d.action] ?? d.action}
                        </span>
                      </div>
                      {d.trigger && (
                        <p className="text-[10px]" style={{ color: "var(--muted)" }}>
                          Trigger: {TRIGGER_LABELS[d.trigger] ?? d.trigger}
                        </p>
                      )}
                      {d.notes && (
                        <p className="text-[11px] mt-1" style={{ color: "var(--sub)" }}>{d.notes}</p>
                      )}
                    </div>
                    <p className="text-[10px] shrink-0" style={{ color: "var(--dim)" }}>
                      {d.created_at ? new Date(d.created_at).toLocaleDateString("es-MX") : ""}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}

          {/* BIASES TAB */}
          {tab === "biases" && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <button onClick={fetchBiases} disabled={loadingB}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs"
                        style={{ borderColor: "var(--border)", color: "var(--sub)" }}>
                  <RefreshCw className={`w-3 h-3 ${loadingB ? "animate-spin" : ""}`} /> Analizar
                </button>
              </div>

              {loadingB ? (
                <div className="flex flex-col items-center py-8 gap-3">
                  <Loader2 className="w-7 h-7 animate-spin" style={{ color: "#a78bfa" }} />
                  <p className="text-sm" style={{ color: "var(--muted)" }}>Analizando tus patrones con IA...</p>
                </div>
              ) : !biases ? null : biases.message ? (
                <div className="text-center py-8">
                  <AlertTriangle className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--muted)", opacity: 0.5 }} />
                  <p className="text-sm" style={{ color: "var(--muted)" }}>{biases.message}</p>
                </div>
              ) : (
                <>
                  {/* Score */}
                  <div className="p-4 rounded-xl border text-center"
                       style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                    <p className="text-[10px] font-bold mb-1" style={{ color: "var(--muted)" }}>PERFIL REAL COMO INVERSOR</p>
                    <div className="text-4xl font-black mb-1" style={{ color: "#a78bfa" }}>
                      {biases.overall_score ?? 0}<span className="text-lg">/100</span>
                    </div>
                    <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{biases.overall_label}</p>
                    <p className="text-[10px] mt-1" style={{ color: "var(--muted)" }}>
                      Basado en {biases.total_decisions} decisiones · {biases.analysis_period}
                    </p>
                  </div>

                  {/* Biases detected */}
                  {biases.biases_detected && biases.biases_detected.length > 0 && (
                    <div>
                      <p className="text-xs font-bold mb-2" style={{ color: "var(--muted)" }}>SESGOS DETECTADOS</p>
                      <div className="space-y-3">
                        {biases.biases_detected.map((bias) => (
                          <div key={bias.name} className="p-4 rounded-xl border"
                               style={{ borderColor: `${SEVERITY_COLOR[bias.severity]}30`,
                                        background: `${SEVERITY_COLOR[bias.severity]}08` }}>
                            <div className="flex items-center justify-between mb-2">
                              <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{bias.name}</p>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                                    style={{ background: `${SEVERITY_COLOR[bias.severity]}20`,
                                             color: SEVERITY_COLOR[bias.severity] }}>
                                {bias.severity.toUpperCase()}
                              </span>
                            </div>
                            <p className="text-xs mb-2" style={{ color: "var(--sub)" }}>{bias.description}</p>
                            <div className="grid grid-cols-2 gap-2 mb-2">
                              <div className="p-2 rounded-lg" style={{ background: "var(--raised)" }}>
                                <p className="text-[10px] font-bold mb-0.5" style={{ color: "var(--muted)" }}>Ocurrencias</p>
                                <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{bias.occurrences}x</p>
                              </div>
                              <div className="p-2 rounded-lg" style={{ background: "var(--raised)" }}>
                                <p className="text-[10px] font-bold mb-0.5" style={{ color: "var(--muted)" }}>Costo estimado</p>
                                <p className="text-xs font-bold" style={{ color: "#ef4444" }}>{bias.cost_estimate}</p>
                              </div>
                            </div>
                            <div className="p-2 rounded-lg mb-2" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
                              <p className="text-[10px] font-bold mb-0.5" style={{ color: "#ef4444" }}>Ejemplo real</p>
                              <p className="text-[10px]" style={{ color: "var(--sub)" }}>{bias.example}</p>
                            </div>
                            <div className="p-2 rounded-lg" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)" }}>
                              <p className="text-[10px] font-bold mb-0.5" style={{ color: "#22c55e" }}>Cómo mejorar</p>
                              <p className="text-[10px]" style={{ color: "var(--sub)" }}>{bias.fix}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Strengths */}
                  {biases.strengths && biases.strengths.length > 0 && (
                    <div>
                      <p className="text-xs font-bold mb-2" style={{ color: "var(--muted)" }}>TUS FORTALEZAS</p>
                      <div className="space-y-2">
                        {biases.strengths.map((s) => (
                          <div key={s.name} className="flex items-start gap-2 p-3 rounded-xl border"
                               style={{ borderColor: "rgba(34,197,94,0.2)", background: "rgba(34,197,94,0.05)" }}>
                            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#22c55e" }} />
                            <div>
                              <p className="text-xs font-bold" style={{ color: "var(--text)" }}>{s.name}</p>
                              <p className="text-[10px]" style={{ color: "var(--sub)" }}>{s.description}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Mentor assessment */}
                  {biases.mentor_assessment && (
                    <div className="p-4 rounded-xl border"
                         style={{ borderColor: "rgba(167,139,250,0.3)", background: "rgba(167,139,250,0.06)" }}>
                      <p className="text-[10px] font-bold mb-1.5" style={{ color: "#a78bfa" }}>🎓 EVALUACIÓN DE TU MENTOR</p>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{biases.mentor_assessment}</p>
                    </div>
                  )}

                  {/* Next challenge */}
                  {biases.next_challenge && (
                    <div className="p-4 rounded-xl border"
                         style={{ borderColor: "rgba(167,139,250,0.3)", background: "rgba(167,139,250,0.06)" }}>
                      <p className="text-[10px] font-bold mb-1.5" style={{ color: "#a78bfa" }}>🎯 RETO DE LA SEMANA</p>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{biases.next_challenge}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Log decision modal */}
      {logOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-sm rounded-2xl border"
               style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="h-1" style={{ background: "linear-gradient(90deg,#a78bfa,#7c3aed)" }} />
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="font-bold text-sm" style={{ color: "var(--text)" }}>Registrar decisión</p>
                <button onClick={() => setLogOpen(false)} style={{ color: "var(--muted)" }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--muted)" }}>Acción</label>
                  <select className="w-full rounded-lg border px-2 py-1.5 text-xs"
                          style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                          value={form.action}
                          onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}>
                    {ACTION_OPTIONS.map((a) => (
                      <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--muted)" }}>Ticker</label>
                  <input type="text" placeholder="Ej: AAPL"
                         className="w-full rounded-lg border px-2 py-1.5 text-xs uppercase"
                         style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                         value={form.ticker}
                         onChange={(e) => setForm((f) => ({ ...f, ticker: e.target.value.toUpperCase() }))} />
                </div>
                <div>
                  <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--muted)" }}>¿Por qué lo hice?</label>
                  <select className="w-full rounded-lg border px-2 py-1.5 text-xs"
                          style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                          value={form.trigger}
                          onChange={(e) => setForm((f) => ({ ...f, trigger: e.target.value }))}>
                    {TRIGGER_OPTIONS.map((t) => (
                      <option key={t} value={t}>{TRIGGER_LABELS[t] ?? t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--muted)" }}>Notas (opcional)</label>
                  <textarea rows={2} placeholder="¿Qué pensabas en ese momento?"
                            className="w-full rounded-lg border px-2 py-1.5 text-xs resize-none"
                            style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                            value={form.notes}
                            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
                </div>
                <button onClick={handleLog} disabled={saving || !form.ticker.trim()}
                        className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60"
                        style={{ background: "linear-gradient(90deg,#a78bfa,#7c3aed)" }}>
                  {saving ? "Guardando..." : "Guardar decisión"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
