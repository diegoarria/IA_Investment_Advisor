"use client";

import { useEffect } from "react";
import { useThemeStore, useAuthStore } from "@/lib/store";
import MarketTickerBar from "@/components/MarketTickerBar";

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
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {isAuthenticated && (
        <div style={{ height: 30, flexShrink: 0 }}>
          <MarketTickerBar />
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}
