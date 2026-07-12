"use client";

import AppSidebar from "@/components/AppSidebar";
import TourSpotlight from "@/components/TourSpotlight";
import StockAvatar from "@/components/StockAvatar";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { market as marketApi } from "@/lib/api";
import { useAuthStore, useSubscriptionStore, useProfileStore } from "@/lib/store";
import { getUserLevel, isAtLeast } from "@/lib/userLevel";
import { usePortfolioStore, type Position } from "@/lib/portfolioStore";
import { useFxRate } from "@/lib/useFxRate";
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
  ChevronDown, ChevronUp, Loader2, Microscope, ArrowRight,
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
  AFRM:"Fintech",UPST:"Fintech",NERDW:"Fintech",

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
  ABNB:"Consumo Discrecional",BKNG:"Consumo Discrecional",EXPE:"Consumo Discrecional",
  YUM:"Consumo Discrecional",CMG:"Consumo Discrecional",
  DKNG:"Consumo Discrecional",DIS:"Consumo Discrecional",
  UBER:"Consumo Discrecional",LYFT:"Consumo Discrecional",
  F:"Consumo Discrecional",GM:"Consumo Discrecional",
  RIVN:"Consumo Discrecional",LCID:"Consumo Discrecional",NIO:"Consumo Discrecional",
  LVS:"Consumo Discrecional",MGM:"Consumo Discrecional",WYNN:"Consumo Discrecional",
  PTON:"Consumo Discrecional",

  // Consumo Básico
  WMT:"Consumo Básico",KO:"Consumo Básico",PG:"Consumo Básico",
  COST:"Consumo Básico",PEP:"Consumo Básico",MDLZ:"Consumo Básico",
  CLX:"Consumo Básico",KHC:"Consumo Básico",GIS:"Consumo Básico",
  HSY:"Consumo Básico",CL:"Consumo Básico",KMB:"Consumo Básico",
  EL:"Consumo Básico",K:"Consumo Básico",CHD:"Consumo Básico",
  TSN:"Consumo Básico",HRL:"Consumo Básico",PM:"Consumo Básico",MO:"Consumo Básico",

  // Salud (aseguradoras + hospitales + dispositivos)
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
  IONS:"Biotecnología",BEAM:"Biotecnología",SGEN:"Biotecnología",

  // Financiero (capital markets, gestoras, pagos)
  GS:"Financiero",MS:"Financiero",BX:"Financiero",
  KKR:"Financiero",APO:"Financiero",SCHW:"Financiero",
  BLK:"Financiero",SPGI:"Financiero",ICE:"Financiero",IBKR:"Financiero",
  V:"Financiero",MA:"Financiero",AXP:"Financiero",
  BRK:"Financiero","BRK-B":"Financiero",

  // Bancario
  JPM:"Bancario",BAC:"Bancario",WFC:"Bancario",
  C:"Bancario",USB:"Bancario",PNC:"Bancario",
  TFC:"Bancario",FITB:"Bancario",HBAN:"Bancario",

  // Seguros
  PRU:"Seguros",MET:"Seguros",AFL:"Seguros",
  TRV:"Seguros",AIG:"Seguros",CB:"Seguros",
  ALL:"Seguros",PGR:"Seguros",UNM:"Seguros",

  // Energía
  XOM:"Energía",CVX:"Energía",COP:"Energía",OXY:"Energía",
  SLB:"Energía",HAL:"Energía",EOG:"Energía",PXD:"Energía",
  DVN:"Energía",PSX:"Energía",VLO:"Energía",MPC:"Energía",
  HES:"Energía",BKR:"Energía",MRO:"Energía",

  // Energía Renovable
  ENPH:"Energía Renovable",SEDG:"Energía Renovable",FSLR:"Energía Renovable",
  RUN:"Energía Renovable",PLUG:"Energía Renovable",BE:"Energía Renovable",

  // Servicios Públicos
  NEE:"Servicios Públicos",DUK:"Servicios Públicos",
  SO:"Servicios Públicos",AEP:"Servicios Públicos",
  D:"Servicios Públicos",EXC:"Servicios Públicos",
  XEL:"Servicios Públicos",PCG:"Servicios Públicos",ITRI:"Servicios Públicos",

  // Industriales (maquinaria, manufactura)
  CAT:"Industriales",DE:"Industriales",GE:"Industriales",
  HON:"Industriales",EMR:"Industriales",ETN:"Industriales",
  ITW:"Industriales",PH:"Industriales",ROK:"Industriales",
  XYL:"Industriales",AME:"Industriales",MMM:"Industriales",
  CARR:"Industriales",OTIS:"Industriales",
  UNP:"Industriales",CSX:"Industriales",

  // Aeroespacial & Defensa
  LMT:"Aeroespacial",RTX:"Aeroespacial",NOC:"Aeroespacial",
  GD:"Aeroespacial",BA:"Aeroespacial",TDG:"Aeroespacial",
  HEI:"Aeroespacial",AXON:"Aeroespacial",RKLB:"Aeroespacial",SPCE:"Aeroespacial",

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
  MP:"Materiales",ECL:"Materiales",PPG:"Materiales",SHW:"Materiales",

  // Telecomunicaciones
  T:"Telecomunicaciones",VZ:"Telecomunicaciones",TMUS:"Telecomunicaciones",
  CMCSA:"Telecomunicaciones",CHTR:"Telecomunicaciones",

  // Medios & Entretenimiento
  WBD:"Medios",PARA:"Medios",FOX:"Medios",FOXA:"Medios",

  // Real Estate
  AMT:"Real Estate",CCI:"Real Estate",PLD:"Real Estate",
  EQR:"Real Estate",VTR:"Real Estate",SPG:"Real Estate",
  MAA:"Real Estate",PSA:"Real Estate",INVH:"Real Estate",
  VICI:"Real Estate",VNQ:"Real Estate",EQIX:"Real Estate",

  // Cripto / Blockchain
  COIN:"Cripto",MSTR:"Cripto",MARA:"Cripto",
  RIOT:"Cripto",HUT:"Cripto",CLSK:"Cripto",

  // ETF
  SPY:"ETF",QQQ:"ETF",VTI:"ETF",IVV:"ETF",VOO:"ETF",
  IWM:"ETF",GLD:"ETF",SLV:"ETF",USO:"ETF",TLT:"ETF",
  HYG:"ETF",LQD:"ETF",EEM:"ETF",EFA:"ETF",IEF:"ETF",
  DIA:"ETF",ARKK:"ETF",TQQQ:"ETF",SQQQ:"ETF",
  XLK:"ETF",XLF:"ETF",XLV:"ETF",XLE:"ETF",
  VGT:"ETF",SMH:"ETF",
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
  "Real Estate": 40,
  Seguros: 40,
  Farmacéutica: 38,
  Salud: 32,
  Telecomunicaciones: 35,
  Logística: 44,
  Bancario: 48,
  Industriales: 48,
  Aeroespacial: 52,
  Financiero: 52,
  Materiales: 54,
  Medios: 55,
  Energía: 58,
  "Consumo Discrecional": 55,
  eCommerce: 62,
  Software: 65,
  "Energía Renovable": 68,
  "Servicios Públicos": 28,
  Tecnología: 70,
  Fintech: 74,
  Biotecnología: 72,
  "Inteligencia Artificial": 82,
  Semiconductores: 78,
  Cripto: 92,
};

// Color por sector para la barra de diagnóstico
const SECTOR_COLOR: Record<string, string> = {
  Semiconductores:"#8b5cf6",
  Software:"#6366f1",
  "Inteligencia Artificial":"#a855f7",
  Tecnología:"#7c3aed",
  Fintech:"#06b6d4",
  eCommerce:"#f97316",
  "Consumo Discrecional":"#fb923c",
  "Consumo Básico":"#eab308",
  Salud:"#ec4899",
  Farmacéutica:"#f43f5e",
  Biotecnología:"#e11d48",
  Financiero:"#475569",
  Bancario:"#64748b",
  Seguros:"#94a3b8",
  Energía:"#ef4444",
  "Energía Renovable":"#22c55e",
  "Servicios Públicos":"#16a34a",
  Industriales:"#0ea5e9",
  Aeroespacial:"#38bdf8",
  Logística:"#14b8a6",
  Materiales:"#d97706",
  Telecomunicaciones:"#22d3ee",
  Medios:"#818cf8",
  "Real Estate":"#2dd4bf",
  Cripto:"#f59e0b",
  ETF:"#94a3b8",
};

// Mapeo de sectores granulares → categoría de drawdown para stress test
const SECTOR_PARENT: Record<string, string> = {
  Semiconductores: "Tecnología",
  Software: "Tecnología",
  "Inteligencia Artificial": "Tecnología",
  Fintech: "Financiero",
  eCommerce: "Consumo Discrecional",
  Farmacéutica: "Salud",
  Biotecnología: "Salud",
  Telecomunicaciones: "Comunicaciones",
  Medios: "Comunicaciones",
  Bancario: "Financiero",
  Seguros: "Financiero",
  "Energía Renovable": "Servicios Públicos",
  Aeroespacial: "Industriales",
  Logística: "Industriales",
  "Real Estate": "Bienes Raíces",
  "Servicios Públicos": "Servicios Públicos",
  Cripto: "Tecnología",
};

function getSectorLabel(t: TFunction): Record<string, string> {
  return {
    "Semiconductores": t("portfolio.sectors.semiconductors"),
    "Software": t("portfolio.sectors.software"),
    "Tecnología": t("portfolio.sectors.technology"),
    "Inteligencia Artificial": t("portfolio.sectors.ai"),
    "Fintech": t("portfolio.sectors.fintech"),
    "eCommerce": t("portfolio.sectors.ecommerce"),
    "Consumo Discrecional": t("portfolio.sectors.consumerDiscretionary"),
    "Consumo Básico": t("portfolio.sectors.consumerStaples"),
    "Salud": t("portfolio.sectors.health"),
    "Farmacéutica": t("portfolio.sectors.pharma"),
    "Biotecnología": t("portfolio.sectors.biotech"),
    "Financiero": t("portfolio.sectors.financial"),
    "Bancario": t("portfolio.sectors.banking"),
    "Seguros": t("portfolio.sectors.insurance"),
    "Energía": t("portfolio.sectors.energy"),
    "Energía Renovable": t("portfolio.sectors.renewableEnergy"),
    "Servicios Públicos": t("portfolio.sectors.utilities"),
    "Industriales": t("portfolio.sectors.industrials"),
    "Aeroespacial": t("portfolio.sectors.aerospace"),
    "Logística": t("portfolio.sectors.logistics"),
    "Materiales": t("portfolio.sectors.materials"),
    "Telecomunicaciones": t("portfolio.sectors.telecom"),
    "Medios": t("portfolio.sectors.media"),
    "Real Estate": t("portfolio.sectors.realEstate"),
    "Cripto": t("portfolio.sectors.crypto"),
    "ETF": t("portfolio.sectors.etf"),
    "Otro": t("portfolio.sectors.other"),
  };
}

function getPortfolioLevels(t: TFunction) {
  return [
    { label:t("portfolio.riskLevels.conservative"),           min:0,  max:13,  color:"#3b82f6" },
    { label:t("portfolio.riskLevels.conservativeModerate"),   min:13, max:25,  color:"#60a5fa" },
    { label:t("portfolio.riskLevels.moderate"),                min:25, max:38,  color:"#f59e0b" },
    { label:t("portfolio.riskLevels.moderateGrowth"),          min:38, max:51,  color:"#f97316" },
    { label:t("portfolio.riskLevels.growth"),                  min:51, max:63,  color:"#fb923c" },
    { label:t("portfolio.riskLevels.aggressive"),               min:63, max:75,  color:"#ef4444" },
    { label:t("portfolio.riskLevels.aggressiveSpeculative"),   min:75, max:88,  color:"#dc2626" },
    { label:t("portfolio.riskLevels.speculative"),              min:88, max:101, color:"#7f1d1d" },
  ];
}

