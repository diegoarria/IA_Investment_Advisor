import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

const YEAR = new Date().getFullYear();

const COMING_FEATURES = [
  { icon: "🚀", text: "Top 3 acciones de tu portafolio con mejor rendimiento" },
  { icon: "🧠", text: "Total de lecciones y simulaciones completadas" },
  { icon: "🏆", text: "Tu sector de mayor exposición en el año" },
  { icon: "📊", text: "Días activo en la plataforma" },
];

export default function WrappedScreen() {
  return (
    <View style={s.root}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* Close */}
        <TouchableOpacity onPress={() => router.back()} style={s.closeBtn}>
          <Text style={s.closeTxt}>✕</Text>
        </TouchableOpacity>

        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

          {/* Logo */}
          <View style={s.logoRow}>
            <View style={s.logoBox}><Text style={s.logoLetter}>N</Text></View>
            <Text style={s.logoName}>Nuvos AI</Text>
          </View>

          {/* Title */}
          <View style={s.titleBlock}>
            <Text style={s.eyebrow}>Próximamente</Text>
            <Text style={s.title}>Annual{"\n"}ScoreBoard</Text>
            <Text style={s.year}>{YEAR}</Text>
          </View>

          {/* Main card */}
          <View style={s.card}>
            <Text style={s.cardIcon}>📅</Text>
            <Text style={s.cardTitle}>
              Tu Annual ScoreBoard estará disponible en diciembre {YEAR}
            </Text>
            <Text style={s.cardBody}>
              Sigue acumulando historial inversionista — cada simulación, debate y decisión que tomes este año quedará registrada en tu resumen anual.
            </Text>
          </View>

          {/* Features list */}
          <View style={s.featuresList}>
            {COMING_FEATURES.map(({ icon, text }) => (
              <View key={text} style={s.featureRow}>
                <Text style={s.featureIcon}>{icon}</Text>
                <Text style={s.featureText}>{text}</Text>
              </View>
            ))}
          </View>

          {/* CTA */}
          <TouchableOpacity onPress={() => router.back()} style={s.cta} activeOpacity={0.85}>
            <Text style={s.ctaText}>¡Lo espero con ansias! 🎯</Text>
          </TouchableOpacity>

          {/* Small logo bottom */}
          <View style={s.bottomLogo}>
            <View style={s.smallLogoBox}><Text style={s.smallLogoLetter}>N</Text></View>
            <Text style={s.smallLogoName}>Nuvos AI</Text>
          </View>

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root:           { flex: 1, backgroundColor: "#0d1117" },
  closeBtn:       { position: "absolute", top: 16, right: 16, zIndex: 10, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 10, width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  closeTxt:       { color: "#fff", fontSize: 14, fontWeight: "700" },

  scroll:         { padding: 28, paddingTop: 56, gap: 24, paddingBottom: 40 },

  logoRow:        { flexDirection: "row", alignItems: "center", gap: 10 },
  logoBox:        { width: 36, height: 36, borderRadius: 10, backgroundColor: "#00d47e", alignItems: "center", justifyContent: "center" },
  logoLetter:     { color: "#0d1117", fontSize: 18, fontWeight: "900" },
  logoName:       { color: "#fff", fontSize: 16, fontWeight: "900" },

  titleBlock:     { gap: 4 },
  eyebrow:        { fontSize: 11, fontWeight: "900", color: "#00d47e", letterSpacing: 0.8, textTransform: "uppercase" },
  title:          { fontSize: 48, fontWeight: "900", color: "#fff", lineHeight: 52, letterSpacing: -2 },
  year:           { fontSize: 15, color: "#00d47e", fontWeight: "700", marginTop: 4 },

  card:           { backgroundColor: "rgba(0,212,126,0.06)", borderWidth: 1, borderColor: "rgba(0,212,126,0.18)", borderRadius: 20, padding: 24, gap: 12 },
  cardIcon:       { fontSize: 32 },
  cardTitle:      { fontSize: 17, fontWeight: "900", color: "#fff", lineHeight: 24 },
  cardBody:       { fontSize: 14, color: "#6b7280", lineHeight: 22 },

  featuresList:   { gap: 14 },
  featureRow:     { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  featureIcon:    { fontSize: 18, width: 24 },
  featureText:    { flex: 1, fontSize: 14, color: "#8fa3c0", lineHeight: 20 },

  cta:            { backgroundColor: "#00d47e", borderRadius: 18, paddingVertical: 16, alignItems: "center", shadowColor: "#00d47e", shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  ctaText:        { color: "#fff", fontSize: 16, fontWeight: "900" },

  bottomLogo:     { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", marginTop: 8 },
  smallLogoBox:   { width: 22, height: 22, borderRadius: 6, backgroundColor: "#00d47e", alignItems: "center", justifyContent: "center" },
  smallLogoLetter:{ color: "#0d1117", fontSize: 11, fontWeight: "900" },
  smallLogoName:  { color: "#374151", fontSize: 12, fontWeight: "700" },
});
