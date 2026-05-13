import React, { useState, useMemo, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, FlatList,
  Modal, StyleSheet, SafeAreaView, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import Markdown from "react-native-markdown-display";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { chatApi } from "../../src/lib/api";

// ─── Data ──────────────────────────────────────────────────────────────────

interface Topic {
  id: string;
  category: string;
  emoji: string;
  title: string;
  prompt: string;
}

const CATEGORIES = [
  { id: "all",        emoji: "✨", title: "Todo" },
  { id: "basics",     emoji: "📚", title: "Básicos" },
  { id: "instruments",emoji: "🏦", title: "Instrumentos" },
  { id: "analysis",   emoji: "📊", title: "Análisis" },
  { id: "strategies", emoji: "🎯", title: "Estrategias" },
  { id: "psychology", emoji: "🧠", title: "Psicología" },
  { id: "markets",    emoji: "🌎", title: "Mercados" },
  { id: "mexico",     emoji: "🇲🇽", title: "México" },
  { id: "companies",  emoji: "🏢", title: "Empresas" },
];

const TOPICS: Topic[] = [
  // Básicos
  { id: "etf",       category: "basics",      emoji: "📦", title: "ETF",                    prompt: "Explícame qué es un ETF de forma completa. Incluye: definición, cómo funciona, tipos, ventajas y desventajas, ejemplos populares y diferencia con un fondo mutuo. Usa ejemplos concretos." },
  { id: "accion",    category: "basics",      emoji: "📈", title: "Acciones",               prompt: "Explícame qué es una acción bursátil. Incluye: definición, tipos (ordinaria vs preferente), derechos del accionista, cómo se compra/vende y qué mueve el precio." },
  { id: "bono",      category: "basics",      emoji: "📄", title: "Bonos",                  prompt: "Explícame qué es un bono. Incluye: cómo funciona el cupón, tipos de bonos, diferencia con acciones, riesgo y rendimiento, y cuándo conviene invertir en bonos." },
  { id: "dividendo", category: "basics",      emoji: "💵", title: "Dividendos",             prompt: "Explícame qué son los dividendos. Incluye: cómo funcionan, dividend yield, ex-dividend date, empresas que pagan bien y la estrategia de inversión por dividendos." },
  { id: "indice",    category: "basics",      emoji: "🗂️", title: "Índices Bursátiles",     prompt: "Explícame qué es un índice bursátil. Incluye: S&P 500, NASDAQ, Dow Jones, IPC México, cómo se calculan y cómo invertir en un índice." },
  { id: "interes_c", category: "basics",      emoji: "🚀", title: "Interés Compuesto",      prompt: "Explícame el interés compuesto y por qué es tan poderoso. Incluye: cómo funciona, ejemplos con números, la regla del 72 y cómo aprovecharlo." },
  { id: "inflacion", category: "basics",      emoji: "💹", title: "Inflación",              prompt: "Explícame la inflación y su impacto en las inversiones. Incluye: cómo erosiona el capital, activos que protegen contra ella y estrategias para invertir en contextos inflacionarios." },
  { id: "liquidez",  category: "basics",      emoji: "💧", title: "Liquidez",               prompt: "Explícame qué es la liquidez en finanzas e inversiones. Incluye: por qué importa, activos líquidos vs ilíquidos, el trade-off rendimiento-liquidez y cuánta liquidez mantener en un portafolio." },

  // Instrumentos
  { id: "crypto",    category: "instruments", emoji: "₿",  title: "Criptomonedas",          prompt: "Explícame las criptomonedas como inversión. Incluye: qué son, Bitcoin vs Ethereum vs altcoins, volatilidad, casos de uso reales, riesgos y cómo integrarlas en un portafolio." },
  { id: "reit",      category: "instruments", emoji: "🏢", title: "REITs",                  prompt: "Explícame qué son los REITs. Incluye: cómo funcionan, tipos, rendimientos históricos, su equivalente en México (FIBRAS) y cómo añadirlos a un portafolio." },
  { id: "commodities",category:"instruments", emoji: "🛢️", title: "Commodities",            prompt: "Explícame los commodities como inversión. Incluye: tipos (oro, petróleo, agrícolas), cómo invertir en ellos (futuros, ETFs), por qué sirven como cobertura y su comportamiento en distintos ciclos." },
  { id: "derivados", category: "instruments", emoji: "⚙️", title: "Derivados",              prompt: "Explícame qué son los derivados financieros (opciones, futuros, swaps). Incluye: cómo funcionan, para qué sirven (cobertura vs especulación), y por qué son complejos y riesgosos para principiantes." },

  // Análisis
  { id: "pe_ratio",  category: "analysis",    emoji: "🔢", title: "P/E Ratio",              prompt: "Explícame el P/E Ratio (Price-to-Earnings). Incluye: cómo se calcula, qué significa, P/E alto vs bajo, comparación entre sectores, el PEG ratio y sus limitaciones." },
  { id: "roe",       category: "analysis",    emoji: "📐", title: "ROE",                    prompt: "Explícame el ROE (Return on Equity). Incluye: cómo se calcula, qué indica de la calidad del negocio, cómo compararlo, su relación con ROA y ROIC, y ejemplos con empresas reales." },
  { id: "dcf",       category: "analysis",    emoji: "💰", title: "Valuación DCF",          prompt: "Explícame el modelo de valuación DCF (Discounted Cash Flow). Incluye: concepto de valor presente, cómo estimar flujos futuros, tasa de descuento, valor terminal y limitaciones del modelo." },
  { id: "tec",       category: "analysis",    emoji: "📉", title: "Análisis Técnico",       prompt: "Explícame el análisis técnico. Incluye: principios básicos, indicadores clave (RSI, MACD, medias móviles), soporte y resistencia, patrones de velas y debate vs análisis fundamental." },
  { id: "fund",      category: "analysis",    emoji: "🔍", title: "Análisis Fundamental",   prompt: "Explícame el análisis fundamental de empresas paso a paso. Incluye: ingresos, márgenes, deuda, crecimiento, cómo leer balance y estado de resultados, y métricas clave." },
  { id: "estados",   category: "analysis",    emoji: "📋", title: "Estados Financieros",    prompt: "Explícame cómo leer los estados financieros de una empresa. Incluye: balance general, estado de resultados, flujo de efectivo, y qué buscar en cada uno como inversionista." },
  { id: "moat",      category: "analysis",    emoji: "🏰", title: "Ventaja Competitiva",    prompt: "Explícame el concepto de 'moat' o ventaja competitiva (Warren Buffett). Incluye: tipos de moat, cómo identificarlos y ejemplos de empresas con moat fuerte vs débil." },
  { id: "ebitda",    category: "analysis",    emoji: "📊", title: "EBITDA",                 prompt: "Explícame qué es el EBITDA y para qué sirve en el análisis de empresas. Incluye: cómo se calcula, por qué se usa, sus limitaciones y cómo usarlo para comparar empresas." },

  // Estrategias
  { id: "dca",       category: "strategies",  emoji: "📅", title: "Dollar Cost Averaging",  prompt: "Explícame la estrategia DCA (Dollar Cost Averaging). Incluye: cómo funciona, por qué reduce el riesgo de timing, comparación con lump sum, cuándo conviene y cómo implementarla." },
  { id: "diversif",  category: "strategies",  emoji: "🎨", title: "Diversificación",        prompt: "Explícame la diversificación en inversiones. Incluye: por qué funciona, correlación de activos, diversificación por tipo/sector/geografía, cuánto es suficiente y el costo de sobre-diversificar." },
  { id: "value_inv", category: "strategies",  emoji: "💎", title: "Value Investing",        prompt: "Explícame el Value Investing (Buffett y Graham). Incluye: principios fundamentales, margen de seguridad, cómo encontrar empresas subvaloradas y por qué es difícil de ejecutar." },
  { id: "growth_inv",category: "strategies",  emoji: "🌱", title: "Growth Investing",       prompt: "Explícame el Growth Investing. Incluye: qué busca, métricas clave (TAM, revenue growth, gross margin), diferencias con value investing y riesgos de múltiplos altos." },
  { id: "pasivo",    category: "strategies",  emoji: "😴", title: "Inversión Pasiva",       prompt: "Explícame la inversión pasiva vs activa. Incluye: fondos index, la evidencia de que la mayoría de fondos activos no superan al índice, el argumento de Jack Bogle y cómo construir un portafolio pasivo." },
  { id: "rebalanceo",category: "strategies",  emoji: "⚖️", title: "Rebalanceo",             prompt: "Explícame el rebalanceo de portafolios. Incluye: por qué es necesario, rebalanceo por tiempo vs umbral, consecuencias fiscales y su impacto en el rendimiento." },
  { id: "cobertura", category: "strategies",  emoji: "🛡️", title: "Cobertura (Hedging)",    prompt: "Explícame el hedging o cobertura en inversiones. Incluye: qué es, para qué sirve, herramientas comunes (opciones, ETFs inversos), costos y cuándo tiene sentido para un inversor individual." },

  // Psicología
  { id: "sesgo_c",   category: "psychology",  emoji: "🪞", title: "Sesgo de Confirmación", prompt: "Explícame el sesgo de confirmación en inversiones. Incluye: cómo nos afecta, ejemplos concretos, cómo lleva a pérdidas y estrategias para contrarrestarlo." },
  { id: "aversion",  category: "psychology",  emoji: "😰", title: "Aversión a la Pérdida", prompt: "Explícame la aversión a la pérdida (Kahneman & Tversky). Incluye: por qué las pérdidas duelen más que las ganancias, cómo afecta las decisiones y cómo manejarla." },
  { id: "fomo",      category: "psychology",  emoji: "😱", title: "FOMO",                   prompt: "Explícame el FOMO (Fear Of Missing Out) en inversiones. Incluye: por qué es dañino, casos históricos (cripto 2021, GME) y estrategias para no dejarse llevar." },
  { id: "herd",      category: "psychology",  emoji: "🐑", title: "Comportamiento de Manada",prompt: "Explícame el comportamiento de manada en mercados. Incluye: por qué ocurre, cómo genera burbujas y crashes, ejemplos históricos y cómo un inversor racional puede aprovecharlo." },
  { id: "ancla",     category: "psychology",  emoji: "⚓", title: "Sesgo de Anclaje",       prompt: "Explícame el sesgo de anclaje en inversiones. Incluye: qué es, cómo nos afecta al evaluar precios y valoraciones, ejemplos concretos y cómo evitarlo." },

  // Mercados
  { id: "bull_bear", category: "markets",     emoji: "🐂", title: "Bull vs Bear Market",   prompt: "Explícame la diferencia entre mercado alcista y bajista. Incluye: definiciones, duración histórica promedio, cómo comportarse en cada fase y por qué predecirlos es casi imposible." },
  { id: "tasas",     category: "markets",     emoji: "🏦", title: "Tasas de Interés",      prompt: "Explícame el impacto de las tasas de interés en los mercados. Incluye: cómo la Fed y Banxico afectan los mercados, relación con bonos, impacto en acciones growth vs value y el ciclo económico." },
  { id: "recesion",  category: "markets",     emoji: "📉", title: "Recesión",              prompt: "Explícame qué es una recesión económica y cómo afecta las inversiones. Incluye: definición técnica, indicadores que la anticipan, sectores que resisten mejor y estrategias para proteger el portafolio." },
  { id: "forex",     category: "markets",     emoji: "💱", title: "Forex",                 prompt: "Explícame el mercado Forex. Incluye: cómo funciona, pares más importantes, qué mueve los tipos de cambio, diferencias con la bolsa y por qué es tan riesgoso para principiantes." },

  // México
  { id: "cetes",     category: "mexico",      emoji: "🏛️", title: "CETES",                 prompt: "Explícame los CETES en México. Incluye: cómo funcionan, plazos, rendimientos, cómo comprarlos en cetesdirecto.com.mx, ventajas fiscales y si convienen para distintos perfiles." },
  { id: "fibras",    category: "mexico",      emoji: "🏗️", title: "FIBRAS",                prompt: "Explícame las FIBRAS mexicanas (REITs de México). Incluye: cómo funcionan, principales FIBRAS del mercado, rendimientos típicos, ventajas fiscales y cómo invertir." },
  { id: "bmv",       category: "mexico",      emoji: "📊", title: "Bolsa Mexicana (BMV)",  prompt: "Explícame cómo funciona la Bolsa Mexicana de Valores. Incluye: estructura, índices (IPC, INMEX), principales empresas, diferencias con Wall Street y cómo acceder siendo mexicano." },
  { id: "gbm",       category: "mexico",      emoji: "📱", title: "Invertir desde México", prompt: "Explícame cómo un mexicano puede invertir en mercados internacionales. Incluye: brokers disponibles (GBM+, BIVA, Interactive Brokers), requisitos, implicaciones fiscales (SAT), y recomendaciones para comenzar." },

  // Empresas
  { id: "nvidia",    category: "companies",   emoji: "💻", title: "NVIDIA",                prompt: "Explícame el modelo de negocio de NVIDIA. Incluye: cómo gana dinero, su posición en GPUs para IA, moat competitivo, métricas financieras clave y principales riesgos." },
  { id: "apple",     category: "companies",   emoji: "🍎", title: "Apple",                 prompt: "Explícame el modelo de negocio de Apple. Incluye: hardware vs servicios, el ecosistema como moat, métricas clave, programa de recompra de acciones y riesgos a largo plazo." },
  { id: "amazon",    category: "companies",   emoji: "📦", title: "Amazon",                prompt: "Explícame el modelo de negocio de Amazon. Incluye: retail vs AWS vs publicidad, cómo AWS subsidia el retail, métricas clave y principales riesgos competitivos." },
  { id: "microsoft", category: "companies",   emoji: "🪟", title: "Microsoft",             prompt: "Explícame el modelo de negocio de Microsoft. Incluye: sus segmentos (Azure, Office, gaming), su transformación cloud, moat competitivo, métricas financieras y perspectivas de IA." },
  { id: "tesla",     category: "companies",   emoji: "🚗", title: "Tesla",                 prompt: "Explícame el modelo de negocio de Tesla. Incluye: más allá del carro eléctrico (energía, software, robo-taxi), su posición competitiva, los riesgos principales y por qué es tan debatida su valuación." },
];

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

  const openTopic = async (title: string, prompt: string) => {
    setModal({ title, prompt });
    setContent("");
    setStreaming(true);
    let full = "";
    await chatApi.stream(
      prompt,
      [],
      (chunk) => {
        full += chunk;
        setContent(full);
      },
      () => setStreaming(false)
    );
  };

  const handleCustomSearch = () => {
    if (!search.trim()) return;
    openTopic(search.trim(), `Explícame de forma educativa y detallada sobre: "${search.trim()}". Estructura la respuesta con secciones claras, ejemplos concretos y analogías cuando sea útil.`);
  };

  return (
    <SafeAreaView style={s.container}>
      {/* Barra de búsqueda */}
      <View style={[s.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={s.searchIcon}>🔍</Text>
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
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat.id}
            style={[s.catChip, { backgroundColor: colors.card, borderColor: colors.border },
              selectedCat === cat.id && s.catChipActive]}
            onPress={() => setSelectedCat(cat.id)}
          >
            <Text style={s.catEmoji}>{cat.emoji}</Text>
            <Text style={[s.catText, { color: selectedCat === cat.id ? "#22c55e" : colors.textSub }]}>
              {cat.title}
            </Text>
          </TouchableOpacity>
        ))}
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
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🤔</Text>
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
          >
            <Text style={s.topicEmoji}>{item.emoji}</Text>
            <Text style={[s.topicTitle, { color: colors.text }]}>{item.title}</Text>
            <Text style={[s.topicCat, { color: colors.textDim }]}>
              {CATEGORIES.find((c) => c.id === item.category)?.title}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Modal de contenido */}
      <Modal visible={!!modal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModal(null)}>
        <SafeAreaView style={[s.modalContainer, { backgroundColor: colors.bg }]}>
          <View style={[s.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setModal(null)} style={s.closeBtn}>
              <Text style={[s.closeText, { color: colors.textMuted }]}>✕</Text>
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
                  <ActivityIndicator color="#22c55e" size="large" />
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
    searchBar: {
      flexDirection: "row", alignItems: "center",
      marginHorizontal: 16, marginTop: 12, marginBottom: 8,
      borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8,
    },
    searchIcon: { fontSize: 16, marginRight: 8 },
    searchInput: { flex: 1, fontSize: 14, paddingVertical: 2 },
    searchBtn: { backgroundColor: "#16a34a", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
    searchBtnText: { color: "white", fontSize: 12, fontWeight: "600" },
    catsScroll: { flexGrow: 0, marginBottom: 8 },
    catsContent: { paddingHorizontal: 12, gap: 8, flexDirection: "row" },
    catChip: {
      flexDirection: "row", alignItems: "center", gap: 4,
      borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6,
    },
    catChipActive: { borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,0.1)" },
    catEmoji: { fontSize: 14 },
    catText: { fontSize: 12, fontWeight: "500" },
    grid: { padding: 12, paddingBottom: 32 },
    gridRow: { gap: 10 },
    topicCard: {
      flex: 1, borderRadius: 14, borderWidth: 1,
      padding: 14, marginBottom: 10, minHeight: 100,
    },
    topicEmoji: { fontSize: 28, marginBottom: 6 },
    topicTitle: { fontSize: 13, fontWeight: "700", marginBottom: 3 },
    topicCat: { fontSize: 10 },
    emptyState: { alignItems: "center", paddingTop: 60 },
    emptyTitle: { fontSize: 16, fontWeight: "600", marginBottom: 6 },
    emptyDesc: { fontSize: 13, textAlign: "center", paddingHorizontal: 32 },
    // Modal
    modalContainer: { flex: 1 },
    modalHeader: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1,
    },
    closeBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
    closeText: { fontSize: 18 },
    modalTitle: { fontSize: 16, fontWeight: "700", flex: 1, textAlign: "center" },
    modalContent: { padding: 20, paddingBottom: 40 },
    loadingState: { alignItems: "center", paddingTop: 60, gap: 16 },
    loadingText: { fontSize: 14 },
  });
}

