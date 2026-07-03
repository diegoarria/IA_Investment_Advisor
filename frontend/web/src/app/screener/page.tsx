"use client";

import { useEffect, useState, useCallback } from "react";
import { Search, RefreshCw, Loader2, TrendingUp, TrendingDown, Star, Lock } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import PaywallModal from "@/components/PaywallModal";
import { screenerApi } from "@/lib/api";
import { useSubscriptionStore, useProfileStore } from "@/lib/store";
import { getUserLevel, isAtLeast } from "@/lib/userLevel";

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

const ETF_BY_RISK: Record<string, { ticker: string; name: string; desc: string; color: string }[]> = {
  conservative: [
    { ticker: "BND",  name: "Vanguard Total Bond Market", desc: "Bonos de EE.UU. de alta calidad. Muy estable, bajo riesgo.", color: "#3b82f6" },
    { ticker: "VTI",  name: "Vanguard Total Stock Market", desc: "Todo el mercado estadounidense en un solo ETF. La base de cualquier portafolio.", color: "#00a85e" },
    { ticker: "BNDX", name: "Vanguard Total Intl Bond",    desc: "Bonos internacionales para diversificar fuera de EE.UU.", color: "#6366f1" },
  ],
  moderate: [
    { ticker: "VTI",  name: "Vanguard Total Stock Market", desc: "Todo el mercado estadounidense. El ETF más recomendado para principiantes.", color: "#00a85e" },
    { ticker: "VXUS", name: "Vanguard Total Intl Stock",   desc: "Acciones internacionales para equilibrar tu exposición global.", color: "#f59e0b" },
    { ticker: "BND",  name: "Vanguard Total Bond Market",  desc: "Componente de bonos para reducir la volatilidad del portafolio.", color: "#3b82f6" },
  ],
  aggressive: [
    { ticker: "QQQ",  name: "Invesco Nasdaq-100",          desc: "Las 100 empresas más innovadoras del Nasdaq. Alto crecimiento, más volatilidad.", color: "#8b5cf6" },
    { ticker: "VTI",  name: "Vanguard Total Stock Market", desc: "Base sólida del mercado completo americano.", color: "#00a85e" },
    { ticker: "VWO",  name: "Vanguard Emerging Markets",   desc: "Mercados emergentes con alto potencial de crecimiento a largo plazo.", color: "#f59e0b" },
  ],
};

export default function ScreenerPage() {
  const sub          = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;
  const { profile }  = useProfileStore();
  const userLevel    = getUserLevel(profile);
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
          {/* ETF mode for basico */}
          {!isAtLeast(userLevel, "intermedio") && (() => {
            const risk = (profile?.risk_tolerance ?? "moderate") as string;
            const riskKey = risk.startsWith("conservative") ? "conservative" : risk.startsWith("aggressive") ? "aggressive" : "moderate";
            const etfs = ETF_BY_RISK[riskKey] ?? ETF_BY_RISK.moderate;
            return (
              <div className="space-y-4">
                <div>
                  <h1 className="text-xl font-bold" style={{ color: "var(--text)" }}>ETFs para tu perfil</h1>
                  <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                    Los ETFs son la forma más segura y diversificada de empezar a invertir — ideales para tu nivel actual.
                  </p>
                </div>
                <div className="rounded-xl border px-4 py-3 flex items-start gap-3"
                     style={{ background: "rgba(0,168,94,0.06)", borderColor: "rgba(0,168,94,0.25)" }}>
                  <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: "var(--accent-l)" }} />
                  <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>
                    Un ETF te permite comprar una canasta de cientos de empresas con una sola operación — más diversificación, menos riesgo que elegir acciones individuales.
                  </p>
                </div>
                <div className="space-y-3">
                  {etfs.map((etf) => (
                    <div key={etf.ticker} className="rounded-xl border p-4"
                         style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-base font-black px-2.5 py-1 rounded-lg"
                              style={{ background: etf.color + "18", color: etf.color }}>
                          {etf.ticker}
                        </span>
                        <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>{etf.name}</span>
                      </div>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>{etf.desc}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-center" style={{ color: "var(--dim)" }}>
                  El Screener de acciones individuales se desbloquea al alcanzar nivel Intermedio.
                </p>
              </div>
            );
          })()}

          {/* Header — only shown for intermedio+ */}
          {isAtLeast(userLevel, "intermedio") && <div className="flex items-center justify-between">
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
          </div>}

          {/* Paywall gate — all free users */}
          {!isPremium && (
            <div className="rounded-2xl border p-8 text-center"
                 style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
                   style={{ background: "rgba(0,168,94,0.1)" }}>
                <Lock className="w-7 h-7" style={{ color: "var(--accent-l)" }} />
              </div>
              <h2 className="font-bold text-base mb-2" style={{ color: "var(--text)" }}>Screener Semanal Personalizado</h2>
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
                            <p className="text-[10px] font-bold mb-0.5" style={{ color: "#22c55e" }}>Catalizador</p>
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
                  <p className="text-[10px] font-bold mb-1.5" style={{ color: "var(--accent-l)" }}>NOTA DE TU MENTOR</p>
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
