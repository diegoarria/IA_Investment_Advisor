"use client";

import { useEffect, useState, useCallback } from "react";
import { Search, RefreshCw, Loader2, TrendingUp, TrendingDown, Star, Lock } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import PaywallModal from "@/components/PaywallModal";
import { screenerApi } from "@/lib/api";
import { useSubscriptionStore, useProfileStore } from "@/lib/store";
import { getUserLevel, isAtLeast } from "@/lib/userLevel";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

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

interface UndervaluedResult {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  intrinsic_value_base: number | null;
  margin_of_safety_pct: number | null;
  thesis_scores: Record<string, number> | null;
}

function getEtfByRisk(t: TFunction): Record<string, { ticker: string; name: string; desc: string; color: string }[]> {
  return {
    conservative: [
      { ticker: "BND",  name: "Vanguard Total Bond Market", desc: t("screener.etf.descriptions.conservative.bnd"), color: "#3b82f6" },
      { ticker: "VTI",  name: "Vanguard Total Stock Market", desc: t("screener.etf.descriptions.conservative.vti"), color: "#00a85e" },
      { ticker: "BNDX", name: "Vanguard Total Intl Bond",    desc: t("screener.etf.descriptions.conservative.bndx"), color: "#6366f1" },
    ],
    moderate: [
      { ticker: "VTI",  name: "Vanguard Total Stock Market", desc: t("screener.etf.descriptions.moderate.vti"), color: "#00a85e" },
      { ticker: "VXUS", name: "Vanguard Total Intl Stock",   desc: t("screener.etf.descriptions.moderate.vxus"), color: "#f59e0b" },
      { ticker: "BND",  name: "Vanguard Total Bond Market",  desc: t("screener.etf.descriptions.moderate.bnd"), color: "#3b82f6" },
    ],
    aggressive: [
      { ticker: "QQQ",  name: "Invesco Nasdaq-100",          desc: t("screener.etf.descriptions.aggressive.qqq"), color: "#8b5cf6" },
      { ticker: "VTI",  name: "Vanguard Total Stock Market", desc: t("screener.etf.descriptions.aggressive.vti"), color: "#00a85e" },
      { ticker: "VWO",  name: "Vanguard Emerging Markets",   desc: t("screener.etf.descriptions.aggressive.vwo"), color: "#f59e0b" },
    ],
  };
}

