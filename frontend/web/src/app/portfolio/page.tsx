"use client";

import AppSidebar from "@/components/AppSidebar";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { market as marketApi, paperApi } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { usePortfolioStore, type Position } from "@/lib/portfolioStore";
import {
  PieChart, Menu, X, Upload, Plus, Trash2, Trophy,
  BarChart, Calculator, Shield, Sparkles, RefreshCw, AlertTriangle, Lightbulb,
} from "lucide-react";

// ─── Liga data ─────────────────────────────────────────────────────────────

interface LeagueEntry {
  rank: number; alias: string; returnPct: number;
  topHolding: string; rankChange: number; isMe?: boolean;
}

const MOCK_LEAGUE_OTHERS = [
  { alias: "InversorPro",    returnPct: 18.4, topHolding: "NVDA",  rankChange:  0 },
  { alias: "TauroMX",        returnPct: 14.2, topHolding: "AAPL",  rankChange:  2 },
  { alias: "BullMkt99",      returnPct: 11.8, topHolding: "MSFT",  rankChange: -1 },
  { alias: "WallStLearner",  returnPct:  9.3, topHolding: "TSLA",  rankChange:  1 },
  { alias: "PipoCapital",    returnPct:  7.1, topHolding: "AMZN",  rankChange:  3 },
  { alias: "Sigma_Returns",  returnPct:  5.8, topHolding: "GOOGL", rankChange:  0 },
  { alias: "CrackMercado",   returnPct:  4.6, topHolding: "META",  rankChange: -2 },
  { alias: "PatternBreaker", returnPct:  2.1, topHolding: "BRK-B", rankChange:  0 },
  { alias: "ETFQueen",       returnPct:  1.4, topHolding: "SPY",   rankChange:  4 },
  { alias: "LongTermLeo",    returnPct: -0.8, topHolding: "BABA",  rankChange: -3 },
];

const LEAGUE_LESSONS: Record<"week" | "month" | "all", string> = {
  week:  "Los líderes concentraron en semiconductores (NVDA, AMD +8.2% esta semana). Apostar a un sector en tendencia clara pagó.",
  month: "Los portfolios top mantuvieron Big Tech (MSFT, AAPL, META) sin rotar. Paciencia > timing de mercado.",
  all:   "Los mejores inversores balancearon crecimiento y dividendos. La consistencia supera al timing.",
};

const LEAGUE_MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };
const LEAGUE_TOTAL = 847;

