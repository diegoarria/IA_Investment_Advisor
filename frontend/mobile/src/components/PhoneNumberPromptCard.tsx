import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, Modal, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";
import { useAppStore } from "../lib/profileStore";
import { useSubscriptionStore } from "../lib/subscriptionStore";
import { profileApi } from "../lib/api";
import { getDialCodes } from "../lib/dialCodes";

// Diego, 2026-09-24: "Quiero que le pidas 5. Número de teléfono a usuarios
// actuales ... para definir su país y por ende mostrarles el paywall
// correcto para que no haya fallas a la hora de pagar." app/core/
// pricing_region.py's is_mexico() uses country OR a +52 phone number to
// decide whether to show the MXN Stripe price instead of USD — many
// Mexican debit cards decline USD charges outright. New users already get
// asked during onboarding's phone step (optional there); this is the
// one-time catch-up for every EXISTING account that predates it or
// skipped it. "SOLO 1 VEZ EN TODA LA HISTORIA" — has_seen_phone_prompt
// (migration 106) is persisted server-side, same never-twice pattern as
// WelcomeCard's has_seen_welcome_card, and gets set whether the user
// submits a number or dismisses the card — a decline must never come
// back and ask again either.
export default function PhoneNumberPromptCard() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const profile = useAppStore((s) => s.profile);
  const setProfile = useAppStore((s) => s.setProfile);
  const { trialStartDate, hasSeenWelcomeCard, hasFetchedStatus } = useSubscriptionStore();
  const [dialCode, setDialCode] = useState("");
  const [localNumber, setLocalNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const DIAL_CODES = getDialCodes(t);

  // Never stack on top of WelcomeCard (also a full-screen modal, mounted
  // alongside this one in app/_layout.tsx) — a brand new trial user sees
  // that one first; this one waits its turn on their next visit instead of
  // two modals fighting for the same screen.
  const welcomeCardShowing = trialStartDate !== null && !hasSeenWelcomeCard;
  // MANDATORY (Diego, 2026-09-23): shown to anyone signed in without a phone
  // number on file, no skip; anyone who has one (saved on ANY device — it is
  // stored on the account) is never asked.
  const visible = hasFetchedStatus && !!profile && !profile.phone_number && !welcomeCardShowing;
  if (!visible) return null;

  const digits = localNumber.replace(/\D/g, "");
  const dialDigits = dialCode.replace(/\D/g, "").length;
  const valid = !!dialCode && digits.length >= 7 && (dialDigits + digits.length) <= 15;

  const handleSubmit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError("");
    try {
      const phone_number = dialCode + digits;
      await profileApi.update({ phone_number });
      setProfile({ ...profile!, phone_number, has_seen_phone_prompt: true });
      profileApi.markPhonePromptSeen().catch(() => {});
    } catch {
      setError(t("phonePromptCard.error"));
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => {}}>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[s.sheet, { backgroundColor: colors.bg, borderColor: colors.border }]}>
          <ScrollView style={s.scrollFlex} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            <View style={s.header}>
              <View style={[s.iconBox, { backgroundColor: colors.accent, shadowColor: colors.accent }]}>
                <Ionicons name="call" size={26} color={colors.bg} />
              </View>
              <Text style={[s.title, { color: colors.text }]}>{t("phonePromptCard.title")}</Text>
              <Text style={[s.subtitle, { color: colors.textSub }]}>{t("phonePromptCard.subtitle")}</Text>
            </View>

            <Text style={[s.label, { color: colors.textMuted }]}>{t("phonePromptCard.phoneLabel")}</Text>
            <View style={s.dialRow}>
              {DIAL_CODES.map((d) => {
                const active = dialCode === d.code;
                return (
                  <TouchableOpacity
                    key={d.value}
                    onPress={() => setDialCode(d.code)}
                    style={[
                      s.dialChip,
                      { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accentGlow : colors.bgRaised },
                    ]}
                  >
                    <Text style={{ fontSize: 14 }}>{d.emoji}</Text>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: active ? colors.accentLight : colors.textSub }}>{d.code}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput
              style={[s.input, { borderColor: colors.border, backgroundColor: colors.bgRaised, color: colors.text }]}
              value={localNumber}
              onChangeText={setLocalNumber}
              placeholder={t("onboarding.step0.phonePlaceholder")}
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
            />
            {!!error && <Text style={{ color: "#ef4444", fontSize: 12, marginTop: 8 }}>{error}</Text>}

            <TouchableOpacity
              style={[s.cta, { backgroundColor: colors.accent, shadowColor: colors.accent, opacity: (!valid || saving) ? 0.4 : 1 }]}
              onPress={handleSubmit}
              disabled={!valid || saving}
              activeOpacity={0.85}
            >
              <Text style={[s.ctaText, { color: colors.bg }]}>{saving ? t("phonePromptCard.saving") : t("phonePromptCard.save")}</Text>
            </TouchableOpacity>

          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, maxHeight: "92%", overflow: "hidden" },
  scrollFlex: { flex: 1 },
  scroll: { paddingHorizontal: 22, paddingTop: 24, paddingBottom: 32 },
  header: { alignItems: "center", gap: 6, marginBottom: 20 },
  iconBox: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 0 }, marginBottom: 4 },
  title: { fontWeight: "900", fontSize: 19, textAlign: "center", letterSpacing: -0.3 },
  subtitle: { fontSize: 13.5, textAlign: "center", lineHeight: 19, maxWidth: 300 },
  label: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 },
  dialRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  dialChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  cta: { width: "100%", paddingVertical: 15, borderRadius: 16, alignItems: "center", marginTop: 20, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 4 } },
  ctaText: { fontWeight: "900", fontSize: 15 },
  skipBtn: { paddingVertical: 10, alignItems: "center" },
  skipText: { fontSize: 12.5, fontWeight: "600" },
});
