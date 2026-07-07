"use client";

import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PremiumBadge from "@/components/PremiumBadge";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useAuthStore, useProfileStore, useSubscriptionStore,
  useThemeStore, msgsRemaining, FREE_MSG_LIMIT, maturityLabel,
} from "@/lib/store";
import { auth as authApi, billing, feedApi, fmgApi, insights as insightsApi, mentorLetter as mentorLetterApi, notifications as notifApi, profile as profileApi, referral as referralApi, sync as syncApi, voiceCallsApi } from "@/lib/api";
import { getMentorInfo } from "@/lib/mentorData";
import PaywallModal from "@/components/PaywallModal";
import WrappedCard from "@/components/WrappedCard";
import {
  User, LogOut, X, Sun, Moon, ChevronDown, ChevronUp, Star, BarChart,
  Loader2, Copy, Check, Gift, Users, Share2, Brain, Trash2, Phone,
} from "lucide-react";
import { getUserLevel, LEVEL_COLOR, LEVEL_LABEL, LEVEL_EMOJI } from "@/lib/userLevel";

const _fmtUSD = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const DUO_METRIC_DEFS: { key: string; label: string; format: (v: any) => string }[] = [
  { key: "current_patrimonio", label: "Patrimonio actual", format: (v) => _fmtUSD(v) },
  { key: "cumulative_return_pct", label: "Retorno acumulado", format: (v) => `${v >= 0 ? "+" : ""}${v}%` },
  { key: "capital_invested", label: "Capital invertido", format: (v) => _fmtUSD(v) },
  { key: "total_operations", label: "Operaciones", format: (v) => `${v}` },
  { key: "consecutive_months_contributing", label: "Racha de meses", format: (v) => `${v}` },
  { key: "days_since_first_investment", label: "Desde su primera inversión", format: (v) => `${v} días` },
];

const LEVEL_OPTIONS = [
  { key: "B", label: "Básico",      emoji: "📚", desc: "Sin experiencia o conozco lo básico" },
  { key: "C", label: "Intermedio",  emoji: "📈", desc: "Tengo experiencia (ETFs, acciones)" },
  { key: "D", label: "Avanzado",    emoji: "⚡", desc: "Análisis financiero profundo" },
];

const RISK_LABEL: Record<string, string> = {
  conservative:           "Inversionista Conservador",
  conservative_moderate:  "Conservador-Moderado",
  moderate:               "Inversionista Moderado",
  moderate_growth:        "Moderado-Growth",
  growth:                 "Growth",
  aggressive:             "Inversionista Agresivo",
  aggressive_speculative: "Agresivo-Especulativo",
  speculative:            "Especulativo",
};

const RISK_COLOR: Record<string, string> = {
  conservative:           "#3b82f6",
  conservative_moderate:  "#22c55e",
  moderate:               "#f59e0b",
  moderate_growth:        "#f97316",
  growth:                 "#f97316",
  aggressive:             "#ef4444",
  aggressive_speculative: "#dc2626",
  speculative:            "#7c3aed",
};

const QUIZ_CATEGORIES = ["Mentalidad", "Horizonte", "Conocimiento", "Riesgo", "Comportamiento"];
const QUIZ_LABELS: Record<string, Record<string, string>> = {
  q1: { A: "Vende ante caídas", B: "Espera sin actuar", C: "Analiza y mantiene", D: "Compra las caídas" },
  q2: { A: "< 2 años", B: "3–5 años", C: "10+ años", D: "Largo plazo, sin prisa" },
  q3: { A: "Principiante", B: "Básico", C: "Intermedio", D: "Avanzado" },
  q4: { A: "$5K seguro", B: "$15K / riesgo $5K", C: "$40K / riesgo $20K", D: "$120K / riesgo total" },
  q5: { A: "Automático / pasivo", B: "Revisión mensual", C: "Revisión semanal", D: "Gestión diaria" },
};
const ANSWER_COLORS: Record<string, string> = { A: "#3b82f6", B: "#22c55e", C: "#f59e0b", D: "#ef4444" };

function riskCategory(rt: string): "conservative" | "moderate" | "aggressive" {
  if (rt.startsWith("conservative")) return "conservative";
  if (rt === "aggressive" || rt.startsWith("aggressive") || rt === "speculative") return "aggressive";
  return "moderate";
}

function getAge(birthDate: string): number {
  if (!birthDate) return 0;
  const sep = birthDate.includes("/") ? "/" : "-";
  const parts = birthDate.split(sep).map(Number);
  const [y, m, d] = sep === "-" ? parts : [parts[2], parts[1], parts[0]];
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return Math.max(0, age);
}

const riskDistributions: Record<string, { label: string; pct: number; color: string }[]> = {
  conservative: [
    { label: "Renta fija / Bonos", pct: 60, color: "#3b82f6" },
    { label: "Acciones defensivas", pct: 30, color: "#22c55e" },
    { label: "Liquidez / Oro", pct: 10, color: "#f59e0b" },
  ],
  moderate: [
    { label: "Acciones diversificadas", pct: 60, color: "#22c55e" },
    { label: "Renta fija", pct: 30, color: "#3b82f6" },
    { label: "Alternativos / REITs", pct: 10, color: "#a855f7" },
  ],
  aggressive: [
    { label: "Acciones de crecimiento", pct: 75, color: "#22c55e" },
    { label: "Mercados emergentes", pct: 15, color: "#f59e0b" },
    { label: "Renta fija mínima", pct: 10, color: "#3b82f6" },
  ],
};

const riskMetrics: Record<string, { label: string; val: string }[]> = {
  conservative: [{ label: "Volatilidad", val: "Baja" }, { label: "Retorno esperado", val: "4–7% anual" }, { label: "Horizonte ideal", val: "1–5 años" }],
  moderate:     [{ label: "Volatilidad", val: "Media" }, { label: "Retorno esperado", val: "7–10% anual" }, { label: "Horizonte ideal", val: "5–10 años" }],
  aggressive:   [{ label: "Volatilidad", val: "Alta" }, { label: "Retorno esperado", val: "10–15%+" }, { label: "Horizonte ideal", val: "10+ años" }],
};

const riskETFs: Record<string, string> = {
  conservative: "BND, AGG, SCHD, VTIP, SGOV, GLD",
  moderate:     "VTI, VEA, BND, QQQ, VNQ, SCHD",
  aggressive:   "QQQ, VTI, VGT, SOXX, VWO, ARKK",
};

