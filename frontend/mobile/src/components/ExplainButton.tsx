import React, { useState, useRef } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";
import { useAppStore } from "../lib/profileStore";
import { useSubscriptionStore, hasPremiumAccess } from "../lib/subscriptionStore";
import { getMentorInfo } from "../lib/mentorData";
import { explainApi } from "../lib/api";
import PaywallModal from "./PaywallModal";

// Re-tapping the button seconds later with an unchanged context (e.g. price
// hasn't moved) would otherwise re-charge Haiku + TTS for an identical
// answer — cache the last response per screen+context+lang for a couple of
// minutes so those repeat taps are instant and free.
const EXPLAIN_CACHE_TTL_MS = 2 * 60 * 1000;

function hashContext(context: Record<string, unknown>): string {
  const s = JSON.stringify(context);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

interface CachedExplanation { text: string; audio: string | null; ts: number }

async function readExplainCache(key: string): Promise<CachedExplanation | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const entry: CachedExplanation = JSON.parse(raw);
    if (Date.now() - entry.ts > EXPLAIN_CACHE_TTL_MS) return null;
    return entry;
  } catch { return null; }
}

async function writeExplainCache(key: string, text: string, audio: string | null) {
  try { await AsyncStorage.setItem(key, JSON.stringify({ text, audio, ts: Date.now() } as CachedExplanation)); } catch { /* ignore */ }
}

// "Explícame esto" — the same mentor that narrates Mentor IA voice calls,
// but on-demand per screen instead of an always-on ambient avatar. Each
// screen just passes its own already-computed context; no new data fetch.
export default function ExplainButton({
  screen,
  context,
  style,
}: {
  screen: string;
  context: Record<string, unknown>;
  style?: StyleProp<ViewStyle>;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const profile = useAppStore((s) => s.profile);
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);
  const mentor = getMentorInfo(profile?.mentor);

  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [text, setText] = useState<string | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  const stop = async () => {
    if (soundRef.current) {
      await soundRef.current.stopAsync().catch(() => {});
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    setState("idle");
  };

  const playAudio = async (b64: string) => {
    const path = (FileSystem.cacheDirectory ?? "") + "nuvos_explain.mp3";
    await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
    const { sound } = await Audio.Sound.createAsync({ uri: path });
    soundRef.current = sound;
    setState("playing");
    await sound.playAsync();
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        setState("idle");
        sound.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
    });
  };

  const handlePress = async () => {
    if (!isPremium) { setPaywallOpen(true); return; }
    if (state === "playing") { await stop(); return; }

    const cacheKey = `nuvos_explain:${screen}:${i18n.language}:${hashContext(context)}`;
    const cached = await readExplainCache(cacheKey);
    if (cached) {
      setText(cached.text);
      if (cached.audio) { await playAudio(cached.audio).catch(() => setState("idle")); } else { setState("idle"); }
      return;
    }

    setState("loading");
    setText(null);
    try {
      const res: any = await explainApi.explain(screen, context, i18n.language);
      const resultText = res.data?.text || "";
      setText(resultText || null);
      if (resultText) writeExplainCache(cacheKey, resultText, res.data?.audio || null);
      if (!res.data?.audio) { setState("idle"); return; }
      await playAudio(res.data.audio);
    } catch {
      setState("idle");
    }
  };

  const mentorColor = mentor?.color ?? colors.accentLight;

  return (
    <View>
      <TouchableOpacity
        onPress={handlePress}
        style={[
          { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: `${mentorColor}18` },
          style,
        ]}
      >
        {state === "loading" ? (
          <ActivityIndicator size="small" color={mentorColor} />
        ) : state === "playing" ? (
          <Ionicons name="stop" size={14} color={mentorColor} />
        ) : (
          <Text style={{ fontSize: 13 }}>{mentor?.emoji ?? "🎙️"}</Text>
        )}
        <Text style={{ fontSize: 12, fontWeight: "800", color: mentorColor }}>
          {state === "loading" ? t("explainButton.loading") : state === "playing" ? t("explainButton.stop") : t("explainButton.cta")}
        </Text>
      </TouchableOpacity>

      {text && state !== "idle" && (
        <View style={{ position: "absolute", top: "100%", right: 0, marginTop: 8, width: 240, padding: 10, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, zIndex: 20 }}>
          <Text style={{ fontSize: 12, lineHeight: 17, color: colors.textSub }}>{text}</Text>
        </View>
      )}

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("explainButton.paywallReason")} />
    </View>
  );
}
