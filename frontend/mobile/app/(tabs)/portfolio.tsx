import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useFocusEffect } from "expo-router";
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, ActivityIndicator, SafeAreaView, Alert,
  RefreshControl, Image, Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path, Defs, RadialGradient as SvgRadial, Stop, Rect as SvgRect, G } from "react-native-svg";
import * as ImagePicker from "expo-image-picker";

import { marketApi } from "../../src/lib/api";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { usePortfolioStore, Position } from "../../src/lib/portfolioStore";
import MobileEarningsPanel from "../../src/components/MobileEarningsPanel";
import MobileWhatIf from "../../src/components/MobileWhatIf";
import MobileMonthlyReport from "../../src/components/MobileMonthlyReport";
import MobileWeeklyScreener from "../../src/components/MobileWeeklyScreener";
import MobileDecisionDiary from "../../src/components/MobileDecisionDiary";
import PremiumToolCard from "../../src/components/PremiumToolCard";
import { useAppStore, getAge, UserProfile, RISK_CONFIG } from "../../src/lib/profileStore";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import PaywallModal from "../../src/components/PaywallModal";

const FREE_POSITION_LIMIT = 10;

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];
type Scenario = "conservative" | "moderate" | "aggressive";

// ─── Stress test data ──────────────────────────────────────────────────────

const TICKER_SECTOR: Record<string, string> = {
  // Tech — megacap & software
  AAPL: "Tech", MSFT: "Tech", GOOGL: "Tech", GOOG: "Tech", AMZN: "Tech", META: "Tech",
  NVDA: "Tech", TSLA: "Tech", AMD: "Tech", INTC: "Tech", CRM: "Tech", ADBE: "Tech",
  PYPL: "Tech", NFLX: "Tech", UBER: "Tech", SNAP: "Tech", SPOT: "Tech", ORCL: "Tech",
  // Tech — semiconductores
  MU: "Tech", QCOM: "Tech", TXN: "Tech", AVGO: "Tech", AMAT: "Tech", LRCX: "Tech",
  KLAC: "Tech", ASML: "Tech", ON: "Tech", MRVL: "Tech", ARM: "Tech", TSM: "Tech",
  SMCI: "Tech", MPWR: "Tech", ENTG: "Tech", WOLF: "Tech",
  // Tech — hardware & infra
  CSCO: "Tech", IBM: "Tech", HPQ: "Tech", DELL: "Tech", HPE: "Tech",
  // Tech — cloud & software
  NOW: "Tech", WDAY: "Tech", PANW: "Tech", CRWD: "Tech", ZS: "Tech", NET: "Tech",
  OKTA: "Tech", FTNT: "Tech", DDOG: "Tech", SNOW: "Tech", MDB: "Tech",
  PLTR: "Tech", RBLX: "Tech", U: "Tech", HOOD: "Tech", SOFI: "Tech",
  SHOP: "Tech", SQ: "Tech", MSTR: "Tech", COIN: "Tech",
  // Finance
  JPM: "Finance", BAC: "Finance", GS: "Finance", MS: "Finance", WFC: "Finance",
  C: "Finance", V: "Finance", MA: "Finance", AXP: "Finance",
  BRK: "Finance", BRKB: "Finance", BX: "Finance", KKR: "Finance", SCHW: "Finance",
  // Salud
  JNJ: "Salud", PFE: "Salud", UNH: "Salud", ABBV: "Salud", MRK: "Salud",
  LLY: "Salud", AMGN: "Salud", MDT: "Salud", BSX: "Salud", ABT: "Salud",
  ISRG: "Salud", REGN: "Salud", BIIB: "Salud", GILD: "Salud", CVS: "Salud",
  // Consumo
  WMT: "Consumo", KO: "Consumo", PG: "Consumo", MCD: "Consumo", NKE: "Consumo",
  SBUX: "Consumo", COST: "Consumo", TGT: "Consumo", HD: "Consumo",
  DIS: "Consumo", CMCSA: "Consumo", WBD: "Consumo", PARA: "Consumo",
  T: "Consumo", VZ: "Consumo", TMUS: "Consumo",
  // Energía
  XOM: "Energía", CVX: "Energía", COP: "Energía", OXY: "Energía", SLB: "Energía",
  // Industrial
  BA: "Industrial", GE: "Industrial", CAT: "Industrial", DE: "Industrial",
  HON: "Industrial", RTX: "Industrial", MMM: "Industrial", LMT: "Industrial",
  // Real Estate
  AMT: "Real Estate", EQIX: "Real Estate", PLD: "Real Estate", SPG: "Real Estate",
  // ETF
  SPY: "ETF", QQQ: "ETF", VTI: "ETF", IVV: "ETF", VOO: "ETF", IWM: "ETF",
  GLD: "ETF", SLV: "ETF", TLT: "ETF", HYG: "ETF", XLK: "ETF", XLF: "ETF",
};

