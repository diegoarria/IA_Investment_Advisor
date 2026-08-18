import React, { useState, useRef, useEffect } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
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

// "Explícame esto" — the same mentor that narrates Arthur voice calls,
// but on-demand per screen instead of an always-on ambient avatar. Each
// screen just passes its own already-computed context; no new data fetch.
export default function ExplainButton({
  screen,
  context,
  bottomOffset = 12,
}: {
  screen: string;
  context: Record<string, unknown>;
  // Distance from the screen's bottom edge — tab screens need extra room to
  // clear the bottom tab bar; stack screens (no tab bar) can sit lower.
  // Was 24 — Diego wanted the button lower on all 4 screens it appears on.
  bottomOffset?: number;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const profile = useAppStore((s) => s.profile);
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);
  const mentor = getMentorInfo(profile?.mentor);

  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [text, setText] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);
  // Was in-memory only (useState(false)) — dismissing just collapsed the
  // button to a small tappable icon that came right back full-size on the
  // next remount (navigating away and back, or reopening the app), which
  // from the user's side looked exactly like the X doing nothing at all
  // (Diego: "le he dado clic a la X mil veces... pero sigue apareciendo").
  // Persisted per screen now, and null (not yet loaded) renders nothing so
  // there's no flash of the full button before the stored value resolves.
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const dismissKey = `nuvos_explain_dismissed:${screen}`;
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(dismissKey)
      .then((v) => { if (!cancelled) setDismissed(v === "1"); })
      .catch(() => { if (!cancelled) setDismissed(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissKey]);

  const stop = async () => {
    if (soundRef.current) {
      await soundRef.current.stopAsync().catch(() => {});
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    setState("idle");
  };

  const handleDismiss = async () => {
    if (state === "playing") await stop();
    setDismissed(true);
    AsyncStorage.setItem(dismissKey, "1").catch(() => {});
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
    // Without this guard, a fast double-tap while the first request is still
    // in flight re-enters here before `state` has re-rendered to "loading",
    // re-checks the (still-empty) cache, and fires a second paid Haiku+TTS
    // call — duplicating the exact spend the cache above exists to avoid.
    if (state === "loading") return;

    const cacheKey = `nuvos_explain:${screen}:${i18n.language}:${hashContext(context)}`;
    setErrorMsg(null);
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
      // Used to just revert to the idle icon with zero feedback — a premium
      // user tapping "Explícame esto" and getting nothing back couldn't tell
      // "I tapped wrong" from "the paid feature just failed."
      setState("idle");
      setErrorMsg(t("explainButton.error"));
      setTimeout(() => setErrorMsg((cur) => (cur === null ? cur : null)), 4000);
    }
  };

  const brandGreen = colors.accentLight;

  // dismissed === null: still reading the persisted value — render nothing
  // rather than flash the full button and then hide it a beat later.
  // dismissed === true: the user closed it on this screen before — gone
  // for good, not just collapsed to a re-openable icon.
  if (dismissed !== false) return null;

  return (
    <View style={{ position: "absolute", bottom: bottomOffset, right: 16, zIndex: 30 }}>
      <TouchableOpacity
        onPress={handlePress}
        style={{
          flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 12, paddingRight: 24, paddingVertical: 9, borderRadius: 20,
          backgroundColor: brandGreen,
          shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4,
        }}
      >
        {state === "loading" ? (
          <ActivityIndicator size="small" color="#000" />
        ) : state === "playing" ? (
          <Ionicons name="stop" size={14} color="#000" />
        ) : (
          <Text style={{ fontSize: 13 }}>{mentor?.emoji ?? "🎙️"}</Text>
        )}
        <Text style={{ fontSize: 12, fontWeight: "800", color: "#000" }}>
          {state === "loading" ? t("explainButton.loading") : state === "playing" ? t("explainButton.stop") : t("explainButton.cta")}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={handleDismiss}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={{
          position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10,
          alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
        }}
      >
        <Ionicons name="close" size={12} color={colors.textMuted} />
      </TouchableOpacity>

      {(errorMsg || (text && state !== "idle")) && (
        <View style={{ position: "absolute", bottom: "100%", right: 0, marginBottom: 8, width: 240, padding: 10, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: errorMsg ? "#ef4444" : colors.border, zIndex: 20 }}>
          <Text style={{ fontSize: 12, lineHeight: 17, color: errorMsg ? "#ef4444" : colors.textSub }}>{errorMsg || text}</Text>
        </View>
      )}

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("explainButton.paywallReason")} />
    </View>
  );
}
