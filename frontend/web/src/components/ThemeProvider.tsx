"use client";

import { useEffect, useRef } from "react";
import { useThemeStore, useAuthStore, useWatchlistStore, useLearnStore } from "@/lib/store";

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme, loadThemeFromServer } = useThemeStore();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const lastSyncRef = useRef<number>(0);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const syncAll = () => {
      const now = Date.now();
      if (now - lastSyncRef.current < 30_000) return;
      lastSyncRef.current = now;

      loadThemeFromServer();
      useWatchlistStore.getState().loadFromServer();
      useLearnStore.getState().restoreFromServer();
    };

    // Initial sync on login
    syncAll();

    // Re-sync when user returns to the tab (catches changes made on another device)
    const onVisibility = () => {
      if (document.visibilityState === "visible") syncAll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [isAuthenticated]);

  return (
    <div style={{ height: "100vh", overflow: "hidden" }}>
      {children}
    </div>
  );
}
