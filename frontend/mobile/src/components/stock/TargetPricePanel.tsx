import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { priceAlertsApi } from "../../lib/api";
import { fmtPrice } from "../../lib/types/companyDiagnostic";
import { GlowCard, DiagIconDot } from "../subvaluadas/companyDiagnosticShared";

// Same brand green as web's --brand-green-l / --accent-l — mirrors
// frontend/web/src/components/stock/TargetPricePanel.tsx exactly, same
// GlowCard visual system validated across the whole subvaluadas screen.
const BRAND_GREEN = "#00e887";
const BRAND_GREEN_D = "#00b96d";

type Condition = "above" | "below" | "range";

interface StoredAlert {
  ticker: string;
  name: string | null;
  target_price: number;
  target_price_high: number | null;
  condition: Condition;
}

interface Props {
  ticker: string;
  companyName: string | null;
  price: number | null;
  currency?: string;
  colors: any;
}

export function TargetPricePanel({ ticker, companyName, price, currency = "USD", colors }: Props) {
  const { t } = useTranslation();
  const [existing, setExisting] = useState<StoredAlert | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [mode, setMode] = useState<"single" | "range">("single");
  const [lowInput, setLowInput] = useState("");
  const [highInput, setHighInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    priceAlertsApi.list()
      .then((res: any) => {
        if (cancelled) return;
        const rows: StoredAlert[] = res.data || [];
        const mine = rows.find((r) => r.ticker === ticker.toUpperCase()) || null;
        setExisting(mine);
        if (mine) {
          if (mine.condition === "range" && mine.target_price_high != null) {
            setMode("range");
            setLowInput(String(mine.target_price));
            setHighInput(String(mine.target_price_high));
          } else {
            setMode("single");
            setLowInput(String(mine.target_price));
          }
        }
      })
      .catch(() => { if (!cancelled) setExisting(null); })
      .finally(() => { if (!cancelled) setLoadingExisting(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const low = parseFloat(lowInput);
  const high = parseFloat(highInput);
  const validSingle = Number.isFinite(low) && low > 0;
  const validRange = validSingle && Number.isFinite(high) && high > low;
  const canSave = mode === "single" ? validSingle : validRange;

  const impliedCondition: "above" | "below" | null = useMemo(() => {
    if (mode !== "single" || !validSingle) return null;
    return price != null && low > price ? "above" : "below";
  }, [mode, validSingle, low, price]);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const name = companyName || ticker.toUpperCase();
      if (mode === "range") {
        await priceAlertsApi.create(ticker.toUpperCase(), low, "range", name, high);
        setExisting({ ticker: ticker.toUpperCase(), name, target_price: low, target_price_high: high, condition: "range" });
      } else {
        const condition: Condition = impliedCondition ?? "below";
        await priceAlertsApi.create(ticker.toUpperCase(), low, condition, name);
        setExisting({ ticker: ticker.toUpperCase(), name, target_price: low, target_price_high: null, condition });
      }
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 3000);
    } catch (err: any) {
      const raw = err?.response?.data?.detail;
      const detail = typeof raw === "string" ? raw : raw?.message;
      setError(detail || t("stockDetailScreen.targetPrice.error"));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    setError(null);
    try {
      await priceAlertsApi.remove(ticker.toUpperCase());
      setExisting(null);
      setJustSaved(false);
      setLowInput("");
      setHighInput("");
    } catch {
      setError(t("stockDetailScreen.targetPrice.error"));
    } finally {
      setRemoving(false);
    }
  };

  if (price == null) return null;

  return (
    <GlowCard colors={colors} tint={BRAND_GREEN} strong>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <DiagIconDot name="locate" color={BRAND_GREEN} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 15, fontWeight: "800", color: colors.text }} numberOfLines={1}>
            {t("stockDetailScreen.targetPrice.title")}
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
            {t("stockDetailScreen.targetPrice.subtitle")}
          </Text>
        </View>
        {existing && !loadingExisting && (
          <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: `${BRAND_GREEN}1f`, borderWidth: 1, borderColor: `${BRAND_GREEN}55` }}>
            <Text style={{ fontSize: 9.5, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.4, color: BRAND_GREEN }}>
              {t("stockDetailScreen.targetPrice.active")}
            </Text>
          </View>
        )}
      </View>

      {/* Current price + saved target */}
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 18 }}>
        <View style={{ flex: 1, borderRadius: 16, padding: 13, backgroundColor: `${BRAND_GREEN}14`, borderWidth: 1, borderColor: `${BRAND_GREEN}33` }}>
          <Text style={{ fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.4, color: colors.muted, marginBottom: 4 }} numberOfLines={1}>
            {t("stockDetailScreen.targetPrice.currentPrice")}
          </Text>
          <Text style={{ fontSize: 17, fontWeight: "900", color: colors.text }} numberOfLines={1} adjustsFontSizeToFit>
            {fmtPrice(price, currency)}
          </Text>
        </View>
        <View style={{ flex: 1, borderRadius: 16, padding: 13, backgroundColor: existing ? `${BRAND_GREEN}14` : colors.raised, borderWidth: 1, borderColor: existing ? `${BRAND_GREEN}33` : colors.border }}>
          <Text style={{ fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.4, color: colors.muted, marginBottom: 4 }} numberOfLines={1}>
            {t("stockDetailScreen.targetPrice.yourTarget")}
          </Text>
          <Text style={{ fontSize: 17, fontWeight: "900", color: existing ? BRAND_GREEN : colors.dim }} numberOfLines={1} adjustsFontSizeToFit>
            {existing
              ? existing.condition === "range"
                ? `${fmtPrice(existing.target_price, currency)}–${fmtPrice(existing.target_price_high!, currency)}`
                : fmtPrice(existing.target_price, currency)
              : "—"}
          </Text>
        </View>
      </View>

      {/* Mode toggle — same segmented switch language as the scenario toggle */}
      <View style={{ flexDirection: "row", gap: 6, padding: 5, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.22)", marginBottom: 16 }}>
        {(["single", "range"] as const).map((m) => {
          const active = mode === m;
          return (
            <TouchableOpacity
              key={m}
              onPress={() => { setMode(m); setJustSaved(false); setError(null); }}
              activeOpacity={0.85}
              style={{ flex: 1, borderRadius: 14, overflow: "hidden" }}
            >
              <LinearGradient
                colors={active ? [BRAND_GREEN, BRAND_GREEN_D] : ["transparent", "transparent"]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ paddingVertical: 11, alignItems: "center" }}
              >
                <Text style={{ fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5, color: active ? "#061308" : colors.sub }}>
                  {t(`stockDetailScreen.targetPrice.${m}Mode`)}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Inputs */}
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 8 }}>
        <View style={{ flex: 1 }}>
          {mode === "range" && (
            <Text style={{ fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4, color: colors.muted, marginBottom: 6 }}>
              {t("stockDetailScreen.targetPrice.lowLabel")}
            </Text>
          )}
          <TextInput
            keyboardType="numeric"
            value={lowInput}
            onChangeText={(v) => { setLowInput(v); setJustSaved(false); setError(null); }}
            placeholder={t("stockDetailScreen.targetPrice.lowPlaceholder")}
            placeholderTextColor={colors.muted}
            style={{ borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontWeight: "700", color: colors.text, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border }}
          />
        </View>
        {mode === "range" && (
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4, color: colors.muted, marginBottom: 6 }}>
              {t("stockDetailScreen.targetPrice.highLabel")}
            </Text>
            <TextInput
              keyboardType="numeric"
              value={highInput}
              onChangeText={(v) => { setHighInput(v); setJustSaved(false); setError(null); }}
              placeholder={t("stockDetailScreen.targetPrice.highPlaceholder")}
              placeholderTextColor={colors.muted}
              style={{ borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontWeight: "700", color: colors.text, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border }}
            />
          </View>
        )}
      </View>

      {mode === "single" && impliedCondition ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16 }}>
          <Ionicons name={impliedCondition === "above" ? "arrow-up" : "arrow-down"} size={13} color={BRAND_GREEN} />
          <Text style={{ fontSize: 12, fontWeight: "700", color: colors.sub }}>
            {t(`stockDetailScreen.targetPrice.condition.${impliedCondition}`)}
          </Text>
        </View>
      ) : (
        <View style={{ marginBottom: 16 }} />
      )}

      {error && (
        <View style={{ borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 16, backgroundColor: "rgba(239,68,68,0.1)", borderWidth: 1, borderColor: "rgba(239,68,68,0.3)" }}>
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: "#f87171" }}>{error}</Text>
        </View>
      )}

      {/* Actions */}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <TouchableOpacity
          onPress={handleSave}
          disabled={!canSave || saving || loadingExisting}
          activeOpacity={0.85}
          style={{ flex: 1, borderRadius: 16, overflow: "hidden", opacity: !canSave || saving || loadingExisting ? 0.45 : 1 }}
        >
          <LinearGradient colors={[BRAND_GREEN, BRAND_GREEN_D]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14 }}>
            {saving ? (
              <ActivityIndicator size="small" color="#061308" />
            ) : (
              <Ionicons name={justSaved ? "checkmark" : "notifications"} size={15} color="#061308" />
            )}
            <Text style={{ fontSize: 13.5, fontWeight: "900", color: "#061308" }}>
              {saving
                ? t("stockDetailScreen.targetPrice.creating")
                : justSaved
                  ? t("stockDetailScreen.targetPrice.created")
                  : existing
                    ? t("stockDetailScreen.targetPrice.updateButton")
                    : t("stockDetailScreen.targetPrice.createButton")}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
        {existing && (
          <TouchableOpacity
            onPress={handleRemove}
            disabled={removing}
            style={{ borderRadius: 16, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border, opacity: removing ? 0.6 : 1 }}
          >
            {removing
              ? <ActivityIndicator size="small" color={colors.muted} />
              : <Ionicons name="trash-outline" size={17} color="#f87171" />}
          </TouchableOpacity>
        )}
      </View>
    </GlowCard>
  );
}
