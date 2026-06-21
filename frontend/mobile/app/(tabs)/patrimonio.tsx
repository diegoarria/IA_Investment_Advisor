import React, { useState, useEffect, useMemo } from "react";
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "../../src/lib/ThemeContext";
import { usePortfolioStore } from "../../src/lib/portfolioStore";
import { useWatchlistStore } from "../../src/lib/watchlistStore";
import { usePaperStore, PAPER_INITIAL_CASH } from "../../src/lib/paperStore";
import { marketApi } from "../../src/lib/api";
import StockAvatar from "../../src/components/StockAvatar";

// ─── Types ─────────────────────────────────────────────────────────────────

interface PriceData {
  price: number | null;
  change_pct: number;
  currency?: string;
  name?: string;
}

type PriceMap = Record<string, PriceData>;

// ─── Helpers ────────────────────────────────────────────────────────────────

const CURRENCY_SYM: Record<string, string> = {
  USD: "$", MXN: "$", ARS: "$", CLP: "$", COP: "$", CAD: "$",
  EUR: "€", GBP: "£", BRL: "R$", JPY: "¥", CHF: "Fr",
};

function fmtMoney(n: number, currency = "USD"): string {
  const sym = CURRENCY_SYM[currency] ?? "$";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(2)}M`;
  return `${sign}${sym}${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// ─── Risk diagnosis data ─────────────────────────────────────────────────────

const TICKER_SECTOR: Record<string, string> = {
  NVDA:"Tecnología",AMD:"Tecnología",INTC:"Tecnología",QCOM:"Tecnología",AVGO:"Tecnología",
  MU:"Tecnología",TSM:"Tecnología",AMAT:"Tecnología",SMCI:"Tecnología",ARM:"Tecnología",
  MSFT:"Tecnología",CRM:"Tecnología",ADBE:"Tecnología",ORCL:"Tecnología",NOW:"Tecnología",
  INTU:"Tecnología",DDOG:"Tecnología",NET:"Tecnología",ZS:"Tecnología",PANW:"Tecnología",
  MDB:"Tecnología",SNOW:"Tecnología",AAPL:"Tecnología",PLTR:"Tecnología",SHOP:"Tecnología",
  ENPH:"Tecnología",FSLR:"Tecnología",TXN:"Tecnología",ADI:"Tecnología",MRVL:"Tecnología",
  GOOGL:"Comunicaciones",GOOG:"Comunicaciones",META:"Comunicaciones",SNAP:"Comunicaciones",
  NFLX:"Comunicaciones",DIS:"Comunicaciones",SPOT:"Comunicaciones",RBLX:"Comunicaciones",
  T:"Comunicaciones",VZ:"Comunicaciones",TMUS:"Comunicaciones",CMCSA:"Comunicaciones",
  AMZN:"Consumo Discrecional",TSLA:"Consumo Discrecional",MELI:"Consumo Discrecional",
  MCD:"Consumo Discrecional",SBUX:"Consumo Discrecional",NKE:"Consumo Discrecional",
  HD:"Consumo Discrecional",TGT:"Consumo Discrecional",ABNB:"Consumo Discrecional",
  UBER:"Consumo Discrecional",LYFT:"Consumo Discrecional",BKNG:"Consumo Discrecional",
  RIVN:"Consumo Discrecional",LCID:"Consumo Discrecional",NIO:"Consumo Discrecional",
  WMT:"Consumo Básico",KO:"Consumo Básico",PG:"Consumo Básico",COST:"Consumo Básico",
  PEP:"Consumo Básico",CL:"Consumo Básico",PM:"Consumo Básico",MO:"Consumo Básico",
  UNH:"Salud",JNJ:"Salud",PFE:"Salud",ABBV:"Salud",MRK:"Salud",LLY:"Salud",
  AMGN:"Salud",GILD:"Salud",REGN:"Salud",VRTX:"Salud",MRNA:"Salud",BNTX:"Salud",
  ABT:"Salud",MDT:"Salud",ISRG:"Salud",CVS:"Salud",
  JPM:"Financiero",BAC:"Financiero",GS:"Financiero",MS:"Financiero",V:"Financiero",
  MA:"Financiero",AXP:"Financiero",SCHW:"Financiero",BLK:"Financiero",
  PYPL:"Financiero",SQ:"Financiero",COIN:"Financiero",MSTR:"Financiero",
  MARA:"Financiero",RIOT:"Financiero","BRK-B":"Financiero",
  XOM:"Energía",CVX:"Energía",COP:"Energía",OXY:"Energía",SLB:"Energía",
  CAT:"Industriales",DE:"Industriales",GE:"Industriales",HON:"Industriales",
  LMT:"Industriales",RTX:"Industriales",BA:"Industriales",UPS:"Industriales",
  FDX:"Industriales",UNP:"Industriales",RKLB:"Industriales",AXON:"Industriales",
  LIN:"Materiales",NEM:"Materiales",FCX:"Materiales",ALB:"Materiales",
  AMT:"Bienes Raíces",PLD:"Bienes Raíces",EQIX:"Bienes Raíces",VNQ:"Bienes Raíces",
  NEE:"Servicios Públicos",DUK:"Servicios Públicos",
  SPY:"ETF",QQQ:"ETF",VTI:"ETF",IVV:"ETF",VOO:"ETF",
  IWM:"ETF",GLD:"ETF",SLV:"ETF",TLT:"ETF",ARKK:"ETF",TQQQ:"ETF",
};

const TICKER_RISK_OVERRIDE: Record<string, number> = {
  GME:96,AMC:96,MSTR:93,MARA:92,RIOT:92,COIN:90,TQQQ:90,ARKK:82,
  TSLA:84,PLTR:82,SNAP:82,RIVN:88,LCID:88,NIO:86,RKLB:84,
  NVDA:77,AMD:76,SMCI:80,ARM:78,SNOW:77,MDB:75,META:68,NFLX:68,
  SHOP:74,SQ:75,UBER:70,ABNB:72,DDOG:73,NET:72,ZS:72,MRNA:72,
  AAPL:60,MSFT:58,GOOGL:60,AMZN:63,ORCL:55,ADBE:60,CRM:62,NOW:62,
  JPM:48,BAC:50,GS:55,MS:52,V:45,MA:45,AXP:50,SCHW:52,
  JNJ:28,PFE:35,UNH:32,ABBV:38,LLY:42,AMGN:36,MRK:34,
  WMT:22,KO:18,PG:18,MCD:25,COST:30,SBUX:35,NKE:45,HD:38,
  XOM:48,CVX:48,COP:55,OXY:58,
  SPY:20,VOO:20,VTI:20,IVV:20,QQQ:38,IWM:45,GLD:30,
};

const SECTOR_RISK_BASE: Record<string, number> = {
  ETF:22,"Consumo Básico":20,"Servicios Públicos":28,"Bienes Raíces":40,
  Salud:42,Comunicaciones:52,Financiero:52,Energía:55,
  Industriales:46,Materiales:52,"Consumo Discrecional":58,Tecnología:68,
};

const SECTOR_COLOR: Record<string, string> = {
  Tecnología:"#8b5cf6",Comunicaciones:"#06b6d4","Consumo Discrecional":"#f97316",
  "Consumo Básico":"#eab308",Salud:"#ec4899",Financiero:"#475569",
  Energía:"#ef4444",Industriales:"#0ea5e9",Materiales:"#d97706",
  "Bienes Raíces":"#14b8a6","Servicios Públicos":"#22c55e",ETF:"#94a3b8",
};

const PORTFOLIO_LEVELS = [
  { label:"Conservador",          min:0,  max:13,  color:"#3b82f6" },
  { label:"Conservador-Moderado", min:13, max:25,  color:"#60a5fa" },
  { label:"Moderado",             min:25, max:38,  color:"#f59e0b" },
  { label:"Moderado-Growth",      min:38, max:51,  color:"#f97316" },
  { label:"Growth",               min:51, max:63,  color:"#fb923c" },
  { label:"Agresivo",             min:63, max:75,  color:"#ef4444" },
  { label:"Agresivo-Especulativo",min:75, max:88,  color:"#dc2626" },
  { label:"Especulativo",         min:88, max:101, color:"#7f1d1d" },
];

function scorePortfolio(positions: { ticker: string; shares: number; avgPrice: number }[], pricesData: PriceMap) {
  if (!positions.length) return null;
  let totalVal = 0, weightedRisk = 0;
  const sectorVals: Record<string, number> = {};
  for (const pos of positions) {
    const price = pricesData[pos.ticker]?.price ?? pos.avgPrice;
    const val = pos.shares * price;
    totalVal += val;
    const risk = TICKER_RISK_OVERRIDE[pos.ticker] ?? (SECTOR_RISK_BASE[TICKER_SECTOR[pos.ticker] ?? ""] ?? 62);
    weightedRisk += risk * val;
    const sector = TICKER_SECTOR[pos.ticker] ?? "Otro";
    sectorVals[sector] = (sectorVals[sector] ?? 0) + val;
  }
  if (totalVal === 0) return null;
  let score = weightedRisk / totalVal;
  const topVal = Math.max(...positions.map((p) => p.shares * (pricesData[p.ticker]?.price ?? p.avgPrice)));
  if (topVal / totalVal > 0.4) score = Math.min(100, score + (topVal / totalVal - 0.4) * 20);
  if (positions.length >= 10) score = Math.max(0, score - 4);
  score = Math.round(Math.min(100, Math.max(0, score)));
  const idx = PORTFOLIO_LEVELS.findIndex((l) => score >= l.min && score < l.max);
  const sectorPcts: Record<string, number> = {};
  for (const [s, v] of Object.entries(sectorVals)) sectorPcts[s] = Math.round((v / totalVal) * 100);
  return { score, levelIdx: idx === -1 ? 7 : idx, sectorPcts };
}

// ─── Sub-tabs ────────────────────────────────────────────────────────────────

const TABS = ["Portafolio", "Watchlist", "Simulador"] as const;
type TabId = (typeof TABS)[number];

// ─── Portafolio Tab ──────────────────────────────────────────────────────────

function PortafolioTab({ prices, loading, colors }: { prices: PriceMap; loading: boolean; colors: any }) {
  const { positions, portfolioCurrency } = usePortfolioStore();
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const diagnosis = useMemo(() => scorePortfolio(positions, prices), [positions, prices]);

  const totalValue = positions.reduce((sum, pos) => {
    const p = prices[pos.ticker]?.price ?? pos.avgPrice;
    return sum + pos.shares * p;
  }, 0);

  const totalCost = positions.reduce((sum, pos) => sum + pos.shares * pos.avgPrice, 0);
  const totalGain = totalValue - totalCost;
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

  const { dayGain, dayPrev } = positions.reduce((acc, pos) => {
    const pr = prices[pos.ticker];
    if (!pr?.price) return acc;
    const cp = pr.change_pct ?? 0;
    const prevPrice = cp !== -100 ? pr.price / (1 + cp / 100) : pr.price;
    return {
      dayGain: acc.dayGain + pos.shares * (pr.price - prevPrice),
      dayPrev: acc.dayPrev + pos.shares * prevPrice,
    };
  }, { dayGain: 0, dayPrev: 0 });
  const dayGainPct = dayPrev > 0 ? (dayGain / dayPrev) * 100 : 0;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 12 }}>
      {/* Summary Row */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={[ss.statCard, { flex: 1, backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Text style={[ss.statLabel, { color: colors.textMuted }]}>Valor Total</Text>
            <View style={{ backgroundColor: colors.bgRaised ?? colors.card, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: 9, fontWeight: "900", color: colors.textMuted, letterSpacing: 0.5 }}>{portfolioCurrency}</Text>
            </View>
          </View>
          <Text style={[ss.statValue, { color: colors.text }]}>{fmtMoney(totalValue, portfolioCurrency)}</Text>
        </View>
        <View style={[ss.statCard, { flex: 1, backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[ss.statLabel, { color: colors.textMuted }]}>Ganancia Día</Text>
          <Text style={[ss.statValue, { color: dayGain >= 0 ? colors.up ?? "#10b981" : colors.down ?? "#ef4444" }]}>
            {fmtMoney(dayGain, portfolioCurrency)}
          </Text>
          <Text style={{ fontSize: 11, fontWeight: "600", color: dayGain >= 0 ? colors.up ?? "#10b981" : colors.down ?? "#ef4444", marginTop: 2 }}>
            {fmtPct(dayGainPct)}
          </Text>
        </View>
      </View>

      <View style={[ss.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[ss.statLabel, { color: colors.textMuted }]}>Ganancia Total</Text>
        <Text style={[ss.statValue, { color: totalGain >= 0 ? colors.up ?? "#10b981" : colors.down ?? "#ef4444" }]}>
          {fmtMoney(totalGain, portfolioCurrency)}{" "}
          <Text style={ss.statSubValue}>{fmtPct(totalGainPct)}</Text>
        </Text>
      </View>

      {/* Positions List */}
      <View style={[ss.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[ss.cardHeader, { borderBottomColor: colors.border }]}>
          <Text style={[ss.cardTitle, { color: colors.text }]}>Posiciones ({positions.length})</Text>
          {loading && <ActivityIndicator size="small" color={colors.accentLight} />}
        </View>

        {positions.length === 0 ? (
          <View style={ss.emptyState}>
            <Ionicons name="bar-chart-outline" size={32} color={colors.textMuted} style={{ opacity: 0.4 }} />
            <Text style={[ss.emptyText, { color: colors.textMuted }]}>No tienes posiciones aún</Text>
          </View>
        ) : (
          positions.map((pos, i) => {
            const pr = prices[pos.ticker];
            const currentPrice = pr?.price ?? pos.avgPrice;
            const currentValue = pos.shares * currentPrice;
            const cost = pos.shares * pos.avgPrice;
            const gainAbs = currentValue - cost;
            const gainPct = cost > 0 ? (gainAbs / cost) * 100 : 0;
            const dayChangePct = pr?.change_pct ?? 0;
            const positive = gainAbs >= 0;

            return (
              <View
                key={pos.id}
                style={[
                  ss.row,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                ]}
              >
                <StockAvatar ticker={pos.ticker} size={36} />
                <View style={ss.rowInfo}>
                  <Text style={[ss.rowTicker, { color: colors.text }]}>{pos.ticker}</Text>
                  <Text style={[ss.rowSub, { color: colors.textMuted }]}>
                    {pos.shares} acc · ${pos.avgPrice.toFixed(2)} prom.
                  </Text>
                </View>
                <View style={ss.rowRight}>
                  <Text style={[ss.rowValue, { color: colors.text }]}>{fmtMoney(currentValue, portfolioCurrency)}</Text>
                  <View style={ss.rowBadgeRow}>
                    <Text style={[ss.rowBadge, { color: positive ? colors.up ?? "#10b981" : colors.down ?? "#ef4444" }]}>
                      {fmtPct(gainPct)}
                    </Text>
                    <Text style={[ss.rowSub, { color: colors.textMuted }]}>
                      {" · "}
                      <Text style={{ color: dayChangePct >= 0 ? colors.up ?? "#10b981" : colors.down ?? "#ef4444" }}>
                        {fmtPct(dayChangePct)}
                      </Text>
                    </Text>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* ── Risk Diagnosis ── */}
      {diagnosis && positions.length > 0 && (() => {
        const level = PORTFOLIO_LEVELS[diagnosis.levelIdx];
        return (
          <View style={[ss.card, { backgroundColor: colors.card, borderColor: level.color + "60", borderWidth: 2 }]}>
            {/* Header: badge + score */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: level.color + "50", backgroundColor: level.color + "18" }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: level.color }} />
                <Text style={{ fontSize: 12, fontWeight: "800", color: level.color }}>{level.label}</Text>
              </View>
              <Text style={{ fontSize: 12, fontWeight: "700", color: colors.textMuted }}>{diagnosis.score}/100</Text>
            </View>

            {/* 8-segment bar */}
            <View style={{ flexDirection: "row", gap: 3, alignItems: "center", marginBottom: 4 }}>
              {PORTFOLIO_LEVELS.map((l, i) => (
                <View key={l.label} style={{ flex: 1, borderRadius: 4, backgroundColor: i === diagnosis.levelIdx ? l.color : l.color + "35", height: i === diagnosis.levelIdx ? 12 : 7 }} />
              ))}
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 12 }}>
              <Text style={{ fontSize: 9, color: colors.textDim }}>Conservador</Text>
              <Text style={{ fontSize: 9, color: colors.textDim }}>Especulativo</Text>
            </View>

            {/* Sector pills */}
            {Object.keys(diagnosis.sectorPcts).length > 0 && (
              <>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: selectedSector ? 10 : 0 }}>
                  {Object.entries(diagnosis.sectorPcts).sort((a, b) => b[1] - a[1]).map(([sector, pct]) => {
                    const col = SECTOR_COLOR[sector] ?? "#94a3b8";
                    const active = selectedSector === sector;
                    return (
                      <TouchableOpacity
                        key={sector}
                        onPress={() => setSelectedSector(active ? null : sector)}
                        style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1, backgroundColor: active ? col : col + "18", borderColor: active ? col : col + "40" }}
                      >
                        <Text style={{ fontSize: 11, fontWeight: "700", color: active ? "#fff" : col }}>{sector} {pct}%</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Sector drill-down */}
                {selectedSector && (() => {
                  const col = SECTOR_COLOR[selectedSector] ?? "#94a3b8";
                  const sectorPositions = positions.filter((p) => (TICKER_SECTOR[p.ticker] ?? "Otro") === selectedSector);
                  return (
                    <View style={{ borderRadius: 12, padding: 12, borderWidth: 1, backgroundColor: col + "0e", borderColor: col + "40" }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <Text style={{ fontSize: 11, fontWeight: "800", color: col }}>Posiciones · {selectedSector}</Text>
                        <TouchableOpacity onPress={() => setSelectedSector(null)}>
                          <Text style={{ fontSize: 10, color: colors.textMuted }}>✕ cerrar</Text>
                        </TouchableOpacity>
                      </View>
                      {sectorPositions.map((p) => {
                        const pr = prices[p.ticker];
                        const val = p.shares * (pr?.price ?? p.avgPrice);
                        const gain = val - p.shares * p.avgPrice;
                        const gainPct = (gain / (p.shares * p.avgPrice)) * 100;
                        return (
                          <View key={p.ticker} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: col + "30" }}>
                            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.text }}>{p.ticker}</Text>
                            <Text style={{ fontSize: 11, color: gain >= 0 ? "#10b981" : "#ef4444", fontWeight: "600" }}>
                              {gain >= 0 ? "+" : ""}{gainPct.toFixed(1)}%
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  );
                })()}
              </>
            )}
          </View>
        );
      })()}

      <TouchableOpacity
        onPress={() => router.push("/(tabs)/portfolio")}
        activeOpacity={0.8}
        style={[ss.btn, { backgroundColor: colors.accent }]}
      >
        <Text style={ss.btnText}>Ver portafolio completo →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Watchlist Tab ───────────────────────────────────────────────────────────

function WatchlistTab({ prices, loading, colors }: { prices: PriceMap; loading: boolean; colors: any }) {
  const { items } = useWatchlistStore();

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <View style={[ss.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[ss.cardHeader, { borderBottomColor: colors.border }]}>
          <Text style={[ss.cardTitle, { color: colors.text }]}>Watchlist ({items.length})</Text>
          {loading && <ActivityIndicator size="small" color={colors.accentLight} />}
        </View>

        {items.length === 0 ? (
          <View style={ss.emptyState}>
            <Ionicons name="eye-outline" size={32} color={colors.textMuted} style={{ opacity: 0.4 }} />
            <Text style={[ss.emptyText, { color: colors.textMuted }]}>Tu watchlist está vacía</Text>
          </View>
        ) : (
          items.map((item, i) => {
            const pr = prices[item.ticker];
            const price = pr?.price ?? null;
            const changePct = pr?.change_pct ?? 0;
            const positive = changePct >= 0;

            return (
              <View
                key={item.ticker}
                style={[
                  ss.row,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                ]}
              >
                <StockAvatar ticker={item.ticker} size={36} />
                <View style={ss.rowInfo}>
                  <Text style={[ss.rowTicker, { color: colors.text }]}>{item.ticker}</Text>
                  <Text style={[ss.rowSub, { color: colors.textMuted }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                </View>
                <View style={ss.rowRight}>
                  <Text style={[ss.rowValue, { color: colors.text }]}>
                    {price !== null ? `$${price.toFixed(2)}` : "—"}
                  </Text>
                  <Text style={[ss.rowBadge, { color: positive ? colors.up ?? "#10b981" : colors.down ?? "#ef4444" }]}>
                    {fmtPct(changePct)}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </View>

      <TouchableOpacity
        onPress={() => router.push("/(tabs)/watchlist")}
        activeOpacity={0.8}
        style={[ss.btn, { backgroundColor: colors.accent }]}
      >
        <Text style={ss.btnText}>Ver watchlist completa →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Simulador Tab ───────────────────────────────────────────────────────────

function SimuladorTab({ prices, loading, colors }: { prices: PriceMap; loading: boolean; colors: any }) {
  const { cash, positions } = usePaperStore();

  const positionsValue = positions.reduce((sum, pos) => {
    const p = prices[pos.ticker]?.price ?? pos.avgPrice;
    return sum + pos.shares * p;
  }, 0);

  const totalValue = cash + positionsValue;
  const gain = totalValue - PAPER_INITIAL_CASH;
  const gainPct = (gain / PAPER_INITIAL_CASH) * 100;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 12 }}>
      {/* Summary Row */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={[ss.statCard, { flex: 1, backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[ss.statLabel, { color: colors.textMuted }]}>Valor Total</Text>
          <Text style={[ss.statValue, { color: colors.text }]}>{fmtMoney(totalValue)}</Text>
        </View>
        <View style={[ss.statCard, { flex: 1, backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[ss.statLabel, { color: colors.textMuted }]}>Efectivo</Text>
          <Text style={[ss.statValue, { color: colors.text }]}>{fmtMoney(cash)}</Text>
        </View>
      </View>

      <View style={[ss.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[ss.statLabel, { color: colors.textMuted }]}>Ganancia vs capital inicial</Text>
        <Text style={[ss.statValue, { color: gain >= 0 ? colors.up ?? "#10b981" : colors.down ?? "#ef4444" }]}>
          {fmtMoney(gain)}{" "}
          <Text style={ss.statSubValue}>{fmtPct(gainPct)}</Text>
        </Text>
      </View>

      {/* Paper Positions */}
      <View style={[ss.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[ss.cardHeader, { borderBottomColor: colors.border }]}>
          <Text style={[ss.cardTitle, { color: colors.text }]}>Posiciones Paper ({positions.length})</Text>
          {loading && <ActivityIndicator size="small" color={colors.accentLight} />}
        </View>

        {positions.length === 0 ? (
          <View style={ss.emptyState}>
            <Ionicons name="wallet-outline" size={32} color={colors.textMuted} style={{ opacity: 0.4 }} />
            <Text style={[ss.emptyText, { color: colors.textMuted }]}>No tienes posiciones paper</Text>
          </View>
        ) : (
          positions.map((pos, i) => {
            const pr = prices[pos.ticker];
            const currentPrice = pr?.price ?? pos.avgPrice;
            const currentValue = pos.shares * currentPrice;
            const cost = pos.shares * pos.avgPrice;
            const gainAbs = currentValue - cost;
            const gainPct2 = cost > 0 ? (gainAbs / cost) * 100 : 0;
            const positive = gainAbs >= 0;

            return (
              <View
                key={pos.id}
                style={[
                  ss.row,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                ]}
              >
                <StockAvatar ticker={pos.ticker} size={36} />
                <View style={ss.rowInfo}>
                  <Text style={[ss.rowTicker, { color: colors.text }]}>{pos.ticker}</Text>
                  <Text style={[ss.rowSub, { color: colors.textMuted }]}>
                    {pos.shares} acc · ${pos.avgPrice.toFixed(2)} prom.
                  </Text>
                </View>
                <View style={ss.rowRight}>
                  <Text style={[ss.rowValue, { color: colors.text }]}>{fmtMoney(currentValue, "USD")}</Text>
                  <Text style={[ss.rowBadge, { color: positive ? colors.up ?? "#10b981" : colors.down ?? "#ef4444" }]}>
                    {fmtPct(gainPct2)}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </View>

      <TouchableOpacity
        onPress={() => router.push("/(tabs)/paper")}
        activeOpacity={0.8}
        style={[ss.btn, { backgroundColor: colors.accent }]}
      >
        <Text style={ss.btnText}>Abrir simulador →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function PatrimonioScreen() {
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState<TabId>("Portafolio");
  const [prices, setPrices] = useState<PriceMap>({});
  const [pricesLoading, setPricesLoading] = useState(false);

  const { positions: portfolioPositions } = usePortfolioStore();
  const { items: watchItems } = useWatchlistStore();
  const { positions: paperPositions } = usePaperStore();

  useEffect(() => {
    const allTickers = [
      ...portfolioPositions.map((p) => p.ticker),
      ...watchItems.map((w) => w.ticker),
      ...paperPositions.map((p) => p.ticker),
    ];
    const unique = [...new Set(allTickers)];
    if (unique.length === 0) return;

    const fetchPrices = (initial = false) => {
      if (initial) setPricesLoading(true);
      marketApi
        .getPrices(unique)
        .then((res: any) => { if (res?.data) setPrices(res.data as PriceMap); })
        .catch(() => {})
        .finally(() => { if (initial) setPricesLoading(false); });
    };

    fetchPrices(true);
    const id = setInterval(() => fetchPrices(false), 30_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SafeAreaView edges={["top"]} style={[ss.safe, { backgroundColor: colors.bg }]}>
      {/* Header */}
      <View style={[ss.header, { borderBottomColor: colors.border }]}>
        <View>
          <Text style={[ss.headerSub, { color: colors.textMuted }]}>Mi dinero</Text>
          <Text style={[ss.headerTitle, { color: colors.text }]}>Patrimonio</Text>
        </View>
      </View>

      {/* Sub-tab switcher */}
      <View style={[ss.tabBar, { borderBottomColor: colors.border, backgroundColor: colors.bg }]}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            activeOpacity={0.8}
            style={[
              ss.tabBtn,
              activeTab === tab && { backgroundColor: colors.accent },
            ]}
          >
            <Text
              style={[
                ss.tabBtnText,
                { color: activeTab === tab ? "#fff" : colors.textMuted },
              ]}
            >
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {activeTab === "Portafolio" && (
        <PortafolioTab prices={prices} loading={pricesLoading} colors={colors} />
      )}
      {activeTab === "Watchlist" && (
        <WatchlistTab prices={prices} loading={pricesLoading} colors={colors} />
      )}
      {activeTab === "Simulador" && (
        <SimuladorTab prices={prices} loading={pricesLoading} colors={colors} />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const ss = StyleSheet.create({
  safe: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSub: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  statCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  statSubValue: {
    fontSize: 14,
    fontWeight: "600",
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
  },
  rowTicker: {
    fontSize: 14,
    fontWeight: "700",
  },
  rowSub: {
    fontSize: 11,
    marginTop: 1,
  },
  rowRight: {
    alignItems: "flex-end",
  },
  rowValue: {
    fontSize: 14,
    fontWeight: "700",
  },
  rowBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  rowBadge: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  btn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
});
