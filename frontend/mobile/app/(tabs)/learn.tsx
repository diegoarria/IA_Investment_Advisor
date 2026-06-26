import React, { useState, useMemo, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, FlatList,
  Modal, StyleSheet, SafeAreaView, ActivityIndicator,
  Image, Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Markdown from "react-native-markdown-display";
import { router, useLocalSearchParams } from "expo-router";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { chatApi, learnApi } from "../../src/lib/api";
import { useLearnStore, getNextMilestone, getUnclaimedMilestones } from "../../src/lib/learnStore";
import StreakMilestoneModal from "../../src/components/StreakMilestoneModal";

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
  { id: "all",         icon: "grid-outline",         title: "Todo" },
  { id: "basics",      icon: "library-outline",      title: "Básicos" },
  { id: "instruments", icon: "business-outline",     title: "Instrumentos" },
  { id: "ratios",      icon: "calculator-outline",   title: "Ratios" },
  { id: "analysis",    icon: "analytics-outline",    title: "Análisis" },
  { id: "strategies",  icon: "flag-outline",         title: "Estrategias" },
  { id: "trading",     icon: "flash-outline",        title: "Trading" },
  { id: "psychology",  icon: "bulb-outline",         title: "Psicología" },
  { id: "macro",       icon: "earth-outline",        title: "Macro" },
  { id: "markets",     icon: "globe-outline",        title: "Mercados" },
  { id: "mexico",      icon: "location-outline",     title: "México" },
  { id: "companies",   icon: "briefcase-outline",    title: "Empresas" },
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
  { id: "alphabet",  category: "companies",   icon: "search-outline",           title: "Alphabet / Google",     prompt: "Eres una enciclopedia financiera. Explica el modelo de negocio de Alphabet (Google). Incluye: segmentos de ingresos (Search, YouTube, Cloud, Other Bets), su moat publicitario, métricas clave y riesgos regulatorios." },
  { id: "meta_co",   category: "companies",   icon: "people-outline",           title: "Meta",                  prompt: "Eres una enciclopedia financiera. Explica el modelo de negocio de Meta. Incluye: ingresos por publicidad, metaverso y Reality Labs, dominio en redes sociales, métricas de usuarios y sus principales riesgos." },
  { id: "berkshire", category: "companies",   icon: "school-outline",           title: "Berkshire Hathaway",    prompt: "Eres una enciclopedia financiera. Explica Berkshire Hathaway: el modelo de holding de Buffett, principales subsidiarias, cómo evaluar su valor intrínseco y sus diferencias con un ETF." },
  { id: "jpmorgan",  category: "companies",   icon: "card-outline",             title: "JPMorgan Chase",        prompt: "Eres una enciclopedia financiera. Explica JPMorgan Chase como inversión: líneas de negocio, cómo se valúan los bancos y métricas clave como ROE y P/B." },
  { id: "femsa",     category: "companies",   icon: "beer-outline",             title: "FEMSA",                 prompt: "Eres una enciclopedia financiera. Explica FEMSA: sus divisiones (Coca-Cola FEMSA, OXXO, salud), cotización en BMV y NYSE, y por qué es relevante para el inversionista mexicano." },

  // ── BÁSICOS NUEVOS ───────────────────────────────────────────────────────
  { id: "ticker",     category: "basics",      icon: "text-outline",             title: "Ticker",                prompt: "Eres una enciclopedia financiera. Explica qué es un ticker bursátil: definición, cómo se asigna, diferencia entre NYSE/NASDAQ/BMV, ejemplos y por qué importa al operar." },
  { id: "spread",     category: "basics",      icon: "resize-outline",           title: "Spread Bid-Ask",        prompt: "Eres una enciclopedia financiera. Explica el spread bid-ask: qué es, cómo afecta al inversor, diferencia en activos líquidos vs ilíquidos y cómo minimizarlo." },
  { id: "market_cap", category: "basics",      icon: "podium-outline",           title: "Capitalización de Mercado", prompt: "Eres una enciclopedia financiera. Explica la capitalización de mercado: cómo se calcula, diferencia entre large/mid/small cap, por qué no es lo mismo que el valor de la empresa." },
  { id: "broker",     category: "basics",      icon: "business-outline",         title: "Broker / Casa de Bolsa", prompt: "Eres una enciclopedia financiera. Explica qué es un broker: tipos, cómo funcionan, cómo elegir uno, comisiones, regulación y diferencia entre broker de descuento y full-service." },
  { id: "beta_b",     category: "basics",      icon: "cellular-outline",         title: "Beta",                  prompt: "Eres una enciclopedia financiera. Explica el Beta: cómo se calcula, beta > 1 vs < 1, beta negativa, relación con el mercado y sus limitaciones." },
  { id: "alpha_b",    category: "basics",      icon: "trophy-outline",           title: "Alpha",                 prompt: "Eres una enciclopedia financiera. Explica el Alpha: qué significa generarlo, cómo se calcula, por qué es difícil de obtener consistentemente y su relación con el beta." },
  { id: "benchmark",  category: "basics",      icon: "checkmark-circle-outline", title: "Benchmark",             prompt: "Eres una enciclopedia financiera. Explica el benchmark: cómo se usa para evaluar fondos, los más comunes (S&P 500, MSCI World) y por qué casi nadie supera al benchmark consistentemente." },
  { id: "ipo",        category: "basics",      icon: "rocket-outline",           title: "IPO (Salida a Bolsa)",  prompt: "Eres una enciclopedia financiera. Explica el proceso de IPO: cómo funciona, rol de los bancos de inversión, lock-up period, cómo participar, riesgos y ejemplos históricos notables." },
  { id: "split",      category: "basics",      icon: "cut-outline",              title: "Stock Split",           prompt: "Eres una enciclopedia financiera. Explica el stock split: qué es, por qué lo hacen las empresas, efecto real en el valor, reverse split y ejemplos (Apple, Tesla, Nvidia)." },
  { id: "buyback",    category: "basics",      icon: "repeat-outline",           title: "Buyback (Recompra)",    prompt: "Eres una enciclopedia financiera. Explica la recompra de acciones: por qué las empresas lo hacen, impacto en el EPS y precio, cuándo es bueno vs señal negativa." },
  { id: "short_sell", category: "basics",      icon: "trending-down-outline",    title: "Venta en Corto (Short)", prompt: "Eres una enciclopedia financiera. Explica la venta en corto: cómo funciona, el riesgo de pérdida ilimitada, el short squeeze, por qué los reguladores la limitan y ejemplos famosos." },
  { id: "apalanc",    category: "basics",      icon: "bar-chart-outline",        title: "Apalancamiento",        prompt: "Eres una enciclopedia financiera. Explica el apalancamiento: cómo amplifica ganancias Y pérdidas, margin trading, el riesgo de ruina y cuándo tiene sentido usarlo." },
  { id: "blue_chips", category: "basics",      icon: "diamond-outline",          title: "Blue Chips",            prompt: "Eres una enciclopedia financiera. Explica las empresas blue chip: criterios, ventajas como inversión, diferencia con growth stocks y por qué son la columna vertebral de portafolios conservadores." },
  { id: "earnings_n", category: "basics",      icon: "calendar-outline",         title: "Earnings / Resultados", prompt: "Eres una enciclopedia financiera. Explica el earnings season: qué informan las empresas, EPS vs consenso, guidance, reacción del mercado y cómo prepararse para los reportes trimestrales." },
  { id: "volatil",    category: "basics",      icon: "pulse-outline",            title: "Volatilidad",           prompt: "Eres una enciclopedia financiera. Explica la volatilidad: definición estadística, volatilidad histórica vs implícita, VIX, por qué puede ser oportunidad y cómo afecta a distintos inversores." },
  { id: "portafolio", category: "basics",      icon: "briefcase-outline",        title: "Portafolio de Inversión", prompt: "Eres una enciclopedia financiera. Explica cómo construir un portafolio: tipos de activos, teoría de Markowitz, frontera eficiente y asignación por perfil de riesgo." },
  { id: "rendimiento",category: "basics",      icon: "stats-chart-outline",      title: "Rendimiento / Retorno", prompt: "Eres una enciclopedia financiera. Explica los tipos de rendimiento: retorno total, anualizado, CAGR, retorno ajustado por riesgo y diferencia entre nominal y real." },

  // ── INSTRUMENTOS NUEVOS ──────────────────────────────────────────────────
  { id: "opciones",   category: "instruments", icon: "ticket-outline",           title: "Opciones Financieras",  prompt: "Eres una enciclopedia financiera. Explica las opciones: calls y puts, los 4 roles básicos, prima, strike price, fecha de expiración y usos para cobertura y especulación." },
  { id: "calls_puts", category: "instruments", icon: "call-outline",             title: "Calls y Puts",          prompt: "Eres una enciclopedia financiera. Explica calls y puts en detalle: definición, cuándo se usan, el profit/loss con ejemplos numéricos, valor intrínseco vs temporal y las gregas básicas." },
  { id: "futuros_i",  category: "instruments", icon: "time-outline",             title: "Contratos de Futuros",  prompt: "Eres una enciclopedia financiera. Explica los contratos de futuros: cómo funcionan, quiénes los usan, contango vs backwardation, el rol del margen y ejemplos en commodities." },
  { id: "fondos_m",   category: "instruments", icon: "folder-outline",           title: "Fondos Mutuos",         prompt: "Eres una enciclopedia financiera. Explica los fondos mutuos: cómo funcionan, diferencia con ETFs, tipos, comisiones y por qué el expense ratio es crítico a largo plazo." },
  { id: "bonos_c",    category: "instruments", icon: "newspaper-outline",        title: "Bonos Corporativos",    prompt: "Eres una enciclopedia financiera. Explica los bonos corporativos: diferencia con bonos gubernamentales, calificaciones crediticias, spread sobre tesoros y riesgo de incumplimiento." },
  { id: "hy_bonds",   category: "instruments", icon: "warning-outline",          title: "Bonos High Yield (Junk)", prompt: "Eres una enciclopedia financiera. Explica los bonos de alto rendimiento: por qué pagan más, calificación crediticia, comportamiento durante recesiones y el riesgo de default." },
  { id: "stablecoin", category: "instruments", icon: "logo-usd",                 title: "Stablecoins",           prompt: "Eres una enciclopedia financiera. Explica las stablecoins: tipos, riesgos principales (colapso de UST/LUNA), su uso en DeFi y si son alternativa válida de ahorro." },
  { id: "defi",       category: "instruments", icon: "link-outline",             title: "DeFi",                  prompt: "Eres una enciclopedia financiera. Explica DeFi: qué es, protocolos principales, yield farming, los riesgos reales (bugs, rug pulls) y por qué es disruptivo pero peligroso." },
  { id: "priv_eq",    category: "instruments", icon: "lock-closed-outline",      title: "Private Equity",        prompt: "Eres una enciclopedia financiera. Explica el private equity: cómo funciona, LBOs, venture capital vs buyout, cómo acceder y rendimientos históricos vs mercado público." },
  { id: "vc",         category: "instruments", icon: "leaf-outline",             title: "Venture Capital",       prompt: "Eres una enciclopedia financiera. Explica el venture capital: etapas (seed, Series A/B/C), cómo piensan los VCs (power law), diferencia con angel investing y por qué el 90% de startups fracasa." },
  { id: "tips_b",     category: "instruments", icon: "shield-outline",           title: "TIPS / Bonos Indexados", prompt: "Eres una enciclopedia financiera. Explica los TIPS: cómo protegen contra la inflación, cómo funciona el ajuste del principal, cuándo convienen y su equivalente en México (Udibonos)." },

  // ── RATIOS Y MÉTRICAS (nueva categoría) ─────────────────────────────────
  { id: "eps",        category: "ratios",      icon: "cash-outline",             title: "EPS (Ganancia por Acción)", prompt: "Eres una enciclopedia financiera. Explica el EPS: cómo se calcula, básico vs diluido, cómo las recompras lo inflan artificialmente y cómo usarlo con el P/E." },
  { id: "revenue",    category: "ratios",      icon: "trending-up-outline",      title: "Revenue / Ingresos",    prompt: "Eres una enciclopedia financiera. Explica el revenue: top line vs bottom line, cómo analizar la calidad y por qué empresas con pérdidas se valúan altísimo." },
  { id: "gross_mg",   category: "ratios",      icon: "git-merge-outline",        title: "Margen Bruto",          prompt: "Eres una enciclopedia financiera. Explica el margen bruto: cómo se calcula, qué dice del modelo de negocio y comparación por sector (software >70% vs retail <30%)." },
  { id: "net_mg",     category: "ratios",      icon: "checkmark-done-outline",   title: "Margen Neto",           prompt: "Eres una enciclopedia financiera. Explica el margen neto: cómo se calcula, diferencia con margen operativo y bruto y las trampas contables que lo distorsionan." },
  { id: "fcf",        category: "ratios",      icon: "wallet-outline",           title: "Free Cash Flow (FCF)",  prompt: "Eres una enciclopedia financiera. Explica el FCF: por qué es más importante que las ganancias contables, cómo se calcula, FCF yield y la trampa del FCF negativo en empresas en crecimiento." },
  { id: "de_ratio",   category: "ratios",      icon: "scale-outline",            title: "Deuda/Capital (D/E)",   prompt: "Eres una enciclopedia financiera. Explica el ratio D/E: niveles saludables por sector, diferencia entre deuda buena y mala, Net Debt vs Gross Debt." },
  { id: "ps_ratio",   category: "ratios",      icon: "pricetag-outline",         title: "P/S Ratio",             prompt: "Eres una enciclopedia financiera. Explica el P/S ratio: cuándo usarlo, niveles por sector, sus limitaciones vs P/E y cómo interpretar múltiplos altos." },
  { id: "pb_ratio",   category: "ratios",      icon: "book-outline",             title: "P/B Ratio",             prompt: "Eres una enciclopedia financiera. Explica el P/B ratio: qué es el valor en libros, cuándo P/B < 1 es señal de valor y por qué es más útil en bancos que en tech." },
  { id: "ev_ebitda",  category: "ratios",      icon: "business-outline",         title: "EV/EBITDA",             prompt: "Eres una enciclopedia financiera. Explica el EV/EBITDA: qué es el enterprise value, por qué es mejor que P/E para comparar empresas y múltiplos razonables por sector." },
  { id: "peg_r",      category: "ratios",      icon: "speedometer-outline",      title: "PEG Ratio",             prompt: "Eres una enciclopedia financiera. Explica el PEG ratio: cómo combina P/E con crecimiento, qué significa PEG < 1 y por qué Peter Lynch lo popularizó." },
  { id: "div_yield",  category: "ratios",      icon: "cash-outline",             title: "Dividend Yield",        prompt: "Eres una enciclopedia financiera. Explica el dividend yield: cómo se calcula, la trampa del yield alto, yield sostenible vs insostenible y dividend growth investing." },
  { id: "payout_r",   category: "ratios",      icon: "send-outline",             title: "Payout Ratio",          prompt: "Eres una enciclopedia financiera. Explica el payout ratio: qué es, payout > 100% como alarma y cómo las mejores empresas balancean dividendos con recompras." },
  { id: "sharpe_r",   category: "ratios",      icon: "bar-chart-outline",        title: "Sharpe Ratio",          prompt: "Eres una enciclopedia financiera. Explica el Sharpe Ratio: retorno ajustado por riesgo, cómo se calcula, qué significa > 1 y la diferencia con el Sortino Ratio." },
  { id: "drawdown_r", category: "ratios",      icon: "arrow-down-outline",       title: "Drawdown",              prompt: "Eres una enciclopedia financiera. Explica el drawdown: maximum drawdown, recuperación, por qué una caída del 50% requiere 100% para recuperarse y cómo comparar estrategias." },
  { id: "cagr_r",     category: "ratios",      icon: "trending-up-outline",      title: "CAGR",                  prompt: "Eres una enciclopedia financiera. Explica el CAGR: cómo se calcula, diferencia con promedio simple y por qué es la métrica correcta para comparar inversiones a largo plazo." },
  { id: "roic_r",     category: "ratios",      icon: "refresh-circle-outline",   title: "ROIC",                  prompt: "Eres una enciclopedia financiera. Explica el ROIC: por qué Buffett y Munger lo consideran la métrica más importante, cómo se calcula y qué ROIC indica un moat verdadero." },
  { id: "wacc_r",     category: "ratios",      icon: "funnel-outline",           title: "WACC",                  prompt: "Eres una enciclopedia financiera. Explica el WACC: para qué sirve en valuación DCF, sus componentes y por qué pequeños cambios tienen gran impacto en la valuación." },
  { id: "ev_r",       category: "ratios",      icon: "business-outline",         title: "Enterprise Value (EV)", prompt: "Eres una enciclopedia financiera. Explica el Enterprise Value: qué incluye, por qué es mejor que el market cap para adquisiciones y cómo se usa en múltiplos." },

  // ── ANÁLISIS NUEVOS ──────────────────────────────────────────────────────
  { id: "vix_a",      category: "analysis",    icon: "warning-outline",          title: "VIX (Índice del Miedo)", prompt: "Eres una enciclopedia financiera. Explica el VIX: qué mide, cómo interpretarlo (>30 = pánico), por qué sube cuando el mercado cae y cómo usarlo como señal contraria." },
  { id: "rsi_a",      category: "analysis",    icon: "fitness-outline",          title: "RSI",                   prompt: "Eres una enciclopedia financiera. Explica el RSI: cómo se calcula, sobrecompra (>70) y sobreventa (<30), divergencias como señal poderosa y sus limitaciones." },
  { id: "macd_a",     category: "analysis",    icon: "git-branch-outline",       title: "MACD",                  prompt: "Eres una enciclopedia financiera. Explica el MACD: sus tres componentes, cómo generar señales de compra/venta y por qué es uno de los indicadores más usados." },
  { id: "bollinger",  category: "analysis",    icon: "ellipse-outline",          title: "Bandas de Bollinger",   prompt: "Eres una enciclopedia financiera. Explica las Bandas de Bollinger: cómo se construyen, la contracción, el squeeze y sus limitaciones en tendencias fuertes." },
  { id: "fibonacci",  category: "analysis",    icon: "infinite-outline",         title: "Fibonacci",             prompt: "Eres una enciclopedia financiera. Explica los niveles de Fibonacci: los retrocesos clásicos (23.6%, 38.2%, 61.8%), por qué el mercado los respeta y el debate sobre profecía autocumplida." },
  { id: "soporte_r",  category: "analysis",    icon: "layers-outline",           title: "Soporte y Resistencia", prompt: "Eres una enciclopedia financiera. Explica soporte y resistencia: cómo identificarlos, cambio de polaridad, niveles psicológicos y cómo el volumen confirma una ruptura." },
  { id: "prom_mov",   category: "analysis",    icon: "remove-outline",           title: "Medias Móviles",        prompt: "Eres una enciclopedia financiera. Explica las medias móviles: SMA vs EMA, golden cross y death cross, la MA de 200 días como soporte histórico y sus limitaciones." },
  { id: "candlestick",category: "analysis",    icon: "podium-outline",           title: "Velas Japonesas",       prompt: "Eres una enciclopedia financiera. Explica las velas japonesas: anatomía de una vela, los patrones más fiables (doji, hammer, engulfing) y cómo combinarlos con volumen." },

  // ── TRADING ACTIVO (nueva categoría) ────────────────────────────────────
  { id: "buy_hold",   category: "trading",     icon: "time-outline",             title: "Buy and Hold",          prompt: "Eres una enciclopedia financiera. Explica el Buy and Hold: la evidencia académica, por qué bate a la mayoría de estrategias activas y el papel de los impuestos y comisiones." },
  { id: "swing_t",    category: "trading",     icon: "trending-up-outline",      title: "Swing Trading",         prompt: "Eres una enciclopedia financiera. Explica el swing trading: holding de días a semanas, cómo identificar swings, herramientas usadas y por qué muy pocos son rentables consistentemente." },
  { id: "day_t",      category: "trading",     icon: "flash-outline",            title: "Day Trading",           prompt: "Eres una enciclopedia financiera. Explica el day trading: estadísticas de rentabilidad (>80% pierde), costos reales, requisitos de capital y por qué es más difícil que parece." },
  { id: "scalping",   category: "trading",     icon: "scan-outline",             title: "Scalping",              prompt: "Eres una enciclopedia financiera. Explica el scalping: operaciones de segundos, importancia del spread, necesidad de plataformas ultra-rápidas y por qué el retail no puede competir con HFT." },
  { id: "momentum_t", category: "trading",     icon: "rocket-outline",           title: "Momentum",              prompt: "Eres una enciclopedia financiera. Explica el momentum: la evidencia académica, cómo medirlo, momentum crash y diferencia entre momentum de precio y momentum de earnings." },
  { id: "trend_f",    category: "trading",     icon: "arrow-up-outline",         title: "Trend Following",       prompt: "Eres una enciclopedia financiera. Explica el trend following: la filosofía, los Turtle Traders, características (malo en mercados laterales) y los sistemas de cruce de medias." },
  { id: "mean_rev",   category: "trading",     icon: "return-down-back-outline", title: "Reversión a la Media",  prompt: "Eres una enciclopedia financiera. Explica la reversión a la media: la evidencia, pairs trading, problemas de implementación y cómo distinguirla de una trampa de valor." },
  { id: "position_s", category: "trading",     icon: "resize-outline",           title: "Position Sizing",       prompt: "Eres una enciclopedia financiera. Explica el position sizing: el criterio de Kelly, el modelo de 1-2% de riesgo por operación y por qué es la diferencia entre sobrevivir y quebrar." },
  { id: "stop_loss",  category: "trading",     icon: "stop-circle-outline",      title: "Stop Loss",             prompt: "Eres una enciclopedia financiera. Explica el stop loss: tipos (fijo, trailing, mental), cómo establecer niveles, el gap risk y el debate sobre stops mentales vs automáticos." },
  { id: "rr_ratio",   category: "trading",     icon: "swap-horizontal-outline",  title: "Ratio Riesgo/Recompensa", prompt: "Eres una enciclopedia financiera. Explica el ratio R/R: cómo calcularlo, por qué 1:2 o 1:3 es preferible y la relación entre R/R y win rate para ser rentable." },

  // ── ESTRATEGIAS NUEVAS ───────────────────────────────────────────────────
  { id: "income_i",   category: "strategies",  icon: "cash-outline",             title: "Income Investing",      prompt: "Eres una enciclopedia financiera. Explica el income investing: generación de flujo regular, instrumentos usados (dividendos, bonos, REITs, covered calls) y cómo construir un portafolio de ingresos." },
  { id: "garp",       category: "strategies",  icon: "leaf-outline",             title: "GARP",                  prompt: "Eres una enciclopedia financiera. Explica el GARP (Growth at Reasonable Price): la filosofía de Peter Lynch, el PEG Ratio como herramienta clave y cómo equilibra value y growth." },
  { id: "allweather", category: "strategies",  icon: "cloud-outline",            title: "All Weather Portfolio", prompt: "Eres una enciclopedia financiera. Explica el All Weather Portfolio de Ray Dalio: la filosofía de paridad de riesgo, la asignación (30% acciones, 40% bonos largo, etc.) y rendimiento histórico." },
  { id: "barbell",    category: "strategies",  icon: "barbell-outline",          title: "Estrategia Barbell",    prompt: "Eres una enciclopedia financiera. Explica la estrategia Barbell de Nassim Taleb: combinar activos muy seguros con apuestas de alto potencial, eliminar el riesgo medio y su aplicación." },
  { id: "rotacion",   category: "strategies",  icon: "sync-outline",             title: "Rotación Sectorial",    prompt: "Eres una enciclopedia financiera. Explica la rotación sectorial: cómo los sectores se comportan en distintas fases del ciclo económico y cómo implementarla con ETFs sectoriales." },
  { id: "canslim",    category: "strategies",  icon: "list-outline",             title: "CAN SLIM",              prompt: "Eres una enciclopedia financiera. Explica el método CAN SLIM de William O'Neil: cada letra del acrónimo, resultados históricos y cómo aplicarlo." },
  { id: "arbitrage",  category: "strategies",  icon: "git-compare-outline",      title: "Arbitraje",             prompt: "Eres una enciclopedia financiera. Explica el arbitraje: definición pura, tipos (merger, statistical, convertible), por qué es casi imposible para retail y su papel en la eficiencia del mercado." },

  // ── PSICOLOGÍA NUEVOS ────────────────────────────────────────────────────
  { id: "overconf",   category: "psychology",  icon: "happy-outline",            title: "Exceso de Confianza",   prompt: "Eres una enciclopedia financiera. Explica el exceso de confianza: la evidencia (los hombres operan más y ganan menos), el efecto Dunning-Kruger en finanzas y cómo contrarrestarlo." },
  { id: "disposition",category: "psychology",  icon: "cut-outline",              title: "Efecto de Disposición", prompt: "Eres una enciclopedia financiera. Explica el efecto de disposición: por qué vendemos ganadores pronto y aguantamos perdedores, su base en Kahneman y cómo las reglas mecánicas ayudan." },
  { id: "recency_b",  category: "psychology",  icon: "time-outline",             title: "Sesgo de Recency",      prompt: "Eres una enciclopedia financiera. Explica el sesgo de recency: por qué sobrestimamos lo reciente, cómo lleva a perseguir rendimientos pasados y cómo combatirlo." },
  { id: "mental_a",   category: "psychology",  icon: "albums-outline",           title: "Contabilidad Mental",   prompt: "Eres una enciclopedia financiera. Explica la contabilidad mental de Richard Thaler: por qué tratamos el dinero distinto según su origen y cómo afecta la gestión del portafolio." },
  { id: "paralysis",  category: "psychology",  icon: "pause-circle-outline",     title: "Parálisis por Análisis", prompt: "Eres una enciclopedia financiera. Explica la parálisis por análisis: por qué más información no lleva a mejores decisiones, la paradoja de la elección y reglas para superarla." },
  { id: "gamblers_f", category: "psychology",  icon: "dice-outline",             title: "Falacia del Jugador",   prompt: "Eres una enciclopedia financiera. Explica la falacia del jugador: por qué creer que 'toca' tras 10 días de caída es erróneo, independencia de eventos y el hot hand fallacy." },
  { id: "hindsight",  category: "psychology",  icon: "eye-outline",              title: "Sesgo de Retrospectiva", prompt: "Eres una enciclopedia financiera. Explica el hindsight bias: por qué después de cada crash creemos que era predecible y cómo el diario de inversión lo combate." },

  // ── MACROECONOMÍA (nueva categoría) ─────────────────────────────────────
  { id: "fed",        category: "macro",       icon: "business-outline",         title: "Reserva Federal (Fed)", prompt: "Eres una enciclopedia financiera. Explica la Fed: su mandato dual, el FOMC, cómo las decisiones de tasas afectan mercados, el 'Fed put' y quantitative easing/tightening." },
  { id: "monetary_p", category: "macro",       icon: "cash-outline",             title: "Política Monetaria",    prompt: "Eres una enciclopedia financiera. Explica la política monetaria: herramientas, política expansiva vs contractiva, canales de transmisión y sus rezagos de 12-18 meses." },
  { id: "fiscal_p",   category: "macro",       icon: "construct-outline",        title: "Política Fiscal",       prompt: "Eres una enciclopedia financiera. Explica la política fiscal: gasto público e impuestos, el multiplicador fiscal, déficit y la interacción con la política monetaria." },
  { id: "yield_c",    category: "macro",       icon: "git-branch-outline",       title: "Curva de Rendimientos", prompt: "Eres una enciclopedia financiera. Explica la yield curve: curva normal vs invertida (predice recesión), el spread 10y-2y y cómo posicionarse cuando se invierte." },
  { id: "qe",         category: "macro",       icon: "print-outline",            title: "Quantitative Easing (QE)", prompt: "Eres una enciclopedia financiera. Explica el QE y QT: cómo la Fed expande/contrae su balance, el efecto en activos de riesgo y las consecuencias inflacionarias." },
  { id: "cape_sh",    category: "macro",       icon: "telescope-outline",        title: "CAPE / Shiller P/E",    prompt: "Eres una enciclopedia financiera. Explica el CAPE de Shiller: por qué usar 10 años de ganancias, su historial como predictor a largo plazo y por qué no sirve para market timing." },
  { id: "pib",        category: "macro",       icon: "globe-outline",            title: "PIB / GDP",             prompt: "Eres una enciclopedia financiera. Explica el PIB: cómo se mide, nominal vs real, sus componentes y por qué el crecimiento del PIB no equivale a retornos bursátiles." },
  { id: "stagflation",category: "macro",       icon: "alert-circle-outline",     title: "Stagflación",           prompt: "Eres una enciclopedia financiera. Explica la stagflación: inflación alta + recesión, el episodio de los 70s, por qué es el peor escenario para bancos centrales y activos ganadores." },
  { id: "eco_cycle",  category: "macro",       icon: "sync-circle-outline",      title: "Ciclo Económico",       prompt: "Eres una enciclopedia financiera. Explica el ciclo económico: las 4 fases, indicadores líderes vs rezagados, duración histórica y sectores que outperforman en cada fase." },
  { id: "inflacion_m",category: "macro",       icon: "arrow-up-circle-outline",  title: "Inflación vs Deflación", prompt: "Eres una enciclopedia financiera. Explica inflación y deflación: tipos, la trampa deflacionaria japonesa, hiperinflación histórica y activos ganadores en cada escenario." },

  // ── MERCADOS NUEVOS ──────────────────────────────────────────────────────
  { id: "emergentes", category: "markets",     icon: "globe-outline",            title: "Mercados Emergentes",   prompt: "Eres una enciclopedia financiera. Explica los mercados emergentes: países incluidos, por qué han underperformado al S&P, riesgos específicos (política, divisa) y cómo acceder vía ETFs." },
  { id: "margin_c",   category: "markets",     icon: "call-outline",             title: "Margin Call",           prompt: "Eres una enciclopedia financiera. Explica el margin call: cómo ocurre, el efecto cascada, el caso Archegos en 2021 y cómo evitar estar expuesto a ellos." },
  { id: "short_sq",   category: "markets",     icon: "game-controller-outline",  title: "Short Squeeze",         prompt: "Eres una enciclopedia financiera. Explica el short squeeze: cómo ocurre mecánicamente, el caso de GameStop/AMC en 2021 y las condiciones que lo hacen posible." },
  { id: "black_sw",   category: "markets",     icon: "help-circle-outline",      title: "Cisne Negro",           prompt: "Eres una enciclopedia financiera. Explica el Cisne Negro de Taleb: eventos de baja probabilidad y alto impacto, por qué los modelos no los capturan y cómo construir un portafolio antifrágil." },
  { id: "timing_m",   category: "markets",     icon: "alarm-outline",            title: "Market Timing",         prompt: "Eres una enciclopedia financiera. Explica el market timing: la evidencia de que no funciona, estudios sobre los mejores días perdidos, la alternativa del DCA y el costo de 'esperar el crash'." },

  // ── MÉXICO NUEVOS ────────────────────────────────────────────────────────
  { id: "afore",      category: "mexico",      icon: "card-outline",             title: "AFORE",                 prompt: "Eres una enciclopedia financiera. Explica las AFOREs: cómo funcionan, las SIEFORES por generación, cómo revisar el saldo, el impacto de las comisiones y por qué las aportaciones voluntarias son clave." },
  { id: "cnbv",       category: "mexico",      icon: "shield-checkmark-outline", title: "CNBV",                  prompt: "Eres una enciclopedia financiera. Explica la CNBV: qué regula, cómo protege al inversionista, diferencia con CONDUSEF y cómo verificar que tu institución esté regulada." },
  { id: "sic_mx",     category: "mexico",      icon: "link-outline",             title: "Mercado SIC",           prompt: "Eres una enciclopedia financiera. Explica el SIC de la BMV: qué son los ETFs del SIC, cómo comprar acciones extranjeras desde México sin cuenta extranjera y sus limitaciones." },
  { id: "biva",       category: "mexico",      icon: "stats-chart-outline",      title: "BIVA",                  prompt: "Eres una enciclopedia financiera. Explica la BIVA: diferencia con la BMV, qué instrumentos lista y su impacto en la liquidez del mercado mexicano." },
  { id: "tiie",       category: "mexico",      icon: "swap-vertical-outline",    title: "TIIE",                  prompt: "Eres una enciclopedia financiera. Explica la TIIE: cómo la determina el Banxico, por qué es la referencia para créditos en México y su relación con la tasa de la Fed." },
  { id: "udibonos",   category: "mexico",      icon: "shield-outline",           title: "Udibonos",              prompt: "Eres una enciclopedia financiera. Explica los Udibonos: bonos indexados a la inflación vía UDIs, cómo protegen el poder adquisitivo y cuándo convienen vs CETES." },
  { id: "sat_inv",    category: "mexico",      icon: "document-text-outline",    title: "SAT e Inversiones",     prompt: "Eres una enciclopedia financiera. Explica las obligaciones fiscales ante el SAT para inversionistas: qué se declara, tasas aplicables, retención de brokers mexicanos vs extranjeros y el FATCA." },
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

  const { streak, completedToday, markTopicCompleted, initStreak, claimedMilestones, markMilestoneClaimed } = useLearnStore();
  useEffect(() => { initStreak(); }, []);

  const [pendingMilestone, setPendingMilestone] = useState<ReturnType<typeof getNextMilestone>>(null);
  const [claiming, setClaiming] = useState(false);

  // Check for newly reached milestones every time streak changes
  useEffect(() => {
    const unclaimed = getUnclaimedMilestones(streak, claimedMilestones);
    if (unclaimed.length > 0 && !pendingMilestone) {
      setPendingMilestone(unclaimed[0]);
    }
  }, [streak, claimedMilestones]);

  const handleClaimMilestone = async () => {
    if (!pendingMilestone) return;
    setClaiming(true);
    try {
      await learnApi.claimMilestone(pendingMilestone.days);
      markMilestoneClaimed(pendingMilestone.days);
    } catch {}
    setClaiming(false);
    setPendingMilestone(null);
    // Show next unclaimed if any
    const remaining = getUnclaimedMilestones(streak, [...claimedMilestones, pendingMilestone.days]);
    if (remaining.length > 0) setTimeout(() => setPendingMilestone(remaining[0]), 400);
  };

  const nextMilestone = getNextMilestone(streak);

const { topicId } = useLocalSearchParams<{ topicId?: string }>();

  const [search, setSearch] = useState("");
  const [selectedCat, setSelectedCat] = useState("all");
  const [modal, setModal] = useState<{ title: string; icon: IoniconName } | null>(null);
  const [content, setContent] = useState("");
  const [streaming, setStreaming] = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return TOPICS.filter((t) => {
      const matchCat = selectedCat === "all" || t.category === selectedCat;
      const matchQ = !q || t.title.toLowerCase().includes(q) || t.category.includes(q);
      return matchCat && matchQ;
    });
  }, [search, selectedCat]);

  const openTopic = async (title: string, _topicContext: string, icon: IoniconName = "book-outline") => {
    setModal({ title, icon });
    setContent("");
    setStreaming(true);
    markTopicCompleted();
    // Prompt flashcard: máximo 70 palabras → respuesta en <3 segundos
    const flashcard = `Eres un mentor de finanzas. Explica "${title}" en formato FLASHCARD — exactamente esta estructura, máximo 70 palabras en total, en español:

**${title}**
[Definición en 1 oración directa]

• [Clave 1]
• [Clave 2]
• [Clave 3]

💡 *Ejemplo:* [1 oración concreta con dato real]`;
    let full = "";
    await chatApi.stream(
      flashcard,
      [],
      (chunk) => { full += chunk; setContent(full); },
      () => setStreaming(false)
    );
  };

  const handleCustomSearch = (term?: string) => {
    const q = (term || search).trim();
    if (!q) return;
    openTopic(q, "", "search-outline");
  };

  useEffect(() => {
    if (!topicId) return;
    const topic = TOPICS.find(t => t.id === topicId);
    if (topic) openTopic(topic.title, topic.prompt, topic.icon as IoniconName);
  }, [topicId]);

  return (
    <SafeAreaView style={s.container}>

      {/* ── Aprender content ── */}
      <View style={{ flex: 1 }}>

      {/* Streak banner + milestone progress */}
      <View style={[s.streakBanner, { backgroundColor: colors.card, borderColor: completedToday ? "#f59e0b44" : colors.border }]}>
        <View style={s.streakLeft}>
          <Text style={s.streakFire}>{completedToday ? "🔥" : "🌑"}</Text>
          <View>
            <Text style={[s.streakNum, { color: completedToday ? "#f59e0b" : colors.textMuted }]}>
              {streak} {streak === 1 ? "día" : "días"} de racha
            </Text>
            <Text style={[s.streakSub, { color: colors.textDim }]}>
              {completedToday ? "¡Racha activa hoy!" : "Lee un tema para mantener tu racha"}
            </Text>
          </View>
        </View>
        {nextMilestone && (
          <View style={{ alignItems: "flex-end", gap: 3 }}>
            <Text style={{ fontSize: 11, color: colors.textMuted }}>
              {streak}/{nextMilestone.days}d → {nextMilestone.emoji}
            </Text>
            <View style={{ width: 80, height: 5, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" }}>
              <View style={{
                height: "100%",
                borderRadius: 3,
                backgroundColor: "#f59e0b",
                width: `${Math.min(100, (streak / nextMilestone.days) * 100)}%`,
              }} />
            </View>
            <Text style={{ fontSize: 10, color: colors.textDim }}>{nextMilestone.title}</Text>
          </View>
        )}
        {!nextMilestone && streak > 0 && (
          <Text style={{ fontSize: 20 }}>👑</Text>
        )}
      </View>

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
          onSubmitEditing={() => handleCustomSearch()}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => handleCustomSearch()} style={s.searchBtn}>
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
          search.trim().length === 0 ? (
            <View style={s.emptyState}>
              <Ionicons name="help-circle-outline" size={40} color={colors.textMuted} style={{ marginBottom: 12 }} />
              <Text style={[s.emptyTitle, { color: colors.text }]}>No encontré ese tema</Text>
              <Text style={[s.emptyDesc, { color: colors.textMuted }]}>Toca "Preguntar" para que la IA te explique cualquier concepto</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          <View>
            {search.trim().length >= 1 && (
              <TouchableOpacity
                onPress={() => handleCustomSearch()}
                activeOpacity={0.75}
                style={[s.aiCard, { borderColor: colors.accentLight, backgroundColor: colors.accentLight + "08" }]}
              >
                <View style={[s.topicIconBox, { backgroundColor: colors.accentLight + "20" }]}>
                  <Ionicons name="search-outline" size={20} color={colors.accentLight} />
                </View>
                <Text style={[s.topicTitle, { color: colors.accentLight }]} numberOfLines={2}>
                  "{search.trim()}"
                </Text>
                <Text style={[s.topicCat, { color: colors.accentLight + "99" }]}>
                  Explicar con IA →
                </Text>
              </TouchableOpacity>
            )}

            {/* Sesión 1:1 con Diego */}
            <TouchableOpacity
              style={[s.coachingCard, { backgroundColor: colors.card, borderColor: "rgba(0,212,126,0.3)" }]}
              onPress={() => Linking.openURL("https://calendly.com/diego-arria19/sesion-1-1-con-diego-nuvos-ai")}
              activeOpacity={0.75}
            >
              <View style={[s.coachingIconBox, { backgroundColor: "rgba(0,212,126,0.12)" }]}>
                <Ionicons name="calendar-outline" size={22} color="#00d47e" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.coachingCardTitle, { color: colors.text }]}>
                  ¿Prefieres aprender con alguien?
                </Text>
                <Text style={[s.coachingCardSub, { color: colors.textMuted }]}>
                  45 min contigo y Diego — te guía por la app y crea tu plan de inversión personalizado.
                </Text>
              </View>
              <View style={[s.coachingReservarBtn, { backgroundColor: "#00a85e" }]}>
                <Text style={s.coachingReservarText}>45 min →</Text>
              </View>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[s.topicCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => openTopic(item.title, item.prompt, item.icon)}
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

      {/* Flashcard modal — centrado, breve */}
      <Modal visible={!!modal} animationType="fade" transparent onRequestClose={() => !streaming && setModal(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.72)", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <View style={{ width: "100%", maxWidth: 420, borderRadius: 24, overflow: "hidden", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
            {/* Color strip */}
            <View style={{ height: 3, backgroundColor: "#00a85e" }} />

            {/* Header */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.accentLight + "18", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={modal?.icon ?? "book-outline"} size={18} color={colors.accentLight} />
                </View>
                <Text style={{ fontSize: 15, fontWeight: "800", color: colors.text, flex: 1 }} numberOfLines={1}>{modal?.title}</Text>
              </View>
              <TouchableOpacity onPress={() => setModal(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Content */}
            <View style={{ paddingHorizontal: 18, paddingVertical: 18, minHeight: 160 }}>
              {!content ? (
                <View style={{ alignItems: "center", justifyContent: "center", height: 120, gap: 12 }}>
                  <ActivityIndicator color={colors.accentLight} size="large" />
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>Preparando flashcard... ~2 seg</Text>
                </View>
              ) : (
                <View>
                  <Markdown style={markdownStyles}>{content}</Markdown>
                  {streaming && <Text style={{ color: "#22c55e", fontSize: 16 }}>▋</Text>}
                </View>
              )}
            </View>

            {/* Action */}
            {!streaming && content && (
              <View style={{ paddingHorizontal: 18, paddingBottom: 18 }}>
                <TouchableOpacity
                  onPress={() => setModal(null)}
                  style={{ backgroundColor: "#00a85e", borderRadius: 16, paddingVertical: 12, alignItems: "center" }}>
                  <Text style={{ color: "white", fontWeight: "800", fontSize: 14 }}>Entendido ✓</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      </View>

      {/* Milestone celebration */}
      <StreakMilestoneModal
        milestone={pendingMilestone ?? null}
        onClaim={handleClaimMilestone}
        claiming={claiming}
      />

    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },

    // Streak banner
    streakBanner: {
      flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const,
      marginHorizontal: 14, marginTop: 10, marginBottom: 6,
      borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10,
    },
    streakLeft: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
    streakFire: { fontSize: 24 },
    streakNum: { fontSize: 15, fontWeight: "800" as const },
    streakSub: { fontSize: 11, marginTop: 1 },
    streakGames: { flexDirection: "row" as const, gap: 8 },
    gameBtn: {
      flexDirection: "row" as const, alignItems: "center" as const, gap: 4,
      borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
    },
    gameBtnText: { fontSize: 11, fontWeight: "700" as const },

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
    aiCard: {
      borderRadius: 16, borderWidth: 1.5, borderStyle: "dashed",
      padding: 14, marginHorizontal: 16, marginBottom: 16, minHeight: 105,
    },

    // 1:1 coaching CTA
    coachingCard: {
      flexDirection: "row", alignItems: "center", gap: 12,
      borderRadius: 18, borderWidth: 1.5,
      padding: 14, marginHorizontal: 12, marginBottom: 24, marginTop: 4,
    },
    coachingIconBox: {
      width: 44, height: 44, borderRadius: 14,
      alignItems: "center", justifyContent: "center", flexShrink: 0,
    },
    coachingCardTitle:  { fontSize: 13, fontWeight: "700", marginBottom: 3 },
    coachingCardSub:    { fontSize: 11, lineHeight: 16 },
    coachingReservarBtn: {
      paddingHorizontal: 12, paddingVertical: 7,
      borderRadius: 20, flexShrink: 0,
    },
    coachingReservarText: { fontSize: 12, fontWeight: "800", color: "white" },

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
    // Sub-tab bar
    subTabBar:   { paddingHorizontal: 16, paddingVertical: 10 },
    subTabInner: { flexDirection: "row" as const, borderRadius: 14, padding: 3, gap: 2 },
    subTab: {
      flex: 1, flexDirection: "row" as const, alignItems: "center" as const,
      justifyContent: "center" as const, gap: 5, paddingVertical: 8, borderRadius: 11,
    },
    subTabActive: {},
    subTabText:   { fontSize: 13, fontWeight: "600" as const },
    // Investor cards
    invCard: {
      flexDirection: "row" as const, alignItems: "center" as const,
      gap: 12, padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth,
    },
    invAvatar: {
      width: 46, height: 46, borderRadius: 23,
      alignItems: "center" as const, justifyContent: "center" as const,
    },
    invAvatarText: { fontSize: 22 },
    invName:       { fontSize: 15, fontWeight: "700" as const },
    invFund:       { fontSize: 12, marginTop: 1 },
    invStylePill: {
      alignSelf: "flex-start" as const, marginTop: 4,
      paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6,
    },
    invStyleText:  { fontSize: 10, fontWeight: "600" as const },
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
