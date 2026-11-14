"use client";

// Nuvos ETF — ficha individual, rediseño de una sola columna (2026-11,
// segunda iteración). Reemplaza el panel sticky "Lo que debes entender"
// (que repetía, en una columna aparte, el mismo dato que cada sección ya
// mostraba abajo) por un recorrido de lectura único: UNA observación
// principal arriba, enlazada a la sección que la respalda, y cada
// sección con su propio copy educativo (nunca el mismo texto del
// backend repetido dos veces).
//
// Admin-gated por el backend. Reutiliza GlowCard/PillarSection/
// RaisedTile/IconSquare de radarUi.tsx — mismo sistema visual, nada
// nuevo inventado.
//
// "Observación principal" consume `insights[0]` — verificado contra el
// contrato real del backend (insights.py::build_insights: SIEMPRE en
// orden de prioridad fijo sector→geográfico→costo, nunca relleno ni
// reordenado por el cliente — ver src/lib/etfDetailCopy.ts). Cada sección
// (Composición/Geografía/Costos) construye su PROPIA frase educativa a
// partir de los mismos números ya calculados por el backend
// (`diversification.by_sector/by_country`, `costs`), nunca repitiendo el
// texto exacto de `insights[]`. `horizon_note` es un texto educativo
// estático, igual para cualquier ETF — nunca se asigna un horizonte
// según la categoría del fondo.
//
// Holdings individuales: el backend NO los expone (el endpoint de FMP
// está restringido por el plan actual — ver provider.py) — nunca se
// inventa una lista de "principales empresas" a partir del agregado
// sectorial. Esa limitación se dice UNA sola vez, en Composición.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Loader2, AlertTriangle, PieChart, Globe2, DollarSign, TrendingUp, Info, Clock, ArrowRight, Scale } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import StockAvatar from "@/components/StockAvatar";
import { GlowCard, PillarSection, Eyebrow, RaisedTile } from "@/components/subvaluadas/radarUi";
// Fase 7.2 (Diego, captura real): verde de marca, no el dorado de
// Radar — mismo criterio en toda la sección "Explorar ETFs".
const GOLD = "#00e887";
import { etfApi } from "@/lib/api";
import {
  selectPrimaryObservation, anchorForInsight, primaryObservationIntro, describeSectorConcentration,
  describeGeographyNote, describeHoldingsCaveat, describeHoldingsUnavailableNote,
  type Insight,
} from "@/lib/etfDetailCopy";

type WeightItem = { name: string; weight_pct: number };

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
    returns: {
      ytd_pct: number | null; one_year_pct: number | null; five_year_pct: number | null;
      max_pct: number | null; max_start_date: string | null; max_is_full_history: boolean;
    };
  };
  dividends: { recent: { ex_date: string | null; amount: number | null; yield_pct: number | null; frequency: string | null }[]; latest_yield_pct: number | null };
  data_quality: {
    source: string; structural_fetched_at: number; price_fetched_at: number;
    missing_fields: string[]; is_actively_trading: boolean | null; suspicious_expense_ratio: boolean;
  };
  insights: Insight[];
  horizon_note: string;
  horizon_note_extended: string;
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

// Nuvos ETF visual refinement: full-width bar, sin animación de relleno.
// Nunca oculta un sector/país pequeño: todo lo que queda bajo
// `visibleCount` sigue contabilizado en el "Otros" real, nunca se
// descarta en silencio.
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

