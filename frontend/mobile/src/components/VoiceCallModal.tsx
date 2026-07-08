import React, { useEffect, useRef, useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { useTranslation } from "react-i18next";
import { BASE_URL } from "../lib/api";

interface Props {
  visible: boolean;
  onClose: () => void;
}

type CallStatus = "connecting" | "listening" | "user_speaking" | "assistant_speaking" | "error";

const SPEECH_DB_THRESHOLD = -35; // dBFS, above this = someone is talking
const BARGE_IN_DB_THRESHOLD = -25; // higher bar — must be clearly louder to interrupt
const BARGE_IN_SUSTAIN_MS = 200;
const SILENCE_MS = 900;
const METERING_INTERVAL_MS = 100;

function wsUrl(token: string): string {
  return `${BASE_URL.replace(/^http/, "ws")}/api/voice/call/ws?token=${encodeURIComponent(token)}`;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function VoiceCallModal({ visible, onClose }: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CallStatus>("connecting");
  const [errorMsg, setErrorMsg] = useState("");
  const [muted, setMuted] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const mutedRef = useRef(false);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const meteringTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  const hasSpokenRef = useRef(false);
  const silenceSinceRef = useRef<number | null>(null);
  const bargeInSinceRef = useRef<number | null>(null);
  const assistantSpeakingRef = useRef(false);
  const awaitingMoreRef = useRef(true);
  const playQueueRef = useRef<string[]>([]);
  const finalizingRef = useRef(false);
  const closedRef = useRef(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!visible) return;
    closedRef.current = false;
    start();
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    const isSpeaking = status === "assistant_speaking" || status === "user_speaking";
    if (isSpeaking) {
      pulseLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.12, duration: 550, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 550, useNativeDriver: true }),
        ])
      );
      pulseLoopRef.current.start();
    } else {
      pulseLoopRef.current?.stop();
      pulseAnim.setValue(1);
    }
    return () => pulseLoopRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function start() {
    try {
      const { status: permStatus } = await Audio.requestPermissionsAsync();
      if (permStatus !== "granted") {
        setStatus("error");
        setErrorMsg(t("voiceCallModal.errors.micPermission"));
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

      const token = (await SecureStore.getItemAsync("access_token")) || "";
      const ws = new WebSocket(wsUrl(token));
      wsRef.current = ws;

      ws.onopen = () => {
        if (closedRef.current) return;
        setStatus("listening");
        beginNewSegment();
        durationTimerRef.current = setInterval(() => setCallSeconds((s) => s + 1), 1000);
      };
      ws.onmessage = (ev) => handleServerMessage(ev.data as string);
      ws.onerror = () => {
        if (!closedRef.current) {
          setStatus("error");
          setErrorMsg(t("voiceCallModal.errors.connectFailed"));
        }
      };
      ws.onclose = () => {
        if (!closedRef.current) {
          setStatus("error");
          setErrorMsg(t("voiceCallModal.errors.unexpectedClose"));
        }
      };
    } catch (e) {
      setStatus("error");
      setErrorMsg(t("voiceCallModal.errors.startFailed"));
    }
  }

  async function beginNewSegment() {
    try {
      const { recording } = await Audio.Recording.createAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      recordingRef.current = recording;
      hasSpokenRef.current = false;
      silenceSinceRef.current = null;
      startMeteringLoop();
    } catch (e) {
      setErrorMsg(t("voiceCallModal.errors.micAccessFailed"));
    }
  }

  function startMeteringLoop() {
    if (meteringTimerRef.current) clearInterval(meteringTimerRef.current);
    meteringTimerRef.current = setInterval(async () => {
      const recording = recordingRef.current;
      if (!recording) return;
      let db = -160;
      try {
        const st = await recording.getStatusAsync();
        db = (st as any)?.metering ?? -160;
      } catch {
        return;
      }
      const now = Date.now();

      if (mutedRef.current) return;

      if (assistantSpeakingRef.current) {
        if (db > BARGE_IN_DB_THRESHOLD) {
          if (bargeInSinceRef.current === null) bargeInSinceRef.current = now;
          if (now - bargeInSinceRef.current > BARGE_IN_SUSTAIN_MS) {
            bargeInSinceRef.current = null;
            wsRef.current?.send(JSON.stringify({ type: "barge_in" }));
            await stopAllPlayback();
            await restartSegmentDiscardingCurrent();
          }
        } else {
          bargeInSinceRef.current = null;
        }
        return;
      }

      if (db > SPEECH_DB_THRESHOLD) {
        hasSpokenRef.current = true;
        silenceSinceRef.current = null;
        setStatus("user_speaking");
      } else if (hasSpokenRef.current) {
        if (silenceSinceRef.current === null) silenceSinceRef.current = now;
        else if (now - silenceSinceRef.current > SILENCE_MS) {
          await finalizeSegment();
        }
      }
    }, METERING_INTERVAL_MS);
  }

  async function restartSegmentDiscardingCurrent() {
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (recording) {
      try {
        await recording.stopAndUnloadAsync();
      } catch {}
    }
    setStatus("listening");
    await beginNewSegment();
  }

  async function finalizeSegment() {
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (meteringTimerRef.current) {
      clearInterval(meteringTimerRef.current);
      meteringTimerRef.current = null;
    }
    try {
      if (recording) {
        await recording.stopAndUnloadAsync();
        const uri = recording.getURI();
        if (uri) {
          const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
          wsRef.current?.send(JSON.stringify({ type: "utterance_audio", audio_b64: b64, mime: "audio/m4a" }));
        }
      }
    } catch {
      // swallow — worst case this utterance is lost, call continues
    } finally {
      finalizingRef.current = false;
      await beginNewSegment();
    }
  }

  function handleServerMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case "transcript":
        assistantSpeakingRef.current = true;
        awaitingMoreRef.current = true;
        setStatus("assistant_speaking");
        break;
      case "assistant_sentence":
        if (msg.audio_b64) {
          playQueueRef.current.push(msg.audio_b64);
          if (!soundRef.current) playNextInQueue();
        }
        break;
      case "assistant_done":
        awaitingMoreRef.current = false;
        maybeFinishSpeaking();
        break;
      case "cancelled":
        stopAllPlayback();
        break;
      case "error":
        setErrorMsg(msg.detail || t("voiceCallModal.errors.generic"));
        break;
    }
  }

  async function playNextInQueue() {
    const next = playQueueRef.current.shift();
    if (!next) {
      soundRef.current = null;
      maybeFinishSpeaking();
      return;
    }
    try {
      const path = (FileSystem.cacheDirectory ?? "") + `nuvos_call_${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(path, next, { encoding: FileSystem.EncodingType.Base64 });
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: path });
      soundRef.current = sound;
      assistantSpeakingRef.current = true;
      setStatus("assistant_speaking");
      sound.setOnPlaybackStatusUpdate((st) => {
        if (st.isLoaded && st.didJustFinish) {
          sound.unloadAsync().catch(() => {});
          FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
          playNextInQueue();
        }
      });
      await sound.playAsync();
    } catch {
      playNextInQueue();
    }
  }

  function maybeFinishSpeaking() {
    if (!awaitingMoreRef.current && playQueueRef.current.length === 0 && !soundRef.current) {
      assistantSpeakingRef.current = false;
      setStatus("listening");
    }
  }

  async function stopAllPlayback() {
    playQueueRef.current = [];
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch {}
      soundRef.current = null;
    }
    assistantSpeakingRef.current = false;
    awaitingMoreRef.current = false;
    setStatus("listening");
  }

  function cleanup() {
    closedRef.current = true;
    if (meteringTimerRef.current) clearInterval(meteringTimerRef.current);
    if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (recording) {
      recording.stopAndUnloadAsync().catch(() => {});
    }
    if (soundRef.current) {
      soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    wsRef.current?.close();
    wsRef.current = null;
  }

  function handleHangUp() {
    cleanup();
    onClose();
  }

  function toggleMute() {
    setMuted((m) => {
      const next = !m;
      mutedRef.current = next;
      return next;
    });
  }

  const ringColor = status === "assistant_speaking" ? "#00b96d" : status === "user_speaking" ? "#3b82f6" : "#3a3a3a";
  const subLabel =
    status === "error" ? errorMsg
    : status === "connecting" ? t("voiceCallModal.connecting")
    : formatDuration(callSeconds);

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={handleHangUp}>
      <View style={styles.container}>
        <View style={{ flex: 1 }} />

        <View style={styles.center}>
          <Animated.View style={[styles.avatar, { borderColor: ringColor, transform: [{ scale: pulseAnim }] }]}>
            <Text style={{ fontSize: 56 }}>🤖</Text>
          </Animated.View>
          <Text style={styles.name}>{t("voiceCallModal.mentorName")}</Text>
          <Text style={[styles.subLabel, { color: status === "error" ? "#f87171" : "rgba(255,255,255,0.5)" }]}>
            {subLabel}
          </Text>
        </View>

        <View style={{ flex: 1 }} />

        <View style={styles.controls}>
          <TouchableOpacity
            onPress={toggleMute}
            style={[styles.controlBtn, { backgroundColor: muted ? "#fff" : "rgba(255,255,255,0.14)" }]}
          >
            <Ionicons name={muted ? "mic-off" : "mic"} size={22} color={muted ? "#000" : "#fff"} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleHangUp} style={styles.hangupBtn}>
            <Ionicons name="call" size={26} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", alignItems: "center" },
  center: { alignItems: "center", gap: 16 },
  avatar: {
    width: 144, height: 144, borderRadius: 72, borderWidth: 2,
    backgroundColor: "#1c1c1e", alignItems: "center", justifyContent: "center",
  },
  name: { fontSize: 22, fontWeight: "800", color: "#fff" },
  subLabel: { fontSize: 14, marginTop: -8 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 40, paddingBottom: 64 },
  controlBtn: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  hangupBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#ef4444", alignItems: "center", justifyContent: "center" },
});
