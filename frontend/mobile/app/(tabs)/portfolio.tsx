import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import StockAvatar from "../../src/components/StockAvatar";
import { useFocusEffect, router } from "expo-router";
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, ActivityIndicator, SafeAreaView, Alert,
  RefreshControl, Image, Modal,
  AppState, AppStateStatus, PanResponder,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path, Defs, RadialGradient as SvgRadial, Stop, Rect as SvgRect, G, LinearGradient, Circle, Line as SvgLine } from "react-native-svg";
import * as ImagePicker from "expo-image-picker";

import { marketApi } from "../../src/lib/api";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { usePortfolioStore, Position } from "../../src/lib/portfolioStore";
import MobileWhatIf from "../../src/components/MobileWhatIf";
import MobileMonthlyReport from "../../src/components/MobileMonthlyReport";
import MobileWeeklyScreener from "../../src/components/MobileWeeklyScreener";
import MobilePortfolioLeaderboard from "../../src/components/MobilePortfolioLeaderboard";
import PremiumToolCard from "../../src/components/PremiumToolCard";
import { useAppStore, getAge, UserProfile, RISK_CONFIG } from "../../src/lib/profileStore";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import Markdown from "react-native-markdown-display";
import PaywallModal from "../../src/components/PaywallModal";

const FREE_POSITION_LIMIT = 10;

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];
type Scenario = "conservative" | "moderate" | "aggressive";

// ─── Stress test data ──────────────────────────────────────────────────────

const TICKER_SECTOR: Record<string, string> = {
  // Semiconductores
  NVDA:"Semiconductores",AMD:"Semiconductores",INTC:"Semiconductores",
  QCOM:"Semiconductores",AVGO:"Semiconductores",MU:"Semiconductores",
  TSM:"Semiconductores",AMAT:"Semiconductores",LRCX:"Semiconductores",
  KLAC:"Semiconductores",TXN:"Semiconductores",ADI:"Semiconductores",
  MCHP:"Semiconductores",ON:"Semiconductores",SWKS:"Semiconductores",
  SMCI:"Semiconductores",MRVL:"Semiconductores",ARM:"Semiconductores",
  WOLF:"Semiconductores",MPWR:"Semiconductores",SOXX:"Semiconductores",
  ASML:"Semiconductores",ENTG:"Semiconductores",

  // Software
  MSFT:"Software",CRM:"Software",ADBE:"Software",ORCL:"Software",
  NOW:"Software",INTU:"Software",CDNS:"Software",SNPS:"Software",
  ANSS:"Software",WDAY:"Software",DDOG:"Software",TEAM:"Software",
  HUBS:"Software",VEEV:"Software",NET:"Software",ZS:"Software",
  OKTA:"Software",PANW:"Software",FTNT:"Software",MDB:"Software",
  SNOW:"Software",GTLB:"Software",ESTC:"Software",SMAR:"Software",
  SPLK:"Software",DOCN:"Software",CRWD:"Software",

  // Tecnología (plataformas, ecosistemas consumer)
  AAPL:"Tecnología",GOOGL:"Tecnología",GOOG:"Tecnología",
  META:"Tecnología",AMZN:"Tecnología",SPOT:"Tecnología",
  SNAP:"Tecnología",PINS:"Tecnología",RBLX:"Tecnología",
  CSCO:"Tecnología",IBM:"Tecnología",DELL:"Tecnología",HPQ:"Tecnología",

  // Inteligencia Artificial
  PLTR:"Inteligencia Artificial",AI:"Inteligencia Artificial",
  BBAI:"Inteligencia Artificial",SOUN:"Inteligencia Artificial",
  U:"Inteligencia Artificial",

  // Fintech
  PYPL:"Fintech",SQ:"Fintech",HOOD:"Fintech",SOFI:"Fintech",
  AFRM:"Fintech",UPST:"Fintech",

  // eCommerce
  SHOP:"eCommerce",MELI:"eCommerce",SE:"eCommerce",
  BABA:"eCommerce",JD:"eCommerce",EBAY:"eCommerce",
  ETSY:"eCommerce",W:"eCommerce",CHWY:"eCommerce",CPNG:"eCommerce",

  // Consumo Discrecional
  TSLA:"Consumo Discrecional",NFLX:"Consumo Discrecional",
  NKE:"Consumo Discrecional",SBUX:"Consumo Discrecional",
  MCD:"Consumo Discrecional",HD:"Consumo Discrecional",
  LOW:"Consumo Discrecional",TGT:"Consumo Discrecional",
  TJX:"Consumo Discrecional",ROST:"Consumo Discrecional",
  ABNB:"Consumo Discrecional",BKNG:"Consumo Discrecional",
  YUM:"Consumo Discrecional",CMG:"Consumo Discrecional",
  DKNG:"Consumo Discrecional",DIS:"Consumo Discrecional",
  UBER:"Consumo Discrecional",LYFT:"Consumo Discrecional",
  F:"Consumo Discrecional",GM:"Consumo Discrecional",
  RIVN:"Consumo Discrecional",LCID:"Consumo Discrecional",NIO:"Consumo Discrecional",

  // Consumo Básico
  WMT:"Consumo Básico",KO:"Consumo Básico",PG:"Consumo Básico",
  COST:"Consumo Básico",PEP:"Consumo Básico",MDLZ:"Consumo Básico",
  CLX:"Consumo Básico",KHC:"Consumo Básico",GIS:"Consumo Básico",
  HSY:"Consumo Básico",CL:"Consumo Básico",KMB:"Consumo Básico",
  EL:"Consumo Básico",K:"Consumo Básico",TSN:"Consumo Básico",

  // Salud (aseguradoras + hospitales)
  UNH:"Salud",HCA:"Salud",CNC:"Salud",CVS:"Salud",
  CI:"Salud",HUM:"Salud",MOH:"Salud",ELV:"Salud",
  ABT:"Salud",MDT:"Salud",BSX:"Salud",ISRG:"Salud",

  // Farmacéutica
  JNJ:"Farmacéutica",PFE:"Farmacéutica",ABBV:"Farmacéutica",
  MRK:"Farmacéutica",LLY:"Farmacéutica",BMY:"Farmacéutica",
  AZN:"Farmacéutica",GSK:"Farmacéutica",SNY:"Farmacéutica",NVO:"Farmacéutica",

  // Biotecnología
  AMGN:"Biotecnología",GILD:"Biotecnología",REGN:"Biotecnología",
  VRTX:"Biotecnología",BIIB:"Biotecnología",MRNA:"Biotecnología",
  BNTX:"Biotecnología",ILMN:"Biotecnología",ALNY:"Biotecnología",

  // Financiero (bancos de inversión, gestoras, pagos)
  GS:"Financiero",MS:"Financiero",BX:"Financiero",
  KKR:"Financiero",APO:"Financiero",SCHW:"Financiero",
  V:"Financiero",MA:"Financiero",AXP:"Financiero",
  BRK:"Financiero",BRKB:"Financiero",

  // Bancario
  JPM:"Bancario",BAC:"Bancario",WFC:"Bancario",
  C:"Bancario",USB:"Bancario",PNC:"Bancario",TFC:"Bancario",

  // Seguros
  PRU:"Seguros",MET:"Seguros",AFL:"Seguros",
  TRV:"Seguros",AIG:"Seguros",CB:"Seguros",ALL:"Seguros",PGR:"Seguros",

  // Energía
  XOM:"Energía",CVX:"Energía",COP:"Energía",OXY:"Energía",
  SLB:"Energía",HAL:"Energía",EOG:"Energía",PXD:"Energía",
  DVN:"Energía",PSX:"Energía",VLO:"Energía",MPC:"Energía",

  // Energía Renovable
  ENPH:"Energía Renovable",SEDG:"Energía Renovable",FSLR:"Energía Renovable",
  RUN:"Energía Renovable",PLUG:"Energía Renovable",BE:"Energía Renovable",NEE:"Energía Renovable",

  // Industriales
  CAT:"Industriales",DE:"Industriales",GE:"Industriales",
  HON:"Industriales",EMR:"Industriales",ETN:"Industriales",
  ITW:"Industriales",PH:"Industriales",MMM:"Industriales",CARR:"Industriales",

  // Aeroespacial & Defensa
  LMT:"Aeroespacial",RTX:"Aeroespacial",NOC:"Aeroespacial",
  GD:"Aeroespacial",BA:"Aeroespacial",TDG:"Aeroespacial",
  HEI:"Aeroespacial",AXON:"Aeroespacial",RKLB:"Aeroespacial",

  // Logística & Transporte
  UPS:"Logística",FDX:"Logística",CHRW:"Logística",
  EXPD:"Logística",GXO:"Logística",XPO:"Logística",ODFL:"Logística",

  // Materiales
  LIN:"Materiales",APD:"Materiales",DOW:"Materiales",
  NEM:"Materiales",FCX:"Materiales",AA:"Materiales",
  NUE:"Materiales",MLM:"Materiales",VMC:"Materiales",ALB:"Materiales",

  // Telecomunicaciones
  T:"Telecomunicaciones",VZ:"Telecomunicaciones",TMUS:"Telecomunicaciones",
  CMCSA:"Telecomunicaciones",CHTR:"Telecomunicaciones",

  // Medios & Entretenimiento
  WBD:"Medios",PARA:"Medios",FOX:"Medios",FOXA:"Medios",

  // Real Estate
  AMT:"Real Estate",CCI:"Real Estate",PLD:"Real Estate",
  EQR:"Real Estate",SPG:"Real Estate",PSA:"Real Estate",
  VICI:"Real Estate",VNQ:"Real Estate",EQIX:"Real Estate",

  // Cripto / Blockchain
  COIN:"Cripto",MSTR:"Cripto",MARA:"Cripto",RIOT:"Cripto",

  // ETF
  SPY:"ETF",QQQ:"ETF",VTI:"ETF",IVV:"ETF",VOO:"ETF",
  IWM:"ETF",GLD:"ETF",SLV:"ETF",TLT:"ETF",HYG:"ETF",
  XLK:"ETF",XLF:"ETF",DIA:"ETF",ARKK:"ETF",TQQQ:"ETF",
  SQQQ:"ETF",VGT:"ETF",SMH:"ETF",
};

// ─── Portfolio risk classification ────────────────────────────────────────

const TICKER_RISK_OVERRIDE: Record<string, number> = {
  // Especulativo
  GME:96, AMC:96, BBBY:96, SPCE:90,
  MSTR:93, MARA:92, RIOT:92, COIN:90,
  RIVN:88, LCID:88, NIO:86, RKLB:84,
  TQQQ:90, SQQQ:90, ARKK:82,
  // Alto riesgo
  TSLA:84, PLTR:82, SNAP:82, HOOD:82, RBLX:80,
  SOFI:78, AFRM:83, UPST:85, DKNG:80,
  NVDA:77, AMD:76, SMCI:80, ARM:78, SNOW:77, MDB:75,
  // Crecimiento moderado-alto
  SHOP:74, SQ:75, META:68, NFLX:68, UBER:70, LYFT:75,
  ABNB:72, DDOG:73, NET:72, ZS:72, BNTX:72, MRNA:72,
  // Blue chip tech
  AAPL:60, MSFT:58, GOOGL:60, AMZN:63, ORCL:55,
  ADBE:60, CRM:62, NOW:62, INTU:58,
  // Financiero establecido
  JPM:48, BAC:50, GS:55, MS:52, V:45, MA:45, AXP:50, SCHW:52,
  // Salud / Farma
  JNJ:28, PFE:35, UNH:32, ABBV:38, LLY:42, AMGN:36,
  MRK:34, BMY:36, VRTX:65, REGN:60,
  // Consumo defensivo
  WMT:22, KO:18, PG:18, MCD:25, COST:30, SBUX:35, NKE:45, HD:38,
  // Energía
  XOM:48, CVX:48, COP:55, OXY:58, SLB:55,
  // Semis establecidos
  INTC:52, TXN:55, QCOM:62, AVGO:60, ADI:58,
  // ETF
  SPY:20, VOO:20, VTI:20, IVV:20, QQQ:38, IWM:45, GLD:30,
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
  { label: "Conservador",           min: 0,   max: 13,  color: "#3b82f6" },
  { label: "Conservador-Moderado",  min: 13,  max: 25,  color: "#60a5fa" },
  { label: "Moderado",              min: 25,  max: 38,  color: "#f59e0b" },
  { label: "Moderado-Growth",       min: 38,  max: 51,  color: "#f97316" },
  { label: "Growth",                min: 51,  max: 63,  color: "#fb923c" },
  { label: "Agresivo",              min: 63,  max: 75,  color: "#ef4444" },
  { label: "Agresivo-Especulativo", min: 75,  max: 88,  color: "#dc2626" },
  { label: "Especulativo",          min: 88,  max: 101, color: "#7f1d1d" },
] as const;

function getPositionRisk(ticker: string): number {
  if (TICKER_RISK_OVERRIDE[ticker] !== undefined) return TICKER_RISK_OVERRIDE[ticker];
  const sector = TICKER_SECTOR[ticker];
  return sector ? (SECTOR_RISK_BASE[sector] ?? 62) : 62;
}

function scorePortfolio(
  positions: Position[],
  pricesData: Record<string, PriceData>
): { score: number; levelIdx: number; sectorPcts: Record<string, number> } {
  if (!positions.length) return { score: 0, levelIdx: 0, sectorPcts: {} };
  let totalVal = 0, weightedRisk = 0;
  const sectorVals: Record<string, number> = {};
  for (const pos of positions) {
    const price = pricesData[pos.ticker]?.price ?? pos.avgPrice;
    const val = pos.shares * price;
    totalVal += val;
    weightedRisk += getPositionRisk(pos.ticker) * val;
    const sector = TICKER_SECTOR[pos.ticker] ?? "Otro";
    sectorVals[sector] = (sectorVals[sector] ?? 0) + val;
  }
  if (totalVal === 0) return { score: 0, levelIdx: 0, sectorPcts: {} };
  let score = weightedRisk / totalVal;
  const topVal = Math.max(...positions.map((p) => p.shares * (pricesData[p.ticker]?.price ?? p.avgPrice)));
  const topPct = topVal / totalVal;
  if (topPct > 0.4) score = Math.min(100, score + (topPct - 0.4) * 20);
  if (positions.length >= 10) score = Math.max(0, score - 4);
  score = Math.round(Math.min(100, Math.max(0, score)));
  const idx = PORTFOLIO_LEVELS.findIndex((l) => score >= l.min && score < l.max);
  const sectorPcts: Record<string, number> = {};
  for (const [s, v] of Object.entries(sectorVals)) sectorPcts[s] = Math.round((v / totalVal) * 100);
  return { score, levelIdx: idx === -1 ? 7 : idx, sectorPcts };
}

