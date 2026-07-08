import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../lib/ThemeContext";
import { marketApi } from "../../lib/api";
import StockAvatar from "../StockAvatar";

interface Peer {
  ticker:     string;
  name:       string;
  price:      number | null;
  change_pct: number | null;
}

export default function StockCompetitors({ ticker }: { ticker: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const [peers, setPeers]     = useState<Peer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    marketApi.getPeers(ticker)
      .then((r) => setPeers(r.data ?? []))
      .catch(() => setPeers([]))
      .finally(() => setLoading(false));
  }, [ticker]);

  if (loading) {
    return (
      <View style={s.loader}>
        <ActivityIndicator color={colors.accentLight} size="small" />
      </View>
    );
  }

  if (peers.length === 0) {
    return (
      <View style={s.loader}>
        <Text style={{ color: colors.textMuted, fontSize: 13 }}>{t("stockCompetitors.noData")}</Text>
      </View>
    );
  }

  return (
    <View>
      {peers.map((peer, i) => {
        const isUp = (peer.change_pct ?? 0) >= 0;
        const color = isUp ? colors.up : colors.down;
        return (
          <TouchableOpacity
            key={peer.ticker}
            onPress={() => router.push(`/stock/${peer.ticker}`)}
            style={[
              s.row,
              {
                borderBottomColor: colors.border,
                borderBottomWidth: i < peers.length - 1 ? StyleSheet.hairlineWidth : 0,
              },
            ]}
            activeOpacity={0.7}
          >
            <StockAvatar ticker={peer.ticker} size={38} />
            <View style={s.info}>
              <Text style={[s.tickerText, { color: colors.text }]}>{peer.ticker}</Text>
              <Text style={[s.nameText, { color: colors.textMuted }]} numberOfLines={1}>
                {peer.name}
              </Text>
            </View>
            {peer.price != null && (
              <View style={s.priceBlock}>
                <Text style={[s.price, { color: colors.text }]}>
                  {peer.price >= 1000
                    ? `$${peer.price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
                    : `$${peer.price.toFixed(2)}`}
                </Text>
                {peer.change_pct != null && (
                  <Text style={[s.change, { color }]}>
                    {isUp ? "+" : ""}{peer.change_pct.toFixed(2)}%
                  </Text>
                )}
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  loader: {
    paddingVertical: 24,
    alignItems: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  info: { flex: 1, minWidth: 0 },
  tickerText: { fontSize: 14, fontWeight: "800" },
  nameText:   { fontSize: 12, marginTop: 1 },
  priceBlock: { alignItems: "flex-end" },
  price:  { fontSize: 14, fontWeight: "700" },
  change: { fontSize: 12, fontWeight: "600", marginTop: 2 },
});
