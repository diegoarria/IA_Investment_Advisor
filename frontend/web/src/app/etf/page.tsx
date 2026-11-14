"use client";

// Nuvos ETF Explorer — Fase 2B redesign.
//
// Fase 8C: free for every authenticated user, no admin gate left on the
// backend. Reuses the full Nuvos visual system: AppSidebar (real in-app
// navigation, not a standalone screen anymore), GlowCard/radarUi, and the
// EtfCard/useEnrichedCards for progressive, capped-at-6-per-request
// enrichment — no mass FMP calls across the 7,463-ETF universe.

import { useEffect, useRef, useState, type ComponentType, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Search, Loader2, AlertTriangle, ChevronRight, ChevronLeft, ShieldCheck, Cpu, HeartPulse, Globe2, Landmark, ShoppingCart, Scale } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import { GlowCard, Eyebrow, IconSquare } from "@/components/subvaluadas/radarUi";
// Fase 7.2 (Diego, captura real): verde de marca de la plataforma, no
// el dorado de Radar. Hex literal (no `var(--accent-l)`) porque esta
// página concatena un sufijo de alfa (`${GOLD}55`).
const GOLD = "#00e887";
import { EtfCard, EtfCardSkeleton } from "@/components/etf/EtfCard";
import { useEnrichedCards } from "@/components/etf/useEnrichedCards";
import { etfApi } from "@/lib/api";

type SearchResult = { symbol: string; name: string };
type Category = { key: string; label: string; etfs: { ticker: string; label: string }[] };

const DEBOUNCE_MS = 350;
const DISCOVERY_TICKERS = ["VOO", "QQQ", "VXUS"];

const CATEGORY_ICON: Record<string, ComponentType<{ className?: string; style?: CSSProperties }>> = {
  mercado_amplio: ShieldCheck,
  tecnologia: Cpu,
  salud: HeartPulse,
  mercados_internacionales: Globe2,
  financiero_y_energia: Landmark,
  consumo_e_industria: ShoppingCart,
};

function LoadMoreRow({ hasMore, loading, onClick, label, loadingLabel }: { hasMore: boolean; loading: boolean; onClick: () => void; label: string; loadingLabel: string }) {
  if (!hasMore) return null;
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full rounded-2xl py-3 text-sm font-semibold flex items-center justify-center gap-2"
      style={{ background: "var(--card)", border: "1px solid var(--border)", color: GOLD }}
    >
      {loading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{loadingLabel}</> : label}
    </button>
  );
}

function CardGrid({ tickers }: { tickers: string[] }) {
  const { t } = useTranslation();
  const { cards, loading, error, hasMore, loadMore, loadedCount } = useEnrichedCards(tickers);
  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
        {cards.map((c) => <EtfCard key={c.ticker} card={c} />)}
        {loading && loadedCount === 0 && Array.from({ length: Math.min(3, tickers.length) }).map((_, i) => <EtfCardSkeleton key={i} />)}
      </div>
      {error && (
        <p className="text-sm text-center py-3" style={{ color: "var(--sub)" }}>{t("etf.explorer.searchError")}</p>
      )}
      <LoadMoreRow hasMore={hasMore} loading={loading && loadedCount > 0} onClick={loadMore} label={t("etf.explorer.loadMore")} loadingLabel={t("etf.explorer.loadingMore")} />
    </div>
  );
}

