// Nuvos Plus — Fase 9B: "Antes de invertir" en mobile. Mismos endpoints
// y el mismo contrato que la web (frontend/web/src/components/portfolio/
// BeforeAfterSimulator.tsx) — estrictamente de solo lectura, nunca
// escribe en el portafolio real, nunca recalcula una fórmula financiera
// aquí. Montado una sola vez por el padre (ver portfolio.tsx's
// `simulatorOpened`) y nunca desmontado después, para conservar el
// escenario hipotético al cambiar de sección — mismo patrón que web.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { marketApi } from "../lib/api";
import { portfolioExposureApi } from "../lib/api";
import { useTheme, type Colors } from "../lib/ThemeContext";
import StockAvatar from "./StockAvatar";
import HistoryComparisonChart from "./HistoryComparisonChart";
import type { HistoryPoint } from "../lib/historyChartDownsample";
import { createRequestGuard } from "../lib/requestGuard";
import { buildSimulationInsights, type SimulationResult } from "../lib/simulationInsights";

const GOLD = "#00e887";
const DEBOUNCE_MS = 350;

type SearchResult = { ticker: string; name?: string | null };
type Perspective = "distribution" | "exposure" | "history";
type HistoryPeriod = "1y" | "3y" | "5y";

type SectorDelta = { sector: string; pct_before: number; pct_after: number; delta_pct_points: number };
type CountryDelta = { country: string; methodology: "equity_domicile" | "etf_underlying"; pct_before: number; pct_after: number; delta_pct_points: number };

// Mismo endpoint que Web (POST /{portfolio_id}/simulate) — el backend ya
// devuelve el shape completo de SimulationResult (positions, sector_exposure,
// concentration por before/after); SimulateResult solo re-declara los
// campos que este archivo usa directamente fuera de buildSimulationInsights.
// Nunca una llamada nueva: `SimulationResult` se usa tal cual para pasar el
// MISMO objeto ya recibido a buildSimulationInsights (lib/simulationInsights.ts,
// port exacto de Web).
type SimulateResult = SimulationResult & {
  before: SimulationResult["before"] & { valuation: { total_value_verified: number | null } };
  after: SimulationResult["after"] & { valuation: { total_value_verified: number | null } };
  sector_deltas: SectorDelta[];
  country_deltas: CountryDelta[];
  before_had_no_verified_positions: boolean;
};

type HistoryResult = {
  available: true;
  period_requested: HistoryPeriod;
  window_status: "full" | "partial";
  start_date: string;
  end_date: string;
  index_before: HistoryPoint[];
  index_after: HistoryPoint[];
  volatility_before: { value: number | null; observations?: number; reason?: string };
  volatility_after: { value: number | null; observations?: number; reason?: string };
  max_drawdown_before: { value: number | null; peak_date?: string; trough_date?: string };
  max_drawdown_after: { value: number | null; peak_date?: string; trough_date?: string };
  fetch_warnings: Record<string, string[]>;
  methodology_es: string;
  disclaimer_es: string;
} | { available: false; reason: string };

