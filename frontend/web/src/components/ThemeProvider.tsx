"use client";

import { useEffect } from "react";
import { useThemeStore, useAuthStore } from "@/lib/store";
import MarketTickerBar from "@/components/MarketTickerBar";

const TICKER_H = 30;

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
    <>
      <MarketTickerBar />
      <div style={{ paddingTop: isAuthenticated ? TICKER_H : 0 }}>
        {children}
      </div>
    </>
  );
}
