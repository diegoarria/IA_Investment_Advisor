"use client";

import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PremiumBadge from "@/components/PremiumBadge";
import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chat as chatApi } from "@/lib/api";
import { useAuthStore, useLearnStore, useProfileStore } from "@/lib/store";
import { getUserLevel, LEVEL_COLOR, LEVEL_LABEL, type UserLevel } from "@/lib/userLevel";

const CATEGORY_LEVEL: Record<string, UserLevel> = {
  basics:      "basico",
  psychology:  "basico",
  mexico:      "basico",
  instruments: "intermedio",
  companies:   "intermedio",
  markets:     "intermedio",
  strategies:  "intermedio",
  analysis:    "avanzado",
  ratios:      "avanzado",
};
import { Search, Menu, X, Calendar } from "lucide-react";
import GuidedSteps from "@/components/GuidedSteps";

const CATEGORIES = [
  { id: "all",         emoji: "🗂️",  title: "Todo" },
  { id: "basics",      emoji: "📚",  title: "Básicos" },
  { id: "instruments", emoji: "🏦",  title: "Instrumentos" },
  { id: "ratios",      emoji: "🧮",  title: "Ratios" },
  { id: "analysis",    emoji: "📊",  title: "Análisis" },
  { id: "strategies",  emoji: "🎯",  title: "Estrategias" },
  { id: "trading",     emoji: "⚡",  title: "Trading" },
  { id: "psychology",  emoji: "🧠",  title: "Psicología" },
  { id: "macro",       emoji: "🌐",  title: "Macro" },
  { id: "markets",     emoji: "🌍",  title: "Mercados" },
  { id: "mexico",      emoji: "🇲🇽", title: "México" },
  { id: "companies",   emoji: "🏢",  title: "Empresas" },
];

interface Topic {
  id: string;
  category: string;
  emoji: string;
  title: string;
  prompt: string;
}