function buildFeedback(
  levelIdx: number,
  profile: UserProfile | null,
  age: number,
  sectorPcts: Record<string, number>
): string[] {
  if (!profile || age === 0) return [];
  const firstName = profile.name.split(" ")[0];
  const levelLabel = PORTFOLIO_LEVELS[levelIdx].label.toLowerCase();
  const profileRange: Record<string, [number, number]> = {
    conservative: [0, 2], moderate: [1, 4], aggressive: [3, 7],
  };
  const [pMin, pMax] = profileRange[profile.risk_tolerance] ?? [1, 4];
  const ageTargetIdx = age < 30 ? 4 : age < 40 ? 3 : age < 50 ? 2 : age < 60 ? 1 : 0;
  const topSector = Object.entries(sectorPcts).sort((a, b) => b[1] - a[1])[0];
  const topSectorStr = topSector ? ` con ${topSector[1]}% en ${topSector[0]}` : "";
  const profileLabel = profile.risk_tolerance === "conservative" ? "conservador" : profile.risk_tolerance === "moderate" ? "moderado" : "agresivo";
  const lines: string[] = [];
  lines.push(`Tu portafolio tiene un perfil ${levelLabel}${topSectorStr}, ${firstName}.`);
  if (levelIdx < pMin) {
    lines.push(`Es más conservador que tu perfil ${profileLabel} — puede que estés dejando rendimiento potencial en la mesa.`);
  } else if (levelIdx > pMax) {
    lines.push(`Estás tomando más riesgo del que tu perfil ${profileLabel} indica. Si hay una corrección, el impacto puede superarte emocionalmente.`);
  } else {
    lines.push(`Está bien alineado con tu perfil de inversionista ${profileLabel}.`);
  }
  const ageTargetLabel = PORTFOLIO_LEVELS[ageTargetIdx].label;
  if (levelIdx > ageTargetIdx + 1) {
    lines.push(`Con ${age} años y este nivel de riesgo, asegúrate de tener un fondo de emergencia sólido antes de mantener esta exposición.`);
  } else if (levelIdx < ageTargetIdx - 1 && age < 45) {
    lines.push(`Con ${age} años tienes un horizonte largo — podrías crecer gradualmente hacia un perfil ${ageTargetLabel.toLowerCase()} para maximizar tu acumulación.`);
  } else {
    lines.push(`Con ${age} años, este nivel de riesgo es adecuado para tu horizonte de inversión.`);
  }
  return lines;
}

interface StressScenario {
  id: string; name: string; icon: string; color: string;
  year: string; desc: string;
  drawdowns: Record<string, number>;
  default: number;
}

