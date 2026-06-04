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
  Cloud, CloudOff, Check,
} from "lucide-react";

// ─── Stress Test data ──────────────────────────────────────────────────────

// ─── Sector taxonomy ────────────────────────────────────────────────────────
const TICKER_SECTOR: Record<string, string> = {
  // Semiconductores
  NVDA:"Semiconductores",AMD:"Semiconductores",INTC:"Semiconductores",
  QCOM:"Semiconductores",AVGO:"Semiconductores",MU:"Semiconductores",
  TSM:"Semiconductores",AMAT:"Semiconductores",LRCX:"Semiconductores",
  KLAC:"Semiconductores",TXN:"Semiconductores",ADI:"Semiconductores",
  MCHP:"Semiconductores",ON:"Semiconductores",SWKS:"Semiconductores",
  SMCI:"Semiconductores",MRVL:"Semiconductores",ARM:"Semiconductores",
  WOLF:"Semiconductores",MPWR:"Semiconductores",SOXX:"Semiconductores",
  SMH:"Semiconductores",

  // Software
  MSFT:"Software",CRM:"Software",ADBE:"Software",ORCL:"Software",
  NOW:"Software",INTU:"Software",CDNS:"Software",SNPS:"Software",
  ANSS:"Software",WDAY:"Software",DDOG:"Software",TEAM:"Software",
  HUBS:"Software",VEEV:"Software",NET:"Software",ZS:"Software",
  OKTA:"Software",PANW:"Software",FTNT:"Software",MDB:"Software",
  SNOW:"Software",GTLB:"Software",ESTC:"Software",SMAR:"Software",
  SPLK:"Software",DOCN:"Software",

  // Tecnología (plataformas, ecosistemas consumer)
  AAPL:"Tecnología",GOOGL:"Tecnología",GOOG:"Tecnología",
  META:"Tecnología",AMZN:"Tecnología",SPOT:"Tecnología",
  SNAP:"Tecnología",PINS:"Tecnología",RBLX:"Tecnología",
  TWTR:"Tecnología",VGT:"Tecnología",

  // Inteligencia Artificial
  PLTR:"Inteligencia Artificial",AI:"Inteligencia Artificial",
  BBAI:"Inteligencia Artificial",SOUN:"Inteligencia Artificial",

  // Fintech
  PYPL:"Fintech",SQ:"Fintech",HOOD:"Fintech",SOFI:"Fintech",
  AFRM:"Fintech",UPST:"Fintech",NERDW:"Fintech",

  // eCommerce
  SHOP:"eCommerce",MELI:"eCommerce",SE:"eCommerce",
  BABA:"eCommerce",JD:"eCommerce",EBAY:"eCommerce",
  ETSY:"eCommerce",W:"eCommerce",CHWY:"eCommerce",
  CPNG:"eCommerce",

  // Consumo Discrecional
  TSLA:"Consumo Discrecional",NFLX:"Consumo Discrecional",
  NKE:"Consumo Discrecional",SBUX:"Consumo Discrecional",
  MCD:"Consumo Discrecional",HD:"Consumo Discrecional",
  LOW:"Consumo Discrecional",TGT:"Consumo Discrecional",
  TJX:"Consumo Discrecional",ROST:"Consumo Discrecional",
  ABNB:"Consumo Discrecional",BKNG:"Consumo Discrecional",
  YUM:"Consumo Discrecional",CMG:"Consumo Discrecional",
  DKNG:"Consumo Discrecional",DIS:"Consumo Discrecional",
  LVS:"Consumo Discrecional",MGM:"Consumo Discrecional",
  WYNN:"Consumo Discrecional",EXPE:"Consumo Discrecional",
  PTON:"Consumo Discrecional",UBER:"Consumo Discrecional",
  LYFT:"Consumo Discrecional",F:"Consumo Discrecional",
  GM:"Consumo Discrecional",RIVN:"Consumo Discrecional",
  LCID:"Consumo Discrecional",NIO:"Consumo Discrecional",

  // Consumo Básico
  WMT:"Consumo Básico",KO:"Consumo Básico",PG:"Consumo Básico",
  COST:"Consumo Básico",PEP:"Consumo Básico",MDLZ:"Consumo Básico",
  CLX:"Consumo Básico",KHC:"Consumo Básico",GIS:"Consumo Básico",
  HSY:"Consumo Básico",CL:"Consumo Básico",KMB:"Consumo Básico",
  EL:"Consumo Básico",K:"Consumo Básico",CHD:"Consumo Básico",
  TSN:"Consumo Básico",HRL:"Consumo Básico",

  // Salud (aseguradoras médicas + hospitales)
  UNH:"Salud",HCA:"Salud",CNC:"Salud",CVS:"Salud",
  CI:"Salud",HUM:"Salud",MOH:"Salud",ELV:"Salud",

  // Farmacéutica
  JNJ:"Farmacéutica",PFE:"Farmacéutica",ABBV:"Farmacéutica",
  MRK:"Farmacéutica",LLY:"Farmacéutica",BMY:"Farmacéutica",
  AZN:"Farmacéutica",GSK:"Farmacéutica",SNY:"Farmacéutica",
  NVO:"Farmacéutica",RHHBY:"Farmacéutica",

  // Biotecnología
  AMGN:"Biotecnología",GILD:"Biotecnología",REGN:"Biotecnología",
  VRTX:"Biotecnología",BIIB:"Biotecnología",MRNA:"Biotecnología",
  BNTX:"Biotecnología",ILMN:"Biotecnología",IONS:"Biotecnología",
  ALNY:"Biotecnología",SGEN:"Biotecnología",BEAM:"Biotecnología",

  // Financiero (bancos de inversión, gestoras, pagos)
  GS:"Financiero",MS:"Financiero",BX:"Financiero",
  KKR:"Financiero",APO:"Financiero",SCHW:"Financiero",
  V:"Financiero",MA:"Financiero",AXP:"Financiero",
  IBKR:"Financiero",

  // Bancario
  JPM:"Bancario",BAC:"Bancario",WFC:"Bancario",
  C:"Bancario",USB:"Bancario",PNC:"Bancario",
  TFC:"Bancario",FITB:"Bancario",HBAN:"Bancario",

  // Seguros
  BRK:"Seguros",PRU:"Seguros",MET:"Seguros",AFL:"Seguros",
  TRV:"Seguros",AIG:"Seguros",CB:"Seguros",ALL:"Seguros",
  PGR:"Seguros",UNM:"Seguros",

  // Energía
  XOM:"Energía",CVX:"Energía",COP:"Energía",OXY:"Energía",
  SLB:"Energía",HAL:"Energía",EOG:"Energía",PXD:"Energía",
  DVN:"Energía",PSX:"Energía",VLO:"Energía",MPC:"Energía",
  HES:"Energía",BKR:"Energía",MRO:"Energía",

  // Energía Renovable
  ENPH:"Energía Renovable",SEDG:"Energía Renovable",FSLR:"Energía Renovable",
  RUN:"Energía Renovable",PLUG:"Energía Renovable",BE:"Energía Renovable",
  NEE:"Energía Renovable",ITRI:"Energía Renovable",

  // Industriales
  CAT:"Industriales",DE:"Industriales",GE:"Industriales",
  HON:"Industriales",EMR:"Industriales",ETN:"Industriales",
  ITW:"Industriales",PH:"Industriales",ROK:"Industriales",
  XYL:"Industriales",AME:"Industriales",MMM:"Industriales",
  CARR:"Industriales",OTIS:"Industriales",

  // Aeroespacial & Defensa
  LMT:"Aeroespacial",RTX:"Aeroespacial",NOC:"Aeroespacial",
  GD:"Aeroespacial",BA:"Aeroespacial",TDG:"Aeroespacial",
  HEI:"Aeroespacial",AXON:"Aeroespacial",RKLB:"Aeroespacial",
  SPCE:"Aeroespacial",

  // Logística & Transporte
  UPS:"Logística",FDX:"Logística",CHRW:"Logística",
  EXPD:"Logística",GXO:"Logística",XPO:"Logística",
  ODFL:"Logística",SAIA:"Logística",JBHT:"Logística",
  LSTR:"Logística",WERN:"Logística",

  // Materiales
  LIN:"Materiales",APD:"Materiales",DOW:"Materiales",
  NEM:"Materiales",FCX:"Materiales",AA:"Materiales",
  CLF:"Materiales",NUE:"Materiales",MLM:"Materiales",
  VMC:"Materiales",ALB:"Materiales",SQM:"Materiales",
  MP:"Materiales",ECL:"Materiales",PPG:"Materiales",

  // Telecomunicaciones
  T:"Telecomunicaciones",VZ:"Telecomunicaciones",TMUS:"Telecomunicaciones",
  CMCSA:"Telecomunicaciones",CHTR:"Telecomunicaciones",

  // Medios & Entretenimiento
  WBD:"Medios",PARA:"Medios",FOX:"Medios",FOXA:"Medios",

  // Real Estate
  AMT:"Real Estate",CCI:"Real Estate",PLD:"Real Estate",
  EQR:"Real Estate",VTR:"Real Estate",SPG:"Real Estate",
  MAA:"Real Estate",PSA:"Real Estate",INVH:"Real Estate",
  VICI:"Real Estate",VNQ:"Real Estate",

  // Cripto / Blockchain
  COIN:"Cripto",MSTR:"Cripto",MARA:"Cripto",
  RIOT:"Cripto",HUT:"Cripto",CLSK:"Cripto",

  // ETF
  SPY:"ETF",QQQ:"ETF",VTI:"ETF",IVV:"ETF",VOO:"ETF",
  IWM:"ETF",GLD:"ETF",SLV:"ETF",USO:"ETF",TLT:"ETF",
  HYG:"ETF",LQD:"ETF",EEM:"ETF",EFA:"ETF",IEF:"ETF",
  DIA:"ETF",ARKK:"ETF",TQQQ:"ETF",SQQQ:"ETF",
};

