import { useAppStore } from "./profileStore";
import type { UserProfile } from "./profileStore";

export type UserLevel = "principiante" | "basico" | "intermedio" | "avanzado";

// q3 answer → level (same mapping as web)
const Q3_MAP: Record<string, UserLevel> = {
  A: "principiante",
  B: "basico",
  C: "intermedio",
  D: "avanzado",
};

const LEVEL_ORDER: Record<UserLevel, number> = {
  principiante: 0,
  basico:       1,
  intermedio:   2,
  avanzado:     3,
};

export function getUserLevel(profile: UserProfile | null): UserLevel {
  if (!profile) return "intermedio";
  const q3 = profile.quiz_answers?.q3 as string | undefined;
  return Q3_MAP[q3 ?? ""] ?? "intermedio";
}

export function isAtLeast(level: UserLevel, min: UserLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[min];
}

export function useUserLevel(): UserLevel {
  const profile = useAppStore((s) => s.profile);
  return getUserLevel(profile);
}

export const LEVEL_LABEL: Record<UserLevel, string> = {
  principiante: "Principiante",
  basico:       "Básico",
  intermedio:   "Intermedio",
  avanzado:     "Avanzado",
};

export const LEVEL_COLOR: Record<UserLevel, string> = {
  principiante: "#6b7280",
  basico:       "#6b7280",
  intermedio:   "#00a85e",
  avanzado:     "#00a85e",
};

export const LEVEL_EMOJI: Record<UserLevel, string> = {
  principiante: "🌱",
  basico:       "📚",
  intermedio:   "📈",
  avanzado:     "⚡",
};

export const LEVEL_DESC: Record<UserLevel, string> = {
  principiante: "Nunca he invertido",
  basico:       "Conozco lo básico",
  intermedio:   "Leo estados financieros",
  avanzado:     "Análisis profundo",
};
