import { create } from "zustand";

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
  birth_date: string; // "DD/MM/YYYY"
  monthly_income: string;
  monthly_contribution: string;
  risk_tolerance: RiskTolerance;
  quiz_answers: QuizAnswers;
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

/** Calculates current age from "DD/MM/YYYY" — auto-updates every birthday */
export function getAge(birthDate: string): number {
  const parts = birthDate.split("/");
  if (parts.length !== 3) return 0;
  const [day, month, year] = parts.map(Number);
  if (!day || !month || !year || year < 1900) return 0;
  const today = new Date();
  let age = today.getFullYear() - year;
  const m = today.getMonth() + 1 - month;
  if (m < 0 || (m === 0 && today.getDate() < day)) age--;
  return Math.max(0, age);
}

/** Auto-inserts "/" as user types — call on every TextInput change */
export function formatBirthDate(text: string): string {
  const digits = text.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export const RISK_CONFIG: Record<RiskTolerance, { label: string; icon: string; pct: number; color: string }> = {
  conservative: { label: "Inversionista Conservador", icon: "🛡️", pct: 0.33, color: "#3b82f6" },
  moderate:     { label: "Inversionista Moderado",    icon: "⚖️", pct: 0.66, color: "#f59e0b" },
  aggressive:   { label: "Inversionista Agresivo",    icon: "🚀", pct: 1.0,  color: "#ef4444" },
};

interface AppStore {
  profile: UserProfile | null;
  setProfile: (p: UserProfile) => void;
  logout: () => void;
  sidebarOpen: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  profile: null,
  setProfile: (p) => set({ profile: p }),
  logout: () => set({ profile: null, sidebarOpen: false }),
  sidebarOpen: false,
  openSidebar: () => set({ sidebarOpen: true }),
  closeSidebar: () => set({ sidebarOpen: false }),
}));
