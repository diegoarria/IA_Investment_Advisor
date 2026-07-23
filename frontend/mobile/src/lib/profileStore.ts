import { create } from "zustand";
import { persist } from "zustand/middleware";
import { userScopedStorage } from "./userScopedStorage";

export type RiskTolerance = "conservative" | "moderate" | "aggressive";
export type QuizAnswer = "A" | "B" | "C" | "D";

export interface QuizAnswers {
  q1: QuizAnswer; // mentalidad
  q2: QuizAnswer; // horizonte
  q3: QuizAnswer; // conocimiento
  q4: QuizAnswer; // riesgo
  q5: QuizAnswer; // comportamiento
}

export interface UserProfile {
  name: string;
  birth_date?: string;
  monthly_income?: string;
  monthly_contribution: string;
  investment_amount?: string;
  investment_goal?: string;
  investment_goal_amount?: string;
  investment_horizon?: string;
  knowledge_level?: QuizAnswer | "";
  risk_tolerance: RiskTolerance;
  quiz_answers: Partial<QuizAnswers>;
  mentor?: string | null;
  avatarUri?: string | null;
  country?: string | null;
  initial_capital?: string | null;
  has_broker?: boolean | null;
  broker_name?: string | null;
  has_investments?: boolean | null;
}

/** Scores: A=1, B=2, C=3, D=4. avg<=2→conservative, <=3→moderate, >3→aggressive */
export function calculateRisk(answers: Partial<Record<keyof QuizAnswers, QuizAnswer | "">>): RiskTolerance {
  const scoreMap: Record<QuizAnswer, number> = { A: 1, B: 2, C: 3, D: 4 };
  const scores = (Object.values(answers) as string[])
    .filter((v): v is QuizAnswer => ["A", "B", "C", "D"].includes(v))
    .map((a) => scoreMap[a]);
  if (scores.length === 0) return "moderate";
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avg <= 2.0) return "conservative";
  if (avg <= 3.0) return "moderate";
  return "aggressive";
}

/** Calculates current age from "DD/MM/YYYY" or "YYYY-MM-DD" */
export function getAge(birthDate: string): number {
  if (!birthDate) return 0;
  const sep = birthDate.includes("/") ? "/" : "-";
  const parts = birthDate.split(sep).map(Number);
  if (parts.length !== 3) return 0;
  const [y, m, d] = sep === "-" ? parts : [parts[2], parts[1], parts[0]];
  if (!y || !m || !d || y < 1900) return 0;
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return Math.max(0, age);
}

