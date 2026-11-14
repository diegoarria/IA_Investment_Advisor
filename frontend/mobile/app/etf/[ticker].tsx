// Fase 9C §3 + paridad Web→Mobile (2026-11): ficha individual de ETF —
// mismo contrato que frontend/web/src/app/etf/[ticker]/page.tsx
// (GET /api/etf/{ticker}). Nunca recalcula nada: solo re-presenta lo que
// el backend ya validó (insights rule-based, nunca IA; sector/país null
// → "No disponible", nunca una barra vacía/0%). Estructura y copy
// educativo replican exactamente el rediseño final de Web: una sola
// observación principal (sin números, sin repetir el dato que ya vive en
// la sección anclada), Composición/Geografía/Costos separados, y
// YTD/1A/5A/Máx en vez de un único "días de historial".
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, SafeAreaView, LayoutChangeEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme, type Colors } from "../../src/lib/ThemeContext";
import { etfApi } from "../../src/lib/api";
import StockAvatar from "../../src/components/StockAvatar";
import { formatWeightPct, costTierColor, formatUnixTimestamp } from "../../src/lib/etfFormat";
import {
  selectPrimaryObservation, anchorForInsight, primaryObservationIntro, describeSectorConcentration,
  describeGeographyNote, describeHoldingsCaveat, describeHoldingsUnavailableNote, type Insight,
} from "../../src/lib/etfDetailCopy";

const GOLD = "#00e887";

type WeightRow = { name: string; weight_pct: number | null };
type SectorDiv = { top1_name: string | null; top1_weight_pct: number | null; top3_weight_pct: number | null; bucket_count: number };
type EtfOverview = {
  ticker: string;
  identification: { name?: string | null; etf_company?: string | null; description?: string | null; has_editorial_description?: boolean; inception_date?: string | null; domicile?: string | null; exchange?: string | null };
  costs: { expense_ratio_pct: number | null; cost_tier: string | null; aum_usd: number | null };
  exposure: { sector_weightings: WeightRow[]; country_weightings: WeightRow[]; holdings_count: number | null };
  diversification: { by_sector: SectorDiv; by_country: SectorDiv };
  price: {
    current: number | null;
    returns: {
      ytd_pct: number | null; one_year_pct: number | null; five_year_pct: number | null;
      max_pct: number | null; max_start_date: string | null; max_is_full_history: boolean;
    };
  };
  dividends: { recent: { ex_date: string; amount: number | null; yield_pct: number | null }[]; latest_yield_pct: number | null };
  data_quality: { structural_fetched_at?: number | null; price_fetched_at?: number | null; missing_fields: string[]; suspicious_expense_ratio?: boolean };
  insights: Insight[];
  horizon_note: string;
  horizon_note_extended?: string | null;
};

