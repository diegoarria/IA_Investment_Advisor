import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../lib/ThemeContext";
import type { StockProfile } from "../../hooks/useStockDetail";

interface Props {
  profile: StockProfile;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtBig(n?: number | null): string {
  if (n == null || n === 0) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString()}`;
}

function fmtNum(n?: number | null, decimals = 2): string {
  if (n == null) return "—";
  return n.toFixed(decimals);
}

function fmtPct(n?: number | null): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

function fmtK(n?: number | null): string {
  if (n == null) return "—";
  if (n >= 1e6)  return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3)  return `${(n / 1e3).toFixed(0)}K`;
  return n.toLocaleString();
}

// ─── Stat Row ─────────────────────────────────────────────────────────────────

function StatRow({ label, value, colors }: {
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <View style={sr.row}>
      <Text style={[sr.label, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[sr.value, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const sr = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 9,
  },
  label: { fontSize: 13, fontWeight: "500" },
  value: { fontSize: 13, fontWeight: "700", textAlign: "right", maxWidth: "55%" },
});

// ─── Section Card ─────────────────────────────────────────────────────────────

function SectionCard({ title, children, colors }: {
  title: string;
  children: React.ReactNode;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <View style={[sc.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[sc.title, { color: colors.textMuted }]}>{title}</Text>
      {children}
    </View>
  );
}

const sc = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  title: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
});

// ─── Divider ─────────────────────────────────────────────────────────────────

function Divider({ color }: { color: string }) {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: color }} />;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function StockOverview({ profile }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const desc = profile.description ?? "";
  const truncated = desc.length > 200 && !expanded;
  const displayDesc = truncated ? desc.slice(0, 200) + "…" : desc;

  return (
    <View style={{ paddingTop: 12, paddingBottom: 8 }}>

      {/* ── Descripción ── */}
      {desc.length > 0 && (
        <View style={[sc.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[sc.title, { color: colors.textMuted }]}>{t("stockOverview.about")}</Text>
          <Text style={[s.desc, { color: colors.textSub }]}>
            {displayDesc}
          </Text>
          {desc.length > 200 && (
            <TouchableOpacity onPress={() => setExpanded(!expanded)} style={s.seeMore}>
              <Text style={[s.seeMoreText, { color: colors.accentLight }]}>
                {expanded ? t("stockOverview.seeLess") : t("stockOverview.seeMore")}
              </Text>
              <Ionicons
                name={expanded ? "chevron-up" : "chevron-down"}
                size={14}
                color={colors.accentLight}
              />
            </TouchableOpacity>
          )}
          {profile.website && (
            <TouchableOpacity
              onPress={() => Linking.openURL(profile.website!)}
              style={s.webLink}
            >
              <Ionicons name="globe-outline" size={13} color={colors.accentLight} />
              <Text style={[s.webText, { color: colors.accentLight }]} numberOfLines={1}>
                {profile.website.replace(/^https?:\/\//, "")}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── Métricas de mercado ── */}
      <SectionCard title={t("stockOverview.market")} colors={colors}>
        <StatRow label={t("stockOverview.marketCap")} value={fmtBig(profile.market_cap)} colors={colors} />
        <Divider color={colors.border} />
        <StatRow label={t("stockOverview.peRatio")} value={fmtNum(profile.pe_ratio)} colors={colors} />
        <Divider color={colors.border} />
        <StatRow label={t("stockOverview.peFwd")} value={fmtNum(profile.forward_pe)} colors={colors} />
        <Divider color={colors.border} />
        <StatRow label={t("stockOverview.epsTtm")} value={profile.eps != null ? `$${profile.eps.toFixed(2)}` : "—"} colors={colors} />
        <Divider color={colors.border} />
        <StatRow label={t("stockOverview.epsFwd")} value={profile.forward_eps != null ? `$${profile.forward_eps.toFixed(2)}` : "—"} colors={colors} />
        <Divider color={colors.border} />
        <StatRow label={t("stockOverview.beta")} value={fmtNum(profile.beta)} colors={colors} />
        <Divider color={colors.border} />
        <StatRow
          label={t("stockOverview.divYield")}
          value={profile.dividend_yield ? `${profile.dividend_yield.toFixed(2)}%` : "—"}
          colors={colors}
        />
        <Divider color={colors.border} />
        <StatRow label={t("stockOverview.priceBook")} value={fmtNum(profile.pb_ratio)} colors={colors} />
      </SectionCard>

      {/* ── Rentabilidad y eficiencia ── */}
      <SectionCard title={t("stockOverview.profitability")} colors={colors}>
        <StatRow label={t("stockOverview.grossMargin")} value={fmtPct(profile.gross_margins)} colors={colors} />
        <Divider color={colors.border} />
        <StatRow label={t("stockOverview.netMargin")} value={fmtPct(profile.profit_margins)} colors={colors} />
        <Divider color={colors.border} />
        <StatRow label={t("stockOverview.roe")} value={fmtPct(profile.return_on_equity)} colors={colors} />
        <Divider color={colors.border} />
        <StatRow label={t("stockOverview.roa")} value={fmtPct(profile.return_on_assets)} colors={colors} />
        <Divider color={colors.border} />
        <StatRow label={t("stockOverview.debtEquity")} value={fmtNum(profile.debt_to_equity)} colors={colors} />
        <Divider color={colors.border} />
        <StatRow label={t("stockOverview.currentRatio")} value={fmtNum(profile.current_ratio)} colors={colors} />
        <Divider color={colors.border} />
        <StatRow label={t("stockOverview.fcf")} value={fmtBig(profile.free_cashflow)} colors={colors} />
      </SectionCard>

      {/* ── Empresa ── */}
      <SectionCard title={t("stockOverview.company")} colors={colors}>
        <StatRow
          label={t("stockOverview.employees")}
          value={profile.employees ? profile.employees.toLocaleString() : "—"}
          colors={colors}
        />
        {profile.country && (
          <>
            <Divider color={colors.border} />
            <StatRow label={t("stockOverview.country")} value={profile.country} colors={colors} />
          </>
        )}
        {profile.city && (
          <>
            <Divider color={colors.border} />
            <StatRow label={t("stockOverview.city")} value={profile.city} colors={colors} />
          </>
        )}
        {profile.sector && (
          <>
            <Divider color={colors.border} />
            <StatRow label={t("stockOverview.sector")} value={profile.sector} colors={colors} />
          </>
        )}
        {profile.industry && (
          <>
            <Divider color={colors.border} />
            <StatRow label={t("stockOverview.industry")} value={profile.industry} colors={colors} />
          </>
        )}
      </SectionCard>
    </View>
  );
}

const s = StyleSheet.create({
  desc: {
    fontSize: 13,
    lineHeight: 20,
    paddingBottom: 8,
  },
  seeMore: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingBottom: 10,
  },
  seeMoreText: {
    fontSize: 12,
    fontWeight: "600",
  },
  webLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingBottom: 10,
  },
  webText: {
    fontSize: 12,
    fontWeight: "500",
  },
});
