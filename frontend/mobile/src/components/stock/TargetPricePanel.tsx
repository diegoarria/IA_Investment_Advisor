import React, { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { priceAlertsApi } from "../../lib/api";
import { fmtPrice } from "../../lib/types/companyDiagnostic";

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
        const condition: Condition = price != null && low > price ? "above" : "below";
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
    <View style={{ borderRadius: 18, padding: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <Ionicons name="locate" size={18} color={colors.green} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 14, fontWeight: "800", color: colors.text }} numberOfLines={1}>{t("stockDetailScreen.targetPrice.title")}</Text>
          <Text style={{ fontSize: 11.5, color: colors.muted }} numberOfLines={1}>{t("stockDetailScreen.targetPrice.subtitle")}</Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        <TouchableOpacity
          onPress={() => setMode("single")}
          style={{
            flex: 1, borderRadius: 12, paddingVertical: 9, alignItems: "center",
            backgroundColor: mode === "single" ? colors.text : "transparent",
            borderWidth: 1, borderColor: colors.border,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "800", color: mode === "single" ? colors.bg : colors.muted }}>
            {t("stockDetailScreen.targetPrice.singleMode")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setMode("range")}
          style={{
            flex: 1, borderRadius: 12, paddingVertical: 9, alignItems: "center",
            backgroundColor: mode === "range" ? colors.text : "transparent",
            borderWidth: 1, borderColor: colors.border,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "800", color: mode === "range" ? colors.bg : colors.muted }}>
            {t("stockDetailScreen.targetPrice.rangeMode")}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 10 }}>
        {t("stockDetailScreen.targetPrice.currentPrice")} <Text style={{ fontWeight: "800", color: colors.text }}>{fmtPrice(price, currency)}</Text>
      </Text>

      <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
        <TextInput
          keyboardType="numeric"
          value={lowInput}
          onChangeText={(v) => { setLowInput(v); setJustSaved(false); setError(null); }}
          placeholder={t("stockDetailScreen.targetPrice.lowPlaceholder")}
          placeholderTextColor={colors.muted}
          style={{ flex: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text, borderWidth: 1, borderColor: colors.border }}
        />
        {mode === "range" && (
          <TextInput
            keyboardType="numeric"
            value={highInput}
            onChangeText={(v) => { setHighInput(v); setJustSaved(false); setError(null); }}
            placeholder={t("stockDetailScreen.targetPrice.highPlaceholder")}
            placeholderTextColor={colors.muted}
            style={{ flex: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text, borderWidth: 1, borderColor: colors.border }}
          />
        )}
      </View>

      {error && <Text style={{ fontSize: 12, marginBottom: 10, color: "#ef4444" }}>{error}</Text>}

      <View style={{ flexDirection: "row", gap: 8 }}>
        <TouchableOpacity
          onPress={handleSave}
          disabled={!canSave || saving || loadingExisting}
          style={{
            flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
            borderRadius: 12, paddingVertical: 12,
            backgroundColor: justSaved ? "#22c55e" : colors.green,
            opacity: !canSave || saving || loadingExisting ? 0.5 : 1,
          }}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name={justSaved ? "checkmark" : "notifications"} size={14} color="#fff" />
          )}
          <Text style={{ fontSize: 12.5, fontWeight: "800", color: "#fff" }}>
            {saving
              ? t("stockDetailScreen.targetPrice.creating")
              : justSaved
                ? t("stockDetailScreen.targetPrice.created")
                : existing
                  ? t("stockDetailScreen.targetPrice.updateButton")
                  : t("stockDetailScreen.targetPrice.createButton")}
          </Text>
        </TouchableOpacity>
        {existing && (
          <TouchableOpacity
            onPress={handleRemove}
            disabled={removing}
            style={{ borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, opacity: removing ? 0.6 : 1 }}
          >
            {removing ? <ActivityIndicator size="small" color={colors.muted} /> : <Ionicons name="trash-outline" size={16} color="#ef4444" />}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