function getStressScenarios(t: TFunction): Array<{
  id: string; name: string; icon: string; color: string; year: string; desc: string;
  drawdowns: Record<string, number>; default: number; era: string;
}> {
  return [
  // ── Siglo XX temprano ──────────────────────────────────────────────────────
  { id:"1901", name:t("portfolio.stressScenarios.y1901.name"), icon:"🚂", color:"#78716c", year:"1901",
    desc:t("portfolio.stressScenarios.y1901.desc"),
    era:"pre1950", default:-46,
    drawdowns:{ Tecnología:-40, Comunicaciones:-38, "Consumo Discrecional":-45, "Consumo Básico":-25, Salud:-22, Financiero:-50, Energía:-35, Industriales:-48, Materiales:-45, "Bienes Raíces":-42, "Servicios Públicos":-35, ETF:-46 }},
  { id:"1907", name:t("portfolio.stressScenarios.y1907.name"), icon:"🏛️", color:"#b45309", year:"1907",
    desc:t("portfolio.stressScenarios.y1907.desc"),
    era:"pre1950", default:-37,
    drawdowns:{ Tecnología:-35, Comunicaciones:-32, "Consumo Discrecional":-38, "Consumo Básico":-20, Salud:-18, Financiero:-55, Energía:-35, Industriales:-42, Materiales:-40, "Bienes Raíces":-45, "Servicios Públicos":-30, ETF:-37 }},
  { id:"ww1", name:t("portfolio.stressScenarios.ww1.name"), icon:"⚔️", color:"#991b1b", year:"1914",
    desc:t("portfolio.stressScenarios.ww1.desc"),
    era:"pre1950", default:-40,
    drawdowns:{ Tecnología:-38, Comunicaciones:-35, "Consumo Discrecional":-42, "Consumo Básico":-18, Salud:-20, Financiero:-45, Energía:-22, Industriales:-30, Materiales:-35, "Bienes Raíces":-38, "Servicios Públicos":-28, ETF:-40 }},
  { id:"1910", name:t("portfolio.stressScenarios.y1910.name"), icon:"📊", color:"#6b7280", year:"1910–1911",
    desc:t("portfolio.stressScenarios.y1910.desc"),
    era:"pre1950", default:-15,
    drawdowns:{ Tecnología:-14, Comunicaciones:-12, "Consumo Discrecional":-16, "Consumo Básico":-8, Salud:-8, Financiero:-18, Energía:-12, Industriales:-16, Materiales:-14, "Bienes Raíces":-15, "Servicios Públicos":-12, ETF:-15 }},
  { id:"1921", name:t("portfolio.stressScenarios.y1921.name"), icon:"🕊️", color:"#6b7280", year:"1920–1921",
    desc:t("portfolio.stressScenarios.y1921.desc"),
    era:"pre1950", default:-30,
    drawdowns:{ Tecnología:-28, Comunicaciones:-25, "Consumo Discrecional":-35, "Consumo Básico":-15, Salud:-12, Financiero:-32, Energía:-25, Industriales:-35, Materiales:-30, "Bienes Raíces":-28, "Servicios Públicos":-22, ETF:-30 }},
  { id:"1929", name:t("portfolio.stressScenarios.y1929.name"), icon:"💸", color:"#7f1d1d", year:"1929–1932",
    desc:t("portfolio.stressScenarios.y1929.desc"),
    era:"pre1950", default:-89,
    drawdowns:{ Tecnología:-82, Comunicaciones:-75, "Consumo Discrecional":-88, "Consumo Básico":-62, Salud:-55, Financiero:-95, Energía:-80, Industriales:-88, Materiales:-85, "Bienes Raíces":-90, "Servicios Públicos":-65, ETF:-89 }},
  { id:"1937", name:t("portfolio.stressScenarios.y1937.name"), icon:"📉", color:"#dc2626", year:"1937–1938",
    desc:t("portfolio.stressScenarios.y1937.desc"),
    era:"pre1950", default:-54,
    drawdowns:{ Tecnología:-50, Comunicaciones:-45, "Consumo Discrecional":-55, "Consumo Básico":-35, Salud:-30, Financiero:-62, Energía:-50, Industriales:-58, Materiales:-55, "Bienes Raíces":-58, "Servicios Públicos":-40, ETF:-54 }},
  { id:"1946", name:t("portfolio.stressScenarios.y1946.name"), icon:"🎖️", color:"#7c3aed", year:"1946",
    desc:t("portfolio.stressScenarios.y1946.desc"),
    era:"pre1950", default:-28,
    drawdowns:{ Tecnología:-25, Comunicaciones:-22, "Consumo Discrecional":-30, "Consumo Básico":-15, Salud:-12, Financiero:-28, Energía:-20, Industriales:-32, Materiales:-28, "Bienes Raíces":-25, "Servicios Públicos":-20, ETF:-28 }},

  // ── 1950–1990 ──────────────────────────────────────────────────────────────
  { id:"1962", name:t("portfolio.stressScenarios.y1962.name"), icon:"🔽", color:"#0891b2", year:"1962",
    desc:t("portfolio.stressScenarios.y1962.desc"),
    era:"mid_century", default:-28,
    drawdowns:{ Tecnología:-28, Comunicaciones:-25, "Consumo Discrecional":-30, "Consumo Básico":-12, Salud:-15, Financiero:-28, Energía:-22, Industriales:-28, Materiales:-25, "Bienes Raíces":-22, "Servicios Públicos":-18, ETF:-28 }},
  { id:"1966", name:t("portfolio.stressScenarios.y1966.name"), icon:"🐻", color:"#dc2626", year:"1966",
    desc:t("portfolio.stressScenarios.y1966.desc"),
    era:"mid_century", default:-22,
    drawdowns:{ Tecnología:-22, Comunicaciones:-20, "Consumo Discrecional":-25, "Consumo Básico":-10, Salud:-12, Financiero:-22, Energía:-15, Industriales:-22, Materiales:-20, "Bienes Raíces":-18, "Servicios Públicos":-15, ETF:-22 }},
  { id:"1970", name:t("portfolio.stressScenarios.y1970.name"), icon:"🔻", color:"#dc2626", year:"1969–1970",
    desc:t("portfolio.stressScenarios.y1970.desc"),
    era:"mid_century", default:-36,
    drawdowns:{ Tecnología:-38, Comunicaciones:-32, "Consumo Discrecional":-40, "Consumo Básico":-15, Salud:-18, Financiero:-38, Energía:-20, Industriales:-38, Materiales:-35, "Bienes Raíces":-32, "Servicios Públicos":-25, ETF:-36 }},
  { id:"oil1973", name:t("portfolio.stressScenarios.oil1973.name"), icon:"🛢️", color:"#f97316", year:"1973–1974",
    desc:t("portfolio.stressScenarios.oil1973.desc"),
    era:"mid_century", default:-48,
    drawdowns:{ Tecnología:-45, Comunicaciones:-35, "Consumo Discrecional":-52, "Consumo Básico":-18, Salud:-20, Financiero:-50, Energía:15, Industriales:-45, Materiales:-42, "Bienes Raíces":-38, "Servicios Públicos":-35, ETF:-48 }},
  { id:"volcker", name:t("portfolio.stressScenarios.volcker.name"), icon:"📈", color:"#b45309", year:"1980–1982",
    desc:t("portfolio.stressScenarios.volcker.desc"),
    era:"mid_century", default:-27,
    drawdowns:{ Tecnología:-25, Comunicaciones:-22, "Consumo Discrecional":-30, "Consumo Básico":-10, Salud:-12, Financiero:-30, Energía:10, Industriales:-28, Materiales:-25, "Bienes Raíces":-45, "Servicios Públicos":-30, ETF:-27 }},
  { id:"1987", name:t("portfolio.stressScenarios.y1987.name"), icon:"⚫", color:"#ef4444", year:"1987",
    desc:t("portfolio.stressScenarios.y1987.desc"),
    era:"mid_century", default:-33,
    drawdowns:{ Tecnología:-38, Comunicaciones:-30, "Consumo Discrecional":-35, "Consumo Básico":-20, Salud:-22, Financiero:-38, Energía:-32, Industriales:-35, Materiales:-35, "Bienes Raíces":-30, "Servicios Públicos":-20, ETF:-33 }},

  // ── 1990–2005 ──────────────────────────────────────────────────────────────
  { id:"gulf1990", name:t("portfolio.stressScenarios.gulf1990.name"), icon:"🛢️", color:"#f97316", year:"1990",
    desc:t("portfolio.stressScenarios.gulf1990.desc"),
    era:"late_xx", default:-20,
    drawdowns:{ Tecnología:-22, Comunicaciones:-18, "Consumo Discrecional":-25, "Consumo Básico":-8, Salud:-10, Financiero:-22, Energía:25, Industriales:-20, Materiales:-18, "Bienes Raíces":-18, "Servicios Públicos":-12, ETF:-20 }},
  { id:"sl1990", name:t("portfolio.stressScenarios.sl1990.name"), icon:"🏠", color:"#b45309", year:"1989–1991",
    desc:t("portfolio.stressScenarios.sl1990.desc"),
    era:"late_xx", default:-20,
    drawdowns:{ Tecnología:-15, Comunicaciones:-12, "Consumo Discrecional":-18, "Consumo Básico":-8, Salud:-10, Financiero:-45, Energía:-12, Industriales:-18, Materiales:-15, "Bienes Raíces":-50, "Servicios Públicos":-12, ETF:-20 }},
  { id:"tequila1994", name:t("portfolio.stressScenarios.tequila1994.name"), icon:"🇲🇽", color:"#16a34a", year:"1994",
    desc:t("portfolio.stressScenarios.tequila1994.desc"),
    era:"late_xx", default:-25,
    drawdowns:{ Tecnología:-15, Comunicaciones:-12, "Consumo Discrecional":-20, "Consumo Básico":-8, Salud:-5, Financiero:-28, Energía:-10, Industriales:-15, Materiales:-18, "Bienes Raíces":-35, "Servicios Públicos":-10, ETF:-25 }},
  { id:"asia1997", name:t("portfolio.stressScenarios.asia1997.name"), icon:"🌏", color:"#0891b2", year:"1997",
    desc:t("portfolio.stressScenarios.asia1997.desc"),
    era:"late_xx", default:-35,
    drawdowns:{ Tecnología:-20, Comunicaciones:-25, "Consumo Discrecional":-35, "Consumo Básico":-10, Salud:-8, Financiero:-30, Energía:-15, Industriales:-22, Materiales:-28, "Bienes Raíces":-45, "Servicios Públicos":-15, ETF:-35 }},
  { id:"russia1998", name:t("portfolio.stressScenarios.russia1998.name"), icon:"🇷🇺", color:"#dc2626", year:"1998",
    desc:t("portfolio.stressScenarios.russia1998.desc"),
    era:"late_xx", default:-19,
    drawdowns:{ Tecnología:-15, Comunicaciones:-18, "Consumo Discrecional":-20, "Consumo Básico":-5, Salud:-8, Financiero:-30, Energía:-25, Industriales:-18, Materiales:-22, "Bienes Raíces":-15, "Servicios Públicos":-10, ETF:-19 }},
  { id:"dotcom", name:t("portfolio.stressScenarios.dotcom.name"), icon:"💻", color:"#9333ea", year:"2000–2002",
    desc:t("portfolio.stressScenarios.dotcom.desc"),
    era:"late_xx", default:-49,
    drawdowns:{ Tecnología:-82, Comunicaciones:-76, "Consumo Discrecional":-45, "Consumo Básico":-10, Salud:-18, Financiero:-22, Energía:-5, Industriales:-25, Materiales:-20, "Bienes Raíces":-15, "Servicios Públicos":-22, ETF:-45 }},
  { id:"sept11", name:t("portfolio.stressScenarios.sept11.name"), icon:"🗽", color:"#1d4ed8", year:"2001",
    desc:t("portfolio.stressScenarios.sept11.desc"),
    era:"late_xx", default:-12,
    drawdowns:{ Tecnología:-15, Comunicaciones:-18, "Consumo Discrecional":-18, "Consumo Básico":5, Salud:3, Financiero:-20, Energía:-8, Industriales:-10, Materiales:-12, "Bienes Raíces":-10, "Servicios Públicos":-5, ETF:-12 }},

  // ── 2005–2015 ──────────────────────────────────────────────────────────────
  { id:"2008", name:t("portfolio.stressScenarios.y2008.name"), icon:"🏦", color:"#ef4444", year:"2007–2009",
    desc:t("portfolio.stressScenarios.y2008.desc"),
    era:"2000s", default:-57,
    drawdowns:{ Tecnología:-55, Comunicaciones:-42, "Consumo Discrecional":-55, "Consumo Básico":-25, Salud:-28, Financiero:-80, Energía:-60, Industriales:-52, Materiales:-58, "Bienes Raíces":-75, "Servicios Públicos":-25, ETF:-55 }},
  { id:"eu2012", name:t("portfolio.stressScenarios.eu2012.name"), icon:"🇪🇺", color:"#6366f1", year:"2010–2012",
    desc:t("portfolio.stressScenarios.eu2012.desc"),
    era:"2000s", default:-25,
    drawdowns:{ Tecnología:-20, Comunicaciones:-22, "Consumo Discrecional":-25, "Consumo Básico":-8, Salud:-12, Financiero:-40, Energía:-18, Industriales:-20, Materiales:-22, "Bienes Raíces":-35, "Servicios Públicos":-28, ETF:-25 }},
  { id:"usdowngrade", name:t("portfolio.stressScenarios.usdowngrade.name"), icon:"📋", color:"#6366f1", year:"2011",
    desc:t("portfolio.stressScenarios.usdowngrade.desc"),
    era:"2000s", default:-19,
    drawdowns:{ Tecnología:-18, Comunicaciones:-15, "Consumo Discrecional":-20, "Consumo Básico":-5, Salud:-8, Financiero:-25, Energía:-18, Industriales:-18, Materiales:-20, "Bienes Raíces":-22, "Servicios Públicos":-15, ETF:-19 }},

  // ── 2015–Hoy ──────────────────────────────────────────────────────────────
  { id:"china2015", name:t("portfolio.stressScenarios.china2015.name"), icon:"🇨🇳", color:"#dc2626", year:"2015–2016",
    desc:t("portfolio.stressScenarios.china2015.desc"),
    era:"recent", default:-15,
    drawdowns:{ Tecnología:-18, Comunicaciones:-15, "Consumo Discrecional":-16, "Consumo Básico":-5, Salud:-8, Financiero:-15, Energía:-30, Industriales:-18, Materiales:-25, "Bienes Raíces":-12, "Servicios Públicos":-10, ETF:-15 }},
  { id:"tradewar2018", name:t("portfolio.stressScenarios.tradewar2018.name"), icon:"🌐", color:"#f59e0b", year:"2018",
    desc:t("portfolio.stressScenarios.tradewar2018.desc"),
    era:"recent", default:-20,
    drawdowns:{ Tecnología:-28, Comunicaciones:-20, "Consumo Discrecional":-22, "Consumo Básico":-5, Salud:-10, Financiero:-18, Energía:-25, Industriales:-22, Materiales:-22, "Bienes Raíces":-15, "Servicios Públicos":-12, ETF:-20 }},
  { id:"covid", name:t("portfolio.stressScenarios.covid.name"), icon:"🦠", color:"#f97316", year:"Feb–Mar 2020",
    desc:t("portfolio.stressScenarios.covid.desc"),
    era:"recent", default:-34,
    drawdowns:{ Tecnología:-30, Comunicaciones:-25, "Consumo Discrecional":-50, "Consumo Básico":-12, Salud:-5, Financiero:-42, Energía:-65, Industriales:-42, Materiales:-40, "Bienes Raíces":-40, "Servicios Públicos":-20, ETF:-34 }},
  { id:"2022", name:t("portfolio.stressScenarios.y2022.name"), icon:"📉", color:"#f59e0b", year:"2022",
    desc:t("portfolio.stressScenarios.y2022.desc"),
    era:"recent", default:-25,
    drawdowns:{ Tecnología:-35, Comunicaciones:-40, "Consumo Discrecional":-38, "Consumo Básico":-5, Salud:-10, Financiero:-15, Energía:58, Industriales:-12, Materiales:-20, "Bienes Raíces":-28, "Servicios Públicos":-15, ETF:-22 }},
  { id:"svb2023", name:t("portfolio.stressScenarios.svb2023.name"), icon:"💳", color:"#6366f1", year:"2023",
    desc:t("portfolio.stressScenarios.svb2023.desc"),
    era:"recent", default:-10,
    drawdowns:{ Tecnología:-12, Comunicaciones:-10, "Consumo Discrecional":-10, "Consumo Básico":-3, Salud:-5, Financiero:-25, Energía:-8, Industriales:-8, Materiales:-8, "Bienes Raíces":-15, "Servicios Públicos":-8, ETF:-10 }},
  { id:"2025", name:t("portfolio.stressScenarios.y2025.name"), icon:"📊", color:"#f59e0b", year:"2025",
    desc:t("portfolio.stressScenarios.y2025.desc"),
    era:"recent", default:-10,
    drawdowns:{ Tecnología:-15, Comunicaciones:-12, "Consumo Discrecional":-12, "Consumo Básico":-3, Salud:-5, Financiero:-10, Energía:-8, Industriales:-10, Materiales:-10, "Bienes Raíces":-8, "Servicios Públicos":-5, ETF:-10 }},

  // ── Escenarios hipotéticos ─────────────────────────────────────────────────
  { id:"fed", name:t("portfolio.stressScenarios.fed.name"), icon:"🏛️", color:"#6366f1", year:t("portfolio.stressScenarios.hypotheticalYear"),
    desc:t("portfolio.stressScenarios.fed.desc"),
    era:"hypothetical", default:-12,
    drawdowns:{ Tecnología:-22, Comunicaciones:-18, "Consumo Discrecional":-12, "Consumo Básico":-8, Salud:-8, Financiero:3, Energía:-8, Industriales:-10, Materiales:-12, "Bienes Raíces":-22, "Servicios Públicos":-18, ETF:-12 }},
  { id:"bull", name:t("portfolio.stressScenarios.bull.name"), icon:"🚀", color:"#22c55e", year:t("portfolio.stressScenarios.hypotheticalYear"),
    desc:t("portfolio.stressScenarios.bull.desc"),
    era:"hypothetical", default:22,
    drawdowns:{ Tecnología:50, Comunicaciones:35, "Consumo Discrecional":28, "Consumo Básico":12, Salud:22, Financiero:30, Energía:22, Industriales:22, Materiales:25, "Bienes Raíces":25, "Servicios Públicos":15, ETF:25 }},
  ];
}

