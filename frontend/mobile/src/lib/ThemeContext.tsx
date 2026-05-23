import React, { createContext, useContext, useState } from "react";

export const dark = {
  // ── Backgrounds ──────────────────────────────────────────────────
  bg:           "#06090f",   // True deep black with cool blue tint
  bgRaised:     "#080d17",   // Slightly lifted surface
  card:         "#0b1120",   // Card background
  cardElevated: "#0e1628",   // Modal / elevated cards

  // ── Borders ──────────────────────────────────────────────────────
  border:       "#152034",   // Subtle cool border
  borderStrong: "#1e3148",   // Stronger separator

  // ── Text hierarchy ────────────────────────────────────────────────
  text:         "#e4eeff",   // Near-white with cool tint
  textSub:      "#9ab4cc",   // Secondary text
  textMuted:    "#5b7a96",   // Muted labels
  textDim:      "#2e4a62",   // Disabled / very dim
  placeholder:  "#3a5570",   // Input placeholders

  // ── Accent ───────────────────────────────────────────────────────
  accent:       "#00a85e",   // Primary green
  accentLight:  "#00d47e",   // Bright / interactive green
  accentGlow:   "#00d47e1a", // Glow overlay

  // ── Semantic ─────────────────────────────────────────────────────
  up:           "#00d47e",
  down:         "#ff4757",
  warning:      "#ffb300",
  info:         "#4d9fff",
};

export const light = {
  bg:           "#f4f8ff",
  bgRaised:     "#ffffff",
  card:         "#ffffff",
  cardElevated: "#f0f5ff",

  border:       "#d8e8f8",
  borderStrong: "#b0cce8",

  text:         "#08142a",
  textSub:      "#1a3050",
  textMuted:    "#476880",
  textDim:      "#90aabf",
  placeholder:  "#90aabf",

  accent:       "#00a055",
  accentLight:  "#00b96b",
  accentGlow:   "#00b96b1a",

  up:           "#00b96b",
  down:         "#e8304a",
  warning:      "#d97706",
  info:         "#2563eb",
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
