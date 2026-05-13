import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, SafeAreaView
} from "react-native";
import Markdown from "react-native-markdown-display";
import { chatApi } from "../../src/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "¿Cómo analizo si una empresa es buena inversión?",
  "Explícame qué es un ETF",
  "¿Qué hace NVIDIA para ganar dinero?",
  "¿Cómo construyo un portafolio diversificado?",
];

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    chatApi.getHistory().then((res) => {
      setMessages(res.data.messages);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || streaming) return;
    setInput("");

    const userMsg: Message = { role: "user", content: msg };
    setMessages((prev) => [...prev, userMsg]);
    chatApi.saveMessage("user", msg).catch(() => {});

    const historyForApi = messages.slice(-20);
    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantMsg]);
    setStreaming(true);

    let full = "";
    await chatApi.stream(
      msg, historyForApi,
      (chunk) => {
        full += chunk;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: full };
          return updated;
        });
      },
      () => {
        setStreaming(false);
        chatApi.saveMessage("assistant", full).catch(() => {});
      }
    );
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => (
    <View style={[styles.messageContainer, item.role === "user" ? styles.userContainer : styles.assistantContainer]}>
      {item.role === "assistant" && (
        <View style={styles.avatar}>
          <Text style={{ fontSize: 12 }}>📈</Text>
        </View>
      )}
      <View style={[styles.bubble, item.role === "user" ? styles.userBubble : styles.assistantBubble]}>
        {item.role === "user" ? (
          <Text style={styles.userText}>{item.content}</Text>
        ) : (
          <>
            <Markdown style={markdownStyles}>
              {item.content || ""}
            </Markdown>
            {streaming && index === messages.length - 1 && item.content === "" && (
              <Text style={{ color: "#22c55e" }}>▋</Text>
            )}
          </>
        )}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
        keyboardVerticalOffset={88}
      >
        {!loaded ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#22c55e" />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>⚡</Text>
            <Text style={styles.emptyTitle}>Tu mentor está listo</Text>
            <Text style={styles.emptySubtitle}>Pregunta sobre cualquier empresa, concepto o estrategia</Text>
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
            placeholderTextColor="#4b5563"
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
              <Text style={{ color: "white", fontSize: 18 }}>➤</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f1117" },
  flex: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: "700", color: "white", marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: "#9ca3af", textAlign: "center", marginBottom: 24 },
  suggestions: { width: "100%", gap: 8 },
  suggestion: {
    backgroundColor: "#1a1d27", borderWidth: 1, borderColor: "#2a2d3a",
    borderRadius: 12, padding: 14
  },
  suggestionText: { color: "#d1d5db", fontSize: 13 },
  list: { padding: 16, paddingBottom: 8 },
  messageContainer: { flexDirection: "row", marginBottom: 12, alignItems: "flex-end" },
  userContainer: { justifyContent: "flex-end" },
  assistantContainer: { justifyContent: "flex-start" },
  avatar: {
    width: 28, height: 28, backgroundColor: "#16a34a", borderRadius: 14,
    alignItems: "center", justifyContent: "center", marginRight: 8
  },
  bubble: { maxWidth: "80%", borderRadius: 16, padding: 12 },
  userBubble: { backgroundColor: "#16a34a", borderBottomRightRadius: 4 },
  assistantBubble: {
    backgroundColor: "#1a1d27", borderWidth: 1, borderColor: "#2a2d3a",
    borderBottomLeftRadius: 4
  },
  messageText: { color: "#e8eaed", fontSize: 14, lineHeight: 20 },
  userText: { color: "white" },
  inputContainer: {
    flexDirection: "row", alignItems: "flex-end", padding: 12,
    borderTopWidth: 1, borderTopColor: "#2a2d3a", backgroundColor: "#1a1d27", gap: 8
  },
  input: {
    flex: 1, backgroundColor: "#0f1117", borderWidth: 1, borderColor: "#2a2d3a",
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    color: "white", fontSize: 15, maxHeight: 100
  },
  sendButton: {
    width: 42, height: 42, backgroundColor: "#16a34a",
    borderRadius: 12, alignItems: "center", justifyContent: "center"
  },
  sendDisabled: { opacity: 0.4 },
});

const markdownStyles = {
  body: { color: "#e8eaed", fontSize: 14, lineHeight: 20 },
  heading1: { color: "white", fontSize: 17, fontWeight: "700" as const, marginBottom: 6, marginTop: 8 },
  heading2: { color: "white", fontSize: 15, fontWeight: "700" as const, marginBottom: 4, marginTop: 6 },
  heading3: { color: "#d1d5db", fontSize: 14, fontWeight: "600" as const, marginBottom: 4, marginTop: 4 },
  strong: { color: "white", fontWeight: "700" as const },
  em: { color: "#d1d5db", fontStyle: "italic" as const },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item: { color: "#e8eaed", fontSize: 14, lineHeight: 20 },
  code_inline: { backgroundColor: "#0f1117", color: "#22c55e", borderRadius: 4, paddingHorizontal: 4, fontSize: 13 },
  fence: { backgroundColor: "#0f1117", borderRadius: 8, padding: 12, marginVertical: 6 },
  code_block: { color: "#22c55e", fontSize: 13 },
  table: { borderWidth: 1, borderColor: "#2a2d3a", borderRadius: 6, marginVertical: 6 },
  thead: { backgroundColor: "#16a34a" },
  th: { color: "white", fontWeight: "700" as const, padding: 8, fontSize: 13 },
  td: { color: "#e8eaed", padding: 8, fontSize: 13, borderTopWidth: 1, borderTopColor: "#2a2d3a" },
  blockquote: { borderLeftWidth: 3, borderLeftColor: "#22c55e", paddingLeft: 10, marginVertical: 4 },
  hr: { borderColor: "#2a2d3a", marginVertical: 8 },
  link: { color: "#22c55e" },
};
