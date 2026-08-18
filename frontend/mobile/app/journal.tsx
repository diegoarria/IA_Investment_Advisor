import React, { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "../src/lib/ThemeContext";
import { useSubscriptionStore, hasPremiumAccess } from "../src/lib/subscriptionStore";
import { researchEngineApi } from "../src/lib/api";
import PaywallModal from "../src/components/PaywallModal";
import MobileDecisionDiary from "../src/components/MobileDecisionDiary";
import MobileInvestmentGraph from "../src/components/MobileInvestmentGraph";

// Mobile mirror of web's /journal page — "Bitácora de Inversión". Was
// previously two separate collapsibles buried inside /profile
// (MobileDecisionDiary + MobileInvestmentGraph); web already promoted
// both out into this own dedicated page plus a new "Tus tesis" section
// that never existed on mobile at all. Every action here calls an
// already-existing backend engine (researchEngineApi) — no new financial
// logic, same as web's own docstring says.

interface MyThesisRow {
  ticker: string;
  version: number;
  thesis_summary: string;
  strengths: { text: string }[];
  critical_variables: { text: string }[];
  key_risks: { text: string }[];
  invalidation_events: { text: string }[];
  created_at: string;
}

interface ReviewResult {
  what_changed: string | null;
  thesis_change_explanation: string | null;
  new_thesis_version: { version: number } | null;
}

function claimsToLines(claims: { text: string }[] | undefined): string {
  return (claims ?? []).map((c) => c.text).join("\n");
}
function linesToList(value: string): string[] {
  return value.split("\n").map((l) => l.trim()).filter(Boolean);
}

function ThesisRow({ thesis, onSaved, colors }: { thesis: MyThesisRow; onSaved: (row: MyThesisRow) => void; colors: any }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(thesis.thesis_summary);
  const [strengths, setStrengths] = useState(claimsToLines(thesis.strengths));
  const [risks, setRisks] = useState(claimsToLines(thesis.key_risks));
  const [criticalVars, setCriticalVars] = useState(claimsToLines(thesis.critical_variables));
  const [invalidation, setInvalidation] = useState(claimsToLines(thesis.invalidation_events));
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!summary.trim()) return;
    setSaving(true);
    try {
      const res: any = await researchEngineApi.saveMyThesis(thesis.ticker, {
        thesis_summary: summary.trim(),
        strengths: linesToList(strengths),
        critical_variables: linesToList(criticalVars),
        key_risks: linesToList(risks),
        invalidation_events: linesToList(invalidation),
      });
      onSaved(res.data);
      setEditing(false);
    } catch {
      // real failure — stay in edit mode so the user can retry
    } finally {
      setSaving(false);
    }
  };

  const handleReview = async () => {
    setReviewing(true);
    setReviewError(null);
    try {
      const res: any = await researchEngineApi.reviewThesis(thesis.ticker);
      setReview(res.data);
    } catch {
      setReviewError(t("investmentJournal.theses.reviewError"));
    } finally {
      setReviewing(false);
    }
  };

  const inputStyle = {
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 12.5, color: colors.text,
    minHeight: 44, textAlignVertical: "top" as const,
  };

  return (
    <View style={{ borderRadius: 14, padding: 13, backgroundColor: colors.bgRaised }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <TouchableOpacity onPress={() => router.push(`/subvaluadas?ticker=${thesis.ticker}` as any)}>
            <Text style={{ fontSize: 14, fontWeight: "800", color: colors.text }}>{thesis.ticker}</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 1 }}>
            {t("investmentJournal.theses.version", { version: thesis.version })}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, shrink: 0 } as any}>
          <TouchableOpacity onPress={() => setEditing((v) => !v)}>
            <Text style={{ fontSize: 11.5, fontWeight: "700", color: colors.accentLight }}>
              {editing ? t("investmentJournal.theses.cancel") : t("investmentJournal.theses.edit")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleReview} disabled={reviewing}>
            <Text style={{ fontSize: 11.5, fontWeight: "700", color: colors.accentLight, opacity: reviewing ? 0.4 : 1 }}>
              {reviewing ? t("investmentJournal.theses.reviewing") : t("investmentJournal.theses.review")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {editing ? (
        <View style={{ gap: 8 }}>
          <TextInput value={summary} onChangeText={setSummary} multiline numberOfLines={2} placeholder={t("investmentJournal.theses.summaryPlaceholder")} placeholderTextColor={colors.placeholder ?? colors.textMuted} style={inputStyle} />
          <TextInput value={risks} onChangeText={setRisks} multiline numberOfLines={2} placeholder={t("investmentJournal.theses.risksPlaceholder")} placeholderTextColor={colors.placeholder ?? colors.textMuted} style={inputStyle} />
          <TextInput value={strengths} onChangeText={setStrengths} multiline numberOfLines={2} placeholder={t("investmentJournal.theses.strengthsPlaceholder")} placeholderTextColor={colors.placeholder ?? colors.textMuted} style={inputStyle} />
          <TextInput value={criticalVars} onChangeText={setCriticalVars} multiline numberOfLines={2} placeholder={t("investmentJournal.theses.criticalVarsPlaceholder")} placeholderTextColor={colors.placeholder ?? colors.textMuted} style={inputStyle} />
          <TextInput value={invalidation} onChangeText={setInvalidation} multiline numberOfLines={2} placeholder={t("investmentJournal.theses.invalidationPlaceholder")} placeholderTextColor={colors.placeholder ?? colors.textMuted} style={inputStyle} />
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving || !summary.trim()}
            style={{ alignSelf: "flex-start", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.accentLight, opacity: saving || !summary.trim() ? 0.4 : 1 }}
          >
            <Text style={{ fontSize: 12, fontWeight: "800", color: "#0a0a0a" }}>
              {saving ? t("investmentJournal.theses.saving") : t("investmentJournal.theses.save")}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={{ fontSize: 12.5, lineHeight: 18, color: colors.textSub }}>{thesis.thesis_summary}</Text>
      )}

      {reviewError && <Text style={{ fontSize: 11, marginTop: 8, color: "#ef4444" }}>{reviewError}</Text>}
      {review && (
        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 5 }}>
          <Text style={{ fontSize: 9.5, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted }}>
            {t("investmentJournal.theses.reviewResultTitle")}
          </Text>
          {review.what_changed ? (
            <>
              <Text style={{ fontSize: 12.5, lineHeight: 18, color: colors.textSub }}>{review.what_changed}</Text>
              {review.thesis_change_explanation && (
                <Text style={{ fontSize: 12.5, lineHeight: 18, color: colors.textSub }}>{review.thesis_change_explanation}</Text>
              )}
              {review.new_thesis_version && (
                <Text style={{ fontSize: 11, color: colors.accentLight }}>
                  {t("investmentJournal.theses.newVersionCreated", { version: review.new_thesis_version.version })}
                </Text>
              )}
            </>
          ) : (
            <Text style={{ fontSize: 12.5, fontStyle: "italic", color: colors.textMuted }}>{t("investmentJournal.theses.noChange")}</Text>
          )}
        </View>
      )}
    </View>
  );
}