function fmtPct(n: number | null | undefined, na: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return na;
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}pp`;
}

function fmtMoney(n: number | null | undefined, currency: string, na: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return na;
  return `${currency} $${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function BeforeAfterSimulator({ portfolioId, currency }: { portfolioId: string; currency: string }) {
  const { t, i18n } = useTranslation();
  const lang: "es" | "en" = i18n.language?.startsWith("en") ? "en" : "es";
  const { colors } = useTheme();
  const na = t("portfolio.distribution.na");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [amountInput, setAmountInput] = useState("");

  const [simResult, setSimResult] = useState<SimulateResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [simulatedFor, setSimulatedFor] = useState<{ ticker: string; amount: number } | null>(null);

  const [perspective, setPerspective] = useState<Perspective>("distribution");
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>("1y");
  const [historyResult, setHistoryResult] = useState<HistoryResult | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyCacheRef = useRef<Map<string, HistoryResult>>(new Map());
  // Fase 9C §1: guardias puras contra respuestas HTTP obsoletas — una
  // por cada llamada asíncrona independiente. Una respuesta de /simulate
  // o /simulate-history que llega después de que el usuario cambió de
  // portafolio (o disparó una simulación nueva) nunca debe mezclarse con
  // el estado actual.
  const simGuardRef = useRef(createRequestGuard());
  const historyGuardRef = useRef(createRequestGuard());

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fase 9B §5: cambiar de PORTAFOLIO invalida cualquier resultado del
  // portafolio anterior — nunca mezclar datos de dos portafolios. Un
  // cambio de SECCIÓN (Posiciones/Distribución/Antes de invertir) nunca
  // pasa por aquí porque el padre nunca desmonta este componente.
  useEffect(() => {
    setSelected(null);
    setAmountInput("");
    setSimResult(null);
    setSimError(null);
    setSimulatedFor(null);
    setPerspective("distribution");
    setHistoryResult(null);
    setHistoryError(null);
    historyCacheRef.current.clear();
    // Fase 9C §1: cualquier /simulate o /simulate-history todavía en
    // vuelo para el portafolio ANTERIOR deja de ser vigente aquí mismo,
    // aunque su respuesta llegue después de este efecto.
    simGuardRef.current.invalidate();
    historyGuardRef.current.invalidate();
  }, [portfolioId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) { setResults(null); return; }
    debounceRef.current = setTimeout(() => {
      setSearching(true);
      marketApi.searchTickers(q)
        .then((res) => setResults(res.data?.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const amountNum = parseFloat(amountInput.replace(",", "."));
  const amountValid = amountInput.trim() !== "" && Number.isFinite(amountNum) && amountNum > 0;

  const runSimulation = () => {
    if (!selected || !amountValid) return;
    const reqId = simGuardRef.current.next();
    setSimLoading(true);
    setSimError(null);
    setPerspective("distribution");
    setHistoryResult(null);
    setHistoryError(null);
    portfolioExposureApi.simulate(portfolioId || "default", selected.ticker, amountNum)
      .then((res) => {
        if (!simGuardRef.current.isCurrent(reqId)) return; // obsoleta: ya cambió de portafolio o se disparó otra simulación
        setSimResult(res.data);
        setSimulatedFor({ ticker: selected.ticker, amount: amountNum });
      })
      .catch((err) => {
        if (!simGuardRef.current.isCurrent(reqId)) return;
        const status = err?.response?.status ?? 0;
        const detail = err?.response?.data?.detail;
        const message =
          status === 422 ? (typeof detail === "string" ? detail : t("portfolio.distribution.simulate.error.invalid"))
          : status === 404 ? t("portfolio.distribution.error.notFound")
          : t("portfolio.distribution.simulate.error.generic");
        setSimError(message);
      })
      .finally(() => { if (simGuardRef.current.isCurrent(reqId)) setSimLoading(false); });
  };

  const discard = () => {
    setSelected(null);
    setAmountInput("");
    setSimResult(null);
    setSimError(null);
    setSimulatedFor(null);
    setPerspective("distribution");
    setHistoryResult(null);
    setHistoryError(null);
  };

  // Historia: solo se consulta cuando el usuario de verdad abre esa
  // perspectiva — nunca al simular, nunca por adelantado. Caché local por
  // (portafolio, ticker, monto, periodo) para no repetir la misma
  // consulta a FMP si el usuario va y vuelve a Historia.
  useEffect(() => {
    if (perspective !== "history" || !simulatedFor) return;
    const cacheKey = `${portfolioId || "default"}|${simulatedFor.ticker}|${simulatedFor.amount}|${historyPeriod}`;
    const cached = historyCacheRef.current.get(cacheKey);
    if (cached) {
      setHistoryResult(cached);
      setHistoryError(null);
      return;
    }
    const reqId = historyGuardRef.current.next();
    setHistoryLoading(true);
    setHistoryError(null);
    portfolioExposureApi.simulateHistory(portfolioId || "default", simulatedFor.ticker, simulatedFor.amount, historyPeriod)
      .then((res) => {
        if (!historyGuardRef.current.isCurrent(reqId)) return; // una consulta más nueva, o un cambio de portafolio, ya la reemplazó
        const history: HistoryResult = res.data.history;
        historyCacheRef.current.set(cacheKey, history);
        setHistoryResult(history);
      })
      .catch((err) => {
        if (!historyGuardRef.current.isCurrent(reqId)) return;
        const status = err?.response?.status ?? 0;
        setHistoryError(status === 404 ? t("portfolio.distribution.error.notFound") : t("portfolio.distribution.simulate.history.errorGeneric"));
      })
      .finally(() => { if (historyGuardRef.current.isCurrent(reqId)) setHistoryLoading(false); });
  }, [perspective, historyPeriod, simulatedFor, portfolioId]);

  return (
    <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={{ fontSize: 14, fontWeight: "800", color: colors.text, marginBottom: 4 }}>
          {t("portfolio.distribution.simulate.title")}
        </Text>
        <Text style={{ fontSize: 12, color: colors.textSub, marginBottom: 10 }}>
          {t("portfolio.distribution.simulate.subtitle")}
        </Text>

        {!selected ? (
          <View>
            <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.bgRaised ?? colors.card }]}>
              <Ionicons name="search" size={15} color={colors.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t("portfolio.distribution.simulate.searchPlaceholder")}
                placeholderTextColor={colors.textMuted}
                style={{ flex: 1, color: colors.text, fontSize: 13, paddingVertical: 8 }}
                autoCapitalize="characters"
              />
              {searching && <ActivityIndicator size="small" color={GOLD} />}
            </View>
            {!!results?.length && (
              <View style={{ marginTop: 6, gap: 4 }}>
                {results.slice(0, 6).map((r) => (
                  <TouchableOpacity
                    key={r.ticker}
                    onPress={() => { setSelected(r); setQuery(""); setResults(null); }}
                    style={[styles.resultRow, { borderColor: colors.border }]}
                    activeOpacity={0.8}
                  >
                    <StockAvatar ticker={r.ticker} size={24} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: colors.text }}>{r.ticker}</Text>
                      {!!r.name && <Text style={{ fontSize: 11, color: colors.textMuted }} numberOfLines={1}>{r.name}</Text>}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <View style={[styles.row, { gap: 8 }]}>
                <StockAvatar ticker={selected.ticker} size={28} />
                <Text style={{ fontSize: 14, fontWeight: "800", color: colors.text }}>{selected.ticker}</Text>
              </View>
              <TouchableOpacity onPress={discard}>
                <Ionicons name="close-circle" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.bgRaised ?? colors.card }]}>
              <Text style={{ color: colors.textMuted, fontSize: 13 }}>{currency}</Text>
              <TextInput
                value={amountInput}
                onChangeText={setAmountInput}
                placeholder="1000"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                style={{ flex: 1, color: colors.text, fontSize: 13, paddingVertical: 8 }}
              />
            </View>
            <TouchableOpacity
              onPress={runSimulation}
              disabled={!amountValid || simLoading}
              style={[styles.simulateButton, { backgroundColor: amountValid ? GOLD : colors.border }]}
              activeOpacity={0.85}
            >
              {simLoading ? <ActivityIndicator size="small" color="#04211a" /> : (
                <Text style={{ fontSize: 13, fontWeight: "800", color: amountValid ? "#04211a" : colors.textMuted }}>
                  {t("portfolio.distribution.simulate.run")}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {!!simError && (
          <Text style={{ fontSize: 12, color: "#E0A030", marginTop: 8 }}>{simError}</Text>
        )}
      </View>

      {simResult && simulatedFor && (() => {
        // Jerarquía "decisión → cambio principal → significado → valor
        // total → detalle" (paridad Web, segunda pasada de
        // simplificación): el cambio de peso del ticker simulado y su
        // significado se muestran SIEMPRE, sin importar qué pestaña esté
        // abierta — nunca repetidos como "% + frase larga + equivalencia
        // por cada $100" (esa tercera forma se eliminó en Web también).
        const insights = buildSimulationInsights(simResult, simulatedFor.ticker, lang, simResult.amount);
        const primaryInsight = insights[0] ?? null;
        const secondaryInsights = primaryInsight ? insights.slice(1) : insights;
        const beforeTickerWeight = simResult.before.positions.find((p) => p.ticker === simulatedFor.ticker)?.weight_pct ?? 0;
        const afterTickerWeight = simResult.after.positions.find((p) => p.ticker === simulatedFor.ticker)?.weight_pct ?? null;
        const meaning = primaryInsight?.category === "position_weight" && typeof primaryInsight.supporting_data.meaning === "string"
          ? primaryInsight.supporting_data.meaning as string
          : null;

        return (
        <View style={{ gap: 10 }}>
          {simResult.before_had_no_verified_positions && (
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
              <Ionicons name="alert-circle-outline" size={14} color="#E0A030" style={{ marginTop: 1 }} />
              <Text style={{ fontSize: 12, color: "#E0A030", flex: 1 }}>{t("portfolio.distribution.simulate.noBeforeVerified")}</Text>
            </View>
          )}

          {/* 1-3: inversión hipotética + cambio principal antes/después + pp */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.text, marginBottom: 8 }}>
              {t("portfolio.distribution.simulate.resultIntro", { amount: fmtMoney(simulatedFor.amount, currency, na) })}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <StockAvatar ticker={simulatedFor.ticker} size={28} />
              <Text style={{ fontSize: 14, fontWeight: "800", color: colors.text }}>{simulatedFor.ticker}</Text>
            </View>
            {afterTickerWeight !== null && (
              <DeltaRow
                label={t("portfolio.distribution.simulate.positionWeightTitle")}
                before={beforeTickerWeight} after={afterTickerWeight}
                delta={Math.round((afterTickerWeight - beforeTickerWeight) * 10) / 10}
                colors={colors} na={na} neutral
              />
            )}
            {/* 4: qué significa ese cambio — nunca una predicción */}
            {!!meaning && (
              <Text style={{ fontSize: 12.5, color: colors.textSub, marginTop: 8, lineHeight: 18 }}>{meaning}</Text>
            )}
          </View>

          {/* 5: valor total antes/después — neutral, es el capital
              agregado en la simulación, nunca un rendimiento. */}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flex: 1 }]}>
              <Text style={{ fontSize: 10.5, color: colors.textMuted, textTransform: "uppercase", fontWeight: "800" }}>{t("portfolio.distribution.simulate.valueBefore")}</Text>
              <Text style={{ fontSize: 14, fontWeight: "900", color: colors.text, marginTop: 4 }}>{fmtMoney(simResult.before.valuation.total_value_verified, currency, na)}</Text>
            </View>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flex: 1 }]}>
              <Text style={{ fontSize: 10.5, color: colors.textMuted, textTransform: "uppercase", fontWeight: "800" }}>{t("portfolio.distribution.simulate.valueAfter")}</Text>
              <Text style={{ fontSize: 14, fontWeight: "900", color: colors.text, marginTop: 4 }}>{fmtMoney(simResult.after.valuation.total_value_verified, currency, na)}</Text>
            </View>
          </View>
          <Text style={{ fontSize: 10.5, color: colors.textMuted, flexDirection: "row" }}>
            {t("portfolio.distribution.simulate.valueIncreaseNote", { amount: fmtMoney(simulatedFor.amount, currency, na) })}
          </Text>

          <View style={[styles.segmented, { backgroundColor: colors.bgRaised ?? colors.card, borderColor: colors.border }]}>
            {([
              { key: "distribution" as const, label: t("portfolio.distribution.simulate.perspective.distribution") },
              { key: "exposure" as const, label: t("portfolio.distribution.simulate.perspective.exposure") },
              { key: "history" as const, label: t("portfolio.distribution.simulate.perspective.history") },
            ]).map((o) => (
              <TouchableOpacity
                key={o.key}
                onPress={() => setPerspective(o.key)}
                style={[styles.segment, perspective === o.key && { backgroundColor: GOLD }]}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 12, fontWeight: "800", color: perspective === o.key ? "#04211a" : colors.textMuted }}>{o.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {perspective === "distribution" && (
            <View style={{ gap: 8 }}>
              {simResult.sector_deltas.length === 0 ? (
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={{ color: colors.textMuted, fontSize: 12.5 }}>{t("portfolio.distribution.sectors.empty")}</Text>
                </View>
              ) : simResult.sector_deltas.slice(0, 8).map((row) => (
                <DeltaRow key={row.sector} label={row.sector} before={row.pct_before} after={row.pct_after} delta={row.delta_pct_points} colors={colors} na={na} />
              ))}
            </View>
          )}

          {perspective === "exposure" && (
            <View style={{ gap: 8 }}>
              {simResult.country_deltas.length === 0 ? (
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={{ color: colors.textMuted, fontSize: 12.5 }}>{t("portfolio.distribution.geography.empty")}</Text>
                </View>
              ) : simResult.country_deltas.slice(0, 8).map((row, i) => (
                <DeltaRow key={`${row.country}-${row.methodology}-${i}`} label={`${row.country} (${row.methodology === "etf_underlying" ? t("portfolio.distribution.geography.etfUnderlying") : t("portfolio.distribution.geography.equityDomicile")})`} before={row.pct_before} after={row.pct_after} delta={row.delta_pct_points} colors={colors} na={na} />
              ))}
            </View>
          )}

          {perspective === "history" && (
            <View style={{ gap: 10 }}>
              <View style={[styles.segmented, { backgroundColor: colors.bgRaised ?? colors.card, borderColor: colors.border }]}>
                {(["1y", "3y", "5y"] as HistoryPeriod[]).map((p) => (
                  <TouchableOpacity
                    key={p}
                    onPress={() => setHistoryPeriod(p)}
                    style={[styles.segment, historyPeriod === p && { backgroundColor: GOLD }]}
                    activeOpacity={0.8}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "800", color: historyPeriod === p ? "#04211a" : colors.textMuted }}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {historyLoading && (
                <View style={{ paddingVertical: 30, alignItems: "center" }}>
                  <ActivityIndicator color={GOLD} />
                </View>
              )}
              {!!historyError && <Text style={{ fontSize: 12, color: "#E0A030" }}>{historyError}</Text>}

              {!historyLoading && historyResult && !historyResult.available && (
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={{ color: colors.textMuted, fontSize: 12.5 }}>{t("portfolio.distribution.simulate.history.unavailable")}</Text>
                </View>
              )}

              {!historyLoading && historyResult && historyResult.available && (
                <View style={{ gap: 10 }}>
                  <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <HistoryComparisonChart
                      seriesA={historyResult.index_before}
                      seriesB={historyResult.index_after}
                      labelA={t("portfolio.distribution.simulate.history.actual")}
                      labelB={t("portfolio.distribution.simulate.history.hypothetical")}
                      colors={colors}
                    />
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <MetricCard label={t("portfolio.distribution.simulate.history.volatility")} before={historyResult.volatility_before.value} after={historyResult.volatility_after.value} colors={colors} na={na} />
                    <MetricCard label={t("portfolio.distribution.simulate.history.maxDrawdown")} before={historyResult.max_drawdown_before.value} after={historyResult.max_drawdown_after.value} colors={colors} na={na} />
                  </View>
                  <Text style={{ fontSize: 10.5, color: colors.textMuted }}>
                    {historyResult.start_date} → {historyResult.end_date}
                    {historyResult.window_status === "partial" ? ` · ${t("portfolio.distribution.simulate.history.partialWindow")}` : ""}
                  </Text>
                  {Object.keys(historyResult.fetch_warnings).length > 0 && (
                    <Text style={{ fontSize: 10.5, color: "#E0A030" }}>{t("portfolio.distribution.simulate.history.warnings")}</Text>
                  )}
                  <Text style={{ fontSize: 10, color: colors.textDim, fontStyle: "italic" }}>{historyResult.disclaimer_es}</Text>
                </View>
              )}
            </View>
          )}

          {/* 6: otros cambios — expandible, nunca repite el cambio
              principal de arriba (secondaryInsights ya excluye
              position_weight). */}
          {secondaryInsights.length > 0 && (
            <Expandable title={t("portfolio.distribution.simulate.otherChanges")} colors={colors}>
              {secondaryInsights.map((insight, i) => (
                <Text key={i} style={{ fontSize: 12.5, color: colors.text, lineHeight: 18 }}>{insight.text}</Text>
              ))}
            </Expandable>
          )}

          <Text style={{ fontSize: 10.5, color: colors.textMuted, lineHeight: 15 }}>{t("portfolio.distribution.simulate.disclaimer")}</Text>
        </View>
        );
      })()}
    </ScrollView>
  );
}

// Diego, 2026-11 (paridad Web): un aumento o disminución de peso/
// concentración NUNCA es inherentemente positivo o negativo — colors.up/
// colors.down (verde/rojo) quedan reservados exclusivamente para
// rendimientos reales (Historia), nunca para esto. Mismo bug que Web ya
// corrigió en su propio rediseño (BeforeAfterRow).
function DeltaRow({ label, before, after, delta, colors, na, neutral }: { label: string; before: number; after: number; delta: number; colors: Colors; na: string; neutral?: boolean }) {
  return (
    <View style={neutral ? undefined : [styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {!neutral && <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.text }} numberOfLines={1}>{label}</Text>}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: neutral ? 0 : 4 }}>
        <Text style={{ fontSize: 11.5, color: colors.textSub }}>{before.toFixed(1)}% → {after.toFixed(1)}%</Text>
        <Text style={{ fontSize: 11.5, fontWeight: "700", color: colors.text }}>{fmtPct(delta, na)}</Text>
      </View>
    </View>
  );
}

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

function MetricCard({ label, before, after, colors, na }: { label: string; before: number | null; after: number | null; colors: Colors; na: string }) {
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flex: 1 }]}>
      <Text style={{ fontSize: 10.5, color: colors.textMuted, textTransform: "uppercase", fontWeight: "800" }}>{label}</Text>
      <Text style={{ fontSize: 12, color: colors.textSub, marginTop: 4 }}>
        {before !== null ? `${before.toFixed(1)}%` : na} → {after !== null ? `${after.toFixed(1)}%` : na}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 14, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10 },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, padding: 8 },
  simulateButton: { borderRadius: 12, paddingVertical: 11, alignItems: "center" },
  segmented: { flexDirection: "row", borderRadius: 12, padding: 3, borderWidth: 1, gap: 2 },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
});