function makeMarkdownStyles(c: Colors) {
  return {
    body: { color: c.textSub, fontSize: 15, lineHeight: 24 },
    heading1: { color: c.text, fontSize: 20, fontWeight: "700" as const, marginTop: 16, marginBottom: 8 },
    heading2: { color: c.text, fontSize: 17, fontWeight: "700" as const, marginTop: 14, marginBottom: 6 },
    heading3: { color: c.textSub, fontSize: 15, fontWeight: "600" as const, marginTop: 10, marginBottom: 4 },
    strong: { color: c.text, fontWeight: "700" as const },
    bullet_list: { marginVertical: 6 },
    ordered_list: { marginVertical: 6 },
    list_item: { color: c.textSub, fontSize: 15, lineHeight: 24 },
    code_inline: { backgroundColor: c.card, color: "#22c55e", borderRadius: 4, fontSize: 13 },
    fence: { backgroundColor: c.card, borderRadius: 8, padding: 12, marginVertical: 8 },
    code_block: { color: "#22c55e", fontSize: 13 },
    blockquote: { borderLeftWidth: 3, borderLeftColor: "#22c55e", paddingLeft: 12, marginVertical: 6 },
    table: { borderWidth: 1, borderColor: c.border, borderRadius: 6, marginVertical: 8 },
    thead: { backgroundColor: "#16a34a" },
    th: { color: "white", fontWeight: "700" as const, padding: 8, fontSize: 13 },
    td: { color: c.textSub, padding: 8, fontSize: 13, borderTopWidth: 1, borderTopColor: c.border },
    hr: { borderColor: c.border, marginVertical: 12 },
    link: { color: "#22c55e" },
  };
}
