import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

function todayStr() { return new Date().toISOString().split("T")[0]; }
function yesterdayStr() { return new Date(Date.now() - 86400000).toISOString().split("T")[0]; }

export const STREAK_MILESTONES = [
  { days: 15, reward: "Modo Experto desbloqueado 🧠", bonus: "+5 mensajes/día" },
  { days: 30, reward: "+5 mensajes diarios activados 🎁", bonus: "Acceso a escenarios imposibles" },
  { days: 60, reward: "Insignia Inversor Consistente 🏅", bonus: "1 semana Premium gratis" },
  { days: 90, reward: "Hall of Fame — Top Inversor 🏆", bonus: "Mención especial" },
];

export function getMilestoneForStreak(streak: number) {
  return [...STREAK_MILESTONES].reverse().find((m) => streak >= m.days) ?? null;
}

export function getNextMilestone(streak: number) {
  return STREAK_MILESTONES.find((m) => streak < m.days) ?? null;
}

interface LearnStore {
  streak: number;
  lastLearnDate: string | null;
  totalCompleted: number;
  completedToday: boolean;
  markTopicCompleted: () => void;
  initStreak: () => void;
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
