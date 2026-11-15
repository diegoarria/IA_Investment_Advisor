// Nuvos Plus — Fase 9A: Distribución dentro de Portafolio en mobile.
// Mismo backend, mismo contrato y la misma disciplina de honestidad
// financiera que la web (frontend/web/src/components/portfolio/
// PortfolioDistribution.tsx) — este archivo nunca recalcula nada, solo
// re-presenta lo que GET /api/portfolio-exposure/{portfolio_id} y su
// /pulse ya devuelven. "Antes de invertir"/Historia deliberadamente no
// incluidos todavía (fuera del alcance de esta fase).
import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import StockAvatar from "./StockAvatar";
import { portfolioExposureApi } from "../lib/api";
import { useTheme, type Colors } from "../lib/ThemeContext";
import { buildObservationCopy, type PortfolioInsight } from "../lib/primaryInsight";
import { selectResumenObservation, buildPulseObservationCopy, type PulseCompareResult } from "../lib/pulseObservation";
import { buildPositionsSummary } from "../lib/positionsSummary";
import { describeSectorConsequence, describeContributorsExplanation, type SectorContributor } from "../lib/sectorExposureSummary";

const GOLD = "#00e887"; // mismo verde de marca que el resto de la app — nunca el dorado de Radar.

type Position = {
  ticker: string; name: string | null; asset_class: "equity" | "etf" | "unknown";
  shares: number; avg_price: number; cost_basis: number;
  market_value: number | null; verifiable: boolean; unverifiable_reason: string | null;
  quote_currency: string | null; sector: string | null; country: string | null;
  etf_company: string | null; price: number | null; weight_pct: number | null;
};

type ExposureResponse = {
  portfolio_id: string; portfolio_name: string | null; currency: string;
  valuation: {
    total_value_verified: number | null; total_cost_basis_all_positions: number;
    position_count: number; verified_position_count: number; unverifiable_position_count: number;
    valuation_coverage_pct: number | null;
  };
  positions: Position[];
  composition: { equity_value: number; equity_pct: number | null; etf_value: number; etf_pct: number | null; unknown_asset_value_cost_basis: number };
  sector_exposure: {
    by_sector: { sector: string; value: number; pct_of_verified_total: number | null }[];
    coverage_pct: number | null; unclassified_value: number; non_equity_style_value: number; eligible_for_sector_value: number;
  };
  geographic_exposure: {
    by_country: { country: string; value: number; pct_of_asset_class_value: number | null; asset_class_total_value: number; methodology: "equity_domicile" | "etf_underlying" }[];
    equity_domicile_coverage_pct: number | null; etf_underlying_coverage_pct: number | null; etf_non_applicable_value: number; note_es: string;
  };
  insights: PortfolioInsight[];
  unverifiable_positions: { ticker: string; reason: string | null }[];
};

type ScreenMode = "resumen" | "entender";
type Dimension = "posiciones" | "sectores" | "geografia";
type TFunc = (key: string, options?: Record<string, unknown>) => string;

function fmtMoney(n: number | null, currency: string, na: string): string {
  if (n === null || !Number.isFinite(n)) return na;
  return new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number | null, na: string): string {
  if (n === null || !Number.isFinite(n)) return na;
  return `${n.toFixed(1)}%`;
}

