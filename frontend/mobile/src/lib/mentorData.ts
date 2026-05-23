import type { RiskTolerance } from "./profileStore";

export interface MentorInfo {
  id: string;
  emoji: string;
  name: string;
  title: string;
  badge: string;
  color: string;
  principles: string[];
  forRisk: RiskTolerance[];
}

export const MENTORS: MentorInfo[] = [
  {
    id: "Warren Buffett",
    emoji: "🏛️",
    name: "Warren Buffett",
    title: "El Oráculo de Omaha",
    badge: "Value Investing",
    color: "#f59e0b",
    principles: ["Compra negocios, no acciones", "Piensa en décadas", "Margen de seguridad siempre"],
    forRisk: ["conservative", "moderate"],
  },
  {
    id: "Ray Dalio",
    emoji: "⚖️",
    name: "Ray Dalio",
    title: "Fundador de Bridgewater",
    badge: "All-Weather",
    color: "#3b82f6",
    principles: ["Diversificación radical", "Ciclos macro de deuda", "Correlaciones sobre retornos"],
    forRisk: ["moderate"],
  },
  {
    id: "Michael Burry",
    emoji: "🔍",
    name: "Michael Burry",
    title: "El Gran Corto",
    badge: "Deep Value Contrario",
    color: "#ef4444",
    principles: ["Activos ocultos subvalorados", "Ve contra el consenso", "El mercado siempre se equivoca"],
    forRisk: ["aggressive"],
  },
  {
    id: "Bill Ackman",
    emoji: "⚔️",
    name: "Bill Ackman",
    title: "Activista Institucional",
    badge: "Concentrado",
    color: "#8b5cf6",
    principles: ["Pocas apuestas grandes", "Activismo como catalizador", "Alta convicción siempre"],
    forRisk: ["aggressive"],
  },
  {
    id: "Peter Lynch",
    emoji: "📈",
    name: "Peter Lynch",
    title: "Magellan Fund Legend",
    badge: "GARP",
    color: "#22c55e",
    principles: ["Invierte en lo que conoces", "Crecimiento a precio razonable", "Investiga más que nadie"],
    forRisk: ["conservative", "moderate", "aggressive"],
  },
];

export const RECOMMENDED_MENTOR: Record<RiskTolerance, string> = {
  conservative: "Warren Buffett",
  moderate: "Ray Dalio",
  aggressive: "Michael Burry",
};

export function getMentorInfo(mentorId: string | null | undefined): MentorInfo | null {
  if (!mentorId) return null;
  return MENTORS.find((m) => m.id === mentorId) ?? null;
}

/** Photos are local require() assets — only available for 3 known investors */
export const MENTOR_PHOTO_IDS = ["Warren Buffett", "Ray Dalio", "Bill Ackman"] as const;
