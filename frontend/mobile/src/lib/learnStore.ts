import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function yesterdayStr() {
  return new Date(Date.now() - 86400000).toISOString().split("T")[0];
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
      },
    }),
    { name: "learn-store", storage: createJSONStorage(() => AsyncStorage) }
  )
);
