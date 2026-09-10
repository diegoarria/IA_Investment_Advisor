import React, { useState, type ReactNode } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { CompanyDiagnosticHero } from "./CompanyDiagnosticHero";
import { CompanyDiagnosticValuationTabs } from "./CompanyDiagnosticValuationTabs";
import { SelfCheckQuiz } from "./SelfCheckQuiz";
import { CompanyDiagnosticBacktestPanel } from "./CompanyDiagnosticBacktestPanel";
import type { CompanyDiagnosticData } from "../../lib/types/companyDiagnostic";

// Mobile mirror of web's CompanyDiagnosticCard.tsx — hero + 4 collapsible
// pillars, Tesis Final, guía de metodología, Self-Check y disclaimer legal.
// The caller (app/subvaluadas/index.tsx) renders "Actualizado hoy / Seguir
// / Analizar con Arthur" right after this, same as web's page.tsx does.

const NUMBER_PATTERN = /\$\d[\d.,]*(?:\s?(?:mil millones|millones|mil|MM|bn|B|M|K))?|\d[\d.,]*%/gi;

function renderWithBoldNumbers(text: string, colors: any): ReactNode {
  const parts = text.split(NUMBER_PATTERN);
  const matches = text.match(NUMBER_PATTERN) || [];
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (part) out.push(<Text key={`t${i}`}>{part}</Text>);
    if (matches[i]) out.push(<Text key={`n${i}`} style={{ fontWeight: "800", color: colors.text }}>{matches[i]}</Text>);
  });
  return out;
}

function DiagSectionHeader({ title, subtitle, icon, colors }: { title: string; subtitle?: string; icon: ReactNode; colors: any }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 15, fontWeight: "800", color: colors.text }} numberOfLines={1}>{title}</Text>
        {subtitle && <Text style={{ fontSize: 11.5, color: colors.textMuted, marginTop: 2 }} numberOfLines={2}>{subtitle}</Text>}
      </View>
      {icon}
    </View>
  );
}

