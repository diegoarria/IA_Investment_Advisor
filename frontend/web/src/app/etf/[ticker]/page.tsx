"use client";

// Nuvos ETF — ficha individual, rediseño con la metodología de 5
// preguntas (Fase 2B, 3ra iteración, 2026-11).
//
// Admin-gated por el backend. Incluye AppSidebar/MarketTickerBar como el
// resto de la app. Reutiliza GlowCard/PillarSection/RaisedTile/IconSquare
// de radarUi.tsx — mismo sistema visual, nada nuevo inventado.
//
// "Lo que debes entender" consume `data.insights` — hasta 3 observaciones
// generadas en el backend por reglas fijas y documentadas (insights.py),
// nunca por IA. Cada una trae su `supporting_data` real, mostrado al
// expandir "ver el dato que respalda esto". `data.horizon_note` es un
// texto educativo estático, igual para cualquier ETF — nunca se asigna un
// horizonte según la categoría del fondo.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronDown, Loader2, AlertTriangle, PieChart, Globe2, DollarSign, TrendingUp, Info, Clock, ListTree, Scale } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import { GlowCard, PillarSection, Eyebrow, IconSquare, RaisedTile } from "@/components/subvaluadas/radarUi";
// Fase 7.2 (Diego, captura real): verde de marca, no el dorado de
// Radar — mismo criterio en toda la sección "Explorar ETFs".
const GOLD = "#00e887";
import { etfApi } from "@/lib/api";

type WeightItem = { name: string; weight_pct: number };
type Insight = { category: string; text: string; supporting_data: Record<string, unknown> };

type EtfOverview = {
  ticker: string;
  identification: {
    name: string | null; etf_company: string | null; description: string | null; has_editorial_description: boolean;
    inception_date: string | null; domicile: string | null; exchange: string | null; isin: string | null;
  };
  costs: {
    expense_ratio_pct: number | null; cost_tier: string | null;
    aum_usd: number | null; nav: number | null; nav_currency: string | null;
  };
  exposure: {
    sector_weightings: WeightItem[]; sector_weight_sum_pct: number | null;
    country_weightings: WeightItem[]; country_weight_sum_pct: number | null;
    holdings_count: number | null;
  };
  diversification: {
    by_sector: { top1_name: string | null; top1_weight_pct: number | null; top3_weight_pct: number | null; bucket_count: number };
    by_country: { top1_name: string | null; top1_weight_pct: number | null; top3_weight_pct: number | null; bucket_count: number };
  };
  price: {
    current: number | null; change_pct_today: number | null; year_low: number | null; year_high: number | null;
    history_based_change: { since_earliest_available_pct: number | null; days_of_history: number };
  };
  dividends: { recent: { ex_date: string | null; amount: number | null; yield_pct: number | null; frequency: string | null }[]; latest_yield_pct: number | null };
  data_quality: {
    source: string; structural_fetched_at: number; price_fetched_at: number;
    missing_fields: string[]; is_actively_trading: boolean | null; suspicious_expense_ratio: boolean;
  };
  insights: Insight[];
  horizon_note: string;
};

const INSIGHT_ICON: Record<string, typeof PieChart> = {
  sector_concentration: PieChart,
  geographic_exposure: Globe2,
  cost: DollarSign,
};

function fmtUsd(n: number | null, na: string): string {
  if (n === null || n === undefined) return na;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
}

function fmtPct(n: number | null, na: string, digits = 2): string {
  if (n === null || n === undefined) return na;
  return `${n.toFixed(digits)}%`;
}

function fmtDate(iso: string | null, locale: string, na: string): string {
  if (!iso) return na;
  try {
    return new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return iso;
  }
}