const TICKER_RISK_OVERRIDE: Record<string, number> = {
  // Especulativo
  GME:96,AMC:96,BBBY:96,SPCE:90,
  MSTR:93,MARA:92,RIOT:92,COIN:90,CLSK:90,
  RIVN:88,LCID:88,NIO:86,RKLB:84,
  TQQQ:90,SQQQ:90,ARKK:82,
  // Alto riesgo
  TSLA:84,PLTR:82,SNAP:82,HOOD:82,RBLX:80,
  SOFI:78,AFRM:83,UPST:85,DKNG:80,
  NVDA:77,AMD:76,SMCI:80,ARM:78,SNOW:77,MDB:75,
  // Crecimiento moderado-alto
  SHOP:74,SQ:75,META:68,NFLX:68,UBER:70,LYFT:75,
  ABNB:72,DDOG:73,NET:72,ZS:72,BNTX:72,MRNA:72,
  // Blue chip tech
  AAPL:60,MSFT:58,GOOGL:60,AMZN:63,ORCL:55,
  ADBE:60,CRM:62,NOW:62,INTU:58,
  // Financiero establecido
  JPM:48,BAC:50,GS:55,MS:52,V:45,MA:45,AXP:50,
  SCHW:52,BX:58,
  // Salud / Farma
  JNJ:28,PFE:35,UNH:32,ABBV:38,LLY:42,AMGN:36,
  MRK:34,BMY:36,VRTX:65,REGN:60,
  // Consumo defensivo
  WMT:22,KO:18,PG:18,MCD:25,COST:30,SBUX:35,
  NKE:45,TGT:40,HD:38,
  // Energía
  XOM:48,CVX:48,COP:55,OXY:58,SLB:55,
  // Semis establecidos
  INTC:52,TXN:55,QCOM:62,AVGO:60,ADI:58,
  // ETF
  SPY:20,VOO:20,VTI:20,IVV:20,QQQ:38,IWM:45,GLD:30,
};

