"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Search, TrendingUp, TrendingDown, Loader2, RefreshCw,
  ChevronDown, ChevronUp, Zap, AlertTriangle, Info, Target, Ban, BookOpen, X, Sparkles,
} from "lucide-react";
import PremiumToolLocked from "@/components/PremiumToolLocked";
import { screenerApi } from "@/lib/api";
import { useTranslation } from "react-i18next";

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

const TOOL_COLOR = "#8b5cf6";

export default function WeeklyScreenerCard({ isPremium, onUpgrade, tickers = [] }: Props) {
  const { t } = useTranslation();
  const [open, setOpen]          = useState(false);
  const [data, setData]          = useState<WeeklyData | null>(null);
  const [loading, setLoading]    = useState(false);
  const [expanded, setExpanded]  = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isPremium) return;
    setLoading(true);
    try {
      const res = await screenerApi.getWeekly(tickers);
      setData(res.data);
    } catch {
    } finally { setLoading(false); }
  }, [isPremium, tickers.join(",")]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  const handleOpen = () => {
    if (!isPremium) { onUpgrade(); return; }
    setOpen(true);
  };

  if (!isPremium) {
    return (
      <PremiumToolLocked
        title={t("weeklyScreenerCard.title")}
        tagline={t("weeklyScreenerCard.tagline")}
        description={t("weeklyScreenerCard.description")}
        icon={Search}
        color={TOOL_COLOR}
        benefits={[
          { icon: Target,   text: t("weeklyScreenerCard.benefit1") },
          { icon: Zap,      text: t("weeklyScreenerCard.benefit2") },
          { icon: Ban,      text: t("weeklyScreenerCard.benefit3") },
          { icon: BookOpen, text: t("weeklyScreenerCard.benefit4") },
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
              <Search className="w-8 h-8 text-white" />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 pt-5">
          <h3 className="text-[22px] font-black tracking-tight text-center mb-1"
              style={{ color: "var(--text)" }}>
            {t("weeklyScreenerCard.title")}
          </h3>
          <p className="text-[13px] font-bold text-center mb-5 tracking-wide" style={{ color: TOOL_COLOR }}>
            {t("weeklyScreenerCard.tagline")}
          </p>

          <div className="rounded-2xl border overflow-hidden mb-5" style={{ borderColor: "var(--border)" }}>
            {[
              { emoji: "🎯", text: t("weeklyScreenerCard.featureAdapted") },
              { emoji: "⚡", text: t("weeklyScreenerCard.featureCatalyst") },
              { emoji: "📚", text: t("weeklyScreenerCard.featureEducational") },
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
            {t("weeklyScreenerCard.viewSuggestions")}
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

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0"
                 style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Search className="w-4 h-4 shrink-0" style={{ color: TOOL_COLOR }} />
                <span className="font-bold text-sm truncate" style={{ color: "var(--text)" }}>
                  {t("weeklyScreenerCard.title")}
                  {data?.week_theme && (
                    <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full font-semibold"
                          style={{ background: TOOL_COLOR + "20", color: TOOL_COLOR }}>
                      {data.week_theme}
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={load} disabled={loading} className="p-1.5 rounded-xl hover:bg-white/5 transition-colors">
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} style={{ color: "var(--muted)" }} />
                </button>
                <button onClick={() => setOpen(false)} className="p-1.5 rounded-xl hover:bg-white/5 transition-colors"
                        style={{ color: "var(--muted)" }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1">
              {loading && (
                <div className="flex items-center gap-2 p-5">
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: TOOL_COLOR }} />
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{t("weeklyScreenerCard.analyzingMarket")}</span>
                </div>
              )}

              {!loading && data?.business_profile && (
                <div className="px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                  <p className="text-[11px] leading-snug" style={{ color: "var(--muted)" }}>{data.business_profile}</p>
                </div>
              )}

              {!loading && data?.picks && (
                <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {data.picks.slice(0, 5).map((pick, i) => {
                    const isOpen = expanded === pick.ticker;
                    const up = (pick.change_pct ?? 0) >= 0;
                    return (
                      <div key={pick.ticker}>
                        <button
                          className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.02] transition-colors"
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
                        {isOpen && (
                          <div className="px-4 pb-3 space-y-2" style={{ borderTop: "1px solid var(--border)", background: "var(--raised)" }}>
                            {pick.catalyst && (
                              <div className="flex items-start gap-2 pt-2">
                                <Zap className="w-3 h-3 mt-0.5 shrink-0" style={{ color: "#f59e0b" }} />
                                <div>
                                  <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "#f59e0b" }}>{t("weeklyScreenerCard.catalyst")}</span>
                                  <p className="text-[11px] leading-snug mt-0.5" style={{ color: "var(--sub)" }}>{pick.catalyst}</p>
                                </div>
                              </div>
                            )}
                            {pick.risk && (
                              <div className="flex items-start gap-2">
                                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" style={{ color: "#ef4444" }} />
                                <div>
                                  <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "#ef4444" }}>{t("weeklyScreenerCard.mainRisk")}</span>
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

              {!loading && data?.mentor_note && (
                <div className="px-5 py-3 border-t" style={{ borderColor: "var(--border)", background: TOOL_COLOR + "06" }}>
                  <p className="text-[11px] leading-relaxed italic" style={{ color: "var(--muted)" }}>
                    &ldquo;{data.mentor_note}&rdquo;
                  </p>
                </div>
              )}

              {!loading && data && (
                <div className="flex items-start gap-2 px-5 py-3 border-t" style={{ borderColor: "var(--border)" }}>
                  <Info className="w-3 h-3 mt-0.5 shrink-0" style={{ color: "var(--dim)" }} />
                  <p className="text-[10px] leading-relaxed" style={{ color: "var(--dim)" }}>
                    {data.disclaimer ?? t("weeklyScreenerCard.defaultDisclaimer")}
                  </p>
                </div>
              )}

              {!loading && !data && (
                <div className="p-5">
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{t("weeklyScreenerCard.noSuggestions")}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
