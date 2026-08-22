"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Loader2, Lock, Search, X, AlertTriangle } from "lucide-react";
import posthog from "posthog-js";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PaywallModal from "@/components/PaywallModal";
import StockAvatar from "@/components/StockAvatar";
import ExplainButton from "@/components/ExplainButton";
import {
  type YearlyDetailRow, type Checklist, type FairValueRangeData, type ConfidenceMeterData,
  type MarketExpectationsData, type LiquidityGate, type DcfAssumptions,
  type SensitivityMatrixData,
  type ReverseDcfSanityCheckData, type ExpectationsInvestingData,
  type NuvosFairValueData, type RelativeValuationData, type AnalystPriceTargetData,
  type NifMoatData, type NifDeteriorationData,
  GeneratedAtNote,
  FollowButton, AnalyzeButton,
  _SCENARIO_COLOR,
} from "@/components/subvaluadas/shared";
import type { GqvFairValueData } from "@/components/subvaluadas/GqvFairValuePanel";
import { CompanyDiagnosticCard } from "@/components/subvaluadas/CompanyDiagnosticCard";
import type { CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";
import { Card } from "@/components/ui/Card";
import { resolveValuationPanelMode } from "@/lib/valuationPanelMode";
import { screenerApi, watchlist } from "@/lib/api";
import { useSubscriptionStore, useThemeStore, useAuthStore, isGuestUser, getGuestId } from "@/lib/store";

// Whether to call the no-auth /public routes instead of the authenticated
// ones. isGuestUser() alone isn't enough — that flag is only ever set by
// enterGuestMode() ("Explorar sin cuenta"), so anyone who reaches this page
// without a real session AND without that flag (a stale/cleared flag, a
// direct link, any edge case that isn't the guest-mode entry flow) would
// otherwise fall through to the authenticated endpoint and get a guaranteed
// 401. The one thing that actually determines whether the authenticated
// call can possibly succeed is whether there's a real session at all.
const shouldUsePublicApi = () => isGuestUser() || !useAuthStore.getState().userId;

export interface QuickAnalysisResult {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  change_pct: number | null;
  exchange: string | null;
  intrinsic_value_base: number | null;
  expected_value_per_share: number | null;
  margin_of_safety_pct: number | null;
  implied_growth_pct: number | null;
  composite_score: number | null;
  fair_value_range: FairValueRangeData | null;
  confidence_meter: ConfidenceMeterData | null;
  market_expectations: MarketExpectationsData | null;
  thesis_scores: Record<string, number> | null;
  summary: string;
  checklist: Checklist | null;
  liquidity_gate: LiquidityGate | null;
  generated_at: number;
  current_fcf: number | null;
  net_cash: number | null;
  shares_outstanding: number | null;
  dcf_assumptions: DcfAssumptions | null;
  yearly_detail: YearlyDetailRow[] | null;
  pv_of_fcf_sum: number | null;
  pv_of_terminal_value: number | null;
  enterprise_value: number | null;
  total_debt: number | null;
  cash: number | null;
  // Fase 1, Incremento 4 — see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
  // All optional/nullable: absent for financial-sector companies and REITs,
  // which don't run the standard FCF-DCF (see `sector_model_note`).
  sensitivity_matrix: SensitivityMatrixData | null;
  reverse_dcf_sanity_check: ReverseDcfSanityCheckData | null;
  expectations_investing: ExpectationsInvestingData | null;
  sector_model_note: { sector_type: string; detalle: string } | null;
  // Nuvos AI Fair Value Engine redesign — one engine, three named scenarios
  // (Bear/Base/Bull), the PRIMARY valuation since Incremento 11 (THE FLIP);
  // see FairValueScenariosPanel in shared.tsx and combine_fair_value_range
  // (fair_value_range's low/base/high now ARE these 3 values).
  nuvos_fair_value: NuvosFairValueData | null;
  // Nuvos Fair Value Engine (Growth + Quality + Value) — EXPERIMENTAL,
  // shown in its own panel while calibrated against more real tickers; not
  // yet primary. See /Users/diegoarria/.claude/plans/cosmic-munching-crown.md.
  gqv_fair_value: GqvFairValueData | null;
  // Incremento 17 (visual redesign, "otros puntos de referencia") — real,
  // independently-computed reference points, never blended into the DCF.
  relative_valuation: RelativeValuationData | null;
  analyst_price_target: AnalystPriceTargetData | null;
  // "Calidad de la valuación" (model confidence, not company quality) —
  // real signals only, see FullModelPanel's _ModelConfidenceCard.
  years_available: number | null;
  beta: number | null;
  moat_engine: NifMoatData | null;
  deterioration_engine: NifDeteriorationData | null;
}

// Gold/teal/coral is this screen's fixed brand identity (Valor Intrínseco),
// kept constant in both themes. The neutrals (--bg/--card/--raised/...),
// however, only get a custom "navy" override in dark mode — in light mode
// they're deliberately left unset so they fall through to the app's own
// [data-theme="light"] tokens (globals.css), which already give the right
// white/near-white palette. Scoped to this wrapper only — the sidebar/nav
// outside it always follows the user's normal light/dark preference.
function useViTheme(): React.CSSProperties {
  const { theme } = useThemeStore();
  return useMemo(() => ({
    ["--accent" as string]: GOLD,
    ["--accent-l" as string]: GOLD,
    ["--accent-d" as string]: "#A9793A",
    ["--up" as string]: TEAL,
    ["--down" as string]: CORAL,
    background: "var(--bg)",
    ...(theme === "dark" ? {
      ["--bg" as string]: "#0A0F1A",
      ["--card" as string]: "#111A2B",
      ["--raised" as string]: "#16223A",
      ["--card-2" as string]: "#16223A",
      ["--border" as string]: "rgba(255,255,255,0.08)",
      ["--border-s" as string]: "#1C2B47",
      ["--text" as string]: "#EBEEF5",
      ["--sub" as string]: "#8C97AD",
      ["--muted" as string]: "#5C6883",
      ["--dim" as string]: "#5C6883",
    } : {}),
  }), [theme]);
}

// Single source of truth for the brand triad — `_SCENARIO_COLOR` in
// shared.tsx (bear/base/bull) IS gold/teal/coral; this used to redefine
// the same 3 hex values locally, a real drift risk (see rediseño visual,
// stateful-painting-flurry.md).
const GOLD = _SCENARIO_COLOR.base;
const TEAL = _SCENARIO_COLOR.bull;
const CORAL = _SCENARIO_COLOR.bear;
const DEFAULT_TICKER = "AAPL";

// The 11 real GICS sectors screener.py's UNIVERSE/undervalued_screener_service
// tag every company with (there's a 12th bucket, "ETF", which isn't a sector
// and is deliberately excluded here — Diego asked for "los 11 sectores de la
// bolsa"). `value` must match that backend string exactly (English) since
// it's sent straight through as the `sector` query param; `labelKey` is the
// Spanish/English display name.
const SECTORS: { value: string; labelKey: string }[] = [
  { value: "Technology", labelKey: "technology" },
  { value: "Healthcare", labelKey: "healthcare" },
  { value: "Financials", labelKey: "financials" },
  { value: "Consumer Discretionary", labelKey: "consumerDiscretionary" },
  { value: "Consumer Staples", labelKey: "consumerStaples" },
  { value: "Communication Services", labelKey: "communicationServices" },
  { value: "Industrials", labelKey: "industrials" },
  { value: "Energy", labelKey: "energy" },
  { value: "Utilities", labelKey: "utilities" },
  { value: "Real Estate", labelKey: "realEstate" },
  { value: "Materials", labelKey: "materials" },
];

// Same shape /screener already renders for these results — a lightweight
// "taste" of each company (ticker, price, margin of safety, one headline
// score), never the full diagnostic, which only opens once a specific
// ticker is searched (Diego, 2026-08-21: "solo como la probadita antes de
// entrar a ver todo sobre 1 empresa a detalle").
interface SectorPreviewResult {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  intrinsic_value_base: number | null;
  margin_of_safety_pct: number | null;
  thesis_scores: Record<string, number> | null;
}

export default function SubvaluadasPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center" style={{ background: "var(--bg)" }}><Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent-l)" }} /></div>}>
      <SubvaluadasPageInner />
    </Suspense>
  );
}