export default function EtfDetailPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useParams<{ ticker: string }>();
  const ticker = (params?.ticker || "").toString().toUpperCase();
  const locale = i18n.language?.startsWith("en") ? "en-US" : "es-MX";
  const lang: "es" | "en" = i18n.language?.startsWith("en") ? "en" : "es";
  const na = t("etf.detail.notAvailable");

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [horizonExpanded, setHorizonExpanded] = useState(false);
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

  const hasRiskNotes = data && (data.data_quality.suspicious_expense_ratio || data.price.returns.one_year_pct === null);
  const primaryObservation = data ? selectPrimaryObservation(data.insights) : null;
  const primaryAnchor = primaryObservation ? anchorForInsight(primaryObservation) : null;
  const sectorNote = data ? describeSectorConcentration(data.diversification.by_sector, lang) : null;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <div className="flex-1 flex flex-col overflow-hidden">
      <MarketTickerBar />
      <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="max-w-[760px] mx-auto px-5 sm:px-6 py-8">
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
            {/* 1. Identidad — nombre completo (hasta 2 líneas, nunca
                truncado a mitad de palabra), bolsa/fecha como info
                secundaria pequeña. */}
            <GlowCard tint={GOLD} strong>
              <Eyebrow color={GOLD}>{t("etf.detail.etfBadge")}</Eyebrow>
              <div className="flex items-start gap-3 mb-1">
                <StockAvatar ticker={data.ticker} size="lg" />
                <div className="min-w-0">
                  <h1 className="text-2xl font-black tracking-tight line-clamp-2" style={{ color: "var(--text)" }}>
                    {data.identification.name || data.ticker}
                  </h1>
                  <p className="text-sm font-semibold" style={{ color: "var(--sub)" }}>
                    {data.ticker}{data.identification.etf_company && ` · ${data.identification.etf_company}`}
                  </p>
                </div>
              </div>
              <p className="text-sm leading-relaxed mb-3" style={{ color: data.identification.has_editorial_description ? "var(--text)" : "var(--sub)" }}>
                {data.identification.description || t("etf.detail.noDescription")}
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px]" style={{ color: "var(--muted)" }}>
                {data.identification.exchange && <span>{t("etf.detail.summary.exchange")}: {data.identification.exchange}</span>}
                {data.identification.inception_date && <span>{t("etf.detail.summary.since")}: {fmtDate(data.identification.inception_date, locale, na)}</span>}
              </div>
              <button
                onClick={() => router.push(`/etf/compare?tickers=${data.ticker}`)}
                className="flex items-center gap-1.5 mt-3 text-[12.5px] font-semibold"
                style={{ color: GOLD }}
              >
                <Scale className="w-3.5 h-3.5" />{t("etf.compare.ctaFromDetail")}
              </button>
            </GlowCard>

            {/* 2. Métricas principales — comisión, nº de posiciones,
                sector dominante, AUM (solo si hay dato real). País
                dominante se movió a la sección Geografía: mostrarlo aquí
                Y abajo era la misma cifra repetida dos veces. */}
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
                <p className="text-[15px] font-black line-clamp-2" style={{ color: "var(--text)" }}>{data.diversification.by_sector.top1_name || na}</p>
              </RaisedTile>
              <RaisedTile>
                <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--sub)" }}>{t("etf.detail.costs.aum")}</p>
                <p className="text-lg font-black" style={{ color: "var(--text)" }}>{fmtUsd(data.costs.aum_usd, na)}</p>
              </RaisedTile>
            </div>

            {/* 3. Observación principal — UNA sola, enlazada a la
                sección que la respalda. `insights[0]` ya viene del
                backend en orden de prioridad verificado (sector →
                geográfico → costo); nunca se muestran insights[1]/[2]
                aparte, su contenido ya vive en el copy propio de cada
                sección más abajo. */}
            {primaryObservation && (
              <GlowCard tint={GOLD}>
                <p className="text-[11px] font-black uppercase tracking-wide mb-1.5" style={{ color: GOLD }}>{t("etf.detail.understand.title")}</p>
                <p className="text-[15px] font-bold leading-snug" style={{ color: "var(--text)" }}>{primaryObservationIntro(primaryObservation, lang)}</p>
                {primaryAnchor && (
                  <a href={`#${primaryAnchor}`} className="flex items-center gap-1 mt-2 text-[12.5px] font-semibold" style={{ color: GOLD }}>
                    {t("etf.detail.understand.seeData")}<ArrowRight className="w-3.5 h-3.5" />
                  </a>
                )}
                <p className="text-[11px] mt-3 pt-2.5 leading-relaxed" style={{ color: "var(--sub)", borderTop: "1px solid var(--border)" }}>
                  {t("etf.detail.understand.disclaimer")}
                </p>
              </GlowCard>
            )}
            {!data.insights.length && (
              <p className="text-[12.5px] flex items-start gap-1.5" style={{ color: "var(--sub)" }}>
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{t("etf.detail.understand.empty")}
              </p>
            )}

            {/* 4. Composición — sectores + concentración real + caveat de
                holdings (una sola vez, aquí, nunca repetido en Riesgos). */}
            <GlowCard>
              <div id="etf-section-composicion" />
              <PillarSection title={t("etf.detail.invests.title")} icon={<PieChart className="w-4 h-4" style={{ color: GOLD }} />} iconColor={GOLD}>
                {sectorNote && (
                  <p className="text-[13.5px] leading-relaxed mb-3" style={{ color: "var(--text)" }}>{sectorNote}</p>
                )}
                {data.exposure.sector_weightings.length > 0 && (
                  <div className="mb-4">
                    <p className="text-[11px] font-black uppercase tracking-wide mb-1.5" style={{ color: "var(--sub)" }}>{t("etf.detail.invests.bySector")}</p>
                    <WeightList items={data.exposure.sector_weightings} visibleCount={8} />
                  </div>
                )}
                <p className="text-[12px] mb-1 flex items-start gap-1.5" style={{ color: "var(--sub)" }}>
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{describeHoldingsCaveat(lang)}
                </p>
                <p className="text-[12px] flex items-start gap-1.5" style={{ color: "var(--sub)" }}>
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{describeHoldingsUnavailableNote(lang)}
                </p>
              </PillarSection>
            </GlowCard>

            {/* 5. Geografía — países + nota fija domicilio≠ingresos +
                metodología ampliable. */}
            {data.exposure.country_weightings.length > 0 && (
              <GlowCard>
                <div id="etf-section-geografia" />
                <PillarSection title={t("etf.detail.invests.byCountry")} icon={<Globe2 className="w-4 h-4" style={{ color: GOLD }} />} iconColor={GOLD}>
                  <p className="text-[13.5px] leading-relaxed mb-3" style={{ color: "var(--text)" }}>{describeGeographyNote(lang)}</p>
                  <WeightList items={data.exposure.country_weightings} visibleCount={6} />
                </PillarSection>
              </GlowCard>
            )}

            {/* 6. Costos */}
            <GlowCard>
              <div id="etf-section-costos" />
              <PillarSection title={t("etf.detail.costs.title")} icon={<DollarSign className="w-4 h-4" style={{ color: GOLD }} />} iconColor={GOLD}>
                <p className="text-[13px] leading-relaxed mb-3" style={{ color: "var(--sub)" }}>
                  {t("etf.detail.costs.explanationIntro")}
                  {data.costs.expense_ratio_pct != null && t("etf.detail.costs.example", { amount: ((10000 * data.costs.expense_ratio_pct) / 100).toFixed(2) })}
                  {t("etf.detail.costs.disclaimer")}
                </p>
                {data.costs.cost_tier && (
                  <p className="text-[12px]" style={{ color: "var(--sub)" }}>{t(`etf.detail.costs.tier.${data.costs.cost_tier}`, data.costs.cost_tier)}</p>
                )}
                {data.data_quality.suspicious_expense_ratio && (
                  <p className="text-[13px] leading-relaxed mt-2 flex items-start gap-2" style={{ color: "var(--text)" }}>
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#E0A030" }} />{t("etf.detail.costs.suspicious")}
                  </p>
                )}
              </PillarSection>
            </GlowCard>

            {/* 7. Evolución histórica */}
            <GlowCard>
              <PillarSection title={t("etf.detail.performance.title")} icon={<TrendingUp className="w-4 h-4" style={{ color: GOLD }} />} iconColor={GOLD}>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                  <RaisedTile>
                    <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--sub)" }}>{t("etf.detail.performance.currentPrice")}</p>
                    <p className="text-xl font-black" style={{ color: "var(--text)" }}>{data.price.current != null ? `$${data.price.current.toFixed(2)}` : na}</p>
                  </RaisedTile>
                  {[
                    { key: "ytd", label: t("etf.detail.performance.ytd"), pct: data.price.returns.ytd_pct },
                    { key: "1y", label: t("etf.detail.performance.oneYear"), pct: data.price.returns.one_year_pct },
                    { key: "5y", label: t("etf.detail.performance.fiveYear"), pct: data.price.returns.five_year_pct },
                    {
                      key: "max",
                      label: data.price.returns.max_is_full_history
                        ? t("etf.detail.performance.maxFullHistory")
                        : t("etf.detail.performance.maxCapped", { years: 10 }),
                      pct: data.price.returns.max_pct,
                    },
                  ].filter((w) => w.pct !== null).map((w) => (
                    <RaisedTile key={w.key}>
                      <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--sub)" }}>{w.label}</p>
                      <p className="text-xl font-black" style={{ color: (w.pct ?? 0) >= 0 ? "#4CAF50" : "#E05252" }}>
                        {fmtPct(w.pct, na)}
                      </p>
                    </RaisedTile>
                  ))}
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

            {/* 8. Riesgos y horizonte — solo señales de calidad de datos,
                nunca repite concentración (ya está en Composición). */}
            {hasRiskNotes && (
              <GlowCard>
                <PillarSection title={t("etf.detail.risks.title")} icon={<AlertTriangle className="w-4 h-4" style={{ color: "#E0A030" }} />} iconColor="#E0A030">
                  <div className="space-y-2.5">
                    {data.price.returns.one_year_pct === null && (
                      <p className="text-[13px] leading-relaxed flex items-start gap-2" style={{ color: "var(--text)" }}>
                        <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#E0A030" }} />
                        {t("etf.detail.risks.limitedHistory")}
                      </p>
                    )}
                  </div>
                </PillarSection>
              </GlowCard>
            )}
            <GlowCard>
              <PillarSection title={t("etf.detail.horizon.title")} icon={<Clock className="w-4 h-4" style={{ color: GOLD }} />} iconColor={GOLD}>
                <p className="text-[13px] leading-relaxed" style={{ color: "var(--text)" }}>{data.horizon_note}</p>
                {horizonExpanded && (
                  <p className="text-[13px] leading-relaxed mt-2" style={{ color: "var(--text)" }}>{data.horizon_note_extended}</p>
                )}
                <button
                  onClick={() => setHorizonExpanded((v) => !v)}
                  className="mt-2 text-[12.5px] font-semibold"
                  style={{ color: GOLD }}
                >
                  {horizonExpanded ? t("etf.detail.horizon.seeLess") : t("etf.detail.horizon.seeMore")}
                </button>
              </PillarSection>
            </GlowCard>

            {/* 9. Fuentes, cobertura y fechas — sin notas metodológicas
                siempre visibles en ningún otro lado, solo aquí. */}
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