function LeaderRow({ entry }: { entry: LeagueEntry }) {
  const medal = LEAGUE_MEDALS[entry.rank];
  const up = entry.returnPct >= 0;
  return (
    <div className="flex items-center px-4 py-3 border-t"
         style={{ borderColor: "var(--border)", background: entry.isMe ? "rgba(0,168,94,0.07)" : entry.rank === 1 ? "rgba(251,191,36,0.03)" : "transparent" }}>
      <div className="w-8 shrink-0 text-center">
        {medal
          ? <span className="text-base leading-none">{medal}</span>
          : <span className="text-xs font-bold" style={{ color: "var(--dim)" }}>#{entry.rank}</span>}
      </div>
      <div className="w-7 h-7 rounded-full flex items-center justify-center mx-2.5 text-[11px] font-black shrink-0"
           style={{ background: entry.isMe ? "var(--accent)" : entry.rank <= 3 ? "rgba(251,191,36,0.18)" : "var(--raised)", color: entry.isMe ? "white" : entry.rank <= 3 ? "#fbbf24" : "var(--muted)" }}>
        {entry.alias[0].toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold truncate" style={{ color: entry.isMe ? "var(--accent-l)" : "var(--text)" }}>
            {entry.isMe ? "Tú" : entry.alias}
          </span>
          {entry.isMe && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold shrink-0"
                  style={{ background: "rgba(0,168,94,0.15)", color: "var(--accent-l)" }}>★</span>
          )}
        </div>
        <div className="text-[11px]" style={{ color: "var(--dim)" }}>Top: {entry.topHolding}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-bold" style={{ color: up ? "var(--up)" : "var(--down)" }}>
          {up ? "+" : ""}{entry.returnPct.toFixed(1)}%
        </div>
        <div className="text-[11px] font-semibold"
             style={{ color: entry.rankChange > 0 ? "var(--up)" : entry.rankChange < 0 ? "var(--down)" : "var(--dim)" }}>
          {entry.rankChange > 0 ? `↑${entry.rankChange}` : entry.rankChange < 0 ? `↓${Math.abs(entry.rankChange)}` : "—"}
        </div>
      </div>
    </div>
  );
}

// ─── Stress Test data ──────────────────────────────────────────────────────

const TICKER_SECTOR: Record<string, string> = {
  AAPL:"Tech",MSFT:"Tech",GOOGL:"Tech",GOOG:"Tech",AMZN:"Tech",META:"Tech",
  NVDA:"Tech",TSLA:"Tech",AMD:"Tech",INTC:"Tech",CRM:"Tech",ADBE:"Tech",
  PYPL:"Tech",NFLX:"Tech",UBER:"Tech",SNAP:"Tech",SPOT:"Tech",ORCL:"Tech",
  JPM:"Finance",BAC:"Finance",GS:"Finance",MS:"Finance",WFC:"Finance",
  C:"Finance",V:"Finance",MA:"Finance",AXP:"Finance",
  JNJ:"Salud",PFE:"Salud",UNH:"Salud",ABBV:"Salud",MRK:"Salud",LLY:"Salud",AMGN:"Salud",
  WMT:"Consumo",KO:"Consumo",PG:"Consumo",MCD:"Consumo",NKE:"Consumo",
  SBUX:"Consumo",COST:"Consumo",TGT:"Consumo",HD:"Consumo",
  XOM:"Energía",CVX:"Energía",COP:"Energía",OXY:"Energía",SLB:"Energía",
  SPY:"ETF",QQQ:"ETF",VTI:"ETF",IVV:"ETF",VOO:"ETF",IWM:"ETF",GLD:"ETF",
};

const TICKER_RISK_OVERRIDE: Record<string, number> = {
  GME:96,AMC:96,MSTR:92,COIN:91,RIVN:88,LCID:88,
  TSLA:84,PLTR:82,SNAP:82,SPOT:80,RBLX:80,HOOD:82,SOFI:78,
  NVDA:77,AMD:76,SHOP:74,SQ:75,META:70,NFLX:70,UBER:72,
  AAPL:60,MSFT:58,GOOGL:60,AMZN:63,ORCL:55,
  JPM:48,BAC:50,GS:55,V:45,MA:45,AXP:50,
  JNJ:28,PFE:35,UNH:32,ABBV:38,LLY:42,AMGN:36,
  WMT:22,KO:18,PG:18,MCD:25,COST:30,SBUX:35,
  XOM:48,CVX:48,COP:55,OXY:58,
  SPY:20,VOO:20,VTI:20,IVV:20,QQQ:38,IWM:45,GLD:30,
};
const SECTOR_RISK_BASE: Record<string, number> = {
  ETF:22,Salud:35,Consumo:38,Finance:52,Energía:58,Tech:72,
};

const PORTFOLIO_LEVELS = [
  { label:"Conservador",           min:0,  max:13,  color:"#3b82f6" },
  { label:"Conservador-Moderado",  min:13, max:25,  color:"#60a5fa" },
  { label:"Moderado",              min:25, max:38,  color:"#f59e0b" },
  { label:"Moderado-Growth",       min:38, max:51,  color:"#f97316" },
  { label:"Growth",                min:51, max:63,  color:"#fb923c" },
  { label:"Agresivo",              min:63, max:75,  color:"#ef4444" },
  { label:"Agresivo-Especulativo", min:75, max:88,  color:"#dc2626" },
  { label:"Especulativo",          min:88, max:101, color:"#7f1d1d" },
];

const STRESS_SCENARIOS = [
  { id:"2008",    name:"Crisis 2008",    icon:"🏦", color:"#ef4444", year:"2008-09",    desc:"Colapso del sistema financiero global",
    drawdowns:{Tech:-52,Finance:-78,Salud:-18,Consumo:-28,Energía:-55,ETF:-38}, default:-42 },
  { id:"covid",   name:"COVID-19",       icon:"🦠", color:"#f97316", year:"Feb-Mar 2020", desc:"Crash de 33 días, caída brusca y rápida",
    drawdowns:{Tech:-34,Finance:-45,Salud:-15,Consumo:-42,Energía:-60,ETF:-34}, default:-34 },
  { id:"tech2022",name:"Tech Crash '22", icon:"📉", color:"#f59e0b", year:"2022",        desc:"Alza de tasas aplasta valuaciones tech",
    drawdowns:{Tech:-55,Finance:-22,Salud:-10,Consumo:-15,Energía:40,ETF:-18},  default:-20 },
  { id:"fed",     name:"Fed +1%",        icon:"🏛️", color:"#6366f1", year:"Escenario",   desc:"Subida sorpresiva de 100pb en tasas",
    drawdowns:{Tech:-20,Finance:5,Salud:-8,Consumo:-10,Energía:-5,ETF:-12},     default:-12 },
  { id:"bull",    name:"Bull Market",    icon:"🚀", color:"#22c55e", year:"Escenario",   desc:"Año de recuperación y euforia inversora",
    drawdowns:{Tech:35,Finance:25,Salud:20,Consumo:18,Energía:22,ETF:24},       default:22  },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const neg = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${neg}$${(abs/1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${neg}$${(abs/1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${neg}$${(abs/1e3).toFixed(2)}K`;
  return `${neg}$${abs.toLocaleString("en-US",{maximumFractionDigits:0})}`;
}

function getPositionRisk(ticker: string): number {
  if (TICKER_RISK_OVERRIDE[ticker] !== undefined) return TICKER_RISK_OVERRIDE[ticker];
  const sector = TICKER_SECTOR[ticker];
  return sector ? (SECTOR_RISK_BASE[sector] ?? 62) : 62;
}

interface PriceData { price: number | null; currency: string; name: string }

function scorePortfolio(positions: Position[], pricesData: Record<string, PriceData>) {
  if (!positions.length) return { score:0, levelIdx:0, sectorPcts:{} };
  let totalVal=0, weightedRisk=0;
  const sectorVals: Record<string,number> = {};
  for (const pos of positions) {
    const price = pricesData[pos.ticker]?.price ?? pos.avgPrice;
    const val = pos.shares * price;
    totalVal += val;
    weightedRisk += getPositionRisk(pos.ticker) * val;
    const sector = TICKER_SECTOR[pos.ticker] ?? "Otro";
    sectorVals[sector] = (sectorVals[sector]??0) + val;
  }
  if (totalVal === 0) return { score:0, levelIdx:0, sectorPcts:{} };
  let score = weightedRisk / totalVal;
  const topVal = Math.max(...positions.map((p) => p.shares * (pricesData[p.ticker]?.price ?? p.avgPrice)));
  const topPct = topVal / totalVal;
  if (topPct > 0.4) score = Math.min(100, score + (topPct-0.4)*20);
  if (positions.length >= 10) score = Math.max(0, score - 4);
  score = Math.round(Math.min(100, Math.max(0, score)));
  const idx = PORTFOLIO_LEVELS.findIndex((l) => score >= l.min && score < l.max);
  const sectorPcts: Record<string,number> = {};
  for (const [s,v] of Object.entries(sectorVals)) sectorPcts[s] = Math.round((v/totalVal)*100);
  return { score, levelIdx: idx===-1?7:idx, sectorPcts };
}


type Scenario = "conservative"|"moderate"|"aggressive";
const SCENARIOS: {value:Scenario; label:string; emoji:string}[] = [
  { value:"conservative", label:"Conservador", emoji:"🛡️" },
  { value:"moderate",     label:"Moderado",    emoji:"⚖️" },
  { value:"aggressive",   label:"Agresivo",    emoji:"🚀" },
];

// ─── Component ─────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { positions, addPosition, removePosition, setPositions } = usePortfolioStore();
  const [sidebarOpen, setSidebarOpen]   = useState(false);
  const [activeTab, setActiveTab]       = useState<"portfolio" | "liga">("portfolio");
  const [leaguePeriod, setLeaguePeriod] = useState<"week" | "month" | "all">("week");
  const [leagueData, setLeagueData]     = useState<LeagueEntry[]>([]);
  const [leagueLoading, setLeagueLoading] = useState(false);

  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [loadingPrices, setLoadingPrices] = useState(false);

  // Screenshot import
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const [screenshotAnalyzing, setScreenshotAnalyzing] = useState(false);
  const [screenshotProgress, setScreenshotProgress] = useState("");
  type ExtractedPos = { id: string; ticker: string; name: string; shares: number; avg_price: number };
  const [screenshotPreview, setScreenshotPreview] = useState<ExtractedPos[]|null>(null);

  // Manual form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ticker:"", shares:"", avgPrice:"" });
  const [addingLoading, setAddingLoading] = useState(false);

  // Currency modal (shown after screenshot or Excel import)
  type PendingImport = { ticker: string; name?: string; shares: number; avgPrice: number }[];
  const [pendingImport, setPendingImport] = useState<PendingImport|null>(null);
  const [importCurrency, setImportCurrency] = useState("USD");
  const [convertingCurrency, setConvertingCurrency] = useState(false);


  // Stress test
  const [stressScenario, setStressScenario] = useState<string|null>(null);
  type StressResult = { total:number; stressed:number; diff:number; pct:number; rows:{ticker:string;invested:number;stressed:number;diff:number;pct:number;sector:string}[] };
  const [stressResult, setStressResult] = useState<StressResult|null>(null);

  // AI Simulator
  const [scenario, setScenario] = useState<Scenario>("moderate");
  const [capital, setCapital] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [simLoading, setSimLoading] = useState(false);

  // Calculator
  const [calcCapital, setCalcCapital] = useState("");
  const [calcMonthly, setCalcMonthly] = useState("");
  const [calcReturn, setCalcReturn]   = useState("");
  const [calcYears, setCalcYears]     = useState("");
  type CalcResult = { final:number; invested:number; gain:number; pct:number; milestones:{year:number;value:number}[] };
  const [calcResult, setCalcResult]   = useState<CalcResult|null>(null);

  useEffect(() => { if (!isAuthenticated) router.push("/"); }, [isAuthenticated]);

  const loadLeaderboard = useCallback(async () => {
    setLeagueLoading(true);
    try {
      const res = await paperApi.getLeaderboard();
      setLeagueData(res.data as LeagueEntry[]);
    } catch {}
    setLeagueLoading(false);
  }, []);

  useEffect(() => {
    if (activeTab === "liga" && leagueData.length === 0) loadLeaderboard();
  }, [activeTab]);

  // Compute local rank from real portfolio while API loads
  const localReturnPct = useMemo(() => {
    let invested = 0, current = 0;
    for (const p of positions) {
      invested += p.shares * p.avgPrice;
      const cp = prices[p.ticker]?.price;
      current += cp ? p.shares * cp : p.shares * p.avgPrice;
    }
    if (invested <= 0) return 0;
    return parseFloat(((current - invested) / invested * 100).toFixed(1));
  }, [positions, prices]);

  const allLeagueEntries = useMemo<LeagueEntry[]>(() => {
    if (leagueData.length > 0) return leagueData;
    const me = { alias: "Tú", returnPct: localReturnPct, topHolding: positions[0]?.ticker ?? "—", rankChange: 0, isMe: true, rank: 0 };
    return [...MOCK_LEAGUE_OTHERS.map(e => ({ ...e, isMe: false })), me]
      .sort((a, b) => b.returnPct - a.returnPct)
      .map((e, i) => ({ ...e, rank: i + 1 }));
  }, [leagueData, localReturnPct, positions]);

  const myEntry      = allLeagueEntries.find(e => e.isMe)!;
  const top5         = allLeagueEntries.slice(0, 5);
  const showEllipsis = myEntry?.rank > 5;

  const fetchPrices = useCallback(async () => {
    if (!positions.length) return;
    setLoadingPrices(true);
    try {
      const res = await marketApi.getPrices(positions.map((p) => p.ticker));
      setPrices(res.data);
    } catch {}
    setLoadingPrices(false);
  }, [positions]);

  // Fetch on mount and whenever positions change; auto-refresh every 30s
  useEffect(() => {
    fetchPrices();
    const interval = setInterval(() => fetchPrices(), 30_000);
    return () => clearInterval(interval);
  }, [fetchPrices]);

  const totals = useMemo(() => {
    let invested=0, current=0;
    for (const p of positions) {
      invested += p.shares * p.avgPrice;
      const cp = prices[p.ticker]?.price;
      current += cp ? p.shares*cp : p.shares*p.avgPrice;
    }
    const diff = current - invested;
    const pct = invested>0 ? (diff/invested)*100 : 0;
    return { invested, current, diff, pct };
  }, [positions, prices]);

  const diagnosis = useMemo(() => {
    if (!positions.length) return null;
    return scorePortfolio(positions, prices);
  }, [positions, prices]);

  // ── Screenshot import ──────────────────────────────────────────────────
  const processScreenshotFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setScreenshotAnalyzing(true);
    setScreenshotPreview(null);
    setScreenshotProgress(files.length > 1 ? `Analizando 1 de ${files.length}...` : "Analizando con IA...");
    const allExtracted: ExtractedPos[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        if (files.length > 1) setScreenshotProgress(`Analizando ${i+1} de ${files.length}...`);
        const file = files[i];
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.readAsDataURL(file);
        });
        const res = await marketApi.analyzeScreenshot(base64, file.type || "image/jpeg");
        const fromImage: ExtractedPos[] = (res.data.positions || []).map(
          (p: Omit<ExtractedPos,"id">, j: number) => ({ ...p, id:`${p.ticker}-${i}-${j}-${Date.now()}` })
        );
        allExtracted.push(...fromImage);
      }
      const merged = new Map<string,ExtractedPos>();
      for (const pos of allExtracted) {
        const existing = merged.get(pos.ticker);
        if (!existing || (pos.avg_price > 0 && existing.avg_price === 0)) merged.set(pos.ticker, pos);
      }
      const final = Array.from(merged.values());
      if (!final.length) {
        alert("No se encontraron posiciones en las imágenes. Intenta con capturas más claras.");
      } else {
        setScreenshotPreview(final);
      }
    } catch {
      alert("No se pudieron analizar las imágenes. Verifica que el backend esté corriendo.");
    } finally {
      setScreenshotAnalyzing(false);
      setScreenshotProgress("");
    }
  }, []);

  const handleScreenshotChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    await processScreenshotFiles(files);
    if (screenshotInputRef.current) screenshotInputRef.current.value = "";
  };

  // Paste handler — Ctrl+V / ⌘+V anywhere on the page
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const imageFiles = Array.from(e.clipboardData?.items || [])
        .filter((item) => item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      if (!imageFiles.length) return;
      e.preventDefault();
      await processScreenshotFiles(imageFiles);
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [processScreenshotFiles]);

  const confirmScreenshotImport = () => {
    if (!screenshotPreview?.length) return;
    setPendingImport(screenshotPreview.map((p) => ({
      ticker: p.ticker, name: p.name, shares: p.shares, avgPrice: p.avg_price,
    })));
    setImportCurrency("USD");
    setScreenshotPreview(null);
  };

  // Approximate fallback rates (1 unit → USD). Updated periodically; good enough for cost basis.
  const FALLBACK_RATES: Record<string, number> = {
    MXN: 0.0500, EUR: 1.08, GBP: 1.27, CAD: 0.73,
    ARS: 0.00095, BRL: 0.18, COP: 0.00024, CLP: 0.00105,
    PEN: 0.265, JPY: 0.0065, CHF: 1.12, AUD: 0.65,
  };

  const applyImport = async (positions: PendingImport, currency: string) => {
    if (currency === "USD") {
      setPositions(positions);
      setPendingImport(null);
      return;
    }
    setConvertingCurrency(true);
    let rate = FALLBACK_RATES[currency] ?? 1;
    try {
      const res = await fetch(`https://api.frankfurter.app/latest?from=${currency}&to=USD`);
      const data = await res.json();
      if (data.rates?.USD) rate = data.rates.USD;
    } catch { /* use fallback */ }
    setPositions(positions.map((p) => ({ ...p, avgPrice: parseFloat((p.avgPrice * rate).toFixed(4)) })));
    setConvertingCurrency(false);
    setPendingImport(null);
  };


  // ── Manual add ─────────────────────────────────────────────────────────
  const handleAdd = async () => {
    const ticker = form.ticker.trim().toUpperCase();
    const shares = parseFloat(form.shares);
    const avgPrice = parseFloat(form.avgPrice);
    if (!ticker || !shares || !avgPrice) { alert("Completa todos los campos"); return; }
    setAddingLoading(true);
    try {
      const res = await marketApi.getPrices([ticker]);
      addPosition({ ticker, shares, avgPrice, name: res.data[ticker]?.name });
    } catch {
      addPosition({ ticker, shares, avgPrice });
    }
    setForm({ ticker:"", shares:"", avgPrice:"" });
    setShowForm(false);
    setAddingLoading(false);
  };

  // ── Stress Test ──────────────────────────────────────────────────────────
  const runStressTest = (scenarioId: string) => {
    const sc = STRESS_SCENARIOS.find((s) => s.id === scenarioId);
    if (!sc) return;
    setStressScenario(scenarioId);
    const rows = positions.map((pos) => {
      const currentPrice = prices[pos.ticker]?.price ?? pos.avgPrice;
      const invested = pos.shares * currentPrice;
      const sector = TICKER_SECTOR[pos.ticker] ?? "";
      const drawdown = sector ? (sc.drawdowns[sector as keyof typeof sc.drawdowns] ?? sc.default) : sc.default;
      const stressed = invested * (1 + drawdown/100);
      return { ticker:pos.ticker, invested, stressed, diff:stressed-invested, pct:drawdown, sector:sector||"Otro" };
    });
    const total = rows.reduce((a,r) => a+r.invested, 0);
    const stressedTotal = rows.reduce((a,r) => a+r.stressed, 0);
    setStressResult({ total, stressed:stressedTotal, diff:stressedTotal-total, pct:total>0?((stressedTotal-total)/total)*100:0, rows });
  };

  // ── AI Simulate ─────────────────────────────────────────────────────────
  const simulate = async () => {
    setSimLoading(true); setAnalysis("");
    try {
      const posPayload = positions.length>0
        ? positions.map((p) => ({ ticker:p.ticker, shares:p.shares, avg_price:p.avgPrice, name:p.name }))
        : undefined;
      const res = await marketApi.getPortfolio(scenario, capital?parseFloat(capital):undefined, posPayload);
      setAnalysis(res.data.analysis);
    } catch { setAnalysis("Error al generar el análisis. Intenta de nuevo."); }
    setSimLoading(false);
  };

  // ── Calculator ──────────────────────────────────────────────────────────
  const calculateCompound = () => {
    const pv  = parseFloat(calcCapital) || 0;
    const pmt = parseFloat(calcMonthly) || 0;
    const ann = parseFloat(calcReturn)  || 0;
    const yrs = parseFloat(calcYears)   || 0;
    if (!pv || !ann || !yrs) return;
    const r = ann/100/12;
    const n = Math.round(yrs*12);
    const fvPV  = pv * Math.pow(1+r, n);
    const fvPMT = pmt>0 ? pmt*(Math.pow(1+r,n)-1)/r : 0;
    const final = fvPV + fvPMT;
    const invested = pv + pmt*n;
    const milestoneYears = Array.from(new Set([1,2,3,5,10,Math.round(yrs)].filter((y) => y>0&&y<=yrs))).sort((a,b)=>a-b);
    const milestones = milestoneYears.map((y) => {
      const mn = y*12;
      const val = pv*Math.pow(1+r,mn) + (pmt>0?pmt*(Math.pow(1+r,mn)-1)/r:0);
      return { year:y, value:val };
    });
    setCalcResult({ final, invested, gain:final-invested, pct:invested>0?((final-invested)/invested)*100:0, milestones });
  };

  if (!isAuthenticated) return null;

  return (
    <>
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      {/* Top bar */}
      <div className="border-b flex items-center justify-between px-4 py-2 shrink-0"
           style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-1" style={{ color: "var(--muted)" }}>
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <button onClick={() => router.push("/chat")} className="flex items-center gap-2.5">
            <div className="relative">
              <Image src="/logo.png" alt="Nuvos AI" width={30} height={30} className="rounded-xl object-cover" />
              <div className="absolute -inset-0.5 rounded-xl blur-sm opacity-40" style={{ background: "var(--grad-green)" }} />
            </div>
            <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvos AI</span>
          </button>
        </div>
        <span className="font-semibold text-sm" style={{ color: "var(--sub)" }}>Portafolio</span>
        <button onClick={fetchPrices} className="p-1.5 rounded-lg transition-colors" style={{ color: "var(--muted)" }}
                title="Actualizar precios">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Main */}
        <main className="flex-1 overflow-y-auto scrollbar-thin p-4 max-w-3xl mx-auto w-full">

          {/* Tab switcher */}
          <div className="flex p-1 rounded-xl gap-1 mb-5" style={{ background: "var(--raised)" }}>
            <button onClick={() => setActiveTab("portfolio")}
                    className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
                    style={{ background: activeTab === "portfolio" ? "var(--card)" : "transparent", color: activeTab === "portfolio" ? "var(--text)" : "var(--muted)" }}>
              Mi Portafolio
            </button>
            <button onClick={() => setActiveTab("liga")}
                    className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-1.5"
                    style={{ background: activeTab === "liga" ? "var(--card)" : "transparent", color: activeTab === "liga" ? "var(--accent-l)" : "var(--muted)" }}>
              <Trophy className="w-3.5 h-3.5" /> Liga
            </button>
          </div>

          {activeTab === "portfolio" && <div className="space-y-5">

          {/* ── Import section ── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-extrabold uppercase tracking-wider" style={{ color: "var(--sub)" }}>Mi Portafolio</h2>
              <div className="flex gap-2">
                <button onClick={() => { setShowForm(!showForm); setScreenshotPreview(null); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors"
                        style={{ borderColor:"var(--border)", color:"var(--sub)", background:"var(--card)" }}>
                  <Plus className="w-3.5 h-3.5" /> Manual
                </button>
              </div>
            </div>

            {/* Screenshot import button */}
            <button onClick={() => screenshotInputRef.current?.click()}
                    disabled={screenshotAnalyzing}
                    className="w-full flex items-center gap-4 p-4 rounded-2xl text-left transition-all disabled:opacity-50"
                    style={{ background:"var(--accent)" }}>
              {screenshotAnalyzing ? (
                <>
                  <RefreshCw className="w-7 h-7 text-white animate-spin shrink-0" />
                  <span className="text-white font-bold">{screenshotProgress || "Analizando con IA..."}</span>
                </>
              ) : (
                <>
                  <Upload className="w-7 h-7 text-white shrink-0" />
                  <div>
                    <p className="text-white font-extrabold text-sm">Importar capturas de pantalla</p>
                    <p className="text-white/70 text-xs mt-0.5">Selecciona 1 o más fotos — la IA detecta todo</p>
                  </div>
                </>
              )}
            </button>
            <input ref={screenshotInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleScreenshotChange} />

            {/* Paste zone */}
            {!screenshotAnalyzing && !screenshotPreview && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed text-xs"
                   style={{ borderColor:"var(--border)", color:"var(--dim)" }}>
                <span className="text-base">📋</span>
                <span>También puedes <strong style={{ color:"var(--sub)" }}>pegar directamente</strong> con <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ background:"var(--raised)", color:"var(--muted)" }}>Ctrl+V</kbd> o <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ background:"var(--raised)", color:"var(--muted)" }}>⌘+V</kbd></span>
              </div>
            )}

            {/* Screenshot preview */}
            {screenshotPreview && (
              <div className="mt-3 rounded-2xl border-2 p-4" style={{ borderColor:"#22c55e", background:"var(--card)" }}>
                <p className="font-extrabold text-sm mb-1" style={{ color:"var(--text)" }}>
                  {screenshotPreview.length} posiciones detectadas
                </p>
                <p className="text-xs mb-3" style={{ color:"var(--muted)" }}>Revisa y elimina las incorrectas</p>
                {screenshotPreview.map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-2.5 border-b" style={{ borderColor:"var(--border)" }}>
                    <div className="flex-1">
                      <span className="font-extrabold text-sm" style={{ color:"var(--text)" }}>{p.ticker}</span>
                      {p.name !== p.ticker && <span className="text-xs ml-2" style={{ color:"var(--muted)" }}>{p.name}</span>}
                    </div>
                    <div className="text-right mr-3">
                      <p className="text-xs" style={{ color:"var(--sub)" }}>{p.shares} acc</p>
                      <p className="text-xs" style={{ color:"var(--sub)" }}>@ ${p.avg_price>0?p.avg_price.toFixed(2):"—"}</p>
                    </div>
                    <button onClick={() => setScreenshotPreview((prev) => {
                      const next=(prev??[]).filter((x)=>x.id!==p.id);
                      return next.length?next:null;
                    })} className="text-[#ef4444] text-xl font-bold leading-none">×</button>
                  </div>
                ))}
                <div className="flex gap-2 mt-3">
                  <button onClick={() => setScreenshotPreview(null)}
                          className="flex-1 py-2.5 rounded-xl border text-sm font-semibold"
                          style={{ borderColor:"var(--border)", color:"var(--muted)" }}>
                    Cancelar
                  </button>
                  <button onClick={confirmScreenshotImport}
                          className="flex-[2] py-2.5 rounded-xl text-white text-sm font-bold"
                          style={{ background:"var(--accent)" }}>
                    ✓ Agregar {screenshotPreview.length} posiciones
                  </button>
                </div>
              </div>
            )}

            {/* Manual form */}
            {showForm && (
              <div className="mt-3 rounded-2xl border p-4" style={{ borderColor:"var(--border)", background:"var(--card)" }}>
                <p className="text-sm font-bold mb-3" style={{ color:"var(--text)" }}>Nueva posición manual</p>
                <input value={form.ticker} onChange={(e) => setForm({...form,ticker:e.target.value.toUpperCase()})}
                       className="w-full rounded-xl border px-3 py-2.5 text-sm mb-2 outline-none"
                       style={{ background:"var(--bg)", borderColor:"var(--border)", color:"var(--text)" }}
                       placeholder="Ticker (ej. AAPL)" />
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <input value={form.shares} onChange={(e) => setForm({...form,shares:e.target.value})}
                         type="number" min="0"
                         className="rounded-xl border px-3 py-2.5 text-sm outline-none"
                         style={{ background:"var(--bg)", borderColor:"var(--border)", color:"var(--text)" }}
                         placeholder="Acciones" />
                  <input value={form.avgPrice} onChange={(e) => setForm({...form,avgPrice:e.target.value})}
                         type="number" min="0"
                         className="rounded-xl border px-3 py-2.5 text-sm outline-none"
                         style={{ background:"var(--bg)", borderColor:"var(--border)", color:"var(--text)" }}
                         placeholder="Precio promedio" />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowForm(false)}
                          className="flex-1 py-2.5 rounded-xl border text-sm font-semibold"
                          style={{ borderColor:"var(--border)", color:"var(--muted)" }}>Cancelar</button>
                  <button onClick={handleAdd} disabled={addingLoading}
                          className="flex-1 py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-40"
                          style={{ background:"var(--accent)" }}>
                    {addingLoading ? "..." : "Agregar"}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ── Positions ── */}
          {positions.length === 0 && !screenshotPreview ? (
            <div className="rounded-2xl border p-10 flex flex-col items-center gap-3"
                 style={{ borderColor:"var(--border)", background:"var(--card)" }}>
              <PieChart className="w-10 h-10" style={{ color:"var(--dim)" }} />
              <p className="font-bold text-sm" style={{ color:"var(--text)" }}>Sin posiciones todavía</p>
              <p className="text-xs text-center" style={{ color:"var(--muted)" }}>
                Importa capturas de pantalla y la IA lo detecta todo automáticamente
              </p>
            </div>
          ) : positions.length > 0 ? (
            <section>
              {/* Totals card */}
              <div className="rounded-2xl border-2 p-5 mb-3" style={{ borderColor:"var(--accent-l)22", background:"var(--card)", borderTopColor:"var(--accent-l)" }}>
                {loadingPrices ? (
                  <div className="flex items-center gap-2" style={{ color:"var(--muted)" }}>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Actualizando precios...</span>
                  </div>
                ) : (
                  <>
                    <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color:"var(--muted)" }}>Valor actual del portafolio</p>
                    <p className="text-3xl font-black" style={{ color:"var(--text)" }}>
                      ${totals.current.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs" style={{ color:"var(--muted)" }}>
                        Invertido: ${totals.invested.toLocaleString("en-US",{minimumFractionDigits:2})}
                      </span>
                      <span className="text-sm font-bold" style={{ color:totals.diff>=0?"#22c55e":"#ef4444" }}>
                        {totals.diff>=0?"+":""}{totals.diff.toLocaleString("en-US",{minimumFractionDigits:2})} ({totals.pct>=0?"+":""}{totals.pct.toFixed(2)}%)
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* Position cards */}
              {positions.map((pos) => {
                const pd = prices[pos.ticker];
                const cp = pd?.price;
                const hasCost = pos.avgPrice > 0;
                const currentVal = cp ? pos.shares * cp : null;
                const investedVal = hasCost ? pos.shares * pos.avgPrice : null;
                const diff = currentVal !== null && investedVal !== null ? currentVal - investedVal : null;
                const pct = diff !== null && investedVal! > 0 ? (diff / investedVal!) * 100 : null;
                const isUp = diff !== null && diff >= 0;
                return (
                  <div key={pos.id} className="rounded-2xl border p-4 mb-2"
                       style={{ borderColor:"var(--border)", background:"var(--card)" }}>
                    {/* Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-extrabold text-base" style={{ color:"var(--text)" }}>{pos.ticker}</p>
                        {(pd?.name || pos.name) && (
                          <p className="text-xs mt-0.5" style={{ color:"var(--muted)" }}>{pd?.name || pos.name}</p>
                        )}
                      </div>
                      <button onClick={() => removePosition(pos.id)} style={{ color:"var(--dim)" }}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {/* Prices row */}
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color:"var(--dim)" }}>Precio compra</p>
                        <p className="text-sm font-bold" style={{ color: hasCost ? "var(--sub)" : "var(--dim)" }}>
                          {hasCost ? `$${pos.avgPrice.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}` : "—"}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color:"var(--dim)" }}>Acciones</p>
                        <p className="text-sm font-bold" style={{ color:"var(--sub)" }}>{pos.shares.toLocaleString("en-US")}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color:"var(--dim)" }}>Precio actual</p>
                        {cp ? (
                          <p className="text-sm font-extrabold" style={{ color:"var(--text)" }}>
                            ${cp.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
                          </p>
                        ) : (
                          <p className="text-sm" style={{ color:"var(--dim)" }}>...</p>
                        )}
                      </div>
                    </div>
                    {/* Performance bar */}
                    {cp && hasCost && (
                      <div className="flex items-center justify-between px-3 py-2 rounded-xl"
                           style={{ background: isUp ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)" }}>
                        <p className="text-xs" style={{ color:"var(--muted)" }}>
                          ${investedVal!.toLocaleString("en-US",{minimumFractionDigits:2})}
                          {" → "}
                          ${currentVal!.toLocaleString("en-US",{minimumFractionDigits:2})}
                        </p>
                        <p className="text-sm font-black" style={{ color: isUp ? "#22c55e" : "#ef4444" }}>
                          {isUp ? "+" : ""}{pct!.toFixed(2)}%
                        </p>
                      </div>
                    )}
                    {cp && !hasCost && (
                      <p className="text-xs mt-1" style={{ color:"var(--dim)" }}>
                        Sin precio de compra — edita la posición para ver rendimiento
                      </p>
                    )}
                  </div>
                );
              })}
            </section>
          ) : null}

          {/* ── Risk Diagnosis ── */}
          {diagnosis && positions.length>0 && (() => {
            const level = PORTFOLIO_LEVELS[diagnosis.levelIdx];
            return (
              <section className="rounded-2xl border-2 p-4" style={{ borderColor:level.color+"60", background:"var(--card)" }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border"
                       style={{ borderColor:level.color+"50", background:level.color+"18" }}>
                    <div className="w-2 h-2 rounded-full" style={{ background:level.color }} />
                    <span className="text-xs font-extrabold" style={{ color:level.color }}>{level.label}</span>
                  </div>
                  <span className="text-xs font-bold" style={{ color:"var(--muted)" }}>{diagnosis.score}/100</span>
                </div>
                {/* 8-segment bar */}
                <div className="flex gap-1 items-center mb-1">
                  {PORTFOLIO_LEVELS.map((l, i) => (
                    <div key={l.label} className="flex-1 rounded transition-all"
                         style={{
                           background: i===diagnosis.levelIdx ? l.color : l.color+"35",
                           height: i===diagnosis.levelIdx ? "14px" : "8px",
                         }} />
                  ))}
                </div>
                <div className="flex justify-between mb-3">
                  <span className="text-[10px]" style={{ color:"var(--dim)" }}>Conservador</span>
                  <span className="text-[10px]" style={{ color:"var(--dim)" }}>Especulativo</span>
                </div>
                {Object.keys(diagnosis.sectorPcts).length>0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {Object.entries(diagnosis.sectorPcts).sort((a,b)=>b[1]-a[1]).map(([sector,pct]) => (
                      <span key={sector} className="text-xs px-2 py-1 rounded-lg border font-semibold"
                            style={{ background:"var(--raised)", borderColor:"var(--border)", color:"var(--sub)" }}>
                        {sector} {pct}%
                      </span>
                    ))}
                  </div>
                )}
              </section>
            );
          })()}

          {/* ── Stress Test ── */}
          {positions.length>0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-5 h-5 text-[#ef4444] shrink-0" />
                <div>
                  <h3 className="text-sm font-extrabold" style={{ color:"var(--text)" }}>Stress Test de Portafolio</h3>
                  <p className="text-xs" style={{ color:"var(--muted)" }}>¿Cuánto aguantaría tu portafolio en una crisis?</p>
                </div>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
                {STRESS_SCENARIOS.map((sc) => (
                  <button key={sc.id}
                          onClick={() => runStressTest(sc.id)}
                          className="flex items-center gap-2 px-3 py-2.5 rounded-xl border shrink-0 transition-all"
                          style={{
                            borderColor: stressScenario===sc.id ? sc.color : "var(--border)",
                            background: stressScenario===sc.id ? sc.color+"18" : "var(--card)",
                          }}>
                    <span>{sc.icon}</span>
                    <div className="text-left">
                      <p className="text-xs font-bold" style={{ color:stressScenario===sc.id?sc.color:"var(--sub)" }}>{sc.name}</p>
                      <p className="text-[10px]" style={{ color:"var(--dim)" }}>{sc.year}</p>
                    </div>
                  </button>
                ))}
              </div>
              {stressResult && stressScenario && (() => {
                const sc = STRESS_SCENARIOS.find((x) => x.id===stressScenario)!;
                return (
                  <div className="rounded-2xl border p-4 mt-3" style={{ borderColor:sc.color+"50", background:"var(--card)" }}>
                    <p className="text-sm font-bold mb-3" style={{ color:"var(--text)" }}>{sc.icon} {sc.name} — {sc.desc}</p>
                    <div className="rounded-xl p-3 mb-3" style={{ background:stressResult.diff>=0?"rgba(34,197,94,0.08)":"rgba(239,68,68,0.08)" }}>
                      <p className="text-xs mb-1" style={{ color:"var(--muted)" }}>Impacto total estimado</p>
                      <p className="text-2xl font-black" style={{ color:stressResult.diff>=0?"#22c55e":"#ef4444" }}>
                        {stressResult.diff>=0?"+":""}{fmtMoney(Math.abs(stressResult.diff))} ({stressResult.pct>=0?"+":""}{stressResult.pct.toFixed(1)}%)
                      </p>
                      <p className="text-xs mt-1" style={{ color:"var(--dim)" }}>
                        {fmtMoney(stressResult.total)} → {fmtMoney(stressResult.stressed)}
                      </p>
                    </div>
                    {stressResult.rows.map((row) => (
                      <div key={row.ticker} className="flex items-center justify-between py-2.5 border-t"
                           style={{ borderColor:"var(--border)" }}>
                        <div>
                          <p className="text-sm font-extrabold" style={{ color:"var(--text)" }}>{row.ticker}</p>
                          <p className="text-xs" style={{ color:"var(--dim)" }}>{row.sector}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-extrabold" style={{ color:row.pct>=0?"#22c55e":"#ef4444" }}>
                            {row.pct>=0?"+":""}{row.pct.toFixed(0)}%
                          </p>
                          <p className="text-xs font-semibold" style={{ color:row.diff>=0?"#22c55e":"#ef4444" }}>
                            {row.diff>=0?"+":""}{fmtMoney(Math.abs(row.diff))}
                          </p>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center gap-1.5 mt-3 px-3 py-2 rounded-lg"
                         style={{ background:"rgba(234,179,8,0.08)", border:"1px solid rgba(234,179,8,0.25)" }}>
                      <AlertTriangle className="w-3 h-3 text-yellow-600 shrink-0" />
                      <p className="text-[11px] text-yellow-600">Estimación basada en datos históricos. No garantiza resultados futuros.</p>
                    </div>
                  </div>
                );
              })()}
            </section>
          )}

          {/* ── AI Portfolio Simulator ── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-5 h-5 text-[#22c55e] shrink-0" />
              <div>
                <h3 className="text-sm font-extrabold" style={{ color:"var(--text)" }}>Simulador de Portafolio</h3>
                <p className="text-xs" style={{ color:"var(--muted)" }}>
                  {positions.length>0 ? `Analiza tus ${positions.length} posiciones con IA` : "Simula un portafolio hipotético"}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {SCENARIOS.map((sc) => (
                <button key={sc.value} onClick={() => setScenario(sc.value)}
                        className="flex flex-col items-center gap-1 p-3 rounded-2xl border text-center transition-all"
                        style={{
                          borderColor: scenario===sc.value ? "var(--accent-l)" : "var(--border)",
                          background: scenario===sc.value ? "rgba(0,212,126,0.08)" : "var(--card)",
                        }}>
                  <span className="text-xl">{sc.emoji}</span>
                  <span className="text-xs font-bold" style={{ color:scenario===sc.value?"var(--text)":"var(--sub)" }}>{sc.label}</span>
                </button>
              ))}
            </div>
            {positions.length===0 && (
              <input value={capital} onChange={(e) => setCapital(e.target.value)} type="number" min="0"
                     className="w-full rounded-xl border px-3 py-2.5 text-sm mb-3 outline-none"
                     style={{ background:"var(--card)", borderColor:"var(--border)", color:"var(--text)" }}
                     placeholder="Capital de referencia (USD, opcional)" />
            )}
            <button onClick={simulate} disabled={simLoading}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-white font-bold text-sm disabled:opacity-40 transition-colors"
                    style={{ background:"var(--accent)" }}>
              {simLoading ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /> Analizando...</>
              ) : (
                <><Sparkles className="w-4 h-4" /> {positions.length>0?"Analizar mi portafolio con IA":"Simular portafolio"}</>
              )}
            </button>
            {analysis && (
              <div className="mt-3 rounded-2xl border p-4" style={{ borderColor:"var(--border)", background:"var(--card)" }}>
                <div className="prose prose-sm max-w-none text-xs leading-relaxed" style={{ color:"var(--sub)" }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{analysis}</ReactMarkdown>
                </div>
                <div className="flex items-center gap-1.5 mt-3 px-3 py-2 rounded-lg"
                     style={{ background:"rgba(234,179,8,0.08)", border:"1px solid rgba(234,179,8,0.25)" }}>
                  <AlertTriangle className="w-3 h-3 text-yellow-600 shrink-0" />
                  <p className="text-[11px] text-yellow-600">Análisis educativo. No es asesoramiento financiero.</p>
                </div>
              </div>
            )}
          </section>

          {/* ── Investment Calculator ── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Calculator className="w-5 h-5 text-[#6366f1] shrink-0" />
              <div>
                <h3 className="text-sm font-extrabold" style={{ color:"var(--text)" }}>Calculadora de Inversión</h3>
                <p className="text-xs" style={{ color:"var(--muted)" }}>¿Cuánto tendrás si inviertes X a Y% por Z años?</p>
              </div>
            </div>
            <div className="rounded-2xl border p-4" style={{ borderColor:"var(--border)", background:"var(--card)" }}>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color:"var(--muted)" }}>Capital inicial (USD)</label>
                  <div className="flex items-center rounded-xl border overflow-hidden"
                       style={{ background:"var(--bg)", borderColor:"var(--border)" }}>
                    <span className="px-2 text-sm font-bold" style={{ color:"var(--muted)" }}>$</span>
                    <input value={calcCapital} onChange={(e) => setCalcCapital(e.target.value)} type="number" min="0"
                           className="flex-1 bg-transparent py-2.5 text-sm outline-none pr-2"
                           style={{ color:"var(--text)" }} placeholder="10,000" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color:"var(--muted)" }}>Aportación mensual</label>
                  <div className="flex items-center rounded-xl border overflow-hidden"
                       style={{ background:"var(--bg)", borderColor:"var(--border)" }}>
                    <span className="px-2 text-sm font-bold" style={{ color:"var(--muted)" }}>$</span>
                    <input value={calcMonthly} onChange={(e) => setCalcMonthly(e.target.value)} type="number" min="0"
                           className="flex-1 bg-transparent py-2.5 text-sm outline-none pr-2"
                           style={{ color:"var(--text)" }} placeholder="500" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color:"var(--muted)" }}>Rendimiento anual (%)</label>
                  <input value={calcReturn} onChange={(e) => setCalcReturn(e.target.value)} type="number" min="0"
                         className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                         style={{ background:"var(--bg)", borderColor:"var(--border)", color:"var(--text)" }}
                         placeholder="10" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color:"var(--muted)" }}>Plazo (años)</label>
                  <input value={calcYears} onChange={(e) => setCalcYears(e.target.value)} type="number" min="0"
                         className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                         style={{ background:"var(--bg)", borderColor:"var(--border)", color:"var(--text)" }}
                         placeholder="20" />
                </div>
              </div>
              <button onClick={calculateCompound}
                      disabled={!calcCapital||!calcReturn||!calcYears}
                      className="w-full py-3 rounded-xl text-white font-bold text-sm disabled:opacity-40 transition-colors"
                      style={{ background:"#6366f1" }}>
                Calcular
              </button>
            </div>
            {calcResult && (
              <div className="mt-3 rounded-2xl border-2 p-5" style={{ borderColor:"#6366f1", background:"var(--card)" }}>
                <div className="text-center mb-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color:"var(--muted)" }}>Valor final</p>
                  <p className="text-4xl font-black" style={{ color:"#6366f1" }}>
                    {fmtMoney(calcResult.final)}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-0 border-t border-b py-4 mb-4" style={{ borderColor:"var(--border)" }}>
                  <div className="text-center">
                    <p className="text-[10px] mb-1" style={{ color:"var(--muted)" }}>Total invertido</p>
                    <p className="text-sm font-extrabold" style={{ color:"var(--text)" }}>{fmtMoney(calcResult.invested)}</p>
                  </div>
                  <div className="text-center border-l" style={{ borderColor:"var(--border)" }}>
                    <p className="text-[10px] mb-1" style={{ color:"var(--muted)" }}>Ganancia neta</p>
                    <p className="text-sm font-extrabold text-[#22c55e]">+{fmtMoney(calcResult.gain)} (+{calcResult.pct.toFixed(0)}%)</p>
                  </div>
                </div>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color:"var(--muted)" }}>Evolución año a año</p>
                {calcResult.milestones.map((m) => (
                  <div key={m.year} className="flex items-center gap-3 mb-2">
                    <span className="text-xs font-bold w-12 shrink-0" style={{ color:"var(--sub)" }}>Año {m.year}</span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background:"var(--border)" }}>
                      <div className="h-full rounded-full" style={{ width:`${(m.value/calcResult.final)*100}%`, background:"#6366f1" }} />
                    </div>
                    <span className="text-xs font-bold w-20 text-right" style={{ color:"var(--text)" }}>{fmtMoney(m.value)}</span>
                  </div>
                ))}
                <div className="flex items-center gap-1.5 mt-3 px-3 py-2 rounded-lg" style={{ background:"rgba(99,102,241,0.1)", border:"1px solid rgba(99,102,241,0.3)" }}>
                  <BarChart className="w-3 h-3 text-[#6366f1] shrink-0" />
                  <p className="text-[11px] text-[#6366f1]">Cálculo con interés compuesto mensual. Los rendimientos reales varían.</p>
                </div>
              </div>
            )}
          </section>

          <div className="h-8" />
          </div>} {/* end activeTab === "portfolio" */}

          {/* ══════════════════ LIGA TAB ══════════════════ */}
          {activeTab === "liga" && (
            <div className="space-y-3">

              {/* Header + refresh */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
                  {leagueData.length > 0 ? `${leagueData.length} inversores · retorno real` : "Cargando ranking…"}
                </span>
                <button onClick={loadLeaderboard} disabled={leagueLoading}
                        className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
                        style={{ color: "var(--muted)" }}>
                  <RefreshCw className={`w-3.5 h-3.5 ${leagueLoading ? "animate-spin" : ""}`} />
                </button>
              </div>

              {/* Period selector */}
              <div className="flex gap-1.5">
                {([
                  { id: "week",  label: "Esta semana" },
                  { id: "month", label: "Este mes" },
                  { id: "all",   label: "Todo tiempo" },
                ] as const).map((p) => (
                  <button key={p.id} onClick={() => setLeaguePeriod(p.id)}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border"
                          style={{
                            background:  leaguePeriod === p.id ? "rgba(0,168,94,0.12)" : "transparent",
                            borderColor: leaguePeriod === p.id ? "rgba(0,168,94,0.4)"  : "var(--border)",
                            color:       leaguePeriod === p.id ? "var(--accent-l)"      : "var(--muted)",
                          }}>
                    {p.label}
                  </button>
                ))}
              </div>

              {/* My rank card */}
              <div className="rounded-xl border p-4"
                   style={{
                     background:  (myEntry?.returnPct ?? 0) >= 0 ? "rgba(0,168,94,0.07)"  : "rgba(255,71,87,0.07)",
                     borderColor: (myEntry?.returnPct ?? 0) >= 0 ? "rgba(0,168,94,0.25)"  : "rgba(255,71,87,0.25)",
                   }}>
                <div className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--muted)" }}>
                  Tu posición
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-black" style={{ color: "var(--text)" }}>#{myEntry?.rank ?? "—"}</span>
                    <span className="text-xs" style={{ color: "var(--muted)" }}>de {LEAGUE_TOTAL.toLocaleString()} inversores</span>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black"
                         style={{ color: (myEntry?.returnPct ?? 0) >= 0 ? "var(--up)" : "var(--down)" }}>
                      {(myEntry?.returnPct ?? 0) >= 0 ? "+" : ""}{(myEntry?.returnPct ?? 0).toFixed(1)}%
                    </div>
                    {(myEntry?.rankChange ?? 0) > 0 && (
                      <div className="text-xs mt-0.5" style={{ color: "#f59e0b" }}>
                        ↑ Subiste {myEntry.rankChange} posiciones
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Lesson card */}
              <div className="rounded-xl border p-3.5"
                   style={{ background: "rgba(59,130,246,0.05)", borderColor: "rgba(59,130,246,0.2)" }}>
                <div className="flex items-center gap-2 mb-1.5">
                  <Lightbulb className="w-3.5 h-3.5 shrink-0" style={{ color: "#60a5fa" }} />
                  <span className="text-xs font-bold" style={{ color: "#60a5fa" }}>Lección del mercado</span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>
                  {LEAGUE_LESSONS[leaguePeriod]}
                </p>
              </div>

              {/* Leaderboard */}
              <div className="rounded-xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
                  <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>Tabla de líderes</span>
                  <span className="text-xs" style={{ color: "var(--dim)" }}>Retorno % · portafolio real</span>
                </div>
                {top5.map((entry) => <LeaderRow key={entry.rank} entry={entry} />)}
                {showEllipsis && (
                  <>
                    <div className="px-4 py-2 text-center text-sm tracking-widest" style={{ color: "var(--dim)" }}>···</div>
                    {myEntry && <LeaderRow entry={myEntry} />}
                  </>
                )}
              </div>

              <p className="text-[11px] text-center pb-2" style={{ color: "var(--dim)" }}>
                Ranking en tiempo real · basado en retorno % de tu portafolio real
              </p>
            </div>
          )}

        </main>
      </div>

    </div>

      {/* ── Currency modal — rendered outside overflow-hidden container ── */}
      {pendingImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-sm rounded-3xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <p className="font-extrabold text-base mb-1" style={{ color: "var(--text)" }}>
              ¿En qué moneda está tu portafolio?
            </p>
            <p className="text-xs mb-5" style={{ color: "var(--muted)" }}>
              Convertiremos tus precios de compra a USD para calcular correctamente tus ganancias.
            </p>

            <div className="grid grid-cols-3 gap-2 mb-5">
              {[
                { code: "USD", flag: "🇺🇸", name: "Dólar" },
                { code: "MXN", flag: "🇲🇽", name: "Peso MX" },
                { code: "EUR", flag: "🇪🇺", name: "Euro" },
                { code: "GBP", flag: "🇬🇧", name: "Libra" },
                { code: "CAD", flag: "🇨🇦", name: "CAD" },
                { code: "ARS", flag: "🇦🇷", name: "Peso AR" },
                { code: "BRL", flag: "🇧🇷", name: "Real" },
                { code: "COP", flag: "🇨🇴", name: "Peso CO" },
                { code: "CLP", flag: "🇨🇱", name: "Peso CL" },
                { code: "PEN", flag: "🇵🇪", name: "Sol" },
                { code: "JPY", flag: "🇯🇵", name: "Yen" },
                { code: "AUD", flag: "🇦🇺", name: "AUD" },
              ].map(({ code, flag, name }) => {
                const active = importCurrency === code;
                return (
                  <button key={code} onClick={() => setImportCurrency(code)}
                          className="flex flex-col items-center py-2.5 px-1 rounded-2xl border transition-all text-center"
                          style={{
                            borderColor: active ? "var(--accent)" : "var(--border)",
                            background: active ? "rgba(0,168,94,0.12)" : "var(--raised)",
                          }}>
                    <span className="text-lg leading-none mb-0.5">{flag}</span>
                    <span className="text-[10px] font-bold" style={{ color: active ? "var(--accent-l)" : "var(--text)" }}>{code}</span>
                    <span className="text-[9px]" style={{ color: "var(--dim)" }}>{name}</span>
                  </button>
                );
              })}
            </div>

            {importCurrency !== "USD" && (
              <p className="text-xs mb-4 text-center" style={{ color: "var(--muted)" }}>
                Se convertirá automáticamente usando la tasa de cambio actual {importCurrency} → USD.
              </p>
            )}

            <div className="flex gap-2">
              <button onClick={() => setPendingImport(null)}
                      className="flex-1 py-2.5 rounded-xl border text-sm font-semibold"
                      style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                Cancelar
              </button>
              <button onClick={() => applyImport(pendingImport, importCurrency)}
                      disabled={convertingCurrency}
                      className="flex-[2] py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-50"
                      style={{ background: "var(--accent)" }}>
                {convertingCurrency ? "Convirtiendo..." : `Importar en ${importCurrency}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
