import React, { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { savedValuationsApi } from "../../lib/api";

// Mobile mirror of web's CompanyDiagnosticMarginAlert.tsx — configurable
// margin-of-safety alert saved from Oportunidades, checked daily by
// worker.py's job_saved_valuation_alerts. No premium gate here:
// CompanyDiagnosticCard (the only caller) is already Premium-only end to
// end.
export function CompanyDiagnosticMarginAlert({
  ticker, marginOfSafetyPercent, colors,
}: {
  ticker: string;
  marginOfSafetyPercent: number | null;
  colors: any;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    savedValuationsApi.list()
      .then((res: any) => {
        if (cancelled) return;
        const row = (res.data || []).find((r: { ticker: string }) => r.ticker === ticker);
        setTarget(row ? row.target_margin_of_safety_pct : null);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

  const handleSave = async () => {
    const pct = parseFloat(inputValue);
    if (!Number.isFinite(pct)) return;
    setSaving(true);
    setError(false);
    try {
      await savedValuationsApi.save(ticker, pct);
      setTarget(pct);
      setEditing(false);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setSaving(true);
    try {
      await savedValuationsApi.remove(ticker);
      setTarget(null);
    } catch {
      // leave as-is, user can retry
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <View style={{ borderRadius: 12, padding: 12, marginBottom: 15, backgroundColor: colors.bgRaised, flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {target !== null && !editing ? (
        <>
          <Ionicons name="notifications" size={16} color={colors.accentLight} />
          <View style={{ flex: 1, minWidth: 130 }}>
            <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.text }}>
              {t("companyDiagnostic.marginAlert.activeLabel", { pct: target })}
            </Text>
            {marginOfSafetyPercent !== null && (
              <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>
                {t("companyDiagnostic.marginAlert.currentLabel", { pct: marginOfSafetyPercent.toFixed(1) })}
              </Text>
            )}
          </View>
          <TouchableOpacity onPress={() => { setInputValue(String(target)); setEditing(true); }}>
            <Text style={{ fontSize: 12, fontWeight: "700", color: colors.accentLight }}>{t("companyDiagnostic.marginAlert.edit")}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleRemove} disabled={saving}>
            <Text style={{ fontSize: 12, fontWeight: "700", color: colors.textMuted, opacity: saving ? 0.4 : 1 }}>{t("companyDiagnostic.marginAlert.remove")}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Ionicons name="notifications-outline" size={16} color={colors.textMuted} />
          <View style={{ flex: 1, minWidth: 130 }}>
            <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.text }}>{t("companyDiagnostic.marginAlert.prompt")}</Text>
            {error && <Text style={{ fontSize: 11, color: "#ef4444", marginTop: 1 }}>{t("companyDiagnostic.marginAlert.error")}</Text>}
          </View>
          <TextInput
            value={inputValue}
            onChangeText={setInputValue}
            keyboardType="numeric"
            placeholder="20"
            placeholderTextColor={colors.textMuted}
            style={{ width: 50, textAlign: "center", fontSize: 13, fontWeight: "700", color: colors.text, backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingVertical: 6 }}
          />
          <Text style={{ fontSize: 12, color: colors.textMuted }}>%</Text>
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving || !inputValue}
            style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: colors.accent, opacity: saving || !inputValue ? 0.4 : 1 }}
          >
            {saving ? <ActivityIndicator size="small" color="#062a1a" /> : <Text style={{ fontSize: 12, fontWeight: "700", color: "#062a1a" }}>{t("companyDiagnostic.marginAlert.save")}</Text>}
          </TouchableOpacity>
          {editing && (
            <TouchableOpacity onPress={() => setEditing(false)}>
              <Text style={{ fontSize: 12, color: colors.textMuted }}>{t("companyDiagnostic.marginAlert.cancel")}</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}