const TOPICS: Topic[] = [
  // Básicos
  { id: "etf",       category: "basics",      emoji: "🏗️", title: "ETF",                   prompt: "Explícame qué es un ETF de forma completa. Incluye: definición, cómo funciona, tipos, ventajas y desventajas, ejemplos populares y diferencia con un fondo mutuo. Usa ejemplos concretos." },
  { id: "accion",    category: "basics",      emoji: "📈", title: "Acciones",              prompt: "Explícame qué es una acción bursátil. Incluye: definición, tipos (ordinaria vs preferente), derechos del accionista, cómo se compra/vende y qué mueve el precio." },
  { id: "bono",      category: "basics",      emoji: "📄", title: "Bonos",                 prompt: "Explícame qué es un bono. Incluye: cómo funciona el cupón, tipos de bonos, diferencia con acciones, riesgo y rendimiento, y cuándo conviene invertir en bonos." },
  { id: "dividendo", category: "basics",      emoji: "💰", title: "Dividendos",            prompt: "Explícame qué son los dividendos. Incluye: cómo funcionan, dividend yield, ex-dividend date, empresas que pagan bien y la estrategia de inversión por dividendos." },
  { id: "indice",    category: "basics",      emoji: "📋", title: "Índices Bursátiles",    prompt: "Explícame qué es un índice bursátil. Incluye: S&P 500, NASDAQ, Dow Jones, IPC México, cómo se calculan y cómo invertir en un índice." },
  { id: "interes_c", category: "basics",      emoji: "🚀", title: "Interés Compuesto",     prompt: "Explícame el interés compuesto y por qué es tan poderoso. Incluye: cómo funciona, ejemplos con números, la regla del 72 y cómo aprovecharlo." },
  { id: "inflacion", category: "basics",      emoji: "🔺", title: "Inflación",             prompt: "Explícame la inflación y su impacto en las inversiones. Incluye: cómo erosiona el capital, activos que protegen contra ella y estrategias para invertir en contextos inflacionarios." },
  { id: "liquidez",  category: "basics",      emoji: "💧", title: "Liquidez",              prompt: "Explícame qué es la liquidez en finanzas e inversiones. Incluye: por qué importa, activos líquidos vs ilíquidos, el trade-off rendimiento-liquidez y cuánta liquidez mantener en un portafolio." },
  // Instrumentos
  { id: "crypto",    category: "instruments", emoji: "₿",  title: "Criptomonedas",        prompt: "Explícame las criptomonedas como inversión. Incluye: qué son, Bitcoin vs Ethereum vs altcoins, volatilidad, casos de uso reales, riesgos y cómo integrarlas en un portafolio." },
  { id: "reit",      category: "instruments", emoji: "🏢", title: "REITs",                 prompt: "Explícame qué son los REITs. Incluye: cómo funcionan, tipos, rendimientos históricos, su equivalente en México (FIBRAS) y cómo añadirlos a un portafolio." },
  { id: "commodities",category:"instruments", emoji: "📦", title: "Commodities",           prompt: "Explícame los commodities como inversión. Incluye: tipos (oro, petróleo, agrícolas), cómo invertir en ellos (futuros, ETFs), por qué sirven como cobertura y su comportamiento en distintos ciclos." },
  { id: "derivados", category: "instruments", emoji: "🌿", title: "Derivados",             prompt: "Explícame qué son los derivados financieros (opciones, futuros, swaps). Incluye: cómo funcionan, para qué sirven (cobertura vs especulación), y por qué son complejos y riesgosos para principiantes." },
  // Análisis
  { id: "pe_ratio",  category: "analysis",   emoji: "🧮", title: "P/E Ratio",             prompt: "Explícame el P/E Ratio (Price-to-Earnings). Incluye: cómo se calcula, qué significa, P/E alto vs bajo, comparación entre sectores, el PEG ratio y sus limitaciones." },
  { id: "roe",       category: "analysis",   emoji: "🏆", title: "ROE",                   prompt: "Explícame el ROE (Return on Equity). Incluye: cómo se calcula, qué indica de la calidad del negocio, cómo compararlo, su relación con ROA y ROIC, y ejemplos con empresas reales." },
  { id: "dcf",       category: "analysis",   emoji: "⏳", title: "Valuación DCF",         prompt: "Explícame el modelo de valuación DCF (Discounted Cash Flow). Incluye: concepto de valor presente, cómo estimar flujos futuros, tasa de descuento, valor terminal y limitaciones del modelo." },
  { id: "tec",       category: "analysis",   emoji: "📊", title: "Análisis Técnico",      prompt: "Explícame el análisis técnico. Incluye: principios básicos, indicadores clave (RSI, MACD, medias móviles), soporte y resistencia, patrones de velas y debate vs análisis fundamental." },
  { id: "fund",      category: "analysis",   emoji: "🔍", title: "Análisis Fundamental",  prompt: "Explícame el análisis fundamental de empresas paso a paso. Incluye: ingresos, márgenes, deuda, crecimiento, cómo leer balance y estado de resultados, y métricas clave." },
  { id: "estados",   category: "analysis",   emoji: "📖", title: "Estados Financieros",   prompt: "Explícame cómo leer los estados financieros de una empresa. Incluye: balance general, estado de resultados, flujo de efectivo, y qué buscar en cada uno como inversionista." },
  { id: "moat",      category: "analysis",   emoji: "🛡️", title: "Ventaja Competitiva",   prompt: "Explícame el concepto de 'moat' o ventaja competitiva (Warren Buffett). Incluye: tipos de moat, cómo identificarlos y ejemplos de empresas con moat fuerte vs débil." },
  { id: "ebitda",    category: "analysis",   emoji: "📊", title: "EBITDA",                prompt: "Explícame qué es el EBITDA y para qué sirve en el análisis de empresas. Incluye: cómo se calcula, por qué se usa, sus limitaciones y cómo usarlo para comparar empresas." },
  // Estrategias
  { id: "dca",       category: "strategies", emoji: "📅", title: "Dollar Cost Averaging", prompt: "Explícame la estrategia DCA (Dollar Cost Averaging). Incluye: cómo funciona, por qué reduce el riesgo de timing, comparación con lump sum, cuándo conviene y cómo implementarla." },
  { id: "diversif",  category: "strategies", emoji: "🥧", title: "Diversificación",       prompt: "Explícame la diversificación en inversiones. Incluye: por qué funciona, correlación de activos, diversificación por tipo/sector/geografía, cuánto es suficiente y el costo de sobre-diversificar." },
  { id: "value_inv", category: "strategies", emoji: "💎", title: "Value Investing",       prompt: "Explícame el Value Investing (Buffett y Graham). Incluye: principios fundamentales, margen de seguridad, cómo encontrar empresas subvaloradas y por qué es difícil de ejecutar." },
  { id: "growth_inv",category: "strategies", emoji: "🌱", title: "Growth Investing",      prompt: "Explícame el Growth Investing. Incluye: qué busca, métricas clave (TAM, revenue growth, gross margin), diferencias con value investing y riesgos de múltiplos altos." },
  { id: "pasivo",    category: "strategies", emoji: "🌙", title: "Inversión Pasiva",      prompt: "Explícame la inversión pasiva vs activa. Incluye: fondos index, la evidencia de que la mayoría de fondos activos no superan al índice, el argumento de Jack Bogle y cómo construir un portafolio pasivo." },
  { id: "rebalanceo",category: "strategies", emoji: "🔄", title: "Rebalanceo",            prompt: "Explícame el rebalanceo de portafolios. Incluye: por qué es necesario, rebalanceo por tiempo vs umbral, consecuencias fiscales y su impacto en el rendimiento." },
  { id: "cobertura", category: "strategies", emoji: "🛡️", title: "Cobertura (Hedging)",   prompt: "Explícame el hedging o cobertura en inversiones. Incluye: qué es, para qué sirve, herramientas comunes (opciones, ETFs inversos), costos y cuándo tiene sentido para un inversor individual." },
  // Psicología
  { id: "sesgo_c",   category: "psychology", emoji: "👁️", title: "Sesgo de Confirmación", prompt: "Explícame el sesgo de confirmación en inversiones. Incluye: cómo nos afecta, ejemplos concretos, cómo lleva a pérdidas y estrategias para contrarrestarlo." },
  { id: "aversion",  category: "psychology", emoji: "⚠️", title: "Aversión a la Pérdida", prompt: "Explícame la aversión a la pérdida (Kahneman & Tversky). Incluye: por qué las pérdidas duelen más que las ganancias, cómo afecta las decisiones y cómo manejarla." },
  { id: "fomo",      category: "psychology", emoji: "⚡", title: "FOMO",                  prompt: "Explícame el FOMO (Fear Of Missing Out) en inversiones. Incluye: por qué es dañino, casos históricos (cripto 2021, GME) y estrategias para no dejarse llevar." },
  { id: "herd",      category: "psychology", emoji: "👥", title: "Comportamiento de Manada",prompt: "Explícame el comportamiento de manada en mercados. Incluye: por qué ocurre, cómo genera burbujas y crashes, ejemplos históricos y cómo un inversor racional puede aprovecharlo." },
  { id: "ancla",     category: "psychology", emoji: "📌", title: "Sesgo de Anclaje",      prompt: "Explícame el sesgo de anclaje en inversiones. Incluye: qué es, cómo nos afecta al evaluar precios y valoraciones, ejemplos concretos y cómo evitarlo." },
  // Mercados
  { id: "bull_bear", category: "markets",    emoji: "↕️", title: "Bull vs Bear Market",   prompt: "Explícame la diferencia entre mercado alcista y bajista. Incluye: definiciones, duración histórica promedio, cómo comportarse en cada fase y por qué predecirlos es casi imposible." },
  { id: "tasas",     category: "markets",    emoji: "🏠", title: "Tasas de Interés",      prompt: "Explícame el impacto de las tasas de interés en los mercados. Incluye: cómo la Fed y Banxico afectan los mercados, relación con bonos, impacto en acciones growth vs value y el ciclo económico." },
  { id: "recesion",  category: "markets",    emoji: "📉", title: "Recesión",              prompt: "Explícame qué es una recesión económica y cómo afecta las inversiones. Incluye: definición técnica, indicadores que la anticipan, sectores que resisten mejor y estrategias para proteger el portafolio." },
  { id: "forex",     category: "markets",    emoji: "↔️", title: "Forex",                 prompt: "Explícame el mercado Forex. Incluye: cómo funciona, pares más importantes, qué mueve los tipos de cambio, diferencias con la bolsa y por qué es tan riesgoso para principiantes." },
  // México
  { id: "cetes",     category: "mexico",     emoji: "👛", title: "CETES",                 prompt: "Explícame los CETES en México. Incluye: cómo funcionan, plazos, rendimientos, cómo comprarlos en cetesdirecto.com.mx, ventajas fiscales y si convienen para distintos perfiles." },
  { id: "fibras",    category: "mexico",     emoji: "🏗️", title: "FIBRAS",                prompt: "Explícame las FIBRAS mexicanas (REITs de México). Incluye: cómo funcionan, principales FIBRAS del mercado, rendimientos típicos, ventajas fiscales y cómo invertir." },
  { id: "bmv",       category: "mexico",     emoji: "📊", title: "Bolsa Mexicana (BMV)",  prompt: "Explícame cómo funciona la Bolsa Mexicana de Valores. Incluye: estructura, índices (IPC, INMEX), principales empresas, diferencias con Wall Street y cómo acceder siendo mexicano." },
  { id: "gbm",       category: "mexico",     emoji: "📱", title: "Invertir desde México", prompt: "Explícame cómo un mexicano puede invertir en mercados internacionales. Incluye: brokers disponibles (GBM+, BIVA, Interactive Brokers), requisitos, implicaciones fiscales (SAT), y recomendaciones para comenzar." },
  // Empresas
  { id: "nvidia",    category: "companies",  emoji: "💻", title: "NVIDIA",                prompt: "Explícame el modelo de negocio de NVIDIA. Incluye: cómo gana dinero, su posición en GPUs para IA, moat competitivo, métricas financieras clave y principales riesgos." },
  { id: "apple",     category: "companies",  emoji: "📱", title: "Apple",                 prompt: "Explícame el modelo de negocio de Apple. Incluye: hardware vs servicios, el ecosistema como moat, métricas clave, programa de recompra de acciones y riesgos a largo plazo." },
  { id: "amazon",    category: "companies",  emoji: "🛒", title: "Amazon",                prompt: "Explícame el modelo de negocio de Amazon. Incluye: retail vs AWS vs publicidad, cómo AWS subsidia el retail, métricas clave y principales riesgos competitivos." },
  { id: "microsoft", category: "companies",  emoji: "🖥️", title: "Microsoft",             prompt: "Explícame el modelo de negocio de Microsoft. Incluye: sus segmentos (Azure, Office, gaming), su transformación cloud, moat competitivo, métricas financieras y perspectivas de IA." },
  { id: "tesla",     category: "companies",  emoji: "🚗", title: "Tesla",                 prompt: "Explícame el modelo de negocio de Tesla. Incluye: más allá del carro eléctrico (energía, software, robo-taxi), su posición competitiva, los riesgos principales y por qué es tan debatida su valuación." },
  { id: "alphabet",  category: "companies",  emoji: "🔍", title: "Alphabet / Google",     prompt: "Eres una enciclopedia financiera. Explica el modelo de negocio de Alphabet (Google). Incluye: segmentos de ingresos (Search, YouTube, Cloud, Other Bets), su moat publicitario, métricas clave y riesgos regulatorios y competitivos." },
  { id: "meta_co",   category: "companies",  emoji: "👁️", title: "Meta",                  prompt: "Eres una enciclopedia financiera. Explica el modelo de negocio de Meta. Incluye: ingresos por publicidad, el metaverso y Reality Labs, su dominio en redes sociales, métricas de usuarios y sus principales riesgos." },
  { id: "berkshire", category: "companies",  emoji: "🎩", title: "Berkshire Hathaway",    prompt: "Eres una enciclopedia financiera. Explica Berkshire Hathaway como empresa e inversión. Incluye: el modelo de holding de Buffett, las principales subsidiarias, cómo evaluar su valor intrínseco y sus diferencias con un ETF." },
  { id: "jpmorgan",  category: "companies",  emoji: "🏦", title: "JPMorgan Chase",        prompt: "Eres una enciclopedia financiera. Explica JPMorgan Chase como inversión. Incluye: sus líneas de negocio (banca retail, investment banking, wealth management), cómo se valúan los bancos y métricas clave como ROE y P/B." },
  { id: "femsa",     category: "companies",  emoji: "🍺", title: "FEMSA",                 prompt: "Eres una enciclopedia financiera. Explica FEMSA como inversión. Incluye: sus divisiones (Coca-Cola FEMSA, OXXO, salud), su cotización en BMV y NYSE, estructura accionaria y por qué es importante para el inversionista mexicano." },

  // ── BÁSICOS NUEVOS ───────────────────────────────────────────────────────
  { id: "ticker",     category: "basics",     emoji: "🔤", title: "Ticker",                prompt: "Eres una enciclopedia financiera. Explica qué es un ticker bursátil: definición, cómo se asigna, diferencia entre NYSE/NASDAQ/BMV, ejemplos y por qué importa al momento de operar." },
  { id: "spread",     category: "basics",     emoji: "↔️", title: "Spread Bid-Ask",        prompt: "Eres una enciclopedia financiera. Explica el spread bid-ask: qué es, cómo afecta al inversor, diferencia en activos líquidos vs ilíquidos, y cómo minimizarlo al operar." },
  { id: "market_cap", category: "basics",     emoji: "🏰", title: "Capitalización de Mercado", prompt: "Eres una enciclopedia financiera. Explica la capitalización de mercado (market cap): cómo se calcula, diferencia entre large cap/mid cap/small cap, por qué no es lo mismo que el valor de la empresa y cómo usarla." },
  { id: "broker",     category: "basics",     emoji: "🏛️", title: "Broker / Casa de Bolsa", prompt: "Eres una enciclopedia financiera. Explica qué es un broker o casa de bolsa: tipos, cómo funcionan, cómo elegir uno, comisiones, regulación, diferencia entre broker de descuento y full-service." },
  { id: "beta_b",     category: "basics",     emoji: "β", title: "Beta",                   prompt: "Eres una enciclopedia financiera. Explica el Beta como medida de riesgo: cómo se calcula, beta > 1 vs < 1, beta negativa, relación con el mercado, cuándo usarlo y sus limitaciones." },
  { id: "alpha_b",    category: "basics",     emoji: "α", title: "Alpha",                  prompt: "Eres una enciclopedia financiera. Explica el Alpha en inversiones: qué significa generar alpha, cómo se calcula, por qué es tan difícil de obtener consistentemente y su relación con el beta." },
  { id: "benchmark",  category: "basics",     emoji: "📏", title: "Benchmark",              prompt: "Eres una enciclopedia financiera. Explica qué es un benchmark en inversiones: cómo se usa para evaluar fondos y gestores, los benchmarks más comunes (S&P 500, MSCI World), y por qué casi nadie supera al benchmark de forma consistente." },
  { id: "ipo",        category: "basics",     emoji: "🚀", title: "IPO (Salida a Bolsa)",  prompt: "Eres una enciclopedia financiera. Explica el proceso de IPO (Initial Public Offering): cómo funciona, el papel de los bancos de inversión, el lock-up period, cómo participar, riesgos y ejemplos históricos notables." },
  { id: "split",      category: "basics",     emoji: "✂️", title: "Stock Split",            prompt: "Eres una enciclopedia financiera. Explica el stock split: qué es, por qué lo hacen las empresas, efecto real en el valor de inversión, reverse split y ejemplos recientes (Apple, Tesla, Nvidia)." },
  { id: "buyback",    category: "basics",     emoji: "🔁", title: "Buyback (Recompra)",    prompt: "Eres una enciclopedia financiera. Explica la recompra de acciones (stock buyback): por qué las empresas lo hacen, impacto en el EPS y precio, cuándo es bueno vs señal negativa, y las empresas más activas en recompras." },
  { id: "short_sell", category: "basics",     emoji: "📉", title: "Venta en Corto (Short)", prompt: "Eres una enciclopedia financiera. Explica la venta en corto (short selling): cómo funciona paso a paso, el riesgo de pérdida ilimitada, el short squeeze, por qué los reguladores la limitan y ejemplos famosos." },
  { id: "apalanc",    category: "basics",     emoji: "⚖️", title: "Apalancamiento",        prompt: "Eres una enciclopedia financiera. Explica el apalancamiento financiero: cómo amplifica ganancias Y pérdidas, margin trading, el riesgo de ruina, apalancamiento en empresas vs inversores y cuándo tiene sentido usarlo." },
  { id: "blue_chips", category: "basics",     emoji: "💎", title: "Blue Chips",            prompt: "Eres una enciclopedia financiera. Explica las empresas blue chip: criterios para serlo, ventajas como inversión, diferencia con growth stocks, ejemplos en EEUU y México y por qué son la columna vertebral de portafolios conservadores." },
  { id: "earnings",   category: "basics",     emoji: "📅", title: "Earnings / Resultados", prompt: "Eres una enciclopedia financiera. Explica el earnings season: qué informan las empresas, EPS vs consenso, revenue beat/miss, guidance, reacción del mercado y cómo prepararse como inversor para los reportes trimestrales." },
  { id: "volatil",    category: "basics",     emoji: "🌊", title: "Volatilidad",           prompt: "Eres una enciclopedia financiera. Explica la volatilidad en mercados financieros: definición estadística (desviación estándar), volatilidad histórica vs implícita, VIX, por qué puede ser oportunidad y cómo afecta a distintos tipos de inversor." },
  { id: "portafolio", category: "basics",     emoji: "💼", title: "Portafolio de Inversión", prompt: "Eres una enciclopedia financiera. Explica cómo construir un portafolio de inversión: tipos de activos, teoría de Markowitz, frontera eficiente, asignación por perfil de riesgo y cómo monitorearlo." },
  { id: "rendimiento",category: "basics",     emoji: "📊", title: "Rendimiento / Retorno",  prompt: "Eres una enciclopedia financiera. Explica los tipos de rendimiento en inversiones: retorno total, retorno anualizado, CAGR, retorno ajustado por riesgo, diferencia entre rentabilidad nominal y real, y cómo calcularlo correctamente." },

  // ── INSTRUMENTOS NUEVOS ──────────────────────────────────────────────────
  { id: "opciones",   category: "instruments",emoji: "🎫", title: "Opciones Financieras",  prompt: "Eres una enciclopedia financiera. Explica las opciones financieras: calls y puts, los 4 roles básicos (comprar/vender call, comprar/vender put), la prima, strike price, fecha de expiración, y usos para cobertura y especulación." },
  { id: "calls_puts", category: "instruments",emoji: "📞", title: "Calls y Puts",          prompt: "Eres una enciclopedia financiera. Explica calls y puts en detalle: definición precisa, cuándo se usan, el profit/loss de cada posición con ejemplos numéricos, el valor intrínseco vs valor temporal y las gregas básicas (delta, theta)." },
  { id: "futuros_i",  category: "instruments",emoji: "📆", title: "Contratos de Futuros",  prompt: "Eres una enciclopedia financiera. Explica los contratos de futuros: cómo funcionan, quiénes los usan (productores, especuladores, arbitragistas), contango vs backwardation, el rol del margen y ejemplos en commodities y financieros." },
  { id: "fondos_m",   category: "instruments",emoji: "🏦", title: "Fondos Mutuos",         prompt: "Eres una enciclopedia financiera. Explica los fondos mutuos: cómo funcionan, diferencia con ETFs, tipos (activos vs indexados), comisiones (TER/TERs), cómo elegir uno y por qué el expense ratio es crítico para el rendimiento a largo plazo." },
  { id: "bonos_c",    category: "instruments",emoji: "🏢", title: "Bonos Corporativos",    prompt: "Eres una enciclopedia financiera. Explica los bonos corporativos: diferencia con bonos gubernamentales, calificaciones crediticias (Aaa, BBB, BB), spread sobre tesoros, riesgo de incumplimiento y cómo diversificar exposición." },
  { id: "hy_bonds",   category: "instruments",emoji: "⚠️", title: "Bonos High Yield (Junk)", prompt: "Eres una enciclopedia financiera. Explica los bonos de alto rendimiento (high yield o 'junk bonds'): por qué pagan más, su calificación crediticia (BB o menor), comportamiento durante recesiones, ETFs para acceder a ellos y el riesgo de default." },
  { id: "stablecoin", category: "instruments",emoji: "💲", title: "Stablecoins",            prompt: "Eres una enciclopedia financiera. Explica las stablecoins: tipos (colateralizadas en USD, cripto o algorítmicas), los riesgos principales (colapso de UST/LUNA, regulación), su uso en DeFi y si son una alternativa válida de ahorro." },
  { id: "defi",       category: "instruments",emoji: "🔗", title: "DeFi (Finanzas Descentralizadas)", prompt: "Eres una enciclopedia financiera. Explica DeFi: qué es, protocolos principales (Uniswap, Aave, Compound), yield farming, liquidity mining, los riesgos reales (smart contract bugs, rug pulls) y por qué es disruptivo pero peligroso para no expertos." },
  { id: "priv_eq",    category: "instruments",emoji: "🔒", title: "Private Equity",        prompt: "Eres una enciclopedia financiera. Explica el private equity: cómo funciona, LBOs (leveraged buyouts), venture capital vs growth equity vs buyout, cómo acceder siendo inversor individual, rendimientos históricos vs mercado público y sus riesgos." },
  { id: "vc",         category: "instruments",emoji: "🌱", title: "Venture Capital",       prompt: "Eres una enciclopedia financiera. Explica el venture capital: etapas de inversión (seed, Series A/B/C), cómo piensan los VCs (power law), cómo acceder a él, diferencia con angel investing y por qué el 90% de startups fracasa." },
  { id: "warrants",   category: "instruments",emoji: "🎟️", title: "Warrants",              prompt: "Eres una enciclopedia financiera. Explica los warrants: diferencia con opciones, cómo los emiten las empresas, dilución para accionistas y su uso en fusiones y adquisiciones." },
  { id: "tips_b",     category: "instruments",emoji: "📌", title: "TIPS / Bonos Indexados", prompt: "Eres una enciclopedia financiera. Explica los TIPS (Treasury Inflation-Protected Securities): cómo protegen contra la inflación, cómo funciona el ajuste del principal, cuándo convienen vs bonos normales y su equivalente en México (Udibonos)." },

  // ── RATIOS Y MÉTRICAS (nueva categoría) ────────────────────────────────
  { id: "eps",        category: "ratios",     emoji: "💰", title: "EPS (Ganancia por Acción)", prompt: "Eres una enciclopedia financiera. Explica el EPS (Earnings Per Share): cómo se calcula, básico vs diluido, por qué es la métrica más seguida, cómo las recompras artificialmente lo inflan y cómo usarlo en combinación con el P/E." },
  { id: "revenue",    category: "ratios",     emoji: "📈", title: "Revenue / Ingresos",     prompt: "Eres una enciclopedia financiera. Explica el revenue (ingresos) de una empresa: top line vs bottom line, revenue growth rate, diferencia entre ingresos y ganancias, por qué algunas empresas con pérdidas se valúan altísimo y cómo analizar la calidad del revenue." },
  { id: "gross_mg",   category: "ratios",     emoji: "📐", title: "Margen Bruto",           prompt: "Eres una enciclopedia financiera. Explica el margen bruto: cómo se calcula (revenue - COGS), qué dice sobre el modelo de negocio, comparación por sector (software >70% vs retail <30%), y cómo mejorarlo indica poder de fijación de precios." },
  { id: "net_mg",     category: "ratios",     emoji: "🎯", title: "Margen Neto",            prompt: "Eres una enciclopedia financiera. Explica el margen neto: cómo se calcula, diferencia con margen operativo y bruto, por qué varía tanto entre sectores, qué márgenes son excelentes vs aceptables y las trampas contables que lo distorsionan." },
  { id: "fcf",        category: "ratios",     emoji: "💵", title: "Free Cash Flow (FCF)",   prompt: "Eres una enciclopedia financiera. Explica el Free Cash Flow: por qué es más importante que las ganancias contables, cómo se calcula (Operating CF - CapEx), FCF yield, empresas con alto FCF vs capital intensivas y la trampa del FCF negativo en empresas en crecimiento." },
  { id: "de_ratio",   category: "ratios",     emoji: "⚖️", title: "Ratio Deuda/Capital (D/E)", prompt: "Eres una enciclopedia financiera. Explica el ratio Deuda/Capital (D/E): cómo se calcula, niveles saludables por sector, diferencia entre deuda buena y mala, Net Debt vs Gross Debt y cómo la deuda amplifica retornos y riesgos." },
  { id: "ps_ratio",   category: "ratios",     emoji: "🏷️", title: "P/S Ratio (Precio/Ventas)", prompt: "Eres una enciclopedia financiera. Explica el P/S ratio: cuándo usarlo (empresas sin ganancias), niveles por sector, sus limitaciones vs P/E y por qué una empresa con P/S de 20x puede ser barata y una con P/S de 2x puede ser cara." },
  { id: "pb_ratio",   category: "ratios",     emoji: "📚", title: "P/B Ratio (Precio/Valor Libro)", prompt: "Eres una enciclopedia financiera. Explica el P/B ratio: qué es el valor en libros, cuándo P/B < 1 es señal de valor, por qué es más útil en bancos que en tech, y las diferencias con tangible book value." },
  { id: "ev_ebitda",  category: "ratios",     emoji: "🏭", title: "EV/EBITDA",              prompt: "Eres una enciclopedia financiera. Explica el EV/EBITDA: qué es el enterprise value, por qué es mejor que P/E para comparar empresas con distinta estructura de capital, múltiplos razonables por sector y sus limitaciones." },
  { id: "peg_r",      category: "ratios",     emoji: "🚀", title: "PEG Ratio",              prompt: "Eres una enciclopedia financiera. Explica el PEG ratio: cómo combina P/E con crecimiento, qué significa PEG < 1, forward PEG, sus limitaciones y por qué Peter Lynch lo popularizó como mejora del P/E estático." },
  { id: "div_yield",  category: "ratios",     emoji: "💸", title: "Dividend Yield",         prompt: "Eres una enciclopedia financiera. Explica el dividend yield: cómo se calcula, la trampa del yield alto (puede indicar caída del precio), yield sostenible vs insostenible, dividend growth investing y cómo comparar rendimientos con bonos." },
  { id: "payout_r",   category: "ratios",     emoji: "📤", title: "Payout Ratio",           prompt: "Eres una enciclopedia financiera. Explica el payout ratio: qué es, payout > 100% como señal de alarma, la relación con la sostenibilidad del dividendo y cómo las mejores empresas balancean dividendos con recompras y reinversión." },
  { id: "sharpe_r",   category: "ratios",     emoji: "📊", title: "Sharpe Ratio",           prompt: "Eres una enciclopedia financiera. Explica el Sharpe Ratio: retorno ajustado por riesgo, cómo se calcula, qué significa un Sharpe > 1, sus limitaciones (asume distribución normal) y la diferencia con el Sortino Ratio." },
  { id: "drawdown_r", category: "ratios",     emoji: "⬇️", title: "Drawdown",               prompt: "Eres una enciclopedia financiera. Explica el drawdown en inversiones: maximum drawdown, cómo medir la recuperación, por qué el 50% de caída requiere 100% para recuperarse, su relación con el perfil de riesgo y cómo comparar estrategias por su drawdown histórico." },
  { id: "cagr_r",     category: "ratios",     emoji: "📈", title: "CAGR",                   prompt: "Eres una enciclopedia financiera. Explica el CAGR (Compound Annual Growth Rate): cómo se calcula, diferencia con promedio simple, por qué es la métrica correcta para comparar inversiones a largo plazo y ejemplos de CAGRs históricos notables." },
  { id: "roic_r",     category: "ratios",     emoji: "♻️", title: "ROIC",                   prompt: "Eres una enciclopedia financiera. Explica el ROIC (Return on Invested Capital): por qué Warren Buffett y Charlie Munger lo consideran la métrica más importante, cómo se calcula, diferencia con ROE y ROA, y qué ROIC indica un moat verdadero." },
  { id: "wacc_r",     category: "ratios",     emoji: "💹", title: "WACC",                   prompt: "Eres una enciclopedia financiera. Explica el WACC (Weighted Average Cost of Capital): para qué sirve en la valuación DCF, sus componentes (costo de equity vs deuda), cómo estimarlo y por qué pequeños cambios en el WACC tienen gran impacto en la valuación." },
  { id: "nav_r",      category: "ratios",     emoji: "📦", title: "NAV (Valor Activo Neto)", prompt: "Eres una enciclopedia financiera. Explica el NAV (Net Asset Value): cómo se calcula para fondos y ETFs, premium vs discount al NAV en CEFs, por qué los ETFs cotizan cerca del NAV y su uso para valorar holdings companies como Berkshire." },
  { id: "current_r",  category: "ratios",     emoji: "💧", title: "Current Ratio / Liquidez", prompt: "Eres una enciclopedia financiera. Explica el current ratio y el quick ratio: qué miden sobre la salud financiera a corto plazo, ratios saludables por sector, diferencia entre liquidez y solvencia y cuándo un ratio bajo es señal de alarma." },
  { id: "ev_r",       category: "ratios",     emoji: "🏢", title: "Enterprise Value (EV)",  prompt: "Eres una enciclopedia financiera. Explica el Enterprise Value: qué incluye (market cap + deuda - efectivo), por qué es mejor que el market cap para adquisiciones, el concepto de 'precio de compra real' y cómo se usa en múltiplos de valuación." },

  // ── ANÁLISIS NUEVOS ──────────────────────────────────────────────────────
  { id: "vix_a",      category: "analysis",   emoji: "😰", title: "VIX (Índice del Miedo)", prompt: "Eres una enciclopedia financiera. Explica el VIX (CBOE Volatility Index): qué mide exactamente, cómo se interpreta (>30 = pánico, <15 = complacencia), por qué sube cuando el mercado cae, el contango en futuros de VIX y cómo usarlo como señal de inversión contraria." },
  { id: "rsi_a",      category: "analysis",   emoji: "💪", title: "RSI",                    prompt: "Eres una enciclopedia financiera. Explica el RSI (Relative Strength Index): cómo se calcula, interpretación de sobrecompra (>70) y sobreventa (<30), divergencias como señal más poderosa, sus limitaciones en tendencias fuertes y cómo usarlo en conjunto con otros indicadores." },
  { id: "macd_a",     category: "analysis",   emoji: "🔄", title: "MACD",                   prompt: "Eres una enciclopedia financiera. Explica el MACD (Moving Average Convergence Divergence): sus tres componentes (línea MACD, señal, histograma), cómo generar señales de compra/venta, divergencias y por qué es uno de los indicadores más usados en análisis técnico." },
  { id: "bollinger",  category: "analysis",   emoji: "📏", title: "Bandas de Bollinger",    prompt: "Eres una enciclopedia financiera. Explica las Bandas de Bollinger: cómo se construyen, la 'contracción' como señal de movimiento inminente, el 'squeeze', toques de banda como señal de reversión y sus limitaciones cuando el precio sigue la banda en tendencia." },
  { id: "fibonacci",  category: "analysis",   emoji: "🌀", title: "Fibonacci en Trading",  prompt: "Eres una enciclopedia financiera. Explica los niveles de Fibonacci en análisis técnico: los retrocesos clásicos (23.6%, 38.2%, 50%, 61.8%, 78.6%), por qué el mercado los respeta, extensiones de Fibonacci y el debate sobre si son profecía autocumplida." },
  { id: "soporte_r",  category: "analysis",   emoji: "🏗️", title: "Soporte y Resistencia",  prompt: "Eres una enciclopedia financiera. Explica soporte y resistencia: cómo identificarlos, el concepto de 'cambio de polaridad', soportes en promedios móviles, niveles psicológicos (números redondos) y cómo volume confirma una ruptura válida." },
  { id: "prom_mov",   category: "analysis",   emoji: "〰️", title: "Medias Móviles",         prompt: "Eres una enciclopedia financiera. Explica las medias móviles: SMA vs EMA, la golden cross y death cross, la MA de 200 días como soporte/resistencia histórico, sus limitaciones como indicador rezagado y cómo se usan en sistemas de tendencia." },
  { id: "candlestick",category: "analysis",   emoji: "🕯️", title: "Velas Japonesas",        prompt: "Eres una enciclopedia financiera. Explica las velas japonesas (candlestick charts): anatomía de una vela, los patrones más fiables (doji, hammer, engulfing, morning star), cuáles tienen más evidencia estadística y cómo combinarlos con volumen." },

  // ── TRADING ACTIVO (nueva categoría) ────────────────────────────────────
  { id: "buy_hold",   category: "trading",    emoji: "⏳", title: "Buy and Hold",           prompt: "Eres una enciclopedia financiera. Explica la estrategia Buy and Hold: la evidencia académica que la respalda, por qué bate a la mayoría de estrategias activas, el papel de los impuestos y comisiones, casos históricos de quienes la ejecutaron bien y sus límites psicológicos." },
  { id: "swing_t",    category: "trading",    emoji: "🎢", title: "Swing Trading",          prompt: "Eres una enciclopedia financiera. Explica el swing trading: holding de días a semanas, cómo identificar swings en tendencias, herramientas usadas (RSI, MACD, velas), gestión de riesgo con stop-loss, diferencia con day trading y por qué muy pocos son consistentemente rentables." },
  { id: "day_t",      category: "trading",    emoji: "⚡", title: "Day Trading",            prompt: "Eres una enciclopedia financiera. Explica el day trading: qué implica realmente, estadísticas de rentabilidad (>80% pierde dinero), los costos reales (spread, comisiones, slippage), requisitos de capital (PDT rule en EEUU) y por qué es más difícil que parece." },
  { id: "scalping",   category: "trading",    emoji: "🔬", title: "Scalping",               prompt: "Eres una enciclopedia financiera. Explica el scalping: operaciones de segundos o minutos, la importancia del spread, necesidad de plataformas ultra-rápidas, por qué es casi imposible para retail traders competir con HFT y las estrategias usadas." },
  { id: "momentum_t", category: "trading",    emoji: "🏃", title: "Momentum",               prompt: "Eres una enciclopedia financiera. Explica el momentum investing: la evidencia académica (anomalía documentada), cómo medirlo (retorno a 12 meses excluyendo último mes), momentum crash, diferencia entre momentum de precio y momentum de earnings y los ETFs que lo aplican." },
  { id: "trend_f",    category: "trading",    emoji: "📈", title: "Trend Following",        prompt: "Eres una enciclopedia financiera. Explica el trend following: la filosofía de 'corta tus pérdidas, deja correr tus ganancias', los managers más famosos (Turtle Traders, AHL), sus características (funciona mal en mercados laterales) y los sistemas de cruce de medias más usados." },
  { id: "mean_rev",   category: "trading",    emoji: "↩️", title: "Reversión a la Media",   prompt: "Eres una enciclopedia financiera. Explica la reversión a la media en mercados: la evidencia estadística, estrategias de pairs trading, problemas de implementación (¿cuándo la media cambia?), examples en acciones y sectores y cómo distinguirla de una trampa de valor." },
  { id: "position_s", category: "trading",    emoji: "📐", title: "Position Sizing",        prompt: "Eres una enciclopedia financiera. Explica el position sizing: por qué es tan importante como la selección de activos, el criterio de Kelly, el modelo de 1-2% de riesgo por operación, diversificación por correlación y por qué el position sizing correcto es la diferencia entre sobrevivir y quebrar." },
  { id: "stop_loss",  category: "trading",    emoji: "🛑", title: "Stop Loss",              prompt: "Eres una enciclopedia financiera. Explica el stop loss: tipos (fijo, trailing, mental), cómo establecer niveles basados en la estructura del mercado vs porcentaje fijo, el 'gap risk', el debate sobre stops mentales vs automáticos y por qué muchos traders no los usan correctamente." },
  { id: "rr_ratio",   category: "trading",    emoji: "⚖️", title: "Ratio Riesgo/Recompensa", prompt: "Eres una enciclopedia financiera. Explica el ratio riesgo/recompensa (R/R): cómo calcularlo, por qué un R/R de 1:2 o 1:3 es preferible, la relación entre R/R y win rate necesario para ser rentable, y cómo el R/R interactúa con la probabilidad de éxito." },

  // ── ESTRATEGIAS NUEVAS ───────────────────────────────────────────────────
  { id: "income_i",   category: "strategies", emoji: "💵", title: "Income Investing",       prompt: "Eres una enciclopedia financiera. Explica el income investing: estrategia orientada a generar flujo de caja regular, instrumentos usados (dividendos, bonos, REITs, covered calls), la diferencia entre rendimiento y rendimiento total, y cómo construir un portafolio de ingresos." },
  { id: "garp",       category: "strategies", emoji: "🌿", title: "GARP (Growth at Reasonable Price)", prompt: "Eres una enciclopedia financiera. Explica el GARP: la filosofía de Peter Lynch, el PEG Ratio como herramienta clave, cómo equilibra value y growth investing, ejemplos de empresas GARP históricas y cómo aplicarlo en la práctica." },
  { id: "allweather", category: "strategies", emoji: "☁️", title: "All Weather Portfolio",   prompt: "Eres una enciclopedia financiera. Explica el All Weather Portfolio de Ray Dalio: la filosofía de paridad de riesgo, la asignación (30% acciones, 40% bonos largo, 15% bonos medio, 7.5% oro, 7.5% commodities), rendimiento histórico, limitaciones en periodos de alta inflación y cómo replicarlo." },
  { id: "barbell",    category: "strategies", emoji: "🏋️", title: "Estrategia Barbell",     prompt: "Eres una enciclopedia financiera. Explica la estrategia Barbell de Nassim Taleb: combinar activos muy seguros con apuestas de alto potencial, eliminar el riesgo medio, su aplicación a portafolios de inversión, carreras profesionales y cómo protege de cisnes negros." },
  { id: "rotacion",   category: "strategies", emoji: "🔄", title: "Rotación Sectorial",     prompt: "Eres una enciclopedia financiera. Explica la rotación sectorial: cómo los sectores se comportan en distintas fases del ciclo económico (expansión: tech/consumo; recesión: utilities/salud), cómo implementarla con ETFs sectoriales y por qué el timing es tan difícil." },
  { id: "canslim",    category: "strategies", emoji: "📋", title: "CAN SLIM",               prompt: "Eres una enciclopedia financiera. Explica el método CAN SLIM de William O'Neil: cada letra (Current earnings, Annual earnings, New product, Supply/demand, Leader, Institutional sponsorship, Market direction), resultados históricos y cómo aplicarlo en la práctica." },
  { id: "arbitrage",  category: "strategies", emoji: "♻️", title: "Arbitraje",              prompt: "Eres una enciclopedia financiera. Explica el arbitraje: definición pura (riesgo-free profit), tipos (merger arbitrage, statistical arbitrage, convertible arbitrage), por qué es casi imposible para retail, el papel que juega en la eficiencia del mercado y riesgos del 'arbitraje' con riesgo." },

  // ── PSICOLOGÍA NUEVOS ────────────────────────────────────────────────────
  { id: "overconf",   category: "psychology", emoji: "🦚", title: "Exceso de Confianza",    prompt: "Eres una enciclopedia financiera. Explica el exceso de confianza (overconfidence bias) en inversiones: la evidencia (los hombres operan más y ganan menos), el efecto Dunning-Kruger en finanzas, cómo nos lleva a operar en exceso y estrategias para contrarrestarlo." },
  { id: "disposition",category: "psychology", emoji: "✂️", title: "Efecto de Disposición",  prompt: "Eres una enciclopedia financiera. Explica el efecto de disposición: por qué vendemos los ganadores demasiado pronto y aguantamos los perdedores demasiado tiempo, su base en la teoría prospectiva de Kahneman, el costo real en rendimiento y cómo las reglas mecánicas ayudan a combatirlo." },
  { id: "recency_b",  category: "psychology", emoji: "🔙", title: "Sesgo de Recency",       prompt: "Eres una enciclopedia financiera. Explica el sesgo de recency en inversiones: por qué sobrestimamos lo reciente, cómo lleva a perseguir rendimientos pasados (comprar alto, vender bajo), el fenómeno de flujos hacia los fondos con mejor performance del año pasado y cómo combatirlo." },
  { id: "mental_a",   category: "psychology", emoji: "🗂️", title: "Contabilidad Mental",    prompt: "Eres una enciclopedia financiera. Explica la contabilidad mental de Richard Thaler: por qué tratamos el dinero de formas distintas según su origen, el problema de las 'ganancias de la casa' en el casino, cómo afecta la gestión del portafolio y su impacto en las decisiones de venta." },
  { id: "paralysis",  category: "psychology", emoji: "🧊", title: "Parálisis por Análisis",  prompt: "Eres una enciclopedia financiera. Explica la parálisis por análisis en inversiones: por qué más información no siempre lleva a mejores decisiones, la paradoja de la elección (Schwartz), reglas para superarla y cuándo 'suficientemente bueno' es mejor que 'perfecto'." },
  { id: "gamblers_f", category: "psychology", emoji: "🎲", title: "Falacia del Jugador",    prompt: "Eres una enciclopedia financiera. Explica la falacia del jugador (gambler's fallacy) en inversiones: por qué creer que tras 10 días de caída 'toca subir' es erróneo, la independencia de eventos, el hot hand fallacy (su opuesto) y cómo ambas falacias afectan las decisiones de trading." },
  { id: "hindsight",  category: "psychology", emoji: "🔮", title: "Sesgo de Retrospectiva", prompt: "Eres una enciclopedia financiera. Explica el sesgo de retrospectiva (hindsight bias): por qué después de cada crash creemos que era predecible, cómo distorsiona el aprendizaje de errores, su efecto en evaluar gestores de fondos y cómo mantener un diario de inversión para combatirlo." },

  // ── MACROECONOMÍA (nueva categoría) ────────────────────────────────────
  { id: "fed",        category: "macro",      emoji: "🏛️", title: "Reserva Federal (Fed)",  prompt: "Eres una enciclopedia financiera. Explica la Reserva Federal: su mandato dual (empleo máximo + estabilidad de precios), el FOMC, cómo las decisiones de tasas afectan a acciones/bonos/forex, el 'Fed put', quantitative easing/tightening y por qué todos miran tanto a la Fed." },
  { id: "monetary_p", category: "macro",      emoji: "💴", title: "Política Monetaria",     prompt: "Eres una enciclopedia financiera. Explica la política monetaria: herramientas (tasas de interés, reservas bancarias, operaciones de mercado abierto), política expansiva vs contractiva, sus canales de transmisión a la economía real y sus rezagos (típicamente 12-18 meses)." },
  { id: "fiscal_p",   category: "macro",      emoji: "🏗️", title: "Política Fiscal",        prompt: "Eres una enciclopedia financiera. Explica la política fiscal: gasto público e impuestos como herramientas, el multiplicador fiscal, el déficit fiscal y su financiamiento, la diferencia entre deuda sostenible e insostenible y la interacción con la política monetaria." },
  { id: "yield_c",    category: "macro",      emoji: "📐", title: "Curva de Rendimientos",  prompt: "Eres una enciclopedia financiera. Explica la yield curve: qué es, la curva normal vs invertida (cada vez que se invierte predice recesión), qué es el spread 10y-2y, por qué la inversión ocurre y cómo los inversores deben posicionarse cuando se invierte." },
  { id: "qe",         category: "macro",      emoji: "🖨️", title: "Quantitative Easing (QE)", prompt: "Eres una enciclopedia financiera. Explica el QE (Quantitative Easing) y QT (Tightening): cómo la Fed expande/contrae su balance, el efecto en tasas de largo plazo y activos de riesgo, por qué el mercado alcista 2009-2021 coincidió con QE masivo y las consecuencias inflacionarias." },
  { id: "cape_sh",    category: "macro",      emoji: "🔭", title: "CAPE / Shiller P/E",     prompt: "Eres una enciclopedia financiera. Explica el CAPE Ratio (Cyclically Adjusted P/E) de Robert Shiller: por qué usar 10 años de ganancias promedio, su historial como predictor de rendimientos a largo plazo, niveles actuales vs históricos y por qué no es útil para market timing de corto plazo." },
  { id: "pib",        category: "macro",      emoji: "🌍", title: "PIB / GDP",               prompt: "Eres una enciclopedia financiera. Explica el PIB (Producto Interno Bruto): cómo se mide, PIB nominal vs real, sus componentes (consumo, inversión, gasto gobierno, exportaciones netas), el PIB per cápita y por qué el crecimiento del PIB no equivale a retornos bursátiles." },
  { id: "stagflation",category: "macro",      emoji: "😬", title: "Stagflación",            prompt: "Eres una enciclopedia financiera. Explica la stagflación: inflación alta + recesión simultáneas, el episodio de los 70s en EEUU, por qué es el peor escenario para los bancos centrales (trade-off imposible), activos que se comportan bien en stagflación (oro, commodities, TIPS) y si podría repetirse." },
  { id: "eco_cycle",  category: "macro",      emoji: "🔄", title: "Ciclo Económico",        prompt: "Eres una enciclopedia financiera. Explica el ciclo económico: las 4 fases (expansión, pico, contracción, recuperación), indicadores líderes vs rezagados, la duración histórica de cada fase, sectores que outperforman en cada fase y los modelos de Dalio sobre debt cycles." },
  { id: "balanza",    category: "macro",      emoji: "⚖️", title: "Balanza Comercial",      prompt: "Eres una enciclopedia financiera. Explica la balanza comercial: superávit vs déficit, su relación con el tipo de cambio, por qué EEUU puede tener déficit masivo indefinidamente (petrodólar/dólar de reserva) y cómo los aranceles afectan las cadenas de suministro globales." },
  { id: "inflacion_m",category: "macro",      emoji: "🔺", title: "Inflación vs Deflación", prompt: "Eres una enciclopedia financiera. Explica inflación y deflación a fondo: tipos de inflación (demand-pull, cost-push), la trampa deflacionaria (Japan), hiperinflación histórica (Venezuela, Zimbabwe, Weimar), activos ganadores en cada escenario y cómo medir la inflación real vs oficial." },

  // ── MERCADOS NUEVOS ───────────────────────────────────────────────────────
  { id: "emergentes", category: "markets",    emoji: "🌱", title: "Mercados Emergentes",    prompt: "Eres una enciclopedia financiera. Explica los mercados emergentes (EM): países incluidos (BRICS+, México, Vietnam...), por qué históricamente han underperformado al S&P en los últimos 15 años a pesar del crecimiento económico, los riesgos específicos (política, divisa, liquidez) y cómo acceder vía ETFs (EEM, VWO)." },
  { id: "margin_c",   category: "markets",    emoji: "📞", title: "Margin Call",             prompt: "Eres una enciclopedia financiera. Explica el margin call: qué es, cómo ocurre (caída del valor de garantías), el efecto cascada en mercados (forced selling), el margin call que llevó a la quiebra de Archegos en 2021 y cómo evitar estar expuesto a ellos." },
  { id: "short_sq",   category: "markets",    emoji: "🎮", title: "Short Squeeze",          prompt: "Eres una enciclopedia financiera. Explica el short squeeze: cómo ocurre mecánicamente, el caso de GameStop/AMC en 2021, cómo WallStreetBets lo orquestó, las condiciones previas que lo hacen posible (alto short interest + alto borrowing cost) y el riesgo para los shorts." },
  { id: "black_sw",   category: "markets",    emoji: "🦢", title: "Cisne Negro (Black Swan)", prompt: "Eres una enciclopedia financiera. Explica el concepto de Cisne Negro de Nassim Taleb: eventos de baja probabilidad y alto impacto, por qué los modelos de riesgo estándar no los capturan, cómo construir un portafolio 'antifragil', la diferencia entre incertidumbre calculable y verdadera y ejemplos históricos." },
  { id: "timing_m",   category: "markets",    emoji: "⏱️", title: "Market Timing",          prompt: "Eres una enciclopedia financiera. Explica el market timing: la evidencia aplastante de que no funciona consistentemente, estudios sobre inversores que se perdieron los mejores días, la alternativa del DCA y cómo el costo de oportunidad de 'esperar el crash' destruye rendimientos." },

  // ── MÉXICO NUEVOS ────────────────────────────────────────────────────────
  { id: "afore",      category: "mexico",     emoji: "🏦", title: "AFORE",                  prompt: "Eres una enciclopedia financiera. Explica las AFOREs en México: cómo funcionan, las SIEFORES por generación, cómo revisar el saldo, cómo cambiar de AFORE, el impacto de las comisiones en el largo plazo y por qué hacer aportaciones voluntarias puede transformar la jubilación." },
  { id: "cnbv",       category: "mexico",     emoji: "🏛️", title: "CNBV",                   prompt: "Eres una enciclopedia financiera. Explica la CNBV (Comisión Nacional Bancaria y de Valores): qué regula, cómo protege al inversionista, qué hacer si un broker tiene problemas, diferencia con CONDUSEF y IPAB, y cómo verificar que tu institución financiera esté regulada." },
  { id: "sic_mx",     category: "mexico",     emoji: "🔗", title: "Mercado SIC (México)",   prompt: "Eres una enciclopedia financiera. Explica el Sistema Internacional de Cotizaciones (SIC) de la BMV: qué son los ETFs del SIC, cómo comprar acciones extranjeras desde México sin abrir cuenta en el extranjero, las ventajas fiscales y sus limitaciones de liquidez y horarios." },
  { id: "biva",       category: "mexico",     emoji: "📊", title: "BIVA",                   prompt: "Eres una enciclopedia financiera. Explica la BIVA (Bolsa Institucional de Valores): qué es, diferencia con la BMV, qué instrumentos lista, por qué existe y cómo ha impactado en la liquidez y competencia del mercado de capitales mexicano." },
  { id: "tiie",       category: "mexico",     emoji: "💱", title: "TIIE",                   prompt: "Eres una enciclopedia financiera. Explica la TIIE (Tasa de Interés Interbancaria de Equilibrio): cómo la determina el Banxico, por qué es la tasa de referencia para créditos en México, su relación con la tasa de la Fed y cómo impacta en las decisiones de inversión en renta fija mexicana." },
  { id: "udibonos",   category: "mexico",     emoji: "🛡️", title: "Udibonos",               prompt: "Eres una enciclopedia financiera. Explica los Udibonos: bonos del gobierno mexicano indexados a la inflación (UDIs), cómo protegen el poder adquisitivo, su rendimiento real garantizado, cuándo convienen vs CETES y cómo comprarlos a través de cetesdirecto o brokers." },
  { id: "sat_inv",    category: "mexico",     emoji: "📋", title: "SAT e Inversiones",      prompt: "Eres una enciclopedia financiera. Explica las obligaciones fiscales del inversionista mexicano ante el SAT: qué se declara (dividendos, ganancias de capital, intereses), las tasas aplicables, la retención de los brokers mexicanos vs extranjeros, el FATCA y cómo no caer en problemas fiscales al invertir." },
];

