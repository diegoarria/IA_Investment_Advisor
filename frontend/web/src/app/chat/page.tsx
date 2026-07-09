"use client";

import { useState, useEffect, useRef } from "react";
import TourSpotlight from "@/components/TourSpotlight";
import { useRouter } from "next/navigation";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chat as chatApi, notifications as notifApi, decisionsApi } from "@/lib/api";
import {
  useAuthStore, useProfileStore, useChatStore, useNotificationStore,
  useThemeStore, useLanguageStore, useSubscriptionStore, msgsRemaining, FREE_MSG_LIMIT,
} from "@/lib/store";
import { getMentorInfo } from "@/lib/mentorData";
import { usePortfolioStore } from "@/lib/portfolioStore";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PaywallModal from "@/components/PaywallModal";
import { useUpsellStore } from "@/lib/upsellStore";
import TutorialModal from "@/components/TutorialModal";
import GuidedSteps from "@/components/GuidedSteps";
import PremiumBadge from "@/components/PremiumBadge";
import VoiceCallModal from "@/components/VoiceCallModal";
import { useTutorialStore } from "@/lib/store";
import {
  Send, TrendingUp, Bell, LogOut, Menu, X,
  ChevronRight, Sun, Moon, Square, Pencil, ImagePlus, Plus, Mic, Play, Copy, Phone,
} from "lucide-react";
import { getUserLevel, LEVEL_LABEL, LEVEL_COLOR } from "@/lib/userLevel";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

function getSuggestionsDefault(t: TFunction): string[] {
  return t("chat.suggestionsDefault", { returnObjects: true }) as string[];
}

function getSuggestionsByLevel(t: TFunction): Record<string, string[]> {
  return {
    basico: t("chat.suggestionsByLevel.basico", { returnObjects: true }) as string[],
    intermedio: t("chat.suggestionsByLevel.intermedio", { returnObjects: true }) as string[],
    avanzado: t("chat.suggestionsByLevel.avanzado", { returnObjects: true }) as string[],
  };
}

function getSuggestionsByObjective(t: TFunction): Record<string, string[]> {
  return {
    protect: t("chat.suggestionsByObjective.protect", { returnObjects: true }) as string[],
    grow: t("chat.suggestionsByObjective.grow", { returnObjects: true }) as string[],
    maximize: t("chat.suggestionsByObjective.maximize", { returnObjects: true }) as string[],
  };
}

function getObjectiveGreeting(t: TFunction): Record<string, string> {
  return {
    protect: t("chat.objectiveGreeting.protect"),
    grow: t("chat.objectiveGreeting.grow"),
    maximize: t("chat.objectiveGreeting.maximize"),
  };
}

function getRiskLabel(t: TFunction): Record<string, string> {
  return {
    conservative:            t("chat.riskLabel.conservative"),
    conservative_moderate:   t("chat.riskLabel.conservative_moderate"),
    moderate:                t("chat.riskLabel.moderate"),
    moderate_growth:         t("chat.riskLabel.moderate_growth"),
    growth:                  t("chat.riskLabel.growth"),
    aggressive:              t("chat.riskLabel.aggressive"),
    aggressive_speculative:  t("chat.riskLabel.aggressive_speculative"),
    speculative:             t("chat.riskLabel.speculative"),
  };
}

const RISK_SEGMENTS = [
  { key: "conservative",           color: "#00d47e" },
  { key: "conservative_moderate",  color: "#3ecf8e" },
  { key: "moderate",               color: "#8bd44e" },
  { key: "moderate_growth",        color: "#c5d43c" },
  { key: "growth",                 color: "#f5c842" },
  { key: "aggressive",             color: "#f5973a" },
  { key: "aggressive_speculative", color: "#f5613a" },
  { key: "speculative",            color: "#ff2d3b" },
];

type BScoreData = { s: number; p: string; sig: string[]; conf: string };

