import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { supportApi } from "../../src/lib/api";

interface Msg { role: "user" | "assistant"; content: string; }

function getFaq(t: TFunction): { q: string; a: string }[] {
  return t("support.faq", { returnObjects: true }) as { q: string; a: string }[];
}

export default function SupportScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const FAQ = useMemo(() => getFaq(t), [t]);

  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", content: t("support.greeting") },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  // Ticket form
  const [ticketMode, setTicketMode] = useState(false);
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketSending, setTicketSending] = useState(false);
  const [ticketSent, setTicketSent] = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [msgs]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const history = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((p) => [...p, { role: "user", content: text }]);
    setInput("");
    setLoading(true);
    try {
      const res = await supportApi.chat(text, history);
      const reply = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      setMsgs((p) => [...p, { role: "assistant", content: reply }]);
    } catch {
      setMsgs((p) => [...p, { role: "assistant", content: t("support.chatError") }]);
    } finally {
      setLoading(false);
    }
  };

  const sendTicket = async () => {
    if (!ticketSubject.trim() || !ticketMessage.trim()) return;
    setTicketSending(true);
    try {
      await supportApi.createTicket(ticketSubject.trim(), ticketMessage.trim());
      setTicketSent(true);
      setTicketSubject(""); setTicketMessage("");
    } catch {
      Alert.alert(t("support.error"), t("support.ticketError"));
    } finally {
      setTicketSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[s.container, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={100}
    >
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* FAQ */}
        <Text style={[s.section, { color: colors.textDim }]}>{t("support.faqTitle")}</Text>
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {FAQ.map((item, i) => (
            <View key={i} style={i > 0 ? [s.faqDivider, { borderTopColor: colors.border }] : undefined}>
              <TouchableOpacity
                style={s.faqRow}
                onPress={() => setOpenFaq(openFaq === i ? null : i)}
                activeOpacity={0.7}
              >
                <Text style={[s.faqQ, { color: colors.text, flex: 1 }]}>{item.q}</Text>
                <Ionicons
                  name={openFaq === i ? "chevron-up" : "chevron-down"}
                  size={16} color={colors.textMuted}
                />
              </TouchableOpacity>
              {openFaq === i && (
                <Text style={[s.faqA, { color: colors.textSub }]}>{item.a}</Text>
              )}
            </View>
          ))}
        </View>

        {/* Chat */}
        <Text style={[s.section, { color: colors.textDim }]}>{t("support.chatTitle")}</Text>
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={s.chatMessages}>
            {msgs.map((m, i) => (
              <View key={i} style={[s.bubble, m.role === "user" ? s.bubbleUser : s.bubbleBot]}>
                <Text style={[
                  s.bubbleText,
                  { color: m.role === "user" ? "white" : colors.text },
                ]}>
                  {m.content}
                </Text>
              </View>
            ))}
            {loading && (
              <View style={[s.bubble, s.bubbleBot, { paddingVertical: 12 }]}>
                <ActivityIndicator size="small" color={colors.accentLight} />
              </View>
            )}
          </View>
          <View style={[s.chatInput, { borderTopColor: colors.border }]}>
            <TextInput
              style={[s.input, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.text }]}
              placeholder={t("support.chatPlaceholder")}
              placeholderTextColor={colors.placeholder}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={500}
            />
            <TouchableOpacity
              style={[s.sendBtn, { backgroundColor: colors.accent }, (loading || !input.trim()) && s.sendBtnDisabled]}
              onPress={send}
              disabled={loading || !input.trim()}
            >
              <Ionicons name="send" size={18} color="white" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Ticket */}
        <Text style={[s.section, { color: colors.textDim }]}>{t("support.moreHelpTitle")}</Text>
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 32 }]}>
          {ticketSent ? (
            <View style={s.ticketSent}>
              <Ionicons name="checkmark-circle" size={36} color={colors.accentLight} />
              <Text style={[s.ticketSentTitle, { color: colors.text }]}>{t("support.ticketSentTitle")}</Text>
              <Text style={[s.ticketSentSub, { color: colors.textMuted }]}>{t("support.ticketSentSub")}</Text>
              <TouchableOpacity onPress={() => setTicketSent(false)}>
                <Text style={[s.ticketSentLink, { color: colors.textMuted }]}>{t("support.sendAnother")}</Text>
              </TouchableOpacity>
            </View>
          ) : !ticketMode ? (
            <View style={s.ticketCta}>
              <Text style={[s.ticketCtaText, { color: colors.textSub }]}>
                {t("support.ticketCtaText")}
              </Text>
              <TouchableOpacity
                style={[s.ticketBtn, { backgroundColor: colors.accent }]}
                onPress={() => setTicketMode(true)}
              >
                <Text style={s.ticketBtnText}>{t("support.createTicket")}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ padding: 14, gap: 10 }}>
              <TextInput
                style={[s.input, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.text }]}
                placeholder={t("support.subjectPlaceholder")}
                placeholderTextColor={colors.placeholder}
                value={ticketSubject}
                onChangeText={setTicketSubject}
                maxLength={200}
              />
              <TextInput
                style={[s.input, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.text, height: 100, textAlignVertical: "top" }]}
                placeholder={t("support.descriptionPlaceholder")}
                placeholderTextColor={colors.placeholder}
                value={ticketMessage}
                onChangeText={setTicketMessage}
                multiline
                maxLength={2000}
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity
                  style={[s.ticketBtn, { flex: 1, backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border }]}
                  onPress={() => setTicketMode(false)}
                >
                  <Text style={[s.ticketBtnText, { color: colors.textMuted }]}>{t("support.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.ticketBtn, { flex: 1, backgroundColor: colors.accent }, (ticketSending || !ticketSubject.trim() || !ticketMessage.trim()) && s.sendBtnDisabled]}
                  onPress={sendTicket}
                  disabled={ticketSending || !ticketSubject.trim() || !ticketMessage.trim()}
                >
                  {ticketSending
                    ? <ActivityIndicator color="white" size="small" />
                    : <Text style={s.ticketBtnText}>{t("support.send")}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1 },
    content: { padding: 16, gap: 8 },
    section: { fontSize: 10, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginTop: 8, marginLeft: 2, marginBottom: 4 },
    card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },

    faqRow: { flexDirection: "row", alignItems: "center", padding: 14, gap: 8 },
    faqDivider: { borderTopWidth: StyleSheet.hairlineWidth },
    faqQ: { fontSize: 13, fontWeight: "600" },
    faqA: { fontSize: 12, lineHeight: 18, paddingHorizontal: 14, paddingBottom: 12 },

    chatMessages: { padding: 12, gap: 8 },
    bubble: { maxWidth: "82%", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
    bubbleUser: { alignSelf: "flex-end", backgroundColor: "#16a34a", borderBottomRightRadius: 4 },
    bubbleBot: { alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.06)", borderBottomLeftRadius: 4 },
    bubbleText: { fontSize: 13, lineHeight: 18 },
    chatInput: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, borderTopWidth: StyleSheet.hairlineWidth },
    input: { flex: 1, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
    sendBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    sendBtnDisabled: { opacity: 0.4 },

    ticketCta: { padding: 16, alignItems: "center", gap: 12 },
    ticketCtaText: { fontSize: 13, textAlign: "center", lineHeight: 18 },
    ticketBtn: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center" },
    ticketBtnText: { color: "white", fontWeight: "700", fontSize: 14 },
    ticketSent: { padding: 24, alignItems: "center", gap: 8 },
    ticketSentTitle: { fontSize: 16, fontWeight: "700" },
    ticketSentSub: { fontSize: 13, textAlign: "center" },
    ticketSentLink: { fontSize: 12, textDecorationLine: "underline", marginTop: 4 },
  });
}
