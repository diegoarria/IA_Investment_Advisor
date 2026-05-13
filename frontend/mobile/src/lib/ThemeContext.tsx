import React, { createContext, useContext, useState } from "react";

export const dark = {
  bg: "#0f1117",
  card: "#1a1d27",
  border: "#2a2d3a",
  text: "#ffffff",
  textSub: "#d1d5db",
  textMuted: "#9ca3af",
  textDim: "#6b7280",
  placeholder: "#4b5563",
  accent: "#16a34a",
  accentLight: "#22c55e",
};

export const light = {
  bg: "#f1f5f9",
  card: "#ffffff",
  border: "#e2e8f0",
  text: "#111827",
  textSub: "#374151",
  textMuted: "#6b7280",
  textDim: "#9ca3af",
  placeholder: "#9ca3af",
  accent: "#16a34a",
  accentLight: "#16a34a",
};

export type Colors = typeof dark;

interface ThemeCtx {
  colors: Colors;
  isDark: boolean;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeCtx>({
  colors: dark,
  isDark: true,
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(true);
  return (
    <ThemeContext.Provider
      value={{ colors: isDark ? dark : light, isDark, toggle: () => setIsDark((v) => !v) }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
