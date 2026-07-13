import React, { useState, useRef, useEffect, useMemo } from "react";
import { router, useLocalSearchParams } from "expo-router";
import MobileTourBanner from "../../src/components/MobileTourBanner";
import * as ImagePicker from "expo-image-picker";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import {
  View, Text, TextInput, TouchableOpacity, FlatList, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, Image, Animated, Alert, Modal, AppState,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Markdown from "react-native-markdown-display";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useLanguage } from "../../src/lib/LanguageContext";
import { chatApi, marketApi, decisionsApi } from "../../src/lib/api";
import { posthog } from "../../src/config/posthog";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { useAppStore, RISK_CONFIG, getAge } from "../../src/lib/profileStore";
import { getUserLevel, LEVEL_LABEL, LEVEL_COLOR } from "../../src/lib/userLevel";
import { useChatStore, Message, BehavioralDiagnosis } from "../../src/lib/chatStore";
import { usePortfolioStore } from "../../src/lib/portfolioStore";
import { useSubscriptionStore, msgsRemaining, resetMinutes, FREE_MSG_LIMIT, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import PaywallModal from "../../src/components/PaywallModal";
import UpsellModal from "../../src/components/UpsellModal";
import { useUpsellStore } from "../../src/lib/upsellStore";
import StockChart from "../../src/components/StockChart";
import FirstActionModal from "../../src/components/FirstActionModal";
import VoiceCallModal from "../../src/components/VoiceCallModal";
import TutorialModal from "../../src/components/TutorialModal";
import { getMentorInfo } from "../../src/lib/mentorData";

function TypingIndicator({ color }: { color: string }) {
  const d1 = useRef(new Animated.Value(0)).current;
  const d2 = useRef(new Animated.Value(0)).current;
  const d3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: -6, duration: 290, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0,  duration: 290, useNativeDriver: true }),
          Animated.delay(400 - delay),
        ])
      );
    const a1 = anim(d1, 0);
    const a2 = anim(d2, 180);
    const a3 = anim(d3, 360);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, []);

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 2 }}>
      {([d1, d2, d3] as Animated.Value[]).map((dot, i) => (
        <Animated.View
          key={i}
          style={{
            width: 9, height: 9, borderRadius: 5,
            backgroundColor: color,
            transform: [{ translateY: dot }],
          }}
        />
      ))}
    </View>
  );
}

const MENTOR_PHOTOS: Record<string, number> = {
  "Warren Buffett": require("../../assets/images/mentors/warren_buffett.jpg"),
  "Ray Dalio":      require("../../assets/images/mentors/ray_dalio.jpg"),
  "Bill Ackman":    require("../../assets/images/mentors/bill_ackman.jpg"),
};

function getSuggestionsDefault(t: TFunction): string[] {
  return t("chat.suggestionsDefault", { returnObjects: true }) as string[];
}

function getSuggestionsByLevel(t: TFunction): Record<string, string[]> {
  return t("chat.suggestionsByLevel", { returnObjects: true }) as Record<string, string[]>;
}

function getSuggestionsByObjective(t: TFunction): Record<string, string[]> {
  return t("chat.suggestionsByObjective", { returnObjects: true }) as Record<string, string[]>;
}

