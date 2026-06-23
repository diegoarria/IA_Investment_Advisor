import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "nuvos_start_screen";

export type StartScreen = "home" | "patrimonio" | "chat" | "notifications" | "academy";

export const START_SCREEN_OPTIONS: { key: StartScreen; label: string; icon: string; color: string }[] = [
  { key: "home",          label: "Inicio",          icon: "home-outline",          color: "#00d47e" },
  { key: "patrimonio",    label: "Patrimonio",       icon: "wallet-outline",        color: "#3b82f6" },
  { key: "chat",          label: "Mentor IA",        icon: "sparkles-outline",      color: "#8b5cf6" },
  { key: "notifications", label: "Notificaciones",   icon: "notifications-outline", color: "#ef4444" },
  { key: "academy",       label: "Academy",          icon: "school-outline",        color: "#f59e0b" },
];

interface StartScreenStore {
  screen: StartScreen | null;
  loaded: boolean;
  setScreen: (s: StartScreen) => void;
  load: () => Promise<void>;
}

export const useStartScreenStore = create<StartScreenStore>((set) => ({
  screen: null,
  loaded: false,

  setScreen: (s) => {
    set({ screen: s });
    AsyncStorage.setItem(KEY, s).catch(() => {});
  },

  load: async () => {
    try {
      const saved = await AsyncStorage.getItem(KEY);
      set({ screen: (saved as StartScreen) ?? null, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));
