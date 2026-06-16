import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, Modal, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/ThemeContext";
import { brokerageApi } from "../lib/api";

interface Connection {
  id: string;
  provider: string;
  institution_name: string;
  last_sync_at: string | null;
}

interface BrokerPosition {
  ticker: string;
  name: string;
  shares: number;
  avgPrice: number;
  currentPrice?: number;
  currency: string;
  brokerSource: string;
  institutionName: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onPositionsImported: (positions: BrokerPosition[]) => void;
}

const BROKERS = [
  { id: "ibkr",      name: "Interactive Brokers", logo: "🏛️", desc: "Acciones, opciones, futuros globales" },
  { id: "schwab",    name: "Charles Schwab",      logo: "🟦", desc: "Broker líder en EE.UU." },
  { id: "robinhood", name: "Robinhood",           logo: "🪶", desc: "Trading sin comisiones" },
  { id: "iol",       name: "Invertir Online",     logo: "🇦🇷", desc: "Bolsa de Buenos Aires + NYSE" },
];

export default function MobileBrokerConnectModal({ visible, onClose, onPositionsImported: _ }: Props) {
  const { colors } = useTheme();
  const [connections, setConns] = useState<Connection[]>([]);
  const [syncing, setSyncing]   = useState(false);

  const loadConnections = useCallback(async () => {
    try {
      const res = await brokerageApi.listConnections();
      setConns(res.data?.connections ?? []);
    } catch {}
  }, []);

  useEffect(() => {
    if (visible) loadConnections();
  }, [visible]);

  const handleDisconnect = (id: string) => {
    Alert.alert(
      "Desconectar broker",
      "¿Confirmas que quieres desconectar este broker?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Desconectar",
          style: "destructive",
          onPress: async () => {
            try {
              await brokerageApi.deleteConnection(id);
              await loadConnections();
            } catch {}
          },
        },
      ]
    );
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      await brokerageApi.syncAll();
      await loadConnections();
    } catch {}
    setSyncing(false);
  };

  const handleBrokerTap = (brokerName: string) => {
    Alert.alert(
      "🚀 Próximamente",
      `La conexión directa con ${brokerName} estará disponible muy pronto.`,
      [{ text: "Entendido", style: "default" }]
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[m.container, { backgroundColor: colors.bg }]}>
        {/* Header */}
        <View style={[m.header, { borderBottomColor: colors.border }]}>
          <View style={m.headerLeft}>
            <Text style={m.headerEmoji}>🔗</Text>
            <Text style={[m.headerTitle, { color: colors.text }]}>Conectar Broker</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={m.body} showsVerticalScrollIndicator={false}>

          {/* Connected brokers */}
          {connections.length > 0 && (
            <View style={m.section}>
              <Text style={[m.sectionLabel, { color: colors.textMuted }]}>CONECTADOS</Text>
              {connections.map((c) => (
                <View key={c.id} style={[m.connRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={[m.connName, { color: colors.text }]}>{c.institution_name}</Text>
                    {c.last_sync_at && (
                      <Text style={[m.connDate, { color: colors.textDim }]}>
                        Última sync: {new Date(c.last_sync_at).toLocaleDateString("es")}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity onPress={() => handleDisconnect(c.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="trash-outline" size={17} color={colors.textDim} />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity
                style={[m.syncAllBtn, { borderColor: colors.accentLight }]}
                onPress={handleSyncAll}
                disabled={syncing}
              >
                {syncing
                  ? <ActivityIndicator size="small" color={colors.accentLight} />
                  : <Ionicons name="refresh-outline" size={15} color={colors.accentLight} />
                }
                <Text style={[m.syncAllText, { color: colors.accentLight }]}>Sincronizar todo</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Broker list */}
          <Text style={[m.sectionLabel, { color: colors.textMuted }]}>
            {connections.length > 0 ? "AGREGAR BROKER" : "SELECCIONA TU BROKER"}
          </Text>

          {BROKERS.map((broker) => {
            const isConnected = connections.some(
              (c) => c.institution_name === broker.name || (broker.id === "iol" && c.provider === "iol")
            );
            return (
              <TouchableOpacity
                key={broker.id}
                style={[m.brokerRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: isConnected ? 0.55 : 1 }]}
                onPress={() => { if (!isConnected) handleBrokerTap(broker.name); }}
                activeOpacity={0.75}
              >
                <Text style={m.brokerLogo}>{broker.logo}</Text>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[m.brokerName, { color: colors.text }]}>{broker.name}</Text>
                  <Text style={[m.brokerDesc, { color: colors.textMuted }]}>{broker.desc}</Text>
                </View>
                {isConnected
                  ? <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
                  : <Text style={[m.comingSoon, { color: colors.textDim }]}>Próximamente</Text>
                }
              </TouchableOpacity>
            );
          })}

          <Text style={[m.disclaimer, { color: colors.textDim }]}>
            Solo lectura — Nuvos AI nunca puede ejecutar operaciones en tu cuenta.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const m = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerEmoji: { fontSize: 20 },
  headerTitle: { fontSize: 17, fontWeight: "800", letterSpacing: -0.3 },
  body: { padding: 20, paddingBottom: 48 },
  section: { marginBottom: 20 },
  sectionLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.8, marginBottom: 8, marginTop: 4 },
  connRow: {
    flexDirection: "row", alignItems: "center",
    padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, marginBottom: 8,
  },
  connName: { fontSize: 13, fontWeight: "700" },
  connDate: { fontSize: 11, marginTop: 2 },
  syncAllBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 11, borderRadius: 12, borderWidth: 1, marginTop: 4,
  },
  syncAllText: { fontSize: 13, fontWeight: "700" },
  brokerRow: {
    flexDirection: "row", alignItems: "center",
    padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, marginBottom: 10,
  },
  brokerLogo: { fontSize: 26 },
  brokerName: { fontSize: 14, fontWeight: "700" },
  brokerDesc: { fontSize: 12, marginTop: 1 },
  comingSoon: { fontSize: 11, fontWeight: "600" },
  disclaimer: { fontSize: 10, textAlign: "center", lineHeight: 16, marginTop: 8 },
});
