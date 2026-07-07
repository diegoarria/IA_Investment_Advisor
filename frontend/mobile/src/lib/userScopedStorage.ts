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
 */
export const userScopedStorage = createJSONStorage(() => ({
  getItem: async (name: string) => {
    const uid = (await SecureStore.getItemAsync("user_id")) ?? "guest";
    return AsyncStorage.getItem(`${name}__${uid}`);
  },
  setItem: async (name: string, value: string) => {
    const uid = (await SecureStore.getItemAsync("user_id")) ?? "guest";
    return AsyncStorage.setItem(`${name}__${uid}`, value);
  },
  removeItem: async (name: string) => {
    const uid = (await SecureStore.getItemAsync("user_id")) ?? "guest";
    return AsyncStorage.removeItem(`${name}__${uid}`);
  },
}));