function BScoreCard({ data }: { data: BScoreData }) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-start mt-1 ml-9">
      <div className="px-3 py-2 rounded-xl border max-w-xs"
           style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
        <div className="text-[10px] mb-1.5 font-semibold uppercase tracking-wide"
             style={{ color: "var(--muted)" }}>
          {t("chat.riskAssessmentTitle")}
        </div>
        <RiskBar level={data.p} />
        {data.sig.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {data.sig.map((s) => (
              <span key={s} className="text-[10px] px-1.5 py-0.5 rounded-full border"
                    style={{ borderColor: "var(--border)", color: "var(--dim)" }}>
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RiskBar({ level }: { level: string }) {
  const { t } = useTranslation();
  const RISK_LABEL = getRiskLabel(t);
  const idx = RISK_SEGMENTS.findIndex((s) => s.key === level);
  if (idx < 0) return null;
  return (
    <div>
      <div className="flex gap-0.5 mb-1">
        {RISK_SEGMENTS.map((seg, i) => (
          <div key={seg.key}
               className="h-1.5 flex-1 rounded-full transition-all"
               style={{
                 background: i <= idx ? seg.color : "var(--border)",
                 opacity: i === idx ? 1 : i < idx ? 0.65 : 0.25,
               }} />
        ))}
      </div>
      <div className="text-[10px] font-semibold"
           style={{ color: RISK_SEGMENTS[idx]?.color ?? "var(--accent-l)" }}>
        {RISK_LABEL[level] ?? level}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1.5 py-1 px-1">
      <span className="w-2 h-2 rounded-full bg-[#5b7a96] dot-bounce" />
      <span className="w-2 h-2 rounded-full bg-[#5b7a96] dot-bounce-2" />
      <span className="w-2 h-2 rounded-full bg-[#5b7a96] dot-bounce-3" />
    </div>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const RISK_LABEL = getRiskLabel(t);
  const SUGGESTIONS_DEFAULT = getSuggestionsDefault(t);
  const SUGGESTIONS_BY_LEVEL = getSuggestionsByLevel(t);
  const SUGGESTIONS_BY_OBJECTIVE = getSuggestionsByObjective(t);
  const OBJECTIVE_GREETING = getObjectiveGreeting(t);
  const { hasSeenTutorial, openTutorial } = useTutorialStore();
  const { isAuthenticated, clearAuth } = useAuthStore();
  const { profile, updateMaturity, updateBehavioralRisk } = useProfileStore();
  const { messages, isStreaming, addMessage, appendToLastAssistant, setStreaming, startAssistantMessage, removeLastMessage, setMessages, sessions, currentId, createSession, clearMessages, syncSessionMessages, loadFromServer } = useChatStore();
  const { notifications, setNotifications, markRead } = useNotificationStore();
  const { theme, toggleTheme } = useThemeStore();
  const { language } = useLanguageStore();
  const subStore = useSubscriptionStore();
  const { positions, loadFromServer: loadPortfolio } = usePortfolioStore();
  const upsellTrigger = useUpsellStore((s) => s.trigger);
  const mentor = getMentorInfo(profile?.mentor);
  const cancelRef = useRef({ cancelled: false });

  const [isTour, setIsTour] = useState(false);
  const [notificationContext, setNotificationContext] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<Array<{ type: string; label: string; data: Record<string, unknown> }> | null>(null);
  const [committedActions, setCommittedActions] = useState<Set<number>>(new Set());
  const [decisionModal, setDecisionModal] = useState<{ action: string; ticker: string; notes: string } | null>(null);
  const [decisionSaved, setDecisionSaved] = useState(false);

  // ── Guided tour & 1:1 suggestion ─────────────────────────────────────────
  const [guidedTour, setGuidedTour]     = useState(false);
  const [guidedStep, setGuidedStep]     = useState(1);
  const [show1on1, setShow1on1]         = useState(false);
  const [dismissed1on1, setDismissed1on1] = useState(false);

  const GUIDED_STEPS = [
    { emoji: "💬", label: t("chat.guidedStepRespond"),         action: null },
    { emoji: "💼", label: t("chat.guidedStepAddPosition"),     action: "/portfolio?tour=1" },
    { emoji: "📚", label: t("chat.guidedStepCompleteLesson"),  action: "/academy" },
    { emoji: "👀", label: t("chat.guidedStepAddWatchlist"),    action: "/watchlist" },
  ];

  useEffect(() => {
    setIsTour(new URLSearchParams(window.location.search).get("tour") === "3");
    const ctx = new URLSearchParams(window.location.search).get("ctx");
    const msg = new URLSearchParams(window.location.search).get("msg");
    if (ctx) setNotificationContext(decodeURIComponent(ctx));
    if (msg) setInput(decodeURIComponent(msg));

    // Guided tour init
    const tourActive = localStorage.getItem("nuvos_guided_tour") === "1";
    const savedStep  = parseInt(localStorage.getItem("nuvos_guided_step") ?? "1");
    setGuidedTour(tourActive);
    setGuidedStep(savedStep);
    setDismissed1on1(sessionStorage.getItem("nuvos_1on1_dismissed") === "1");
  }, []);

  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [paywallReason, setPaywallReason] = useState<string | undefined>(undefined);
  const [lastAssessment, setLastAssessment] = useState<BScoreData | null>(null);
  const [pendingImages, setPendingImages] = useState<Array<{ data: string; type: string; preview: string }>>([]);
  const [isDragging, setIsDragging] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Voice input state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [recordingSecs, setRecordingSecs] = useState(0);
  const [voiceAudio, setVoiceAudio] = useState<{ content: string; url: string | null; loading: boolean; playing: boolean } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showCallModal, setShowCallModal] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voiceInputRef = useRef(false);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Cross-device sync
  const syncCursorRef = useRef<string | null>(null);
  const localFingerprintsRef = useRef<Set<string>>(new Set());
  const fp = (role: string, content: string) => `${role}:${content.slice(0, 60)}`;

  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const handleScrollContainer = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    isAtBottom.current = atBottom;
    setShowScrollBtn(!atBottom);
  };

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowScrollBtn(false);
  };

  const isPremium = subStore.tier === "premium" || subStore.isTrialPremium;
  const remaining = msgsRemaining(subStore);

  const handleStop = () => {
    cancelRef.current.cancelled = true;
    setStreaming(false);
  };

  const addImageFiles = (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const remaining = 8 - pendingImages.length;
    const toAdd = arr.slice(0, remaining);
    toAdd.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        setPendingImages((prev) => prev.length < 8 ? [...prev, { data: base64, type: file.type, preview: result }] : prev);
      };
      reader.readAsDataURL(file);
    });
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 48000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg";
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.start(100);
      mediaRecorderRef.current = recorder;

      setIsRecording(true);
      setShowVoiceModal(true);
      setRecordingSecs(0);
      timerRef.current = setInterval(() => setRecordingSecs((s) => s + 1), 1000);
    } catch {
      alert(t("chat.micPermissionError"));
    }
  };

  const stopRecording = async () => {
    setShowVoiceModal(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    analyserRef.current = null;

    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    setIsRecording(false);
    setIsTranscribing(true);
    recorder.stop();
    recorder.stream.getTracks().forEach((t) => t.stop());
    mediaRecorderRef.current = null;
    await new Promise<void>((res) => { recorder.onstop = () => res(); });
    try {
      const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
      const { data } = await chatApi.transcribe(blob);
      if (data?.text) {
        voiceInputRef.current = true;
        sendMessage(data.text);
      }
    } catch {
      // silently ignore
    } finally {
      setIsTranscribing(false);
    }
  };

  const cancelRecording = () => {
    setShowVoiceModal(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    analyserRef.current = null;
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      recorder.stop();
      recorder.stream.getTracks().forEach((t) => t.stop());
      mediaRecorderRef.current = null;
    }
    setIsRecording(false);
    audioChunksRef.current = [];
  };

  const generateVoiceResponse = async (text: string) => {
    const key = text.slice(0, 80);
    setVoiceAudio({ content: key, url: null, loading: true, playing: false });
    try {
      const { data } = await chatApi.speak(text);
      if (!data?.audio) { setVoiceAudio(null); return; }
      const bytes = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      setVoiceAudio({ content: key, url, loading: false, playing: false });
    } catch {
      setVoiceAudio(null);
    }
  };

  const playVoiceResponse = async () => {
    if (!voiceAudio?.url) return;
    if (audioRef.current) { audioRef.current.pause(); }
    setVoiceAudio((prev) => prev ? { ...prev, playing: true } : null);
    const url = voiceAudio.url;
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => { setVoiceAudio((prev) => prev ? { ...prev, playing: false } : null); audioRef.current = null; };
    audio.onerror = () => { setVoiceAudio((prev) => prev ? { ...prev, playing: false } : null); audioRef.current = null; };
    await audio.play();
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addImageFiles(e.target.files);
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files) addImageFiles(e.dataTransfer.files);
  };

  const removeImage = (idx: number) => setPendingImages((prev) => prev.filter((_, i) => i !== idx));

  const handleEditMessage = (index: number, content: string) => {
    if (isStreaming) { cancelRef.current.cancelled = true; setStreaming(false); }
    setMessages(messages.slice(0, index));
    setInput(content);
    inputRef.current?.focus();
  };

  const buildProfileContext = () => {
    if (!profile) return null;
    const qa = profile.quiz_answers;
    const q1Labels: Record<string, string> = { A: "vende ante caídas (reactivo conservador)", B: "espera sin actuar (pasivo)", C: "analiza fundamentos y mantiene (racional)", D: "compra más en caídas (inversor de valor)" };
    const q2Labels: Record<string, string> = { A: "necesita el dinero en menos de 2 años", B: "horizonte de 3–5 años", C: "10+ años, busca independencia financiera", D: "largo plazo sin prisa" };
    const q3Labels: Record<string, string> = { A: "básico — apenas empieza", B: "básico — conoce fondos indexados", C: "intermedio — entiende P/E, diversificación", D: "avanzado — maneja análisis fundamental" };
    const q4Labels: Record<string, string> = { A: "conservador — prefiere $5K garantizado", B: "moderado-bajo — acepta riesgo de $5K", C: "moderado-alto — acepta riesgo de $20K", D: "especulador — arriesga todo" };
    const q5Labels: Record<string, string> = { A: "pasivo — inversión automática", B: "semipasivo — revisión mensual", C: "activo — revisiones semanales", D: "muy activo — gestión diaria" };

    let portfolioBlock = "\n\n[PORTAFOLIO REAL DEL USUARIO]";
    if (positions.length === 0) {
      portfolioBlock += "\nEl usuario aún no tiene posiciones registradas.";
    } else {
      portfolioBlock += `\nPosiciones (${positions.length}):`;
      for (const p of positions) {
        portfolioBlock += `\n- ${p.ticker}${p.name ? ` (${p.name})` : ""}: ${p.shares} acc × $${p.avgPrice.toFixed(2)} costo promedio`;
      }
    }

    const a = (key: string) => qa ? String(qa[key] ?? "") : "";

    const GOAL_LABELS: Record<string, string> = {
      emergency_fund: "Fondo de emergencia",
      big_purchase:   "Compra importante (casa, auto, proyecto)",
      retirement:     "Retiro / pensión a largo plazo",
      independence:   "Independencia financiera",
    };
    const goalLine   = profile.investment_goal ? `\nMeta financiera: ${GOAL_LABELS[profile.investment_goal] ?? profile.investment_goal}` : "";
    const amountLine = profile.investment_amount
      ? `\nCapital disponible: $${Number(profile.investment_amount).toLocaleString("en-US")}`
      : "";
    const goalAmtLine = profile.investment_goal_amount
      ? `\nMeta financiera ($): $${Number(profile.investment_goal_amount).toLocaleString("en-US")}`
      : "";

    // Include context from most recent previous session
    const prevSession = sessions.find(s => s.id !== currentId && s.messages.length > 0);
    const prevMsgs = prevSession?.messages.slice(-6) ?? [];
    const memoryBlock = prevMsgs.length > 0 && messages.length === 0
      ? "\n\n[CONTEXTO DE CONVERSACIÓN ANTERIOR - Para continuidad, el usuario ya habló contigo]\n" +
        prevMsgs.map(m => `${m.role === "user" ? "Usuario" : "Mentor"}: ${m.content.slice(0, 200)}`).join("\n") +
        "\n(Retoma el hilo de forma natural si es relevante)"
      : "";

    return `[PERFIL DEL USUARIO]\nNombre: ${profile.name}\nPerfil de riesgo: ${profile.risk_tolerance}${goalLine}${amountLine}${goalAmtLine}\n\nRespuestas del cuestionario:\n- Comportamiento ante caídas: ${q1Labels[a("q1")] ?? "no disponible"}\n- Horizonte: ${q2Labels[a("q2")] ?? "no disponible"}\n- Conocimiento: ${q3Labels[a("q3")] ?? "no disponible"}\n- Tolerancia al riesgo: ${q4Labels[a("q4")] ?? "no disponible"}\n- Estilo de gestión: ${q5Labels[a("q5")] ?? "no disponible"}${portfolioBlock}\n\nInstrucciones: Llama siempre a este usuario por su nombre (${profile.name.split(" ")[0]}). Adapta el nivel al conocimiento declarado. Si el usuario es principiante (conocimiento: A), usa lenguaje simple, evita términos técnicos sin explicarlos y enfócate en sus miedos y metas concretas. ${language === "en" ? "Always respond in English." : "Responde en español."}${memoryBlock}`;
  };

  useEffect(() => {
    if (!hasSeenTutorial) setTimeout(() => openTutorial(), 800);

    // Always start with a fresh empty chat on every visit/navigation to this page.
    // Load history from server first so the sidebar shows past sessions, then open
    // a new blank session for the current conversation.
    loadFromServer().finally(() => {
      chatApi.getHistory()
        .then((res) => {
          const msgs: { created_at?: string }[] = res.data?.messages ?? [];
          syncCursorRef.current = msgs[msgs.length - 1]?.created_at ?? new Date().toISOString();
          createSession();
        })
        .catch(() => {
          syncCursorRef.current = new Date().toISOString();
          createSession();
        });
    });

    // Also open a fresh session whenever the user returns to this tab after
    // having it hidden (matches mobile's AppState inactive→active behavior).
    const onVisibility = () => {
      if (document.visibilityState === "visible") createSession();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Retry the history pull shortly after mount. This call has no retry of its
    // own, so a single cold-start race with auth-token restoration (e.g. a fresh
    // login on a new browser) can silently leave this tab thinking the account
    // has no chat history at all, when it actually does on the server. Re-running
    // loadFromServer() is a safe no-op if the first pull already succeeded — its
    // merge logic drops the placeholder empty session once real ones land.
    const retryTimers = [3_000, 8_000, 15_000].map((delay) => setTimeout(loadFromServer, delay));

    notifApi.getAll()
      .then((res) => setNotifications(res.data.notifications, res.data.unread_count))
      .catch(() => {});

    subStore.fetchStatus().catch(() => {});
    loadPortfolio();
    return () => {
      retryTimers.forEach(clearTimeout);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAtBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Cross-device sync: poll for messages sent from other devices
  useEffect(() => {
    if (!isAuthenticated) return;
    const poll = setInterval(async () => {
      if (!syncCursorRef.current) return;
      try {
        const res = await chatApi.getHistory(syncCursorRef.current);
        const newMsgs: { role: string; content: string; created_at?: string; session_id?: string | null }[] = res.data.messages ?? [];
        if (newMsgs.length === 0) return;
        const foreign = newMsgs.filter((m) => !localFingerprintsRef.current.has(fp(m.role, m.content)));
        if (foreign.length > 0) {
          // Group by session_id and route each group to the right session
          const bySession = new Map<string, typeof foreign>();
          for (const m of foreign) {
            const sid = m.session_id ?? "__legacy__";
            if (!bySession.has(sid)) bySession.set(sid, []);
            bySession.get(sid)!.push(m);
          }
          for (const [sid, msgs] of bySession) {
            const chatMsgs = msgs.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
            if (sid === "__legacy__") {
              chatMsgs.forEach((m) => addMessage(m));
            } else {
              syncSessionMessages(sid, chatMsgs);
            }
          }
        }
        syncCursorRef.current = newMsgs[newMsgs.length - 1].created_at ?? syncCursorRef.current;
      } catch {}
    }, 8000);
    return () => clearInterval(poll);
  }, [isAuthenticated]);

  // Waveform animation loop (runs while voice modal is open)
  useEffect(() => {
    if (!showVoiceModal) return;
    let animId: number;
    const draw = () => {
      const canvas = waveCanvasRef.current;
      const analyser = analyserRef.current;
      if (canvas && analyser) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const bufLen = analyser.frequencyBinCount;
          const data = new Uint8Array(bufLen);
          analyser.getByteFrequencyData(data);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const barCount = 40;
          const barW = Math.floor(canvas.width / barCount) - 2;
          const step = Math.floor(bufLen / barCount);
          for (let i = 0; i < barCount; i++) {
            const v = data[i * step] / 255;
            const h = Math.max(4, v * canvas.height * 0.85);
            const x = i * (barW + 2);
            const y = (canvas.height - h) / 2;
            ctx.fillStyle = `rgba(0, 212, 126, ${0.35 + v * 0.65})`;
            ctx.fillRect(x, y, barW, h);
          }
        }
      }
      animId = requestAnimationFrame(draw);
    };
    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, [showVoiceModal]);

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    if ((!msg && pendingImages.length === 0) || isStreaming) return;

    if (remaining === 0) { setPaywallReason(undefined); setPaywallOpen(true); return; }

    const imagesToSend = [...pendingImages];
    setInput("");
    setPendingImages([]);
    setLastAssessment(null);
    setSendError(null);
    cancelRef.current.cancelled = false;
    isAtBottom.current = true;
    subStore.incrementMsgCount();
    const n = imagesToSend.length;
    const saveMsg = msg || (n === 1 ? t("chat.imageSentOne") : t("chat.imageSentMany", { count: n }));
    addMessage({
      role: "user",
      content: msg,
      images: imagesToSend.length > 0 ? imagesToSend.map((i) => ({ preview: i.preview })) : undefined,
    });
    localFingerprintsRef.current.add(fp("user", saveMsg));
    chatApi.saveMessage("user", saveMsg, currentId).catch(() => {});
    syncCursorRef.current = new Date().toISOString();

    // Advance guided tour to step 2 on first user message
    if (guidedTour && guidedStep === 1) {
      setGuidedStep(2);
      localStorage.setItem("nuvos_guided_step", "2");
    }
    // Show 1:1 suggestion after first exchange
    if (guidedTour && !dismissed1on1) {
      setShow1on1(true);
    }

    const profileCtx = buildProfileContext();
    const recentHistory = messages.slice(-18).map((m) => ({ role: m.role, content: m.content }));
    const historyForApi = profileCtx
      ? [
          { role: "user", content: profileCtx },
          { role: "assistant", content: `Entendido. Tengo en cuenta el perfil de ${profile?.name?.split(" ")[0] || "usuario"}.` },
          ...recentHistory,
        ]
      : messages.slice(-20).map((m) => ({ role: m.role, content: m.content }));

    startAssistantMessage();
    setStreaming(true);

    const ctxToSend = notificationContext;
    setNotificationContext(null);
    setPendingActions(null);
    let fullResponse = "";
    try {
      await chatApi.stream(
        msg,
        historyForApi,
        (chunk) => {
          if (cancelRef.current.cancelled) return;
          appendToLastAssistant(chunk);
          fullResponse += chunk;
        },
        () => {
          setStreaming(false);
          localFingerprintsRef.current.add(fp("assistant", fullResponse));
          chatApi.saveMessage("assistant", fullResponse, currentId).catch(() => {});
          syncCursorRef.current = new Date().toISOString();
          if (voiceInputRef.current) {
            voiceInputRef.current = false;
            generateVoiceResponse(fullResponse);
          }
        },
        (a) => {
          setLastAssessment(a);
          updateMaturity(a.sig);
          updateBehavioralRisk(a.s, a.conf);
        },
        undefined,
        profile?.mentor ?? null,
        cancelRef.current,
        null,
        null,
        imagesToSend.length > 0 ? imagesToSend.map((i) => ({ data: i.data, type: i.type })) : null,
        ctxToSend,
        (actions) => { setPendingActions(actions); setCommittedActions(new Set()); },
      );
    } catch (err: unknown) {
      setStreaming(false);
      removeLastMessage();
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 429) { await subStore.fetchStatus(); upsellTrigger("msg_limit_hit"); setPaywallReason(undefined); setPaywallOpen(true); }
      else { setSendError(t("chat.connectError")); }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const unreadNotifCount = notifications.filter((n) => !n.read).length;

  const accentCol = mentor?.color ?? "var(--accent-l)";

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b gap-3"
           style={{ background: "var(--card)", borderColor: "var(--border)" }}>

        {/* Left: hamburger + logo */}
        <div className="flex items-center gap-3 shrink-0">
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="lg:hidden p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                  style={{ color: "var(--muted)" }}>
            {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
          <button onClick={() => router.push("/chat")} className="flex items-center gap-2">
            <Image src="/logo.png" alt="Nuvos AI" width={28} height={28} className="rounded-xl object-cover" />
            <span className="font-bold text-sm hidden sm:block" style={{ color: "var(--text)" }}>Nuvos AI</span>
          </button>
        </div>

        {/* Center: mentor identity pill */}
        <div className="flex items-center gap-2 flex-1 justify-center">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-2xl border"
               style={{
                 background: mentor ? mentor.color + "0d" : "var(--raised)",
                 borderColor: mentor ? mentor.color + "30" : "var(--border)",
               }}>
            <span className="text-lg leading-none">{mentor ? mentor.emoji : "🤖"}</span>
            <div className="hidden sm:block">
              <p className="text-xs font-black leading-none" style={{ color: "var(--text)" }}>
                {mentor ? mentor.name : profile?.name ? t("chat.greeting", { name: profile.name.split(" ")[0] }) : t("chat.mentorFallbackName")}
              </p>
              {mentor && (
                <p className="text-[10px] leading-none mt-0.5" style={{ color: mentor.color }}>
                  {mentor.badge}
                </p>
              )}
            </div>
          </div>
          {(() => {
            const level = getUserLevel(profile);
            return (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg border hidden sm:inline"
                    style={{ background: "var(--raised)", color: LEVEL_COLOR[level], borderColor: "var(--border)" }}>
                {LEVEL_LABEL[level]}
              </span>
            );
          })()}
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1 shrink-0">
          {!isPremium && remaining > 0 && (
            <span className="hidden md:block text-[10px] font-semibold px-2 py-1 rounded-full"
                  style={{ background: "var(--raised)", color: "var(--dim)", border: "1px solid var(--border)" }}>
              {t("chat.msgCount", { count: remaining })}
            </span>
          )}
          <button onClick={() => { clearMessages(); router.push("/chat"); }}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold hover:bg-white/5 transition-colors"
                  style={{ color: "var(--muted)", borderColor: "var(--border)" }}>
            <Plus className="w-3 h-3" />
            {t("chat.newChat")}
          </button>
          <PremiumBadge />
          <button onClick={openTutorial}
                  className="w-7 h-7 flex items-center justify-center rounded-lg border text-xs font-bold hover:bg-white/5 transition-colors"
                  style={{ color: "var(--muted)", borderColor: "var(--border)" }}>?</button>
          <button onClick={toggleTheme} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                  style={{ color: "var(--muted)" }}>
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button onClick={() => setNotifOpen(!notifOpen)}
                  className="relative p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                  style={{ color: "var(--muted)" }}>
            <Bell className="w-4 h-4" />
            {unreadNotifCount > 0 && (
              <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full text-white text-[9px] flex items-center justify-center font-bold"
                    style={{ background: "var(--accent)" }}>
                {unreadNotifCount > 9 ? "9+" : unreadNotifCount}
              </span>
            )}
          </button>
          <button onClick={async () => { await clearAuth(); router.push("/"); }}
                  className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                  style={{ color: "var(--muted)" }}>
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      <MarketTickerBar />

      <div className="flex flex-1 overflow-hidden relative">
        <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} hideMobileTrigger />

        {/* Notification panel */}
        {notifOpen && (
          <div className="absolute right-0 top-0 w-80 h-full border-l z-30 flex flex-col"
               style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
              <span className="font-bold text-sm" style={{ color: "var(--text)" }}>{t("chat.notifPanelTitle")}</span>
              <button onClick={() => setNotifOpen(false)} style={{ color: "var(--muted)" }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2" style={{ scrollbarWidth: "thin" }}>
              {notifications.length === 0 && (
                <p className="text-center py-10 text-sm" style={{ color: "var(--dim)" }}>{t("chat.notifPanelEmpty")}</p>
              )}
              {notifications.map((n) => (
                <div key={n.id} onClick={() => markRead(n.id)}
                     className="p-3 rounded-xl border cursor-pointer transition-all"
                     style={{
                       borderColor: n.read ? "var(--border)" : "rgba(0,168,94,0.4)",
                       background: n.read ? "var(--raised)" : "rgba(0,168,94,0.05)",
                     }}>
                  <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{n.title}</p>
                  <p className="text-xs mt-1 line-clamp-2" style={{ color: "var(--muted)" }}>{n.message}</p>
                  <button onClick={(e) => { e.stopPropagation(); sendMessage(n.message.slice(0, 200)); setNotifOpen(false); }}
                          className="text-xs mt-2 flex items-center gap-1 font-semibold hover:opacity-80"
                          style={{ color: "var(--accent-l)" }}>
                    {t("chat.askMentor")} <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Chat column ───────────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <GuidedSteps currentPage="chat" />

          {/* Scroll area */}
          <div ref={scrollContainerRef} onScroll={handleScrollContainer}
               className="flex-1 overflow-y-auto p-4 md:px-8 space-y-5"
               style={{ scrollbarWidth: "thin" }}>

            {/* ─── Welcome / Empty state ──────────────────────────────────── */}
            {messages.length === 0 && (
              <div className="min-h-full flex flex-col items-center justify-center gap-5 animate-fade-in py-8 max-w-2xl mx-auto w-full">

                {/* Hero card */}
                <div className="w-full rounded-2xl border overflow-hidden"
                     style={{ background: "var(--card)", borderColor: mentor ? mentor.color + "35" : "var(--border)" }}>

                  {/* Color strip */}
                  <div className="h-1.5"
                       style={{ background: mentor ? `linear-gradient(90deg, ${mentor.color}, ${mentor.color}70)` : "var(--grad-green)" }} />

                  <div className="p-6 text-center">
                    {/* Avatar */}
                    <div className="mx-auto mb-4 w-20 h-20 rounded-2xl flex items-center justify-center text-4xl"
                         style={{
                           background: mentor ? mentor.color + "18" : "rgba(0,212,126,0.1)",
                           border: `2px solid ${mentor ? mentor.color + "35" : "rgba(0,212,126,0.25)"}`,
                         }}>
                      {mentor ? mentor.emoji : <TrendingUp className="w-9 h-9" style={{ color: "var(--accent-l)" }} />}
                    </div>

                    <h2 className="text-2xl font-black tracking-tight mb-1"
                        style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                      {mentor ? mentor.name : profile?.name ? t("chat.greeting", { name: profile.name.split(" ")[0] }) : "Nuvos AI"}
                    </h2>
                    <p className="text-sm font-semibold mb-4"
                       style={{ color: mentor ? mentor.color : "var(--accent-l)" }}>
                      {mentor ? mentor.title : t("chat.defaultMentorTitle")}
                    </p>

                    {mentor && <span className="badge-green inline-block mb-4">{mentor.badge}</span>}
                    {mentor && (
                      <div className="flex flex-wrap justify-center gap-1.5 mb-2">
                        {mentor.principles.map((p) => (
                          <span key={p} className="text-xs px-2.5 py-1 rounded-full border font-medium"
                                style={{ borderColor: (mentor as NonNullable<typeof mentor>).color + "40", background: (mentor as NonNullable<typeof mentor>).color + "0e", color: (mentor as NonNullable<typeof mentor>).color }}>
                            {p}
                          </span>
                        ))}
                      </div>
                    )}

                    {!mentor && (() => {
                      const obj = profile?.quiz_answers?.objective as string | undefined;
                      if (obj) return (
                        <p className="text-sm leading-relaxed max-w-sm mx-auto" style={{ color: "var(--muted)" }}>
                          {OBJECTIVE_GREETING[obj] ?? t("chat.defaultGreetingQuestion")}
                        </p>
                      );
                      return (
                        <p className="text-sm leading-relaxed max-w-sm mx-auto" style={{ color: "var(--muted)" }}>
                          {!isAuthenticated || getUserLevel(profile) === "basico"
                            ? t("chat.welcomeSubtitleBasic")
                            : t("chat.welcomeSubtitleDefault")}
                        </p>
                      );
                    })()}
                  </div>

                  {/* Context chips strip */}
                  {profile && (
                    <div className="border-t px-5 py-3 flex flex-wrap gap-2"
                         style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                      {profile.risk_tolerance && (
                        <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full border"
                              style={{ borderColor: "var(--border)", color: "var(--muted)", background: "var(--card)" }}>
                          🎯 {RISK_LABEL[profile.risk_tolerance] ?? profile.risk_tolerance}
                        </span>
                      )}
                      {(() => {
                        const level = getUserLevel(profile);
                        return (
                          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border"
                                style={{ borderColor: "var(--border)", color: LEVEL_COLOR[level], background: "var(--card)" }}>
                            📊 {LEVEL_LABEL[level]}
                          </span>
                        );
                      })()}
                      {positions.length > 0 && (
                        <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full border"
                              style={{ borderColor: "var(--border)", color: "var(--muted)", background: "var(--card)" }}>
                          💼 {positions.length !== 1 ? t("chat.positionsCount", { count: positions.length }) : t("chat.positionsCountSingular", { count: positions.length })}
                        </span>
                      )}
                      {!isPremium && (
                        <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full border ml-auto"
                              style={{ borderColor: "rgba(244,63,94,0.25)", color: "var(--down)", background: "rgba(244,63,94,0.05)" }}>
                          {t("chat.msgToday", { count: remaining })}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Suggestion cards */}
                {(() => {
                  const obj = profile?.quiz_answers?.objective as string | undefined;
                  const level = getUserLevel(profile);
                  const effectiveLevel = !isAuthenticated ? "basico" : level;
                  const suggestions = obj && SUGGESTIONS_BY_OBJECTIVE[obj]
                    ? SUGGESTIONS_BY_OBJECTIVE[obj]
                    : (SUGGESTIONS_BY_LEVEL[effectiveLevel] ?? SUGGESTIONS_DEFAULT);
                  return (
                    <div className="w-full">
                      <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--muted)" }}>
                        {t("chat.suggestedQuestions")}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {suggestions.map((s, si) => (
                          <button key={si} onClick={() => sendMessage(s)}
                                  className="text-left p-4 rounded-xl border transition-all hover:scale-[1.01] group"
                                  style={{ background: "var(--card)", borderColor: "var(--border)" }}
                                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = accentCol + "60"; }}
                                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}>
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm leading-relaxed" style={{ color: "var(--sub)" }}>{s}</p>
                              <ChevronRight className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                            style={{ color: "var(--accent-l)" }} />
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ─── Message list ──────────────────────────────────────────── */}
            {messages.map((msg, i) => (
              <div key={i} className="animate-fade-in">
                <div className={`flex ${msg.role === "user" ? "justify-end items-start gap-2.5 group/msg" : "justify-start gap-2.5"}`}>

                  {/* AI avatar */}
                  {msg.role === "assistant" && (
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 text-sm overflow-hidden"
                         style={{
                           background: mentor ? mentor.color + "20" : "rgba(0,185,109,0.15)",
                           border: `1px solid ${mentor ? mentor.color + "35" : "rgba(0,185,109,0.25)"}`,
                         }}>
                      {mentor ? mentor.emoji : <TrendingUp className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />}
                    </div>
                  )}

                  {/* Bubble */}
                  {msg.role === "user" ? (
                    <>
                      {/* ── User message column ── */}
                      <div className="flex flex-col items-end" style={{ maxWidth: "72%" }}>
                        {/* Sender label */}
                        <span className="text-[10px] font-semibold tracking-wide mb-1.5 mr-0.5 select-none"
                              style={{ color: "var(--dim)" }}>
                          {t("chat.you")}
                        </span>
                        {/* Bubble */}
                        <div className="bubble-user">
                          {msg.images && msg.images.length > 0 && (
                            <div className={`flex flex-wrap gap-1.5${msg.content ? " mb-2.5" : ""}`}>
                              {msg.images.map((img, idx) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img key={idx} src={img.preview} alt=""
                                     className="rounded-xl object-cover"
                                     style={{ maxWidth: 200, maxHeight: 180 }} />
                              ))}
                            </div>
                          )}
                          {msg.content && <span>{msg.content}</span>}
                        </div>
                        {/* Action row — appears on hover */}
                        <div className="flex items-center gap-0.5 mt-1.5 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-150">
                          <button onClick={() => handleEditMessage(i, msg.content)}
                                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium hover:bg-white/5 transition-colors"
                                  style={{ color: "var(--dim)" }}>
                            <Pencil className="w-2.5 h-2.5" />
                            {t("chat.edit")}
                          </button>
                          {msg.content && (
                            <button onClick={() => navigator.clipboard.writeText(msg.content)}
                                    className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium hover:bg-white/5 transition-colors"
                                    style={{ color: "var(--dim)" }}>
                              <Copy className="w-2.5 h-2.5" />
                              {t("chat.copy")}
                            </button>
                          )}
                        </div>
                      </div>
                      {/* User avatar */}
                      <div className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center text-[11px] font-bold mt-[26px]"
                           style={{
                             background: "linear-gradient(135deg, rgba(0,185,109,0.20) 0%, rgba(0,90,200,0.12) 100%)",
                             border: "1px solid rgba(0,185,109,0.25)",
                             color: "var(--accent-l)",
                             boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
                           }}>
                        {profile?.name ? profile.name.charAt(0).toUpperCase() : "T"}
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 min-w-0">
                      {/* ── AI message card ── */}
                      <div className="rounded-2xl border px-4 py-3.5 overflow-hidden"
                           style={{
                             background: "var(--card)",
                             borderColor: "var(--border)",
                             borderLeftWidth: 3,
                             borderLeftColor: mentor ? mentor.color + "70" : "rgba(0,185,109,0.5)",
                           }}>
                        {voiceAudio && msg.content && msg.content.slice(0, 80) === voiceAudio.content && !(isStreaming && i === messages.length - 1) ? (
                          <div className="flex items-center gap-3 py-1">
                            <div className="flex items-end gap-0.5 shrink-0" style={{ height: 32 }}>
                              {[0.35,0.65,0.85,0.55,0.95,0.7,0.45,0.8,0.6,0.4,0.75,0.5].map((h, bi) => (
                                <div key={bi} style={{
                                  width: 3, height: `${h * 100}%`,
                                  background: mentor?.color ?? "var(--accent)",
                                  borderRadius: 2, opacity: voiceAudio.playing ? 1 : 0.5,
                                  transition: "opacity 0.2s",
                                }} />
                              ))}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold" style={{ color: "var(--text)" }}>
                                {voiceAudio.loading ? t("chat.generatingAudio") : voiceAudio.playing ? t("chat.playingAudio") : t("chat.voiceResponseLabel")}
                              </p>
                              <p className="text-[10px]" style={{ color: "var(--muted)" }}>
                                {t("chat.educationalDisclaimerShort")}
                              </p>
                            </div>
                            {voiceAudio.loading ? (
                              <span className="w-9 h-9 border-2 border-t-transparent rounded-full animate-spin shrink-0"
                                    style={{ borderColor: mentor?.color ?? "var(--accent)" }} />
                            ) : (
                              <button onClick={playVoiceResponse} disabled={voiceAudio.playing}
                                      className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 disabled:opacity-50 transition-all"
                                      style={{ background: mentor?.color ?? "var(--accent)", boxShadow: `0 0 16px ${mentor?.color ?? "rgba(0,212,126,0.25)"}40` }}>
                                {voiceAudio.playing
                                  ? <Square className="w-3.5 h-3.5" style={{ color: "#fff" }} fill="#fff" />
                                  : <Play className="w-3.5 h-3.5 ml-0.5" style={{ color: "#fff" }} fill="#fff" />}
                              </button>
                            )}
                          </div>
                        ) : (
                          <>
                            <div className="prose-dark">
                              {msg.content === "" && isStreaming && i === messages.length - 1
                                ? <TypingDots />
                                : <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>}
                            </div>
                            {msg.content !== "" && !(isStreaming && i === messages.length - 1) && (
                              <p className="mt-3 pt-2.5 border-t text-[10px] leading-tight"
                                 style={{ color: "var(--dim)", borderColor: "var(--border)" }}>
                                {t("chat.educationalDisclaimerFull")}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* BScore card */}
                {msg.role === "assistant" && i === messages.length - 1 && lastAssessment && !isStreaming && (
                  <BScoreCard data={lastAssessment} />
                )}

                {/* Welcome quick-reply chips — only on the first assistant message when tour is active */}
                {msg.role === "assistant" && i === 0 && messages.length === 1 && guidedTour && !isStreaming && (
                  <div className="flex flex-wrap gap-2 mt-3 ml-11">
                    {[
                      { label: t("chat.quickReplyHasPositions"),         msg: t("chat.quickReplyHasPositionsMsg") },
                      { label: t("chat.quickReplyStartingFresh"),        msg: t("chat.quickReplyStartingFreshMsg") },
                      { label: t("chat.quickReplyWant1on1"),              msg: t("chat.quickReplyWant1on1Msg") },
                    ].map((chip, ci) => (
                      <button
                        key={ci}
                        onClick={() => sendMessage(chip.msg)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold border transition-all hover:opacity-80 active:scale-95"
                        style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--sub)" }}
                      >
                        {ci === 0 ? "📊" : ci === 1 ? "🌱" : "🎯"} {chip.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Action chips */}
                {msg.role === "assistant" && i === messages.length - 1 && pendingActions && !isStreaming && (
                  <div className="flex flex-wrap gap-2 mt-2 ml-11">
                    {pendingActions.map((action, ai) => (
                      <div key={ai} className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            if (action.type === "decision") {
                              const d = action.data as Record<string, string>;
                              setDecisionModal({ action: d.action ?? "hold", ticker: d.ticker ?? "", notes: d.notes ?? "" });
                            } else if (action.type === "chat") {
                              const d = action.data as Record<string, string>;
                              sendMessage(d.message);
                            } else if (action.type === "watchlist") {
                              const d = action.data as Record<string, string>;
                              router.push(`/portfolio?add=${d.ticker}`);
                            } else if (action.type === "alert") {
                              const d = action.data as Record<string, string>;
                              router.push(`/portfolio?alert=${d.ticker}`);
                            } else if (action.type === "learn") {
                              const d = action.data as Record<string, string>;
                              router.push(`/learn?topic=${d.topic}`);
                            }
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all hover:opacity-80 active:scale-95"
                          style={{
                            background: action.type === "decision" ? "rgba(0,185,109,0.10)" : "var(--raised)",
                            borderColor: action.type === "decision" ? "rgba(0,185,109,0.35)" : "var(--border)",
                            color: action.type === "decision" ? "var(--accent-l)" : "var(--sub)",
                          }}
                        >
                          <span>
                            {action.type === "decision" ? "📝" : action.type === "watchlist" ? "👁" : action.type === "alert" ? "🔔" : action.type === "learn" ? "📚" : "→"}
                          </span>
                          {action.label}
                        </button>
                        {action.type !== "chat" && (
                          <button
                            onClick={async () => {
                              if (committedActions.has(ai)) return;
                              try {
                                const { default: api } = await import("@/lib/api");
                                await api.post("/api/actions/commit", { type: action.type, label: action.label, data: action.data });
                                setCommittedActions(prev => new Set([...prev, ai]));
                              } catch { /* silent */ }
                            }}
                            title={t("chat.remindMeTooltip")}
                            className="flex items-center justify-center w-6 h-6 rounded-full border transition-all hover:opacity-80 active:scale-95 text-xs"
                            style={{
                              background: committedActions.has(ai) ? "rgba(0,185,109,0.12)" : "var(--raised)",
                              borderColor: committedActions.has(ai) ? "rgba(0,185,109,0.4)" : "var(--border)",
                              color: committedActions.has(ai) ? "var(--accent-l)" : "var(--muted)",
                            }}
                          >
                            {committedActions.has(ai) ? "✓" : "🔔"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* ─── Scroll to bottom ──────────────────────────────────────────── */}
          {showScrollBtn && (
            <div className="relative h-0 flex justify-center">
              <button
                onClick={scrollToBottom}
                className="absolute -top-12 flex items-center justify-center w-8 h-8 rounded-full shadow-lg transition-opacity duration-200 hover:opacity-80"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 6l4 4 4-4" stroke="var(--text)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          )}

          {/* ─── Guided tour banner ────────────────────────────────────────── */}
          {guidedTour && guidedStep <= GUIDED_STEPS.length && (
            <div className="shrink-0 px-4 pt-3 pb-0 max-w-3xl mx-auto w-full">
              <div className="rounded-2xl border overflow-hidden"
                   style={{ background: "rgba(0,168,94,0.06)", borderColor: "rgba(0,168,94,0.25)" }}>
                <div className="flex items-center justify-between px-4 py-2.5 border-b"
                     style={{ borderColor: "rgba(0,168,94,0.15)" }}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black" style={{ color: "var(--accent-l)" }}>
                      {t("chat.guidedTourTitle")}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: "rgba(0,168,94,0.15)", color: "var(--accent-l)" }}>
                      {t("chat.guidedStepsCompleted", { completed: guidedStep - 1, total: GUIDED_STEPS.length })}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setGuidedTour(false);
                      localStorage.removeItem("nuvos_guided_tour");
                      localStorage.removeItem("nuvos_guided_step");
                    }}
                    className="text-xs transition-opacity hover:opacity-60"
                    style={{ color: "var(--dim)" }}
                  >
                    {t("chat.skipTour")}
                  </button>
                </div>
                <div className="flex items-stretch">
                  {GUIDED_STEPS.map((s, i) => {
                    const done = i < guidedStep - 1;
                    const active = i === guidedStep - 1;
                    return (
                      <div key={i}
                           className="flex-1 flex flex-col items-center gap-1 px-2 py-2.5 text-center"
                           style={{ borderLeft: i > 0 ? "1px solid rgba(0,168,94,0.15)" : "none" }}>
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0"
                             style={{
                               background: done ? "#00a85e" : active ? "rgba(0,168,94,0.15)" : "var(--raised)",
                               border: active ? "2px solid #00a85e" : "none",
                             }}>
                          {done ? "✓" : s.emoji}
                        </div>
                        <p className="text-[10px] leading-tight font-semibold"
                           style={{ color: done ? "var(--dim)" : active ? "var(--text)" : "var(--dim)" }}>
                          {s.label}
                        </p>
                        {active && s.action && (
                          <button
                            onClick={() => { router.push(s.action!); setGuidedStep(i + 2); localStorage.setItem("nuvos_guided_step", String(i + 2)); }}
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full mt-0.5"
                            style={{ background: "#00a85e", color: "#000" }}
                          >
                            {t("chat.goTo")}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ─── Sesión 1:1 card ───────────────────────────────────────────── */}
          {show1on1 && !dismissed1on1 && guidedTour && (
            <div className="shrink-0 px-4 pt-3 pb-0 max-w-3xl mx-auto w-full">
              <div className="rounded-2xl border p-4 flex gap-3"
                   style={{ background: "rgba(99,102,241,0.06)", borderColor: "rgba(99,102,241,0.25)" }}>
                <div className="text-2xl shrink-0">🎯</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black mb-0.5" style={{ color: "var(--text)" }}>
                    {t("chat.oneOnOneTitle")}
                  </p>
                  <p className="text-xs leading-relaxed mb-3" style={{ color: "var(--muted)" }}>
                    {t("chat.oneOnOneDesc")}
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => {
                        setShow1on1(false);
                        setDismissed1on1(false);
                        sessionStorage.removeItem("nuvos_1on1_dismissed");
                        sendMessage(t("chat.oneOnOneRequestMsg"));
                      }}
                      className="text-xs font-bold px-3 py-1.5 rounded-full"
                      style={{ background: "rgba(99,102,241,0.8)", color: "white" }}
                    >
                      {t("chat.oneOnOneCta")}
                    </button>
                    <button
                      onClick={() => {
                        setShow1on1(false);
                        setDismissed1on1(true);
                        sessionStorage.setItem("nuvos_1on1_dismissed", "1");
                      }}
                      className="text-xs px-3 py-1.5 rounded-full transition-opacity hover:opacity-70"
                      style={{ color: "var(--dim)" }}
                    >
                      {t("chat.oneOnOneDismiss")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── Input bar ─────────────────────────────────────────────────── */}
          <div className="shrink-0 px-4 pb-4 pt-3"
               style={{ borderTop: "1px solid var(--border)", background: "var(--card)" }}>

            {/* Paywall banner */}
            {remaining === 0 && !isPremium && (
              <div className="max-w-3xl mx-auto mb-3 px-4 py-2.5 rounded-xl flex items-center justify-between"
                   style={{ background: "rgba(244,63,94,0.06)", border: "1px solid rgba(244,63,94,0.2)" }}>
                <span className="text-xs" style={{ color: "var(--down)" }}>
                  {t("chat.limitReachedBanner", { limit: FREE_MSG_LIMIT })}
                </span>
                <button onClick={() => { setPaywallReason(undefined); setPaywallOpen(true); }}
                        className="text-xs font-bold ml-3 shrink-0" style={{ color: "var(--accent-l)" }}>
                  {t("chat.activatePremium")}
                </button>
              </div>
            )}

            <div className="max-w-3xl mx-auto relative"
                 onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>

              {/* Drag overlay */}
              {isDragging && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed pointer-events-none"
                     style={{ borderColor: "var(--accent)", background: "rgba(0,212,126,0.06)" }}>
                  <span className="text-sm font-bold" style={{ color: "var(--accent)" }}>{t("chat.dropImagesHere")}</span>
                </div>
              )}

              {/* Input card */}
              <div className="rounded-2xl border overflow-hidden"
                   style={{ background: "var(--raised)", borderColor: "var(--border)" }}>

                {/* Image thumbnails */}
                {pendingImages.length > 0 && (
                  <div className="flex gap-2 flex-wrap px-3 pt-3">
                    {pendingImages.map((img, idx) => (
                      <div key={idx} className="relative w-14 h-14 rounded-xl overflow-hidden border shrink-0"
                           style={{ borderColor: "var(--border)" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img.preview} alt="" className="w-full h-full object-cover" />
                        <button onClick={() => removeImage(idx)}
                                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center"
                                style={{ background: "rgba(0,0,0,0.75)" }}>
                          <X className="w-3 h-3 text-white" />
                        </button>
                      </div>
                    ))}
                    {pendingImages.length < 8 && (
                      <button onClick={() => fileInputRef.current?.click()}
                              className="w-14 h-14 rounded-xl border-2 border-dashed flex items-center justify-center shrink-0"
                              style={{ borderColor: "var(--border)" }}>
                        <ImagePlus className="w-4 h-4" style={{ color: "var(--muted)" }} />
                      </button>
                    )}
                  </div>
                )}

                {/* Send error */}
                {sendError && (
                  <div className="mx-3 mb-1 px-3 py-2 rounded-xl text-xs flex items-center gap-2"
                       style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <span className="flex-1">{sendError}</span>
                    <button onClick={() => setSendError(null)} className="shrink-0 opacity-60 hover:opacity-100">✕</button>
                  </div>
                )}

                {/* Textarea + send */}
                <div className="flex items-end gap-2 px-3 pt-3 pb-2">
                  <textarea
                    id="tour-chat-input"
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={
                      remaining === 0 && !isPremium
                        ? t("chat.placeholderLimitReached")
                        : pendingImages.length > 0
                        ? t("chat.placeholderDescribeImage", { target: pendingImages.length === 1 ? t("chat.targetImageSingle") : t("chat.targetImagePlural") })
                        : t("chat.placeholderDefault")
                    }
                    rows={1}
                    disabled={isStreaming || (remaining === 0 && !isPremium)}
                    className="flex-1 resize-none bg-transparent text-sm py-1.5 outline-none leading-relaxed placeholder:text-sm"
                    style={{ color: "var(--text)", maxHeight: 120, overflowY: "auto", caretColor: "var(--accent-l)" }}
                  />
                  <button
                    onClick={isStreaming ? handleStop : () => sendMessage()}
                    disabled={!isStreaming && ((!input.trim() && pendingImages.length === 0) || (remaining === 0 && !isPremium))}
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all disabled:opacity-30"
                    style={{
                      background: isStreaming ? "rgba(244,63,94,0.15)" : "var(--grad-green)",
                      border: isStreaming ? "1px solid rgba(244,63,94,0.3)" : "none",
                      boxShadow: isStreaming ? "none" : "var(--shadow-accent-sm)",
                    }}>
                    {isStreaming
                      ? <Square className="w-3.5 h-3.5" style={{ color: "#f87171" }} />
                      : <Send className="w-3.5 h-3.5 text-white" />}
                  </button>
                </div>

                {/* Action toolbar */}
                <div className="flex items-center gap-0.5 px-2 pb-2.5">
                  <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageSelect} />

                  <button onClick={() => fileInputRef.current?.click()} disabled={isStreaming}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-white/5 disabled:opacity-30 transition-colors"
                          style={{ color: "var(--muted)" }}>
                    <ImagePlus className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{t("chat.toolbarImage")}</span>
                  </button>

                  <button onClick={startRecording} disabled={isStreaming || isTranscribing || showVoiceModal}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-white/5 disabled:opacity-30 transition-colors"
                          style={{ color: isTranscribing ? "#818cf8" : "var(--muted)" }}>
                    {isTranscribing
                      ? <span className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                      : <Mic className="w-3.5 h-3.5" />}
                    <span className="hidden sm:inline">{isTranscribing ? t("chat.toolbarTranscribing") : t("chat.toolbarVoice")}</span>
                  </button>

                  <button
                    onClick={() => {
                      if (!isPremium) {
                        setPaywallReason(t("chat.callPremiumOnly"));
                        setPaywallOpen(true);
                        return;
                      }
                      setShowCallModal(true);
                    }}
                    disabled={isStreaming}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-white/5 disabled:opacity-30 transition-colors"
                    style={{ color: "var(--muted)" }}
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{t("chat.toolbarCall")}</span>
                  </button>

                  <div className="flex-1" />

                  <span className="text-[9px] hidden md:block" style={{ color: "var(--dim)" }}>
                    {t("chat.enterToSend")}
                  </span>
                </div>
              </div>

              <p className="text-center text-[10px] mt-2" style={{ color: "var(--dim)" }}>
                {t("chat.eduFooter")}
              </p>
            </div>
          </div>
        </main>
      </div>

      {/* ── Voice recording modal ──────────────────────────────────────────── */}
      {showVoiceModal && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center"
             style={{ background: "rgba(0,0,0,0.95)" }}>
          <div className="flex flex-col items-center w-full max-w-xs px-6">
            <canvas ref={waveCanvasRef} width={280} height={80} className="block mb-8" style={{ borderRadius: 8 }} />
            <div className="text-5xl font-mono font-bold mb-1 tabular-nums" style={{ color: "#fff", letterSpacing: "0.04em" }}>
              {String(Math.floor(recordingSecs / 60)).padStart(2, "0")}:{String(recordingSecs % 60).padStart(2, "0")}
            </div>
            <p className="text-sm mb-10" style={{ color: "rgba(255,255,255,0.35)" }}>{t("chat.recordingAudio")}</p>
            <button onClick={stopRecording}
                    className="w-20 h-20 rounded-full flex items-center justify-center mb-8 transition-transform active:scale-95"
                    style={{ background: "#ef4444", boxShadow: "0 0 40px rgba(239,68,68,0.4)" }}>
              <Square className="w-7 h-7 text-white" fill="white" />
            </button>
            <button onClick={cancelRecording}
                    className="text-sm font-medium hover:opacity-60 transition-opacity"
                    style={{ color: "rgba(255,255,255,0.4)" }}>
              {t("chat.cancel")}
            </button>
          </div>
        </div>
      )}

      {showCallModal && <VoiceCallModal onClose={() => setShowCallModal(false)} />}

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={paywallReason} />
      <TutorialModal />

      {/* Decision journal modal */}
      {decisionModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
          onClick={() => setDecisionModal(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-5 flex flex-col gap-3"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{t("chat.decisionModalTitle")}</p>
            <p className="text-xs" style={{ color: "var(--sub)" }}>
              {t("chat.decisionModalDesc")}
            </p>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold" style={{ color: "var(--sub)" }}>{t("chat.decisionLabel")}</label>
              <input
                className="rounded-lg px-3 py-2 text-sm outline-none border focus:border-[var(--accent)]"
                style={{ background: "var(--raised)", border: "1px solid var(--border)", color: "var(--text)" }}
                value={decisionModal.action}
                onChange={(e) => setDecisionModal({ ...decisionModal, action: e.target.value })}
                placeholder={t("chat.decisionPlaceholder")}
              />
              <label className="text-xs font-semibold" style={{ color: "var(--sub)" }}>{t("chat.tickerLabel")}</label>
              <input
                className="rounded-lg px-3 py-2 text-sm outline-none border focus:border-[var(--accent)]"
                style={{ background: "var(--raised)", border: "1px solid var(--border)", color: "var(--text)" }}
                value={decisionModal.ticker}
                onChange={(e) => setDecisionModal({ ...decisionModal, ticker: e.target.value })}
                placeholder={t("chat.tickerPlaceholder")}
              />
              <label className="text-xs font-semibold" style={{ color: "var(--sub)" }}>{t("chat.notesLabel")}</label>
              <textarea
                rows={3}
                className="rounded-lg px-3 py-2 text-sm outline-none border focus:border-[var(--accent)] resize-none"
                style={{ background: "var(--raised)", border: "1px solid var(--border)", color: "var(--text)" }}
                value={decisionModal.notes}
                onChange={(e) => setDecisionModal({ ...decisionModal, notes: e.target.value })}
                placeholder={t("chat.notesPlaceholder")}
              />
            </div>
            <div className="flex gap-2 mt-1">
              <button
                className="flex-1 py-2 rounded-xl text-sm font-semibold transition-colors"
                style={{ background: "var(--raised)", color: "var(--sub)" }}
                onClick={() => setDecisionModal(null)}
              >{t("chat.cancel")}</button>
              <button
                className="flex-1 py-2 rounded-xl text-sm font-semibold transition-colors"
                style={{ background: "var(--accent)", color: "#fff" }}
                onClick={async () => {
                  try {
                    await decisionsApi.log({ action: decisionModal.action, ticker: decisionModal.ticker, notes: decisionModal.notes, date: new Date().toISOString() });
                  } catch {}
                  setDecisionSaved(true);
                  setTimeout(() => { setDecisionSaved(false); setDecisionModal(null); }, 1500);
                }}
              >
                {decisionSaved ? t("chat.saved") : t("chat.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {isTour && (
        <TourSpotlight
          targetId="tour-chat-input"
          step={3}
          title={t("chat.tourTitle")}
          description={t("chat.tourDesc")}
          ctaLabel={t("chat.tourCta")}
        />
      )}
    </div>
  );
}
