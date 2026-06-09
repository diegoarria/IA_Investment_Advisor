"use client";

import { useEffect } from "react";
import { useThemeStore } from "@/lib/store";
import { useAuthStore } from "@/lib/store";

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme, loadThemeFromServer } = useThemeStore();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Load server theme once on login — server is authoritative for cross-device sync
  useEffect(() => {
    if (isAuthenticated) {
      loadThemeFromServer();
    }
  }, [isAuthenticated]);

  return <>{children}</>;
}
