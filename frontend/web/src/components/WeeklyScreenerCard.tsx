"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Search, Loader2, RefreshCw, Lock, X, Sparkles, Info,
} from "lucide-react";
import { screenerApi } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/lib/store";
import WeeklyOpportunityCard, { type WeeklyOpportunity } from "@/components/WeeklyOpportunityCard";

// Diego, 2026-09-24: "Acciones subvaluadas (DCF) ... ese es el que quiero
// que sea el Screener Semanal, el único." Real, DCF-backed candidates —
// same engine and same 5 tickers as the Sunday "Nuvos Radar detectó..."
// push (GET /screener/weekly-opportunities), never an AI narrative.
type Pick = WeeklyOpportunity;

interface WeeklyData {
  results?: Pick[];
  generated_at?: string | null;
}

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
const WEEKLY_CACHE_MAX_AGE_MS = 8 * 24 * 3600 * 1000;
function weeklyCacheKey(userId: string | null): string | null {
  return userId ? `nuvos_weekly_screener_cache__${userId}` : null;
}
function isValidWeeklyPayload(data: WeeklyData | null | undefined): data is WeeklyData {
  return !!data && (data.results?.length ?? 0) > 0;
}
function readWeeklyCache(userId: string | null): WeeklyData | null {
  const key = weeklyCacheKey(userId);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data?: WeeklyData; cachedAt?: number };
    if (!parsed.cachedAt || Date.now() - parsed.cachedAt > WEEKLY_CACHE_MAX_AGE_MS) return null;
    return isValidWeeklyPayload(parsed.data) ? parsed.data! : null;
  } catch { return null; }
}
function writeWeeklyCache(userId: string | null, data: WeeklyData) {
  const key = weeklyCacheKey(userId);
  if (!key || !isValidWeeklyPayload(data)) return;
  try { localStorage.setItem(key, JSON.stringify({ data, cachedAt: Date.now() })); } catch {}
}

export default function WeeklyScreenerCard({ isPremium, onUpgrade }: Props) {
  const { t, i18n } = useTranslation();
  const { isAuthenticated, authRestoring, userId } = useAuthStore();
  const [open, setOpen]          = useState(false);
  const [data, setData]          = useState<WeeklyData | null>(() => readWeeklyCache(userId));
  const [loading, setLoading]    = useState(false);
  const [previewRows, setPreviewRows] = useState<Pick[]>([]);

  const load = useCallback(async () => {
    // Same auth-rehydration race fixed elsewhere in this app (watchlist,
    // subvaluadas, portfolio's cash/dividends): firing before the session
    // cookie is attached used to 401, and the old bare `catch {}` below
    // swallowed that silently with no retry — permanently empty until a
    // manual reload, which is exactly "en web app nunca se ve."
    if (authRestoring || !isAuthenticated || !isPremium) return;
    setLoading(true);
    // Diego, 2026-09-23: "necesito que abra en máximo 10 segundos." This is
    // a plain DB read (weekly_opportunities_history), normally instant —
    // the budget only matters on the rare on-demand fallback (a brand new
    // Premium user this job hasn't run for yet). One bounded attempt (8s)
    // decides what's on screen within the 10s ceiling; a second, longer
    // attempt keeps trying quietly in the background if that doesn't land.
    try {
      const res = await screenerApi.getWeeklyOpportunities(i18n.language);
      setData(res.data);
      writeWeeklyCache(userId, res.data);
    } catch {
      screenerApi.getWeeklyOpportunities(i18n.language)
        .then((res) => { setData(res.data); writeWeeklyCache(userId, res.data); })
        .catch(() => {}); // still nothing — the empty/cached state below already covers this
    }
    setLoading(false);
  }, [isPremium, authRestoring, isAuthenticated, userId, i18n.language]);

  useEffect(() => { load(); }, [load]);

  // Free/guest preview — real (never fabricated) candidates from the same
  // DCF universe, just not personalized (that part is Premium-only). Zero
  // AI cost, same source /screener page's own free-tier teaser uses.
  useEffect(() => {
    if (isPremium) return;
    screenerApi.getUndervalued(undefined, 3)
      .then((res) => setPreviewRows((res.data?.results ?? []) as Pick[]))
      .catch(() => {});
  }, [isPremium]);

  const handleOpen = () => {
    if (!isPremium) { onUpgrade(); return; }
    setOpen(true);
  };

  if (!isPremium) {
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
              {loading && (
                <div className="flex items-center gap-2 p-5">
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: TOOL_COLOR }} />
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{t("weeklyScreenerCard.analyzingMarket")}</span>
                </div>
              )}

              {!loading && data?.generated_at && (
                <div className="px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                  <p className="text-[11px] leading-snug" style={{ color: "var(--muted)" }}>
                    {t("weeklyScreenerCard.updated", {
                      date: new Date(data.generated_at).toLocaleDateString(i18n.language === "en" ? "en-US" : "es-MX", { day: "numeric", month: "long" }),
                    })}
                  </p>
                </div>
              )}

              {!loading && data?.results && data.results.length > 0 && (
                <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {data.results.slice(0, 5).map((pick, i) => (
                    <WeeklyOpportunityCard key={pick.ticker} pick={pick} rank={i + 1} />
                  ))}
                </div>
              )}

              {!loading && data && (
                <div className="flex items-start gap-2 px-5 py-3 border-t" style={{ borderColor: "var(--border)" }}>
                  <Info className="w-3 h-3 mt-0.5 shrink-0" style={{ color: "var(--dim)" }} />
                  <p className="text-[10px] leading-relaxed" style={{ color: "var(--dim)" }}>
                    {t("weeklyScreenerCard.defaultDisclaimer")}
                  </p>
                </div>
              )}

              {!loading && (!data || !data.results || data.results.length === 0) && (
                <div className="p-5 flex flex-col items-center gap-3 text-center">
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{t("weeklyScreenerCard.noSuggestions")}</span>
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