export default function EtfExplorerPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);

  const [categories, setCategories] = useState<Category[] | null>(null);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    etfApi.getCategories()
      .then((res) => setCategories(res.data?.categories ?? []))
      .catch(() => setCategoriesError(true))
      .finally(() => setCategoriesLoading(false));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setResults(null);
      setSearchError(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setSearching(true);
      setSearchError(false);
      etfApi.search(q, 20)
        .then((res) => setResults(res.data?.results ?? []))
        .catch(() => setSearchError(true))
        .finally(() => setSearching(false));
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const showingSearch = query.trim().length > 0;
  const searchTickers = (results ?? []).map((r) => r.symbol);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />
        <div className="flex-1 overflow-y-auto scrollbar-thin relative">
          <div className="absolute inset-x-0 top-0 h-[340px] pointer-events-none"
               style={{ background: "linear-gradient(rgba(212,162,76,0.18), rgba(212,162,76,0.05) 50%, rgba(212,162,76,0))" }} />
          <div className="relative max-w-[1000px] mx-auto px-5 sm:px-6 md:px-10 py-8">

            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <Eyebrow color={GOLD}>{t("etf.explorer.heroEyebrow")}</Eyebrow>
                <h1 className="text-[28px] sm:text-[32px] font-black tracking-tight mb-2" style={{ color: "var(--text)" }}>{t("etf.explorer.heroTitle")}</h1>
              </div>
              <button
                onClick={() => router.push("/etf/compare")}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold shrink-0"
                style={{ background: "var(--raised)", border: `1px solid ${GOLD}55`, color: GOLD }}
              >
                <Scale className="w-4 h-4" />{t("etf.explorer.compareCta")}
              </button>
            </div>
            <p className="text-sm sm:text-[15px] mb-6 max-w-xl" style={{ color: "var(--sub)" }}>{t("etf.explorer.heroSubtitle")}</p>

            {/* Búsqueda destacada */}
            <div className="relative mb-7">
              <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2" style={{ color: "var(--muted)" }} />
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelectedCategory(null); }}
                placeholder={t("etf.explorer.searchPlaceholder")}
                className="w-full rounded-2xl pl-11 pr-4 py-3.5 text-sm outline-none"
                style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)" }}
              />
            </div>

            {showingSearch ? (
              <div>
                <p className="text-[11px] font-black uppercase tracking-wide mb-2.5" style={{ color: "var(--muted)" }}>{t("etf.explorer.resultsTitle")}</p>
                {searching && (
                  <div className="flex items-center gap-2 py-6 justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" style={{ color: GOLD }} />
                    <p className="text-sm" style={{ color: "var(--sub)" }}>{t("etf.explorer.searchLoading")}</p>
                  </div>
                )}
                {!searching && searchError && (
                  <GlowCard tint="#E05252" className="text-center py-6">
                    <AlertTriangle className="w-6 h-6 mx-auto mb-2" style={{ color: "#E05252" }} />
                    <p className="text-sm" style={{ color: "var(--sub)" }}>{t("etf.explorer.searchError")}</p>
                  </GlowCard>
                )}
                {!searching && !searchError && results && results.length === 0 && (
                  <p className="text-sm text-center py-6" style={{ color: "var(--sub)" }}>{t("etf.explorer.searchEmpty", { query })}</p>
                )}
                {!searching && !searchError && results && results.length > 0 && (
                  <CardGrid tickers={searchTickers} />
                )}
              </div>
            ) : selectedCategory ? (
              <div>
                <button onClick={() => setSelectedCategory(null)} className="flex items-center gap-1 mb-3 text-sm font-semibold" style={{ color: "var(--sub)" }}>
                  <ChevronLeft className="w-4 h-4" /> {t("etf.explorer.backToCategories")}
                </button>
                <p className="text-lg font-bold mb-1" style={{ color: "var(--text)" }}>{t(`etf.explorer.categories.${selectedCategory.key}`, selectedCategory.label)}</p>
                <p className="text-[12px] mb-4" style={{ color: "var(--sub)" }}>{t("etf.explorer.categoryCuratedNote")}</p>
                <CardGrid tickers={selectedCategory.etfs.map((e) => e.ticker)} />
              </div>
            ) : (
              <div className="space-y-8">
                {/* Categorías como intereses */}
                <div>
                  <p className="text-sm font-bold mb-1" style={{ color: "var(--text)" }}>{t("etf.explorer.categoriesTitle")}</p>
                  {/* Diego, 2026-11 (rediseño): aclarar ANTES de entrar a
                      una categoría que son agrupaciones curadas para
                      explorar, no una clasificación GICS formal — ya
                      existía esta nota dentro de cada categoría
                      (`categoryCuratedNote`), ahora también aquí. */}
                  <p className="text-[12px] mb-3" style={{ color: "var(--sub)" }}>{t("etf.explorer.categoriesEducationalNote")}</p>
                  {categoriesLoading && (
                    <div className="flex items-center gap-2 py-6 justify-center">
                      <Loader2 className="w-4 h-4 animate-spin" style={{ color: GOLD }} />
                      <p className="text-sm" style={{ color: "var(--sub)" }}>{t("etf.explorer.categoriesLoading")}</p>
                    </div>
                  )}
                  {!categoriesLoading && categoriesError && (
                    <GlowCard tint="#E05252" className="text-center py-6">
                      <AlertTriangle className="w-6 h-6 mx-auto mb-2" style={{ color: "#E05252" }} />
                      <p className="text-sm" style={{ color: "var(--sub)" }}>{t("etf.explorer.categoriesError")}</p>
                    </GlowCard>
                  )}
                  {!categoriesLoading && !categoriesError && categories && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {categories.filter((c) => c.etfs.length > 0).map((cat) => {
                        const Icon = CATEGORY_ICON[cat.key] || ShieldCheck;
                        return (
                          <button
                            key={cat.key}
                            onClick={() => setSelectedCategory(cat)}
                            className="text-left"
                          >
                            <GlowCard tint={GOLD} className="flex items-start gap-3 hover:-translate-y-0.5 transition-transform">
                              <IconSquare color={GOLD} size={40}><Icon className="w-5 h-5" style={{ color: GOLD }} /></IconSquare>
                              <div className="min-w-0 flex-1">
                                <p className="text-[15px] font-bold" style={{ color: "var(--text)" }}>{t(`etf.explorer.categories.${cat.key}`, cat.label)}</p>
                                <p className="text-[12px]" style={{ color: "var(--muted)" }}>{cat.etfs.length} {t("etf.explorer.resultsTitle").toLowerCase()}</p>
                              </div>
                              <ChevronRight className="w-4 h-4 shrink-0 mt-1" style={{ color: "var(--muted)" }} />
                            </GlowCard>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Descubrimiento educativo */}
                <div>
                  <p className="text-sm font-bold mb-1" style={{ color: "var(--text)" }}>{t("etf.explorer.discoveryTitle")}</p>
                  <p className="text-[12px] mb-3" style={{ color: "var(--sub)" }}>{t("etf.explorer.discoveryNote")}</p>
                  <CardGrid tickers={DISCOVERY_TICKERS} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
