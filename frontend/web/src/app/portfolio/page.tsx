"use client";

import AppSidebar from "@/components/AppSidebar";
import TourSpotlight from "@/components/TourSpotlight";
import StockAvatar from "@/components/StockAvatar";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { market as marketApi } from "@/lib/api";
import { useAuthStore, useSubscriptionStore, useProfileStore } from "@/lib/store";
import { getUserLevel, isAtLeast } from "@/lib/userLevel";
import { usePortfolioStore, type Position } from "@/lib/portfolioStore";
import AdvancedStockTable from "@/components/AdvancedStockTable";
import type { AdvancedRow } from "@/components/AdvancedStockTable";
import StockDetailModal from "@/components/StockDetailModal";
import MonthlyReport from "@/components/MonthlyReport";
import WeeklyScreenerCard from "@/components/WeeklyScreenerCard";
import EarningsPanel from "@/components/EarningsPanel";
import PremiumToolLockedWeb from "@/components/PremiumToolLocked";
import PaywallModal from "@/components/PaywallModal";
import GuidedSteps from "@/components/GuidedSteps";
import PremiumBadge from "@/components/PremiumBadge";
import FirstStepsFlow from "@/components/FirstStepsFlow";
import MarketTickerBar from "@/components/MarketTickerBar";
import BrokerConnectModal from "@/components/BrokerConnectModal";
import { useUpsellStore } from "@/lib/upsellStore";
import {
  PieChart, Menu, X, Upload, Plus, Trash2,
  BarChart, Calculator, Shield, Sparkles, RefreshCw, AlertTriangle, FileText, Pencil, Eye,
  Cloud, CloudOff, Check, BarChart2, TrendingUp, TrendingDown, GraduationCap, CheckSquare, Bell, Users, Share2,
  ChevronDown, ChevronUp,
} from "lucide-react";

// ─── Stress Test data ──────────────────────────────────────────────────────

// ─── Sector taxonomy ────────────────────────────────────────────────────────
const TICKER_SECTOR: Record<string, string> = {
  // ── Tecnología (Technology) ────────────────────────────────────────────────
  // Semiconductors
  NVDA:"Tecnología",AMD:"Tecnología",INTC:"Tecnología",
  QCOM:"Tecnología",AVGO:"Tecnología",MU:"Tecnología",
  TSM:"Tecnología",AMAT:"Tecnología",LRCX:"Tecnología",
  KLAC:"Tecnología",TXN:"Tecnología",ADI:"Tecnología",
  MCHP:"Tecnología",ON:"Tecnología",SWKS:"Tecnología",
  SMCI:"Tecnología",MRVL:"Tecnología",ARM:"Tecnología",
  WOLF:"Tecnología",MPWR:"Tecnología",SOXX:"Tecnología",SMH:"Tecnología",
  // Software – Infrastructure & Application
  MSFT:"Tecnología",CRM:"Tecnología",ADBE:"Tecnología",ORCL:"Tecnología",
  NOW:"Tecnología",INTU:"Tecnología",CDNS:"Tecnología",SNPS:"Tecnología",
  ANSS:"Tecnología",WDAY:"Tecnología",DDOG:"Tecnología",TEAM:"Tecnología",
  HUBS:"Tecnología",VEEV:"Tecnología",NET:"Tecnología",ZS:"Tecnología",
  OKTA:"Tecnología",PANW:"Tecnología",FTNT:"Tecnología",MDB:"Tecnología",
  SNOW:"Tecnología",GTLB:"Tecnología",ESTC:"Tecnología",SMAR:"Tecnología",
  SPLK:"Tecnología",DOCN:"Tecnología",
  // Consumer Electronics & AI platforms
  AAPL:"Tecnología",
  PLTR:"Tecnología",AI:"Tecnología",BBAI:"Tecnología",SOUN:"Tecnología",
  SHOP:"Tecnología",VGT:"Tecnología",
  // Solar (classified under Technology per Yahoo Finance)
  ENPH:"Tecnología",SEDG:"Tecnología",FSLR:"Tecnología",

  // ── Comunicaciones (Communication Services) ────────────────────────────────
  // Internet Content & Information
  GOOGL:"Comunicaciones",GOOG:"Comunicaciones",
  META:"Comunicaciones",SNAP:"Comunicaciones",PINS:"Comunicaciones",
  RBLX:"Comunicaciones",SPOT:"Comunicaciones",
  // Entertainment
  NFLX:"Comunicaciones",DIS:"Comunicaciones",
  WBD:"Comunicaciones",PARA:"Comunicaciones",FOX:"Comunicaciones",FOXA:"Comunicaciones",
  // Telecom Services
  T:"Comunicaciones",VZ:"Comunicaciones",TMUS:"Comunicaciones",
  CMCSA:"Comunicaciones",CHTR:"Comunicaciones",

  // ── Consumo Discrecional (Consumer Discretionary) ─────────────────────────
  // Internet Retail
  AMZN:"Consumo Discrecional",
  MELI:"Consumo Discrecional",SE:"Consumo Discrecional",
  BABA:"Consumo Discrecional",JD:"Consumo Discrecional",
  EBAY:"Consumo Discrecional",ETSY:"Consumo Discrecional",
  W:"Consumo Discrecional",CHWY:"Consumo Discrecional",CPNG:"Consumo Discrecional",
  // Auto Manufacturers
  TSLA:"Consumo Discrecional",
  F:"Consumo Discrecional",GM:"Consumo Discrecional",
  RIVN:"Consumo Discrecional",LCID:"Consumo Discrecional",NIO:"Consumo Discrecional",
  // Restaurants
  MCD:"Consumo Discrecional",SBUX:"Consumo Discrecional",
  CMG:"Consumo Discrecional",YUM:"Consumo Discrecional",
  // Home Improvement Retail
  HD:"Consumo Discrecional",LOW:"Consumo Discrecional",
  // Specialty & Apparel Retail
  NKE:"Consumo Discrecional",TGT:"Consumo Discrecional",
  TJX:"Consumo Discrecional",ROST:"Consumo Discrecional",
  // Travel & Leisure
  ABNB:"Consumo Discrecional",BKNG:"Consumo Discrecional",EXPE:"Consumo Discrecional",
  // Gambling & Casinos
  LVS:"Consumo Discrecional",MGM:"Consumo Discrecional",
  WYNN:"Consumo Discrecional",DKNG:"Consumo Discrecional",
  // Other
  PTON:"Consumo Discrecional",
  UBER:"Consumo Discrecional",LYFT:"Consumo Discrecional",

  // ── Consumo Básico (Consumer Staples) ─────────────────────────────────────
  WMT:"Consumo Básico",KO:"Consumo Básico",PG:"Consumo Básico",
  COST:"Consumo Básico",PEP:"Consumo Básico",MDLZ:"Consumo Básico",
  CLX:"Consumo Básico",KHC:"Consumo Básico",GIS:"Consumo Básico",
  HSY:"Consumo Básico",CL:"Consumo Básico",KMB:"Consumo Básico",
  EL:"Consumo Básico",K:"Consumo Básico",CHD:"Consumo Básico",
  TSN:"Consumo Básico",HRL:"Consumo Básico",
  PM:"Consumo Básico",MO:"Consumo Básico",

  // ── Salud (Healthcare) ─────────────────────────────────────────────────────
  // Healthcare Plans & Hospitals
  UNH:"Salud",HCA:"Salud",CNC:"Salud",CVS:"Salud",
  CI:"Salud",HUM:"Salud",MOH:"Salud",ELV:"Salud",
  // Drug Manufacturers
  JNJ:"Salud",PFE:"Salud",ABBV:"Salud",
  MRK:"Salud",LLY:"Salud",BMY:"Salud",
  AZN:"Salud",GSK:"Salud",SNY:"Salud",
  NVO:"Salud",RHHBY:"Salud",
  // Biotechnology
  AMGN:"Salud",GILD:"Salud",REGN:"Salud",
  VRTX:"Salud",BIIB:"Salud",MRNA:"Salud",
  BNTX:"Salud",ILMN:"Salud",IONS:"Salud",
  ALNY:"Salud",SGEN:"Salud",BEAM:"Salud",
  // Medical Devices
  ABT:"Salud",MDT:"Salud",ISRG:"Salud",

  // ── Financiero (Financials) ────────────────────────────────────────────────
  // Capital Markets & Asset Management
  GS:"Financiero",MS:"Financiero",BX:"Financiero",
  KKR:"Financiero",APO:"Financiero",SCHW:"Financiero",
  BLK:"Financiero",SPGI:"Financiero",ICE:"Financiero",IBKR:"Financiero",
  // Credit Services
  V:"Financiero",MA:"Financiero",AXP:"Financiero",
  // Fintech & Credit
  PYPL:"Financiero",SQ:"Financiero",HOOD:"Financiero",
  SOFI:"Financiero",AFRM:"Financiero",UPST:"Financiero",NERDW:"Financiero",
  // Banks – Diversified & Regional
  JPM:"Financiero",BAC:"Financiero",WFC:"Financiero",
  C:"Financiero",USB:"Financiero",PNC:"Financiero",
  TFC:"Financiero",FITB:"Financiero",HBAN:"Financiero",
  // Insurance
  BRK:"Financiero","BRK-B":"Financiero",PRU:"Financiero",MET:"Financiero",
  AFL:"Financiero",TRV:"Financiero",AIG:"Financiero",
  CB:"Financiero",ALL:"Financiero",PGR:"Financiero",UNM:"Financiero",
  // Crypto / Blockchain (Capital Markets per Yahoo Finance)
  COIN:"Financiero",MSTR:"Financiero",MARA:"Financiero",
  RIOT:"Financiero",HUT:"Financiero",CLSK:"Financiero",

  // ── Energía (Energy) ──────────────────────────────────────────────────────
  XOM:"Energía",CVX:"Energía",COP:"Energía",OXY:"Energía",
  SLB:"Energía",HAL:"Energía",EOG:"Energía",PXD:"Energía",
  DVN:"Energía",PSX:"Energía",VLO:"Energía",MPC:"Energía",
  HES:"Energía",BKR:"Energía",MRO:"Energía",

  // ── Industriales (Industrials) ─────────────────────────────────────────────
  // Machinery
  CAT:"Industriales",DE:"Industriales",GE:"Industriales",
  HON:"Industriales",EMR:"Industriales",ETN:"Industriales",
  ITW:"Industriales",PH:"Industriales",ROK:"Industriales",
  XYL:"Industriales",AME:"Industriales",MMM:"Industriales",
  CARR:"Industriales",OTIS:"Industriales",
  // Aerospace & Defense
  LMT:"Industriales",RTX:"Industriales",NOC:"Industriales",
  GD:"Industriales",BA:"Industriales",TDG:"Industriales",
  HEI:"Industriales",AXON:"Industriales",RKLB:"Industriales",SPCE:"Industriales",
  // Logistics & Transport
  UPS:"Industriales",FDX:"Industriales",CHRW:"Industriales",
  EXPD:"Industriales",GXO:"Industriales",XPO:"Industriales",
  ODFL:"Industriales",SAIA:"Industriales",JBHT:"Industriales",
  LSTR:"Industriales",WERN:"Industriales",
  // Railroads
  UNP:"Industriales",CSX:"Industriales",

  // ── Materiales (Materials) ────────────────────────────────────────────────
  LIN:"Materiales",APD:"Materiales",DOW:"Materiales",
  NEM:"Materiales",FCX:"Materiales",AA:"Materiales",
  CLF:"Materiales",NUE:"Materiales",MLM:"Materiales",
  VMC:"Materiales",ALB:"Materiales",SQM:"Materiales",
  MP:"Materiales",ECL:"Materiales",PPG:"Materiales",SHW:"Materiales",

  // ── Bienes Raíces (Real Estate) ────────────────────────────────────────────
  AMT:"Bienes Raíces",CCI:"Bienes Raíces",PLD:"Bienes Raíces",
  EQR:"Bienes Raíces",VTR:"Bienes Raíces",SPG:"Bienes Raíces",
  MAA:"Bienes Raíces",PSA:"Bienes Raíces",INVH:"Bienes Raíces",
  VICI:"Bienes Raíces",VNQ:"Bienes Raíces",EQIX:"Bienes Raíces",

  // ── Servicios Públicos (Utilities) ────────────────────────────────────────
  NEE:"Servicios Públicos",DUK:"Servicios Públicos",
  SO:"Servicios Públicos",AEP:"Servicios Públicos",
  D:"Servicios Públicos",EXC:"Servicios Públicos",
  XEL:"Servicios Públicos",PCG:"Servicios Públicos",
  // Renewable utilities
  RUN:"Servicios Públicos",PLUG:"Servicios Públicos",
  BE:"Servicios Públicos",ITRI:"Servicios Públicos",

  // ── ETF ───────────────────────────────────────────────────────────────────
  SPY:"ETF",QQQ:"ETF",VTI:"ETF",IVV:"ETF",VOO:"ETF",
  IWM:"ETF",GLD:"ETF",SLV:"ETF",USO:"ETF",TLT:"ETF",
  HYG:"ETF",LQD:"ETF",EEM:"ETF",EFA:"ETF",IEF:"ETF",
  DIA:"ETF",ARKK:"ETF",TQQQ:"ETF",SQQQ:"ETF",
  XLK:"ETF",XLF:"ETF",XLV:"ETF",XLE:"ETF",
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
  ETF: 22,
  "Consumo Básico": 20,
  "Servicios Públicos": 28,
  "Bienes Raíces": 40,
  Salud: 42,
  Comunicaciones: 52,
  Financiero: 52,
  Energía: 55,
  Industriales: 46,
  Materiales: 52,
  "Consumo Discrecional": 58,
  Tecnología: 68,
};