export default function ProfilePage() {
  const router = useRouter();
  const { isAuthenticated, clearAuth } = useAuthStore();
  const { profile, maturityScore, maturityHistory, setProfile } = useProfileStore();
  const subStore = useSubscriptionStore();
  const { theme, toggleTheme } = useThemeStore();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [riskExpanded, setRiskExpanded] = useState(false);
  const [psyEditField, setPsyEditField] = useState<string | null>(null);
  const [savingPsy, setSavingPsy] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [letterOpen, setLetterOpen] = useState(false);
  const [letter, setLetter] = useState<string | null>(null);
  const [letterLoading, setLetterLoading] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralStats, setReferralStats] = useState<{ referred_count: number; pending_reward: string } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [copiedProfile, setCopiedProfile] = useState(false);
  const [likedClips, setLikedClips] = useState<{ id: string; title: string; thumbnail_url: string; speaker: string; duration_sec: number }[]>([]);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [insights, setInsights] = useState<{
    ready: boolean; topics?: string[]; risk_match?: boolean;
    risk_note?: string; suggestion?: string;
  } | null>(null);
  const [wrappedOpen, setWrappedOpen] = useState(false);
  const [duoEmail, setDuoEmail] = useState("");
  const [duoSaving, setDuoSaving] = useState(false);
  const [duoError, setDuoError] = useState("");
  const [duoEditing, setDuoEditing] = useState(false);
  const [duoPartner, setDuoPartner] = useState<{
    paired: boolean;
    partner_name?: string;
    my_summary?: Record<string, any>;
    partner_summary?: Record<string, any>;
  } | null>(null);

  const [fmgData, setFmgData] = useState<{
    memories: { id: string; type: string; content: string; times_reinforced: number }[];
    patterns: { id: string; pattern_key: string; description: string; confidence: number; times_observed: number; is_positive: boolean }[];
    events: { id: string; event_type: string; title: string; description?: string; occurred_at: string }[];
  } | null>(null);
  const [fmgOpen, setFmgOpen] = useState(false);

  const [voiceCalls, setVoiceCalls] = useState<{ id: string; mentor: string | null; started_at: string; duration_seconds: number }[]>([]);
  const [voiceCallsOpen, setVoiceCallsOpen] = useState(false);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const [callDetail, setCallDetail] = useState<Record<string, { role: string; text: string }[]>>({});

  const isPremium = subStore.tier === "premium" || subStore.isTrialPremium;
  const remaining = msgsRemaining(subStore);
  const mentor = getMentorInfo(profile?.mentor);
  const riskColor = profile ? (RISK_COLOR[profile.risk_tolerance] ?? "var(--accent)") : "var(--accent)";
  const riskCat = profile ? riskCategory(profile.risk_tolerance) : "moderate";
  const maturity = maturityLabel(maturityScore);

  useEffect(() => {
    insightsApi.get().then((r) => setInsights(r.data)).catch(() => {});
    notifApi.getAll().then(() => {}).catch(() => {});
    feedApi.getLiked().then((r) => setLikedClips(r.data.clips || [])).catch(() => {});
    subStore.fetchStatus().catch(() => {});
    referralApi.getCode().then((r) => setReferralCode(r.data.code ?? null)).catch(() => {});
    referralApi.getStats().then((r) => setReferralStats(r.data)).catch(() => {});
    fmgApi.getSummary().then((r) => setFmgData(r.data)).catch(() => {});
    voiceCallsApi.list().then((r) => setVoiceCalls(r.data?.calls || [])).catch(() => {});
    if (profile?.avatar_url) setAvatarUrl(profile.avatar_url);
    // Bidirectional maturity sync on every profile view
    syncApi.getAll().then((res) => {
      const serverScore: number = res.data?.maturity?.score ?? 0;
      const serverHistory = res.data?.maturity?.history ?? [];
      const { maturityScore: local, maturityHistory: localHist } = useProfileStore.getState();
      if (serverScore > local) {
        useProfileStore.setState({ maturityScore: serverScore, maturityHistory: serverHistory });
      } else if (local > serverScore) {
        syncApi.pushMaturity(local, localHist).catch(() => {});
      }
    }).catch(() => {});
  }, [isAuthenticated]);

  useEffect(() => {
    if (!subStore.duoSecondaryEmail) return;
    billing.getDuoPartner().then((r) => setDuoPartner(r.data)).catch(() => {});
  }, [subStore.duoSecondaryEmail]);

  const toggleCallExpand = async (id: string) => {
    if (expandedCallId === id) {
      setExpandedCallId(null);
      return;
    }
    setExpandedCallId(id);
    if (!callDetail[id]) {
      try {
        const res = await voiceCallsApi.get(id);
        setCallDetail((prev) => ({ ...prev, [id]: res.data.turns || [] }));
      } catch {}
    }
  };

  const handleDeleteCall = async (id: string) => {
    setVoiceCalls((prev) => prev.filter((c) => c.id !== id));
    try {
      await voiceCallsApi.delete(id);
    } catch {}
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      const localUrl = `data:image/jpeg;base64,${base64}`;
      setAvatarUrl(localUrl);
      setAvatarUploading(true);
      try {
        const res = await profileApi.uploadAvatar(base64);
        const url = res.data.avatar_url;
        setAvatarUrl(url);
        // Persist to store so sidebar and other pages see it immediately
        if (profile) setProfile({ ...profile, avatar_url: url });
      } catch {}
      setAvatarUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const openMentorLetter = async () => {
    if (letter) { setLetterOpen(true); return; }
    setLetterLoading(true);
    try {
      const r = await mentorLetterApi.get();
      setLetter(r.data.letter ?? null);
      setLetterOpen(true);
    } catch {}
    setLetterLoading(false);
  };

  const handleLogout = () => {
    if (confirm("¿Seguro que quieres cerrar sesión?")) {
      clearAuth();
      router.push("/");
    }
  };

  const [savingLevel, setSavingLevel] = useState(false);
  const handleLevelChange = async (q3Key: string) => {
    if (!profile) return;
    setSavingLevel(true);
    try {
      const updated = { ...profile, quiz_answers: { ...profile.quiz_answers, q3: q3Key } };
      await profileApi.update({ quiz_answers: updated.quiz_answers });
      setProfile(updated);
    } catch {}
    setSavingLevel(false);
  };

  const handlePsySave = async (field: string, value: string) => {
    if (!profile) return;
    setSavingPsy(true);
    try {
      let update: Record<string, unknown> = {};
      if (field === "risk_tolerance") {
        update = { risk_tolerance: value };
      } else {
        update = { quiz_answers: { ...profile.quiz_answers, [field]: value } };
      }
      await profileApi.update(update);
      setProfile({
        ...profile,
        ...(field === "risk_tolerance" ? { risk_tolerance: value } : {}),
        quiz_answers: field !== "risk_tolerance"
          ? { ...profile.quiz_answers, [field]: value }
          : profile.quiz_answers,
      });
      setPsyEditField(null);
    } catch { /* ignore */ }
    setSavingPsy(false);
  };

  const handleDeleteAccount = async () => {
    if (!confirm("Esta acción es permanente. Se borrarán todos tus datos. ¿Continuar?")) return;
    if (!confirm("¿Estás absolutamente seguro? No se puede deshacer.")) return;
    setDeletingAccount(true);
    setDeleteError(null);
    try {
      await authApi.deleteAccount();
      clearAuth();
      router.push("/");
    } catch {
      setDeleteError("No se pudo eliminar la cuenta. Intenta de nuevo o escríbenos a soporte.");
      setDeletingAccount(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

        {/* Sticky Header */}
        <div className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between border-b shrink-0"
             style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Mi cuenta</p>
            <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>Perfil</h1>
          </div>
          <div className="flex items-center gap-2">
            <PremiumBadge />
            <button onClick={toggleTheme}
                    className="w-9 h-9 flex items-center justify-center rounded-xl border transition-colors hover:border-[var(--accent)]"
                    style={{ borderColor: "var(--border)", background: "var(--raised)", color: "var(--sub)" }}>
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={handleLogout}
                    className="w-9 h-9 flex items-center justify-center rounded-xl border transition-colors hover:border-red-500/40"
                    style={{ borderColor: "var(--border)", background: "var(--raised)", color: "var(--sub)" }}>
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

      <div className="flex flex-1 overflow-hidden relative">

        {/* Main */}
        <main className="flex-1 overflow-y-auto scrollbar-thin p-4">
          <div className="max-w-2xl mx-auto space-y-4 pb-8">
            {!profile ? (
              <div className="flex flex-col items-center justify-center h-64 gap-4">
                <User className="w-16 h-16" style={{ color: "var(--dim)" }} />
                <p style={{ color: "var(--muted)" }}>No hay perfil configurado</p>
                <button onClick={() => router.push("/onboarding")}
                        className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
                        style={{ background: "var(--accent)" }}>
                  Completar onboarding
                </button>
              </div>
            ) : (
              <>
                {/* Hero card */}
                <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: riskColor + "44" }}>
                  <div className="h-16" style={{ background: riskColor }} />
                  <div className="flex flex-col items-center -mt-8 pb-4 px-5">
                    <label className="relative cursor-pointer group">
                      <div className="w-16 h-16 rounded-full border-4 flex items-center justify-center text-2xl font-black text-white overflow-hidden"
                           style={{ background: riskColor, borderColor: "var(--card)" }}>
                        {avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                        ) : avatarUploading ? (
                          <Loader2 className="w-6 h-6 animate-spin text-white" />
                        ) : (
                          profile.name.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="absolute bottom-0 right-0 w-5 h-5 rounded-full flex items-center justify-center border-2 opacity-0 group-hover:opacity-100 transition-opacity"
                           style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                        <span className="text-[9px]">📷</span>
                      </div>
                      <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} disabled={avatarUploading} />
                    </label>
                    <div className="mt-2 text-center space-y-2">
                      <div className="text-lg font-extrabold" style={{ color: "var(--text)" }}>{profile.name}</div>
                      <div className="flex flex-wrap justify-center gap-2">
                        <span className="text-xs font-bold px-2.5 py-1 rounded-full border"
                              style={{ background: riskColor + "1a", borderColor: riskColor + "55", color: riskColor }}>
                          {RISK_LABEL[profile.risk_tolerance] ?? profile.risk_tolerance}
                        </span>
                        {mentor && (
                          <span className="text-xs font-bold px-2.5 py-1 rounded-full border"
                                style={{ background: mentor.color + "1a", borderColor: mentor.color + "55", color: mentor.color }}>
                            {mentor.emoji} {mentor.name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="border-t flex" style={{ borderColor: "var(--border)" }}>
                    <button onClick={() => router.push("/profile/edit")}
                            className="flex-1 py-3 text-xs font-semibold text-center hover:bg-white/5 transition-colors border-r"
                            style={{ color: "var(--muted)", borderColor: "var(--border)" }}>
                      Editar perfil
                    </button>
                    <button
                      onClick={() => {
                        const riskLabel = RISK_LABEL[profile.risk_tolerance] ?? profile.risk_tolerance;
                        const mentorLine = mentor ? `\nMi mentor: ${mentor.emoji} ${mentor.name}` : "";
                        const maturityLine = `\nMadurez inversora: ${maturityScore}/100`;
                        const text = `Soy un/a ${riskLabel} 📊${mentorLine}${maturityLine}\n\nAprende a invertir con IA 👉 https://nuvosai.com`;
                        if (navigator.share) {
                          navigator.share({ title: "Mi perfil en Nuvos AI", text, url: "https://nuvosai.com" }).catch(() => {});
                        } else {
                          setShareOpen((v) => !v);
                        }
                      }}
                      className="flex-1 py-3 text-xs font-semibold text-center hover:bg-white/5 transition-colors flex items-center justify-center gap-1.5"
                      style={{ color: "var(--accent-l)" }}
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      Compartir perfil
                    </button>
                  </div>

                  {/* Share options panel (desktop fallback) */}
                  {shareOpen && (
                    <div className="border-t px-4 py-4" style={{ borderColor: "var(--border)" }}>
                      {(() => {
                        const riskLabel = RISK_LABEL[profile.risk_tolerance] ?? profile.risk_tolerance;
                        const mentorLine = mentor ? `\nMi mentor: ${mentor.emoji} ${mentor.name}` : "";
                        const text = encodeURIComponent(`Soy un/a ${riskLabel} 📊${mentorLine}\nMadurez inversora: ${maturityScore}/100\n\nAprende a invertir con IA 👉 https://nuvosai.com`);
                        const url = encodeURIComponent("https://nuvosai.com");
                        return (
                          <div className="space-y-3">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-center" style={{ color: "var(--dim)" }}>Compartir en</p>
                            <div className="grid grid-cols-4 gap-2">
                              {[
                                { label: "X", bg: "#000", href: `https://twitter.com/intent/tweet?text=${text}`, icon: "𝕏" },
                                { label: "WhatsApp", bg: "#25D366", href: `https://wa.me/?text=${text}`, icon: "💬" },
                                { label: "LinkedIn", bg: "#0A66C2", href: `https://www.linkedin.com/sharing/share-offsite/?url=${url}&summary=${text}`, icon: "in" },
                                { label: "Telegram", bg: "#229ED9", href: `https://t.me/share/url?url=${url}&text=${text}`, icon: "✈️" },
                              ].map(({ label, bg, href, icon }) => (
                                <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                                   className="flex flex-col items-center gap-1.5 py-3 rounded-2xl hover:opacity-80 transition-opacity"
                                   style={{ background: bg + "18", border: `1px solid ${bg}30` }}>
                                  <span className="text-lg leading-none font-black" style={{ color: bg === "#000" ? "var(--text)" : bg }}>{icon}</span>
                                  <span className="text-[9px] font-semibold" style={{ color: "var(--muted)" }}>{label}</span>
                                </a>
                              ))}
                            </div>
                            <button
                              onClick={() => {
                                const raw = `Soy un/a ${RISK_LABEL[profile.risk_tolerance] ?? profile.risk_tolerance} 📊${mentor ? `\nMi mentor: ${mentor.emoji} ${mentor.name}` : ""}\nMadurez inversora: ${maturityScore}/100\n\nAprende a invertir con IA 👉 https://nuvosai.com`;
                                navigator.clipboard.writeText(raw);
                                setCopiedProfile(true);
                                setTimeout(() => setCopiedProfile(false), 2000);
                              }}
                              className="w-full py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-colors hover:opacity-80"
                              style={{ borderColor: "var(--border)", color: copiedProfile ? "#22c55e" : "var(--muted)", background: "var(--raised)" }}
                            >
                              {copiedProfile ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                              {copiedProfile ? "¡Copiado!" : "Copiar texto"}
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* AI Insights */}
                {insights?.ready && (
                  <div className="rounded-2xl border p-4"
                       style={{ background: insights.risk_match === false ? "rgba(245,158,11,0.06)" : "var(--card)", borderColor: insights.risk_match === false ? "rgba(245,158,11,0.4)" : "rgba(34,197,94,0.4)" }}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-lg">🧠</span>
                      <span className="text-sm font-bold" style={{ color: "var(--text)" }}>La IA te ha analizado</span>
                    </div>
                    {insights.risk_match === false && insights.risk_note && (
                      <div className="rounded-xl p-3 mb-3 border" style={{ background: "rgba(245,158,11,0.1)", borderColor: "rgba(245,158,11,0.3)" }}>
                        <p className="text-xs font-bold mb-1" style={{ color: "#f59e0b" }}>⚠️ Tu comportamiento real difiere de tu perfil</p>
                        <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{insights.risk_note}</p>
                      </div>
                    )}
                    {insights.suggestion && (
                      <p className="text-sm leading-relaxed mb-3" style={{ color: "var(--sub)" }}>{insights.suggestion}</p>
                    )}
                    {insights.topics && insights.topics.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {insights.topics.map((t) => (
                          <span key={t} className="text-xs px-2.5 py-1 rounded-full border font-semibold"
                                style={{ background: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)", color: "#22c55e" }}>
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Datos personales */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>Datos personales</p>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Edad", value: String(getAge(profile.birth_date)), sub: "años", color: "#3b82f6" },
                      { label: "Ingresos", value: `$${Number(profile.monthly_income).toLocaleString()}`, sub: "/mes", color: "#22c55e" },
                      { label: "Aportación", value: `$${Number(profile.monthly_contribution).toLocaleString()}`, sub: "/mes", color: riskColor },
                    ].map((item) => (
                      <div key={item.label} className="rounded-2xl border p-3" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-2" style={{ background: item.color + "18" }}>
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: item.color }} />
                        </div>
                        <div className="text-xl font-extrabold leading-tight" style={{ color: "var(--text)" }}>{item.value}</div>
                        <div className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>{item.sub} · {item.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Perfil de riesgo */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>Perfil de riesgo</p>
                  <button onClick={() => setRiskExpanded((v) => !v)}
                          className="w-full text-left rounded-2xl border p-4 transition-colors hover:opacity-90"
                          style={{ background: "var(--card)", borderColor: riskColor + "55" }}>
                    <div className="flex items-start gap-3 mb-4">
                      <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: riskColor + "18" }}>
                        <BarChart className="w-6 h-6" style={{ color: riskColor }} />
                      </div>
                      <div className="flex-1">
                        <div className="font-bold text-base" style={{ color: "var(--text)" }}>{RISK_LABEL[profile.risk_tolerance] ?? profile.risk_tolerance}</div>
                        <div className="text-xs mt-1 leading-relaxed" style={{ color: "var(--muted)" }}>
                          {riskCat === "conservative" ? "Priorizas la seguridad y la preservación del capital."
                            : riskCat === "moderate" ? "Buscas equilibrio entre crecimiento y protección."
                            : "Tu objetivo es el máximo crecimiento a largo plazo."}
                        </div>
                      </div>
                      {riskExpanded
                        ? <ChevronUp className="w-4 h-4 shrink-0 mt-1" style={{ color: "var(--dim)" }} />
                        : <ChevronDown className="w-4 h-4 shrink-0 mt-1" style={{ color: "var(--dim)" }} />}
                    </div>
                    <div className="flex gap-1.5 mb-1">
                      {(["conservative", "moderate", "aggressive"] as const).map((key) => (
                        <div key={key} className="flex-1 rounded-full"
                             style={{ height: key === riskCat ? 8 : 5, background: key === riskCat ? riskColor : "var(--border)" }} />
                      ))}
                    </div>
                    <div className="flex justify-between text-[9px]" style={{ color: "var(--dim)" }}>
                      <span>Conservador</span><span>Moderado</span><span>Agresivo</span>
                    </div>
                    {riskExpanded && (
                      <div className="mt-4 pt-4 border-t space-y-3" style={{ borderColor: riskColor + "25" }}>
                        <div className="space-y-2">
                          {(riskDistributions[riskCat] ?? riskDistributions.moderate).map((item) => (
                            <div key={item.label}>
                              <div className="flex justify-between text-xs mb-1">
                                <span style={{ color: "var(--sub)" }}>{item.label}</span>
                                <span className="font-bold" style={{ color: item.color }}>{item.pct}%</span>
                              </div>
                              <div className="h-1 rounded-full" style={{ background: "var(--border)" }}>
                                <div className="h-1 rounded-full" style={{ width: `${item.pct}%`, background: item.color }} />
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          {(riskMetrics[riskCat] ?? riskMetrics.moderate).map((m) => (
                            <div key={m.label} className="flex-1 rounded-xl p-2 text-center" style={{ background: riskColor + "10" }}>
                              <div className="text-[9px] font-semibold mb-1" style={{ color: "var(--muted)" }}>{m.label}</div>
                              <div className="text-xs font-bold" style={{ color: riskColor }}>{m.val}</div>
                            </div>
                          ))}
                        </div>
                        <p className="text-xs" style={{ color: "var(--muted)" }}>
                          <span className="font-bold" style={{ color: "var(--sub)" }}>ETFs típicos: </span>
                          {riskETFs[riskCat]}
                        </p>
                      </div>
                    )}
                  </button>
                </div>

                {/* Madurez inversora */}
                <div>
                  <div className="flex items-baseline gap-2 mb-2 ml-0.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--dim)" }}>Madurez Inversora</p>
                    <p className="text-[9px] italic" style={{ color: "var(--dim)" }}>comportamiento en la app</p>
                  </div>
                  <div className="rounded-2xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="text-5xl font-black leading-none" style={{ color: maturity.color }}>
                          {maturityScore}<span className="text-xl font-normal ml-1" style={{ color: "var(--muted)" }}>/100</span>
                        </div>
                        <span className="inline-block mt-2 text-xs font-bold px-2.5 py-1 rounded-full border"
                              style={{ background: maturity.color + "18", borderColor: maturity.color + "40", color: maturity.color }}>
                          {maturity.label}
                        </span>
                      </div>
                      <div className="w-14 h-14 rounded-full border-2 flex items-center justify-center"
                           style={{ borderColor: maturity.color + "40", background: maturity.color + "0e" }}>
                        <BarChart className="w-7 h-7" style={{ color: maturity.color }} />
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full mb-1.5 overflow-hidden" style={{ background: "var(--border)" }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${maturityScore}%`, background: maturity.color }} />
                    </div>
                    <div className="flex justify-between text-[9px]" style={{ color: "var(--dim)" }}>
                      <span>Pasivo</span><span>Racional</span><span>Especulativo</span>
                    </div>
                    <p className="text-[10px] mt-2 leading-relaxed" style={{ color: "var(--dim)" }}>
                      Sube con cada buena decisión en la app (mantener calma, diversificar, largo plazo).
                    </p>
                    {maturityHistory.length > 0 && (
                      <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
                        <p className="text-[9px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>Últimas señales</p>
                        {maturityHistory.slice(-5).reverse().map((ev, i) => (
                          <div key={i} className={`flex items-center gap-2 py-1.5 ${i > 0 ? "border-t" : ""}`}
                               style={{ borderColor: "var(--border)" }}>
                            <span className="text-xs font-bold px-1.5 py-0.5 rounded"
                                  style={{ background: ev.delta >= 0 ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)", color: ev.delta >= 0 ? "#22c55e" : "#ef4444" }}>
                              {ev.delta >= 0 ? "+" : ""}{ev.delta}
                            </span>
                            <span className="text-xs flex-1 truncate" style={{ color: "var(--sub)" }}>
                              {ev.signals.map((s) => s.replace(/_/g, " ")).join(", ")}
                            </span>
                            <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>{ev.newScore}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Mentor card */}
                {mentor && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>Tu mentor</p>
                    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: mentor.color + "40" }}>
                      <div className="flex items-center gap-4 p-4" style={{ background: mentor.color + "0d" }}>
                        <div className="w-16 h-16 rounded-full flex items-center justify-center text-4xl shrink-0"
                             style={{ background: mentor.color + "22" }}>
                          {mentor.emoji}
                        </div>
                        <div className="flex-1">
                          <div className="font-bold text-base" style={{ color: "var(--text)" }}>{mentor.name}</div>
                          <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{mentor.title}</div>
                          <span className="inline-block mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded border"
                                style={{ background: mentor.color + "22", borderColor: mentor.color + "40", color: mentor.color }}>
                            {mentor.badge}
                          </span>
                        </div>
                      </div>
                      <div className="p-3 space-y-2" style={{ background: "var(--card)" }}>
                        {mentor.principles.map((p, i) => (
                          <div key={i} className="flex items-center gap-3 rounded-xl border px-3 py-2"
                               style={{ borderColor: mentor.color + "30", background: mentor.color + "08" }}>
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: mentor.color }} />
                            <span className="text-sm" style={{ color: "var(--sub)" }}>{p}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Mentor letter */}
                    <button onClick={openMentorLetter}
                            className="w-full mt-2 flex items-center gap-3 rounded-2xl border p-4 hover:opacity-80 transition-opacity"
                            style={{ background: mentor.color + "0a", borderColor: mentor.color + "35" }}>
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                           style={{ background: mentor.color + "20" }}>
                        {letterLoading
                          ? <Loader2 className="w-5 h-5 animate-spin" style={{ color: mentor.color }} />
                          : <span className="text-xl">✉️</span>}
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-sm font-bold" style={{ color: "var(--text)" }}>Carta de {mentor.name.split(" ")[0]}</div>
                        <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>Tu carta mensual personalizada</div>
                      </div>
                      <ChevronDown className="w-4 h-4 shrink-0" style={{ color: mentor.color }} />
                    </button>
                  </div>
                )}

                {/* ── Nivel de conocimiento ── */}
                {(() => {
                  const currentLevel = getUserLevel(profile);
                  const currentQ3 = profile.quiz_answers?.q3 as string | undefined;
                  return (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>
                        Nivel de conocimiento
                      </p>
                      <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                        <div className="px-4 pt-4 pb-3">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-2xl">{LEVEL_EMOJI[currentLevel]}</span>
                            <div>
                              <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{LEVEL_LABEL[currentLevel]}</p>
                              <p className="text-xs" style={{ color: "var(--muted)" }}>
                                {currentLevel === "basico" ? "La app te guía paso a paso" : currentLevel === "intermedio" ? "Contenido equilibrado" : "Análisis avanzado desbloqueado"}
                              </p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {LEVEL_OPTIONS.map(({ key, label, emoji, desc }) => {
                              const isActive = currentQ3 === key || (!currentQ3 && key === "C");
                              const lc = LEVEL_COLOR[key === "B" ? "basico" : key === "C" ? "intermedio" : "avanzado"];
                              return (
                                <button key={key}
                                        onClick={() => handleLevelChange(key)}
                                        disabled={savingLevel}
                                        className="flex items-start gap-2.5 p-3 rounded-xl border-2 text-left transition-all hover:opacity-90 disabled:opacity-50"
                                        style={{
                                          borderColor: isActive ? lc : "var(--border)",
                                          background: isActive ? `${lc}12` : "var(--raised)",
                                        }}>
                                  <span className="text-lg shrink-0 mt-0.5">{emoji}</span>
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold leading-tight" style={{ color: isActive ? lc : "var(--text)" }}>{label}</p>
                                    <p className="text-[10px] leading-tight mt-0.5" style={{ color: "var(--dim)" }}>{desc}</p>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                          {savingLevel && (
                            <p className="text-[10px] mt-2 text-center" style={{ color: "var(--muted)" }}>Guardando...</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Perfil psicológico */}
                <div>
                  <div className="flex items-center gap-2 mb-2 ml-0.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--dim)" }}>Perfil psicológico</p>
                    {savingPsy && <div className="w-3 h-3 border border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--accent-l)", borderTopColor: "transparent" }} />}
                  </div>
                  <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                    {[
                      { key: "q2", icon: "🕐", label: "Horizonte de inversión", color: "#22c55e",
                        value: profile.quiz_answers?.q2 as string | undefined },
                      { key: "rt", icon: "🧠", label: "Comportamiento", color:
                          (profile.risk_tolerance ?? "").startsWith("conservative") ? "#3b82f6"
                          : (profile.risk_tolerance ?? "").startsWith("aggressive") || profile.risk_tolerance === "speculative" ? "#ef4444"
                          : "#f59e0b",
                        value: (profile.risk_tolerance ?? "").startsWith("conservative") ? "conservative"
                          : (profile.risk_tolerance ?? "").startsWith("aggressive") || profile.risk_tolerance === "speculative" ? "aggressive"
                          : "moderate",
                        displayOverride: (profile.risk_tolerance ?? "").startsWith("conservative") ? "Conservador"
                          : (profile.risk_tolerance ?? "").startsWith("aggressive") || profile.risk_tolerance === "speculative" ? "Agresivo"
                          : "Moderado",
                      },
                      { key: "q1", icon: "📉", label: "Reacción ante caídas", color: "#ef4444",
                        value: profile.quiz_answers?.q1 as string | undefined },
                      { key: "q5", icon: "⚙️", label: "Seguimiento del mercado", color: "#3b82f6",
                        value: profile.quiz_answers?.q5 as string | undefined },
                    ].map((row, idx) => {
                      const displayText = row.displayOverride ?? (row.value ? QUIZ_LABELS[row.key]?.[row.value] : null);
                      return (
                        <button key={row.key} onClick={() => setPsyEditField(row.key)}
                          className={`w-full flex items-center gap-3 px-4 py-3.5 text-left hover:opacity-80 transition-opacity${idx > 0 ? " border-t" : ""}`}
                          style={{ borderColor: "var(--border)" }}>
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-base"
                               style={{ background: row.color + "18" }}>
                            {row.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[9px] font-bold uppercase tracking-wider mb-0.5" style={{ color: "var(--dim)" }}>{row.label}</div>
                            <div className="text-sm font-semibold truncate" style={{ color: displayText ? "var(--text)" : "var(--dim)" }}>
                              {displayText ?? "No completado"}
                            </div>
                          </div>
                          <span className="text-xs font-bold px-2.5 py-1 rounded-full shrink-0"
                                style={displayText
                                  ? { background: row.color + "18", color: row.color, border: `1px solid ${row.color}44` }
                                  : { background: "rgba(251,191,36,0.12)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)" }}>
                            {displayText ?? "Completar"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Modal edición perfil psicológico */}
                {psyEditField && (
                  <div className="fixed inset-0 z-50 flex items-end justify-center"
                       style={{ background: "rgba(0,0,0,0.6)" }}
                       onClick={() => setPsyEditField(null)}>
                    <div className="w-full max-w-lg rounded-t-3xl p-6 pb-10 space-y-3"
                         style={{ background: "var(--card)" }}
                         onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-extrabold text-base" style={{ color: "var(--text)" }}>
                          {psyEditField === "q2" ? "¿Cuál es tu horizonte de inversión?"
                            : psyEditField === "rt" ? "¿Cuál es tu comportamiento inversor?"
                            : psyEditField === "q1" ? "¿Qué haces cuando tu portafolio cae?"
                            : "¿Con qué frecuencia revisas el mercado?"}
                        </p>
                        <button onClick={() => setPsyEditField(null)} className="p-1 rounded-full hover:opacity-70">
                          <X className="w-5 h-5" style={{ color: "var(--muted)" }} />
                        </button>
                      </div>
                      <p className="text-xs mb-2" style={{ color: "var(--muted)" }}>Toca una opción para guardar automáticamente</p>

                      {psyEditField !== "rt" && Object.entries(QUIZ_LABELS[psyEditField] ?? {}).map(([key, text]) => {
                        const currentVal = profile.quiz_answers?.[psyEditField] as string | undefined;
                        const active = currentVal === key;
                        const color = active ? "#22c55e" : undefined;
                        return (
                          <button key={key} onClick={() => handlePsySave(psyEditField, key)} disabled={savingPsy}
                            className="w-full flex items-center gap-3 p-3.5 rounded-2xl border-2 text-left transition-all hover:opacity-90 disabled:opacity-50"
                            style={{ borderColor: active ? "#22c55e" : "var(--border)", background: active ? "rgba(34,197,94,0.1)" : "var(--raised)" }}>
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black shrink-0"
                                 style={{ background: active ? "#22c55e" : "var(--border)", color: active ? "#fff" : "var(--muted)" }}>
                              {key}
                            </div>
                            <span className="flex-1 text-sm font-semibold" style={{ color: color ?? "var(--text)" }}>{text}</span>
                            {active && <Check className="w-4 h-4 shrink-0" style={{ color: "#22c55e" }} />}
                          </button>
                        );
                      })}

                      {psyEditField === "rt" && [
                        { key: "conservative", label: "Conservador", color: "#3b82f6", desc: "Priorizo no perder dinero sobre ganar" },
                        { key: "moderate",     label: "Moderado",    color: "#f59e0b", desc: "Balance entre crecimiento y estabilidad" },
                        { key: "aggressive",   label: "Agresivo",    color: "#ef4444", desc: "Acepto alta volatilidad buscando mayor retorno" },
                      ].map(({ key, label, color, desc }) => {
                        const cat = (profile.risk_tolerance ?? "").startsWith("conservative") ? "conservative"
                          : (profile.risk_tolerance ?? "").startsWith("aggressive") || profile.risk_tolerance === "speculative" ? "aggressive" : "moderate";
                        const active = cat === key;
                        return (
                          <button key={key} onClick={() => handlePsySave("risk_tolerance", key)} disabled={savingPsy}
                            className="w-full flex items-center gap-3 p-3.5 rounded-2xl border-2 text-left transition-all hover:opacity-90 disabled:opacity-50"
                            style={{ borderColor: active ? color : "var(--border)", background: active ? color + "12" : "var(--raised)" }}>
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black shrink-0"
                                 style={{ background: active ? color : color + "30", color: active ? "#fff" : color }}>
                              {key === "conservative" ? "C" : key === "moderate" ? "M" : "A"}
                            </div>
                            <div className="flex-1">
                              <div className="text-sm font-bold" style={{ color: active ? color : "var(--text)" }}>{label}</div>
                              <div className="text-xs" style={{ color: "var(--muted)" }}>{desc}</div>
                            </div>
                            {active && <Check className="w-4 h-4 shrink-0" style={{ color }} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Suscripción */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>Suscripción</p>
                  {isPremium ? (
                    <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "rgba(245,158,11,0.5)" }}>
                      <div className="h-0.5" style={{ background: "#f59e0b" }} />
                      <div className="flex items-center gap-3 p-4">
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "rgba(245,158,11,0.15)" }}>
                          <Star className="w-6 h-6 fill-current" style={{ color: "#f59e0b" }} />
                        </div>
                        <div className="flex-1">
                          <div className="font-bold" style={{ color: "var(--text)" }}>Nuvos AI Premium</div>
                          <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>Acceso completo · Mensajes ilimitados</div>
                        </div>
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold"
                             style={{ background: "rgba(34,197,94,0.15)", borderColor: "rgba(34,197,94,0.4)", color: "#22c55e" }}>
                          <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                          Activo
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                      <div className="flex items-center gap-3 p-4">
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "var(--raised)" }}>
                          <User className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
                        </div>
                        <div className="flex-1">
                          <div className="font-bold" style={{ color: "var(--text)" }}>Plan Gratis</div>
                          <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                            {remaining === Infinity ? FREE_MSG_LIMIT : remaining}/{FREE_MSG_LIMIT} mensajes hoy
                          </div>
                        </div>
                      </div>
                      <div className="h-1 mx-4 rounded-full mb-3 overflow-hidden" style={{ background: "var(--border)" }}>
                        <div className="h-full rounded-full" style={{
                          width: `${Math.round(((FREE_MSG_LIMIT - (remaining === Infinity ? 0 : remaining)) / FREE_MSG_LIMIT) * 100)}%`,
                          background: remaining < 5 ? "#ef4444" : "var(--accent)",
                        }} />
                      </div>
                      <button onClick={() => setPaywallOpen(true)}
                              className="mx-4 mb-4 w-[calc(100%-2rem)] py-3 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2"
                              style={{ background: "linear-gradient(90deg, #f59e0b, #f97316)" }}>
                        <Star className="w-4 h-4 fill-current" />
                        Activar Premium — $10.33/mes
                      </button>
                    </div>
                  )}
                </div>

                {/* Plan Dúo — secondary account management */}
                {isPremium && (subStore.duoSetupPending || subStore.duoSecondaryEmail) && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>Plan Dúo</p>
                    <div className="rounded-2xl border p-4 flex flex-col gap-3" style={{ background: "var(--card)", borderColor: "rgba(59,130,246,0.4)" }}>
                      <div className="flex items-center gap-2">
                        <span className="text-lg">👫</span>
                        <div className="flex-1">
                          <p className="text-sm font-bold" style={{ color: "var(--text)" }}>Cuenta secundaria</p>
                          <p className="text-xs" style={{ color: "var(--muted)" }}>
                            {subStore.duoSecondaryEmail
                              ? `Compartiendo con ${subStore.duoSecondaryEmail}`
                              : "Aún no has agregado la segunda cuenta"}
                          </p>
                        </div>
                        {subStore.duoSecondaryEmail && !duoEditing && (
                          <button
                            onClick={() => { setDuoEmail(subStore.duoSecondaryEmail ?? ""); setDuoEditing(true); setDuoError(""); }}
                            className="text-xs font-bold px-3 py-1.5 rounded-xl"
                            style={{ background: "rgba(59,130,246,0.12)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.3)" }}
                          >
                            Editar
                          </button>
                        )}
                      </div>

                      {(duoEditing || !subStore.duoSecondaryEmail) && (
                        <div className="flex flex-col gap-2">
                          <input
                            type="email"
                            placeholder="email@ejemplo.com"
                            value={duoEmail}
                            onChange={(e) => { setDuoEmail(e.target.value); setDuoError(""); }}
                            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                            style={{
                              background: "var(--raised)",
                              border: `1px solid ${duoEmail.includes("@") ? "rgba(59,130,246,0.5)" : "var(--border)"}`,
                              color: "var(--text)",
                            }}
                          />
                          {duoError && <p className="text-xs" style={{ color: "#f87171" }}>⚠️ {duoError}</p>}
                          <div className="flex gap-2">
                            {duoEditing && (
                              <button
                                onClick={() => { setDuoEditing(false); setDuoError(""); }}
                                className="flex-1 py-2.5 rounded-xl text-sm font-bold"
                                style={{ background: "var(--raised)", color: "var(--muted)", border: "1px solid var(--border)" }}
                              >
                                Cancelar
                              </button>
                            )}
                            <button
                              disabled={duoSaving || !duoEmail.includes("@")}
                              onClick={async () => {
                                setDuoSaving(true); setDuoError("");
                                try {
                                  await billing.duoSetup(duoEmail);
                                  await subStore.fetchStatus();
                                  setDuoEditing(false);
                                } catch (err: any) {
                                  setDuoError(err?.response?.data?.detail ?? "Error al guardar. Intenta de nuevo.");
                                } finally { setDuoSaving(false); }
                              }}
                              className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white"
                              style={{
                                background: duoSaving || !duoEmail.includes("@") ? "rgba(59,130,246,0.2)" : "#3b82f6",
                                color: duoSaving || !duoEmail.includes("@") ? "var(--muted)" : "#fff",
                              }}
                            >
                              {duoSaving ? "Guardando..." : "Guardar"}
                            </button>
                          </div>
                        </div>
                      )}

                      {duoPartner?.paired && (
                        <div className="pt-3 mt-1 border-t" style={{ borderColor: "var(--border)" }}>
                          <p className="text-xs font-bold mb-2" style={{ color: "var(--text)" }}>
                            Comparar progreso con {duoPartner.partner_name}
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            <p className="text-[10px] font-bold uppercase" style={{ color: "var(--muted)" }}>Tú</p>
                            <p className="text-[10px] font-bold uppercase" style={{ color: "var(--muted)" }}>{duoPartner.partner_name}</p>
                            {DUO_METRIC_DEFS.map((m) => {
                              const mine = duoPartner.my_summary?.[m.key];
                              const theirs = duoPartner.partner_summary?.[m.key];
                              if (mine === undefined && theirs === undefined) return null;
                              return (
                                <div key={m.key} className="contents">
                                  <div className="rounded-lg p-2" style={{ background: "var(--raised)" }}>
                                    <p className="text-[9px]" style={{ color: "var(--muted)" }}>{m.label}</p>
                                    <p className="text-xs font-black" style={{ color: "var(--text)" }}>
                                      {mine !== undefined ? m.format(mine) : "—"}
                                    </p>
                                  </div>
                                  <div className="rounded-lg p-2" style={{ background: "var(--raised)" }}>
                                    <p className="text-[9px]" style={{ color: "var(--muted)" }}>{m.label}</p>
                                    <p className="text-xs font-black" style={{ color: "var(--text)" }}>
                                      {theirs !== undefined ? m.format(theirs) : "—"}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Mis llamadas — voice call transcripts */}
                {voiceCalls.length > 0 && (
                  <div>
                    <button
                      onClick={() => setVoiceCallsOpen((v) => !v)}
                      className="w-full flex items-center justify-between mb-2"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-widest ml-0.5" style={{ color: "var(--dim)" }}>
                        Mis llamadas ({voiceCalls.length})
                      </p>
                      {voiceCallsOpen ? <ChevronUp className="w-4 h-4" style={{ color: "var(--muted)" }} /> : <ChevronDown className="w-4 h-4" style={{ color: "var(--muted)" }} />}
                    </button>
                    {voiceCallsOpen && (
                      <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                        {voiceCalls.map((call, i) => {
                          const date = new Date(call.started_at);
                          const dateStr = date.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
                          const timeStr = date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
                          const mins = Math.floor(call.duration_seconds / 60);
                          const secs = call.duration_seconds % 60;
                          const isOpen = expandedCallId === call.id;
                          return (
                            <div key={call.id} style={{ borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                              <button
                                onClick={() => toggleCallExpand(call.id)}
                                className="w-full flex items-center gap-3 p-4 text-left"
                              >
                                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(0,185,109,0.12)" }}>
                                  <Phone className="w-4 h-4" style={{ color: "var(--accent)" }} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{dateStr} · {timeStr}</p>
                                  <p className="text-xs" style={{ color: "var(--muted)" }}>{mins}:{String(secs).padStart(2, "0")} min</p>
                                </div>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDeleteCall(call.id); }}
                                  className="p-1.5 rounded-lg"
                                  style={{ color: "var(--dim)" }}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                                {isOpen ? <ChevronUp className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} /> : <ChevronDown className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />}
                              </button>
                              {isOpen && (
                                <div className="px-4 pb-4 flex flex-col gap-2">
                                  {(callDetail[call.id] || []).length === 0 ? (
                                    <p className="text-xs" style={{ color: "var(--dim)" }}>Cargando...</p>
                                  ) : (
                                    callDetail[call.id].map((turn, idx) => (
                                      <div
                                        key={idx}
                                        className="rounded-xl px-3 py-2 text-xs max-w-[85%]"
                                        style={{
                                          background: turn.role === "user" ? "var(--raised)" : "rgba(0,185,109,0.08)",
                                          color: "var(--text)",
                                          alignSelf: turn.role === "user" ? "flex-end" : "flex-start",
                                        }}
                                      >
                                        {turn.text}
                                      </div>
                                    ))
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Referral program */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>Programa de referidos</p>
                  <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "rgba(245,158,11,0.3)" }}>
                    {/* Header */}
                    <div className="p-4 border-b" style={{ borderColor: "var(--border)", background: "linear-gradient(135deg, rgba(245,158,11,0.06) 0%, rgba(251,191,36,0.04) 100%)" }}>
                      <div className="flex items-center gap-3 mb-1">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(245,158,11,0.15)" }}>
                          <Gift className="w-5 h-5" style={{ color: "#f59e0b" }} />
                        </div>
                        <div>
                          <div className="font-bold text-sm" style={{ color: "var(--text)" }}>Invita amigos, gana recompensas</div>
                          <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>1 mes Premium gratis por cada amigo que se una</div>
                        </div>
                      </div>
                    </div>

                    {/* Stats */}
                    {referralStats && (
                      <div className="flex border-b" style={{ borderColor: "var(--border)" }}>
                        <div className="flex-1 flex flex-col items-center py-3">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <Users className="w-3.5 h-3.5" style={{ color: "#f59e0b" }} />
                            <span className="text-xl font-black" style={{ color: "#f59e0b" }}>{referralStats.referred_count}</span>
                          </div>
                          <span className="text-[10px]" style={{ color: "var(--muted)" }}>Amigos referidos</span>
                        </div>
                        <div className="w-px" style={{ background: "var(--border)" }} />
                        <div className="flex-1 flex flex-col items-center py-3">
                          <span className="text-xl font-black" style={{ color: "#22c55e" }}>{referralStats.pending_reward || "—"}</span>
                          <span className="text-[10px]" style={{ color: "var(--muted)" }}>Recompensa pendiente</span>
                        </div>
                      </div>
                    )}

                    {/* Link + copy */}
                    <div className="p-4 space-y-3">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>Tu enlace de referido</div>
                        <div className="flex items-center gap-2 rounded-xl border px-3 py-2.5" style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
                          <span className="flex-1 text-xs truncate font-mono" style={{ color: "var(--sub)" }}>
                            {referralCode ? `nuvosai.com/join?ref=${referralCode}` : "Cargando..."}
                          </span>
                          <button
                            onClick={() => {
                              if (!referralCode) return;
                              navigator.clipboard.writeText(`https://nuvosai.com/join?ref=${referralCode}`);
                              setCopiedLink(true);
                              setTimeout(() => setCopiedLink(false), 2000);
                            }}
                            className="shrink-0 p-1.5 rounded-lg transition-colors hover:opacity-70"
                            style={{ color: copiedLink ? "#22c55e" : "var(--muted)" }}
                          >
                            {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          if (!referralCode) return;
                          const text = `Estoy usando Nuvos AI — el mejor mentor de inversiones con IA. Únete gratis 👉 https://nuvosai.com/join?ref=${referralCode}`;
                          if (navigator.share) {
                            navigator.share({ title: "Nuvos AI", text, url: `https://nuvosai.com/join?ref=${referralCode}` }).catch(() => {});
                          } else {
                            navigator.clipboard.writeText(text);
                            setCopiedLink(true);
                            setTimeout(() => setCopiedLink(false), 2000);
                          }
                        }}
                        className="w-full py-3 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-opacity hover:opacity-80"
                        style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b" }}
                      >
                        <Gift className="w-4 h-4" />
                        Compartir invitación
                      </button>

                      <p className="text-[10px] text-center leading-relaxed" style={{ color: "var(--dim)" }}>
                        Tu amigo obtiene 7 días Premium gratis al registrarse. Tú recibes 1 mes Premium cuando activa su plan.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Videos con like */}
                {likedClips.length > 0 && (
                  <div>
                    <p className="text-xs font-bold mb-3 flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
                      ❤️ VIDEOS QUE TE GUSTARON
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-normal"
                            style={{ background: "var(--raised)", color: "var(--dim)" }}>
                        {likedClips.length}
                      </span>
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {likedClips.map((clip) => (
                        <a key={clip.id} href={`/feed?clip=${clip.id}`}
                           className="rounded-xl overflow-hidden block group"
                           style={{ border: "1px solid var(--border)" }}>
                          <div className="relative aspect-video flex items-center justify-center"
                               style={{ background: "var(--raised)" }}>
                            {clip.thumbnail_url
                              ? <img src={clip.thumbnail_url} alt={clip.title}
                                     className="w-full h-full object-cover" />
                              : <span className="text-2xl">🎬</span>}
                            {clip.duration_sec > 0 && (
                              <span className="absolute bottom-1 right-1 text-[9px] font-bold px-1 rounded"
                                    style={{ background: "rgba(0,0,0,0.7)", color: "white" }}>
                                {clip.duration_sec}s
                              </span>
                            )}
                          </div>
                          <div className="p-1.5">
                            <p className="text-[10px] font-semibold leading-tight line-clamp-2"
                               style={{ color: "var(--text)" }}>{clip.title}</p>
                            <p className="text-[9px] mt-0.5" style={{ color: "var(--muted)" }}>
                              {clip.speaker.split(" ")[1] ?? clip.speaker}
                            </p>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Nuvos Wrapped */}
                <button
                  onClick={() => setWrappedOpen(true)}
                  className="w-full flex items-center gap-3 p-4 rounded-2xl text-left transition-all hover:scale-[1.01] active:scale-[0.99]"
                  style={{ background: "linear-gradient(135deg, #00d47e18, #00d47e0a)", border: "1px solid #00d47e30" }}
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ background: "#00d47e18" }}>✨</div>
                  <div className="flex-1">
                    <p className="text-sm font-black" style={{ color: "var(--text)" }}>Annual ScoreBoard {new Date().getFullYear()}</p>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>Tu año como inversor en Nuvos AI</p>
                  </div>
                  <p className="text-xs font-black shrink-0" style={{ color: "#00d47e" }}>Ver →</p>
                </button>

                {/* Financial Memory Graph */}
                <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                  <button
                    onClick={() => setFmgOpen((v) => !v)}
                    className="w-full flex items-center gap-3 p-4 text-left transition-opacity hover:opacity-80"
                    style={{ background: "var(--surface)" }}
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#7c3aed18" }}>
                      <Brain className="w-5 h-5" style={{ color: "#7c3aed" }} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-black" style={{ color: "var(--text)" }}>Mi Memoria Financiera</p>
                      <p className="text-xs" style={{ color: "var(--muted)" }}>
                        {fmgData
                          ? isPremium
                            ? `${fmgData.memories.length} aprendizajes · ${fmgData.patterns.length} patrones`
                            : `${fmgData.memories.length}/10 creencias guardadas`
                          : "Lo que Nuvos recuerda de ti"}
                      </p>
                    </div>
                    <ChevronDown className="w-4 h-4 shrink-0 transition-transform" style={{ color: "var(--muted)", transform: fmgOpen ? "rotate(180deg)" : "rotate(0deg)" }} />
                  </button>

                  {fmgOpen && (
                    <div className="border-t p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
                      {!fmgData ? (
                        <p className="text-xs text-center py-4" style={{ color: "var(--muted)" }}>Cargando...</p>
                      ) : fmgData.memories.length === 0 ? (
                        <p className="text-xs text-center py-4" style={{ color: "var(--muted)" }}>Aún no hay aprendizajes. Conversa con tu mentor para que empiece a recordar.</p>
                      ) : (
                        <>
                          {/* Memories */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "#7c3aed" }}>Aprendizajes</p>
                              {!isPremium && (
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "#7c3aed18", color: "#7c3aed" }}>
                                  {fmgData.memories.length}/10
                                </span>
                              )}
                            </div>
                            <div className="space-y-2">
                              {fmgData.memories.slice(0, isPremium ? 50 : 10).map((m) => (
                                <div key={m.id} className="flex items-start gap-2 p-2 rounded-xl" style={{ background: "var(--surface)" }}>
                                  <span className="text-xs mt-0.5 shrink-0 px-1.5 py-0.5 rounded-md font-semibold" style={{ background: "#7c3aed18", color: "#7c3aed" }}>{m.type}</span>
                                  <p className="text-xs flex-1 leading-relaxed" style={{ color: "var(--text)" }}>{m.content}</p>
                                  {isPremium && (
                                    <button
                                      onClick={() => fmgApi.deleteMemory(m.id).then(() => setFmgData((d) => d ? { ...d, memories: d.memories.filter((x) => x.id !== m.id) } : d)).catch(() => {})}
                                      className="shrink-0 hover:opacity-70 transition-opacity"
                                    >
                                      <Trash2 className="w-3 h-3" style={{ color: "var(--dim)" }} />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Patterns — premium only */}
                          {isPremium ? (
                            fmgData.patterns.length > 0 && (
                              <div>
                                <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "#f59e0b" }}>Patrones de comportamiento</p>
                                <div className="space-y-2">
                                  {fmgData.patterns.map((p) => (
                                    <div key={p.id} className="p-2 rounded-xl" style={{ background: "var(--surface)" }}>
                                      <div className="flex items-center justify-between mb-1">
                                        <p className="text-xs font-semibold" style={{ color: p.is_positive ? "#22c55e" : "#f59e0b" }}>{p.description}</p>
                                        <span className="text-xs font-bold" style={{ color: "var(--muted)" }}>{Math.round(p.confidence * 100)}%</span>
                                      </div>
                                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                                        <div className="h-full rounded-full transition-all" style={{ width: `${p.confidence * 100}%`, background: p.is_positive ? "#22c55e" : "#f59e0b" }} />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          ) : (
                            <button
                              onClick={() => setPaywallOpen(true)}
                              className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-opacity hover:opacity-80"
                              style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.25)" }}
                            >
                              <Star className="w-4 h-4 shrink-0" style={{ color: "#f59e0b" }} />
                              <div className="flex-1">
                                <p className="text-xs font-bold" style={{ color: "#f59e0b" }}>Patrones de comportamiento</p>
                                <p className="text-xs" style={{ color: "var(--muted)" }}>Descubre cómo piensas como inversionista — Premium</p>
                              </div>
                              <ChevronDown className="w-3 h-3 -rotate-90 shrink-0" style={{ color: "#f59e0b" }} />
                            </button>
                          )}

                          {/* Timeline — premium only */}
                          {isPremium ? (
                            fmgData.events.length > 0 && (
                              <div>
                                <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "#3b82f6" }}>Timeline</p>
                                <div className="space-y-2">
                                  {fmgData.events.slice(0, 5).map((e) => (
                                    <div key={e.id} className="flex items-start gap-2">
                                      <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: "#3b82f6" }} />
                                      <div>
                                        <p className="text-xs font-semibold" style={{ color: "var(--text)" }}>{e.title}</p>
                                        {e.description && <p className="text-xs" style={{ color: "var(--muted)" }}>{e.description}</p>}
                                        <p className="text-xs" style={{ color: "var(--dim)" }}>{new Date(e.occurred_at).toLocaleDateString("es")}</p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          ) : (
                            <button
                              onClick={() => setPaywallOpen(true)}
                              className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-opacity hover:opacity-80"
                              style={{ background: "rgba(59,130,246,0.07)", border: "1px solid rgba(59,130,246,0.25)" }}
                            >
                              <Star className="w-4 h-4 shrink-0" style={{ color: "#3b82f6" }} />
                              <div className="flex-1">
                                <p className="text-xs font-bold" style={{ color: "#3b82f6" }}>Timeline de decisiones</p>
                                <p className="text-xs" style={{ color: "var(--muted)" }}>Tu historial financiero permanente — Premium</p>
                              </div>
                              <ChevronDown className="w-3 h-3 -rotate-90 shrink-0" style={{ color: "#3b82f6" }} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Legal */}
                <div className="flex justify-center gap-5 py-1">
                  <a href="/privacy" className="text-xs hover:opacity-80 transition-opacity" style={{ color: "var(--dim)" }}>Política de privacidad</a>
                  <span style={{ color: "var(--dim)" }}>·</span>
                  <a href="/terms" className="text-xs hover:opacity-80 transition-opacity" style={{ color: "var(--dim)" }}>Términos de uso</a>
                </div>

                {/* Logout */}
                <button onClick={handleLogout}
                        className="w-full py-3 rounded-2xl border flex items-center justify-center gap-2 text-sm font-semibold hover:opacity-80 transition-opacity"
                        style={{ borderColor: "rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.06)", color: "#ef4444" }}>
                  <LogOut className="w-4 h-4" />
                  Cerrar sesión
                </button>

                {/* Delete account */}
                {deleteError && (
                  <p className="text-xs text-center px-2" style={{ color: "#ef4444" }}>{deleteError}</p>
                )}
                <button onClick={handleDeleteAccount}
                        disabled={deletingAccount}
                        className="w-full py-3 text-xs text-center hover:opacity-70 transition-opacity disabled:opacity-40"
                        style={{ color: "var(--dim)" }}>
                  {deletingAccount ? "Eliminando cuenta..." : "Eliminar mi cuenta"}
                </button>
              </>
            )}
          </div>
        </main>
      </div>
      </div>

      {/* Mentor letter modal */}
      {letterOpen && mentor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6"
             style={{ background: "rgba(0,0,0,0.7)" }}
             onClick={() => setLetterOpen(false)}>
          <div className="rounded-3xl border p-6 max-w-md w-full max-h-[80vh] flex flex-col"
               style={{ background: mentor.color + "0f", borderColor: mentor.color + "40" }}
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold tracking-wider uppercase" style={{ color: mentor.color }}>{mentor.name}</span>
              <button onClick={() => setLetterOpen(false)} style={{ color: mentor.color }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              <p className="text-sm leading-relaxed italic" style={{ color: "var(--text)" }}>{letter}</p>
            </div>
          </div>
        </div>
      )}

      {wrappedOpen && <WrappedCard onClose={() => setWrappedOpen(false)} />}
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} />
    </div>
  );
}
