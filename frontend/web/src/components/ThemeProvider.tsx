"use client";

import { useEffect } from "react";
import { useThemeStore, useAuthStore } from "@/lib/store";

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme, loadThemeFromServer } = useThemeStore();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (isAuthenticated) {
      loadThemeFromServer();
    }
  }, [isAuthenticated]);

  return (
    <div style={{ height: "100vh", overflow: "hidden" }}>
      {children}
    </div>
  );
}
