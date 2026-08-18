import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { priceAlertsApi } from "../../lib/api";
import { fmtPrice } from "../../lib/types/companyDiagnostic";

// Mirror of web's CompanyDiagnosticBuyZonePanel.tsx ("Mi Zona de Compra").
// Same real price-alert logic (priceAlertsApi.list/create/remove), same
// i18n copy under subvaluadas.followAlert.*, restyled for RN with the
// screen's own viColors instead of hardcoded light theme.

const PRESETS = [0, 10, 20, 30, 40, 50];
const DEFAULT_PCT = 20;
const ACCENT_GREEN = "#4FA695";

interface StoredAlert {
  ticker: string;
  name: string | null;
  target_price: number;
  condition: "above" | "below";
}

interface Props {
  ticker: string;
  companyName: string | null;
  price: number | null;
  intrinsicValue: number | null;
  currency?: string;
  defaultMarginPct?: number | null;
  colors: any;
}

export function CompanyDiagnosticBuyZonePanel({ ticker, companyName, price, intrinsicValue, currency = "USD", defaultMarginPct, colors }: Props) {
  const { t } = useTranslation();
  const [existing, setExisting] = useState<StoredAlert | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [selectedPct, setSelectedPct] = useState<number>(() => (defaultMarginPct != null ? Math.round(defaultMarginPct) : DEFAULT_PCT));
  const [customOpen, setCustomOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");
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
        const mine = rows.find((r) => r.ticker === ticker.toUpperCase() && r.condition === "below") || null;
        setExisting(mine);
        if (mine && intrinsicValue) {
          const impliedPct = Math.round((1 - mine.target_price / intrinsicValue) * 100);
          setSelectedPct(impliedPct);
        }
      })
      .catch(() => { if (!cancelled) setExisting(null); })
      .finally(() => { if (!cancelled) setLoadingExisting(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const targetPrice = useMemo(() => {
    if (intrinsicValue == null) return null;
    return intrinsicValue * (1 - selectedPct / 100);
  }, [intrinsicValue, selectedPct]);

  const otherPresets = PRESETS.filter((p) => p !== selectedPct);

  const handleSelect = (pct: number) => {
    setSelectedPct(pct);
    setJustSaved(false);
    setError(null);
    setCustomOpen(false);
  };

  const handleCustomSubmit = () => {
    const v = parseFloat(customInput);
    if (!Number.isFinite(v) || v < 0 || v > 95) return;
    handleSelect(Math.round(v));
    setCustomInput("");
  };

  const handleCreate = async () => {
    if (targetPrice == null) return;
    setSaving(true);
    setError(null);
    try {
      await priceAlertsApi.create(ticker.toUpperCase(), targetPrice, "below", companyName || ticker.toUpperCase());
      setExisting({ ticker: ticker.toUpperCase(), name: companyName, target_price: targetPrice, condition: "below" });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 3000);
    } catch (err: any) {
      const raw = err?.response?.data?.detail;
      setError(typeof raw === "string" ? raw : t("subvaluadas.followAlert.error"));
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
    } catch {
      setError(t("subvaluadas.followAlert.error"));
    } finally {
      setRemoving(false);
    }
  };

  if (intrinsicValue == null || price == null) return null;

  return (
    <View style={{ marginTop: 13, borderRadius: 16, padding: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 9, paddingBottom: 12, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <View style={{ width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgRaised }}>
          <Ionicons name="locate" size={16} color={ACCENT_GREEN} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text }} numberOfLines={1}>{t("subvaluadas.followAlert.title", { ticker: ticker.toUpperCase() })}</Text>
          <Text style={{ fontSize: 10.5, color: colors.textMuted }} numberOfLines={1}>{t("subvaluadas.followAlert.subtitle")}</Text>
        </View>
      </View>

      {/* Primary card — currently selected margin */}
      <View style={{ borderRadius: 14, padding: 12, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ alignSelf: "flex-start", fontSize: 8.5, fontWeight: "800", textTransform: "uppercase", paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, marginBottom: 9, color: ACCENT_GREEN, backgroundColor: `${ACCENT_GREEN}1f` }}>
          {t("subvaluadas.followAlert.badge")}
        </Text>
        <Text style={{ fontSize: 15, fontWeight: "900", lineHeight: 20, color: colors.text }}>
          {t("subvaluadas.followAlert.belowLabel", { pct: selectedPct })}
        </Text>
        {targetPrice != null && (
          <Text style={{ fontSize: 11, marginTop: 3, color: colors.textDim }}>· {fmtPrice(targetPrice, currency)}</Text>
        )}
        <Text style={{ fontSize: 11, marginTop: 7, lineHeight: 15.5, color: colors.textMuted }}>
          {t("subvaluadas.followAlert.description")}
        </Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 11 }}>
          <View style={{ flex: 1, minWidth: "45%", borderRadius: 10, padding: 9, backgroundColor: colors.card }}>
            <Text style={{ fontSize: 9, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted }} numberOfLines={1}>{t("subvaluadas.followAlert.currentPrice")}</Text>
            <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text, marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>{fmtPrice(price, currency)}</Text>
          </View>
          <View style={{ flex: 1, minWidth: "45%", borderRadius: 10, padding: 9, backgroundColor: colors.card }}>
            <Text style={{ fontSize: 9, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted }} numberOfLines={1}>{t("subvaluadas.followAlert.intrinsicValue")}</Text>
            <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text, marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>{fmtPrice(intrinsicValue, currency)}</Text>
          </View>
          <View style={{ width: "100%", borderRadius: 10, padding: 9, backgroundColor: `${ACCENT_GREEN}14`, borderWidth: 1, borderColor: ACCENT_GREEN }}>
            <Text style={{ fontSize: 9, fontWeight: "800", textTransform: "uppercase", color: ACCENT_GREEN }} numberOfLines={1}>{t("subvaluadas.followAlert.marginOfSafety", { pct: selectedPct })}</Text>
            <Text style={{ fontSize: 14.5, fontWeight: "900", color: ACCENT_GREEN, marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>{targetPrice != null ? fmtPrice(targetPrice, currency) : "—"}</Text>
          </View>
        </View>

        {error && <Text style={{ fontSize: 11, marginTop: 9, color: "#ef4444" }}>{error}</Text>}

        <View style={{ flexDirection: "row", gap: 8, marginTop: 11 }}>
          <TouchableOpacity
            onPress={handleCreate}
            disabled={saving || loadingExisting}
            style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 6, backgroundColor: justSaved ? ACCENT_GREEN : colors.accent, opacity: saving || loadingExisting ? 0.6 : 1 }}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name={justSaved ? "checkmark" : "notifications"} size={13} color="#fff" />
            )}
            <Text style={{ fontSize: 11, fontWeight: "800", color: "#fff", flexShrink: 1 }} numberOfLines={1} adjustsFontSizeToFit>
              {saving
                ? t("subvaluadas.followAlert.creating")
                : justSaved
                  ? t("subvaluadas.followAlert.created")
                  : existing
                    ? t("subvaluadas.followAlert.updateButton", { pct: selectedPct })
                    : t("subvaluadas.followAlert.createButton", { pct: selectedPct })}
            </Text>
          </TouchableOpacity>
          {existing && (
            <TouchableOpacity
              onPress={handleRemove}
              disabled={removing}
              style={{ borderRadius: 12, paddingHorizontal: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, opacity: removing ? 0.6 : 1 }}
            >
              {removing ? <ActivityIndicator size="small" color={colors.textMuted} /> : <Ionicons name="trash-outline" size={15} color="#ef4444" />}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Other margin options */}
      <View style={{ marginTop: 13 }}>
        <Text style={{ fontSize: 9.5, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted, marginBottom: 7 }}>
          {t("subvaluadas.followAlert.otherOptions")}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {otherPresets.map((pct) => (
            <TouchableOpacity
              key={pct}
              onPress={() => handleSelect(pct)}
              style={{ width: "31%", minHeight: 60, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border }}
            >
              <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text }}>{pct}%</Text>
              {intrinsicValue != null && (
                <Text style={{ fontSize: 9, fontWeight: "700", color: colors.textMuted, marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>
                  {fmtPrice(intrinsicValue * (1 - pct / 100), currency)}
                </Text>
              )}
            </TouchableOpacity>
          ))}
          {!customOpen ? (
            <TouchableOpacity
              onPress={() => setCustomOpen(true)}
              style={{ width: "31%", minHeight: 60, borderRadius: 12, alignItems: "center", justifyContent: "center", gap: 3, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" }}
            >
              <Ionicons name="add" size={14} color={colors.textDim} />
              <Text style={{ fontSize: 9, fontWeight: "700", color: colors.textMuted, textAlign: "center" }} numberOfLines={1}>{t("subvaluadas.followAlert.customOption")}</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: "100%", borderRadius: 12, padding: 9, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border }}>
              <TextInput
                autoFocus
                keyboardType="numeric"
                value={customInput}
                onChangeText={setCustomInput}
                onSubmitEditing={handleCustomSubmit}
                placeholder={t("subvaluadas.followAlert.customPlaceholder")}
                placeholderTextColor={colors.placeholder ?? colors.textMuted}
                style={{ flex: 1, fontSize: 12, color: colors.text, paddingVertical: 4 }}
              />
              <TouchableOpacity onPress={handleCustomSubmit}>
                <Text style={{ fontSize: 11.5, fontWeight: "800", color: ACCENT_GREEN }}>{t("subvaluadas.followAlert.customApply")}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
