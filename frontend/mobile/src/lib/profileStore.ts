import { create } from "zustand";

export type RiskTolerance = "conservative" | "moderate" | "aggressive";
export type Experience = "beginner" | "intermediate" | "advanced";
export type Goal = "capital_preservation" | "income" | "growth" | "aggressive_growth" | "retirement";

export interface UserProfile {
  name: string;
  birth_date: string; // "DD/MM/YYYY"
  monthly_income: string;
  monthly_contribution: string;
  risk_tolerance: RiskTolerance;
  investment_experience: Experience;
  time_horizon_years: string;
  investment_goals: Goal[];
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

/** Auto-inserts "/" as user types a date — call on every TextInput change */
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
  sidebarOpen: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  profile: null,
  setProfile: (p) => set({ profile: p }),
  sidebarOpen: false,
  openSidebar: () => set({ sidebarOpen: true }),
  closeSidebar: () => set({ sidebarOpen: false }),
}));
