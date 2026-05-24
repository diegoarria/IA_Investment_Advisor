import React, { useState, useMemo, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, FlatList,
  Modal, StyleSheet, SafeAreaView, ActivityIndicator,
  KeyboardAvoidingView, Platform, Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Markdown from "react-native-markdown-display";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { chatApi } from "../../src/lib/api";

// ─── Data ──────────────────────────────────────────────────────────────────

interface Topic {
  id: string;
  category: string;
  icon: IoniconName;
  title: string;
  prompt: string;
}

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const CATEGORIES: { id: string; icon: IoniconName; title: string }[] = [
  { id: "all",         icon: "grid-outline",      title: "Todo" },
  { id: "basics",      icon: "library-outline",   title: "Básicos" },
  { id: "instruments", icon: "business-outline",  title: "Instrumentos" },
  { id: "analysis",    icon: "analytics-outline", title: "Análisis" },
  { id: "strategies",  icon: "flag-outline",      title: "Estrategias" },
  { id: "psychology",  icon: "bulb-outline",      title: "Psicología" },
  { id: "markets",     icon: "globe-outline",     title: "Mercados" },
  { id: "mexico",      icon: "location-outline",  title: "México" },
  { id: "companies",   icon: "briefcase-outline", title: "Empresas" },
];

const TOPICS: Topic[] = [
  // Básicos
  { id: "etf",       category: "basics",      icon: "layers-outline",           title: "ETF",                    prompt: "Explícame qué es un ETF de forma completa. Incluye: definición, cómo funciona, tipos, ventajas y desventajas, ejemplos populares y diferencia con un fondo mutuo. Usa ejemplos concretos." },
  { id: "accion",    category: "basics",      icon: "trending-up-outline",      title: "Acciones",               prompt: "Explícame qué es una acción bursátil. Incluye: definición, tipos (ordinaria vs preferente), derechos del accionista, cómo se compra/vende y qué mueve el precio." },
  { id: "bono",      category: "basics",      icon: "document-text-outline",    title: "Bonos",                  prompt: "Explícame qué es un bono. Incluye: cómo funciona el cupón, tipos de bonos, diferencia con acciones, riesgo y rendimiento, y cuándo conviene invertir en bonos." },
  { id: "dividendo", category: "basics",      icon: "cash-outline",             title: "Dividendos",             prompt: "Explícame qué son los dividendos. Incluye: cómo funcionan, dividend yield, ex-dividend date, empresas que pagan bien y la estrategia de inversión por dividendos." },
  { id: "indice",    category: "basics",      icon: "list-outline",             title: "Índices Bursátiles",     prompt: "Explícame qué es un índice bursátil. Incluye: S&P 500, NASDAQ, Dow Jones, IPC México, cómo se calculan y cómo invertir en un índice." },
  { id: "interes_c", category: "basics",      icon: "rocket-outline",           title: "Interés Compuesto",      prompt: "Explícame el interés compuesto y por qué es tan poderoso. Incluye: cómo funciona, ejemplos con números, la regla del 72 y cómo aprovecharlo." },
  { id: "inflacion", category: "basics",      icon: "arrow-up-outline",         title: "Inflación",              prompt: "Explícame la inflación y su impacto en las inversiones. Incluye: cómo erosiona el capital, activos que protegen contra ella y estrategias para invertir en contextos inflacionarios." },
  { id: "liquidez",  category: "basics",      icon: "water-outline",            title: "Liquidez",               prompt: "Explícame qué es la liquidez en finanzas e inversiones. Incluye: por qué importa, activos líquidos vs ilíquidos, el trade-off rendimiento-liquidez y cuánta liquidez mantener en un portafolio." },

  // Instrumentos
  { id: "crypto",    category: "instruments", icon: "logo-bitcoin",             title: "Criptomonedas",          prompt: "Explícame las criptomonedas como inversión. Incluye: qué son, Bitcoin vs Ethereum vs altcoins, volatilidad, casos de uso reales, riesgos y cómo integrarlas en un portafolio." },
  { id: "reit",      category: "instruments", icon: "business-outline",         title: "REITs",                  prompt: "Explícame qué son los REITs. Incluye: cómo funcionan, tipos, rendimientos históricos, su equivalente en México (FIBRAS) y cómo añadirlos a un portafolio." },
  { id: "commodities",category:"instruments", icon: "cube-outline",             title: "Commodities",            prompt: "Explícame los commodities como inversión. Incluye: tipos (oro, petróleo, agrícolas), cómo invertir en ellos (futuros, ETFs), por qué sirven como cobertura y su comportamiento en distintos ciclos." },
  { id: "derivados", category: "instruments", icon: "git-branch-outline",       title: "Derivados",              prompt: "Explícame qué son los derivados financieros (opciones, futuros, swaps). Incluye: cómo funcionan, para qué sirven (cobertura vs especulación), y por qué son complejos y riesgosos para principiantes." },

  // Análisis
  { id: "pe_ratio",  category: "analysis",    icon: "calculator-outline",       title: "P/E Ratio",              prompt: "Explícame el P/E Ratio (Price-to-Earnings). Incluye: cómo se calcula, qué significa, P/E alto vs bajo, comparación entre sectores, el PEG ratio y sus limitaciones." },
  { id: "roe",       category: "analysis",    icon: "trophy-outline",           title: "ROE",                    prompt: "Explícame el ROE (Return on Equity). Incluye: cómo se calcula, qué indica de la calidad del negocio, cómo compararlo, su relación con ROA y ROIC, y ejemplos con empresas reales." },
  { id: "dcf",       category: "analysis",    icon: "hourglass-outline",        title: "Valuación DCF",          prompt: "Explícame el modelo de valuación DCF (Discounted Cash Flow). Incluye: concepto de valor presente, cómo estimar flujos futuros, tasa de descuento, valor terminal y limitaciones del modelo." },
  { id: "tec",       category: "analysis",    icon: "stats-chart-outline",      title: "Análisis Técnico",       prompt: "Explícame el análisis técnico. Incluye: principios básicos, indicadores clave (RSI, MACD, medias móviles), soporte y resistencia, patrones de velas y debate vs análisis fundamental." },
  { id: "fund",      category: "analysis",    icon: "search-outline",           title: "Análisis Fundamental",   prompt: "Explícame el análisis fundamental de empresas paso a paso. Incluye: ingresos, márgenes, deuda, crecimiento, cómo leer balance y estado de resultados, y métricas clave." },
  { id: "estados",   category: "analysis",    icon: "reader-outline",           title: "Estados Financieros",    prompt: "Explícame cómo leer los estados financieros de una empresa. Incluye: balance general, estado de resultados, flujo de efectivo, y qué buscar en cada uno como inversionista." },
  { id: "moat",      category: "analysis",    icon: "shield-outline",           title: "Ventaja Competitiva",    prompt: "Explícame el concepto de 'moat' o ventaja competitiva (Warren Buffett). Incluye: tipos de moat, cómo identificarlos y ejemplos de empresas con moat fuerte vs débil." },
  { id: "ebitda",    category: "analysis",    icon: "bar-chart-outline",        title: "EBITDA",                 prompt: "Explícame qué es el EBITDA y para qué sirve en el análisis de empresas. Incluye: cómo se calcula, por qué se usa, sus limitaciones y cómo usarlo para comparar empresas." },

  // Estrategias
  { id: "dca",       category: "strategies",  icon: "calendar-outline",         title: "Dollar Cost Averaging",  prompt: "Explícame la estrategia DCA (Dollar Cost Averaging). Incluye: cómo funciona, por qué reduce el riesgo de timing, comparación con lump sum, cuándo conviene y cómo implementarla." },
  { id: "diversif",  category: "strategies",  icon: "pie-chart-outline",        title: "Diversificación",        prompt: "Explícame la diversificación en inversiones. Incluye: por qué funciona, correlación de activos, diversificación por tipo/sector/geografía, cuánto es suficiente y el costo de sobre-diversificar." },
  { id: "value_inv", category: "strategies",  icon: "diamond-outline",          title: "Value Investing",        prompt: "Explícame el Value Investing (Buffett y Graham). Incluye: principios fundamentales, margen de seguridad, cómo encontrar empresas subvaloradas y por qué es difícil de ejecutar." },
  { id: "growth_inv",category: "strategies",  icon: "leaf-outline",             title: "Growth Investing",       prompt: "Explícame el Growth Investing. Incluye: qué busca, métricas clave (TAM, revenue growth, gross margin), diferencias con value investing y riesgos de múltiplos altos." },
  { id: "pasivo",    category: "strategies",  icon: "moon-outline",             title: "Inversión Pasiva",       prompt: "Explícame la inversión pasiva vs activa. Incluye: fondos index, la evidencia de que la mayoría de fondos activos no superan al índice, el argumento de Jack Bogle y cómo construir un portafolio pasivo." },
  { id: "rebalanceo",category: "strategies",  icon: "refresh-outline",          title: "Rebalanceo",             prompt: "Explícame el rebalanceo de portafolios. Incluye: por qué es necesario, rebalanceo por tiempo vs umbral, consecuencias fiscales y su impacto en el rendimiento." },
  { id: "cobertura", category: "strategies",  icon: "shield-checkmark-outline", title: "Cobertura (Hedging)",    prompt: "Explícame el hedging o cobertura en inversiones. Incluye: qué es, para qué sirve, herramientas comunes (opciones, ETFs inversos), costos y cuándo tiene sentido para un inversor individual." },

  // Psicología
  { id: "sesgo_c",   category: "psychology",  icon: "eye-outline",              title: "Sesgo de Confirmación", prompt: "Explícame el sesgo de confirmación en inversiones. Incluye: cómo nos afecta, ejemplos concretos, cómo lleva a pérdidas y estrategias para contrarrestarlo." },
  { id: "aversion",  category: "psychology",  icon: "alert-circle-outline",     title: "Aversión a la Pérdida", prompt: "Explícame la aversión a la pérdida (Kahneman & Tversky). Incluye: por qué las pérdidas duelen más que las ganancias, cómo afecta las decisiones y cómo manejarla." },
  { id: "fomo",      category: "psychology",  icon: "flash-outline",            title: "FOMO",                   prompt: "Explícame el FOMO (Fear Of Missing Out) en inversiones. Incluye: por qué es dañino, casos históricos (cripto 2021, GME) y estrategias para no dejarse llevar." },
  { id: "herd",      category: "psychology",  icon: "people-outline",           title: "Comportamiento de Manada",prompt: "Explícame el comportamiento de manada en mercados. Incluye: por qué ocurre, cómo genera burbujas y crashes, ejemplos históricos y cómo un inversor racional puede aprovecharlo." },
  { id: "ancla",     category: "psychology",  icon: "pin-outline",           title: "Sesgo de Anclaje",       prompt: "Explícame el sesgo de anclaje en inversiones. Incluye: qué es, cómo nos afecta al evaluar precios y valoraciones, ejemplos concretos y cómo evitarlo." },

  // Mercados
  { id: "bull_bear", category: "markets",     icon: "swap-vertical-outline",    title: "Bull vs Bear Market",   prompt: "Explícame la diferencia entre mercado alcista y bajista. Incluye: definiciones, duración histórica promedio, cómo comportarse en cada fase y por qué predecirlos es casi imposible." },
  { id: "tasas",     category: "markets",     icon: "home-outline",             title: "Tasas de Interés",      prompt: "Explícame el impacto de las tasas de interés en los mercados. Incluye: cómo la Fed y Banxico afectan los mercados, relación con bonos, impacto en acciones growth vs value y el ciclo económico." },
  { id: "recesion",  category: "markets",     icon: "trending-down-outline",    title: "Recesión",              prompt: "Explícame qué es una recesión económica y cómo afecta las inversiones. Incluye: definición técnica, indicadores que la anticipan, sectores que resisten mejor y estrategias para proteger el portafolio." },
  { id: "forex",     category: "markets",     icon: "swap-horizontal-outline",  title: "Forex",                 prompt: "Explícame el mercado Forex. Incluye: cómo funciona, pares más importantes, qué mueve los tipos de cambio, diferencias con la bolsa y por qué es tan riesgoso para principiantes." },

  // México
  { id: "cetes",     category: "mexico",      icon: "wallet-outline",           title: "CETES",                 prompt: "Explícame los CETES en México. Incluye: cómo funcionan, plazos, rendimientos, cómo comprarlos en cetesdirecto.com.mx, ventajas fiscales y si convienen para distintos perfiles." },
  { id: "fibras",    category: "mexico",      icon: "construct-outline",        title: "FIBRAS",                prompt: "Explícame las FIBRAS mexicanas (REITs de México). Incluye: cómo funcionan, principales FIBRAS del mercado, rendimientos típicos, ventajas fiscales y cómo invertir." },
  { id: "bmv",       category: "mexico",      icon: "stats-chart-outline",      title: "Bolsa Mexicana (BMV)",  prompt: "Explícame cómo funciona la Bolsa Mexicana de Valores. Incluye: estructura, índices (IPC, INMEX), principales empresas, diferencias con Wall Street y cómo acceder siendo mexicano." },
  { id: "gbm",       category: "mexico",      icon: "phone-portrait-outline",   title: "Invertir desde México", prompt: "Explícame cómo un mexicano puede invertir en mercados internacionales. Incluye: brokers disponibles (GBM+, BIVA, Interactive Brokers), requisitos, implicaciones fiscales (SAT), y recomendaciones para comenzar." },

  // Empresas
  { id: "nvidia",    category: "companies",   icon: "hardware-chip-outline",    title: "NVIDIA",                prompt: "Explícame el modelo de negocio de NVIDIA. Incluye: cómo gana dinero, su posición en GPUs para IA, moat competitivo, métricas financieras clave y principales riesgos." },
  { id: "apple",     category: "companies",   icon: "phone-portrait-outline",   title: "Apple",                 prompt: "Explícame el modelo de negocio de Apple. Incluye: hardware vs servicios, el ecosistema como moat, métricas clave, programa de recompra de acciones y riesgos a largo plazo." },
  { id: "amazon",    category: "companies",   icon: "storefront-outline",       title: "Amazon",                prompt: "Explícame el modelo de negocio de Amazon. Incluye: retail vs AWS vs publicidad, cómo AWS subsidia el retail, métricas clave y principales riesgos competitivos." },
  { id: "microsoft", category: "companies",   icon: "desktop-outline",          title: "Microsoft",             prompt: "Explícame el modelo de negocio de Microsoft. Incluye: sus segmentos (Azure, Office, gaming), su transformación cloud, moat competitivo, métricas financieras y perspectivas de IA." },
  { id: "tesla",     category: "companies",   icon: "car-outline",              title: "Tesla",                 prompt: "Explícame el modelo de negocio de Tesla. Incluye: más allá del carro eléctrico (energía, software, robo-taxi), su posición competitiva, los riesgos principales y por qué es tan debatida su valuación." },
];

// ─── Company logos (Clearbit free logo API) ───────────────────────────────
const COMPANY_LOGOS: Record<string, string> = {
  nvidia:    "https://logo.clearbit.com/nvidia.com",
  apple:     "https://logo.clearbit.com/apple.com",
  amazon:    "https://logo.clearbit.com/amazon.com",
  microsoft: "https://logo.clearbit.com/microsoft.com",
  tesla:     "https://logo.clearbit.com/tesla.com",
};

// ─── Component ─────────────────────────────────────────────────────────────

export default function LearnScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const markdownStyles = useMemo(() => makeMarkdownStyles(colors), [colors]);

  const [search, setSearch] = useState("");
  const [selectedCat, setSelectedCat] = useState("all");
  const [modal, setModal] = useState<{ title: string; prompt: string } | null>(null);
  const [content, setContent] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return TOPICS.filter((t) => {
      const matchCat = selectedCat === "all" || t.category === selectedCat;
      const matchQ = !q || t.title.toLowerCase().includes(q) || t.category.includes(q);
      return matchCat && matchQ;
    });
  }, [search, selectedCat]);

  const openTopic = async (title: string, topicContext: string) => {
    setModal({ title, prompt: topicContext });
    setContent("");
    setStreaming(true);
    const prompt =
      `Explícame "${title}" de forma breve y fácil de entender, como si le explicaras a alguien que nunca ha invertido.\n\n` +
      `Usa exactamente este formato:\n\n` +
      `## ¿Qué es?\n` +
      `(1-2 oraciones simples, sin jerga)\n\n` +
      `## Ejemplo real\n` +
      `(un caso concreto y cotidiano que cualquiera pueda visualizar)\n\n` +
      `## ¿Por qué importa?\n` +
      `(1-2 oraciones sobre qué decisión de inversión mejora saber esto)\n\n` +
      `Contexto del tema para tu referencia: ${topicContext}`;
    let full = "";
    await chatApi.stream(
      prompt,
      [],
      (chunk) => { full += chunk; setContent(full); },
      () => setStreaming(false)
    );
  };

  const handleCustomSearch = () => {
    if (!search.trim()) return;
    openTopic(
      search.trim(),
      `Concepto financiero: "${search.trim()}". Explícalo brevemente con un ejemplo real.`
    );
  };

  return (
    <SafeAreaView style={s.container}>
      {/* Barra de búsqueda */}
      <View style={[s.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Ionicons name="search-outline" size={16} color={colors.textMuted} style={{ marginRight: 8 }} />
        <TextInput
          style={[s.searchInput, { color: colors.text }]}
          value={search}
          onChangeText={setSearch}
          placeholder="Busca cualquier tema financiero..."
          placeholderTextColor={colors.placeholder}
          returnKeyType="search"
          onSubmitEditing={handleCustomSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={handleCustomSearch} style={s.searchBtn}>
            <Text style={s.searchBtnText}>Preguntar</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Categorías */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.catsScroll} contentContainerStyle={s.catsContent}>
        {CATEGORIES.map((cat) => {
          const active = selectedCat === cat.id;
          return (
            <TouchableOpacity
              key={cat.id}
              style={[
                s.catChip,
                { backgroundColor: colors.card, borderColor: colors.border },
                active && s.catChipActive,
              ]}
              onPress={() => setSelectedCat(cat.id)}
            >
              <Ionicons name={cat.icon} size={14} color={active ? colors.accentLight : colors.textSub} />
              <Text style={[s.catText, { color: active ? colors.accentLight : colors.textSub }]}>
                {cat.title}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Grid de temas */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={s.grid}
        columnWrapperStyle={s.gridRow}
        ListEmptyComponent={
          <View style={s.emptyState}>
            <Ionicons name="help-circle-outline" size={40} color={colors.textMuted} style={{ marginBottom: 12 }} />
            <Text style={[s.emptyTitle, { color: colors.text }]}>No encontré ese tema</Text>
            <Text style={[s.emptyDesc, { color: colors.textMuted }]}>
              Toca "Preguntar" para que la IA te explique cualquier concepto
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[s.topicCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => openTopic(item.title, item.prompt)}
            activeOpacity={0.75}
          >
            {COMPANY_LOGOS[item.id] ? (
              <Image source={{ uri: COMPANY_LOGOS[item.id] }} style={s.companyLogo} resizeMode="contain" />
            ) : (
              <View style={[s.topicIconBox, { backgroundColor: colors.accentLight + "15" }]}>
                <Ionicons name={item.icon} size={20} color={colors.accentLight} />
              </View>
            )}
            <Text style={[s.topicTitle, { color: colors.text }]}>{item.title}</Text>
            <View style={[s.topicCatPill, { backgroundColor: colors.border }]}>
              <Text style={[s.topicCat, { color: colors.textMuted }]}>
                {CATEGORIES.find((c) => c.id === item.category)?.title}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />

      {/* Modal de contenido */}
      <Modal visible={!!modal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModal(null)}>
        <SafeAreaView style={[s.modalContainer, { backgroundColor: colors.bg }]}>
          <View style={[s.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setModal(null)} style={s.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
            <Text style={[s.modalTitle, { color: colors.text }]}>{modal?.title}</Text>
            <View style={{ width: 32 }} />
          </View>

          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={s.modalContent}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            >
              {content ? (
                <Markdown style={markdownStyles}>{content}</Markdown>
              ) : (
                <View style={s.loadingState}>
                  <ActivityIndicator color={colors.accentLight} size="large" />
                  <Text style={[s.loadingText, { color: colors.textMuted }]}>La IA está preparando la explicación...</Text>
                </View>
              )}
              {streaming && content && (
                <Text style={{ color: "#22c55e", fontSize: 16 }}>▋</Text>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },

    // Search
    searchBar: {
      flexDirection: "row", alignItems: "center", gap: 10,
      marginHorizontal: 14, marginTop: 14, marginBottom: 10,
      borderRadius: 16, borderWidth: 1,
      paddingHorizontal: 14, paddingVertical: 11,
    },
    searchInput: { flex: 1, fontSize: 14, paddingVertical: 0 },
    searchBtn: {
      backgroundColor: c.accent, borderRadius: 10,
      paddingHorizontal: 12, paddingVertical: 7,
    },
    searchBtnText: { color: "white", fontSize: 12, fontWeight: "700", letterSpacing: 0.2 },

    // Categories
    catsScroll: { flexShrink: 0 },
    catsContent: { paddingHorizontal: 12, gap: 7, flexDirection: "row", paddingVertical: 6 },
    catChip: {
      flexDirection: "row", alignItems: "center", gap: 6,
      borderRadius: 20, borderWidth: 1,
      paddingHorizontal: 13, height: 36, flexShrink: 0,
    },
    catChipActive: { borderColor: c.accentLight, backgroundColor: c.accentLight + "18" },
    catText: { fontSize: 13, fontWeight: "600" },

    // Topic grid
    grid: { padding: 12, paddingTop: 6, paddingBottom: 40 },
    gridRow: { gap: 10 },
    topicCard: {
      flex: 1, borderRadius: 16, borderWidth: 1,
      padding: 14, marginBottom: 10, minHeight: 105,
    },
    topicIconBox: {
      width: 40, height: 40, borderRadius: 12,
      alignItems: "center", justifyContent: "center", marginBottom: 10,
    },
    topicEmoji: { fontSize: 26, marginBottom: 8 },
    companyLogo: { width: 38, height: 38, marginBottom: 8, borderRadius: 9 },
    topicTitle: { fontSize: 13, fontWeight: "700", marginBottom: 4, letterSpacing: -0.1 },
    topicCatPill: {
      alignSelf: "flex-start",
      borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
    },
    topicCat: { fontSize: 9, fontWeight: "600", letterSpacing: 0.3 },

    // Empty
    emptyState: { alignItems: "center", paddingTop: 60, paddingHorizontal: 32 },
    emptyTitle: { fontSize: 16, fontWeight: "700", marginBottom: 8, letterSpacing: -0.2 },
    emptyDesc: { fontSize: 13, textAlign: "center", lineHeight: 20 },

    // Learn modal
    modalContainer: { flex: 1 },
    modalHeader: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 16, paddingVertical: 13,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    closeBtn: {
      width: 32, height: 32, borderRadius: 16,
      alignItems: "center", justifyContent: "center",
    },
    modalTitle: { fontSize: 16, fontWeight: "700", flex: 1, textAlign: "center", letterSpacing: -0.2 },
    modalContent: { padding: 20, paddingBottom: 48 },
    loadingState: { alignItems: "center", paddingTop: 72, gap: 16 },
    loadingText: { fontSize: 14 },
  });
}

function makeMarkdownStyles(c: Colors) {
  return {
    body: { color: c.textSub, fontSize: 15, lineHeight: 25 },
    heading1: { color: c.text, fontSize: 21, fontWeight: "800" as const, letterSpacing: -0.4, marginTop: 18, marginBottom: 8, paddingBottom: 6, borderBottomWidth: 1.5, borderBottomColor: c.accentLight },
    heading2: { color: c.text, fontSize: 17, fontWeight: "700" as const, letterSpacing: -0.2, marginTop: 16, marginBottom: 6 },
    heading3: { color: c.accentLight, fontSize: 13, fontWeight: "700" as const, letterSpacing: 0.5, textTransform: "uppercase" as const, marginTop: 12, marginBottom: 5 },
    strong: { color: c.text, fontWeight: "700" as const },
    em: { color: c.accentLight, fontStyle: "italic" as const },
    bullet_list: { marginVertical: 6 },
    ordered_list: { marginVertical: 6 },
    list_item: { color: c.textSub, fontSize: 15, lineHeight: 24, marginVertical: 2 },
    code_inline: { backgroundColor: c.accentLight + "1a", color: c.accentLight, borderRadius: 5, paddingHorizontal: 5, fontSize: 13, fontWeight: "600" as const },
    fence: { backgroundColor: c.bgRaised ?? c.card, borderRadius: 12, padding: 14, marginVertical: 8, borderWidth: 1, borderColor: c.border },
    code_block: { color: c.accentLight, fontSize: 13, fontFamily: "monospace" as const },
    blockquote: { borderLeftWidth: 3, borderLeftColor: c.accentLight, backgroundColor: c.accentLight + "0d", paddingLeft: 12, paddingVertical: 8, marginVertical: 8, borderRadius: 4 },
    table: { borderWidth: 1, borderColor: c.border, borderRadius: 10, marginVertical: 8, overflow: "hidden" as const },
    thead: { backgroundColor: c.accent + "33" },
    th: { color: c.accentLight, fontWeight: "700" as const, padding: 9, fontSize: 12, letterSpacing: 0.4 },
    td: { color: c.textSub, padding: 9, fontSize: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    hr: { borderColor: c.border, marginVertical: 14 },
    link: { color: c.accentLight, textDecorationLine: "underline" as const },
  };
}