function getObjectiveGreeting(t: TFunction): Record<string, string> {
  return t("chat.objectiveGreeting", { returnObjects: true }) as Record<string, string>;
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = insets.top + 104;
  const { tour, ctx, msg: msgParam } = useLocalSearchParams<{ tour?: string; ctx?: string; msg?: string }>();
  const isTour = tour === "3"; // MobileHeader row (52) + MarketTicker (52)
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { language } = useLanguage();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const markdownStyles = useMemo(() => makeMarkdownStyles(colors), [colors]);
  const markdownRules = useMemo(() => ({
    table: (node: any, children: React.ReactNode[]) => (
      <ScrollView
        key={node.key}
        horizontal
        showsHorizontalScrollIndicator={false}
        bounces={false}
        style={{ marginVertical: 8 }}
      >
        <View style={{
          borderWidth: 1, borderColor: colors.border,
          borderRadius: 10, overflow: "hidden" as const,
        }}>
          {children}
        </View>
      </ScrollView>
    ),
  }), [colors]);
  const profile = useAppStore((s) => s.profile);
  const maturityScore = useAppStore((s) => s.maturityScore);
  const updateMaturity = useAppStore((s) => s.updateMaturity);
  const hasSeenTutorial = useAppStore((s) => s.hasSeenTutorial);
  const markTutorialSeen = useAppStore((s) => s.markTutorialSeen);
  const riskCfg = profile?.risk_tolerance ? RISK_CONFIG[profile.risk_tolerance] : null;
  const pct = riskCfg ? Math.round(riskCfg.pct * 100) : 0;
  const mentor = getMentorInfo(profile?.mentor);
  const mentorPhoto = mentor ? MENTOR_PHOTOS[mentor.id] : null;

  const { currentId, currentMessages, setMessages, createSession, currentDiagnosis, setDiagnosis, restoreFromServer, sessions, syncSessionMessages } = useChatStore();
  const messages = currentMessages();
  const diagnosis = currentDiagnosis();
  const positions = usePortfolioStore((s) => s.positions);

  const subStore = useSubscriptionStore();
  const { activeOffer, userTier: upsellTier, prices: upsellPrices, triggerSource: upsellSource, trigger: upsellTrigger, dismiss: upsellDismiss } = useUpsellStore();
  const subTier = subStore.tier;
  const fetchSubStatus = subStore.fetchStatus;
  const incrementMsgCount = subStore.incrementMsgCount;
  const remaining = msgsRemaining({ tier: subTier, msgCount: subStore.msgCount, msgWindowStart: subStore.msgWindowStart });
  const isPremiumAccess = hasPremiumAccess(subStore);

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [pendingImages, setPendingImages] = useState<Array<{ data: string; type: string; uri: string }>>([]);
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const [lastTicker, setLastTicker] = useState<string | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallReason, setPaywallReason] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [showRecordingModal, setShowRecordingModal] = useState(false);
  const [recordingSecs, setRecordingSecs] = useState(0);
  const [showCallModal, setShowCallModal] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meteringRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waveAnimValues = useRef<Animated.Value[]>(
    Array.from({ length: 24 }, () => new Animated.Value(0.12))
  ).current;
  const voiceInputRef = useRef(false); // true while a voice-originated message is in flight
  const listRef = useRef<FlatList>(null);
  const cancelRef = useRef({ cancelled: false });
  const inputRef = useRef<TextInput>(null);
  const isAtBottom = useRef(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [notificationContext, setNotificationContext] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<Array<{ type: string; label: string; data: Record<string, unknown> }> | null>(null);
  const [committedActions, setCommittedActions] = useState<Set<number>>(new Set());
  const [decisionModal, setDecisionModal] = useState<{ action: string; ticker: string; notes: string } | null>(null);
  const [decisionSaved, setDecisionSaved] = useState(false);

  // Handle notification deep-link params
  useEffect(() => {
    if (ctx) setNotificationContext(decodeURIComponent(ctx));
    if (msgParam) setInput(decodeURIComponent(msgParam));
  }, [ctx, msgParam]);

  // Cross-device sync
  const syncCursorRef = useRef<string | null>(null);
  const localFingerprintsRef = useRef<Set<string>>(new Set());
  const fp = (role: string, content: string) => `${role}:${content.slice(0, 60)}`;

  // On first load: restore history from server then always open a fresh empty session.
  // Also open a fresh session whenever the app returns from background (treat as a new visit).
  useEffect(() => {
    const appStateRef = { current: AppState.currentState };
    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === "active") {
        createSession();
      }
      appStateRef.current = nextState;
    });

    const init = async () => {
      await restoreFromServer();
      createSession();
      try {
        const res = await chatApi.getHistory();
        const msgs: { created_at?: string }[] = res.data?.messages ?? [];
        syncCursorRef.current = msgs[msgs.length - 1]?.created_at ?? new Date().toISOString();
      } catch {
        syncCursorRef.current = new Date().toISOString();
      }
    };
    init();

    const poll = setInterval(async () => {
      if (!syncCursorRef.current) return;
      try {
        const res = await chatApi.getHistory(syncCursorRef.current);
        const newMsgs: { role: string; content: string; created_at?: string; session_id?: string | null }[] = res.data?.messages ?? [];
        if (newMsgs.length === 0) return;
        const foreign = newMsgs.filter((m) => !localFingerprintsRef.current.has(fp(m.role, m.content)));
        if (foreign.length > 0) {
          const bySession = new Map<string, typeof foreign>();
          for (const m of foreign) {
            const sid = m.session_id ?? "__legacy__";
            if (!bySession.has(sid)) bySession.set(sid, []);
            bySession.get(sid)!.push(m);
          }
          for (const [sid, msgs] of bySession) {
            const chatMsgs: Message[] = msgs.map((m) => ({ role: m.role as "user" | "assistant", content: m.content, timestamp: Date.now() }));
            if (sid === "__legacy__") {
              const current = useChatStore.getState().currentMessages();
              setMessages([...current, ...chatMsgs]);
            } else {
              syncSessionMessages(sid, chatMsgs);
            }
          }
        }
        syncCursorRef.current = newMsgs[newMsgs.length - 1].created_at ?? syncCursorRef.current;
      } catch {}
    }, 8000);

    return () => { clearInterval(poll); appStateSub.remove(); };
  }, []);

  // Refresh subscription status on mount
  useEffect(() => { fetchSubStatus(); }, []);
  useEffect(() => {
    if (!hasSeenTutorial) setTimeout(() => setTutorialVisible(true), 1000);
  }, []);

  // Fetch live prices for portfolio positions
  useEffect(() => {
    if (positions.length === 0) return;
    const tickers = positions.map((p) => p.ticker);
    marketApi.getPrices(tickers)
      .then((res) => {
        const prices: Record<string, number> = {};
        for (const item of res.data?.prices ?? []) {
          if (item.ticker && item.price) prices[item.ticker] = item.price;
        }
        setLivePrices(prices);
      })
      .catch(() => {});
  }, [positions.length]);

  const handleNewChat = () => {
    if (streaming) return;
    createSession();
    setInput("");
  };

  const buildProfileContext = () => {
    if (!profile) return null;
    const riskLabel = riskCfg ? riskCfg.label : "";
    const qa = profile.quiz_answers;
    const q1Labels = { A: "vende ante caídas (reactivo conservador)", B: "espera sin actuar (pasivo)", C: "analiza fundamentos y mantiene (racional)", D: "compra más en caídas (inversor de valor)" };
    const q2Labels = { A: "necesita el dinero en menos de 2 años", B: "horizonte de 3–5 años para algo específico", C: "10+ años, busca independencia financiera o retiro", D: "largo plazo sin prisa, construir patrimonio" };
    const q3Labels = { A: "principiante — apenas empieza", B: "básico — conoce CETES, interés compuesto, fondos indexados", C: "intermedio — entiende P/E, diversificación, riesgo ajustado", D: "avanzado — maneja análisis fundamental, derivados, ciclos" };
    const q4Labels = { A: "conservador — prefiere $5K garantizado sin riesgo", B: "moderado-bajo — acepta riesgo de $5K por posible $15K", C: "moderado-alto — acepta riesgo de $20K por posible $40K", D: "especulador — arriesga todo por posible $120K" };
    const q5Labels = { A: "pasivo — prefiere inversión automática sin monitoreo", B: "semipasivo — revisión mensual o trimestral", C: "activo — revisiones semanales con ajustes", D: "muy activo — gestión diaria dedicada" };
    // Derive behavioral flags from quiz answers for contradiction detection
    const panicFlag = qa?.q1 === "A"
      ? "ALERTA: declaró que vende ante caídas — muy probable que entre en pánico con pérdidas reales"
      : qa?.q1 === "D"
      ? "Declaró que compra más en caídas — si muestra pánico en conversación, es una contradicción fuerte"
      : "";
    const speculationFlag = qa?.q4 === "A"
      ? "ALERTA: eligió el escenario más conservador con dinero real — si pide activos especulativos, nómbralo"
      : qa?.q4 === "D"
      ? "Declaró apetito especulativo máximo — si entra en pánico con volatilidad normal, es contradicción"
      : "";

    // Portfolio block
    let portfolioBlock = "\n\n[PORTAFOLIO REAL DEL USUARIO]";
    if (positions.length === 0) {
      portfolioBlock += "\nEl usuario aún no tiene posiciones registradas en su portafolio.";
    } else {
      let totalInvested = 0;
      let totalCurrent = 0;
      const posLines: { p: typeof positions[0]; invested: number; current: number; currentPrice: number }[] = [];
      for (const p of positions) {
        const invested = p.shares * p.avgPrice;
        const currentPrice = livePrices[p.ticker] ?? p.avgPrice;
        const current = p.shares * currentPrice;
        totalInvested += invested;
        totalCurrent += current;
        posLines.push({ p, invested, current, currentPrice });
      }
      portfolioBlock += `\nCapital invertido: $${totalInvested.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
      portfolioBlock += `\nValor actual: $${totalCurrent.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
      const totalPnl = totalInvested > 0 ? ((totalCurrent - totalInvested) / totalInvested * 100) : 0;
      portfolioBlock += ` (${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(1)}% total)`;
      portfolioBlock += `\n\nPosiciones (${positions.length}):`;
      for (const { p, invested, current, currentPrice } of posLines as any[]) {
        const weight = totalCurrent > 0 ? (current / totalCurrent * 100) : 0;
        const pnl = invested > 0 ? ((current - invested) / invested * 100) : 0;
        const hasLive = !!livePrices[p.ticker];
        portfolioBlock += `\n- ${p.ticker}${p.name ? ` (${p.name})` : ""}: ${p.shares} acc × $${p.avgPrice.toFixed(2)} compra${hasLive ? ` | Precio actual: $${currentPrice.toFixed(2)} | P&L: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%` : ""} | Peso: ${weight.toFixed(1)}%`;
      }
      portfolioBlock += `\n\nUsa este portafolio para contextualizar cualquier pregunta del usuario. Analiza concentración, diversificación, correlaciones entre posiciones y cómo cada posición encaja con su perfil de riesgo. NO recomiendes comprar ni vender activos específicos — guía con análisis educativo y preguntas que ayuden al usuario a pensar por sí mismo.`;
    }

    return `[PERFIL DEL USUARIO — usa esta información para PERSONALIZAR y DETECTAR CONTRADICCIONES]
Nombre: ${profile.name}
Edad: ${profile.birth_date ? getAge(profile.birth_date) : "—"} años
Ingresos mensuales: $${Number(profile.monthly_income).toLocaleString()} USD
Aportación mensual: $${Number(profile.monthly_contribution).toLocaleString()} USD
Perfil calculado: ${riskLabel}

Diagnóstico de inversor (respuestas del cuestionario inicial):
- Comportamiento declarado ante caídas: ${qa?.q1 ? q1Labels[qa.q1] : "no disponible"}
- Horizonte / objetivo: ${qa?.q2 ? q2Labels[qa.q2] : "no disponible"}
- Nivel de conocimiento: ${qa?.q3 ? q3Labels[qa.q3] : "no disponible"}
- Tolerancia al riesgo con dinero real: ${qa?.q4 ? q4Labels[qa.q4] : "no disponible"}
- Estilo de gestión: ${qa?.q5 ? q5Labels[qa.q5] : "no disponible"}
${panicFlag ? `\n⚠️ ${panicFlag}` : ""}${speculationFlag ? `\n⚠️ ${speculationFlag}` : ""}${portfolioBlock}

Instrucciones críticas:
1. Llama siempre a este usuario por su nombre (${profile.name.split(" ")[0]}).
2. Adapta el nivel de explicación a su conocimiento.
3. Si el usuario pregunta o actúa de forma que contradice su perfil declarado (ej: perfil agresivo entra en pánico, perfil conservador pide especular), DEBES nombrarlo directamente con empatía y recalibrar tu asesoría al perfil revelado por su comportamiento real.
4. ${language === "en" ? "Always respond in English." : "Responde siempre en español."}`;
  };

  const openPaywall = (reason: string) => {
    setPaywallReason(reason);
    setPaywallVisible(true);
  };

  const handleStop = () => {
    cancelRef.current.cancelled = true;
    setStreaming(false);
  };

  const handleEditMessage = (index: number, content: string) => {
    if (streaming) {
      cancelRef.current.cancelled = true;
      setStreaming(false);
    }
    setMessages(messages.slice(0, index));
    setInput(content);
    inputRef.current?.focus();
  };

  const _clearRecordingTimers = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (meteringRef.current) { clearInterval(meteringRef.current); meteringRef.current = null; }
  };

  const startRecording = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      recordingRef.current = recording;
      setIsRecording(true);
      setRecordingSecs(0);
      setShowRecordingModal(true);

      timerRef.current = setInterval(() => setRecordingSecs((s) => s + 1), 1000);

      meteringRef.current = setInterval(async () => {
        try {
          const st = await recordingRef.current?.getStatusAsync() as any;
          if (st?.isRecording) {
            const metering: number = st.metering ?? -60;
            const level = Math.max(0, Math.min(1, (metering + 60) / 60));
            waveAnimValues.forEach((val, i) => {
              const phase = (i / waveAnimValues.length) * Math.PI * 2;
              const idle = 0.07 + 0.06 * Math.sin(Date.now() / 400 + phase);
              const target = level > 0.05
                ? Math.max(0.06, level * (0.45 + 0.55 * Math.abs(Math.sin(i * 1.4 + Date.now() / 120))))
                : idle;
              Animated.timing(val, { toValue: target, duration: 80, useNativeDriver: false }).start();
            });
          }
        } catch {}
      }, 80);
    } catch {}
  };

  const cancelRecording = async () => {
    _clearRecordingTimers();
    const recording = recordingRef.current;
    if (recording) {
      try { await recording.stopAndUnloadAsync(); } catch {}
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      recordingRef.current = null;
    }
    waveAnimValues.forEach((v) => v.setValue(0.12));
    setIsRecording(false);
    setShowRecordingModal(false);
    setRecordingSecs(0);
  };

  const stopRecording = async () => {
    _clearRecordingTimers();
    setShowRecordingModal(false);
    const recording = recordingRef.current;
    if (!recording) return;
    setIsRecording(false);
    setIsTranscribing(true);
    waveAnimValues.forEach((v) => v.setValue(0.12));
    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      recordingRef.current = null;
      const uri = recording.getURI();
      if (!uri) {
        Alert.alert(t("chat.errorTitle"), t("chat.audioNotObtained"));
        return;
      }
      const { data } = await chatApi.transcribe(uri);
      if (data?.text) {
        voiceInputRef.current = true;
        sendMessage(data.text);
      } else {
        Alert.alert(t("chat.noResultTitle"), t("chat.noVoiceDetected"));
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      const msg = err?.response?.data?.detail || err?.message || t("chat.unknownError");
      Alert.alert(t("chat.transcribeErrorTitle"), msg);
    } finally {
      setIsTranscribing(false);
      setRecordingSecs(0);
    }
  };

  const playMessageAudio = async (text: string, idx: number) => {
    if (soundRef.current) {
      await soundRef.current.stopAsync().catch(() => {});
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
      if (playingIdx === idx) { setPlayingIdx(null); return; }
    }
    setIsLoadingAudio(true);
    setPlayingIdx(idx);
    try {
      const { data } = await chatApi.speak(text);
      if (!data?.audio) return;
      const path = (FileSystem.cacheDirectory ?? "") + "nuvos_tts.mp3";
      await FileSystem.writeAsStringAsync(path, data.audio, { encoding: FileSystem.EncodingType.Base64 });
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
      const { sound } = await Audio.Sound.createAsync({ uri: path });
      soundRef.current = sound;
      setIsLoadingAudio(false);
      await sound.playAsync();
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setPlayingIdx(null);
          sound.unloadAsync().catch(() => {});
          soundRef.current = null;
        }
      });
    } catch {
      setPlayingIdx(null);
      setIsLoadingAudio(false);
    }
  };

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true,
      quality: 0.7,
      allowsMultipleSelection: true,
      selectionLimit: 8,
    });
    if (!result.canceled && result.assets.length > 0) {
      const toAdd = result.assets.filter((a) => a.base64).slice(0, 8 - pendingImages.length);
      const newImgs = toAdd.map((a) => ({ data: a.base64!, type: a.mimeType ?? "image/jpeg", uri: a.uri }));
      setPendingImages((prev) => [...prev, ...newImgs].slice(0, 8));
    }
  };

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    if ((!msg && pendingImages.length === 0) || streaming) return;

    // Client-side free limit check
    if (!isPremiumAccess && remaining <= 0) {
      const mins = resetMinutes(subStore.msgWindowStart);
      posthog.capture("ai_chat_limit_reached", { free_limit: FREE_MSG_LIMIT, reset_minutes: mins });
      openPaywall(t("chat.limitReached", { limit: FREE_MSG_LIMIT, mins }));
      return;
    }

    const imagesToSend = [...pendingImages];
    setInput("");
    setPendingImages([]);
    cancelRef.current.cancelled = false;

    const saveMsg = msg || (imagesToSend.length === 1 ? t("chat.imagesSentOne") : t("chat.imagesSentOther", { count: imagesToSend.length }));
    isAtBottom.current = true;
    const userMsg: Message = {
      role: "user",
      content: msg,
      images: imagesToSend.length > 0 ? imagesToSend.map((i) => ({ uri: i.uri })) : undefined,
      timestamp: Date.now(),
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    localFingerprintsRef.current.add(fp("user", saveMsg));
    syncCursorRef.current = new Date().toISOString();
    chatApi.saveMessage("user", saveMsg, currentId).catch(() => {});

    const profileCtx = buildProfileContext();
    const recentHistory = newMessages.slice(-18);
    const historyForApi = profileCtx
      ? [
          { role: "user", content: profileCtx },
          { role: "assistant", content: `Entendido. Tengo en cuenta el perfil de ${profile?.name?.split(" ")[0] || "usuario"} para personalizar mis respuestas.` },
          ...recentHistory,
        ]
      : newMessages.slice(-20);

    const withAssistant = [...newMessages, { role: "assistant" as const, content: "" }];
    setMessages(withAssistant);
    setStreaming(true);
    setLastTicker(null);

    incrementMsgCount();
    posthog.capture("ai_message_sent", {
      has_images: imagesToSend.length > 0,
      image_count: imagesToSend.length,
      is_voice: voiceInputRef.current,
      is_premium: isPremiumAccess,
      messages_remaining: remaining - 1,
    });

    const ctxToSend = notificationContext;
    setNotificationContext(null);
    setPendingActions(null);
    let full = "";
    try {
      await chatApi.stream(
        msg,
        historyForApi as Array<{ role: string; content: string }>,
        (chunk) => {
          full += chunk;
          setMessages([...withAssistant.slice(0, -1), { role: "assistant", content: full, timestamp: Date.now() }]);
        },
        () => {
          setStreaming(false);
          localFingerprintsRef.current.add(fp("assistant", full));
          syncCursorRef.current = new Date().toISOString();
          chatApi.saveMessage("assistant", full, currentId).catch(() => {});
          if (voiceInputRef.current) {
            voiceInputRef.current = false;
            playMessageAudio(full, withAssistant.length - 1);
          }
        },
        (a) => {
          const d: BehavioralDiagnosis = { score: a.s, profile: a.p, signals: a.sig, confidence: a.conf };
          updateMaturity(a.sig);
          setDiagnosis(d, maturityScore);
        },
        (tickers) => { if (tickers.length > 0) setLastTicker(tickers[0]); },
        profile?.mentor,
        cancelRef.current,
        null,
        null,
        imagesToSend.length > 0 ? imagesToSend.map((i) => ({ data: i.data, type: i.type })) : null,
        ctxToSend,
        (actions) => { setPendingActions(actions); setCommittedActions(new Set()); },
      );
    } catch (err: unknown) {
      const errObj = err as { response?: { status?: number; data?: { detail?: { message?: string } } }; message?: string };
      // 429 = message limit hit server-side
      if (errObj?.response?.status === 429) {
        const detail = errObj.response.data?.detail;
        const serverMsg = (typeof detail === "object" ? detail?.message : String(detail)) ?? t("chat.limitReachedFallback");
        setMessages([...withAssistant.slice(0, -1)]);
        upsellTrigger("msg_limit_hit");
        openPaywall(serverMsg);
      } else {
        const errMsg = errObj?.message ?? String(err);
        if (__DEV__) console.error("[chat] sendMessage error:", errMsg, err);
        setMessages([...withAssistant.slice(0, -1), { role: "assistant", content: t("chat.errorProcessing") }]);
      }
      setStreaming(false);
    }
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    const isUser = item.role === "user";
    const isLastAssistant = !isUser && index === messages.length - 1;
    const showChart = isLastAssistant && !streaming && !!lastTicker;
    const timeStr = item.timestamp
      ? new Date(item.timestamp).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })
      : "";

    if (isUser) {
      return (
        <View style={{ alignItems: "flex-end", marginBottom: 8 }}>
          <Text style={styles.senderNameUser}>{t("chat.you")}</Text>
        <View style={styles.userRow}>
          <View style={styles.userBubble}>
            {item.images && item.images.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: item.content ? 6 : 0 }}>
                {item.images.map((img, idx) => (
                  <Image key={idx} source={{ uri: img.uri }}
                    style={{ width: 120, height: 100, borderRadius: 10, resizeMode: "cover" }} />
                ))}
              </View>
            )}
            {!!item.content && <Text style={styles.userText}>{item.content}</Text>}
            {!!timeStr && (
              <View style={styles.timeRowUser}>
                <Text style={styles.timeUser}>{timeStr}</Text>
                <Ionicons name="checkmark-done-outline" size={12} color={colors.textDim} />
              </View>
            )}
          </View>
          <TouchableOpacity style={styles.editBtn} onPress={() => handleEditMessage(index, item.content)}>
            <Ionicons name="pencil" size={14} color={colors.textSub} />
          </TouchableOpacity>
        </View>
        </View>
      );
    }

    return (
      <View style={styles.aiRow}>
        <Text style={[styles.senderName, { color: mentor?.color ?? colors.accentLight }]}>{mentor?.name ?? t("chat.nuvosAi")}</Text>
        <View style={styles.aiBubble}>
          <Markdown style={markdownStyles} rules={markdownRules}>{item.content || ""}</Markdown>
          {streaming && isLastAssistant && item.content === "" && (
            <TypingIndicator color={colors.accentLight} />
          )}
          {!!timeStr && item.content !== "" && (
            <Text style={styles.timeAI}>{timeStr}</Text>
          )}
          {item.content !== "" && !(streaming && isLastAssistant) && (
            <View style={styles.aiFooter}>
              <Text style={[styles.aiDisclaimer, { flex: 1 }]}>
                {t("chat.disclaimer")}
              </Text>
              <TouchableOpacity
                onPress={() => playMessageAudio(item.content, index)}
                disabled={isLoadingAudio && playingIdx !== index}
                style={styles.speakerBtn}
              >
                <Ionicons
                  name={
                    playingIdx === index
                      ? isLoadingAudio ? "hourglass-outline" : "stop-circle-outline"
                      : "volume-medium-outline"
                  }
                  size={15}
                  color={playingIdx === index ? colors.accentLight : colors.textMuted}
                />
              </TouchableOpacity>
            </View>
          )}
        </View>
        {showChart && <StockChart ticker={lastTicker!} />}
        {isLastAssistant && pendingActions && !streaming && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6, marginLeft: 4 }}>
            {pendingActions.map((action, ai) => (
              <View key={ai} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <TouchableOpacity
                  onPress={() => {
                    if (action.type === "decision") {
                      const d = action.data as Record<string, string>;
                      setDecisionModal({ action: d.action ?? "hold", ticker: d.ticker ?? "", notes: d.notes ?? "" });
                    } else if (action.type === "chat") {
                      const d = action.data as Record<string, string>;
                      sendMessage(d.message);
                    }
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: 20,
                    borderWidth: 1,
                    borderColor: action.type === "decision" ? "rgba(0,185,109,0.4)" : colors.border,
                    backgroundColor: action.type === "decision" ? "rgba(0,185,109,0.10)" : colors.bgRaised,
                  }}
                >
                  <Text style={{ fontSize: 12 }}>
                    {action.type === "decision" ? "📝" : action.type === "watchlist" ? "👁" : action.type === "alert" ? "🔔" : "→"}
                  </Text>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: action.type === "decision" ? colors.accentLight : colors.textSub }}>
                    {action.label}
                  </Text>
                </TouchableOpacity>
                {action.type !== "chat" && (
                  <TouchableOpacity
                    onPress={async () => {
                      if (committedActions.has(ai)) return;
                      try {
                        const { default: api } = await import("../../src/lib/api");
                        await api.post("/api/actions/commit", { type: action.type, label: action.label, data: action.data });
                        setCommittedActions(prev => new Set([...prev, ai]));
                      } catch { /* silent */ }
                    }}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 13,
                      borderWidth: 1,
                      alignItems: "center",
                      justifyContent: "center",
                      borderColor: committedActions.has(ai) ? "rgba(0,185,109,0.4)" : colors.border,
                      backgroundColor: committedActions.has(ai) ? "rgba(0,185,109,0.10)" : colors.bgRaised,
                    }}
                  >
                    <Text style={{ fontSize: 11 }}>{committedActions.has(ai) ? "✓" : "🔔"}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const webContentStyle = Platform.OS === "web"
    ? { maxWidth: 860, width: "100%" as const, alignSelf: "center" as const, flex: 1 }
    : { flex: 1 };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
      keyboardVerticalOffset={headerHeight}
    >
    <SafeAreaView style={styles.flex} edges={["left", "right"]}>
      {/* ── Header ── */}
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
        {/* Left: logo */}
        <Image source={require("../../assets/images/logo_new.png")} style={styles.topBarLogoImg} />

        {/* Center: mentor identity pill */}
        <View style={[styles.mentorPill, {
          backgroundColor: mentor ? mentor.color + "12" : colors.card,
          borderColor: mentor ? mentor.color + "30" : colors.border,
        }]}>
          <Text style={{ fontSize: 20, lineHeight: 24 }}>{mentor ? mentor.emoji : "🤖"}</Text>
          <View style={{ gap: 1, flexShrink: 1 }}>
            <Text numberOfLines={1} style={[styles.mentorPillName, { color: colors.text }]}>
              {mentor ? mentor.name : profile?.name ? t("chat.helloName", { name: profile.name.split(" ")[0] }) : t("chat.mentorAiFallback")}
            </Text>
            {mentor && (
              <Text style={[styles.mentorPillBadge, { color: mentor.color }]}>{mentor.badge}</Text>
            )}
          </View>
        </View>

        {/* Right: actions */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <TouchableOpacity
            onPress={() => setTutorialVisible(true)}
            style={[styles.iconBtn, { borderColor: colors.border }]}
          >
            <Ionicons name="help-circle-outline" size={17} color={colors.textSub} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.newChatBtn, { borderColor: colors.border }]}
            onPress={handleNewChat}
            disabled={streaming}
          >
            <Ionicons name="add-outline" size={15} color={colors.textSub} />
            <Text style={[styles.newChatBtnText, { color: colors.textSub }]}>{t("chat.newChat")}</Text>
          </TouchableOpacity>
        </View>
      </View>

        <View style={webContentStyle}>
          {messages.length === 0 ? (
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.empty}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* ── Hero card ── */}
              <View style={[styles.heroCard, {
                backgroundColor: colors.card,
                borderColor: mentor ? mentor.color + "30" : colors.border,
              }]}>
                {/* Color strip */}
                <View style={[styles.heroStrip, {
                  backgroundColor: mentor ? mentor.color : colors.accentLight,
                }]} />

                <View style={styles.heroContent}>
                  {/* Avatar */}
                  {mentor && mentorPhoto ? (
                    <Image source={mentorPhoto} style={styles.heroAvatar} />
                  ) : (
                    <View style={[styles.heroAvatarBox, {
                      backgroundColor: mentor ? mentor.color + "18" : colors.accentGlow,
                      borderColor: mentor ? mentor.color + "35" : "rgba(0,185,109,0.25)",
                    }]}>
                      {mentor
                        ? <Text style={{ fontSize: 40 }}>{mentor.emoji}</Text>
                        : <Ionicons name="trending-up" size={38} color={colors.accentLight} />}
                    </View>
                  )}

                  <Text style={[styles.heroTitle, { color: colors.text }]}>
                    {mentor ? mentor.name : profile?.name ? t("chat.helloName", { name: profile.name.split(" ")[0] }) : t("chat.nuvosAi")}
                  </Text>
                  <Text style={[styles.heroSub, { color: mentor ? mentor.color : colors.accentLight }]}>
                    {mentor ? mentor.title : t("chat.mentorSub")}
                  </Text>

                  {mentor && (
                    <View style={styles.principlesRow}>
                      {mentor.principles.map((p, i) => (
                        <View key={i} style={[styles.principlePill, {
                          borderColor: mentor.color + "50",
                          backgroundColor: mentor.color + "12",
                        }]}>
                          <Text style={[styles.principlePillText, { color: mentor.color }]}>{p}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {/* Context chips strip */}
                {profile && (
                  <View style={[styles.contextStrip, {
                    borderTopColor: colors.border,
                    backgroundColor: colors.bgRaised ?? colors.bg,
                  }]}>
                    {profile.risk_tolerance && riskCfg && (
                      <View style={[styles.contextChip, { borderColor: colors.border }]}>
                        <Text style={[styles.contextChipText, { color: colors.textMuted }]}>🎯 {riskCfg.label}</Text>
                      </View>
                    )}
                    {(() => {
                      const lvl = getUserLevel(profile);
                      const lvlColor = LEVEL_COLOR[lvl];
                      const lvlLabel = LEVEL_LABEL[lvl];
                      return (
                        <View style={[styles.contextChip, { borderColor: lvlColor + "40", backgroundColor: lvlColor + "10" }]}>
                          <Text style={[styles.contextChipText, { color: lvlColor }]}>📊 {lvlLabel}</Text>
                        </View>
                      );
                    })()}
                    {positions.length > 0 && (
                      <View style={[styles.contextChip, { borderColor: colors.border }]}>
                        <Text style={[styles.contextChipText, { color: colors.textMuted }]}>{t("chat.positionsCount", { count: positions.length })}</Text>
                      </View>
                    )}
                    {!isPremiumAccess && (
                      <View style={[styles.contextChip, { borderColor: "rgba(239,68,68,0.25)", backgroundColor: "rgba(239,68,68,0.07)" }]}>
                        <Text style={[styles.contextChipText, { color: "#ef4444" }]}>{t("chat.msgRemaining", { count: remaining })}</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>

              {/* ── Suggestions ── */}
              {(() => {
                const obj = profile?.investment_goal as string | undefined;
                const level = getUserLevel(profile);
                const objectiveGreeting = getObjectiveGreeting(t);
                const suggestionsByObjective = getSuggestionsByObjective(t);
                const suggestionsByLevel = getSuggestionsByLevel(t);
                const suggestionsDefault = getSuggestionsDefault(t);
                const greeting = obj ? objectiveGreeting[obj] : null;
                const suggestions = obj && suggestionsByObjective[obj]
                  ? suggestionsByObjective[obj]
                  : (suggestionsByLevel[level] ?? suggestionsDefault);
                return (
                  <>
                    {greeting && !mentor && (
                      <Text style={[styles.greetingText, { color: colors.textMuted }]}>{greeting}</Text>
                    )}
                    <Text style={[styles.suggestLabel, { color: colors.textMuted }]}>{t("chat.suggestedQuestions")}</Text>
                    <View style={styles.suggestGrid}>
                      {suggestions.map((s, i) => (
                        <TouchableOpacity
                          key={i}
                          style={[styles.suggestCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                          onPress={() => sendMessage(s)}
                        >
                          <Text style={[styles.suggestCardText, { color: colors.textSub }]}>{s}</Text>
                          <Ionicons name="chevron-forward" size={13} color={colors.accentLight} style={{ alignSelf: "flex-end", marginTop: 4, opacity: 0.7 }} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                );
              })()}
            </ScrollView>
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(_, i) => i.toString()}
              renderItem={renderMessage}
              contentContainerStyle={styles.list}
              onContentSizeChange={() => {
                if (isAtBottom.current) listRef.current?.scrollToEnd({ animated: false });
              }}
              onScroll={({ nativeEvent: e }) => {
                const atBottom = e.contentOffset.y + e.layoutMeasurement.height >= e.contentSize.height - 80;
                isAtBottom.current = atBottom;
                setShowScrollBtn(!atBottom);
              }}
              scrollEventThrottle={100}
              keyboardShouldPersistTaps="handled"
              removeClippedSubviews
              initialNumToRender={12}
              maxToRenderPerBatch={6}
              windowSize={8}
              style={styles.flex}
            />
          )}

          {showScrollBtn && (
            <TouchableOpacity
              onPress={() => listRef.current?.scrollToEnd({ animated: true })}
              style={{
                position: "absolute", bottom: 80, alignSelf: "center", zIndex: 20,
                width: 36, height: 36, borderRadius: 18,
                backgroundColor: colors.card,
                borderWidth: 1, borderColor: colors.border,
                alignItems: "center", justifyContent: "center",
                shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
                elevation: 4,
              }}
            >
              <Ionicons name="chevron-down" size={20} color={colors.text} />
            </TouchableOpacity>
          )}

          {!isPremiumAccess && (
            <TouchableOpacity
              style={[
                styles.premiumBadge,
                remaining <= 0 && { backgroundColor: "rgba(239,68,68,0.10)", borderColor: "rgba(239,68,68,0.30)" },
              ]}
              onPress={() => openPaywall(t("chat.unlimitedPremium"))}
            >
              {remaining <= 0 ? (
                <>
                  <Ionicons name="time-outline" size={13} color="#ef4444" />
                  <Text style={[styles.premiumBadgeText, { color: "#ef4444" }]}>
                    {(() => {
                      const mins = resetMinutes(subStore.msgWindowStart);
                      const hrs = Math.floor(mins / 60);
                      const min = mins % 60;
                      const timeStr = hrs > 0 ? `${hrs}h ${min > 0 ? `${min}min` : ""}`.trim() : `${mins}min`;
                      return t("chat.unlimitedOrWait", { time: timeStr });
                    })()}
                  </Text>
                </>
              ) : (
                <>
                  <Ionicons name="star" size={11} color="#f59e0b" />
                  <Text style={styles.premiumBadgeText}>
                    {remaining <= 5
                      ? t("chat.msgsLeftToday", { count: remaining, plural: remaining === 1 ? "" : "s" })
                      : t("chat.unlimitedPremium")}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {pendingImages.length > 0 && (
            <View style={{ paddingHorizontal: 12, paddingBottom: 6, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {pendingImages.map((img, idx) => (
                <View key={idx} style={{ position: "relative", width: 60, height: 60 }}>
                  <Image source={{ uri: img.uri }} style={{ width: 60, height: 60, borderRadius: 10 }} />
                  <TouchableOpacity
                    onPress={() => setPendingImages((prev) => prev.filter((_, i) => i !== idx))}
                    style={{ position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: 9, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center" }}
                  >
                    <Ionicons name="close" size={11} color="white" />
                  </TouchableOpacity>
                </View>
              ))}
              {pendingImages.length < 8 && (
                <TouchableOpacity
                  onPress={handlePickImage}
                  style={{ width: 60, height: 60, borderRadius: 10, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.border, alignItems: "center", justifyContent: "center" }}
                >
                  <Ionicons name="add" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          )}
          {/* ── Input card ── */}
          <View style={[styles.inputCard, { borderTopColor: colors.border, backgroundColor: colors.card }, isTour && { borderWidth: 2, borderColor: "#00d47e", borderRadius: 16, margin: 8 }]}>
            <View style={[styles.inputInner, { backgroundColor: colors.bgRaised ?? colors.bg, borderColor: colors.border }]}>
              <TextInput
                ref={inputRef}
                style={[styles.input, { color: colors.text }]}
                value={input}
                onChangeText={setInput}
                placeholder={pendingImages.length > 0 ? t("chat.inputPlaceholderWithImages") : t("chat.inputPlaceholderDefault")}
                placeholderTextColor={colors.placeholder}
                multiline
                editable={!streaming}
              />
              <TouchableOpacity
                style={[styles.sendButton, !streaming && !input.trim() && pendingImages.length === 0 && styles.sendDisabled]}
                onPress={streaming ? handleStop : () => sendMessage()}
                disabled={!streaming && !input.trim() && pendingImages.length === 0}
              >
                {streaming ? (
                  <Ionicons name="stop" size={18} color="white" />
                ) : (
                  <Ionicons name="send" size={18} color="white" />
                )}
              </TouchableOpacity>
            </View>
            <View style={styles.inputToolbar}>
              <TouchableOpacity
                onPress={handlePickImage}
                disabled={streaming || pendingImages.length >= 8}
                style={[styles.toolbarBtn, { opacity: (streaming || pendingImages.length >= 8) ? 0.4 : 1 }]}
              >
                <Ionicons name="image-outline" size={18} color={colors.textSub} />
                <Text style={[styles.toolbarBtnText, { color: colors.textMuted }]}>{t("chat.toolbarImage")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={isRecording ? stopRecording : startRecording}
                disabled={streaming || isTranscribing}
                style={[styles.toolbarBtn, { opacity: streaming ? 0.4 : 1 }]}
              >
                {isTranscribing ? (
                  <Ionicons name="hourglass-outline" size={18} color={colors.accentLight} />
                ) : (
                  <Ionicons
                    name={isRecording ? "stop-circle" : "mic-outline"}
                    size={18}
                    color={isRecording ? "#ef4444" : colors.textSub}
                  />
                )}
                <Text style={[styles.toolbarBtnText, { color: isRecording ? "#ef4444" : colors.textMuted }]}>
                  {isTranscribing ? t("chat.toolbarProcessing") : isRecording ? t("chat.toolbarStop") : t("chat.toolbarVoice")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  if (!isPremiumAccess) {
                    openPaywall(t("chat.voiceCallPremiumOnly"));
                    return;
                  }
                  setShowCallModal(true);
                }}
                disabled={streaming}
                style={[styles.toolbarBtn, { opacity: streaming ? 0.4 : 1 }]}
              >
                <Ionicons name="call-outline" size={18} color={colors.textSub} />
                <Text style={[styles.toolbarBtnText, { color: colors.textMuted }]}>{t("chat.toolbarCall")}</Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }} />
              <Text style={[styles.toolbarBtnText, { color: colors.textDim }]}>{t("chat.toolbarSend")}</Text>
            </View>
          </View>
        </View>
    </SafeAreaView>

    <PaywallModal
      visible={paywallVisible}
      onClose={() => setPaywallVisible(false)}
      reason={paywallReason}
    />
    {activeOffer && (
      <UpsellModal
        visible={!!activeOffer}
        offer={activeOffer}
        userTier={upsellTier}
        prices={upsellPrices}
        triggerSource={upsellSource ?? undefined}
        onClose={upsellDismiss}
      />
    )}
    <FirstActionModal />
    <VoiceCallModal visible={showCallModal} onClose={() => setShowCallModal(false)} />
    <TutorialModal
      visible={tutorialVisible}
      onClose={() => { setTutorialVisible(false); markTutorialSeen(); }}
    />
    {isTour && (
      <MobileTourBanner
        step={3}
        title={t("chat.tour.title")}
        description={t("chat.tour.description")}
      />
    )}

    {/* ── Voice Recording Modal ── */}
    <Modal
      visible={showRecordingModal}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={cancelRecording}
    >
      <View style={{
        flex: 1, backgroundColor: "rgba(0,0,0,0.96)",
        alignItems: "center", justifyContent: "center",
      }}>
        <View style={{ alignItems: "center", paddingHorizontal: 40, width: "100%" }}>

          {/* Waveform bars */}
          <View style={{ flexDirection: "row", alignItems: "center", height: 80, gap: 3, marginBottom: 36 }}>
            {waveAnimValues.map((val, i) => (
              <Animated.View
                key={i}
                style={{
                  width: 5,
                  borderRadius: 3,
                  backgroundColor: "rgba(0,212,126,0.85)",
                  height: val.interpolate({ inputRange: [0, 1], outputRange: [4, 72] }),
                }}
              />
            ))}
          </View>

          {/* Timer */}
          <Text style={{
            fontSize: 54, fontWeight: "800", color: "white",
            letterSpacing: 2, marginBottom: 6,
            fontVariant: ["tabular-nums"],
          }}>
            {String(Math.floor(recordingSecs / 60)).padStart(2, "0")}:{String(recordingSecs % 60).padStart(2, "0")}
          </Text>
          <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginBottom: 48 }}>
            {t("chat.recordingAudio")}
          </Text>

          {/* Stop button */}
          <TouchableOpacity
            onPress={stopRecording}
            activeOpacity={0.85}
            style={{
              width: 80, height: 80, borderRadius: 40,
              backgroundColor: "#ef4444",
              alignItems: "center", justifyContent: "center",
              marginBottom: 32,
              shadowColor: "#ef4444", shadowOpacity: 0.5,
              shadowRadius: 24, shadowOffset: { width: 0, height: 0 },
              elevation: 10,
            }}
          >
            <View style={{ width: 26, height: 26, borderRadius: 5, backgroundColor: "white" }} />
          </TouchableOpacity>

          {/* Cancel */}
          <TouchableOpacity onPress={cancelRecording} activeOpacity={0.6}>
            <Text style={{ fontSize: 14, fontWeight: "500", color: "rgba(255,255,255,0.38)" }}>
              {t("chat.cancel")}
            </Text>
          </TouchableOpacity>

        </View>
      </View>
    </Modal>

    {/* Decision journal modal */}
    <Modal
      visible={!!decisionModal}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={() => setDecisionModal(null)}
    >
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setDecisionModal(null)} />
        {decisionModal && (
          <View style={{
            backgroundColor: colors.card,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 20,
            gap: 12,
            borderTopWidth: 1,
            borderColor: colors.border,
          }}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.text }}>{t("chat.logDecisionTitle")}</Text>
            <Text style={{ fontSize: 12, color: colors.textSub }}>
              {t("chat.logDecisionDesc")}
            </Text>
            <Text style={{ fontSize: 11, fontWeight: "600", color: colors.textMuted }}>{t("chat.decisionLabel")}</Text>
            <TextInput
              style={{
                backgroundColor: colors.bgRaised,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 8,
                fontSize: 14,
                color: colors.text,
              }}
              value={decisionModal.action}
              onChangeText={(v) => setDecisionModal({ ...decisionModal, action: v })}
              placeholder={t("chat.decisionPlaceholder")}
              placeholderTextColor={colors.textMuted}
            />
            <Text style={{ fontSize: 11, fontWeight: "600", color: colors.textMuted }}>{t("chat.tickerLabel")}</Text>
            <TextInput
              style={{
                backgroundColor: colors.bgRaised,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 8,
                fontSize: 14,
                color: colors.text,
              }}
              value={decisionModal.ticker}
              onChangeText={(v) => setDecisionModal({ ...decisionModal, ticker: v })}
              placeholder={t("chat.tickerPlaceholder")}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
            />
            <Text style={{ fontSize: 11, fontWeight: "600", color: colors.textMuted }}>{t("chat.notesLabel")}</Text>
            <TextInput
              style={{
                backgroundColor: colors.bgRaised,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 8,
                fontSize: 14,
                color: colors.text,
                minHeight: 70,
                textAlignVertical: "top",
              }}
              value={decisionModal.notes}
              onChangeText={(v) => setDecisionModal({ ...decisionModal, notes: v })}
              placeholder={t("chat.notesPlaceholder")}
              placeholderTextColor={colors.textMuted}
              multiline
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
              <TouchableOpacity
                onPress={() => setDecisionModal(null)}
                style={{
                  flex: 1, paddingVertical: 12, borderRadius: 12,
                  backgroundColor: colors.bgRaised, alignItems: "center",
                  borderWidth: 1, borderColor: colors.border,
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.textSub }}>{t("chat.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  try {
                    await decisionsApi.log({ action: decisionModal.action, ticker: decisionModal.ticker, notes: decisionModal.notes, date: new Date().toISOString() });
                  } catch {}
                  setDecisionSaved(true);
                  setTimeout(() => { setDecisionSaved(false); setDecisionModal(null); }, 1500);
                }}
                style={{
                  flex: 1, paddingVertical: 12, borderRadius: 12,
                  backgroundColor: colors.accent, alignItems: "center",
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: "600", color: "#fff" }}>
                  {decisionSaved ? t("chat.saved") : t("chat.save")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Modal>

    </KeyboardAvoidingView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    flex: { flex: 1 },

    // Profile banner (risk bar at top)
    profileBanner: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
    profileType: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 8 },
    barTrack: { height: 5, borderRadius: 3, overflow: "hidden", flexDirection: "row", marginBottom: 4 },
    barFill: { height: "100%", borderRadius: 3 },
    barLabels: { flexDirection: "row", justifyContent: "space-between" },
    barLabelText: { fontSize: 10, letterSpacing: 0.2 },

    // Top bar
    topBar: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 16, paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    topBarTitle: { fontWeight: "700", fontSize: 15, letterSpacing: -0.2 },
    topBarLogo: { flexDirection: "row", alignItems: "center", gap: 8 },
    topBarLogoImg: { width: 28, height: 28, borderRadius: 7 },
    newChatBtn: {
      flexDirection: "row", alignItems: "center", gap: 5,
      borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
    },
    newChatBtnText: { fontSize: 12, fontWeight: "600", letterSpacing: 0.1 },

    // Empty / welcome state
    empty: { flexGrow: 1, alignItems: "center", justifyContent: "flex-start", padding: 20, paddingTop: 24 },
    emptyTitle: { fontSize: 22, fontWeight: "800", color: c.text, marginBottom: 6, letterSpacing: -0.5 },
    emptySubtitle: { fontSize: 14, color: c.textMuted, textAlign: "center", marginBottom: 32, lineHeight: 21 },
    emptyIconBox: {
      width: 80, height: 80, borderRadius: 24,
      alignItems: "center", justifyContent: "center",
      marginBottom: 16, borderWidth: 2,
    },
    quickChip: {
      borderRadius: 20, borderWidth: 1,
      paddingHorizontal: 14, paddingVertical: 7,
    },
    quickChipText: { fontSize: 13, fontWeight: "500" },
    suggestions: { width: "100%", gap: 8 },
    suggestion: {
      backgroundColor: c.card,
      borderWidth: 1, borderColor: c.border,
      borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14,
      flexDirection: "column", gap: 4,
    },
    suggestionBullet: { fontSize: 10, fontWeight: "700" as const },
    suggestionText: { color: c.textSub, fontSize: 13, lineHeight: 19 },

    // Message list
    list: { paddingHorizontal: 12, paddingVertical: 12, paddingBottom: 8 },

    // User message row
    userRow: {
      flexDirection: "row" as const,
      justifyContent: "flex-end" as const,
      alignItems: "flex-end" as const,
      gap: 4,
    },

    // AI message row
    aiRow: {
      marginBottom: 10,
      paddingHorizontal: 4,
    },

    // Sender name
    senderName: {
      fontSize: 11, fontWeight: "600" as const, color: c.accentLight,
      marginBottom: 3, marginLeft: 2, letterSpacing: 0.1,
      fontFamily: "Inter_400Regular",
    },
    mentorAvatar: { width: 96, height: 96, borderRadius: 24, marginBottom: 14 },
    mentorAvatarEmoji: {
      width: 96, height: 96, borderRadius: 24,
      alignItems: "center", justifyContent: "center", marginBottom: 14,
    },
    mentorPrinciples: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10, justifyContent: "center" },
    principlePill: {
      borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5,
    },
    principlePillText: { fontSize: 11, fontWeight: "600", letterSpacing: 0.2 },

    // Sender label above the user bubble (mirrors web's "You" label)
    senderNameUser: {
      fontSize: 10, fontWeight: "600" as const, color: c.textDim,
      marginBottom: 3, marginRight: 4, letterSpacing: 0.1,
      fontFamily: "Inter_400Regular",
    },
    // User bubble — translucent glass, matches web's .bubble-user exactly
    userBubble: {
      maxWidth: "72%" as const,
      backgroundColor: "rgba(255,255,255,0.07)",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.10)",
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 12,
      shadowColor: "#000",
      shadowOpacity: 0.14,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    // AI message — plain text, no card, ChatGPT-style
    aiBubble: {},
    timeRowUser: {
      flexDirection: "row" as const, justifyContent: "flex-end" as const,
      alignItems: "center" as const, gap: 3, marginTop: 5,
    },
    timeUser: { fontSize: 10, color: c.textDim, fontFamily: "Inter_400Regular" },
    timeAI: { fontSize: 10, color: c.textDim, fontFamily: "Inter_400Regular", textAlign: "right" as const, marginTop: 6 },
    userText: { color: c.text, fontSize: 14.5, lineHeight: 23, flexWrap: "wrap" as const, fontFamily: "Inter_400Regular" },

    input: {
      flex: 1,
      backgroundColor: "transparent",
      paddingHorizontal: 12, paddingVertical: 10,
      fontSize: 15, maxHeight: 110, lineHeight: 20,
    },
    sendButton: {
      width: 44, height: 44,
      backgroundColor: c.accentLight,
      borderRadius: 14,
      alignItems: "center", justifyContent: "center",
      shadowColor: c.accentLight,
      shadowOpacity: 0.3,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 0 },
    },
    sendDisabled: { opacity: 0.35 },
    premiumBadge: {
      flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const,
      gap: 5, marginHorizontal: 12, marginBottom: 6,
      paddingVertical: 8, paddingHorizontal: 12,
      borderRadius: 10, borderWidth: 1,
      backgroundColor: "rgba(245,158,11,0.08)", borderColor: "rgba(245,158,11,0.25)",
    },
    premiumBadgeText: { fontSize: 11, fontWeight: "500" as const, color: "#f59e0b" },
    msgCounter: {
      flexDirection: "row" as const, alignItems: "center" as const, gap: 6,
      marginHorizontal: 12, marginBottom: 4,
      borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    },
    msgCounterText: { fontSize: 11, fontWeight: "500" as const, flex: 1 },
    editBtn: { alignSelf: "flex-end", marginTop: 3, padding: 4 },
    aiDisclaimer: { fontSize: 10, lineHeight: 14, color: c.textDim, fontFamily: "Inter_400Regular" },
    aiFooter: {
      flexDirection: "row" as const, alignItems: "center" as const, gap: 6,
      marginTop: 10, paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
    },
    speakerBtn: { padding: 3 },

    // Diagnostic
    diagSeparator: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 8, marginBottom: 8 },
    signalsRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 5 },
    signalChip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
    signalText: { fontSize: 9 },

    // ── Header pill ──────────────────────────────────────────────────────────────
    mentorPill: {
      flexDirection: "row" as const, alignItems: "center", gap: 8,
      paddingHorizontal: 10, paddingVertical: 6,
      borderRadius: 20, borderWidth: 1,
      maxWidth: 180, flexShrink: 1,
    },
    mentorPillName: { fontSize: 12, fontWeight: "700" as const, letterSpacing: -0.1 },
    mentorPillBadge: { fontSize: 9, fontWeight: "600" as const, letterSpacing: 0.2 },
    iconBtn: {
      width: 32, height: 32, borderRadius: 10,
      alignItems: "center" as const, justifyContent: "center" as const,
      borderWidth: 1,
    },

    // ── Hero card ────────────────────────────────────────────────────────────────
    heroCard: {
      width: "100%" as const, borderRadius: 20, borderWidth: 1,
      overflow: "hidden" as const, marginBottom: 20,
    },
    heroStrip: { height: 5 },
    heroContent: { padding: 20, alignItems: "center" as const },
    heroAvatar: { width: 80, height: 80, borderRadius: 20, marginBottom: 12 },
    heroAvatarBox: {
      width: 80, height: 80, borderRadius: 20,
      alignItems: "center" as const, justifyContent: "center" as const,
      marginBottom: 12, borderWidth: 2,
    },
    heroTitle: {
      fontSize: 20, fontWeight: "800" as const, letterSpacing: -0.4,
      marginBottom: 4, textAlign: "center" as const,
    },
    heroSub: {
      fontSize: 12, fontWeight: "600" as const, letterSpacing: 0.2,
      marginBottom: 12, textAlign: "center" as const,
    },
    principlesRow: {
      flexDirection: "row" as const, flexWrap: "wrap" as const,
      gap: 6, justifyContent: "center" as const,
    },

    // ── Context chips ────────────────────────────────────────────────────────────
    contextStrip: {
      flexDirection: "row" as const, flexWrap: "wrap" as const,
      gap: 6, padding: 12, borderTopWidth: StyleSheet.hairlineWidth,
    },
    contextChip: {
      borderRadius: 20, borderWidth: 1,
      paddingHorizontal: 10, paddingVertical: 5,
    },
    contextChipText: { fontSize: 11, fontWeight: "500" as const },

    // ── Suggestions ──────────────────────────────────────────────────────────────
    greetingText: {
      fontSize: 13, textAlign: "center" as const, lineHeight: 20,
      marginBottom: 16, paddingHorizontal: 8,
    },
    suggestLabel: {
      fontSize: 10, fontWeight: "700" as const, letterSpacing: 0.8,
      textTransform: "uppercase" as const,
      marginBottom: 10, alignSelf: "flex-start" as const,
    },
    suggestGrid: {
      width: "100%" as const,
      flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8,
    },
    suggestCard: {
      borderWidth: 1, borderRadius: 16, padding: 14,
      flexGrow: 1, flexBasis: "45%" as const, minWidth: 150,
    },
    suggestCardText: { fontSize: 12, lineHeight: 18, flex: 1 },

    // ── Input card ───────────────────────────────────────────────────────────────
    inputCard: {
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12, paddingTop: 10, paddingBottom: 14,
    },
    inputInner: {
      flexDirection: "row" as const, alignItems: "flex-end",
      borderWidth: 1, borderRadius: 16, overflow: "hidden" as const,
      paddingHorizontal: 4, paddingVertical: 4,
    },
    inputToolbar: {
      flexDirection: "row" as const, alignItems: "center",
      paddingHorizontal: 4, paddingTop: 8, gap: 4,
    },
    toolbarBtn: {
      flexDirection: "row" as const, alignItems: "center",
      gap: 4, paddingHorizontal: 10, paddingVertical: 5,
      borderRadius: 20,
    },
    toolbarBtnText: { fontSize: 11, fontWeight: "500" as const },
  });
}

function makeMarkdownStyles(c: Colors) {
  return {
    body: {
      color: c.textSub, fontSize: 14, lineHeight: 24, flexShrink: 1,
      fontFamily: "Inter_400Regular",
      ...(Platform.OS === "web" ? { wordBreak: "break-word", overflowWrap: "break-word" } : {}),
    },
    paragraph: {
      flexShrink: 1, flexWrap: "wrap" as const, marginVertical: 4,
      fontFamily: "Inter_400Regular",
      ...(Platform.OS === "web" ? { wordBreak: "break-word", overflowWrap: "break-word" } : {}),
    },
    text: { flexShrink: 1, flexWrap: "wrap" as const, fontFamily: "Inter_400Regular" },
    heading1: {
      color: c.text, fontSize: 17, fontWeight: "700" as const, letterSpacing: -0.4,
      fontFamily: "Inter_700Bold",
      marginBottom: 8, marginTop: 14, paddingBottom: 6,
      borderBottomWidth: 1.5, borderBottomColor: c.accentLight,
    },
    heading2: {
      color: c.text, fontSize: 15, fontWeight: "700" as const, letterSpacing: -0.2,
      fontFamily: "Inter_700Bold",
      marginBottom: 6, marginTop: 12,
    },
    heading3: {
      color: c.accentLight, fontSize: 12, fontWeight: "600" as const,
      fontFamily: "Inter_600SemiBold",
      marginBottom: 4, marginTop: 8, letterSpacing: 0.5, textTransform: "uppercase" as const,
    },
    strong: { color: c.text, fontWeight: "700" as const, fontFamily: "Inter_700Bold" },
    em: { color: c.accentLight, fontStyle: "italic" as const, fontFamily: "Inter_400Regular" },
    bullet_list: { marginVertical: 6, flexShrink: 1 },
    ordered_list: { marginVertical: 6, flexShrink: 1 },
    list_item: { color: c.textSub, fontSize: 14, lineHeight: 24, flexShrink: 1, marginVertical: 2, fontFamily: "Inter_400Regular" },
    code_inline: {
      backgroundColor: c.accentLight + "1a", color: c.accentLight,
      borderRadius: 5, paddingHorizontal: 6, fontSize: 12.5, fontWeight: "500" as const,
      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    },
    fence: {
      backgroundColor: c.bgRaised ?? c.card,
      borderRadius: 12, padding: 14,
      marginVertical: 8, borderWidth: 1, borderColor: c.border,
    },
    code_block: {
      color: c.text, fontSize: 13, lineHeight: 22,
      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    },
    table: { marginVertical: 0 },
    thead: { backgroundColor: c.accent + "28" },
    th: {
      color: c.accentLight, fontWeight: "700" as const,
      paddingHorizontal: 14, paddingVertical: 11,
      fontSize: 12, letterSpacing: 0.4,
      minWidth: 120,
      borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.border,
    },
    td: {
      color: c.textSub,
      paddingHorizontal: 14, paddingVertical: 10,
      fontSize: 13, lineHeight: 20,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
      minWidth: 120,
      borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.border,
    },
    tr: {},
    blockquote: {
      borderLeftWidth: 3, borderLeftColor: c.accentLight,
      backgroundColor: c.accentLight + "0d",
      paddingLeft: 12, paddingVertical: 8,
      marginVertical: 6, borderRadius: 4,
    },
    hr: { borderColor: c.border, marginVertical: 12, height: StyleSheet.hairlineWidth },
    link: { color: c.accentLight, textDecorationLine: "underline" as const },
  };
}
