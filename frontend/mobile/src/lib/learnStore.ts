import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function yesterdayStr() {
  const d = new Date(Date.now() - 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const STREAK_MILESTONES = [
  { days: 15, reward: "Modo Experto desbloqueado 🧠", bonus: "+5 mensajes/día" },
  { days: 30, reward: "+5 mensajes diarios activados 🎁", bonus: "Acceso a escenarios imposibles" },
  { days: 60, reward: "Insignia Inversor Consistente 🏅", bonus: "1 semana Premium gratis" },
  { days: 90, reward: "Hall of Fame — Top Inversor 🏆", bonus: "Mención especial" },
];

export const STREAK_MILESTONES_PREMIUM = [
  { days: 15, reward: "Insignia Estratega 🎖️", bonus: "Análisis macro semanal exclusivo" },
  { days: 30, reward: "Badge Inversor Élite ⭐", bonus: "Debates sin límite de rondas" },
  { days: 60, reward: "Avatar Halcón de Mercado 🦅", bonus: "Escenarios históricos secretos desbloqueados" },
  { days: 90, reward: "Leyenda del Hall of Fame 👑", bonus: "Top 1% — mención permanente en el perfil" },
];

export function getMilestoneForStreak(streak: number, premium = false) {
  const milestones = premium ? STREAK_MILESTONES_PREMIUM : STREAK_MILESTONES;
  return [...milestones].reverse().find((m) => streak >= m.days) ?? null;
}

export function getNextMilestone(streak: number, premium = false) {
  const milestones = premium ? STREAK_MILESTONES_PREMIUM : STREAK_MILESTONES;
  return milestones.find((m) => streak < m.days) ?? null;
}

interface LearnStore {
  streak: number;
  lastLearnDate: string | null;
  totalCompleted: number;
  completedToday: boolean;
  markTopicCompleted: () => void;
  initStreak: () => void;
  setStreakFromServer: (count: number, lastLearnDate: string | null) => void;
}

export const useLearnStore = create<LearnStore>()(
  persist(
    (set, get) => ({
      streak: 0,
      lastLearnDate: null,
      totalCompleted: 0,
      completedToday: false,

      initStreak: () => {
        const { lastLearnDate, streak } = get();
        const today = todayStr();
        const yesterday = yesterdayStr();
        if (lastLearnDate === today) {
          set({ completedToday: true });
        } else if (lastLearnDate && lastLearnDate < yesterday) {
          set({ streak: 0, completedToday: false });
          _syncStreak(0, "");
        } else {
          set({ completedToday: false });
        }
      },

      setStreakFromServer: (count, lastDate) => {
        const today = todayStr();
        set({
          streak: count,
          lastLearnDate: lastDate ?? null,
          completedToday: lastDate === today,
        });
      },

      markTopicCompleted: () => {
        const { lastLearnDate, streak, totalCompleted } = get();
        const today = todayStr();
        const yesterday = yesterdayStr();

        if (lastLearnDate === today) {
          set({ totalCompleted: totalCompleted + 1 });
          return;
        }

        const newStreak = lastLearnDate === yesterday ? streak + 1 : 1;
        set({
          streak: newStreak,
          lastLearnDate: today,
          totalCompleted: totalCompleted + 1,
          completedToday: true,
        });
        _syncStreak(newStreak, today);
      },
    }),
    { name: "learn-store", storage: createJSONStorage(() => AsyncStorage) }
  )
);

function _syncStreak(streak: number, lastLearnDate: string) {
  import("../lib/api").then(({ learnApi }) => {
    learnApi.syncStreak(streak, lastLearnDate).catch(() => {});
  });
}