export default function JournalScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);

  const [paywallOpen, setPaywallOpen] = useState(false);
  const [theses, setTheses] = useState<MyThesisRow[]>([]);
  const [thesesLoading, setThesesLoading] = useState(true);

  useEffect(() => {
    if (!isPremium) { setThesesLoading(false); return; }
    let cancelled = false;
    researchEngineApi.getAllMyTheses()
      .then((res: any) => { if (!cancelled) setTheses(res.data?.theses ?? []); })
      .catch(() => { if (!cancelled) setTheses([]); })
      .finally(() => { if (!cancelled) setThesesLoading(false); });
    return () => { cancelled = true; };
  }, [isPremium]);

  const handleThesisSaved = (updated: MyThesisRow) => {
    setTheses((prev) => prev.map((t2) => (t2.ticker === updated.ticker ? updated : t2)));
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14 }}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.text} /></TouchableOpacity>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name="create-outline" size={18} color={colors.accentLight} />
          <View>
            <Text style={{ fontSize: 17, fontWeight: "900", color: colors.text }}>{t("investmentJournal.title")}</Text>
            <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>{t("investmentJournal.subtitle")}</Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 16 }}>
        {/* Tus tesis */}
        <View style={{ borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14 }}>
          <Text style={{ fontSize: 14, fontWeight: "800", color: colors.text }}>{t("investmentJournal.theses.title")}</Text>
          <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2, marginBottom: 12 }}>{t("investmentJournal.theses.subtitle")}</Text>

          {!isPremium ? (
            <TouchableOpacity onPress={() => setPaywallOpen(true)}>
              <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.accentLight }}>
                {t("investmentJournal.theses.premiumRequired")}
              </Text>
            </TouchableOpacity>
          ) : thesesLoading ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }}>
              <ActivityIndicator size="small" color={colors.textMuted} />
              <Text style={{ fontSize: 12.5, color: colors.textMuted }}>{t("investmentJournal.theses.loading")}</Text>
            </View>
          ) : theses.length === 0 ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <Text style={{ flex: 1, fontSize: 12.5, color: colors.textMuted }}>{t("investmentJournal.theses.empty")}</Text>
              <TouchableOpacity onPress={() => router.push("/subvaluadas" as any)} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: colors.accentLight }}>{t("investmentJournal.theses.goResearch")}</Text>
                <Ionicons name="chevron-forward" size={13} color={colors.accentLight} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {theses.map((thesis) => (
                <ThesisRow key={thesis.ticker} thesis={thesis} onSaved={handleThesisSaved} colors={colors} />
              ))}
            </View>
          )}
        </View>

        {/* Fortalezas y Puntos Ciegos — promovido desde /profile */}
        <MobileDecisionDiary isPremium={isPremium} onUpgrade={() => setPaywallOpen(true)} />

        {/* Bitácora — Investment Graph — promovido desde /profile */}
        <MobileInvestmentGraph isPremium={isPremium} onUpgrade={() => setPaywallOpen(true)} />
      </ScrollView>

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} />
    </SafeAreaView>
  );
}
