import type { UserProfile } from "./types";

export type UserLevel = "basico" | "intermedio" | "avanzado";

// Maps quiz q3 answer → level
// q3: A=Principiante, B=Básico, C=Intermedio, D=Avanzado
const Q3_MAP: Record<string, UserLevel> = {
  A: "basico",
  B: "basico",
  C: "intermedio",
  D: "avanzado",
};

export function getUserLevel(profile: UserProfile | null): UserLevel {
  if (!profile) return "intermedio";
  const q3 = profile.quiz_answers?.q3 as string | undefined;
  return Q3_MAP[q3 ?? ""] ?? "intermedio";
}

export const LEVEL_LABEL: Record<UserLevel, string> = {
  basico:     "Básico",
  intermedio: "Intermedio",
  avanzado:   "Avanzado",
};

export const LEVEL_COLOR: Record<UserLevel, string> = {
  basico:     "#3b82f6",
  intermedio: "#f59e0b",
  avanzado:   "#8b5cf6",
};

export const LEVEL_EMOJI: Record<UserLevel, string> = {
  basico:     "🌱",
  intermedio: "📈",
  avanzado:   "⚡",
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
