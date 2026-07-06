"use client";

import { useEffect, useRef, useState } from "react";
import { X, PhoneOff, Mic, Volume2 } from "lucide-react";

interface Props {
  onClose: () => void;
}

type CallStatus = "connecting" | "listening" | "user_speaking" | "assistant_speaking" | "error";

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
  const [status, setStatus] = useState<CallStatus>("connecting");
  const [caption, setCaption] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");

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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      };
      ws.onmessage = (ev) => {
        console.debug("[voice-call] message:", typeof ev.data === "string" ? ev.data.slice(0, 200) : "<binary>");
        handleServerMessage(ev.data);
      };
      ws.onerror = (ev) => {
        console.error("[voice-call] websocket error", ev);
        if (!cancelled) {
          setStatus("error");
          setErrorMsg("No se pudo conectar con el Mentor. Revisa tu conexión.");
        }
      };
      ws.onclose = (ev) => {
        console.debug("[voice-call] websocket closed", ev.code, ev.reason);
        if (!cancelled && !closedRef.current) {
          setStatus("error");
          setErrorMsg(`La llamada se cerró inesperadamente${ev.code ? ` (código ${ev.code})` : ""}.`);
        }
      };
    }

    start().catch((err) => {
      console.error(err);
      if (!cancelled) {
        setStatus("error");
        setErrorMsg("No se pudo acceder al micrófono. Da permiso en el navegador.");
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
        setCaption(msg.text || "");
        setStatus("assistant_speaking");
        assistantSpeakingRef.current = true;
        awaitingMoreRef.current = true;
        break;
      case "assistant_sentence":
        setCaption(msg.text || "");
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
        setErrorMsg(msg.detail || "Ocurrió un error.");
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
      setCaption("");
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
    setCaption("");
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

  const statusLabel: Record<CallStatus, string> = {
    connecting: "Conectando...",
    listening: "Escuchando...",
    user_speaking: "Te estoy escuchando",
    assistant_speaking: "El Mentor está hablando",
    error: "Error en la llamada",
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div
        className="w-full max-w-sm rounded-[28px] p-8 flex flex-col items-center gap-6 text-center"
        style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}
      >
        <button
          onClick={handleHangUp}
          className="self-end -mt-2 -mr-2 p-2 rounded-full"
          style={{ color: "var(--muted)" }}
          aria-label="Cerrar"
        >
          <X size={18} />
        </button>

        <div
          className="w-24 h-24 rounded-full flex items-center justify-center transition-all"
          style={{
            background: status === "assistant_speaking" ? "#00b96d22" : status === "user_speaking" ? "#3b82f622" : "var(--raised)",
            border: `2px solid ${status === "assistant_speaking" ? "#00b96d" : status === "user_speaking" ? "#3b82f6" : "var(--border)"}`,
          }}
        >
          {status === "assistant_speaking" ? (
            <Volume2 size={34} color="#00b96d" />
          ) : (
            <Mic size={34} color={status === "user_speaking" ? "#3b82f6" : "var(--muted)"} />
          )}
        </div>

        <div>
          <p className="text-base font-bold" style={{ color: "var(--text)" }}>
            Llamada con Mentor IA
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            {status === "error" ? errorMsg : statusLabel[status]}
          </p>
        </div>

        {caption && (
          <p className="text-sm leading-relaxed max-h-24 overflow-y-auto" style={{ color: "var(--sub)" }}>
            {caption}
          </p>
        )}

        <button
          onClick={handleHangUp}
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{ background: "#ef4444" }}
          aria-label="Colgar"
        >
          <PhoneOff size={26} color="#fff" />
        </button>
      </div>
    </div>
  );
}
