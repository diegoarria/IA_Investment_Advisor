"use client";

import { useEffect, useState, useCallback } from "react";
import { Search, TrendingUp, TrendingDown, Loader2, RefreshCw, ChevronDown, ChevronUp, Zap, AlertTriangle, Info } from "lucide-react";
import PremiumToolLocked from "@/components/PremiumToolLocked";
import { screenerApi } from "@/lib/api";

interface Pick {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  change_pct: number;
  score: number;
  why: string;
  catalyst: string;
  risk: string;
}

interface WeeklyData {
  week_theme?: string;
  business_profile?: string;
  picks?: Pick[];
  mentor_note?: string;
  disclaimer?: string;
}

interface Props {
  isPremium: boolean;
  onUpgrade: () => void;
  tickers?: string[];
}

export default function WeeklyScreenerCard({ isPremium, onUpgrade, tickers = [] }: Props) {
  const [data, setData]         = useState<WeeklyData | null>(null);
  const [loading, setLoading]   = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isPremium) return;
    setLoading(true);
    try {
      const res = await screenerApi.getWeekly(tickers);
      setData(res.data);
    } catch {
    } finally { setLoading(false); }
  }, [isPremium, tickers.join(",")]);

  useEffect(() => { load(); }, [load]);

  if (!isPremium) {
    return (
      <PremiumToolLocked
        title="Screener Semanal"
        tagline="5 sugerencias personalizadas según tu perfil"
        description="La IA analiza el mercado y sugiere 5 ideas que encajan con el tipo de negocio que buscas, tu mentor y tu perfil de riesgo. Son sugerencias para explorar, no recomendaciones de compra."
        icon={Search}
        color="#8b5cf6"
        benefits={[
          { icon: "🎯", text: "Tipo de negocio adaptado a tu mentor y perfil" },
          { icon: "⚡", text: "Catalizador concreto y riesgo por cada idea" },
          { icon: "🚫", text: "Nunca sugiere lo que ya tienes" },
          { icon: "📚", text: "Sugerencias educativas para investigar más" },
        ]}
        onUnlock={onUpgrade}
      />
    );
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--card)" }}>

      {/* Header */}
      <div className="flex items-start gap-2 p-4 border-b" style={{ borderColor: "var(--border)" }}>
        <Search className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--accent-l)" }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm" style={{ color: "var(--text)" }}>Screener Semanal</span>
            {data?.week_theme && (
              <span className="text-[10px] px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(139,92,246,0.12)", color: "#a78bfa" }}>
                {data.week_theme}
              </span>
            )}
          </div>
          {data?.business_profile && (
            <p className="text-[11px] mt-1 leading-snug" style={{ color: "var(--muted)" }}>
              {data.business_profile}
            </p>
          )}
        </div>
        <button onClick={load} disabled={loading} className="p-1 rounded-lg hover:bg-white/5 shrink-0">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} style={{ color: "var(--muted)" }} />
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 p-4">
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--accent-l)" }} />
          <span className="text-xs" style={{ color: "var(--muted)" }}>Analizando el mercado según tu perfil...</span>
        </div>
      )}

      {/* Picks */}
      {!loading && data?.picks && (
        <div className="divide-y" style={{ borderColor: "var(--border)" }}>
          {data.picks.slice(0, 5).map((pick, i) => {
            const isOpen = expanded === pick.ticker;
            const up = (pick.change_pct ?? 0) >= 0;
            return (
              <div key={pick.ticker}>
                {/* Row */}
                <button
                  className="w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-white/[0.02] transition-colors"
                  onClick={() => setExpanded(isOpen ? null : pick.ticker)}
                >
                  <span className="text-xs font-black w-4 text-center shrink-0" style={{ color: "var(--dim)" }}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm" style={{ color: "var(--text)" }}>{pick.ticker}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--raised)", color: "var(--muted)" }}>{pick.sector}</span>
                    </div>
                    <p className={`text-[11px] mt-0.5 leading-snug ${isOpen ? "" : "truncate"}`} style={{ color: "var(--sub)" }}>
                      {pick.why}
                    </p>
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
                    <p className="text-sm font-bold" style={{ color: "var(--text)" }}>
                      {pick.price != null ? `$${pick.price.toFixed(2)}` : "—"}
                    </p>
                    <p className="text-[10px] flex items-center gap-0.5" style={{ color: up ? "#22c55e" : "#ef4444" }}>
                      {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                      {up ? "+" : ""}{pick.change_pct?.toFixed(1) ?? 0}%
                    </p>
                  </div>
                  <span className="shrink-0 ml-1" style={{ color: "var(--dim)" }}>
                    {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </span>
                </button>

                {/* Expanded detail */}
                {isOpen && (
                  <div className="px-4 pb-3 space-y-2" style={{ borderTop: "1px solid var(--border)", background: "var(--raised)" }}>
                    {pick.catalyst && (
                      <div className="flex items-start gap-2 pt-2">
                        <Zap className="w-3 h-3 mt-0.5 shrink-0" style={{ color: "#f59e0b" }} />
                        <div>
                          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "#f59e0b" }}>Catalizador</span>
                          <p className="text-[11px] leading-snug mt-0.5" style={{ color: "var(--sub)" }}>{pick.catalyst}</p>
                        </div>
                      </div>
                    )}
                    {pick.risk && (
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" style={{ color: "#ef4444" }} />
                        <div>
                          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "#ef4444" }}>Riesgo principal</span>
                          <p className="text-[11px] leading-snug mt-0.5" style={{ color: "var(--sub)" }}>{pick.risk}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Mentor note */}
      {!loading && data?.mentor_note && (
        <div className="px-4 py-3 border-t" style={{ borderColor: "var(--border)", background: "rgba(139,92,246,0.04)" }}>
          <p className="text-[11px] leading-relaxed italic" style={{ color: "var(--muted)" }}>
            "{data.mentor_note}"
          </p>
        </div>
      )}

      {/* Disclaimer */}
      {!loading && data && (
        <div className="flex items-start gap-2 px-4 py-3 border-t" style={{ borderColor: "var(--border)" }}>
          <Info className="w-3 h-3 mt-0.5 shrink-0" style={{ color: "var(--dim)" }} />
          <p className="text-[10px] leading-relaxed" style={{ color: "var(--dim)" }}>
            {data.disclaimer ?? "Estas son sugerencias educativas basadas en tu perfil. No son asesoramiento financiero ni recomendaciones de compra. Siempre investiga antes de invertir."}
          </p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !data && (
        <div className="p-4">
          <span className="text-xs" style={{ color: "var(--muted)" }}>No hay sugerencias disponibles aún.</span>
        </div>
      )}
    </div>
  );
}
