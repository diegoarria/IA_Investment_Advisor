import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";
import { screenerWeeklyApi } from "../lib/api";
import WeeklyOpportunityCard, { type WeeklyOpportunity } from "./WeeklyOpportunityCard";

interface Props {
  isPremium: boolean;
  onUpgrade: () => void;
}

const TOOL_COLOR = "#8b5cf6";

interface WeeklyData {
  results?: WeeklyOpportunity[];
  generated_at?: string | null;
}

// Diego, 2026-09-24: "Acciones subvaluadas (DCF) ... ese es el que quiero
// que sea el Screener Semanal, el único." Real, DCF-backed candidates —
// same engine and same 5 tickers as the Sunday "Nuvos Radar detectó..."
// push (GET /screener/weekly-opportunities), never the old AI narrative.
//
// Diego, 2026-09-23: "Screener Semanal SIEMPRE SIEMPRE SIEMPRE debe abrir
// ... en mobile app tampoco o a veces sí." Same-week picks (read back from
// weekly_opportunities_history, never recomputed on every visit) cached
// on-device too, per user (same suffix convention as lib/userScopedStorage.
// ts), so a transient failure still shows last week's real picks instead
// of a blank "no suggestions" card.
//
// Diego, 2026-09-24: never persist an empty result, ignore one on read,
// and time-box every entry to 8 days so a stale entry can't outlive its
// week even if it once looked valid.
const WEEKLY_CACHE_KEY = "nuvos_weekly_screener_cache";
const WEEKLY_CACHE_MAX_AGE_MS = 8 * 24 * 3600 * 1000;
function isValidWeeklyPayload(data: WeeklyData | null | undefined): boolean {
  return !!data && (data.results?.length ?? 0) > 0;
}
async function readWeeklyCache(): Promise<WeeklyData | null> {
  try {
    const uid = (await SecureStore.getItemAsync("user_id")) ?? "guest";
    const raw = await AsyncStorage.getItem(`${WEEKLY_CACHE_KEY}__${uid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.cachedAt || Date.now() - parsed.cachedAt > WEEKLY_CACHE_MAX_AGE_MS) return null;
    return isValidWeeklyPayload(parsed.data) ? parsed.data : null;
  } catch { return null; }
}
async function writeWeeklyCache(data: WeeklyData) {
  if (!isValidWeeklyPayload(data)) return;
  try {
    const uid = (await SecureStore.getItemAsync("user_id")) ?? "guest";
    await AsyncStorage.setItem(`${WEEKLY_CACHE_KEY}__${uid}`, JSON.stringify({ data, cachedAt: Date.now() }));
  } catch { /* best-effort — session still has it in memory */ }
}

export default function MobileWeeklyScreener({ isPremium, onUpgrade }: Props) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const [data, setData]       = useState<WeeklyData | null>(null);
  const [previewRows, setPreviewRows] = useState<WeeklyOpportunity[]>([]);
  const [loading, setLoading] = useState(false);
  const s = styles();

  useEffect(() => {
    let cancelled = false;
    readWeeklyCache().then((cached) => { if (cached && !cancelled) setData(cached); });
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    if (!isPremium) return;
    // Diego, 2026-09-23: "necesito que abra en máximo 10 segundos." This is
    // a plain DB read (weekly_opportunities_history), normally instant —
    // the budget only matters on the rare on-demand fallback (a brand new
    // Premium user this job hasn't run for yet). One bounded attempt (8s)
    // decides what's on screen within the 10s ceiling; a second, longer
    // attempt keeps trying quietly in the background if that doesn't land.
    setLoading(true);
    try {
      const res = await screenerWeeklyApi.getWeeklyOpportunities(i18n.language, 8000);
      setData(res.data);
      writeWeeklyCache(res.data);
    } catch {
      screenerWeeklyApi.getWeeklyOpportunities(i18n.language, 25000)
        .then((res: any) => { setData(res.data); writeWeeklyCache(res.data); })
        .catch(() => {}); // still nothing — the empty/cached state below already covers this
    }
    setLoading(false);
  }, [isPremium, i18n.language]);

  useEffect(() => { load(); }, [load]);

  // Free/guest preview — real (never fabricated) candidates from the same
  // DCF universe, just not personalized (that part is Premium-only). Zero
  // AI cost.
  useEffect(() => {
    if (isPremium) return;
    screenerWeeklyApi.getUndervalued(undefined, 3)
      .then((res: any) => setPreviewRows((res.data?.results ?? []) as WeeklyOpportunity[]))
      .catch(() => {});
  }, [isPremium]);

  if (!isPremium) {
    // Diego, 2026-08-30: locked "blurred" preview (skeleton bars, not real
    // text — RN has no reliable text-blur filter) instead of a plain
    // locked card. Whole card taps to the paywall.
    const rows = previewRows.length ? previewRows.slice(0, 3) : [];
    return (
      <TouchableOpacity activeOpacity={0.85} onPress={onUpgrade} style={[s.card, { backgroundColor: colors.card }]}>
        <View style={[s.hero, { backgroundColor: TOOL_COLOR + "18" }]}>
          <View style={[s.circle1, { backgroundColor: TOOL_COLOR + "15" }]} />
          <View style={[s.circle2, { backgroundColor: TOOL_COLOR + "0A" }]} />
          <View style={[s.iconOuter, { backgroundColor: TOOL_COLOR + "25", borderColor: TOOL_COLOR + "40" }]}>
            <View style={[s.iconInner, { backgroundColor: TOOL_COLOR }]}>
              <Ionicons name="search" size={26} color="white" />
            </View>
          </View>
          <Text style={[s.heroTitle, { color: colors.text }]}>{t("mobileWeeklyScreener.title")}</Text>
          <Text style={[s.heroTagline, { color: TOOL_COLOR }]}>{t("mobileWeeklyScreener.tagline")}</Text>
        </View>

        <View style={s.content}>
          <View style={[s.lockedPreview, { borderColor: colors.border }]}>
            <View style={{ opacity: 0.4 }}>
              {(rows.length ? rows : [null, null, null]).map((pick, i) => (
                <View key={pick?.ticker ?? i} style={[s.pickRow, { borderTopColor: colors.border, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0 }]}>
                  <View style={[s.rankBox, { backgroundColor: TOOL_COLOR + "15" }]}>
                    <Text style={[s.rank, { color: TOOL_COLOR }]}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 6 }}>
                    <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                      <Text style={[s.ticker, { color: colors.text }]}>{pick?.ticker ?? "TICK"}</Text>
                      {pick?.sector && (
                        <View style={[s.sectorBadge, { backgroundColor: colors.bgRaised }]}>
                          <Text style={[s.sector, { color: colors.textMuted }]}>{pick.sector}</Text>
                        </View>
                      )}
                    </View>
                    <View style={[s.skeletonBar, { width: "80%", height: 9, backgroundColor: colors.border }]} />
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[s.price, { color: colors.text }]}>
                      {pick?.margin_of_safety_pct != null ? `+${pick.margin_of_safety_pct.toFixed(1)}%` : "+—%"}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
            <View style={s.lockOverlay}>
              <Ionicons name="lock-closed" size={18} color="#fff" />
              <Text style={s.lockText}>{t("mobileWeeklyScreener.unlockPreview")}</Text>
            </View>
          </View>

          <View style={[s.unlockBtn, { backgroundColor: TOOL_COLOR }]}>
            <Ionicons name="sparkles" size={15} color="#fff" />
            <Text style={s.unlockBtnText}>{t("mobileWeeklyScreener.unlockCta")}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[s.card, { backgroundColor: colors.card }]}>

      {/* ── Hero ── */}
      <View style={[s.hero, { backgroundColor: TOOL_COLOR + "18" }]}>
        <View style={[s.circle1, { backgroundColor: TOOL_COLOR + "15" }]} />
        <View style={[s.circle2, { backgroundColor: TOOL_COLOR + "0A" }]} />
        <View style={[s.iconOuter, { backgroundColor: TOOL_COLOR + "25", borderColor: TOOL_COLOR + "40" }]}>
          <View style={[s.iconInner, { backgroundColor: TOOL_COLOR }]}>
            {loading
              ? <ActivityIndicator color="white" size="small" />
              : <Ionicons name="search" size={26} color="white" />}
          </View>
        </View>
        <Text style={[s.heroTitle, { color: colors.text }]}>{t("mobileWeeklyScreener.title")}</Text>
        <Text style={[s.heroTagline, { color: TOOL_COLOR }]}>{t("mobileWeeklyScreener.tagline")}</Text>
        {data?.generated_at && (
          <View style={[s.themeBadge, { backgroundColor: TOOL_COLOR + "20", borderColor: TOOL_COLOR + "40" }]}>
            <Text style={[s.themeBadgeText, { color: TOOL_COLOR }]}>
              {t("mobileWeeklyScreener.updated", {
                date: new Date(data.generated_at).toLocaleDateString(i18n.language === "en" ? "en-US" : "es-MX", { day: "numeric", month: "long" }),
              })}
            </Text>
          </View>
        )}
      </View>

      {/* ── Content ── */}
      <View style={s.content}>
        {loading && (
          <View style={s.loadingRow}>
            <ActivityIndicator size="small" color={TOOL_COLOR} />
            <Text style={[s.loadingText, { color: colors.textMuted }]}>{t("mobileWeeklyScreener.searching")}</Text>
          </View>
        )}

        {!loading && data?.results?.map((pick, i) => (
          <WeeklyOpportunityCard key={pick.ticker} pick={pick} rank={i + 1} />
        ))}

        {!loading && (!data || !data.results || data.results.length === 0) && (
          <View style={s.emptyWrap}>
            <Text style={{ fontSize: 28 }}>🔍</Text>
            <Text style={[s.emptyText, { color: colors.textMuted }]}>{t("mobileWeeklyScreener.noPicks")}</Text>
            <TouchableOpacity
              onPress={load}
              style={[s.retryBtn, { backgroundColor: TOOL_COLOR + "15" }]}
            >
              <Ionicons name="refresh" size={13} color={TOOL_COLOR} />
              <Text style={[s.retryText, { color: TOOL_COLOR }]}>{t("mobileWeeklyScreener.retry")}</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && data?.results && data.results.length > 0 && (
          <View style={[s.disclaimerRow, { borderTopColor: colors.border }]}>
            <Ionicons name="information-circle-outline" size={13} color={colors.textDim ?? colors.textMuted} style={{ marginTop: 1 }} />
            <Text style={[s.disclaimerText, { color: colors.textDim ?? colors.textMuted }]}>
              {t("mobileWeeklyScreener.defaultDisclaimer")}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = () => StyleSheet.create({
  card:       { borderRadius: 24, overflow: "hidden", marginBottom: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 6 },

  // Hero
  hero:        { paddingTop: 28, paddingBottom: 20, alignItems: "center", position: "relative", overflow: "hidden" },
  circle1:     { position: "absolute", width: 160, height: 160, borderRadius: 80, top: -50, right: -30 },
  circle2:     { position: "absolute", width: 100, height: 100, borderRadius: 50, bottom: -25, left: -15 },
  iconOuter:   { width: 80, height: 80, borderRadius: 24, borderWidth: 2, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  iconInner:   { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  heroTitle:   { fontSize: 20, fontWeight: "900", letterSpacing: -0.5, marginBottom: 2, textAlign: "center" },
  heroTagline: { fontSize: 12, fontWeight: "700", textAlign: "center", letterSpacing: 0.2 },
  themeBadge:  { marginTop: 10, borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 4 },
  themeBadgeText: { fontSize: 11, fontWeight: "700" },

  // Content
  content:    { paddingHorizontal: 16, paddingBottom: 16 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 18, justifyContent: "center" },
  loadingText:{ fontSize: 13 },
  emptyWrap:  { alignItems: "center", paddingVertical: 20, gap: 8 },
  emptyText:  { fontSize: 13, textAlign: "center" },
  retryBtn:   { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, marginTop: 2 },
  retryText:  { fontSize: 11, fontWeight: "700" },

  // Locked preview (Free tier)
  lockedPreview: { position: "relative", borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden", marginBottom: 14 },
  skeletonBar:   { borderRadius: 4 },
  lockOverlay:   { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.45)" },
  lockText:      { fontSize: 12, fontWeight: "800", color: "#fff", textAlign: "center", paddingHorizontal: 16 },
  unlockBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 13 },
  unlockBtnText: { fontSize: 14, fontWeight: "800", color: "#fff" },

  // Locked preview rows (Free tier skeleton — Premium rows are WeeklyOpportunityCard)
  pickRow:    { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11 },
  rankBox:    { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  rank:       { fontSize: 12, fontWeight: "900" },
  ticker:     { fontSize: 14, fontWeight: "800" },
  sectorBadge:{ borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  sector:     { fontSize: 10, fontWeight: "600" },
  price:      { fontSize: 13, fontWeight: "700" },

  // Disclaimer
  disclaimerRow:  { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingTop: 12, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth },
  disclaimerText: { fontSize: 10, lineHeight: 14, flex: 1 },
});
