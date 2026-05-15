import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, SafeAreaView
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Markdown from "react-native-markdown-display";
import { chatApi } from "../../src/lib/api";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { useAppStore, RISK_CONFIG, getAge } from "../../src/lib/profileStore";
import { useChatStore, Message } from "../../src/lib/chatStore";

const SUGGESTIONS = [
  "¿Cómo analizo si una empresa es buena inversión?",
  "Explícame qué es un ETF",
  "¿Qué hace NVIDIA para ganar dinero?",
  "¿Cómo construyo un portafolio diversificado?",
];

export default function ChatScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const markdownStyles = useMemo(() => makeMarkdownStyles(colors), [colors]);
  const profile = useAppStore((s) => s.profile);
  const riskCfg = profile?.risk_tolerance ? RISK_CONFIG[profile.risk_tolerance] : null;
  const pct = riskCfg ? Math.round(riskCfg.pct * 100) : 0;

  const { currentId, currentMessages, setMessages, createSession } = useChatStore();
  const messages = currentMessages();

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const listRef = useRef<FlatList>(null);

  // Ensure there's always an active session
  useEffect(() => {
    if (!currentId) createSession();
  }, []);

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
${panicFlag ? `\n⚠️ ${panicFlag}` : ""}${speculationFlag ? `\n⚠️ ${speculationFlag}` : ""}