export default function PortfolioDistribution({ portfolioId }: { portfolioId: string }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const lang: "es" | "en" = i18n.language?.startsWith("en") ? "en" : "es";
  const na = t("portfolio.distribution.na");

  const [data, setData] = useState<ExposureResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [pulseResult, setPulseResult] = useState<PulseCompareResult | null>(null);
  const [view, setView] = useState<ScreenMode>("resumen");
  const [dimension, setDimension] = useState<Dimension>("posiciones");

  useEffect(() => {
    let cancelled = false;
    setPulseResult(null);
    portfolioExposureApi.getPulse(portfolioId || "default", "month_end")
      .then((res) => { if (!cancelled) setPulseResult(res.data); })
      .catch(() => { if (!cancelled) setPulseResult(null); });
    return () => { cancelled = true; };
  }, [portfolioId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setView("resumen");
    setDimension("posiciones");
    portfolioExposureApi.get(portfolioId || "default")
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => {
        if (cancelled) return;
        const status = err?.response?.status ?? 0;
        const message =
          status === 404 ? t("portfolio.distribution.error.notFound")
          : status === 401 ? t("portfolio.distribution.error.sessionExpired")
          : t("portfolio.distribution.error.generic");
        setError({ status, message });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioId]);

  if (loading) {
    return (
      <View style={{ paddingVertical: 60, alignItems: "center", gap: 10 }}>
        <ActivityIndicator color={GOLD} />
        <Text style={{ color: colors.textMuted, fontSize: 13 }}>{t("portfolio.distribution.loading")}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: "#E0525240" }]}>
        <Ionicons name="warning-outline" size={22} color="#E05252" />
        <Text style={{ color: colors.textSub, fontSize: 13, textAlign: "center", marginTop: 8 }}>{error.message}</Text>
      </View>
    );
  }

  if (!data) return null;

  const { valuation, currency, unverifiable_positions } = data;
  const isEmpty = valuation.position_count === 0;

  if (isEmpty) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: "center" }}>
          {t("portfolio.distribution.summary.emptyPortfolio")}
        </Text>
      </View>
    );
  }

  if (view === "entender") {
    return (
      <EntenderView
        data={data} dimension={dimension} setDimension={setDimension}
        onBack={() => setView("resumen")} colors={colors} t={t} na={na} currency={currency} lang={lang}
      />
    );
  }

  const observation = selectResumenObservation(data.insights, pulseResult);

  return (
    <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderTopWidth: 3, borderTopColor: GOLD }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
          <Text style={{ fontSize: 24, fontWeight: "900", color: colors.text }}>
            {valuation.total_value_verified !== null ? fmtMoney(valuation.total_value_verified, currency, na) : na}
          </Text>
          <Text style={{ fontSize: 12.5, color: colors.textSub }}>
            {t("portfolio.distribution.summary.positionsCount", { count: valuation.position_count })}
          </Text>
        </View>

        {unverifiable_positions.length > 0 && (
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 8 }}>
            <Ionicons name="alert-circle-outline" size={14} color="#E0A030" style={{ marginTop: 1 }} />
            <Text style={{ fontSize: 12, color: "#E0A030", flex: 1 }}>
              {t("portfolio.distribution.summary.unverifiableNote", { count: unverifiable_positions.length })}
            </Text>
          </View>
        )}
      </View>

      {/* Observación principal: Pulse si hay comparación válida y relevante, estática si no */}
      {observation.source === "pulse" && (
        <PulseObservationCard pulse={observation.pulse} lang={lang} colors={colors} />
      )}
      {observation.source === "static" && observation.insight && (
        <StaticObservationCard insight={observation.insight} lang={lang} colors={colors} />
      )}

      <TouchableOpacity
        onPress={() => setView("entender")}
        style={[styles.card, styles.row, { backgroundColor: colors.card, borderColor: colors.border, justifyContent: "space-between" }]}
        activeOpacity={0.8}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: GOLD + "22", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="pie-chart" size={16} color={GOLD} />
          </View>
          <Text style={{ fontSize: 14, fontWeight: "800", color: colors.text }}>
            {t("portfolio.distribution.summary.actionUnderstand")}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    </ScrollView>
  );
}

