"use client";

import { useEffect, useState, useCallback } from "react";
import { Search, RefreshCw, Loader2, TrendingUp, TrendingDown, Star, Lock } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import PaywallModal from "@/components/PaywallModal";
import { screenerApi } from "@/lib/api";
import { useSubscriptionStore } from "@/lib/store";

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
  picks?: Pick[];
  mentor_note?: string;
  generated_at?: string;
}

export default function ScreenerPage() {
  const sub          = useSubscriptionStore();
  const isPremium    = sub.tier === "premium";
  const [weekly, setWeekly]         = useState<WeeklyData | null>(null);
  const [loading, setLoading]       = useState(false);
  const [paywallOpen, setPaywall]   = useState(false);
  const [paywallReason, setPaywallReason] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const loadWeekly = useCallback(async () => {
    if (!isPremium) return;
    setLoading(true);
    try {
      const res = await screenerApi.getWeekly([]);
      setWeekly(res.data);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [isPremium]);

  useEffect(() => { loadWeekly(); }, [loadWeekly]);

  const handleUpgrade = (reason: string) => {
    setPaywallReason(reason);
    setPaywall(true);
  };

  return (
    <div className="flex h-screen" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "var(--text)" }}>
                <Search className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
                Screener Semanal
              </h1>
              <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                5 oportunidades personalizadas para ti — actualizadas cada lunes
              </p>
            </div>
            {isPremium && (
              <button onClick={loadWeekly} disabled={loading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium"
                      style={{ borderColor: "var(--border)", color: "var(--sub)" }}>
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                Actualizar
              </button>
            )}
          </div>

          {/* Paywall gate */}
          {!isPremium && (
            <div className="rounded-2xl border p-8 text-center"
                 style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
                   style={{ background: "rgba(0,168,94,0.1)" }}>
                <Lock className="w-7 h-7" style={{ color: "var(--accent-l)" }} />
              </div>
              <h2 className="font-bold text-base mb-2" style={{ color: "var(--text)" }}>
                Screener Semanal Personalizado
              </h2>
              <p className="text-sm mb-5 max-w-sm mx-auto" style={{ color: "var(--muted)" }}>
                Cada lunes la IA analiza el mercado y selecciona 5 oportunidades que encajan exactamente con tu perfil de riesgo y filosofía de inversión.
              </p>
              <button onClick={() => handleUpgrade("Activa Premium para recibir tu screener semanal personalizado.")}
                      className="px-6 py-2.5 rounded-xl text-sm font-bold text-white"
                      style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
                Activar Premium
              </button>
            </div>
          )}

          {/* Loading */}
          {isPremium && loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent-l)" }} />
              <p className="text-sm" style={{ color: "var(--muted)" }}>Analizando el mercado para ti...</p>
            </div>
          )}

          {/* Weekly content */}
          {isPremium && !loading && weekly && (
            <>
              {/* Week theme */}
              {weekly.week_theme && (
                <div className="p-4 rounded-xl border"
                     style={{ borderColor: "rgba(0,168,94,0.3)", background: "rgba(0,168,94,0.06)" }}>
                  <p className="text-[10px] font-bold mb-1" style={{ color: "var(--accent-l)" }}>🗓 TEMA DE LA SEMANA</p>
                  <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{weekly.week_theme}</p>
                  {weekly.generated_at && (
                    <p className="text-[10px] mt-1" style={{ color: "var(--muted)" }}>
                      Actualizado: {new Date(weekly.generated_at).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}
                    </p>
                  )}
                </div>
              )}

              {/* Picks */}
              <div className="space-y-3">
                {(weekly.picks ?? []).map((pick, i) => (
                  <div key={pick.ticker} className="rounded-xl border p-4"
                       style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                    <div className="flex items-start gap-3">
                      {/* Rank */}
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                           style={{ background: i === 0 ? "rgba(251,191,36,0.15)" : "var(--raised)",
                                    color: i === 0 ? "#fbbf24" : "var(--muted)" }}>
                        {i === 0 ? <Star className="w-3.5 h-3.5" /> : `${i + 1}`}
                      </div>

                      <div className="flex-1 min-w-0">
                        {/* Ticker + price */}
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div>
                            <span className="font-bold text-sm" style={{ color: "var(--text)" }}>{pick.ticker}</span>
                            <span className="text-xs ml-2" style={{ color: "var(--muted)" }}>{pick.name}</span>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-bold" style={{ color: "var(--text)" }}>
                              ${pick.price?.toFixed(2) ?? "—"}
                            </p>
                            <p className="text-[10px] flex items-center gap-0.5 justify-end"
                               style={{ color: (pick.change_pct ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>
                              {(pick.change_pct ?? 0) >= 0
                                ? <TrendingUp className="w-2.5 h-2.5" />
                                : <TrendingDown className="w-2.5 h-2.5" />}
                              {(pick.change_pct ?? 0) >= 0 ? "+" : ""}{pick.change_pct?.toFixed(2) ?? 0}%
                            </p>
                          </div>
                        </div>

                        {/* Sector + score */}
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                                style={{ background: "var(--raised)", color: "var(--muted)" }}>
                            {pick.sector}
                          </span>
                          <div className="flex items-center gap-1">
                            <div className="h-1.5 rounded-full w-16 overflow-hidden" style={{ background: "var(--border)" }}>
                              <div className="h-full rounded-full"
                                   style={{ width: `${pick.score}%`, background: "var(--accent-l)" }} />
                            </div>
                            <span className="text-[10px] font-medium" style={{ color: "var(--accent-l)" }}>
                              {pick.score}/100
                            </span>
                          </div>
                        </div>

                        {/* Why */}
                        <p className="text-xs leading-relaxed mb-2" style={{ color: "var(--sub)" }}>{pick.why}</p>

                        {/* Catalyst + Risk */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="p-2 rounded-lg" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)" }}>
                            <p className="text-[10px] font-bold mb-0.5" style={{ color: "#22c55e" }}>⚡ Catalizador</p>
                            <p className="text-[10px]" style={{ color: "var(--sub)" }}>{pick.catalyst}</p>
                          </div>
                          <div className="p-2 rounded-lg" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
                            <p className="text-[10px] font-bold mb-0.5" style={{ color: "#ef4444" }}>⚠️ Riesgo</p>
                            <p className="text-[10px]" style={{ color: "var(--sub)" }}>{pick.risk}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Mentor note */}
              {weekly.mentor_note && (
                <div className="p-4 rounded-xl border"
                     style={{ borderColor: "rgba(0,168,94,0.3)", background: "rgba(0,168,94,0.06)" }}>
                  <p className="text-[10px] font-bold mb-1.5" style={{ color: "var(--accent-l)" }}>🎓 NOTA DE TU MENTOR</p>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{weekly.mentor_note}</p>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <PaywallModal visible={paywallOpen} onClose={() => setPaywall(false)} reason={paywallReason} />
    </div>
  );
}