const COMPANY_LOGOS: Record<string, string> = {
  nvidia:    "https://logo.clearbit.com/nvidia.com",
  apple:     "https://logo.clearbit.com/apple.com",
  amazon:    "https://logo.clearbit.com/amazon.com",
  microsoft: "https://logo.clearbit.com/microsoft.com",
  tesla:     "https://logo.clearbit.com/tesla.com",
};

export default function LearnPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { streak, completedToday, markTopicCompleted, initStreak } = useLearnStore();
  const { profile } = useProfileStore();
  const userLevel = getUserLevel(profile);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [selectedCat, setSelectedCat] = useState("all");
  const [modal, setModal] = useState<{ title: string; emoji: string } | null>(null);
  const [content, setContent] = useState("");
  const [streaming, setStreaming] = useState(false);

  useEffect(() => { initStreak(); }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return TOPICS.filter((t) => {
      const matchCat = selectedCat === "all" || t.category === selectedCat;
      const matchQ = !q || t.title.toLowerCase().includes(q) || t.category.includes(q);
      return matchCat && matchQ;
    });
  }, [search, selectedCat]);

  const openTopic = async (title: string, _prompt: string, emoji = "📚") => {
    setModal({ title, emoji });
    setContent("");
    setStreaming(true);
    markTopicCompleted();
    // Prompt flashcard: breve, estructurado, ~70 palabras → respuesta en <3 seg
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

  const handleSearch = (term?: string) => {
    const q = (term || search).trim();
    if (!q) return;
    openTopic(q, "", "🔍");
  };

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      {/* Top bar */}
      <div className="font-ui border-b flex items-center justify-between px-4 py-2 shrink-0"
           style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-1" style={{ color: "var(--muted)" }}>
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <button onClick={() => router.push("/chat")} className="flex items-center gap-2.5">
            <div className="relative">
              <Image src="/logo.png" alt="Nuvos AI" width={30} height={30} className="rounded-xl object-cover" />
            </div>
            <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvos AI</span>
          </button>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="font-semibold text-sm" style={{ color: "var(--sub)", fontFamily: "var(--font-body)" }}>Aprendizaje</span>
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: `${LEVEL_COLOR[userLevel]}15`, color: LEVEL_COLOR[userLevel] }}>
            {LEVEL_LABEL[userLevel]}
          </span>
        </div>
        <PremiumBadge />
      </div>
      <MarketTickerBar />

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Main */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <GuidedSteps currentPage="learn" />
          {/* Streak banner */}
          <div className="px-4 pt-3 pb-1 shrink-0">
            <div className="flex items-center rounded-xl border px-3 py-2.5"
                 style={{ background: "var(--card)", borderColor: completedToday ? "rgba(34,197,94,0.4)" : "var(--border)" }}>
              <div className="flex items-center gap-2">
                <span className="text-xl">{completedToday ? "🔥" : "🌑"}</span>
                <div>
                  <span className="text-sm font-bold" style={{ color: completedToday ? "#f59e0b" : "var(--muted)" }}>
                    {streak} {streak === 1 ? "día" : "días"} de racha
                  </span>
                  <p className="text-[10px]" style={{ color: "var(--dim)" }}>
                    {completedToday ? "¡Racha activa hoy!" : "Lee un tema para mantener tu racha"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Search bar */}
          <div className="px-4 pt-2 pb-2 shrink-0">
            <div className="flex items-center gap-2 rounded-xl border px-3 py-2.5"
                 style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <Search className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: "var(--text)" }}
                placeholder="Busca cualquier tema financiero..."
              />
              {search.trim() && (
                <button onClick={() => handleSearch()}
                        className="text-xs font-bold px-2.5 py-1 rounded-lg text-white"
                        style={{ background: "var(--accent)" }}>
                  Preguntar
                </button>
              )}
            </div>
          </div>

          {/* Category chips */}
          <div className="flex gap-2 px-4 pb-3 overflow-x-auto scrollbar-none shrink-0">
            {CATEGORIES.map((cat) => {
              const active = selectedCat === cat.id;
              return (
                <button key={cat.id}
                        onClick={() => setSelectedCat(cat.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold shrink-0 transition-all"
                        style={{
                          borderColor: active ? "var(--accent-l)" : "var(--border)",
                          background: active ? "rgba(0,212,126,0.1)" : "var(--card)",
                          color: active ? "var(--accent-l)" : "var(--sub)",
                        }}>
                  <span>{cat.emoji}</span>
                  <span>{cat.title}</span>
                </button>
              );
            })}
          </div>

          {/* Topic grid */}
          <div className="flex-1 overflow-y-auto scrollbar-thin px-4 pb-8">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {filtered.map((topic) => {
                const catLabel = CATEGORIES.find((c) => c.id === topic.category)?.title ?? "";
                const logoUrl = COMPANY_LOGOS[topic.id];
                const topicLevel = CATEGORY_LEVEL[topic.category] ?? "intermedio";
                const isMyLevel = topicLevel === userLevel;
                const tc = LEVEL_COLOR[topicLevel];
                return (
                  <button key={topic.id}
                          onClick={() => openTopic(topic.title, topic.prompt, topic.emoji)}
                          className="text-left p-3 rounded-2xl border transition-all hover:border-[#00d47e]/40 hover:bg-[#00d47e]/5 relative"
                          style={{ background: "var(--card)", borderColor: isMyLevel ? `${tc}40` : "var(--border)" }}>
                    {isMyLevel && (
                      <div className="absolute top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                           style={{ background: `${tc}20`, color: tc }}>
                        Para ti
                      </div>
                    )}
                    {logoUrl ? (
                      <img src={logoUrl} alt={topic.title}
                           className="w-9 h-9 rounded-xl object-contain mb-2"
                           onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg mb-2"
                           style={{ background: "rgba(0,212,126,0.1)" }}>
                        {topic.emoji}
                      </div>
                    )}
                    <p className="text-xs font-bold leading-tight mb-1" style={{ color: "var(--text)" }}>
                      {topic.title}
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
                            style={{ background: "var(--border)", color: "var(--muted)" }}>
                        {catLabel}
                      </span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ background: `${tc}15`, color: tc }}>
                        {LEVEL_LABEL[topicLevel]}
                      </span>
                    </div>
                  </button>
                );
              })}

              {/* Tarjeta dinámica: buscar CUALQUIER término con IA */}
              {search.trim().length >= 1 && (
                <button
                  onClick={() => handleSearch()}
                  className="text-left p-3 rounded-2xl border-2 border-dashed transition-all hover:border-solid"
                  style={{ borderColor: "var(--accent-l)", background: "rgba(0,212,126,0.04)" }}>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg mb-2"
                       style={{ background: "rgba(0,212,126,0.15)" }}>
                    🔍
                  </div>
                  <p className="text-xs font-bold leading-tight mb-1" style={{ color: "var(--accent-l)" }}>
                    "{search.trim()}"
                  </p>
                  <span className="text-[9px] font-semibold" style={{ color: "var(--muted)" }}>
                    Explicar con IA →
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* ── Sesión 1:1 CTA ── */}
          <div className="px-4 pb-6 pt-2">
            <a href="https://calendly.com/diego-arria19/sesion-1-1-con-diego-nuvos-ai" target="_blank" rel="noopener noreferrer"
               className="flex items-center gap-4 rounded-2xl p-4 hover:opacity-90 transition-opacity"
               style={{ background: "var(--card)", border: "1px solid rgba(0,168,94,0.3)" }}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                   style={{ background: "rgba(0,168,94,0.12)" }}>
                <Calendar className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold leading-tight" style={{ color: "var(--text)" }}>
                  ¿Prefieres aprender con alguien?
                </p>
                <p className="text-xs mt-0.5 leading-snug" style={{ color: "var(--muted)" }}>
                  Agenda una sesión 1:1 con Diego — 45 min para guiarte por la app y crear tu plan de inversión.
                </p>
              </div>
              <div className="shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap"
                   style={{ background: "rgba(0,168,94,0.12)", color: "var(--accent-l)" }}>
                45 min →
              </div>
            </a>
          </div>
        </main>
      </div>

      {/* Flashcard modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
             onClick={() => !streaming && setModal(null)}>
          <div className="w-full max-w-md rounded-3xl overflow-hidden"
               style={{ background: "var(--card)", border: "1px solid var(--border)" }}
               onClick={(e) => e.stopPropagation()}>

            {/* Color strip */}
            <div className="h-1" style={{ background: "var(--grad-green)" }} />

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b"
                 style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">{modal.emoji}</span>
                <span className="font-extrabold text-base" style={{ color: "var(--text)" }}>{modal.title}</span>
              </div>
              <button onClick={() => setModal(null)} style={{ color: "var(--muted)" }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="px-5 py-5 min-h-[180px]">
              {!content ? (
                <div className="flex flex-col items-center justify-center h-36 gap-3">
                  <div className="w-7 h-7 border-2 rounded-full animate-spin"
                       style={{ borderColor: "rgba(0,212,126,0.2)", borderTopColor: "#00d47e" }} />
                  <p className="text-xs" style={{ color: "var(--muted)" }}>Preparando flashcard... ~2 seg</p>
                </div>
              ) : (
                <div className="learn-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                  {streaming && <span style={{ color: "#22c55e" }}>▋</span>}
                </div>
              )}
            </div>

            {/* Action */}
            {!streaming && content && (
              <div className="px-5 pb-5">
                <button onClick={() => setModal(null)}
                        className="w-full py-2.5 rounded-2xl text-sm font-bold text-white"
                        style={{ background: "var(--grad-green)" }}>
                  Entendido ✓
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        .learn-markdown { color: var(--sub); font-size: 14px; line-height: 1.65; }
        .learn-markdown p { margin: 6px 0; }
        .learn-markdown strong { color: var(--text); font-weight: 800; font-size: 15px; }
        .learn-markdown em { color: var(--accent-l); font-style: normal; font-weight: 600; }
        .learn-markdown ul { margin: 8px 0; padding-left: 18px; }
        .learn-markdown li { margin: 4px 0; color: var(--sub); }
        .learn-markdown li::marker { color: var(--accent-l); }
      `}</style>
    </div>
  );
}
