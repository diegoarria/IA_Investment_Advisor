import React, { useState, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as SecureStore from "expo-secure-store";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../src/lib/ThemeContext";
import { researchApi } from "../../src/lib/api";

interface Block { type: string; data: unknown }
interface Report { id: string; title: string; companies: string[]; blocks: Block[] }

const BLOCK_TITLES: Record<string, string> = {
  executive_summary: "Resumen Ejecutivo",
  business_overview: "Visión General del Negocio",
  recent_changes: "Cambios Recientes",
  business_model: "Modelo de Negocio",
  competitive_advantages: "Ventajas Competitivas",
  industry_analysis: "Análisis de la Industria",
  competitor_comparison: "Comparación con Competidores",
  financial_analysis: "Análisis Financiero",
  management_evaluation: "Evaluación de la Gerencia",
  risk_analysis: "Análisis de Riesgos",
  catalysts: "Catalizadores",
  valuation: "Valuación",
  historical_performance: "Desempeño Histórico",
  portfolio_compatibility: "Compatibilidad con tu Portafolio",
  alternative_ideas: "Ideas Alternativas",
  investment_thesis: "Tesis de Inversión",
  key_takeaways: "Puntos Clave",
  sources: "Fuentes",
};

function BlockContent({ data, colors }: { data: unknown; colors: any }) {
  if (typeof data === "string") {
    return <Text style={{ fontSize: 13, lineHeight: 19, color: colors.textSub }}>{data}</Text>;
  }
  if (Array.isArray(data)) {
    return (
      <View style={{ gap: 6 }}>
        {data.map((item, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 6 }}>
            <Text style={{ color: colors.accentLight }}>•</Text>
            <Text style={{ flex: 1, fontSize: 13, lineHeight: 19, color: colors.textSub }}>
              {typeof item === "string" ? item : JSON.stringify(item)}
            </Text>
          </View>
        ))}
      </View>
    );
  }
  if (data && typeof data === "object") {
    return (
      <View style={{ gap: 10 }}>
        {Object.entries(data as Record<string, unknown>).map(([key, value]) => (
          <View key={key}>
            <Text style={{ fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, color: colors.textMuted, marginBottom: 3 }}>
              {key.replace(/_/g, " ")}
            </Text>
            <BlockContent data={value} colors={colors} />
          </View>
        ))}
      </View>
    );
  }
  return null;
}

export default function ResearchReportScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!id) return;
    researchApi.getReport(id).then((res) => setReport(res.data)).catch(() => setReport(null)).finally(() => setLoading(false));
  }, [id]);

  const handleDownload = async () => {
    if (!report) return;
    setDownloading(true);
    try {
      const token = await SecureStore.getItemAsync("access_token");
      const path = (FileSystem.cacheDirectory ?? "") + `nuvos-deep-research-${report.id.slice(0, 8)}.pdf`;
      const result = await FileSystem.downloadAsync(researchApi.downloadPdfUrl(report.id), path, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, { mimeType: "application/pdf" });
      }
    } catch {}
    setDownloading(false);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          {report?.title || t("research.report.loading")}
        </Text>
        <TouchableOpacity onPress={handleDownload} disabled={!report || downloading} style={styles.backBtn}>
          {downloading ? <ActivityIndicator size="small" color={colors.accentLight} /> : <Ionicons name="download-outline" size={20} color={colors.accentLight} />}
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.accentLight} /></View>
      ) : !report ? (
        <View style={styles.center}><Text style={{ color: colors.textMuted }}>{t("research.report.notFound")}</Text></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {report.companies?.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
              {report.companies.map((c) => (
                <View key={c} style={{ backgroundColor: colors.bgRaised, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Text style={{ fontSize: 11, fontWeight: "800", color: colors.textSub }}>{c}</Text>
                </View>
              ))}
            </View>
          )}
          {report.blocks?.map((block, i) => (
            <View key={i} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={{ fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5, color: colors.accentLight, marginBottom: 10 }}>
                {BLOCK_TITLES[block.type] ?? block.type.replace(/_/g, " ")}
              </Text>
              <BlockContent data={block.data} colors={colors} />
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8 },
  backBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 14, fontWeight: "800", textAlign: "center", marginHorizontal: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 12 },
});