// Nuvos ETF visual refinement (2026-11): full-width bar instead of a
// cramped fixed w-24 one — legibility fix per Diego's explicit ask. No
// animation on the fill itself (just a plain width%, no transition) —
// "sin animaciones innecesarias." Never hides small sectors: every item
// below visibleCount is still accounted for in the real "Otros" sum
// (WeightList below), never silently dropped.
function WeightBar({ item, max, dimmed }: { item: WeightItem; max: number; dimmed?: boolean }) {
  const { t } = useTranslation();
  const widthPct = max > 0 ? Math.max(2, (item.weight_pct / max) * 100) : 0;
  return (
    <div className="py-1.5" style={{ opacity: dimmed ? 0.65 : 1 }}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[13px] min-w-0 truncate" style={{ color: "var(--text)" }}>{item.name}</span>
        <span className="text-[13px] font-bold shrink-0" style={{ color: "var(--text)" }}>{fmtPct(item.weight_pct, t("etf.detail.notAvailable"), 1)}</span>
      </div>
      <div className="w-full h-[7px] rounded-full overflow-hidden" style={{ background: "var(--raised)" }}>
        <div className="h-full rounded-full" style={{ width: `${widthPct}%`, background: GOLD }} />
      </div>
    </div>
  );
}

function WeightList({ items, visibleCount }: { items: WeightItem[]; visibleCount: number }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const max = items[0]?.weight_pct ?? 0;
  const shown = expanded ? items : items.slice(0, visibleCount);
  const rest = items.slice(visibleCount);
  const restSum = rest.reduce((sum, i) => sum + i.weight_pct, 0);
  return (
    <div>
      {shown.map((item) => <WeightBar key={item.name} item={item} max={max} />)}
      {!expanded && rest.length > 0 && (
        <button onClick={() => setExpanded(true)} className="w-full text-left" aria-label={t("etf.detail.invests.others", { count: rest.length })}>
          <WeightBar item={{ name: t("etf.detail.invests.others", { count: rest.length }), weight_pct: restSum }} max={max} dimmed />
        </button>
      )}
      {expanded && items.length > visibleCount && (
        <button onClick={() => setExpanded(false)} className="text-[12px] font-semibold mt-1" style={{ color: GOLD }}>
          {t("etf.detail.invests.seeLess")}
        </button>
      )}
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const { t } = useTranslation();
  const [showData, setShowData] = useState(false);
  const Icon = INSIGHT_ICON[insight.category] || Info;
  const title = t(`etf.detail.understand.categoryTitles.${insight.category}`, insight.category);
  return (
    <div className="rounded-2xl p-3.5" style={{ background: "var(--raised)", border: `1px solid ${GOLD}2b` }}>
      <div className="flex items-center gap-2 mb-1.5">
        <IconSquare color={GOLD} size={24}><Icon className="w-3 h-3" style={{ color: GOLD }} /></IconSquare>
        <p className="text-[12.5px] font-black uppercase tracking-wide" style={{ color: GOLD }}>{title}</p>
      </div>
      <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--text)" }}>{insight.text}</p>
      <button onClick={() => setShowData((v) => !v)} className="flex items-center gap-1 mt-2 text-[11px] font-semibold" style={{ color: "var(--sub)" }}>
        <ChevronDown className={`w-3 h-3 transition-transform ${showData ? "rotate-180" : ""}`} />
        {t("etf.detail.understand.seeData")}
      </button>
      {showData && (
        <div className="mt-1.5 text-[11.5px] font-mono rounded-lg p-2" style={{ background: "var(--card)", color: "var(--sub)" }}>
          {Object.entries(insight.supporting_data).map(([k, v]) => (
            <div key={k}>{k}: {String(v)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EtfDetailPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useParams<{ ticker: string }>();
  const ticker = (params?.ticker || "").toString().toUpperCase();
  const locale = i18n.language?.startsWith("en") ? "en-US" : "es-MX";
  const lang = i18n.language?.startsWith("en") ? "en" : "es";
  const na = t("etf.detail.notAvailable");

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [data, setData] = useState<EtfOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    etfApi.getOverview(ticker, lang)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => {
        if (cancelled) return;
        const status = err?.response?.status ?? 0;
        const detail = err?.response?.data?.detail;
        const message =
          status === 403 ? t("etf.detail.error.notAdmin")
          : status === 422 ? (typeof detail === "object" ? detail.message : t("etf.detail.error.notEtf", { ticker }))
          : status === 400 ? t("etf.detail.error.invalidTicker", { ticker })
          : t("etf.detail.error.generic");
        setError({ status, message });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, lang]);

  const hasRiskNotes = data && (data.data_quality.suspicious_expense_ratio || data.price.history_based_change.days_of_history < 252);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <div className="flex-1 flex flex-col overflow-hidden">
      <MarketTickerBar />
      <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="max-w-[1150px] mx-auto px-5 sm:px-6 py-8">
        <button onClick={() => router.back()} className="flex items-center gap-1 mb-6 text-sm font-semibold" style={{ color: "var(--sub)" }}>
          <ChevronLeft className="w-4 h-4" /> {t("etf.detail.back")}
        </button>

        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 className="w-7 h-7 animate-spin" style={{ color: GOLD }} />
            <p className="text-sm" style={{ color: "var(--sub)" }}>{t("etf.detail.loading", { ticker })}</p>
          </div>
        )}

        {!loading && error && (
          <GlowCard tint="#E05252" className="text-center py-10 max-w-[560px] mx-auto">
            <AlertTriangle className="w-8 h-8 mx-auto mb-3" style={{ color: "#E05252" }} />
            <p className="text-sm font-semibold mb-1" style={{ color: "var(--text)" }}>{ticker}</p>
            <p className="text-sm max-w-sm mx-auto" style={{ color: "var(--sub)" }}>{error.message}</p>
          </GlowCard>
        )}

        {!loading && !error && data && (
          <div className="space-y-5">
            {/* 1. Encabezado */}
            <GlowCard tint={GOLD} strong>
              <Eyebrow color={GOLD}>{t("etf.detail.etfBadge")}</Eyebrow>
              <h1 className="text-2xl font-black tracking-tight mb-1" style={{ color: "var(--text)" }}>
                {data.identification.name || data.ticker}
              </h1>
              <p className="text-sm font-semibold mb-3" style={{ color: "var(--sub)" }}>{data.ticker}</p>
              <p className="text-sm leading-relaxed mb-3" style={{ color: data.identification.has_editorial_description ? "var(--text)" : "var(--sub)" }}>
                {data.identification.description || t("etf.detail.noDescription")}
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]" style={{ color: "var(--sub)" }}>
                {data.identification.etf_company && <span>{t("etf.detail.summary.manager")}: <b style={{ color: "var(--text)" }}>{data.identification.etf_company}</b></span>}
                {data.identification.exchange && <span>{t("etf.detail.summary.exchange")}: <b style={{ color: "var(--text)" }}>{data.identification.exchange}</b></span>}
                {data.identification.inception_date && <span>{t("etf.detail.summary.since")}: <b style={{ color: "var(--text)" }}>{fmtDate(data.identification.inception_date, locale, na)}</b></span>}
              </div>
              <button
                onClick={() => router.push(`/etf/compare?tickers=${data.ticker}`)}
                className="flex items-center gap-1.5 mt-3 text-[12.5px] font-semibold"
                style={{ color: GOLD }}
              >
                <Scale className="w-3.5 h-3.5" />{t("etf.compare.ctaFromDetail")}
              </button>
            </GlowCard>

            {/* 2. Cuatro métricas principales */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <RaisedTile>
                <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--sub)" }}>{t("etf.detail.metrics.expenseRatio")}</p>
                <p className="text-lg font-black" style={{ color: "var(--text)" }}>{fmtPct(data.costs.expense_ratio_pct, na)}</p>
              </RaisedTile>
              <RaisedTile>
                <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--sub)" }}>{t("etf.detail.metrics.holdingsCount")}</p>
                <p className="text-lg font-black" style={{ color: "var(--text)" }}>{data.exposure.holdings_count ?? na}</p>
              </RaisedTile>
              <RaisedTile>
                <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--sub)" }}>{t("etf.detail.metrics.dominantSector")}</p>
                <p className="text-[15px] font-black truncate" style={{ color: "var(--text)" }}>{data.diversification.by_sector.top1_name || na}</p>
              </RaisedTile>
              <RaisedTile>
                <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--sub)" }}>{t("etf.detail.metrics.dominantCountry")}</p>
                <p className="text-[15px] font-black truncate" style={{ color: "var(--text)" }}>{data.diversification.by_country.top1_name || na}</p>
              </RaisedTile>
            </div>

            {/* Nuvos ETF visual refinement (2026-11): two-column layout on
                desktop — main column (distributions + secondary sections)
                and a featured, sticky "Lo que debes entender" panel beside
                it. Single column on mobile, with the panel shown FIRST
                (order-1) to match the requested priority: metrics →
                entender → en qué invierte → adicional. */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5 items-start">
            <div className="order-1 lg:order-2 lg:sticky lg:top-6">
            {/* 3. Lo que debes entender */}
            <GlowCard tint={GOLD}>
              <div className="flex items-center gap-2.5 mb-3.5">
                <IconSquare color={GOLD} size={34}><ListTree className="w-4 h-4" style={{ color: GOLD }} /></IconSquare>
                <span className="text-base font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{t("etf.detail.understand.title")}</span>
              </div>
              {data.insights.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--sub)" }}>{t("etf.detail.understand.empty")}</p>
              ) : (
                <div className="space-y-2.5">
                  {data.insights.map((insight, i) => <InsightCard key={i} insight={insight} />)}
                </div>
              )}
              <p className="text-[11px] mt-3.5 pt-3 leading-relaxed" style={{ color: "var(--sub)", borderTop: "1px solid var(--border)" }}>
                {t("etf.detail.understand.disclaimer")}
              </p>
            </GlowCard>
            </div>

            <div className="order-2 lg:order-1 space-y-5">
            {/* 4. Distribuciones */}
            <GlowCard>
              <PillarSection title={t("etf.detail.invests.title")} icon={<PieChart className="w-4 h-4" style={{ color: GOLD }} />} iconColor={GOLD}>
                {data.exposure.sector_weightings.length > 0 && (
                  <div className="mb-4">
                    <p className="text-[11px] font-black uppercase tracking-wide mb-1.5" style={{ color: "var(--sub)" }}>{t("etf.detail.invests.bySector")}</p>
                    <WeightList items={data.exposure.sector_weightings} visibleCount={8} />
                  </div>
                )}
                {data.exposure.country_weightings.length > 0 && (
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-wide mb-1.5" style={{ color: "var(--sub)" }}>{t("etf.detail.invests.byCountry")}</p>
                    <WeightList items={data.exposure.country_weightings} visibleCount={6} />
                  </div>
                )}
              </PillarSection>
            </GlowCard>

            {/* 5. Secciones secundarias: Costos */}
            <GlowCard>
              <PillarSection title={t("etf.detail.costs.title")} icon={<DollarSign className="w-4 h-4" style={{ color: GOLD }} />} iconColor={GOLD}>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <RaisedTile>
                    <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--sub)" }}>{t("etf.detail.costs.expenseRatio")}</p>
                    <p className="text-xl font-black" style={{ color: "var(--text)" }}>{fmtPct(data.costs.expense_ratio_pct, na)}</p>
                    {data.costs.cost_tier && <p className="text-[11px] mt-0.5" style={{ color: "var(--sub)" }}>{t(`etf.detail.costs.tier.${data.costs.cost_tier}`, data.costs.cost_tier)}</p>}
                  </RaisedTile>
                  <RaisedTile>
                    <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--sub)" }}>{t("etf.detail.costs.aum")}</p>
                    <p className="text-xl font-black" style={{ color: "var(--text)" }}>{fmtUsd(data.costs.aum_usd, na)}</p>
                  </RaisedTile>
                </div>
                <p className="text-[13px] leading-relaxed" style={{ color: "var(--sub)" }}>
                  {t("etf.detail.costs.explanationIntro")}
                  {data.costs.expense_ratio_pct != null && t("etf.detail.costs.example", { amount: ((10000 * data.costs.expense_ratio_pct) / 100).toFixed(2) })}
                  {t("etf.detail.costs.disclaimer")}
                </p>
              </PillarSection>
            </GlowCard>

            {/* Rendimiento */}
            <GlowCard>
              <PillarSection title={t("etf.detail.performance.title")} icon={<TrendingUp className="w-4 h-4" style={{ color: GOLD }} />} iconColor={GOLD}>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <RaisedTile>
                    <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--sub)" }}>{t("etf.detail.performance.currentPrice")}</p>
                    <p className="text-xl font-black" style={{ color: "var(--text)" }}>{data.price.current != null ? `$${data.price.current.toFixed(2)}` : na}</p>
                  </RaisedTile>
                  <RaisedTile>
                    <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--sub)" }}>
                      {t("etf.detail.performance.priceChange", { days: data.price.history_based_change.days_of_history })}
                    </p>
                    <p className="text-xl font-black" style={{ color: (data.price.history_based_change.since_earliest_available_pct ?? 0) >= 0 ? "#4CAF50" : "#E05252" }}>
                      {fmtPct(data.price.history_based_change.since_earliest_available_pct, na)}
                    </p>
                  </RaisedTile>
                </div>
                <p className="text-[12px] mb-3 flex items-start gap-1.5" style={{ color: "var(--sub)" }}>
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {t("etf.detail.performance.priceOnlyDisclaimer")}
                </p>
                {data.dividends.recent.length > 0 && (
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-wide mb-1.5" style={{ color: "var(--sub)" }}>
                      {t("etf.detail.performance.recentDividends")}
                      {data.dividends.latest_yield_pct != null && t("etf.detail.performance.currentYield", { pct: fmtPct(data.dividends.latest_yield_pct, na) })}
                    </p>
                    {data.dividends.recent.slice(0, 4).map((d, i) => (
                      <div key={i} className="flex justify-between text-[13px] py-1" style={{ color: "var(--text)" }}>
                        <span style={{ color: "var(--sub)" }}>{fmtDate(d.ex_date, locale, na)}</span>
                        <span className="font-semibold">{d.amount != null ? `$${d.amount.toFixed(4)}` : "—"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </PillarSection>
            </GlowCard>

            {/* Riesgos — solo señales de calidad de datos, no repite concentración (ya está en "Lo que debes entender") */}
            {hasRiskNotes && (
              <GlowCard>
                <PillarSection title={t("etf.detail.risks.title")} icon={<AlertTriangle className="w-4 h-4" style={{ color: "#E0A030" }} />} iconColor="#E0A030">
                  <div className="space-y-2.5">
                    {data.data_quality.suspicious_expense_ratio && (
                      <p className="text-[13px] leading-relaxed flex items-start gap-2" style={{ color: "var(--text)" }}>
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#E0A030" }} />
                        {t("etf.detail.costs.suspicious")}
                      </p>
                    )}
                    {data.price.history_based_change.days_of_history < 252 && (
                      <p className="text-[13px] leading-relaxed flex items-start gap-2" style={{ color: "var(--text)" }}>
                        <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#E0A030" }} />
                        {t("etf.detail.risks.limitedHistory", { days: data.price.history_based_change.days_of_history })}
                      </p>
                    )}
                  </div>
                </PillarSection>
              </GlowCard>
            )}

            {/* 6. Horizonte de inversión */}
            <GlowCard>
              <PillarSection title={t("etf.detail.horizon.title")} icon={<Clock className="w-4 h-4" style={{ color: GOLD }} />} iconColor={GOLD}>
                <p className="text-[13px] leading-relaxed" style={{ color: "var(--text)" }}>{data.horizon_note}</p>
              </PillarSection>
            </GlowCard>
            </div>
            </div>

            {/* Procedencia de los datos */}
            <div className="text-center text-[11px] pt-2" style={{ color: "var(--sub)" }}>
              {t("etf.detail.footer.source")} · {t("etf.detail.footer.structuralUpdated", { date: new Date(data.data_quality.structural_fetched_at * 1000).toLocaleString(locale) })}
              {" · "}{t("etf.detail.footer.priceUpdated", { date: new Date(data.data_quality.price_fetched_at * 1000).toLocaleString(locale) })}
              {data.data_quality.missing_fields.length > 0 && (
                <span>{t("etf.detail.footer.missingFields", { fields: data.data_quality.missing_fields.join(", ") })}</span>
              )}
            </div>
          </div>
        )}
      </div>
      </div>
      </div>
      </div>
  );
}
