"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Loader2, Radio, Calendar, ChevronRight, ShieldCheck, Info, CloudOff } from "lucide-react";
import Link from "next/link";
import StockAvatar from "@/components/StockAvatar";
import WeeklyScreenerCard from "@/components/WeeklyScreenerCard";
import posthog from "posthog-js";
import AppSidebar from "@/components/AppSidebar";
import PaywallModal from "@/components/PaywallModal";
import { screenerApi } from "@/lib/api";
import { useSubscriptionStore, useProfileStore, hasPremiumAccess } from "@/lib/store";
import { getUserLevel, isAtLeast } from "@/lib/userLevel";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useWeeklyOpportunities } from "@/lib/useWeeklyOpportunities";
import type { WeeklyOpportunity } from "@/components/WeeklyOpportunityCard";

interface UndervaluedResponse {
  is_premium: boolean;
  results?: WeeklyOpportunity[];
  generated_at?: number;
  teaser_count?: number;
}

// Diego, 2026-09-24: "el único" Screener Semanal — real, DCF-backed,
// per-user picks (same engine + same 5 tickers as the Sunday push,
// GET /screener/weekly-opportunities), not an AI narrative. This
// response has no `results`/`generated_at` timestamp shape difference
// from UndervaluedResponse above (generated_at is an ISO string here,
// a unix timestamp there) — kept as its own type instead of reusing
// UndervaluedResponse so that difference stays explicit.
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

// Redesigned 2026-09-27 to match mobile's Screener Semanal screen exactly
// (Diego: "igualito para web app, sin ninguna diferencia") — Nuvos Radar
// hero, summary stats, one large card per pick, non-advisory note.
const TOOL = "#8b5cf6";
const GREEN = "#00d47e";

