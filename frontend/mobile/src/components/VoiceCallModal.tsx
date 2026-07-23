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

function wsUrl(token: string, resume: boolean): string {
  const resumeParam = resume ? "&resume=1" : "";
  return `${BASE_URL.replace(/^http/, "ws")}/api/voice/call/ws?token=${encodeURIComponent(token)}${resumeParam}`;
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
  // Defaults to on — unlike a private phone call, a hands-free AI mentor call
  // is almost always used on loudspeaker.
  const [speakerOn, setSpeakerOn] = useState(true);
  const speakerOnRef = useRef(true);
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

  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const tokenRef = useRef("");
  const MAX_RECONNECT_ATTEMPTS = 4;
  const HEARTBEAT_MS = 20000;

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

  // Centralizes the audio-mode config so the speaker toggle is respected
  // consistently everywhere audio mode gets (re-)applied — previously start()
  // and playNextInQueue() each called setAudioModeAsync with their own
  // hardcoded literal, so a speaker preference set here would've silently
  // been overwritten the next time a sentence started playing.
  // Note: playThroughEarpieceAndroid reliably controls speaker vs earpiece on
  // Android. iOS has no public expo-av API to force loudspeaker while
  // allowsRecordingIOS is true (required here for continuous barge-in
  // listening) — iOS may still route to the earpiece regardless of this flag.
  async function applyAudioMode() {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      playThroughEarpieceAndroid: !speakerOnRef.current,
    });
  }

  async function start() {
    try {
      const { status: permStatus } = await Audio.requestPermissionsAsync();
      if (permStatus !== "granted") {
        setStatus("error");
        setErrorMsg(t("voiceCallModal.errors.micPermission"));
        return;
      }
      await applyAudioMode();

      tokenRef.current = (await SecureStore.getItemAsync("access_token")) || "";
      connectWebSocket();
    } catch (e) {
      setStatus("error");
      setErrorMsg(t("voiceCallModal.errors.startFailed"));
    }
  }

  // Extracted so it can be called again on reconnect without re-requesting mic
  // permission or dropping any recording already in progress.
  function connectWebSocket() {
    const ws = new WebSocket(wsUrl(tokenRef.current, reconnectAttemptsRef.current > 0));
    wsRef.current = ws;

    ws.onopen = () => {
      if (closedRef.current) return;
      reconnectAttemptsRef.current = 0;
      setIsReconnecting(false);
      setStatus("listening");
      if (!recordingRef.current) beginNewSegment();
      if (!durationTimerRef.current) {
        durationTimerRef.current = setInterval(() => setCallSeconds((s) => s + 1), 1000);
      }
      if (!heartbeatTimerRef.current) {
        // Keeps the connection alive through quiet listening stretches so a
        // load-balancer idle timeout doesn't silently kill a healthy call.
        heartbeatTimerRef.current = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "ping" }));
          }
        }, HEARTBEAT_MS);
      }
    };
    ws.onmessage = (ev) => handleServerMessage(ev.data as string);
    ws.onerror = () => {
      // onclose fires right after onerror for WebSocket failures — let onclose
      // own the retry/error decision so it isn't made twice.
    };
    ws.onclose = (ev: any) => {
      if (closedRef.current) return;
      const code = ev?.code;
      if (code === 4401 || code === 4403) {
        setStatus("error");
        setErrorMsg(code === 4403 ? t("voiceCallModal.errors.premiumRequired") : t("voiceCallModal.errors.connectFailed"));
        return;
      }
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current += 1;
        setIsReconnecting(true);
        setStatus("connecting");
        const delay = 600 * reconnectAttemptsRef.current;
        reconnectTimerRef.current = setTimeout(() => {
          if (!closedRef.current) connectWebSocket();
        }, delay);
      } else {
        setStatus("error");
        setErrorMsg(t("voiceCallModal.errors.unexpectedClose"));
      }
    };
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
      await applyAudioMode();
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
    // Null out every ref after clearing — clearInterval/clearTimeout doesn't
    // do that itself, and this component stays mounted with `visible` toggling
    // across separate calls, so a stale non-null ref here would make the next
    // call's `if (!ref.current)` guards wrongly skip starting fresh timers.
    if (meteringTimerRef.current) { clearInterval(meteringTimerRef.current); meteringTimerRef.current = null; }
    if (durationTimerRef.current) { clearInterval(durationTimerRef.current); durationTimerRef.current = null; }
    if (heartbeatTimerRef.current) { clearInterval(heartbeatTimerRef.current); heartbeatTimerRef.current = null; }
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    reconnectAttemptsRef.current = 0;
    // Drop any sentences still queued so a hang-up mid-response can't resume
    // playback on the next call — previously only stopAllPlayback() cleared this.
    playQueueRef.current = [];
    assistantSpeakingRef.current = false;
    awaitingMoreRef.current = false;
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (recording) {
      recording.stopAndUnloadAsync().catch(() => {});
    }
    if (soundRef.current) {
      const sound = soundRef.current;
      soundRef.current = null;
      // Must stopAsync() before unloadAsync() — unloading a still-playing
      // sound without stopping it first could let the assistant's voice
      // keep audibly playing for a moment after hang-up.
      sound.stopAsync().catch(() => {}).finally(() => {
        sound.unloadAsync().catch(() => {});
      });
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

  function toggleSpeaker() {
    setSpeakerOn((s) => {
      const next = !s;
      speakerOnRef.current = next;
      applyAudioMode().catch(() => {});
      return next;
    });
  }

  const ringColor = status === "assistant_speaking" ? "#00b96d" : status === "user_speaking" ? "#3b82f6" : "#3a3a3a";
  const subLabel =
    status === "error" ? errorMsg
    : status === "connecting" ? (isReconnecting ? t("voiceCallModal.reconnecting") : t("voiceCallModal.connecting"))
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
          <TouchableOpacity
            onPress={toggleSpeaker}
            style={[styles.controlBtn, { backgroundColor: speakerOn ? "#fff" : "rgba(255,255,255,0.14)" }]}
          >
            <Ionicons name={speakerOn ? "volume-high" : "volume-medium-outline"} size={22} color={speakerOn ? "#000" : "#fff"} />
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