const STRESS_SCENARIOS: StressScenario[] = [
  {
    id: "2008", name: "Crisis 2008", icon: "🏦", color: "#ef4444", year: "2008-09",
    desc: "Colapso del sistema financiero global", default: -42,
    drawdowns: {
      Semiconductores:-55, Software:-48, Tecnología:-52, "Inteligencia Artificial":-52,
      Fintech:-55, eCommerce:-50, "Consumo Discrecional":-42, "Consumo Básico":-20,
      Salud:-18, "Farmacéutica":-22, Biotecnología:-30,
      Bancario:-80, Financiero:-68, Seguros:-55,
      Energía:-55, "Energía Renovable":-60,
      Industriales:-42, Aeroespacial:-40, Logística:-40, Materiales:-55,
      Telecomunicaciones:-32, Medios:-42, "Real Estate":-65, Cripto:-55, ETF:-38,
    },
  },
  {
    id: "covid", name: "COVID-19", icon: "🦠", color: "#f97316", year: "Feb-Mar 2020",
    desc: "Crash de 33 días, caída brusca y rápida", default: -34,
    drawdowns: {
      Semiconductores:-35, Software:-28, Tecnología:-32, "Inteligencia Artificial":-30,
      Fintech:-38, eCommerce:18, "Consumo Discrecional":-50, "Consumo Básico":-12,
      Salud:-10, "Farmacéutica":-15, Biotecnología:15,
      Bancario:-48, Financiero:-42, Seguros:-38,
      Energía:-65, "Energía Renovable":-38,
      Industriales:-40, Aeroespacial:-55, Logística:-32, Materiales:-40,
      Telecomunicaciones:-22, Medios:-45, "Real Estate":-40, Cripto:-50, ETF:-34,
    },
  },
  {
    id: "tech2022", name: "Tech Crash '22", icon: "📉", color: "#f59e0b", year: "2022",
    desc: "Alza de tasas aplasta valuaciones tech", default: -20,
    drawdowns: {
      Semiconductores:-62, Software:-58, Tecnología:-52, "Inteligencia Artificial":-60,
      Fintech:-70, eCommerce:-55, "Consumo Discrecional":-18, "Consumo Básico":-10,
      Salud:-8, "Farmacéutica":-10, Biotecnología:-32,
      Bancario:-18, Financiero:-22, Seguros:-12,
      Energía:45, "Energía Renovable":-35,
      Industriales:-12, Aeroespacial:-8, Logística:-20, Materiales:-20,
      Telecomunicaciones:-28, Medios:-40, "Real Estate":-25, Cripto:-75, ETF:-18,
    },
  },
  {
    id: "fed", name: "Fed +1%", icon: "🏛️", color: "#6366f1", year: "Escenario",
    desc: "Subida sorpresiva de 100pb en tasas", default: -12,
    drawdowns: {
      Semiconductores:-22, Software:-25, Tecnología:-20, "Inteligencia Artificial":-28,
      Fintech:-28, eCommerce:-22, "Consumo Discrecional":-12, "Consumo Básico":-8,
      Salud:-5, "Farmacéutica":-8, Biotecnología:-15,
      Bancario:8, Financiero:5, Seguros:3,
      Energía:-8, "Energía Renovable":-20,
      Industriales:-10, Aeroespacial:-8, Logística:-10, Materiales:-12,
      Telecomunicaciones:-15, Medios:-10, "Real Estate":-20, Cripto:-35, ETF:-12,
    },
  },
  {
    id: "bull", name: "Bull Market", icon: "🚀", color: "#22c55e", year: "Escenario",
    desc: "Año de recuperación y euforia inversora", default: 22,
    drawdowns: {
      Semiconductores:55, Software:40, Tecnología:38, "Inteligencia Artificial":60,
      Fintech:42, eCommerce:38, "Consumo Discrecional":25, "Consumo Básico":12,
      Salud:18, "Farmacéutica":20, Biotecnología:32,
      Bancario:25, Financiero:28, Seguros:18,
      Energía:22, "Energía Renovable":40,
      Industriales:22, Aeroespacial:28, Logística:20, Materiales:25,
      Telecomunicaciones:15, Medios:20, "Real Estate":25, Cripto:80, ETF:25,
    },
  },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

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



// ─── Portfolio historical chart ────────────────────────────────────────────

type ChartPoint = { date: string; pct: number; value: number };

function fmtChartDate(s: string, full = false) {
  try {
    const hasTime = s.includes("T") || (s.includes(" ") && s.includes(":"));
    const d = new Date(hasTime ? s.replace(" ", "T") : s + "T12:00:00");
    if (hasTime) return d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
    if (full) return d.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
    return d.toLocaleDateString("es", { month: "short", day: "numeric" });
  } catch { return s.slice(5, 10); }
}

function PortfolioHistoryChart({
  history, color, currencySymbol, positions,
}: {
  history: ChartPoint[];
  color: string;
  currencySymbol: string;
  positions: Array<{ purchaseDate?: string | null; shares: number; avgPrice: number }>;
}) {
  const { colors } = useTheme();
  const [hovIdx, setHovIdx] = useState<number | null>(null);
  const [ctrW, setCtrW] = useState(0);

  const Y_AXIS_W = 46;
  const W = Math.max(100, ctrW - Y_AXIS_W);
  const H = 180;
  const PT = 12, PB = 8, PL = 2;
  const cW = W - PL;
  const cH = H - PT - PB;

  const costBasis = useMemo(
    () => positions.reduce((s, p) => s + p.shares * p.avgPrice, 0),
    [positions],
  );

  const updateHov = useCallback((x: number) => {
    if (cW <= 0 || history.length < 2) return;
    const ratio = Math.max(0, Math.min(1, (x - PL) / cW));
    setHovIdx(Math.round(ratio * (history.length - 1)));
  }, [cW, history.length]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => updateHov(evt.nativeEvent.locationX),
    onPanResponderMove: (evt) => updateHov(evt.nativeEvent.locationX),
    onPanResponderRelease: () => setHovIdx(null),
    onPanResponderTerminate: () => setHovIdx(null),
  }), [updateHov]);

  if (history.length < 2) return null;

  // ── Cumulative investment curve ──────────────────────────────────────────
  const noDateCost = positions
    .filter(p => !p.purchaseDate && p.avgPrice > 0)
    .reduce((s, p) => s + p.shares * p.avgPrice, 0);
  const events = positions
    .filter(p => p.purchaseDate && p.avgPrice > 0)
    .map(p => ({ date: p.purchaseDate!, cost: p.shares * p.avgPrice }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const investedCurve = history.map(h => {
    const fromDated = events.filter(e => e.date <= h.date).reduce((s, e) => s + e.cost, 0);
    return noDateCost + fromDated;
  });
  const hasCurveData = investedCurve[investedCurve.length - 1] > 0;
  const effectiveCurve = hasCurveData ? investedCurve : history.map(() => costBasis);

  // ── Value range ──────────────────────────────────────────────────────────
  const vals = history.map(h => h.value);
  const endV = vals[vals.length - 1];
  const allVals = [...vals, ...effectiveCurve.filter(v => v > 0)];
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const spread = maxV - minV || Math.abs(maxV) || 1;
  const lo = minV - spread * 0.08;
  const hi = maxV + spread * 0.14;
  const range = hi - lo;

  const toX = (i: number) => PL + (i / (history.length - 1)) * cW;
  const toY = (v: number) => PT + ((hi - v) / range) * cH;

  // ── Paths ────────────────────────────────────────────────────────────────
  const pts = history.map((h, i) => `${toX(i).toFixed(1)},${toY(h.value).toFixed(1)}`);
  const lineD = "M" + pts.join("L");
  const lx = toX(history.length - 1);
  const ly = toY(endV);
  const by = PT + cH;
  const areaD = `${lineD}L${lx.toFixed(1)},${by}L${PL},${by}Z`;
  const invD = "M" + effectiveCurve.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join("L");

  // ── Y-axis ticks ─────────────────────────────────────────────────────────
  const yTicks = [0, 1, 2, 3].map(i => ({ v: hi - (range * i) / 3, y: PT + (cH * i) / 3 }));

  // ── X-axis indices ────────────────────────────────────────────────────────
  const xIdxs = [0, 1, 2, 3].map(i => Math.round((i * (history.length - 1)) / 3));

  // ── Hover computations ───────────────────────────────────────────────────
  const hovV   = hovIdx !== null ? vals[hovIdx] : null;
  const hovX   = hovIdx !== null ? toX(hovIdx) : null;
  const hovY   = hovIdx !== null ? toY(vals[hovIdx]) : null;
  const hovPt  = hovIdx !== null ? history[hovIdx] : null;
  const hovInv = hovIdx !== null ? effectiveCurve[hovIdx] : effectiveCurve[effectiveCurve.length - 1];
  const base   = hovInv > 0 ? hovInv : (costBasis > 0 ? costBasis : 1);
  const chgV   = hovV !== null ? hovV - base : endV - base;
  const chgP   = base > 0 ? (chgV / base) * 100 : 0;
  const isHovUp = (hovV ?? endV) >= base;
  const hCol    = isHovUp ? "#22c55e" : "#ef4444";

  const fmtV = (v: number) => {
    const abs = Math.abs(v), sign = v < 0 ? "-" : "";
    if (abs >= 1e6) return `${sign}${currencySymbol}${(abs / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${sign}${currencySymbol}${(abs / 1e3).toFixed(1)}K`;
    return `${sign}${currencySymbol}${abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };
  const fmtY = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${Math.round(v / 1e3)}K`;
    return Math.round(v).toString();
  };

  const ttLeft  = hovX !== null && hovX < W * 0.55 ? hovX + 8 : undefined;
  const ttRight = hovX !== null && hovX >= W * 0.55 ? W - hovX + 8 : undefined;

  return (
    <View onLayout={e => setCtrW(e.nativeEvent.layout.width)}>
      {ctrW > 0 && (
        <>
          {/* Chart area + Y-axis */}
          <View style={{ flexDirection: "row" }}>
            {/* Touchable chart */}
            <View style={{ width: W, height: H, position: "relative" }} {...panResponder.panHandlers}>
              {/* Floating tooltip */}
              {hovPt && hovV !== null && (
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute", zIndex: 20,
                    left: ttLeft, right: ttRight, top: 6,
                    backgroundColor: colors.card,
                    borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8,
                    borderWidth: 1, borderColor: hCol + "28",
                    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.18, shadowRadius: 12, elevation: 8,
                  }}
                >
                  <Text style={{ fontSize: 15, fontWeight: "900", color: colors.text, lineHeight: 18 }}>
                    {fmtV(hovV)}
                  </Text>
                  <Text style={{ fontSize: 10, fontWeight: "700", color: hCol, marginTop: 1 }}>
                    {isHovUp ? "+" : ""}{fmtV(chgV)} ({isHovUp ? "+" : ""}{chgP.toFixed(2)}%)
                  </Text>
                  <Text style={{ fontSize: 9, color: colors.textDim, marginTop: 2 }}>
                    vs {fmtV(hovInv)} invertido
                  </Text>
                  <Text style={{ fontSize: 9, color: colors.textDim, marginTop: 1 }}>
                    {fmtChartDate(hovPt.date, true)}
                  </Text>
                </View>
              )}
              <Svg width={W} height={H}>
                <Defs>
                  <LinearGradient id="pfhg_m" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={color} stopOpacity="0.20" />
                    <Stop offset="0.65" stopColor={color} stopOpacity="0.04" />
                    <Stop offset="1" stopColor={color} stopOpacity="0" />
                  </LinearGradient>
                </Defs>
                {/* Y gridlines */}
                {yTicks.map((t, i) => (
                  <SvgLine key={i} x1={PL} y1={t.y} x2={W} y2={t.y}
                    stroke="#888" strokeWidth={0.55} strokeOpacity={0.12} />
                ))}
                {/* Investment curve — dashed amber */}
                <Path d={invD} fill="none" stroke="#f59e0b"
                  strokeWidth={1.4} strokeDasharray="5,3" strokeOpacity={0.65}
                  strokeLinejoin="round" />
                {/* Area fill */}
                <Path d={areaD} fill="url(#pfhg_m)" />
                {/* Main portfolio line */}
                <Path d={lineD} fill="none" stroke={color} strokeWidth={2.2}
                  strokeLinejoin="round" strokeLinecap="round" />
                {/* End dot — idle */}
                {hovIdx === null && (
                  <>
                    <Circle cx={lx} cy={ly} r={6} fill={color} fillOpacity={0.18} />
                    <Circle cx={lx} cy={ly} r={2.8} fill={color} />
                  </>
                )}
                {/* Cursor crosshair */}
                {hovIdx !== null && hovX !== null && hovY !== null && (
                  <>
                    <SvgLine x1={hovX} y1={PT} x2={hovX} y2={PT + cH}
                      stroke={hCol} strokeWidth={1.2} strokeOpacity={0.45} />
                    <Circle cx={hovX} cy={hovY} r={7.5} fill={hCol} fillOpacity={0.13} />
                    <Circle cx={hovX} cy={hovY} r={3.2} fill={hCol} />
                    <Circle cx={hovX} cy={hovY} r={5.8} fill="none"
                      stroke={hCol} strokeWidth={1.3} strokeOpacity={0.5} />
                  </>
                )}
              </Svg>
            </View>
            {/* Y-axis labels */}
            <View style={{ width: Y_AXIS_W, height: H }}>
              {yTicks.map((t, i) => (
                <Text key={i} style={{
                  position: "absolute", left: 4, top: t.y - 6,
                  fontSize: 9, fontWeight: "500", color: colors.textDim,
                }}>
                  {fmtY(t.v)}
                </Text>
              ))}
            </View>
          </View>
          {/* X-axis date labels */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4, paddingRight: Y_AXIS_W }}>
            {xIdxs.map((idx) => (
              <Text key={idx} style={{ fontSize: 9, fontWeight: "500", color: colors.textDim }}>
                {fmtChartDate(history[idx].date)}
              </Text>
            ))}
          </View>
          {/* Legend */}
          <View style={{ flexDirection: "row", gap: 12, marginTop: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <View style={{ width: 16, height: 2, backgroundColor: color, borderRadius: 1 }} />
              <Text style={{ fontSize: 9, color: colors.textDim }}>Portafolio</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <View style={{ width: 12, height: 1, borderBottomWidth: 1, borderColor: "#f59e0b", borderStyle: "dashed" }} />
              <Text style={{ fontSize: 9, color: colors.textDim }}>Invertido</Text>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function PortfolioScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);


  const {
    positions, addPosition, removePosition, updatePosition, setPositions, mergePositions,
    clearPortfolio, portfolioCurrency, setCurrency,
    loadFromServer, syncStatus, lastSaved,
  } = usePortfolioStore();
  const profile = useAppStore((s) => s.profile);
  const subStore = useSubscriptionStore();
  const isPremiumAccess = hasPremiumAccess(subStore);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<"portafolio" | "herramientas">("portafolio");
  const age = profile?.birth_date ? getAge(profile.birth_date) : 0;
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [priceError, setPriceError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fxRate, setFxRate] = useState(1);

  // Currency symbol for display
  const currencySymbol = portfolioCurrency === "USD" ? "$"
    : portfolioCurrency === "EUR" ? "€"
    : portfolioCurrency === "GBP" ? "£"
    : portfolioCurrency === "JPY" ? "¥"
    : `${portfolioCurrency} `;

  // Fallback rates USD → user currency
  const FALLBACK_TO_LOCAL: Record<string, number> = {
    MXN: 17.5, EUR: 0.92, GBP: 0.79, CAD: 1.37, ARS: 870,
    BRL: 5.0, COP: 4000, CLP: 900, PEN: 3.7, JPY: 150, AUD: 1.55,
  };

  // Fetch live FX rate USD → portfolioCurrency when currency changes
  useEffect(() => {
    if (portfolioCurrency === "USD") { setFxRate(1); return; }
    fetch(`https://api.frankfurter.app/latest?from=USD&to=${portfolioCurrency}`)
      .then((r) => r.json())
      .then((d) => { if (d.rates?.[portfolioCurrency]) setFxRate(d.rates[portfolioCurrency]); })
      .catch(() => setFxRate(FALLBACK_TO_LOCAL[portfolioCurrency] ?? 1));
  }, [portfolioCurrency]);

  // Currency import modal
  type PendingImport = { ticker: string; name?: string; shares: number; avgPrice: number }[];
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importCurrency, setImportCurrency] = useState("USD");
  const [convertingCurrency, setConvertingCurrency] = useState(false);

  // Screenshot import
  const [screenshotAnalyzing, setScreenshotAnalyzing] = useState(false);
  const [screenshotProgress, setScreenshotProgress] = useState("");
  const [screenshotPreview, setScreenshotPreview] = useState<ExtractedPosition[] | null>(null);
  const [screenshotUris, setScreenshotUris] = useState<string[]>([]);

  // Sort
  type SortField = "return" | "invested" | "price";
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir("desc"); }
  };

  // Currency picker
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);

  // Sector drill-down
  const [selectedSector, setSelectedSector] = useState<string | null>(null);

  // Edit position
  const [editingPos, setEditingPos] = useState<{ id: string; shares: string; avgPrice: string; purchaseDate: string } | null>(null);
  const [revealedPrices, setRevealedPrices] = useState<Set<string>>(new Set());

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

  // Chart state
  type ChartData = { history: ChartPoint[]; period_pct: number; period_amount: number };
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [chartLoading, setChartLoading] = useState(false);

  // Manual add form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ticker: "", shares: "", avgPrice: "" });
  const [addingLoading, setAddingLoading] = useState(false);

  // Simulator
  const riskCfg = profile?.risk_tolerance ? RISK_CONFIG[profile.risk_tolerance] : null;
  const [scenario, setScenario] = useState<Scenario>(
    (profile?.risk_tolerance as Scenario) ?? "moderate"
  );
  const [analysis, setAnalysis] = useState("");
  const [simLoading, setSimLoading] = useState(false);
  type PortfolioResult = {
    summary: string;
    mismatch?: string;
    allocations: { ticker: string; name: string; pct: number; color: string; reason: string }[];
    risks: string[];
    history: Record<string, string>;
  };
  const [portfolioResult, setPortfolioResult] = useState<PortfolioResult | null>(null);

  const fetchPrices = useCallback(async (silent = false) => {
    if (!positions.length) return;
    if (!silent) setLoadingPrices(true);
    try {
      const res = await marketApi.getPrices(positions.map((p) => p.ticker));
      setPrices(res.data);
      setPriceError(false);
    } catch {
      if (!silent) setPriceError(true);
    }
    setLoadingPrices(false);
  }, [positions]);

  // Refresh on tab focus
  useFocusEffect(useCallback(() => {
    fetchPrices(true);
    const interval = setInterval(() => fetchPrices(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchPrices]));

  // Re-fetch whenever positions are added/removed so new entries get prices immediately
  useEffect(() => {
    if (positions.length > 0) fetchPrices(true);
  }, [positions.length]);

  // Cargar portafolio del servidor al montar Y cada vez que el tab recibe foco.
  // Esto garantiza que los cambios hechos en web (u otro dispositivo) siempre
  // aparezcan en mobile sin reiniciar la app.
  const lastSyncRef = useRef<number>(0);
  useFocusEffect(useCallback(() => {
    const now = Date.now();
    // Throttle: no más de una sincronización cada 30 s para no saturar el servidor
    if (now - lastSyncRef.current > 30_000) {
      lastSyncRef.current = now;
      loadFromServer();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  // Sincronizar también cuando el app vuelve al frente desde background
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") {
        const now = Date.now();
        if (now - lastSyncRef.current > 30_000) {
          lastSyncRef.current = now;
          loadFromServer();
        }
      }
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clave estable que cambia con tickers, acciones o fecha de compra
  const positionsKey = useMemo(
    () => positions.map((p) => `${p.ticker}:${p.shares}:${p.purchaseDate ?? ""}`).join("|"),
    [positions]
  );

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
  useEffect(() => { fetchReturns(true); }, [positionsKey]);
  useEffect(() => { fetchChart(true); }, [selectedPeriod, positionsKey]);

  // Auto-refresh en tiempo real — returns cada 30s, chart cada 60s
  useFocusEffect(useCallback(() => {
    if (positions.length === 0) return;
    const ri = setInterval(() => fetchReturns(false), 30_000);
    const ci = setInterval(() => fetchChart(false), 60_000);
    return () => { clearInterval(ri); clearInterval(ci); };
  }, [positions.length, fetchReturns, fetchChart]));

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchPrices(true);
    setRefreshing(false);
  };

  // ── Currency import — keep prices in original currency, just store the currency ──
  const applyImport = async (currency: string) => {
    if (!pendingImport) return;
    setCurrency(currency);
    setPositions(pendingImport);
    setConvertingCurrency(false);
    setPendingImport(null);
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
      allowsMultipleSelection: true,
    });

    if (result.canceled || !result.assets?.length) return;

    const assets = result.assets.filter((a) => a.base64);
    if (!assets.length) return;

    setScreenshotUris(assets.map((a) => a.uri));
    setScreenshotAnalyzing(true);
    setScreenshotPreview(null);
    setScreenshotProgress(assets.length > 1 ? `Analizando 1 de ${assets.length}...` : "Analizando con IA...");

    try {
      const allExtracted: ExtractedPosition[] = [];

      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        if (assets.length > 1) setScreenshotProgress(`Analizando ${i + 1} de ${assets.length}...`);
        const mimeType = asset.mimeType || "image/jpeg";
        const res = await marketApi.analyzeScreenshot(asset.base64!, mimeType);
        const fromImage: ExtractedPosition[] = (res.data.positions || []).map(
          (p: Omit<ExtractedPosition, "id">, j: number) => ({
            ...p,
            id: `${p.ticker}-${i}-${j}-${Date.now()}`,
          })
        );
        allExtracted.push(...fromImage);
      }

      // Merge: deduplicate by ticker, prefer entry with avg_price > 0
      const merged = new Map<string, ExtractedPosition>();
      for (const pos of allExtracted) {
        const existing = merged.get(pos.ticker);
        if (!existing || (pos.avg_price > 0 && existing.avg_price === 0)) {
          merged.set(pos.ticker, pos);
        }
      }
      const final = Array.from(merged.values());

      if (!final.length) {
        Alert.alert("Sin posiciones detectadas", "No se encontraron posiciones en las imágenes. Intenta con capturas más claras.");
        setScreenshotUris([]);
      } else {
        setScreenshotPreview(final);
      }
    } catch {
      Alert.alert("Error", "No se pudieron analizar las imágenes. Verifica que el backend esté corriendo.");
      setScreenshotUris([]);
    } finally {
      setScreenshotAnalyzing(false);
      setScreenshotProgress("");
    }
  };

  const removeExtracted = (id: string) => {
    setScreenshotPreview((prev) => {
      const next = (prev ?? []).filter((p) => p.id !== id);
      if (!next.length) { setScreenshotUris([]); return null; }
      return next;
    });
  };

  const confirmScreenshotImport = () => {
    if (!screenshotPreview?.length) return;
    if (!isPremiumAccess && screenshotPreview.length > FREE_POSITION_LIMIT) {
      setPaywallOpen(true);
      return;
    }

    type ImportItem = { ticker: string; name: string; shares: number; avgPrice: number };
    const incoming: ImportItem[] = screenshotPreview.map((p) => ({
      ticker: p.ticker,
      name: p.name ?? "",
      shares: p.shares,
      avgPrice: p.avg_price,
    }));

    // Resolve merge vs replace now; store the final list in pendingImport for currency selection
    const openCurrencyModal = (toImport: ImportItem[]) => {
      setPendingImport(toImport);
      setScreenshotPreview(null);
      setScreenshotUris([]);
      setImportCurrency("USD");
    };

    if (positions.length > 0) {
      const newTickers = incoming.filter(
        (p) => !positions.some((e) => e.ticker.toUpperCase() === p.ticker.toUpperCase())
      ).length;
      Alert.alert(
        "Ya tienes posiciones guardadas",
        `Tienes ${positions.length} posición${positions.length !== 1 ? "es" : ""} en tu portafolio.\n\n` +
        (newTickers > 0
          ? `Se agregarán ${newTickers} nueva${newTickers !== 1 ? "s" : ""} (las duplicadas se ignoran).`
          : "Todas las posiciones de la foto ya están en tu portafolio."),
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Eliminar y reemplazar", style: "destructive", onPress: () => openCurrencyModal(incoming) },
          {
            text: "Mantener y agregar", onPress: () => {
              // Pre-merge: deduplicate by ticker, keep existing entries for dupes
              const merged = [...positions.map((p) => ({ ticker: p.ticker, name: p.name ?? "", shares: p.shares, avgPrice: p.avgPrice }))];
              for (const inc of incoming) {
                if (!merged.some((e) => e.ticker.toUpperCase() === inc.ticker.toUpperCase())) {
                  merged.push(inc);
                }
              }
              openCurrencyModal(merged);
            },
          },
        ]
      );
    } else {
      openCurrencyModal(incoming);
    }
  };

  // ── Manual add ─────────────────────────────────────────────────────────
  const handleAdd = async () => {
    const ticker = form.ticker.trim().toUpperCase();
    const shares = parseFloat(form.shares);
    const avgPrice = parseFloat(form.avgPrice);
    if (!ticker || !shares || !avgPrice) { Alert.alert("Completa todos los campos"); return; }
    if (!isPremiumAccess && positions.length >= FREE_POSITION_LIMIT) { setPaywallOpen(true); return; }
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


  // ── Simulator 1: portfolio AI analysis ────────────────────────────────
  const simulate = async () => {
    setSimLoading(true); setAnalysis(""); setPortfolioResult(null);
    try {
      const positionsPayload = positions.length > 0
        ? positions.map((p) => ({ ticker: p.ticker, shares: p.shares, avg_price: p.avgPrice, name: p.name }))
        : undefined;
      const res = await marketApi.getPortfolio(
        scenario,
        undefined,
        positionsPayload,
      );
      const text: string = res.data.analysis;
      // Try to parse structured JSON (no-positions mode)
      if (!positionsPayload) {
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]) as PortfolioResult;
            if (parsed.allocations?.length) { setPortfolioResult(parsed); }
          }
        } catch { /* fallback to text */ }
      }
      setAnalysis(text);
    } catch { setAnalysis("Error al generar el análisis. Intenta de nuevo."); }
    finally { setSimLoading(false); }
  };

  // Stress Test state
  const [stressScenario, setStressScenario] = useState<string | null>(null);
  const [stressResult, setStressResult] = useState<null | {
    total: number; stressed: number; diff: number; pct: number;
    rows: { ticker: string; invested: number; stressed: number; diff: number; pct: number; sector: string }[];
  }>(null);

  // ── Calculadora de Inversión ────────────────────────────────────────────
  const [calcCapital, setCalcCapital] = useState("");
  const [calcMonthly, setCalcMonthly] = useState("");
  const [calcReturn, setCalcReturn]   = useState("");
  const [calcYears, setCalcYears]     = useState("");

  interface CalcBar { year: number; invested: number; returns: number; total: number; }
  const [calcResult, setCalcResult]   = useState<{
    final: number; invested: number; gain: number; pct: number;
    multiplier: number; realFinal: number;
    bars: CalcBar[];
  } | null>(null);

  // FV de una anualidad ordinaria mensual
  const _fv = (pv: number, pmt: number, rMonthly: number, months: number) => {
    const f = Math.pow(1 + rMonthly, months);
    return pv * f + (pmt > 0 && rMonthly > 0 ? pmt * (f - 1) / rMonthly : pmt * months);
  };

  const CHART_YEARS = [1, 5, 10, 15, 20];

  const calculateCompound = () => {
    const pv  = parseFloat(calcCapital) || 0;
    const pmt = parseFloat(calcMonthly) || 0;
    const ann = parseFloat(calcReturn)  || 0;
    const yrs = parseFloat(calcYears)   || 0;
    if (!pv || !ann || !yrs) return;

    const r       = ann / 100 / 12;           // tasa mensual nominal
    const rReal   = (ann - 3.5) / 100 / 12;  // tasa mensual real (descontando 3.5% inflación)
    const n       = Math.round(yrs * 12);

    const final         = _fv(pv, pmt, r, n);
    const totalInvested = pv + pmt * n;
    const gain          = final - totalInvested;
    const realFinal     = _fv(pv, pmt, Math.max(0.0001, rReal), n); // ajustado por inflación
    const multiplier    = totalInvested > 0 ? final / totalInvested : 1;

    // Barras fijas en 1, 5, 10, 15, 20 años (siempre, sin importar el plazo)
    const bars: CalcBar[] = CHART_YEARS.map((y) => {
      const mn       = y * 12;
      const invested = pv + pmt * mn;
      const total    = _fv(pv, pmt, r, mn);
      return { year: y, invested, returns: total - invested, total };
    });

    setCalcResult({ final, invested: totalInvested, gain, pct: totalInvested > 0 ? (gain / totalInvested) * 100 : 0, multiplier, realFinal, bars });
  };

  // ── Stress Test ─────────────────────────────────────────────────────────
  const runStressTest = (scenarioId: string) => {
    const sc = STRESS_SCENARIOS.find((s) => s.id === scenarioId);
    if (!sc) return;
    setStressScenario(scenarioId);
    const rows = positions.map((pos) => {
      const currentPrice = prices[pos.ticker]?.price ?? pos.avgPrice;
      const invested = pos.shares * currentPrice;
      const sector = TICKER_SECTOR[pos.ticker] ?? "";
      const drawdown = sector ? (sc.drawdowns[sector] ?? sc.default) : sc.default;
      const stressed = invested * (1 + drawdown / 100);
      return {
        ticker: pos.ticker,
        invested,
        stressed,
        diff: stressed - invested,
        pct: drawdown,
        sector: sector || "Otro",
      };
    });
    const total = rows.reduce((acc, r) => acc + r.invested, 0);
    const stressedTotal = rows.reduce((acc, r) => acc + r.stressed, 0);
    setStressResult({
      total, stressed: stressedTotal,
      diff: stressedTotal - total,
      pct: total > 0 ? ((stressedTotal - total) / total) * 100 : 0,
      rows,
    });
  };

  // ── Totals ─────────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let invested = 0, current = 0;
    for (const p of positions) {
      invested += p.shares * p.avgPrice; // stored in user's currency
      const cpUSD = prices[p.ticker]?.price;
      current += cpUSD ? p.shares * cpUSD * fxRate : p.shares * p.avgPrice;
    }
    const diff = current - invested;
    const pct = invested > 0 ? (diff / invested) * 100 : 0;
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
    const { score, levelIdx, sectorPcts } = scorePortfolio(positions, prices);
    const feedback = buildFeedback(levelIdx, profile, age, sectorPcts);
    return { score, levelIdx, sectorPcts, feedback };
  }, [positions, prices, profile, age]);

  return (
    <SafeAreaView style={s.container}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22c55e" />}
      >

        {/* ── TAB SWITCHER ── */}
        <View style={[s.subTabBar, { backgroundColor: colors.bg }]}>
          <View style={[s.subTabInner, { backgroundColor: colors.bgRaised }]}>
            <TouchableOpacity
              style={[s.subTab, activeSection === "portafolio" && [s.subTabActive, { backgroundColor: colors.card }]]}
              onPress={() => setActiveSection("portafolio")}
              activeOpacity={0.75}
            >
              <Ionicons
                name="briefcase-outline"
                size={14}
                color={activeSection === "portafolio" ? colors.accent : colors.textMuted}
              />
              <Text style={[s.subTabText, { color: activeSection === "portafolio" ? colors.text : colors.textMuted }]}>
                Mi Portafolio
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.subTab, activeSection === "herramientas" && [s.subTabActive, { backgroundColor: colors.card }]]}
              onPress={() => setActiveSection("herramientas")}
              activeOpacity={0.75}
            >
              <Ionicons
                name="sparkles-outline"
                size={14}
                color={activeSection === "herramientas" ? colors.accent : colors.textMuted}
              />
              <Text style={[s.subTabText, { color: activeSection === "herramientas" ? colors.accent : colors.textMuted }]}>
                Herramientas
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {activeSection === "herramientas" && (
          <View style={{ gap: 12, paddingBottom: 32 }}>
            {/* Section header */}
            <View style={{ paddingHorizontal: 2, paddingBottom: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(0,168,94,0.15)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="sparkles" size={18} color={colors.accent} />
                </View>
                <View>
                  <Text style={{ fontSize: 18, fontWeight: "900", color: colors.text, letterSpacing: -0.4 }}>Herramientas Premium</Text>
                  <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>Análisis avanzado de tu portafolio</Text>
                </View>
              </View>
            </View>

            {/* ── REPORTE MENSUAL ── */}
            {isPremiumAccess
              ? <MobileMonthlyReport
                  positions={positions.map((p) => ({ ticker: p.ticker, name: p.name, shares: p.shares, avg_cost: p.avgPrice, current_price: prices[p.ticker]?.price ?? 0, value: (p.shares || 0) * (prices[p.ticker]?.price ?? p.avgPrice) }))}
                  isPremium={true} onUpgrade={() => setPaywallOpen(true)} />
              : <PremiumToolCard
                  title="Reporte Mensual"
                  tagline="Tu portafolio analizado con IA cada mes"
                  description="Genera un reporte profesional con rendimiento vs S&P 500, Sharpe ratio, volatilidad, mejores y peores posiciones del mes y nota personal de tu mentor."
                  icon="document-text-outline"
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

            {/* ── SIMULADOR ¿QUÉ PASA SI? ── */}
            {isPremiumAccess
              ? <MobileWhatIf
                  positions={positions.map((p) => ({ ticker: p.ticker, name: p.name, shares: p.shares, avg_cost: p.avgPrice, current_price: prices[p.ticker]?.price ?? 0, value: (p.shares || 0) * (prices[p.ticker]?.price ?? p.avgPrice) }))}
                  isPremium={true} onUpgrade={() => setPaywallOpen(true)} />
              : <PremiumToolCard
                  title="Simulador ¿Qué pasa si?"
                  tagline="Prueba decisiones antes de tomarlas"
                  description="Simula cualquier cambio en tu portafolio antes de ejecutarlo. Cambia posiciones, proyecta aportes o simula eventos macroeconómicos y ve el impacto real."
                  icon="flash-outline"
                  color="#f59e0b"
                  benefits={[
                    { icon: "🔄", text: "¿Qué pasa si vendo X y compro Y?" },
                    { icon: "💰", text: "Proyección de aportes mensuales a N años" },
                    { icon: "🌍", text: "Impacto de eventos macro en tu portafolio" },
                    { icon: "💡", text: "Veredicto de tu mentor en cada escenario" },
                  ]}
                  onUnlock={() => setPaywallOpen(true)}
                />
            }

            {/* ── SCREENER SEMANAL ── */}
            {isPremiumAccess
              ? <MobileWeeklyScreener isPremium={true} onUpgrade={() => setPaywallOpen(true)} existingTickers={positions.map(p => p.ticker)} />
              : <PremiumToolCard
                  title="Screener Semanal"
                  tagline="5 oportunidades personalizadas cada lunes"
                  description="Cada lunes la IA escanea el mercado y selecciona 5 oportunidades que encajan con tu perfil de riesgo, filosofía de tu mentor y los huecos en tu portafolio."
                  icon="search-outline"
                  color="#8b5cf6"
                  benefits={[
                    { icon: "🎯", text: "Filtradas por tu perfil de riesgo y mentor" },
                    { icon: "⚡", text: "Catalizador concreto y riesgo por cada pick" },
                    { icon: "🚫", text: "Nunca te sugiere lo que ya tienes" },
                    { icon: "🔄", text: "Se actualiza cada lunes automáticamente" },
                  ]}
                  onUnlock={() => setPaywallOpen(true)}
                />
            }

            <MobilePortfolioLeaderboard isPremium={isPremiumAccess} onUpgrade={() => setPaywallOpen(true)} />

          </View>
        )}

        {activeSection === "portafolio" && (
        <View>
        {/* ── Nube + sync status ── */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="cloud-outline" size={16} color="#22c55e" />
            </View>
            <View>
              <Text style={{ fontSize: 12, fontWeight: "700", color: colors.text }}>Portafolio en la nube</Text>
              <Text style={{ fontSize: 10, color: colors.textMuted }}>
                {syncStatus === "syncing" ? "Guardando..." : syncStatus === "saved" ? "✓ Guardado" : syncStatus === "error" ? "⚠ Error al guardar" : lastSaved ? "Sincronizado" : "Sincronizado en todos tus dispositivos"}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            {!isPremiumAccess && (
              <Text style={{ fontSize: 10, color: positions.length >= FREE_POSITION_LIMIT ? "#ef4444" : colors.textDim }}>
                {positions.length}/{FREE_POSITION_LIMIT}
              </Text>
            )}
            {positions.length > 0 && (
              <TouchableOpacity
                style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: "rgba(239,68,68,0.08)", borderWidth: 1, borderColor: "rgba(239,68,68,0.2)" }}
                onPress={() => Alert.alert(
                  "Vaciar portafolio",
                  `¿Eliminar las ${positions.length} posiciones? Esta acción no se puede deshacer.`,
                  [{ text: "Cancelar", style: "cancel" }, { text: "Vaciar todo", style: "destructive", onPress: () => clearPortfolio() }]
                )}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: "#ef4444" }}>Vaciar</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── Botones principales: Agregar posición + Importar captura ── */}
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
          {/* Agregar posición — acción primaria */}
          <TouchableOpacity
            style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, borderRadius: 16, backgroundColor: "#00a85e" }}
            onPress={() => { setShowForm(!showForm); setScreenshotPreview(null); }}
            activeOpacity={0.8}>
            <Ionicons name="add-circle-outline" size={18} color="white" />
            <Text style={{ fontSize: 13, fontWeight: "800", color: "white" }}>Agregar posición</Text>
          </TouchableOpacity>

          {/* Importar captura — acción secundaria */}
          <TouchableOpacity
            style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, borderRadius: 16, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, opacity: screenshotAnalyzing ? 0.7 : 1 }}
            onPress={handleScreenshotImport}
            disabled={screenshotAnalyzing}
            activeOpacity={0.8}>
            {screenshotAnalyzing
              ? <><ActivityIndicator size="small" color={colors.textSub} /><Text style={{ fontSize: 13, fontWeight: "700", color: colors.textSub }}>{screenshotProgress || "Analizando..."}</Text></>
              : <><Ionicons name="images-outline" size={18} color={colors.textSub} /><Text style={{ fontSize: 13, fontWeight: "700", color: colors.textSub }}>Importar captura</Text></>
            }
          </TouchableOpacity>
        </View>

        {/* ── PREVIEW DE CAPTURA ── */}
        {screenshotPreview && (
          <View style={[s.previewCard, { backgroundColor: colors.card, borderColor: "#22c55e" }]}>
            <View style={s.previewHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[s.previewTitle, { color: colors.text }]}>
                  {screenshotPreview.length} posiciones detectadas
                </Text>
                <Text style={[s.previewSub, { color: colors.textMuted }]}>
                  {screenshotUris.length > 1 ? `De ${screenshotUris.length} capturas · ` : ""}Revisa y elimina las incorrectas antes de confirmar
                </Text>
              </View>
              {screenshotUris.length > 0 && (
                <View style={s.previewThumbs}>
                  {screenshotUris.slice(0, 3).map((uri, i) => (
                    <Image key={i} source={{ uri }} style={[s.previewThumb, i > 0 && { marginLeft: -12 }]} />
                  ))}
                  {screenshotUris.length > 3 && (
                    <View style={[s.previewThumbMore, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                      <Text style={[s.previewThumbMoreText, { color: colors.textSub }]}>+{screenshotUris.length - 3}</Text>
                    </View>
                  )}
                </View>
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
                onPress={() => { setScreenshotPreview(null); setScreenshotUris([]); }}
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
            {priceError && (
              <View style={{ backgroundColor: "#f5931510", borderColor: "#f5931530", borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="cloud-offline-outline" size={15} color="#f59315" />
                <Text style={{ color: "#f59315", fontSize: 12, fontWeight: "600" }}>Sin conexión — precios desactualizados</Text>
              </View>
            )}
            {/* Totals card — arriba del rendimiento histórico */}
            {(() => {
              const sp = periodReturns["since_purchase"];
              const histPct = sp?.pct;
              const histAmt = sp?.amount;
              const histDate = sp?.date;
              const spyPct = sp?.spy_pct;
              const up = histPct !== undefined ? histPct >= 0 : totals.diff >= 0;
              const color = up ? "#22c55e" : "#ef4444";
              return (
                <View style={[s.totalsCard, { backgroundColor: colors.card, borderColor: color + "30" }]}>
                  {/* Colored accent top line */}
                  <View style={{ height: 3, backgroundColor: color, marginHorizontal: -20, marginTop: -20, marginBottom: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20 }} />
                  {loadingPrices ? (
                    <ActivityIndicator color="#22c55e" />
                  ) : (
                    <>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <Text style={[s.totalsLabel, { color: colors.textMuted }]}>Valor actual del portafolio</Text>
                        <TouchableOpacity
                          onPress={() => setShowCurrencyPicker(true)}
                          style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.bgRaised, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: colors.border }}
                          activeOpacity={0.7}>
                          <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text }}>{portfolioCurrency}</Text>
                          <Ionicons name="chevron-down" size={10} color={colors.textDim} />
                        </TouchableOpacity>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 12 }}>
                        <Text style={[s.totalsValue, { color: colors.text }]}>
                          {currencySymbol}{totals.current.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Text>
                        {histPct !== undefined ? (
                          <View style={{ alignItems: "flex-end", gap: 4 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: color + "18", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 }}>
                              <Text style={{ fontSize: 13, color }}>{up ? "▲" : "▼"}</Text>
                              <Text style={{ fontSize: 16, fontWeight: "900", color }}>
                                {up ? "+" : ""}{histPct.toFixed(2)}%
                              </Text>
                            </View>
                            {histAmt !== undefined && (
                              <Text style={{ fontSize: 12, fontWeight: "700", color }}>
                                {up ? "+" : ""}{currencySymbol}{Math.abs(histAmt).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                              </Text>
                            )}
                          </View>
                        ) : (
                          <View style={{ backgroundColor: (totals.diff >= 0 ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)"), borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 }}>
                            <Text style={[s.totalsDiff, { color: totals.diff >= 0 ? "#22c55e" : "#ef4444" }]}>
                              {totals.diff >= 0 ? "▲ +" : "▼ "}{totals.pct.toFixed(2)}%
                            </Text>
                          </View>
                        )}
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
                        <Text style={{ fontSize: 11, color: colors.textMuted }}>
                          Total Invertido{" "}
                          <Text style={{ fontWeight: "700", color: colors.textSub }}>{currencySymbol}{totals.invested.toLocaleString("en-US", { minimumFractionDigits: 2 })}</Text>
                          {histDate ? `  ·  desde ${histDate}` : ""}
                        </Text>
                        {spyPct !== undefined && histPct !== undefined && (() => {
                          const diff = histPct - spyPct;
                          const beats = diff >= 0;
                          return (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                              <Text style={{ fontSize: 10, color: colors.textMuted }}>vs S&P</Text>
                              <View style={{ backgroundColor: beats ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)", borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2 }}>
                                <Text style={{ fontSize: 10, fontWeight: "800", color: beats ? "#22c55e" : "#ef4444" }}>
                                  {beats ? "▲" : "▼"} {Math.abs(diff).toFixed(2)}%
                                </Text>
                              </View>
                            </View>
                          );
                        })()}
                      </View>
                    </>
                  )}
                </View>
              );
            })()}

            {/* ── Rendimiento histórico — grid 2×5 + gráfica ── */}
            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 9, fontWeight: "800", color: colors.textDim, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 8 }}>
                Rendimiento histórico · Yahoo Finance
              </Text>

              {/* Grid de períodos estándar — todos visibles de un vistazo */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                {PERIODS.filter(({ key }) => key !== "since_purchase").map(({ key, label }) => {
                  const ret = periodReturns[key];
                  const isSel = selectedPeriod === key;
                  const isUp = ret ? ret.pct >= 0 : null;
                  const valColor = isUp === null ? colors.textDim : isUp ? "#22c55e" : "#ef4444";
                  return (
                    <TouchableOpacity
                      key={key}
                      onPress={() => setSelectedPeriod(key)}
                      style={{
                        width: "18%", alignItems: "center", paddingVertical: 8, borderRadius: 12,
                        backgroundColor: isSel
                          ? (isUp === null ? "rgba(0,168,94,0.10)" : isUp ? "#22c55e1A" : "#ef44441A")
                          : colors.bgRaised,
                        borderWidth: 1,
                        borderColor: isSel
                          ? (isUp === null ? "rgba(0,168,94,0.35)" : isUp ? "#22c55e55" : "#ef444455")
                          : "transparent",
                      }}>
                      <Text style={{ fontSize: 10, fontWeight: "600", color: isSel ? colors.textSub : colors.textMuted, marginBottom: 2 }}>
                        {label}
                      </Text>
                      {loadingReturns ? (
                        <Text style={{ fontSize: 9, color: colors.textDim }}>···</Text>
                      ) : ret ? (
                        <Text style={{ fontSize: 10, fontWeight: "900", color: valColor }}>
                          {isUp ? "+" : ""}{ret.pct.toFixed(1)}%
                        </Text>
                      ) : (
                        <Text style={{ fontSize: 9, color: colors.textDim }}>—</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* "Desde compra" — siempre visible */}
              {(() => {
                const r = periodReturns["since_purchase"];
                const isSel = selectedPeriod === "since_purchase";
                const up = r ? r.pct >= 0 : true;
                const avgUp = r?.avg_pct !== undefined ? r.avg_pct >= 0 : up;
                return (
                  <TouchableOpacity
                    onPress={() => setSelectedPeriod("since_purchase")}
                    style={{
                      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                      paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, marginBottom: 6,
                      backgroundColor: isSel ? (up ? "#22c55e0D" : "#ef44440D") : colors.bgRaised,
                      borderWidth: 1,
                      borderColor: isSel ? (up ? "#22c55e40" : "#ef444440") : colors.border,
                    }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>Desde compra</Text>
                      {r?.date && <Text style={{ fontSize: 9, color: colors.textDim }}>· {r.date}</Text>}
                    </View>
                    {r ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        {r.avg_pct !== undefined && (
                          <View style={{ alignItems: "flex-end" }}>
                            <Text style={{ fontSize: 9, fontWeight: "600", color: colors.textDim }}>promedio</Text>
                            <Text style={{ fontSize: 12, fontWeight: "900", color: avgUp ? "#22c55e" : "#ef4444" }}>
                              {avgUp ? "+" : ""}{r.avg_pct.toFixed(2)}%
                            </Text>
                          </View>
                        )}
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ fontSize: 9, fontWeight: "600", color: colors.textDim }}>portafolio</Text>
                          <Text style={{ fontSize: 14, fontWeight: "900", color: up ? "#22c55e" : "#ef4444" }}>
                            {up ? "+" : ""}{r.pct.toFixed(2)}%
                          </Text>
                        </View>
                      </View>
                    ) : (
                      <Text style={{ fontSize: 10, color: colors.textDim }}>{loadingReturns ? "···" : "Agrega precio de compra"}</Text>
                    )}
                  </TouchableOpacity>
                );
              })()}

              {/* Tarjeta: gráfica + stats + breakdown */}
              {(() => {
                const r = periodReturns[selectedPeriod];
                const displayPct = r?.pct !== undefined ? r.pct : chartData?.period_pct;
                const displayAmt = r?.amount !== undefined ? r.amount : chartData?.period_amount;
                const up = displayPct !== undefined ? displayPct >= 0 : true;
                const color = up ? "#22c55e" : "#ef4444";
                const periodLabel = PERIODS.find((p) => p.key === selectedPeriod)?.label ?? "";
                return (
                  <View style={{ borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: `${color}30`, backgroundColor: colors.card }}>
                    {/* Franja de color */}
                    <View style={{ height: 2, backgroundColor: color }} />

                    {/* Stats header */}
                    <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 }}>
                      <View>
                        <Text style={{ fontSize: 10, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>
                          Rendimiento · {periodLabel}
                        </Text>
                        {r?.date && <Text style={{ fontSize: 9, color: colors.textDim, marginTop: 1 }}>desde {r.date}</Text>}
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        {displayPct !== undefined ? (
                          <>
                            <Text style={{ fontSize: 22, fontWeight: "900", color, lineHeight: 24 }}>
                              {up ? "+" : ""}{displayPct.toFixed(2)}%
                            </Text>
                            {displayAmt !== undefined && (
                              <Text style={{ fontSize: 12, fontWeight: "700", color, marginTop: 1 }}>
                                {up ? "+" : ""}{currencySymbol}{Math.abs(displayAmt).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </Text>
                            )}
                          </>
                        ) : chartLoading ? (
                          <Text style={{ fontSize: 12, color: colors.textMuted }}>···</Text>
                        ) : null}
                      </View>
                    </View>

                    {/* vs S&P 500 */}
                    {r?.spy_pct !== undefined && displayPct !== undefined && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingBottom: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
                        <Text style={{ fontSize: 10, fontWeight: "600", color: colors.textMuted }}>vs S&P 500</Text>
                        <Text style={{ fontSize: 11, fontWeight: "800", color: r.spy_pct >= 0 ? "#22c55e" : "#ef4444" }}>
                          {r.spy_pct >= 0 ? "+" : ""}{r.spy_pct.toFixed(2)}%
                        </Text>
                        {(() => {
                          const diff = displayPct - r.spy_pct;
                          const beats = diff >= 0;
                          return (
                            <View style={{ backgroundColor: beats ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}>
                              <Text style={{ fontSize: 10, fontWeight: "800", color: beats ? "#22c55e" : "#ef4444" }}>
                                {beats ? "▲" : "▼"} {Math.abs(diff).toFixed(2)}% {beats ? "mejor" : "peor"}
                              </Text>
                            </View>
                          );
                        })()}
                      </View>
                    )}

                    {/* Gráfica */}
                    <View style={{ paddingHorizontal: 14, paddingBottom: 4 }}>
                      {chartLoading ? (
                        <View style={{ height: 180, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }}>
                          <ActivityIndicator size="small" color={colors.textMuted} />
                          <Text style={{ fontSize: 11, color: colors.textMuted }}>Cargando datos históricos...</Text>
                        </View>
                      ) : chartData && chartData.history.length >= 2 ? (
                        <PortfolioHistoryChart
                          history={chartData.history}
                          color={color}
                          currencySymbol={currencySymbol}
                          positions={positions}
                        />
                      ) : !chartLoading ? (
                        <View style={{ height: 180, alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ fontSize: 11, color: colors.textDim }}>Sin datos históricos para este período</Text>
                        </View>
                      ) : null}
                    </View>

                    {/* Fuente */}
                    <Text style={{ fontSize: 9, color: colors.textDim, paddingHorizontal: 14, paddingBottom: 8 }}>
                      Yahoo Finance · ajustado por splits y dividendos
                    </Text>

                    {/* Breakdown por posición */}
                  </View>
                );
              })()}
            </View>

            {/* Sort chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingRight: 8 }}>
                <Text style={{ fontSize: 10, fontWeight: "600", color: colors.textDim }}>Ordenar:</Text>
                {([
                  { field: "return" as const,  label: "Rentabilidad" },
                  { field: "invested" as const, label: "Invertido" },
                  { field: "price" as const,    label: "Precio" },
                ] as const).map(({ field, label }) => {
                  const active = sortField === field;
                  return (
                    <TouchableOpacity
                      key={field}
                      onPress={() => handleSort(field)}
                      style={{
                        flexDirection: "row", alignItems: "center", gap: 4,
                        paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
                        backgroundColor: active ? "rgba(0,168,94,0.12)" : colors.bgRaised,
                        borderWidth: 1,
                        borderColor: active ? "rgba(0,168,94,0.35)" : "transparent",
                      }}>
                      <Text style={{ fontSize: 11, fontWeight: "700", color: active ? colors.accentLight : colors.textMuted }}>
                        {label}{active ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            {sortedPositions.map((pos) => {
              const pd = prices[pos.ticker];
              const cpUSD = pd?.price;
              const cp = cpUSD ? cpUSD * fxRate : null; // convert USD → user currency
              const hasCost = pos.avgPrice > 0;
              const currentVal = cp ? pos.shares * cp : null;
              const investedVal = hasCost ? pos.shares * pos.avgPrice : null;
              const diff = currentVal !== null && investedVal !== null ? currentVal - investedVal : null;
              const pct = diff !== null && investedVal! > 0 ? (diff / investedVal!) * 100 : null;
              const isUp = diff !== null && diff >= 0;
              const priceRevealed = revealedPrices.has(pos.id);
              return (
                <View key={pos.id} style={[s.posCardWrapper, { backgroundColor: colors.card, borderColor: diff !== null ? (isUp ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)") : colors.border }]}>
                  {diff !== null && (
                    <View style={[s.posCardAccent, { backgroundColor: isUp ? "#22c55e" : "#ef4444" }]} />
                  )}
                  <View style={s.posCard}>
                  {/* Header: ticker + edit + remove */}
                  <View style={s.posHeader}>
                    <TouchableOpacity
                      style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
                      onPress={() => router.push(`/stock/${pos.ticker}` as any)}
                      activeOpacity={0.7}
                    >
                      <StockAvatar ticker={pos.ticker} size={36} />
                      <View>
                        <Text style={[s.posTicker, { color: colors.text }]}>{pos.ticker}</Text>
                        {(pd?.name || pos.name) && (
                          <Text style={[s.posName, { color: colors.textMuted }]}>{pd?.name || pos.name}</Text>
                        )}
                      </View>
                    </TouchableOpacity>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <TouchableOpacity
                        onPress={() => setEditingPos({ id: pos.id, shares: String(pos.shares), avgPrice: String(pos.avgPrice), purchaseDate: pos.purchaseDate ?? new Date().toISOString().split("T")[0] })}
                        style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgRaised }}
                        activeOpacity={0.7}>
                        <Ionicons name="pencil-outline" size={13} color={colors.textSub} />
                        <Text style={{ fontSize: 11, fontWeight: "700", color: colors.textSub }}>Editar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => removePosition(pos.id)}
                        style={{ paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgRaised }}
                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                        activeOpacity={0.7}>
                        <Ionicons name="trash-outline" size={13} color="#ef444480" />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Invested / Shares / Current Value */}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
                    <View>
                      <Text style={{ fontSize: 10, color: colors.textDim, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 2 }}>Invertido</Text>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: colors.textSub }}>
                        {investedVal != null ? `${currencySymbol}${investedVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                      </Text>
                    </View>
                    <View style={{ alignItems: "center" }}>
                      <Text style={{ fontSize: 10, color: colors.textDim, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 2 }}>Acciones</Text>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: colors.textSub }}>{pos.shares.toLocaleString("en-US")}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ fontSize: 10, color: colors.textDim, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 2 }}>Valor hoy</Text>
                      <Text style={{ fontSize: 14, fontWeight: "800", color: colors.text }}>
                        {currentVal != null ? `${currencySymbol}${currentVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                      </Text>
                    </View>
                  </View>

                  {/* Performance row */}
                  {diff !== null && pct !== null && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                      backgroundColor: isUp ? "#22c55e14" : "#ef444414",
                      borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8 }}>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: isUp ? "#22c55e" : "#ef4444" }}>
                        {isUp ? "+" : ""}{currencySymbol}{Math.abs(diff).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Text>
                      <Text style={{ fontSize: 14, fontWeight: "900", color: isUp ? "#22c55e" : "#ef4444" }}>
                        {isUp ? "+" : ""}{pct.toFixed(2)}%
                      </Text>
                    </View>
                  )}

                  {/* Reveal price per share */}
                  <TouchableOpacity
                    onPress={() => setRevealedPrices((prev) => {
                      const next = new Set(prev);
                      next.has(pos.id) ? next.delete(pos.id) : next.add(pos.id);
                      return next;
                    })}
                    style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Ionicons name="eye-outline" size={13} color={colors.textMuted} />
                    <Text style={{ fontSize: 11, fontWeight: "600", color: colors.textMuted }}>
                      {priceRevealed
                        ? cp ? `${currencySymbol}${cp.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / acción · ocultar` : "Sin precio"
                        : "Ver precio por acción"}
                    </Text>
                  </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </>
        ) : null}

        {/* ── STRESS TEST ── */}
        {positions.length > 0 && (
          <>
            <View style={[s.divider, { borderTopColor: colors.border }]} />
            <View style={s.simHeader}>
              <Ionicons name="shield-half-outline" size={20} color="#ef4444" />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <Text style={s.sectionTitle}>Stress Test de Portafolio</Text>
                  {!isPremiumAccess && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#f59e0b18", borderWidth: 1, borderColor: "#f59e0b40", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Ionicons name="star" size={9} color="#f59e0b" />
                      <Text style={{ fontSize: 9, fontWeight: "700", color: "#f59e0b", letterSpacing: 0.3 }}>PREMIUM</Text>
                    </View>
                  )}
                </View>
                <Text style={[s.simSubtitle, { color: colors.textMuted }]}>
                  ¿Cuánto aguantaría tu portafolio en una crisis histórica?
                  {!isPremiumAccess && (
                    <Text style={{ color: colors.textDim }}> COVID-19 gratis · el resto con Premium.</Text>
                  )}
                </Text>
              </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 8 }}>
              {STRESS_SCENARIOS.map((sc) => {
                const isFreeScenario = sc.id === "covid";
                const canRun = isPremiumAccess || isFreeScenario;
                return (
                  <TouchableOpacity
                    key={sc.id}
                    style={[s.stressChip, { borderColor: stressScenario === sc.id ? sc.color : colors.border, backgroundColor: stressScenario === sc.id ? sc.color + "18" : "transparent", opacity: canRun ? 1 : 0.45 }]}
                    onPress={() => canRun ? runStressTest(sc.id) : setPaywallOpen(true)}
                  >
                    <Text style={s.stressChipIcon}>{sc.icon}</Text>
                    <View>
                      <Text style={[s.stressChipName, { color: stressScenario === sc.id ? sc.color : colors.textSub }]}>{sc.name}</Text>
                      <Text style={[s.stressChipYear, { color: colors.textDim }]}>
                        {!isPremiumAccess && !isFreeScenario ? "🔒 " : ""}{sc.year}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {stressResult && stressScenario && (() => {
              const sc = STRESS_SCENARIOS.find((x) => x.id === stressScenario)!;
              return (
                <View style={[s.stressResultCard, { backgroundColor: colors.card, borderColor: sc.color + "50" }]}>
                  <Text style={[s.stressResultTitle, { color: colors.text }]}>{sc.icon} {sc.name} — {sc.desc}</Text>

                  <View style={[s.stressSummary, { backgroundColor: stressResult.diff >= 0 ? "#22c55e14" : "#ef444414" }]}>
                    <Text style={[s.stressSummaryLabel, { color: colors.textMuted }]}>Impacto total estimado</Text>
                    <Text style={[s.stressSummaryVal, { color: stressResult.diff >= 0 ? "#22c55e" : "#ef4444" }]}>
                      {stressResult.diff >= 0 ? "+" : ""}{fmtMoney(Math.abs(stressResult.diff))} ({stressResult.pct >= 0 ? "+" : ""}{stressResult.pct.toFixed(1)}%)
                    </Text>
                    <Text style={{ color: colors.textDim, fontSize: 11, marginTop: 2 }}>
                      {fmtMoney(stressResult.total)} → {fmtMoney(stressResult.stressed)}
                    </Text>
                  </View>

                  {stressResult.rows.map((row) => (
                    <View key={row.ticker} style={[s.stressRow, { borderTopColor: colors.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.stressRowTicker, { color: colors.text }]}>{row.ticker}</Text>
                        <Text style={[s.stressRowSector, { color: colors.textDim }]}>{row.sector}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={[s.stressRowPct, { color: row.pct >= 0 ? "#22c55e" : "#ef4444" }]}>
                          {row.pct >= 0 ? "+" : ""}{row.pct.toFixed(0)}%
                        </Text>
                        <Text style={[s.stressRowDiff, { color: row.diff >= 0 ? "#22c55e" : "#ef4444" }]}>
                          {row.diff >= 0 ? "+" : ""}{fmtMoney(Math.abs(row.diff))}
                        </Text>
                      </View>
                    </View>
                  ))}

                  <View style={s.disclaimer}>
                    <Ionicons name="warning-outline" size={12} color="#ca8a04" />
                    <Text style={s.disclaimerText}>Estimación basada en datos históricos. No garantiza resultados futuros.</Text>
                  </View>
                </View>
              );
            })()}
          </>
        )}

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
        {/* ── DIAGNÓSTICO DE RIESGO ── */}
        {diagnosis && (() => {
          const level = PORTFOLIO_LEVELS[diagnosis.levelIdx];
          return (
            <View style={[s.diagCard, { backgroundColor: s.diagCard.backgroundColor, borderColor: level.color + "60" }]}>
              {/* Header */}
              <View style={s.diagHeader}>
                <View style={[s.diagBadge, { backgroundColor: level.color + "18", borderColor: level.color + "50" }]}>
                  <View style={[s.diagBadgeDot, { backgroundColor: level.color }]} />
                  <Text style={[s.diagBadgeText, { color: level.color }]}>{level.label}</Text>
                </View>
                <Text style={[s.diagScore, { color: colors.textMuted }]}>{diagnosis.score}/100</Text>
              </View>

              {/* 8-segment risk bar */}
              <View style={s.diagBarRow}>
                {PORTFOLIO_LEVELS.map((l, i) => (
                  <View
                    key={l.label}
                    style={[
                      s.diagBarSeg,
                      {
                        backgroundColor: i === diagnosis.levelIdx ? l.color : l.color + "35",
                        height: i === diagnosis.levelIdx ? 14 : 8,
                        borderRadius: i === 0 ? 4 : i === PORTFOLIO_LEVELS.length - 1 ? 4 : 2,
                      },
                    ]}
                  />
                ))}
              </View>
              <View style={s.diagBarLabels}>
                <Text style={[s.diagBarLabel, { color: colors.textDim }]}>Conservador</Text>
                <Text style={[s.diagBarLabel, { color: colors.textDim }]}>Especulativo</Text>
              </View>

              {/* Sector breakdown chips — toca uno para ver las posiciones */}
              {Object.keys(diagnosis.sectorPcts).length > 0 && (
                <>
                  <View style={s.diagSectors}>
                    {Object.entries(diagnosis.sectorPcts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([sector, pct]) => {
                        const col = SECTOR_COLOR[sector] ?? "#94a3b8";
                        const isSelected = selectedSector === sector;
                        return (
                          <TouchableOpacity
                            key={sector}
                            onPress={() => setSelectedSector(isSelected ? null : sector)}
                            style={[
                              s.diagSectorChip,
                              {
                                backgroundColor: isSelected ? col : `${col}18`,
                                borderColor: isSelected ? col : `${col}40`,
                              },
                            ]}
                            activeOpacity={0.7}
                          >
                            <Text style={[s.diagSectorText, { color: isSelected ? "#fff" : col }]}>
                              {sector} {pct}%
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                  </View>

                  {/* Drill-down: posiciones del sector seleccionado */}
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
                      <View style={[s.sectorDrillBox, { backgroundColor: `${col}0e`, borderColor: `${col}40` }]}>
                        <View style={s.sectorDrillHeader}>
                          <Text style={[s.sectorDrillTitle, { color: col }]}>
                            Posiciones · {selectedSector}
                          </Text>
                          <TouchableOpacity onPress={() => setSelectedSector(null)} activeOpacity={0.7}>
                            <Text style={[s.sectorDrillClose, { color: colors.textDim }]}>Cerrar ✕</Text>
                          </TouchableOpacity>
                        </View>
                        {sectorPositions.map((pos) => {
                          const price = (prices[pos.ticker]?.price ?? pos.avgPrice) * fxRate;
                          const val = pos.shares * price;
                          const pctOfSector = sectorTotal > 0 ? Math.round((val / sectorTotal) * 100) : 0;
                          return (
                            <View key={pos.id} style={[s.sectorDrillRow, { backgroundColor: colors.bg }]}>
                              <View style={s.sectorDrillLeft}>
                                <Text style={[s.sectorDrillTicker, { color: col }]}>{pos.ticker}</Text>
                                {pos.name && (
                                  <Text style={[s.sectorDrillName, { color: colors.textSub }]} numberOfLines={1}>
                                    {pos.name}
                                  </Text>
                                )}
                              </View>
                              <View style={s.sectorDrillRight}>
                                <Text style={[s.sectorDrillShares, { color: colors.textDim }]}>
                                  {pos.shares} acc.
                                </Text>
                                <Text style={[s.sectorDrillVal, { color: colors.text }]}>
                                  {currencySymbol}{val.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                                </Text>
                                <Text style={[s.sectorDrillPct, { color: col }]}>
                                  {pctOfSector}%
                                </Text>
                              </View>
                            </View>
                          );
                        })}
                        <View style={[s.sectorDrillFooter, { borderTopColor: `${col}30` }]}>
                          <Text style={[s.sectorDrillFooterLabel, { color: colors.textDim }]}>
                            Total sector:{" "}
                            <Text style={{ color: col }}>
                              {currencySymbol}{sectorTotal.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                            </Text>
                          </Text>
                        </View>
                      </View>
                    );
                  })()}
                </>
              )}

              {/* Feedback lines */}
              {diagnosis.feedback.length > 0 && (
                <View style={[s.diagFeedback, { borderTopColor: colors.border }]}>
                  {diagnosis.feedback.map((line, i) => (
                    <View key={i} style={s.diagFeedbackRow}>
                      <Ionicons
                        name={i === 0 ? "stats-chart-outline" : i === 1 ? "person-outline" : "time-outline"}
                        size={13}
                        color={level.color}
                        style={{ marginTop: 2, flexShrink: 0 }}
                      />
                      <Text style={[s.diagFeedbackText, { color: colors.textSub }]}>{line}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })()}

        {/* Risk profile indicator */}
        {riskCfg && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden" }}>
              <View style={{ width: `${Math.round(riskCfg.pct * 100)}%` as any, height: "100%", backgroundColor: riskCfg.color, borderRadius: 2 }} />
            </View>
            <Text style={{ color: riskCfg.color, fontSize: 11, fontWeight: "700" }}>
              Tu perfil: {riskCfg.label}
            </Text>
          </View>
        )}
        {riskCfg && scenario !== profile?.risk_tolerance && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f59e0b12", borderColor: "#f59e0b30", borderWidth: 1, borderRadius: 8, padding: 8, marginBottom: 8 }}>
            <Ionicons name="warning-outline" size={13} color="#f59e0b" />
            <Text style={{ color: "#f59e0b", fontSize: 11, fontWeight: "600", flex: 1 }}>
              Este escenario difiere de tu perfil real ({riskCfg.label.toLowerCase()})
            </Text>
          </View>
        )}
        <View style={s.scenarioRow}>
          {SCENARIOS.map((sc) => (
            <TouchableOpacity
              key={sc.value}
              style={[s.scenarioCard, { backgroundColor: colors.card, borderColor: colors.border }, scenario === sc.value && s.scenarioActive]}
              onPress={() => setScenario(sc.value)}
            >
              <Ionicons name={sc.icon} size={20} color={scenario === sc.value ? "#22c55e" : colors.textSub} style={{ marginBottom: 2 }} />
              <Text style={[s.scenarioLabel, { color: scenario === sc.value ? colors.text : colors.textSub }]}>{sc.label}</Text>
              {sc.value === profile?.risk_tolerance && (
                <View style={{ backgroundColor: riskCfg?.color + "25", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, marginTop: 2 }}>
                  <Text style={{ color: riskCfg?.color, fontSize: 8, fontWeight: "800" }}>TU PERFIL</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
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
        {/* ── Resultado estructurado premium ── */}
        {portfolioResult && (() => {
          const scenarioColor = scenario === "conservative" ? "#3b82f6" : scenario === "moderate" ? "#22c55e" : "#f59e0b";
          const scenarioLabel = scenario === "conservative" ? "Conservador" : scenario === "moderate" ? "Moderado" : "Agresivo";

          // Donut chart math
          const CHART = 180;
          const cx = CHART / 2;
          const cy = CHART / 2;
          const R = 62;
          const SW = 26;
          const GAP = 3;
          let cum = 0;
          const segs = portfolioResult.allocations.map((a) => {
            const s = cum; cum += a.pct; return { ...a, s, e: cum };
          });
          const arc = (s: number, e: number) => {
            const sa = s * 3.6 + GAP / 2, ea = e * 3.6 - GAP / 2;
            const toXY = (deg: number) => {
              const r = ((deg - 90) * Math.PI) / 180;
              return { x: cx + R * Math.cos(r), y: cy + R * Math.sin(r) };
            };
            const p1 = toXY(sa), p2 = toXY(ea);
            const large = ea - sa > 180 ? 1 : 0;
            return `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} A ${R} ${R} 0 ${large} 1 ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
          };

          return (
            <View style={{ gap: 12 }}>

              {/* ── Hero card ── */}
              <View style={{ borderRadius: 22, overflow: "hidden", borderWidth: 1, borderColor: scenarioColor + "35" }}>
                <View style={{ backgroundColor: "#080d18", padding: 22, alignItems: "center", gap: 0 }}>
                  {/* Glow bg */}
                  <Svg style={StyleSheet.absoluteFillObject as any} width="100%" height="100%">
                    <Defs>
                      <SvgRadial id="hglow" cx="50%" cy="30%" r="60%">
                        <Stop offset="0%" stopColor={scenarioColor} stopOpacity={0.18} />
                        <Stop offset="100%" stopColor={scenarioColor} stopOpacity={0} />
                      </SvgRadial>
                    </Defs>
                    <SvgRect x="0" y="0" width="100%" height="100%" fill="url(#hglow)" />
                  </Svg>

                  <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, fontWeight: "900", letterSpacing: 2.5 }}>PORTAFOLIO SUGERIDO</Text>
                  <Text style={{ color: scenarioColor, fontSize: 26, fontWeight: "900", letterSpacing: -0.5, marginTop: 2 }}>{scenarioLabel.toUpperCase()}</Text>

                  {/* Donut chart */}
                  <View style={{ marginVertical: 18 }}>
                    <Svg width={CHART} height={CHART}>
                      {/* Track */}
                      <G>
                        {segs.map((sg) => (
                          <Path key={sg.ticker} d={arc(sg.s, sg.e)} stroke={sg.color} strokeWidth={SW} fill="none" strokeLinecap="butt" opacity={0.9} />
                        ))}
                      </G>
                    </Svg>
                    {/* Center label */}
                    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ color: "rgba(255,255,255,0.35)", fontSize: 8, fontWeight: "800", letterSpacing: 1 }}>ESTRATEGIA</Text>
                      <Text style={{ color: "#fff", fontSize: 16, fontWeight: "900", marginTop: 2 }}>{scenarioLabel}</Text>
                    </View>
                  </View>

                  {/* Legend */}
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                    {portfolioResult.allocations.map((a) => (
                      <View key={a.ticker} style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: a.color + "18", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                        <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: a.color }} />
                        <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 11, fontWeight: "700" }}>{a.ticker}</Text>
                        <Text style={{ color: a.color, fontSize: 11, fontWeight: "900" }}>{a.pct}%</Text>
                      </View>
                    ))}
                  </View>

                  {/* Summary */}
                  <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, lineHeight: 19, textAlign: "center", marginTop: 14 }}>
                    {portfolioResult.summary}
                  </Text>

                  {/* Mismatch warning */}
                  {!!portfolioResult.mismatch && (
                    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 12, backgroundColor: "#f59e0b14", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#f59e0b30", width: "100%" }}>
                      <Ionicons name="warning-outline" size={15} color="#f59e0b" style={{ marginTop: 1 }} />
                      <Text style={{ color: "#f59e0b", fontSize: 11, fontWeight: "600", flex: 1, lineHeight: 17 }}>{portfolioResult.mismatch}</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* ── Allocation rows ── */}
              <View style={{ backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 16, paddingBottom: 12 }}>
                  <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: scenarioColor + "20", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="pie-chart-outline" size={16} color={scenarioColor} />
                  </View>
                  <Text style={{ color: colors.text, fontSize: 14, fontWeight: "800" }}>Distribución de activos</Text>
                </View>
                {portfolioResult.allocations.map((a, i) => (
                  <View key={a.ticker} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 13, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
                    {/* Color stripe */}
                    <View style={{ width: 4, height: 52, borderRadius: 2, backgroundColor: a.color }} />
                    <View style={{ flex: 1, gap: 5 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                          <View style={{ backgroundColor: a.color + "20", borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3 }}>
                            <Text style={{ color: a.color, fontSize: 12, fontWeight: "900" }}>{a.ticker}</Text>
                          </View>
                          <Text style={{ color: colors.textMuted, fontSize: 11, flex: 1 }} numberOfLines={1}>{a.name}</Text>
                        </View>
                        <Text style={{ color: a.color, fontSize: 22, fontWeight: "900", marginLeft: 8 }}>{a.pct}%</Text>
                      </View>
                      {/* Bar */}
                      <View style={{ height: 5, backgroundColor: colors.border, borderRadius: 3 }}>
                        <View style={{ width: `${a.pct}%` as any, height: 5, backgroundColor: a.color, borderRadius: 3, opacity: 0.85 }} />
                      </View>
                      <Text style={{ color: colors.textMuted, fontSize: 10, lineHeight: 14 }}>{a.reason}</Text>
                    </View>
                  </View>
                ))}
              </View>

              {/* ── Historical performance ── */}
              <View style={{ backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: "#6366f120", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="time-outline" size={16} color="#6366f1" />
                  </View>
                  <Text style={{ color: colors.text, fontSize: 14, fontWeight: "800" }}>Comportamiento histórico</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {Object.entries(portfolioResult.history).map(([year, val]) => {
                    const pos = !val.startsWith("-");
                    const clr = pos ? "#22c55e" : "#ef4444";
                    return (
                      <View key={year} style={{ flex: 1, backgroundColor: clr + "10", borderRadius: 16, borderWidth: 1, borderColor: clr + "30", padding: 14, alignItems: "center", gap: 6 }}>
                        <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, fontWeight: "800", letterSpacing: 1 }}>{year}</Text>
                        <Ionicons name={pos ? "trending-up" : "trending-down"} size={20} color={clr} />
                        <Text style={{ color: clr, fontSize: 20, fontWeight: "900" }}>{val}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* ── Risks ── */}
              <View style={{ backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: "#f59e0b22", padding: 16, gap: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: "#f59e0b18", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="shield-outline" size={16} color="#f59e0b" />
                  </View>
                  <Text style={{ color: colors.text, fontSize: 14, fontWeight: "800" }}>Riesgos a considerar</Text>
                </View>
                {portfolioResult.risks.map((r, i) => (
                  <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                    <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: "#f59e0b18", borderWidth: 1, borderColor: "#f59e0b30", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                      <Text style={{ color: "#f59e0b", fontSize: 10, fontWeight: "900" }}>{i + 1}</Text>
                    </View>
                    <Text style={{ color: colors.textSub, fontSize: 12, lineHeight: 19, flex: 1 }}>{r}</Text>
                  </View>
                ))}
              </View>

              {/* Disclaimer */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, justifyContent: "center", paddingBottom: 4 }}>
                <Ionicons name="warning-outline" size={10} color={colors.textDim} />
                <Text style={{ color: colors.textDim, fontSize: 10 }}>Análisis educativo · No es asesoramiento financiero</Text>
              </View>

            </View>
          );
        })()}

        {/* Resultado texto (con posiciones) — renderizado con Markdown */}
        {analysis !== "" && (
          <View style={[s.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Markdown
              style={{
                body:       { color: colors.textSub, fontSize: 13, lineHeight: 20 },
                heading1:   { color: colors.text, fontWeight: "800", fontSize: 15, marginBottom: 6 },
                heading2:   { color: colors.text, fontWeight: "700", fontSize: 14, marginBottom: 4 },
                heading3:   { color: colors.text, fontWeight: "700", fontSize: 13, marginBottom: 4 },
                strong:     { color: colors.text, fontWeight: "700" },
                bullet_list:{ marginLeft: 4 },
                list_item:  { color: colors.textSub, fontSize: 13, lineHeight: 20 },
                paragraph:  { marginBottom: 8 },
                fence:      { backgroundColor: colors.bgRaised, borderRadius: 8, padding: 10, fontSize: 12 },
                code_inline:{ backgroundColor: colors.bgRaised, borderRadius: 4, paddingHorizontal: 4, fontSize: 12 },
              }}
            >
              {analysis}
            </Markdown>
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

        {calcResult && (() => {
          const maxTotal = Math.max(...calcResult.bars.map((b) => b.total));
          const BAR_MAX_H = 150;
          const yrs = parseFloat(calcYears) || 0;
          return (
            <View style={[s.calcResultCard, { backgroundColor: colors.card, borderColor: "#6366f130" }]}>

              {/* ── Hero: valor final ── */}
              <View style={[s.calcHero, { backgroundColor: "#6366f110" }]}>
                <Text style={[s.calcHeroLabel, { color: colors.textMuted }]}>
                  Valor final en {calcYears} {parseInt(calcYears) === 1 ? "año" : "años"}
                </Text>
                <Text style={[s.calcHeroValue, { color: "#6366f1" }]}>
                  ${fmtMoney(calcResult.final)}
                </Text>
                <View style={s.calcHeroRow}>
                  <View style={[s.calcHeroBadge, { backgroundColor: "#22c55e18" }]}>
                    <Text style={[s.calcHeroBadgeText, { color: "#22c55e" }]}>
                      ×{calcResult.multiplier.toFixed(1)} tu dinero
                    </Text>
                  </View>
                  <View style={[s.calcHeroBadge, { backgroundColor: "#6366f118" }]}>
                    <Text style={[s.calcHeroBadgeText, { color: "#a78bfa" }]}>
                      +{calcResult.pct.toFixed(0)}% retorno
                    </Text>
                  </View>
                </View>
              </View>

              {/* ── Stats row ── */}
              <View style={[s.calcStatsRow, { borderColor: colors.border }]}>
                {[
                  { label: "Invertido",    val: `$${fmtMoney(calcResult.invested)}`,  col: colors.textSub },
                  { label: "Ganancias",    val: `+$${fmtMoney(calcResult.gain)}`,      col: "#22c55e"      },
                  { label: "Valor real*",  val: `$${fmtMoney(calcResult.realFinal)}`,  col: "#f59e0b"      },
                ].map((st, i) => (
                  <View key={st.label} style={[s.calcStatItem, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border }]}>
                    <Text style={[s.calcStatLabel, { color: colors.textMuted }]}>{st.label}</Text>
                    <Text style={[s.calcStatVal, { color: st.col }]}>{st.val}</Text>
                  </View>
                ))}
              </View>

              {/* ── Bar chart ── */}
              <View style={s.chartSection}>
                <Text style={[s.chartTitle, { color: colors.textMuted }]}>Invertido vs Retorno por año</Text>

                <View style={s.chartBars}>
                  {calcResult.bars.map((bar) => {
                    const barH   = Math.max(12, (bar.total / maxTotal) * BAR_MAX_H);
                    const invH   = bar.total > 0 ? (bar.invested / bar.total) * barH : barH;
                    const retH   = barH - invH;
                    const isBeyond = yrs > 0 && bar.year > yrs;
                    return (
                      <View key={bar.year} style={s.barCol}>
                        {/* value label */}
                        <Text style={[s.barTopLabel, { color: isBeyond ? colors.textDim : colors.textSub }]}
                          numberOfLines={1} adjustsFontSizeToFit>
                          ${fmtMoney(bar.total)}
                        </Text>
                        {/* bar container aligned to bottom */}
                        <View style={[s.barContainer, { height: BAR_MAX_H }]}>
                          <View style={[s.barStack, { height: barH, opacity: isBeyond ? 0.45 : 1 }]}>
                            {retH > 0 && (
                              <View style={[s.barSegReturns, { height: retH }]} />
                            )}
                            <View style={[s.barSegInvested, { height: invH }]} />
                          </View>
                        </View>
                        <Text style={[s.barYearLabel, { color: isBeyond ? colors.textDim : colors.textMuted }]}>
                          {bar.year}a
                        </Text>
                      </View>
                    );
                  })}
                </View>

                {/* Legend */}
                <View style={s.chartLegend}>
                  <View style={s.legendItem}>
                    <View style={[s.legendDot, { backgroundColor: "#6366f1" }]} />
                    <Text style={[s.legendText, { color: colors.textMuted }]}>Invertido</Text>
                  </View>
                  <View style={s.legendItem}>
                    <View style={[s.legendDot, { backgroundColor: "#22c55e" }]} />
                    <Text style={[s.legendText, { color: colors.textMuted }]}>Retorno</Text>
                  </View>
                  <View style={s.legendItem}>
                    <View style={[s.legendDot, { backgroundColor: "#f59e0b", width: 8, height: 8, borderRadius: 2 }]} />
                    <Text style={[s.legendText, { color: colors.textMuted }]}>Opaco = proyección</Text>
                  </View>
                </View>
              </View>

              {/* ── Disclaimer ── */}
              <View style={[s.calcDisclaimer, { borderColor: "#6366f120", backgroundColor: "#6366f108" }]}>
                <Ionicons name="information-circle-outline" size={12} color="#a78bfa" />
                <Text style={[s.calcDisclaimerText, { color: "#a78bfa" }]}>
                  Interés compuesto mensual. *Valor real descontando 3.5% inflación anual. Rendimientos pasados no garantizan futuros.
                </Text>
              </View>
            </View>
          );
        })()}

        </View>
        )}
      </ScrollView>

      <PaywallModal
        visible={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        reason="Más de 10 posiciones requiere Premium"
      />

      {/* Edit position modal */}
      <Modal visible={!!editingPos} transparent animationType="fade" onRequestClose={() => setEditingPos(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 20 }}>
          <View style={{ backgroundColor: colors.card, borderRadius: 20, width: "100%", maxWidth: 360, overflow: "hidden" }}>
            <View style={{ height: 4, backgroundColor: "#00a85e" }} />
            <View style={{ padding: 20 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }}>Editar posición</Text>
                <TouchableOpacity onPress={() => setEditingPos(null)}>
                  <Ionicons name="close" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Acciones / unidades</Text>
              <TextInput
                style={{ backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text, marginBottom: 12 }}
                keyboardType="decimal-pad"
                value={editingPos?.shares ?? ""}
                onChangeText={(v) => setEditingPos((p) => p ? { ...p, shares: v } : p)}
                placeholderTextColor={colors.textDim}
                placeholder="Ej: 10"
              />
              <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Precio promedio de compra ($)</Text>
              <TextInput
                style={{ backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text, marginBottom: 12 }}
                keyboardType="decimal-pad"
                value={editingPos?.avgPrice ?? ""}
                onChangeText={(v) => setEditingPos((p) => p ? { ...p, avgPrice: v } : p)}
                placeholderTextColor={colors.textDim}
                placeholder="Ej: 150.00"
              />
              <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Fecha de compra (YYYY-MM-DD)</Text>
              <TextInput
                style={{ backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text, marginBottom: 16 }}
                keyboardType="default"
                value={editingPos?.purchaseDate ?? ""}
                onChangeText={(v) => setEditingPos((p) => p ? { ...p, purchaseDate: v } : p)}
                placeholderTextColor={colors.textDim}
                placeholder={new Date().toISOString().split("T")[0]}
              />
              <TouchableOpacity
                style={{ backgroundColor: "#00a85e", borderRadius: 14, paddingVertical: 12, alignItems: "center" }}
                onPress={() => {
                  if (!editingPos) return;
                  const shares = parseFloat(editingPos.shares);
                  const avgPrice = parseFloat(editingPos.avgPrice);
                  if (isNaN(shares) || shares <= 0) return;
                  Alert.alert(
                    "¿Guardar cambios?",
                    `${shares} acciones · precio promedio $${isNaN(avgPrice) ? "0" : avgPrice}`,
                    [
                      { text: "Cancelar", style: "cancel" },
                      {
                        text: "Guardar", style: "default",
                        onPress: () => {
                          updatePosition(editingPos.id, { shares, avgPrice: isNaN(avgPrice) ? 0 : avgPrice, purchaseDate: editingPos.purchaseDate || undefined });
                          setEditingPos(null);
                        },
                      },
                    ]
                  );
                }}>
                <Text style={{ color: "white", fontWeight: "800", fontSize: 14 }}>Guardar cambios</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Currency picker (standalone) ── */}
      <Modal visible={showCurrencyPicker} transparent animationType="slide" onRequestClose={() => setShowCurrencyPicker(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: 16 }} />
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, marginBottom: 4 }}>Moneda del portafolio</Text>
            <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 20 }}>
              Los precios de mercado se convierten automáticamente en tiempo real.
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
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
                  <TouchableOpacity
                    key={code}
                    onPress={() => { setCurrency(code); setShowCurrencyPicker(false); }}
                    style={{
                      width: "22%", alignItems: "center", paddingVertical: 10, paddingHorizontal: 4,
                      borderRadius: 14, borderWidth: 1.5,
                      borderColor: active ? "#00a85e" : colors.border,
                      backgroundColor: active ? "rgba(0,168,94,0.12)" : colors.bgRaised,
                    }}
                    activeOpacity={0.75}>
                    <Text style={{ fontSize: 20, marginBottom: 2 }}>{flag}</Text>
                    <Text style={{ fontSize: 11, fontWeight: "800", color: active ? "#00d47e" : colors.text }}>{code}</Text>
                    <Text style={{ fontSize: 9, color: colors.textMuted, textAlign: "center" }}>{name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity
              onPress={() => setShowCurrencyPicker(false)}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingVertical: 13, alignItems: "center" }}
              activeOpacity={0.7}>
              <Text style={{ color: colors.textSub, fontWeight: "700", fontSize: 14 }}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Currency modal */}
      <Modal visible={!!pendingImport} transparent animationType="fade" onRequestClose={() => setPendingImport(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: 20 }}>
          <View style={{ backgroundColor: colors.card, borderRadius: 24, padding: 20, width: "100%", maxWidth: 400 }}>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, marginBottom: 4 }}>
              ¿En qué moneda está tu portafolio?
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 16 }}>
              Los precios se mostrarán en la moneda que elijas. Los precios de mercado en tiempo real se convierten automáticamente.
            </Text>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
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
              ] as const).map(({ code, flag, name: cname }) => {
                const active = importCurrency === code;
                return (
                  <TouchableOpacity
                    key={code}
                    onPress={() => setImportCurrency(code)}
                    style={{
                      width: "30%",
                      alignItems: "center",
                      paddingVertical: 10,
                      borderRadius: 14,
                      borderWidth: 1.5,
                      borderColor: active ? colors.accent : colors.border,
                      backgroundColor: active ? colors.accent + "18" : colors.bgRaised,
                    }}
                  >
                    <Text style={{ fontSize: 20 }}>{flag}</Text>
                    <Text style={{ color: active ? colors.accentLight : colors.text, fontSize: 11, fontWeight: "700" }}>{code}</Text>
                    <Text style={{ color: colors.textDim, fontSize: 9 }}>{cname}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity
                onPress={() => setPendingImport(null)}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}
              >
                <Text style={{ color: colors.textMuted, fontWeight: "600" }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => applyImport(importCurrency)}
                disabled={convertingCurrency}
                style={{ flex: 2, paddingVertical: 12, borderRadius: 14, backgroundColor: colors.accent, alignItems: "center", opacity: convertingCurrency ? 0.6 : 1 }}
              >
                <Text style={{ color: "#fff", fontWeight: "700" }}>
                  {convertingCurrency ? "Convirtiendo..." : `Importar en ${importCurrency}`}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    subTabBar: {
      paddingHorizontal: 16, paddingVertical: 10,
    },
    subTabInner: {
      flexDirection: "row", borderRadius: 14, padding: 3,
    },
    subTab: {
      flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 6, paddingVertical: 11, paddingHorizontal: 8, borderRadius: 11,
    },
    subTabActive: {
      shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2,
    },
    subTabText: { fontSize: 13, fontWeight: "700", letterSpacing: -0.1 },
    premiumToolCard: { borderRadius: 18, borderWidth: 1, padding: 16 },
    premiumToolHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
    premiumToolIcon: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
    premiumToolTitle: { fontSize: 15, fontWeight: "800", letterSpacing: -0.3 },
    premiumToolSub: { fontSize: 11, marginTop: 1 },
    premiumToolDesc: { fontSize: 12, lineHeight: 18 },
    premiumBenefit: { fontSize: 12, lineHeight: 18 },
    lockBadge: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
    unlockBtn: { borderRadius: 13, paddingVertical: 12, alignItems: "center", marginTop: 14 },
    unlockBtnText: { color: "white", fontWeight: "800", fontSize: 14 },
    content: { padding: 16, paddingBottom: 48 },
    sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
    sectionTitle: { fontSize: 17, fontWeight: "800", color: c.text, marginBottom: 12, letterSpacing: -0.3 },
    headerButtons: { flexDirection: "row", gap: 8 },
    btnSmall: { borderRadius: 10, paddingHorizontal: 13, paddingVertical: 7 },

    btnSmallText: { color: "white", fontSize: 12, fontWeight: "700", letterSpacing: 0.1 },
    // Screenshot primary button
    screenshotBtn: {
      backgroundColor: c.accent, borderRadius: 18, padding: 18,
      marginBottom: 14,
      shadowColor: c.accentLight, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    },
    screenshotBtnInner: { flexDirection: "row", alignItems: "center", gap: 16 },
    screenshotBtnText: { color: "white", fontSize: 16, fontWeight: "800", letterSpacing: -0.2 },
    screenshotBtnSub: { color: "rgba(255,255,255,0.72)", fontSize: 12, marginTop: 3, letterSpacing: 0.1 },
    // Screenshot preview card
    previewCard: { borderRadius: 18, borderWidth: 1.5, padding: 16, marginBottom: 14 },
    previewHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
    previewTitle: { fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
    previewSub: { fontSize: 12, marginTop: 3, lineHeight: 17 },
    previewThumbs: { flexDirection: "row", alignItems: "center", marginLeft: 8 },
    previewThumb: { width: 44, height: 78, borderRadius: 8, resizeMode: "cover", borderWidth: 2, borderColor: "transparent" },
    previewThumbMore: { width: 44, height: 78, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center", marginLeft: -12 },
    previewThumbMoreText: { fontSize: 12, fontWeight: "700" },
    previewRow: {
      flexDirection: "row", alignItems: "center", paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth, gap: 10,
    },
    previewRowLeft: { flex: 1 },
    previewTicker: { fontSize: 14, fontWeight: "800" },
    previewName: { fontSize: 11, marginTop: 2 },
    previewRowMid: { alignItems: "flex-end", marginRight: 4 },
    previewDetail: { fontSize: 12, lineHeight: 18 },
    previewActions: { flexDirection: "row", gap: 10, marginTop: 16 },
    previewCancel: {
      flex: 1, borderWidth: 1, borderRadius: 12,
      paddingVertical: 13, alignItems: "center",
    },
    previewCancelText: { fontWeight: "600", fontSize: 14 },
    previewConfirm: {
      flex: 2, backgroundColor: c.accent, borderRadius: 12,
      paddingVertical: 13, alignItems: "center",
    },
    previewConfirmText: { color: "white", fontWeight: "700", fontSize: 14 },
    // Manual form
    formCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 14 },
    formTitle: { fontSize: 14, fontWeight: "700", marginBottom: 12, letterSpacing: -0.1 },
    formRow: { flexDirection: "row", marginBottom: 8 },
    formInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, marginBottom: 10, width: "100%" },
    cancelBtn: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: "center", borderWidth: 1 },
    cancelBtnText: { fontWeight: "600", fontSize: 14 },
    addBtn: { flex: 1, backgroundColor: c.accent, borderRadius: 12, paddingVertical: 13, alignItems: "center", marginLeft: 8 },
    addBtnText: { color: "white", fontWeight: "700", fontSize: 14 },
    // Empty
    emptyCard: { borderRadius: 18, borderWidth: 1, padding: 32, alignItems: "center", marginBottom: 16 },
    emptyTitle: { fontSize: 16, fontWeight: "700", marginBottom: 8, letterSpacing: -0.2 },
    emptyDesc: { fontSize: 13, textAlign: "center", lineHeight: 19 },
    // Totals
    totalsCard: {
      borderRadius: 20, borderWidth: 1, padding: 20, marginBottom: 14,
      overflow: "hidden",
      shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1, shadowRadius: 10, elevation: 4,
    },
    totalsLabel: { fontSize: 10, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 },
    totalsValue: { fontSize: 28, fontWeight: "700", marginBottom: 6, letterSpacing: -0.8 },
    totalsRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    totalsInvested: { fontSize: 12, letterSpacing: 0.1 },
    totalsDiff: { fontSize: 15, fontWeight: "900" },
    // Position card
    posCardWrapper: { borderRadius: 18, borderWidth: 1, marginBottom: 8, overflow: "hidden" },
    posCardAccent: { height: 3 },
    posCard: { padding: 14 },
    posHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
    posTicker: { fontSize: 16, fontWeight: "800", letterSpacing: -0.3 },
    posName: { fontSize: 11, marginTop: 2, letterSpacing: 0.1 },
    posBody: { flexDirection: "row", justifyContent: "space-between" },
    posDetail: { fontSize: 12, lineHeight: 19 },
    posCurrentVal: { fontSize: 15, fontWeight: "700" },
    posPct: { fontSize: 12, fontWeight: "700", marginTop: 2 },
    posPrice: { fontSize: 11, marginTop: 8, letterSpacing: 0.1 },
    // Divider
    divider: { borderTopWidth: StyleSheet.hairlineWidth, marginVertical: 24 },
    // Simulator
    scenarioRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
    scenarioCard: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 12, alignItems: "center", gap: 4 },
    scenarioActive: { borderColor: c.accentLight, backgroundColor: c.accentLight + "12" },
    scenarioLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.1 },
    simInput: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, fontSize: 14, marginBottom: 14 },
    simBtn: {
      backgroundColor: c.accent, borderRadius: 16, paddingVertical: 16,
      alignItems: "center", justifyContent: "center", marginBottom: 16,
      shadowColor: c.accentLight, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    },
    btnDisabled: { opacity: 0.45 },
    simBtnText: { color: "white", fontWeight: "700", fontSize: 15, letterSpacing: 0.1 },
    simHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 14 },
    simSubtitle: { fontSize: 12, lineHeight: 18 },
    resultCard: { borderRadius: 16, borderWidth: 1, padding: 18, marginBottom: 4 },
    resultText: { fontSize: 13, lineHeight: 21 },
    disclaimer: { marginTop: 12, backgroundColor: "rgba(234,179,8,0.08)", borderWidth: 1, borderColor: "rgba(234,179,8,0.25)", borderRadius: 10, padding: 10 },
    disclaimerText: { color: "#ca8a04", fontSize: 11, lineHeight: 16 },
    // ── Calculadora de Inversión ─────────────────────────────────────────
    calcCard:          { borderRadius: 20, borderWidth: 1, padding: 18, marginBottom: 14 },
    calcRow:           { flexDirection: "row", gap: 10, marginBottom: 14 },
    calcField:         { flex: 1 },
    calcLabel:         { fontSize: 10, fontWeight: "700", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
    calcInput:         { borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 12, fontSize: 15 },
    calcInputWrap:     { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 12 },
    calcInputPrefix:   { fontSize: 15, fontWeight: "800", marginRight: 4 },
    calcInputInner:    { flex: 1, fontSize: 15, padding: 0 },
    calcBtn:           { backgroundColor: "#6366f1", borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 4,
                         shadowColor: "#6366f1", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 6 },
    calcBtnText:       { color: "white", fontWeight: "800", fontSize: 16, letterSpacing: 0.2 },
    // Result card
    calcResultCard:    { borderRadius: 20, borderWidth: 1, overflow: "hidden", marginBottom: 4 },
    calcHero:          { padding: 20, alignItems: "center", gap: 6 },
    calcHeroLabel:     { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
    calcHeroValue:     { fontSize: 40, fontWeight: "900", letterSpacing: -1.5 },
    calcHeroRow:       { flexDirection: "row", gap: 8, marginTop: 4 },
    calcHeroBadge:     { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
    calcHeroBadgeText: { fontSize: 12, fontWeight: "800" },
    // Stats
    calcStatsRow:      { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
    calcStatItem:      { flex: 1, alignItems: "center", paddingVertical: 14 },
    calcStatLabel:     { fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 },
    calcStatVal:       { fontSize: 13, fontWeight: "800" },
    // Chart
    chartSection:      { padding: 16, paddingBottom: 12 },
    chartTitle:        { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 14 },
    chartBars:         { flexDirection: "row", alignItems: "flex-end", gap: 6 },
    barCol:            { flex: 1, alignItems: "center" },
    barTopLabel:       { fontSize: 9, fontWeight: "700", marginBottom: 4, textAlign: "center" },
    barContainer:      { justifyContent: "flex-end", width: "100%" },
    barStack:          { width: "100%", borderRadius: 6, overflow: "hidden" },
    barSegReturns:     { width: "100%", backgroundColor: "#22c55e" },
    barSegInvested:    { width: "100%", backgroundColor: "#6366f1" },
    barYearLabel:      { fontSize: 10, fontWeight: "700", marginTop: 6 },
    // Legend
    chartLegend:       { flexDirection: "row", gap: 12, marginTop: 12, flexWrap: "wrap" },
    legendItem:        { flexDirection: "row", alignItems: "center", gap: 5 },
    legendDot:         { width: 8, height: 8, borderRadius: 4 },
    legendText:        { fontSize: 10, fontWeight: "600" },
    // Disclaimer
    calcDisclaimer:    { flexDirection: "row", alignItems: "flex-start", gap: 6, margin: 14, marginTop: 0, borderWidth: 1, borderRadius: 10, padding: 10 },
    calcDisclaimerText:{ fontSize: 10, flex: 1, lineHeight: 15 },
    // Risk Diagnosis card
    diagCard: {
      borderRadius: 18, borderWidth: 1.5, padding: 16, marginBottom: 16,
      backgroundColor: c.card,
    },
    diagHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
    diagBadge: { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
    diagBadgeDot: { width: 8, height: 8, borderRadius: 4 },
    diagBadgeText: { fontSize: 13, fontWeight: "800", letterSpacing: -0.2 },
    diagScore: { fontSize: 12, fontWeight: "700" },
    diagBarRow: { flexDirection: "row", gap: 3, alignItems: "center", marginBottom: 7 },
    diagBarSeg: { flex: 1, alignSelf: "center" },
    diagBarLabels: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
    diagBarLabel: { fontSize: 10, letterSpacing: 0.1 },
    diagSectors: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
    diagSectorChip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
    diagSectorText: { fontSize: 11, fontWeight: "700" },
    // Sector drill-down
    sectorDrillBox: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
    sectorDrillHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
    sectorDrillTitle: { fontSize: 12, fontWeight: "800" },
    sectorDrillClose: { fontSize: 11, fontWeight: "600" },
    sectorDrillRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 4 },
    sectorDrillLeft: { flex: 1, minWidth: 0, marginRight: 8 },
    sectorDrillTicker: { fontSize: 13, fontWeight: "800" },
    sectorDrillName: { fontSize: 11, marginTop: 1 },
    sectorDrillRight: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 0 },
    sectorDrillShares: { fontSize: 11 },
    sectorDrillVal: { fontSize: 12, fontWeight: "700" },
    sectorDrillPct: { fontSize: 11, fontWeight: "700", width: 30, textAlign: "right" },
    sectorDrillFooter: { borderTopWidth: 1, paddingTop: 8, marginTop: 4, alignItems: "flex-end" },
    sectorDrillFooterLabel: { fontSize: 12, fontWeight: "700" },
    diagFeedback: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 8 },
    diagFeedbackRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
    diagFeedbackText: { flex: 1, fontSize: 13, lineHeight: 19 },
    // Stress Test
    stressChip: {
      flexDirection: "row", alignItems: "center", gap: 8,
      borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 9,
    },
    stressChipIcon: { fontSize: 17 },
    stressChipName: { fontSize: 12, fontWeight: "700", letterSpacing: -0.1 },
    stressChipYear: { fontSize: 10, marginTop: 2 },
    stressResultCard: { borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 4 },
    stressResultTitle: { fontSize: 14, fontWeight: "700", marginBottom: 12, letterSpacing: -0.2 },
    stressSummary: { borderRadius: 12, padding: 14, marginBottom: 12 },
    stressSummaryLabel: { fontSize: 11, marginBottom: 4, letterSpacing: 0.1 },
    stressSummaryVal: { fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
    stressRow: {
      flexDirection: "row", alignItems: "center",
      paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth,
    },
    stressRowTicker: { fontSize: 14, fontWeight: "800", letterSpacing: -0.2 },
    stressRowSector: { fontSize: 11, marginTop: 2 },
    stressRowPct: { fontSize: 15, fontWeight: "800" },
    stressRowDiff: { fontSize: 11, fontWeight: "600", marginTop: 2 },
    // Paper Trading
    paperBalance: {
      flexDirection: "row", alignItems: "center",
      borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 12,
    },
    paperBalanceLabel: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 },
    paperBalanceVal: { fontSize: 24, fontWeight: "900", letterSpacing: -0.5 },
    paperBalanceReturn: { fontSize: 12, fontWeight: "700", marginTop: 3 },
    paperCash: { fontSize: 20, fontWeight: "800" },
    paperForm: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
    paperFormTitle: { fontSize: 14, fontWeight: "700", marginBottom: 12 },
    paperInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
    paperBuyBtn: { backgroundColor: "#8b5cf6", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
    paperBuyBtnText: { color: "white", fontWeight: "700", fontSize: 13 },
    paperPositionsList: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 4 },
    paperPosRow: {
      flexDirection: "row", alignItems: "center",
      paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth,
    },
    paperPosTicker: { fontSize: 14, fontWeight: "800", letterSpacing: -0.2 },
    paperPosDetail: { fontSize: 11, marginTop: 2 },
    paperPosVal: { fontSize: 14, fontWeight: "700" },
    paperPosPct: { fontSize: 11, fontWeight: "700" },
    paperSellBtn: {
      borderWidth: 1, borderColor: c.down, borderRadius: 9,
      paddingHorizontal: 10, paddingVertical: 5,
    },
    paperSellBtnText: { color: c.down, fontSize: 11, fontWeight: "700" },
    paperHistoryBtn: {
      flexDirection: "row", alignItems: "center", gap: 5,
      borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    },
    paperHistoryBtnText: { fontSize: 12, fontWeight: "600" },
    paperResetBtn: {
      flexDirection: "row", alignItems: "center", gap: 5,
      borderWidth: 1, borderColor: c.down + "60", borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 10,
    },
    paperResetBtnText: { color: c.down, fontSize: 12, fontWeight: "600" },
    paperHistoryCard: { borderRadius: 14, borderWidth: 1, padding: 12, marginTop: 10 },
    paperTradeRow: {
      flexDirection: "row", alignItems: "center", gap: 8,
      paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth,
    },
    paperTradeBadge: { width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center" },
    paperTradeBadgeText: { fontSize: 10, fontWeight: "800" },
    paperTradeTicker: { fontSize: 13, fontWeight: "800", width: 46, letterSpacing: -0.2 },
    paperTradeDetail: { fontSize: 12 },
    paperTradeTotal: { fontSize: 12, fontWeight: "700" },
  });
}