export default function ScreenerPage() {
  const { t } = useTranslation();
  const ETF_BY_RISK = getEtfByRisk(t);
  const sub          = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;
  const { profile }  = useProfileStore();
  const userLevel    = getUserLevel(profile);
  const [weekly, setWeekly]         = useState<WeeklyData | null>(null);
  const [loading, setLoading]       = useState(false);
  const [paywallOpen, setPaywall]   = useState(false);
  const [paywallReason, setPaywallReason] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [undervalued, setUndervalued] = useState<UndervaluedResult[]>([]);
  const [undervaluedGeneratedAt, setUndervaluedGeneratedAt] = useState<number>(0);
  const [undervaluedLoading, setUndervaluedLoading] = useState(false);

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

  useEffect(() => {
    if (!isPremium) return;
    setUndervaluedLoading(true);
    screenerApi.getUndervalued(undefined, 10)
      .then((res) => {
        setUndervalued(res.data?.results || []);
        setUndervaluedGeneratedAt(res.data?.generated_at || 0);
      })
      .catch(() => setUndervalued([]))
      .finally(() => setUndervaluedLoading(false));
  }, [isPremium]);

  const handleUpgrade = (reason: string) => {
    setPaywallReason(reason);
    setPaywall(true);
  };

  return (
    <div className="flex h-screen" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
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
                  <h1 className="text-xl font-bold" style={{ color: "var(--text)" }}>{t("screener.etf.title")}</h1>
                  <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                    {t("screener.etf.subtitle")}
                  </p>
                </div>
                <div className="rounded-xl border px-4 py-3 flex items-start gap-3"
                     style={{ background: "rgba(0,168,94,0.06)", borderColor: "rgba(0,168,94,0.25)" }}>
                  <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: "var(--accent-l)" }} />
                  <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>
                    {t("screener.etf.explainer")}
                  </p>
                </div>
                <div className="space-y-3">
                  {etfs.map((etf: { ticker: string; name: string; desc: string; color: string }) => (
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
                  {t("screener.etf.lockedNotice")}
                </p>
              </div>
            );
          })()}

          {/* Header — only shown for intermedio+ */}
          {isAtLeast(userLevel, "intermedio") && <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "var(--text)" }}>
                <Search className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
                {t("screener.header.title")}
              </h1>
              <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                {t("screener.header.subtitle")}
              </p>
            </div>
            {isPremium && (
              <button onClick={loadWeekly} disabled={loading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium"
                      style={{ borderColor: "var(--border)", color: "var(--sub)" }}>
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                {t("screener.header.refresh")}
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
              <h2 className="font-bold text-base mb-2" style={{ color: "var(--text)" }}>{t("screener.paywall.title")}</h2>
              <p className="text-sm mb-5 max-w-sm mx-auto" style={{ color: "var(--muted)" }}>
                {t("screener.paywall.desc")}
              </p>
              <button onClick={() => handleUpgrade(t("screener.paywall.reason"))}
                      className="px-6 py-2.5 rounded-xl text-sm font-bold text-white"
                      style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
                {t("screener.paywall.cta")}
              </button>
            </div>
          )}


          {/* Loading */}
          {isPremium && loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent-l)" }} />
              <p className="text-sm" style={{ color: "var(--muted)" }}>{t("screener.loading")}</p>
            </div>
          )}

          {/* Weekly content */}
          {isPremium && !loading && weekly && (
            <>
              {/* Week theme */}
              {weekly.week_theme && (
                <div className="p-4 rounded-xl border"
                     style={{ borderColor: "rgba(0,168,94,0.3)", background: "rgba(0,168,94,0.06)" }}>
                  <p className="text-[10px] font-bold mb-1" style={{ color: "var(--accent-l)" }}>{t("screener.weekTheme.label")}</p>
                  <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{weekly.week_theme}</p>
                  {weekly.generated_at && (
                    <p className="text-[10px] mt-1" style={{ color: "var(--muted)" }}>
                      {t("screener.weekTheme.updated", { date: new Date(weekly.generated_at).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" }) })}
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
                            <p className="text-[10px] font-bold mb-0.5" style={{ color: "#22c55e" }}>{t("screener.pick.catalyst")}</p>
                            <p className="text-[10px]" style={{ color: "var(--sub)" }}>{pick.catalyst}</p>
                          </div>
                          <div className="p-2 rounded-lg" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
                            <p className="text-[10px] font-bold mb-0.5" style={{ color: "#ef4444" }}>{t("screener.pick.risk")}</p>
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
                  <p className="text-[10px] font-bold mb-1.5" style={{ color: "var(--accent-l)" }}>{t("screener.mentorNote.label")}</p>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{weekly.mentor_note}</p>
                </div>
              )}
            </>
          )}

          {/* Undervalued screener — real DCF-backed candidates, refreshed weekly */}
          {isPremium && (
            <div className="pt-2">
              <h2 className="text-sm font-bold mb-0.5" style={{ color: "var(--text)" }}>Acciones subvaluadas (DCF)</h2>
              <p className="text-[11px] mb-3" style={{ color: "var(--muted)" }}>
                Candidatas con margen de seguridad positivo real, del mismo motor de valor intrínseco de Mentor IA.
                {undervaluedGeneratedAt > 0 && (
                  <> Actualizado: {new Date(undervaluedGeneratedAt * 1000).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}.</>
                )}
              </p>
              {undervaluedLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--accent-l)" }} />
                </div>
              ) : undervalued.length === 0 ? (
                <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>Todavía no hay datos del screener semanal — vuelve más tarde.</p>
                </div>
              ) : (
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                  {undervalued.map((u, i) => (
                    <div key={u.ticker} className="px-4 py-3 flex items-center justify-between gap-3"
                         style={{ background: "var(--card)", borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                      <div className="min-w-0">
                        <p className="text-sm font-bold truncate" style={{ color: "var(--text)" }}>
                          {u.ticker} {u.company_name ? `· ${u.company_name}` : ""}
                        </p>
                        <p className="text-[11px]" style={{ color: "var(--dim)" }}>
                          Precio ${u.price} · Valor intrínseco ${u.intrinsic_value_base} · Business Quality {u.thesis_scores?.business_quality ?? "N/D"}/100
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-black px-2 py-1 rounded-lg"
                            style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>
                        +{u.margin_of_safety_pct}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <PaywallModal visible={paywallOpen} onClose={() => setPaywall(false)} reason={paywallReason} />
    </div>
  );
}
