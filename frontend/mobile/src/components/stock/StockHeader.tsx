import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/ThemeContext";
import type { StockProfile } from "../../hooks/useStockDetail";

interface Props {
  ticker:  string;
  profile: StockProfile | undefined;
  loading: boolean;
  onBack:  () => void;
}

function fmtPrice(p: number): string {
  return p >= 1000
    ? `$${p.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : `$${p.toFixed(2)}`;
}

export default function StockHeader({ ticker, profile, loading, onBack }: Props) {
  const { colors } = useTheme();

  const price     = profile?.current_price;
  const prevClose = profile?.prev_close;
  const change    = price != null && prevClose != null ? price - prevClose : null;
  const changePct = change != null && prevClose ? (change / prevClose) * 100 : null;
  const isUp      = (changePct ?? 0) >= 0;
  const priceColor = isUp ? colors.up : colors.down;

  return (
    <View style={[s.container, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>

      {/* ── Top row: back + exchange badge ── */}
      <View style={s.topRow}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>

        <View style={s.badges}>
          {profile?.exchange && (
            <View style={[s.badge, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}>
              <Text style={[s.badgeText, { color: colors.textMuted }]}>{profile.exchange}</Text>
            </View>
          )}
          {profile?.sector && (
            <View style={[s.badge, { backgroundColor: colors.accentGlow, borderColor: "transparent" }]}>
              <Text style={[s.badgeText, { color: colors.accentLight }]}>{profile.sector}</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Ticker + company name ── */}
      <Text style={[s.ticker, { color: colors.text }]}>{ticker}</Text>
      {profile?.name && (
        <Text style={[s.name, { color: colors.textMuted }]} numberOfLines={1}>
          {profile.name}
        </Text>
      )}

      {/* ── Price ── */}
      {loading && !profile ? (
        <ActivityIndicator color={colors.accentLight} style={{ marginTop: 12 }} />
      ) : price != null ? (
        <View style={s.priceBlock}>
          <Text style={[s.price, { color: colors.text }]}>{fmtPrice(price)}</Text>

          {changePct != null && change != null && (
            <View style={s.changeRow}>
              <Ionicons
                name={isUp ? "arrow-up" : "arrow-down"}
                size={14}
                color={priceColor}
              />
              <Text style={[s.changeAbs, { color: priceColor }]}>
                {isUp ? "+" : ""}${Math.abs(change).toFixed(2)}
              </Text>
              <Text style={[s.changePct, { color: priceColor }]}>
                ({isUp ? "+" : ""}{changePct.toFixed(2)}%)
              </Text>
            </View>
          )}
        </View>
      ) : null}

      {/* ── 52-week range bar ── */}
      {profile?.week_52_low != null && profile?.week_52_high != null && price != null && (
        <View style={s.rangeWrap}>
          <Text style={[s.rangeLabel, { color: colors.textMuted }]}>
            52s: ${profile.week_52_low.toFixed(0)}
          </Text>
          <View style={[s.rangeTrack, { backgroundColor: colors.border }]}>
            <View
              style={[
                s.rangeBar,
                {
                  backgroundColor: colors.accentLight,
                  width: `${Math.min(
                    100,
                    Math.max(
                      0,
                      ((price - profile.week_52_low) /
                        (profile.week_52_high - profile.week_52_low)) *
                        100,
                    ),
                  )}%`,
                },
              ]}
            />
          </View>
          <Text style={[s.rangeLabel, { color: colors.textMuted }]}>
            ${profile.week_52_high.toFixed(0)}
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  badges: {
    flexDirection: "row",
    gap: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  ticker: {
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.5,
    lineHeight: 32,
  },
  name: {
    fontSize: 14,
    fontWeight: "500",
    marginTop: 2,
  },
  priceBlock: {
    marginTop: 10,
  },
  price: {
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: -1,
    lineHeight: 40,
  },
  changeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 4,
  },
  changeAbs: {
    fontSize: 15,
    fontWeight: "600",
  },
  changePct: {
    fontSize: 15,
    fontWeight: "600",
  },
  rangeWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  rangeLabel: {
    fontSize: 10,
    fontWeight: "600",
    minWidth: 36,
  },
  rangeTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  rangeBar: {
    height: 4,
    borderRadius: 2,
  },
});