// Score-boundary lookup only (no labels needed here — labels are rendered
// separately via getPortfolioLevels(t) wherever the level name is displayed).
const PORTFOLIO_LEVEL_BOUNDS = [
  { min:0,  max:13 }, { min:13, max:25 }, { min:25, max:38 }, { min:38, max:51 },
  { min:51, max:63 }, { min:63, max:75 }, { min:75, max:88 }, { min:88, max:101 },
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

// Adds thousand separators as the user types, while keeping the underlying
// state a plain parseable numeric string (no commas).
function formatWithCommas(raw: string): string {
  if (!raw) return "";
  const [intPart, decPart] = raw.split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decPart !== undefined ? `${withCommas}.${decPart}` : withCommas;
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
  const idx = PORTFOLIO_LEVEL_BOUNDS.findIndex((l) => score >= l.min && score < l.max);
  const sectorPcts: Record<string,number> = {};
  for (const [s,v] of Object.entries(sectorVals)) sectorPcts[s] = Math.round((v/totalVal)*100);
  return { score, levelIdx: idx===-1?7:idx, sectorPcts };
}


type Scenario = "conservative"|"moderate"|"aggressive";
function getScenarios(t: TFunction): {value:Scenario; label:string; emoji:string}[] {
  return [
    { value:"conservative", label:t("portfolio.scenarios.conservative"), emoji:"🛡️" },
    { value:"moderate",     label:t("portfolio.scenarios.moderate"),    emoji:"⚖️" },
    { value:"aggressive",   label:t("portfolio.scenarios.aggressive"),   emoji:"🚀" },
  ];
}

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
  const { t, i18n } = useTranslation();
  const sectorLabels = getSectorLabel(t);
  const PORTFOLIO_LEVELS = getPortfolioLevels(t);
  const STRESS_SCENARIOS = getStressScenarios(t);
  const SCENARIOS = getScenarios(t);
  const router = useRouter();
  const { isAuthenticated, userId } = useAuthStore();
  const [isTour, setIsTour] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setIsTour(new URLSearchParams(window.location.search).get("tour") === "1"); }, []);
  const [demoMode, setDemoMode] = useState(false);
  const [serverLoading, setServerLoading] = useState(true);
  useEffect(() => {
    if (!localStorage.getItem("nuvos_demo_done")) setDemoMode(true);
  }, []);
  const dismissDemo = (choice: "has_portfolio" | "has_cash" | "wants_to_learn") => {
    localStorage.setItem("nuvos_demo_done", "1");
    setDemoMode(false);
    if (choice === "wants_to_learn" && !isAuthenticated) {
      // Only load demo positions for unauthenticated users — never overwrite a real portfolio
      const demoPositions = [
        { ticker: "NVDA", name: "NVIDIA Corp.", shares: 3.2, avgPrice: 580 },
        { ticker: "AAPL", name: "Apple Inc.", shares: 8, avgPrice: 156 },
        { ticker: "TSLA", name: "Tesla Inc.", shares: 5, avgPrice: 195 },
      ];
      setPositions(demoPositions);
    }
  };
  const { profile } = useProfileStore();
  const userLevel = getUserLevel(profile);
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;
  const upsellTrigger = useUpsellStore((s) => s.trigger);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const {
    positions, closedPositions, inceptionDate, addPosition, removePosition, updatePosition, setPositions,
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
  const fxRate = useFxRate(portfolioCurrency);
  const fxRateRef = useRef(1);
  const portfolioCurrencyRef = useRef("USD");
  useEffect(() => { fxRateRef.current = fxRate; }, [fxRate]);
  useEffect(() => { portfolioCurrencyRef.current = portfolioCurrency; }, [portfolioCurrency]);

  // Screenshot import
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const [screenshotAnalyzing, setScreenshotAnalyzing] = useState(false);
  const [screenshotProgress, setScreenshotProgress] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  type ExtractedPos = { id: string; ticker: string; name: string; shares: number; avg_price: number; purchase_date?: string | null };
  const [screenshotPreview, setScreenshotPreview] = useState<ExtractedPos[]|null>(null);
  const [screenshotPriceInputs, setScreenshotPriceInputs] = useState<Record<string, { avgPrice: string; purchaseDate: string }>>({});
  // Currency of prices shown in the screenshot/PDF (set by user before importing)
  const [screenshotCurrency, setScreenshotCurrency] = useState("USD");
  const screenshotCurrencyRef = useRef("USD");
  useEffect(() => { screenshotCurrencyRef.current = screenshotCurrency; }, [screenshotCurrency]);
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
  // Sync viewMode from server after load (survives Safari localStorage clears)
  useEffect(() => {
    if (!isAuthenticated) return;
    import("@/lib/api").then(({ sync }) =>
      sync.getAll().then((res) => {
        const serverMode = res.data?.portfolio_view_mode as "basic" | "advanced" | undefined;
        if (serverMode && serverMode !== viewMode) {
          setViewMode(serverMode);
          localStorage.setItem("nuvos_portfolio_view", serverMode);
        }
      }).catch(() => {})
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);
  // "Avanzado" is a denser table meant for desktop width — force "Básico" on
  // a phone-sized viewport without touching the user's actual saved
  // preference, so it's back to normal the moment they open this on a
  // computer. Web-only concept (viewport width), not a device check.
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    setIsMobileViewport(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobileViewport(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const effectiveViewMode: "basic" | "advanced" = isMobileViewport ? "basic" : viewMode;
  const [selectedStock, setSelectedStock] = useState<string | null>(null);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir("desc"); }
  };

  // Currency picker
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [showImportSteps, setShowImportSteps] = useState(false);

  // "Historial de compras" panel — the table shows one combined row per
  // ticker; this lists every purchase lot behind that ticker individually.
  const [lotsTicker, setLotsTicker] = useState<string | null>(null);
  // Inline "add another purchase" form inside that same panel — adding to a
  // ticker you already hold happens right here, not in the top-level
  // "Agregar posición" box.
  const [addingLot, setAddingLot] = useState(false);
  // Asks for money invested + price per share, not share count directly —
  // shares = amount / price, computed live, fractional or whole either way.
  const [lotForm, setLotForm] = useState({ amount: "", avgPrice: "", purchaseDate: new Date().toISOString().split("T")[0] });
  const [lotAddLoading, setLotAddLoading] = useState(false);

  // Edit position modal — edits exactly one purchase lot. Buying more of a
  // ticker never touches this lot; it always goes through "Agregar otra
  // compra" (see the lots history panel), which creates a brand new one.
  const [editingPos, setEditingPos] = useState<{ id: string; ticker: string; originalShares: number; shares: string; avgPrice: string; purchaseDate: string } | null>(null);
  const [editConfirm, setEditConfirm] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editSaveError, setEditSaveError] = useState(false);
  // When editing reduces shares, we don't know if it's a sale or a data-entry
  // correction — ask, since only a real sale should be archived into the
  // since-inception performance ledger.
  const [editSaleChoice, setEditSaleChoice] = useState<"ask" | "sale" | "correction" | null>(null);
  const [editSalePrice, setEditSalePrice] = useState("");
  // Sell-price confirmation shown when fully removing a position — required so
  // the realized gain/loss recorded in the ledger is accurate, not a guess.
  const [sellConfirm, setSellConfirm] = useState<{ id: string; ticker: string; shares: number } | null>(null);
  const [sellPrice, setSellPrice] = useState("");
  const [sellSaving, setSellSaving] = useState(false);
  const [revealedPrices, setRevealedPrices] = useState<Set<string>>(new Set());

  // Toast + confirm modal
  const [toastMsg, setToastMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const showToast = (text: string, ok = false) => {
    setToastMsg({ text, ok });
    setTimeout(() => setToastMsg(null), 3500);
  };
  const [confirmModal, setConfirmModal] = useState<{ msg: string; onConfirm: () => void } | null>(null);

  // Manual form — asks for money invested + price per share, not share count
  // directly; shares = amount / price, computed live.
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ticker:"", amount:"", avgPrice:"", purchaseDate: new Date().toISOString().split("T")[0] });
  const [addingLoading, setAddingLoading] = useState(false);

  // Currency modal (shown after screenshot or Excel import)
  type PendingImport = { ticker: string; name?: string; shares: number; avgPrice: number; purchaseDate?: string }[];
  const [pendingImport, setPendingImport] = useState<PendingImport|null>(null);
  const [importCurrency, setImportCurrency] = useState("USD");
  const [convertingCurrency, setConvertingCurrency] = useState(false);


  // Stress test
  const [stressScenario, setStressScenario] = useState<string|null>(null);
  const [stressEra, setStressEra] = useState<string>("all");
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  type StressResult = { total:number; stressed:number; diff:number; pct:number; rows:{ticker:string;invested:number;stressed:number;diff:number;pct:number;sector:string}[] };
  const [stressResult, setStressResult] = useState<StressResult|null>(null);
  const [stressMode, setStressMode] = useState<"scenarios"|"real">("scenarios");
  type BacktestYear = { year:number; portfolio_return_pct:number; sp500_return_pct:number; substituted:boolean };
  const [backtestResult, setBacktestResult] = useState<BacktestYear[]|null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState<string|null>(null);

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

  // Cargar portafolio del servidor — pero NO sobreescribir si hay cambios locales pendientes.
  // serverLoading stays true until we know whether the server has data, so the demo banner
  // never appears to an authenticated user before their real portfolio has a chance to load.
  useEffect(() => {
    if (!isAuthenticated || !userId) {
      setServerLoading(false);
      return;
    }
    const storedKey = `portfolio-positions-web__${userId}`;
    try {
      const raw = localStorage.getItem(storedKey);
      const stored = raw ? JSON.parse(raw) : null;
      if (stored?.pendingSync) {
        retrySync();
        setServerLoading(false);
        return;
      }
    } catch {}
    loadFromServer().finally(() => setServerLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, userId]);

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
    { key: "since_purchase", label: t("portfolio.summary.periods.buy"), premium: false },
    { key: "1d",  label: "1D",   premium: false },
    { key: "5d",  label: "5D",   premium: false },
    { key: "1mo", label: "1M",   premium: false },
    { key: "3mo", label: "3M",   premium: true  },
    { key: "6mo", label: "6M",   premium: true  },
    { key: "ytd", label: t("portfolio.summary.periods.ytd"),  premium: true  },
    { key: "1y",  label: t("portfolio.summary.periods.oneYear"),   premium: true  },
    { key: "3y",  label: t("portfolio.summary.periods.threeYears"),   premium: true  },
    { key: "5y",  label: t("portfolio.summary.periods.fiveYears"),   premium: true  },
    { key: "max", label: t("portfolio.summary.periods.max"),  premium: true  },
  ] as const;
  type PeriodKey = typeof PERIODS[number]["key"];
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodKey>("since_purchase");
  const [periodReturns, setPeriodReturns] = useState<Record<string, PeriodReturn>>({});
  const [loadingReturns, setLoadingReturns] = useState(false);
  // ytd/1mo/3mo/6mo come from the same endpoint used to render the chart itself
  // (getPortfolioChart) rather than /portfolio-returns' own independent
  // calculation of the same numbers — two separately-fetched real-time prices
  // for the same figure can drift apart, and this also keeps the pill % in
  // sync with what the chart underneath actually ends at.
  const CHART_OVERRIDE_KEYS = ["ytd", "1mo", "3mo", "6mo"] as const;
  const [chartOverrides, setChartOverrides] = useState<Partial<Record<string, PeriodReturn>>>({});

  // Chart state
  type ChartData = { history: ChartPoint[]; period_pct: number; period_amount: number; spy_pct?: number };
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [hovData, setHovData] = useState<ChartHovData | null>(null);

  const posPayload = useCallback(
    () => positions.map((p) => ({
      id: p.id, ticker: p.ticker, shares: p.shares,
      purchase_date: p.purchaseDate ?? null,
      avg_price: p.avgPrice ?? null,
    })),
    [positions]
  );

  const closedPosPayload = useCallback(
    () => closedPositions.map((c) => ({
      ticker: c.ticker, shares: c.shares, avg_price: c.avgPrice, close_price: c.closePrice,
      purchase_date: c.purchaseDate ?? null, close_date: c.closeDate ?? null,
    })),
    [closedPositions]
  );

  const fetchReturns = useCallback((showLoader = false) => {
    // Still fetch if everything was sold — closedPositions alone can carry a
    // real since-inception return even with zero current holdings.
    if (positions.length === 0 && closedPositions.length === 0) return;
    if (showLoader) setLoadingReturns(true);
    marketApi.getPortfolioReturns(posPayload(), closedPosPayload(), inceptionDate)
      .then((res: { data: { returns?: Record<string, PeriodReturn>; inferred_dates?: Record<string, string> } }) => {
        setPeriodReturns(res.data.returns ?? {});
        if (showLoader) {
          // Keyed by position id (falls back to "TICKER:index" for lots the
          // client never sent an id for) so each lot's inferred date lands
          // on exactly that lot, even when the same ticker has several.
          const inferred = res.data.inferred_dates ?? {};
          for (const [id, date] of Object.entries(inferred)) {
            const pos = positions.find((p) => p.id === id) ?? positions.find((p) => p.ticker === id.split(":")[0] && !p.purchaseDate);
            if (pos && !pos.purchaseDate) updatePosition(pos.id, { purchaseDate: date });
          }
        }
      })
      .catch(() => {})
      .finally(() => { if (showLoader) setLoadingReturns(false); });
  }, [positions, closedPositions, posPayload, closedPosPayload, inceptionDate, updatePosition]);

  const fetchChart = useCallback((resetChart = false) => {
    if (positions.length === 0) return;
    if (resetChart) { setChartData(null); setChartLoading(true); }
    marketApi.getPortfolioChart(posPayload(), selectedPeriod)
      .then((res: { data: ChartData }) => setChartData(res.data))
      .catch(() => {})
      .finally(() => { if (resetChart) setChartLoading(false); });
  }, [positions, selectedPeriod, posPayload]);

  const fetchChartOverrides = useCallback(() => {
    if (positions.length === 0) return;
    // "1mo" is free; ytd/3mo/6mo are premium — matches PERIODS' own gating,
    // no point fetching chart data for a period the user can't see anyway.
    const keys = CHART_OVERRIDE_KEYS.filter((k) => k === "1mo" || isPremium);
    for (const key of keys) {
      marketApi.getPortfolioChart(posPayload(), key)
        .then((res: { data: ChartData }) => {
          if (res?.data?.period_pct !== undefined) {
            setChartOverrides((prev) => ({
              ...prev,
              [key]: { pct: res.data.period_pct, amount: res.data.period_amount, spy_pct: res.data.spy_pct },
            }));
          }
        })
        .catch(() => {});
    }
  }, [positions, posPayload, isPremium]);

  // Initial load
  useEffect(() => { fetchReturns(true); }, [positions.length]);
  useEffect(() => { fetchChart(true); }, [selectedPeriod, positions.length]);
  useEffect(() => { fetchChartOverrides(); }, [positions.length]);

  // Auto-refresh en tiempo real — returns cada 30s, chart cada 60s
  useEffect(() => {
    if (positions.length === 0) return;
    const ri = setInterval(() => fetchReturns(false), 30_000);
    const ci = setInterval(() => fetchChart(false), 60_000);
    const oi = setInterval(() => fetchChartOverrides(), 60_000);
    return () => { clearInterval(ri); clearInterval(ci); clearInterval(oi); };
  }, [positions.length, fetchReturns, fetchChart, fetchChartOverrides]);

  // Per-position gain/loss for the currently selected period. The backend's
  // /portfolio-returns already returns a purchase-date-aware breakdown per
  // ticker for every period (clamped to the purchase date when it falls
  // inside the period, with the date itself inferred from cost-basis-vs-
  // history when the user never entered one) — this just wires that into
  // the table/cards instead of always showing the flat since-purchase %.
  const getPeriodGainLoss = useCallback((ticker: string, currentVal: number | null, investedVal: number | null) => {
    const bd = selectedPeriod !== "since_purchase" ? periodReturns[selectedPeriod]?.breakdown?.[ticker] : undefined;
    if (bd != null && currentVal != null) {
      const startVal = currentVal / (1 + bd / 100);
      return { pct: bd, diff: currentVal - startVal };
    }
    if (currentVal != null && investedVal != null && investedVal > 0) {
      return { pct: ((currentVal - investedVal) / investedVal) * 100, diff: currentVal - investedVal };
    }
    return { pct: null as number | null, diff: null as number | null };
  }, [selectedPeriod, periodReturns]);

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

  // One entry per ticker, combining every purchase lot — this is the only
  // thing that changes for display; the underlying `positions` array still
  // holds each purchase as its own permanent row (see the lots panel below).
  interface AggPosition { ticker: string; name?: string; totalShares: number; avgPrice: number; lots: Position[] }
  const aggregatedPositions = useMemo<AggPosition[]>(() => {
    const map = new Map<string, AggPosition>();
    for (const p of positions) {
      const existing = map.get(p.ticker);
      if (existing) {
        const newShares = existing.totalShares + p.shares;
        const newCost = existing.avgPrice * existing.totalShares + p.avgPrice * p.shares;
        existing.totalShares = newShares;
        existing.avgPrice = newShares > 0 ? newCost / newShares : 0;
        existing.lots.push(p);
      } else {
        map.set(p.ticker, { ticker: p.ticker, name: p.name, totalShares: p.shares, avgPrice: p.avgPrice, lots: [p] });
      }
    }
    return Array.from(map.values());
  }, [positions]);

  const sortedPositions = useMemo(() => {
    if (!sortField) return aggregatedPositions;
    return [...aggregatedPositions].sort((a, b) => {
      let va = 0, vb = 0;
      if (sortField === "invested") {
        va = a.totalShares * a.avgPrice * fxRate;
        vb = b.totalShares * b.avgPrice * fxRate;
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
  }, [aggregatedPositions, prices, fxRate, sortField, sortDir]);

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
      const shotCur = screenshotCurrencyRef.current;
      const res = await marketApi.analyzePdf(file, shotCur);
      const extracted: ExtractedPos[] = (res.data.positions || []).map(
        (p: Omit<ExtractedPos, "id">, i: number) => ({ ...p, id: `${p.ticker}-pdf-${i}-${Date.now()}` })
      );
      if (!extracted.length) {
        showToast("No se encontraron posiciones en el PDF. Verifica que sea un estado de cuenta con posiciones.");
      } else {
        setScreenshotPreview(extracted);
        const inputs: Record<string, { avgPrice: string; purchaseDate: string }> = {};
        const rate = fxRateRef.current;
        const cur = portfolioCurrencyRef.current;
        const APPROX: Record<string, number> = { MXN:18.5, EUR:0.92, GBP:0.79, CAD:1.38, BRL:5.7, JPY:155, AUD:1.55, CHF:0.89 };
        for (const p of extracted) {
          let display = p.avg_price;
          if (p.avg_price > 0) {
            if (shotCur === cur) {
              display = p.avg_price;
            } else if (shotCur === "USD") {
              display = p.avg_price * rate;
            } else {
              const usd = p.avg_price / (APPROX[shotCur] ?? 1);
              display = cur === "USD" ? usd : usd * rate;
            }
          }
          inputs[p.id] = {
            avgPrice: p.avg_price > 0 ? String(parseFloat(display.toFixed(4))) : "",
            purchaseDate: p.purchase_date ?? "",
          };
        }
        setScreenshotPriceInputs(inputs);
      }
    } catch {
      showToast("No se pudo leer el PDF. Intenta con el estado de cuenta más reciente o usa una captura de pantalla.");
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
        const res = await marketApi.analyzeScreenshot(base64, file.type || "image/jpeg", screenshotCurrencyRef.current);
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
        showToast("No se encontraron posiciones en las imágenes. Intenta con capturas más claras.");
      } else {
        setScreenshotPreview(final);
        const inputs: Record<string, { avgPrice: string; purchaseDate: string }> = {};
        const shotCur = screenshotCurrencyRef.current;
        const rate = fxRateRef.current;
        const cur = portfolioCurrencyRef.current;
        const APPROX: Record<string, number> = { MXN:18.5, EUR:0.92, GBP:0.79, CAD:1.38, BRL:5.7, JPY:155, AUD:1.55, CHF:0.89 };
        for (const p of final) {
          let display = p.avg_price;
          if (p.avg_price > 0) {
            if (shotCur === cur) {
              display = p.avg_price;
            } else if (shotCur === "USD") {
              display = p.avg_price * rate;
            } else {
              const usd = p.avg_price / (APPROX[shotCur] ?? 1);
              display = cur === "USD" ? usd : usd * rate;
            }
          }
          inputs[p.id] = {
            avgPrice: p.avg_price > 0 ? String(parseFloat(display.toFixed(4))) : "",
            purchaseDate: p.purchase_date ?? "",
          };
        }
        setScreenshotPriceInputs(inputs);
      }
    } catch {
      showToast("No se pudieron analizar las imágenes. Verifica que el backend esté corriendo.");
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
    // Inject user-entered prices — convert from user's display currency to USD for storage
    const shotCur = screenshotCurrencyRef.current;
    const APPROX: Record<string, number> = { MXN:18.5, EUR:0.92, GBP:0.79, CAD:1.38, BRL:5.7, JPY:155, AUD:1.55, CHF:0.89 };
    const withUserPrices = screenshotPreview.map((p) => {
      const typed = parseFloat(screenshotPriceInputs[p.id]?.avgPrice ?? "");
      // Fallback: convert AI-extracted price from screenshotCurrency to USD
      const fallbackUSD = shotCur === "USD" ? p.avg_price : p.avg_price / (APPROX[shotCur] ?? 1);
      const avg_price_usd = (!isNaN(typed) && typed > 0)
        ? (portfolioCurrency === "USD" ? typed : typed / fxRate)
        : fallbackUSD;
      return {
        ...p,
        avg_price: parseFloat(avg_price_usd.toFixed(6)),
        purchase_date: screenshotPriceInputs[p.id]?.purchaseDate || null,
      };
    });
    if (positions.length > 0) {
      setPendingMerge(withUserPrices);
      setMergeModalOpen(true);
      setScreenshotPreview(null);
      setScreenshotPriceInputs({});
      return;
    }
    setPendingImport(withUserPrices.map((p) => ({
      ticker: p.ticker, name: p.name, shares: p.shares, avgPrice: p.avg_price,
      ...(p.purchase_date ? { purchaseDate: p.purchase_date } : {}),
    })));
    // Prices are already in USD; importCurrency just sets the user's display currency
    setImportCurrency(portfolioCurrency);
    setScreenshotPreview(null);
    setScreenshotPriceInputs({});
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
    setImportCurrency(portfolioCurrency);
    setMergeModalOpen(false);
    setPendingMerge([]);
  };

  // Import: keep prices in original currency, just store the currency
  const applyImport = async (positions: PendingImport, currency: string) => {
    setCurrency(currency);
    setPositions(positions);
    setConvertingCurrency(false);
    setPendingImport(null);
  };


  // ── Manual add ─────────────────────────────────────────────────────────
  const FREE_POSITION_LIMIT = 10;

  const handleAdd = async () => {
    const ticker = form.ticker.trim().toUpperCase();
    const amount = parseFloat(form.amount);
    const enteredPrice = parseFloat(form.avgPrice);
    if (!ticker || !amount || !enteredPrice) { showToast("Completa todos los campos"); return; }
    if (!isPremium && positions.length >= FREE_POSITION_LIMIT) { setPaywallOpen(true); return; }
    const shares = amount / enteredPrice;
    // avgPrice always stored in USD
    const avgPrice = portfolioCurrency === "USD" ? enteredPrice : enteredPrice / fxRate;
    setAddingLoading(true);
    try {
      const res = await marketApi.getPrices([ticker]);
      addPosition({ ticker, shares: parseFloat(shares.toFixed(6)), avgPrice: parseFloat(avgPrice.toFixed(6)), name: res.data[ticker]?.name, purchaseDate: form.purchaseDate });
    } catch {
      addPosition({ ticker, shares: parseFloat(shares.toFixed(6)), avgPrice: parseFloat(avgPrice.toFixed(6)), purchaseDate: form.purchaseDate });
    }
    setForm({ ticker:"", amount:"", avgPrice:"", purchaseDate: new Date().toISOString().split("T")[0] });
    setShowForm(false);
    setAddingLoading(false);
  };

  // Adds another purchase lot for a ticker already shown in the "Historial
  // de compras" panel — same as handleAdd, but stays inside that panel
  // instead of routing to the top-level "Agregar posición" box.
  const handleAddLot = async (ticker: string) => {
    const amount = parseFloat(lotForm.amount);
    const enteredPrice = parseFloat(lotForm.avgPrice);
    if (!amount || !enteredPrice) { showToast("Completa el monto y el precio"); return; }
    if (!isPremium && positions.length >= FREE_POSITION_LIMIT) { setPaywallOpen(true); return; }
    const shares = amount / enteredPrice;
    const avgPrice = portfolioCurrency === "USD" ? enteredPrice : enteredPrice / fxRate;
    setLotAddLoading(true);
    try {
      const res = await marketApi.getPrices([ticker]);
      addPosition({ ticker, shares: parseFloat(shares.toFixed(6)), avgPrice: parseFloat(avgPrice.toFixed(6)), name: res.data[ticker]?.name, purchaseDate: lotForm.purchaseDate });
    } catch {
      addPosition({ ticker, shares: parseFloat(shares.toFixed(6)), avgPrice: parseFloat(avgPrice.toFixed(6)), purchaseDate: lotForm.purchaseDate });
    }
    setLotForm({ amount: "", avgPrice: "", purchaseDate: new Date().toISOString().split("T")[0] });
    setAddingLot(false);
    setLotAddLoading(false);
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
      const parentSector = sector ? (SECTOR_PARENT[sector] ?? sector) : null;
      const drawdown = sector
        ? (sc.drawdowns[sector as keyof typeof sc.drawdowns]
            ?? (parentSector ? sc.drawdowns[parentSector as keyof typeof sc.drawdowns] : undefined)
            ?? sc.default)
        : sc.default;
      const stressed = invested * (1 + drawdown/100);
      return { ticker:pos.ticker, invested, stressed, diff:stressed-invested, pct:drawdown, sector:sector||"Otro" };
    });
    const total = rows.reduce((a,r) => a+r.invested, 0);
    const stressedTotal = rows.reduce((a,r) => a+r.stressed, 0);
    setStressResult({ total, stressed:stressedTotal, diff:stressedTotal-total, pct:total>0?((stressedTotal-total)/total)*100:0, rows });
    upsellTrigger("stress_test_done");
  };

  const runHistoricalBacktest = async () => {
    if (positions.length === 0 || backtestLoading) return;
    setBacktestLoading(true); setBacktestError(null);
    try {
      const posPayload = positions.map((p) => ({ ticker: p.ticker, shares: p.shares, avg_price: p.avgPrice }));
      const res = await marketApi.getHistoricalBacktest(posPayload);
      setBacktestResult(res.data?.years ?? []);
      upsellTrigger("stress_test_done");
    } catch {
      setBacktestError("No pudimos calcular el backtest histórico. Intenta de nuevo.");
    }
    setBacktestLoading(false);
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
    {/* Toast */}
    {toastMsg && (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-2xl text-sm font-semibold shadow-xl pointer-events-none"
           style={{ background: toastMsg.ok ? "rgba(0,168,94,0.95)" : "rgba(30,32,48,0.97)", color: "#fff", border: "1px solid rgba(255,255,255,0.08)" }}>
        {toastMsg.text}
      </div>
    )}
    {/* Confirm Modal */}
    {confirmModal && (
      <div className="fixed inset-0 z-[9998] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }}
           onClick={() => setConfirmModal(null)}>
        <div className="rounded-2xl p-6 max-w-xs w-full mx-4 flex flex-col gap-4"
             style={{ background: "var(--card)", border: "1px solid var(--border)" }}
             onClick={e => e.stopPropagation()}>
          <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{confirmModal.msg}</p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmModal(null)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold border"
                    style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
              Cancelar
            </button>
            <button onClick={() => { confirmModal.onConfirm(); setConfirmModal(null); }}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold"
                    style={{ background: "#ef4444", color: "#fff" }}>
              Eliminar
            </button>
          </div>
        </div>
      </div>
    )}
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

        {/* Sticky Header */}
        {/* Title+switcher and the controls row used to share one
            items-center justify-between row unconditionally — on mobile
            there's no room for both, so the wrapped portfolio-pill line and
            the view-toggle/refresh/share controls ended up vertically
            overlapping instead of stacking. flex-col below lg stacks them;
            lg:flex-row restores the original single-row desktop layout. */}
        <div className="sticky top-0 z-10 px-4 sm:px-6 py-3 sm:py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b shrink-0"
             style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
          <div className="flex flex-col gap-2 flex-1 min-w-0">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("portfolio.header.eyebrow")}</p>
              <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>
                {portfolios.find(p => p.id === activePortfolioId)?.name ?? t("portfolio.header.title")}
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
                      onClick={e => { e.stopPropagation(); setConfirmModal({ msg: `¿Eliminar "${p.name}"?`, onConfirm: () => deletePortfolio(p.id) }); }}
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
                  + {t("portfolio.header.newPortfolio")}
                </button>
              )}
              {showNewPortfolioInput && (
                <form onSubmit={async e => { e.preventDefault(); if (!newPortfolioName.trim()) return; setPortfolioCreating(true); try { await createPortfolio(newPortfolioName.trim()); setShowNewPortfolioInput(false); setNewPortfolioName(""); } catch { showToast("No se pudo crear el portafolio. Inténtalo de nuevo."); } finally { setPortfolioCreating(false); } }} style={{ display: "flex", gap: 6, alignItems: "center" }}>
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
          <div className="flex items-center gap-2 flex-wrap">
            {/* Sync status */}
            {syncStatus === "syncing" && (
              <div className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: "var(--muted)" }}>
                <RefreshCw className="w-3 h-3 animate-spin" /><span className="hidden sm:inline">{t("portfolio.header.saving")}</span>
              </div>
            )}
            {syncStatus === "saved" && (
              <div className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: "#22c55e" }}
                   title={t("portfolio.header.savedOnServerTitle") ?? undefined}>
                <Check className="w-3 h-3" /><span className="hidden sm:inline">{t("portfolio.header.savedOnServer")}</span>
              </div>
            )}
            {syncStatus === "error" && (
              <div className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: "#ef4444" }}>
                <CloudOff className="w-3 h-3" /><span className="hidden sm:inline">{t("portfolio.header.saveError")}</span>
              </div>
            )}
            {syncStatus === "idle" && lastSaved && (
              <div className="flex items-center gap-1 text-[10px]" style={{ color: "var(--dim)" }}
                   title={t("portfolio.header.savedAtTitle") ?? undefined}>
                <Cloud className="w-3 h-3" />
                <span className="hidden sm:inline">{t("portfolio.header.savedAt", { time: new Date(lastSaved).toLocaleTimeString(i18n.language === "en" ? "en-US" : "es-MX", { hour: "2-digit", minute: "2-digit" }) })}</span>
              </div>
            )}
            {/* View toggle — hidden on mobile since effectiveViewMode forces "basic" there regardless of what's tapped */}
            <div className="hidden lg:flex items-center rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              <button onClick={() => { setViewMode("basic"); localStorage.setItem("nuvos_portfolio_view", "basic"); import("@/lib/api").then(({ sync }) => sync.pushPortfolioViewMode("basic").catch(() => {})); }}
                      className="px-2.5 py-1.5 text-[10px] font-bold transition-colors"
                      style={{ background: viewMode === "basic" ? "var(--accent)" : "transparent", color: viewMode === "basic" ? "#fff" : "var(--muted)" }}>
                {t("portfolio.header.basic")}
              </button>
              <button onClick={() => { setViewMode("advanced"); localStorage.setItem("nuvos_portfolio_view", "advanced"); import("@/lib/api").then(({ sync }) => sync.pushPortfolioViewMode("advanced").catch(() => {})); }}
                      className="px-2.5 py-1.5 text-[10px] font-bold transition-colors"
                      style={{ background: viewMode === "advanced" ? "var(--accent)" : "transparent", color: viewMode === "advanced" ? "#fff" : "var(--muted)" }}>
                {t("portfolio.header.advanced")}
              </button>
            </div>
            <PremiumBadge />
            <button onClick={fetchPrices}
                    className="w-9 h-9 flex items-center justify-center rounded-xl border transition-colors hover:border-[var(--accent)]"
                    style={{ borderColor: "var(--border)", background: "var(--raised)", color: "var(--sub)" }}
                    title={t("portfolio.header.refreshPrices") ?? undefined}>
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              title={t("portfolio.header.sharePortfolio") ?? undefined}
              className="w-9 h-9 flex items-center justify-center rounded-xl border transition-colors hover:border-[var(--accent)]"
              style={{ borderColor: "var(--border)", background: "var(--raised)", color: "var(--sub)" }}
              onClick={() => {
                const sign = totals.pct >= 0 ? "+" : "";
                const text = t("portfolio.header.shareText", {
                  value: `${currencySymbol}${totals.current.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
                  sign, pct: totals.pct.toFixed(1),
                });
                if (navigator.share) {
                  navigator.share({ title: t("portfolio.header.shareTitle") ?? undefined, text });
                } else {
                  navigator.clipboard.writeText(text);
                  showToast(t("portfolio.header.copiedToClipboard"), true);
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
              {t("portfolio.header.myPortfolioTab")}
            </button>
            {isAtLeast(userLevel, "basico") ? (
              <button onClick={() => setActiveTab("herramientas")}
                      className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-1.5"
                      style={{ background: activeTab === "herramientas" ? "var(--card)" : "transparent", color: activeTab === "herramientas" ? "var(--accent-l)" : "var(--muted)" }}>
                {t("portfolio.header.toolsTab")}
              </button>
            ) : (
              <div className="flex-1 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 opacity-35"
                   style={{ color: "var(--dim)" }}
                   title={t("portfolio.header.toolsLocked") ?? undefined}>
                🔒 {t("portfolio.header.toolsTab")}
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
                  <p className="text-xs font-bold" style={{ color: "var(--text)" }}>{t("portfolio.actions.cloudTitle")}</p>
                  <p className="text-[10px]" style={{ color: "var(--muted)" }}>
                    {t("portfolio.actions.cloudSubtitle")}
                  </p>
                </div>
              </div>
              {positions.length > 0 && (
                <button
                  onClick={() => {
                    setConfirmModal({ msg: t("portfolio.actions.emptyConfirm", { count: positions.length }), onConfirm: clearPortfolio });
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-colors"
                  style={{ color: "#ef4444", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                  <Trash2 className="w-3 h-3" /> {t("portfolio.actions.empty")}
                </button>
              )}
            </div>

            {/* Pasos para importar portafolio por captura */}
            <div className="mb-3 rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--card)" }}>
              <button
                onClick={() => setShowImportSteps(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors"
                style={{ background: "transparent" }}>
                <span className="text-xs font-bold" style={{ color: "var(--muted)" }}>{t("portfolio.actions.importHowTo")}</span>
                {showImportSteps
                  ? <ChevronUp className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--muted)" }} />
                  : <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--muted)" }} />}
              </button>
              {showImportSteps && (
                <div className="px-3 pb-3" style={{ borderTop: "1px solid var(--border)" }}>
                  {(t("portfolio.actions.importSteps", { returnObjects: true }) as string[]).map((step, i) => (
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

            {/* Moneda de la captura — selector inline antes de importar */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs shrink-0" style={{ color: "var(--muted)" }}>{t("portfolio.actions.screenshotPricesIn")}</span>
              {["USD", "MXN", "EUR", "GBP"].map((c) => (
                <button
                  key={c}
                  onClick={() => setScreenshotCurrency(c)}
                  className="px-2 py-0.5 rounded-lg text-xs font-bold transition-all"
                  style={{
                    background: screenshotCurrency === c ? "rgba(0,212,126,0.15)" : "var(--raised)",
                    color: screenshotCurrency === c ? "#00d47e" : "var(--muted)",
                    border: `1px solid ${screenshotCurrency === c ? "#00d47e" : "var(--border)"}`,
                  }}
                >
                  {c}
                </button>
              ))}
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
                {t("portfolio.actions.addPosition")}
                {!isPremium && (
                  <span className="ml-1 text-xs font-black opacity-80">
                    {positions.length}/{FREE_POSITION_LIMIT}
                  </span>
                )}
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
                  <><RefreshCw className="w-4 h-4 animate-spin" /><span>{screenshotProgress || t("portfolio.actions.analyzing")}</span></>
                ) : isDragOver ? (
                  <><Upload className="w-4 h-4" /><span>{t("portfolio.actions.dropHere")}</span></>
                ) : (
                  <><Upload className="w-4 h-4" /><span>{t("portfolio.actions.importScreenshotOrPdf")}</span></>
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
              <span>{t("portfolio.actions.connectBroker")}</span>
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
                <span>{t("portfolio.actions.pasteHintPre")}{" "}
                  <kbd className="px-1 py-0.5 rounded font-mono text-[9px]"
                       style={{ background: "var(--raised)", color: "var(--muted)" }}>⌘V</kbd>
                  {" "}{t("portfolio.actions.pasteHintPost")}
                </span>
              </div>
            )}

            {/* Screenshot preview */}
            {screenshotPreview && (
              <div className="mt-3 rounded-2xl border-2 p-4" style={{ borderColor:"#22c55e", background:"var(--card)" }}>
                <p className="font-extrabold text-sm mb-1" style={{ color:"var(--text)" }}>
                  {screenshotPreview.length} posiciones detectadas
                </p>
                <p className="text-xs mb-1" style={{ color:"var(--muted)" }}>
                  Agrega el precio promedio de compra de cada posición.
                </p>
                <p className="text-[11px] mb-3 px-2.5 py-1.5 rounded-lg font-medium" style={{ color:"#f59e0b", background:"#f59e0b15" }}>
                  ⚠ No usamos el precio de la foto — puede ser incorrecto en acciones fraccionadas. Búscalo en tu broker bajo "precio promedio" o "average cost".
                </p>
                {screenshotPreview.map((p) => (
                  <div key={p.id} className="py-3 border-b" style={{ borderColor:"var(--border)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="font-extrabold text-sm" style={{ color:"var(--text)" }}>{p.ticker}</span>
                        {p.name !== p.ticker && <span className="text-xs ml-2" style={{ color:"var(--muted)" }}>{p.name}</span>}
                        <span className="text-xs ml-2 font-medium" style={{ color:"var(--sub)" }}>{p.shares} acc</span>
                      </div>
                      <button onClick={() => {
                        setScreenshotPreview((prev) => { const next=(prev??[]).filter((x)=>x.id!==p.id); return next.length?next:null; });
                        setScreenshotPriceInputs((prev) => { const n={...prev}; delete n[p.id]; return n; });
                      }} className="text-[#ef4444] text-xl font-bold leading-none ml-2">×</button>
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-[10px] font-bold uppercase block mb-1" style={{ color:"var(--muted)" }}>
                          Precio promedio ({portfolioCurrency})
                        </label>
                        <input
                          type="number" min="0" step="any"
                          placeholder={portfolioCurrency === "USD" ? "ej. 223.00" : `ej. ${(223 * fxRate).toFixed(0)}`}
                          value={screenshotPriceInputs[p.id]?.avgPrice ?? ""}
                          onChange={(e) => setScreenshotPriceInputs((prev) => ({ ...prev, [p.id]: { ...prev[p.id], avgPrice: e.target.value } }))}
                          className="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none"
                          style={{ background:"var(--raised)", borderColor:"var(--border)", color:"var(--text)" }}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-[10px] font-bold uppercase block mb-1" style={{ color:"var(--muted)" }}>
                          Fecha de compra <span style={{ fontWeight:400 }}>(opcional)</span>
                        </label>
                        <input
                          type="date"
                          max={new Date().toISOString().split("T")[0]}
                          value={screenshotPriceInputs[p.id]?.purchaseDate ?? ""}
                          onChange={(e) => setScreenshotPriceInputs((prev) => ({ ...prev, [p.id]: { ...prev[p.id], purchaseDate: e.target.value } }))}
                          className="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none"
                          style={{ background:"var(--raised)", borderColor:"var(--border)", color:"var(--text)" }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex gap-2 mt-3">
                  <button onClick={() => { setScreenshotPreview(null); setScreenshotPriceInputs({}); }}
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
                      <label className="text-[9px] font-bold uppercase tracking-wider block mb-1" style={{ color: "var(--muted)" }}>¿Cuánto invertiste? ({portfolioCurrency})</label>
                      <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                             type="number" min="0"
                             className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                             style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                             placeholder="500" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold uppercase tracking-wider block mb-1" style={{ color: "var(--muted)" }}>Precio por acción ({portfolioCurrency})</label>
                      <input value={form.avgPrice} onChange={(e) => setForm({ ...form, avgPrice: e.target.value })}
                             type="number" min="0"
                             className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                             style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                             placeholder={portfolioCurrency === "USD" ? "150.00" : (150 * fxRate).toFixed(0)} />
                    </div>
                  </div>
                  {parseFloat(form.amount) > 0 && parseFloat(form.avgPrice) > 0 && (() => {
                    const calcShares = parseFloat(form.amount) / parseFloat(form.avgPrice);
                    const isWhole = Math.abs(calcShares - Math.round(calcShares)) < 0.0005;
                    return (
                      <p className="text-[11px] mb-2 px-0.5" style={{ color: "var(--accent-l)" }}>
                        ≈ <span className="font-bold">{calcShares.toLocaleString("en-US", { maximumFractionDigits: 6 })}</span> acciones
                        {" "}({isWhole ? "completas" : "fraccionadas"})
                      </p>
                    );
                  })()}
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
            // The goal is stored in USD (entered without a currency picker in
            // onboarding/profile) — convert it the same way positions are, so
            // it tracks whatever currency is selected instead of staying in USD.
            const goalAmtUSD = parseFloat(profile?.investment_goal_amount ?? "0");
            if (!goalAmtUSD || goalAmtUSD <= 0) return null;
            const goalAmt = goalAmtUSD * fxRate;
            const progressPct = Math.min((totals.current / goalAmt) * 100, 100);
            const remaining = Math.max(goalAmt - totals.current, 0);
            const GOAL_LABELS: Record<string, string> = {
              emergency_fund: t("portfolio.goal.emergencyFund", "Fondo de emergencia"),
              big_purchase:   t("portfolio.goal.bigPurchase", "Compra importante"),
              retirement:     t("portfolio.goal.retirement", "Retiro / pensión"),
              independence:   t("portfolio.goal.independence", "Independencia financiera"),
            };
            const goalLabel = GOAL_LABELS[profile?.investment_goal ?? ""] ?? t("portfolio.goal.default");
            const reached = progressPct >= 100;
            return (
              <div className="rounded-2xl border p-4 mb-4"
                   style={{ background: "var(--card)", borderColor: reached ? "rgba(34,197,94,0.35)" : "var(--border)" }}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5"
                       style={{ color: "var(--accent-l)" }}>{t("portfolio.goal.label")}</p>
                    <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{goalLabel}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-black leading-none"
                       style={{ color: reached ? "#22c55e" : "var(--text)" }}>
                      {progressPct.toFixed(1)}%
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>
                      {reached ? t("portfolio.goal.reached") : t("portfolio.goal.completed")}
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
                    {" "}{t("portfolio.goal.accumulated")}
                  </span>
                  {reached ? (
                    <span className="font-bold" style={{ color: "#22c55e" }}>{t("portfolio.goal.goalReached")}</span>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>
                      {t("portfolio.goal.missing")}{" "}
                      <span className="font-semibold" style={{ color: "var(--sub)" }}>
                        {currencySymbol}{remaining.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </span>
                    </span>
                  )}
                </div>
                <div className="mt-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px]" style={{ color: "var(--dim)" }}>
                      {t("portfolio.goal.goalPrefix")} {currencySymbol}{goalAmt.toLocaleString("en-US", { maximumFractionDigits: 0 })}
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
                      ? t("portfolio.goal.months", { count: Math.ceil(monthsToGoalPure) })
                      : yearsToGoal < 1.83
                      ? t("portfolio.goal.yearAndHalf")
                      : t("portfolio.goal.years", { count: Math.round(yearsToGoal) });
                    return (
                      <p className="text-[10px] mt-1" style={{ color: "var(--dim)" }}>
                        {t("portfolio.goal.rateLabel", { rate: rateLabel, time: timeLabel })}
                      </p>
                    );
                  })()}
                </div>
              </div>
            );
          })()}

          {/* ── Positions ── */}
          {positions.length === 0 && !screenshotPreview && demoMode && !serverLoading ? (
            <div className="space-y-3">
              {/* Simulated notification — the "aha moment" */}
              <div className="rounded-2xl border-2 p-4" style={{ borderColor:"#22c55e40", background:"linear-gradient(135deg,#0a1f0f,#0f1a10)" }}>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5" style={{ background:"#22c55e20" }}>
                    <span className="text-base">📈</span>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color:"#22c55e" }}>Así funciona Nuvos AI</p>
                    <p className="text-sm font-bold leading-snug mb-1" style={{ color:"#fff" }}>
                      Tu NVIDIA subió <span style={{ color:"#22c55e" }}>+$1,847</span> esta semana
                    </p>
                    <p className="text-xs leading-relaxed" style={{ color:"#9ca3af" }}>
                      Jensen Huang anunció nuevos chips para centros de datos IA, lo que impulsó la demanda institucional. Tu portafolio se beneficia directamente por tu posición en NVDA.
                    </p>
                  </div>
                </div>
              </div>

              {/* Demo portfolio positions */}
              <div className="rounded-2xl border p-4" style={{ borderColor:"var(--border)", background:"var(--card)" }}>
                <p className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color:"var(--muted)" }}>Portafolio de ejemplo</p>
                {[
                  { ticker:"NVDA", name:"NVIDIA Corp.", shares:3.2, buy:580, price:134.5 * 4, gain:31.2 },
                  { ticker:"AAPL", name:"Apple Inc.", shares:8, buy:156, price:198.45, gain:27.2 },
                  { ticker:"TSLA", name:"Tesla Inc.", shares:5, buy:195, price:248.3, gain:27.3 },
                ].map((p) => {
                  const val = p.shares * p.price;
                  const gainAmt = p.shares * (p.price - p.buy);
                  return (
                    <div key={p.ticker} className="flex items-center justify-between py-2.5 border-b last:border-0" style={{ borderColor:"var(--border)" }}>
                      <div>
                        <p className="font-extrabold text-sm" style={{ color:"var(--text)" }}>{p.ticker}</p>
                        <p className="text-[11px]" style={{ color:"var(--muted)" }}>{p.shares} acc</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold" style={{ color:"var(--text)" }}>${val.toLocaleString("en-US",{maximumFractionDigits:0})}</p>
                        <p className="text-[11px] font-semibold" style={{ color:"#22c55e" }}>+${gainAmt.toLocaleString("en-US",{maximumFractionDigits:0})} ({p.gain}%)</p>
                      </div>
                    </div>
                  );
                })}
                <div className="mt-2.5 pt-2.5 border-t flex justify-between" style={{ borderColor:"var(--border)" }}>
                  <span className="text-xs font-bold" style={{ color:"var(--muted)" }}>Total portafolio</span>
                  <span className="text-sm font-black" style={{ color:"#22c55e" }}>+$2,451 · +28.6%</span>
                </div>
              </div>

              {/* Magic question */}
              <div className="rounded-2xl border p-4" style={{ borderColor:"var(--border)", background:"var(--card)" }}>
                <p className="font-bold text-sm mb-1" style={{ color:"var(--text)" }}>¿Tienes acciones o fondos invertidos actualmente?</p>
                <p className="text-xs mb-4" style={{ color:"var(--muted)" }}>Así Nuvos AI sabe cómo ayudarte mejor desde el primer momento.</p>
                <div className="space-y-2">
                  <button onClick={() => dismissDemo("has_portfolio")}
                          className="w-full text-left p-3 rounded-xl border-2 transition-all flex items-center gap-3"
                          style={{ borderColor:"#22c55e", background:"#22c55e08" }}>
                    <span className="text-xl">📊</span>
                    <div>
                      <p className="text-sm font-bold" style={{ color:"var(--text)" }}>Sí, ya tengo portafolio</p>
                      <p className="text-xs" style={{ color:"var(--muted)" }}>Agrego mis posiciones y Nuvos AI las analiza</p>
                    </div>
                  </button>
                  <button onClick={() => dismissDemo("has_cash")}
                          className="w-full text-left p-3 rounded-xl border transition-all flex items-center gap-3"
                          style={{ borderColor:"var(--border)", background:"var(--raised)" }}>
                    <span className="text-xl">💵</span>
                    <div>
                      <p className="text-sm font-bold" style={{ color:"var(--text)" }}>Tengo dinero para invertir</p>
                      <p className="text-xs" style={{ color:"var(--muted)" }}>Aún no tengo cuenta en un broker</p>
                    </div>
                  </button>
                  <button onClick={() => dismissDemo("wants_to_learn")}
                          className="w-full text-left p-3 rounded-xl border transition-all flex items-center gap-3"
                          style={{ borderColor:"var(--border)", background:"var(--raised)" }}>
                    <span className="text-xl">📚</span>
                    <div>
                      <p className="text-sm font-bold" style={{ color:"var(--text)" }}>Solo quiero aprender por ahora</p>
                      <p className="text-xs" style={{ color:"var(--muted)" }}>Explorar con el portafolio de ejemplo</p>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          ) : positions.length === 0 && !screenshotPreview ? (
            userLevel === "avanzado" ? (
              <div className="rounded-2xl border p-10 flex flex-col items-center gap-3"
                   style={{ borderColor:"var(--border)", background:"var(--card)" }}>
                <PieChart className="w-10 h-10" style={{ color:"var(--dim)" }} />
                <p className="font-bold text-sm" style={{ color:"var(--text)" }}>Sin posiciones todavía</p>
                <p className="text-xs text-center" style={{ color:"var(--muted)" }}>
                  Importa capturas de pantalla y la IA lo detecta todo automáticamente
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border overflow-hidden"
                   style={{ borderColor:"rgba(0,212,126,0.2)", background:"var(--card)" }}>
                <div className="h-1" style={{ background:"linear-gradient(90deg,#00d47e,#00a8ff)" }} />
                <div className="p-6 flex flex-col items-center gap-3 text-center">
                  <span className="text-4xl">🌱</span>
                  <div>
                    <p className="font-black text-base mb-1" style={{ color:"var(--text)" }}>
                      Todos empezamos desde cero
                    </p>
                    <p className="text-xs leading-relaxed max-w-xs" style={{ color:"var(--muted)" }}>
                      Antes de invertir dinero real, practica con dinero virtual. Cuando te sientas listo, te recomendamos los mejores ETFs para empezar.
                    </p>
                  </div>
                  <div className="w-full grid grid-cols-2 gap-2 mt-1">
                    <button onClick={() => router.push("/paper")}
                            className="py-2.5 rounded-xl text-xs font-black transition-all hover:opacity-90"
                            style={{ background:"var(--accent)", color:"#000" }}>
                      🎮 Practica sin dinero real
                    </button>
                    <button onClick={() => router.push("/screener")}
                            className="py-2.5 rounded-xl text-xs font-bold border transition-all hover:opacity-80"
                            style={{ borderColor:"rgba(0,212,126,0.35)", color:"var(--accent-l)", background:"rgba(0,212,126,0.06)" }}>
                      🚀 Ver ETFs recomendados
                    </button>
                  </div>
                  <button onClick={() => router.push("/chat")}
                          className="text-xs transition-all hover:opacity-70 mt-1"
                          style={{ color:"var(--muted)" }}>
                    Tengo dudas — preguntarle al mentor IA →
                  </button>
                </div>
              </div>
            )
          ) : positions.length > 0 ? (
            <section>
              {/* ── Unified Performance Card ── */}
              {(() => {
                const sp   = periodReturns["since_purchase"];
                const r    = chartOverrides[selectedPeriod] ?? periodReturns[selectedPeriod];
                const displayPct = r?.pct !== undefined ? r.pct : chartData?.period_pct;
                const displayAmtUSD = r?.amount !== undefined ? r.amount : chartData?.period_amount;
                const displayAmt = displayAmtUSD !== undefined ? displayAmtUSD * fxRate : undefined;
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
                          <span className="text-sm">{t("portfolio.summary.updatingPrices")}</span>
                        </div>
                      ) : priceError ? (
                        <div className="flex items-center gap-2 py-2">
                          <span className="text-sm" style={{ color: "var(--muted)" }}>
                            {t("portfolio.summary.pricesUnavailable")}{" "}
                          </span>
                          <button onClick={fetchPrices}
                                  className="text-sm font-semibold underline hover:opacity-70 transition-opacity"
                                  style={{ color: "var(--accent-l)" }}>
                            {t("portfolio.summary.retry")}
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--dim)" }}>
                                <span className="flex items-center gap-1.5">
                                {t("portfolio.summary.label")}
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
                              {t("portfolio.summary.invested")}{" "}
                              <span className="font-semibold" style={{ color: "var(--sub)" }}>
                                {currencySymbol}{totals.invested.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                              </span>
                              {sp?.date && <span style={{ color: "var(--dim)" }}> · {t("portfolio.summary.since", { date: sp.date })}</span>}
                            </p>
                            {sp?.spy_pct !== undefined && sp?.pct !== undefined && (() => {
                              const diff = sp.pct - sp.spy_pct;
                              const beats = diff >= 0;
                              return (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px]" style={{ color: "var(--dim)" }}>{t("portfolio.summary.vsSp500")}</span>
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
                          const ret    = locked ? null : (chartOverrides[key] ?? periodReturns[key]);
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
                                {label}
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
                          <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--dim)" }}>{t("portfolio.summary.kpi.performance")}</p>
                          {displayPct !== undefined ? (
                            <p className="text-base font-black leading-none" style={{ color }}>
                              {up ? "+" : ""}{displayPct.toFixed(2)}%
                            </p>
                          ) : chartLoading ? (
                            <p className="text-xs font-bold" style={{ color: "var(--dim)" }}>···</p>
                          ) : (
                            <p className="text-base font-black leading-none" style={{ color: "var(--dim)" }}>—</p>
                          )}
                          {r?.date && <p className="text-[9px] mt-1" style={{ color: "var(--dim)" }}>{t("portfolio.summary.since", { date: r.date })}</p>}
                        </div>

                        {/* Ganancia $ */}
                        <div className="rounded-xl p-3" style={{ background: "var(--raised)" }}>
                          <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--dim)" }}>{t("portfolio.summary.kpi.gain")}</p>
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
                          <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--dim)" }}>{t("portfolio.summary.kpi.vsSp500")}</p>
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
                                    {beats ? "▲" : "▼"} {Math.abs(diff).toFixed(2)}% {beats ? t("portfolio.summary.kpi.better") : t("portfolio.summary.kpi.worse")}
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
                          {t("portfolio.summary.loadingHistory")}
                        </div>
                      ) : chartData && chartData.history.length >= 2 ? (
                        <div className="pt-3">
                          <PortfolioHistoryChart history={chartData.history} color={color} currencySymbol={currencySymbol} onHoverChange={setHovData} />
                        </div>
                      ) : !chartLoading ? (
                        <div className="h-[160px] flex items-center justify-center text-xs"
                             style={{ color: "var(--dim)" }}>
                          {t("portfolio.summary.noHistoryForPeriod")}
                        </div>
                      ) : null}
                    </div>


                    {/* ── FOOTER ── */}
                    <div className="border-t px-4 py-2" style={{ borderColor: "var(--border)" }}>
                      <p className="text-[9px]" style={{ color: "var(--dim)" }}>{t("portfolio.summary.footer")}</p>
                    </div>

                  </div>
                );
              })()}

              {/* Advanced table view */}
              {effectiveViewMode === "advanced" && sortedPositions.length > 0 && (
                <div className="mb-4">
                  <AdvancedStockTable
                    mode="portfolio"
                    userLevel={userLevel}
                    fxRate={fxRate}
                    onRowClick={setSelectedStock}
                    onEdit={(ticker) => setLotsTicker(ticker)}
                    onRemove={(ticker) => setLotsTicker(ticker)}
                    rows={sortedPositions.map((pos): AdvancedRow => {
                      const pd = prices[pos.ticker];
                      const cp = pd?.price ? pd.price * fxRate : null;
                      const currentVal = cp ? pos.totalShares * cp : null;
                      const investedVal = pos.avgPrice > 0 ? pos.totalShares * pos.avgPrice * fxRate : null;
                      const { pct: gainLossPct } = getPeriodGainLoss(pos.ticker, currentVal, investedVal);
                      return {
                        ticker: pos.ticker,
                        name: pd?.name ?? pos.ticker,
                        price: cp,
                        changePct: null,
                        currency: portfolioCurrency,
                        shares: pos.totalShares,
                        avgCost: pos.avgPrice * fxRate,
                        positionValue: currentVal,
                        gainLossPct,
                      };
                    })}
                  />
                </div>
              )}

              {/* Sort chips */}
              {effectiveViewMode === "basic" && (
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
              {effectiveViewMode === "basic" && sortedPositions.map((pos) => {
                const pd = prices[pos.ticker];
                const cpUSD = pd?.price;
                // Convert USD market price → user's currency
                const cp = cpUSD ? cpUSD * fxRate : null;
                const hasCost = pos.avgPrice > 0;
                const currentVal = cp ? pos.totalShares * cp : null;
                const investedVal = hasCost ? pos.totalShares * pos.avgPrice * fxRate : null;
                const { pct, diff } = getPeriodGainLoss(pos.ticker, currentVal, investedVal);
                const isUp = diff !== null && diff >= 0;
                const priceRevealed = revealedPrices.has(pos.ticker);
                return (
                  <div key={pos.ticker} className="rounded-xl mb-1.5 overflow-hidden cursor-pointer"
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
                          onClick={() => setLotsTicker(pos.ticker)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-l)]"
                          style={{ borderColor: "var(--border)", color: "var(--sub)", background: "var(--raised)" }}>
                          <Pencil className="w-3 h-3" />
                          {pos.lots.length > 1 ? `${pos.lots.length} compras` : "Editar"}
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
                        <p className="text-[11px] font-bold" style={{ color:"var(--sub)" }}>{pos.totalShares.toLocaleString("en-US")}</p>
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
                        next.has(pos.ticker) ? next.delete(pos.ticker) : next.add(pos.ticker);
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
                            {sectorLabels[sector] ?? sector} {pct}%
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
                              {t("portfolio.riskDiagnosis.positionsInSector", { sector: sectorLabels[selectedSector] ?? selectedSector })}
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
                    <h3 className="text-sm font-extrabold" style={{ color:"var(--text)" }}>{t("portfolio.stressTest.title")}</h3>
                    {!isPremium && <span className="text-xs px-1.5 py-0.5 rounded-md font-bold" style={{ background:"rgba(245,158,11,0.15)", color:"#f59e0b" }}>Premium</span>}
                  </div>
                  <p className="text-xs" style={{ color:"var(--muted)" }}>{t("portfolio.stressTest.subtitle")}</p>
                </div>
              </div>
              {/* Mode toggle: hypothetical crisis scenarios vs. real year-by-year backtest */}
              <div className="flex gap-1.5 mb-3">
                {([
                  { id:"scenarios" as const, label: t("portfolio.stressTest.modeScenarios") },
                  { id:"real" as const,      label: t("portfolio.stressTest.modeReal") },
                ]).map((m) => (
                  <button key={m.id}
                          onClick={() => {
                            setStressMode(m.id);
                            if (m.id === "real" && isPremium && !backtestResult && !backtestLoading) runHistoricalBacktest();
                          }}
                          className="px-3 py-1.5 rounded-full text-xs font-bold border transition-all"
                          style={{
                            borderColor: stressMode===m.id ? "var(--accent)" : "var(--border)",
                            background: stressMode===m.id ? "var(--accent)" : "transparent",
                            color: stressMode===m.id ? "#000" : "var(--muted)",
                          }}>
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Scenarios — always visible, blurred for free */}
              <div className="relative">
                <div className={!isPremium ? "pointer-events-none select-none" : ""} style={!isPremium ? { filter:"blur(3px)", opacity:0.6 } : {}}>
                {stressMode === "real" ? (
                  <>
                    {backtestLoading && (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-5 h-5 animate-spin" style={{ color:"var(--accent)" }} />
                      </div>
                    )}
                    {backtestError && (
                      <p className="text-xs text-center py-4" style={{ color:"#ef4444" }}>{backtestError}</p>
                    )}
                    {!backtestLoading && backtestResult && backtestResult.length > 0 && (
                      <div className="rounded-2xl border p-4" style={{ borderColor:"var(--border)", background:"var(--card)" }}>
                        <p className="text-xs mb-3" style={{ color:"var(--muted)" }}>
                          {t("portfolio.stressTest.realDescription")}
                        </p>
                        <div className="space-y-0.5 max-h-96 overflow-y-auto">
                          {backtestResult.map((row) => (
                            <div key={row.year} className="flex items-center justify-between py-2 border-t" style={{ borderColor:"var(--border)" }}>
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-bold" style={{ color:"var(--text)" }}>{row.year}</p>
                                {row.substituted && (
                                  <span title={t("portfolio.stressTest.substitutedTooltip") ?? undefined}>
                                    <AlertTriangle className="w-3 h-3" style={{ color:"#f59e0b" }} />
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="text-right">
                                  <p className="text-[10px]" style={{ color:"var(--dim)" }}>{t("portfolio.stressTest.yourPortfolio")}</p>
                                  <p className="text-sm font-extrabold" style={{ color:row.portfolio_return_pct>=0?"#22c55e":"#ef4444" }}>
                                    {row.portfolio_return_pct>=0?"+":""}{row.portfolio_return_pct.toFixed(1)}%
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="text-[10px]" style={{ color:"var(--dim)" }}>S&P 500</p>
                                  <p className="text-sm font-semibold" style={{ color:row.sp500_return_pct>=0?"#22c55e":"#ef4444" }}>
                                    {row.sp500_return_pct>=0?"+":""}{row.sp500_return_pct.toFixed(1)}%
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-1.5 mt-3 px-3 py-2 rounded-lg"
                             style={{ background:"rgba(234,179,8,0.08)", border:"1px solid rgba(234,179,8,0.25)" }}>
                          <AlertTriangle className="w-3 h-3 text-yellow-600 shrink-0" />
                          <p className="text-[11px] text-yellow-600">
                            {t("portfolio.stressTest.substitutedDisclaimer")}
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                <>
                  {/* Era filter chips */}
                  {(() => {
                    const ERAS: { id: string; label: string }[] = [
                      { id:"all",         label: t("portfolio.stressTest.eras.all") },
                      { id:"pre1950",     label: t("portfolio.stressTest.eras.pre1950") },
                      { id:"mid_century", label: t("portfolio.stressTest.eras.midCentury") },
                      { id:"late_xx",     label: t("portfolio.stressTest.eras.lateXx") },
                      { id:"2000s",       label: t("portfolio.stressTest.eras.y2000s") },
                      { id:"recent",      label: t("portfolio.stressTest.eras.recent") },
                      { id:"hypothetical",label: t("portfolio.stressTest.eras.hypothetical") },
                    ];
                    return (
                      <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-none mb-2 fade-scroll-x">
                        {ERAS.map((era) => (
                          <button key={era.id}
                                  onClick={() => { setStressEra(era.id); setStressScenario(null); }}
                                  className="px-2.5 py-1 rounded-full text-[10px] font-bold shrink-0 border transition-all"
                                  style={{
                                    borderColor: stressEra===era.id ? "var(--accent)" : "var(--border)",
                                    background: stressEra===era.id ? "var(--accent)" : "transparent",
                                    color: stressEra===era.id ? "#000" : "var(--muted)",
                                  }}>
                            {era.label}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                  <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none fade-scroll-x">
                    {STRESS_SCENARIOS.filter((sc) => stressEra==="all" || sc.era===stressEra).map((sc) => (
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
                      <p className="text-sm font-bold mb-3" style={{ color:"var(--text)" }}>{t("portfolio.stressTest.fakeCrisisTitle")}</p>
                      <div className="rounded-xl p-3 mb-3" style={{ background:"rgba(239,68,68,0.08)" }}>
                        <p className="text-xs mb-1" style={{ color:"var(--muted)" }}>{t("portfolio.stressTest.totalImpact")}</p>
                        <p className="text-2xl font-black" style={{ color:"#ef4444" }}>-$XX,XXX (-XX.X%)</p>
                        <p className="text-xs mt-1" style={{ color:"var(--dim)" }}>$XX,XXX → $XX,XXX</p>
                      </div>
                      {["AAPL","MSFT","GOOGL"].map((t) => (
                        <div key={t} className="flex items-center justify-between py-2.5 border-t" style={{ borderColor:"var(--border)" }}>
                          <div>
                            <p className="text-sm font-extrabold" style={{ color:"var(--text)" }}>{t}</p>
                            <p className="text-xs" style={{ color:"var(--dim)" }}>{sectorLabels["Tecnología"]}</p>
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
                          <p className="text-xs mb-1" style={{ color:"var(--muted)" }}>{t("portfolio.stressTest.totalImpact")}</p>
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
                              <p className="text-xs" style={{ color:"var(--dim)" }}>{sectorLabels[row.sector] ?? row.sector}</p>
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
                          <p className="text-[11px] text-yellow-600">{t("portfolio.stressTest.disclaimer")}</p>
                        </div>
                      </div>
                    );
                  })()}
                </>
                )}
                </div>
                {/* Paywall overlay for free users */}
                {!isPremium && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl"
                       style={{ background:"rgba(0,0,0,0.45)", backdropFilter:"blur(2px)" }}>
                    <span className="text-3xl">🛡️</span>
                    <p className="text-sm font-extrabold text-white text-center px-4">{t("portfolio.stressTest.unlockTitle")}</p>
                    <p className="text-xs text-white/70 text-center px-6">{t("portfolio.stressTest.unlockSubtitle")}</p>
                    <button onClick={() => setPaywallOpen(true)}
                            className="px-5 py-2 rounded-2xl text-sm font-black text-black"
                            style={{ background:"#f59e0b" }}>
                      {t("portfolio.stressTest.goToPremium")}
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
                  <h3 className="text-sm font-extrabold" style={{ color:"var(--text)" }}>{t("portfolio.analyze.title")}</h3>
                  {!isPremium && <span className="text-xs px-1.5 py-0.5 rounded-md font-bold" style={{ background:"rgba(245,158,11,0.15)", color:"#f59e0b" }}>Premium</span>}
                </div>
                <p className="text-xs" style={{ color:"var(--muted)" }}>
                  {t("portfolio.analyze.subtitle", { count: positions.length })}
                </p>
              </div>
            </div>

            {/* Analyze button */}
            {!isPremium ? (
              <button onClick={() => setPaywallOpen(true)}
                      className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-bold text-sm transition-opacity"
                      style={{ background:"rgba(245,158,11,0.12)", border:"1px solid rgba(245,158,11,0.35)", color:"#f59e0b" }}>
                {t("portfolio.analyze.unlock")}
              </button>
            ) : positions.length > 0 ? (
              <button onClick={runPortfolioAnalysis} disabled={analysisLoading}
                      className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-white font-bold text-sm disabled:opacity-40 transition-opacity"
                      style={{ background:"var(--accent)" }}>
                {analysisLoading
                  ? <><RefreshCw className="w-4 h-4 animate-spin" /> {t("portfolio.analyze.analyzing")}</>
                  : <><Sparkles className="w-4 h-4" /> {t("portfolio.analyze.analyzeButton")}</>}
              </button>
            ) : (
              <div className="text-center py-6 rounded-2xl border" style={{ borderColor:"var(--border)", background:"var(--card)" }}>
                <p className="text-xs" style={{ color:"var(--muted)" }}>{t("portfolio.analyze.emptyState")}</p>
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
                <h3 className="text-sm font-extrabold" style={{ color:"var(--text)" }}>{t("portfolio.calculator.title")}</h3>
                <p className="text-xs" style={{ color:"var(--muted)" }}>{t("portfolio.calculator.subtitle")}</p>
              </div>
            </div>
            <div className="rounded-2xl border p-4" style={{ borderColor:"var(--border)", background:"var(--card)" }}>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color:"var(--muted)" }}>{t("portfolio.calculator.initialCapital")}</label>
                  <div className="flex items-center rounded-xl border overflow-hidden"
                       style={{ background:"var(--bg)", borderColor:"var(--border)" }}>
                    <span className="px-2 text-sm font-bold" style={{ color:"var(--muted)" }}>$</span>
                    <input value={formatWithCommas(calcCapital)}
                           onChange={(e) => { const raw = e.target.value.replace(/,/g, ""); if (raw === "" || /^\d*\.?\d*$/.test(raw)) setCalcCapital(raw); }}
                           type="text" inputMode="decimal"
                           className="flex-1 bg-transparent py-2.5 text-sm outline-none pr-2"
                           style={{ color:"var(--text)" }} placeholder="10,000" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color:"var(--muted)" }}>{t("portfolio.calculator.monthlyContribution")}</label>
                  <div className="flex items-center rounded-xl border overflow-hidden"
                       style={{ background:"var(--bg)", borderColor:"var(--border)" }}>
                    <span className="px-2 text-sm font-bold" style={{ color:"var(--muted)" }}>$</span>
                    <input value={formatWithCommas(calcMonthly)}
                           onChange={(e) => { const raw = e.target.value.replace(/,/g, ""); if (raw === "" || /^\d*\.?\d*$/.test(raw)) setCalcMonthly(raw); }}
                           type="text" inputMode="decimal"
                           className="flex-1 bg-transparent py-2.5 text-sm outline-none pr-2"
                           style={{ color:"var(--text)" }} placeholder="500" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color:"var(--muted)" }}>{t("portfolio.calculator.annualReturn")}</label>
                  <input value={calcReturn} onChange={(e) => setCalcReturn(e.target.value)} type="number" min="0"
                         className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                         style={{ background:"var(--bg)", borderColor:"var(--border)", color:"var(--text)" }}
                         placeholder="10" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color:"var(--muted)" }}>{t("portfolio.calculator.termYears")}</label>
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
                {t("portfolio.calculator.calculate")}
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
                      {t("portfolio.calculator.finalValueIn", { years: calcYears, unit: parseInt(calcYears)===1 ? t("portfolio.calculator.oneYear") : t("portfolio.calculator.multipleYears") })}
                    </p>
                    <p className="text-4xl font-black mb-3" style={{ color:"#6366f1" }}>{fmtMoney(calcResult.final)}</p>
                    <div className="flex justify-center gap-2">
                      <span className="text-xs font-bold px-3 py-1.5 rounded-full" style={{ background:"rgba(34,197,94,0.15)", color:"#22c55e" }}>
                        {t("portfolio.calculator.timesYourMoney", { multiplier: calcResult.multiplier.toFixed(1) })}
                      </span>
                      <span className="text-xs font-bold px-3 py-1.5 rounded-full" style={{ background:"rgba(99,102,241,0.15)", color:"#a78bfa" }}>
                        {t("portfolio.calculator.returnPct", { pct: calcResult.pct.toFixed(0) })}
                      </span>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 border-t border-b" style={{ borderColor:"var(--border)" }}>
                    {[
                      { label: t("portfolio.calculator.invested"),  val:fmtMoney(calcResult.invested), color:"var(--sub)" },
                      { label: t("portfolio.calculator.gains"),     val:`+${fmtMoney(calcResult.gain)}`, color:"#22c55e" },
                      { label: t("portfolio.calculator.realValue"), val:fmtMoney(calcResult.realFinal),  color:"#f59e0b" },
                    ].map((st, i) => (
                      <div key={st.label} className={`text-center py-3 ${i>0?"border-l":""}`} style={{ borderColor:"var(--border)" }}>
                        <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color:"var(--muted)" }}>{st.label}</p>
                        <p className="text-xs font-extrabold" style={{ color:st.color }}>{st.val}</p>
                      </div>
                    ))}
                  </div>

                  {/* Bar chart */}
                  <div className="p-4">
                    <p className="text-[9px] font-bold uppercase tracking-wider mb-4" style={{ color:"var(--muted)" }}>{t("portfolio.calculator.investedVsReturn")}</p>
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
                      {[{color:"#6366f1",label:t("portfolio.calculator.invested")},{color:"#22c55e",label:t("portfolio.calculator.return")}].map(l=>(
                        <div key={l.label} className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full" style={{ background:l.color }} />
                          <span className="text-[9px] font-semibold" style={{ color:"var(--muted)" }}>{l.label}</span>
                        </div>
                      ))}
                      <span className="text-[9px]" style={{ color:"var(--dim)" }}>{t("portfolio.calculator.opaqueProjection")}</span>
                    </div>
                  </div>

                  {/* Disclaimer */}
                  <div className="mx-4 mb-4 flex items-start gap-1.5 px-3 py-2 rounded-lg"
                       style={{ background:"rgba(99,102,241,0.07)", border:"1px solid rgba(99,102,241,0.2)" }}>
                    <BarChart className="w-3 h-3 shrink-0 mt-0.5" style={{ color:"#a78bfa" }} />
                    <p className="text-[10px] leading-relaxed" style={{ color:"#a78bfa" }}>
                      {t("portfolio.calculator.disclaimer")}
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
                {t("portfolio.toolsTab.subtitle")}
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

              {/* Nuvos Deep Research — available to every tier, just cheaper for
                  Premium, so this isn't gated behind PremiumToolLocked's paywall. */}
              <button onClick={() => router.push("/research")}
                      className="w-full text-left rounded-3xl overflow-hidden transition-transform hover:scale-[1.01] active:scale-[0.99]"
                      style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <div className="flex items-center gap-4 p-5">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
                       style={{ background: "linear-gradient(135deg,#8b5cf6,#6366f1)" }}>
                    <Microscope className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-black" style={{ color: "var(--text)" }}>{t("research.tools.title")}</p>
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa" }}>
                        ${isPremium ? "9.99" : "19.99"}
                      </span>
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{t("research.tools.description")}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />
                </div>
              </button>

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

      {/* Purchase history — one combined row per ticker in the table, this
          panel lists every purchase lot behind it individually. */}
      {lotsTicker && (() => {
        const lots = [...positions]
          .filter((p) => p.ticker === lotsTicker)
          .sort((a, b) => (a.purchaseDate ?? "").localeCompare(b.purchaseDate ?? ""));
        const closeLotsPanel = () => {
          setLotsTicker(null);
          setAddingLot(false);
          setLotForm({ amount: "", avgPrice: "", purchaseDate: new Date().toISOString().split("T")[0] });
        };
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
               style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
               onClick={closeLotsPanel}>
            <div className="w-full max-w-sm rounded-2xl border overflow-hidden"
                 style={{ background: "var(--card)", borderColor: "var(--border)" }}
                 onClick={(e) => e.stopPropagation()}>
              <div className="h-1" style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }} />
              <div className="p-5">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-bold text-sm" style={{ color:"var(--text)" }}>Tus compras de {lotsTicker}</p>
                  <button onClick={closeLotsPanel} style={{ color:"var(--muted)" }}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-[11px] mb-4" style={{ color:"var(--muted)" }}>
                  Cada compra queda guardada por separado con su propia fecha.
                </p>
                <div className="space-y-2 mb-4">
                  {lots.map((lot) => {
                    const displayPrice = portfolioCurrency === "USD" ? lot.avgPrice : lot.avgPrice * fxRate;
                    return (
                      <div key={lot.id} className="flex items-center gap-2 rounded-xl border px-3 py-2.5"
                           style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold" style={{ color:"var(--text)" }}>
                            {lot.purchaseDate ? new Date(lot.purchaseDate + "T12:00:00").toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }) : "Sin fecha"}
                          </p>
                          <p className="text-[11px]" style={{ color:"var(--muted)" }}>
                            {lot.shares.toLocaleString("en-US")} acciones · {currencySymbol}{displayPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} c/u
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            setEditConfirm(false); setEditSaleChoice(null); setEditSalePrice("");
                            setEditingPos({ id: lot.id, ticker: lot.ticker, originalShares: lot.shares, shares: String(lot.shares), avgPrice: String(portfolioCurrency === "USD" ? lot.avgPrice : parseFloat((lot.avgPrice * fxRate).toFixed(4))), purchaseDate: lot.purchaseDate ?? new Date().toISOString().split("T")[0] });
                            setLotsTicker(null);
                          }}
                          className="p-1.5 rounded-lg border shrink-0 transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-l)]"
                          style={{ borderColor: "var(--border)", color: "var(--sub)" }}>
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setSellPrice("");
                            setSellConfirm({ id: lot.id, ticker: lot.ticker, shares: lot.shares });
                            setLotsTicker(null);
                          }}
                          className="p-1.5 rounded-lg border shrink-0 transition-colors hover:border-red-500/40 hover:text-red-400"
                          style={{ borderColor: "var(--border)", color: "var(--dim)" }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                {addingLot ? (
                  <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] font-bold uppercase tracking-wider block mb-1" style={{ color: "var(--muted)" }}>¿Cuánto invertiste?</label>
                        <input value={lotForm.amount} onChange={(e) => setLotForm({ ...lotForm, amount: e.target.value })}
                               type="number" min="0" autoFocus
                               className="w-full rounded-xl border px-3 py-2 text-sm outline-none"
                               style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--text)" }}
                               placeholder="500" />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold uppercase tracking-wider block mb-1" style={{ color: "var(--muted)" }}>Precio/acción ({portfolioCurrency})</label>
                        <input value={lotForm.avgPrice} onChange={(e) => setLotForm({ ...lotForm, avgPrice: e.target.value })}
                               type="number" min="0"
                               className="w-full rounded-xl border px-3 py-2 text-sm outline-none"
                               style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--text)" }}
                               placeholder="150.00" />
                      </div>
                    </div>
                    {parseFloat(lotForm.amount) > 0 && parseFloat(lotForm.avgPrice) > 0 && (() => {
                      const calcShares = parseFloat(lotForm.amount) / parseFloat(lotForm.avgPrice);
                      const isWhole = Math.abs(calcShares - Math.round(calcShares)) < 0.0005;
                      return (
                        <p className="text-[11px] px-0.5" style={{ color: "var(--accent-l)" }}>
                          ≈ <span className="font-bold">{calcShares.toLocaleString("en-US", { maximumFractionDigits: 6 })}</span> acciones
                          {" "}({isWhole ? "completas" : "fraccionadas"})
                        </p>
                      );
                    })()}
                    <div>
                      <label className="text-[9px] font-bold uppercase tracking-wider block mb-1" style={{ color: "var(--muted)" }}>Fecha de compra</label>
                      <input value={lotForm.purchaseDate} onChange={(e) => setLotForm({ ...lotForm, purchaseDate: e.target.value })}
                             type="date" max={new Date().toISOString().split("T")[0]}
                             className="w-full rounded-xl border px-3 py-2 text-sm outline-none"
                             style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--text)" }} />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => { setAddingLot(false); setLotForm({ amount: "", avgPrice: "", purchaseDate: new Date().toISOString().split("T")[0] }); }}
                              className="flex-1 py-2 rounded-lg text-xs font-semibold border"
                              style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                        Cancelar
                      </button>
                      <button onClick={() => handleAddLot(lotsTicker)} disabled={lotAddLoading}
                              className="flex-[2] py-2 rounded-lg text-xs font-bold text-white disabled:opacity-40 flex items-center justify-center gap-1.5"
                              style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
                        {lotAddLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        Guardar compra
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingLot(true)}
                    className="w-full py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2"
                    style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
                    <Plus className="w-4 h-4" />
                    Agregar otra compra
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

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
                <button onClick={() => { setEditingPos(null); setEditConfirm(false); setEditSaleChoice(null); setEditSalePrice(""); }} style={{ color:"var(--muted)" }}>
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
                  <label className="text-[10px] font-bold uppercase block mb-1" style={{ color:"var(--muted)" }}>
                    Precio promedio de compra ({portfolioCurrency})
                  </label>
                  <input
                    type="number" min="0" step="any"
                    value={editingPos.avgPrice}
                    onChange={(e) => setEditingPos((p) => p ? { ...p, avgPrice: e.target.value } : p)}
                    className="w-full rounded-xl border px-3 py-2 text-sm"
                    style={{ background:"var(--raised)", borderColor:"var(--border)", color:"var(--text)" }}
                  />
                  {portfolioCurrency !== "USD" && editingPos.avgPrice && !isNaN(parseFloat(editingPos.avgPrice)) && (
                    <p className="text-[10px] mt-1" style={{ color:"var(--dim)" }}>
                      ≈ ${(parseFloat(editingPos.avgPrice) / fxRate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                    </p>
                  )}
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
                {editSaleChoice === "ask" ? (
                  <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                    <p className="text-xs font-bold text-center" style={{ color: "var(--text)" }}>
                      Bajaste de {editingPos.originalShares} a {editingPos.shares} acciones
                    </p>
                    <p className="text-[10px] text-center" style={{ color: "var(--muted)" }}>
                      ¿Vendiste {(editingPos.originalShares - parseFloat(editingPos.shares || "0")).toLocaleString()} acciones o es una corrección de captura?
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => { setEditSaleChoice("correction"); setEditConfirm(true); }}
                              className="flex-1 py-2 rounded-lg text-xs font-semibold border"
                              style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                        Es corrección
                      </button>
                      <button
                        onClick={() => {
                          const marketUSD = prices[editingPos.ticker]?.price;
                          const prefill = marketUSD ? (portfolioCurrency === "USD" ? marketUSD : marketUSD * fxRate) : 0;
                          setEditSalePrice(prefill > 0 ? prefill.toFixed(2) : "");
                          setEditSaleChoice("sale");
                        }}
                        className="flex-1 py-2 rounded-lg text-xs font-bold text-white"
                        style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
                        Vendí acciones
                      </button>
                    </div>
                  </div>
                ) : editSaleChoice === "sale" && !editConfirm ? (
                  <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                    <label className="text-[10px] font-bold uppercase block" style={{ color:"var(--muted)" }}>
                      Precio de venta ({portfolioCurrency})
                    </label>
                    <input
                      type="number" min="0" step="any"
                      value={editSalePrice}
                      onChange={(e) => setEditSalePrice(e.target.value)}
                      className="w-full rounded-xl border px-3 py-2 text-sm"
                      style={{ background:"var(--card)", borderColor:"var(--border)", color:"var(--text)" }}
                    />
                    <div className="flex gap-2">
                      <button onClick={() => setEditSaleChoice("ask")}
                              className="flex-1 py-2 rounded-lg text-xs font-semibold border"
                              style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                        Atrás
                      </button>
                      <button
                        disabled={!editSalePrice || isNaN(parseFloat(editSalePrice))}
                        onClick={() => setEditConfirm(true)}
                        className="flex-1 py-2 rounded-lg text-xs font-bold text-white"
                        style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)", opacity: (!editSalePrice || isNaN(parseFloat(editSalePrice))) ? 0.5 : 1 }}>
                        Continuar
                      </button>
                    </div>
                  </div>
                ) : !editConfirm ? (
                  <button
                    onClick={() => {
                      const shares = parseFloat(editingPos.shares);
                      if (isNaN(shares) || shares <= 0) return;
                      if (shares < editingPos.originalShares && editSaleChoice === null) { setEditSaleChoice("ask"); return; }
                      setEditConfirm(true);
                    }}
                    className="w-full py-2.5 rounded-xl text-sm font-bold text-white"
                    style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
                    Guardar cambios
                  </button>
                ) : (
                  <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                    <p className="text-xs font-bold text-center" style={{ color: "var(--text)" }}>¿Confirmar cambios?</p>
                    <p className="text-[10px] text-center" style={{ color: "var(--muted)" }}>
                      {editingPos.shares} acciones · precio promedio {currencySymbol}{editingPos.avgPrice}
                      {editSaleChoice === "sale" && ` · vendiste ${(editingPos.originalShares - parseFloat(editingPos.shares || "0")).toLocaleString()} a ${currencySymbol}${editSalePrice}`}
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setEditConfirm(false)}
                              className="flex-1 py-2 rounded-lg text-xs font-semibold border"
                              style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                        Cancelar
                      </button>
                      <button
                        disabled={editSaving}
                        onClick={async () => {
                          const shares = parseFloat(editingPos.shares);
                          const enteredPrice = parseFloat(editingPos.avgPrice);
                          // avgPrice is always stored in USD — convert from user's currency
                          const avgPriceUSD = isNaN(enteredPrice) ? 0
                            : portfolioCurrency === "USD" ? enteredPrice
                            : enteredPrice / fxRate;
                          setEditSaving(true);
                          setEditSaveError(false);
                          try {
                            let saleInfo: { soldShares: number; closePrice: number } | undefined;
                            if (editSaleChoice === "sale") {
                              const enteredSalePrice = parseFloat(editSalePrice);
                              const closePriceUSD = portfolioCurrency === "USD" ? enteredSalePrice : enteredSalePrice / fxRate;
                              saleInfo = { soldShares: editingPos.originalShares - shares, closePrice: closePriceUSD };
                            }
                            await updatePosition(editingPos.id, {
                              shares,
                              avgPrice: parseFloat(avgPriceUSD.toFixed(6)),
                              purchaseDate: editingPos.purchaseDate,
                            }, saleInfo);
                            setEditingPos(null);
                            setEditConfirm(false);
                            setEditSaleChoice(null);
                            setEditSalePrice("");
                           
                          } catch {
                            setEditSaveError(true);
                          } finally {
                            setEditSaving(false);
                          }
                        }}
                        className="flex-[2] py-2 rounded-lg text-xs font-bold text-white"
                        style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)", opacity: editSaving ? 0.7 : 1 }}>
                        {editSaving ? "Guardando..." : "Guardar"}
                      </button>
                    </div>
                    {editSaveError && (
                      <p className="text-[10px] text-center mt-2" style={{ color: "#f87171" }}>
                        Error al guardar. Verifica tu conexión y vuelve a intentar.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sell confirmation modal — required to record realized gain/loss accurately */}
      {sellConfirm && (() => {
        const marketUSD = prices[sellConfirm.ticker]?.price;
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-xs rounded-2xl border overflow-hidden"
               style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="h-1" style={{ background: "linear-gradient(90deg,#ef4444,#f97316)" }} />
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="font-bold text-sm" style={{ color:"var(--text)" }}>Vender {sellConfirm.ticker}</p>
                <button onClick={() => setSellConfirm(null)} style={{ color:"var(--muted)" }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  Vas a eliminar tus {sellConfirm.shares.toLocaleString()} acciones de {sellConfirm.ticker}. ¿A qué precio las vendiste?
                </p>
                <div>
                  <label className="text-[10px] font-bold uppercase block mb-1" style={{ color:"var(--muted)" }}>
                    Precio de venta ({portfolioCurrency})
                  </label>
                  <input
                    type="number" min="0" step="any" autoFocus
                    value={sellPrice}
                    onChange={(e) => setSellPrice(e.target.value)}
                    placeholder={marketUSD ? (portfolioCurrency === "USD" ? marketUSD : marketUSD * fxRate).toFixed(2) : undefined}
                    className="w-full rounded-xl border px-3 py-2 text-sm"
                    style={{ background:"var(--raised)", borderColor:"var(--border)", color:"var(--text)" }}
                  />
                  {marketUSD != null && (
                    <button
                      onClick={() => setSellPrice(((portfolioCurrency === "USD" ? marketUSD : marketUSD * fxRate)).toFixed(2))}
                      className="text-[10px] mt-1 underline" style={{ color: "var(--accent-l)" }}>
                      Usar precio actual de mercado ({currencySymbol}{(portfolioCurrency === "USD" ? marketUSD : marketUSD * fxRate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setSellConfirm(null)}
                          className="flex-1 py-2 rounded-lg text-xs font-semibold border"
                          style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                    Cancelar
                  </button>
                  <button
                    disabled={sellSaving || !sellPrice || isNaN(parseFloat(sellPrice)) || parseFloat(sellPrice) < 0}
                    onClick={async () => {
                      const enteredPrice = parseFloat(sellPrice);
                      const closePriceUSD = portfolioCurrency === "USD" ? enteredPrice : enteredPrice / fxRate;
                      setSellSaving(true);
                      try {
                        await removePosition(sellConfirm.id, parseFloat(closePriceUSD.toFixed(6)));
                        setSellConfirm(null);
                      } finally {
                        setSellSaving(false);
                      }
                    }}
                    className="flex-[2] py-2 rounded-lg text-xs font-bold text-white"
                    style={{ background: "linear-gradient(90deg,#ef4444,#f97316)", opacity: sellSaving ? 0.7 : 1 }}>
                    {sellSaving ? "Guardando..." : "Confirmar venta"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

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