// ─── Portfolio risk classification ────────────────────────────────────────

const TICKER_RISK_OVERRIDE: Record<string, number> = {
  GME: 96, AMC: 96, MSTR: 92, COIN: 91, RIVN: 88, LCID: 88,
  TSLA: 84, PLTR: 82, SNAP: 82, SPOT: 80, RBLX: 80, HOOD: 82, SOFI: 78,
  NVDA: 77, AMD: 76, SHOP: 74, SQ: 75, META: 70, NFLX: 70, UBER: 72,
  AAPL: 60, MSFT: 58, GOOGL: 60, AMZN: 63, ORCL: 55,
  JPM: 48, BAC: 50, GS: 55, V: 45, MA: 45, AXP: 50,
  JNJ: 28, PFE: 35, UNH: 32, ABBV: 38, LLY: 42, AMGN: 36,
  WMT: 22, KO: 18, PG: 18, MCD: 25, COST: 30, SBUX: 35,
  XOM: 48, CVX: 48, COP: 55, OXY: 58,
  SPY: 20, VOO: 20, VTI: 20, IVV: 20, QQQ: 38, IWM: 45, GLD: 30,
};

const SECTOR_RISK_BASE: Record<string, number> = {
  ETF: 22, Salud: 35, Consumo: 38, Finance: 52, Energía: 58, Tech: 72,
  Industrial: 45, "Real Estate": 40,
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
    desc: "Colapso del sistema financiero global",
    drawdowns: { Tech: -52, Finance: -78, Salud: -18, Consumo: -28, Energía: -55, ETF: -38, Industrial: -42, "Real Estate": -45 },
    default: -42,
  },
  {
    id: "covid", name: "COVID-19", icon: "🦠", color: "#f97316", year: "Feb-Mar 2020",
    desc: "Crash de 33 días, caída brusca y rápida",
    drawdowns: { Tech: -34, Finance: -45, Salud: -15, Consumo: -42, Energía: -60, ETF: -34, Industrial: -35, "Real Estate": -30 },
    default: -34,
  },
  {
    id: "tech2022", name: "Tech Crash '22", icon: "📉", color: "#f59e0b", year: "2022",
    desc: "Alza de tasas aplasta valuaciones tech",
    drawdowns: { Tech: -55, Finance: -22, Salud: -10, Consumo: -15, Energía: 40, ETF: -18, Industrial: -20, "Real Estate": -28 },
    default: -20,
  },
  {
    id: "fed", name: "Fed +1%", icon: "🏛️", color: "#6366f1", year: "Escenario",
    desc: "Subida sorpresiva de 100pb en tasas",
    drawdowns: { Tech: -20, Finance: 5, Salud: -8, Consumo: -10, Energía: -5, ETF: -12, Industrial: -12, "Real Estate": -18 },
    default: -12,
  },
  {
    id: "bull", name: "Bull Market", icon: "🚀", color: "#22c55e", year: "Escenario",
    desc: "Año de recuperación y euforia inversora",
    drawdowns: { Tech: 35, Finance: 25, Salud: 20, Consumo: 18, Energía: 22, ETF: 24, Industrial: 22, "Real Estate": 18 },
    default: 22,
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



// ─── Component ─────────────────────────────────────────────────────────────

export default function PortfolioScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);


  const { positions, addPosition, removePosition, updatePosition, setPositions, mergePositions, portfolioCurrency, setCurrency } = usePortfolioStore();
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

  // Edit position
  const [editingPos, setEditingPos] = useState<{ id: string; shares: string; avgPrice: string; purchaseDate: string } | null>(null);
  const [revealedPrices, setRevealedPrices] = useState<Set<string>>(new Set());

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

  // Manual add form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ticker: "", shares: "", avgPrice: "" });
  const [addingLoading, setAddingLoading] = useState(false);

  // Simulator
  const riskCfg = profile?.risk_tolerance ? RISK_CONFIG[profile.risk_tolerance] : null;
  const [scenario, setScenario] = useState<Scenario>(
    (profile?.risk_tolerance as Scenario) ?? "moderate"
  );
  const [capital, setCapital] = useState("");
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

  // Fetch period returns whenever positions change
  useEffect(() => {
    if (positions.length === 0) return;
    setLoadingReturns(true);
    marketApi.getPortfolioReturns(positions.map((p) => ({ ticker: p.ticker, shares: p.shares, purchase_date: p.purchaseDate ?? null })))
      .then((res: { data: { returns?: Record<string, PeriodReturn> } }) => setPeriodReturns(res.data.returns ?? {}))
      .catch(() => {})
      .finally(() => setLoadingReturns(false));
  }, [positions.length]);

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
        capital ? parseFloat(capital) : undefined,
        positionsPayload,
      );
      const text: string = res.data.analysis;
      // Try to parse structured JSON (no-positions mode)
      if (!positionsPayload) {
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]) as PortfolioResult;
            if (parsed.allocations?.length) { setPortfolioResult(parsed); return; }
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

  // ── Simulator 2: compound interest calculator ──────────────────────────
  const [calcCapital, setCalcCapital] = useState("");
  const [calcMonthly, setCalcMonthly] = useState("");
  const [calcReturn, setCalcReturn]   = useState("");
  const [calcYears, setCalcYears]     = useState("");
  const [calcResult, setCalcResult]   = useState<{
    final: number; invested: number; gain: number; pct: number;
    milestones: { year: number; value: number }[];
  } | null>(null);

  const calculateCompound = () => {
    const pv  = parseFloat(calcCapital)  || 0;
    const pmt = parseFloat(calcMonthly)  || 0;
    const ann = parseFloat(calcReturn)   || 0;
    const yrs = parseFloat(calcYears)    || 0;
    if (!pv || !ann || !yrs) return;

    const r = ann / 100 / 12;
    const n = Math.round(yrs * 12);

    const fvPV  = pv * Math.pow(1 + r, n);
    const fvPMT = pmt > 0 ? pmt * (Math.pow(1 + r, n) - 1) / r : 0;
    const final = fvPV + fvPMT;
    const invested = pv + pmt * n;

    const milestoneYears = Array.from(new Set([1, 2, 3, 5, 10, Math.round(yrs)].filter((y) => y > 0 && y <= yrs))).sort((a, b) => a - b);
    const milestones = milestoneYears.map((y) => {
      const mn = y * 12;
      const val = pv * Math.pow(1 + r, mn) + (pmt > 0 ? pmt * (Math.pow(1 + r, mn) - 1) / r : 0);
      return { year: y, value: val };
    });

    setCalcResult({ final, invested, gain: final - invested, pct: invested > 0 ? ((final - invested) / invested) * 100 : 0, milestones });
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
        <View style={[s.subTabBar, { backgroundColor: colors.bgRaised }]}>
          <TouchableOpacity
            style={[s.subTab, activeSection === "portafolio" && { backgroundColor: colors.card }]}
            onPress={() => setActiveSection("portafolio")}
          >
            <Text style={[s.subTabText, { color: activeSection === "portafolio" ? colors.text : colors.textMuted }]}>
              Mi Portafolio
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.subTab, activeSection === "herramientas" && { backgroundColor: colors.card }]}
            onPress={() => setActiveSection("herramientas")}
          >
            <Text style={[s.subTabText, { color: activeSection === "herramientas" ? colors.accent : colors.textMuted }]}>
              ⭐ Herramientas
            </Text>
          </TouchableOpacity>
        </View>

        {activeSection === "herramientas" && (
          <View style={{ gap: 12, paddingBottom: 32 }}>
            <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 2 }}>
              Herramientas de análisis avanzado para tu portafolio
            </Text>

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

            {/* ── ANÁLISIS DE EARNINGS ── */}
            {isPremiumAccess
              ? <MobileEarningsPanel
                  positions={positions.map((p) => ({ ticker: p.ticker, shares: p.shares, avg_cost: p.avgPrice }))}
                  isPremium={true} onUpgrade={() => setPaywallOpen(true)} />
              : <PremiumToolCard
                  title="Análisis de Earnings"
                  tagline="IA analiza resultados automáticamente"
                  description="Cuando una empresa de tu portafolio reporta resultados, la IA los analiza al instante: EPS vs estimado, revenue, guidance e impacto exacto en tu posición."
                  icon="calendar-outline"
                  color="#22c55e"
                  benefits={[
                    { icon: "📅", text: "Calendario de earnings de tus posiciones" },
                    { icon: "📈", text: "EPS real vs estimado con contexto profundo" },
                    { icon: "💵", text: "Impacto calculado en tu inversión específica" },
                    { icon: "🔔", text: "Análisis automático sin buscar nada tú" },
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

            {/* ── DIARIO DE SESGOS ── */}
            <MobileDecisionDiary isPremium={isPremiumAccess} onUpgrade={() => setPaywallOpen(true)} />
          </View>
        )}

        {activeSection === "portafolio" && (
        <View>
        {/* ── MI PORTAFOLIO ── */}
        <View style={s.sectionHeader}>
          <View>
            <Text style={s.sectionTitle}>Mi Portafolio</Text>
            {!isPremiumAccess && (
              <Text style={{ fontSize: 11, color: positions.length >= FREE_POSITION_LIMIT ? "#ef4444" : colors.textDim, marginTop: -8, marginBottom: 4 }}>
                {positions.length}/{FREE_POSITION_LIMIT} posiciones · <Text style={{ color: "#f59e0b" }} onPress={() => setPaywallOpen(true)}>Premium = ilimitadas</Text>
              </Text>
            )}
          </View>
          <View style={s.headerButtons}>
            <TouchableOpacity style={[s.btnSmall, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]} onPress={() => { setShowForm(!showForm); setScreenshotPreview(null); }}>
              <Text style={[s.btnSmallText, { color: colors.textSub }]}>+ Manual</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── BOTÓN PRINCIPAL: CAPTURA ── */}
        <TouchableOpacity
          style={[s.screenshotBtn, screenshotAnalyzing && s.btnDisabled]}
          onPress={handleScreenshotImport}
          disabled={screenshotAnalyzing}
          activeOpacity={0.8}
        >
          {screenshotAnalyzing ? (
            <View style={s.screenshotBtnInner}>
              <ActivityIndicator color="white" size="small" />
              <Text style={s.screenshotBtnText}>{screenshotProgress || "Analizando con IA..."}</Text>
            </View>
          ) : (
            <View style={s.screenshotBtnInner}>
              <Ionicons name="images-outline" size={28} color="white" />
              <View>
                <Text style={s.screenshotBtnText}>Importar capturas de pantalla</Text>
                <Text style={s.screenshotBtnSub}>Selecciona 1 o más fotos — la IA detecta todo</Text>
              </View>
            </View>
          )}
        </TouchableOpacity>

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
            {/* Period return tabs */}
            <View style={{ marginBottom: 10 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: "row", gap: 6, paddingRight: 8 }}>
                  {PERIODS.map(({ key, label }) => {
                    const ret = periodReturns[key];
                    const isSelected = selectedPeriod === key;
                    const isUp = ret ? ret.pct >= 0 : true;
                    const isSincePurchase = key === "since_purchase";
                    return (
                      <TouchableOpacity
                        key={key}
                        onPress={() => setSelectedPeriod(key)}
                        style={{
                          paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
                          backgroundColor: isSelected ? (isUp ? "#22c55e22" : "#ef444422") : colors.bgRaised,
                          borderWidth: 1,
                          borderColor: isSelected ? (isUp ? "#22c55e66" : "#ef444466") : isSincePurchase ? "rgba(0,168,94,0.3)" : "transparent",
                        }}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: isSelected ? (isUp ? "#22c55e" : "#ef4444") : isSincePurchase ? colors.accentLight : colors.textMuted }}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
              {loadingReturns ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <ActivityIndicator size="small" color={colors.textMuted} />
                  <Text style={{ fontSize: 11, color: colors.textMuted }}>Calculando rendimientos...</Text>
                </View>
              ) : periodReturns[selectedPeriod] ? (() => {
                const r = periodReturns[selectedPeriod]!;
                const up = r.pct >= 0;
                return (
                  <View style={{ backgroundColor: up ? "#22c55e0D" : "#ef44440D", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: colors.textMuted }}>{PERIODS.find(p => p.key === selectedPeriod)?.label}</Text>
                      <Text style={{ fontSize: 18, fontWeight: "900", color: up ? "#22c55e" : "#ef4444" }}>{up ? "+" : ""}{r.pct.toFixed(2)}%</Text>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: up ? "#22c55e" : "#ef4444" }}>{up ? "+" : ""}${Math.abs(r.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                    </View>
                    {r.date && (
                      <Text style={{ fontSize: 10, color: colors.textDim, marginTop: 2 }}>desde {r.date}</Text>
                    )}
                  </View>
                );
              })() : null}
            </View>

            <View style={[s.totalsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {loadingPrices ? (
                <ActivityIndicator color="#22c55e" />
              ) : (
                <>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                    <Text style={[s.totalsLabel, { color: colors.textMuted }]}>Valor actual del portafolio</Text>
                    {portfolioCurrency !== "USD" && (
                      <View style={{ backgroundColor: colors.bgRaised, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 10, fontWeight: "700", color: colors.textMuted }}>{portfolioCurrency}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[s.totalsValue, { color: colors.text }]}>
                    {currencySymbol}{totals.current.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Text>
                  <View style={s.totalsRow}>
                    <Text style={[s.totalsInvested, { color: colors.textMuted }]}>
                      Invertido: {currencySymbol}{totals.invested.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </Text>
                    <Text style={[s.totalsDiff, { color: totals.diff >= 0 ? "#22c55e" : "#ef4444" }]}>
                      {totals.diff >= 0 ? "+" : ""}{currencySymbol}{Math.abs(totals.diff).toLocaleString("en-US", { minimumFractionDigits: 2 })} ({totals.pct >= 0 ? "+" : ""}{totals.pct.toFixed(2)}%)
                    </Text>
                  </View>
                </>
              )}
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
                <View key={pos.id} style={[s.posCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {/* Header: ticker + edit + remove */}
                  <View style={s.posHeader}>
                    <View>
                      <Text style={[s.posTicker, { color: colors.text }]}>{pos.ticker}</Text>
                      {(pd?.name || pos.name) && (
                        <Text style={[s.posName, { color: colors.textMuted }]}>{pd?.name || pos.name}</Text>
                      )}
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <TouchableOpacity
                        onPress={() => setEditingPos({ id: pos.id, shares: String(pos.shares), avgPrice: String(pos.avgPrice), purchaseDate: pos.purchaseDate ?? new Date().toISOString().split("T")[0] })}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="pencil-outline" size={16} color={colors.textMuted} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => removePosition(pos.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={{ color: colors.textDim, fontSize: 20 }}>×</Text>
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

              {/* Sector breakdown chips */}
              {Object.keys(diagnosis.sectorPcts).length > 0 && (
                <View style={s.diagSectors}>
                  {Object.entries(diagnosis.sectorPcts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([sector, pct]) => (
                      <View key={sector} style={[s.diagSectorChip, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                        <Text style={[s.diagSectorText, { color: colors.textSub }]}>{sector} {pct}%</Text>
                      </View>
                    ))}
                </View>
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
        {positions.length === 0 && (
          <TextInput
            style={[s.simInput, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}
            value={capital} onChangeText={setCapital}
            placeholder="Capital de referencia (USD, opcional)" placeholderTextColor={colors.placeholder}
            keyboardType="numeric"
          />
        )}
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

        {/* Resultado texto (con posiciones) */}
        {analysis !== "" && (
          <View style={[s.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.resultText, { color: colors.textSub }]}>{analysis}</Text>
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

        {calcResult && (
          <View style={[s.calcResultCard, { backgroundColor: colors.card, borderColor: "#6366f1" }]}>
            <View style={s.calcResultTop}>
              <Text style={[s.calcResultLabel, { color: colors.textMuted }]}>Valor final</Text>
              <Text style={[s.calcResultFinal, { color: "#6366f1" }]}>
                ${fmtMoney(calcResult.final)}
              </Text>
            </View>
            <View style={[s.calcResultRow, { borderTopColor: colors.border }]}>
              <View style={s.calcResultItem}>
                <Text style={[s.calcResultItemLabel, { color: colors.textMuted }]}>Total invertido</Text>
                <Text style={[s.calcResultItemVal, { color: colors.text }]}>
                  ${fmtMoney(calcResult.invested)}
                </Text>
              </View>
              <View style={[s.calcResultDivider, { backgroundColor: colors.border }]} />
              <View style={s.calcResultItem}>
                <Text style={[s.calcResultItemLabel, { color: colors.textMuted }]}>Ganancia neta</Text>
                <Text style={[s.calcResultItemVal, { color: "#22c55e" }]}>
                  +${fmtMoney(calcResult.gain)} (+{calcResult.pct.toFixed(0)}%)
                </Text>
              </View>
            </View>
            <View style={[s.milestoneSection, { borderTopColor: colors.border }]}>
              <Text style={[s.milestoneTitle, { color: colors.textMuted }]}>Evolución año a año</Text>
              {calcResult.milestones.map((m) => (
                <View key={m.year} style={s.milestoneRow}>
                  <Text style={[s.milestoneYear, { color: colors.textSub }]}>Año {m.year}</Text>
                  <View style={[s.milestoneBar, { backgroundColor: colors.border }]}>
                    <View style={[s.milestoneBarFill, { flex: m.value / calcResult.final, backgroundColor: "#6366f1" }]} />
                    <View style={{ flex: 1 - m.value / calcResult.final }} />
                  </View>
                  <Text style={[s.milestoneVal, { color: colors.text }]}>
                    ${fmtMoney(m.value)}
                  </Text>
                </View>
              ))}
            </View>
            <View style={s.disclaimer}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="information-circle-outline" size={13} color="#6366f1" />
                <Text style={[s.disclaimerText, { color: "#6366f1" }]}>Cálculo con interés compuesto mensual. Los rendimientos reales varían.</Text>
              </View>
            </View>
          </View>
        )}

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
                  if (!isNaN(shares) && shares > 0) {
                    updatePosition(editingPos.id, { shares, avgPrice: isNaN(avgPrice) ? 0 : avgPrice, purchaseDate: editingPos.purchaseDate || undefined });
                  }
                  setEditingPos(null);
                }}>
                <Text style={{ color: "white", fontWeight: "800", fontSize: 14 }}>Guardar cambios</Text>
              </TouchableOpacity>
            </View>
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
      flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: c.card,
    },
    subTab: {
      flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 6, paddingVertical: 13, borderBottomWidth: 2, borderBottomColor: "transparent",
    },
    subTabText: { fontSize: 13, fontWeight: "600", letterSpacing: 0.1 },
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
      borderTopWidth: 3, borderTopColor: c.accentLight,
    },
    totalsLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 6 },
    totalsValue: { fontSize: 30, fontWeight: "900", marginBottom: 6, letterSpacing: -1 },
    totalsRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    totalsInvested: { fontSize: 12, letterSpacing: 0.1 },
    totalsDiff: { fontSize: 13, fontWeight: "700" },
    // Position card
    posCard: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 8 },
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
    // Compound interest calculator
    calcCard: { borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 14 },
    calcRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
    calcField: { flex: 1 },
    calcLabel: { fontSize: 10, fontWeight: "700", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
    calcInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, fontSize: 14 },
    calcInputWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11 },
    calcInputPrefix: { fontSize: 14, fontWeight: "700", marginRight: 4 },
    calcInputInner: { flex: 1, fontSize: 14, padding: 0 },
    calcBtn: { backgroundColor: "#6366f1", borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 4 },
    calcBtnText: { color: "white", fontWeight: "700", fontSize: 15 },
    calcResultCard: { borderRadius: 18, borderWidth: 1.5, padding: 18, marginBottom: 4 },
    calcResultTop: { alignItems: "center", marginBottom: 16 },
    calcResultLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
    calcResultFinal: { fontSize: 36, fontWeight: "900", letterSpacing: -1 },
    calcResultRow: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14, marginBottom: 16 },
    calcResultItem: { flex: 1, alignItems: "center" },
    calcResultItemLabel: { fontSize: 11, marginBottom: 4, letterSpacing: 0.1 },
    calcResultItemVal: { fontSize: 14, fontWeight: "800" },
    calcResultDivider: { width: 1, marginVertical: 4 },
    milestoneSection: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14 },
    milestoneTitle: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },
    milestoneRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 9 },
    milestoneYear: { fontSize: 12, fontWeight: "700", width: 46 },
    milestoneBar: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden", flexDirection: "row" },
    milestoneBarFill: { height: "100%", borderRadius: 3 },
    milestoneVal: { fontSize: 12, fontWeight: "700", width: 80, textAlign: "right" },
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
    diagSectorText: { fontSize: 11, fontWeight: "600" },
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
