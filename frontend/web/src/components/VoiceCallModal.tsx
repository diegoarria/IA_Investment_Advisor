"use client";

import { useEffect, useRef, useState } from "react";
import { PhoneOff, Mic, MicOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getUnlockedAudioElement } from "@/lib/audioUnlock";

interface Props {
  onClose: () => void;
}

type CallStatus = "connecting" | "listening" | "user_speaking" | "assistant_speaking" | "error";

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const SPEECH_RMS_THRESHOLD = 0.02;
const BARGE_IN_RMS_THRESHOLD = 0.035;
const BARGE_IN_SUSTAIN_MS = 150;
const SILENCE_MS = 800;
const VAD_INTERVAL_MS = 60;

function wsBaseUrl(): string {
  const apiBase =
    process.env.NEXT_PUBLIC_API_URL ||
    (process.env.NODE_ENV === "production"
      ? "https://iainvestmentadvisor-production.up.railway.app"
      : "http://localhost:8000");
  return apiBase.replace(/^http/, "ws");
}

export default function VoiceCallModal({ onClose }: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CallStatus>("connecting");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const mutedRef = useRef(false);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isRecordingRef = useRef(false);
  const silenceSinceRef = useRef<number | null>(null);
  const bargeInSinceRef = useRef<number | null>(null);
  const assistantSpeakingRef = useRef(false);

  const playQueueRef = useRef<Blob[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const awaitingMoreRef = useRef(true); // true until "assistant_done" AND queue drained

  const closedRef = useRef(false);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_RECONNECT_ATTEMPTS = 4;
  const HEARTBEAT_MS = 20000;

  useEffect(() => {
    let cancelled = false;

    async function start() {
      // Explicit constraints (not just `audio: true`): echoCancellation is what
      // keeps the Mentor's own voice from bleeding into the mic and triggering
      // false barge-ins — browsers often default it off or inconsistently on.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx: AudioContext = new AudioCtx();
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === "suspended") {
        // Browsers suspend AudioContext until it's resumed inside a user-gesture
        // chain. Opening this modal is itself the gesture, but the creation
        // happens a tick later (inside a useEffect), so Chrome/Safari sometimes
        // leave it suspended — without this the analyser reads flat silence
        // forever and the VAD never detects speech.
        await audioCtx.resume().catch(() => {});
      }
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
        (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
        chunksRef.current = [];
        sendUtterance(blob);
      };
      recorderRef.current = recorder;

      connectWebSocket();
    }

    // Extracted so it can be called again on reconnect without re-requesting
    // mic permission or rebuilding the recorder/analyser — only the socket
    // itself needs to be replaced. Uses closedRef (a ref, always current)
    // instead of the `cancelled` closure variable, which would otherwise be
    // captured stale from whichever call triggered this connect attempt.
    async function connectWebSocket() {
      // This WS connects directly to the API's own domain (not through the
      // frontend's same-origin proxy), so our first-party auth cookie never
      // reaches it — cookies don't cross unrelated domains. A fresh
      // short-lived single-use ticket stands in for it instead (fetched
      // every attempt, including reconnects, since it's single-use).
      let ticketParam = "";
      try {
        const { voiceCallsApi } = await import("@/lib/api");
        const { data } = await voiceCallsApi.getTicket();
        if (data?.ticket) ticketParam = `ticket=${encodeURIComponent(data.ticket)}&`;
      } catch {}
      if (closedRef.current) return;

      // resume=1 on anything past the first attempt — tells the server this
      // is a reconnect mid-call, not a fresh call, so it skips the greeting
      // (the user is already mid-conversation, replaying it would be jarring).
      const resumeParam = reconnectAttemptsRef.current > 0 ? "resume=1" : "";
      const query = ticketParam || resumeParam ? `?${ticketParam}${resumeParam}` : "";
      const ws = new WebSocket(`${wsBaseUrl()}/api/voice/call/ws${query}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        console.debug("[voice-call] websocket open");
        if (closedRef.current) return;
        reconnectAttemptsRef.current = 0;
        setIsReconnecting(false);
        setStatus("listening");
        if (!vadTimerRef.current) startVadLoop();
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
      ws.onmessage = (ev) => {
        console.debug("[voice-call] message:", typeof ev.data === "string" ? ev.data.slice(0, 200) : "<binary>");
        handleServerMessage(ev.data);
      };
      ws.onerror = (ev) => {
        console.error("[voice-call] websocket error", ev);
      };
      ws.onclose = (ev) => {
        console.debug("[voice-call] websocket closed", ev.code, ev.reason);
        if (closedRef.current) return;
        // 4401/4403 are the server explicitly rejecting this connection (auth,
        // not-premium) — retrying won't help, surface the real error instead.
        if (ev.code === 4401 || ev.code === 4403) {
          setStatus("error");
          setErrorMsg(ev.code === 4403 ? t("voiceCallModal.errors.premiumRequired") : t("voiceCallModal.errors.connectionFailed"));
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
          setErrorMsg(ev.code ? t("voiceCallModal.errors.callClosedWithCode", { code: ev.code }) : t("voiceCallModal.errors.callClosed"));
        }
      };
    }

    start().catch((err) => {
      console.error(err);
      if (!cancelled) {
        setStatus("error");
        setErrorMsg(t("voiceCallModal.errors.micAccessFailed"));
      }
    });

    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function base64ToBlob(b64: string, mime: string): Blob {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function handleServerMessage(data: string) {
    let msg: any;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    switch (msg.type) {
      case "transcript":
        setStatus("assistant_speaking");
        assistantSpeakingRef.current = true;
        awaitingMoreRef.current = true;
        break;
      case "assistant_sentence":
        if (msg.audio_b64) {
          playQueueRef.current.push(base64ToBlob(msg.audio_b64, "audio/mpeg"));
          if (!currentAudioRef.current) playNextInQueue();
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

  function playNextInQueue() {
    const next = playQueueRef.current.shift();
    if (!next) {
      currentAudioRef.current = null;
      maybeFinishSpeaking();
      return;
    }
    const url = URL.createObjectURL(next);
    // Reuse the SAME <audio> element the "start call" button unlocked — a
    // fresh `new Audio()` here is exactly what used to make calls silent on
    // iOS Safari: every sentence arrives via a WebSocket message, several
    // `await`s removed from the original click, so it's never autoplay-
    // unlocked on its own. See lib/audioUnlock.ts.
    const audio = getUnlockedAudioElement();
    currentAudioRef.current = audio;
    audio.pause();
    audio.src = url;
    assistantSpeakingRef.current = true;
    setStatus("assistant_speaking");
    audio.onended = () => {
      URL.revokeObjectURL(url);
      playNextInQueue();
    };
    audio.onerror = (e) => {
      console.error("[voice-call] audio playback error", e);
      URL.revokeObjectURL(url);
      playNextInQueue();
    };
    audio.play().catch((e) => {
      console.error("[voice-call] audio.play() rejected", e);
      playNextInQueue();
    });
  }

  function maybeFinishSpeaking() {
    if (!awaitingMoreRef.current && playQueueRef.current.length === 0 && !currentAudioRef.current) {
      assistantSpeakingRef.current = false;
      setStatus("listening");
    }
  }

  function stopAllPlayback() {
    playQueueRef.current = [];
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    assistantSpeakingRef.current = false;
    awaitingMoreRef.current = false;
    setStatus("listening");
  }

  function sendUtterance(blob: Blob) {
    const ws = wsRef.current;
    console.debug("[voice-call] sendUtterance, size=", blob.size, "wsState=", ws?.readyState);
    if (!ws || ws.readyState !== WebSocket.OPEN || blob.size === 0) return;
    blob.arrayBuffer().then((buf) => {
      ws.send(buf);
      ws.send(JSON.stringify({ type: "utterance_end" }));
    });
  }

  function startVadLoop() {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);

    let tick = 0;
    vadTimerRef.current = setInterval(() => {
      // Some browsers silently re-suspend an AudioContext (e.g. after a tab
      // goes background) — resume every tick is cheap and self-heals that.
      if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume().catch(() => {});
      }
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      const now = Date.now();

      tick++;
      if (tick % 20 === 0) {
        // eslint-disable-next-line no-console
        console.debug("[voice-call] rms=", rms.toFixed(4), "ctxState=", audioCtxRef.current?.state, "recording=", isRecordingRef.current, "assistantSpeaking=", assistantSpeakingRef.current);
      }

      if (mutedRef.current) {
        if (isRecordingRef.current) endRecording();
        return;
      }

      if (assistantSpeakingRef.current) {
        // Barge-in detection: sustained speech while the assistant is talking
        if (rms > BARGE_IN_RMS_THRESHOLD) {
          if (bargeInSinceRef.current === null) bargeInSinceRef.current = now;
          if (now - bargeInSinceRef.current > BARGE_IN_SUSTAIN_MS) {
            bargeInSinceRef.current = null;
            wsRef.current?.send(JSON.stringify({ type: "barge_in" }));
            stopAllPlayback();
            beginRecording();
            silenceSinceRef.current = null;
          }
        } else {
          bargeInSinceRef.current = null;
        }
        return;
      }

      if (!isRecordingRef.current) {
        if (rms > SPEECH_RMS_THRESHOLD) {
          beginRecording();
          silenceSinceRef.current = null;
        }
        return;
      }

      // Currently recording an utterance
      if (rms > SPEECH_RMS_THRESHOLD) {
        silenceSinceRef.current = null;
        setStatus("user_speaking");
      } else {
        if (silenceSinceRef.current === null) silenceSinceRef.current = now;
        else if (now - silenceSinceRef.current > SILENCE_MS) {
          endRecording();
        }
      }
    }, VAD_INTERVAL_MS);
  }

  function beginRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "recording") return;
    console.debug("[voice-call] beginRecording, recorder.state=", recorder.state);
    chunksRef.current = [];
    recorder.start();
    isRecordingRef.current = true;
    setStatus("user_speaking");
  }

  function endRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    console.debug("[voice-call] endRecording (silence timeout reached)");
    recorder.stop();
    isRecordingRef.current = false;
    silenceSinceRef.current = null;
  }

  function cleanup() {
    closedRef.current = true;
    if (vadTimerRef.current) { clearInterval(vadTimerRef.current); vadTimerRef.current = null; }
    if (durationTimerRef.current) { clearInterval(durationTimerRef.current); durationTimerRef.current = null; }
    if (heartbeatTimerRef.current) { clearInterval(heartbeatTimerRef.current); heartbeatTimerRef.current = null; }
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    reconnectAttemptsRef.current = 0;
    if (recorderRef.current && recorderRef.current.state === "recording") {
      try {
        recorderRef.current.stop();
      } catch {}
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    wsRef.current?.close();
    stopAllPlayback();
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

  const isSpeaking = status === "assistant_speaking" || status === "user_speaking";
  const ringColor = status === "assistant_speaking" ? "#00b96d" : status === "user_speaking" ? "#3b82f6" : "#3a3a3a";
  const subLabel =
    status === "error" ? errorMsg
    : status === "connecting" ? (isReconnecting ? t("voiceCallModal.reconnecting") : t("voiceCallModal.calling"))
    : formatDuration(callSeconds);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center" style={{ background: "linear-gradient(180deg,#111 0%,#000 100%)" }}>
      <div className="flex-1" />

      <div className="flex flex-col items-center gap-5">
        <div className="relative w-36 h-36 flex items-center justify-center">
          {isSpeaking && (
            <span
              className="absolute inset-0 rounded-full animate-ping"
              style={{ background: ringColor + "33" }}
            />
          )}
          <div
            className="w-32 h-32 rounded-full flex items-center justify-center transition-colors duration-300"
            style={{ background: "#1c1c1e", border: `2px solid ${ringColor}` }}
          >
            <span className="text-6xl" role="img" aria-label={t("voiceCallModal.aiMentor")}>🤖</span>
          </div>
        </div>

        <div className="text-center">
          <p className="text-2xl font-bold text-white">{t("voiceCallModal.aiMentor")}</p>
          <p className="text-sm mt-2 tabular-nums" style={{ color: status === "error" ? "#f87171" : "rgba(255,255,255,0.5)" }}>
            {subLabel}
          </p>
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex items-center justify-center gap-10 pb-16">
        <button
          onClick={toggleMute}
          className="w-14 h-14 rounded-full flex items-center justify-center transition-colors"
          style={{ background: muted ? "#fff" : "rgba(255,255,255,0.14)" }}
          aria-label={muted ? t("voiceCallModal.unmute") : t("voiceCallModal.mute")}
        >
          {muted ? <MicOff size={22} color="#000" /> : <Mic size={22} color="#fff" />}
        </button>
        <button
          onClick={handleHangUp}
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{ background: "#ef4444" }}
          aria-label={t("voiceCallModal.hangUp")}
        >
          <PhoneOff size={26} color="#fff" />
        </button>
      </div>
    </div>
  );
}
