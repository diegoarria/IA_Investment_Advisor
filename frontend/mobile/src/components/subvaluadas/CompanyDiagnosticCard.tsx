import React, { useState, type ReactNode } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { CompanyDiagnosticHero } from "./CompanyDiagnosticHero";
import { CompanyDiagnosticValuationTabs } from "./CompanyDiagnosticValuationTabs";
import { SelfCheckQuiz } from "./SelfCheckQuiz";
import { GlowCard } from "./companyDiagnosticShared";
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

// Section header used by every card below the hero — icon in a tinted
// square on the left, title + subtitle (Nuvos Radar redesign, 2026-09-27).
function DiagSectionHeader({ title, subtitle, icon, colors, tint }: { title: string; subtitle?: string; icon: ReactNode; colors: any; tint?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 }}>
      <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: tint ? `${tint}1f` : colors.bgRaised }}>
        {icon}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 16, fontWeight: "800", color: colors.text, letterSpacing: -0.2 }} numberOfLines={1}>{title}</Text>
        {subtitle && <Text style={{ fontSize: 12, lineHeight: 16, color: colors.textMuted, marginTop: 2 }} numberOfLines={2}>{subtitle}</Text>}
      </View>
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
      <CompanyDiagnosticHero data={data} colors={colors} />

      {(data.sectorModelNote || data.valuation.fcfAssumptions || data.valuation.waccDetails) && (
      <GlowCard colors={colors} style={{ marginTop: 16 }}>
        {data.sectorModelNote && (
          <View style={{ borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "rgba(212,162,76,0.08)", borderLeftWidth: 3, borderLeftColor: "#D4A24C" }}>
            <Text style={{ fontSize: 10, fontWeight: "800", textTransform: "uppercase", color: colors.accentLight, marginBottom: 3 }}>
              {t("companyDiagnostic.sectorModelNoteTitle")}
            </Text>
            <Text style={{ fontSize: 11.5, lineHeight: 16, color: colors.textSub }}>{data.sectorModelNote.detalle}</Text>
          </View>
        )}

        {(data.valuation.fcfAssumptions || data.valuation.waccDetails) && (
          <View style={{ marginTop: data.sectorModelNote ? 14 : 0 }}>
            <TouchableOpacity onPress={() => setAssumptionsOpen((o) => !o)} style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" }}>
              <Ionicons name="options-outline" size={13} color={colors.textMuted} />
              <Text style={{ fontSize: 12, fontWeight: "700", color: colors.textMuted }}>
                {t("companyDiagnostic.modelAssumptions.toggle")}
              </Text>
              <Ionicons name={assumptionsOpen ? "chevron-up" : "chevron-down"} size={12} color={colors.textMuted} />
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
      </GlowCard>
      )}

      {/* Capa 2 — pestañas Valuación/Escenarios/Comparables/Historial (incluye
          el gráfico precio vs. valor razonable) + los 4 pilares como pestañas,
          mismo diseño que la web (CompanyDiagnosticValuationTabs.tsx). */}
      <CompanyDiagnosticValuationTabs data={data} colors={colors} />

      {/* Tesis Final */}
      {data.investmentThesis && (
        <GlowCard colors={colors} tint={colors.accent} strong style={{ marginTop: 16 }}>
          <DiagSectionHeader
            title={t("companyDiagnostic.thesis.title")}
            subtitle={t("companyDiagnostic.thesis.subtitle")}
            icon={<Ionicons name="locate" size={18} color={colors.accentLight} />}
            tint={colors.accent}
            colors={colors}
          />
          <Text style={{ fontSize: 14.5, lineHeight: 22, color: colors.textSub }}>
            {renderWithBoldNumbers(data.investmentThesis, colors)}
          </Text>
        </GlowCard>
      )}

      {/* Guía de metodología */}
      <GlowCard colors={colors} style={{ marginTop: 16 }}>
        <DiagSectionHeader
          title={t("companyDiagnostic.methodology.title")}
          subtitle={t("companyDiagnostic.methodology.subtitle")}
          icon={<Ionicons name="book-outline" size={18} color={colors.textSub} />}
          colors={colors}
        />
        <View style={{ gap: 12 }}>
          {methodologyParagraphs.map((p, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ width: 4, borderRadius: 2, backgroundColor: colors.bgRaised }} />
              <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 20, color: colors.textSub }}>{p}</Text>
            </View>
          ))}
        </View>
      </GlowCard>

      {/* "What $10,000 became" — ticker-independent, moved here from the
          bottom of app/subvaluadas/index.tsx (Diego, 2026-08-19): sits
          right above the Self-Check quiz as motivation/context before the
          user tests their own instinct. Mirrors web's CompanyDiagnosticCard. */}
      <CompanyDiagnosticBacktestPanel colors={colors} />

      {/* Self-Check */}
      <SelfCheckQuiz ticker={data.ticker} colors={colors} />

      {/* Disclaimer */}
      <Text style={{ fontSize: 11, lineHeight: 16, marginTop: 20, paddingHorizontal: 8, textAlign: "center", color: colors.textDim }}>
        {t("companyDiagnostic.disclaimer")}
      </Text>
    </View>
  );

  if (!locked) return content;

  return (
    <View>
      {/* Diego, 2026-09-18: strengthened from 0.35 — past the 3 free weekly
          views, the whole card (hero included, same as web's fix) should
          read as genuinely locked, not just faded. True blur still isn't
          available here (see the constraint noted on `locked` above); a
          real BlurView (expo-blur) would need a new native dependency —
          flagged for Diego, not silently added. */}
      <View style={{ opacity: 0.18 }} pointerEvents="none">
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
