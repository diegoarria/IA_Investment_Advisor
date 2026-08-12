import { createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

/**
 * Every persisted store that holds user data (profile, portfolio, watchlist,
 * subscription, paper trading, learn progress) must use this instead of the
 * plain AsyncStorage adapter. Without the `${name}__${uid}` suffix, logging
 * out and into a different account reads back the PREVIOUS account's data
 * under the same bare key — this is what caused switching accounts to show
 * stale/wrong data. chatStore.ts already had this pattern; this just makes
 * it shared instead of duplicated per-store.
 *
 * Every method is wrapped in try/catch — same reasoning as the web app's
 * equivalent userStorage (frontend/web/src/lib/store.ts): SecureStore/
 * AsyncStorage can throw on real devices (keychain access denied, storage
 * full, a stale Expo Go/dev-client build) and an uncaught exception inside
 * zustand's persist middleware can abort the whole store's hydration/write.
 * For useSubscriptionStore specifically, that's how a device ends up stuck
 * showing "free" even after a successful server fetch, because the write of
 * that fetch's result back to storage is what threw — this was already
 * fixed on web; this closes the same gap on mobile.
 */
export const userScopedStorage = createJSONStorage(() => ({
  getItem: async (name: string) => {
    try {
      const uid = (await SecureStore.getItemAsync("user_id")) ?? "guest";
      return await AsyncStorage.getItem(`${name}__${uid}`);
    } catch {
      return null;
    }
  },
  setItem: async (name: string, value: string) => {
    try {
      const uid = (await SecureStore.getItemAsync("user_id")) ?? "guest";
      await AsyncStorage.setItem(`${name}__${uid}`, value);
    } catch {
      // Store still works in-memory for this session, it just won't
      // persist across app restarts.
    }
  },
  removeItem: async (name: string) => {
    try {
      const uid = (await SecureStore.getItemAsync("user_id")) ?? "guest";
      await AsyncStorage.removeItem(`${name}__${uid}`);
    } catch {
      // Nothing to do — best-effort cleanup.
    }
  },
}));
