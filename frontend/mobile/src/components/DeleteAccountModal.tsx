import React, { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, Modal, ActivityIndicator, Platform, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useTheme } from "../lib/ThemeContext";
import { useAppStore } from "../lib/profileStore";
import { useChatStore } from "../lib/chatStore";
import { rcLogOut } from "../lib/revenuecat";
import { authApi } from "../lib/api";
import { useDeleteAccountModal } from "../lib/deleteAccountModal";
import { usePaywallModalGuard } from "../lib/paywallModalGuard";
import { confirmWordMatches } from "../lib/deleteAccountConfirm";

// Diego, 2026-11-14: Apple rejected build 46 (Guideline 5.1.1(v)) saying
// there was no way to delete the account — the real flow (DELETE
// /auth/account, already atomic/robust server-side, see auth.py) existed
// since 2026-05 and survived an identical rejection on build 36, but stayed
// a small text link the reviewer missed both times. This replaces the old
// nested-Alert.alert confirmation with a single, unmissable, always-visible
// modal reachable from both Sidebar and Profile, requiring the user to type
// the exact confirm word (no accidental double-tap-through) before the
// delete button even enables.
//
// "Siempre funciona, nunca falla silenciosamente": on any failure (network,
// server, partial state) this modal stays open and shows the real error —
// it never logs the user out or claims success unless DELETE /auth/account
// itself returned success. See auth.py's delete_account: the server call is
// atomic (all user data tables or none) and safe to retry if it ever fails
// after the Plaid-revocation step but before finishing.
export default function DeleteAccountModal() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const isOpen = useDeleteAccountModal((s) => s.isOpen);
  const close = useDeleteAccountModal((s) => s.close);
  const logout = useAppStore((s) => s.logout);

  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmWord = t("profile.deleteAccountConfirmWord");
  const canDelete = confirmWordMatches(confirmText, confirmWord);

  useEffect(() => {
    if (!isOpen) return;
    usePaywallModalGuard.getState().claim();
    return () => usePaywallModalGuard.getState().release();
  }, [isOpen]);

  const reset = () => {
    setConfirmText("");
    setError(null);
    setDeleting(false);
  };

  const handleClose = () => {
    if (deleting) return; // never let the modal be dismissed mid-request
    reset();
    close();
  };

  const handleDelete = async () => {
    if (!canDelete || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await authApi.deleteAccount();
    } catch {
      setError(t("profile.deleteAccountError"));
      setDeleting(false);
      return;
    }
    // Only reached on a real, confirmed-deleted server response.
    useChatStore.getState().createSession();
    logout();
    SecureStore.deleteItemAsync("access_token").catch(() => {});
    SecureStore.deleteItemAsync("refresh_token").catch(() => {});
    SecureStore.deleteItemAsync("user_id").catch(() => {});
    rcLogOut().catch(() => {});
    reset();
    close();
    router.replace("/");
  };

  return (
    <Modal visible={isOpen} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <View style={{ width: "100%", maxWidth: 420, borderRadius: 20, borderWidth: 1, padding: 24, backgroundColor: colors.card, borderColor: colors.border }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <Ionicons name="warning" size={22} color="#ef4444" />
            <Text style={{ fontSize: 18, fontWeight: "900", color: colors.text, flex: 1 }}>
              {t("profile.deleteAccountTitle")}
            </Text>
          </View>

          <Text style={{ fontSize: 13, color: colors.textMuted, lineHeight: 19, marginBottom: 12 }}>
            {t("profile.deleteAccountMsg")}
          </Text>

          {/* Apple 5.1.1(v) explicitly requires both of these: deleting the
              account does NOT touch Apple's own subscription billing, and
              the user must be able to reach subscription management from
              right here — StoreKit purchases are cancelled only through
              Apple, never through our backend. */}
          {Platform.OS === "ios" && (
            <View style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, padding: 12, marginBottom: 16 }}>
              <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 18, marginBottom: 8 }}>
                {t("profile.deleteAccountSubscriptionNote")}
              </Text>
              <TouchableOpacity onPress={() => Linking.openURL("https://apps.apple.com/account/subscriptions")}>
                <Text style={{ fontSize: 12, fontWeight: "800", color: colors.accentLight ?? "#00d47e" }}>
                  {t("profile.deleteAccountManageSubscription")}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={{ fontSize: 12, fontWeight: "700", color: colors.textSub, marginBottom: 8 }}>
            {t("profile.deleteAccountTypeInstruction", { word: confirmWord })}
          </Text>

          <TextInput
            value={confirmText}
            onChangeText={(v) => { setConfirmText(v); if (error) setError(null); }}
            placeholder={confirmWord}
            placeholderTextColor={colors.textDim}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!deleting}
            style={{
              borderWidth: 1.5,
              borderColor: canDelete ? "#ef4444" : colors.border,
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: Platform.OS === "ios" ? 12 : 8,
              fontSize: 16,
              fontWeight: "700",
              color: colors.text,
              marginBottom: 14,
            }}
          />

          {error && (
            <Text style={{ fontSize: 12, color: "#ef4444", marginBottom: 14, lineHeight: 17 }}>
              {error}
            </Text>
          )}

          <TouchableOpacity
            onPress={handleDelete}
            disabled={!canDelete || deleting}
            activeOpacity={0.85}
            style={{
              borderRadius: 14,
              paddingVertical: 14,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 8,
              backgroundColor: "#ef4444",
              opacity: canDelete && !deleting ? 1 : 0.4,
              marginBottom: 10,
            }}
          >
            {deleting && <ActivityIndicator size="small" color="#fff" />}
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 15 }}>
              {deleting ? t("profile.deleteAccountDeleting") : t("profile.deleteAccountYes")}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={handleClose} disabled={deleting} style={{ paddingVertical: 10, alignItems: "center" }}>
            <Text style={{ color: colors.textDim, fontSize: 13, fontWeight: "600" }}>
              {t("common.cancel")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
