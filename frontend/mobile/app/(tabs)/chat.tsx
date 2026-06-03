import React, { useState, useRef, useEffect, useMemo } from "react";
import * as ImagePicker from "expo-image-picker";
import {
  View, Text, TextInput, TouchableOpacity, FlatList, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, Image, Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Markdown from "react-native-markdown-display";
import { chatApi, marketApi } from "../../src/lib/api";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { useAppStore, RISK_CONFIG, getAge } from "../../src/lib/profileStore";
import { useChatStore, Message, BehavioralDiagnosis } from "../../src/lib/chatStore";
import { usePortfolioStore } from "../../src/lib/portfolioStore";
import { useSubscriptionStore, msgsRemaining, resetMinutes, FREE_MSG_LIMIT, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import PaywallModal from "../../src/components/PaywallModal";
import StockChart from "../../src/components/StockChart";
import FirstActionModal from "../../src/components/FirstActionModal";
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

const SUGGESTIONS = [
  "¿Cómo analizo si una empresa es buena inversión?",
  "Explícame qué es un ETF",
  "¿Qué hace NVIDIA para ganar dinero?",
  "¿Cómo construyo un portafolio diversificado?",
];

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = insets.top + 104; // MobileHeader row (52) + MarketTicker (52)
  const { colors } = useTheme();
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

  const { currentId, currentMessages, setMessages, createSession, currentDiagnosis, setDiagnosis, restoreFromServer, sessions } = useChatStore();
  const messages = currentMessages();
  const diagnosis = currentDiagnosis();
  const positions = usePortfolioStore((s) => s.positions);

  const subStore = useSubscriptionStore();
  const subTier = subStore.tier;
  const fetchSubStatus = subStore.fetchStatus;
  const incrementMsgCount = subStore.incrementMsgCount;
  const remaining = msgsRemaining({ tier: subTier, msgCount: subStore.msgCount, msgWindowStart: subStore.msgWindowStart });
  const isPremiumAccess = hasPremiumAccess(subStore);

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ data: string; type: string; uri: string } | null>(null);
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const [lastTicker, setLastTicker] = useState<string | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallReason, setPaywallReason] = useState("");
  const listRef = useRef<FlatList>(null);
  const cancelRef = useRef({ cancelled: false });
  const inputRef = useRef<TextInput>(null);

  // On first load: restore history from server if no local sessions, then ensure active session
  useEffect(() => {
    const init = async () => {
      if (sessions.length === 0) await restoreFromServer();
      if (!useChatStore.getState().currentId) createSession();
    };
    init();
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
Edad: ${getAge(profile.birth_date)} años
Ingresos mensuales: $${Number(profile.monthly_income).toLocaleString()} USD
Aportación mensual: $${Number(profile.monthly_contribution).toLocaleString()} USD
Perfil calculado: ${riskLabel}

Diagnóstico de inversor (respuestas del cuestionario inicial):
- Comportamiento declarado ante caídas: ${qa ? q1Labels[qa.q1] : "no disponible"}
- Horizonte / objetivo: ${qa ? q2Labels[qa.q2] : "no disponible"}
- Nivel de conocimiento: ${qa ? q3Labels[qa.q3] : "no disponible"}
- Tolerancia al riesgo con dinero real: ${qa ? q4Labels[qa.q4] : "no disponible"}
- Estilo de gestión: ${qa ? q5Labels[qa.q5] : "no disponible"}
${panicFlag ? `\n⚠️ ${panicFlag}` : ""}${speculationFlag ? `\n⚠️ ${speculationFlag}` : ""}${portfolioBlock}

Instrucciones críticas:
1. Llama siempre a este usuario por su nombre (${profile.name.split(" ")[0]}).
2. Adapta el nivel de explicación a su conocimiento.
3. Si el usuario pregunta o actúa de forma que contradice su perfil declarado (ej: perfil agresivo entra en pánico, perfil conservador pide especular), DEBES nombrarlo directamente con empatía y recalibrar tu asesoría al perfil revelado por su comportamiento real.
4. Responde siempre en español.`;
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

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setPendingImage({
        data: asset.base64!,
        type: asset.mimeType ?? "image/jpeg",
        uri: asset.uri,
      });
    }
  };

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    if ((!msg && !pendingImage) || streaming) return;

    // Client-side free limit check
    if (!isPremiumAccess && remaining <= 0) {
      const mins = resetMinutes(subStore.msgWindowStart);
      openPaywall(`Alcanzaste el límite de ${FREE_MSG_LIMIT} mensajes. Vuelve en ${mins} min o activa Premium.`);
      return;
    }

    const imgToSend = pendingImage;
    setInput("");
    setPendingImage(null);
    cancelRef.current.cancelled = false;

    const displayMsg = msg || "📷 Captura enviada";
    const userMsg: Message = { role: "user", content: displayMsg };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    chatApi.saveMessage("user", displayMsg).catch(() => {});

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

    let full = "";
    try {
      await chatApi.stream(
        msg,
        historyForApi as Array<{ role: string; content: string }>,
        (chunk) => {
          full += chunk;
          setMessages([...withAssistant.slice(0, -1), { role: "assistant", content: full }]);
        },
        () => { setStreaming(false); chatApi.saveMessage("assistant", full).catch(() => {}); },
        (a) => {
          const d: BehavioralDiagnosis = { score: a.s, profile: a.p, signals: a.sig, confidence: a.conf };
          updateMaturity(a.sig);
          setDiagnosis(d, maturityScore);
        },
        (tickers) => { if (tickers.length > 0) setLastTicker(tickers[0]); },
        profile?.mentor,
        cancelRef.current,
        imgToSend?.data ?? null,
        imgToSend?.type ?? null,
      );
    } catch (err: unknown) {
      const errObj = err as { response?: { status?: number; data?: { detail?: { message?: string } } }; message?: string };
      // 429 = message limit hit server-side
      if (errObj?.response?.status === 429) {
        const detail = errObj.response.data?.detail;
        const serverMsg = (typeof detail === "object" ? detail?.message : String(detail)) ?? "Límite alcanzado";
        setMessages([...withAssistant.slice(0, -1)]);
        openPaywall(serverMsg);
      } else {
        const errMsg = errObj?.message ?? String(err);
        if (__DEV__) console.error("[chat] sendMessage error:", errMsg, err);
        setMessages([...withAssistant.slice(0, -1), { role: "assistant", content: "Ocurrió un error al procesar tu mensaje. Inténtalo de nuevo." }]);
      }
      setStreaming(false);
    }
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    const isLastAssistant = item.role === "assistant" && index === messages.length - 1;
    const showChart = isLastAssistant && !streaming && !!lastTicker;
    return (
      <View style={[styles.messageContainer, item.role === "user" ? styles.userContainer : styles.assistantContainer]}>
        {item.role === "assistant" && (
          <View style={[styles.avatar, { backgroundColor: mentor?.color ?? "#16a34a" }]}>
            {mentorPhoto ? (
              <Image source={mentorPhoto} style={styles.avatarPhoto} />
            ) : mentor ? (
              <Text style={{ fontSize: 12 }}>{mentor.emoji}</Text>
            ) : (
              <Ionicons name="trending-up" size={14} color="white" />
            )}
          </View>
        )}
        <View style={item.role === "user" ? { maxWidth: "80%" } : { flex: 1 }}>
          <View style={[styles.bubble, item.role === "user" ? styles.userBubble : styles.assistantBubble]}>
            {item.role === "user" ? (
              <Text style={styles.userText}>{item.content}</Text>
            ) : (
              <>
                <Markdown style={markdownStyles} rules={markdownRules}>{item.content || ""}</Markdown>
                {streaming && isLastAssistant && item.content === "" && (
                  <TypingIndicator color={colors.accentLight} />
                )}
              </>
            )}
          </View>
          {item.role === "user" && (
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => handleEditMessage(index, item.content)}
            >
              <Ionicons name="pencil" size={15} color={colors.textSub} />
            </TouchableOpacity>
          )}
          {showChart && <StockChart ticker={lastTicker!} />}
        </View>
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
      {/* Behavioral investor bar — mobile only */}
      {riskCfg && Platform.OS !== "web" && (() => {
        const score    = diagnosis?.score ?? pct;
        const barColor = score < 36 ? "#3b82f6" : score < 56 ? "#f59e0b" : score < 76 ? "#f97316" : "#ef4444";
        const barLabel = score < 36 ? "Conservador" : score < 56 ? "Moderado" : score < 76 ? "Moderado-Alto" : "Agresivo";
        const confLabel: Record<string, string> = { low: "aprendiendo…", medium: "diagnóstico parcial", high: "diagnóstico sólido" };
        return (
          <View style={[styles.profileBanner, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            {/* Header row */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Ionicons name="pulse-outline" size={13} color={barColor} />
                <Text style={[styles.profileType, { color: barColor, marginBottom: 0, fontSize: 13 }]}>
                  {barLabel}
                </Text>
                {diagnosis && (
                  <View style={[styles.signalChip, { backgroundColor: barColor + "18", borderColor: barColor + "40" }]}>
                    <Text style={[styles.signalText, { color: barColor }]}>{confLabel[diagnosis.confidence]}</Text>
                  </View>
                )}
              </View>
              {profile?.name && (
                <Text style={{ color: colors.textMuted, fontSize: 11 }}>{profile.name.split(" ")[0]}</Text>
              )}
            </View>

            {/* Dynamic bar — fills from 0 to 100 based on behavioral score */}
            <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
              <View style={[styles.barFill, { flex: score, backgroundColor: barColor }]} />
              {score < 100 && <View style={{ flex: 100 - score }} />}
            </View>
            <View style={styles.barLabels}>
              <Text style={[styles.barLabelText, { color: colors.textDim }]}>Pasivo</Text>
              <Text style={[styles.barLabelText, { color: colors.textDim }]}>Especulativo</Text>
            </View>

            {/* Live signal chips */}
            {diagnosis?.signals && diagnosis.signals.length > 0 && (
              <View style={[styles.signalsRow, { marginTop: 6 }]}>
                {diagnosis.signals.map((sig) => (
                  <View key={sig} style={[styles.signalChip, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                    <Text style={[styles.signalText, { color: colors.textDim }]}>{sig.replace(/_/g, " ")}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })()}

      {/* Top bar */}
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
        {mentor ? (
          <Text style={[styles.topBarTitle, { color: colors.text }]}>{`Con ${mentor.name}`}</Text>
        ) : Platform.OS === "web" && profile?.name ? (
          <Text style={[styles.topBarTitle, { color: colors.text }]}>{`Hola, ${profile.name.split(" ")[0]}`}</Text>
        ) : (
          <View style={styles.topBarLogo}>
            <Image source={require("../../assets/images/logo_new.png")} style={styles.topBarLogoImg} />
            <Text style={[styles.topBarTitle, { color: colors.text }]}>Nuvos AI</Text>
          </View>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TouchableOpacity
            onPress={() => setTutorialVisible(true)}
            style={[styles.newChatBtn, { borderColor: colors.border, paddingHorizontal: 10 }]}
          >
            <Ionicons name="help-circle-outline" size={16} color={colors.textSub} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.newChatBtn, { borderColor: colors.border }]}
            onPress={handleNewChat}
            disabled={streaming}
          >
            <Ionicons name="add-outline" size={16} color={colors.textSub} />
            <Text style={[styles.newChatBtnText, { color: colors.textSub }]}>Nuevo chat</Text>
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
              {mentor ? (
                mentorPhoto ? (
                  <Image source={mentorPhoto} style={styles.mentorAvatar} />
                ) : (
                  <View style={[styles.mentorAvatarEmoji, { backgroundColor: mentor.color + "22" }]}>
                    <Text style={{ fontSize: 40 }}>{mentor.emoji}</Text>
                  </View>
                )
              ) : (
                <Ionicons name="flash-outline" size={48} color={colors.accentLight} style={{ marginBottom: 16 }} />
              )}
              <Text style={styles.emptyTitle}>
                {mentor
                  ? mentor.name
                  : profile?.name
                  ? `Hola, ${profile.name.split(" ")[0]}!`
                  : "Nuvos AI"}
              </Text>
              <Text style={styles.emptySubtitle}>
                {mentor
                  ? `${mentor.title} · ${mentor.badge}`
                  : "Pregunta sobre cualquier empresa, concepto o estrategia"}
              </Text>
              {mentor && (
                <View style={styles.mentorPrinciples}>
                  {mentor.principles.map((p, i) => (
                    <View key={i} style={[styles.principlePill, { borderColor: mentor.color + "50", backgroundColor: mentor.color + "12" }]}>
                      <Text style={[styles.principlePillText, { color: mentor.color }]}>{p}</Text>
                    </View>
                  ))}
                </View>
              )}
              <View style={styles.suggestions}>
                {SUGGESTIONS.map((s) => (
                  <TouchableOpacity key={s} style={[styles.suggestion, { borderColor: colors.border }]} onPress={() => sendMessage(s)}>
                    <Ionicons name="sparkles-outline" size={14} color={colors.accentLight} style={{ flexShrink: 0 }} />
                    <Text style={[styles.suggestionText, { color: colors.textSub }]}>{s}</Text>
                    <Ionicons name="chevron-forward" size={13} color={colors.textDim} style={{ flexShrink: 0 }} />
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(_, i) => i.toString()}
              renderItem={renderMessage}
              contentContainerStyle={styles.list}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
              keyboardShouldPersistTaps="handled"
              style={styles.flex}
            />
          )}

          {!isPremiumAccess && (
            <TouchableOpacity
              style={[
                styles.premiumBadge,
                remaining <= 0 && { backgroundColor: "rgba(239,68,68,0.10)", borderColor: "rgba(239,68,68,0.30)" },
              ]}
              onPress={() => openPaywall("Activa Premium para mensajes ilimitados")}
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
                      return `Activa Premium para chats ilimitados o espera ${timeStr}`;
                    })()}
                  </Text>
                </>
              ) : (
                <>
                  <Ionicons name="star" size={11} color="#f59e0b" />
                  <Text style={styles.premiumBadgeText}>
                    {remaining <= 5
                      ? `Te quedan ${remaining} mensaje${remaining === 1 ? "" : "s"} hoy · Activa Premium`
                      : "Activa Premium para mensajes ilimitados"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {pendingImage && (
            <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}>
              <View style={{ position: "relative", width: 64, height: 64 }}>
                <Image source={{ uri: pendingImage.uri }} style={{ width: 64, height: 64, borderRadius: 10 }} />
                <TouchableOpacity
                  onPress={() => setPendingImage(null)}
                  style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center" }}
                >
                  <Ionicons name="close" size={12} color="white" />
                </TouchableOpacity>
              </View>
            </View>
          )}
          <View style={styles.inputContainer}>
            <TouchableOpacity
              onPress={handlePickImage}
              disabled={streaming}
              style={{ padding: 4, opacity: streaming ? 0.4 : 1 }}
            >
              <Ionicons name="image-outline" size={22} color={colors.textSub} />
            </TouchableOpacity>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="¿Cómo puedo ayudarte hoy?"
              placeholderTextColor={colors.placeholder}
              multiline
              editable={!streaming}
            />
            <TouchableOpacity
              style={[styles.sendButton, !streaming && !input.trim() && !pendingImage && styles.sendDisabled]}
              onPress={streaming ? handleStop : () => sendMessage()}
              disabled={!streaming && !input.trim() && !pendingImage}
            >
              {streaming ? (
                <Ionicons name="stop" size={18} color="white" />
              ) : (
                <Ionicons name="send" size={18} color="white" />
              )}
            </TouchableOpacity>
          </View>
        </View>
    </SafeAreaView>

    <PaywallModal
      visible={paywallVisible}
      onClose={() => setPaywallVisible(false)}
      reason={paywallReason}
    />
    <FirstActionModal />
    <TutorialModal
      visible={tutorialVisible}
      onClose={() => { setTutorialVisible(false); markTutorialSeen(); }}
    />
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
    empty: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 28 },
    emptyTitle: { fontSize: 22, fontWeight: "800", color: c.text, marginBottom: 6, letterSpacing: -0.5 },
    emptySubtitle: { fontSize: 14, color: c.textMuted, textAlign: "center", marginBottom: 32, lineHeight: 21 },
    suggestions: { width: "100%", gap: 9 },
    suggestion: {
      backgroundColor: c.card,
      borderWidth: 1, borderColor: c.border,
      borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
      flexDirection: "row", alignItems: "center", gap: 10,
    },
    suggestionText: { color: c.textSub, fontSize: 13, flex: 1, lineHeight: 19 },

    // Message list
    list: { paddingHorizontal: 14, paddingVertical: 16, paddingBottom: 8 },
    messageContainer: { flexDirection: "row", marginBottom: 10, alignItems: "flex-end" },
    userContainer: { justifyContent: "flex-end" },
    assistantContainer: { justifyContent: "flex-start" },

    // Avatars
    avatar: {
      width: 30, height: 30, borderRadius: 15,
      alignItems: "center", justifyContent: "center", marginRight: 8,
      overflow: "hidden",
    },
    avatarPhoto: { width: 30, height: 30, borderRadius: 15 },
    mentorAvatar: { width: 88, height: 88, borderRadius: 44, marginBottom: 14 },
    mentorAvatarEmoji: {
      width: 88, height: 88, borderRadius: 44,
      alignItems: "center", justifyContent: "center", marginBottom: 14,
    },
    mentorPrinciples: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10, justifyContent: "center" },
    principlePill: {
      borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5,
    },
    principlePillText: { fontSize: 11, fontWeight: "600", letterSpacing: 0.2 },

    // Bubbles
    bubble: { maxWidth: "80%", minWidth: 0, flexShrink: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
    userBubble: {
      backgroundColor: c.accent,
      borderBottomRightRadius: 5,
      shadowColor: c.accentLight,
      shadowOpacity: 0.3,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
    },
    assistantBubble: {
      backgroundColor: c.card,
      borderWidth: 1, borderColor: c.border,
      borderBottomLeftRadius: 5,
    },
    userText: { color: "white", fontSize: 14, lineHeight: 21, flexWrap: "wrap", fontWeight: "500" },

    // Input area
    inputContainer: {
      flexDirection: "row", alignItems: "flex-end",
      paddingHorizontal: 12, paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
      backgroundColor: c.card, gap: 8,
    },
    input: {
      flex: 1,
      backgroundColor: c.bgRaised ?? c.bg,
      borderWidth: 1, borderColor: c.border,
      borderRadius: 20,
      paddingHorizontal: 16, paddingVertical: 10,
      color: c.text, fontSize: 15, maxHeight: 110, lineHeight: 20,
    },
    sendButton: {
      width: 44, height: 44,
      backgroundColor: c.accent,
      borderRadius: 22,
      alignItems: "center", justifyContent: "center",
      shadowColor: c.accentLight,
      shadowOpacity: 0.4,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
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

    // Diagnostic
    diagSeparator: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 8, marginBottom: 8 },
    signalsRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 5 },
    signalChip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
    signalText: { fontSize: 9 },
  });
}

function makeMarkdownStyles(c: Colors) {
  return {
    body: {
      color: c.textSub, fontSize: 14, lineHeight: 22, flexShrink: 1,
      ...(Platform.OS === "web" ? { wordBreak: "break-word", overflowWrap: "break-word" } : {}),
    },
    paragraph: {
      flexShrink: 1, flexWrap: "wrap" as const, marginVertical: 4,
      ...(Platform.OS === "web" ? { wordBreak: "break-word", overflowWrap: "break-word" } : {}),
    },
    text: { flexShrink: 1, flexWrap: "wrap" as const },
    heading1: {
      color: c.text, fontSize: 17, fontWeight: "800" as const, letterSpacing: -0.4,
      marginBottom: 8, marginTop: 14, paddingBottom: 6,
      borderBottomWidth: 1.5, borderBottomColor: c.accentLight,
    },
    heading2: {
      color: c.text, fontSize: 15, fontWeight: "700" as const, letterSpacing: -0.2,
      marginBottom: 6, marginTop: 12,
    },
    heading3: {
      color: c.accentLight, fontSize: 13, fontWeight: "700" as const,
      marginBottom: 4, marginTop: 8, letterSpacing: 0.4, textTransform: "uppercase" as const,
    },
    strong: { color: c.text, fontWeight: "700" as const },
    em: { color: c.accentLight, fontStyle: "italic" as const },
    bullet_list: { marginVertical: 6, flexShrink: 1 },
    ordered_list: { marginVertical: 6, flexShrink: 1 },
    list_item: { color: c.textSub, fontSize: 14, lineHeight: 22, flexShrink: 1, marginVertical: 2 },
    code_inline: {
      backgroundColor: c.accentLight + "1a", color: c.accentLight,
      borderRadius: 5, paddingHorizontal: 6, fontSize: 13, fontWeight: "600" as const,
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
