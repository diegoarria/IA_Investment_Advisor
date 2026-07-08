import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, Modal, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert, Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
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

function getBrokers(t: TFunction) {
  return [
    { id: "ibkr",      name: "Interactive Brokers", domain: "interactivebrokers.com", color: "#e8000d", fallback: "IB",  desc: t("mobileBrokerConnectModal.brokers.ibkr") },
    { id: "schwab",    name: "Charles Schwab",       domain: "schwab.com",             color: "#00a2e0", fallback: "CS",  desc: t("mobileBrokerConnectModal.brokers.schwab") },
    { id: "robinhood", name: "Robinhood",            domain: "robinhood.com",          color: "#00c805", fallback: "RH",  desc: t("mobileBrokerConnectModal.brokers.robinhood") },
    { id: "iol",       name: "Invertir Online",      domain: "invertironline.com",     color: "#003087", fallback: "IOL", desc: t("mobileBrokerConnectModal.brokers.iol") },
    { id: "gbm",       name: "GBM",                  domain: "gbm.com.mx",             color: "#0033a0", fallback: "GBM", desc: t("mobileBrokerConnectModal.brokers.gbm") },
    { id: "actinver",  name: "Actinver",             domain: "actinver.com",           color: "#c8102e", fallback: "ACT", desc: t("mobileBrokerConnectModal.brokers.actinver") },
  ];
}

function BrokerLogo({ domain, fallback, color }: { domain: string; fallback: string; color: string }) {
  const [error, setError] = useState(false);
  if (error) {
    return (
      <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: color, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Text style={{ color: "white", fontWeight: "800", fontSize: 11 }}>{fallback}</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri: `https://logo.clearbit.com/${domain}` }}
      style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: "white" }}
      onError={() => setError(true)}
    />
  );
}

export default function MobileBrokerConnectModal({ visible, onClose, onPositionsImported: _ }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const BROKERS = getBrokers(t);
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
      t("mobileBrokerConnectModal.disconnectBrokerTitle"),
      t("mobileBrokerConnectModal.disconnectBrokerMsg"),
      [
        { text: t("mobileBrokerConnectModal.cancel"), style: "cancel" },
        {
          text: t("mobileBrokerConnectModal.disconnect"),
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
      t("mobileBrokerConnectModal.comingSoonTitle"),
      t("mobileBrokerConnectModal.comingSoonMsg", { brokerName }),
      [{ text: t("mobileBrokerConnectModal.understood"), style: "default" }]
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
            <Text style={[m.headerTitle, { color: colors.text }]}>{t("mobileBrokerConnectModal.connectBroker")}</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={m.body} showsVerticalScrollIndicator={false}>

          {/* Connected brokers */}
          {connections.length > 0 && (
            <View style={m.section}>
              <Text style={[m.sectionLabel, { color: colors.textMuted }]}>{t("mobileBrokerConnectModal.connected")}</Text>
              {connections.map((c) => (
                <View key={c.id} style={[m.connRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={[m.connName, { color: colors.text }]}>{c.institution_name}</Text>
                    {c.last_sync_at && (
                      <Text style={[m.connDate, { color: colors.textDim }]}>
                        {t("mobileBrokerConnectModal.lastSync", { date: new Date(c.last_sync_at).toLocaleDateString("es") })}
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
                <Text style={[m.syncAllText, { color: colors.accentLight }]}>{t("mobileBrokerConnectModal.syncAll")}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Broker list */}
          <Text style={[m.sectionLabel, { color: colors.textMuted }]}>
            {connections.length > 0 ? t("mobileBrokerConnectModal.addBroker") : t("mobileBrokerConnectModal.selectYourBroker")}
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
                <BrokerLogo domain={broker.domain} fallback={broker.fallback} color={broker.color} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[m.brokerName, { color: colors.text }]}>{broker.name}</Text>
                  <Text style={[m.brokerDesc, { color: colors.textMuted }]}>{broker.desc}</Text>
                </View>
                {isConnected
                  ? <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
                  : <View style={m.comingSoonBadge}>
                      <Text style={[m.comingSoon, { color: colors.accentLight }]}>{t("mobileBrokerConnectModal.comingSoon")}</Text>
                    </View>
                }
              </TouchableOpacity>
            );
          })}

          <Text style={[m.disclaimer, { color: colors.textDim }]}>
            {t("mobileBrokerConnectModal.disclaimer")}
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
  comingSoonBadge: { borderRadius: 20, borderWidth: 1, borderColor: "rgba(0,168,94,0.3)", backgroundColor: "rgba(0,168,94,0.08)", paddingHorizontal: 9, paddingVertical: 3 },
  brokerName: { fontSize: 14, fontWeight: "700" },
  brokerDesc: { fontSize: 12, marginTop: 1 },
  comingSoon: { fontSize: 11, fontWeight: "600" },
  disclaimer: { fontSize: 10, textAlign: "center", lineHeight: 16, marginTop: 8 },
});
