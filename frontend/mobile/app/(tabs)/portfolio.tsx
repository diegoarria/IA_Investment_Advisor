import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, ActivityIndicator, SafeAreaView, Alert,
  RefreshControl, Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as XLSX from "xlsx";
import { marketApi } from "../../src/lib/api";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { usePortfolioStore, Position } from "../../src/lib/portfolioStore";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];
type Scenario = "conservative" | "moderate" | "aggressive";

function fmtMoney(n: number, showSign = false): string {
  const sign = showSign && n >= 0 ? "+" : "";
  const abs = Math.abs(n);
  const neg = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${neg}${sign}$${(abs / 1e12).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}T`;
  if (abs >= 1e9)  return `${neg}${sign}$${(abs / 1e9).toLocaleString("en-US",  { minimumFractionDigits: 2, maximumFractionDigits: 2 })}B`;
  if (abs >= 1e6)  return `${neg}${sign}$${(abs / 1e6).toLocaleString("en-US",  { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`;
  if (abs >= 1e3)  return `${neg}${sign}$${(abs / 1e3).toLocaleString("en-US",  { minimumFractionDigits: 2, maximumFractionDigits: 2 })}K`;
  return `${neg}${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

const SCENARIOS: { value: Scenario; icon: IoniconName; label: string }[] = [
  { value: "conservative", icon: "shield-outline", label: "Conservador" },
  { value: "moderate",     icon: "scale-outline",  label: "Moderado" },
  { value: "aggressive",   icon: "rocket-outline", label: "Agresivo" },
];

interface PriceData { price: number | null; currency: string; name: string }
interface ExtractedPosition { id: string; ticker: string; name: string; shares: number; avg_price: number }

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

  // Screenshot import
  const [screenshotAnalyzing, setScreenshotAnalyzing] = useState(false);
  const [screenshotPreview, setScreenshotPreview] = useState<ExtractedPosition[] | null>(null);
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);

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

  // ── Screenshot import ──────────────────────────────────────────────────
  const handleScreenshotImport = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permiso requerido", "Necesitamos acceso a tu galería para leer la captura de pantalla.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true,
      quality: 0.6,
      allowsMultipleSelection: false,
    });

    if (result.canceled || !result.assets?.[0]?.base64) return;

    const asset = result.assets[0];
    setScreenshotUri(asset.uri);
    setScreenshotAnalyzing(true);
    setScreenshotPreview(null);

    try {
      const mimeType = asset.mimeType || "image/jpeg";
      const res = await marketApi.analyzeScreenshot(asset.base64!, mimeType);
      const extracted: ExtractedPosition[] = (res.data.positions || []).map(
        (p: Omit<ExtractedPosition, "id">, i: number) => ({
          ...p,
          id: `${p.ticker}-${i}-${Date.now()}`,
        })
      );

      if (!extracted.length) {
        Alert.alert(
          "Sin posiciones detectadas",
          res.data.error || "No se encontraron posiciones en la imagen. Intenta con una captura más clara."
        );
        setScreenshotUri(null);
      } else {
        setScreenshotPreview(extracted);
      }
    } catch {
      Alert.alert("Error", "No se pudo analizar la imagen. Verifica que el backend esté corriendo.");
      setScreenshotUri(null);
    } finally {
      setScreenshotAnalyzing(false);
    }
  };

  const removeExtracted = (id: string) => {
    setScreenshotPreview((prev) => {
      const next = (prev ?? []).filter((p) => p.id !== id);
      if (!next.length) {
        setScreenshotUri(null);
        return null;
      }
      return next;
    });
  };

  const confirmScreenshotImport = () => {
    if (!screenshotPreview?.length) return;
    setPositions(screenshotPreview.map((p) => ({
      ticker: p.ticker,
      name: p.name,
      shares: p.shares,
      avgPrice: p.avg_price,
    })));
    setScreenshotPreview(null);
    setScreenshotUri(null);
  };

  // ── Manual add ─────────────────────────────────────────────────────────
  const handleAdd = async () => {
    const ticker = form.ticker.trim().toUpperCase();
    const shares = parseFloat(form.shares);
    const avgPrice = parseFloat(form.avgPrice);
    if (!ticker || !shares || !avgPrice) { Alert.alert("Completa todos los campos"); return; }
    setAddingLoading(true);
    try {
      const res = await marketApi.getPrices([ticker]);
      addPosition({ ticker, shares, avgPrice, name: res.data[ticker]?.name });
    } catch {
      addPosition({ ticker, shares, avgPrice });
    }
    setForm({ ticker: "", shares: "", avgPrice: "" });
    setShowForm(false);
    setAddingLoading(false);
  };

  // ── Excel import ────────────────────────────────────────────────────────
  const handleExcelImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ["*/*"], copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.length) return;
      const file = result.assets[0];
      const buffer = await (await fetch(file.uri)).arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
      const parsed = parseExcelRows(rows);
      if (!parsed.length) {
        Alert.alert("No se encontraron posiciones", "El Excel debe tener columnas: Ticker / Acciones / Precio");
        return;
      }
      Alert.alert(
        `${parsed.length} posiciones detectadas`,
        parsed.slice(0, 5).map((p) => `• ${p.ticker}: ${p.shares.toLocaleString("en-US")} acc @ $${p.avgPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join("\n") +
          (parsed.length > 5 ? `\n... y ${parsed.length - 5} más` : ""),
        [{ text: "Cancelar", style: "cancel" }, { text: "Importar", onPress: () => setPositions(parsed) }]
      );
    } catch {
      Alert.alert("Error", "No se pudo leer el archivo.");
    }
  };

  // ── Simulator 1: portfolio AI analysis ────────────────────────────────
  const simulate = async () => {
    setSimLoading(true); setAnalysis("");
    try {
      const positionsPayload = positions.length > 0
        ? positions.map((p) => ({ ticker: p.ticker, shares: p.shares, avg_price: p.avgPrice, name: p.name }))
        : undefined;
      const res = await marketApi.getPortfolio(
        scenario,
        capital ? parseFloat(capital) : undefined,
        positionsPayload,
      );
      setAnalysis(res.data.analysis);
    } catch { setAnalysis("Error al generar el análisis. Intenta de nuevo."); }
    setSimLoading(false);
  };

  // ── Simulator 2: compound interest calculator ──────────────────────────
  const [calcCapital, setCalcCapital] = useState("");
  const [calcMonthly, setCalcMonthly] = useState("");
  const [calcReturn, setCalcReturn]   = useState("");
  const [calcYears, setCalcYears]     = useState("");
  const [calcResult, setCalcResult]   = useState<{
    final: number; invested: number; gain: number; pct: number;
    milestones: { year: number; value: number }[];
  } | null>(null);

  const calculateCompound = () => {
    const pv  = parseFloat(calcCapital)  || 0;
    const pmt = parseFloat(calcMonthly)  || 0;
    const ann = parseFloat(calcReturn)   || 0;
    const yrs = parseFloat(calcYears)    || 0;
    if (!pv || !ann || !yrs) return;

    const r = ann / 100 / 12;
    const n = Math.round(yrs * 12);

    const fvPV  = pv * Math.pow(1 + r, n);
    const fvPMT = pmt > 0 ? pmt * (Math.pow(1 + r, n) - 1) / r : 0;
    const final = fvPV + fvPMT;
    const invested = pv + pmt * n;

    const milestoneYears = Array.from(new Set([1, 2, 3, 5, 10, Math.round(yrs)].filter((y) => y > 0 && y <= yrs))).sort((a, b) => a - b);
    const milestones = milestoneYears.map((y) => {
      const mn = y * 12;
      const val = pv * Math.pow(1 + r, mn) + (pmt > 0 ? pmt * (Math.pow(1 + r, mn) - 1) / r : 0);
      return { year: y, value: val };
    });

    setCalcResult({ final, invested, gain: final - invested, pct: invested > 0 ? ((final - invested) / invested) * 100 : 0, milestones });
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
            <TouchableOpacity style={[s.btnSmall, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]} onPress={() => { setShowForm(!showForm); setScreenshotPreview(null); }}>
              <Text style={[s.btnSmallText, { color: colors.textSub }]}>+ Manual</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btnSmall, s.btnExcel, { flexDirection: "row", alignItems: "center", gap: 4 }]} onPress={handleExcelImport}>
              <Ionicons name="document-outline" size={13} color="white" />
              <Text style={s.btnSmallText}>Excel</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── BOTÓN PRINCIPAL: CAPTURA ── */}
        <TouchableOpacity
          style={[s.screenshotBtn, screenshotAnalyzing && s.btnDisabled]}
          onPress={handleScreenshotImport}
          disabled={screenshotAnalyzing}
          activeOpacity={0.8}
        >
          {screenshotAnalyzing ? (
            <View style={s.screenshotBtnInner}>
              <ActivityIndicator color="white" size="small" />
              <Text style={s.screenshotBtnText}>Analizando con IA...</Text>
            </View>
          ) : (
            <View style={s.screenshotBtnInner}>
              <Ionicons name="camera-outline" size={28} color="white" />
              <View>
                <Text style={s.screenshotBtnText}>Importar desde captura</Text>
                <Text style={s.screenshotBtnSub}>La IA detecta tus posiciones automáticamente</Text>
              </View>
            </View>
          )}
        </TouchableOpacity>

        {/* ── PREVIEW DE CAPTURA ── */}
        {screenshotPreview && (
          <View style={[s.previewCard, { backgroundColor: colors.card, borderColor: "#22c55e" }]}>
            <View style={s.previewHeader}>
              <View>
                <Text style={[s.previewTitle, { color: colors.text }]}>
                  {screenshotPreview.length} posiciones detectadas
                </Text>
                <Text style={[s.previewSub, { color: colors.textMuted }]}>
                  Revisa y elimina las incorrectas antes de confirmar
                </Text>
              </View>
              {screenshotUri && (
                <Image source={{ uri: screenshotUri }} style={s.previewThumb} />
              )}
            </View>

            {screenshotPreview.map((p) => (
              <View key={p.id} style={[s.previewRow, { borderColor: colors.border }]}>
                <View style={s.previewRowLeft}>
                  <Text style={[s.previewTicker, { color: colors.text }]}>{p.ticker}</Text>
                  {p.name !== p.ticker && (
                    <Text style={[s.previewName, { color: colors.textMuted }]}>{p.name}</Text>
                  )}
                </View>
                <View style={s.previewRowMid}>
                  <Text style={[s.previewDetail, { color: colors.textSub }]}>
                    {p.shares.toLocaleString("en-US")} acc
                  </Text>
                  <Text style={[s.previewDetail, { color: colors.textSub }]}>
                    @ ${p.avg_price > 0 ? p.avg_price.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "—"}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => removeExtracted(p.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={{ color: "#ef4444", fontSize: 18, fontWeight: "600" }}>×</Text>
                </TouchableOpacity>
              </View>
            ))}

            <View style={s.previewActions}>
              <TouchableOpacity
                style={[s.previewCancel, { borderColor: colors.border }]}
                onPress={() => { setScreenshotPreview(null); setScreenshotUri(null); }}
              >
                <Text style={[s.previewCancelText, { color: colors.textMuted }]}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.previewConfirm} onPress={confirmScreenshotImport}>
                <Text style={s.previewConfirmText}>✓ Agregar {screenshotPreview.length} posiciones</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── FORMULARIO MANUAL ── */}
        {showForm && (
          <View style={[s.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.formTitle, { color: colors.text }]}>Nueva posición manual</Text>
            <TextInput
              style={[s.formInput, { color: colors.text, backgroundColor: colors.bg, borderColor: colors.border }]}
              value={form.ticker}
              onChangeText={(v) => setForm({ ...form, ticker: v.toUpperCase() })}
              placeholder="Ticker (ej. AAPL)" placeholderTextColor={colors.placeholder}
              autoCapitalize="characters"
            />
            <View style={s.formRow}>
              <TextInput
                style={[s.formInput, { color: colors.text, backgroundColor: colors.bg, borderColor: colors.border, flex: 1 }]}
                value={form.shares}
                onChangeText={(v) => setForm({ ...form, shares: v })}
                placeholder="Acciones" placeholderTextColor={colors.placeholder}
                keyboardType="decimal-pad"
              />
              <TextInput
                style={[s.formInput, { color: colors.text, backgroundColor: colors.bg, borderColor: colors.border, flex: 1, marginLeft: 8 }]}
                value={form.avgPrice}
                onChangeText={(v) => setForm({ ...form, avgPrice: v })}
                placeholder="Precio promedio" placeholderTextColor={colors.placeholder}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={s.formRow}>
              <TouchableOpacity style={[s.cancelBtn, { borderColor: colors.border }]} onPress={() => setShowForm(false)}>
                <Text style={[s.cancelBtnText, { color: colors.textMuted }]}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.addBtn} onPress={handleAdd} disabled={addingLoading}>
                {addingLoading ? <ActivityIndicator color="white" size="small" /> : <Text style={s.addBtnText}>Agregar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── LISTA DE POSICIONES ── */}
        {positions.length === 0 && !screenshotPreview ? (
          <View style={[s.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="folder-open-outline" size={40} color={colors.textMuted} style={{ marginBottom: 10 }} />
            <Text style={[s.emptyTitle, { color: colors.text }]}>Sin posiciones todavía</Text>
            <Text style={[s.emptyDesc, { color: colors.textMuted }]}>
              Toma una captura de tu portafolio y la IA lo importa automáticamente
            </Text>
          </View>
        ) : positions.length > 0 ? (
          <>
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
                      {totals.diff >= 0 ? "+" : ""}${totals.diff.toLocaleString("es-MX", { minimumFractionDigits: 2 })} ({totals.pct >= 0 ? "+" : ""}{totals.pct.toFixed(2)}%)
                    </Text>
                  </View>
                </>
              )}
            </View>

            {positions.map((pos) => {
              const pd = prices[pos.ticker];
              const cp = pd?.price;
              const currentVal = cp ? pos.shares * cp : null;
              const investedVal = pos.shares * pos.avgPrice;
              const diff = currentVal !== null ? currentVal - investedVal : null;
              const pct = diff !== null && investedVal > 0 ? (diff / investedVal) * 100 : null;
              const isUp = diff !== null && diff >= 0;
              return (
                <View key={pos.id} style={[s.posCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={s.posHeader}>
                    <View>
                      <Text style={[s.posTicker, { color: colors.text }]}>{pos.ticker}</Text>
                      {pd?.name && <Text style={[s.posName, { color: colors.textMuted }]}>{pd.name}</Text>}
                    </View>
                    <TouchableOpacity onPress={() => removePosition(pos.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={{ color: colors.textDim, fontSize: 20 }}>×</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={s.posBody}>
                    <View>
                      <Text style={[s.posDetail, { color: colors.textMuted }]}>{pos.shares} acc × ${pos.avgPrice.toLocaleString()}</Text>
                      <Text style={[s.posDetail, { color: colors.textMuted }]}>Invertido: ${investedVal.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      {cp ? (
                        <>
                          <Text style={[s.posCurrentVal, { color: colors.text }]}>${(currentVal!).toLocaleString("es-MX", { minimumFractionDigits: 2 })}</Text>
                          <Text style={[s.posPct, { color: isUp ? "#22c55e" : "#ef4444" }]}>{isUp ? "+" : ""}{pct!.toFixed(2)}%</Text>
                        </>
                      ) : (
                        <Text style={[s.posDetail, { color: colors.textDim }]}>Sin precio</Text>
                      )}
                    </View>
                  </View>
                  {cp && <Text style={[s.posPrice, { color: colors.textDim }]}>Precio actual: ${cp.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {pd?.currency}</Text>}
                </View>
              );
            })}
          </>
        ) : null}

        {/* ── SIMULADOR 1: PORTAFOLIO CON IA ── */}
        <View style={[s.divider, { borderTopColor: colors.border }]} />
        <View style={s.simHeader}>
          <Ionicons name="analytics-outline" size={20} color="#22c55e" />
          <View style={{ flex: 1 }}>
            <Text style={[s.sectionTitle, { marginBottom: 2 }]}>Simulador de Portafolio</Text>
            <Text style={[s.simSubtitle, { color: colors.textMuted }]}>
              {positions.length > 0
                ? `Analiza tus ${positions.length} posiciones con forecast de analistas`
                : "Simula un portafolio hipotético según tu perfil"}
            </Text>
          </View>
        </View>
        <View style={s.scenarioRow}>
          {SCENARIOS.map((sc) => (
            <TouchableOpacity
              key={sc.value}
              style={[s.scenarioCard, { backgroundColor: colors.card, borderColor: colors.border }, scenario === sc.value && s.scenarioActive]}
              onPress={() => setScenario(sc.value)}
            >
              <Ionicons name={sc.icon} size={20} color={scenario === sc.value ? "#22c55e" : colors.textSub} style={{ marginBottom: 2 }} />
              <Text style={[s.scenarioLabel, { color: scenario === sc.value ? colors.text : colors.textSub }]}>{sc.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {positions.length === 0 && (
          <TextInput
            style={[s.simInput, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}
            value={capital} onChangeText={setCapital}
            placeholder="Capital de referencia (USD, opcional)" placeholderTextColor={colors.placeholder}
            keyboardType="numeric"
          />
        )}
        <TouchableOpacity style={[s.simBtn, simLoading && s.btnDisabled]} onPress={simulate} disabled={simLoading}>
          {simLoading
            ? <ActivityIndicator color="white" />
            : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="sparkles-outline" size={16} color="white" />
                <Text style={s.simBtnText}>
                  {positions.length > 0 ? "Analizar mi portafolio con IA" : "Simular portafolio"}
                </Text>
              </View>
            )}
        </TouchableOpacity>
        {analysis !== "" && (
          <View style={[s.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.resultText, { color: colors.textSub }]}>{analysis}</Text>
            <View style={s.disclaimer}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="warning-outline" size={13} color="#ca8a04" />
                <Text style={s.disclaimerText}>Análisis educativo. No es asesoramiento financiero.</Text>
              </View>
            </View>
          </View>
        )}

        {/* ── SIMULADOR 2: CALCULADORA DE INTERÉS COMPUESTO ── */}
        <View style={[s.divider, { borderTopColor: colors.border }]} />
        <View style={s.simHeader}>
          <Ionicons name="calculator-outline" size={20} color="#6366f1" />
          <View style={{ flex: 1 }}>
            <Text style={[s.sectionTitle, { marginBottom: 2 }]}>Calculadora de Inversión</Text>
            <Text style={[s.simSubtitle, { color: colors.textMuted }]}>
              ¿Cuánto tendrás si inviertes X a Y% por Z años?
            </Text>
          </View>
        </View>

        <View style={[s.calcCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={s.calcRow}>
            <View style={s.calcField}>
              <Text style={[s.calcLabel, { color: colors.textMuted }]}>Capital inicial (USD)</Text>
              <View style={[s.calcInputWrap, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                <Text style={[s.calcInputPrefix, { color: colors.textMuted }]}>$</Text>
                <TextInput
                  style={[s.calcInputInner, { color: colors.text }]}
                  value={calcCapital} onChangeText={setCalcCapital}
                  placeholder="10,000" placeholderTextColor={colors.placeholder}
                  keyboardType="numeric"
                />
              </View>
            </View>
            <View style={s.calcField}>
              <Text style={[s.calcLabel, { color: colors.textMuted }]}>Aportación mensual (USD)</Text>
              <View style={[s.calcInputWrap, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                <Text style={[s.calcInputPrefix, { color: colors.textMuted }]}>$</Text>
                <TextInput
                  style={[s.calcInputInner, { color: colors.text }]}
                  value={calcMonthly} onChangeText={setCalcMonthly}
                  placeholder="500 (opcional)" placeholderTextColor={colors.placeholder}
                  keyboardType="numeric"
                />
              </View>
            </View>
          </View>
          <View style={s.calcRow}>
            <View style={s.calcField}>
              <Text style={[s.calcLabel, { color: colors.textMuted }]}>Rendimiento anual (%)</Text>
              <TextInput
                style={[s.calcInput, { color: colors.text, backgroundColor: colors.bg, borderColor: colors.border }]}
                value={calcReturn} onChangeText={setCalcReturn}
                placeholder="10" placeholderTextColor={colors.placeholder}
                keyboardType="numeric"
              />
            </View>
            <View style={s.calcField}>
              <Text style={[s.calcLabel, { color: colors.textMuted }]}>Plazo (años)</Text>
              <TextInput
                style={[s.calcInput, { color: colors.text, backgroundColor: colors.bg, borderColor: colors.border }]}
                value={calcYears} onChangeText={setCalcYears}
                placeholder="20" placeholderTextColor={colors.placeholder}
                keyboardType="numeric"
              />
            </View>
          </View>
          <TouchableOpacity
            style={[s.calcBtn, (!calcCapital || !calcReturn || !calcYears) && s.btnDisabled]}
            onPress={calculateCompound}
            disabled={!calcCapital || !calcReturn || !calcYears}
          >
            <Text style={s.calcBtnText}>Calcular</Text>
          </TouchableOpacity>
        </View>

        {calcResult && (
          <View style={[s.calcResultCard, { backgroundColor: colors.card, borderColor: "#6366f1" }]}>
            <View style={s.calcResultTop}>
              <Text style={[s.calcResultLabel, { color: colors.textMuted }]}>Valor final</Text>
              <Text style={[s.calcResultFinal, { color: "#6366f1" }]}>
                ${fmtMoney(calcResult.final)}
              </Text>
            </View>
            <View style={[s.calcResultRow, { borderTopColor: colors.border }]}>
              <View style={s.calcResultItem}>
                <Text style={[s.calcResultItemLabel, { color: colors.textMuted }]}>Total invertido</Text>
                <Text style={[s.calcResultItemVal, { color: colors.text }]}>
                  ${fmtMoney(calcResult.invested)}
                </Text>
              </View>
              <View style={[s.calcResultDivider, { backgroundColor: colors.border }]} />
              <View style={s.calcResultItem}>
                <Text style={[s.calcResultItemLabel, { color: colors.textMuted }]}>Ganancia neta</Text>
                <Text style={[s.calcResultItemVal, { color: "#22c55e" }]}>
                  +${fmtMoney(calcResult.gain)} (+{calcResult.pct.toFixed(0)}%)
                </Text>
              </View>
            </View>
            <View style={[s.milestoneSection, { borderTopColor: colors.border }]}>
              <Text style={[s.milestoneTitle, { color: colors.textMuted }]}>Evolución año a año</Text>
              {calcResult.milestones.map((m) => (
                <View key={m.year} style={s.milestoneRow}>
                  <Text style={[s.milestoneYear, { color: colors.textSub }]}>Año {m.year}</Text>
                  <View style={[s.milestoneBar, { backgroundColor: colors.border }]}>
                    <View style={[s.milestoneBarFill, { flex: m.value / calcResult.final, backgroundColor: "#6366f1" }]} />
                    <View style={{ flex: 1 - m.value / calcResult.final }} />
                  </View>
                  <Text style={[s.milestoneVal, { color: colors.text }]}>
                    ${fmtMoney(m.value)}
                  </Text>
                </View>
              ))}
            </View>
            <View style={s.disclaimer}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="information-circle-outline" size={13} color="#6366f1" />
                <Text style={[s.disclaimerText, { color: "#6366f1" }]}>Cálculo con interés compuesto mensual. Los rendimientos reales varían.</Text>
              </View>
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
    btnSmall: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
    btnExcel: { backgroundColor: "#1d4ed8" },
    btnSmallText: { color: "white", fontSize: 12, fontWeight: "600" },
    // Screenshot primary button
    screenshotBtn: {
      backgroundColor: "#16a34a", borderRadius: 14, padding: 16,
      marginBottom: 12, shadowColor: "#16a34a", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    },
    screenshotBtnInner: { flexDirection: "row", alignItems: "center", gap: 14 },
    screenshotBtnText: { color: "white", fontSize: 15, fontWeight: "700" },
    screenshotBtnSub: { color: "rgba(255,255,255,0.75)", fontSize: 12, marginTop: 2 },
    // Screenshot preview card
    previewCard: { borderRadius: 14, borderWidth: 1.5, padding: 14, marginBottom: 12 },
    previewHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
    previewTitle: { fontSize: 15, fontWeight: "700" },
    previewSub: { fontSize: 12, marginTop: 2 },
    previewThumb: { width: 50, height: 90, borderRadius: 6, resizeMode: "cover" },
    previewRow: {
      flexDirection: "row", alignItems: "center", paddingVertical: 10,
      borderBottomWidth: 1, gap: 10,
    },
    previewRowLeft: { flex: 1 },
    previewTicker: { fontSize: 14, fontWeight: "700" },
    previewName: { fontSize: 11, marginTop: 1 },
    previewRowMid: { alignItems: "flex-end", marginRight: 4 },
    previewDetail: { fontSize: 12 },
    previewActions: { flexDirection: "row", gap: 10, marginTop: 14 },
    previewCancel: {
      flex: 1, borderWidth: 1, borderRadius: 10,
      paddingVertical: 12, alignItems: "center",
    },
    previewCancelText: { fontWeight: "500", fontSize: 14 },
    previewConfirm: {
      flex: 2, backgroundColor: "#16a34a", borderRadius: 10,
      paddingVertical: 12, alignItems: "center",
    },
    previewConfirmText: { color: "white", fontWeight: "700", fontSize: 14 },
    // Manual form
    formCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
    formTitle: { fontSize: 14, fontWeight: "600", marginBottom: 10 },
    formRow: { flexDirection: "row", marginBottom: 8 },
    formInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 8, width: "100%" },
    cancelBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center", borderWidth: 1 },
    cancelBtnText: { fontWeight: "500", fontSize: 14 },
    addBtn: { flex: 1, backgroundColor: "#16a34a", borderRadius: 10, paddingVertical: 12, alignItems: "center", marginLeft: 8 },
    addBtnText: { color: "white", fontWeight: "600", fontSize: 14 },
    // Empty
    emptyCard: { borderRadius: 14, borderWidth: 1, padding: 24, alignItems: "center", marginBottom: 16 },
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
    scenarioLabel: { fontSize: 12, fontWeight: "600" },
    simInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, marginBottom: 12 },
    simBtn: { backgroundColor: "#16a34a", borderRadius: 12, paddingVertical: 14, alignItems: "center", justifyContent: "center", marginBottom: 16 },
    btnDisabled: { opacity: 0.5 },
    simBtnText: { color: "white", fontWeight: "600", fontSize: 15 },
    simHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 12 },
    simSubtitle: { fontSize: 12, lineHeight: 17 },
    resultCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 4 },
    resultText: { fontSize: 13, lineHeight: 20 },
    disclaimer: { marginTop: 10, backgroundColor: "rgba(234,179,8,0.1)", borderWidth: 1, borderColor: "rgba(234,179,8,0.3)", borderRadius: 8, padding: 8 },
    disclaimerText: { color: "#ca8a04", fontSize: 11 },
    // Compound interest calculator
    calcCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
    calcRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
    calcField: { flex: 1 },
    calcLabel: { fontSize: 11, fontWeight: "600", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 },
    calcInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
    calcInputWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
    calcInputPrefix: { fontSize: 14, fontWeight: "600", marginRight: 4 },
    calcInputInner: { flex: 1, fontSize: 14, padding: 0 },
    calcBtn: { backgroundColor: "#6366f1", borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 4 },
    calcBtnText: { color: "white", fontWeight: "700", fontSize: 15 },
    calcResultCard: { borderRadius: 14, borderWidth: 1.5, padding: 16, marginBottom: 4 },
    calcResultTop: { alignItems: "center", marginBottom: 14 },
    calcResultLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
    calcResultFinal: { fontSize: 32, fontWeight: "800" },
    calcResultRow: { flexDirection: "row", borderTopWidth: 1, paddingTop: 12, marginBottom: 14 },
    calcResultItem: { flex: 1, alignItems: "center" },
    calcResultItemLabel: { fontSize: 11, marginBottom: 3 },
    calcResultItemVal: { fontSize: 14, fontWeight: "700" },
    calcResultDivider: { width: 1, marginVertical: 4 },
    milestoneSection: { borderTopWidth: 1, paddingTop: 12 },
    milestoneTitle: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 },
    milestoneRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
    milestoneYear: { fontSize: 12, fontWeight: "600", width: 44 },
    milestoneBar: { flex: 1, height: 8, borderRadius: 4, overflow: "hidden", flexDirection: "row" },
    milestoneBarFill: { height: "100%", borderRadius: 4 },
    milestoneVal: { fontSize: 12, fontWeight: "600", width: 80, textAlign: "right" },
  });
}