const SECTOR_RISK_BASE: Record<string, number> = {
  ETF:22,
  "Consumo Básico":20,
  "Real Estate":40,
  Seguros:40,
  "Farmacéutica":38,
  Salud:32,
  Telecomunicaciones:35,
  Logística:44,
  Bancario:48,
  Industriales:48,
  Aeroespacial:52,
  Financiero:52,
  Materiales:54,
  Medios:55,
  Energía:58,
  "Consumo Discrecional":55,
  eCommerce:62,
  Software:65,
  "Energía Renovable":68,
  Tecnología:70,
  Fintech:74,
  Biotecnología:72,
  "Inteligencia Artificial":82,
  Semiconductores:78,
  Cripto:92,
};

// Color por sector para la barra de diagnóstico
const SECTOR_COLOR: Record<string, string> = {
  Semiconductores:"#8b5cf6",
  Software:"#3b82f6",
  Tecnología:"#06b6d4",
  "Inteligencia Artificial":"#a855f7",
  Fintech:"#10b981",
  eCommerce:"#f59e0b",
  "Consumo Discrecional":"#f97316",
  "Consumo Básico":"#eab308",
  Salud:"#ec4899",
  "Farmacéutica":"#f43f5e",
  Biotecnología:"#c026d3",
  Financiero:"#475569",
  Bancario:"#64748b",
  Seguros:"#6b7280",
  Energía:"#ef4444",
  "Energía Renovable":"#22c55e",
  Industriales:"#78716c",
  Aeroespacial:"#0ea5e9",
  Logística:"#84cc16",
  Materiales:"#d97706",
  Telecomunicaciones:"#7c3aed",
  Medios:"#db2777",
  "Real Estate":"#14b8a6",
  Cripto:"#f59e0b",
  ETF:"#94a3b8",
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

const STRESS_SCENARIOS: Array<{
  id: string; name: string; icon: string; color: string; year: string; desc: string;
  drawdowns: Record<string, number>; default: number;
}> = [
  { id:"2008", name:"Crisis 2008", icon:"🏦", color:"#ef4444", year:"2008-09",
    desc:"Colapso del sistema financiero global",
    default:-42,
    drawdowns:{
      Semiconductores:-55, Software:-48, Tecnología:-52, "Inteligencia Artificial":-52,
      Fintech:-55, eCommerce:-50,
      "Consumo Discrecional":-42, "Consumo Básico":-20,
      Salud:-18, "Farmacéutica":-22, Biotecnología:-30,
      Bancario:-80, Financiero:-68, Seguros:-55,
      Energía:-55, "Energía Renovable":-60,
      Industriales:-42, Aeroespacial:-40, Logística:-40, Materiales:-55,
      Telecomunicaciones:-32, Medios:-42, "Real Estate":-65,
      Cripto:-55, ETF:-38,
    }},
  { id:"covid", name:"COVID-19", icon:"🦠", color:"#f97316", year:"Feb-Mar 2020",
    desc:"Crash de 33 días, caída brusca y rápida",
    default:-34,
    drawdowns:{
      Semiconductores:-35, Software:-28, Tecnología:-32, "Inteligencia Artificial":-30,
      Fintech:-38, eCommerce:18,
      "Consumo Discrecional":-50, "Consumo Básico":-12,
      Salud:-10, "Farmacéutica":-15, Biotecnología:15,
      Bancario:-48, Financiero:-42, Seguros:-38,
      Energía:-65, "Energía Renovable":-38,
      Industriales:-40, Aeroespacial:-55, Logística:-32, Materiales:-40,
      Telecomunicaciones:-22, Medios:-45, "Real Estate":-40,
      Cripto:-50, ETF:-34,
    }},
  { id:"tech2022", name:"Tech Crash '22", icon:"📉", color:"#f59e0b", year:"2022",
    desc:"Alza de tasas aplasta valuaciones tech",
    default:-20,
    drawdowns:{
      Semiconductores:-62, Software:-58, Tecnología:-52, "Inteligencia Artificial":-60,
      Fintech:-70, eCommerce:-55,
      "Consumo Discrecional":-18, "Consumo Básico":-10,
      Salud:-8, "Farmacéutica":-10, Biotecnología:-32,
      Bancario:-18, Financiero:-22, Seguros:-12,
      Energía:45, "Energía Renovable":-35,
      Industriales:-12, Aeroespacial:-8, Logística:-20, Materiales:-20,
      Telecomunicaciones:-28, Medios:-40, "Real Estate":-25,
      Cripto:-75, ETF:-18,
    }},
  { id:"fed", name:"Fed +1%", icon:"🏛️", color:"#6366f1", year:"Escenario",
    desc:"Subida sorpresiva de 100pb en tasas",
    default:-12,
    drawdowns:{
      Semiconductores:-22, Software:-25, Tecnología:-20, "Inteligencia Artificial":-28,
      Fintech:-28, eCommerce:-22,
      "Consumo Discrecional":-12, "Consumo Básico":-8,
      Salud:-5, "Farmacéutica":-8, Biotecnología:-15,
      Bancario:8, Financiero:5, Seguros:3,
      Energía:-8, "Energía Renovable":-20,
      Industriales:-10, Aeroespacial:-8, Logística:-10, Materiales:-12,
      Telecomunicaciones:-15, Medios:-10, "Real Estate":-20,
      Cripto:-35, ETF:-12,
    }},
  { id:"bull", name:"Bull Market", icon:"🚀", color:"#22c55e", year:"Escenario",
    desc:"Año de recuperación y euforia inversora",
    default:22,
    drawdowns:{
      Semiconductores:55, Software:40, Tecnología:38, "Inteligencia Artificial":60,
      Fintech:42, eCommerce:38,
      "Consumo Discrecional":25, "Consumo Básico":12,
      Salud:18, "Farmacéutica":20, Biotecnología:32,
      Bancario:25, Financiero:28, Seguros:18,
      Energía:22, "Energía Renovable":40,
      Industriales:22, Aeroespacial:28, Logística:20, Materiales:25,
      Telecomunicaciones:15, Medios:20, "Real Estate":25,
      Cripto:80, ETF:25,
    }},
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

// ─── Portfolio historical chart ────────────────────────────────────────────

type ChartPoint = { date: string; pct: number; value: number };

function PortfolioSparkline({ history, color }: { history: ChartPoint[]; color: string }) {
  if (history.length < 2) return null;

  const W = 400;
  const H = 110;
  const PY = 6;

  const values = history.map((h) => h.pct);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const spread = maxV - minV || Math.abs(maxV) || 1;
  const lo = minV - spread * 0.12;
  const hi = maxV + spread * 0.12;
  const range = hi - lo;

  const toX = (i: number) => (i / (history.length - 1)) * W;
  const toY = (v: number) => PY + ((hi - v) / range) * (H - PY * 2);
  const zeroY = Math.max(PY, Math.min(H - PY, toY(0)));

  const pts = history.map((h, i) => `${toX(i).toFixed(1)},${toY(h.pct).toFixed(1)}`);
  const linePath = "M" + pts.join("L");
  const lastX = toX(history.length - 1).toFixed(1);
  const lastY = toY(values[values.length - 1]).toFixed(1);
  const areaPath = `${linePath}L${lastX},${zeroY.toFixed(1)}L0,${zeroY.toFixed(1)}Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: 110, display: "block" }}>
      <defs>
        <linearGradient id="psg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {/* Zero baseline */}
      <line x1="0" y1={zeroY} x2={W} y2={zeroY}
        stroke={color} strokeWidth="0.7" strokeDasharray="4,4" strokeOpacity="0.3" />
      {/* Area fill */}
      <path d={areaPath} fill="url(#psg)" />
      {/* Line */}
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.8"
        strokeLinejoin="round" strokeLinecap="round" />
      {/* End dot */}
      <circle cx={lastX} cy={lastY} r="5" fill={color} fillOpacity="0.25" />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium";
  const [paywallOpen, setPaywallOpen] = useState(false);
  const {
    positions, addPosition, removePosition, updatePosition, setPositions,
    clearPortfolio, portfolioCurrency, setCurrency,
    loadFromServer, syncStatus, lastSaved,
  } = usePortfolioStore();
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

  // Cargar portafolio del servidor al montar — garantiza sincronía entre dispositivos
  useEffect(() => {
    if (isAuthenticated) loadFromServer();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

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
  type PeriodReturn = { pct: number; avg_pct?: number; amount: number; date?: string; breakdown?: Record<string, number>; spy_pct?: number };
  const PERIODS = [
    { key: "since_purchase", label: "Compra" },
    { key: "1d",  label: "1D"  }, { key: "5d",  label: "5D"  },
    { key: "1mo", label: "1M"  }, { key: "3mo", label: "3M"  },
    { key: "6mo", label: "6M"  }, { key: "ytd", label: "YTD" },
    { key: "1y",  label: "1A"  }, { key: "3y",  label: "3A"  },
    { key: "5y",  label: "5A"  }, { key: "max", label: "MÁX" },
  ] as const;
  type PeriodKey = typeof PERIODS[number]["key"];
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodKey>("1y");
  const [periodReturns, setPeriodReturns] = useState<Record<string, PeriodReturn>>({});
  const [loadingReturns, setLoadingReturns] = useState(false);
  const [breakdownSort, setBreakdownSort] = useState<"desc" | "asc">("desc");

  // Chart state
  type ChartData = { history: ChartPoint[]; period_pct: number; period_amount: number };
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [chartLoading, setChartLoading] = useState(false);

  const posPayload = useCallback(
    () => positions.map((p) => ({
      ticker: p.ticker, shares: p.shares,
      purchase_date: p.purchaseDate ?? null,
      avg_price: p.avgPrice ?? null,
    })),
    [positions]
  );

  const fetchReturns = useCallback((showLoader = false) => {
    if (positions.length === 0) return;
    if (showLoader) setLoadingReturns(true);
    marketApi.getPortfolioReturns(posPayload())
      .then((res: { data: { returns?: Record<string, PeriodReturn>; inferred_dates?: Record<string, string> } }) => {
        setPeriodReturns(res.data.returns ?? {});
        if (showLoader) {
          const inferred = res.data.inferred_dates ?? {};
          for (const [ticker, date] of Object.entries(inferred)) {
            const pos = positions.find((p) => p.ticker === ticker && !p.purchaseDate);
            if (pos) updatePosition(pos.id, { purchaseDate: date });
          }
        }
      })
      .catch(() => {})
      .finally(() => { if (showLoader) setLoadingReturns(false); });
  }, [positions, posPayload, updatePosition]);

  const fetchChart = useCallback((resetChart = false) => {
    if (positions.length === 0) return;
    if (resetChart) { setChartData(null); setChartLoading(true); }
    marketApi.getPortfolioChart(posPayload(), selectedPeriod)
      .then((res: { data: ChartData }) => setChartData(res.data))
      .catch(() => {})
      .finally(() => { if (resetChart) setChartLoading(false); });
  }, [positions, selectedPeriod, posPayload]);

  // Initial load
  useEffect(() => { fetchReturns(true); }, [positions.length]);
  useEffect(() => { fetchChart(true); }, [selectedPeriod, positions.length]);

  // Auto-refresh en tiempo real — returns cada 30s, chart cada 60s
  useEffect(() => {
    if (positions.length === 0) return;
    const ri = setInterval(() => fetchReturns(false), 30_000);
    const ci = setInterval(() => fetchChart(false), 60_000);
    return () => { clearInterval(ri); clearInterval(ci); };
  }, [positions.length, fetchReturns, fetchChart]);

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

        {/* Sync status + refresh */}
        <div className="flex items-center gap-2">
          {syncStatus === "syncing" && (
            <div className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: "var(--muted)" }}>
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span className="hidden sm:inline">Guardando...</span>
            </div>
          )}
          {syncStatus === "saved" && (
            <div className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: "#22c55e" }}>
              <Check className="w-3 h-3" />
              <span className="hidden sm:inline">Guardado</span>
            </div>
          )}
          {syncStatus === "error" && (
            <div className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: "#ef4444" }}>
              <CloudOff className="w-3 h-3" />
              <span className="hidden sm:inline">Error al guardar</span>
            </div>
          )}
          {syncStatus === "idle" && lastSaved && (
            <div className="flex items-center gap-1 text-[10px]" style={{ color: "var(--dim)" }}
                 title={`Guardado: ${new Date(lastSaved).toLocaleTimeString()}`}>
              <Cloud className="w-3 h-3" />
            </div>
          )}
          <button onClick={fetchPrices} className="p-1.5 rounded-lg transition-colors"
                  style={{ color: "var(--muted)" }} title="Actualizar precios">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
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

          {/* ── Acciones del portafolio ── */}
          <section>
            {/* Cloud sync info + vaciar */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0"
                     style={{ background: "rgba(34,197,94,0.12)" }}>
                  <Cloud className="w-3.5 h-3.5" style={{ color: "#22c55e" }} />
                </div>
                <div>
                  <p className="text-xs font-bold" style={{ color: "var(--text)" }}>Portafolio en la nube</p>
                  <p className="text-[10px]" style={{ color: "var(--muted)" }}>
                    Sincronizado en todos tus dispositivos
                  </p>
                </div>
              </div>
              {positions.length > 0 && (
                <button
                  onClick={() => {
                    if (window.confirm(`¿Eliminar las ${positions.length} posiciones de tu portafolio? Esta acción no se puede deshacer.`)) {
                      clearPortfolio();
                    }
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-colors"
                  style={{ color: "#ef4444", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                  <Trash2 className="w-3 h-3" /> Vaciar
                </button>
              )}
            </div>

            {/* Botones principales: Agregar posición + Importar captura */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              {/* Agregar posición — acción primaria */}
              <button
                onClick={() => { setShowForm(!showForm); setScreenshotPreview(null); }}
                className="flex items-center justify-center gap-2 py-3.5 rounded-2xl font-bold text-sm transition-all"
                style={{
                  background: showForm ? "var(--accent-glow)" : "var(--grad-green)",
                  color: "white",
                  border: showForm ? "2px solid var(--accent-l)" : "none",
                  boxShadow: showForm ? "none" : "var(--shadow-accent-sm)",
                }}>
                <Plus className="w-4 h-4" />
                Agregar posición
              </button>

              {/* Importar captura — con drag-drop integrado */}
              <div
                onClick={() => !screenshotAnalyzing && screenshotInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); if (!screenshotAnalyzing) setIsDragOver(true); }}
                onDragEnter={(e) => { e.preventDefault(); if (!screenshotAnalyzing) setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault(); setIsDragOver(false);
                  if (screenshotAnalyzing) return;
                  const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
                  if (files.length) processScreenshotFiles(files);
                }}
                className="flex items-center justify-center gap-2 py-3.5 rounded-2xl font-bold text-sm transition-all cursor-pointer select-none"
                style={{
                  background: isDragOver ? "rgba(0,168,94,0.08)" : "var(--raised)",
                  border: `2px ${isDragOver ? "dashed" : "solid"} ${isDragOver ? "var(--accent)" : "var(--border)"}`,
                  color: "var(--sub)",
                  opacity: screenshotAnalyzing ? 0.7 : 1,
                }}>
                {screenshotAnalyzing ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /><span>{screenshotProgress || "Analizando..."}</span></>
                ) : isDragOver ? (
                  <><Upload className="w-4 h-4" /><span>¡Suelta aquí!</span></>
                ) : (
                  <><Upload className="w-4 h-4" /><span>Importar captura</span></>
                )}
              </div>
            </div>

            <input ref={screenshotInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleScreenshotChange} />

            {/* Hint pegado / arrastrar — sutil */}
            {!screenshotAnalyzing && !screenshotPreview && !showForm && (
              <div className="flex items-center gap-2 text-[10px] px-1 mb-1"
                   style={{ color: "var(--dim)" }}>
                <span>📋</span>
                <span>También puedes pegar con{" "}
                  <kbd className="px-1 py-0.5 rounded font-mono text-[9px]"
                       style={{ background: "var(--raised)", color: "var(--muted)" }}>⌘V</kbd>
                  {" "}o arrastrar imágenes directamente
                </span>
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

            {/* Formulario manual — se expande al hacer click en "Agregar posición" */}
            {showForm && (
              <div className="rounded-2xl border-2 overflow-hidden"
                   style={{ borderColor: "var(--accent-l)30" }}>
                <div className="h-0.5" style={{ background: "var(--grad-green)" }} />
                <div className="p-4" style={{ background: "var(--card)" }}>
                  <p className="text-sm font-extrabold mb-3" style={{ color: "var(--text)" }}>
                    Agregar posición al portafolio
                  </p>
                  <input
                    value={form.ticker}
                    onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })}
                    className="w-full rounded-xl border px-3 py-2.5 text-sm mb-2 outline-none font-bold tracking-wide"
                    style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                    placeholder="Ticker — ej. AAPL, NVDA, SPY"
                    autoFocus
                  />
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div>
                      <label className="text-[9px] font-bold uppercase tracking-wider block mb-1" style={{ color: "var(--muted)" }}>Acciones / unidades</label>
                      <input value={form.shares} onChange={(e) => setForm({ ...form, shares: e.target.value })}
                             type="number" min="0"
                             className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                             style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                             placeholder="10" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold uppercase tracking-wider block mb-1" style={{ color: "var(--muted)" }}>Precio promedio ($)</label>
                      <input value={form.avgPrice} onChange={(e) => setForm({ ...form, avgPrice: e.target.value })}
                             type="number" min="0"
                             className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                             style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                             placeholder="150.00" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[9px] font-bold uppercase tracking-wider block mb-1" style={{ color: "var(--muted)" }}>Fecha de compra (opcional)</label>
                    <input value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })}
                           type="date" max={new Date().toISOString().split("T")[0]}
                           className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none mb-3"
                           style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setShowForm(false)}
                            className="flex-1 py-2.5 rounded-xl border text-sm font-semibold"
                            style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                      Cancelar
                    </button>
                    <button onClick={handleAdd} disabled={addingLoading}
                            className="flex-[2] py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2"
                            style={{ background: "var(--grad-green)" }}>
                      {addingLoading
                        ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Agregando...</>
                        : <><Plus className="w-3.5 h-3.5" /> Agregar al portafolio</>
                      }
                    </button>
                  </div>
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
              {/* ── Rendimiento histórico del portafolio ── */}
              <div className="mb-4">
                <p className="text-[10px] font-extrabold uppercase tracking-wider mb-2"
                   style={{ color: "var(--dim)" }}>
                  Rendimiento histórico · Yahoo Finance
                </p>

                {/* Grid de períodos estándar — todos visibles de un vistazo */}
                <div className="grid grid-cols-5 gap-1.5 mb-2">
                  {PERIODS.filter(({ key }) => key !== "since_purchase").map(({ key, label }) => {
                    const ret = periodReturns[key];
                    const isSel = selectedPeriod === key;
                    const isUp = ret ? ret.pct >= 0 : null;
                    const valColor = isUp === null ? "var(--dim)" : isUp ? "#22c55e" : "#ef4444";
                    return (
                      <button
                        key={key}
                        onClick={() => setSelectedPeriod(key)}
                        className="flex flex-col items-center py-2.5 rounded-xl transition-all"
                        style={{
                          background: isSel
                            ? (isUp === null ? "rgba(0,168,94,0.10)" : isUp ? "rgba(34,197,94,0.13)" : "rgba(239,68,68,0.13)")
                            : "var(--raised)",
                          border: `1px solid ${isSel
                            ? (isUp === null ? "rgba(0,168,94,0.35)" : isUp ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)")
                            : "transparent"}`,
                        }}>
                        <span className="text-[10px] font-semibold mb-0.5"
                              style={{ color: isSel ? "var(--sub)" : "var(--muted)" }}>
                          {label}
                        </span>
                        {loadingReturns ? (
                          <span className="text-[10px]" style={{ color: "var(--dim)" }}>···</span>
                        ) : ret ? (
                          <span className="text-[11px] font-black" style={{ color: valColor }}>
                            {isUp ? "+" : ""}{ret.pct.toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-[10px]" style={{ color: "var(--dim)" }}>—</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* "Desde compra" — siempre visible si hay datos */}
                {(() => {
                  const r = periodReturns["since_purchase"];
                  const up = r ? r.pct >= 0 : true;
                  const isSel = selectedPeriod === "since_purchase";
                  const avgUp = r?.avg_pct !== undefined ? r.avg_pct >= 0 : up;
                  return (
                    <button
                      onClick={() => setSelectedPeriod("since_purchase")}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl mb-2 transition-all"
                      style={{
                        background: isSel ? (up ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)") : "var(--raised)",
                        border: `1px solid ${isSel ? (up ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)") : "var(--border)"}`,
                      }}>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wide"
                              style={{ color: "var(--muted)" }}>Desde compra</span>
                        {r?.date && (
                          <span className="text-[9px]" style={{ color: "var(--dim)" }}>· {r.date}</span>
                        )}
                      </div>
                      {r ? (
                        <div className="flex items-center gap-3">
                          {r.avg_pct !== undefined && (
                            <div className="flex flex-col items-end">
                              <span className="text-[9px] font-semibold" style={{ color: "var(--dim)" }}>promedio</span>
                              <span className="text-xs font-black" style={{ color: avgUp ? "#22c55e" : "#ef4444" }}>
                                {avgUp ? "+" : ""}{r.avg_pct.toFixed(2)}%
                              </span>
                            </div>
                          )}
                          <div className="flex flex-col items-end">
                            <span className="text-[9px] font-semibold" style={{ color: "var(--dim)" }}>portafolio</span>
                            <span className="text-sm font-black" style={{ color: up ? "#22c55e" : "#ef4444" }}>
                              {up ? "+" : ""}{r.pct.toFixed(2)}%
                            </span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-[10px]" style={{ color: "var(--dim)" }}>
                          {loadingReturns ? "···" : "Agrega precio de compra"}
                        </span>
                      )}
                    </button>
                  );
                })()}

                {/* Tarjeta principal: gráfica + stats + breakdown */}
                {(() => {
                  const r = periodReturns[selectedPeriod];
                  // Prefer returns pct (cost-adjusted, exact) over chart period_pct
                  const displayPct   = r?.pct !== undefined ? r.pct : chartData?.period_pct;
                  const displayAmt   = r?.amount !== undefined ? r.amount : chartData?.period_amount;
                  const up           = displayPct !== undefined ? displayPct >= 0 : true;
                  const color        = up ? "#22c55e" : "#ef4444";
                  const periodLabel  = PERIODS.find((p) => p.key === selectedPeriod)?.label ?? "";
                  const breakdown    = r?.breakdown;
                  const bEntries     = breakdown
                    ? Object.entries(breakdown).sort((a, b) =>
                        breakdownSort === "desc" ? b[1] - a[1] : a[1] - b[1]
                      )
                    : [];
                  const maxAbs = bEntries.length > 0
                    ? Math.max(...bEntries.map(([, p]) => Math.abs(p))) : 1;

                  return (
                    <div className="rounded-2xl border overflow-hidden"
                         style={{ borderColor: `${color}30`, background: "var(--card)" }}>
                      {/* Franja de color */}
                      <div className="h-0.5"
                           style={{ background: `linear-gradient(90deg,${color},${color}66)` }} />

                      {/* Header stats */}
                      <div className="px-4 pt-4 pb-1">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider"
                               style={{ color: "var(--muted)" }}>
                              Rendimiento · {periodLabel}
                            </p>
                            {r?.date && (
                              <p className="text-[10px] mt-0.5" style={{ color: "var(--dim)" }}>
                                desde {r.date}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            {displayPct !== undefined ? (
                              <>
                                <p className="text-2xl font-black leading-none" style={{ color }}>
                                  {up ? "+" : ""}{displayPct.toFixed(2)}%
                                </p>
                                {displayAmt !== undefined && (
                                  <p className="text-sm font-bold mt-0.5" style={{ color }}>
                                    {up ? "+" : ""}{currencySymbol}
                                    {Math.abs(displayAmt).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </p>
                                )}
                              </>
                            ) : chartLoading ? (
                              <span className="text-sm" style={{ color: "var(--muted)" }}>···</span>
                            ) : null}
                          </div>
                        </div>
                        {/* S&P 500 comparison */}
                        {r?.spy_pct !== undefined && displayPct !== undefined && (
                          <div className="flex items-center gap-2 mt-2 pt-2 border-t"
                               style={{ borderColor: "var(--border)" }}>
                            <span className="text-[10px] font-semibold" style={{ color: "var(--muted)" }}>
                              vs S&P 500
                            </span>
                            <span className="text-[11px] font-bold"
                                  style={{ color: r.spy_pct >= 0 ? "#22c55e" : "#ef4444" }}>
                              {r.spy_pct >= 0 ? "+" : ""}{r.spy_pct.toFixed(2)}%
                            </span>
                            {(() => {
                              const diff = displayPct - r.spy_pct;
                              const beats = diff >= 0;
                              return (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                                      style={{
                                        background: beats ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                                        color: beats ? "#22c55e" : "#ef4444",
                                      }}>
                                  {beats ? "▲" : "▼"} {Math.abs(diff).toFixed(2)}% {beats ? "mejor" : "peor"}
                                </span>
                              );
                            })()}
                          </div>
                        )}
                      </div>

                      {/* Gráfica histórica */}
                      <div className="px-3 pb-1">
                        {chartLoading ? (
                          <div className="h-[110px] flex items-center justify-center gap-2 text-xs"
                               style={{ color: "var(--muted)" }}>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            Cargando datos históricos...
                          </div>
                        ) : chartData && chartData.history.length >= 2 ? (
                          <PortfolioSparkline history={chartData.history} color={color} />
                        ) : !chartLoading ? (
                          <div className="h-[110px] flex items-center justify-center text-xs"
                               style={{ color: "var(--dim)" }}>
                            Sin datos históricos para este período
                          </div>
                        ) : null}
                      </div>

                      {/* Fuente */}
                      <div className="px-4 pb-3">
                        <p className="text-[9px]" style={{ color: "var(--dim)" }}>
                          Yahoo Finance · precios ajustados por splits y dividendos
                        </p>
                      </div>

                      {/* Breakdown por posición */}
                      {bEntries.length > 0 && (
                        <div className="px-4 pb-4 pt-2 border-t space-y-2"
                             style={{ borderColor: "var(--border)" }}>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[9px] font-bold uppercase tracking-widest"
                               style={{ color: "var(--dim)" }}>
                              Rendimiento por posición · {periodLabel}
                            </p>
                            <button
                              onClick={() => setBreakdownSort(s => s === "desc" ? "asc" : "desc")}
                              className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all"
                              style={{ background: "var(--raised)", color: "var(--muted)" }}>
                              {breakdownSort === "desc" ? "▲ Verde → Rojo" : "▼ Rojo → Verde"}
                            </button>
                          </div>
                          {bEntries.map(([ticker, pct]) => {
                            const isPos = pct >= 0;
                            const barW  = maxAbs > 0 ? Math.round((Math.abs(pct) / maxAbs) * 100) : 0;
                            return (
                              <div key={ticker} className="flex items-center gap-2">
                                <span className="text-[11px] font-extrabold shrink-0 w-12"
                                      style={{ color: "var(--text)" }}>
                                  {ticker}
                                </span>
                                <div className="flex-1 h-1.5 rounded-full overflow-hidden"
                                     style={{ background: "var(--raised)" }}>
                                  <div className="h-full rounded-full"
                                       style={{ width: `${barW}%`, background: isPos ? "#22c55e" : "#ef4444",
                                                transition: "width 0.5s ease" }} />
                                </div>
                                <span className="text-[11px] font-bold shrink-0 w-16 text-right"
                                      style={{ color: isPos ? "#22c55e" : "#ef4444" }}>
                                  {isPos ? "+" : ""}{pct.toFixed(2)}%
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
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
                    {Object.entries(diagnosis.sectorPcts).sort((a,b)=>b[1]-a[1]).map(([sector,pct]) => {
                      const col = SECTOR_COLOR[sector] ?? "#94a3b8";
                      return (
                        <span key={sector} className="text-xs px-2.5 py-1 rounded-lg font-bold"
                              style={{ background:`${col}18`, border:`1px solid ${col}40`, color: col }}>
                          {sector} {pct}%
                        </span>
                      );
                    })}
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
