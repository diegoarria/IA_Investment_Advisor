import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, ActivityIndicator, SafeAreaView, Alert,
  RefreshControl,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as XLSX from "xlsx";
import { marketApi } from "../../src/lib/api";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { usePortfolioStore, Position } from "../../src/lib/portfolioStore";

type Scenario = "conservative" | "moderate" | "aggressive";

const SCENARIOS: { value: Scenario; emoji: string; label: string }[] = [
  { value: "conservative", emoji: "🛡️", label: "Conservador" },
  { value: "moderate",     emoji: "⚖️", label: "Moderado" },
  { value: "aggressive",   emoji: "🚀", label: "Agresivo" },
];

interface PriceData { price: number | null; currency: string; name: string }

// ─── Excel helpers ─────────────────────────────────────────────────────────

const TICKER_KEYS = ["ticker", "symbol", "emisora", "instrumento", "accion", "titulo", "clave"];
const SHARES_KEYS = ["shares", "qty", "quantity", "cantidad", "titulos", "acciones", "unidades"];
const PRICE_KEYS  = ["price", "precio", "promedio", "costo", "avg", "cost", "compra", "purchase"];

function findCol(headers: string[], keys: string[]) {
  return headers.findIndex((h) => keys.some((k) => h.toLowerCase().includes(k)));
}

