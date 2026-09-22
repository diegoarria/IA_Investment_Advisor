"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Search, TrendingUp, TrendingDown, Loader2, RefreshCw,
  ChevronDown, ChevronUp, Zap, AlertTriangle, Info, Lock, X, Sparkles,
} from "lucide-react";
import { screenerApi } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/lib/store";

interface Pick {
  ticker: string;
  name?: string;
  sector: string;
  price: number | null;
  // null for Free's real-but-unlabeled teaser rows (screener.py's /weekly
  // route) — only Premium's AI-generated picks carry a narrative.
  change_pct?: number | null;
  score?: number;
  why?: string | null;
  catalyst?: string | null;
  risk?: string | null;
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

// Diego, 2026-09-23: "Screener Semanal SIEMPRE SIEMPRE SIEMPRE debe abrir
// ... en web app no abre nada." Same-week picks (server cache is 7 days,
// one set per user, refreshed every Sunday) cached per-user here too, so
// a transient failure after retries still shows last week's real picks
// instead of an empty "no suggestions" card until the user manually hits
// retry.
//
// Diego, 2026-09-24: "solo me dio 1 acción cuando deberían ser las 5."
// The backend guarantees exactly 5 for Premium (screener.py's own
// backfill logic never lets it fall short) — so a cached value with
// fewer than 5 can only be a corrupted/partial entry (e.g. an old
// truncated response from before that guardrail, or a value written
// during a genuine backend hiccup), and this cache never expired or
// validated what it stored, so a bad entry would keep rendering forever
// until a fresh fetch happened to overwrite it. Now: never persist a
// non-5 Premium result, ignore one on read (falls through to a real
// fetch instead), and time-box every entry to 8 days (a week's cache
// ceiling server-side is 7) so a stale entry can't outlive its week
// indefinitely even if it once looked valid.
const WEEKLY_CACHE_MAX_AGE_MS = 8 * 24 * 3600 * 1000;
function weeklyCacheKey(userId: string | null): string | null {
  return userId ? `nuvos_weekly_screener_cache__${userId}` : null;
}
function isValidWeeklyPayload(data: WeeklyData | null | undefined): data is WeeklyData {
  // `locked` (Free/guest teaser) is real but intentionally has fewer than
  // 5 rows — only Premium's full result is held to "must be exactly 5."
  return !!data && (!!(data as { locked?: boolean }).locked || (data.picks?.length ?? 0) >= 5);
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

export default function WeeklyScreenerCard({ isPremium, onUpgrade, tickers = [] }: Props) {
  const { t } = useTranslation();
  const { isAuthenticated, authRestoring, userId } = useAuthStore();
  const [open, setOpen]          = useState(false);
  const [data, setData]          = useState<WeeklyData | null>(() => readWeeklyCache(userId));
  const [loading, setLoading]    = useState(false);
  const [expanded, setExpanded]  = useState<string | null>(null);

  const load = useCallback(async () => {
    // Same auth-rehydration race fixed elsewhere in this app (watchlist,
    // subvaluadas, portfolio's cash/dividends): firing before the session
    // cookie is attached used to 401, and the old bare `catch {}` below
    // swallowed that silently with no retry — permanently empty until a
    // manual reload, which is exactly "en web app nunca se ve."
    if (authRestoring || !isAuthenticated) return;
    setLoading(true);
    // Diego, 2026-09-09: Free users now fetch too — the backend returns 3
    // real (never fabricated) teaser tickers for them instead of the full
    // AI-personalized picks (see screener.py's /weekly route), so the
    // blurred preview below shows real data, not hardcoded placeholders.
    //
    // Diego, 2026-09-23: "necesito que abra en máximo 10 segundos." The
    // normal case (Sunday's batch already pre-warmed this user's cache) is
    // a sub-second Redis read — this budget only matters on a cache miss,
    // which can otherwise take 15s+ (a live 200-ticker scan + a real
    // Claude call). One bounded attempt (8s, leaves margin for render +
    // network) decides what the user sees within the 10s ceiling — either
    // fresh data or whatever's already on screen (this week's cache-first
    // value, or last week's cached picks). If that attempt doesn't make
    // it, a second, longer-budget attempt keeps trying quietly in the
    // background so a first-time user still gets real personalized picks
    // without having to tap retry, it just doesn't hold the screen open
    // waiting for it.
    try {
      const res = await screenerApi.getWeekly(tickers, 8000);
      setData(res.data);
      if (isPremium) writeWeeklyCache(userId, res.data);
    } catch {
      screenerApi.getWeekly(tickers, 25000)
        .then((res) => { setData(res.data); if (isPremium) writeWeeklyCache(userId, res.data); })
        .catch(() => {}); // still nothing — the empty/cached state below already covers this
    }
    setLoading(false);
  }, [isPremium, tickers.join(","), authRestoring, isAuthenticated, userId]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  const handleOpen = () => {
    if (!isPremium) { onUpgrade(); return; }
    setOpen(true);
  };

  if (!isPremium) {
    // Diego, 2026-09-09: blurred preview of 3 REAL tickers (never
    // fabricated) — the backend's /weekly route returns real, zero-AI-cost
    // candidates for Free (see screener.py's docstring: reuses the same
    // real DCF-backed picker the Sunday push uses), so what's blurred here
    // is genuinely this user's own data, not a generic placeholder.
    const previewRows = data?.picks?.length ? data.picks.slice(0, 3) : [null, null, null];
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
              {previewRows.map((pick, i, arr) => (
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
                      {pick?.price != null ? `$${pick.price.toFixed(2)}` : "$—.—"}
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

              {!loading && (!data || !data.picks || data.picks.length === 0) && (
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