function PulseObservationCard({ pulse, lang, colors }: { pulse: Extract<PulseCompareResult, { available: true }>; lang: "es" | "en"; colors: Colors }) {
  const copy = buildPulseObservationCopy(pulse, lang);
  if (!copy) return null;
  const up = copy.delta_pp >= 0;
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <Ionicons name="pulse" size={13} color={GOLD} />
        <Text style={{ fontSize: 10.5, fontWeight: "800", color: GOLD, textTransform: "uppercase", letterSpacing: 0.3 }}>Nuvos Pulse</Text>
      </View>
      <Text style={{ fontSize: 14, fontWeight: "700", color: colors.text }}>{copy.headline}</Text>
      <Text style={{ fontSize: 12.5, color: colors.textSub, marginTop: 4 }}>{copy.explanation}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
        <Ionicons name={up ? "arrow-up" : "arrow-down"} size={13} color={up ? colors.up : colors.down} />
        <Text style={{ fontSize: 12, fontWeight: "700", color: up ? colors.up : colors.down }}>
          {fmtPct(copy.before_pct, "—")} → {fmtPct(copy.after_pct, "—")}
        </Text>
      </View>
      <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 6, fontStyle: "italic" }}>{copy.causalityNote}</Text>
    </View>
  );
}

function StaticObservationCard({ insight, lang, colors }: { insight: PortfolioInsight; lang: "es" | "en"; colors: Colors }) {
  const copy = buildObservationCopy(insight, lang);
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={{ fontSize: 14, fontWeight: "700", color: colors.text }}>{copy.headline}</Text>
      {!!copy.explanation && <Text style={{ fontSize: 12.5, color: colors.textSub, marginTop: 4 }}>{copy.explanation}</Text>}
    </View>
  );
}