function SubvaluadasPageInner() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;
  const viTheme = useViTheme();
  // useAuthStore is a persist()-wrapped Zustand store — it rehydrates from
  // localStorage ASYNCHRONOUSLY after mount. shouldUsePublicApi() reads
  // getState().userId directly (a synchronous snapshot, not the reactive
  // hook), so on a hard refresh/direct link into this page the very first
  // fetch effect below could fire while userId is still null even for a
  // real logged-in Premium user — routing their search to the /public
  // guest endpoint, which enforces a flat 3-search limit keyed by the
  // browser's guest_id with zero premium awareness. Confirmed real
  // (Diego, 2026-08-19): a Premium account hit "ya usaste tus 3
  // búsquedas" because of exactly this race. Gating both fetch effects on
  // `!authRestoring` (same pattern home/page.tsx already uses) closes it.
  const authRestoring = useAuthStore((s) => s.authRestoring);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);

  // Marks the home checklist's "view 1 opportunity" step done — landing here
  // at all counts, since this screen's whole purpose is showing an opportunity.
  useEffect(() => { localStorage.setItem("nuvos_opportunity_viewed", "1"); }, []);

  const [query, setQuery] = useState("");
  const [ticker, setTicker] = useState(() => (searchParams.get("ticker") || DEFAULT_TICKER).toUpperCase());
  const [data, setData] = useState<QuickAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limitHit, setLimitHit] = useState(false);
  const [watchlisted, setWatchlisted] = useState(false);
  // Free users get 2 searches/week (enforced server-side) — don't burn that on
  // the default AAPL auto-load; only fetch once they've actually searched,
  // or if the URL itself names a ticker (a shared link is an explicit ask).
  const [searchTriggered, setSearchTriggered] = useState(() => !!searchParams.get("ticker"));

  // Sector browse: pick one of the 11 sectors, see a grid of preview cards
  // (not the full diagnostic) for real DCF-backed candidates in it, then
  // tap one to open its full detail — same as searching that ticker
  // directly. null selectedSector means "not browsing," showing the normal
  // single-ticker search result below instead.
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [sectorResults, setSectorResults] = useState<SectorPreviewResult[]>([]);
  const [sectorLoading, setSectorLoading] = useState(false);
  const [sectorError, setSectorError] = useState(false);
  // Free/guest: the backend never leaks tickers/content, just a real count
  // of how many candidates exist — same 100%-Premium pattern the rest of
  // this screen already uses (subvaluadas.freeGate.*).
  const [sectorTeaserCount, setSectorTeaserCount] = useState<number | null>(null);

  useEffect(() => {
    if (!selectedSector || authRestoring) return;
    let cancelled = false;
    setSectorLoading(true);
    setSectorError(false);
    setSectorTeaserCount(null);
    screenerApi.getUndervalued(selectedSector, 24, i18n.language, true)
      .then((res) => {
        if (cancelled) return;
        const body = res.data as { is_premium: boolean; results?: SectorPreviewResult[]; teaser_count?: number };
        if (body.is_premium) {
          setSectorResults(body.results ?? []);
        } else {
          setSectorResults([]);
          setSectorTeaserCount(body.teaser_count ?? 0);
        }
      })
      .catch(() => { if (!cancelled) setSectorError(true); })
      .finally(() => { if (!cancelled) setSectorLoading(false); });
    return () => { cancelled = true; };
  }, [selectedSector, i18n.language, authRestoring]);

  const handleSectorClick = (value: string) => {
    setSelectedSector((cur) => (cur === value ? null : value));
  };

  const handleSectorCardClick = (t: string) => {
    setSelectedSector(null);
    setQuery(t);
    setWatchlisted(false);
    setSearchTriggered(true);
    setTicker(t);
  };

  useEffect(() => {
    let cancelled = false;
    const cacheKey = `vi_quick_analysis:${ticker}:${i18n.language}`;
    setLimitHit(false);
    // Apple is always the free default view (Diego: "si o si") — exempt
    // from the weekly free-search counter server-side via is_default_view,
    // so it must load unconditionally, Premium or not. Only an explicit
    // user search (searchTriggered) ever counts against that counter.
    const isDefaultView = !searchTriggered;

    // Stale-while-revalidate: paint instantly from the last cached payload
    // for this ticker+lang (localStorage) while a fresh copy loads in the
    // background — the screen's default ticker must never sit on a spinner
    // when we already know the answer from a previous visit.
    let hadCache = false;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        setData(JSON.parse(cached));
        setError(null);
        setLoading(false);
        hadCache = true;
      }
    } catch { /* localStorage unavailable (Safari private mode, etc.) — fall through to network */ }

    if (!hadCache) { setLoading(true); setError(null); }

    // Wait for the auth store to finish rehydrating before deciding
    // guest-vs-authenticated — see the authRestoring comment above. Once
    // it flips to false this effect re-runs (authRestoring is a dep
    // below) and fires for real.
    if (authRestoring) return () => { cancelled = true; };

    // This screen must always open with a real result, not a spinner stuck
    // on a transient network hiccup or a slow provider timeout — retry a
    // couple of times with backoff before surfacing an error. A definite
    // answer from the server (bad ticker, out of free searches) is never retried.
    const attempt = async (n: number): Promise<void> => {
      try {
        // A true guest has no session at all — the authenticated route
        // would just 401. Same real data, same 3/week rule either way,
        // just identified by an anonymous guest_id instead (Diego:
        // "quiero que los free y los usuarios sin cuenta puedan tener
        // acceso a sus 3 búsquedas semanales en Oportunidades").
        const res = shouldUsePublicApi()
          ? await screenerApi.quickAnalysisPublic(ticker, getGuestId(), i18n.language, isDefaultView)
          : await screenerApi.quickAnalysis(ticker, i18n.language, isDefaultView);
        if (cancelled) return;
        setData(res.data);
        setError(null);
        try { localStorage.setItem(cacheKey, JSON.stringify(res.data)); } catch { /* ignore */ }
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        const isDefinitive = status !== undefined && status !== 503;
        if (!isDefinitive && n < 2) {
          await new Promise((r) => setTimeout(r, 800 * (n + 1)));
          return cancelled ? undefined : attempt(n + 1);
        }
        if (cancelled || hadCache) return; // already showing the cached result — don't rip it away
        const rawDetail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
        if (status === 429) {
          setLimitHit(true);
          setError((rawDetail as { message?: string })?.message || t("subvaluadas.freeGate.limitDesc"));
          posthog.capture("dcf_limit_reached", { ticker });
          return;
        }
        setError(typeof rawDetail === "string" ? rawDetail : t("subvaluadas.search.error"));
      }
    };

    attempt(0).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, isPremium, searchTriggered, i18n.language, t, authRestoring]);

  // CompanyDiagnosticCard's real data — Premium-only (same reasoning as
  // /nif-dashboard: called in parallel with quick-analysis for the same
  // search, gating it behind Premium instead of the free-tier weekly-search
  // counter avoids decrementing that counter twice for one search action).
  // A failure/insufficient_data here must never block the page — it just
  // falls back to the existing GqvFairValuePanel/FairValueScenariosPanel
  // path below, exactly like before this feature existed.
  const [companyDiagnostic, setCompanyDiagnostic] = useState<CompanyDiagnosticData | null>(null);
  // Premium-only, and slower than the main `data` fetch below (it's a
  // separate request) — without tracking "still in flight" separately from
  // "null", the page would render `data` first, see hasCompanyDiagnostic
  // still false, and flash the retired gqv panel for however long this
  // fetch takes before swapping to the diagnostic card. See
  // valuationPanelMode.ts's own doc comment for the full reasoning.
  const [companyDiagnosticLoading, setCompanyDiagnosticLoading] = useState(false);
  // Every failure (403 premium_required, 404 insufficient data, a 500 bug,
  // a dropped request) used to collapse into the same silent `null` →
  // "unavailable" card, with zero way to tell them apart from the UI —
  // confirmed the hard way (Aug 17) chasing a "some tickers show nothing"
  // report that turned out to need actual Railway log access to diagnose.
  // Kept minimal (status + code only, never raw error text) so the
  // "unavailable" card below can distinguish "you need Premium" from a
  // real data gap without waiting on server logs next time.
  const [companyDiagnosticError, setCompanyDiagnosticError] = useState<{ status?: number; code?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Same auth-rehydration race as the fetch effect above — wait for a
    // real session snapshot before deciding guest-vs-authenticated. Keep
    // reporting "loading" (not the default false) so resolveValuationPanelMode
    // doesn't briefly resolve to "unavailable" during this window.
    if (authRestoring) {
      setCompanyDiagnosticLoading(true);
      return () => { cancelled = true; };
    }
    setCompanyDiagnostic(null);
    setCompanyDiagnosticError(null);
    setCompanyDiagnosticLoading(true);
    // Free/guest users get the same real diagnostic Premium sees for their
    // first weekly free searches (Diego: "vamos a asustar a todos los
    // usuarios si no mostramos valor") — the backend, not isPremium, is the
    // source of truth for whether this search is still within the free
    // allowance; a 403 here means it isn't.
    const req = shouldUsePublicApi()
      ? screenerApi.companyDiagnosticPublic(ticker, getGuestId(), i18n.language)
      : screenerApi.companyDiagnostic(ticker, i18n.language);
    req
      .then((res) => { if (!cancelled) setCompanyDiagnostic(res.data); })
      .catch((err) => {
        if (cancelled) return;
        setCompanyDiagnostic(null);
        const status = (err as { response?: { status?: number; data?: { detail?: { code?: string } | string } } })?.response?.status;
        const detail = (err as { response?: { data?: { detail?: { code?: string } | string } } })?.response?.data?.detail;
        const code = typeof detail === "object" ? detail?.code : undefined;
        setCompanyDiagnosticError({ status, code });
      })
      .finally(() => { if (!cancelled) setCompanyDiagnosticLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, isPremium, searchTriggered, i18n.language, authRestoring]);

  const handleSearch = () => {
    if (!query.trim()) return;
    setWatchlisted(false);
    setSearchTriggered(true);
    // Was `.toUpperCase()` — silently broke every company-name search.
    // The backend's `_resolve_quick_ticker` deliberately trusts a query as
    // a literal ticker ONLY when the user typed it already in caps
    // (`stripped == candidate`, see its own doc comment) — that's exactly
    // how it tells "AAPL" (a deliberate ticker) apart from "Apple" (a name
    // that needs a real Finnhub/Yahoo name search). Forcing every query to
    // uppercase here made "apple"/"Apple" arrive as "APPLE", which trivially
    // satisfies that same-case check and short-circuits straight past the
    // name search — so a plain company name failed unless it happened to
    // already equal its own ticker. Send exactly what the user typed.
    setTicker(query.trim());
  };

  const suggestedG = data?.dcf_assumptions?.suggested_g ?? 7;
  const suggestedR = data?.dcf_assumptions?.suggested_r ?? 9;
  const suggestedGt = data?.dcf_assumptions?.suggested_gt ?? 3;

  // Which valuation panel renders — CompanyDiagnosticCard always first when
  // available; the retired legacy DCF/GQV panel is no longer reachable at
  // all (Diego, "siempre siempre siempre" — see resolveValuationPanelMode's
  // own doc comment).
  const valuationPanelMode = resolveValuationPanelMode(!!companyDiagnostic, companyDiagnosticLoading);

  const handleFollow = async () => {
    if (!data || watchlisted) return;
    try { await watchlist.add(data.ticker, data.company_name || undefined); setWatchlisted(true); } catch { /* idempotent */ }
  };
  const handleAnalyze = () => router.push(`/chat?msg=${encodeURIComponent(t("subvaluadas.analyze.prompt", { ticker }))}&autosend=1`);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

        <div className="flex-1 overflow-y-auto scrollbar-thin" style={viTheme}>
            <div className="max-w-[1000px] mx-auto px-6 py-8 md:px-10">

              {!isPremium && (
                <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl px-4 py-2.5 mb-4"
                     style={{ background: "rgba(212,162,76,0.08)", border: "1px solid rgba(212,162,76,0.25)" }}>
                  <span className="text-[12.5px]" style={{ color: "var(--sub)" }}>{t("subvaluadas.freeGate.banner")}</span>
                  <button onClick={() => setPaywallOpen(true)} className="text-[12px] font-bold shrink-0" style={{ color: GOLD }}>
                    {t("subvaluadas.freeGate.bannerCta")}
                  </button>
                </div>
              )}

              <div className="flex gap-2 mb-8">
                <div className="flex-1 flex items-center gap-2 rounded-xl border px-3"
                     style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <Search className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    placeholder={t("subvaluadas.search.placeholder")}
                    className="flex-1 py-2.5 text-sm bg-transparent outline-none"
                    style={{ color: "var(--text)" }}
                  />
                  {query && (
                    <button onClick={() => setQuery("")}>
                      <X className="w-4 h-4" style={{ color: "var(--muted)" }} />
                    </button>
                  )}
                </div>
                <button onClick={handleSearch} disabled={!query.trim()}
                        className="px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40"
                        style={{ background: "var(--brand-green)", color: "#0A0F1A" }}>
                  {t("subvaluadas.search.button")}
                </button>
              </div>

              <div className="flex gap-2 overflow-x-auto pb-2 mb-8 -mx-1 px-1" style={{ scrollbarWidth: "thin" }}>
                {SECTORS.map((s) => {
                  const active = selectedSector === s.value;
                  return (
                    <button
                      key={s.value}
                      onClick={() => handleSectorClick(s.value)}
                      className="shrink-0 px-3.5 py-1.5 rounded-full text-[12.5px] font-semibold border transition-colors"
                      style={active
                        ? { background: "var(--brand-green)", borderColor: "var(--brand-green)", color: "#0A0F1A" }
                        : { background: "var(--card)", borderColor: "var(--border)", color: "var(--sub)" }}
                    >
                      {t(`subvaluadas.sectors.${s.labelKey}`)}
                    </button>
                  );
                })}
              </div>

              {selectedSector ? (
                <div className="mb-10">
                  {sectorLoading ? (
                    <div className="flex items-center justify-center py-16"><Loader2 className="w-7 h-7 animate-spin" style={{ color: GOLD }} /></div>
                  ) : sectorError ? (
                    <div className="rounded-2xl border p-6 text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                      <p className="text-sm" style={{ color: "var(--muted)" }}>{t("subvaluadas.sectors.error")}</p>
                    </div>
                  ) : sectorTeaserCount !== null ? (
                    <div className="rounded-2xl border p-6 text-center" style={{ borderColor: "rgba(212,162,76,0.25)", background: "rgba(212,162,76,0.08)" }}>
                      <p className="text-sm mb-3" style={{ color: "var(--text)" }}>
                        {t("subvaluadas.sectors.teaser", { count: sectorTeaserCount })}
                      </p>
                      <button onClick={() => setPaywallOpen(true)} className="px-5 py-2 rounded-xl text-sm font-bold" style={{ background: GOLD, color: "#0A0F1A" }}>
                        {t("subvaluadas.premiumGate.cta")}
                      </button>
                    </div>
                  ) : sectorResults.length === 0 ? (
                    <div className="rounded-2xl border p-6 text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                      <p className="text-sm" style={{ color: "var(--muted)" }}>{t("subvaluadas.sectors.empty")}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {sectorResults.map((r) => (
                        <button
                          key={r.ticker}
                          onClick={() => handleSectorCardClick(r.ticker)}
                          className="text-left rounded-xl border p-4 transition-colors hover:opacity-90"
                          style={{ borderColor: "var(--border)", background: "var(--card)" }}
                        >
                          <div className="flex items-center gap-3 mb-3">
                            <div style={{ width: 36, height: 36 }}><StockAvatar ticker={r.ticker} size="md" /></div>
                            <div className="min-w-0">
                              <p className="text-sm font-bold truncate" style={{ color: "var(--text)" }}>{r.ticker}</p>
                              <p className="text-[11px] truncate" style={{ color: "var(--muted)" }}>{r.company_name ?? ""}</p>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-bold tabular-nums" style={{ color: "var(--text)" }}>
                              {r.price !== null ? `$${r.price.toFixed(2)}` : "—"}
                            </span>
                            {r.margin_of_safety_pct !== null && (
                              <span className="text-xs font-black px-2 py-1 rounded-lg tabular-nums"
                                    style={{ background: "rgba(34,197,94,0.12)", color: TEAL }}>
                                +{r.margin_of_safety_pct.toFixed(0)}%
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : loading ? (
                <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin" style={{ color: GOLD }} /></div>
              ) : limitHit ? (
                <div className="max-w-xl mx-auto rounded-2xl border p-8 text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(212,162,76,0.12)" }}>
                    <Lock className="w-7 h-7" style={{ color: GOLD }} />
                  </div>
                  <h2 className="font-bold text-base mb-2" style={{ color: "var(--text)" }}>{t("subvaluadas.freeGate.limitTitle")}</h2>
                  <p className="text-sm mb-5 max-w-sm mx-auto" style={{ color: "var(--muted)" }}>{error || t("subvaluadas.freeGate.limitDesc")}</p>
                  <button onClick={() => setPaywallOpen(true)} className="px-6 py-2.5 rounded-xl text-sm font-bold" style={{ background: GOLD, color: "#0A0F1A" }}>
                    {t("subvaluadas.freeGate.cta")}
                  </button>
                </div>
              ) : error || !data ? (
                <div className="rounded-2xl border p-8 text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>{error || t("subvaluadas.search.error")}</p>
                </div>
              ) : (
                <>
                  {/* Hero — free-floating, no card, same treatment as before but
                      on the new type scale (rediseño visual). */}
                  <div className="flex items-end justify-between gap-5 flex-wrap mb-8">
                    <div className="flex items-center gap-4">
                      <div style={{ width: 48, height: 48 }}><StockAvatar ticker={data.ticker} size="lg" /></div>
                      <div>
                        <div className="text-lg font-bold tracking-tight" style={{ color: "var(--text)" }}>{data.company_name}</div>
                        <div className="text-[12px] mt-0.5" style={{ color: "var(--sub)" }}>
                          {data.sector}{data.exchange ? ` · ${data.exchange}` : ""}
                        </div>
                      </div>
                    </div>
                    {data.price !== null && (
                      <div className="text-right">
                        <div className="text-[22px] font-black tabular-nums" style={{ color: "var(--text)" }}>${data.price.toFixed(2)}</div>
                        {data.change_pct !== null && (
                          <div className="text-[12px] font-semibold tabular-nums" style={{ color: data.change_pct >= 0 ? TEAL : CORAL }}>
                            {data.change_pct >= 0 ? "+" : ""}{data.change_pct.toFixed(2)}% {t("subvaluadas.detail.today")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* CompanyDiagnosticCard — LA ÚNICA tarjeta de valoración
                      de esta pantalla (Diego, "siempre siempre siempre").
                      El viejo panel GQV/DCF y todo su detalle en cascada
                      (FollowAlertPanel legacy, Supuestos, Reverse DCF,
                      Sensibilidad, Modelo Completo, Checklist) quedaron
                      retirados por completo — nunca vuelven a ser
                      alcanzables, ni siquiera como fallback. Cuando el
                      diagnóstico real no está disponible (Premium-only,
                      cargando, o datos insuficientes) se muestra un estado
                      honesto en su lugar, nunca el diseño antiguo. */}
                  {valuationPanelMode === "diagnostic" ? (
                    <CompanyDiagnosticCard data={companyDiagnostic!} />
                  ) : valuationPanelMode === "loading" ? (
                    <Card padding="p-10">
                      <div className="flex items-center justify-center">
                        <Loader2 className="w-6 h-6 animate-spin" style={{ color: GOLD }} />
                      </div>
                    </Card>
                  ) : companyDiagnosticError?.status === 403 ? (
                    <Card padding="p-6">
                      <div className="flex items-start gap-3">
                        <Lock className="w-5 h-5 shrink-0 mt-0.5" style={{ color: GOLD }} />
                        <div>
                          <p className="text-[14px] font-bold" style={{ color: "var(--text)" }}>
                            {t("subvaluadas.premiumGate.title")}
                          </p>
                          <p className="text-[13px] mt-1" style={{ color: "var(--sub)" }}>
                            {t("subvaluadas.premiumGate.desc")}
                          </p>
                        </div>
                      </div>
                    </Card>
                  ) : (
                    <Card padding="p-6">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "var(--muted)" }} />
                        <div>
                          <p className="text-[14px] font-bold" style={{ color: "var(--text)" }}>
                            {t("subvaluadas.valuationUnavailable.title")}
                          </p>
                          <p className="text-[13px] mt-1" style={{ color: "var(--sub)" }}>
                            {t("subvaluadas.valuationUnavailable.subtitle")}
                          </p>
                          {companyDiagnosticError && (
                            <p className="text-[11px] mt-2" style={{ color: "var(--dim)" }}>
                              {t("subvaluadas.valuationUnavailable.debug", {
                                status: companyDiagnosticError.status ?? "?",
                                code: companyDiagnosticError.code ?? "unknown",
                              })}
                            </p>
                          )}
                        </div>
                      </div>
                    </Card>
                  )}

                  <div className="space-y-3 mt-8">
                    <GeneratedAtNote generatedAt={data.generated_at} />
                  </div>
                  <div className="flex gap-2 mt-6">
                    <FollowButton ticker={data.ticker} watchlisted={watchlisted} onFollow={handleFollow} />
                    <AnalyzeButton onAnalyze={handleAnalyze} />
                  </div>
                </>
              )}

            </div>
          </div>
      </div>

      <ExplainButton
        screen={data ? "oportunidades_resultado" : "oportunidades_intro"}
        context={
          data
            ? {
                ticker: data.ticker,
                company_name: data.company_name,
                price: data.price,
                fair_value_low: data.fair_value_range?.low ?? null,
                fair_value_high: data.fair_value_range?.high ?? null,
                margin_of_safety_pct: data.margin_of_safety_pct,
                intrinsic_value_per_share: data.expected_value_per_share ?? data.intrinsic_value_base,
                wacc_pct: suggestedR,
                growth_pct: suggestedG,
                terminal_growth_pct: suggestedGt,
                summary: data.summary,
              }
            : {
                screen_purpose:
                  "This screen shows whether a stock is cheap or expensive by comparing its " +
                  "current price to its real value, estimated from the company's expected " +
                  "future cash flows (a method called DCF — discounted cash flow). It helps " +
                  "the user decide whether now looks like a good time to buy, letting them " +
                  "adjust their own assumptions for growth and risk (WACC).",
              }
        }
      />

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("subvaluadas.premiumGate.paywallReason")} />
    </div>
  );
}
