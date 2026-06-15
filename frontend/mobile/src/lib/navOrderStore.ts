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

// Icons mirror the web app's Lucide icons mapped to Ionicons equivalents:
// BookOpen→book, PieChart→pie-chart, Eye→eye, BarChart2→bar-chart,
// GraduationCap→school, Trophy→trophy, Bell→notifications, Headphones→headset, User→person
export const ALL_NAV_ITEMS: NavItem[] = [
  { icon: "book-outline",          iconFilled: "book",          label: "Chat",          path: "/chat",          tabCapable: true,  minLevel: "principiante" },
  { icon: "pie-chart-outline",     iconFilled: "pie-chart",     label: "Portafolio",    path: "/portfolio",     tabCapable: true,  minLevel: "principiante" },
  { icon: "eye-outline",           iconFilled: "eye",           label: "Watchlist",     path: "/watchlist",     tabCapable: true,  minLevel: "basico" },
  { icon: "school-outline",        iconFilled: "school",        label: "Aprendizaje",   path: "/learn",         tabCapable: true,  minLevel: "principiante" },
  { icon: "bar-chart-outline",     iconFilled: "bar-chart",     label: "Simulador",     path: "/paper",         tabCapable: true,  minLevel: "basico" },
  { icon: "person-outline",        iconFilled: "person",        label: "Perfil",        path: "/profile",       tabCapable: true,  minLevel: "principiante" },
  { icon: "notifications-outline", iconFilled: "notifications", label: "Notificaciones",path: "/notifications", tabCapable: true,  minLevel: "principiante" },
  { icon: "play-circle-outline",   iconFilled: "play-circle",   label: "Videos",        path: "/videos",        tabCapable: true,  minLevel: "principiante" },
  { icon: "headset-outline",       iconFilled: "headset",       label: "Soporte",       path: "/support",       tabCapable: false, minLevel: "principiante" },
];

const ALL_PATHS = ALL_NAV_ITEMS.map((i) => i.path);
const DEFAULT_ORDER = ALL_PATHS;

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
    // Persist to server for cross-device sync (fire-and-forget)
    syncApi.pushNavOrder(order).catch(() => {});
  },

  loadOrder: async () => {
    // 1. Apply AsyncStorage immediately so UI is fast
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

    // 2. Fetch server order (authoritative for cross-device restore)
    try {
      const res = await syncApi.getNavOrder();
      const serverOrder: string[] | null | undefined = res.data?.nav_order;
      if (serverOrder && Array.isArray(serverOrder) && serverOrder.length > 0) {
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
