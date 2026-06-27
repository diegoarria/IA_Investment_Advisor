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

export type StreakMilestone = {
  days: number;
  emoji: string;
  title: string;
  reward: string;       // short label shown on badge
  description: string;  // explanation in modal
  premiumBonus?: number; // days of premium granted (free users only)
  msgReset?: boolean;   // resets daily message count
};

export const STREAK_MILESTONES: StreakMilestone[] = [
  {
    days: 3,
    emoji: "🔥",
    title: "Arranque",
    reward: "Badge Arranque",
    description: "¡Llevas 3 días aprendiendo seguidos! Tu mentor tiene un mensaje especial para ti.",
  },
  {
    days: 7,
    emoji: "⚡",
    title: "Primera Semana",
    reward: "Día de mensajes gratis",
    description: "Una semana completa. Como recompensa, tu límite de mensajes de hoy se ha reiniciado.",
    msgReset: true,
  },
  {
    days: 14,
    emoji: "🎯",
    title: "Dos Semanas",
    reward: "Badge Estratega",
    description: "14 días consecutivos. Estás construyendo un hábito real de inversión.",
  },
  {
    days: 30,
    emoji: "🎁",
    title: "Mes Completo",
    reward: "3 días Premium gratis",
    description: "¡Un mes entero! Hemos agregado 3 días de Premium a tu cuenta.",
    premiumBonus: 3,
  },
  {
    days: 60,
    emoji: "🏅",
    title: "Inversor Consistente",
    reward: "7 días Premium gratis",
    description: "60 días sin parar. Esto ya es disciplina de nivel élite. Tienes 7 días de Premium.",
    premiumBonus: 7,
  },
  {
    days: 90,
    emoji: "👑",
    title: "Hall of Fame",
    reward: "1 mes Premium gratis",
    description: "90 días consecutivos. Eres parte del 1% de los inversores más consistentes de Nuvos. Disfruta 1 mes de Premium.",
    premiumBonus: 30,
  },
];

export function getMilestoneForStreak(streak: number): StreakMilestone | null {
  return [...STREAK_MILESTONES].reverse().find((m) => streak >= m.days) ?? null;
}

export function getNextMilestone(streak: number): StreakMilestone | null {
  return STREAK_MILESTONES.find((m) => streak < m.days) ?? null;
}

/** Returns all milestones newly reached (not yet in claimedMilestones) */
export function getUnclaimedMilestones(streak: number, claimed: number[]): StreakMilestone[] {
  return STREAK_MILESTONES.filter((m) => streak >= m.days && !claimed.includes(m.days));
}

interface LearnStore {
  streak: number;
  lastLearnDate: string | null;
  totalCompleted: number;
  completedToday: boolean;
  claimedMilestones: number[];
  completedTopicIds: string[];
  markTopicCompleted: () => void;
  markTopicId: (id: string) => void;
  setCompletedTopicIds: (ids: string[]) => void;
  initStreak: () => void;
  setStreakFromServer: (count: number, lastLearnDate: string | null) => void;
  setClaimedMilestones: (milestones: number[]) => void;
  markMilestoneClaimed: (days: number) => void;
}

export const useLearnStore = create<LearnStore>()(
  persist(
    (set, get) => ({
      streak: 0,
      lastLearnDate: null,
      totalCompleted: 0,
      completedToday: false,
      claimedMilestones: [],
      completedTopicIds: [],

      setCompletedTopicIds: (ids) =>
        set((s) => ({ completedTopicIds: [...new Set([...s.completedTopicIds, ...ids])] })),

      markTopicId: (id) => {
        const current = get().completedTopicIds;
        if (current.includes(id)) return;
        const updated = [...current, id];
        set({ completedTopicIds: updated });
        const { streak, lastLearnDate } = get();
        _syncStreak(streak, lastLearnDate ?? "", updated);
      },

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

      setClaimedMilestones: (milestones) => set({ claimedMilestones: milestones }),

      markMilestoneClaimed: (days) =>
        set((s) => ({
          claimedMilestones: s.claimedMilestones.includes(days)
            ? s.claimedMilestones
            : [...s.claimedMilestones, days],
        })),

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

function _syncStreak(streak: number, lastLearnDate: string, completedTopicIds?: string[]) {
  import("../lib/api").then(({ learnApi }) => {
    learnApi.syncStreak(streak, lastLearnDate, completedTopicIds).catch(() => {});
  });
}
