"use client";

import { useEffect, useState } from "react";
import {
  Search, Loader2, RefreshCw, Lock, X, Sparkles, Info,
} from "lucide-react";
import { screenerApi } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { useWeeklyOpportunities } from "@/lib/useWeeklyOpportunities";
import WeeklyOpportunityCard, { type WeeklyOpportunity } from "@/components/WeeklyOpportunityCard";

// Diego, 2026-09-24: "Acciones subvaluadas (DCF) ... ese es el que quiero
// que sea el Screener Semanal, el único." Real, DCF-backed candidates —
// same engine and same 5 tickers as the Sunday "Nuvos Radar detectó..."
// push (GET /screener/weekly-opportunities), never an AI narrative.
type Pick = WeeklyOpportunity;

interface Props {
  isPremium: boolean;
  onUpgrade: () => void;
}

const TOOL_COLOR = "#8b5cf6";

// Diego, 2026-09-23: "Screener Semanal SIEMPRE SIEMPRE SIEMPRE debe abrir
// ... en web app no abre nada." Same-week picks (server-side, read back
// from weekly_opportunities_history — never recomputed on every visit)
// cached per-user here too, so a transient failure after retries still
// shows last week's real picks instead of an empty "no suggestions" card
// until the user manually hits retry.
//
// Diego, 2026-09-24: cache entries never expired or validated what they
// stored before, so a corrupted/empty entry could render forever. Never
// persist an empty result, ignore one on read, and time-box every entry
// to 8 days (server-side history is read fresh each Sunday) so a stale
// entry can't outlive its week even if it once looked valid.
export default function WeeklyScreenerCard({ isPremium, onUpgrade }: Props) {
  const { t, i18n } = useTranslation();
  const [open, setOpen]          = useState(false);
  const [previewRows, setPreviewRows] = useState<Pick[]>([]);
  // Cache + retries + "never blank a real list" live in the shared hook
  // (see useWeeklyOpportunities). `serverFree`: the backend says this
  // account is Free even though billing status hadn't loaded yet.
  const { data, loading, serverFree, load } = useWeeklyOpportunities(isPremium);
  const premium = isPremium && !serverFree;
  const hasData = (data?.results?.length ?? 0) > 0;

  // Free/guest preview — real (never fabricated) candidates from the same
  // DCF universe, just not personalized (that part is Premium-only). Zero
  // AI cost, same source /screener page's own free-tier teaser uses.
  useEffect(() => {
    if (premium) return;
    screenerApi.getUndervalued(undefined, 3)
      .then((res) => setPreviewRows((res.data?.results ?? []) as Pick[]))
      .catch(() => {});
  }, [premium]);

  const handleOpen = () => {
    if (!premium) { onUpgrade(); return; }
    setOpen(true);
  };

  if (!premium) {
    const rows: (Pick | null)[] = previewRows.length ? previewRows.slice(0, 3) : [null, null, null];
    return (
      <div
        onClick={onUpgrade}
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

        <div className="p-6 pt-5">
          <h3 className="text-[22px] font-black tracking-tight text-center mb-1"
              style={{ color: "var(--text)" }}>
            {t("weeklyScreenerCard.title")}
          </h3>
          <p className="text-[13px] font-bold text-center mb-5 tracking-wide" style={{ color: TOOL_COLOR }}>
            {t("weeklyScreenerCard.tagline")}
          </p>

          {/* Blurred preview */}
          <div className="relative rounded-2xl border overflow-hidden mb-5" style={{ borderColor: "var(--border)" }}>
            <div className="pointer-events-none select-none" style={{ filter: "blur(6px)" }} aria-hidden="true">
              {rows.map((pick, i, arr) => (
                <div key={pick?.ticker ?? i}
                     className="flex items-center gap-3 px-4 py-3.5"
                     style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <span className="text-xs font-black w-4 text-center shrink-0" style={{ color: "var(--dim)" }}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm" style={{ color: "var(--text)" }}>{pick?.ticker ?? "TICK"}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--raised)", color: "var(--muted)" }}>{pick?.sector ?? "Sector"}</span>
                    </div>
                    <p className="text-[11px] mt-0.5 leading-snug truncate" style={{ color: "var(--sub)" }}>
                      {t("weeklyScreenerCard.previewRowHint")}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold" style={{ color: "var(--text)" }}>
                      {pick?.margin_of_safety_pct != null ? `+${pick.margin_of_safety_pct}%` : "+—%"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-4 text-center"
                 style={{ background: "color-mix(in srgb, var(--card) 55%, transparent)" }}>
              <Lock className="w-5 h-5" style={{ color: TOOL_COLOR }} />
              <span className="text-[12px] font-bold" style={{ color: "var(--text)" }}>
                {t("weeklyScreenerCard.unlockPreview")}
              </span>
            </div>
          </div>

          <button
            onClick={(e) => { e.stopPropagation(); onUpgrade(); }}
            className="relative w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-extrabold text-[15px] text-white overflow-hidden tracking-wide transition-opacity hover:opacity-90"
            style={{ background: TOOL_COLOR }}
          >
            <div className="absolute inset-0 top-0 h-1/2 pointer-events-none"
                 style={{ background: "rgba(255,255,255,0.12)" }} />
            <Sparkles className="w-4 h-4" />
            {t("weeklyScreenerCard.unlockCta")}
          </button>
        </div>
      </div>
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
              { emoji: "📐", text: t("weeklyScreenerCard.featureDcf") },
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
              {loading && !hasData && (
                <div className="flex items-center gap-2 p-5">
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: TOOL_COLOR }} />
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{t("weeklyScreenerCard.analyzingMarket")}</span>
                </div>
              )}

              {data?.generated_at && (
                <div className="px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                  <p className="text-[11px] leading-snug" style={{ color: "var(--muted)" }}>
                    {t("weeklyScreenerCard.updated", {
                      date: new Date(data.generated_at).toLocaleDateString(i18n.language === "en" ? "en-US" : "es-MX", { day: "numeric", month: "long" }),
                    })}
                  </p>
                </div>
              )}

              {hasData && (
                <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {data!.results!.slice(0, 5).map((pick, i) => (
                    <WeeklyOpportunityCard key={pick.ticker} pick={pick} rank={i + 1} />
                  ))}
                </div>
              )}

              {hasData && (
                <div className="flex items-start gap-2 px-5 py-3 border-t" style={{ borderColor: "var(--border)" }}>
                  <Info className="w-3 h-3 mt-0.5 shrink-0" style={{ color: "var(--dim)" }} />
                  <p className="text-[10px] leading-relaxed" style={{ color: "var(--dim)" }}>
                    {t("weeklyScreenerCard.defaultDisclaimer")}
                  </p>
                </div>
              )}

              {!loading && !hasData && (
                <div className="p-5 flex flex-col items-center gap-3 text-center">
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{t("weeklyScreenerCard.loadError")}</span>
                  <button
                    onClick={load}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold"
                    style={{ background: TOOL_COLOR + "15", color: TOOL_COLOR }}
                  >
                    <RefreshCw className="w-3 h-3" />
                    {t("weeklyScreenerCard.retry")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
