import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

// Fallbacks matter here specifically because EAS build profiles can silently
// omit the `env` block (as the `preview` profile did) — without a fallback,
// createClient() below throws on an empty URL at module-import time, before
// any UI renders, which looks like the app crashing/closing immediately on open.
const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || "https://nyxcqjzeiyptyipigsaz.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55eGNxanplaXlwdHlpcGlnc2F6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NDYwOTIsImV4cCI6MjA5NTEyMjA5Mn0.zrOA6106uiBblb95PHc-jEvtBkFfB8jIHjxC_qZrlwg";

const ExpoSecureStoreAdapter = {
  getItem: async (key: string) => {
    try { return await SecureStore.getItemAsync(key); } catch { return null; }
  },
  setItem: async (key: string, value: string) => {
    try { await SecureStore.setItemAsync(key, value); } catch {}
  },
  removeItem: async (key: string) => {
    try { await SecureStore.deleteItemAsync(key); } catch {}
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
