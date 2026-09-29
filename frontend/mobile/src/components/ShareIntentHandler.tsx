import React, { useEffect, useRef, useState } from "react";
import { Modal, View, Text, ActivityIndicator, StyleSheet, Alert } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useShareIntent, ShareIntentModule } from "expo-share-intent";
import { useTheme } from "../lib/ThemeContext";
import { importsApi } from "../lib/api";

// Compartir desde la app del broker (Diego, 2026-09-29): a screenshot/PDF
// shared to Nuvos from GBM/Actinver/any app is read by Arthur, reconciled
// with the portfolio, and opens Arthur's conversation to register it with
// one tap. Native share extension — inert in Expo Go (module is null).
export default function ShareIntentHandler() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ disabled: !ShareIntentModule, resetOnBackground: true });
  const [busy, setBusy] = useState(false);
  const handling = useRef(false);

  useEffect(() => {
    if (!hasShareIntent || handling.current) return;
    const files = (shareIntent.files ?? []).filter((f) =>
      (f.mimeType ?? "").startsWith("image/") || (f.mimeType ?? "").includes("pdf") || (f.fileName ?? "").toLowerCase().endsWith(".pdf"));
    if (files.length === 0) { resetShareIntent(); return; }
    handling.current = true;
    setBusy(true);
    (async () => {
      try {
        const payload = [];
        for (const f of files.slice(0, 5)) {
          const content = await FileSystem.readAsStringAsync(f.path, { encoding: FileSystem.EncodingType.Base64 });
          payload.push({ filename: f.fileName ?? "archivo", content_type: f.mimeType ?? "image/jpeg", content });
        }
        const r = await importsApi.shared(payload);
        const res = r.data as { ok: boolean; kind?: string; session_id?: string };
        if (res.ok && res.session_id) {
          router.navigate({ pathname: "/(tabs)/chat", params: { arthur: res.session_id } });
        } else {
          Alert.alert(t("shareImport.nothingTitle"), t("shareImport.nothingBody"));
        }
      } catch {
        Alert.alert(t("shareImport.errorTitle"), t("shareImport.errorBody"));
      } finally {
        setBusy(false);
        handling.current = false;
        resetShareIntent();
      }
    })();
  }, [hasShareIntent]);

  return (
    <Modal visible={busy} transparent animationType="fade">
      <View style={s.overlay}>
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <ActivityIndicator size="large" color={colors.accentLight} />
          <Text style={[s.title, { color: colors.text }]}>{t("shareImport.reading")}</Text>
          <Text style={[s.sub, { color: colors.textSub }]}>{t("shareImport.readingSub")}</Text>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 32 },
  card: { borderRadius: 22, borderWidth: 1, padding: 24, alignItems: "center", width: "100%", gap: 10 },
  title: { fontSize: 16, fontWeight: "800", textAlign: "center" },
  sub: { fontSize: 13, textAlign: "center", lineHeight: 19 },
});