function money(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: v < 100 ? 2 : 0, maximumFractionDigits: v < 100 ? 2 : 0 })}`;
}

function PickCard({ pick, rank }: { pick: WeeklyOpportunity; rank: number }) {
  const { t } = useTranslation();
  const mos = pick.margin_of_safety_pct;
  const price = pick.price;
  const base = pick.intrinsic_value_base;
  const fill = price != null && base ? Math.max(0.06, Math.min(1, price / base)) : null;
  const bq = pick.thesis_scores?.business_quality;
  const scenarios = [
    { key: "pessimistic", value: pick.intrinsic_value_conservative, color: "#f87171" },
    { key: "base", value: base, color: GREEN },
    { key: "optimistic", value: pick.intrinsic_value_optimistic, color: "#4ade80" },
  ];
  return (
    <Link href={`/stock/${pick.ticker}`} className="block rounded-[20px] border p-4 space-y-3 transition-transform hover:scale-[1.005]"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2.5">
        <div className="w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0" style={{ background: TOOL + "22" }}>
          <span className="text-[11px] font-black" style={{ color: TOOL }}>{rank}</span>
        </div>
        <StockAvatar ticker={pick.ticker} px={42} />
        <div className="flex-1 min-w-0">
          <p className="text-[17px] font-black tracking-tight" style={{ color: "var(--text)" }}>{pick.ticker}</p>
          {pick.company_name && <p className="text-xs truncate mt-px" style={{ color: "var(--muted)" }}>{pick.company_name}</p>}
        </div>
        {mos != null && (
          <div className="flex flex-col items-center rounded-[14px] px-2.5 py-1.5" style={{ background: "rgba(34,197,94,0.14)" }}>
            <span className="text-[15px] font-black" style={{ color: "#22c55e" }}>+{mos.toFixed(0)}%</span>
            <span className="text-[9px] font-bold opacity-85" style={{ color: "#22c55e" }}>{t("screenerWeekly.marginShort")}</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {pick.sector && (
          <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: "var(--raised)", color: "var(--muted)" }}>{pick.sector}</span>
        )}
        {bq != null && (
          <span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: "var(--raised)", color: "var(--muted)" }}>
            <ShieldCheck className="w-3 h-3" />{t("screenerWeekly.quality", { score: bq })}
          </span>
        )}
      </div>

      {fill != null && (
        <div className="space-y-2">
          <div className="flex justify-between items-end">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("screenerWeekly.priceNow")}</p>
              <p className="text-base font-black mt-0.5" style={{ color: "var(--text)" }}>{money(price)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("screenerWeekly.estimatedValue")}</p>
              <p className="text-base font-black mt-0.5" style={{ color: GREEN }}>{money(base)}</p>
            </div>
          </div>
          <div className="h-2 rounded overflow-hidden" style={{ background: GREEN + "22" }}>
            <div className="h-full rounded" style={{ width: `${fill * 100}%`, background: "var(--sub)" }} />
          </div>
        </div>
      )}

      {(pick.intrinsic_value_conservative != null || pick.intrinsic_value_optimistic != null) && (
        <div className="flex gap-2">
          {scenarios.map((sc) => (
            <div key={sc.key} className="flex-1 flex flex-col items-center rounded-xl py-2 px-1"
                 style={sc.key === "base"
                   ? { background: "rgba(0,168,94,0.1)", border: "1px solid rgba(0,168,94,0.3)" }
                   : { background: "var(--raised)" }}>
              <span className="text-[9px] font-black uppercase truncate" style={{ color: sc.color }}>{t(`subvaluadas.scenarios.${sc.key}`)}</span>
              <span className="text-[13px] font-extrabold mt-0.5" style={{ color: sc.key === "base" ? GREEN : "var(--text)" }}>{money(sc.value)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-0.5 pt-2.5 border-t" style={{ borderColor: "var(--border)" }}>
        <span className="text-xs font-extrabold" style={{ color: TOOL }}>{t("screenerWeekly.viewAnalysis")}</span>
        <ChevronRight className="w-3.5 h-3.5" style={{ color: TOOL }} />
      </div>
    </Link>
  );
}

export default function ScreenerPage() {
  const { t, i18n } = useTranslation();
  const ETF_BY_RISK = getEtfByRisk(t);
  const sub          = useSubscriptionStore();
  const isPremiumAccess = hasPremiumAccess(sub);
  const { profile }  = useProfileStore();
  const userLevel    = getUserLevel(profile);
  const [paywallOpen, setPaywall]   = useState(false);
  const [paywallReason, setPaywallReason] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [opportunitiesTeaserCount, setOpportunitiesTeaserCount] = useState<number | null>(null);

  // Diego, 2026-09-27: always this week's 5 — cached per user, retried, and
  // never blanked by a failed/empty answer (see useWeeklyOpportunities).
  // `serverFree`: billing status hadn't loaded yet, so the page assumed
  // Premium, but the backend says Free — show the Free teaser, not an
  // empty Premium list ("Todavía no hay datos del screener semanal").
  const { data: weeklyData, loading: weeklyLoading, serverFree, load: loadWeekly } = useWeeklyOpportunities(isPremiumAccess);
  const isPremium = isPremiumAccess && !serverFree;
  const weekly = weeklyData?.results ?? [];
  const weeklyGeneratedAt = weeklyData?.generated_at ?? null;

  useEffect(() => {
    // Free/guest users still see a REAL, never-hardcoded count of how many
    // candidates exist this week, sourced from the same real DCF universe
    // (not personalized — that's Premium-only) — zero extra AI/API cost.
    if (isPremium) return;
    screenerApi.getUndervalued(undefined, 10)
      .then((res: { data: UndervaluedResponse }) => {
        const count = res.data?.teaser_count ?? 0;
        setOpportunitiesTeaserCount(count);
        posthog.capture("opportunities_teaser_viewed", { count });
      })
      .catch(() => {});
  }, [isPremium]);

  const handleUpgrade = (reason: string) => {
    setPaywallReason(reason);
    setPaywall(true);
  };

  return (
    <div className="flex h-screen" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6 pb-12">
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

          {/* Weekly screener — every level (básico sees it under its ETF block, same as before). */}
          {(() => {
            const picks = weekly.slice(0, 5);
            const margins = picks.map((p) => p.margin_of_safety_pct).filter((m): m is number => m != null);
            const avgMargin = margins.length ? margins.reduce((x, y) => x + y, 0) / margins.length : null;
            const sectors = new Set(picks.map((p) => p.sector).filter(Boolean)).size;
            const weekLabel = weeklyGeneratedAt
              ? new Date(weeklyGeneratedAt).toLocaleDateString(i18n.language === "en" ? "en-US" : "es-MX", { day: "numeric", month: "long" })
              : null;
            return (
              <div className="space-y-3.5">
                {/* Hero */}
                <div className="relative overflow-hidden rounded-3xl p-5 border" style={{ background: TOOL + "14", borderColor: TOOL + "33" }}>
                  <div className="absolute w-[220px] h-[220px] rounded-full -top-[110px] -right-[70px] pointer-events-none" style={{ background: TOOL + "22" }} />
                  <div className="relative">
                    <div className="flex items-start justify-between">
                      <div className="w-11 h-11 rounded-[14px] flex items-center justify-center mb-3.5" style={{ background: TOOL }}>
                        <Radio className="w-[22px] h-[22px] text-white" />
                      </div>
                      {isPremium && (
                        <button onClick={loadWeekly} disabled={weeklyLoading} aria-label={t("screener.header.refresh")}
                                className="w-9 h-9 rounded-full flex items-center justify-center border"
                                style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--sub)" }}>
                          <RefreshCw className={`w-4 h-4 ${weeklyLoading ? "animate-spin" : ""}`} />
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] font-black tracking-[1.4px] mb-1" style={{ color: TOOL }}>NUVOS RADAR</p>
                    <h1 className="text-[22px] font-black tracking-tight leading-[27px]" style={{ color: "var(--text)" }}>{t("screenerWeekly.heroTitle")}</h1>
                    <p className="text-[13px] leading-[19px] mt-1.5" style={{ color: "var(--sub)" }}>{t("screenerWeekly.heroSubtitle")}</p>
                    <div className="flex flex-wrap gap-2 mt-3.5">
                      {weekLabel && (
                        <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 border text-[11px] font-bold" style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--sub)" }}>
                          <Calendar className="w-3 h-3" style={{ color: TOOL }} />{t("screenerWeekly.weekOf", { date: weekLabel })}
                        </span>
                      )}
                      <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 border text-[11px] font-bold" style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--sub)" }}>
                        <RefreshCw className="w-3 h-3" style={{ color: TOOL }} />{t("screenerWeekly.renews")}
                      </span>
                    </div>
                  </div>
                </div>

                {!isPremium ? (
                  // Same locked preview + paywall the Portfolio card uses (mobile parity).
                  <WeeklyScreenerCard
                    isPremium={false}
                    onUpgrade={() => {
                      posthog.capture("opportunities_upgrade_clicked", { count: opportunitiesTeaserCount });
                      handleUpgrade(opportunitiesTeaserCount === null ? t("screener.paywall.reason") : t("screener.paywall.teaser", { count: opportunitiesTeaserCount }));
                    }}
                  />
                ) : picks.length === 0 ? (
                  <div className="rounded-[20px] border p-7 flex flex-col items-center gap-3 text-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                    {weeklyLoading ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" style={{ color: TOOL }} />
                        <p className="text-[13px] leading-[19px]" style={{ color: "var(--muted)" }}>{t("screenerWeekly.loading")}</p>
                      </>
                    ) : (
                      <>
                        <CloudOff className="w-6 h-6" style={{ color: "var(--muted)" }} />
                        <p className="text-[13px] leading-[19px]" style={{ color: "var(--muted)" }}>{t("weeklyScreenerCard.loadError")}</p>
                        <button onClick={loadWeekly} className="flex items-center gap-1.5 rounded-[14px] px-4 py-2.5 text-[13px] font-extrabold text-white" style={{ background: TOOL }}>
                          <RefreshCw className="w-3.5 h-3.5" />{t("weeklyScreenerCard.retry")}
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2.5">
                      {[
                        { value: String(picks.length), label: t("screenerWeekly.statCompanies"), color: "var(--text)" },
                        { value: avgMargin != null ? `+${avgMargin.toFixed(0)}%` : "—", label: t("screenerWeekly.statAvgMargin"), color: GREEN },
                        { value: sectors ? String(sectors) : "—", label: t("screenerWeekly.statSectors"), color: "var(--text)" },
                      ].map((st) => (
                        <div key={st.label} className="flex-1 rounded-2xl border py-3 flex flex-col items-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                          <span className="text-xl font-black" style={{ color: st.color }}>{st.value}</span>
                          <span className="text-[10px] font-bold mt-0.5 text-center" style={{ color: "var(--muted)" }}>{st.label}</span>
                        </div>
                      ))}
                    </div>

                    <p className="text-xs font-black tracking-wide uppercase pt-1" style={{ color: "var(--muted)" }}>{t("screenerWeekly.listTitle")}</p>
                    {picks.map((pick, i) => <PickCard key={pick.ticker} pick={pick} rank={i + 1} />)}

                    <div className="flex gap-2 px-1 pt-1">
                      <Info className="w-[15px] h-[15px] shrink-0 mt-px" style={{ color: "var(--muted)" }} />
                      <p className="text-[11px] leading-4" style={{ color: "var(--muted)" }}>{t("weeklyScreenerCard.defaultDisclaimer")}</p>
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </div>
      </main>

      <PaywallModal visible={paywallOpen} onClose={() => setPaywall(false)} reason={paywallReason} />
    </div>
  );
}