export function CompanyDiagnosticCard({
  data, colors, locked, onUnlock,
}: {
  data: CompanyDiagnosticData;
  colors: any;
  // Diego, 2026-09-09: past the free weekly search limit, the caller
  // still passes real (never fabricated) data — this just dims everything
  // below the name/logo/price header (rendered by the caller, app/
  // subvaluadas/index.tsx, above this card) and shows an upgrade CTA over
  // it, instead of the search dead-ending on an empty/blocked screen. RN
  // has no reliable text-blur filter (same constraint as MobileWeekly
  // Screener's own free-tier preview), so this dims via opacity, not blur.
  locked?: boolean;
  onUnlock?: () => void;
}) {
  const { t } = useTranslation();
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const methodologyParagraphs = t("companyDiagnostic.methodology.paragraphs", { returnObjects: true }) as string[];

  const content = (
    <View>
      {/* Capa 1 — Hero (simplificado, ver CompanyDiagnosticHero.tsx) */}
      <View style={{ borderRadius: 18, padding: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
        <CompanyDiagnosticHero data={data} colors={colors} />

        {data.sectorModelNote && (
          <View style={{ borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginTop: 15, backgroundColor: "rgba(212,162,76,0.08)", borderWidth: 1, borderColor: "rgba(212,162,76,0.2)" }}>
            <Text style={{ fontSize: 10, fontWeight: "800", textTransform: "uppercase", color: colors.accentLight, marginBottom: 3 }}>
              {t("companyDiagnostic.sectorModelNoteTitle")}
            </Text>
            <Text style={{ fontSize: 11.5, lineHeight: 16, color: colors.textSub }}>{data.sectorModelNote.detalle}</Text>
          </View>
        )}

        {(data.valuation.fcfAssumptions || data.valuation.waccDetails) && (
          <View style={{ marginTop: 8 }}>
            <TouchableOpacity onPress={() => setAssumptionsOpen((o) => !o)}>
              <Text style={{ fontSize: 11, color: colors.textMuted, textDecorationLine: "underline" }}>
                {t("companyDiagnostic.modelAssumptions.toggle")}
              </Text>
            </TouchableOpacity>
            {assumptionsOpen && (
              <View style={{ marginTop: 8, gap: 6 }}>
                {data.valuation.fcfAssumptions && (
                  <>
                    <Text style={{ fontSize: 11, color: colors.textSub }}>
                      {t("companyDiagnostic.modelAssumptions.fcfReported")}:{" "}
                      <Text style={{ fontWeight: "800", color: colors.text }}>
                        {data.valuation.fcfAssumptions.fcf_reported != null ? `$${(data.valuation.fcfAssumptions.fcf_reported / 1e6).toFixed(0)}M` : "—"}
                      </Text>
                      {" · "}{t("companyDiagnostic.modelAssumptions.fcfNormalized")}:{" "}
                      <Text style={{ fontWeight: "800", color: colors.accentLight }}>
                        {data.valuation.fcfAssumptions.fcf_normalized != null ? `$${(data.valuation.fcfAssumptions.fcf_normalized / 1e6).toFixed(0)}M` : "—"}
                      </Text>
                    </Text>
                    {data.valuation.fcfAssumptions.growth_capex_estimate != null && data.valuation.fcfAssumptions.growth_capex_estimate > 0 && (
                      <Text style={{ fontSize: 11, color: colors.textSub }}>
                        {t("companyDiagnostic.modelAssumptions.growthCapex")}:{" "}
                        <Text style={{ fontWeight: "800", color: colors.text }}>${(data.valuation.fcfAssumptions.growth_capex_estimate / 1e6).toFixed(0)}M</Text>
                      </Text>
                    )}
                  </>
                )}
                {data.valuation.waccDetails?.wacc_pct != null && (
                  <Text style={{ fontSize: 11, color: colors.textSub }}>
                    {t("companyDiagnostic.modelAssumptions.wacc")}:{" "}
                    <Text style={{ fontWeight: "800", color: colors.text }}>{data.valuation.waccDetails.wacc_pct.toFixed(1)}%</Text>
                  </Text>
                )}
                {data.valuation.fcfAssumptions?.methodology_note && (
                  <Text style={{ fontSize: 11, color: colors.textDim }}>{data.valuation.fcfAssumptions.methodology_note}</Text>
                )}
              </View>
            )}
          </View>
        )}
      </View>

      {/* Capa 2 — pestañas Valuación/Escenarios/Comparables/Historial (incluye
          el gráfico precio vs. valor razonable) + los 4 pilares como pestañas,
          mismo diseño que la web (CompanyDiagnosticValuationTabs.tsx). */}
      <CompanyDiagnosticValuationTabs data={data} colors={colors} />

      {/* Tesis Final */}
      {data.investmentThesis && (
        <View style={{ marginTop: 14, borderRadius: 18, padding: 15, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.accent }}>
          <DiagSectionHeader
            title={t("companyDiagnostic.thesis.title")}
            subtitle={t("companyDiagnostic.thesis.subtitle")}
            icon={<Ionicons name="locate" size={17} color={colors.accentLight} />}
            colors={colors}
          />
          <Text style={{ fontSize: 14, lineHeight: 20.5, color: colors.textSub, marginTop: 6 }}>
            {renderWithBoldNumbers(data.investmentThesis, colors)}
          </Text>
        </View>
      )}

      {/* Guía de metodología */}
      <View style={{ marginTop: 14, borderRadius: 18, padding: 15, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
        <DiagSectionHeader
          title={t("companyDiagnostic.methodology.title")}
          subtitle={t("companyDiagnostic.methodology.subtitle")}
          icon={<Ionicons name="book" size={17} color={colors.textMuted} />}
          colors={colors}
        />
        <View style={{ marginTop: 6, gap: 8 }}>
          {methodologyParagraphs.map((p, i) => (
            <Text key={i} style={{ fontSize: 13, lineHeight: 19, color: colors.textSub }}>{p}</Text>
          ))}
        </View>
      </View>

      {/* "What $10,000 became" — ticker-independent, moved here from the
          bottom of app/subvaluadas/index.tsx (Diego, 2026-08-19): sits
          right above the Self-Check quiz as motivation/context before the
          user tests their own instinct. Mirrors web's CompanyDiagnosticCard. */}
      <CompanyDiagnosticBacktestPanel colors={colors} />

      {/* Self-Check */}
      <SelfCheckQuiz ticker={data.ticker} colors={colors} />

      {/* Disclaimer */}
      <Text style={{ fontSize: 11, lineHeight: 16, marginTop: 16, textAlign: "center", color: colors.textDim }}>
        {t("companyDiagnostic.disclaimer")}
      </Text>
    </View>
  );

  if (!locked) return content;

  return (
    <View>
      <View style={{ opacity: 0.35 }} pointerEvents="none">
        {content}
      </View>
      <View style={{ position: "absolute", top: 50, left: 0, right: 0, alignItems: "center", paddingHorizontal: 20 }}>
        <View style={{ width: "100%", maxWidth: 340, borderRadius: 18, padding: 20, alignItems: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: "rgba(212,162,76,0.4)" }}>
          <View style={{ width: 44, height: 44, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 10, backgroundColor: "rgba(212,162,76,0.14)" }}>
            <Ionicons name="lock-closed" size={20} color="#D4A24C" />
          </View>
          <Text style={{ fontSize: 14, fontWeight: "800", color: colors.text, marginBottom: 5, textAlign: "center" }}>
            {t("companyDiagnostic.locked.title")}
          </Text>
          <Text style={{ fontSize: 12.5, lineHeight: 17, color: colors.textSub, marginBottom: 16, textAlign: "center" }}>
            {t("companyDiagnostic.locked.body")}
          </Text>
          <TouchableOpacity onPress={onUnlock} style={{ width: "100%", borderRadius: 12, paddingVertical: 12, alignItems: "center", backgroundColor: "#D4A24C" }}>
            <Text style={{ fontSize: 13.5, fontWeight: "800", color: "#0A0F1A" }}>{t("companyDiagnostic.locked.cta")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
