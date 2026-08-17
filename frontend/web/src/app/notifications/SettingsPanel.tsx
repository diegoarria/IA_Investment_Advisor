"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { apiBase } from "@/lib/apiBase";
import { useSubscriptionStore } from "@/lib/store";
import PaywallModal from "@/components/PaywallModal";

const API = apiBase();

function getPushToggles(t: TFunction) {
  return [
    { key: "push_market_open",        label: t("notificationSettings.push.marketOpen.label"),        desc: t("notificationSettings.push.marketOpen.desc") },
    { key: "push_market_close",       label: t("notificationSettings.push.marketClose.label"),       desc: t("notificationSettings.push.marketClose.desc") },
    { key: "push_portfolio_alerts",   label: t("notificationSettings.push.portfolioAlerts.label"),   desc: t("notificationSettings.push.portfolioAlerts.desc") },
    { key: "push_watchlist_alerts",   label: t("notificationSettings.push.watchlistAlerts.label"),   desc: t("notificationSettings.push.watchlistAlerts.desc") },
    { key: "push_news_general",       label: t("notificationSettings.push.news.label"),              desc: t("notificationSettings.push.news.desc") },
    { key: "push_ai_recommendations", label: t("notificationSettings.push.aiRecommendations.label"), desc: t("notificationSettings.push.aiRecommendations.desc") },
    { key: "push_milestones",         label: t("notificationSettings.push.milestones.label"),        desc: t("notificationSettings.push.milestones.desc") },
    { key: "push_volatility",         label: t("notificationSettings.push.volatility.label"),        desc: t("notificationSettings.push.volatility.desc") },
  ];
}
// Fase 4, Incremento 10 (Alertas Inteligentes, Parte J) — each bridges a
// real Fase 2/3 signal (Change Detection Engine / Deterioration Engine /
// DCF), never a new detection. 100% Premium (Diego's Aug 16 Free/Premium
// spec, §7) — rendered separately below, gated by isPremium.
function getSmartAlertToggles(t: TFunction) {
  return [
    { key: "push_thesis_changes",         label: t("notificationSettings.push.thesisChanges.label"),        desc: t("notificationSettings.push.thesisChanges.desc") },
    { key: "push_guidance_changes",       label: t("notificationSettings.push.guidanceChanges.label"),      desc: t("notificationSettings.push.guidanceChanges.desc") },
    { key: "push_roic_fcf_deterioration", label: t("notificationSettings.push.roicFcfDeterioration.label"), desc: t("notificationSettings.push.roicFcfDeterioration.desc") },
    { key: "push_new_risks",              label: t("notificationSettings.push.newRisks.label"),              desc: t("notificationSettings.push.newRisks.desc") },
    { key: "push_price_in_range",         label: t("notificationSettings.push.priceInRange.label"),          desc: t("notificationSettings.push.priceInRange.desc") },
  ];
}
function getEmailToggles(t: TFunction) {
  return [
    { key: "email_daily_summary",  label: t("notificationSettings.email.daily.label"),  desc: t("notificationSettings.email.daily.desc") },
    { key: "email_weekly_summary", label: t("notificationSettings.email.weekly.label"), desc: t("notificationSettings.email.weekly.desc") },
  ];
}

interface Props { onClose: () => void }

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 ml-3 w-11 h-6 rounded-full relative transition-colors"
      style={{ background: on ? "var(--accent-l, #22c55e)" : "var(--border, #2a2d3a)" }}
    >
      <span
        className="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform"
        style={{ transform: on ? "translateX(22px)" : "translateX(4px)" }}
      />
    </button>
  );
}