function parseExcelRows(rows: Record<string, unknown>[]): Omit<Position, "id">[] {
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  const tI = findCol(headers, TICKER_KEYS);
  const sI = findCol(headers, SHARES_KEYS);
  const pI = findCol(headers, PRICE_KEYS);
  if (tI < 0) return [];
  return rows
    .map((row) => ({
      ticker: String(row[headers[tI]] ?? "").trim().toUpperCase(),
      shares: sI >= 0 ? parseFloat(String(row[headers[sI]] ?? "0")) || 0 : 0,
      avgPrice: pI >= 0 ? parseFloat(String(row[headers[pI]] ?? "0")) || 0 : 0,
    }))
    .filter((p) => p.ticker.length > 0 && p.shares > 0);
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function PortfolioScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const { positions, addPosition, removePosition, setPositions } = usePortfolioStore();
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Manual add form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ticker: "", shares: "", avgPrice: "" });
  const [addingLoading, setAddingLoading] = useState(false);

  // Simulator
  const [scenario, setScenario] = useState<Scenario>("moderate");
  const [capital, setCapital] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [simLoading, setSimLoading] = useState(false);

  const fetchPrices = useCallback(async (silent = false) => {
    if (!positions.length) return;
    if (!silent) setLoadingPrices(true);
    try {
      const res = await marketApi.getPrices(positions.map((p) => p.ticker));
      setPrices(res.data);
    } catch {}
    setLoadingPrices(false);
  }, [positions]);

  useEffect(() => { fetchPrices(); }, [positions.length]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchPrices(true);
    setRefreshing(false);
  };

  // ── Manual add ─────────────────────────────────────────────────────────
  const handleAdd = async () => {
    const ticker = form.ticker.trim().toUpperCase();
    const shares = parseFloat(form.shares);
    const avgPrice = parseFloat(form.avgPrice);
    if (!ticker || !shares || !avgPrice) {
      Alert.alert("Completa todos los campos");
      return;
    }
    setAddingLoading(true);
    try {
      const res = await marketApi.getPrices([ticker]);
      const info = res.data[ticker];
      addPosition({ ticker, shares, avgPrice, name: info?.name });
      setForm({ ticker: "", shares: "", avgPrice: "" });
      setShowForm(false);
    } catch {
      addPosition({ ticker, shares, avgPrice });
      setForm({ ticker: "", shares: "", avgPrice: "" });
      setShowForm(false);
    }
    setAddingLoading(false);
  };

  // ── Excel import ────────────────────────────────────────────────────────
  const handleExcelImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["*/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;

      const file = result.assets[0];
      const response = await fetch(file.uri);
      const buffer = await response.arrayBuffer();
      const data = new Uint8Array(buffer);
      const wb = XLSX.read(data, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const parsed = parseExcelRows(rows);

      if (!parsed.length) {
        Alert.alert(
          "No se encontraron posiciones",
          "El Excel debe tener columnas con nombres como:\nTicker / Acciones / Precio\n\nRevisa el formato e intenta de nuevo."
        );
        return;
      }

      Alert.alert(
        `${parsed.length} posiciones detectadas`,
        parsed.slice(0, 5).map((p) => `• ${p.ticker}: ${p.shares} acc @ $${p.avgPrice}`).join("\n") +
          (parsed.length > 5 ? `\n... y ${parsed.length - 5} más` : ""),
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Importar", onPress: () => setPositions(parsed) },
        ]
      );
    } catch {
      Alert.alert("Error", "No se pudo leer el archivo. Asegúrate de que sea .xlsx o .csv");
    }
  };

  // ── Simulator ──────────────────────────────────────────────────────────
  const simulate = async () => {
    setSimLoading(true);
    setAnalysis("");
    try {
      const res = await marketApi.getPortfolio(scenario, capital ? parseFloat(capital) : undefined);
      setAnalysis(res.data.analysis);
    } catch {
      setAnalysis("Error al generar el análisis. Intenta de nuevo.");
    }
    setSimLoading(false);
  };

  // ── Totals ─────────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let invested = 0, current = 0;
    for (const p of positions) {
      invested += p.shares * p.avgPrice;
      const cp = prices[p.ticker]?.price;
      current += cp ? p.shares * cp : p.shares * p.avgPrice;
    }
    const diff = current - invested;
    const pct = invested > 0 ? (diff / invested) * 100 : 0;
    return { invested, current, diff, pct };
  }, [positions, prices]);

  return (
    <SafeAreaView style={s.container}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22c55e" />}
      >

        {/* ── MI PORTAFOLIO ── */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Mi Portafolio</Text>
          <View style={s.headerButtons}>
            <TouchableOpacity style={s.btnSmall} onPress={() => setShowForm(!showForm)}>
              <Text style={s.btnSmallText}>+ Agregar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btnSmall, s.btnExcel]} onPress={handleExcelImport}>
              <Text style={s.btnSmallText}>📁 Excel</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Formulario de agregar manual */}
        {showForm && (
          <View style={[s.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.formTitle, { color: colors.text }]}>Nueva posición</Text>
            <View style={s.formRow}>
              <TextInput
                style={[s.formInput, { color: colors.text, backgroundColor: colors.bg, borderColor: colors.border, flex: 1 }]}
                value={form.ticker}
                onChangeText={(v) => setForm({ ...form, ticker: v.toUpperCase() })}
                placeholder="Ticker (ej. AAPL)"
                placeholderTextColor={colors.placeholder}
                autoCapitalize="characters"
              />
            </View>
            <View style={s.formRow}>
              <TextInput
                style={[s.formInput, { color: colors.text, backgroundColor: colors.bg, borderColor: colors.border, flex: 1 }]}
                value={form.shares}
                onChangeText={(v) => setForm({ ...form, shares: v })}
                placeholder="Cantidad de acciones"
                placeholderTextColor={colors.placeholder}
                keyboardType="decimal-pad"
              />
              <TextInput
                style={[s.formInput, { color: colors.text, backgroundColor: colors.bg, borderColor: colors.border, flex: 1, marginLeft: 8 }]}
                value={form.avgPrice}
                onChangeText={(v) => setForm({ ...form, avgPrice: v })}
                placeholder="Precio promedio"
                placeholderTextColor={colors.placeholder}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={s.formRow}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setShowForm(false)}>
                <Text style={[s.cancelBtnText, { color: colors.textMuted }]}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.addBtn} onPress={handleAdd} disabled={addingLoading}>
                {addingLoading ? <ActivityIndicator color="white" size="small" /> : <Text style={s.addBtnText}>Agregar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Lista de posiciones */}
        {positions.length === 0 ? (
          <View style={[s.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={s.emptyIcon}>📂</Text>
            <Text style={[s.emptyTitle, { color: colors.text }]}>Sin posiciones todavía</Text>
            <Text style={[s.emptyDesc, { color: colors.textMuted }]}>
              Agrega tus inversiones manualmente o importa desde un archivo Excel con columnas: Ticker, Acciones, Precio
            </Text>
          </View>
        ) : (
          <>
            {/* Tarjeta de totales */}
            <View style={[s.totalsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {loadingPrices ? (
                <ActivityIndicator color="#22c55e" />
              ) : (
                <>
                  <Text style={[s.totalsLabel, { color: colors.textMuted }]}>Valor actual del portafolio</Text>
                  <Text style={[s.totalsValue, { color: colors.text }]}>
                    ${totals.current.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Text>
                  <View style={s.totalsRow}>
                    <Text style={[s.totalsInvested, { color: colors.textMuted }]}>
                      Invertido: ${totals.invested.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                    </Text>
                    <Text style={[s.totalsDiff, { color: totals.diff >= 0 ? "#22c55e" : "#ef4444" }]}>
                      {totals.diff >= 0 ? "+" : ""}
                      ${totals.diff.toLocaleString("es-MX", { minimumFractionDigits: 2 })} ({totals.pct >= 0 ? "+" : ""}{totals.pct.toFixed(2)}%)
                    </Text>
                  </View>
                </>
              )}
            </View>

            {/* Posiciones */}
            {positions.map((pos) => {
              const pd = prices[pos.ticker];
              const cp = pd?.price;
              const currentVal = cp ? pos.shares * cp : null;
              const investedVal = pos.shares * pos.avgPrice;
              const diff = currentVal !== null ? currentVal - investedVal : null;
              const pct = diff !== null ? (diff / investedVal) * 100 : null;
              const isUp = diff !== null && diff >= 0;

              return (
                <View key={pos.id} style={[s.posCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={s.posHeader}>
                    <View>
                      <Text style={[s.posTicker, { color: colors.text }]}>{pos.ticker}</Text>
                      {pd?.name && <Text style={[s.posName, { color: colors.textMuted }]}>{pd.name}</Text>}
                    </View>
                    <TouchableOpacity onPress={() => removePosition(pos.id)}>
                      <Text style={{ color: colors.textDim, fontSize: 18 }}>×</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={s.posBody}>
                    <View>
                      <Text style={[s.posDetail, { color: colors.textMuted }]}>
                        {pos.shares} acc × ${pos.avgPrice.toLocaleString()}
                      </Text>
                      <Text style={[s.posDetail, { color: colors.textMuted }]}>
                        Invertido: ${investedVal.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      {cp ? (
                        <>
                          <Text style={[s.posCurrentVal, { color: colors.text }]}>
                            ${(currentVal!).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                          </Text>
                          <Text style={[s.posPct, { color: isUp ? "#22c55e" : "#ef4444" }]}>
                            {isUp ? "+" : ""}{pct!.toFixed(2)}%
                          </Text>
                        </>
                      ) : (
                        <Text style={[s.posDetail, { color: colors.textDim }]}>Sin precio</Text>
                      )}
                    </View>
                  </View>
                  {cp && (
                    <Text style={[s.posPrice, { color: colors.textDim }]}>
                      Precio actual: ${cp.toLocaleString()} {pd?.currency}
                    </Text>
                  )}
                </View>
              );
            })}
          </>
        )}

        {/* ── SIMULADOR ── */}
        <View style={[s.divider, { borderTopColor: colors.border }]} />
        <Text style={s.sectionTitle}>Simulador de Escenarios</Text>

        <View style={s.scenarioRow}>
          {SCENARIOS.map((sc) => (
            <TouchableOpacity
              key={sc.value}
              style={[s.scenarioCard, { backgroundColor: colors.card, borderColor: colors.border },
                scenario === sc.value && s.scenarioActive]}
              onPress={() => setScenario(sc.value)}
            >
              <Text style={s.scenarioEmoji}>{sc.emoji}</Text>
              <Text style={[s.scenarioLabel, { color: scenario === sc.value ? colors.text : colors.textSub }]}>{sc.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          style={[s.simInput, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}
          value={capital}
          onChangeText={setCapital}
          placeholder="Capital de referencia (USD, opcional)"
          placeholderTextColor={colors.placeholder}
          keyboardType="numeric"
        />

        <TouchableOpacity style={[s.simBtn, simLoading && s.btnDisabled]} onPress={simulate} disabled={simLoading}>
          {simLoading ? <ActivityIndicator color="white" /> : <Text style={s.simBtnText}>Simular portafolio</Text>}
        </TouchableOpacity>

        {analysis !== "" && (
          <View style={[s.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.resultText, { color: colors.textSub }]}>{analysis}</Text>
            <View style={s.disclaimer}>
              <Text style={s.disclaimerText}>⚠️ Análisis educativo hipotético. No es asesoramiento financiero.</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 40 },
    sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
    sectionTitle: { fontSize: 17, fontWeight: "700", color: c.text, marginBottom: 12 },
    headerButtons: { flexDirection: "row", gap: 8 },
    btnSmall: { backgroundColor: "#16a34a", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
    btnExcel: { backgroundColor: "#1d4ed8" },
    btnSmallText: { color: "white", fontSize: 12, fontWeight: "600" },
    // Form
    formCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
    formTitle: { fontSize: 14, fontWeight: "600", marginBottom: 10 },
    formRow: { flexDirection: "row", marginBottom: 8 },
    formInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
    cancelBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: c.border },
    cancelBtnText: { fontWeight: "500", fontSize: 14 },
    addBtn: { flex: 1, backgroundColor: "#16a34a", borderRadius: 10, paddingVertical: 12, alignItems: "center", marginLeft: 8 },
    addBtnText: { color: "white", fontWeight: "600", fontSize: 14 },
    // Empty
    emptyCard: { borderRadius: 14, borderWidth: 1, padding: 24, alignItems: "center", marginBottom: 16 },
    emptyIcon: { fontSize: 40, marginBottom: 10 },
    emptyTitle: { fontSize: 15, fontWeight: "600", marginBottom: 6 },
    emptyDesc: { fontSize: 13, textAlign: "center", lineHeight: 18 },
    // Totals
    totalsCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 12 },
    totalsLabel: { fontSize: 12, marginBottom: 4 },
    totalsValue: { fontSize: 24, fontWeight: "700", marginBottom: 4 },
    totalsRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    totalsInvested: { fontSize: 12 },
    totalsDiff: { fontSize: 13, fontWeight: "600" },
    // Position card
    posCard: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8 },
    posHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
    posTicker: { fontSize: 16, fontWeight: "700" },
    posName: { fontSize: 11, marginTop: 1 },
    posBody: { flexDirection: "row", justifyContent: "space-between" },
    posDetail: { fontSize: 12, lineHeight: 18 },
    posCurrentVal: { fontSize: 14, fontWeight: "600" },
    posPct: { fontSize: 12, fontWeight: "500" },
    posPrice: { fontSize: 11, marginTop: 6 },
    // Divider
    divider: { borderTopWidth: 1, marginVertical: 20 },
    // Simulator
    scenarioRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
    scenarioCard: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 10, alignItems: "center" },
    scenarioActive: { borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,0.1)" },
    scenarioEmoji: { fontSize: 20, marginBottom: 2 },
    scenarioLabel: { fontSize: 12, fontWeight: "600" },
    simInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, marginBottom: 12 },
    simBtn: { backgroundColor: "#16a34a", borderRadius: 12, paddingVertical: 14, alignItems: "center", marginBottom: 16 },
    btnDisabled: { opacity: 0.5 },
    simBtnText: { color: "white", fontWeight: "600", fontSize: 15 },
    resultCard: { borderRadius: 14, borderWidth: 1, padding: 16 },
    resultText: { fontSize: 13, lineHeight: 20 },
    disclaimer: { marginTop: 10, backgroundColor: "rgba(234,179,8,0.1)", borderWidth: 1, borderColor: "rgba(234,179,8,0.3)", borderRadius: 8, padding: 8 },
    disclaimerText: { color: "#ca8a04", fontSize: 11 },
  });
}
