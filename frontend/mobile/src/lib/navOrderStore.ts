import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { syncApi } from "./api";

const STORAGE_KEY = "nuvos_nav_order";

export interface NavItem {
  icon: string;
  iconFilled: string;
  label: string;
  path: string;
  /** If true, can appear as a bottom tab */
  tabCapable: boolean;
}

// Icons mirror the web app's Lucide icons mapped to Ionicons equivalents:
// BookOpen→book, PieChart→pie-chart, Eye→eye, BarChart2→bar-chart,
// GraduationCap→school, Trophy→trophy, Bell→notifications, Headphones→headset, User→person
export const ALL_NAV_ITEMS: NavItem[] = [
  { icon: "book-outline",          iconFilled: "book",          label: "Chat IA",     path: "/chat",          tabCapable: true },
  { icon: "pie-chart-outline",     iconFilled: "pie-chart",     label: "Portafolios", path: "/portfolio",     tabCapable: true },
  { icon: "eye-outline",           iconFilled: "eye",           label: "Watchlist",   path: "/watchlist",     tabCapable: true },
  { icon: "trophy-outline",        iconFilled: "trophy",        label: "Play",        path: "/arena",         tabCapable: true },
  { icon: "school-outline",        iconFilled: "school",        label: "Aprender",    path: "/learn",         tabCapable: true },
  { icon: "bar-chart-outline",     iconFilled: "bar-chart",     label: "Simulador",   path: "/paper",         tabCapable: true },
  { icon: "person-outline",        iconFilled: "person",        label: "Mi Perfil",   path: "/profile",       tabCapable: true },
  { icon: "notifications-outline", iconFilled: "notifications", label: "Alertas",     path: "/notifications", tabCapable: true },
  { icon: "headset-outline",       iconFilled: "headset",       label: "Soporte",     path: "/support",       tabCapable: false },
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
