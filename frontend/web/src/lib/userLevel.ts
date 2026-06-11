import { useProfileStore } from "./store";
import type { UserProfile } from "./types";

export type UserLevel = "principiante" | "basico" | "intermedio" | "avanzado";

// Maps quiz q3 answer → level
// q3: A=Principiante, B=Básico, C=Intermedio, D=Avanzado
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
  // knowledge_level is the direct field set during onboarding (replaces q3)
  const kl = profile.knowledge_level as string | undefined;
  if (kl && Q3_MAP[kl]) return Q3_MAP[kl];
  // Fall back to quiz answer q3 for profiles created before the knowledge_level field
  const q3 = profile.quiz_answers?.q3 as string | undefined;
  return Q3_MAP[q3 ?? ""] ?? "intermedio";
}

/** Returns true if `level` is at least as advanced as `min`. */
export function isAtLeast(level: UserLevel, min: UserLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[min];
}

/** React hook — reads user level from the profile store. */
export function useUserLevel(): UserLevel {
  const { profile } = useProfileStore();
  return getUserLevel(profile);
}

export const LEVEL_LABEL: Record<UserLevel, string> = {
  principiante: "Principiante",
  basico:       "Básico",
  intermedio:   "Intermedio",
  avanzado:     "Avanzado",
};

// Single accent color for all levels — clean, on-brand
export const LEVEL_COLOR: Record<UserLevel, string> = {
  principiante: "#6b7280",
  basico:       "#6b7280",
  intermedio:   "#00a85e",
  avanzado:     "#00a85e",
};

// Kept for backwards compat — all empty, use icons instead
export const LEVEL_EMOJI: Record<UserLevel, string> = {
  principiante: "",
  basico:       "",
  intermedio:   "",
  avanzado:     "",
};

// Tooltip text shown to basic users on complex financial terms
export const TOOLTIPS: Record<string, string> = {
  "P/E":         "Price-to-Earnings: cuánto pagas por cada $1 de ganancia. Menor = más barato.",
  "EPS":         "Earnings Per Share: ganancia neta dividida entre acciones. Más alto = mejor.",
  "Market Cap":  "Valor total de la empresa en el mercado. Precio × acciones totales.",
  "Beta":        "Mide cuánto se mueve la acción vs el mercado. Beta >1 = más volátil.",
  "Dividendo":   "Parte de la ganancia que la empresa te paga por tener sus acciones.",
  "YTD":         "Year To Date: rendimiento acumulado desde el 1 de enero hasta hoy.",
  "52W High":    "Precio más alto que tuvo la acción en los últimos 12 meses.",
  "Sharpe":      "Mide cuánto rendimiento obtienes por cada unidad de riesgo que tomas.",
  "Volatilidad": "Qué tan drásticamente sube y baja el precio. Alta = más riesgo.",
  "ROE":         "Return on Equity: qué tan bien usa la empresa el dinero de sus accionistas.",
};
