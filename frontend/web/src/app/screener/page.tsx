"use client";

import { useEffect, useState, useCallback } from "react";
import { Search, RefreshCw, Loader2, Lock } from "lucide-react";
import posthog from "posthog-js";
import AppSidebar from "@/components/AppSidebar";
import PaywallModal from "@/components/PaywallModal";
import { screenerApi } from "@/lib/api";
import { useSubscriptionStore, useProfileStore, hasPremiumAccess } from "@/lib/store";
import { getUserLevel, isAtLeast } from "@/lib/userLevel";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import WeeklyOpportunityCard, { type WeeklyOpportunity } from "@/components/WeeklyOpportunityCard";

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
interface WeeklyOpportunitiesResponse {
  is_premium: boolean;
  results?: WeeklyOpportunity[];
  generated_at?: string | null;
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
  const { t, i18n } = useTranslation();
  const ETF_BY_RISK = getEtfByRisk(t);
  const sub          = useSubscriptionStore();
  const isPremium = hasPremiumAccess(sub);
  const { profile }  = useProfileStore();
  const userLevel    = getUserLevel(profile);
  const [paywallOpen, setPaywall]   = useState(false);
  const [paywallReason, setPaywallReason] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [weekly, setWeekly] = useState<WeeklyOpportunity[]>([]);
  const [weeklyGeneratedAt, setWeeklyGeneratedAt] = useState<string | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [opportunitiesTeaserCount, setOpportunitiesTeaserCount] = useState<number | null>(null);

  const loadWeekly = useCallback(async () => {
    if (!isPremium) return;
    setWeeklyLoading(true);
    try {
      const res = await screenerApi.getWeeklyOpportunities(i18n.language);
      const data = res.data as WeeklyOpportunitiesResponse;
      setWeekly(data.results ?? []);
      setWeeklyGeneratedAt(data.generated_at ?? null);
    } catch {
      // Keep whatever was already showing — never wipe a real list on a
      // transient failure.
    } finally {
      setWeeklyLoading(false);
    }
  }, [isPremium, i18n.language]);

  useEffect(() => { loadWeekly(); }, [loadWeekly]);

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
              <button onClick={loadWeekly} disabled={weeklyLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium"
                      style={{ borderColor: "var(--border)", color: "var(--sub)" }}>
                <RefreshCw className={`w-3.5 h-3.5 ${weeklyLoading ? "animate-spin" : ""}`} />
                {t("screener.header.refresh")}
              </button>
            )}
          </div>}

          {/* Paywall gate — all free users. Real, never-hardcoded count
              (§5/§11: "el número debe ser calculado dinámicamente"). */}
          {!isPremium && (
            <div className="rounded-2xl border p-8 text-center"
                 style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
                   style={{ background: "rgba(0,168,94,0.1)" }}>
                <Lock className="w-7 h-7" style={{ color: "var(--accent-l)" }} />
              </div>
              <h2 className="font-bold text-base mb-2" style={{ color: "var(--text)" }}>{t("screener.paywall.title")}</h2>
              <p className="text-sm mb-5 max-w-sm mx-auto" style={{ color: "var(--muted)" }}>
                {opportunitiesTeaserCount === null
                  ? t("screener.paywall.desc")
                  : t("screener.paywall.teaser", { count: opportunitiesTeaserCount })}
              </p>
              <button onClick={() => {
                        posthog.capture("opportunities_upgrade_clicked", { count: opportunitiesTeaserCount });
                        handleUpgrade(opportunitiesTeaserCount === null ? t("screener.paywall.reason") : t("screener.paywall.teaser", { count: opportunitiesTeaserCount }));
                      }}
                      className="px-6 py-2.5 rounded-xl text-sm font-bold text-white"
                      style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
                {t("screener.paywall.cta")}
              </button>
            </div>
          )}

          {/* The one, real, DCF-backed Screener Semanal — same tickers as
              the Sunday "Nuvos Radar detectó..." push, read back from
              weekly_opportunities_history so it never drifts from what was
              actually sent. */}
          {isPremium && (
            <div>
              {weeklyGeneratedAt && (
                <p className="text-[11px] mb-3" style={{ color: "var(--muted)" }}>
                  {t("screener.weekTheme.updated", { date: new Date(weeklyGeneratedAt).toLocaleDateString(i18n.language === "en" ? "en-US" : "es-MX", { day: "numeric", month: "long" }) })}
                </p>
              )}
              {weeklyLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--accent-l)" }} />
                </div>
              ) : weekly.length === 0 ? (
                <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>{t("screener.empty")}</p>
                </div>
              ) : (
                <div className="rounded-2xl border overflow-hidden divide-y" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  {weekly.map((u, i) => (
                    <WeeklyOpportunityCard key={u.ticker} pick={u} rank={i + 1} />
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