Instrucciones críticas:
1. Llama siempre a este usuario por su nombre (${profile.name.split(" ")[0]}).
2. Adapta el nivel de explicación a su conocimiento.
3. Si el usuario pregunta o actúa de forma que contradice su perfil declarado (ej: perfil agresivo entra en pánico, perfil conservador pide especular), DEBES nombrarlo directamente con empatía y recalibrar tu asesoría al perfil revelado por su comportamiento real.
4. Responde siempre en español.`;
  };

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || streaming) return;
    setInput("");

    const userMsg: Message = { role: "user", content: msg };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

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

    let full = "";
    try {
      await chatApi.stream(
        msg,
        historyForApi as Array<{ role: string; content: string }>,
        (chunk) => {
          full += chunk;
          setMessages([...withAssistant.slice(0, -1), { role: "assistant", content: full }]);
        },
        () => {
          setStreaming(false);
        }
      );
    } catch {
      setMessages([...withAssistant.slice(0, -1), { role: "assistant", content: "Error al conectar con el servidor. Verifica que el backend esté corriendo." }]);
      setStreaming(false);
    }
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => (
    <View style={[styles.messageContainer, item.role === "user" ? styles.userContainer : styles.assistantContainer]}>
      {item.role === "assistant" && (
        <View style={styles.avatar}>
          <Ionicons name="trending-up" size={14} color="white" />
        </View>
      )}
      <View style={[styles.bubble, item.role === "user" ? styles.userBubble : styles.assistantBubble]}>
        {item.role === "user" ? (
          <Text style={styles.userText}>{item.content}</Text>
        ) : (
          <>
            <Markdown style={markdownStyles}>{item.content || ""}</Markdown>
            {streaming && index === messages.length - 1 && item.content === "" && (
              <Text style={{ color: colors.accentLight }}>▋</Text>
            )}
          </>
        )}
      </View>
    </View>
  );

  const webContentStyle = Platform.OS === "web"
    ? { maxWidth: 860, width: "100%" as const, alignSelf: "center" as const, flex: 1 }
    : { flex: 1 };

  return (
    <SafeAreaView style={styles.container}>
      {/* Profile banner — mobile only */}
      {riskCfg && Platform.OS !== "web" && (
        <View style={[styles.profileBanner, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name={riskCfg.icon} size={15} color={riskCfg.color} />
              <Text style={[styles.profileType, { color: colors.text, marginBottom: 0 }]}>{riskCfg.label}</Text>
            </View>
            {profile?.name && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Ionicons name="person-outline" size={12} color={colors.textMuted} />
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>{profile.name.split(" ")[0]}</Text>
              </View>
            )}
          </View>
          <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
            <View style={[styles.barFill, { flex: pct, backgroundColor: riskCfg.color }]} />
            {pct < 100 && <View style={{ flex: 100 - pct }} />}
          </View>
          <View style={styles.barLabels}>
            <Text style={[styles.barLabelText, { color: colors.textDim }]}>Bajo riesgo</Text>
            <Text style={[styles.barLabelText, { color: colors.textDim }]}>Alto riesgo</Text>
          </View>
        </View>
      )}

      {/* Top bar */}
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
        <Text style={[styles.topBarTitle, { color: colors.text }]}>
          {Platform.OS === "web" && profile?.name
            ? `Hola, ${profile.name.split(" ")[0]} 👋`
            : "Chat IA"}
        </Text>
        <TouchableOpacity
          style={[styles.newChatBtn, { borderColor: colors.border }]}
          onPress={handleNewChat}
          disabled={streaming}
        >
          <Ionicons name="add-outline" size={16} color={colors.textSub} />
          <Text style={[styles.newChatBtnText, { color: colors.textSub }]}>Nuevo chat</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
        keyboardVerticalOffset={88}
      >
        <View style={webContentStyle}>
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="flash-outline" size={48} color={colors.accentLight} style={{ marginBottom: 16 }} />
              <Text style={styles.emptyTitle}>
                {profile?.name ? `Hola, ${profile.name.split(" ")[0]}!` : "Tu mentor está listo"}
              </Text>
              <Text style={styles.emptySubtitle}>
                {profile?.name
                  ? "Pregunta lo que quieras sobre inversiones — conozco tu perfil y te daré consejos personalizados"
                  : "Pregunta sobre cualquier empresa, concepto o estrategia"}
              </Text>
              <View style={styles.suggestions}>
                {SUGGESTIONS.map((s) => (
                  <TouchableOpacity key={s} style={styles.suggestion} onPress={() => sendMessage(s)}>
                    <Text style={styles.suggestionText}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(_, i) => i.toString()}
              renderItem={renderMessage}
              contentContainerStyle={styles.list}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            />
          )}

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Pregunta sobre inversiones..."
              placeholderTextColor={colors.placeholder}
              multiline
              maxLength={2000}
              editable={!streaming}
            />
            <TouchableOpacity
              style={[styles.sendButton, (!input.trim() || streaming) && styles.sendDisabled]}
              onPress={() => sendMessage()}
              disabled={!input.trim() || streaming}
            >
              {streaming ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <Ionicons name="send" size={18} color="white" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    flex: { flex: 1 },
    profileBanner: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
    profileType: { fontSize: 13, fontWeight: "600", marginBottom: 8 },
    barTrack: { height: 7, borderRadius: 4, overflow: "hidden", flexDirection: "row", marginBottom: 4 },
    barFill: { height: "100%", borderRadius: 4 },
    barLabels: { flexDirection: "row", justifyContent: "space-between" },
    barLabelText: { fontSize: 10 },
    topBar: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1,
    },
    topBarTitle: { fontWeight: "600", fontSize: 15 },
    newChatBtn: {
      flexDirection: "row", alignItems: "center", gap: 4,
      borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    },
    newChatBtnText: { fontSize: 13, fontWeight: "500" },
    empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    emptyTitle: { fontSize: 20, fontWeight: "700", color: c.text, marginBottom: 8 },
    emptySubtitle: { fontSize: 14, color: c.textMuted, textAlign: "center", marginBottom: 24 },
    suggestions: { width: "100%", gap: 8 },
    suggestion: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      borderRadius: 12, padding: 14,
    },
    suggestionText: { color: c.textSub, fontSize: 13 },
    list: { padding: 16, paddingBottom: 8 },
    messageContainer: { flexDirection: "row", marginBottom: 12, alignItems: "flex-end" },
    userContainer: { justifyContent: "flex-end" },
    assistantContainer: { justifyContent: "flex-start" },
    avatar: {
      width: 28, height: 28, backgroundColor: "#16a34a", borderRadius: 14,
      alignItems: "center", justifyContent: "center", marginRight: 8,
    },
    bubble: { maxWidth: "80%", borderRadius: 16, padding: 12 },
    userBubble: { backgroundColor: "#16a34a", borderBottomRightRadius: 4 },
    assistantBubble: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      borderBottomLeftRadius: 4,
    },
    userText: { color: "white", fontSize: 14, lineHeight: 20 },
    inputContainer: {
      flexDirection: "row", alignItems: "flex-end", padding: 12,
      borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.card, gap: 8,
    },
    input: {
      flex: 1, backgroundColor: c.bg, borderWidth: 1, borderColor: c.border,
      borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
      color: c.text, fontSize: 15, maxHeight: 100,
    },
    sendButton: {
      width: 42, height: 42, backgroundColor: "#16a34a",
      borderRadius: 12, alignItems: "center", justifyContent: "center",
    },
    sendDisabled: { opacity: 0.4 },
  });
}

function makeMarkdownStyles(c: Colors) {
  return {
    body: { color: c.textSub, fontSize: 14, lineHeight: 20 },
    heading1: { color: c.text, fontSize: 17, fontWeight: "700" as const, marginBottom: 6, marginTop: 8 },
    heading2: { color: c.text, fontSize: 15, fontWeight: "700" as const, marginBottom: 4, marginTop: 6 },
    heading3: { color: c.textSub, fontSize: 14, fontWeight: "600" as const, marginBottom: 4, marginTop: 4 },
    strong: { color: c.text, fontWeight: "700" as const },
    em: { color: c.textSub, fontStyle: "italic" as const },
    bullet_list: { marginVertical: 4 },
    ordered_list: { marginVertical: 4 },
    list_item: { color: c.textSub, fontSize: 14, lineHeight: 20 },
    code_inline: { backgroundColor: c.bg, color: c.accentLight, borderRadius: 4, paddingHorizontal: 4, fontSize: 13 },
    fence: { backgroundColor: c.bg, borderRadius: 8, padding: 12, marginVertical: 6 },
    code_block: { color: c.accentLight, fontSize: 13 },
    table: { borderWidth: 1, borderColor: c.border, borderRadius: 6, marginVertical: 6 },
    thead: { backgroundColor: c.accent },
    th: { color: "white", fontWeight: "700" as const, padding: 8, fontSize: 13 },
    td: { color: c.textSub, padding: 8, fontSize: 13, borderTopWidth: 1, borderTopColor: c.border },
    blockquote: { borderLeftWidth: 3, borderLeftColor: c.accentLight, paddingLeft: 10, marginVertical: 4 },
    hr: { borderColor: c.border, marginVertical: 8 },
    link: { color: c.accentLight },
  };
}