function WeightList({ rows, limit, na, colors }: { rows: WeightRow[]; limit: number; na: string; colors: Colors }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();
  const visible = expanded ? rows : rows.slice(0, limit);
  const restCount = rows.length - limit;
  const restSum = !expanded && restCount > 0 ? rows.slice(limit).reduce((s, r) => s + (r.weight_pct ?? 0), 0) : null;
  return (
    <View style={{ gap: 6 }}>
      {visible.map((r, i) => (
        <View key={`${r.name}-${i}`} style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 12, color: colors.text, flex: 1 }} numberOfLines={1}>{r.name}</Text>
          <Text style={{ fontSize: 12, color: colors.textSub, fontWeight: "700" }}>{formatWeightPct(r.weight_pct, na)}</Text>
        </View>
      ))}
      {!expanded && restCount > 0 && (
        <TouchableOpacity onPress={() => setExpanded(true)}>
          <Text style={{ fontSize: 11.5, color: GOLD, fontWeight: "700" }}>
            {t("etf.detail.invests.others", { count: restCount })}{restSum !== null ? ` (${restSum.toFixed(1)}%)` : ""}
          </Text>
        </TouchableOpacity>
      )}
      {expanded && rows.length > limit && (
        <TouchableOpacity onPress={() => setExpanded(false)}>
          <Text style={{ fontSize: 11.5, color: GOLD, fontWeight: "700" }}>{t("etf.detail.invests.seeLess")}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function EtfDetailScreen() {
  const { ticker: rawTicker } = useLocalSearchParams<{ ticker: string }>();
  const ticker = (rawTicker ?? "").toUpperCase();
  const { t, i18n } = useTranslation();
  const lang: "es" | "en" = i18n.language?.startsWith("en") ? "en" : "es";
  const { colors } = useTheme();
  const st = useMemo(() => styles(colors), [colors]);
  const na = t("etf.detail.notAvailable");

  const [data, setData] = useState<EtfOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [horizonExpanded, setHorizonExpanded] = useState(false);

  // Tipado como `any`: el mismo gap de tipos de refs de ScrollView/View ya
  // presente en otras pantallas de esta versión de Expo/RN (ver
  // app/(tabs)/support.tsx, app/wrapped.tsx) — no es un error nuevo de
  // este archivo.
  const scrollRef = useRef<any>(null);
  const sectionY = useRef<Record<string, number>>({});
  const onSectionLayout = (anchor: string) => (e: LayoutChangeEvent) => {
    sectionY.current[anchor] = e.nativeEvent.layout.y;
  };
  const scrollToAnchor = (anchor: string | null) => {
    if (!anchor) return;
    const y = sectionY.current[anchor];
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
  };

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    etfApi.getOverview(ticker, i18n.language === "en" ? "en" : "es")
      .then((res) => setData(res.data))
      .catch((err) => {
        const status = err?.response?.status ?? 0;
        if (status === 422) setError(err?.response?.data?.detail?.message ?? t("etf.detail.error.notEtf", { ticker }));
        else if (status === 400) setError(t("etf.detail.error.invalidTicker", { ticker }));
        else setError(t("etf.detail.error.generic"));
      })
      .finally(() => setLoading(false));
  }, [ticker, i18n.language]);

  const primaryObservation = data ? selectPrimaryObservation(data.insights) : null;
  const primaryAnchor = primaryObservation ? anchorForInsight(primaryObservation) : null;
  const sectorNote = data ? describeSectorConcentration(data.diversification.by_sector, lang) : null;

  const returnTiles = data ? [
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
  ].filter((w) => w.pct !== null) : [];

  const hasRiskNotes = data && (data.data_quality.suspicious_expense_ratio || data.price.returns.one_year_pct === null);

  return (
    <SafeAreaView style={st.container}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.back()} style={st.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={st.headerTitle} numberOfLines={1}>{ticker}</Text>
        <View style={{ width: 30 }} />
      </View>

      {loading && (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={GOLD} />
          <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 8 }}>{t("etf.detail.loading", { ticker })}</Text>
        </View>
      )}

      {!loading && error && (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 20 }}>
          <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: "center" }}>{error}</Text>
        </View>
      )}

      {!loading && !error && data && (
        <ScrollView ref={scrollRef} contentContainerStyle={st.content}>
          {/* Identidad — hasta 2 líneas en el nombre, nunca cortado a
              mitad de palabra. */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <StockAvatar ticker={data.ticker} size={44} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ fontSize: 16, fontWeight: "900", color: colors.text }}>{data.ticker}</Text>
                <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: `${GOLD}22` }}>
                  <Text style={{ fontSize: 9.5, fontWeight: "800", color: GOLD }}>{t("etf.detail.etfBadge")}</Text>
                </View>
              </View>
              {!!data.identification.name && <Text style={{ fontSize: 12.5, color: colors.textSub }} numberOfLines={2}>{data.identification.name}</Text>}
            </View>
          </View>

          <Text style={{ fontSize: 12.5, color: colors.textSub, lineHeight: 18, marginTop: 10 }}>
            {data.identification.description || t("etf.detail.noDescription")}
          </Text>

          <View style={{ flexDirection: "row", gap: 14, marginTop: 10, flexWrap: "wrap" }}>
            {!!data.identification.etf_company && <Text style={st.metaText}>{t("etf.detail.summary.manager")}: {data.identification.etf_company}</Text>}
            {!!data.identification.exchange && <Text style={st.metaText}>{t("etf.detail.summary.exchange")}: {data.identification.exchange}</Text>}
            {!!data.identification.inception_date && <Text style={st.metaText}>{t("etf.detail.summary.since")}: {data.identification.inception_date}</Text>}
          </View>

          <TouchableOpacity
            onPress={() => router.push(`/etf/compare?tickers=${encodeURIComponent(data.ticker)}` as any)}
            activeOpacity={0.85}
            style={st.compareCta}
          >
            <Ionicons name="git-compare-outline" size={14} color="#04211a" />
            <Text style={{ fontSize: 12, fontWeight: "800", color: "#04211a" }}>{t("etf.compare.ctaFromDetail")}</Text>
          </TouchableOpacity>

          {/* Métricas principales — AUM en vez de país dominante (el país
              dominante vive solo en Geografía, nunca repetido aquí). */}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <MetricTile label={t("etf.detail.metrics.expenseRatio")} value={formatWeightPct(data.costs.expense_ratio_pct, na)} colors={colors} />
            <MetricTile label={t("etf.detail.metrics.holdingsCount")} value={data.exposure.holdings_count != null ? String(data.exposure.holdings_count) : na} colors={colors} />
            <MetricTile label={t("etf.detail.metrics.dominantSector")} value={data.diversification.by_sector.top1_name ?? na} colors={colors} />
            <MetricTile label={t("etf.detail.metrics.aum")} value={data.costs.aum_usd != null ? `$${(data.costs.aum_usd / 1e9).toFixed(1)}B` : na} colors={colors} />
          </View>

          {/* Observación principal — UNA sola, sin números (el dato real
              vive en la sección anclada), nunca el texto crudo del
              backend. */}
          {primaryObservation && (
            <View style={[st.card, { marginTop: 14, borderColor: GOLD }]}>
              <Text style={{ fontSize: 10.5, fontWeight: "900", color: GOLD, textTransform: "uppercase", letterSpacing: 0.3 }}>
                {t("etf.detail.understand.title")}
              </Text>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.text, lineHeight: 19, marginTop: 4 }}>
                {primaryObservationIntro(primaryObservation, lang)}
              </Text>
              {!!primaryAnchor && (
                <TouchableOpacity onPress={() => scrollToAnchor(primaryAnchor)} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: GOLD }}>{t("etf.detail.understand.seeData")}</Text>
                  <Ionicons name="arrow-forward" size={12} color={GOLD} />
                </TouchableOpacity>
              )}
              <Text style={[st.disclaimerText, { marginTop: 8 }]}>{t("etf.detail.understand.disclaimer")}</Text>
            </View>
          )}
          {!data.insights.length && (
            <Text style={[st.mutedText, { marginTop: 14 }]}>{t("etf.detail.understand.empty")}</Text>
          )}

          {/* Composición — sectores + concentración real + caveats de
              holdings, una sola vez, aquí. */}
          <View onLayout={onSectionLayout("etf-section-composicion")}>
            <Section title={t("etf.detail.invests.title")} colors={colors}>
              {!!sectorNote && <Text style={st.mutedText}>{sectorNote}</Text>}
              {data.exposure.sector_weightings.length === 0
                ? <Text style={st.mutedText}>{na}</Text>
                : <WeightList rows={data.exposure.sector_weightings} limit={8} na={na} colors={colors} />}
              <Text style={[st.disclaimerText, { marginTop: 6 }]}>{describeHoldingsCaveat(lang)}</Text>
              <Text style={st.disclaimerText}>{describeHoldingsUnavailableNote(lang)}</Text>
            </Section>
          </View>

          {/* Geografía — propia, con nota fija domicilio≠ingresos; se
              omite por completo (no una vacía) si no hay datos. */}
          {data.exposure.country_weightings.length > 0 && (
            <View onLayout={onSectionLayout("etf-section-geografia")}>
              <Section title={t("etf.detail.invests.byCountry")} colors={colors}>
                <Text style={st.mutedText}>{describeGeographyNote(lang)}</Text>
                <WeightList rows={data.exposure.country_weightings} limit={6} na={na} colors={colors} />
              </Section>
            </View>
          )}

          {/* Costos — sin repetir AUM (ya está en la tarjeta de métricas). */}
          <View onLayout={onSectionLayout("etf-section-costos")}>
            <Section title={t("etf.detail.costs.title")} colors={colors}>
              <View style={st.card}>
                <Text style={st.subhead}>{t("etf.detail.costs.expenseRatio")}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
                  <Text style={{ fontSize: 16, fontWeight: "900", color: colors.text }}>{formatWeightPct(data.costs.expense_ratio_pct, na)}</Text>
                  {!!data.costs.cost_tier && (
                    <Text style={{ fontSize: 11, fontWeight: "700", color: costTierColor(data.costs.cost_tier) }}>
                      {t(`etf.detail.costs.tier.${data.costs.cost_tier}`)}
                    </Text>
                  )}
                </View>
                <Text style={st.mutedText}>
                  {t("etf.detail.costs.explanationIntro")}
                  {data.costs.expense_ratio_pct != null && t("etf.detail.costs.example", { amount: ((10000 * data.costs.expense_ratio_pct) / 100).toFixed(2) })}
                </Text>
                <Text style={st.disclaimerText}>{t("etf.detail.costs.disclaimer")}</Text>
                {!!data.data_quality.suspicious_expense_ratio && <Text style={{ fontSize: 11, color: "#E0A030", marginTop: 4 }}>{t("etf.detail.costs.suspicious")}</Text>}
              </View>
            </Section>
          </View>

          {/* Evolución histórica — YTD/1A/5A/Máx, cada ventana
              independiente (null si no hay suficiente historial real para
              ESA ventana específicamente), nunca una sola "variación de
              precio" ambigua. */}
          <Section title={t("etf.detail.performance.title")} colors={colors}>
            <View style={st.card}>
              <Text style={st.mutedText}>{t("etf.detail.performance.currentPrice")}: {data.price.current != null ? `$${data.price.current.toFixed(2)}` : na}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                {returnTiles.map((w) => (
                  <View key={w.key} style={{ flexBasis: "47%" }}>
                    <Text style={{ fontSize: 10.5, color: colors.textMuted, fontWeight: "700" }} numberOfLines={1}>{w.label}</Text>
                    <Text style={{ fontSize: 15, fontWeight: "900", color: (w.pct ?? 0) >= 0 ? "#4CAF50" : "#E05252" }}>
                      {formatWeightPct(w.pct, na)}
                    </Text>
                  </View>
                ))}
              </View>
              <Text style={st.disclaimerText}>{t("etf.detail.performance.priceOnlyDisclaimer")}</Text>
              {data.dividends.recent.length > 0 && (
                <View style={{ marginTop: 8 }}>
                  <Text style={st.subhead}>
                    {t("etf.detail.performance.recentDividends")}
                    {data.dividends.latest_yield_pct != null ? t("etf.detail.performance.currentYield", { pct: formatWeightPct(data.dividends.latest_yield_pct, na) }) : ""}
                  </Text>
                  {data.dividends.recent.slice(0, 4).map((d, i) => (
                    <Text key={i} style={st.mutedText}>{d.ex_date} · {d.amount != null ? `$${d.amount.toFixed(3)}` : na}</Text>
                  ))}
                </View>
              )}
            </View>
          </Section>

          {/* Riesgos — solo si corresponde; "poco historial" ahora se basa
              en que la ventana de 1 año honestamente no tiene dato, no en
              un conteo de días que ya no existe en el contrato. */}
          {hasRiskNotes && (
            <Section title={t("etf.detail.risks.title")} colors={colors}>
              <View style={st.card}>
                {data.price.returns.one_year_pct === null && (
                  <Text style={st.mutedText}>{t("etf.detail.risks.limitedHistory")}</Text>
                )}
                <Text style={st.disclaimerText}>{t("etf.detail.risks.disclaimer")}</Text>
              </View>
            </Section>
          )}

          {/* Horizonte — texto breve + "ver más" con el detalle extendido;
              degrada con seguridad si el backend no manda
              horizon_note_extended todavía. */}
          <Section title={t("etf.detail.horizon.title")} colors={colors}>
            <Text style={st.mutedText}>{data.horizon_note}</Text>
            {horizonExpanded && !!data.horizon_note_extended && (
              <Text style={[st.mutedText, { marginTop: 6 }]}>{data.horizon_note_extended}</Text>
            )}
            {!!data.horizon_note_extended && (
              <TouchableOpacity onPress={() => setHorizonExpanded((v) => !v)} style={{ marginTop: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: GOLD }}>
                  {horizonExpanded ? t("etf.detail.horizon.seeLess") : t("etf.detail.horizon.seeMore")}
                </Text>
              </TouchableOpacity>
            )}
          </Section>

          {/* Pie — structural/price_fetched_at son timestamps Unix
              (time.time() en el backend), nunca una fecha ya formateada;
              se formatean aquí, nunca se interpola el float crudo. */}
          <Text style={st.footerText}>{t("etf.detail.footer.source")}</Text>
          {(() => { const d = formatUnixTimestamp(data.data_quality.structural_fetched_at, i18n.language === "en" ? "en" : "es"); return d ? (
            <Text style={st.footerText}>{t("etf.detail.footer.structuralUpdated", { date: d })}</Text>
          ) : null; })()}
          {(() => { const d = formatUnixTimestamp(data.data_quality.price_fetched_at, i18n.language === "en" ? "en" : "es"); return d ? (
            <Text style={st.footerText}>{t("etf.detail.footer.priceUpdated", { date: d })}</Text>
          ) : null; })()}
          {data.data_quality.missing_fields.length > 0 && (
            <Text style={st.footerText}>{t("etf.detail.footer.missingFields", { fields: data.data_quality.missing_fields.join(", ") })}</Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Section({ title, colors, children }: { title: string; colors: Colors; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 18, gap: 8 }}>
      <Text style={{ fontSize: 14, fontWeight: "800", color: colors.text }}>{title}</Text>
      {children}
    </View>
  );
}

function MetricTile({ label, value, colors }: { label: string; value: string; colors: Colors }) {
  return (
    <View style={{ flexBasis: "47%", borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 10 }}>
      <Text style={{ fontSize: 10, color: colors.textMuted, textTransform: "uppercase", fontWeight: "800" }} numberOfLines={1}>{label}</Text>
      <Text style={{ fontSize: 13, color: colors.text, fontWeight: "800", marginTop: 3 }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8 },
  backBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 15, fontWeight: "800", color: c.text },
  content: { padding: 14, paddingBottom: 40 },
  metaText: { fontSize: 11, color: c.textMuted },
  card: { borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, padding: 12, gap: 4 },
  subhead: { fontSize: 11.5, fontWeight: "800", color: c.textSub, textTransform: "uppercase" },
  mutedText: { fontSize: 12, color: c.textSub, lineHeight: 17 },
  disclaimerText: { fontSize: 10.5, color: c.textMuted, fontStyle: "italic" },
  footerText: { fontSize: 10, color: c.textDim, marginTop: 4 },
  compareCta: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: GOLD, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, alignSelf: "flex-start", marginTop: 10 },
});
