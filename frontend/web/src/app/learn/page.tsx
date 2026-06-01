"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chat as chatApi, notifications as notifApi } from "@/lib/api";
import { useAuthStore, useProfileStore, useNotificationStore, useLearnStore } from "@/lib/store";
import {
  TrendingUp, Search, BookOpen, PieChart, BarChart2, Bell, User,
  Menu, X, GraduationCap, Loader2, Trophy, Compass,
} from "lucide-react";

const NAV = [
  { href: "/chat",          icon: BookOpen,      label: "Chat" },
  { href: "/portfolio",     icon: PieChart,      label: "Portafolio" },
  { href: "/paper",         icon: BarChart2,     label: "Paper Trading" },
  { href: "/learn",         icon: GraduationCap, label: "Aprendizaje" },
  { href: "/arena",         icon: Trophy,        label: "Arena" },
  { href: "/explore",       icon: Compass,     label: "Explorar" },
  { href: "/notifications", icon: Bell,          label: "Notificaciones" },
  { href: "/profile",       icon: User,          label: "Perfil" },
];

const CATEGORIES = [
  { id: "all",         emoji: "🗂️",  title: "Todo" },
  { id: "basics",      emoji: "📚",  title: "Básicos" },
  { id: "instruments", emoji: "🏦",  title: "Instrumentos" },
  { id: "analysis",    emoji: "📊",  title: "Análisis" },
  { id: "strategies",  emoji: "🎯",  title: "Estrategias" },
  { id: "psychology",  emoji: "🧠",  title: "Psicología" },
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
  const pathname = usePathname();
  const { isAuthenticated } = useAuthStore();
  const { notifications } = useNotificationStore();
  const { streak, completedToday, markTopicCompleted, initStreak } = useLearnStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const [search, setSearch] = useState("");
  const [selectedCat, setSelectedCat] = useState("all");
  const [modal, setModal] = useState<{ title: string; prompt: string } | null>(null);
  const [content, setContent] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!isAuthenticated) router.push("/"); }, [isAuthenticated]);
  useEffect(() => { initStreak(); }, []);

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
    markTopicCompleted();
    let full = "";
    await chatApi.stream(
      prompt,
      [],
      (chunk) => { full += chunk; setContent(full); },
      () => setStreaming(false)
    );
  };

  const handleSearch = () => {
    if (!search.trim()) return;
    openTopic(
      search.trim(),
      `Explícame de forma educativa y detallada sobre: "${search.trim()}". Estructura la respuesta con secciones claras, ejemplos concretos y analogías cuando sea útil.`
    );
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content]);

  if (!isAuthenticated) return null;

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      {/* Top bar */}
      <div className="border-b flex items-center justify-between px-4 py-2 shrink-0"
           style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-1" style={{ color: "var(--muted)" }}>
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "var(--accent)" }}>
              <TrendingUp className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvo</span>
          </div>
        </div>
        <span className="font-semibold text-sm" style={{ color: "var(--sub)" }}>Aprendizaje</span>
        <div className="w-8" />
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <aside className={`${sidebarOpen ? "flex" : "hidden"} lg:flex w-60 border-r flex-col py-4 absolute lg:relative z-20 h-full`}
               style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <nav className="flex-1 px-2 space-y-0.5">
            {NAV.map(({ href, icon: Icon, label }) => {
              const active = pathname === href;
              const badge = href === "/notifications" && unreadCount > 0;
              return (
                <button key={href} onClick={() => { router.push(href); setSidebarOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors"
                        style={{ background: active ? "rgba(0,168,94,0.12)" : "transparent", color: active ? "var(--accent-l)" : "var(--muted)" }}>
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{label}</span>
                  {badge && <span className="ml-auto w-4 h-4 rounded-full text-white text-[10px] flex items-center justify-center font-bold" style={{ background: "var(--accent)" }}>{unreadCount}</span>}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Streak banner */}
          <div className="px-4 pt-3 pb-1 shrink-0">
            <div className="flex items-center justify-between rounded-xl border px-3 py-2.5 cursor-pointer hover:opacity-80 transition-opacity"
                 style={{ background: "var(--card)", borderColor: completedToday ? "rgba(34,197,94,0.4)" : "var(--border)" }}
                 onClick={() => router.push("/arena")}>
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
              <div className="flex items-center gap-1 text-xs font-semibold" style={{ color: "var(--accent-l)" }}>
                <Trophy className="w-3.5 h-3.5" />
                Arena
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
                <button onClick={handleSearch}
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
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <span className="text-4xl">❓</span>
                <p className="font-bold text-sm" style={{ color: "var(--text)" }}>No encontré ese tema</p>
                <p className="text-xs text-center" style={{ color: "var(--muted)" }}>
                  Toca "Preguntar" para que la IA te explique cualquier concepto
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {filtered.map((topic) => {
                  const catLabel = CATEGORIES.find((c) => c.id === topic.category)?.title ?? "";
                  const logoUrl = COMPANY_LOGOS[topic.id];
                  return (
                    <button key={topic.id}
                            onClick={() => openTopic(topic.title, topic.prompt)}
                            className="text-left p-3 rounded-2xl border transition-all hover:border-[#00d47e]/40 hover:bg-[#00d47e]/5"
                            style={{ background: "var(--card)", borderColor: "var(--border)" }}>
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
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
                            style={{ background: "var(--border)", color: "var(--muted)" }}>
                        {catLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "var(--bg)" }}>
          {/* Modal header */}
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0"
               style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <button onClick={() => setModal(null)}
                    className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ color: "var(--muted)" }}>
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-sm font-bold flex-1 text-center" style={{ color: "var(--text)" }}>
              {modal.title}
            </h2>
            <div className="w-8" />
          </div>

          {/* Modal content */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin px-5 py-6">
            {!content ? (
              <div className="flex flex-col items-center justify-center h-40 gap-3">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent-l)" }} />
                <p className="text-sm" style={{ color: "var(--muted)" }}>La IA está preparando la explicación...</p>
              </div>
            ) : (
              <div className="prose prose-sm max-w-none learn-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                {streaming && <span className="text-[#22c55e] text-base">▋</span>}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        .learn-markdown { color: var(--sub); font-size: 15px; line-height: 1.7; }
        .learn-markdown h1 { color: var(--text); font-size: 21px; font-weight: 800; letter-spacing: -0.4px; margin-top: 18px; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1.5px solid var(--accent-l); }
        .learn-markdown h2 { color: var(--text); font-size: 17px; font-weight: 700; letter-spacing: -0.2px; margin-top: 16px; margin-bottom: 6px; }
        .learn-markdown h3 { color: var(--accent-l); font-size: 13px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; margin-top: 12px; margin-bottom: 5px; }
        .learn-markdown strong { color: var(--text); font-weight: 700; }
        .learn-markdown em { color: var(--accent-l); font-style: italic; }
        .learn-markdown code { background: rgba(0,212,126,0.1); color: var(--accent-l); border-radius: 5px; padding: 1px 5px; font-size: 13px; font-weight: 600; }
        .learn-markdown pre { background: var(--card); border-radius: 12px; padding: 14px; margin: 8px 0; border: 1px solid var(--border); }
        .learn-markdown blockquote { border-left: 3px solid var(--accent-l); background: rgba(0,212,126,0.05); padding-left: 12px; padding-top: 8px; padding-bottom: 8px; margin: 8px 0; border-radius: 0 4px 4px 0; }
        .learn-markdown table { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; margin: 8px 0; width: 100%; border-collapse: collapse; }
        .learn-markdown th { background: rgba(0,168,94,0.2); color: var(--accent-l); font-weight: 700; padding: 9px; font-size: 12px; letter-spacing: 0.4px; text-align: left; }
        .learn-markdown td { color: var(--sub); padding: 9px; font-size: 13px; border-top: 1px solid var(--border); }
        .learn-markdown hr { border-color: var(--border); margin: 14px 0; }
        .learn-markdown a { color: var(--accent-l); text-decoration: underline; }
        .learn-markdown ul, .learn-markdown ol { margin: 6px 0; padding-left: 20px; }
        .learn-markdown li { margin: 3px 0; }
      `}</style>
    </div>
  );
}
