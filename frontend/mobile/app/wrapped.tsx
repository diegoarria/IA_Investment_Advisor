import React, { useEffect, useState, useRef } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Dimensions,
  Share, ActivityIndicator, SafeAreaView,
} from "react-native";
import { router } from "expo-router";
import api from "../src/lib/api";

const { width, height } = Dimensions.get("window");

interface WrappedData {
  year: number;
  user_name: string;
  top_stocks: { ticker: string; ytd_pct: number }[];
  lessons: number;
  days_active: number;
  top_sector: string;
  sim_count: number;
  debate_count: number;
}

const SLIDES = ["cover", "stocks", "lessons", "sector"] as const;

export default function WrappedScreen() {
  const [data, setData] = useState<WrappedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    api.get("/api/wrapped/annual")
      .then((r) => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const next = () => setSlide((s) => Math.min(s + 1, SLIDES.length - 1));
  const prev = () => setSlide((s) => Math.max(s - 1, 0));
  const isLast = slide === SLIDES.length - 1;

  const fmt = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

  const handleShare = async () => {
    if (!data) return;
    try {
      await Share.share({
        message: `Mi Nuvos Wrapped ${data.year} 🚀\n\nCompletí ${data.lessons} lecciones en ${data.days_active} días.\nMi sector favorito: ${data.top_sector}.\n\n📲 nuvosai.com`,
        title: `Nuvos Wrapped ${data.year}`,
      });
    } catch {}
  };

  if (loading) return (
    <View style={s.loadingContainer}>
      <ActivityIndicator color="#00d47e" size="large" />
      <Text style={s.loadingText}>Cargando tu Wrapped…</Text>
    </View>
  );

  if (!data) return (
    <View style={s.loadingContainer}>
      <Text style={s.loadingText}>No se pudo cargar el Wrapped.</Text>
      <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
        <Text style={{ color: "#00d47e", fontSize: 14 }}>Volver</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={s.root}>
      {/* Progress bars */}
      <SafeAreaView style={s.progressWrap}>
        <View style={s.progressRow}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[s.progressBar, { backgroundColor: i <= slide ? "#00d47e" : "rgba(255,255,255,0.25)" }]} />
          ))}
        </View>
      </SafeAreaView>

      {/* Close */}
      <TouchableOpacity style={s.closeBtn} onPress={() => router.back()}>
        <Text style={s.closeTxt}>✕</Text>
      </TouchableOpacity>

      {/* Slides */}
      {slide === 0 && (
        <View style={[s.slide, { backgroundColor: "#0d1117" }]}>
          <View style={s.coverCircle1} />
          <View style={s.coverCircle2} />

          {/* Logo */}
          <View style={s.logoRow}>
            <View style={s.logoBox}><Text style={s.logoLetter}>N</Text></View>
            <Text style={s.logoName}>Nuvos AI</Text>
          </View>

          {/* Year ghost */}
          <Text style={s.yearGhost}>{data.year}</Text>

          {/* Main */}
          <View style={s.coverMain}>
            <Text style={s.coverEyebrow}>Tu año en</Text>
            <Text style={s.coverTitle}>Nuvos{"\n"}Wrapped</Text>
            <Text style={s.coverYear}>{data.year}</Text>
          </View>

          {/* User */}
          <View style={s.coverUser}>
            <Text style={s.coverUserLabel}>Resumen de</Text>
            <Text style={s.coverUserName}>{data.user_name}</Text>
          </View>
        </View>
      )}

      {slide === 1 && (
        <View style={[s.slide, { backgroundColor: "#0d1117" }]}>
          <View style={[s.bgCircle, { top: -40, right: -40, backgroundColor: "rgba(0,212,126,0.08)" }]} />
          <View style={s.slideInner}>
            <Text style={[s.eyebrow, { color: "#00d47e" }]}>Tus mejores inversiones</Text>
            <Text style={s.slideTitle}>Top 3 acciones{"\n"}del año 🚀</Text>

            {data.top_stocks.length === 0 ? (
              <Text style={s.emptyNote}>Agrega acciones a tu portafolio para ver este dato el próximo año.</Text>
            ) : (
              data.top_stocks.map((st, i) => (
                <View key={st.ticker} style={s.stockRow}>
                  <Text style={s.stockRank}>{i + 1}</Text>
                  <View style={s.stockCard}>
                    <View>
                      <Text style={s.stockTicker}>{st.ticker}</Text>
                      <Text style={s.stockSub}>Rendimiento YTD</Text>
                    </View>
                    <Text style={[s.stockPct, { color: st.ytd_pct >= 0 ? "#00d47e" : "#ef4444" }]}>{fmt(st.ytd_pct)}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
          <View style={s.smallLogoRow}>
            <View style={s.smallLogoBox}><Text style={s.smallLogoLetter}>N</Text></View>
            <Text style={s.smallLogoName}>Nuvos AI</Text>
          </View>
        </View>
      )}

      {slide === 2 && (
        <View style={[s.slide, { backgroundColor: "#0d1117" }]}>
          <View style={[s.bgCircle, { top: -40, left: -40, backgroundColor: "rgba(139,92,246,0.08)" }]} />
          <View style={s.slideInner}>
            <Text style={[s.eyebrow, { color: "#8b5cf6" }]}>Tu actividad</Text>
            <Text style={s.slideTitle}>Nunca dejaste{"\n"}de aprender 🧠</Text>

            <View style={[s.bigStatCard, { borderColor: "rgba(139,92,246,0.25)", backgroundColor: "rgba(139,92,246,0.08)" }]}>
              <Text style={[s.bigStatNum, { color: "#8b5cf6" }]}>{data.lessons}</Text>
              <Text style={s.bigStatLabel}>lecciones completadas</Text>
              <Text style={s.bigStatSub}>{data.sim_count} simulaciones · {data.debate_count} debates</Text>
            </View>

            <View style={s.smallStatCard}>
              <Text style={s.smallStatNum}>{data.days_active}</Text>
              <Text style={s.smallStatLabel}>días en plataforma</Text>
            </View>
          </View>
          <View style={s.smallLogoRow}>
            <View style={s.smallLogoBox}><Text style={s.smallLogoLetter}>N</Text></View>
            <Text style={s.smallLogoName}>Nuvos AI</Text>
          </View>
        </View>
      )}

      {slide === 3 && (
        <View style={[s.slide, { backgroundColor: "#0d1117" }]}>
          <View style={[s.bgCircle, { bottom: -60, right: -60, backgroundColor: "rgba(59,130,246,0.07)" }]} />
          <View style={s.slideInner}>
            <Text style={[s.eyebrow, { color: "#3b82f6" }]}>Tu perfil</Text>
            <Text style={s.slideTitle}>Tu sector{"\n"}favorito 🏆</Text>

            <View style={[s.bigStatCard, { borderColor: "rgba(59,130,246,0.25)", backgroundColor: "rgba(59,130,246,0.08)", alignItems: "center" }]}>
              <Text style={[s.sectorName, { color: "#3b82f6" }]}>{data.top_sector}</Text>
              <Text style={s.bigStatSub}>Sector con mayor exposición en tu portafolio</Text>
            </View>

            <Text style={s.creditLine}>{data.user_name} · Nuvos Wrapped {data.year}</Text>

            <TouchableOpacity style={s.shareBtn} onPress={handleShare} activeOpacity={0.85}>
              <Text style={s.shareBtnText}>Compartir mi Wrapped ✨</Text>
            </TouchableOpacity>
          </View>
          <View style={s.smallLogoRow}>
            <View style={s.smallLogoBox}><Text style={s.smallLogoLetter}>N</Text></View>
            <Text style={s.smallLogoName}>Nuvos AI</Text>
          </View>
        </View>
      )}

      {/* Tap zones */}
      <View style={s.tapZones} pointerEvents="box-none">
        <TouchableOpacity style={{ flex: 1 }} onPress={prev} activeOpacity={1} />
        <TouchableOpacity style={{ flex: 1 }} onPress={isLast ? undefined : next} activeOpacity={1} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:            { flex: 1, backgroundColor: "#000" },
  loadingContainer:{ flex: 1, backgroundColor: "#0d1117", alignItems: "center", justifyContent: "center", gap: 16 },
  loadingText:     { color: "#9ca3af", fontSize: 14 },

  progressWrap:    { position: "absolute", top: 0, left: 0, right: 0, zIndex: 20 },
  progressRow:     { flexDirection: "row", gap: 4, paddingHorizontal: 16, paddingTop: 16 },
  progressBar:     { flex: 1, height: 3, borderRadius: 2 },

  closeBtn:        { position: "absolute", top: 52, right: 16, zIndex: 30, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 10, width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  closeTxt:        { color: "#fff", fontSize: 14, fontWeight: "700" },

  slide:           { flex: 1, position: "relative" },
  slideInner:      { flex: 1, padding: 32, paddingTop: 80, gap: 20 },
  bgCircle:        { position: "absolute", width: 220, height: 220, borderRadius: 110 },

  // Cover
  coverCircle1:    { position: "absolute", top: -60, right: -60, width: 240, height: 240, borderRadius: 120, backgroundColor: "rgba(0,212,126,0.06)" },
  coverCircle2:    { position: "absolute", bottom: -80, left: -80, width: 280, height: 280, borderRadius: 140, backgroundColor: "rgba(0,212,126,0.04)" },
  logoRow:         { position: "absolute", top: 60, left: 32, flexDirection: "row", alignItems: "center", gap: 10, zIndex: 5 },
  logoBox:         { width: 36, height: 36, borderRadius: 10, backgroundColor: "#00d47e", alignItems: "center", justifyContent: "center" },
  logoLetter:      { color: "#0d1117", fontSize: 18, fontWeight: "900" },
  logoName:        { color: "#fff", fontSize: 17, fontWeight: "900" },
  yearGhost:       { position: "absolute", fontSize: 140, fontWeight: "900", color: "rgba(0,212,126,0.08)", top: "30%", left: -10, letterSpacing: -6 },
  coverMain:       { flex: 1, justifyContent: "center", alignItems: "center", zIndex: 5 },
  coverEyebrow:    { fontSize: 13, color: "#6b7280", letterSpacing: 0.5, marginBottom: 8, textTransform: "uppercase" },
  coverTitle:      { fontSize: 52, fontWeight: "900", color: "#fff", textAlign: "center", lineHeight: 56, letterSpacing: -2 },
  coverYear:       { fontSize: 16, color: "#00d47e", fontWeight: "700", marginTop: 12 },
  coverUser:       { position: "absolute", bottom: 48, left: 0, right: 0, alignItems: "center", zIndex: 5 },
  coverUserLabel:  { fontSize: 12, color: "#6b7280", marginBottom: 4 },
  coverUserName:   { fontSize: 22, fontWeight: "900", color: "#fff" },

  // Slides common
  eyebrow:         { fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  slideTitle:      { fontSize: 36, fontWeight: "900", color: "#fff", lineHeight: 42, letterSpacing: -1 },
  emptyNote:       { fontSize: 14, color: "#6b7280", lineHeight: 22 },

  // Stocks
  stockRow:        { flexDirection: "row", alignItems: "center", gap: 14 },
  stockRank:       { fontSize: 28, fontWeight: "900", color: "rgba(255,255,255,0.15)", width: 32, textAlign: "center" },
  stockCard:       { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "rgba(0,212,126,0.07)", borderWidth: 1, borderColor: "rgba(0,212,126,0.18)", borderRadius: 16, padding: 14 },
  stockTicker:     { fontSize: 20, fontWeight: "900", color: "#fff" },
  stockSub:        { fontSize: 11, color: "#6b7280", marginTop: 2 },
  stockPct:        { fontSize: 22, fontWeight: "900" },

  // Stats
  bigStatCard:     { borderRadius: 20, borderWidth: 1, padding: 24, gap: 6 },
  bigStatNum:      { fontSize: 64, fontWeight: "900", lineHeight: 68 },
  bigStatLabel:    { fontSize: 16, color: "#e5e7eb", fontWeight: "700" },
  bigStatSub:      { fontSize: 12, color: "#6b7280" },
  smallStatCard:   { backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: 16, padding: 18 },
  smallStatNum:    { fontSize: 40, fontWeight: "900", color: "#fff" },
  smallStatLabel:  { fontSize: 13, color: "#9ca3af", marginTop: 2 },
  sectorName:      { fontSize: 40, fontWeight: "900", textAlign: "center", lineHeight: 48 },
  creditLine:      { fontSize: 12, color: "#6b7280", textAlign: "center" },

  // Share
  shareBtn:        { width: "100%", paddingVertical: 16, borderRadius: 18, backgroundColor: "#00d47e", alignItems: "center", shadowColor: "#00d47e", shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  shareBtnText:    { color: "#fff", fontSize: 16, fontWeight: "900" },

  // Small logo (bottom of each slide)
  smallLogoRow:    { position: "absolute", bottom: 40, left: 32, flexDirection: "row", alignItems: "center", gap: 8 },
  smallLogoBox:    { width: 24, height: 24, borderRadius: 7, backgroundColor: "#00d47e", alignItems: "center", justifyContent: "center" },
  smallLogoLetter: { color: "#0d1117", fontSize: 12, fontWeight: "900" },
  smallLogoName:   { color: "#374151", fontSize: 12, fontWeight: "700" },

  // Tap zones
  tapZones:        { position: "absolute", inset: 0, flexDirection: "row", top: 80, bottom: 80 },
});
