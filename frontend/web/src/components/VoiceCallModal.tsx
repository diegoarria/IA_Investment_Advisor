"use client";

import { useEffect, useRef, useState } from "react";
import { PhoneOff, Mic, MicOff } from "lucide-react";
import { useTranslation } from "react-i18next";

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

  useEffect(() => {
    let cancelled = false;

    async function start() {
      const token = localStorage.getItem("access_token") || "";
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

      const ws = new WebSocket(`${wsBaseUrl()}/api/voice/call/ws?token=${encodeURIComponent(token)}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        console.debug("[voice-call] websocket open");
        if (cancelled) return;
        setStatus("listening");
        startVadLoop();
        durationTimerRef.current = setInterval(() => setCallSeconds((s) => s + 1), 1000);
      };
      ws.onmessage = (ev) => {
        console.debug("[voice-call] message:", typeof ev.data === "string" ? ev.data.slice(0, 200) : "<binary>");
        handleServerMessage(ev.data);
      };
      ws.onerror = (ev) => {
        console.error("[voice-call] websocket error", ev);
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(t("voiceCallModal.errors.connectionFailed"));
        }
      };
      ws.onclose = (ev) => {
        console.debug("[voice-call] websocket closed", ev.code, ev.reason);
        if (!cancelled && !closedRef.current) {
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
    const audio = new Audio(url);
    currentAudioRef.current = audio;
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
    if (vadTimerRef.current) clearInterval(vadTimerRef.current);
    if (durationTimerRef.current) clearInterval(durationTimerRef.current);
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
    : status === "connecting" ? t("voiceCallModal.calling")
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
