import { useAppStore } from "./profileStore";
import type { UserProfile } from "./profileStore";

export type UserLevel = "basico" | "intermedio" | "avanzado";

// A (old principiante) and B both map to "basico"
const Q3_MAP: Record<string, UserLevel> = {
  A: "basico",
  B: "basico",
  C: "intermedio",
  D: "avanzado",
};

const LEVEL_ORDER: Record<UserLevel, number> = {
  basico:     0,
  intermedio: 1,
  avanzado:   2,
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

/** i18n-aware label for a user level — call with the `t` from useTranslation(). */
export function getLevelLabel(t: (key: string) => string, level: UserLevel): string {
  return t(`common.userLevel.${level}`);
}

export const LEVEL_COLOR: Record<UserLevel, string> = {
  basico:     "#6b7280",
  intermedio: "#00a85e",
  avanzado:   "#00a85e",
};

export const LEVEL_EMOJI: Record<UserLevel, string> = {
  basico:     "📚",
  intermedio: "📈",
  avanzado:   "⚡",
};

export const LEVEL_DESC: Record<UserLevel, string> = {
  basico:     "Sin experiencia o conozco lo básico",
  intermedio: "Tengo experiencia (ETFs, acciones)",
  avanzado:   "Análisis financiero profundo",
};
