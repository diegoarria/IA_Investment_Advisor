import React, { useEffect, useRef, useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { BASE_URL } from "../lib/api";
import { useTheme } from "../lib/ThemeContext";

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

export default function VoiceCallModal({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const [status, setStatus] = useState<CallStatus>("connecting");
  const [caption, setCaption] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

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

  useEffect(() => {
    if (!visible) return;
    closedRef.current = false;
    start();
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function start() {
    try {
      const { status: permStatus } = await Audio.requestPermissionsAsync();
      if (permStatus !== "granted") {
        setStatus("error");
        setErrorMsg("Necesito permiso de micrófono para la llamada.");
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
      };
      ws.onmessage = (ev) => handleServerMessage(ev.data as string);
      ws.onerror = () => {
        if (!closedRef.current) {
          setStatus("error");
          setErrorMsg("No se pudo conectar con el Mentor.");
        }
      };
      ws.onclose = () => {
        if (!closedRef.current) {
          setStatus("error");
          setErrorMsg("La llamada se cerró inesperadamente.");
        }
      };
    } catch (e) {
      setStatus("error");
      setErrorMsg("No se pudo iniciar la llamada.");
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
      // Recording setup failed — surface but don't crash the call
      setErrorMsg("No se pudo acceder al micrófono.");
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
        setCaption(msg.text || "");
        assistantSpeakingRef.current = true;
        awaitingMoreRef.current = true;
        setStatus("assistant_speaking");
        break;
      case "assistant_sentence":
        setCaption(msg.text || "");
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
        setErrorMsg(msg.detail || "Ocurrió un error.");
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
      setCaption("");
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
    setCaption("");
  }

  function cleanup() {
    closedRef.current = true;
    if (meteringTimerRef.current) clearInterval(meteringTimerRef.current);
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

  const statusLabel: Record<CallStatus, string> = {
    connecting: "Conectando...",
    listening: "Escuchando...",
    user_speaking: "Te estoy escuchando",
    assistant_speaking: "El Mentor está hablando",
    error: "Error en la llamada",
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={handleHangUp}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity onPress={handleHangUp} style={styles.closeBtn}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>

          <View
            style={[
              styles.avatar,
              {
                backgroundColor: status === "assistant_speaking" ? "#00b96d22" : status === "user_speaking" ? "#3b82f622" : colors.bgRaised,
                borderColor: status === "assistant_speaking" ? "#00b96d" : status === "user_speaking" ? "#3b82f6" : colors.border,
              },
            ]}
          >
            <Ionicons
              name={status === "assistant_speaking" ? "volume-high" : "mic"}
              size={32}
              color={status === "assistant_speaking" ? "#00b96d" : status === "user_speaking" ? "#3b82f6" : colors.textMuted}
            />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>Llamada con Mentor IA</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            {status === "error" ? errorMsg : statusLabel[status]}
          </Text>

          {!!caption && (
            <Text style={[styles.caption, { color: colors.textSub }]} numberOfLines={4}>
              {caption}
            </Text>
          )}

          <TouchableOpacity onPress={handleHangUp} style={styles.hangupBtn}>
            <Ionicons name="call" size={24} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 340, borderRadius: 28, borderWidth: 1, padding: 28, alignItems: "center", gap: 14 },
  closeBtn: { position: "absolute", top: 14, right: 14, padding: 6 },
  avatar: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "700" },
  subtitle: { fontSize: 13 },
  caption: { fontSize: 13, lineHeight: 19, textAlign: "center", maxHeight: 100 },
  hangupBtn: { width: 60, height: 60, borderRadius: 30, backgroundColor: "#ef4444", alignItems: "center", justifyContent: "center", marginTop: 8 },
});