export default function NotificationSettingsPanel({ onClose }: Props) {
  const { t } = useTranslation();
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;
  const PUSH_TOGGLES = getPushToggles(t);
  const SMART_ALERT_TOGGLES = getSmartAlertToggles(t);
  const EMAIL_TOGGLES = getEmailToggles(t);
  const [prefs, setPrefs] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved,  setSaved]    = useState(false);
  const [smartAlertsTeaser, setSmartAlertsTeaser] = useState<number | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/api/notification-settings`, {
          credentials: "include",
        });
        setPrefs(await res.json());
      } catch {}
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (isPremium) return;
    // Free: never fetch/show the raw toggles — just a real count of what
    // Arthur already detected (Diego's Aug 16 spec, §7 — never a
    // fabricated number, 0 stays 0).
    (async () => {
      try {
        const res = await fetch(`${API}/api/smart-alerts/teaser`, { credentials: "include" });
        const json = await res.json();
        setSmartAlertsTeaser(typeof json.count === "number" ? json.count : 0);
      } catch {
        setSmartAlertsTeaser(0);
      }
    })();
  }, [isPremium]);

  const toggle = (key: string) =>
    setPrefs((p) => (p ? { ...p, [key]: !p[key] } : p));

  const save = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      await fetch(`${API}/api/notification-settings`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-sm flex flex-col"
        style={{ background: "var(--card)", borderLeft: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 shrink-0"
             style={{ borderBottom: "1px solid var(--border)" }}>
          <span className="font-bold text-base" style={{ color: "var(--text)" }}>
            {t("notificationSettings.title")}
          </span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5"
                  style={{ color: "var(--muted)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-l)" }} />
            </div>
          ) : !prefs ? (
            <p className="text-sm text-center py-10" style={{ color: "var(--muted)" }}>
              {t("notificationSettings.loadError")}
            </p>
          ) : (
            <>
              {/* Push section */}
              <section>
                <p className="text-xs font-black uppercase tracking-widest mb-3"
                   style={{ color: "var(--accent-l)", letterSpacing: "0.12em" }}>
                  {t("notificationSettings.pushSection")}
                </p>
                <div className="space-y-1">
                  {PUSH_TOGGLES.map(({ key, label, desc }) => (
                    <button key={key} onClick={() => toggle(key)}
                            className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white/3 transition-colors"
                            style={{ background: "var(--raised)" }}>
                      <div className="text-left">
                        <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{label}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--dim, #6b7280)" }}>{desc}</p>
                      </div>
                      <Toggle on={!!prefs[key]} onClick={() => toggle(key)} />
                    </button>
                  ))}
                </div>
              </section>

              {/* Smart Alerts — 100% Premium (Diego's Aug 16 spec, §7) */}
              <section>
                <p className="text-xs font-black uppercase tracking-widest mb-3"
                   style={{ color: "var(--accent-l)", letterSpacing: "0.12em" }}>
                  {t("notificationSettings.smartAlertsSection")}
                </p>
                {isPremium ? (
                  <div className="space-y-1">
                    {SMART_ALERT_TOGGLES.map(({ key, label, desc }) => (
                      <button key={key} onClick={() => toggle(key)}
                              className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white/3 transition-colors"
                              style={{ background: "var(--raised)" }}>
                        <div className="text-left">
                          <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{label}</p>
                          <p className="text-xs mt-0.5" style={{ color: "var(--dim, #6b7280)" }}>{desc}</p>
                        </div>
                        <Toggle on={!!prefs[key]} onClick={() => toggle(key)} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <button
                    onClick={() => setPaywallOpen(true)}
                    className="w-full flex items-center gap-3 p-4 rounded-xl text-left"
                    style={{ background: "var(--raised)" }}
                  >
                    <Lock className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />
                    <p className="text-sm" style={{ color: "var(--text)" }}>
                      {smartAlertsTeaser === null
                        ? t("notificationSettings.smartAlertsLoading")
                        : smartAlertsTeaser === 0
                        ? t("notificationSettings.smartAlertsTeaserZero")
                        : t("notificationSettings.smartAlertsTeaser", { count: smartAlertsTeaser })}
                    </p>
                  </button>
                )}
              </section>

              {/* Email section */}
              <section>
                <p className="text-xs font-black uppercase tracking-widest mb-3"
                   style={{ color: "var(--accent-l)", letterSpacing: "0.12em" }}>
                  {t("notificationSettings.emailSection")}
                </p>
                <div className="space-y-1">
                  {EMAIL_TOGGLES.map(({ key, label, desc }) => (
                    <button key={key} onClick={() => toggle(key)}
                            className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white/3 transition-colors"
                            style={{ background: "var(--raised)" }}>
                      <div className="text-left">
                        <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{label}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--dim, #6b7280)" }}>{desc}</p>
                      </div>
                      <Toggle on={!!prefs[key]} onClick={() => toggle(key)} />
                    </button>
                  ))}
                </div>
              </section>

              {/* Limits section */}
              <section>
                <p className="text-xs font-black uppercase tracking-widest mb-3"
                   style={{ color: "var(--accent-l)", letterSpacing: "0.12em" }}>
                  {t("notificationSettings.limitsSection")}
                </p>
                <div className="p-4 rounded-xl space-y-5" style={{ background: "var(--raised)" }}>
                  <div>
                    <div className="flex justify-between mb-2">
                      <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                        {t("notificationSettings.maxPerDay")}
                      </p>
                      <span className="text-sm font-bold" style={{ color: "var(--accent-l)" }}>
                        {prefs.max_push_per_day}
                      </span>
                    </div>
                    <input type="range" min={1} max={10}
                           value={prefs.max_push_per_day ?? 5}
                           onChange={(e) => setPrefs((p) => p ? { ...p, max_push_per_day: +e.target.value } : p)}
                           className="w-full accent-green-500" />
                  </div>

                  <div>
                    <p className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>
                      {t("notificationSettings.quietHours")}
                    </p>
                    <div className="flex gap-3">
                      {(["quiet_hours_start", "quiet_hours_end"] as const).map((field, i) => (
                        <div key={field} className="flex-1">
                          <p className="text-xs mb-1" style={{ color: "var(--dim, #6b7280)" }}>
                            {i === 0 ? t("notificationSettings.from") : t("notificationSettings.to")}
                          </p>
                          <select
                            value={prefs[field] ?? (i === 0 ? 22 : 8)}
                            onChange={(e) =>
                              setPrefs((p) => p ? { ...p, [field]: +e.target.value } : p)
                            }
                            className="w-full p-2 rounded-lg text-sm"
                            style={{
                              background: "var(--card)",
                              border: "1px solid var(--border)",
                              color: "var(--text)",
                            }}
                          >
                            {Array.from({ length: 24 }, (_, h) => (
                              <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>

        {/* Save */}
        <div className="px-5 py-4 shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
          <button
            onClick={save}
            disabled={saving || !prefs}
            className="w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2"
            style={{
              background: saved ? "rgba(34,197,94,0.12)" : "var(--accent-l, #22c55e)",
              color:      saved ? "var(--accent-l)"     : "#fff",
              border:     saved ? "1px solid var(--accent-l)" : "none",
              opacity:    !prefs ? 0.5 : 1,
            }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? t("notificationSettings.saved") : t("notificationSettings.saveChanges")}
          </button>
        </div>
      </div>
      <PaywallModal
        visible={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        reason={
          smartAlertsTeaser === null
            ? t("notificationSettings.smartAlertsSection")
            : smartAlertsTeaser === 0
            ? t("notificationSettings.smartAlertsTeaserZero")
            : t("notificationSettings.smartAlertsTeaser", { count: smartAlertsTeaser })
        }
      />
    </div>
  );
}
