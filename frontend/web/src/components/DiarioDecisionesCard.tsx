"use client";

import { useEffect, useState } from "react";
import { BookOpen, Loader2, TrendingUp, TrendingDown, CheckCircle, RefreshCw, Plus, X, AlertTriangle, Brain, BookMarked, BarChart2, Target, Trash2, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import PremiumToolLocked from "@/components/PremiumToolLocked";
import { decisionsApi } from "@/lib/api";

interface Decision {
  id?: string;
  action: string;
  ticker: string;
  trigger?: string;
  notes?: string;
  price_at_action?: number;
  created_at?: string;
}

interface Bias {
  name: string;
  severity: "alto" | "medio" | "bajo";
  occurrences: number;
  description: string;
  cost_estimate: string;
  example: string;
  fix: string;
}

interface Strength {
  name: string;
  description: string;
}

interface BiasReport {
  total_decisions?: number;
  analysis_period?: string;
  overall_score?: number;
  overall_label?: string;
  biases_detected?: Bias[];
  strengths?: Strength[];
  patterns?: {
    avg_hold_days?: number;
    panic_sell_count?: number;
    fomo_buy_count?: number;
    best_decision?: string;
    worst_decision?: string;
  };
  mentor_assessment?: string;
  next_challenge?: string;
  message?: string;
  generated_at?: string;
}

const ACTION_OPTIONS = ["buy", "sell", "hold", "ignored_alert", "acted_on_alert"];
const TRIGGER_OPTIONS = ["manual", "alert", "mentor", "fomo", "panic", "research"];
function getActionLabels(t: TFunction): Record<string, string> {
  return {
    buy: t("diarioDecisiones.actions.buy"),
    sell: t("diarioDecisiones.actions.sell"),
    hold: t("diarioDecisiones.actions.hold"),
    ignored_alert: t("diarioDecisiones.actions.ignoredAlert"),
    acted_on_alert: t("diarioDecisiones.actions.actedOnAlert"),
  };
}
function getTriggerLabels(t: TFunction): Record<string, string> {
  return {
    manual: t("diarioDecisiones.triggers.manual"),
    alert: t("diarioDecisiones.triggers.alert"),
    mentor: t("diarioDecisiones.triggers.mentor"),
    fomo: t("diarioDecisiones.triggers.fomo"),
    panic: t("diarioDecisiones.triggers.panic"),
    research: t("diarioDecisiones.triggers.research"),
    auto_sync: t("diarioDecisiones.triggers.autoSync"),
  };
}
const SEVERITY_COLOR: Record<string, string> = {
  alto: "#ef4444",
  medio: "#f59e0b",
  bajo: "#22c55e",
};

interface Props {
  isPremium: boolean;
  onUpgrade: () => void;
}

export default function DiarioDecisionesCard({ isPremium, onUpgrade }: Props) {
  const { t } = useTranslation();
  const ACTION_LABELS = getActionLabels(t);
  const TRIGGER_LABELS = getTriggerLabels(t);
  const [tab, setTab]             = useState<"diary" | "biases">("diary");
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [biases, setBiases]       = useState<BiasReport | null>(null);
  const [loadingD, setLoadingD]   = useState(false);
  const [loadingB, setLoadingB]   = useState(false);
  const [logOpen, setLogOpen]     = useState(false);
  const [form, setForm]           = useState({ action: "buy", ticker: "", trigger: "manual", notes: "" });
  const [saving, setSaving]       = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  const fetchDecisions = async () => {
    setLoadingD(true);
    try {
      const res = await decisionsApi.getAll(50);
      setDecisions(res.data.decisions || []);
    } catch {} finally { setLoadingD(false); }
  };

  const fetchBiases = async () => {
    setLoadingB(true);
    try {
      const res = await decisionsApi.getBiases();
      setBiases(res.data);
    } catch {} finally { setLoadingB(false); }
  };

  useEffect(() => {
    if (isPremium) { fetchDecisions(); fetchBiases(); }
  }, [isPremium]);

  const handleDeleteOne = async (id: string) => {
    setDeletingId(id);
    try {
      await decisionsApi.deleteOne(id);
      setDecisions((prev) => prev.filter((d) => d.id !== id));
      setBiases(null);
    } catch {} finally { setDeletingId(null); }
  };

  const handleClearAll = async () => {
    if (!window.confirm(t("diarioDecisiones.confirmClearAll"))) return;
    setClearingAll(true);
    try {
      await decisionsApi.deleteAll();
      setDecisions([]);
      setBiases(null);
    } catch {} finally { setClearingAll(false); }
  };

  const handleLog = async () => {
    if (!form.ticker.trim() || !form.action) return;
    setSaving(true);
    try {
      await decisionsApi.log({ ...form, ticker: form.ticker.toUpperCase() });
      setForm({ action: "buy", ticker: "", trigger: "manual", notes: "" });
      setLogOpen(false);
      fetchDecisions();
      setBiases(null);
    } catch {} finally { setSaving(false); }
  };

  const actionIcon = (action: string) =>
    action === "buy"  ? <TrendingUp  className="w-3.5 h-3.5" style={{ color: "#22c55e" }} />
    : action === "sell" ? <TrendingDown className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />
    : <CheckCircle className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />;

  if (!isPremium) {
    return (
      <PremiumToolLocked
        title={t("diarioDecisiones.locked.title")}
        tagline={t("diarioDecisiones.locked.tagline")}
        description={t("diarioDecisiones.locked.description")}
        icon={Brain}
        color="#a78bfa"
        benefits={[
          { icon: BookMarked, text: t("diarioDecisiones.locked.benefit1") },
          { icon: Brain,      text: t("diarioDecisiones.locked.benefit2") },
          { icon: BarChart2,  text: t("diarioDecisiones.locked.benefit3") },
          { icon: Target,     text: t("diarioDecisiones.locked.benefit4") },
        ]}
        onUnlock={onUpgrade}
      />
    );
  }

  return (
    <>
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "rgba(167,139,250,0.3)", background: "var(--card)" }}>
        <div className="h-1" style={{ background: "linear-gradient(90deg,#a78bfa,#7c3aed)" }} />
        <div className="p-5 space-y-4">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(167,139,250,0.15)" }}>
                <BookOpen className="w-4 h-4" style={{ color: "#a78bfa" }} />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{t("diarioDecisiones.headerTitle")}</p>
                <p className="text-[10px]" style={{ color: "var(--muted)" }}>{t("diarioDecisiones.headerSubtitle")}</p>
              </div>
            </div>
            <button
              onClick={() => setLogOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white"
              style={{ background: "linear-gradient(90deg,#a78bfa,#7c3aed)" }}
            >
              <Plus className="w-3.5 h-3.5" /> {t("diarioDecisiones.register")}
            </button>
          </div>

          {/* Tabs */}
          <div className="flex rounded-xl p-1" style={{ background: "var(--raised)" }}>
            {(["diary", "biases"] as const).map((tabKey) => (
              <button key={tabKey} onClick={() => setTab(tabKey)}
                      className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all"
                      style={{
                        background: tab === tabKey ? "var(--card)" : "transparent",
                        color:      tab === tabKey ? "var(--text)" : "var(--muted)",
                      }}>
                {tabKey === "diary" ? `📔 ${t("diarioDecisiones.tabDiary")}` : `🧠 ${t("diarioDecisiones.tabBiases")}`}
              </button>
            ))}
          </div>

          {/* DIARY TAB */}
          {tab === "diary" && (
            <div className="space-y-2">
              {loadingD ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#a78bfa" }} />
                </div>
              ) : decisions.length === 0 ? (
                <div className="text-center py-8">
                  <BookOpen className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--muted)", opacity: 0.4 }} />
                  <p className="text-sm" style={{ color: "var(--muted)" }}>{t("diarioDecisiones.noDecisions")}</p>
                  <p className="text-xs mt-1" style={{ color: "var(--dim)" }}>{t("diarioDecisiones.noDecisionsHint")}</p>
                </div>
              ) : (
                decisions.map((d, i) => (
                  <div key={d.id ?? i} className="flex items-start gap-3 p-3 rounded-xl border"
                       style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                    <div className="mt-0.5">{actionIcon(d.action)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-bold text-sm" style={{ color: "var(--text)" }}>{d.ticker}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                              style={{ background: "var(--card)", color: "var(--muted)" }}>
                          {ACTION_LABELS[d.action] ?? d.action}
                        </span>
                      </div>
                      {d.trigger && (
                        <p className="text-[10px]" style={{ color: "var(--muted)" }}>
                          {t("diarioDecisiones.trigger")}: {TRIGGER_LABELS[d.trigger] ?? d.trigger}
                        </p>
                      )}
                      {d.notes && (
                        <p className="text-[11px] mt-1" style={{ color: "var(--sub)" }}>{d.notes}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <p className="text-[10px]" style={{ color: "var(--dim)" }}>
                        {d.created_at ? new Date(d.created_at).toLocaleDateString("es-MX") : ""}
                      </p>
                      {d.id && (
                        <button
                          onClick={() => handleDeleteOne(d.id!)}
                          disabled={deletingId === d.id}
                          title={t("diarioDecisiones.deleteOne")}
                          className="p-1 rounded-md hover:opacity-70 disabled:opacity-40"
                        >
                          {deletingId === d.id
                            ? <Loader2 className="w-3 h-3 animate-spin" style={{ color: "var(--muted)" }} />
                            : <Trash2 className="w-3 h-3" style={{ color: "var(--muted)" }} />}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
              {decisions.length > 0 && (
                <button
                  onClick={handleClearAll}
                  disabled={clearingAll}
                  className="w-full flex items-center justify-center gap-1.5 py-2 mt-1 rounded-lg text-[11px] font-semibold disabled:opacity-50"
                  style={{ color: "#ef4444" }}
                >
                  {clearingAll
                    ? <RotateCw className="w-3 h-3 animate-spin" />
                    : <Trash2 className="w-3 h-3" />}
                  {t("diarioDecisiones.clearAll")}
                </button>
              )}
            </div>
          )}

          {/* BIASES TAB */}
          {tab === "biases" && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <button onClick={fetchBiases} disabled={loadingB}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs"
                        style={{ borderColor: "var(--border)", color: "var(--sub)" }}>
                  <RefreshCw className={`w-3 h-3 ${loadingB ? "animate-spin" : ""}`} /> {t("diarioDecisiones.analyze")}
                </button>
              </div>

              {loadingB ? (
                <div className="flex flex-col items-center py-8 gap-3">
                  <Loader2 className="w-7 h-7 animate-spin" style={{ color: "#a78bfa" }} />
                  <p className="text-sm" style={{ color: "var(--muted)" }}>{t("diarioDecisiones.analyzingPatterns")}</p>
                </div>
              ) : !biases ? null : biases.message ? (
                <div className="text-center py-8">
                  <AlertTriangle className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--muted)", opacity: 0.5 }} />
                  <p className="text-sm" style={{ color: "var(--muted)" }}>{biases.message}</p>
                </div>
              ) : (
                <>
                  {/* Score */}
                  <div className="p-4 rounded-xl border text-center"
                       style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                    <p className="text-[10px] font-bold mb-1" style={{ color: "var(--muted)" }}>{t("diarioDecisiones.realProfileTitle")}</p>
                    <div className="text-4xl font-black mb-1" style={{ color: "#a78bfa" }}>
                      {biases.overall_score ?? 0}<span className="text-lg">/100</span>
                    </div>
                    <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{biases.overall_label}</p>
                    <p className="text-[10px] mt-1" style={{ color: "var(--muted)" }}>
                      {t("diarioDecisiones.basedOn", { count: biases.total_decisions, period: biases.analysis_period })}
                    </p>
                  </div>

                  {/* Biases detected */}
                  {biases.biases_detected && biases.biases_detected.length > 0 && (
                    <div>
                      <p className="text-xs font-bold mb-2" style={{ color: "var(--muted)" }}>{t("diarioDecisiones.biasesDetected")}</p>
                      <div className="space-y-3">
                        {biases.biases_detected.map((bias) => (
                          <div key={bias.name} className="p-4 rounded-xl border"
                               style={{ borderColor: `${SEVERITY_COLOR[bias.severity]}30`,
                                        background: `${SEVERITY_COLOR[bias.severity]}08` }}>
                            <div className="flex items-center justify-between mb-2">
                              <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{bias.name}</p>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                                    style={{ background: `${SEVERITY_COLOR[bias.severity]}20`,
                                             color: SEVERITY_COLOR[bias.severity] }}>
                                {bias.severity.toUpperCase()}
                              </span>
                            </div>
                            <p className="text-xs mb-2" style={{ color: "var(--sub)" }}>{bias.description}</p>
                            <div className="grid grid-cols-2 gap-2 mb-2">
                              <div className="p-2 rounded-lg" style={{ background: "var(--raised)" }}>
                                <p className="text-[10px] font-bold mb-0.5" style={{ color: "var(--muted)" }}>{t("diarioDecisiones.occurrences")}</p>
                                <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{bias.occurrences}x</p>
                              </div>
                              <div className="p-2 rounded-lg" style={{ background: "var(--raised)" }}>
                                <p className="text-[10px] font-bold mb-0.5" style={{ color: "var(--muted)" }}>{t("diarioDecisiones.estimatedCost")}</p>
                                <p className="text-xs font-bold" style={{ color: "#ef4444" }}>{bias.cost_estimate}</p>
                              </div>
                            </div>
                            <div className="p-2 rounded-lg mb-2" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
                              <p className="text-[10px] font-bold mb-0.5" style={{ color: "#ef4444" }}>{t("diarioDecisiones.realExample")}</p>
                              <p className="text-[10px]" style={{ color: "var(--sub)" }}>{bias.example}</p>
                            </div>
                            <div className="p-2 rounded-lg" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)" }}>
                              <p className="text-[10px] font-bold mb-0.5" style={{ color: "#22c55e" }}>{t("diarioDecisiones.howToImprove")}</p>
                              <p className="text-[10px]" style={{ color: "var(--sub)" }}>{bias.fix}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Strengths */}
                  {biases.strengths && biases.strengths.length > 0 && (
                    <div>
                      <p className="text-xs font-bold mb-2" style={{ color: "var(--muted)" }}>{t("diarioDecisiones.yourStrengths")}</p>
                      <div className="space-y-2">
                        {biases.strengths.map((s) => (
                          <div key={s.name} className="flex items-start gap-2 p-3 rounded-xl border"
                               style={{ borderColor: "rgba(34,197,94,0.2)", background: "rgba(34,197,94,0.05)" }}>
                            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#22c55e" }} />
                            <div>
                              <p className="text-xs font-bold" style={{ color: "var(--text)" }}>{s.name}</p>
                              <p className="text-[10px]" style={{ color: "var(--sub)" }}>{s.description}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Mentor assessment */}
                  {biases.mentor_assessment && (
                    <div className="p-4 rounded-xl border"
                         style={{ borderColor: "rgba(167,139,250,0.3)", background: "rgba(167,139,250,0.06)" }}>
                      <p className="text-[10px] font-bold mb-1.5" style={{ color: "#a78bfa" }}>🎓 {t("diarioDecisiones.mentorAssessment")}</p>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{biases.mentor_assessment}</p>
                    </div>
                  )}

                  {/* Next challenge */}
                  {biases.next_challenge && (
                    <div className="p-4 rounded-xl border"
                         style={{ borderColor: "rgba(167,139,250,0.3)", background: "rgba(167,139,250,0.06)" }}>
                      <p className="text-[10px] font-bold mb-1.5" style={{ color: "#a78bfa" }}>🎯 {t("diarioDecisiones.weeklyChallenge")}</p>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{biases.next_challenge}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Log decision modal */}
      {logOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-sm rounded-2xl border"
               style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="h-1" style={{ background: "linear-gradient(90deg,#a78bfa,#7c3aed)" }} />
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{t("diarioDecisiones.modal.title")}</p>
                <button onClick={() => setLogOpen(false)} style={{ color: "var(--muted)" }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--muted)" }}>{t("diarioDecisiones.modal.action")}</label>
                  <select className="w-full rounded-lg border px-2 py-1.5 text-xs"
                          style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                          value={form.action}
                          onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}>
                    {ACTION_OPTIONS.map((a) => (
                      <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--muted)" }}>{t("diarioDecisiones.modal.ticker")}</label>
                  <input type="text" placeholder={t("diarioDecisiones.modal.tickerPlaceholder")}
                         className="w-full rounded-lg border px-2 py-1.5 text-xs uppercase"
                         style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                         value={form.ticker}
                         onChange={(e) => setForm((f) => ({ ...f, ticker: e.target.value.toUpperCase() }))} />
                </div>
                <div>
                  <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--muted)" }}>{t("diarioDecisiones.modal.whyLabel")}</label>
                  <select className="w-full rounded-lg border px-2 py-1.5 text-xs"
                          style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                          value={form.trigger}
                          onChange={(e) => setForm((f) => ({ ...f, trigger: e.target.value }))}>
                    {TRIGGER_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{TRIGGER_LABELS[opt] ?? opt}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--muted)" }}>{t("diarioDecisiones.modal.notesLabel")}</label>
                  <textarea rows={2} placeholder={t("diarioDecisiones.modal.notesPlaceholder")}
                            className="w-full rounded-lg border px-2 py-1.5 text-xs resize-none"
                            style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                            value={form.notes}
                            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
                </div>
                <button onClick={handleLog} disabled={saving || !form.ticker.trim()}
                        className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60"
                        style={{ background: "linear-gradient(90deg,#a78bfa,#7c3aed)" }}>
                  {saving ? t("diarioDecisiones.modal.saving") : t("diarioDecisiones.modal.save")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