function EntenderView({ data, dimension, setDimension, onBack, colors, t, na, currency, lang }: {
  data: ExposureResponse; dimension: Dimension; setDimension: (d: Dimension) => void; onBack: () => void;
  colors: Colors; t: TFunc; na: string; currency: string; lang: "es" | "en";
}) {
  const { positions, composition, sector_exposure, geographic_exposure, unverifiable_positions } = data;
  const positionsSummary = buildPositionsSummary(positions, lang);
  const verifiablePositionsCount = positions.filter((p) => p.verifiable).length;
  const singlePositionCase = verifiablePositionsCount <= 1;

  return (
    <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 24 }}>
      <View style={styles.row}>
        <TouchableOpacity onPress={onBack} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
          <Text style={{ fontSize: 13, color: colors.textMuted }}>{t("portfolio.distribution.nav.backToSummary")}</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.segmented, { backgroundColor: colors.bgRaised ?? colors.card, borderColor: colors.border }]}>
        {([
          { key: "posiciones" as const, label: t("portfolio.distribution.dimensionSelector.positions") },
          { key: "sectores" as const, label: t("portfolio.distribution.dimensionSelector.sectors") },
          { key: "geografia" as const, label: t("portfolio.distribution.dimensionSelector.geography") },
        ]).map((o) => (
          <TouchableOpacity
            key={o.key}
            onPress={() => setDimension(o.key)}
            style={[styles.segment, dimension === o.key && { backgroundColor: GOLD }]}
            activeOpacity={0.8}
          >
            <Text style={{ fontSize: 12.5, fontWeight: "800", color: dimension === o.key ? "#04211a" : colors.textMuted }}>{o.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {dimension === "posiciones" && (
        <View style={{ gap: 8 }}>
          {/* Una sola observación educativa de concentración — nunca
              repite la misma cifra en varios párrafos (paridad Web,
              segunda pasada de simplificación). Caso de una sola
              posición: el hecho ya lo dice todo. */}
          {singlePositionCase && positionsSummary.concentrationHeadline && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={{ fontSize: 13, color: colors.text }}>{positionsSummary.concentrationHeadline}</Text>
            </View>
          )}
          {!singlePositionCase && positionsSummary.largestHeadline && (
            <View style={[styles.card, styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {positionsSummary.largestTicker && <StockAvatar ticker={positionsSummary.largestTicker} size={30} />}
              <View style={{ flex: 1, marginLeft: positionsSummary.largestTicker ? 10 : 0 }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.text }}>{positionsSummary.largestHeadline}</Text>
                <Text style={{ fontSize: 12, color: colors.textSub, marginTop: 3 }}>
                  {positionsSummary.largestDetail} {positionsSummary.largestConsequence}
                </Text>
              </View>
            </View>
          )}

          {/* Todas las posiciones — acceso inmediato, nunca se oculta
              ninguna por falta de precio/clasificación. */}
          <Text style={{ fontSize: 11, fontWeight: "800", color: colors.textMuted, textTransform: "uppercase", marginTop: 2 }}>
            {t("portfolio.distribution.positions.allPositionsTitle")}
          </Text>
          {positions.map((p) => (
            <View key={p.ticker} style={[styles.card, styles.row, { backgroundColor: colors.card, borderColor: colors.border, paddingVertical: 10 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                <StockAvatar ticker={p.ticker} size={30} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: colors.text }}>{p.ticker}</Text>
                  <Text style={{ fontSize: 11, color: colors.textMuted }} numberOfLines={1}>{p.name || (p.asset_class === "etf" ? "ETF" : "—")}</Text>
                </View>
              </View>
              {p.verifiable ? (
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: colors.text }}>{fmtMoney(p.market_value, currency, na)}</Text>
                  <Text style={{ fontSize: 11, color: colors.textMuted }}>{fmtPct(p.weight_pct, na)}</Text>
                </View>
              ) : (
                <View style={{ alignItems: "flex-end", maxWidth: 140 }}>
                  <Text style={{ fontSize: 11, color: "#E0A030", fontWeight: "700" }}>{t("portfolio.distribution.unverifiable.badge")}</Text>
                  <Text style={{ fontSize: 10, color: colors.textMuted, textAlign: "right" }} numberOfLines={2}>
                    {t(`portfolio.distribution.unverifiable.reason.${p.unverifiable_reason}`)}
                  </Text>
                </View>
              )}
            </View>
          ))}

          {/* Desglose acciones/ETFs — contexto secundario, después de la
              lista principal (paridad Web). */}
          {composition.equity_pct !== null && composition.etf_pct !== null && (
            <Text style={{ fontSize: 12, color: colors.textSub, marginTop: 4 }}>
              {t("portfolio.distribution.positions.compositionNote", {
                etf: Math.round(composition.etf_pct), equity: Math.round(composition.equity_pct),
              })}
            </Text>
          )}
          {composition.unknown_asset_value_cost_basis > 0 && (
            <Text style={{ fontSize: 11, color: colors.textMuted }}>
              {t("portfolio.distribution.positions.unknownAssetNote", { amount: fmtMoney(composition.unknown_asset_value_cost_basis, currency, na) })}
            </Text>
          )}
        </View>
      )}

      {dimension === "sectores" && (() => {
        const topSector = sector_exposure.by_sector[0] ?? null;
        const otherSectors = sector_exposure.by_sector.slice(1);
        // El desglose de contribuyentes SOLO existe cuando el backend
        // mismo produjo un insight `dominant_sector` (su propio umbral y
        // posiciones verificadas) — nunca se infiere aquí.
        const sectorInsight = data.insights.find((i) => i.category === "dominant_sector") ?? null;
        const contributors = (sectorInsight?.supporting_data.contributors as SectorContributor[] | undefined) ?? [];
        const contributorsExplanation = topSector
          ? describeContributorsExplanation(topSector.sector, contributors, positions, lang)
          : null;

        if (!topSector) {
          return (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={{ color: colors.textMuted, fontSize: 12.5 }}>{t("portfolio.distribution.sectors.empty")}</Text>
            </View>
          );
        }

        return (
          <View style={{ gap: 10 }}>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {topSector.pct_of_verified_total !== null ? (
                <>
                  {/* Una sola cifra protagonista, no tres repeticiones del
                      mismo número. */}
                  <Text style={{ fontSize: 20, fontWeight: "900", color: colors.text, marginBottom: 8 }}>
                    {topSector.pct_of_verified_total.toFixed(1)}% {topSector.sector}
                  </Text>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.bgRaised ?? colors.border, overflow: "hidden" }}>
                    <View style={{ height: 6, width: `${Math.max(2, topSector.pct_of_verified_total)}%`, backgroundColor: GOLD, borderRadius: 3 }} />
                  </View>
                  {/* Consecuencia educativa — ambas direcciones, nunca una
                      predicción ni un umbral arbitrario de "buena/mala"
                      concentración. */}
                  <Text style={{ fontSize: 12.5, color: colors.textSub, marginTop: 10, lineHeight: 18 }}>
                    {describeSectorConsequence(topSector.sector, lang)}
                  </Text>

                  {contributors.length > 0 ? (
                    <View style={{ marginTop: 12, gap: 8 }}>
                      <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.text }}>
                        {t("portfolio.distribution.sectors.contributorsTitle", { sector: topSector.sector })}
                      </Text>
                      {contributors.map((c) => (
                        <View key={c.ticker} style={{ gap: 4 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <StockAvatar ticker={c.ticker} size={26} />
                            <Text style={{ fontSize: 12.5, color: colors.text, flex: 1 }} numberOfLines={1}>{c.name || c.ticker}</Text>
                            <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.textSub }}>{c.contribution_pct_points.toFixed(1)}pp</Text>
                          </View>
                          <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.bgRaised ?? colors.border, overflow: "hidden" }}>
                            <View style={{ height: 5, width: `${Math.max(2, c.contribution_pct_points)}%`, backgroundColor: GOLD, borderRadius: 3 }} />
                          </View>
                        </View>
                      ))}
                      <Text style={{ fontSize: 10.5, color: colors.textMuted }}>{t("portfolio.distribution.sectors.contributorsClarification")}</Text>
                      {contributorsExplanation && (
                        <Text style={{ fontSize: 12, color: colors.text, lineHeight: 17 }}>{contributorsExplanation}</Text>
                      )}
                    </View>
                  ) : (
                    <Text style={{ fontSize: 12, color: colors.textSub, marginTop: 10 }}>{t("portfolio.distribution.sectors.contributorsUnavailable")}</Text>
                  )}
                </>
              ) : (
                <Text style={{ fontSize: 12.5, color: colors.textSub }}>{t("portfolio.distribution.sectors.noDominantSector")}</Text>
              )}
            </View>

            <Expandable title={t("portfolio.distribution.sectors.seeAllSectors")} colors={colors}>
              <Text style={{ fontSize: 11, color: colors.textMuted }}>
                {t("portfolio.distribution.sectors.verifiedUniverseNote", { pct: fmtPct(sector_exposure.coverage_pct, na) })}
              </Text>
              {otherSectors.map((row) => (
                <View key={row.sector} style={{ gap: 4 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 12.5, color: colors.text }}>{row.sector}</Text>
                    <Text style={{ fontSize: 12.5, color: colors.textSub }}>{fmtPct(row.pct_of_verified_total, na)}</Text>
                  </View>
                  <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.bgRaised ?? colors.border, overflow: "hidden" }}>
                    <View style={{ height: 5, width: `${Math.max(2, row.pct_of_verified_total ?? 0)}%`, backgroundColor: colors.border, borderRadius: 3 }} />
                  </View>
                </View>
              ))}
              {sector_exposure.non_equity_style_value > 0 && (
                <Text style={{ fontSize: 11, color: colors.textMuted }}>
                  {t("portfolio.distribution.sectors.nonEquityStyleNote", { amount: fmtMoney(sector_exposure.non_equity_style_value, currency, na) })}
                </Text>
              )}
              {sector_exposure.unclassified_value > 0 && (
                <Text style={{ fontSize: 11, color: colors.textMuted }}>
                  {t("portfolio.distribution.sectors.unclassifiedNote", { amount: fmtMoney(sector_exposure.unclassified_value, currency, na) })}
                </Text>
              )}
            </Expandable>
          </View>
        );
      })()}

      {dimension === "geografia" && (
        <View style={{ gap: 14 }}>
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 11, fontWeight: "800", color: colors.textMuted, textTransform: "uppercase" }}>
              {t("portfolio.distribution.geography.etfUnderlying")} · {fmtPct(geographic_exposure.etf_underlying_coverage_pct, na)}
            </Text>
            {geographic_exposure.by_country.filter((r) => r.methodology === "etf_underlying").length === 0 ? (
              <Text style={{ fontSize: 12, color: colors.textMuted }}>{t("portfolio.distribution.geography.empty")}</Text>
            ) : geographic_exposure.by_country.filter((r) => r.methodology === "etf_underlying").map((row) => (
              <CountryBar key={`etf-${row.country}`} row={row} colors={colors} na={na} />
            ))}
          </View>
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 11, fontWeight: "800", color: colors.textMuted, textTransform: "uppercase" }}>
              {t("portfolio.distribution.geography.equityDomicile")} · {fmtPct(geographic_exposure.equity_domicile_coverage_pct, na)}
            </Text>
            {geographic_exposure.by_country.filter((r) => r.methodology === "equity_domicile").length === 0 ? (
              <Text style={{ fontSize: 12, color: colors.textMuted }}>{t("portfolio.distribution.geography.empty")}</Text>
            ) : geographic_exposure.by_country.filter((r) => r.methodology === "equity_domicile").map((row) => (
              <CountryBar key={`eq-${row.country}`} row={row} colors={colors} na={na} />
            ))}
          </View>
          {geographic_exposure.etf_non_applicable_value > 0 && (
            <Text style={{ fontSize: 11, color: colors.textMuted }}>
              {t("portfolio.distribution.geography.nonApplicableNote", { amount: fmtMoney(geographic_exposure.etf_non_applicable_value, currency, na) })}
            </Text>
          )}
          {/* Metodología expandible — domicilio de acciones vs. activos
              subyacentes de ETFs, nunca se infieren ingresos regionales
              del domicilio (paridad Web). */}
          <Expandable title={t("portfolio.distribution.geography.whatThisMeansToggle")} colors={colors}>
            <Text style={{ fontSize: 12, color: colors.textSub, lineHeight: 17 }}>{t("portfolio.distribution.geography.methodologyNote")}</Text>
          </Expandable>
        </View>
      )}

      {unverifiable_positions.length > 0 && (
        <View style={{ gap: 4, marginTop: 4 }}>
          <Text style={{ fontSize: 12.5, fontWeight: "800", color: colors.text }}>{t("portfolio.distribution.unverifiable.title")}</Text>
          {unverifiable_positions.map((u) => (
            <Text key={u.ticker} style={{ fontSize: 12, color: colors.textSub }}>
              {u.ticker} — {t(`portfolio.distribution.unverifiable.reason.${u.reason}`)}
            </Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// Toggle genérico "ver más" — mismo patrón ya usado en la ficha ETF
// (app/etf/[ticker].tsx) y equivalente a <ExpandableSection> en Web; no
// existe todavía un componente compartido para esto en mobile.
function Expandable({ title, colors, children }: { title: string; colors: Colors; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <TouchableOpacity onPress={() => setOpen((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons name={open ? "chevron-down" : "chevron-forward"} size={13} color={colors.textMuted} />
        <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.textMuted }}>{title}</Text>
      </TouchableOpacity>
      {open && <View style={{ marginTop: 8, gap: 6 }}>{children}</View>}
    </View>
  );
}

function CountryBar({ row, colors, na }: { row: { country: string; pct_of_asset_class_value: number | null }; colors: Colors; na: string }) {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 12.5, color: colors.text }}>{row.country}</Text>
        <Text style={{ fontSize: 12.5, color: colors.textSub }}>{fmtPct(row.pct_of_asset_class_value, na)}</Text>
      </View>
      <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.bgRaised ?? colors.border, overflow: "hidden" }}>
        <View style={{ height: 5, width: `${Math.max(2, row.pct_of_asset_class_value ?? 0)}%`, backgroundColor: GOLD, borderRadius: 3 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 14, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center" },
  segmented: { flexDirection: "row", borderRadius: 12, padding: 3, borderWidth: 1, gap: 2 },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
});
