"use client";

import AppSidebar from "@/components/AppSidebar";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { market as marketApi } from "@/lib/api";
import { useAuthStore, useSubscriptionStore } from "@/lib/store";
import { usePortfolioStore, type Position } from "@/lib/portfolioStore";
import EarningsPanel from "@/components/EarningsPanel";
import WhatIfSimulator from "@/components/WhatIfSimulator";
import MonthlyReport from "@/components/MonthlyReport";
import WeeklyScreenerCard from "@/components/WeeklyScreenerCard";
import DiarioDecisionesCard from "@/components/DiarioDecisionesCard";
import PremiumToolLockedWeb from "@/components/PremiumToolLocked";
import PaywallModal from "@/components/PaywallModal";
import {
  PieChart, Menu, X, Upload, Plus, Trash2,
  BarChart, Calculator, Shield, Sparkles, RefreshCw, AlertTriangle, FileText, Pencil, Eye,
} from "lucide-react";

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
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium";
  const [paywallOpen, setPaywallOpen] = useState(false);
  const { positions, addPosition, removePosition, updatePosition, setPositions, clearPortfolio, portfolioCurrency, setCurrency } = usePortfolioStore();
  const [sidebarOpen, setSidebarOpen]   = useState(false);
  const [activeTab, setActiveTab] = useState<"portfolio" | "herramientas">("portfolio");

  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [fxRate, setFxRate] = useState(1);

  // Screenshot import
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const [screenshotAnalyzing, setScreenshotAnalyzing] = useState(false);
  const [screenshotProgress, setScreenshotProgress] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  type ExtractedPos = { id: string; ticker: string; name: string; shares: number; avg_price: number };
  const [screenshotPreview, setScreenshotPreview] = useState<ExtractedPos[]|null>(null);
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [pendingMerge, setPendingMerge] = useState<ExtractedPos[]>([]);

  // Sort
  type SortField = "return" | "invested" | "price";
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir("desc"); }
  };

  // Edit position modal
  const [editingPos, setEditingPos] = useState<{ id: string; shares: string; avgPrice: string; purchaseDate: string } | null>(null);
  const [revealedPrices, setRevealedPrices] = useState<Set<string>>(new Set());

  // Manual form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ticker:"", shares:"", avgPrice:"", purchaseDate: new Date().toISOString().split("T")[0] });
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
  const [analysis, setAnalysis] = useState("");
  const [simLoading, setSimLoading] = useState(false);

  // Calculator
  const [calcCapital, setCalcCapital] = useState("");
  const [calcMonthly, setCalcMonthly] = useState("");
  const [calcReturn, setCalcReturn]   = useState("");
  const [calcYears, setCalcYears]     = useState("");
  type CalcBar    = { year:number; invested:number; returns:number; total:number };
  type CalcResult = { final:number; invested:number; gain:number; pct:number; multiplier:number; realFinal:number; bars:CalcBar[] };
  const [calcResult, setCalcResult]   = useState<CalcResult|null>(null);
  const CHART_YEARS = [1, 5, 10, 15, 20];
  const _fv = (pv:number, pmt:number, r:number, n:number) => {
    const f = Math.pow(1+r, n);
    return pv*f + (pmt>0 && r>0 ? pmt*(f-1)/r : pmt*n);
  };

  useEffect(() => { if (!isAuthenticated) router.push("/"); }, [isAuthenticated]);

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

  // Period returns
  type PeriodReturn = { pct: number; amount: number; date?: string };
  const PERIODS = [
    { key: "since_purchase", label: "Desde compra" },
    { key: "1d", label: "1D" }, { key: "5d", label: "5D" },
    { key: "1mo", label: "1M" }, { key: "3mo", label: "3M" },
    { key: "6mo", label: "6M" }, { key: "ytd", label: "YTD" },
    { key: "1y", label: "1A" }, { key: "3y", label: "3A" },
    { key: "5y", label: "5A" },
  ] as const;
  type PeriodKey = typeof PERIODS[number]["key"];
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodKey>("since_purchase");
  const [periodReturns, setPeriodReturns] = useState<Record<string, PeriodReturn>>({});
  const [loadingReturns, setLoadingReturns] = useState(false);

  useEffect(() => {
    if (positions.length === 0) return;
    setLoadingReturns(true);
    marketApi.getPortfolioReturns(positions.map((p) => ({ ticker: p.ticker, shares: p.shares, purchase_date: p.purchaseDate ?? null })))
      .then((res: { data: { returns?: Record<string, PeriodReturn> } }) => setPeriodReturns(res.data.returns ?? {}))
      .catch(() => {})
      .finally(() => setLoadingReturns(false));
  }, [positions]);

  // Currency symbol for display
  const currencySymbol = portfolioCurrency === "USD" ? "$"
    : portfolioCurrency === "EUR" ? "€"
    : portfolioCurrency === "GBP" ? "£"
    : portfolioCurrency === "JPY" ? "¥"
    : `${portfolioCurrency} `;

  const totals = useMemo(() => {
    let invested=0, current=0;
    for (const p of positions) {
      invested += p.shares * p.avgPrice; // stored in user's currency
      const cpUSD = prices[p.ticker]?.price;
      // Convert USD price → user's currency
      current += cpUSD ? p.shares * cpUSD * fxRate : p.shares * p.avgPrice;
    }
    const diff = current - invested;
    const pct = invested>0 ? (diff/invested)*100 : 0;
    return { invested, current, diff, pct };
  }, [positions, prices, fxRate]);

  const sortedPositions = useMemo(() => {
    if (!sortField) return positions;
    return [...positions].sort((a, b) => {
      let va = 0, vb = 0;
      if (sortField === "invested") {
        va = a.shares * a.avgPrice;
        vb = b.shares * b.avgPrice;
      } else if (sortField === "price") {
        va = (prices[a.ticker]?.price ?? 0) * fxRate;
        vb = (prices[b.ticker]?.price ?? 0) * fxRate;
      } else if (sortField === "return") {
        const cpA = (prices[a.ticker]?.price ?? 0) * fxRate;
        const cpB = (prices[b.ticker]?.price ?? 0) * fxRate;
        va = a.avgPrice > 0 && cpA > 0 ? (cpA - a.avgPrice) / a.avgPrice * 100 : 0;
        vb = b.avgPrice > 0 && cpB > 0 ? (cpB - b.avgPrice) / b.avgPrice * 100 : 0;
      }
      return sortDir === "desc" ? vb - va : va - vb;
    });
  }, [positions, prices, fxRate, sortField, sortDir]);

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
    if (positions.length > 0) {
      setPendingMerge(screenshotPreview);
      setMergeModalOpen(true);
      setScreenshotPreview(null);
      return;
    }
    setPendingImport(screenshotPreview.map((p) => ({
      ticker: p.ticker, name: p.name, shares: p.shares, avgPrice: p.avg_price,
    })));
    setImportCurrency("USD");
    setScreenshotPreview(null);
  };

  const applyMerge = (mode: "keep" | "replace") => {
    const incoming = pendingMerge.map((p) => ({ ticker: p.ticker, name: p.name, shares: p.shares, avgPrice: p.avg_price }));
    let toImport;
    if (mode === "keep") {
      const existing = positions.map((p) => ({ ticker: p.ticker, name: p.name ?? "", shares: p.shares, avgPrice: p.avgPrice }));
      const newOnly = incoming.filter((p) => !existing.some((e) => e.ticker.toUpperCase() === p.ticker.toUpperCase()));
      toImport = [...existing, ...newOnly];
    } else {
      toImport = incoming;
    }
    setPendingImport(toImport);
    setImportCurrency("USD");
    setMergeModalOpen(false);
    setPendingMerge([]);
  };

  // Exchange rate: USD → portfolioCurrency (for converting current market prices to user's currency)
  const FALLBACK_RATES_TO_USD: Record<string, number> = {
    MXN: 0.0500, EUR: 1.08, GBP: 1.27, CAD: 0.73,
    ARS: 0.00095, BRL: 0.18, COP: 0.00024, CLP: 0.00105,
    PEN: 0.265, JPY: 0.0065, CHF: 1.12, AUD: 0.65,
  };

  // Fetch exchange rate whenever portfolioCurrency changes
  useEffect(() => {
    if (portfolioCurrency === "USD") { setFxRate(1); return; }
    fetch(`https://api.frankfurter.app/latest?from=USD&to=${portfolioCurrency}`)
      .then((r) => r.json())
      .then((d) => { if (d.rates?.[portfolioCurrency]) setFxRate(d.rates[portfolioCurrency]); })
      .catch(() => { setFxRate(1 / (FALLBACK_RATES_TO_USD[portfolioCurrency] ?? 1)); });
  }, [portfolioCurrency]);

  // Import: keep prices in original currency, just store the currency
  const applyImport = async (positions: PendingImport, currency: string) => {
    setCurrency(currency);
    setPositions(positions);
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
      addPosition({ ticker, shares, avgPrice, name: res.data[ticker]?.name, purchaseDate: form.purchaseDate });
    } catch {
      addPosition({ ticker, shares, avgPrice, purchaseDate: form.purchaseDate });
    }
    setForm({ ticker:"", shares:"", avgPrice:"", purchaseDate: new Date().toISOString().split("T")[0] });
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
      const res = await marketApi.getPortfolio(scenario, undefined, posPayload);
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
    const r     = ann/100/12;
    const rReal = (ann-3.5)/100/12;
    const n     = Math.round(yrs*12);
    const final         = _fv(pv, pmt, r, n);
    const totalInvested = pv + pmt*n;
    const gain          = final - totalInvested;
    const realFinal     = _fv(pv, pmt, Math.max(0.0001, rReal), n);
    const multiplier    = totalInvested>0 ? final/totalInvested : 1;
    const bars: CalcBar[] = CHART_YEARS.map((y) => {
      const mn = y*12;
      const inv = pv + pmt*mn;
      const tot = _fv(pv, pmt, r, mn);
      return { year:y, invested:inv, returns:tot-inv, total:tot };
    });
    setCalcResult({ final, invested:totalInvested, gain, pct:totalInvested>0?(gain/totalInvested)*100:0, multiplier, realFinal, bars });
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
            <button onClick={() => setActiveTab("herramientas")}
                    className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-1.5"
                    style={{ background: activeTab === "herramientas" ? "var(--card)" : "transparent", color: activeTab === "herramientas" ? "var(--accent-l)" : "var(--muted)" }}>
              ⭐ Herramientas
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
                {positions.length > 0 && (
                  <button
                    onClick={() => {
                      if (window.confirm(`¿Eliminar las ${positions.length} posiciones de tu portafolio? Esta acción no se puede deshacer.`)) {
                        clearPortfolio();
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors"
                    style={{ borderColor:"rgba(239,68,68,0.3)", color:"#ef4444", background:"rgba(239,68,68,0.06)" }}>
                    <Trash2 className="w-3.5 h-3.5" /> Vaciar
                  </button>
                )}
              </div>
            </div>

            {/* Screenshot import — drop zone */}
            <div
              onClick={() => !screenshotAnalyzing && screenshotInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); if (!screenshotAnalyzing) setIsDragOver(true); }}
              onDragEnter={(e) => { e.preventDefault(); if (!screenshotAnalyzing) setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (screenshotAnalyzing) return;
                const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
                if (files.length) processScreenshotFiles(files);
              }}
              className="w-full rounded-2xl transition-all cursor-pointer select-none"
              style={{
                background: isDragOver ? "var(--accent-l)" : "var(--accent)",
                border: isDragOver ? "2px dashed white" : "2px solid transparent",
                opacity: screenshotAnalyzing ? 0.7 : 1,
              }}>
              <div className="flex items-center gap-4 p-4">
                {screenshotAnalyzing ? (
                  <>
                    <RefreshCw className="w-7 h-7 text-white animate-spin shrink-0" />
                    <span className="text-white font-bold">{screenshotProgress || "Analizando con IA..."}</span>
                  </>
                ) : isDragOver ? (
                  <>
                    <Upload className="w-7 h-7 text-white shrink-0 animate-bounce" />
                    <div>
                      <p className="text-white font-extrabold text-sm">¡Suelta aquí!</p>
                      <p className="text-white/80 text-xs mt-0.5">La IA analizará tus capturas al instante</p>
                    </div>
                  </>
                ) : (
                  <>
                    <Upload className="w-7 h-7 text-white shrink-0" />
                    <div>
                      <p className="text-white font-extrabold text-sm">Importar capturas de pantalla</p>
                      <p className="text-white/70 text-xs mt-0.5">Arrastra aquí, selecciona fotos o pega con ⌘V</p>
                    </div>
                  </>
                )}
              </div>
            </div>
            <input ref={screenshotInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleScreenshotChange} />

            {/* Paste zone hint — solo si no hay drag zone visible */}
            {!screenshotAnalyzing && !screenshotPreview && !isDragOver && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed text-xs"
                   style={{ borderColor:"var(--border)", color:"var(--dim)" }}>
                <span className="text-base">📋</span>
                <span>Puedes <strong style={{ color:"var(--sub)" }}>arrastrar imágenes</strong>, <strong style={{ color:"var(--sub)" }}>pegar</strong> con <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ background:"var(--raised)", color:"var(--muted)" }}>⌘V</kbd> o seleccionar desde tu galería</span>
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
                <div className="grid grid-cols-2 gap-2 mb-2">
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
                <input value={form.purchaseDate} onChange={(e) => setForm({...form,purchaseDate:e.target.value})}
                       type="date" max={new Date().toISOString().split("T")[0]}
                       className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none mb-3"
                       style={{ background:"var(--bg)", borderColor:"var(--border)", color:"var(--text)" }} />
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
              {/* Period return tabs */}
              <div className="mb-3">
                <div className="flex gap-1 flex-wrap mb-2">
                  {PERIODS.map(({ key, label }) => {
                    const ret = periodReturns[key];
                    const isSelected = selectedPeriod === key;
                    const isUp = ret ? ret.pct >= 0 : true;
                    const isSincePurchase = key === "since_purchase";
                    return (
                      <button
                        key={key}
                        onClick={() => setSelectedPeriod(key)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all"
                        style={{
                          background: isSelected ? (isUp ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)") : "var(--raised)",
                          color: isSelected ? (isUp ? "#22c55e" : "#ef4444") : isSincePurchase ? "var(--accent-l)" : "var(--muted)",
                          border: `1px solid ${isSelected ? (isUp ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)") : isSincePurchase ? "rgba(0,168,94,0.3)" : "transparent"}`,
                        }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
                {loadingReturns ? (
                  <div className="flex items-center gap-1.5 text-xs" style={{ color:"var(--muted)" }}>
                    <RefreshCw className="w-3 h-3 animate-spin" /> Calculando rendimientos...
                  </div>
                ) : periodReturns[selectedPeriod] ? (() => {
                  const r = periodReturns[selectedPeriod]!;
                  const up = r.pct >= 0;
                  return (
                    <div className="flex items-center gap-3 px-3 py-2 rounded-xl"
                         style={{ background: up ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)" }}>
                      <div>
                        <span className="text-xs font-semibold" style={{ color:"var(--muted)" }}>
                          {PERIODS.find(p => p.key === selectedPeriod)?.label}
                        </span>
                        {r.date && (
                          <span className="text-[10px] ml-1.5" style={{ color:"var(--dim)" }}>desde {r.date}</span>
                        )}
                      </div>
                      <span className="text-lg font-black" style={{ color: up ? "#22c55e" : "#ef4444" }}>
                        {up ? "+" : ""}{r.pct.toFixed(2)}%
                      </span>
                      <span className="text-xs font-semibold" style={{ color: up ? "#22c55e" : "#ef4444" }}>
                        {up ? "+" : ""}${Math.abs(r.amount).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
                      </span>
                    </div>
                  );
                })() : null}
              </div>

              {/* Totals card */}
              <div className="rounded-2xl border-2 p-5 mb-3" style={{ borderColor:"var(--accent-l)22", background:"var(--card)", borderTopColor:"var(--accent-l)" }}>
                {loadingPrices ? (
                  <div className="flex items-center gap-2" style={{ color:"var(--muted)" }}>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Actualizando precios...</span>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-bold uppercase tracking-wider" style={{ color:"var(--muted)" }}>Valor actual del portafolio</p>
                      {portfolioCurrency !== "USD" && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:"var(--raised)", color:"var(--muted)" }}>{portfolioCurrency}</span>}
                    </div>
                    <p className="text-3xl font-black" style={{ color:"var(--text)" }}>
                      {currencySymbol}{totals.current.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs" style={{ color:"var(--muted)" }}>
                        Invertido: {currencySymbol}{totals.invested.toLocaleString("en-US",{minimumFractionDigits:2})}
                      </span>
                      <span className="text-sm font-bold" style={{ color:totals.diff>=0?"#22c55e":"#ef4444" }}>
                        {totals.diff>=0?"+":""}{currencySymbol}{Math.abs(totals.diff).toLocaleString("en-US",{minimumFractionDigits:2})} ({totals.pct>=0?"+":""}{totals.pct.toFixed(2)}%)
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* Sort chips */}
              <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                <span className="text-[10px] font-semibold" style={{ color:"var(--dim)" }}>Ordenar:</span>
                {([
                  { field: "return" as const,   label: "Rentabilidad" },
                  { field: "invested" as const,  label: "Invertido" },
                  { field: "price" as const,     label: "Precio" },
                ] as const).map(({ field, label }) => {
                  const active = sortField === field;
                  return (
                    <button
                      key={field}
                      onClick={() => handleSort(field)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
                      style={{
                        background: active ? "rgba(0,168,94,0.12)" : "var(--raised)",
                        color: active ? "var(--accent-l)" : "var(--muted)",
                        border: `1px solid ${active ? "rgba(0,168,94,0.35)" : "transparent"}`,
                      }}>
                      {label}
                      {active && <span>{sortDir === "desc" ? " ↓" : " ↑"}</span>}
                    </button>
                  );
                })}
              </div>

              {/* Position cards */}
              {sortedPositions.map((pos) => {
                const pd = prices[pos.ticker];
                const cpUSD = pd?.price;
                // Convert USD market price → user's currency
                const cp = cpUSD ? cpUSD * fxRate : null;
                const hasCost = pos.avgPrice > 0;
                const currentVal = cp ? pos.shares * cp : null;
                const investedVal = hasCost ? pos.shares * pos.avgPrice : null;
                const diff = currentVal !== null && investedVal !== null ? currentVal - investedVal : null;
                const pct = diff !== null && investedVal! > 0 ? (diff / investedVal!) * 100 : null;
                const isUp = diff !== null && diff >= 0;
                const priceRevealed = revealedPrices.has(pos.id);
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
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setEditingPos({ id: pos.id, shares: String(pos.shares), avgPrice: String(pos.avgPrice), purchaseDate: pos.purchaseDate ?? new Date().toISOString().split("T")[0] })}
                          style={{ color:"var(--muted)" }}>
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => removePosition(pos.id)} style={{ color:"var(--dim)" }}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Invested vs Current */}
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color:"var(--dim)" }}>Invertido</p>
                        <p className="text-sm font-bold" style={{ color:"var(--sub)" }}>
                          {investedVal != null ? `${currencySymbol}${investedVal.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}` : "—"}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color:"var(--dim)" }}>Acciones</p>
                        <p className="text-sm font-bold" style={{ color:"var(--sub)" }}>{pos.shares.toLocaleString("en-US")}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color:"var(--dim)" }}>Valor hoy</p>
                        <p className="text-sm font-extrabold" style={{ color:"var(--text)" }}>
                          {currentVal != null ? `${currencySymbol}${currentVal.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}` : "—"}
                        </p>
                      </div>
                    </div>

                    {/* Performance row */}
                    {diff !== null && pct !== null && (
                      <div className="flex items-center justify-between px-3 py-2 rounded-xl mb-2"
                           style={{ background: isUp ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)" }}>
                        <p className="text-xs font-semibold" style={{ color: isUp ? "#22c55e" : "#ef4444" }}>
                          {isUp ? "+" : ""}{currencySymbol}{Math.abs(diff).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
                        </p>
                        <p className="text-sm font-black" style={{ color: isUp ? "#22c55e" : "#ef4444" }}>
                          {isUp ? "+" : ""}{pct.toFixed(2)}%
                        </p>
                      </div>
                    )}

                    {/* Reveal price */}
                    <button
                      onClick={() => setRevealedPrices((prev) => {
                        const next = new Set(prev);
                        next.has(pos.id) ? next.delete(pos.id) : next.add(pos.id);
                        return next;
                      })}
                      className="flex items-center gap-1.5 text-[10px] font-semibold mt-1"
                      style={{ color:"var(--muted)" }}>
                      <Eye className="w-3 h-3" />
                      {priceRevealed
                        ? cp ? `${currencySymbol}${cp.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})} / acción · ocultar` : "Sin precio"
                        : "Ver precio por acción"}
                    </button>
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
            {calcResult && (() => {
              const maxTotal = Math.max(...calcResult.bars.map(b => b.total));
              const yrs = parseFloat(calcYears) || 0;
              const BAR_H = 120;
              return (
                <div className="mt-3 rounded-2xl border overflow-hidden" style={{ borderColor:"rgba(99,102,241,0.25)", background:"var(--card)" }}>
                  {/* Hero */}
                  <div className="p-5 text-center" style={{ background:"rgba(99,102,241,0.07)" }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color:"var(--muted)" }}>
                      Valor final en {calcYears} {parseInt(calcYears)===1?"año":"años"}
                    </p>
                    <p className="text-4xl font-black mb-3" style={{ color:"#6366f1" }}>{fmtMoney(calcResult.final)}</p>
                    <div className="flex justify-center gap-2">
                      <span className="text-xs font-bold px-3 py-1.5 rounded-full" style={{ background:"rgba(34,197,94,0.15)", color:"#22c55e" }}>
                        ×{calcResult.multiplier.toFixed(1)} tu dinero
                      </span>
                      <span className="text-xs font-bold px-3 py-1.5 rounded-full" style={{ background:"rgba(99,102,241,0.15)", color:"#a78bfa" }}>
                        +{calcResult.pct.toFixed(0)}% retorno
                      </span>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 border-t border-b" style={{ borderColor:"var(--border)" }}>
                    {[
                      { label:"Invertido",   val:fmtMoney(calcResult.invested), color:"var(--sub)" },
                      { label:"Ganancias",   val:`+${fmtMoney(calcResult.gain)}`, color:"#22c55e" },
                      { label:"Valor real*", val:fmtMoney(calcResult.realFinal),  color:"#f59e0b" },
                    ].map((st, i) => (
                      <div key={st.label} className={`text-center py-3 ${i>0?"border-l":""}`} style={{ borderColor:"var(--border)" }}>
                        <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color:"var(--muted)" }}>{st.label}</p>
                        <p className="text-xs font-extrabold" style={{ color:st.color }}>{st.val}</p>
                      </div>
                    ))}
                  </div>

                  {/* Bar chart */}
                  <div className="p-4">
                    <p className="text-[9px] font-bold uppercase tracking-wider mb-4" style={{ color:"var(--muted)" }}>Invertido vs Retorno por año</p>
                    <div className="flex items-end gap-2" style={{ height: BAR_H + 40 }}>
                      {calcResult.bars.map(bar => {
                        const barH   = Math.max(8, (bar.total/maxTotal)*BAR_H);
                        const invH   = bar.total>0 ? (bar.invested/bar.total)*barH : barH;
                        const retH   = barH - invH;
                        const beyond = yrs>0 && bar.year>yrs;
                        return (
                          <div key={bar.year} className="flex-1 flex flex-col items-center gap-1">
                            <span className="text-[8px] font-bold text-center leading-tight" style={{ color: beyond?"var(--dim)":"var(--sub)" }}>
                              {fmtMoney(bar.total)}
                            </span>
                            <div className="w-full flex flex-col justify-end rounded overflow-hidden"
                                 style={{ height:BAR_H, opacity: beyond?0.4:1 }}>
                              <div style={{ height:retH, background:"#22c55e" }} />
                              <div style={{ height:invH, background:"#6366f1" }} />
                            </div>
                            <span className="text-[9px] font-bold" style={{ color: beyond?"var(--dim)":"var(--muted)" }}>
                              {bar.year}a
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex gap-4 mt-3">
                      {[{color:"#6366f1",label:"Invertido"},{color:"#22c55e",label:"Retorno"}].map(l=>(
                        <div key={l.label} className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full" style={{ background:l.color }} />
                          <span className="text-[9px] font-semibold" style={{ color:"var(--muted)" }}>{l.label}</span>
                        </div>
                      ))}
                      <span className="text-[9px]" style={{ color:"var(--dim)" }}>Opaco = proyección</span>
                    </div>
                  </div>

                  {/* Disclaimer */}
                  <div className="mx-4 mb-4 flex items-start gap-1.5 px-3 py-2 rounded-lg"
                       style={{ background:"rgba(99,102,241,0.07)", border:"1px solid rgba(99,102,241,0.2)" }}>
                    <BarChart className="w-3 h-3 shrink-0 mt-0.5" style={{ color:"#a78bfa" }} />
                    <p className="text-[10px] leading-relaxed" style={{ color:"#a78bfa" }}>
                      Interés compuesto mensual. *Valor real descontando 3.5% inflación anual. Rendimientos pasados no garantizan futuros.
                    </p>
                  </div>
                </div>
              );
            })()}
          </section>

          <div className="h-8" />
          </div>} {/* end activeTab === "portfolio" */}

          {/* ══ HERRAMIENTAS TAB ══ */}
          {activeTab === "herramientas" && (
            <div className="space-y-4 pb-8">
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Herramientas de análisis avanzado para tu portafolio
              </p>

              {isPremium
                ? <MonthlyReport
                    positions={positions.map((p) => ({
                      ticker: p.ticker, name: p.name, shares: p.shares,
                      avg_cost: p.avgPrice,
                      current_price: prices[p.ticker]?.price ?? 0,
                      value: (p.shares || 0) * (prices[p.ticker]?.price ?? p.avgPrice),
                    }))}
                    isPremium={true}
                    onUpgrade={() => setPaywallOpen(true)}
                  />
                : <PremiumToolLockedWeb
                    title="Reporte Mensual"
                    tagline="Tu portafolio analizado con IA cada mes"
                    description="Genera un reporte profesional con rendimiento vs S&P 500, Sharpe ratio, volatilidad, mejores y peores posiciones del mes y nota personal de tu mentor."
                    icon={FileText}
                    color="#3b82f6"
                    benefits={[
                      { icon: "📊", text: "Rendimiento real vs S&P 500 y benchmarks" },
                      { icon: "📉", text: "Sharpe ratio, volatilidad y drawdown máximo" },
                      { icon: "🎓", text: "Nota personalizada de tu mentor cada mes" },
                      { icon: "✅", text: "3 acciones concretas para el mes siguiente" },
                    ]}
                    onUnlock={() => setPaywallOpen(true)}
                  />
              }

              <EarningsPanel
                positions={positions.map((p) => ({
                  ticker: p.ticker,
                  shares: p.shares,
                  avg_cost: p.avgPrice,
                }))}
                isPremium={isPremium}
                onUpgrade={() => setPaywallOpen(true)}
              />

              <WhatIfSimulator
                positions={positions.map((p) => ({
                  ticker: p.ticker, name: p.name, shares: p.shares,
                  avg_cost: p.avgPrice,
                  current_price: prices[p.ticker]?.price ?? 0,
                  value: (p.shares || 0) * (prices[p.ticker]?.price ?? p.avgPrice),
                }))}
                isPremium={isPremium}
                onUpgrade={() => setPaywallOpen(true)}
              />

              <WeeklyScreenerCard isPremium={isPremium} onUpgrade={() => setPaywallOpen(true)} tickers={positions.map(p => p.ticker)} />

              <DiarioDecisionesCard isPremium={isPremium} onUpgrade={() => setPaywallOpen(true)} />
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
              Los precios se mostrarán en la moneda que elijas. Los precios de mercado en tiempo real se convierten automáticamente.
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
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} />

      {/* Edit position modal */}
      {editingPos && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-xs rounded-2xl border overflow-hidden"
               style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="h-1" style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }} />
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="font-bold text-sm" style={{ color:"var(--text)" }}>Editar posición</p>
                <button onClick={() => setEditingPos(null)} style={{ color:"var(--muted)" }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold uppercase block mb-1" style={{ color:"var(--muted)" }}>Acciones / unidades</label>
                  <input
                    type="number" min="0" step="any"
                    value={editingPos.shares}
                    onChange={(e) => setEditingPos((p) => p ? { ...p, shares: e.target.value } : p)}
                    className="w-full rounded-xl border px-3 py-2 text-sm"
                    style={{ background:"var(--raised)", borderColor:"var(--border)", color:"var(--text)" }}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase block mb-1" style={{ color:"var(--muted)" }}>Precio promedio de compra ($)</label>
                  <input
                    type="number" min="0" step="any"
                    value={editingPos.avgPrice}
                    onChange={(e) => setEditingPos((p) => p ? { ...p, avgPrice: e.target.value } : p)}
                    className="w-full rounded-xl border px-3 py-2 text-sm"
                    style={{ background:"var(--raised)", borderColor:"var(--border)", color:"var(--text)" }}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase block mb-1" style={{ color:"var(--muted)" }}>Fecha de compra</label>
                  <input
                    type="date"
                    value={editingPos.purchaseDate}
                    max={new Date().toISOString().split("T")[0]}
                    onChange={(e) => setEditingPos((p) => p ? { ...p, purchaseDate: e.target.value } : p)}
                    className="w-full rounded-xl border px-3 py-2 text-sm"
                    style={{ background:"var(--raised)", borderColor:"var(--border)", color:"var(--text)" }}
                  />
                </div>
                <button
                  onClick={() => {
                    const shares = parseFloat(editingPos.shares);
                    const avgPrice = parseFloat(editingPos.avgPrice);
                    if (!isNaN(shares) && shares > 0) {
                      updatePosition(editingPos.id, {
                        shares,
                        avgPrice: isNaN(avgPrice) ? 0 : avgPrice,
                        purchaseDate: editingPos.purchaseDate,
                      });
                    }
                    setEditingPos(null);
                  }}
                  className="w-full py-2.5 rounded-xl text-sm font-bold text-white"
                  style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
                  Guardar cambios
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Merge modal */}
      {mergeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-sm rounded-2xl border overflow-hidden"
               style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="h-1" style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }} />
            <div className="p-5">
              <p className="font-bold text-sm mb-1" style={{ color: "var(--text)" }}>
                Ya tienes posiciones guardadas
              </p>
              <p className="text-xs mb-5" style={{ color: "var(--muted)" }}>
                Tienes {positions.length} posición{positions.length !== 1 ? "es" : ""} en tu portafolio.
                {" "}Se detectaron {pendingMerge.length} en la captura. ¿Qué deseas hacer?
              </p>
              <div className="space-y-2">
                <button
                  onClick={() => applyMerge("keep")}
                  className="w-full py-2.5 rounded-xl text-sm font-bold text-white"
                  style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
                  Mantener actuales y agregar nuevas
                </button>
                <button
                  onClick={() => applyMerge("replace")}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold border"
                  style={{ borderColor: "#ef4444", color: "#ef4444", background: "rgba(239,68,68,0.06)" }}>
                  Reemplazar todo con la captura
                </button>
                <button
                  onClick={() => { setMergeModalOpen(false); setPendingMerge([]); }}
                  className="w-full py-2 text-xs"
                  style={{ color: "var(--muted)" }}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
