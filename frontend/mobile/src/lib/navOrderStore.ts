import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { syncApi } from "./api";
import type { UserLevel } from "./userLevel";

const STORAGE_KEY = "nuvos_nav_order";

export interface NavItem {
  icon: string;
  iconFilled: string;
  label: string;
  path: string;
  /** If true, can appear as a bottom tab */
  tabCapable: boolean;
  /** Minimum user level required to access this section */
  minLevel: UserLevel;
}

export const ALL_NAV_ITEMS: NavItem[] = [
  { icon: "home-outline",          iconFilled: "home",          label: "Inicio",        path: "/home",          tabCapable: true,  minLevel: "basico" },
  { icon: "reader-outline",        iconFilled: "reader",        label: "Chat",          path: "/chat",          tabCapable: true,  minLevel: "basico" },
  { icon: "pie-chart-outline",     iconFilled: "pie-chart",     label: "Portafolio",    path: "/portfolio",     tabCapable: true,  minLevel: "basico" },
  { icon: "eye-outline",           iconFilled: "eye",           label: "Watchlist",     path: "/watchlist",     tabCapable: true,  minLevel: "basico" },
  { icon: "play-outline",          iconFilled: "play",          label: "Videos",        path: "/videos",        tabCapable: true,  minLevel: "basico" },
  { icon: "school-outline",        iconFilled: "school",        label: "Aprendizaje",   path: "/learn",         tabCapable: true,  minLevel: "basico" },
  { icon: "bar-chart-outline",     iconFilled: "bar-chart",     label: "Simulador",     path: "/paper",         tabCapable: true,  minLevel: "basico" },
  { icon: "notifications-outline", iconFilled: "notifications", label: "Notificaciones",path: "/notifications", tabCapable: true,  minLevel: "basico" },
  { icon: "headset-outline",       iconFilled: "headset",       label: "Soporte",       path: "/support",       tabCapable: false, minLevel: "basico" },
  { icon: "person-outline",        iconFilled: "person",        label: "Perfil",        path: "/profile",       tabCapable: true,  minLevel: "basico" },
];

const ALL_PATHS = ALL_NAV_ITEMS.map((i) => i.path);
const DEFAULT_ORDER = ALL_PATHS;

// Web uses /feed for Videos; mobile uses /videos. Translate when syncing with server.
const FROM_SERVER: Record<string, string> = { "/feed": "/videos" };
const TO_SERVER:   Record<string, string> = { "/videos": "/feed" };

function normalizeFromServer(paths: string[]): string[] {
  return paths.map((p) => FROM_SERVER[p] ?? p);
}

function normalizeToServer(paths: string[]): string[] {
  return paths.map((p) => TO_SERVER[p] ?? p);
}

interface NavOrderStore {
  order: string[];
  setOrder: (order: string[]) => void;
  loadOrder: () => Promise<void>;
}

export const useNavOrderStore = create<NavOrderStore>((set) => ({
  order: DEFAULT_ORDER,

  setOrder: (order) => {
    set({ order });
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(order)).catch(() => {});
    syncApi.pushNavOrder(normalizeToServer(order)).catch(() => {});
  },

  loadOrder: async () => {
    // 1. AsyncStorage first — fast local restore
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: string[] = JSON.parse(saved);
        const merged = [
          ...parsed.filter((p) => ALL_PATHS.includes(p)),
          ...ALL_PATHS.filter((p) => !parsed.includes(p)),
        ];
        set({ order: merged });
      }
    } catch {}

    // 2. Server order is authoritative (web drag-and-drop syncs here)
    try {
      const res = await syncApi.getNavOrder();
      const raw: string[] | null | undefined = res.data?.nav_order;
      if (raw && Array.isArray(raw) && raw.length > 0) {
        const serverOrder = normalizeFromServer(raw);
        const merged = [
          ...serverOrder.filter((p) => ALL_PATHS.includes(p)),
          ...ALL_PATHS.filter((p) => !serverOrder.includes(p)),
        ];
        set({ order: merged });
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      }
    } catch {}
  },
}));

/** Top 5 tab-capable paths in user's preferred order */
export function getTop5TabPaths(order: string[]): string[] {
  return order
    .filter((p) => ALL_NAV_ITEMS.find((i) => i.path === p)?.tabCapable)
    .slice(0, 5);
}

/** "/chat" → "chat" */
export function pathToRoute(path: string): string {
  return path.replace(/^\//, "");
}
