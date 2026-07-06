import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, SafeAreaView, ActivityIndicator, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useTheme } from "../src/lib/ThemeContext";
import { libraryApi } from "../src/lib/api";

const TYPE_META: Record<string, { label: string; emoji: string }> = {
  analysis:         { label: "Análisis",   emoji: "📊" },
  note:             { label: "Nota",       emoji: "📝" },
  thesis:           { label: "Tesis",      emoji: "💡" },
  earnings_summary: { label: "Earnings",   emoji: "📈" },
  upload:           { label: "Archivo",    emoji: "📎" },
  bookmark:         { label: "Guardado",   emoji: "🔖" },
};

interface LibraryItem {
  id: string;
  item_type: string;
  ticker: string | null;
  title: string;
  body: string | null;
  source: "user" | "ai";
  created_at: string;
}

export default function LibraryScreen() {
  const { colors } = useTheme();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newTicker, setNewTicker] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await libraryApi.list({ limit: 100 });
      setItems(res.data?.items || []);
    } catch {
      // keep whatever was already loaded
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleAdd = async () => {
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      const res = await libraryApi.save({
        item_type: "note",
        title: newTitle.trim(),
        body: newBody.trim() || undefined,
        ticker: newTicker.trim() || undefined,
        source: "user",
      });
      setItems((prev) => [
        { id: res.data.id, item_type: "note", title: newTitle.trim(), body: newBody.trim(), ticker: newTicker.trim() || null, source: "user", created_at: new Date().toISOString() },
        ...prev,
      ]);
      setNewTitle(""); setNewBody(""); setNewTicker("");
      setAdding(false);
    } catch {
      Alert.alert("Error", "No se pudo guardar la nota.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert("Eliminar", "¿Eliminar este elemento de tu biblioteca?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar", style: "destructive",
        onPress: async () => {
          setItems((prev) => prev.filter((i) => i.id !== id));
          try { await libraryApi.delete(id); } catch {}
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={[st.container, { backgroundColor: colors.bg }]}>
      <View style={st.header}>
        <Text style={[st.headerTitle, { color: colors.text }]}>Mi Biblioteca</Text>
        <TouchableOpacity onPress={() => setAdding((v) => !v)}>
          <Ionicons name={adding ? "close" : "add-circle-outline"} size={24} color={colors.accentLight} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>
        {adding && (
          <View style={[st.addCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TextInput
              style={[st.input, { borderColor: colors.border, color: colors.text }]}
              value={newTitle} onChangeText={setNewTitle}
              placeholder="Título" placeholderTextColor={colors.placeholder}
            />
            <TextInput
              style={[st.input, { borderColor: colors.border, color: colors.text, marginTop: 8 }]}
              value={newTicker} onChangeText={(v) => setNewTicker(v.toUpperCase())}
              placeholder="Ticker (opcional)" placeholderTextColor={colors.placeholder} autoCapitalize="characters"
            />
            <TextInput
              style={[st.input, st.multiline, { borderColor: colors.border, color: colors.text, marginTop: 8 }]}
              value={newBody} onChangeText={setNewBody}
              placeholder="Tu nota o tesis..." placeholderTextColor={colors.placeholder}
              multiline numberOfLines={4}
            />
            <TouchableOpacity
              style={[st.saveBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}
              onPress={handleAdd} disabled={saving}
            >
              <Text style={st.saveBtnText}>{saving ? "Guardando..." : "Guardar en mi biblioteca"}</Text>
            </TouchableOpacity>
          </View>
        )}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.accentLight} />
        ) : items.length === 0 ? (
          <View style={st.empty}>
            <Text style={{ fontSize: 32, marginBottom: 8 }}>📚</Text>
            <Text style={[st.emptyText, { color: colors.textMuted }]}>
              Aún no tienes nada guardado. Tus análisis, notas y tesis de inversión aparecerán aquí.
            </Text>
          </View>
        ) : (
          items.map((item) => {
            const meta = TYPE_META[item.item_type] || { label: item.item_type, emoji: "📄" };
            return (
              <View key={item.id} style={[st.itemCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={st.itemHeader}>
                  <Text style={{ fontSize: 16 }}>{meta.emoji}</Text>
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={[st.itemTitle, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
                    <Text style={[st.itemMeta, { color: colors.textDim }]}>
                      {meta.label}{item.ticker ? ` · ${item.ticker}` : ""} · {item.source === "ai" ? "Generado por IA" : "Tuyo"}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => handleDelete(item.id)}>
                    <Ionicons name="trash-outline" size={16} color={colors.textDim} />
                  </TouchableOpacity>
                </View>
                {!!item.body && (
                  <Text style={[st.itemBody, { color: colors.textMuted }]} numberOfLines={3}>{item.body}</Text>
                )}
              </View>
            );
          })
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  headerTitle: { fontSize: 20, fontWeight: "800" },
  content: { paddingHorizontal: 20 },
  addCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 16 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  saveBtn: { borderRadius: 12, paddingVertical: 12, alignItems: "center", marginTop: 10 },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  empty: { alignItems: "center", paddingTop: 60, paddingHorizontal: 20 },
  emptyText: { textAlign: "center", fontSize: 13, lineHeight: 19 },
  itemCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  itemHeader: { flexDirection: "row", alignItems: "center" },
  itemTitle: { fontSize: 14, fontWeight: "700" },
  itemMeta: { fontSize: 11, marginTop: 2 },
  itemBody: { fontSize: 12, marginTop: 8, lineHeight: 17 },
});