/** Auto-inserts "/" as user types — call on every TextInput change */
export function formatBirthDate(text: string): string {
  const digits = text.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export const RISK_CONFIG: Record<RiskTolerance, { label: string; icon: "shield-checkmark-outline" | "scale-outline" | "rocket-outline"; pct: number; color: string }> = {
  conservative: { label: "Inversionista Conservador", icon: "shield-checkmark-outline", pct: 0.15, color: "#3b82f6" },
  moderate:     { label: "Inversionista Moderado",    icon: "scale-outline",             pct: 0.50, color: "#f59e0b" },
  aggressive:   { label: "Inversionista Agresivo",    icon: "rocket-outline",            pct: 1.0,  color: "#ef4444" },
};

export interface MaturityEvent {
  timestamp: number;
  delta: number;
  signals: string[];
  newScore: number;
}

const MATURITY_DELTAS: Record<string, number> = {
  "análisis_racional": 4,
  "tolera_volatilidad": 4,
  "largo_plazo": 3,
  "diversificación_consciente": 3,
  "compra_en_caídas": 5,
  "decisión_por_fundamentos": 4,
  "acepta_pérdida_educada": 3,
  "pánico_venta": -5,
  "busca_garantías": -3,
  "fomo": -4,
  "especulación": -3,
  "decisión_por_precio": -3,
  "horizonte_corto": -2,
};

export function computeMaturityDelta(signals: string[]): number {
  return signals.reduce((acc, sig) => acc + (MATURITY_DELTAS[sig] ?? 0), 0);
}

// Maps each raw signal key (matching MATURITY_DELTAS above) to its i18n key
// under profile.maturitySignals.* — these used to render as the raw
// Spanish key with underscores replaced by spaces, even in English.
const MATURITY_SIGNAL_I18N_KEYS: Record<string, string> = {
  "análisis_racional": "analisisRacional",
  "tolera_volatilidad": "toleraVolatilidad",
  "largo_plazo": "largoPlazo",
  "diversificación_consciente": "diversificacionConsciente",
  "compra_en_caídas": "compraEnCaidas",
  "decisión_por_fundamentos": "decisionPorFundamentos",
  "acepta_pérdida_educada": "aceptaPerdidaEducada",
  "pánico_venta": "panicoVenta",
  "busca_garantías": "buscaGarantias",
  "fomo": "fomo",
  "especulación": "especulacion",
  "decisión_por_precio": "decisionPorPrecio",
  "horizonte_corto": "horizonteCorto",
};

export function maturitySignalI18nKey(signal: string): string {
  const key = MATURITY_SIGNAL_I18N_KEYS[signal];
  return key ? `profile.maturitySignals.${key}` : "";
}

export function maturityLabel(score: number, t: (key: string) => string): { label: string; color: string } {
  if (score < 30) return { label: t("profile.maturityLevels.apprentice"),  color: "#ef4444" };
  if (score < 50) return { label: t("profile.maturityLevels.beginner"),    color: "#f97316" };
  if (score < 65) return { label: t("profile.maturityLevels.developing"), color: "#f59e0b" };
  if (score < 80) return { label: t("profile.maturityLevels.mature"),     color: "#22c55e" };
  return                 { label: t("profile.maturityLevels.expert"),     color: "#16a34a" };
}

/** Knowledge level derived from the actual maturity score (overrides quiz self-report). */
export function knowledgeFromMaturity(score: number): { label: string; key: "A" | "B" | "C" | "D" } {
  if (score < 50) return { label: "Básico",      key: "B" };
  if (score < 75) return { label: "Intermedio",  key: "C" };
  return                 { label: "Avanzado",     key: "D" };
}

interface AppStore {
  profile: UserProfile | null;
  explicitLogout: boolean;
  setProfile: (p: UserProfile) => void;
  setAvatarUri: (uri: string | null) => void;
  logout: () => void;
  sidebarOpen: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
  maturityScore: number;
  maturityHistory: MaturityEvent[];
  updateMaturity: (signals: string[]) => void;
  hasSeenFirstAction: boolean;
  markFirstActionSeen: () => void;
  hasSeenTutorial: boolean;
  markTutorialSeen: () => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      profile: null,
      explicitLogout: false,
      setProfile: (p) => set({ profile: p, explicitLogout: false }),
      setAvatarUri: (uri) => set((s) => ({ profile: s.profile ? { ...s.profile, avatarUri: uri } : null })),
      logout: () => set({ profile: null, explicitLogout: true, sidebarOpen: false }),
      sidebarOpen: false,
      openSidebar: () => set({ sidebarOpen: true }),
      closeSidebar: () => set({ sidebarOpen: false }),
      maturityScore: 0,
      maturityHistory: [],
      hasSeenFirstAction: false,
      markFirstActionSeen: () => set({ hasSeenFirstAction: true }),
      hasSeenTutorial: false,
      markTutorialSeen: () => set({ hasSeenTutorial: true }),
      updateMaturity: (signals) => {
        const delta = computeMaturityDelta(signals);
        if (delta === 0) return;
        const current = get().maturityScore;
        const newScore = Math.min(100, Math.max(0, current + delta));
        const event: MaturityEvent = { timestamp: Date.now(), delta, signals, newScore };
        set((s) => ({
          maturityScore: newScore,
          maturityHistory: [...s.maturityHistory.slice(-99), event],
        }));
        const history = get().maturityHistory;
        import("./api").then(({ syncApi }) => {
          syncApi.pushMaturity(newScore, history).catch(() => {});
        });
      },
    }),
    {
      name: "user-profile",
      storage: userScopedStorage,
      partialize: (s) => ({ profile: s.profile, maturityScore: s.maturityScore, maturityHistory: s.maturityHistory, hasSeenFirstAction: s.hasSeenFirstAction, hasSeenTutorial: s.hasSeenTutorial }),
    }
  )
);