// Color por sector para la barra de diagnóstico
const SECTOR_COLOR: Record<string, string> = {
  Tecnología:"#8b5cf6",
  Comunicaciones:"#06b6d4",
  "Consumo Discrecional":"#f97316",
  "Consumo Básico":"#eab308",
  Salud:"#ec4899",
  Financiero:"#475569",
  Energía:"#ef4444",
  Industriales:"#0ea5e9",
  Materiales:"#d97706",
  "Bienes Raíces":"#14b8a6",
  "Servicios Públicos":"#22c55e",
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
      Tecnología:-52, Comunicaciones:-40,
      "Consumo Discrecional":-45, "Consumo Básico":-20,
      Salud:-22, Financiero:-65, Energía:-55,
      Industriales:-40, Materiales:-55,
      "Bienes Raíces":-65, "Servicios Públicos":-20,
      ETF:-38,
    }},
  { id:"covid", name:"COVID-19", icon:"🦠", color:"#f97316", year:"Feb-Mar 2020",
    desc:"Crash de 33 días, caída brusca y rápida",
    default:-34,
    drawdowns:{
      Tecnología:-30, Comunicaciones:-25,
      "Consumo Discrecional":-50, "Consumo Básico":-12,
      Salud:-5, Financiero:-42, Energía:-65,
      Industriales:-42, Materiales:-40,
      "Bienes Raíces":-40, "Servicios Públicos":-20,
      ETF:-34,
    }},
  { id:"tech2022", name:"Tech Crash '22", icon:"📉", color:"#f59e0b", year:"2022",
    desc:"Alza de tasas aplasta valuaciones tech",
    default:-20,
    drawdowns:{
      Tecnología:-58, Comunicaciones:-52,
      "Consumo Discrecional":-18, "Consumo Básico":-10,
      Salud:-15, Financiero:-25, Energía:45,
      Industriales:-12, Materiales:-20,
      "Bienes Raíces":-28, "Servicios Públicos":-15,
      ETF:-18,
    }},
  { id:"fed", name:"Fed +1%", icon:"🏛️", color:"#6366f1", year:"Escenario",
    desc:"Subida sorpresiva de 100pb en tasas",
    default:-12,
    drawdowns:{
      Tecnología:-22, Comunicaciones:-18,
      "Consumo Discrecional":-12, "Consumo Básico":-8,
      Salud:-8, Financiero:3, Energía:-8,
      Industriales:-10, Materiales:-12,
      "Bienes Raíces":-22, "Servicios Públicos":-18,
      ETF:-12,
    }},
  { id:"bull", name:"Bull Market", icon:"🚀", color:"#22c55e", year:"Escenario",
    desc:"Año de recuperación y euforia inversora",
    default:22,
    drawdowns:{
      Tecnología:50, Comunicaciones:35,
      "Consumo Discrecional":28, "Consumo Básico":12,
      Salud:22, Financiero:30, Energía:22,
      Industriales:22, Materiales:25,
      "Bienes Raíces":25, "Servicios Públicos":15,
      ETF:25,
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
type ChartHovData = { value: number; chgV: number; chgP: number; date: string; isUp: boolean };

function fmtChartDate(s: string, full = false) {
  try {
    const hasTime = s.includes("T") || (s.includes(" ") && s.includes(":"));
    const d = new Date(hasTime ? s.replace(" ", "T") : s + "T12:00:00");
    if (hasTime) return d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
    if (full) return d.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
    return d.toLocaleDateString("es", { month: "short", day: "numeric" });
  } catch { return s.slice(5, 10); }
}

function smoothBezier(pts: { x: number; y: number }[], t = 0.3): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) * t;
    const cp1y = p1.y + (p2.y - p0.y) * t;
    const cp2x = p2.x - (p3.x - p1.x) * t;
    const cp2y = p2.y - (p3.y - p1.y) * t;
    d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function PortfolioHistoryChart({
  history, color, currencySymbol, onHoverChange,
}: {
  history: ChartPoint[];
  color: string;
  currencySymbol: string;
  onHoverChange?: (data: ChartHovData | null) => void;
}) {
  const [hovIdx, setHovIdx] = useState<number | null>(null);

  if (history.length < 2) return null;

  const W = 720, H = 300;
  const PT = 14, PB = 34;
  const cH = H - PT - PB;

  const vals   = history.map(h => h.value);
  const endV   = vals[vals.length - 1];
  const startV = vals[0];
  const minV   = Math.min(...vals);
  const maxV   = Math.max(...vals);
  const spread = maxV - minV || Math.abs(maxV) || 1;
  const lo = minV - spread * 0.05;
  const hi = maxV + spread * 0.10;
  const range = hi - lo;

  const toX = (i: number) => (i / (history.length - 1)) * W;
  const toY = (v: number) => PT + ((hi - v) / range) * cH;

  const pts   = history.map((h, i) => ({ x: toX(i), y: toY(h.value) }));
  const lineD = smoothBezier(pts);
  const lx    = toX(history.length - 1);
  const ly    = toY(endV);
  const by    = PT + cH;
  const areaD = `${lineD} L ${lx.toFixed(1)},${by} L 0,${by} Z`;

  const baseLineY = toY(startV);

  const yTicks = [0.2, 0.5, 0.8].map(frac => ({
    v: hi - range * frac,
    y: PT + frac * cH,
    pct: (PT + frac * cH) / H * 100,
  }));

  const xIdxs = [0, 1, 2, 3].map(i => Math.round((i * (history.length - 1)) / 3));

  const hovX  = hovIdx !== null ? toX(hovIdx) : null;
  const hovY  = hovIdx !== null ? toY(vals[hovIdx]) : null;
  const hovPt = hovIdx !== null ? history[hovIdx] : null;
  const base  = startV > 0 ? startV : 1;

  const fmtY = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${Math.round(v / 1e3)}K`;
    return Math.round(v).toString();
  };

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const idx = Math.round(ratio * (history.length - 1));
    setHovIdx(idx);
    if (onHoverChange) {
      const v = vals[idx];
      const cv = v - base;
      const cp = (cv / base) * 100;
      onHoverChange({ value: v, chgV: cv, chgP: cp, date: history[idx].date, isUp: v >= base });
    }
  };

  const handleLeave = () => {
    setHovIdx(null);
    onHoverChange?.(null);
  };

  return (
    <div className="relative w-full select-none">
      {/* SVG chart */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: H, display: "block", cursor: "crosshair" }}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        <defs>
          <linearGradient id="pfhg3" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity="0.28" />
            <stop offset="55%"  stopColor={color} stopOpacity="0.06" />
            <stop offset="100%" stopColor={color} stopOpacity="0"    />
          </linearGradient>
        </defs>

        {/* Baseline at period-start value */}
        <line x1="0" y1={baseLineY} x2={W} y2={baseLineY}
          stroke="currentColor" strokeWidth="0.6" strokeOpacity="0.18" strokeDasharray="4,5" />

        {/* Subtle horizontal gridlines */}
        {yTicks.map((t, i) => (
          <line key={i} x1="0" y1={t.y} x2={W} y2={t.y}
            stroke="currentColor" strokeWidth="0.4" strokeOpacity="0.06" />
        ))}

        {/* Area fill */}
        <path d={areaD} fill="url(#pfhg3)" />

        {/* Main portfolio line */}
        <path d={lineD} fill="none" stroke={color} strokeWidth="2.5"
          strokeLinejoin="round" strokeLinecap="round" />

        {/* End dot when idle */}
        {hovIdx === null && (
          <>
            <circle cx={lx} cy={ly} r="9"   fill={color} fillOpacity="0.15" />
            <circle cx={lx} cy={ly} r="3.5" fill={color} />
          </>
        )}

        {/* Crosshair + dot */}
        {hovIdx !== null && hovX !== null && hovY !== null && (
          <>
            <line x1={hovX} y1={PT} x2={hovX} y2={by}
              stroke={color} strokeWidth="1" strokeOpacity="0.3" />
            <circle cx={hovX} cy={hovY} r="12" fill={color} fillOpacity="0.10" />
            <circle cx={hovX} cy={hovY} r="4"  fill={color} />
          </>
        )}
      </svg>

      {/* Y-axis labels (inside, left) */}
      <div className="absolute inset-0 pointer-events-none" style={{ height: H }}>
        {yTicks.map((t, i) => (
          <div key={i} className="absolute"
               style={{ left: 8, top: `${t.pct}%`, transform: "translateY(-50%)" }}>
            <span className="text-[9px] font-medium tabular-nums"
                  style={{ color: "var(--dim)", opacity: 0.65 }}>
              {currencySymbol}{fmtY(t.v)}
            </span>
          </div>
        ))}
      </div>

      {/* Floating date label below crosshair */}
      {hovPt && hovX !== null && (
        <div className="absolute pointer-events-none"
             style={{ bottom: 14, left: `${(hovX / W) * 100}%`, transform: "translateX(-50%)" }}>
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap"
                style={{ background: "var(--raised)", color: "var(--dim)" }}>
            {fmtChartDate(hovPt.date, true)}
          </span>
        </div>
      )}

      {/* X-axis date labels */}
      <div className="flex justify-between px-1 mt-0.5">
        {xIdxs.map(idx => (
          <span key={idx} className="text-[9px] font-medium" style={{ color: "var(--dim)" }}>
            {fmtChartDate(history[idx].date)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const [isTour, setIsTour] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setIsTour(new URLSearchParams(window.location.search).get("tour") === "1"); }, []);
  const { profile } = useProfileStore();
  const userLevel = getUserLevel(profile);
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium";
  const upsellTrigger = useUpsellStore((s) => s.trigger);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const {
    positions, addPosition, removePosition, updatePosition, setPositions,
    clearPortfolio, portfolioCurrency, setCurrency,
    loadFromServer, syncStatus, lastSaved, pendingSync, retrySync,
    portfolios, activePortfolioId, switchPortfolio, createPortfolio, deletePortfolio, renamePortfolio,
  } = usePortfolioStore();
  const [portfolioCreating, setPortfolioCreating] = useState(false);
  const [newPortfolioName, setNewPortfolioName] = useState("");
  const [showNewPortfolioInput, setShowNewPortfolioInput] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [hoveredPortfolioId, setHoveredPortfolioId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen]   = useState(false);
  const [activeTab, setActiveTab] = useState<"portfolio" | "herramientas">("portfolio");

  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [priceError, setPriceError] = useState(false);
  const [fxRate, setFxRate] = useState(1);

  // Screenshot import
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const [screenshotAnalyzing, setScreenshotAnalyzing] = useState(false);
  const [screenshotProgress, setScreenshotProgress] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  type ExtractedPos = { id: string; ticker: string; name: string; shares: number; avg_price: number; purchase_date?: string | null };
  const [screenshotPreview, setScreenshotPreview] = useState<ExtractedPos[]|null>(null);
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [brokerModalOpen, setBrokerModalOpen] = useState(false);
  const [pendingMerge, setPendingMerge] = useState<ExtractedPos[]>([]);

  // Sort
  type SortField = "return" | "invested" | "price";
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [viewMode, setViewMode] = useState<"basic" | "advanced">(() => {
    if (typeof window === "undefined") return "basic";
    return (localStorage.getItem("nuvos_portfolio_view") as "basic" | "advanced") ?? "basic";
  });
  const [selectedStock, setSelectedStock] = useState<string | null>(null);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir("desc"); }
  };

  // Currency picker
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [showImportSteps, setShowImportSteps] = useState(false);

  // Edit position modal
  const [editingPos, setEditingPos] = useState<{ id: string; shares: string; avgPrice: string; purchaseDate: string } | null>(null);
  const [editConfirm, setEditConfirm] = useState(false);
  const [revealedPrices, setRevealedPrices] = useState<Set<string>>(new Set());

  // Manual form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ticker:"", shares:"", avgPrice:"", purchaseDate: new Date().toISOString().split("T")[0] });
  const [addingLoading, setAddingLoading] = useState(false);

  // Currency modal (shown after screenshot or Excel import)
  type PendingImport = { ticker: string; name?: string; shares: number; avgPrice: number; purchaseDate?: string }[];
  const [pendingImport, setPendingImport] = useState<PendingImport|null>(null);
  const [importCurrency, setImportCurrency] = useState("USD");
  const [convertingCurrency, setConvertingCurrency] = useState(false);


  // Stress test
  const [stressScenario, setStressScenario] = useState<string|null>(null);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  type StressResult = { total:number; stressed:number; diff:number; pct:number; rows:{ticker:string;invested:number;stressed:number;diff:number;pct:number;sector:string}[] };
  const [stressResult, setStressResult] = useState<StressResult|null>(null);

  // Portfolio Analyzer
  const [portfolioAnalysis, setPortfolioAnalysis] = useState<{
    error?: string; score: number; score_label: string; score_color: string; summary: string;
    sections: { title: string; score: number; detail: string; icon: string }[];
    strengths: string[]; weaknesses: string[];
    recommendations: { title: string; detail: string }[];
  } | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

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

  const [daysSinceVisit, setDaysSinceVisit] = useState<number | null>(null);

  useEffect(() => {
    const STORAGE_KEY = "nuvos_last_portfolio_visit";
    const last = localStorage.getItem(STORAGE_KEY);
    if (last) {
      const days = Math.floor((Date.now() - parseInt(last)) / 86400000);
      if (days >= 3) setDaysSinceVisit(days);
    }
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  }, []);

  // Cargar portafolio del servidor al montar — garantiza sincronía entre dispositivos
  useEffect(() => {
    if (isAuthenticated) loadFromServer();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // Retry automático si hay cambios locales sin confirmar (syncStatus error o pendingSync)
  useEffect(() => {
    if (!isAuthenticated || !pendingSync) return;
    if (syncStatus === "error" || syncStatus === "idle") {
      const id = setTimeout(() => retrySync(), 5000);
      return () => clearTimeout(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, syncStatus, pendingSync]);

  const fetchPrices = useCallback(async () => {
    if (!positions.length) return;
    setLoadingPrices(true);
    setPriceError(false);
    try {
      const res = await marketApi.getPrices(positions.map((p) => p.ticker));
      setPrices(res.data);
    } catch {
      setPriceError(true);
    }
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
    { key: "since_purchase", label: "Compra", premium: false },
    { key: "1d",  label: "1D",   premium: false },
    { key: "5d",  label: "5D",   premium: false },
    { key: "1mo", label: "1M",   premium: false },
    { key: "3mo", label: "3M",   premium: true  },
    { key: "6mo", label: "6M",   premium: true  },
    { key: "ytd", label: "YTD",  premium: true  },
    { key: "1y",  label: "1A",   premium: true  },
    { key: "3y",  label: "3A",   premium: true  },
    { key: "5y",  label: "5A",   premium: true  },
    { key: "max", label: "MÁX",  premium: true  },
  ] as const;
  type PeriodKey = typeof PERIODS[number]["key"];
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodKey>("since_purchase");
  const [periodReturns, setPeriodReturns] = useState<Record<string, PeriodReturn>>({});
  const [loadingReturns, setLoadingReturns] = useState(false);

  // Chart state
  type ChartData = { history: ChartPoint[]; period_pct: number; period_amount: number };
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [hovData, setHovData] = useState<ChartHovData | null>(null);

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
      // Both invested and current converted to user's currency via fxRate
      invested += p.shares * p.avgPrice * fxRate;
      const cpUSD = prices[p.ticker]?.price;
      current += cpUSD ? p.shares * cpUSD * fxRate : p.shares * p.avgPrice * fxRate;
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
        va = a.shares * a.avgPrice * fxRate;
        vb = b.shares * b.avgPrice * fxRate;
      } else if (sortField === "price") {
        va = (prices[a.ticker]?.price ?? 0) * fxRate;
        vb = (prices[b.ticker]?.price ?? 0) * fxRate;
      } else if (sortField === "return") {
        const cpA = (prices[a.ticker]?.price ?? 0) * fxRate;
        const cpB = (prices[b.ticker]?.price ?? 0) * fxRate;
        const costA = a.avgPrice * fxRate;
        const costB = b.avgPrice * fxRate;
        va = costA > 0 && cpA > 0 ? (cpA - costA) / costA * 100 : 0;
        vb = costB > 0 && cpB > 0 ? (cpB - costB) / costB * 100 : 0;
      }
      return sortDir === "desc" ? vb - va : va - vb;
    });
  }, [positions, prices, fxRate, sortField, sortDir]);

  const diagnosis = useMemo(() => {
    if (!positions.length) return null;
    return scorePortfolio(positions, prices);
  }, [positions, prices]);

  // ── Screenshot import ──────────────────────────────────────────────────
  const processPdfFile = useCallback(async (file: File) => {
    setScreenshotAnalyzing(true);
    setScreenshotPreview(null);
    setScreenshotProgress("Leyendo PDF con IA...");
    try {
      const res = await marketApi.analyzePdf(file);
      const extracted: ExtractedPos[] = (res.data.positions || []).map(
        (p: Omit<ExtractedPos, "id">, i: number) => ({ ...p, id: `${p.ticker}-pdf-${i}-${Date.now()}` })
      );
      if (!extracted.length) {
        alert("No se encontraron posiciones en el PDF. Verifica que sea un estado de cuenta con posiciones.");
      } else {
        setScreenshotPreview(extracted);
      }
    } catch {
      alert("No se pudo leer el PDF. Intenta con el estado de cuenta más reciente o usa una captura de pantalla.");
    } finally {
      setScreenshotAnalyzing(false);
      setScreenshotProgress("");
    }
  }, []);

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
    const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (pdf) await processPdfFile(pdf);
    else if (images.length) await processScreenshotFiles(images);
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
      ...(p.purchase_date ? { purchaseDate: p.purchase_date } : {}),
    })));
    setImportCurrency("USD");
    setScreenshotPreview(null);
  };

  const applyMerge = (mode: "keep" | "replace") => {
    const incoming = pendingMerge.map((p) => ({
      ticker: p.ticker, name: p.name, shares: p.shares, avgPrice: p.avg_price,
      ...(p.purchase_date ? { purchaseDate: p.purchase_date } : {}),
    }));
    let toImport;
    if (mode === "keep") {
      const existing = positions.map((p) => ({
        ticker: p.ticker, name: p.name ?? "", shares: p.shares, avgPrice: p.avgPrice,
        ...(p.purchaseDate ? { purchaseDate: p.purchaseDate } : {}),
      }));
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

  // Fetch live FX rate from backend (yfinance → frankfurter → hardcoded fallback)
  useEffect(() => {
    if (portfolioCurrency === "USD") { setFxRate(1); return; }
    const LOCAL_FALLBACK: Record<string, number> = {
      MXN:18.5, EUR:0.92, GBP:0.79, CAD:1.38, ARS:1150, BRL:5.7,
      COP:4200, CLP:960, PEN:3.75, JPY:155, AUD:1.55, CHF:0.89,
      NZD:1.68, INR:83.5, CNY:7.25, HKD:7.82, SGD:1.35, TRY:32.5,
      ZAR:18.8, SEK:10.6, NOK:10.8, DKK:6.85, PLN:4.05, KRW:1360,
    };
    const fetchRate = () => {
      marketApi.getFxRate(portfolioCurrency)
        .then((r) => {
          if (r.data?.rate) {
            setFxRate(r.data.rate);
          } else if (LOCAL_FALLBACK[portfolioCurrency]) {
            setFxRate(LOCAL_FALLBACK[portfolioCurrency]);
          }
        })
        .catch(() => {
          if (LOCAL_FALLBACK[portfolioCurrency]) setFxRate(LOCAL_FALLBACK[portfolioCurrency]);
        });
    };
    fetchRate();
    const interval = setInterval(fetchRate, 30 * 60 * 1000);
    return () => clearInterval(interval);
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
    upsellTrigger("stress_test_done");
  };

  // ── Portfolio Analyzer ───────────────────────────────────────────────────
  const runPortfolioAnalysis = async () => {
    if (positions.length === 0) return;
    setAnalysisLoading(true); setPortfolioAnalysis(null); setAnalysisError(null);
    try {
      const posPayload = positions.map((p) => ({
        ticker: p.ticker, shares: p.shares, avg_price: p.avgPrice, name: p.name,
        current_price: prices[p.ticker]?.price ?? undefined,
      }));
      const res = await marketApi.analyzePortfolio(posPayload);
      setPortfolioAnalysis(res.data);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { detail?: string; error?: string } } };
      const status = axiosErr?.response?.status;
      const detail = axiosErr?.response?.data?.detail ?? axiosErr?.response?.data?.error;
      if (status === 429) {
        setAnalysisError("Límite de intentos alcanzado. Espera un minuto e intenta de nuevo.");
      } else if (detail) {
        setAnalysisError(`Error ${status ?? ""}: ${detail}`);
      } else {
        setAnalysisError("No se pudo completar el análisis. Intenta de nuevo en unos segundos.");
      }
    }
    setAnalysisLoading(false);
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

  return (
    <>
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

        {/* Sticky Header */}
        <div className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between border-b shrink-0"
             style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
          <div className="flex flex-col gap-2 flex-1 min-w-0">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Mis inversiones</p>
              <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>
                {portfolios.find(p => p.id === activePortfolioId)?.name ?? "Mi Portafolio"}
              </h1>
            </div>
            {/* ── Portfolio switcher ── */}
            <div className="flex items-center gap-2 flex-wrap">
              {portfolios.map(p => (
                <button
                  key={p.id}
                  onClick={() => { if (renamingId === p.id) return; switchPortfolio(p.id); }}
                  onMouseEnter={() => setHoveredPortfolioId(p.id)}
                  onMouseLeave={() => setHoveredPortfolioId(null)}
                  style={{
                    padding: "4px 14px",
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    border: p.id === activePortfolioId ? "1.5px solid var(--accent-l)" : "1.5px solid var(--border)",
                    background: p.id === activePortfolioId ? "rgba(0,212,126,0.12)" : "transparent",
                    color: p.id === activePortfolioId ? "var(--accent-l)" : "var(--muted)",
                    display: "flex", alignItems: "center", gap: 6, position: "relative",
                  }}
                >
                  {renamingId === p.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => { if (renameValue.trim()) renamePortfolio(p.id, renameValue.trim()); setRenamingId(null); }}
                      onKeyDown={e => { if (e.key === "Enter") { if (renameValue.trim()) renamePortfolio(p.id, renameValue.trim()); setRenamingId(null); } if (e.key === "Escape") setRenamingId(null); }}
                      onClick={e => e.stopPropagation()}
                      style={{ background: "transparent", border: "none", outline: "none", width: 110, color: "var(--accent-l)", fontWeight: 700, fontSize: 12 }}
                    />
                  ) : (
                    <>
                      {p.name}
                      {isPremium && (
                        <span
                          onClick={e => { e.stopPropagation(); setRenamingId(p.id); setRenameValue(p.name); }}
                          title="Editar nombre"
                          style={{ fontSize: 10, opacity: hoveredPortfolioId === p.id ? 0.6 : 0, cursor: "pointer", transition: "opacity 0.15s" }}
                        >✏️</span>
                      )}
                    </>
                  )}
                  {isPremium && p.id !== "default" && renamingId !== p.id && (
                    <span
                      onClick={e => { e.stopPropagation(); if (confirm(`¿Eliminar "${p.name}"?`)) deletePortfolio(p.id); }}
                      style={{ fontSize: 10, opacity: 0.5, cursor: "pointer", marginLeft: 2 }}
                      title="Eliminar portafolio"
                    >✕</span>
                  )}
                </button>
              ))}
              {/* Add portfolio button */}
              {isPremium && portfolios.length < 3 && !showNewPortfolioInput && (
                <button
                  onClick={() => { setShowNewPortfolioInput(true); setNewPortfolioName(""); }}
                  style={{ padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700, border: "1.5px dashed var(--border)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}
                >
                  + Nuevo
                </button>
              )}
              {showNewPortfolioInput && (
                <form onSubmit={async e => { e.preventDefault(); if (!newPortfolioName.trim()) return; setPortfolioCreating(true); try { await createPortfolio(newPortfolioName.trim()); } finally { setPortfolioCreating(false); setShowNewPortfolioInput(false); } }} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input autoFocus placeholder="Nombre del portafolio…" value={newPortfolioName} onChange={e => setNewPortfolioName(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setShowNewPortfolioInput(false); }}
                    style={{ padding: "4px 10px", borderRadius: 10, border: "1px solid var(--accent-l)", background: "rgba(0,212,126,0.08)", color: "var(--text)", fontSize: 12, outline: "none", width: 140 }} />
                  <button type="submit" disabled={portfolioCreating || !newPortfolioName.trim()} style={{ padding: "4px 12px", borderRadius: 10, background: "var(--accent-l)", color: "#000", fontSize: 12, fontWeight: 800, border: "none", cursor: "pointer" }}>
                    {portfolioCreating ? "…" : "Crear"}
                  </button>
                  <button type="button" onClick={() => setShowNewPortfolioInput(false)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12 }}>✕</button>
                </form>
              )}
              {!isPremium && portfolios.length < 2 && (
                <button onClick={() => setPaywallOpen(true)} title="Función Premium"
                  style={{ padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700, border: "1.5px dashed var(--border)", background: "transparent", color: "var(--muted)", cursor: "pointer", opacity: 0.6 }}>
                  🔒 + Portafolio
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Sync status */}
            {syncStatus === "syncing" && (
              <div className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: "var(--muted)" }}>
                <RefreshCw className="w-3 h-3 animate-spin" /><span className="hidden sm:inline">Guardando...</span>
              </div>
            )}
            {syncStatus === "saved" && (
              <div className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: "#22c55e" }}>
                <Check className="w-3 h-3" /><span className="hidden sm:inline">Guardado</span>
              </div>
            )}
            {syncStatus === "error" && (
              <div className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: "#ef4444" }}>
                <CloudOff className="w-3 h-3" /><span className="hidden sm:inline">Error al guardar</span>
              </div>
            )}
            {syncStatus === "idle" && lastSaved && (
              <div className="flex items-center gap-1 text-[10px]" style={{ color: "var(--dim)" }}
                   title={`Guardado: ${new Date(lastSaved).toLocaleTimeString()}`}>
                <Cloud className="w-3 h-3" />
              </div>
            )}
            {/* View toggle */}
            <div className="flex items-center rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              <button onClick={() => { setViewMode("basic"); localStorage.setItem("nuvos_portfolio_view", "basic"); }}
                      className="px-2.5 py-1.5 text-[10px] font-bold transition-colors"
                      style={{ background: viewMode === "basic" ? "var(--accent)" : "transparent", color: viewMode === "basic" ? "#fff" : "var(--muted)" }}>
                Básico
              </button>
              <button onClick={() => { setViewMode("advanced"); localStorage.setItem("nuvos_portfolio_view", "advanced"); }}
                      className="px-2.5 py-1.5 text-[10px] font-bold transition-colors"
                      style={{ background: viewMode === "advanced" ? "var(--accent)" : "transparent", color: viewMode === "advanced" ? "#fff" : "var(--muted)" }}>
                Avanzado
              </button>
            </div>
            <PremiumBadge />
            <button onClick={fetchPrices}
                    className="w-9 h-9 flex items-center justify-center rounded-xl border transition-colors hover:border-[var(--accent)]"
                    style={{ borderColor: "var(--border)", background: "var(--raised)", color: "var(--sub)" }}
                    title="Actualizar precios">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              title="Compartir portafolio"
              className="w-9 h-9 flex items-center justify-center rounded-xl border transition-colors hover:border-[var(--accent)]"
              style={{ borderColor: "var(--border)", background: "var(--raised)", color: "var(--sub)" }}
              onClick={() => {
                const sign = totals.pct >= 0 ? "+" : "";
                const text = `Mi portafolio en Nuvos AI: ${currencySymbol}${totals.current.toLocaleString("en-US", { maximumFractionDigits: 0 })} (${sign}${totals.pct.toFixed(1)}%) 📈\n\nAnalizo mis inversiones con IA. Pruébalo en nuvosai.com`;
                if (navigator.share) {
                  navigator.share({ title: "Mi portafolio – Nuvos AI", text });
                } else {
                  navigator.clipboard.writeText(text);
                  alert("¡Texto copiado al portapapeles!");
                }
              }}>
              <Share2 className="w-4 h-4" />
            </button>
          </div>
        </div>

      <div className="flex flex-1 overflow-hidden relative">

        {/* Main */}
        <main className="flex-1 overflow-y-auto scrollbar-thin p-4 w-full">
          <GuidedSteps currentPage="portfolio" />

          {/* Tab switcher — Herramientas only for basico+ */}
          <div className="flex p-1 rounded-xl gap-1 mb-5" style={{ background: "var(--raised)" }}>
            <button onClick={() => setActiveTab("portfolio")}
                    className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
                    style={{ background: activeTab === "portfolio" ? "var(--card)" : "transparent", color: activeTab === "portfolio" ? "var(--text)" : "var(--muted)" }}>
              Mi Portafolio
            </button>
            {isAtLeast(userLevel, "basico") ? (
              <button onClick={() => setActiveTab("herramientas")}
                      className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-1.5"
                      style={{ background: activeTab === "herramientas" ? "var(--card)" : "transparent", color: activeTab === "herramientas" ? "var(--accent-l)" : "var(--muted)" }}>
                Herramientas
              </button>
            ) : (
              <div className="flex-1 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 opacity-35"
                   style={{ color: "var(--dim)" }}
                   title="Disponible en nivel Básico">
                🔒 Herramientas
              </div>
            )}
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

            {/* Pasos para importar portafolio por captura */}
            <div className="mb-3 rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--card)" }}>
              <button
                onClick={() => setShowImportSteps(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors"
                style={{ background: "transparent" }}>
                <span className="text-xs font-bold" style={{ color: "var(--muted)" }}>¿Cómo importar tu portafolio por captura?</span>
                {showImportSteps
                  ? <ChevronUp className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--muted)" }} />
                  : <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--muted)" }} />}
              </button>
              {showImportSteps && (
                <div className="px-3 pb-3" style={{ borderTop: "1px solid var(--border)" }}>
                  {[
                    "Ve a tu broker (Robinhood, IBKR, Schwab, etc.)",
                    "Ingresa a la sección de tu portafolio",
                    "Toma una captura de pantalla de todas tus posiciones",
                    'Toca "Importar captura" aquí en Nuvos AI y selecciona la imagen',
                    "¡Listo! Tu portafolio quedará sincronizado en todos tus dispositivos",
                  ].map((step, i) => (
                    <div key={i} className="flex items-start gap-2.5 pt-2.5">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-px"
                           style={{ background: "rgba(0,212,126,0.15)", color: "#00d47e" }}>
                        <span className="text-[10px] font-black">{i + 1}</span>
                      </div>
                      <p className="text-xs leading-snug" style={{ color: "var(--text)" }}>{step}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Botones principales: Agregar posición + Importar captura */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              {/* Agregar posición — acción primaria */}
              <button
                id="tour-add-position"
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
                  const all = Array.from(e.dataTransfer.files);
                  const pdf = all.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
                  const images = all.filter((f) => f.type.startsWith("image/"));
                  if (pdf) processPdfFile(pdf);
                  else if (images.length) processScreenshotFiles(images);
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
                  <><Upload className="w-4 h-4" /><span>Importar captura o PDF</span></>
                )}
              </div>
            </div>

            <input ref={screenshotInputRef} type="file" accept="image/*,.pdf" multiple className="hidden" onChange={handleScreenshotChange} />

            {/* Conectar broker — Premium */}
            <button
              onClick={() => isPremium ? setBrokerModalOpen(true) : setPaywallOpen(true)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm transition-all hover:opacity-80"
              style={{ background: "var(--raised)", border: "1px solid var(--border)", color: "var(--sub)" }}
            >
              <span>🔗</span>
              <span>Conectar broker</span>
              {isPremium ? (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full ml-1"
                  style={{ background: "rgba(0,168,94,0.12)", color: "var(--accent)" }}>
                  IBKR · Schwab · Robinhood · IOL
                </span>
              ) : (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full ml-1"
                  style={{ background: "rgba(168,85,247,0.12)", color: "#a855f7" }}>
                  Premium
                </span>
              )}
            </button>

            {/* Hint pegado / arrastrar — sutil */}
            {!screenshotAnalyzing && !screenshotPreview && !showForm && (
              <div className="flex items-center gap-2 text-[10px] px-1 mb-1"
                   style={{ color: "var(--dim)" }}>
                <span>📋</span>
                <span>También puedes pegar con{" "}
                  <kbd className="px-1 py-0.5 rounded font-mono text-[9px]"
                       style={{ background: "var(--raised)", color: "var(--muted)" }}>⌘V</kbd>
                  {" "}o arrastrar capturas / PDFs de GBM+, Actinver u otro broker
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
                      {p.purchase_date && <p className="text-xs" style={{ color:"var(--muted)" }}>{p.purchase_date}</p>}
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

          {/* ── Retention banner ── */}
          {daysSinceVisit !== null && daysSinceVisit >= 3 && (
            <div className="rounded-2xl border p-4 mb-4 flex items-start gap-3"
                 style={{ background: "rgba(0,168,94,0.06)", borderColor: "rgba(0,168,94,0.25)" }}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                   style={{ background: "rgba(0,168,94,0.15)" }}>
                <Bell className="w-4 h-4" style={{ color: "var(--accent-l)" }} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: "var(--text)" }}>
                  Bienvenido de vuelta — {daysSinceVisit} días sin revisar
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                  Tu portafolio sigue trabajando. Aquí va el resumen de hoy.
                </p>
              </div>
              <button onClick={() => setDaysSinceVisit(null)} className="p-1 shrink-0">
                <X className="w-3.5 h-3.5" style={{ color: "var(--dim)" }} />
              </button>
            </div>
          )}

          {/* ── Goal progress widget ── */}
          {(() => {
            const goalAmt = parseFloat(profile?.investment_goal_amount ?? "0");
            if (!goalAmt || goalAmt <= 0) return null;
            const progressPct = Math.min((totals.current / goalAmt) * 100, 100);
            const remaining = Math.max(goalAmt - totals.current, 0);
            const GOAL_LABELS: Record<string, string> = {
              emergency_fund: "Fondo de emergencia",
              big_purchase:   "Compra importante",
              retirement:     "Retiro / pensión",
              independence:   "Independencia financiera",
            };
            const goalLabel = GOAL_LABELS[profile?.investment_goal ?? ""] ?? "Mi meta";
            const reached = progressPct >= 100;
            return (
              <div className="rounded-2xl border p-4 mb-4"
                   style={{ background: "var(--card)", borderColor: reached ? "rgba(34,197,94,0.35)" : "var(--border)" }}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5"
                       style={{ color: "var(--accent-l)" }}>META FINANCIERA</p>
                    <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{goalLabel}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-black leading-none"
                       style={{ color: reached ? "#22c55e" : "var(--text)" }}>
                      {progressPct.toFixed(1)}%
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>
                      {reached ? "¡Alcanzada!" : "completado"}
                    </p>
                  </div>
                </div>
                <div className="h-2.5 rounded-full overflow-hidden mb-2.5"
                     style={{ background: "var(--border)" }}>
                  <div className="h-full rounded-full transition-all duration-500"
                       style={{ width: `${progressPct}%`, background: reached ? "#22c55e" : "var(--accent-l)" }} />
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span style={{ color: "var(--muted)" }}>
                    <span className="font-semibold" style={{ color: "var(--sub)" }}>
                      {currencySymbol}{totals.current.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </span>
                    {" "}acumulados
                  </span>
                  {reached ? (
                    <span className="font-bold" style={{ color: "#22c55e" }}>Meta alcanzada</span>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>
                      Faltan{" "}
                      <span className="font-semibold" style={{ color: "var(--sub)" }}>
                        {currencySymbol}{remaining.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </span>
                    </span>
                  )}
                </div>
                <div className="mt-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px]" style={{ color: "var(--dim)" }}>
                      Meta: {currencySymbol}{goalAmt.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  {(() => {
                    const annualRate = (profile?.risk_tolerance ?? "").startsWith("conservative") ? 0.07
                                     : (profile?.risk_tolerance ?? "").startsWith("aggressive") ? 0.12 : 0.10;
                    const rateLabel = (profile?.risk_tolerance ?? "").startsWith("conservative") ? "7%"
                                    : (profile?.risk_tolerance ?? "").startsWith("aggressive") ? "12%" : "10%";
                    const r = annualRate / 12;
                    const monthsToGoalPure = totals.current > 0 && goalAmt > totals.current
                      ? Math.log(goalAmt / totals.current) / Math.log(1 + r) : null;
                    if (monthsToGoalPure === null || reached) return null;
                    const yearsToGoal = monthsToGoalPure / 12;
                    const timeLabel = yearsToGoal < 1
                      ? `${Math.ceil(monthsToGoalPure)} meses`
                      : yearsToGoal < 1.83
                      ? "~1 año y medio"
                      : `~${Math.round(yearsToGoal)} años`;
                    return (
                      <p className="text-[10px] mt-1" style={{ color: "var(--dim)" }}>
                        A tasa del {rateLabel}/año (histórico), llegas en {timeLabel}
                      </p>
                    );
                  })()}
                </div>
              </div>
            );
          })()}

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
              {/* ── Unified Performance Card ── */}
              {(() => {
                const sp   = periodReturns["since_purchase"];
                const r    = periodReturns[selectedPeriod];
                const displayPct = r?.pct !== undefined ? r.pct : chartData?.period_pct;
                const displayAmt = r?.amount !== undefined ? r.amount : chartData?.period_amount;
                const up   = displayPct !== undefined ? displayPct >= 0 : totals.diff >= 0;
                const color = up ? "#22c55e" : "#ef4444";
                // Hero always shows since_purchase as the "total return" anchor
                const heroUp = sp ? sp.pct >= 0 : totals.diff >= 0;
                const heroColor = heroUp ? "#22c55e" : "#ef4444";

                return (
                  <div className="rounded-2xl overflow-hidden mb-4"
                       style={{ background: "var(--card)", border: `1px solid ${heroColor}28`, boxShadow: `0 0 48px ${heroColor}07` }}>

                    {/* ── Accent stripe ── */}
                    <div className="h-[3px]" style={{ background: `linear-gradient(90deg,${heroColor},${heroColor}30)` }} />

                    {/* ── HERO: value + since-purchase return ── */}
                    <div className="px-5 pt-5 pb-4">
                      {loadingPrices ? (
                        <div className="flex items-center gap-2" style={{ color: "var(--muted)" }}>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span className="text-sm">Actualizando precios...</span>
                        </div>
                      ) : priceError ? (
                        <div className="flex items-center gap-2 py-2">
                          <span className="text-sm" style={{ color: "var(--muted)" }}>
                            Los precios no están disponibles ahora.{" "}
                          </span>
                          <button onClick={fetchPrices}
                                  className="text-sm font-semibold underline hover:opacity-70 transition-opacity"
                                  style={{ color: "var(--accent-l)" }}>
                            Reintentar
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--dim)" }}>
                                <span className="flex items-center gap-1.5">
                                Portafolio
                                <button onClick={() => setShowCurrencyPicker(true)}
                                        className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold border transition-colors hover:border-[var(--accent)]"
                                        style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--sub)" }}>
                                  {portfolioCurrency} ▾
                                </button>
                              </span>
                              </p>
                              <p className="text-[2.4rem] font-black tracking-tight leading-none" style={{ color: "var(--text)" }}>
                                {currencySymbol}{(hovData?.value ?? totals.current).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </p>
                              {hovData ? (
                                <p className="text-[10px] mt-0.5" style={{ color: "var(--dim)" }}>
                                  {fmtChartDate(hovData.date, true)}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex flex-col items-end gap-1 pt-1">
                              {hovData ? (
                                <>
                                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-black"
                                       style={{ background: `${hovData.isUp ? "#22c55e" : "#ef4444"}18`, color: hovData.isUp ? "#22c55e" : "#ef4444" }}>
                                    {hovData.isUp ? "▲" : "▼"} {hovData.isUp ? "+" : ""}{hovData.chgP.toFixed(2)}%
                                  </div>
                                  <p className="text-xs font-bold" style={{ color: hovData.isUp ? "#22c55e" : "#ef4444" }}>
                                    {hovData.isUp ? "+" : ""}{currencySymbol}{Math.abs(hovData.chgV).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                                  </p>
                                </>
                              ) : sp ? (
                                <>
                                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-black"
                                       style={{ background: `${heroColor}18`, color: heroColor }}>
                                    {heroUp ? "▲" : "▼"} {heroUp ? "+" : ""}{sp.pct.toFixed(2)}%
                                  </div>
                                  {sp.amount !== undefined && (
                                    <p className="text-xs font-bold" style={{ color: heroColor }}>
                                      {heroUp ? "+" : ""}{currencySymbol}{Math.abs(sp.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                                    </p>
                                  )}
                                </>
                              ) : (
                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-black"
                                     style={{ background: `${heroColor}18`, color: heroColor }}>
                                  {totals.diff >= 0 ? "▲" : "▼"} {totals.pct >= 0 ? "+" : ""}{totals.pct.toFixed(2)}%
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Invested + date row */}
                          <div className="flex items-center justify-between">
                            <p className="text-xs" style={{ color: "var(--muted)" }}>
                              Invertido{" "}
                              <span className="font-semibold" style={{ color: "var(--sub)" }}>
                                {currencySymbol}{totals.invested.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                              </span>
                              {sp?.date && <span style={{ color: "var(--dim)" }}> · desde {sp.date}</span>}
                            </p>
                            {sp?.spy_pct !== undefined && sp?.pct !== undefined && (() => {
                              const diff = sp.pct - sp.spy_pct;
                              const beats = diff >= 0;
                              return (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px]" style={{ color: "var(--dim)" }}>vs S&P 500</span>
                                  <span className="text-[11px] font-bold" style={{ color: sp.spy_pct >= 0 ? "#22c55e" : "#ef4444" }}>
                                    {sp.spy_pct >= 0 ? "+" : ""}{sp.spy_pct.toFixed(2)}%
                                  </span>
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                                        style={{ background: beats ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)", color: beats ? "#22c55e" : "#ef4444" }}>
                                    {beats ? "▲" : "▼"} {Math.abs(diff).toFixed(2)}%
                                  </span>
                                </div>
                              );
                            })()}
                          </div>
                        </>
                      )}
                    </div>

                    {/* ── PERIOD TABS ── */}
                    <div className="border-t px-4 py-3" style={{ borderColor: "var(--border)" }}>
                      <div className="flex gap-1 overflow-x-auto scrollbar-none">
                        {PERIODS.map(({ key, label, premium: needsPremium }) => {
                          const locked = needsPremium && !isPremium;
                          const ret    = locked ? null : periodReturns[key];
                          const isSel  = selectedPeriod === key;
                          const isUp   = ret ? ret.pct >= 0 : null;
                          const tc     = locked ? "var(--muted)" : (isUp === null ? "#22c55e" : isUp ? "#22c55e" : "#ef4444");
                          return (
                            <button
                              key={key}
                              onClick={() => locked ? setPaywallOpen(true) : setSelectedPeriod(key)}
                              className="flex-none flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl transition-all relative"
                              style={{
                                background: locked ? "var(--surface)" : isSel ? `${tc}14` : "transparent",
                                border: `1.5px solid ${locked ? "var(--border)" : isSel ? `${tc}55` : "transparent"}`,
                                opacity: locked ? 0.7 : 1,
                              }}
                            >
                              <span className="text-[10px] font-bold whitespace-nowrap leading-tight flex items-center gap-0.5"
                                    style={{ color: locked ? "var(--muted)" : isSel ? tc : "var(--muted)" }}>
                                {locked && <span className="text-[9px]">🔒</span>}
                                {key === "since_purchase" ? "Compra" : label}
                              </span>
                              {locked ? (
                                <span className="text-[9px] font-black leading-tight blur-[3px] select-none"
                                      style={{ color: "#22c55e" }}>+9.9%</span>
                              ) : loadingReturns ? (
                                <span className="text-[9px]" style={{ color: "var(--dim)" }}>···</span>
                              ) : ret ? (
                                <span className="text-[10px] font-black leading-tight" style={{ color: tc }}>
                                  {ret.pct >= 0 ? "+" : ""}{ret.pct.toFixed(1)}%
                                </span>
                              ) : (
                                <span className="text-[9px]" style={{ color: "var(--dim)" }}>—</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* ── KPI ROW for selected period ── */}
                    <div className="border-t px-4 pb-4 pt-3" style={{ borderColor: "var(--border)" }}>
                      <div className="grid grid-cols-3 gap-2">

                        {/* Rendimiento % */}
                        <div className="rounded-xl p-3" style={{ background: "var(--raised)" }}>
                          <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--dim)" }}>Rendimiento</p>
                          {displayPct !== undefined ? (
                            <p className="text-base font-black leading-none" style={{ color }}>
                              {up ? "+" : ""}{displayPct.toFixed(2)}%
                            </p>
                          ) : chartLoading ? (
                            <p className="text-xs font-bold" style={{ color: "var(--dim)" }}>···</p>
                          ) : (
                            <p className="text-base font-black leading-none" style={{ color: "var(--dim)" }}>—</p>
                          )}
                          {r?.date && <p className="text-[9px] mt-1" style={{ color: "var(--dim)" }}>desde {r.date}</p>}
                        </div>

                        {/* Ganancia $ */}
                        <div className="rounded-xl p-3" style={{ background: "var(--raised)" }}>
                          <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--dim)" }}>Ganancia</p>
                          {displayAmt !== undefined ? (
                            <p className="text-base font-black leading-none" style={{ color }}>
                              {up ? "+" : ""}{currencySymbol}{Math.abs(displayAmt).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </p>
                          ) : (
                            <p className="text-base font-black leading-none" style={{ color: "var(--dim)" }}>—</p>
                          )}
                        </div>

                        {/* vs S&P 500 */}
                        <div className="rounded-xl p-3" style={{ background: "var(--raised)" }}>
                          <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--dim)" }}>vs S&P 500</p>
                          {r?.spy_pct !== undefined && displayPct !== undefined ? (
                            <>
                              <p className="text-base font-black leading-none" style={{ color: r.spy_pct >= 0 ? "#22c55e" : "#ef4444" }}>
                                {r.spy_pct >= 0 ? "+" : ""}{r.spy_pct.toFixed(2)}%
                              </p>
                              {(() => {
                                const diff = displayPct - r.spy_pct;
                                const beats = diff >= 0;
                                return (
                                  <p className="text-[9px] font-bold mt-1" style={{ color: beats ? "#22c55e" : "#ef4444" }}>
                                    {beats ? "▲" : "▼"} {Math.abs(diff).toFixed(2)}% {beats ? "mejor" : "peor"}
                                  </p>
                                );
                              })()}
                            </>
                          ) : (
                            <p className="text-base font-black leading-none" style={{ color: "var(--dim)" }}>—</p>
                          )}
                        </div>

                      </div>
                    </div>

                    {/* ── CHART ── */}
                    <div className="border-t px-3 pb-1" style={{ borderColor: "var(--border)" }}>
                      {chartLoading ? (
                        <div className="h-[220px] flex items-center justify-center gap-2 text-xs"
                             style={{ color: "var(--muted)" }}>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Cargando datos históricos...
                        </div>
                      ) : chartData && chartData.history.length >= 2 ? (
                        <div className="pt-3">
                          <PortfolioHistoryChart history={chartData.history} color={color} currencySymbol={currencySymbol} onHoverChange={setHovData} />
                        </div>
                      ) : !chartLoading ? (
                        <div className="h-[160px] flex items-center justify-center text-xs"
                             style={{ color: "var(--dim)" }}>
                          Sin datos históricos para este período
                        </div>
                      ) : null}
                    </div>


                    {/* ── FOOTER ── */}
                    <div className="border-t px-4 py-2" style={{ borderColor: "var(--border)" }}>
                      <p className="text-[9px]" style={{ color: "var(--dim)" }}>Yahoo Finance · precios ajustados por splits y dividendos</p>
                    </div>

                  </div>
                );
              })()}

              {/* Advanced table view */}
              {viewMode === "advanced" && sortedPositions.length > 0 && (
                <div className="mb-4">
                  <AdvancedStockTable
                    mode="portfolio"
                    userLevel={userLevel}
                    onRowClick={setSelectedStock}
                    onEdit={(ticker) => {
                      const pos = sortedPositions.find((p) => p.ticker === ticker);
                      if (pos) { setEditConfirm(false); setEditingPos({ id: pos.id, shares: String(pos.shares), avgPrice: String(pos.avgPrice), purchaseDate: pos.purchaseDate ?? new Date().toISOString().split("T")[0] }); }
                    }}
                    onRemove={(ticker) => {
                      const pos = sortedPositions.find((p) => p.ticker === ticker);
                      if (pos) removePosition(pos.id);
                    }}
                    rows={sortedPositions.map((pos): AdvancedRow => {
                      const pd = prices[pos.ticker];
                      const cp = pd?.price ? pd.price * fxRate : null;
                      const currentVal = cp ? pos.shares * cp : null;
                      const investedVal = pos.avgPrice > 0 ? pos.shares * pos.avgPrice * fxRate : null;
                      const gainLossPct = currentVal !== null && investedVal !== null && investedVal > 0
                        ? ((currentVal - investedVal) / investedVal) * 100 : null;
                      return {
                        ticker: pos.ticker,
                        name: pd?.name ?? pos.ticker,
                        price: cp,
                        changePct: null,
                        currency: portfolioCurrency,
                        shares: pos.shares,
                        avgCost: pos.avgPrice * fxRate,
                        positionValue: currentVal,
                        gainLossPct,
                      };
                    })}
                  />
                </div>
              )}

              {/* Sort chips */}
              {viewMode === "basic" && (
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
              )}

              {/* Position cards */}
              {viewMode === "basic" && sortedPositions.map((pos) => {
                const pd = prices[pos.ticker];
                const cpUSD = pd?.price;
                // Convert USD market price → user's currency
                const cp = cpUSD ? cpUSD * fxRate : null;
                const hasCost = pos.avgPrice > 0;
                const currentVal = cp ? pos.shares * cp : null;
                const investedVal = hasCost ? pos.shares * pos.avgPrice * fxRate : null;
                const diff = currentVal !== null && investedVal !== null ? currentVal - investedVal : null;
                const pct = diff !== null && investedVal! > 0 ? (diff / investedVal!) * 100 : null;
                const isUp = diff !== null && diff >= 0;
                const priceRevealed = revealedPrices.has(pos.id);
                return (
                  <div key={pos.id} className="rounded-xl mb-1.5 overflow-hidden cursor-pointer"
                       onClick={() => setSelectedStock(pos.ticker)}
                       style={{
                         background:"var(--card)",
                         border: `1px solid ${diff !== null ? (isUp?"rgba(34,197,94,0.2)":"rgba(239,68,68,0.2)") : "var(--border)"}`,
                         borderLeft: `2px solid ${diff !== null ? (isUp?"#22c55e":"#ef4444") : "var(--border)"}`,
                       }}>
                    <div className="p-3">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <StockAvatar ticker={pos.ticker} size="sm" />
                        <div>
                          <p className="font-extrabold text-[13px] leading-none" style={{ color:"var(--text)" }}>{pos.ticker}</p>
                          {(pd?.name || pos.name) && (
                            <p className="text-[10px] mt-0.5 truncate max-w-[140px]" style={{ color:"var(--muted)" }}>{pd?.name || pos.name}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {diff !== null && pct !== null && (
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg"
                               style={{ background: isUp ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)" }}>
                            <span className="text-[10px] font-semibold" style={{ color: isUp ? "#22c55e" : "#ef4444" }}>
                              {isUp ? "+" : ""}{currencySymbol}{Math.abs(diff).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
                            </span>
                            <span className="text-[11px] font-black" style={{ color: isUp ? "#22c55e" : "#ef4444" }}>
                              {isUp ? "+" : ""}{pct.toFixed(2)}%
                            </span>
                          </div>
                        )}
                        <button
                          onClick={() => { setEditConfirm(false); setEditingPos({ id: pos.id, shares: String(pos.shares), avgPrice: String(pos.avgPrice), purchaseDate: pos.purchaseDate ?? new Date().toISOString().split("T")[0] }); }}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-l)]"
                          style={{ borderColor: "var(--border)", color: "var(--sub)", background: "var(--raised)" }}>
                          <Pencil className="w-3 h-3" />
                          Editar
                        </button>
                        <button onClick={() => removePosition(pos.id)}
                                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors hover:border-red-500/40 hover:text-red-400"
                                style={{ borderColor: "var(--border)", color: "var(--dim)", background: "var(--raised)" }}>
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Invested vs Current */}
                    <div className="grid grid-cols-3 gap-1.5">
                      <div>
                        <p className="text-[8px] font-bold uppercase tracking-wider mb-0.5" style={{ color:"var(--dim)" }}>Invertido</p>
                        <p className="text-[11px] font-bold" style={{ color:"var(--sub)" }}>
                          {investedVal != null ? `${currencySymbol}${investedVal.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}` : "—"}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-[8px] font-bold uppercase tracking-wider mb-0.5" style={{ color:"var(--dim)" }}>Acciones</p>
                        <p className="text-[11px] font-bold" style={{ color:"var(--sub)" }}>{pos.shares.toLocaleString("en-US")}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[8px] font-bold uppercase tracking-wider mb-0.5" style={{ color:"var(--dim)" }}>Valor hoy</p>
                        <p className="text-[11px] font-extrabold" style={{ color:"var(--text)" }}>
                          {currentVal != null ? `${currencySymbol}${currentVal.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}` : "—"}
                        </p>
                      </div>
                    </div>

                    {/* Reveal price */}
                    <button
                      onClick={() => setRevealedPrices((prev) => {
                        const next = new Set(prev);
                        next.has(pos.id) ? next.delete(pos.id) : next.add(pos.id);
                        return next;
                      })}
                      className="flex items-center gap-1 text-[9px] font-semibold mt-2"
                      style={{ color:"var(--muted)" }}>
                      <Eye className="w-2.5 h-2.5" />
                      {priceRevealed
                        ? cp ? `${currencySymbol}${cp.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})} / acción · ocultar` : "Sin precio"
                        : "Ver precio por acción"}
                    </button>
                    </div>
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
                  <>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {Object.entries(diagnosis.sectorPcts).sort((a,b)=>b[1]-a[1]).map(([sector,pct]) => {
                        const col = SECTOR_COLOR[sector] ?? "#94a3b8";
                        const isSelected = selectedSector === sector;
                        return (
                          <button
                            key={sector}
                            onClick={() => setSelectedSector(isSelected ? null : sector)}
                            className="text-xs px-2.5 py-1 rounded-lg font-bold transition-all"
                            style={{
                              background: isSelected ? col : `${col}18`,
                              border: `1px solid ${isSelected ? col : col+"40"}`,
                              color: isSelected ? "#fff" : col,
                            }}
                          >
                            {sector} {pct}%
                          </button>
                        );
                      })}
                    </div>
                    {selectedSector && (() => {
                      const col = SECTOR_COLOR[selectedSector] ?? "#94a3b8";
                      const sectorPositions = positions.filter(
                        (p) => (TICKER_SECTOR[p.ticker] ?? "Otro") === selectedSector
                      );
                      const sectorTotal = sectorPositions.reduce((sum, p) => {
                        const price = (prices[p.ticker]?.price ?? p.avgPrice) * fxRate;
                        return sum + p.shares * price;
                      }, 0);
                      return (
                        <div className="rounded-xl p-3 mb-3 border"
                             style={{ background:`${col}0e`, borderColor:`${col}40` }}>
                          <div className="flex items-center justify-between mb-2.5">
                            <span className="text-xs font-extrabold" style={{ color: col }}>
                              Posiciones · {selectedSector}
                            </span>
                            <button
                              onClick={() => setSelectedSector(null)}
                              className="text-[10px] font-semibold transition-opacity hover:opacity-60"
                              style={{ color:"var(--muted)" }}
                            >
                              Cerrar ✕
                            </button>
                          </div>
                          <div className="space-y-1.5">
                            {sectorPositions.map((pos) => {
                              const price = (prices[pos.ticker]?.price ?? pos.avgPrice) * fxRate;
                              const val = pos.shares * price;
                              const pctOfSector = sectorTotal > 0 ? Math.round((val / sectorTotal) * 100) : 0;
                              return (
                                <div key={pos.id}
                                     className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg"
                                     style={{ background:"var(--bg)" }}>
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-xs font-extrabold shrink-0" style={{ color: col }}>
                                      {pos.ticker}
                                    </span>
                                    {pos.name && (
                                      <span className="text-[11px] truncate" style={{ color:"var(--sub)" }}>
                                        {pos.name}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-3 shrink-0 text-right">
                                    <span className="text-[11px]" style={{ color:"var(--muted)" }}>
                                      {pos.shares} acc.
                                    </span>
                                    <span className="text-xs font-bold" style={{ color:"var(--text)" }}>
                                      {currencySymbol}{val.toLocaleString("en-US",{maximumFractionDigits:0})}
                                    </span>
                                    <span className="text-[10px] font-bold w-8 text-right" style={{ color: col }}>
                                      {pctOfSector}%
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <div className="flex justify-end mt-2 pt-2 border-t" style={{ borderColor:`${col}30` }}>
                            <span className="text-xs font-extrabold" style={{ color:"var(--muted)" }}>
                              Total sector:&nbsp;
                              <span style={{ color: col }}>
                                {currencySymbol}{sectorTotal.toLocaleString("en-US",{maximumFractionDigits:0})}
                              </span>
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}
              </section>
            );
          })()}

          {/* ── Stress Test ── */}
          {positions.length>0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-5 h-5 text-[#ef4444] shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-extrabold" style={{ color:"var(--text)" }}>Stress Test de Portafolio</h3>
                    {!isPremium && <span className="text-xs px-1.5 py-0.5 rounded-md font-bold" style={{ background:"rgba(245,158,11,0.15)", color:"#f59e0b" }}>Premium</span>}
                  </div>
                  <p className="text-xs" style={{ color:"var(--muted)" }}>¿Cuánto aguantaría tu portafolio en una crisis?</p>
                </div>
              </div>
              {/* Scenarios — always visible, blurred for free */}
              <div className="relative">
                <div className={!isPremium ? "pointer-events-none select-none" : ""} style={!isPremium ? { filter:"blur(3px)", opacity:0.6 } : {}}>
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
                  {/* Fake blurred result */}
                  {!isPremium && (
                    <div className="rounded-2xl border p-4 mt-3" style={{ borderColor:"rgba(239,68,68,0.3)", background:"var(--card)" }}>
                      <p className="text-sm font-bold mb-3" style={{ color:"var(--text)" }}>💥 Crisis 2008 — Caída del mercado hipotecario</p>
                      <div className="rounded-xl p-3 mb-3" style={{ background:"rgba(239,68,68,0.08)" }}>
                        <p className="text-xs mb-1" style={{ color:"var(--muted)" }}>Impacto total estimado</p>
                        <p className="text-2xl font-black" style={{ color:"#ef4444" }}>-$XX,XXX (-XX.X%)</p>
                        <p className="text-xs mt-1" style={{ color:"var(--dim)" }}>$XX,XXX → $XX,XXX</p>
                      </div>
                      {["AAPL","MSFT","GOOGL"].map((t) => (
                        <div key={t} className="flex items-center justify-between py-2.5 border-t" style={{ borderColor:"var(--border)" }}>
                          <div>
                            <p className="text-sm font-extrabold" style={{ color:"var(--text)" }}>{t}</p>
                            <p className="text-xs" style={{ color:"var(--dim)" }}>Tecnología</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-extrabold" style={{ color:"#ef4444" }}>-XX%</p>
                            <p className="text-xs font-semibold" style={{ color:"#ef4444" }}>-$X,XXX</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {isPremium && stressResult && stressScenario && (() => {
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
                </div>
                {/* Paywall overlay for free users */}
                {!isPremium && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl"
                       style={{ background:"rgba(0,0,0,0.45)", backdropFilter:"blur(2px)" }}>
                    <span className="text-3xl">🛡️</span>
                    <p className="text-sm font-extrabold text-white text-center px-4">Desbloquea el Stress Test</p>
                    <p className="text-xs text-white/70 text-center px-6">Simula crisis históricas y ve el impacto real en tu portafolio</p>
                    <button onClick={() => setPaywallOpen(true)}
                            className="px-5 py-2 rounded-2xl text-sm font-black text-black"
                            style={{ background:"#f59e0b" }}>
                      Ir a Premium
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── Analiza tu Portafolio ── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-5 h-5 shrink-0" style={{ color:"#22c55e" }} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-extrabold" style={{ color:"var(--text)" }}>Analiza tu Portafolio</h3>
                  {!isPremium && <span className="text-xs px-1.5 py-0.5 rounded-md font-bold" style={{ background:"rgba(245,158,11,0.15)", color:"#f59e0b" }}>Premium</span>}
                </div>
                <p className="text-xs" style={{ color:"var(--muted)" }}>
                  IA evalúa tus {positions.length} posiciones y te da una calificación detallada
                </p>
              </div>
            </div>

            {/* Analyze button */}
            {!isPremium ? (
              <button onClick={() => setPaywallOpen(true)}
                      className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-bold text-sm transition-opacity"
                      style={{ background:"rgba(245,158,11,0.12)", border:"1px solid rgba(245,158,11,0.35)", color:"#f59e0b" }}>
                🔒 Desbloquear análisis con IA
              </button>
            ) : positions.length > 0 ? (
              <button onClick={runPortfolioAnalysis} disabled={analysisLoading}
                      className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-white font-bold text-sm disabled:opacity-40 transition-opacity"
                      style={{ background:"var(--accent)" }}>
                {analysisLoading
                  ? <><RefreshCw className="w-4 h-4 animate-spin" /> Analizando tu portafolio...</>
                  : <><Sparkles className="w-4 h-4" /> Analizar mi portafolio con IA</>}
              </button>
            ) : (
              <div className="text-center py-6 rounded-2xl border" style={{ borderColor:"var(--border)", background:"var(--card)" }}>
                <p className="text-xs" style={{ color:"var(--muted)" }}>Agrega posiciones a tu portafolio para analizarlo</p>
              </div>
            )}

            {/* Error */}
            {analysisError && (
              <div className="mt-2 flex items-center gap-2 px-4 py-3 rounded-xl text-xs"
                   style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#ef4444" }}>
                ⚠️ {analysisError}
              </div>
            )}

            {/* Results */}
            {portfolioAnalysis && !portfolioAnalysis.error && (
              <div className="mt-3 flex flex-col gap-3">

                {/* Score hero */}
                <div className="rounded-2xl border p-5 flex items-center gap-5"
                     style={{ borderColor: portfolioAnalysis.score_color + "40", background: portfolioAnalysis.score_color + "08" }}>
                  {/* Score circle */}
                  <div className="relative shrink-0 w-20 h-20">
                    <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                      <circle cx="40" cy="40" r="32" fill="none" stroke="var(--border)" strokeWidth="7" />
                      <circle cx="40" cy="40" r="32" fill="none"
                              stroke={portfolioAnalysis.score_color} strokeWidth="7" strokeLinecap="round"
                              strokeDasharray={`${2 * Math.PI * 32}`}
                              strokeDashoffset={`${2 * Math.PI * 32 * (1 - portfolioAnalysis.score / 100)}`} />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-xl font-black leading-none" style={{ color: portfolioAnalysis.score_color }}>
                        {portfolioAnalysis.score}
                      </span>
                      <span className="text-[8px] font-bold" style={{ color:"var(--muted)" }}>/ 100</span>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-base font-black" style={{ color: portfolioAnalysis.score_color }}>
                      {portfolioAnalysis.score_label}
                    </span>
                    <p className="text-[11px] leading-relaxed mt-1" style={{ color:"var(--sub)" }}>
                      {portfolioAnalysis.summary}
                    </p>
                  </div>
                </div>

                {/* Dimension bars */}
                <div className="rounded-2xl border overflow-hidden" style={{ borderColor:"var(--border)", background:"var(--card)" }}>
                  {portfolioAnalysis.sections.map((sec, i) => (
                    <div key={sec.title}
                         className="px-4 py-3"
                         style={{ borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold" style={{ color:"var(--text)" }}>{sec.title}</span>
                        <span className="text-xs font-black" style={{ color: sec.score >= 70 ? "#22c55e" : sec.score >= 50 ? "#f59e0b" : "#ef4444" }}>
                          {sec.score}/100
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background:"var(--border)" }}>
                        <div className="h-full rounded-full transition-all duration-700"
                             style={{
                               width:`${sec.score}%`,
                               background: sec.score >= 70 ? "#22c55e" : sec.score >= 50 ? "#f59e0b" : "#ef4444",
                             }} />
                      </div>
                      <p className="text-[10px] mt-1.5 leading-relaxed" style={{ color:"var(--muted)" }}>{sec.detail}</p>
                    </div>
                  ))}
                </div>

                {/* Strengths & Weaknesses */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border p-3" style={{ borderColor:"rgba(34,197,94,0.25)", background:"rgba(34,197,94,0.05)" }}>
                    <p className="text-[10px] font-black uppercase tracking-wider mb-2" style={{ color:"#22c55e" }}>Fortalezas</p>
                    <div className="flex flex-col gap-1.5">
                      {portfolioAnalysis.strengths.map((s, i) => (
                        <div key={i} className="flex items-start gap-1.5">
                          <span className="text-[10px] mt-0.5">✓</span>
                          <p className="text-[10px] leading-snug" style={{ color:"var(--sub)" }}>{s}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl border p-3" style={{ borderColor:"rgba(239,68,68,0.25)", background:"rgba(239,68,68,0.05)" }}>
                    <p className="text-[10px] font-black uppercase tracking-wider mb-2" style={{ color:"#ef4444" }}>A Mejorar</p>
                    <div className="flex flex-col gap-1.5">
                      {portfolioAnalysis.weaknesses.map((w, i) => (
                        <div key={i} className="flex items-start gap-1.5">
                          <span className="text-[10px] mt-0.5">!</span>
                          <p className="text-[10px] leading-snug" style={{ color:"var(--sub)" }}>{w}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Recommendations */}
                <div className="rounded-2xl border overflow-hidden" style={{ borderColor:"var(--border)", background:"var(--card)" }}>
                  <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor:"var(--border)" }}>
                    <TrendingUp className="w-3.5 h-3.5" style={{ color:"#6366f1" }} />
                    <span className="text-xs font-bold" style={{ color:"var(--text)" }}>Recomendaciones</span>
                  </div>
                  {portfolioAnalysis.recommendations.map((r, i) => (
                    <div key={i} className="flex items-start gap-3 px-4 py-3"
                         style={{ borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                      <div className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-black mt-0.5"
                           style={{ background:"rgba(99,102,241,0.15)", color:"#818cf8" }}>
                        {i + 1}
                      </div>
                      <div>
                        <p className="text-[11px] font-bold mb-0.5" style={{ color:"var(--text)" }}>{r.title}</p>
                        <p className="text-[10px] leading-snug" style={{ color:"var(--muted)" }}>{r.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Disclaimer */}
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg"
                     style={{ background:"rgba(234,179,8,0.08)", border:"1px solid rgba(234,179,8,0.25)" }}>
                  <AlertTriangle className="w-3 h-3 text-yellow-600 shrink-0" />
                  <p className="text-[10px] text-yellow-600">Análisis educativo. No es asesoramiento financiero.</p>
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
                      { icon: BarChart2,     text: "Rendimiento real vs S&P 500 y benchmarks" },
                      { icon: TrendingDown,  text: "Sharpe ratio, volatilidad y drawdown máximo" },
                      { icon: GraduationCap, text: "Nota personalizada de tu mentor cada mes" },
                      { icon: CheckSquare,   text: "3 acciones concretas para el mes siguiente" },
                    ]}
                    onUnlock={() => setPaywallOpen(true)}
                  />
              }

              <EarningsPanel
                positions={positions.map(p => ({ ticker: p.ticker, shares: p.shares, avg_cost: p.avgPrice }))}
                isPremium={isPremium}
                onUpgrade={() => setPaywallOpen(true)}
              />

              <WeeklyScreenerCard isPremium={isPremium} onUpgrade={() => setPaywallOpen(true)} tickers={positions.map(p => p.ticker)} />

            </div>
          )}

        </main>
      </div>
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

      {/* ── Broker connect modal ── */}
      {brokerModalOpen && (
        <BrokerConnectModal
          onClose={() => setBrokerModalOpen(false)}
          onPositionsImported={(brokerPositions) => {
            brokerPositions.forEach((p) => {
              if (p.shares > 0) {
                addPosition({
                  ticker: p.ticker,
                  name: p.name,
                  shares: p.shares,
                  avgPrice: p.avgPrice,
                });
              }
            });
            setBrokerModalOpen(false);
          }}
        />
      )}

      {/* First Steps guided flow — basico only, post-onboarding */}
      {userLevel === "basico" && (
        <FirstStepsFlow onOpenAddPosition={() => setShowForm(true)} />
      )}

      {/* ── Currency picker modal ── */}
      {showCurrencyPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-sm rounded-3xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="font-extrabold text-base" style={{ color: "var(--text)" }}>Moneda del portafolio</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>Los precios de mercado se convierten en tiempo real</p>
              </div>
              <button onClick={() => setShowCurrencyPicker(false)} style={{ color: "var(--muted)" }}>✕</button>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-5">
              {([
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
              ] as { code: string; flag: string; name: string }[]).map(({ code, flag, name }) => {
                const active = portfolioCurrency === code;
                return (
                  <button key={code}
                          onClick={() => { setCurrency(code); setShowCurrencyPicker(false); }}
                          className="flex flex-col items-center py-2.5 px-1 rounded-2xl border transition-all text-center hover:opacity-90"
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
            <button onClick={() => setShowCurrencyPicker(false)}
                    className="w-full py-2.5 rounded-xl border text-sm font-semibold"
                    style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
              Cerrar
            </button>
          </div>
        </div>
      )}

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
                <button onClick={() => { setEditingPos(null); setEditConfirm(false); }} style={{ color:"var(--muted)" }}>
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
                {!editConfirm ? (
                  <button
                    onClick={() => {
                      const shares = parseFloat(editingPos.shares);
                      if (!isNaN(shares) && shares > 0) setEditConfirm(true);
                    }}
                    className="w-full py-2.5 rounded-xl text-sm font-bold text-white"
                    style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
                    Guardar cambios
                  </button>
                ) : (
                  <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                    <p className="text-xs font-bold text-center" style={{ color: "var(--text)" }}>¿Confirmar cambios?</p>
                    <p className="text-[10px] text-center" style={{ color: "var(--muted)" }}>
                      {editingPos.shares} acciones · precio promedio ${editingPos.avgPrice}
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setEditConfirm(false)}
                              className="flex-1 py-2 rounded-lg text-xs font-semibold border"
                              style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                        Cancelar
                      </button>
                      <button
                        onClick={() => {
                          const shares = parseFloat(editingPos.shares);
                          const avgPrice = parseFloat(editingPos.avgPrice);
                          updatePosition(editingPos.id, {
                            shares,
                            avgPrice: isNaN(avgPrice) ? 0 : avgPrice,
                            purchaseDate: editingPos.purchaseDate,
                          });
                          setEditingPos(null);
                          setEditConfirm(false);
                        }}
                        className="flex-[2] py-2 rounded-lg text-xs font-bold text-white"
                        style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
                        Guardar
                      </button>
                    </div>
                  </div>
                )}
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

      {/* ── Stock Detail Modal ── */}
      {selectedStock && (
        <StockDetailModal ticker={selectedStock} onClose={() => setSelectedStock(null)} />
      )}

      {isTour && (
        <TourSpotlight
          targetId="tour-add-position"
          step={1}
          title="Agrega tu primera posición"
          description="Toca el botón verde para registrar las acciones que ya tienes. Nuvos calculará tu rendimiento en tiempo real."
          ctaLabel="Entendido, volver al inicio ✓"
        />
      )}
    </>
  );
}
